import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { buildTreeGeometries, createLeafAtlas, createTreeField, TREE_LOD, TREE_SPECIES, TREE_SPECIES_INDEX } from '../src/world/bogota/TreeField.js';
import { withWarmupVariants, collectShaderWarmupJobs } from '../src/core/ShaderWarmup.js';

const { tileMeters } = createLeafAtlas();

test('prepara todos los LOD sin cambiar su distribución ni activar árboles lejanos al terminar', async () => {
  const scene = new THREE.Scene();
  const field = createTreeField(scene, [{ x: 0, z: 0, scale: .7, species: 0 }, { x: 300, z: 0, scale: .7, species: 2 }]);
  scene.add(field.group);
  field.update(new THREE.Vector3(0, 2, 10));
  const before = field.meshes.map(m => [m.visible, m.count, [...m.instanceMatrix.array]]);
  assert.equal(collectShaderWarmupJobs([field.group]).objects, field.meshes.length);
  await withWarmupVariants([field.group], async () => {
    field.update(new THREE.Vector3(300, 2, 10));
    assert.ok(field.meshes.every(m => m.visible));
    assert.deepEqual(field.meshes.map(m => m.count), before.map(v => v[1]));
  });
  assert.deepEqual(field.meshes.map(m => [m.visible, m.count, [...m.instanceMatrix.array]]), before);
  field.update(new THREE.Vector3(300, 2, 10));
  assert.notDeepEqual(field.meshes.map(m => m.visible), before.map(v => v[0]));
  field.dispose();
});

test('las tres especies bogotanas crecen igual en cada carga y con su silueta propia', () => {
  assert.deepEqual(TREE_SPECIES.map(s => s.name), ['urapan', 'eucalipto', 'caucho']);
  assert.deepEqual(Object.keys(TREE_SPECIES_INDEX), ['urapan', 'eucalipto', 'caucho']);
  const size = s => buildTreeGeometries(s, 0, tileMeters)[0].boundingBox.getSize(new THREE.Vector3());
  const [urapan, eucalipto, caucho] = [0, 1, 2].map(size);
  assert.ok(eucalipto.y > urapan.y && urapan.y > caucho.y, 'el eucalipto es el más alto y el caucho el más bajo');
  assert.ok(caucho.x / caucho.y > urapan.x / urapan.y, 'el caucho tiene la copa más ancha respecto de su altura');
  const a = buildTreeGeometries(1, 1, tileMeters)[0], b = buildTreeGeometries(1, 1, tileMeters)[0];
  assert.deepEqual([...a.attributes.position.array.slice(0, 60)], [...b.attributes.position.array.slice(0, 60)]);
});

test('cada nivel de detalle tiene menos triángulos y el atlas calcula sus tarjetas sin canvas', () => {
  assert.equal(tileMeters.length, 4);
  assert.ok(tileMeters.every(m => m > .5 && m < 4));
  for (let s = 0; s < 3; s++) {
    const [near, mid, far] = buildTreeGeometries(s, 0, tileMeters).map(g => g.userData.triangles);
    assert.ok(near > mid && mid > far, `${TREE_SPECIES[s].name}: ${near} > ${mid} > ${far}`);
    assert.ok(near < 6000, 'un árbol cercano cuesta pocos miles de triángulos');
  }
});

test('el nivel de cada árbol sigue a la cámara con histéresis y las celdas vacías se ocultan', () => {
  const scene = new THREE.Scene();
  const field = createTreeField(scene, [{ x: 0, z: 0, scale: .7, species: 0 }, { x: 300, z: 0, scale: .7, species: 2 }]);
  assert.equal(field.group.userData.noMerge, true);
  const visible = () => field.meshes.filter(m => m.visible).map(m => m.name);
  field.update(new THREE.Vector3(0, 2, 10));
  assert.ok(visible().some(n => n.includes('lod0')), 'cerca: detalle completo');
  field.update(new THREE.Vector3(0, 2, TREE_LOD.near + TREE_LOD.hysteresis / 2));
  assert.ok(visible().some(n => n.includes('lod0')), 'en el borde conserva el nivel que tenía');
  field.update(new THREE.Vector3(0, 2, TREE_LOD.near + 20));
  assert.ok(visible().some(n => n.startsWith('Trees_urapan') && n.includes('lod1')));
  field.update(new THREE.Vector3(1000, 2, 1000));
  assert.equal(field.meshes.filter(m => m.visible).length, 0, 'demasiado lejos: nada que dibujar');
  assert.ok(field.group.children.every(cell => !cell.visible));
  field.dispose();
});

test('el campo sigue la cámara de cada render de la vista y se libera devolviendo el gancho de la escena', () => {
  const scene = new THREE.Scene(), calls = [];
  scene.onBeforeRender = (...args) => calls.push(args[2]);
  const field = createTreeField(scene, [{ x: 0, z: 0, scale: .7, species: 1 }]);
  const view = new THREE.PerspectiveCamera(), shadow = new THREE.OrthographicCamera();
  view.position.set(1000, 2, 1000); view.updateMatrixWorld();
  scene.onBeforeRender(null, scene, shadow, null);
  assert.ok(field.meshes.some(m => m.visible), 'las cascadas de sombra no cambian los niveles');
  scene.onBeforeRender(null, scene, view, null);
  assert.ok(field.meshes.every(m => !m.visible));
  assert.deepEqual(calls, [shadow, view], 'el gancho anterior se sigue llamando');
  const before = field.group.parent;
  field.dispose();
  assert.equal(before, null);
  scene.onBeforeRender(null, scene, view, null);
  assert.equal(calls.length, 3, 'tras liberar queda solo el gancho original');
});
