import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { SMOKE_DURATION, PUFF_INTERVAL, PUFF, PUFF_LENGTH, puffReach, emberGlow, isExhaling } from '../src/character/smoking.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

function smoker() {
  const scene = new THREE.Scene();
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress() { return false; }, isDown() { return false; } };
  const player = new Player(scene, input, { dinero: 0 }, {});
  return { scene, player, tick: (seconds, dt = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += dt) player.update(dt, null, null, null, []); } };
}

test('la calada sube la mano a la boca, aspira, la baja y bota el humo', () => {
  assert.equal(puffReach(null), 0);
  assert.equal(puffReach(0), 0);
  assert.equal(puffReach(PUFF.raise + PUFF.hold / 2), 1, 'en la boca mientras aspira');
  assert.equal(puffReach(PUFF_LENGTH), 0, 'la mano vuelve a bajar');
  assert.ok(emberGlow(PUFF.raise + 0.5) > 0.9, 'la brasa se aviva al aspirar');
  assert.equal(emberGlow(null), 0);
  assert.equal(isExhaling(PUFF.raise), false);
  assert.equal(isExhaling(PUFF.raise + PUFF.hold + 0.1), true, 'el humo sale al bajar la mano');
});

test('el cigarrillo se fuma 10 minutos con una calada cada 30 segundos', () => {
  const { player, tick } = smoker();
  assert.equal(player.startSmoking(), true);
  assert.equal(player.startSmoking(), false, 'no se prenden dos a la vez');
  let puffs = 0, wasPuffing = false;
  for (let t = 0; t < SMOKE_DURATION - 1; t += 0.1) {
    tick(0.1);
    const puffing = player.smoking?.puff != null;
    if (puffing && !wasPuffing) puffs++;
    wasPuffing = puffing;
  }
  assert.ok(player.smoking, 'todavía no se acaba');
  assert.equal(puffs, Math.ceil(SMOKE_DURATION / PUFF_INTERVAL), 'la primera al prenderlo y luego una cada 30 s');
  let ended = false;
  window.addEventListener('toast', (e) => { if (/acabó el cigarrillo/.test(e.detail.text)) ended = true; });
  tick(2);
  assert.equal(player.smoking, null);
  assert.equal(ended, true);
});

test('fumando sale humo de la brasa y al soltar la calada sale una bocanada', () => {
  const { scene, player, tick } = smoker();
  player.startSmoking();
  tick(1);
  const smoke = scene.getObjectByName('humo-cigarrillo');
  assert.ok(smoke, 'el humo vive en la escena');
  const visible = () => smoke.children.filter((s) => s.visible).length;
  const wisp = visible();
  assert.ok(wisp > 0, 'hilo de humo desde la brasa');
  tick(PUFF_LENGTH + 0.6);
  assert.ok(visible() > wisp + 5, 'la bocanada suelta varias nubes');
});

test('dormir o salir volando apaga el cigarrillo', () => {
  const { player, tick } = smoker();
  player.startSmoking();
  player.playAction('dormir', 5);
  tick(0.2);
  assert.equal(player.smoking, null);
});

test('el porro de hierba se fuma igual pero suelta humo verdoso y avisa como porro', () => {
  const { scene, player, tick } = smoker();
  let toast = null;
  window.addEventListener('toast', (e) => { toast = e.detail.text; });
  player.startSmoking('hierba');
  assert.equal(player.smoking.kind, 'hierba');
  tick(1);
  const puffs = scene.getObjectByName('humo-cigarrillo').children.filter((s) => s.visible);
  assert.ok(puffs.length > 0);
  const { r, g, b } = puffs[0].material.color;
  assert.ok(g > r && g > b, 'el humo tira a verde');
  tick(SMOKE_DURATION);
  assert.equal(player.smoking, null);
  assert.match(toast ?? '', /porro/);
});
