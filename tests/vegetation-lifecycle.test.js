import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { createRenderSectors } from '../src/world/bogota/StaticGeometry.js';
import { createUrbanTree } from '../src/world/bogota/UrbanTrees.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { rng } from '../src/world/bogota/textures.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

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

test('decorar el distrito conserva el mapa y las colisiones originales, incluida el agua sólida', () => {
  const city = new Bogota();
  city.map = city._layout();
  city._buildGreenery();
  const collisions = new CollisionSystem();
  city._buildCollisions(city.map, collisions);
  // Capturados en main b250a4b antes de portar la decoración.
  assert.equal(digest(city.map), 'ad927fbac5cbcbb2fae2f8b8b0ae0f64a4beda7492b1c482c317d04b35ec8f9c');
  assert.equal(digest(collisions.colliders.map(({ box }) => [box.min.toArray(), box.max.toArray()])),
    'e0de87ed46577c6b7f2261fae7a24736bdaf3f63710f154e6e82550617e3ddc0');
  city.dispose(new THREE.Scene());
});

test('crear más recursos visuales no cambia solares, alturas ni detalles de las casas', () => {
  const document = globalThis.document, random = Math.random;
  // Solo sustituye Canvas; se ejecutan la partición, las geometrías y los UUID reales.
  const context = new Proxy({
    measureText: () => ({ width: 0 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} })
  }, { get: (object, key) => object[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const build = (seed, churn) => {
    Math.random = rng(seed);
    const city = new Bogota();
    try {
      city.map = city._layout();
      if (churn) {
        const house = city._house;
        city._house = function (...args) {
          const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture });
          const result = house.apply(this, args);
          material.dispose(); texture.dispose();
          return result;
        };
      }
      city._buildBlocks(city.map);
      city.group.updateMatrixWorld(true);
      const hash = createHash('sha256');
      city.group.traverse(object => {
        if (!object.isMesh) return;
        hash.update(JSON.stringify(object.matrixWorld.elements));
        for (const attribute of Object.values(object.geometry.attributes)) {
          const { array } = attribute;
          hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
        }
        const index = object.geometry.index?.array;
        if (index) hash.update(Buffer.from(index.buffer, index.byteOffset, index.byteLength));
      });
      return {
        geometry: hash.digest('hex'),
        buildings: city.buildingVisibility.buildings.map(({ baseBounds, height }) =>
          [baseBounds.min.toArray(), baseBounds.max.toArray(), height])
      };
    } finally { city.dispose(new THREE.Scene()); }
  };
  try { assert.deepEqual(build(89123, false), build(17, true)); }
  finally {
    Math.random = random;
    if (document === undefined) delete globalThis.document; else globalThis.document = document;
  }
});
