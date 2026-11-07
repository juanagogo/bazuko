import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Npc } from '../src/entities/Npc.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';

test('al recibir un golpe, quien hablaba calla y su globo desaparece', async () => {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0, 0), { look: {} });
  await npc.ready;
  let removed = false;
  npc._bubbleEl = { remove() { removed = true; } }; npc._bubbleTimer = 3;
  assert.ok(npc.takeHit({ damage: 5, dir: { x: 1, z: 0 } }) !== false);
  assert.equal(removed, true);
  assert.equal(npc._bubbleEl, null);
  assert.equal(npc._bubbleTimer, 0);
  npc.dispose();
});

test('el susto suelta un quejido por persona cada tanto y el audio nunca pasa de tres a la vez', () => {
  const events = [];
  globalThis.window ??= new EventTarget();
  const listener = e => events.push(e.detail);
  window.addEventListener('npc-yelp', listener);
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0, 0), { look: {} });
  npc._playerDist = 5;
  npc._fleeFrom(new THREE.Vector3(1, 0, 0)); npc._fleeFrom(new THREE.Vector3(1, 0, 0));
  assert.equal(events.length, 1);
  window.removeEventListener('npc-yelp', listener);
  const audio = Object.create(AudioSystem.prototype);
  let started = 0;
  const node = () => ({ connect() {}, start() { started++; }, stop() {}, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, value: 0 }, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, Q: {} });
  audio._fx = () => ({ out: node(), ctx: { currentTime: 0, createOscillator: node, createGain: node, createBiquadFilter: node } });
  audio._yelps = 0;
  for (let i = 0; i < 6; i++) audio.playYelp(5);
  assert.equal(audio._yelps, 3);
  audio.playYelp(80); assert.equal(audio._yelps, 3);
  npc.dispose();
});
