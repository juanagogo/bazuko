import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { VIADUCT, viaductHeight, viaductSurface, buildColpatriaViaduct } from '../src/world/bogota/ColpatriaViaduct.js';
import { bridgeCenter, bridgeNormal, busPathX } from '../src/world/bogota/Colpatria.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { tree } from '../src/world/bogota/props.js';
import { Banca } from '../src/world/props/Banca.js';

test('la adaptación responde a 55 FPS sostenidos bajando efectos y solo recupera con margen de CPU', () => {
  const resolution = new AdaptiveResolution(1);
  for (let i = 0; i < 180; i++) resolution.sample(1000 / 55, 14);
  // La resolución queda fija en 1×: la carga sostenida baja efectos (presión), no píxeles.
  assert.equal(resolution.ratio, 1);
  assert.ok(resolution.pressure > 0);
  const raised = resolution.pressure;
  for (let i = 0; i < 900; i++) resolution.sample(1000 / 60, 15);
  assert.equal(resolution.pressure, raised, 'sin margen de CPU no recupera');
  resolution.resetWindow();
  for (let i = 0; i < 900; i++) resolution.sample(1000 / 60, 6);
  assert.equal(resolution.pressure, 0);
  assert.equal(resolution.ratio, 1);
});

test('el concreto entra en lotes por sector sin perder triángulos ni alterar la superficie', () => {
  const group = buildColpatriaViaduct();
  let triangles = 0;
  group.traverse(mesh => { if (mesh.isMesh) {
    assert.ok(mesh.geometry.attributes.uv);
    triangles += mesh.geometry.index.count / 3;
  } });
  Bogota.prototype._mergeStatic.call(Object.assign(Object.create(Bogota.prototype), { group, props: [] }));
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

test('bancas y árboles iguales comparten lotes; los objetos animados conservan sus materiales', () => {
  const group = new THREE.Group();
  for (let i = 0; i < 20; i++) {
    group.add(new Banca(new THREE.Vector3(i, 0, 0)).group);
    const plant = tree(1); plant.position.set(i, 0, 5); group.add(plant);
  }
  const animated = tree(1); animated.userData.update = () => {}; group.add(animated);
  const ownMaterials = animated.children.map(mesh => mesh.material);
  let before = 0; group.traverse(mesh => { if (mesh.isMesh) before++; });
  Bogota.prototype._mergeStatic.call(Object.assign(Object.create(Bogota.prototype), { group, props: [] }));
  let after = 0; group.traverse(mesh => { if (mesh.isMesh) after++; });
  assert.ok(after < before / 3, `${before} -> ${after}`);
  assert.deepEqual(animated.children.map(mesh => mesh.material), ownMaterials);
});

