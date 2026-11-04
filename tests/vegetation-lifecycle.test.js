import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { createRenderSectors } from '../src/world/bogota/StaticGeometry.js';
import { createUrbanTree } from '../src/world/bogota/UrbanTrees.js';

function countDisposals(resources) {
  const counts = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of counts.keys()) resource.addEventListener('dispose', () => {
    counts.set(resource, counts.get(resource) + 1);
  });
  return () => {
    for (const [resource, count] of counts) {
      assert.equal(count, 1, `${resource.type ?? resource.constructor.name} ${resource.name || resource.uuid}`);
    }
  };
}

function resourcesOf(root) {
  const resources = new Set();
  root.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.isInstancedMesh) resources.add(object);
    for (const material of [object.material, object.customDepthMaterial, object.customDistanceMaterial].flat().filter(Boolean)) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  return resources;
}

test('el distrito libera una vez recursos compartidos de color, sombra y uniforms', () => {
  const city = new Bogota(), scene = new THREE.Scene(), geometry = new THREE.BoxGeometry();
  const atlas = new THREE.Texture(), distanceAtlas = new THREE.Texture(), uniformAtlas = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: .4 });
  const depth = new THREE.MeshDepthMaterial({ map: atlas, alphaTest: .4 });
  const distance = new THREE.MeshDistanceMaterial({ alphaMap: distanceAtlas });
  depth.uniforms = { sharedAtlas: { value: [atlas, uniformAtlas] } };
  material.userData.uniforms = { extraAtlas: { value: uniformAtlas } };
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(geometry, [material, material]);
    mesh.customDepthMaterial = depth; mesh.customDistanceMaterial = distance;
    city.group.add(mesh);
  }
  scene.add(city.group);
  const verify = countDisposals([geometry, material, depth, distance, atlas, distanceAtlas, uniformAtlas]);
  city.dispose(scene); city.dispose(scene);
  verify();
  assert.equal(city.group.parent, null);
});

test('BuildingVisibility conserva la propiedad de materiales agrupados sin doble liberación', () => {
  const city = new Bogota(), scene = new THREE.Scene(), atlas = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: atlas });
  const shell = createBuildingShell(new THREE.BoxGeometry(6, 8, 5), Array(6).fill(material), {
    x: 4, z: 5, height: 8, interiorMaterial: material
  });
  city.group.add(shell.root);
  city.buildingVisibility.register(shell);
  city.group.add(city.buildingVisibility.buildClosedView());
  scene.add(city.group);
  const resources = resourcesOf(city.group);
  for (const closed of city.buildingVisibility.closedMaterials.values()) resources.add(closed);
  const verify = countDisposals(resources);
  city.dispose(scene); city.dispose(scene);
  verify();
  assert.equal(city.buildingVisibility.closedMaterials.size, 0);
});

test('árboles fusionados y vegetación transferida por sectores liberan sus recursos una sola vez', () => {
  const city = new Bogota(), scene = new THREE.Scene();
  city.map = city._layout();
  city._buildGreenery();
  assert.ok(city.treePlan.length > 0);
  assert.ok(city.vegetationPlan.clusters.length > 0);
  const vegetationMeshes = city.group.children.filter(object => object.userData.vegetationSector);
  assert.ok(vegetationMeshes.length > 1);
  city._mergeStatic();
  createRenderSectors(city.group);
  scene.add(city.group);
  const resources = resourcesOf(city.group), verify = countDisposals(resources);
  const leaves = [...resources].find(resource => resource.isMaterial && resource.alphaTest > 0);
  assert.ok(leaves?.map?.isTexture);
  assert.ok([...resources].some(resource => resource.isMeshDepthMaterial));
  city.dispose(scene); city.dispose(scene);
  verify();

  // El banco compartido de árboles se renueva después de cerrar su ciudad.
  const nextCity = new Bogota(), tree = createUrbanTree();
  nextCity.group.add(tree);
  let nextLeaves;
  tree.traverse(object => { if (object.material?.alphaTest > 0) nextLeaves = object.material; });
  assert.notEqual(nextLeaves, leaves);
  assert.notEqual(nextLeaves.map, leaves.map);
  nextCity.dispose(scene);
});

test('el merge estático conserva instancias y sus transformaciones sin necesitar noMerge', () => {
  const city = new Bogota(), scene = new THREE.Scene();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2);
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(20, 0, 0));
  const matrices = [...mesh.instanceMatrix.array];
  city.group.add(mesh);
  city._mergeStatic();
  assert.equal(mesh.parent, city.group);
  assert.equal(mesh.count, 2);
  assert.deepEqual([...mesh.instanceMatrix.array], matrices);
  const verify = countDisposals([mesh, mesh.geometry, mesh.material]);
  city.dispose(scene); city.dispose(scene);
  verify();
});
