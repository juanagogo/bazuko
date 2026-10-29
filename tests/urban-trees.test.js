import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createUrbanTree, URBAN_TREE_SPECIES, foliageWind } from '../src/world/bogota/UrbanTrees.js';
import { tree, foliageWind as publicWind } from '../src/world/bogota/props.js';
import { Bogota } from '../src/world/districts/Bogota.js';

const meshes = tree => { const list = []; tree.traverse(o => { if (o.isMesh) list.push(o); }); return list; };
const leaves = tree => meshes(tree).find(mesh => mesh.geometry.attributes.treeWind);

test('cada especie mantiene dos mallas, geometría finita y un presupuesto pequeño de triángulos', () => {
  const heights = [];
  for (const species of URBAN_TREE_SPECIES) {
    const plant = createUrbanTree(1, { seed: 13, species }), parts = meshes(plant);
    assert.equal(parts.length, 2);
    assert.equal(plant.userData.update, undefined);
    const triangleCount = parts.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
    assert.equal(triangleCount, plant.userData.tree.triangles);
    assert.ok(triangleCount < 900);
    for (const mesh of parts) {
      assert.ok(mesh.castShadow && mesh.receiveShadow);
      assert.ok(mesh.material.userData.staticMergeKey);
      for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
      assert.ok(mesh.geometry.index.array.every(index => index < mesh.geometry.attributes.position.count));
    }
    const bounds = new THREE.Box3().setFromObject(plant), size = bounds.getSize(new THREE.Vector3());
    assert.ok(bounds.min.y >= -.03 && bounds.max.y < 8.5);
    assert.ok(size.x < 6 && size.z < 6 && size.y > 4);
    heights.push(size.y);
  }
  assert.ok(heights[1] > heights[0] && heights[0] > heights[2], 'las siluetas tienen proporciones distintas');
});

test('la semilla determina la forma y el viento sin depender de UUID o del orden de construcción', () => {
  const first = meshes(tree(1, { seed: 722, species: 'eucalipto' }));
  tree(1, { seed: 91, species: 'arrayan' });
  const second = meshes(tree(1, { seed: 722, species: 'eucalipto' }));
  const other = meshes(tree(1, { seed: 723, species: 'eucalipto' }));
  for (let i = 0; i < first.length; i++) {
    for (const key of Object.keys(first[i].geometry.attributes)) {
      assert.deepEqual(first[i].geometry.attributes[key].array, second[i].geometry.attributes[key].array);
    }
    assert.deepEqual(first[i].geometry.index.array, second[i].geometry.index.array);
    assert.notDeepEqual(first[i].geometry.attributes.position.array, other[i].geometry.attributes.position.array);
  }
  assert.deepEqual(meshes(tree())[0].geometry.attributes.position.array, meshes(tree())[0].geometry.attributes.position.array);
});

test('tronco y ramas tienen caras orientadas hacia fuera y normales coherentes', () => {
  for (const species of URBAN_TREE_SPECIES) {
    const geometry = meshes(createUrbanTree(1, { seed: 21, species }))[0].geometry;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
    for (let i = 0; i < geometry.index.count; i += 3) {
      const first = geometry.index.getX(i);
      a.fromBufferAttribute(geometry.attributes.position, first);
      b.fromBufferAttribute(geometry.attributes.position, geometry.index.getX(i + 1)).sub(a);
      c.fromBufferAttribute(geometry.attributes.position, geometry.index.getX(i + 2)).sub(a);
      normal.fromBufferAttribute(geometry.attributes.normal, first);
      assert.ok(b.cross(c).dot(normal) > 0, `${species}: cara ${i / 3} invertida`);
    }
  }
});

test('todas las variantes comparten atlas y materiales; las hojas recortan siluetas sin mezclado transparente', () => {
  const plants = URBAN_TREE_SPECIES.map((species, seed) => createUrbanTree(1, { seed, species }));
  const all = plants.map(meshes), reference = leaves(plants[0]);
  for (const parts of all) {
    assert.equal(parts[0].material, all[0][0].material);
    assert.equal(parts[1].material, reference.material);
    assert.equal(parts[1].customDepthMaterial, reference.customDepthMaterial);
    assert.equal(parts[1].material.transparent, false);
    assert.ok(parts[1].material.alphaTest > 0);
    assert.equal(parts[1].customDepthMaterial.map, parts[1].material.map);
    assert.equal(parts[1].customDepthMaterial.alphaTest, parts[1].material.alphaTest);
  }
  const atlas = reference.material.map;
  assert.equal(atlas.colorSpace, THREE.SRGBColorSpace);
  assert.equal(atlas.image.width, 256); assert.equal(atlas.image.height, 256);
  let visible = 0, empty = 0;
  for (let i = 3; i < atlas.image.data.length; i += 4) {
    if (atlas.image.data[i] >= 128) visible++;
    if (atlas.image.data[i] === 0) empty++;
  }
  assert.ok(visible > 6000 && empty > 20000, 'atlas con hojas y aire entre ellas');
});

test('el viento usa datos separados de UV y el mismo desplazamiento en color y profundidad', () => {
  const foliage = leaves(createUrbanTree(1, { seed: 41 }));
  const { uv, treeWind } = foliage.geometry.attributes;
  assert.equal(publicWind, foliageWind);
  assert.equal(treeWind.count, uv.count);
  assert.ok(uv.array.every(value => value >= 0 && value <= 1));
  assert.ok(treeWind.array.some(value => value > 1), 'las fases no ocupan coordenadas del atlas');
  const color = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <alphatest_fragment>' };
  const depth = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <alphatest_fragment>' };
  foliage.material.onBeforeCompile(color); foliage.customDepthMaterial.onBeforeCompile(depth);
  assert.equal(color.uniforms.foliageTime, foliageWind);
  assert.equal(depth.uniforms.foliageTime, foliageWind);
  assert.equal(color.vertexShader, depth.vertexShader);
  assert.equal(color.fragmentShader, '#include <alphatest_fragment>');
  assert.equal(depth.fragmentShader, '#include <alphatest_fragment>');
});

test('los lotes del distrito conservan colores, UV, semillas y sombra del follaje', () => {
  const group = new THREE.Group(), phases = new Set(), expected = new THREE.Box3();
  for (let i = 0; i < 6; i++) {
    const plant = tree(1, { seed: i + 8, species: URBAN_TREE_SPECIES[i % 3] });
    plant.position.set(8 + i * 2, 0, 8); group.add(plant);
    phases.add(leaves(plant).geometry.attributes.treeWind.getX(0));
    expected.union(new THREE.Box3().setFromObject(plant));
  }
  Bogota.prototype._mergeStatic.call({ group });
  const parts = meshes(group), foliage = parts.filter(mesh => mesh.geometry.attributes.treeWind);
  assert.equal(parts.length, 2, 'dos lotes compartidos dentro de un mismo sector');
  assert.equal(foliage.length, 1);
  assert.ok(foliage[0].customDepthMaterial);
  const wind = foliage[0].geometry.attributes.treeWind;
  assert.deepEqual(new Set(Array.from({ length: wind.count }, (_, i) => wind.getX(i))), phases);
  assert.ok(parts.every(mesh => mesh.geometry.attributes.color));
  const bounds = new THREE.Box3().setFromObject(group);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(bounds.min[axis] <= expected.min[axis] + 1e-5 && bounds.max[axis] >= expected.max[axis] - 1e-5);
    assert.ok(Math.abs(bounds.min[axis] - expected.min[axis]) < .251 && Math.abs(bounds.max[axis] - expected.max[axis]) < .251,
      'el lote conserva el volumen más el margen acotado del viento');
  }
});

test('una ciudad nueva recibe otro banco tras liberar los materiales compartidos', () => {
  const first = leaves(tree(1, { seed: 1 }));
  first.material.dispose();
  const second = leaves(tree(1, { seed: 1 }));
  assert.notEqual(second.material, first.material);
  assert.notEqual(second.material.map, first.material.map);
  first.customDepthMaterial.dispose();
  assert.equal(leaves(tree()).material, second.material, 'disponer el banco viejo no invalida el nuevo');
});
