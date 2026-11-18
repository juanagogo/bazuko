// tests/player-poop.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

const POSE = { drop: 1, censor: true, stance: null };
const pressing = codes => ({ axis: { x: 1, z: 0 }, isRunning: false, consumePress: code => codes.includes(code) });

test('haciendo popó no camina, no salta ni golpea', () => {
  const collisions = new CollisionSystem();
  const free = new Player(new THREE.Scene(), pressing([]));
  for (let i = 0; i < 10; i++) free.update(.1, null, collisions);
  assert.ok(free.position.length() > .3, 'sin la escena el mismo control sí lo mueve');

  const player = new Player(new THREE.Scene(), pressing(['Space', 'KeyG']));
  const start = player.position.clone();
  player.setPoopPose(POSE);
  assert.equal(player.busyPoop, true);
  for (let i = 0; i < 10; i++) player.update(.1, null, collisions);
  assert.ok(player.position.distanceTo(start) < 1e-6, 'se queda en su sitio');
  assert.equal(player.jumpVelocity, 0);
  assert.equal(player.isGrounded, true);
  assert.notEqual(player.action, 'golpear');
  assert.equal(player.attack, null);
  assert.equal(player.punch(), false);
  free.dispose(); player.dispose();
});

test('el cigarrillo y el arma se guardan y vuelven al vestirse', () => {
  const player = new Player(new THREE.Scene(), pressing([]));
  player.equippedWeapon = 'cuchillo';
  player.smoking = { kind: 'cigarrillo', left: 60, nextPuff: 5, puff: 0 };
  const weapon = [], smoke = [];
  player.character.setWeapon = id => weapon.push(id);
  player.character.setSmoking = (on, kind) => smoke.push(on ? kind : false);
  player.setPoopPose(POSE);
  assert.equal(weapon.at(-1), null);
  assert.equal(smoke.at(-1), false);
  assert.equal(player._holdingCigarette, false);
  player.setPoopPose(null);
  assert.equal(weapon.at(-1), 'cuchillo');
  assert.equal(smoke.at(-1), 'cigarrillo');
  assert.equal(player._holdingCigarette, true);
  player.dispose();
});

test('al terminar o al cambiar de modelo los dos personajes quedan vestidos', async () => {
  const player = new Player(new THREE.Scene(), pressing([]));
  const procedural = [], realistic = [];
  player.procedural.setUndress = state => procedural.push(state);
  player._realistic = { setUndress: state => realistic.push(state) };
  player.setPoopPose(POSE);
  player.setPoopPose(null);
  assert.equal(procedural.at(-1), null);
  assert.equal(realistic.at(-1), null);
  assert.equal(player.busyPoop, false);

  player.setPoopPose(POSE);
  player.modelKind = 'realista';
  player._realistic = { setUndress: state => realistic.push(state), group: new THREE.Group(), dispose() {} };
  player.character = player._realistic;
  await player.setModel('procedural');
  assert.equal(player.busyPoop, false);
  assert.equal(procedural.at(-1), null);
  assert.equal(realistic.at(-1), null);
  player.dispose();
});

test('la postura de las manos y el censurado llegan al personaje', () => {
  const player = new Player(new THREE.Scene(), pressing([]));
  const camera = new THREE.PerspectiveCamera(50, 1.5, .1, 100);
  camera.position.set(0, 1.6, 3.5);
  camera.lookAt(0, .6, 0);
  camera.updateMatrixWorld();
  let stance, undress;
  const update = player.character.update;
  player.character.update = (dt, options) => { stance = options.stance; return update(dt, options); };
  player.character.setUndress = state => { undress = state; };
  player.setPoopPose({ drop: .7, censor: true, stance: 'pretina' });
  player.update(1 / 60, camera, new CollisionSystem());
  assert.equal(stance, 'pretina');
  assert.equal(undress.drop, .7);
  assert.equal(undress.censor, true);
  assert.ok(Number.isInteger(undress.block) && undress.block >= 3);
  assert.equal(typeof undress.seed, 'number');
  player.dispose();
});
