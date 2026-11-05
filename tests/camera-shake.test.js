import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// CameraRig usa window, localStorage y el lienzo; aquí basta con lo mínimo.
const listeners = {};
globalThis.window ??= { innerWidth: 1280, innerHeight: 720, addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); } };
const { CameraRig } = await import('../src/core/Camera.js');
const { Game } = await import('../src/core/game.js');

const canvas = { addEventListener() {}, removeEventListener() {}, requestPointerLock() {}, style: {} };
const rig = () => {
  const r = new CameraRig(new THREE.Scene(), canvas);
  r.mode = 'third-person';
  r.shakeEnabled = true;
  return r;
};

test('el trauma se suma con tope 1 y decae hasta cero', () => {
  const r = rig();
  r.addTrauma(.6); r.addTrauma(.7);
  assert.equal(r.trauma, 1);
  for (let i = 0; i < 120; i++) r.follow(new THREE.Vector3(), 1 / 60);
  assert.equal(r.trauma, 0);
});

test('el temblor gira la cámara sin moverla de su sitio', () => {
  const quiet = rig(), shaken = rig();
  const target = new THREE.Vector3(10, 0, 5);
  quiet.follow(target, 1 / 60);
  shaken.follow(target, 1 / 60);
  shaken.addTrauma(1);
  quiet.follow(target, 1 / 60);
  shaken.follow(target, 1 / 60);
  assert.ok(quiet.camera.position.distanceTo(shaken.camera.position) < 1e-9);
  assert.ok(quiet.camera.quaternion.angleTo(shaken.camera.quaternion) > 1e-4);
});

test('con movimiento reducido no hay temblor y los valores raros se ignoran', () => {
  const r = rig();
  r.addTrauma(NaN); r.addTrauma(-1);
  assert.equal(r.trauma, 0);
  r.shakeEnabled = false;
  r.addTrauma(.5);
  assert.equal(r.trauma, 0);
});

test('el temblor por daño crece con el golpe y el desgaste lento no lo dispara', () => {
  const trauma = [];
  const game = Object.assign(Object.create(Game.prototype), {
    stats: { salud: 100 }, cameraRig: { addTrauma: (a) => trauma.push(a) }
  });
  assert.equal(game._shakeOnDamage(), 0);
  game.stats.salud = 99.5; assert.equal(game._shakeOnDamage(), 0);
  game.stats.salud = 90; const leve = game._shakeOnDamage();
  game.stats.salud = 50; const fuerte = game._shakeOnDamage();
  assert.ok(leve > 0 && fuerte > leve && fuerte <= .45);
  game.stats.salud = 100; assert.equal(game._shakeOnDamage(), 0);
  assert.equal(trauma.length, 2);
});
