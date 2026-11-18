// tests/carjack.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CarjackSystem, CARJACK, distanceToCarBody } from '../src/systems/CarjackSystem.js';

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

function fakeGame(cars = []) {
  const root = new THREE.Group();
  return {
    cars, traffic: { vehicles: [] },
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

test('Y junto a un carro estacionado lo roba, oculta al jugador y sube buscado', () => {
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
  carjack.enter({ car });
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
  carjack.enter({ car });
  input.down.add('KeyW');
  for (let i = 0; i < 120; i++) carjack.update(1 / 30, input);
  assert.ok(car.position.x + car.length / 2 <= 4.01, `posición ${car.position.x}`);
});

test('con el stick del mando también se maneja', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  carjack.enter({ car });
  settle(carjack, input);
  input.stick = { x: -.8, z: -1 };
  for (let i = 0; i < 45; i++) carjack.update(1 / 30, input);
  assert.ok(carjack.speed > 3, `velocidad ${carjack.speed}`);
  assert.ok(car.group.rotation.y > 0, 'el stick a la izquierda gira a la izquierda');
});

test('LB + B en el mando es la tecla de robar carros', async () => {
  const { CON_LB } = await import('../src/core/Gamepad.js');
  assert.equal(CON_LB[1], CARJACK.key);
});

test('reiniciar a mitad de subir no deja al jugador oculto ni el carro con conductor', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  input.pressed.add(CARJACK.key);
  carjack.update(1 / 30, input);
  assert.ok(carjack.transition, 'va caminando a la puerta');
  carjack.reset();
  assert.equal(carjack.transition, null);
  assert.equal(car.driven, false);
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
  carjack.enter({ car }); settle(carjack, input);
  carjack.exit();
  carjack.update(1 / 30, input);
  settle(carjack, input);
  carjack.enter({ car }); settle(carjack, input);
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
  carjack.enter({ car });
  assert.ok(!car._playerDriver?.visible, 'todavía camina hacia la puerta');
  settle(carjack, input);
  assert.equal(car._playerDriver.visible, true);
  assert.equal(car._playerDriver.parent, car.vehicle.bodyVisual ?? car.group, 'se mueve con la carrocería');
  carjack.exit();
  assert.equal(car._playerDriver.visible, false, 'al bajarse queda vacío');
  carjack.enter({ car }); settle(carjack, input);
  carjack.reset();
  assert.equal(car._playerDriver.visible, false);
  car.dispose();
});
