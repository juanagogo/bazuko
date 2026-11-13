import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { KnockFeedback, KNOCK } from '../src/systems/KnockFeedback.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

function attack(id = 1) {
  return { id, timing: { windup: .12, range: 1.6 } };
}

function fighter() {
  return { position: new THREE.Vector3(), root: { rotation: { y: 0 } }, melee: { attack: attack(1), elapsed: 0 } };
}

test('pegarle a un carro suena una vez por golpe, con enfriamiento', () => {
  const collisions = new CollisionSystem();
  const group = new THREE.Object3D();
  const car = { traffic: false, kind: 'carro', position: new THREE.Vector3(0, 0, 1.4), length: 4, width: 1.7,
    group, vehicle: { group } };
  collisions.setVehicles([car]);
  const player = fighter();
  let knocks = 0, metals = 0, alarms = 0, hitCar = null;
  const audio = { playKnock(_p, { metal } = {}) { knocks++; if (metal) metals++; }, playCarAlarm() { alarms++; } };
  window.addEventListener('solid-hit', event => { hitCar = event.detail.car; });
  const system = new KnockFeedback({ player, audio, collisions });

  // En la anticipación todavía no suena.
  system.update(.05);
  assert.equal(knocks, 0);
  // Al terminar la anticipación suena una vez y avisa que le pegó al carro.
  player.melee.elapsed = .13;
  system.update(.05);
  assert.equal(knocks, 1);
  assert.equal(metals, 1, 'un carro suena metálico');
  assert.equal(alarms, 1, 'el parqueado enciende su alarma');
  assert.equal(hitCar, car, 'y avisa para que el conductor se baje');
  // El mismo golpe no vuelve a sonar.
  system.update(.05);
  assert.equal(knocks, 1);
  // Otro golpe dentro del enfriamiento tampoco.
  player.melee.attack = attack(2);
  system.update(.02);
  player.melee.elapsed = .13;
  system.update(.02);
  assert.equal(knocks, 1, 'el enfriamiento aguanta');
  // Pasado el enfriamiento, el siguiente golpe suena.
  for (let t = 0; t < KNOCK.cooldown; t += .02) system.update(.02);
  player.melee.attack = attack(3);
  player.melee.elapsed = 0;
  system.update(.02);
  player.melee.elapsed = .13;
  system.update(.02);
  assert.equal(knocks, 2);
});

test('una pared o una caneca suenan hueco y no encienden alarma', () => {
  const collisions = new CollisionSystem();
  const block = new THREE.Object3D();
  block.position.set(0, 0, 1.2);
  collisions.add(block, new THREE.Vector3(1, 2, 1));
  const player = fighter();
  let knocks = 0, metals = 0, alarms = 0;
  const audio = { playKnock(_p, { metal } = {}) { knocks++; if (metal) metals++; }, playCarAlarm() { alarms++; } };
  const system = new KnockFeedback({ player, audio, collisions });
  player.melee.elapsed = .13;
  system.update(.02);
  assert.equal(knocks, 1);
  assert.equal(metals, 0, 'no es metálico');
  assert.equal(alarms, 0, 'y no hay alarma que encender');
});

test('el parqueado se mece unos centímetros y vuelve a su puesto', () => {
  const collisions = new CollisionSystem();
  const group = new THREE.Object3D();
  const car = { traffic: false, kind: 'carro', position: new THREE.Vector3(0, 0, 1.4), length: 4, width: 1.7,
    group, vehicle: { group } };
  collisions.setVehicles([car]);
  const player = fighter();
  player.melee.elapsed = .13;
  const system = new KnockFeedback({ player, audio: { playKnock() {}, playCarAlarm() {} }, collisions });
  system.update(.02); // golpe y aviso de balanceo
  system.update(.02); // el primer vaivén
  assert.notEqual(group.rotation.z, 0);
  for (let t = 0; t < KNOCK.rockTime + .1; t += .05) system.update(.05);
  assert.equal(group.rotation.z, 0, 'queda recto');
});

test('lo que queda detrás del jugador no cuenta', () => {
  const collisions = new CollisionSystem();
  const car = { traffic: true, kind: 'carro', position: new THREE.Vector3(0, 0, -1.4), length: 4, width: 1.7,
    group: new THREE.Object3D() };
  collisions.setVehicles([car]);
  const player = fighter();
  let knocks = 0;
  const system = new KnockFeedback({ player, audio: { playKnock() { knocks++; } }, collisions });
  player.melee.elapsed = .13;
  system.update(.02);
  assert.equal(knocks, 0);
});
