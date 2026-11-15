import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// CameraRig usa window, localStorage y el lienzo; aquí basta con lo mínimo.
const listeners = {};
globalThis.window ??= {
  innerWidth: 1280, innerHeight: 720,
  addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
  dispatchEvent: (event) => { for (const fn of listeners[event.type] ?? []) fn(event); return true; }
};
// La preferencia «movimiento reducido» del sistema, que la prueba cambia a mano.
const systemCalm = { matches: false };
globalThis.matchMedia ??= (query) => (query.includes('reduced-motion') ? systemCalm : { matches: false });
const { CameraRig } = await import('../src/core/Camera.js');
const { Game } = await import('../src/core/game.js');

const canvas = { addEventListener() {}, removeEventListener() {}, requestPointerLock() {}, style: {} };
const rig = (mode = 'third-person') => {
  const r = new CameraRig(new THREE.Scene(), canvas);
  r.mode = mode;
  r.shakeEnabled = true;
  return r;
};
const grados = (a, b) => a.camera.quaternion.angleTo(b.camera.quaternion) * 180 / Math.PI;

test('el trauma se suma con tope 1 y decae hasta cero', () => {
  const r = rig();
  r.addTrauma(.6); r.addTrauma(.7);
  assert.equal(r.trauma, 1);
  for (let i = 0; i < 120; i++) r.follow(new THREE.Vector3(), 1 / 60);
  assert.equal(r.trauma, 0);
});

test('el temblor gira la cámara sin moverla de su sitio, también en la vista isométrica', () => {
  for (const mode of ['third-person', 'isometric']) {
    const quiet = rig(mode), shaken = rig(mode);
    const target = new THREE.Vector3(10, 0, 5);
    quiet.follow(target, 1 / 60);
    shaken.follow(target, 1 / 60);
    shaken.addTrauma(1);
    quiet.follow(target, 1 / 60);
    shaken.follow(target, 1 / 60);
    assert.ok(quiet.camera.position.distanceTo(shaken.camera.position) < 1e-9, `${mode}: no se mueve`);
    assert.ok(grados(quiet, shaken) > 1e-2, `${mode}: gira`);
  }
});

test('con golpes seguidos no pasa de su tope y, al apagarse, no deja la vista torcida', () => {
  const quiet = rig(), shaken = rig();
  const target = new THREE.Vector3(3, 0, -2);
  quiet.follow(target, 1 / 60); shaken.follow(target, 1 / 60);
  let peak = 0;
  // Cinco segundos con un golpe fuerte en cada cuadro.
  for (let i = 0; i < 300; i++) {
    shaken.addTrauma(.5);
    quiet.follow(target, 1 / 60); shaken.follow(target, 1 / 60);
    assert.ok(shaken.trauma <= 1);
    peak = Math.max(peak, grados(quiet, shaken));
  }
  // Con trauma 1 los tres ejes juntos no pasan de ~8,7°; medido, ~6°. Un golpe solo no pasa de ~1,1°.
  assert.ok(peak < 8.8, `pico con trauma 1: ${peak}°`);
  for (let i = 0; i < 60; i++) { quiet.follow(target, 1 / 60); shaken.follow(target, 1 / 60); }
  assert.equal(shaken.trauma, 0);
  assert.ok(grados(quiet, shaken) < 1e-6, 'sin deriva');
  assert.ok(quiet.camera.position.distanceTo(shaken.camera.position) < 1e-9);
});

test('a 30, 60 y 144 imágenes por segundo da el mismo pico y se apaga en el mismo tiempo', () => {
  const run = (fps) => {
    const quiet = rig(), shaken = rig(), target = new THREE.Vector3();
    quiet.follow(target, 1 / fps); shaken.follow(target, 1 / fps);
    shaken.addTrauma(.15 + 20 / 60);
    let peak = 0, frames = 0;
    for (; frames < 4 * fps && shaken.trauma > 0; frames++) {
      quiet.follow(target, 1 / fps); shaken.follow(target, 1 / fps);
      peak = Math.max(peak, grados(quiet, shaken));
    }
    return { peak, seconds: frames / fps };
  };
  const a = run(60), b = run(30), c = run(144);
  assert.ok(Math.abs(a.seconds - b.seconds) <= 1 / 30 + 1e-9, `60: ${a.seconds} s, 30: ${b.seconds} s`);
  assert.ok(Math.abs(a.seconds - c.seconds) <= 1 / 60 + 1e-9, `60: ${a.seconds} s, 144: ${c.seconds} s`);
  assert.ok(Math.abs(a.peak - b.peak) < .01, `60: ${a.peak}°, 30: ${b.peak}°`);
  assert.ok(Math.abs(a.peak - c.peak) < .01, `60: ${a.peak}°, 144: ${c.peak}°`);
});

test('con movimiento reducido no hay temblor y los valores raros se ignoran', () => {
  const r = rig();
  r.addTrauma(NaN); r.addTrauma(-1);
  assert.equal(r.trauma, 0);
  r.shakeEnabled = false;
  r.addTrauma(.5);
  assert.equal(r.trauma, 0);
  // La preferencia fijada en la cámara...
  const calm = rig();
  calm.reducedMotion = true;
  calm.addTrauma(.5);
  assert.equal(calm.trauma, 0);
  // ...y la del sistema, que se mira en cada golpe.
  const system = rig();
  systemCalm.matches = true;
  try {
    system.addTrauma(.5);
    window.dispatchEvent({ type: 'camera-shake', detail: { amount: .5 } });
    assert.equal(system.trauma, 0);
  } finally { systemCalm.matches = false; }
  system.addTrauma(.5);
  assert.equal(system.trauma, .5);
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
  assert.ok(leve > 0 && fuerte > leve && fuerte <= .5);
  game.stats.salud = 100; assert.equal(game._shakeOnDamage(), 0);
  assert.equal(trauma.length, 2);
});

test('tomarse una pastilla, basuco o pegante quita salud sin sacudir la cámara; un golpe después, sí', async () => {
  const { HUD } = await import('../src/ui/HUD.js');
  const { ITEMS } = await import('../src/data/items.js');
  const { InventorySystem } = await import('../src/systems/InventorySystem.js');
  const { StatsSystem } = await import('../src/systems/StatsSystem.js');
  const trauma = [];
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), audio: { play() {} }, cameraRig: { addTrauma: (a) => trauma.push(a) }
  });
  game.stats.salud = 90;
  const inventory = new InventorySystem();
  const hud = Object.assign(Object.create(HUD.prototype), { _toast() {}, _renderInventory() {} });
  window.__game = game;
  try {
    game._shakeOnDamage();
    for (const id of ['pastilla', 'basuco', 'pegante']) {
      inventory.add(ITEMS[id], 1);
      const antes = game.stats.salud;
      hud._useItem(id, inventory);
      assert.ok(game.stats.salud <= antes - 3, `${id} quita salud`);
      assert.equal(game._shakeOnDamage(), 0, `${id} no sacude`);
    }
    game.stats.salud -= 10;
    assert.ok(game._shakeOnDamage() > 0, 'un puño después sí');
    assert.equal(trauma.length, 1);
  } finally { delete window.__game; }
});

test('un atropello de 20 gira la vista ~1° en su pico y se apaga en ~0,35 s; un puño, ~0,4°', () => {
  const pico = (amount) => {
    const quiet = rig(), shaken = rig(), target = new THREE.Vector3();
    quiet.follow(target, 1 / 60); shaken.follow(target, 1 / 60);
    shaken.addTrauma(amount);
    let peak = 0, frames = 0;
    for (; frames < 120 && shaken.trauma > 0; frames++) {
      quiet.follow(target, 1 / 60); shaken.follow(target, 1 / 60);
      peak = Math.max(peak, grados(quiet, shaken));
    }
    return { peak, seconds: frames / 60 };
  };
  const atropello = pico(.15 + 20 / 60), puno = pico(.15 + 10 / 60);
  assert.ok(atropello.peak > .95 && atropello.peak < 1.05, `atropello ${atropello.peak}°`);
  assert.ok(atropello.seconds > .3 && atropello.seconds < .4, `dura ${atropello.seconds} s`);
  assert.ok(puno.peak > .3 && puno.peak < .5, `puño ${puno.peak}°`);
  assert.ok(pico(.5).peak < 1.2, 'el tope de un golpe no pasa de ~1,1°');
});
