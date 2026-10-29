import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { rng } from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { TILE_SIZE } from '../src/utils/constants.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Solo se sustituye el dibujo Canvas. Partición, edificios, materiales, UUID y colisiones son reales.
function canvasDocument(labels) {
  return { createElement() {
    const context = new Proxy({
      measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillText(text, ...position) { labels.push([text, ...position]); }
    }, { get: (object, key) => object[key] ?? (() => {}) });
    return { width: 0, height: 0, getContext: () => context };
  } };
}

function architecture(seed, churn) {
  const random = Math.random, document = globalThis.document, labels = [];
  let city;
  try {
    Math.random = rng(seed);
    globalThis.document = canvasDocument(labels);
    city = new Bogota();
    city.map = city._layout();
    const before = digest(city.map);
    if (churn) {
      const buildHouse = city._house;
      city._house = function (...args) {
        // Simula más recursos visuales por fallo de caché: cambia el consumo global de UUID.
        const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture });
        const result = buildHouse.apply(this, args);
        material.dispose(); texture.dispose();
        return result;
      };
    }
    city._buildBlocks(city.map);
    assert.equal(digest(city.map), before, 'construir fachadas no modifica tiles');
    city.group.updateMatrixWorld(true);
    const geometry = createHash('sha256');
    city.group.traverse(object => {
      if (!object.isMesh) return;
      geometry.update(JSON.stringify({ name: object.name, matrix: object.matrixWorld.elements }));
      for (const key of ['position', 'normal', 'uv']) {
        const array = object.geometry.attributes[key]?.array;
        if (array) geometry.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
      }
      const index = object.geometry.index?.array;
      if (index) geometry.update(Buffer.from(index.buffer, index.byteOffset, index.byteLength));
    });
    const occupancy = city.map.map(row => row.map(() => 0));
    for (const building of city.buildingVisibility.buildings) {
      if (building.root.userData.perimeter) continue;
      const { min, max } = building.baseBounds;
      for (let z = Math.floor(min.z / TILE_SIZE) + 1; z < Math.ceil(max.z / TILE_SIZE); z++) {
        for (let x = Math.floor(min.x / TILE_SIZE) + 1; x < Math.ceil(max.x / TILE_SIZE); x++) occupancy[z][x]++;
      }
    }
    for (let z = 0; z < city.map.length; z++) for (let x = 0; x < city.map[z].length; x++) {
      assert.equal(occupancy[z][x], ['building', 'ruin'].includes(city.map[z][x]) ? 1 : 0, `solar ${x},${z}`);
    }
    const collisions = new CollisionSystem();
    city._buildCollisions(city.map, collisions);
    return {
      map: before, geometry: geometry.digest('hex'), labels: digest(labels), occupancy: digest(occupancy),
      bounds: digest(city.buildingVisibility.buildings.map(building => [building.bounds.min.toArray(), building.bounds.max.toArray()])),
      colliders: digest(collisions.colliders.map(({ box }) => [box.min.toArray(), box.max.toArray()]))
    };
  } finally {
    city?.dispose(new THREE.Scene());
    Math.random = random;
    if (document === undefined) delete globalThis.document; else globalThis.document = document;
  }
}

test('la arquitectura no cambia con el azar global ni con más creaciones de texturas y materiales', () => {
  const first = architecture(89123, false);
  assert.deepEqual(architecture(17, true), first);
  // Capturados antes de separar el azar arquitectónico: el mapa y sus sólidos siguen exactos.
  assert.equal(first.map, 'ad927fbac5cbcbb2fae2f8b8b0ae0f64a4beda7492b1c482c317d04b35ec8f9c');
  assert.equal(first.colliders, '6b8d21ce0063a9a7ef0f4f4bfb43608e02335553ab98206151f237594ef3dd0d');
});

test('cerrar la ciudad libera una vez todos los mapas del suelo y el detalle propio de la ribera', () => {
  const city = new Bogota(), scene = new THREE.Scene();
  city.map = city._layout(); city._buildGround(city.map); scene.add(city.group);
  const releases = new Map();
  for (const material of Object.values(city.groundMaterials)) {
    for (const value of Object.values(material)) if (value?.isTexture) releases.set(value, 0);
  }
  releases.set(city.lakeTerrain.material.userData.uniforms.lakeShoreDetail.value, 0);
  for (const texture of releases.keys()) texture.addEventListener('dispose', () => releases.set(texture, releases.get(texture) + 1));
  city.dispose(scene);
  for (const count of releases.values()) assert.equal(count, 1);
});
