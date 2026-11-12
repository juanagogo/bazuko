// tests/windshield-cleaning.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Car } from '../src/entities/Car.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { textoDelPrompt } from '../src/ui/HUD.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

function fakeCar(options = {}) {
  const scene = new THREE.Scene();
  return new Car(scene, new THREE.Vector3(0, 0, 0), 0, { kind: 'carro', variant: 1, traffic: true, ...options });
}

test('Carro recién creado es apto para limpiar parabrisas', () => {
  const car = fakeCar();
  assert.equal(car.cleanable, true);

  const res = car.cleanWindshield();
  assert.ok(res);
  assert.equal(res.success, true);
  assert.equal(car.cleanable, false, 'Entra en enfriamiento');
  assert.ok(car.cleanCooldown > 0);

  car.update(car.cleanCooldown + 1);
  assert.equal(car.cleanable, true, 'Vuelve a estar disponible tras enfriamiento');

  car.dispose();
});

test('Limpiar parabrisas otorga monedas y consume energía', () => {
  const car = fakeCar();
  const player = { position: new THREE.Vector3(0, 0, 1.2), faceTowards() {}, playAction() {} };
  const stats = { energia: 50, dinero: 1000, animo: 50, addXP() {} };
  const interaction = new InteractionSystem(
    player,
    { add: () => true },
    stats,
    { play: () => {} },
    null,
    { getEffect: (_k, b) => b },
    null
  );

  let cleanedEvent = null;
  window.addEventListener('windshield-cleaned', (e) => {
    cleanedEvent = e.detail;
  });

  interaction._cleanWindshield(car);

  assert.ok(cleanedEvent);
  assert.ok(cleanedEvent.amount > 0);
  assert.ok(stats.dinero > 1000, 'Ganó monedas');
  assert.equal(stats.energia, 48, 'Gastó 2 de energía');
  assert.equal(car.cleanable, false, 'Carro quedó en cooldown');

  car.dispose();
});

test('Sin energía no se puede limpiar el parabrisas', () => {
  const car = fakeCar();
  const player = { position: new THREE.Vector3(0, 0, 1.2) };
  const stats = { energia: 1, dinero: 500, animo: 50, addXP() {} };
  const interaction = new InteractionSystem(
    player,
    { add: () => true },
    stats,
    { play: () => {} },
    null,
    { getEffect: (_k, b) => b },
    null
  );

  interaction._cleanWindshield(car);

  assert.equal(stats.dinero, 500, 'No ganó plata');
  assert.equal(car.cleanable, true, 'El carro sigue sin limpiar');

  car.dispose();
});

test('El prompt de interacción ofrece robar retrovisor y limpiar parabrisas', () => {
  const car = fakeCar();
  const prompt = textoDelPrompt({ currentTarget: car, currentTargetType: 'car' });
  assert.match(prompt, /Robar retrovisor/);
  assert.match(prompt, /Limpiar parabrisas/);

  car.dispose();
});

test('Solo paga un carro en circulación detenido: ni parqueados ni carros en marcha', () => {
  const parked = fakeCar({ traffic: false });
  assert.equal(parked.cleanable, false, 'un parqueado no tiene conductor que pague');
  assert.equal(parked.cleanWindshield(), null);

  const moving = fakeCar();
  moving.animateDrive(.4, false, { dt: .05, speed: 8 });
  assert.equal(moving.cleanable, false, 'a uno en marcha no se le alcanza');
  moving.animateDrive(0, true, { dt: .05, speed: 0 });
  assert.equal(moving.cleanable, true, 'detenido en el semáforo, sí');

  parked.dispose();
  moving.dispose();
});
