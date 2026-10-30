import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import * as THREE from 'three';
import { SpatialGrid } from '../src/core/SpatialGrid.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { FrameMetrics } from '../src/core/FrameMetrics.js';
import { FrameProfiler } from '../src/core/FrameProfiler.js';
import { LocalLights } from '../src/core/LocalLights.js';
import { disposeRealisticInstance } from '../src/character/RealisticCharacter.js';
import { BuildingVisibility, createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { Renderer } from '../src/core/Renderer.js';

test('el índice incluye cajas extensas, bordes y coordenadas negativas sin duplicar candidatos', () => {
  const grid = new SpatialGrid(8), large = {}, local = {}, remote = {};
  grid.insert(large, -25, -25, 25, 25);
  grid.insert(local, -8, -8); grid.insert(remote, 500, 500);
  const found = grid.query(-8, -8, 0, 0);
  assert.deepEqual(new Set(found), new Set([large, local]));
  assert.equal(found.length, 2);
  grid.clear();
  assert.equal(grid.query(-100, -100, 100, 100).length, 0);
});

test('el barrido indexado conserva la resolución exhaustiva en movimientos largos y callejones', () => {
  const indexed = new CollisionSystem(), exhaustive = new CollisionSystem();
  let seed = 21;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < 250; i++) {
    const x = random() * 400 - 200, z = random() * 400 - 200;
    const entry = { box: new THREE.Box3(new THREE.Vector3(x, 0, z), new THREE.Vector3(x + 2 + random() * 12, 8, z + 2 + random() * 12)) };
    indexed.colliders.push(entry); exhaustive.colliders.push(entry);
  }
  exhaustive.queryStatic = () => exhaustive.colliders;
  for (let i = 0; i < 150; i++) {
    const start = new THREE.Vector3(random() * 300 - 150, 0, random() * 300 - 150);
    const movement = new THREE.Vector3(random() * 70 - 35, 0, random() * 70 - 35);
    assert.ok(indexed.resolveMove(start, movement).distanceTo(exhaustive.resolveMove(start, movement)) < 1e-9);
  }
  assert.ok(indexed.queryStatic(-5, -5, 5, 5).length < indexed.colliders.length / 4);
  const added = { box: new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 8, 1)) };
  indexed.colliders.push(added);
  assert.ok(indexed.queryStatic(0, 0, 0, 0).includes(added));
});

test('un tirón aislado no baja la calidad y una carga sostenida solo baja efectos sin tocar la resolución', () => {
  const resolution = new AdaptiveResolution(1.25);
  resolution.sample(200);
  for (let i = 0; i < 180; i++) resolution.sample(1000 / 60);
  assert.equal(resolution.ratio, 1);
  assert.equal(resolution.pressure, 0);
  for (let i = 0; i < 300; i++) resolution.sample(40);
  assert.equal(resolution.ratio, 1);
  assert.equal(resolution.pressure, 2);
  resolution.setLimit(1.5);
  assert.equal(resolution.pressure, 0);
  assert.equal(resolution.ratio, 1);
});

test('los percentiles recientes olvidan tirones antiguos sin alterar el mínimo histórico', () => {
  const metrics = new FrameMetrics();
  let now = 0; metrics.sample(now);
  metrics.sample(now += 200);
  for (let i = 0; i < 600; i++) metrics.sample(now += 20);
  const recent = metrics.recentStats();
  assert.equal(metrics.min, 5);
  assert.equal(recent.frames, 600); assert.equal(recent.p95, 20); assert.equal(recent.over100ms, 0);
  assert.equal(recent.low1Percent, 50);
});

test('el perfilador permanece acotado y separa fases de CPU sin medir GPU', () => {
  const profiler = new FrameProfiler(2);
  profiler.beginFrame(0); profiler.mark('render', 10); profiler.endFrame(12);
  assert.equal(profiler.report().frames, 0);
  profiler.enabled = true;
  for (let i = 0; i < 5; i++) {
    profiler.beginFrame(0); profiler.mark('mundo', 3); profiler.mark('render', 8); profiler.endFrame(10);
  }
  const report = profiler.report();
  assert.equal(report.frames, 2); assert.equal(report.phases.totalCPU.p95, 10);
  assert.equal(report.phases.mundo.p95, 3); assert.equal(report.phases.render.p95, 5);
  profiler.reset(); assert.equal(profiler.report().frames, 0);
});

test('las luces registradas no recorren toda la escena por segundo y conservan sus cambios de intensidad', () => {
  const scene = new THREE.Scene(), light = new THREE.PointLight(0xff0000, 3, 8);
  scene.add(light);
  const lights = new LocalLights(scene);
  lights.refreshSources({ static: true });
  const traversal = mock.method(scene, 'traverse');
  for (let i = 0; i < 20; i++) lights.update(.2, new THREE.Vector3());
  assert.equal(traversal.mock.callCount(), 0);
  light.intensity = 7; lights.update(.1, new THREE.Vector3());
  assert.equal(lights.pool[0].intensity, 7);
  scene.remove(light); lights.update(.1, new THREE.Vector3());
  assert.equal(lights.sources.has(light), false); assert.equal(light.layers.mask, 1);
  lights.dispose(); traversal.mock.restore();
});

test('liberar un personaje no libera geometrías ni texturas compartidas con otros', () => {
  const root = new THREE.Group(), shared = new THREE.BoxGeometry(), own = new THREE.BoxGeometry();
  const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture });
  const skeleton = new THREE.Skeleton([new THREE.Bone()]);
  const mesh = new THREE.SkinnedMesh(shared, material); mesh.bind(skeleton);
  root.add(mesh);
  const sharedDispose = mock.method(shared, 'dispose'), textureDispose = mock.method(texture, 'dispose');
  const ownDispose = mock.method(own, 'dispose'), materialDispose = mock.method(material, 'dispose'), skeletonDispose = mock.method(skeleton, 'dispose');
  const instance = { root, ownedGeometries: [own], mixer: { stopAllAction() {}, uncacheRoot() {} } };
  disposeRealisticInstance(instance); disposeRealisticInstance(instance);
  assert.equal(sharedDispose.mock.callCount(), 0); assert.equal(textureDispose.mock.callCount(), 0);
  assert.equal(ownDispose.mock.callCount(), 1); assert.equal(materialDispose.mock.callCount(), 1); assert.equal(skeletonDispose.mock.callCount(), 1);
});

test('atenuar una pared no modifica los materiales de edificios agrupados', () => {
  const visibility = new BuildingVisibility(), shared = new THREE.MeshStandardMaterial();
  for (const x of [4, 12]) {
    const shell = createBuildingShell(new THREE.BoxGeometry(4, 8, 4), Array(6).fill(shared), { x, z: 4, height: 8, interiorMaterial: shared });
    visibility.register(shell);
  }
  const batch = visibility.buildClosedView();
  visibility._fade(visibility.buildings[0].parts[0], true, .1);
  assert.ok(visibility.buildings[0].parts[0].opacity < 1);
  assert.ok(batch.children.length <= 2);
  batch.traverse(mesh => { if (mesh.isMesh) { assert.equal(mesh.material.opacity, 1); assert.equal(mesh.material.transparent, false); } });
});

test('la silueta omite sus dos pasadas cuando está desactivada o no hay obstrucción', () => {
  let passes = 0;
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    quality: 'media', resolution: { pressure: 0 }, culling: { apply() {}, restore() {} },
    silhouette: { render() { passes += 2; } }, instance: { info: { reset() {} }, shadowMap: {}, render() { passes++; } }
  });
  renderer.render({}, {}, {}, [], false); assert.equal(passes, 1);
  renderer.quality = 'baja'; renderer.render({}, {}, {}); assert.equal(passes, 2);
  renderer.quality = 'alta'; renderer.render({}, {}, {}); assert.equal(passes, 5);
});
