import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TILE_SIZE } from '../src/utils/constants.js';
import { textureSet } from './helpers/fixtures.js';

// Conserva la geometría real; evita depender de Canvas para pintar las texturas.
mock.module('../src/world/bogota/textures.js', {
  namedExports: { ...textures, brick: textureSet, slab: textureSet, roofTiles: textureSet, facade: textureSet }
});
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => null } });
const { Bogota } = await import('../src/world/districts/Bogota.js');

function checkBuildings(map, seed) {
  const originalRandom = Math.random;
  Math.random = textures.rng(seed);
  const city = new Bogota();
  try {
    city._buildBlocks(map);
    const occupancy = map.map(row => row.map(() => 0));
    const claim = (bounds) => {
      for (let z = 0; z < map.length; z++) for (let x = 0; x < map[z].length; x++) {
        if (x * TILE_SIZE > bounds.min.x && x * TILE_SIZE < bounds.max.x &&
            z * TILE_SIZE > bounds.min.z && z * TILE_SIZE < bounds.max.z) occupancy[z][x]++;
      }
    };
    for (const building of city.buildingVisibility.buildings) {
      if (building.root.userData.perimeter) continue;
      // La base física de cada edificio conserva su huella cuando se ocultan las partes altas.
      claim(new THREE.Box3().setFromObject(building.base));
    }
    for (let z = 0; z < map.length; z++) for (let x = 0; x < map[z].length; x++) {
      const expected = ['building', 'ruin'].includes(map[z][x]) ? 1 : 0;
      assert.equal(occupancy[z][x], expected, `seed ${seed}, tile ${x},${z}: cobertura sin huecos ni solapamientos`);
    }
  } finally {
    Math.random = originalRandom;
    city.dispose(new THREE.Scene());
  }
}

test('las manzanas de Bogotá no contienen edificios superpuestos ni huecos', () => {
  const map = new Bogota()._layout();
  for (let seed = 1; seed <= 20; seed++) checkBuildings(map, seed);
});

test('fachadas opuestas y esquinas respetan las casas existentes en bloques estrechos', () => {
  for (const [width, depth] of [[1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [8, 2], [8, 8]]) {
    const map = Array.from({ length: 48 }, (_, z) => Array.from({ length: 48 }, (_, x) => {
      if (x === 0 || z === 0 || x === 47 || z === 47) return 'wall';
      if (x >= 5 && x < 5 + width && z >= 5 && z < 5 + depth) return 'ruin';
      return 'sidewalk';
    }));
    for (let seed = 1; seed <= 3; seed++) checkBuildings(map, seed);
  }
});

test('unir geometrías conserva índices, triángulos y geometrías compartidas por objetos animados', () => {
  const city = new Bogota();
  const shared = new THREE.BoxGeometry(2, 3, 4);
  const disposable = shared.clone();
  const material = new THREE.MeshStandardMaterial();
  let sharedDisposed = false, originalDisposed = false;
  shared.addEventListener('dispose', () => { sharedDisposed = true; });
  disposable.addEventListener('dispose', () => { originalDisposed = true; });
  const first = new THREE.Mesh(shared, material);
  const second = new THREE.Mesh(disposable, material);
  second.position.x = 8;
  const animated = new THREE.Mesh(shared, material);
  animated.userData.noMerge = true;
  city.group.add(first, second, animated);
  const before = new THREE.Box3().setFromObject(city.group);
  city._mergeStatic();
  const merged = city.group.children.find(o => o !== animated);
  assert.equal(merged.geometry.attributes.position.count, 48); // Antes: 72 vértices expandidos.
  assert.equal(merged.geometry.index.count, 72); // Los mismos 24 triángulos.
  assert.equal(sharedDisposed, false);
  assert.equal(originalDisposed, true);
  assert.ok(new THREE.Box3().setFromObject(city.group).equals(before));
  assert.equal(animated.matrixAutoUpdate, true);
  assert.equal(merged.matrixAutoUpdate, false);
  city.dispose(new THREE.Scene());
});
