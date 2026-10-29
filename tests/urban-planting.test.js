import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota, SHELTER_LOCATION } from '../src/world/districts/Bogota.js';
import { planUrbanTrees, URBAN_TREE_LIMITS, URBAN_TREE_SPECIES } from '../src/world/bogota/UrbanPlanting.js';
import { EXTENSION_PARKS } from '../src/world/bogota/CityLayout.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';
import { LAKE_PARK, onLakeBridge } from '../src/world/bogota/LakePark.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';

function fixture() {
  const city = new Bogota();
  city.map = city._layout();
  const options = {
    map: city.map,
    groundHeight: (x, z) => city.getMovementGroundHeight(x, z, 0),
    getWaterInfo: (x, z) => city.getWaterInfo(x, z),
    isReserved: (x, z, padding) => Math.hypot(x - SHELTER_LOCATION.x, z - SHELTER_LOCATION.z) < 7 + padding
  };
  return { city, options, plan: planUrbanTrees(options) };
}

test('los parques actuales reciben arbolado acotado sin cambiar el mapa ni su geometría física', () => {
  const { city, options } = fixture();
  const before = JSON.stringify(city.map);
  for (const row of city.map) Object.freeze(row);
  Object.freeze(city.map);
  const trees = planUrbanTrees(options);
  assert.ok(trees.length >= 50 && trees.length <= 90, `presupuesto actual: ${trees.length}`);
  assert.ok(trees.length <= URBAN_TREE_LIMITS.max);
  assert.equal(JSON.stringify(city.map), before);
  assert.deepEqual([...new Set(trees.map(tree => tree.species))].sort(), [...URBAN_TREE_SPECIES].sort());
  for (const tree of trees) {
    assert.ok(tree.scale >= .88 && tree.scale <= 1.2);
    assert.ok(tree.rotation >= 0 && tree.rotation < Math.PI * 2);
    assert.ok(Number.isInteger(tree.seed));
    assert.equal(tree.y, city.getMovementGroundHeight(tree.x, tree.z, 0));
    assert.deepEqual(Object.keys(tree).sort(), ['x', 'y', 'z', 'scale', 'seed', 'species', 'rotation'].sort());
  }
});

test('semillas, especies y jitter no dependen de Math.random ni de creaciones de objetos Three', t => {
  const { options, plan } = fixture();
  t.mock.method(Math, 'random', () => .975);
  for (let i = 0; i < 50; i++) new THREE.Group();
  assert.deepEqual(planUrbanTrees(options), plan);
  t.mock.method(Math, 'random', () => { throw new Error('el plan no debe consumir azar global'); });
  assert.deepEqual(planUrbanTrees(options), plan);
});

test('troncos conservan margen de césped y separación, sin árboles sobre agua ni cerca del viaducto', () => {
  const { city, plan } = fixture();
  for (const tree of plan) {
    for (const dx of [-.8, 0, .8]) for (const dz of [-.8, 0, .8]) {
      assert.equal(city.map[Math.round((tree.z + dz) / 2)]?.[Math.round((tree.x + dx) / 2)], 'grass');
    }
    assert.equal(city.getWaterInfo(tree.x, tree.z), null);
    assert.ok(Math.hypot(tree.x - SHELTER_LOCATION.x, tree.z - SHELTER_LOCATION.z) >= 7);
    for (let i = 0; i < 32; i++) {
      const angle = i / 32 * Math.PI * 2, x = tree.x + Math.cos(angle) * 3.1, z = tree.z + Math.sin(angle) * 3.1;
      assert.equal(onLakeBridge(x, z), false, 'la copa no invade el tablero del lago');
      assert.equal(viaductSurface(x, z), null, 'la copa no invade el viaducto');
    }
  }
  for (let i = 0; i < plan.length; i++) for (let j = i + 1; j < plan.length; j++) {
    assert.ok(Math.hypot(plan[i].x - plan[j].x, plan[i].z - plan[j].z) >= URBAN_TREE_LIMITS.spacing);
  }
});

test('el presupuesto se reparte entre parques y lago, sin poblar la franja verde de la troncal', () => {
  const { plan } = fixture();
  const original = tree => tree.x >= STREET_X.world(29) - 1 && tree.x <= STREET_X.world(38) + 1 &&
    tree.z >= STREET_Z.world(33) - 1 && tree.z <= STREET_Z.world(45) + 1;
  const extension = park => tree => tree.x >= park.x0 * 2 - 1 && tree.x <= park.x1 * 2 + 1 &&
    tree.z >= park.z0 * 2 - 1 && tree.z <= park.z1 * 2 + 1;
  const lake = tree => tree.z >= LAKE_PARK.z0 - 1 && tree.z <= LAKE_PARK.z1 + 1;
  const parks = [original, ...EXTENSION_PARKS.map(extension)];
  for (const contains of parks) assert.ok(plan.filter(contains).length >= 4, 'cada parque conserva varios árboles');
  assert.ok(plan.filter(lake).length >= 40);
  assert.ok(plan.every(tree => lake(tree) || parks.some(contains => contains(tree))));
});

test('las reservas reciben solo el margen del tronco y conservan sus propios radios', () => {
  const { options, plan } = fixture();
  const reserved = plan[0];
  let calls = 0;
  const remaining = planUrbanTrees({ ...options, isReserved(x, z, padding) {
    calls++;
    assert.equal(padding, .8);
    return options.isReserved(x, z, padding) || Math.hypot(x - reserved.x, z - reserved.z) < 1.8 + padding;
  } });
  assert.ok(calls > 0);
  assert.ok(remaining.every(tree => Math.hypot(tree.x - reserved.x, tree.z - reserved.z) >= 2.6));
  assert.deepEqual(planUrbanTrees({ ...options, isReserved: () => true }), []);
});

test('rechaza agua, pisos elevados, alturas inválidas y terrenos que no son césped', () => {
  const { options } = fixture();
  for (const height of [NaN, Infinity, -2, 7.82]) {
    assert.deepEqual(planUrbanTrees({ ...options, groundHeight: () => height }), []);
  }
  assert.deepEqual(planUrbanTrees({ ...options, getWaterInfo: () => ({ surfaceY: 0, depth: 1 }) }), []);
  for (const tile of ['road', 'plaza', 'sidewalk', 'water', 'busway', 'building', 'dirt']) {
    const map = options.map.map(row => row.map(() => tile));
    assert.deepEqual(planUrbanTrees({ ...options, map }), []);
  }
  const raised = planUrbanTrees({ ...options, groundHeight: () => .22 });
  assert.ok(raised.length > 0);
  assert.ok(raised.every(tree => tree.y === .22));
});

test('entradas vacías o tamaño de baldosa inválido producen un plan vacío', () => {
  assert.deepEqual(planUrbanTrees(), []);
  assert.deepEqual(planUrbanTrees({ map: [] }), []);
  for (const tileSize of [0, -2, NaN, Infinity]) assert.deepEqual(planUrbanTrees({ map: [['grass']], tileSize }), []);
});
