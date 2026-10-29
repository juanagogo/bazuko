import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { GpsNavigation } from '../src/systems/GpsNavigation.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';

mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { Bogota } = await import('../src/world/districts/Bogota.js');

const city = new Bogota();
city.map = city._layout();
city.reserved = {
  shop: { x: STREET_X.world(34), z: STREET_Z.world(29) },
  sell: { x: STREET_X.world(14.5), z: STREET_Z.world(34) }
};
const gps = city.createGpsNavigation();
const START = { x: 112.98, z: 97.84 };

function assertWalkable(route) {
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .5);
    for (let s = 0; s <= steps; s++) {
      const x = a.x + (b.x - a.x) * s / steps, z = a.z + (b.z - a.z) * s / steps;
      assert.ok(gps.isRoutable(x, z), `tramo ${i} cruza un tile bloqueado en ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  }
}

test('el GPS une el cambuche con la recicladora sin atravesar edificios ni agua', () => {
  assert.equal(gps.setWaypoint({ ...city.reserved.sell, name: 'Recicladora' }, START, 0), true);
  assert.ok(gps.route.length >= 2);
  assertWalkable(gps.route);
  const end = gps.route.at(-1);
  assert.ok(Math.hypot(end.x - city.reserved.sell.x, end.z - city.reserved.sell.z) < 3);
  assert.ok(gps.routeLength >= Math.hypot(START.x - city.reserved.sell.x, START.z - city.reserved.sell.z));
});

test('el GPS llega a la isla del Portal del Centro por la extensión norte', () => {
  assert.equal(gps.setWaypoint({ x: 75, z: -30 }, START, 0), true);
  assertWalkable(gps.route);
  assert.ok(gps.route.some(p => p.z < -20));
});

test('el GPS rodea el lago y no usa el tablero elevado', () => {
  assert.equal(gps.isRoutable(75, 262), false);
  assert.equal(gps.setWaypoint({ x: 75, z: 300 }, { x: 75, z: 225 }, 0), true);
  assertWalkable(gps.route);
  for (const p of gps.route) assert.ok(city.getGroundHeight(p.x, p.z) < 1.2);
});

test('el GPS prefiere andenes y cruces antes que caminar por la calzada', () => {
  // Fila 0: calzada; fila 1: andén. Inicio y destino quedan sobre la calzada.
  const nav = new GpsNavigation({ width: 8, zMin: 0, zMax: 1, tileSize: 2,
    cost: (x, z) => z === 1 ? 1 : 8 });
  assert.equal(nav.setWaypoint({ x: 14, z: 0 }, { x: 0, z: 0 }, 0), true);
  const inner = nav.route.slice(1, -1);
  assert.ok(inner.length >= 2);
  for (const p of inner) assert.equal(p.z, 2, `se salió del andén en x ${p.x}`);
});

test('el destino se recalcula al desviarse y se borra al llegar', () => {
  const nav = new GpsNavigation({ width: 30, zMin: 0, zMax: 30, tileSize: 2, cost: () => 1 });
  assert.equal(nav.setWaypoint({ x: 40, z: 0, name: 'Prueba' }, { x: 0, z: 0 }, 0), true);
  assert.equal(nav.update({ x: 10, z: 0 }, 100), null);
  assert.equal(nav.update({ x: 10, z: 30 }, 500), null, 'respeta el intervalo entre recálculos');
  assert.equal(nav.update({ x: 10, z: 30 }, 1200), 'replanned');
  assert.ok(Math.abs(nav.route[0].z - 30) <= 2);
  assert.ok(nav.remainingDistance({ x: 10, z: 30 }) > 30);
  assert.equal(nav.update({ x: 38, z: 1 }, 1300), 'arrived');
  assert.equal(nav.waypoint, null);
  assert.equal(nav.lastArrival.name, 'Prueba');
});

test('el destino se serializa para el guardado', () => {
  const nav = new GpsNavigation({ width: 10, zMin: 0, zMax: 10, tileSize: 2, cost: () => 1 });
  assert.equal(nav.serialize(), null);
  nav.setWaypoint({ x: 6, z: 8, name: 'Tienda', icon: '🏪' }, { x: 0, z: 0 }, 0);
  assert.deepEqual(nav.serialize(), { x: 6, z: 8, name: 'Tienda', icon: '🏪' });
});
