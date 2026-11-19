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
  return new Car(scene, new THREE.Vector3(0, 0, 0), 0, { kind: 'carro', variant: 1, ...options });
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

test('Limpiar parabrisas otorga monedas y consume energía', (t) => {
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

  // El conductor se niega una de cada ocho veces: con el azar fijo, este paga una propina normal ($ 1.500).
  t.mock.method(Math, 'random', () => 0.5);
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

test('un carro del que se bajó el conductor conserva sus espejos pero no golpea, habla ni paga propina', t => {
  t.mock.method(Math, 'random', () => 0);
  for (const died of [false, true]) {
    const car = fakeCar({ traffic: true });
    car.setDriverInside(false);
    car.driverDead = died;
    const stats = { salud: 100, energia: 50, dinero: 500, animo: 50, addXP() {} };
    const voice = t.mock.fn();
    const interaction = new InteractionSystem({ position: new THREE.Vector3() }, { add: () => true }, stats,
      { play() {}, playMovingTheft: voice }, null, { getEffect: (_k, fallback) => fallback });
    assert.equal(car.cleanable, false);
    interaction._cleanWindshield(car);
    assert.equal(stats.dinero, 500);
    assert.equal(stats.energia, 50);
    assert.equal(car.stealable, true);
    interaction._executeCarTheft(car);
    assert.equal(stats.salud, 100);
    assert.equal(stats.dinero, 500);
    assert.equal(voice.mock.callCount(), 0);
    car.dispose();
  }
});

test('El prompt de interacción ofrece robar retrovisor y limpiar parabrisas', () => {
  const car = fakeCar();
  const prompt = textoDelPrompt({ currentTarget: car, currentTargetType: 'car' });
  assert.match(prompt, /Robar retrovisor/);
  assert.match(prompt, /Limpiar parabrisas/);

  car.dispose();
});
