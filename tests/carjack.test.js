// tests/carjack.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CarjackSystem, CARJACK, distanceToCarBody } from '../src/systems/CarjackSystem.js';
import { MirrorCinematic, MIRROR_CINEMATIC } from '../src/ui/MirrorCinematic.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fakeCar(x = 0, z = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  return { group, get position() { return group.position; }, length: 4.2, width: 1.8,
    marker: { visible: true }, traffic: false, setNight() {}, animateDrive() {} };
}

function fakeInput() {
  const down = new Set(), pressed = new Set();
  return { down, pressed, isDown: c => down.has(c), consumePress: c => pressed.delete(c) };
}

function fakeGame(cars = [], vehicles = []) {
  const root = new THREE.Group();
  return {
    cars, traffic: { vehicles, setParkedCars() {}, release(v) { vehicles.splice(vehicles.indexOf(v), 1); } },
    player: { position: new THREE.Vector3(0, 0, 1.5), root, velocity: new THREE.Vector3() },
    cameraRig: { mode: 'third-person', yaw: 0, pitch: .22, distance: 5.5 },
    collisions: { queryStatic: () => [], dynamicColliders: [] },
    world: { active: { npcs: [], getGroundHeight: () => 0 } },
    steal: { buscado: 0 }, stats: { salud: 100, addXP() {} }
  };
}

test('la distancia a la carrocería es cero dentro y crece desde el costado', () => {
  const car = fakeCar();
  assert.equal(distanceToCarBody(new THREE.Vector3(0, 0, 0), car), 0);
  assert.ok(Math.abs(distanceToCarBody(new THREE.Vector3(0, 0, 1.9), car) - 1) < 1e-9);
});

test('H junto a un carro estacionado lo roba, oculta al jugador y sube buscado', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  assert.equal(carjack.update(.016, input), false);
  assert.match(carjack.prompt, /Forzar la puerta/);
  input.pressed.add(CARJACK.key);
  assert.equal(carjack.update(.016, input), true);
  assert.equal(carjack.car, car);
  assert.equal(game.player.root.visible, false);
  assert.equal(game.steal.buscado, 1);
  assert.equal(game.cameraRig.distance, CARJACK.cameraDistance);
});

test('el carro robado avanza con W, gira con A y el jugador se baja al lado', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  input.down.add('KeyW');
  for (let i = 0; i < 60; i++) carjack.update(1 / 30, input);
  assert.ok(car.position.x > 5, `avanzó ${car.position.x}`);
  assert.ok(game.player.position.distanceTo(car.position) < 1e-9);
  input.down.add('KeyA');
  const heading = car.group.rotation.y;
  for (let i = 0; i < 10; i++) carjack.update(1 / 30, input);
  assert.ok(car.group.rotation.y > heading, 'A gira a la izquierda');
  input.down.clear(); input.down.add('Space');
  for (let i = 0; i < 90; i++) carjack.update(1 / 30, input);
  assert.ok(Math.abs(carjack.speed) < CARJACK.exitSpeed);
  input.pressed.add(CARJACK.key);
  carjack.update(1 / 30, input);
  assert.equal(carjack.car, null);
  assert.equal(game.player.root.visible, true);
  assert.equal(game.cameraRig.distance, 5.5);
  assert.ok(Math.abs(distanceToCarBody(game.player.position, car) - .7) < .05);
});

test('una pared detiene el carro en lugar de atravesarla', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const wall = { box: new THREE.Box3(new THREE.Vector3(4, 0, -5), new THREE.Vector3(5, 3, 5)) };
  game.collisions.queryStatic = () => [wall];
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  input.down.add('KeyW');
  for (let i = 0; i < 120; i++) carjack.update(1 / 30, input);
  assert.ok(car.position.x + car.length / 2 <= 4.01, `posición ${car.position.x}`);
});

test('sacar al conductor retira el carro de la circulación y lo deja como estacionado', () => {
  const car = fakeCar(), vehicle = { car, speed: 0 }, vehicles = [vehicle];
  const game = fakeGame([], vehicles), input = fakeInput();
  const carjack = new CarjackSystem(game);
  input.pressed.add(CARJACK.key);
  carjack.update(.016, input);
  assert.equal(carjack.car, car);
  assert.equal(vehicles.length, 0);
  assert.ok(game.cars.includes(car));
  carjack.exit();
  assert.equal(car.traffic, false);
});

test('un carro en marcha no se puede robar', () => {
  const car = fakeCar(), game = fakeGame([], [{ car, speed: 9 }]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  input.pressed.add(CARJACK.key);
  assert.equal(carjack.update(.016, input), false);
  assert.equal(carjack.car, null);
});

test('TrafficSystem.release libera el vehículo de las reservas de cruce', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const vehicle = {}, other = {};
  const state = { owners: new Map([[vehicle, {}]]), plans: new Map([[vehicle, {}]]), queue: [vehicle, other] };
  Object.assign(traffic, { vehicles: [vehicle, other], _routeVehicles: new Map([['r', [vehicle]]]), signals: { reservations: new Map([['n', state]]) } });
  assert.equal(traffic.release(vehicle), true);
  assert.deepEqual(traffic.vehicles, [other]);
  assert.equal(state.owners.size, 0);
  assert.deepEqual(state.queue, [other]);
});

test('robar un espejo dispara la cinemática y restaura la cámara al terminar', () => {
  const game = fakeGame();
  const cinematic = new MirrorCinematic(game, { random: () => 0 });
  window.dispatchEvent(new CustomEvent('steal', { detail: { mirror: true, caught: false, car: fakeCar(0, 3) } }));
  assert.equal(cinematic.active, true);
  assert.equal(game.cameraRig.distance, MIRROR_CINEMATIC.distance);
  cinematic.update(MIRROR_CINEMATIC.duration + .1);
  assert.equal(cinematic.active, false);
  assert.equal(game.cameraRig.distance, 5.5);
  assert.equal(cinematic.play(), false, 'enfriamiento entre cinemáticas');
});
