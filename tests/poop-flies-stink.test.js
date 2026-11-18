// tests/poop-flies-stink.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FLIES_PER_POOP, FLY_ARRIVE, FLY_STAGGER, PoopFlies } from '../src/entities/PoopFlies.js';
import { PoopStink, STINK_PER_POOP, STINK_RISE } from '../src/entities/PoopStink.js';

const pileAt = (x, extra = {}) => ({
  position: new THREE.Vector3(x, 0, 0), top: new THREE.Vector3(x, .2, 0), yaw: 0,
  visible: true, settledAge: 5, fade: 0, seed: 3 + x, ...extra
});

const flyPosition = (flies, i) => {
  const m = new THREE.Matrix4();
  flies.bodies.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
};

test('cada popó asentada y visible tiene seis moscas; en calidad baja tres', () => {
  const flies = new PoopFlies(new THREE.Scene());
  const piles = [pileAt(0), pileAt(4)];
  flies.update(1 / 60, piles, { time: 1, quality: 'alta' });
  assert.equal(FLIES_PER_POOP.alta, 6);
  assert.equal(flies.count, 12);
  flies.update(1 / 60, piles, { time: 1, quality: 'baja' });
  assert.equal(flies.count, 6);
});

test('al bajar la calidad con moscas en pantalla no quedan instancias viejas', () => {
  const flies = new PoopFlies(new THREE.Scene());
  const piles = [pileAt(0), pileAt(4)];
  flies.update(1 / 60, piles, { time: 1, quality: 'alta' });
  assert.equal(flies.bodies.count, 12);
  assert.equal(flies.wings.count, 24);
  flies.update(1 / 60, piles, { time: 1.1, quality: 'baja' });
  assert.equal(flies.bodies.count, 6);
  assert.equal(flies.wings.count, 12);
});

test('las moscas no llegan antes de asentarse ni a popós lejanas', () => {
  const flies = new PoopFlies(new THREE.Scene());
  flies.update(1 / 60, [pileAt(0, { settledAge: null })], { time: 1 });
  assert.equal(flies.count, 0);
  flies.update(1 / 60, [pileAt(0, { visible: false })], { time: 1 });
  assert.equal(flies.count, 0);
  flies.update(1 / 60, [pileAt(0, { settledAge: FLY_ARRIVE - .1 })], { time: 1 });
  assert.equal(flies.count, 0, 'llegan después de asentarse');
});

test('las moscas llegan escalonadas desde lejos', () => {
  const flies = new PoopFlies(new THREE.Scene());
  const arriving = pileAt(0, { settledAge: FLY_ARRIVE + FLY_STAGGER + .1 });
  flies.update(1 / 60, [arriving], { time: 2 });
  assert.equal(flies.count, 2, 'solo las dos primeras van llegando');
  const far = flyPosition(flies, 1).distanceTo(arriving.position);
  flies.update(1 / 60, [pileAt(0, { settledAge: 6 })], { time: 2 });
  const near = flyPosition(flies, 1).distanceTo(arriving.position);
  assert.ok(far > near + .5, `llega de lejos (${far.toFixed(2)} m) y luego ronda (${near.toFixed(2)} m)`);
  assert.ok(near < .6);
});

test('el olor aparece en 1,5 s y se va con la popó', () => {
  const stink = new PoopStink(new THREE.Scene());
  stink.update(1 / 60, [pileAt(0, { settledAge: 0 })], { time: 1 });
  assert.equal(stink.count, STINK_PER_POOP);
  assert.equal(stink.strengthAt(0), 0);
  stink.update(1 / 60, [pileAt(0, { settledAge: STINK_RISE })], { time: 1 });
  assert.ok(Math.abs(stink.strengthAt(0) - .85) < 1e-6);
  stink.update(1 / 60, [pileAt(0, { settledAge: 10, fade: 1 })], { time: 1 });
  assert.equal(stink.strengthAt(0), 0);
  stink.update(1 / 60, [pileAt(0, { settledAge: null })], { time: 1 });
  assert.equal(stink.count, 0);
});

test('moscas y olor son tres mallas instanciadas sin importar cuántas popós haya', () => {
  for (const n of [1, 8]) {
    const scene = new THREE.Scene();
    const flies = new PoopFlies(scene);
    const stink = new PoopStink(scene);
    const piles = Array.from({ length: n }, (_, i) => pileAt(i * 3));
    flies.update(1 / 60, piles, { time: 1 });
    stink.update(1 / 60, piles, { time: 1 });
    assert.equal(scene.children.length, 3);
    assert.ok(scene.children.every(child => child.isInstancedMesh));
    flies.dispose();
    stink.dispose();
    assert.equal(scene.children.length, 0);
  }
});
