import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function effectsSpy(calls = []) {
  return {
    calls, ends: 0, disposed: 0, beforeArgs: null,
    beforeRender(...args) { calls.push('before'); this.beforeArgs = args; },
    afterRender(camera) { calls.push('after'); this.afterCamera = camera; },
    end() { this.ends++; },
    dispose() { this.disposed++; }
  };
}

function renderFixture(substanceEffects) {
  const calls = substanceEffects?.calls ?? [];
  const game = Object.assign(Object.create(Game.prototype), {
    _effectiveQuality: 'media',
    clock: { hour: 12 },
    renderer: { effectiveQuality: 'media', render() { calls.push('render'); }, resolution: { resetWindow() {} } },
    sceneMgr: { scene: new THREE.Scene(), sun: new THREE.DirectionalLight() },
    cameraRig: { camera: new THREE.PerspectiveCamera(55) },
    player: { position: new THREE.Vector3(), root: new THREE.Group() },
    world: { active: null },
    localLights: { update() {} },
    collisions: {},
    performanceHUD: { update() { return false; } },
    substanceEffects
  });
  return { game, calls };
}

// Como en tests/respawn.test.js: lo mínimo para morir y volver al cambuche.
function deathFixture(substanceEffects) {
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), deathCount: 0, _deathPending: false,
    talents: { getEffect: (key, fallback) => fallback }, clock: { isNight: false },
    player: { position: new THREE.Vector3(40, 0, 26), root: new THREE.Group(), clearVehicleImpact() {} },
    world: { active: { reserved: { bed: { x: 89, z: 80 } } } },
    input: { keys: {}, endFrame() {} },
    audio: { updateSteps() {} },
    interaction: { currentTarget: {}, currentTargetType: 'shop' },
    menu: { isOpen: false, open(options) { this.options = options; this.isOpen = true; }, close() { this.isOpen = false; } },
    creator: { isOpen: false },
    diseases: { hasAny: false, cureAll() {} },
    inventory: new InventorySystem(),
    cameraRig: { follow() {} },
    substanceEffects
  });
  return game;
}

test('_renderFrame aplica el efecto justo antes del render y lo retira justo después', () => {
  const fx = effectsSpy();
  const { game, calls } = renderFixture(fx);
  game._renderFrame(1000, true);
  assert.deepEqual(calls, ['before', 'render', 'after']);
  assert.equal(fx.beforeArgs[0], game.cameraRig.camera);
  assert.deepEqual(fx.beforeArgs[1], { quality: 'media', paused: false });
  assert.equal(fx.afterCamera, game.cameraRig.camera);
  game._renderFrame(1100, false);
  assert.equal(fx.beforeArgs[1].paused, true);
});

test('morir y recuperarse en el cambuche cortan el efecto', () => {
  const fx = effectsSpy();
  const game = deathFixture(fx);
  game.stats.salud = 0;
  assert.equal(game._handleDeath(), true);
  assert.equal(fx.ends, 1);
  game._respawn();
  assert.equal(fx.ends, 2);
});

test('dormir corta el efecto', (t) => {
  t.mock.method(globalThis, 'setTimeout', () => 0);
  const fx = effectsSpy();
  const game = Object.assign(Object.create(Game.prototype), {
    isSleeping: false, built: { base: true }, dog: null,
    player: { position: new THREE.Vector3(), playAction() {} },
    clock: { isNight: false, hour: 12, day: 1 },
    stats: new StatsSystem(), inventory: new InventorySystem(),
    _save() {}, substanceEffects: fx
  });
  game.sleep();
  assert.equal(game.isSleeping, true);
  assert.equal(fx.ends, 1);
});

test('detener el juego libera los efectos', () => {
  const fx = effectsSpy();
  const game = Object.assign(Object.create(Game.prototype), { _running: true, substanceEffects: fx });
  game.stop();
  assert.equal(fx.disposed, 1);
  assert.equal(game._running, false);
});

test('las pruebas de juego sin efectos siguen funcionando', () => {
  const { game, calls } = renderFixture(undefined);
  game._renderFrame(1000, true);
  assert.deepEqual(calls, ['render']);
  const dying = deathFixture(undefined);
  dying.stats.salud = 0;
  assert.equal(dying._handleDeath(), true);
  dying._respawn();
});
