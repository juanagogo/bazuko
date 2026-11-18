// tests/ground-poops.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  GroundPoops, MAX_GROUND_POOPS, PEE_LIFETIME, POOP_FADE, POOP_LIFETIME, POOP_PIECES
} from '../src/entities/GroundPoops.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function advance(ground, seconds, dt = .25) {
  for (let t = 0; t < seconds - 1e-9; t += dt) ground.update(dt);
}

test('una popó nueva aparece vacía y revela sus cinco trozos en orden', () => {
  const ground = new GroundPoops(new THREE.Scene());
  assert.equal(ground.pieceEnds.length, POOP_PIECES);
  const pile = ground.spawn(V(1, 0, 1), { pieces: 0 });
  assert.equal(pile.mesh.geometry.drawRange.count, 0);
  ground.reveal(pile, 3);
  assert.equal(pile.pieces, 3);
  assert.equal(pile.mesh.geometry.drawRange.count, ground.pieceEnds[2]);
  ground.reveal(pile, 5);
  assert.equal(pile.mesh.geometry.drawRange.count, pile.mesh.geometry.index.count);
  for (let i = 1; i < POOP_PIECES; i++) assert.ok(ground.pieceEnds[i] > ground.pieceEnds[i - 1]);
});

test('como mucho ocho popós: la novena retira entera la más vieja con su desvanecimiento', () => {
  const scene = new THREE.Scene();
  const ground = new GroundPoops(scene);
  const piles = [];
  for (let i = 0; i <= MAX_GROUND_POOPS; i++) piles.push(ground.spawn(V(i * 2, 0, 0), { pieces: POOP_PIECES }));
  assert.equal(ground.activeCount, MAX_GROUND_POOPS);
  assert.equal(ground.piles.length, MAX_GROUND_POOPS + 1);
  ground.update(.1);
  assert.ok(piles[0].fade > 0, 'la más vieja empieza a irse');
  assert.equal(piles[1].fade, 0);
  advance(ground, POOP_FADE + .1, .1);
  assert.equal(ground.piles.length, MAX_GROUND_POOPS);
  assert.equal(piles[0].group.parent, null);
  assert.ok(!ground.piles.includes(piles[0]));
});

test('la popó dura 45 s y el charquito se seca antes', () => {
  const scene = new THREE.Scene();
  const ground = new GroundPoops(scene);
  const pile = ground.spawn(V(), { pieces: POOP_PIECES, pee: true, peeAt: V(0, 0, .24) });
  ground.setPee(pile, 1, null);
  ground.update(0);
  assert.ok(pile.peeMesh.visible && pile.peeMesh.scale.x > 0);
  advance(ground, PEE_LIFETIME + .5);
  assert.ok(!pile.peeMesh.visible || pile.peeMesh.scale.x === 0, 'el charquito ya se secó');
  assert.ok(ground.piles.includes(pile), 'la popó sigue ahí');
  assert.equal(pile.fade, 0);
  advance(ground, POOP_LIFETIME + .1 - (PEE_LIFETIME + .5));
  assert.ok(!ground.piles.includes(pile));
  assert.equal(pile.group.parent, null);
});

test('nearestDistance da la distancia a la popó más cercana', () => {
  const ground = new GroundPoops(new THREE.Scene());
  assert.equal(ground.nearestDistance(V()), Infinity);
  ground.spawn(V(7, 0, 0), { pieces: POOP_PIECES });
  ground.spawn(V(0, 0, 2), { pieces: POOP_PIECES });
  assert.ok(Math.abs(ground.nearestDistance(V()) - 2) < 1e-6);
});

test('las popós comparten geometría y materiales', () => {
  const ground = new GroundPoops(new THREE.Scene());
  const a = ground.spawn(V(), { pieces: POOP_PIECES, pee: true, peeAt: V(0, 0, .2) });
  const b = ground.spawn(V(3, 0, 0), { pieces: POOP_PIECES, pee: true, peeAt: V(3, 0, .2) });
  assert.equal(a.mesh.material, b.mesh.material);
  assert.equal(a.mesh.geometry.attributes.position, b.mesh.geometry.attributes.position);
  assert.notEqual(a.mesh.geometry, b.mesh.geometry, 'cada una lleva su drawRange');
  assert.equal(a.peeMesh.material, b.peeMesh.material);
  assert.equal(a.peeMesh.geometry, b.peeMesh.geometry);
});

test('dispose deja la escena como estaba', () => {
  const scene = new THREE.Scene();
  const before = scene.children.length;
  const ground = new GroundPoops(scene);
  const pile = ground.spawn(V(), { pieces: 0, pee: true, peeAt: V(0, 0, .2) });
  ground.dropPiece(pile, 0, V(0, .3, 0), .5);
  ground.setPee(pile, .5, V(0, .3, .05));
  ground.dispose();
  assert.equal(scene.children.length, before);
});
