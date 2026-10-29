import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { instanceStaticModels, freezeStaticTransforms } from '../src/world/bogota/StaticGeometry.js';
import { Renderer } from '../src/core/Renderer.js';
import { VIADUCT, viaductHeight, viaductSurface, buildColpatriaViaduct } from '../src/world/bogota/ColpatriaViaduct.js';
import { bridgeCenter, bridgeNormal, busPathX } from '../src/world/bogota/Colpatria.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { tree, foliageWind } from '../src/world/bogota/props.js';
import { Banca } from '../src/world/props/Banca.js';

test('la adaptación responde a 55 FPS sostenidos y solo recupera con margen de CPU', () => {
  const resolution = new AdaptiveResolution(1);
  for (let i = 0; i < 180; i++) resolution.sample(1000 / 55, 14);
  assert.ok(resolution.ratio < 1);
  const lower = resolution.ratio;
  for (let i = 0; i < 900; i++) resolution.sample(1000 / 60, 15);
  assert.equal(resolution.ratio, lower);
  resolution.resetWindow();
  for (let i = 0; i < 900; i++) resolution.sample(1000 / 60, 6);
  assert.equal(resolution.ratio, 1);
});

test('el concreto entra en lotes por sector sin perder triángulos ni alterar la superficie', () => {
  const group = buildColpatriaViaduct();
  let triangles = 0;
  group.traverse(mesh => { if (mesh.isMesh) {
    assert.ok(mesh.geometry.attributes.uv);
    triangles += mesh.geometry.index.count / 3;
  } });
  Bogota.prototype._mergeStatic.call({ group });
  let meshes = 0, after = 0;
  group.traverse(mesh => { if (mesh.isMesh) { meshes++; after += mesh.geometry.index.count / 3; } });
  assert.equal(after, triangles);
  assert.ok(meshes < 60, `${meshes} mallas en el viaducto agrupado`);
});

test('el índice de altura coincide con la consulta exhaustiva anterior en rampas, curvas y bordes', () => {
  const edge = (z, side) => {
    const n = bridgeNormal(z), offset = side * VIADUCT.width / 2;
    return new THREE.Vector3(bridgeCenter(z) + n.x * offset, viaductHeight(z), z + n.z * offset);
  };
  const reference = (x, z) => {
    if (z < VIADUCT.start - 16 || z > VIADUCT.end + 16 || Math.abs(x - busPathX(z)) > 24) return null;
    for (let t = Math.max(Math.floor(VIADUCT.start), Math.floor(z - 16)); t < Math.min(VIADUCT.end, z + 16); t++) {
      const a = edge(Math.max(t, VIADUCT.start), -1), b = edge(Math.max(t, VIADUCT.start), 1);
      const c = edge(Math.min(t + 1, VIADUCT.end), -1), d = edge(Math.min(t + 1, VIADUCT.end), 1);
      for (const [p, q, r] of [[a, b, c], [b, d, c]]) {
        const den = (q.z - r.z) * (p.x - r.x) + (r.x - q.x) * (p.z - r.z);
        if (Math.abs(den) < 1e-9) continue;
        const u = ((q.z - r.z) * (x - r.x) + (r.x - q.x) * (z - r.z)) / den;
        const v = ((r.z - p.z) * (x - r.x) + (p.x - r.x) * (z - r.z)) / den;
        if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) return u * p.y + v * q.y + (1 - u - v) * r.y;
      }
    }
    return null;
  };
  for (let z = 14; z <= 320; z += .71) for (const offset of [-7.01, -7, -6.99, -3.5, 0, 3.5, 6.99, 7, 7.01]) {
    const n = bridgeNormal(z), x = bridgeCenter(z) + n.x * offset, worldZ = z + n.z * offset;
    const expected = reference(x, worldZ), actual = viaductSurface(x, worldZ);
    if (expected === null) assert.equal(actual, null, `${x},${worldZ}`);
    else assert.ok(actual !== null && Math.abs(actual - expected) < 1e-10, `${x},${worldZ}: ${actual} != ${expected}`);
  }
});

test('instanciar conserva transformaciones mundiales, luces, recursos compartidos y descarte espacial', () => {
  const parent = new THREE.Group(); parent.position.set(40, 2, -10); parent.rotation.y = .3;
  const geometry = new THREE.BoxGeometry(1, 4, 1), material = new THREE.MeshStandardMaterial();
  const roots = [], expected = new THREE.Box3();
  for (const x of [2, 6, 90]) {
    const root = new THREE.Group(), mesh = new THREE.Mesh(geometry, material), light = new THREE.PointLight();
    root.position.set(x, 0, 2); mesh.position.y = 2; mesh.castShadow = true; root.add(mesh, light); parent.add(root);
    root.updateWorldMatrix(true, true); expected.union(new THREE.Box3().setFromObject(mesh)); roots.push(root);
  }
  const group = instanceStaticModels(roots, parent); parent.add(group); parent.updateMatrixWorld(true);
  assert.equal(group.children.length, 2);
  assert.equal(group.children.reduce((sum, mesh) => sum + mesh.count, 0), 3);
  const actual = new THREE.Box3().setFromObject(group);
  assert.ok(actual.min.distanceTo(expected.min) < 1e-5 && actual.max.distanceTo(expected.max) < 1e-5);
  assert.ok(roots.every(root => !root.children[0].visible && root.children[1].visible));
  assert.ok(group.children.every(mesh => mesh.geometry === geometry && mesh.material === material && mesh.castShadow && mesh.boundingSphere));
});

test('bancas y árboles iguales comparten lotes; los objetos animados conservan sus materiales', () => {
  const group = new THREE.Group();
  for (let i = 0; i < 20; i++) {
    group.add(new Banca(new THREE.Vector3(i, 0, 0)).group);
    const plant = tree(1); plant.position.set(i, 0, 5); group.add(plant);
  }
  const animated = tree(1); animated.userData.update = () => {}; group.add(animated);
  const ownMaterials = animated.children.map(mesh => mesh.material);
  let before = 0; group.traverse(mesh => { if (mesh.isMesh) before++; });
  Bogota.prototype._mergeStatic.call({ group });
  let after = 0; group.traverse(mesh => { if (mesh.isMesh) after++; });
  assert.ok(after < before / 3, `${before} -> ${after}`);
  assert.deepEqual(animated.children.map(mesh => mesh.material), ownMaterials);
});

test('el viento de los árboles vive en el shader y sobrevive a la fusión en lotes', () => {
  const group = new THREE.Group();
  for (let i = 0; i < 12; i++) { const plant = tree(1); plant.position.set(4 + i, 0, 4); group.add(plant); }
  assert.ok(group.children.every(plant => !plant.userData.update));
  const phases = group.children.map(plant => {
    const leaves = []; plant.traverse(mesh => { if (mesh.isMesh && mesh.material.userData.staticMergeKey.endsWith('|wind')) leaves.push(mesh); });
    assert.equal(leaves.length, 4);
    assert.ok(leaves.every(mesh => mesh.geometry.attributes.uv.getX(0) === leaves[0].geometry.attributes.uv.getX(0)));
    return leaves[0].geometry.attributes.uv.getX(0);
  });
  assert.ok(new Set(phases).size > 1, 'cada árbol conserva su propia fase');
  Bogota.prototype._mergeStatic.call({ group });
  const leaves = []; group.traverse(mesh => { if (mesh.isMesh && mesh.material.userData.staticMergeKey?.endsWith('|wind')) leaves.push(mesh); });
  assert.ok(leaves.length <= 3, `${leaves.length} lotes de follaje`);
  assert.ok(leaves.every(mesh => mesh.customDepthMaterial?.onBeforeCompile));
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' };
  leaves[0].material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.foliageTime, foliageWind);
  assert.match(shader.vertexShader, /transformed\.x \+= sin\(foliageTime/);
});

test('el render actualiza raíces dinámicas sin recorrer inmuebles y restaura el estado si falla', () => {
  const scene = new THREE.Scene(), city = new THREE.Group(), building = new THREE.Object3D();
  const bus = new THREE.Group(), chassis = new THREE.Object3D(), fire = new THREE.Group(), flame = new THREE.Object3D();
  fire.userData.update = () => {};
  bus.add(chassis); fire.add(flame); city.add(building, bus, fire); scene.add(city);
  const player = new THREE.Group(), bone = new THREE.Object3D(); player.add(bone); scene.add(player);
  building.position.set(20, 10, 30); freezeStaticTransforms(city, new Set([bus]));
  let staticVisits = 0;
  const update = city.updateMatrixWorld;
  city.updateMatrixWorld = function (...args) { staticVisits++; return update.apply(this, args); };
  bus.position.z = 12; chassis.rotation.z = .2; flame.scale.y = 2; player.position.x = 7; bone.position.y = 1.5;
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    quality: 'baja', dynamicWorldRoots: [bus, fire], resolution: { pressure: 0 },
    culling: { apply() {}, restore() {} },
    instance: { info: { reset() {} }, shadowMap: {}, render() {
      assert.equal(scene.matrixWorldAutoUpdate, false);
      assert.equal(bus.matrixWorld.elements[14], 12);
      assert.ok(Math.abs(chassis.matrixWorld.elements[0] - Math.cos(.2)) < 1e-10);
      assert.equal(flame.matrixWorld.elements[5], 2);
      assert.equal(bone.matrixWorld.elements[12], 7); assert.equal(bone.matrixWorld.elements[13], 1.5);
      assert.equal(building.matrixWorld.elements[12], 20);
      throw new Error('GPU');
    } }
  });
  assert.throws(() => renderer.render(scene, new THREE.PerspectiveCamera()), /GPU/);
  assert.equal(scene.matrixWorldAutoUpdate, true);
  assert.equal(staticVisits, 0);
});
