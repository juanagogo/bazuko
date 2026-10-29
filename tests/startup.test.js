import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { Renderer } from '../src/core/Renderer.js';
import { FrameMetrics } from '../src/core/FrameMetrics.js';
import { loadInBatches, loadTaskGroups, withLoadTimeout } from '../src/core/Startup.js';
import { Clock } from '../src/core/Clock.js';
import { WeatherSystem } from '../src/world/WeatherSystem.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, { fresh = false, lightweight = false } = {}) {
  const models = deferred(), shaders = deferred(), gpu = deferred(), creator = deferred();
  const events = [];
  const metrics = new FrameMetrics();
  metrics.sample(0); metrics.sample(1000);
  const game = Object.assign(Object.create(Game.prototype), {
    _running: false, _loading: true, look: fresh ? null : {},
    menu: { isOpen: false }, creator: { isOpen: false },
    world: {
      active: { npcs: [{ preload: () => models.promise }], setNightMode() {} },
      loadDistrict() { events.push('map'); },
      update(dt) { assert.equal(dt, 0); events.push('pose'); }
    },
    player: {
      position: new THREE.Vector3(), root: new THREE.Group(),
      async setModel() { events.push('player'); await models.promise; }
    },
    cameraRig: { mode: 'third-person', yaw: 0, camera: new THREE.PerspectiveCamera(), follow() {} },
    sceneMgr: { scene: new THREE.Scene(), setTimeOfDay() {}, followTarget() {} },
    clock: { hour: 6, isNight: false },
    localLights: { update() {} },
    renderer: {
      async prepare() { events.push('shaders'); await shaders.promise; },
      render() { events.push('render'); assert.equal(game._running, false); },
      async waitForGPU() { events.push('gpu'); await gpu.promise; },
      resolution: { resetWindow() { events.push('resolution-reset'); } }
    },
    performanceHUD: { metrics, nextPaint: 500 },
    audio: { ready: Promise.resolve(), startAmbient() { events.push('audio'); } },
    input: { keys: { KeyW: true }, endFrame() { events.push('clear-input'); } },
    _spawnEntities() {}, _registerRenderGroups() {}, _loadIfSave() {},
    async _createCharacter(loading) {
      events.push('creator'); loading.forCreator();
      await creator.promise; this.look = {};
    },
    _loop() { throw new Error('El bucle no debe ejecutarse durante la carga'); }
  });
  const loading = {
    async stage() {}, forCreator() { events.push('show-creator'); },
    finish() { events.push('show-game'); }
  };
  t.mock.method(globalThis, 'requestAnimationFrame', callback => {
    if (callback === game._loop) events.push('schedule-loop');
    else queueMicrotask(callback);
  });
  t.mock.method(globalThis.localStorage, 'getItem', () => lightweight ? 'procedural' : null);
  return { game, loading, events, models, shaders, gpu, creator, metrics };
}

// Node no tiene RAF ni almacenamiento del navegador.
globalThis.requestAnimationFrame ??= () => {};
globalThis.localStorage ??= { getItem() { return null; } };

test('el inicio espera modelos, shaders y GPU antes de mostrar, medir o simular; no se duplica', async t => {
  const f = fixture(t);
  f.game.clock = new Clock();
  f.game.weather = new WeatherSystem(f.game.sceneMgr.scene);
  f.game.world.active.reserved = { spawn: { x: 112.98, z: 97.84 } };
  f.game.world.active.getGroundHeight = () => .08;
  f.game._loadIfSave = () => {
    f.game.player.position.set(40, 0, 26);
    f.game.clock.deserialize({ day: 5, hour: 9 });
  };
  const start = f.game.start(f.loading);
  assert.equal(f.game.start(f.loading), start);
  await tick();
  assert.equal(f.game.paused, true);
  assert.equal(f.game._running, false);
  assert.ok(!f.events.includes('shaders'));
  f.models.resolve(); await tick();
  assert.ok(f.events.includes('shaders'));
  assert.ok(!f.events.includes('render'));
  f.shaders.resolve(); await tick();
  assert.equal(f.events.filter(e => e === 'render').length, 3);
  assert.ok(f.events.includes('gpu'));
  assert.ok(!f.events.includes('show-game'));
  assert.equal(f.metrics.frames, 1); // no muestras durante el calentamiento
  f.gpu.resolve(); await start;
  assert.equal(f.game._running, true);
  assert.equal(f.game.paused, false);
  assert.equal(f.metrics.frames, 0);
  assert.equal(f.metrics.previous, null);
  assert.deepEqual(f.game.input.keys, {});
  assert.equal(f.game.clock.hour, 22);
  assert.equal(f.game.clock.day, 5);
  assert.equal(f.game.clock.isNight, true);
  assert.equal(f.game.weather.isRaining, true);
  assert.equal(f.game.weather.rainParticles.visible, true);
  assert.ok(f.game.weather.rainParticles.material.opacity > 0);
  assert.equal(f.game.weather.timer, 0);
  assert.equal(f.game.weather.rainParticles.position.x, 112.98);
  assert.equal(f.game.weather.rainParticles.position.z, 97.84);
  assert.deepEqual(f.game.player.position.toArray(), [112.98, .08, 97.84]);
  assert.deepEqual(f.game.player.root.position, f.game.player.position);
  assert.equal(f.events.filter(e => e === 'map').length, 1);
  assert.ok(f.events.indexOf('show-game') < f.events.indexOf('schedule-loop'));
  f.metrics.sample(20000); f.metrics.sample(20020);
  assert.equal(f.metrics.min, 50); // la espera no contamina mínimo ni promedio
  assert.equal(f.metrics.average, 50);
});

test('si falla un modelo no arranca una partida incompleta', async t => {
  const f = fixture(t);
  const start = f.game.start(f.loading);
  const failure = assert.rejects(start, /modelo ausente/);
  await tick(); f.models.reject(new Error('modelo ausente'));
  await failure;
  assert.equal(f.game._running, false);
  assert.equal(f.game.paused, true);
  assert.ok(!f.events.includes('show-game'));
  assert.ok(!f.events.includes('schedule-loop'));
});

test('los vehículos y el refugio terminan de cargar antes del culling y de preparar shaders', async t => {
  const f = fixture(t);
  const asset = deferred();
  const targets = [
    { preloadModel: () => asset.promise },
    { preloadModel: () => asset.promise }
  ];
  f.game.cars = [targets[0]];
  f.game.traffic = { vehicles: [{ car: targets[1] }] };
  f.game._registerRenderGroups = () => f.events.push('culling');
  const start = f.game.start(f.loading);
  f.models.resolve(); f.shaders.resolve(); f.gpu.resolve();
  await tick();
  assert.ok(!f.events.includes('culling'));
  assert.ok(!f.events.includes('shaders'));
  assert.equal(f.game._running, false);
  asset.resolve(); await start;
  assert.ok(f.events.indexOf('culling') < f.events.indexOf('shaders'));
  assert.equal(f.game._running, true);
});

test('vehículos y mobiliario avanzan mientras los personajes siguen descargándose', async t => {
  const f = fixture(t);
  f.game.cars = [{ async preloadModel() { f.events.push('vehicle'); } }];
  f.game.world.active.preloadDetails = async () => { f.events.push('details'); };
  const start = f.game.start(f.loading);
  await tick();
  assert.ok(f.events.includes('vehicle'));
  assert.ok(f.events.includes('details'));
  assert.ok(!f.events.includes('shaders'));
  f.models.resolve(); f.shaders.resolve(); f.gpu.resolve();
  await start;
});

test('colas alternadas comparten un límite de concurrencia y completan el progreso', async () => {
  const pending = Array.from({ length: 5 }, deferred);
  const started = [], progress = [];
  const task = i => () => { started.push(i); return pending[i].promise; };
  const work = loadTaskGroups([[task(0), task(2), task(4)], [task(1), task(3)]],
    (done, total) => progress.push([done, total]), 2);
  assert.deepEqual(started, [0, 1]);
  pending[1].resolve(); await tick();
  assert.deepEqual(started, [0, 1, 2]);
  pending.forEach(item => item.resolve()); await work;
  assert.deepEqual(progress, [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
});

test('primera partida espera al creador y respeta el modelo liviano guardado', async t => {
  const f = fixture(t, { fresh: true, lightweight: true });
  const start = f.game.start(f.loading);
  await tick();
  assert.ok(f.events.includes('show-creator'));
  assert.equal(f.game._running, false);
  f.creator.resolve(); f.models.resolve(); f.shaders.resolve(); f.gpu.resolve();
  await start;
  assert.ok(!f.events.includes('player'));
  assert.equal(f.game._running, true);
});

test('precarga limitada espera todos los elementos y notifica trabajo completado', async () => {
  const pending = Array.from({ length: 6 }, deferred);
  const progress = [], started = [];
  const work = loadInBatches(pending, (item) => {
    started.push(item); return item.promise;
  }, count => progress.push(count), 2);
  assert.equal(started.length, 2);
  pending[0].resolve(); await tick();
  assert.equal(started.length, 3);
  pending.forEach(item => item.resolve());
  await work;
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
  await assert.rejects(withLoadTimeout(new Promise(() => {}), 'carga agotada', 5), /carga agotada/);
  assert.equal(await withLoadTimeout(Promise.resolve(42), 'error'), 42);
});

test('preparación incluye texturas ocultas y modelos LOD sin cambiar padres o visibilidad', async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), material);
  hidden.visible = false; scene.add(hidden);
  const full = new THREE.Mesh(hidden.geometry, material);
  const parent = new THREE.Group(); parent.add(full);
  const uploads = [], compiles = [];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    instance: {
      initTexture(value) { uploads.push(value); },
      async compileAsync(root, cam, target) {
        compiles.push([root, cam, target, [...root.children]]);
      }
    }
  });
  await renderer.prepare(scene, camera, [full]);
  assert.deepEqual(uploads, [texture]);
  assert.equal(compiles.length, 2);
  assert.equal(compiles[1][2], scene);
  assert.deepEqual(compiles[1][3], [full]);
  assert.equal(full.parent, parent);
  assert.equal(hidden.visible, false);
});

test('la espera GPU comprueba la señal sin bloquear el hilo y libera el fence', async t => {
  const calls = [];
  let polls = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
    isContextLost: () => false, fenceSync: () => 'fence',
    flush() { calls.push('flush'); },
    clientWaitSync() { return ++polls < 3 ? 0 : 3; },
    deleteSync(value) { calls.push(value); }
  };
  t.mock.method(globalThis, 'requestAnimationFrame', cb => queueMicrotask(cb));
  const renderer = Object.assign(Object.create(Renderer.prototype), { instance: { getContext: () => gl } });
  await renderer.waitForGPU();
  assert.equal(polls, 3);
  assert.deepEqual(calls, ['flush', 'fence']);
  gl.clientWaitSync = () => gl.WAIT_FAILED;
  await assert.rejects(renderer.waitForGPU(), /preparación gráfica/);
  assert.deepEqual(calls, ['flush', 'fence', 'flush', 'fence']);
});

test('subir texturas cede por tiempo consumido y no por cantidad de archivos', async t => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const geometry = new THREE.BoxGeometry();
  for (let i = 0; i < 24; i++) {
    scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: new THREE.Texture() })));
  }
  let time = 0, frames = 0, cost = .1;
  t.mock.method(performance, 'now', () => time);
  t.mock.method(globalThis, 'requestAnimationFrame', callback => { frames++; queueMicrotask(callback); });
  const renderer = Object.assign(Object.create(Renderer.prototype), { instance: {
    initTexture() { time += cost; }, async compileAsync() {}
  } });
  await renderer.prepare(scene, camera);
  assert.equal(frames, 0, 'texturas baratas no añaden esperas de fotogramas');
  cost = 4;
  await renderer.prepare(scene, camera);
  assert.ok(frames >= 2, 'las subidas costosas permiten repintar el progreso');
});
