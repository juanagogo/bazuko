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
  const input = { down, pressed, stick: null, isDown: c => down.has(c), consumePress: c => pressed.delete(c) };
  Object.defineProperty(input, 'axis', { get() {
    const x = (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0), z = (down.has('KeyS') ? 1 : 0) - (down.has('KeyW') ? 1 : 0);
    return (x || z || !input.stick) ? { x, z } : input.stick;
  } });
  return input;
}

/** Avanza hasta que termine de subir o bajar (BOARDING). Devuelve los cuadros que tardó. */
function settle(carjack, input, dt = 1 / 30) {
  let frames = 0;
  while (carjack.transition && frames < 200) { carjack.update(dt, input); frames++; }
  return frames;
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
  // Primero camina a la puerta y la fuerza: sigue a la vista hasta meterse.
  assert.equal(game.player.root.visible, true);
  assert.equal(carjack.transition?.kind, 'enter');
  const frames = settle(carjack, fakeInput());
  assert.ok(frames > 5 && frames < 60, `subir tardó ${frames} cuadros`);
  assert.equal(game.player.root.visible, false);
  assert.equal(game.steal.buscado, 1);
  assert.equal(game.cameraRig.distance, CARJACK.cameraDistance);
});

test('el carro robado avanza con W, gira con A y el jugador se baja al lado', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  settle(carjack, input);
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
  assert.ok(game.cameraRig.distance > 5.5, 'la cámara no salta hacia el jugador');
  // Aparece pegado a la puerta y da un paso hasta quedar libre.
  assert.ok(distanceToCarBody(game.player.position, car) < .5);
  assert.equal(carjack.update(1 / 30, input), true, 'mientras se baja no camina por su cuenta');
  settle(carjack, input);
  assert.ok(Math.abs(distanceToCarBody(game.player.position, car) - .7) < .05);
  assert.equal(carjack.update(1 / 30, input), false);
  for (let i = 0; i < 30; i++) carjack.update(1 / 30, input);
  assert.equal(game.cameraRig.distance, 5.5, 'y vuelve a su distancia a pie');
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

test('con el stick del mando también se maneja', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  settle(carjack, input);
  input.stick = { x: -.8, z: -1 };
  for (let i = 0; i < 45; i++) carjack.update(1 / 30, input);
  assert.ok(carjack.speed > 3, `velocidad ${carjack.speed}`);
  assert.ok(car.group.rotation.y > 0, 'el stick a la izquierda gira a la izquierda');
});

test('el carro robado se guarda y vuelve estacionado donde quedó', () => {
  const car = fakeCar(), game = fakeGame([car]);
  car.kind = 'taxi'; car.variant = 77;
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  car.position.set(12.345, 0, -7.5); car.group.rotation.y = 1.2;
  carjack.exit();
  const saved = JSON.parse(JSON.stringify(carjack.serialize()));
  assert.deepEqual(saved, { pos: [12.35, 0, -7.5], rot: 1.2, kind: 'taxi', variant: 77 });

  // Partida nueva: se rehace el mismo carro con su modelo y variante.
  const created = [];
  class CarClass { constructor(scene, pos, rot, opts) { Object.assign(this, fakeCar(pos.x, pos.z)); this.group.rotation.y = rot; this.opts = opts; created.push(this); } }
  const fresh = fakeGame([]);
  fresh.sceneMgr = { scene: {} };
  const registered = [];
  fresh.interaction = { register: c => registered.push(c) };
  const loaded = new CarjackSystem(fresh).restore(saved, { CarClass });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].opts, { kind: 'taxi', variant: 77 });
  assert.ok(fresh.cars.includes(loaded) && registered.includes(loaded));
  assert.equal(loaded.position.x, 12.35);
  assert.equal(loaded.group.rotation.y, 1.2);
});

test('una partida con datos rotos del carro robado no rompe la carga', () => {
  const game = fakeGame([]);
  game.sceneMgr = { scene: {} };
  const carjack = new CarjackSystem(game);
  for (const bad of [null, {}, { pos: [1, 2] , rot: 0 }, { pos: [1, 'x', 3], rot: 0 }, { pos: [1, 0, 3], rot: 0, kind: 'police' }]) {
    assert.equal(carjack.restore(bad, { CarClass: class {} }), null);
  }
  assert.equal(game.cars.length, 0);
});

test('LB + B en el mando es la tecla de robar carros', async () => {
  const { CON_LB } = await import('../src/core/Gamepad.js');
  assert.equal(CON_LB[1], CARJACK.key);
});

test('al sacar al conductor, este sigue sentado hasta que lo jalan y el carro se hunde en los muelles', () => {
  const car = fakeCar(), vehicle = { car, speed: 0 }, game = fakeGame([], [vehicle]), input = fakeInput();
  let inside = true, settles = 0;
  car.setDriverInside = v => { inside = v; };
  car.settle = () => { settles++; };
  const ejected = [];
  game.roadRage = { ejectDriver: (c, at) => ejected.push({ c, at }) };
  const carjack = new CarjackSystem(game);
  input.pressed.add(CARJACK.key);
  carjack.update(1 / 30, input);
  assert.equal(inside, true, 'el conductor no desaparece al apretar la tecla');
  settle(carjack, input);
  assert.equal(inside, false);
  assert.equal(ejected.length, 1, 'el conductor sale corriendo');
  assert.ok(ejected[0].at.distanceTo(game.player.position) > .5, 'no aparece encima del jugador');
  assert.ok(settles >= 2, 'se abre la puerta y se sienta: dos hundidas');
  assert.equal(game.player.root.visible, false);
});

test('reiniciar a mitad de subir no deja al conductor sentado ni al jugador oculto', () => {
  const car = fakeCar(), vehicle = { car, speed: 0 }, game = fakeGame([], [vehicle]), input = fakeInput();
  let inside = true;
  car.setDriverInside = v => { inside = v; };
  const carjack = new CarjackSystem(game);
  input.pressed.add(CARJACK.key);
  carjack.update(1 / 30, input);
  carjack.reset();
  assert.equal(carjack.transition, null);
  assert.equal(inside, false);
  assert.equal(game.player.root.visible, true);
  assert.equal(carjack.update(1 / 30, input), false);
});

test('la suspensión del carro baja unos centímetros y vuelve al reposo', async () => {
  const { Car } = await import('../src/entities/Car.js').catch(() => ({}));
  if (!Car) return;
  const car = Object.create(Car.prototype);
  const body = new THREE.Object3D();
  Object.assign(car, { vehicle: { bodyVisual: body }, _bodyRestY: .1, _roadBob: 0, _settleY: 0, _settleV: 0 });
  car.settle(1);
  let lowest = 0;
  for (let i = 0; i < 20; i++) { car._updateSettle(1 / 60); lowest = Math.min(lowest, body.position.y - .1); }
  assert.ok(lowest < -.008 && lowest > -.06, `bajó ${lowest}`);
  for (let i = 0; i < 180; i++) car._updateSettle(1 / 60);
  assert.equal(car._settleY, 0);
  assert.ok(Math.abs(body.position.y - .1) < 1e-9);
});

test('subirse otra vez mientras la cámara regresa conserva la distancia a pie', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null }); settle(carjack, input);
  carjack.exit();
  carjack.update(1 / 30, input);
  settle(carjack, input);
  carjack.enter({ car, vehicle: null }); settle(carjack, input);
  assert.equal(game.cameraRig.distance, CARJACK.cameraDistance);
  carjack.reset();
  assert.equal(game.cameraRig.distance, 5.5);
});

test('mientras maneja, por las ventanas se ve al jugador sentado al volante', async () => {
  const { Car } = await import('../src/entities/Car.js');
  const scene = new THREE.Scene();
  const car = new Car(scene, new THREE.Vector3(), 0, { kind: 'carro', model: 'citadino', variant: 3 });
  const game = fakeGame([car]), input = fakeInput();
  game.player.position.set(0, 0, car.width / 2 + .8);
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  assert.ok(!car._playerDriver?.visible, 'todavía camina hacia la puerta');
  settle(carjack, input);
  assert.equal(car._playerDriver.visible, true);
  assert.equal(car._playerDriver.parent, car.vehicle.bodyVisual ?? car.group, 'se mueve con la carrocería');
  carjack.exit();
  assert.equal(car._playerDriver.visible, false, 'al bajarse queda vacío');
  carjack.enter({ car, vehicle: null }); settle(carjack, input);
  carjack.reset();
  assert.equal(car._playerDriver.visible, false);
  car.dispose();
});
