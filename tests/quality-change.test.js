import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';

globalThis.requestAnimationFrame ??= cb => setTimeout(cb, 0);
globalThis.window ??= globalThis;
globalThis.window.dispatchEvent ??= () => true;
globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

function fakeGame({ failGPU = false } = {}) {
  const stored = new Map(), calls = [];
  globalThis.localStorage = { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) };
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    _running: true,
    renderer: { quality: 'alta', setQuality(q, persist) { this.quality = q; calls.push(['renderer', q, persist]); }, render() { calls.push(['render']); }, waitForGPU: async () => { if (failGPU) throw new Error('device lost'); } },
    sceneMgr: { scene: {}, sun: {}, setQuality: q => calls.push(['scene', q]), setShadowQuality: q => calls.push(['shadow', q]) },
    cameraRig: { camera: {}, setQuality() {} }, player: { root: {} }, world: { active: null }, weather: null
  });
  return { game, stored, calls };
}

test('el cambio manual prepara la calidad, informa el progreso y solo entonces guarda la preferencia', async () => {
  const { game, stored, calls } = fakeGame(), progress = [];
  const pending = game.changeGraphicsQuality('baja', { onProgress: t => progress.push(t) });
  assert.equal(game.qualityChanging, true);
  assert.equal(game.changeGraphicsQuality('media'), pending, 'no se apilan cambios mientras prepara');
  assert.equal(await pending, true);
  assert.equal(game.qualityChanging, false);
  assert.equal(stored.get('bazuko.webgpu.graphics_quality'), 'baja');
  assert.deepEqual(calls.find(c => c[0] === 'renderer'), ['renderer', 'baja', false]);
  assert.ok(calls.some(c => c[0] === 'shadow' && c[1] === 'baja'));
  assert.ok(calls.some(c => c[0] === 'render'));
  assert.deepEqual(progress, ['Preparando calidad baja…', 'Calidad baja lista']);
});

test('si la preparación falla mantiene la calidad anterior y no guarda la nueva', async () => {
  const { game, stored } = fakeGame({ failGPU: true }), progress = [];
  assert.equal(await game.changeGraphicsQuality('media', { onProgress: t => progress.push(t) }), false);
  assert.equal(game.renderer.quality, 'alta');
  assert.equal(stored.has('bazuko.webgpu.graphics_quality'), false);
  assert.equal(game.qualityChanging, false);
  assert.match(progress.at(-1), /se mantiene alta/);
});
