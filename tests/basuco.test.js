import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { PsychosisSystem } from '../src/systems/PsychosisSystem.js';
import { BASUCO, BASUCO_LENGTH, BASUCO_TOTAL, basucoReach } from '../src/character/pipe.js';
import { SUBSTANCE_EFFECTS } from '../src/data/substanceEffects.js';
import { PUFF_INTERVAL, FIRST_PUFF } from '../src/character/smoking.js';
import { ITEMS } from '../src/data/items.js';
import { HUD } from '../src/ui/HUD.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';

let consumed;
beforeEach(() => {
  globalThis.window = new EventTarget();
  consumed = [];
  window.addEventListener('substance-consumed', (e) => consumed.push(e.detail.id));
});

function smoker(axis = { x: 0, z: 0 }) {
  const scene = new THREE.Scene();
  const input = { axis, isRunning: false, consumePress() { return false; }, isDown() { return false; } };
  const player = new Player(scene, input, { dinero: 0 }, {});
  player.position.set(0, 0, 0);
  const tick = (seconds, dt = 0.05) => { for (let t = 0; t < seconds - 1e-9; t += dt) player.update(dt, null, null, () => 0, []); };
  return { scene, player, tick };
}

test('el basuco: se agacha con las manos en la boca y vuelve a pararse', () => {
  assert.equal(basucoReach(0), 0);
  assert.equal(basucoReach(BASUCO.bend + 1), 1);
  assert.equal(basucoReach(BASUCO_LENGTH), 0);
});

test('fumando basuco se queda quieto, pega al terminar de aspirar y bota la bocanada', () => {
  const { scene, player, tick } = smoker({ x: 1, z: 0 });
  assert.equal(player.startBasuco(), true);
  assert.equal(player.startBasuco(), false, 'ya tiene la pipa');
  tick(BASUCO.bend + BASUCO.light - 0.2);
  assert.ok(player.position.length() < 0.01, 'quieto con la pipa');
  assert.deepEqual(consumed, []);
  tick(0.4);
  assert.deepEqual(consumed, ['basuco'], 'el efecto llega al soltar la pipa');
  const smoke = scene.getObjectByName('humo-cigarrillo');
  const visible = () => smoke.children.filter((s) => s.visible).length;
  tick(0.5);
  assert.ok(visible() > 8, 'bocanada espesa');
  tick(BASUCO_LENGTH - BASUCO.bend - BASUCO.light);
  assert.ok(player.position.length() > 0.05, 'guardó la pipa y ya camina');
  tick(BASUCO_TOTAL);
  assert.equal(player.basuco, null);
  assert.deepEqual(consumed, ['basuco'], 'una sola vez');
});

test('con las manos ocupadas no se fuma el basuco y el inventario no lo gasta', () => {
  const { player } = smoker();
  window.__game = { stats: new StatsSystem(), audio: { play() {} }, player };
  const hud = Object.assign(Object.create(HUD.prototype), { _toast() {}, _renderInventory() {} });
  const inv = new InventorySystem();
  inv.add(ITEMS.basuco, 2);
  player.playAction('pedir', 2);
  hud._useItem('basuco', inv);
  assert.equal(inv.count('basuco'), 2);
  player.action = null;
  hud._useItem('basuco', inv);
  assert.equal(inv.count('basuco'), 1);
  assert.ok(player.basuco);
  assert.deepEqual(consumed, [], 'pega al aspirar, no al sacarlo del costal');
});

test('el porro pega en cada calada', () => {
  const { player, tick } = smoker();
  player.startSmoking('hierba');
  tick(FIRST_PUFF + 4);
  assert.deepEqual(consumed, ['hierba']);
  tick(PUFF_INTERVAL);
  assert.deepEqual(consumed, ['hierba', 'hierba']);
});

test('el basuco trae paranoia: sombras y mirar a los lados, sin abstinencia', () => {
  const { paranoia } = SUBSTANCE_EFFECTS.basuco;
  assert.ok(paranoia.seconds > 0 && paranoia.severity > 0);
  const { scene, player, tick } = smoker();
  const psychosis = new PsychosisSystem(scene, player, { abstinencia: 0 }, null, null);
  psychosis.induce(paranoia.seconds, paranoia.severity);
  let maxGlance = 0;
  for (let t = 0; t < 20; t += 0.05) {
    psychosis.update(0.05);
    tick(0.05);
    maxGlance = Math.max(maxGlance, Math.abs(player._glance));
  }
  assert.ok(psychosis.active);
  assert.ok(player.paranoia > 0.5);
  assert.ok(maxGlance > 0.4, 'voltea la cabeza');
  assert.ok(psychosis.shadowPeople.length > 0, 've sombras');
  psychosis.clearInduced();
  psychosis.update(0.05);
  assert.equal(psychosis.active, false);
  assert.equal(player.paranoia, 0);
  assert.equal(psychosis.shadowPeople.length, 0);
});
