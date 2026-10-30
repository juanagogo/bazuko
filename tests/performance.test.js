import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FrameMetrics } from '../src/core/FrameMetrics.js';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { LocalLights } from '../src/core/LocalLights.js';
import { mergeByChunk, freezeStaticTransforms } from '../src/world/bogota/StaticGeometry.js';
import { PlayerSilhouette } from '../src/core/PlayerSilhouette.js';
import { PerformanceHUD } from '../src/ui/PerformanceHUD.js';
import { LightHalos } from '../src/core/LightHalos.js';

test('FPS usa tiempo real, promedio ponderado y conserva los tirones sin limitar el intervalo', () => {
  const metrics = new FrameMetrics();
  metrics.sample(0);
  metrics.sample(10);
  metrics.sample(60);
  metrics.sample(1060);
  assert.equal(metrics.current, 1);
  assert.equal(metrics.min, 1);
  assert.equal(metrics.max, 100);
  assert.equal(metrics.average, 3000 / 1060);
  assert.equal(metrics.frameMs, 1000);
  metrics.sample(10000, false);
  assert.equal(metrics.sample(20000), false); // pausa y pestaña en segundo plano
  metrics.sample(20020);
  assert.equal(metrics.min, 1);
  assert.equal(metrics.current, 50);
  metrics.reset();
  assert.equal(metrics.frames, 0);
  assert.equal(metrics.sample(30000), false);
  metrics.sample(30025);
  assert.equal(metrics.min, 40);
});

test('la resolución se mantiene en 1× y la carga severa solo baja efectos, que se recuperan después', () => {
  const quality = new AdaptiveResolution(2);
  assert.equal(quality.ratio, 1, 'un píxel de render por píxel CSS, también en pantallas densas');
  for (let i = 0; i < 9; i++) assert.equal(quality.sample(100), false);
  assert.equal(quality.sample(100), true, 'la carga severa reacciona en cuanto hay ocho cuadros lentos');
  assert.equal(quality.ratio, 1);
  assert.equal(quality.pressure, 1);
  for (let i = 0; i < 400; i++) quality.sample(100);
  assert.equal(quality.ratio, 1);
  assert.equal(quality.pressure, 2);
  quality.resetWindow();
  for (let i = 0; i < 800; i++) quality.sample(16);
  assert.equal(quality.pressure, 1, 'cuatro ventanas rápidas devuelven un nivel de efectos');
  for (let i = 0; i < 5000; i++) quality.sample(16);
  assert.equal(quality.pressure, 0);
  assert.equal(quality.ratio, 1);
  const lowDpi = new AdaptiveResolution(.5);
  for (let i = 0; i < 100; i++) lowDpi.sample(100);
  assert.equal(lowDpi.ratio, 1);
});

test('206 fuentes usan exactamente 2 luces de shader, también de día, y siguen al jugador', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const lights = Array.from({ length: 206 }, (_, i) => {
    const light = new THREE.PointLight(i === 0 ? 0xff0000 : 0x00ff00, 2, 8, 1.6);
    light.position.set(i * 10, 4, 0);
    scene.add(light);
    return light;
  });
  const budget = new LocalLights(scene);
  const count = () => {
    let count = 0;
    scene.traverseVisible(o => { if (o.isPointLight && o.layers.test(camera.layers)) count++; });
    return count;
  };
  budget.update(0, new THREE.Vector3());
  assert.equal(count(), 2);
  assert.ok(budget.pool[0].color.equals(lights[0].color));
  assert.deepEqual(budget.pool[0].position.toArray(), [0, 4, 0]);
  assert.equal(budget.pool[0].decay, 1.6);
  assert.equal(budget.pool[0].distance, 8);
  budget.update(.1, new THREE.Vector3(1500, 0, 0));
  assert.equal(budget.pool[0].position.x, 1500);
  assert.equal(count(), 2);
  for (const light of lights) light.intensity = 0;
  budget.update(.1, new THREE.Vector3());
  assert.equal(count(), 2);
  assert.ok(budget.pool.every(o => o.intensity === 0));
  budget.dispose();
  assert.equal(count(), 206);
  assert.ok(lights.every(o => o.layers.mask === 1));
});

test('halos comparten un solo dibujo, respetan la altura del suelo y se apagan sin dejar instancias', () => {
  const scene = new THREE.Scene(), halos = new LightHalos(scene, 4);
  const light = new THREE.PointLight(0xff8800, 3, 8);
  const entries = Array.from({ length: 10 }, (_, i) => ({ light, position: new THREE.Vector3(i * 2, 2, 0) }));
  entries.push({ light, position: new THREE.Vector3(100, 0, 0) });
  halos.update(entries, new THREE.Vector3(), () => .12);
  assert.equal(halos.mesh.count, 4);
  assert.equal(halos.mesh.material.isMeshBasicMaterial, true);
  assert.equal(halos.mesh.material.depthWrite, false);
  assert.equal(halos.mesh.material.depthTest, true);
  assert.equal(halos.mesh.castShadow, false);
  const matrix = new THREE.Matrix4();
  halos.mesh.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - .145) < 1e-6);
  assert.equal(scene.children.length, 1);
  halos.update([], new THREE.Vector3());
  assert.equal(halos.mesh.count, 0);
  let disposed = 0;
  for (const resource of [halos.texture, halos.mesh.geometry, halos.mesh.material]) resource.addEventListener('dispose', () => disposed++);
  halos.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(disposed, 3);
});

test('las luces respetan grupos ocultos y descubren fogones añadidos o eliminados durante la partida', () => {
  const scene = new THREE.Scene(), target = new THREE.Vector3();
  const group = new THREE.Group(), light = new THREE.PointLight(0xffaa00, 5, 9);
  group.position.x = 12;
  group.add(light);
  scene.add(group);
  const budget = new LocalLights(scene, 2);
  budget.update(0, target);
  assert.equal(budget.pool[0].position.x, 12);
  group.visible = false;
  budget.update(.1, target);
  assert.ok(budget.pool.every(o => o.intensity === 0));
  const fire = new THREE.PointLight(0xff0000, 9, 5);
  scene.add(fire);
  budget.update(1, target);
  assert.equal(budget.pool[0].intensity, 9);
  scene.remove(fire);
  budget.update(1, target);
  assert.equal(fire.layers.mask, 1);
  assert.ok(budget.pool.every(o => o.intensity === 0));
  budget.dispose();
});

test('sectores conservan geometría y UV y permiten descartar terreno distante del frustum', () => {
  const geometries = [];
  for (let z = 0; z < 120; z += 2) for (let x = 0; x < 120; x += 2) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(x, 0, z);
    geometries.push(geometry);
  }
  const group = mergeByChunk(geometries, new THREE.MeshBasicMaterial());
  assert.equal(group.children.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0), 7200);
  const bounds = new THREE.Box3().setFromObject(group);
  assert.equal(bounds.min.x, -1);
  assert.equal(bounds.min.z, -1);
  assert.ok(Math.abs(bounds.min.y) < 1e-12);
  assert.equal(bounds.max.x, 119);
  const camera = new THREE.PerspectiveCamera(55, 1, .1, 50);
  camera.position.set(10, 10, 10);
  camera.lookAt(10, 0, 10);
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const visible = group.children.filter(mesh => frustum.intersectsObject(mesh));
  assert.ok(visible.length < group.children.length / 2);
  assert.ok(visible.every(mesh => mesh.geometry.attributes.uv));
});

test('congelar inmuebles conserva sus matrices pero permite movimiento y animación del bus y las llamas', () => {
  const root = new THREE.Group(), house = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  house.position.set(30, 5, 20);
  const bus = new THREE.Group(), fire = new THREE.Group();
  fire.userData.update = () => {};
  const flame = new THREE.Object3D();
  fire.add(flame);
  root.add(house, bus, fire);
  freezeStaticTransforms(root, bus);
  const before = house.matrixWorld.clone();
  bus.position.z = 15;
  flame.scale.y = 2;
  root.updateMatrixWorld(true);
  assert.equal(house.matrixAutoUpdate, false);
  assert.equal(house.matrixWorldAutoUpdate, false);
  assert.ok(house.matrixWorld.equals(before));
  assert.equal(bus.matrixWorld.elements[14], 15);
  assert.equal(flame.matrixWorld.elements[5], 2);
});

test('las pasadas de silueta omiten la ciudad y restauran el estado incluso si falla el dibujo', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), player = new THREE.Group();
  const city = new THREE.Group(), light = new THREE.DirectionalLight();
  scene.add(city, player, light);
  for (let i = 0; i < 1000; i++) city.add(new THREE.Object3D());
  const originalChildren = scene.children;
  const overlay = new PlayerSilhouette();
  const renderer = { autoClear: true, shadowMap: { autoUpdate: true }, render(s) {
    assert.equal(s.children.length, 2);
    assert.equal(s.children.includes(city), false);
    assert.equal(player.parent, scene);
    assert.equal(s.matrixWorldAutoUpdate, false);
    throw new Error('GPU');
  } };
  assert.throws(() => overlay.render(renderer, scene, camera, player), /GPU/);
  assert.equal(scene.children, originalChildren);
  assert.equal(scene.matrixWorldAutoUpdate, true);
  assert.equal(light.layers.mask, 1);
  assert.equal(camera.layers.mask, 1);
  assert.equal(renderer.autoClear, true);
});

test('panel muestra las coordenadas y FPS con pocas escrituras DOM y descarta la pestaña oculta', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { hidden: false };
  try {
    let writes = 0, text = '';
    const hud = Object.assign(Object.create(PerformanceHUD.prototype), {
      metrics: new FrameMetrics(), nextPaint: 0,
      text: { set textContent(value) { writes++; text = value; } }
    });
    const renderer = { instance: { info: { render: { calls: 100, triangles: 5000 } }, getPixelRatio: () => 1 } };
    const position = new THREE.Vector3(12.345, .12, -8.9);
    for (let i = 0; i <= 60; i++) hud.update(i * 1000 / 60, position, renderer, true);
    assert.ok(writes <= 5);
    assert.match(text, /FPS actual 60.0/);
    assert.match(text, /X 12.35  Y 0.12  Z -8.90/);
    assert.match(text, /Promedio 60.0/);
    globalThis.document.hidden = true;
    hud.update(5000, position, renderer, true);
    globalThis.document.hidden = false;
    assert.equal(hud.update(10000, position, renderer, true), false);
    assert.ok(hud.metrics.min > 59);
  } finally { globalThis.document = previousDocument; }
});

test('las ramas estáticas congeladas no se recorren cada fotograma salvo que algo las modifique', () => {
  const root = new THREE.Group(), bus = new THREE.Group(), house = new THREE.Group(), wall = new THREE.Mesh();
  house.add(wall);
  root.add(house, bus);
  freezeStaticTransforms(root, bus);
  let visits = 0;
  const wallUpdate = wall.updateMatrixWorld;
  wall.updateMatrixWorld = function (force) { visits++; return wallUpdate.call(this, force); };
  root.updateMatrixWorld();
  assert.equal(visits, 0, 'sin cambios no se entra en la rama');
  assert.equal(root.children.includes(bus) && bus.updateMatrixWorld === THREE.Object3D.prototype.updateMatrixWorld, true, 'lo dinámico conserva su actualización');
  house.position.x = 4;
  house.updateMatrix();
  root.updateMatrixWorld();
  assert.equal(visits, 1, 'una matriz marcada como modificada recorre la rama');
  assert.equal(wall.matrixWorld.elements[12], 0, 'la pared congelada no recalcula su matriz de mundo');
  visits = 0;
  house.add(new THREE.Mesh());
  root.updateMatrixWorld();
  assert.equal(visits, 1, 'un hijo añadido después de congelar devuelve la rama al recorrido normal');
  assert.equal(house.updateMatrixWorld, THREE.Object3D.prototype.updateMatrixWorld);
});

test('un objeto oculto no recorre sus huesos y al mostrarse recupera las matrices de mundo', async () => {
  const { skipWhenHidden } = await import('../src/graphics/HiddenSubtrees.js');
  const parent = new THREE.Group(), root = new THREE.Group(), bone = new THREE.Object3D();
  root.add(bone);
  parent.add(root);
  skipWhenHidden(root);
  bone.position.x = 1;
  parent.updateMatrixWorld(true);
  assert.equal(bone.matrixWorld.elements[12], 1);
  root.visible = false;
  bone.position.x = 5;
  root.position.z = 3;
  parent.updateMatrixWorld();
  assert.equal(bone.matrixWorld.elements[12], 1, 'oculto: el hueso no se recalcula');
  assert.equal(root.matrixWorld.elements[14], 3, 'oculto: la matriz propia sí');
  root.visible = true;
  parent.updateMatrixWorld();
  assert.equal(bone.matrixWorld.elements[12], 5, 'al mostrarse se actualiza todo');
  assert.equal(bone.matrixWorld.elements[14], 3);
});
