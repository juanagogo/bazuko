import assert from 'node:assert/strict';
import { beforeEach, test, mock } from 'node:test';
import * as THREE from 'three';
import { Renderer } from '../src/core/Renderer.js';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { SceneManager } from '../src/core/Scene.js';
import { CameraRig } from '../src/core/Camera.js';
import { CompanionNavigation } from '../src/systems/CompanionNavigation.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { Dog } from '../src/entities/Dog.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { ITEMS } from '../src/data/items.js';
import { Game } from '../src/core/game.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  window.innerWidth = 1200; window.innerHeight = 800; window.devicePixelRatio = 2;
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
});

test('los perfiles respetan su límite de resolución incluso después de la adaptación automática', () => {
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    resolution: new AdaptiveResolution(2),
    instance: { shadowMap: {}, setPixelRatio(value) { this.ratio = value; }, getPixelRatio() { return this.ratio; } }
  });
  for (const [quality, cap] of [['baja', 1], ['media', 1.25], ['alta', 1.5]]) {
    renderer.setQuality(quality);
    assert.equal(renderer.instance.ratio, cap);
    for (let i = 0; i < 300; i++) renderer.adaptResolution(40);
    assert.ok(renderer.instance.ratio < cap);
    for (let i = 0; i < 4000; i++) renderer.adaptResolution(10);
    assert.ok(renderer.instance.ratio <= cap);
    assert.equal(renderer.instance.shadowMap.enabled, quality !== 'baja');
    assert.equal(localStorage.getItem('bazuko.graphics_quality'), quality);
  }
});

test('el ciclo de iluminación mantiene la calidad elegida y libera el mapa de sombras al redimensionarlo', () => {
  const manager = new SceneManager(); let disposed = 0;
  manager.sun.shadow.map = { dispose() { disposed++; } };
  manager.setQuality('media');
  assert.equal(disposed, 1);
  assert.equal(manager.sun.shadow.map, null);
  assert.equal(manager.sun.shadow.mapSize.x, 1024);
  for (let hour = 0; hour < 24; hour++) {
    manager.setTimeOfDay(hour);
    assert.ok(manager.scene.fog.far <= 160);
  }
  manager.setQuality('baja'); manager.setTimeOfDay(12);
  assert.equal(manager.sun.castShadow, false);
  assert.ok(manager.scene.fog.far <= 130);
  manager.setQuality('alta');
  assert.equal(manager.sun.shadow.mapSize.x, 2048);
  assert.equal(manager.sun.castShadow, true);
  assert.ok(manager.scene.fog.far > 160);
  assert.equal(manager.sun.shadow.normalBias, .035);
});

test('Pointer Lock procesa una sola rotación y libera el cursor en menús, Escape y cambio de cámara', () => {
  const canvas = new EventTarget(); let releases = 0;
  globalThis.document = new EventTarget();
  document.exitPointerLock = () => { releases++; document.pointerLockElement = null; };
  canvas.requestPointerLock = () => { document.pointerLockElement = canvas; return Promise.resolve(); };
  const rig = new CameraRig(new THREE.Scene(), canvas);
  const down = new Event('pointerdown'); Object.assign(down, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  canvas.dispatchEvent(down);
  const yaw = rig.yaw;
  for (const type of ['pointermove', 'mousemove']) {
    const e = new Event(type); Object.assign(e, { movementX: 10, movementY: 0 }); window.dispatchEvent(e);
  }
  assert.ok(Math.abs(rig.yaw - (yaw - .05)) < 1e-9);
  rig.releaseControls(); assert.equal(releases, 1);
  document.pointerLockElement = canvas;
  const escape = new Event('keydown'); escape.code = 'Escape'; window.dispatchEvent(escape);
  assert.equal(document.pointerLockElement, null);
  document.pointerLockElement = canvas; rig.toggle(); assert.equal(document.pointerLockElement, null);
  delete globalThis.document;
});

test('El Chato rodea una pared, respeta las cajas de vehículos y no corta esquinas', () => {
  const collisions = new CollisionSystem();
  collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(5, -1, 0), new THREE.Vector3(7, 5, 11)) });
  const district = {
    map: Array.from({ length: 10 }, () => Array(10).fill('walkable')),
    isWalkableAt: (x, z) => x >= 0 && z >= 0 && x <= 18 && z <= 18,
    getGroundHeight: () => .04
  };
  const navigation = new CompanionNavigation(district, collisions);
  const from = new THREE.Vector3(2, .04, 4), to = new THREE.Vector3(12, .04, 4);
  const route = navigation.route(from, to);
  assert.ok(route.some(point => point.z >= 12));
  let previous = from;
  for (const point of route) { assert.ok(navigation.clearLine(previous, point)); previous = point; }
  const dog = new Dog(new THREE.Scene(), from); dog.navigation = navigation; dog.befriend();
  for (let i = 0; i < 800; i++) {
    dog.update(1 / 60, to);
    assert.ok(navigation.isOpen(dog.position.x, dog.position.z), 'No atraviesa la pared al seguir la ruta');
  }
  assert.ok(dog.position.distanceTo(to) < 2.6);
  const vehicle = { position: new THREE.Vector3(4, 0, 16), length: 4.3, width: 1.76, group: new THREE.Group() };
  collisions.setVehicles([vehicle]);
  dog.resetNear(new THREE.Vector3(0, 0, 16));
  for (let i = 0; i < 120; i++) dog.update(1 / 60, new THREE.Vector3(10, 0, 16));
  assert.ok(dog.position.x < 2);
  dog.destroy();
});

test('alimentar al perro consume comida real del inventario y las caricias tienen enfriamiento', () => {
  const dog = new Dog(new THREE.Scene()), inventory = new InventorySystem(), stats = new StatsSystem();
  stats.saludMental = 40; inventory.add(ITEMS.pan, 1); inventory.add(ITEMS.lata, 1);
  const interaction = new InteractionSystem({}, inventory, stats);
  interaction._interactDog(dog);
  assert.equal(dog.isFriend, true); assert.equal(inventory.count('pan'), 0); assert.equal(inventory.count('lata'), 1);
  assert.equal(stats.saludMental, 55);
  interaction._interactDog(dog); assert.equal(stats.saludMental, 60);
  interaction._interactDog(dog); assert.equal(stats.saludMental, 60);
  dog.update(21, dog.position); interaction._interactDog(dog); assert.equal(stats.saludMental, 65);
  dog.restAt(new THREE.Vector3(2, 0, 2)); assert.equal(dog.sleeping, true); assert.equal(dog._posture.lie, 1);
  const restingPosition = dog.position.clone(); dog.update(1, new THREE.Vector3(50, 0, 50));
  assert.deepEqual(dog.position, restingPosition);
  dog.wake(); assert.equal(dog.sleeping, false); assert.equal(dog.group.scale.y, 1);
  dog.destroy();
});

test('el olfato ignora bolsas y canecas vacías y la amistad se incluye en el guardado', () => {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3()); dog.befriend();
  let barks = 0; window.addEventListener('dog-bark', () => barks++);
  dog._barkTimer = 11; dog.update(.1, dog.position, [{ used: true, position: new THREE.Vector3(1, 0, 1) }]);
  assert.equal(barks, 0);
  dog._barkTimer = 11; dog.update(.1, dog.position, [{ used: false, position: new THREE.Vector3(1, 0, 1) }]);
  assert.equal(barks, 1);
  const serializable = () => ({ serialize: () => ({}) }); let saved;
  const game = Object.assign(Object.create(Game.prototype), {
    stats: serializable(), clock: serializable(), inventory: serializable(), talents: serializable(), diseases: serializable(),
    player: { position: new THREE.Vector3() }, world: {}, dog, save: { save: data => { saved = data; } }
  });
  game._save(); assert.equal(saved.dog.isFriend, true); assert.deepEqual(saved.dog.look, dog.look); dog.destroy();
});

test('inventario y paneles existentes pausan la simulación y los POI usan la ubicación real del cambuche', () => {
  const game = Object.assign(Object.create(Game.prototype), {
    menu: { isOpen: false }, creator: { isOpen: false }, hud: {}, inventoryUI: { isOpen: false },
    cambuche: { position: new THREE.Vector3(112.98, 0, 94.64) }
  });
  assert.equal(game.paused, false);
  game.inventoryUI.isOpen = true; assert.equal(game.paused, true); game.inventoryUI.isOpen = false;
  game.hud._talentOpen = true; assert.equal(game.paused, true);
  assert.equal(game._getPOIs()[0].x, 112.98);
  assert.equal(game._getPOIs()[0].z, 94.64);
});

test('dormir con El Chato suma quince de ánimo y lo despierta al terminar la siesta', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const run = friend => {
      const dog = new Dog(new THREE.Scene()); if (friend) dog.befriend();
      const stats = new StatsSystem(); stats.saludMental = 20;
      const game = Object.assign(Object.create(Game.prototype), {
        built: { base: true }, clock: { hour: 12, day: 1, isNight: false }, stats,
        player: { position: new THREE.Vector3(), playAction() {} }, dog, _save() {}, inventory: new InventorySystem()
      });
      game.sleep(); return game;
    };
    const alone = run(false), accompanied = run(true);
    assert.equal(accompanied.stats.saludMental - alone.stats.saludMental, 15);
    assert.equal(accompanied.dog.sleeping, true);
    mock.timers.tick(1200);
    assert.equal(accompanied.dog.sleeping, false); assert.equal(accompanied.isSleeping, false);
    alone.dog.destroy(); accompanied.dog.destroy();
  } finally { mock.timers.reset(); }
});
