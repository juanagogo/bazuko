import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';
const point = (x, z) => [STREET_X.world(x / 2), STREET_Z.world(z / 2)];
import { rng } from '../src/world/bogota/textures.js';

// La navegación y los NPC son reales; solo se sustituye la carga de modelos GLB.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { Npc } = await import('../src/entities/Npc.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');

const map3x5 = [
  ['sidewalk', 'sidewalk', 'sidewalk', 'wall', 'sidewalk'],
  ['sidewalk', 'building', 'sidewalk', 'wall', 'sidewalk'],
  ['sidewalk', 'sidewalk', 'sidewalk', 'wall', 'sidewalk']
];

function district() {
  const city = new Bogota();
  city.map = city._layout();
  city.reserved = { shop: { x: STREET_X.world(34), z: STREET_Z.world(29) } };
  city.scene = new THREE.Scene();
  return city;
}

test('las rutas rodean edificios sin diagonales y no atraviesan componentes aislados', () => {
  const nav = new PedestrianNavigation(map3x5, 2);
  for (let seed = 1; seed <= 30; seed++) {
    const route = nav.createRoute(new THREE.Vector3(), rng(seed));
    assert.ok(route.length > 1);
    for (let i = 0; i < route.length; i++) {
      const point = route[i];
      assert.ok(point.x <= 4);
      assert.ok(nav.isWalkableAt(point.x, point.z));
      if (i) assert.equal(Math.abs(point.x - route[i - 1].x) + Math.abs(point.z - route[i - 1].z), 2);
    }
  }
  const isolated = new PedestrianNavigation([['sidewalk']], 2);
  assert.deepEqual(isolated.createRoute(new THREE.Vector3()), []);
  assert.deepEqual(nav.createRoute(new THREE.Vector3(-100, 0, 0)), []);
});

test('createRouteTo llega a la meta por andenes y no cruza componentes aislados', () => {
  const nav = new PedestrianNavigation(map3x5, 2);
  const route = nav.createRouteTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 4));
  assert.deepEqual([route.at(-1).x, route.at(-1).z], [4, 4]);
  for (const p of route) assert.ok(nav.isWalkableAt(p.x, p.z));
  assert.deepEqual(nav.createRouteTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 0, 0)), []);
  assert.deepEqual(nav.createRouteTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 4), 1), []);
});

test('en Bogotá los recorridos usan andenes y cruces, evitan tienda y estación', () => {
  const city = district();
  const nav = city._createPedestrianNavigation();
  assert.equal(nav.isWalkableAt(...point(68, 58)), false);
  assert.equal(nav.isWalkableAt(...point(48, 42)), false);
  assert.equal(nav.isWalkableAt(...point(12, 40)), false); // Carril fuera de un cruce.
  assert.equal(nav.isWalkableAt(...point(12, 22)), true); // Cruce de Carrera 15.
  let crossingCount = 0;
  for (const start of [[36, 22], [42, 32], [56, 38], [16, 54], [68, 86]]) {
    for (let seed = 1; seed <= 20; seed++) {
      const route = nav.createRoute(nav.nearestPoint(...point(...start)), rng(seed));
      assert.ok(route.length > 1);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i];
        assert.equal(Math.abs(a.x - b.x) + Math.abs(a.z - b.z), 2);
        for (let fraction = 0; fraction <= 1; fraction += 0.1) {
          assert.ok(nav.isWalkableAt(a.x + (b.x - a.x) * fraction, a.z + (b.z - a.z) * fraction));
        }
        if (['road', 'busway'].includes(city.map[b.z / 2][b.x / 2])) crossingCount++;
      }
      const last = route.at(-1);
      assert.ok(!['road', 'busway'].includes(city.map[last.z / 2][last.x / 2]));
    }
  }
  assert.ok(crossingCount > 0);
});

test('los peatones avanzan fuera de cámara, siguen nuevas rutas y ajustan su altura', async () => {
  const nav = new PedestrianNavigation([Array(14).fill('sidewalk')], 2, {
    groundHeight: (x) => x < 8 ? 0.12 : 0
  });
  let routes = 0;
  const original = nav.createRoute.bind(nav);
  nav.createRoute = (position) => { routes++; return original(position, () => 0.9); };
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0.12, 0), {
    navigation: nav, groundHeight: nav.groundHeight,
    isWalkable: (x, z) => nav.isWalkableAt(x, z), speed: 1.1, look: {}
  });
  await npc.ready;
  let maximumX = 0;
  for (let frame = 0; frame < 2400; frame++) {
    const before = npc.position.clone();
    npc.update(0.05, { frustum: { intersectsSphere: () => false } });
    assert.ok(Math.hypot(npc.position.x - before.x, npc.position.z - before.z) <= 1.1 * 0.05 + 1e-8);
    assert.equal(npc.position.y, nav.groundHeight(npc.position.x));
    assert.ok(nav.isWalkableAt(npc.position.x, npc.position.z));
    maximumX = Math.max(maximumX, npc.position.x);
  }
  assert.ok(maximumX > 16);
  assert.ok(routes >= 3);
  assert.equal(npc.root.visible, false);
  npc.dispose();
});

test('la población incluye peatones junto al inicio y mantiene quietos a los vendedores', async () => {
  const city = district();
  city._spawnPeople();
  await Promise.all(city.npcs.map(npc => npc.ready));
  assert.equal(city.npcs.length, 66);
  assert.ok(city.npcs.some(npc => npc.position.distanceTo(new THREE.Vector3(STREET_X.world(20), 0, STREET_Z.world(11))) < 5));
  const starts = city.npcs.map(npc => npc.position.clone());
  for (let frame = 0; frame < 100; frame++) for (const npc of city.npcs) npc.update(0.05);
  for (let i = 0; i < city.npcs.length; i++) {
    assert.ok(city.npcs[i].position.distanceTo(starts[i]) > 0.5);
    assert.ok(city.pedestrianNavigation.isWalkableAt(city.npcs[i].position.x, city.npcs[i].position.z));
  }
  const vendor = new Npc(city.scene, new THREE.Vector3(5, 0.12, 5), { look: {}, isWalkable: () => false });
  await vendor.ready;
  for (let frame = 0; frame < 100; frame++) vendor.update(0.1);
  assert.deepEqual(vendor.position.toArray(), [5, 0.12, 5]);
  vendor.dispose();
  city.dispose(city.scene);
});
