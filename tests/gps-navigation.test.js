import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { GpsNavigation } from '../src/systems/GpsNavigation.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { Shop, SHOP_NAME } from '../src/entities/Shop.js';
import { SellPoint, RECYCLER_NAME } from '../src/entities/SellPoint.js';
import { ComedorComunitario, COMEDOR_NAME } from '../src/entities/ComedorComunitario.js';
import { INTERACT_RANGE, PLAYER_RADIUS } from '../src/utils/constants.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';

mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { cityLandmarks } = await import('../src/world/bogota/CityMapRaster.js');
const { buildMetroBogota } = await import('../src/world/bogota/MetroBogota.js');
const { buildColpatriaViaduct } = await import('../src/world/bogota/ColpatriaViaduct.js');
const { pedestrianCrossings } = await import('../src/world/bogota/StreetCrossings.js');

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

test('el GPS llega al mostrador de La Esquinita desde el lado que permite comprar', () => {
  const nav = city.createGpsNavigation();
  const { x, z } = city.reserved.shop;
  const shop = new Shop(new THREE.Scene(), new THREE.Vector3(x, 0, z));
  const waypoint = { name: SHOP_NAME, icon: '🏪', ...shop.gpsWaypoint };
  const { access } = waypoint;
  assert.equal(nav.isRoutable(waypoint.x, waypoint.z), false, 'el mostrador comparte tile con la caseta');
  assert.ok(nav.isRoutable(access.x, access.z));
  assert.ok(nav.setWaypoint(waypoint, START, 0));
  assert.deepEqual(nav.route.slice(-2), [access, { x: waypoint.x, z: waypoint.z }]);
  assert.equal(nav.update({ x, z: 70 }, 100), null);
  assert.equal(nav.update(access, 200), null);
  const point = new THREE.Vector3(waypoint.x, .12, waypoint.z);
  assert.ok(point.distanceTo(shop.position) < INTERACT_RANGE);
  const collisions = new CollisionSystem(), before = new THREE.Vector3(access.x, 0, access.z);
  collisions.add(shop.group, new THREE.Vector3(2.4, 2, 1.5));
  assert.equal(collisions.resolveMove(before, point.clone().sub(before), PLAYER_RADIUS).z, point.z);
  assert.deepEqual(nav.serialize(), { name: SHOP_NAME, icon: '🏪', x: point.x, z: point.z });
  assert.equal(nav.update(point, 300), 'arrived');
  shop.dispose();
});

test('El Progreso anuncia la llegada dentro del alcance de la báscula', () => {
  const nav = city.createGpsNavigation();
  const { x, z } = city.reserved.sell;
  const sellPoint = new SellPoint(new THREE.Scene(), new THREE.Vector3(x, 0, z));
  const waypoint = { name: RECYCLER_NAME, icon: '♻️', ...sellPoint.gpsWaypoint };
  assert.ok(nav.setWaypoint(waypoint, START, 0));
  assert.equal(nav.update({ x: 43.37, z: 89.60 }, 100), null, 'todavía está cerca de la bicicleta');
  const point = new THREE.Vector3(x + 1.6, .12, z - .15);
  assert.ok(point.distanceTo(sellPoint.position) < INTERACT_RANGE);
  assert.deepEqual(nav.serialize(), { name: RECYCLER_NAME, icon: '♻️', x, z });
  assert.equal(nav.update(point, 200), 'arrived');
  sellPoint.dispose();
});

test('el aviso del Comedor Comunitario espera a que se pueda pedir el almuerzo', () => {
  const nav = city.createGpsNavigation();
  const comedor = new ComedorComunitario(new THREE.Scene(), new THREE.Vector3(100, .12, 90));
  let interactionTarget = null;
  const waypoint = { name: COMEDOR_NAME, icon: '🍲', ...comedor.gpsWaypoint,
    acceptsArrival: position => comedor.acceptsGpsArrival(position, interactionTarget) };
  assert.ok(nav.setWaypoint(waypoint, START, 0));
  assert.equal(nav.update({ x: 102.65, z: 93.03 }, 100), null);
  assert.equal(nav.update(waypoint.access, 200), null);
  for (const x of [99.35, 100.65]) {
    interactionTarget = null;
    assert.ok(nav.setWaypoint(waypoint, START, 0));
    const point = new THREE.Vector3(x, .06, 91.6);
    assert.ok(point.distanceTo(comedor.position) < INTERACT_RANGE);
    assert.equal(nav.update(point, 300), null);
    interactionTarget = comedor;
    assert.equal(nav.update(point, 400), 'arrived');
  }
  comedor.dispose();
});

test('el GPS cruza la Caracas por las cebras y evita las pilas bajo el viaducto', () => {
  const district = new Bogota();
  district.map = city.map;
  district.reserved = city.reserved;
  const collisions = new CollisionSystem();
  const metro = buildMetroBogota();
  const viaduct = buildColpatriaViaduct(district.map);
  collisions.colliders.push(...metro.userData.colliders, ...viaduct.userData.colliders.map(box => ({ box, layered: true })));
  const comedor = new THREE.Object3D();
  comedor.position.set(100, .12, 90);
  collisions.add(comedor, new THREE.Vector3(3.2, 2.2, 2.2));
  district._navigationCollisions = collisions;
  const crossings = pedestrianCrossings(district.map);
  for (const from of [START, { x: 98, z: 88.02 }]) {
    const nav = district.createGpsNavigation();
    assert.ok(nav.setWaypoint(city.reserved.sell, from, 0));
    const position = new THREE.Vector3(from.x, .12, from.z), direction = new THREE.Vector3();
    const route = nav.remainingRoute(from);
    const crossesAt = x => {
      const i = route.findIndex((point, j) => j > 0 && point.x < x && route[j - 1].x >= x);
      assert.ok(i > 0);
      const a = route[i - 1], b = route[i];
      return a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x);
    };
    for (const x of [63, 87]) {
      const z = crossesAt(x);
      assert.ok(crossings.some(crossing => crossing.dx && x >= crossing.x && x <= crossing.x + crossing.length
        && Math.abs(z - crossing.z) <= crossing.width / 2), `cruza fuera de la cebra en ${x},${z}`);
    }
    for (const end of route.slice(1)) {
      const steps = Math.ceil(Math.hypot(end.x - position.x, end.z - position.z) / .15);
      if (!steps) continue;
      direction.set((end.x - position.x) / steps, 0, (end.z - position.z) / steps);
      for (let step = 0; step < steps; step++) {
        const next = collisions.resolveMove(position, direction, PLAYER_RADIUS);
        assert.ok(next.distanceTo(position.add(direction)) < 1e-6, `la ruta toca un sólido en ${position.x},${position.z}`);
      }
    }
  }
  const station = { x: 75, z: 115 };
  assert.deepEqual(district.createGpsNavigation().findPath(START, station), gps.findPath(START, station),
    'el ajuste local conserva el acercamiento a la estación Calle 72');
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

test('marcar Colpatria lleva a una acera y completa el destino al terminar la ruta', () => {
  const nav = city.createGpsNavigation();
  const building = { x: 81, z: 168, name: 'Colpatria', icon: '🏢' };
  assert.equal(nav.isRoutable(building.x, building.z), false);
  assert.equal(nav.setWaypoint(building, START, 0), true);
  const end = nav.route.at(-1);
  assert.ok(nav.isRoutable(end.x, end.z));
  assert.deepEqual(nav.waypoint, { ...building, ...end });
  assert.deepEqual(building, { x: 81, z: 168, name: 'Colpatria', icon: '🏢' }, 'no mueve el hito original');
  assertWalkable(nav.route);
  for (const point of [...nav.route]) nav.update(point, 100);
  assert.equal(nav.waypoint, null);
  assert.equal(nav.remainingDistance(end), 0);
  assert.equal(nav.lastArrival.name, 'Colpatria');
});

test('el destino ajustado conserva su posición accesible al guardar y reanudar', () => {
  const nav = city.createGpsNavigation();
  nav.setWaypoint({ x: 81, z: 168, name: 'Colpatria', icon: '🏢' }, START, 0);
  const saved = JSON.parse(JSON.stringify(nav.serialize()));
  const restored = city.createGpsNavigation();
  assert.equal(restored.setWaypoint(saved, START, 0), true);
  assert.deepEqual(restored.serialize(), saved);
  assert.deepEqual(restored.route.at(-1), { x: saved.x, z: saved.z });
  assert.equal(restored.update(restored.route.at(-1), 100), 'arrived');
  assert.equal(restored.waypoint, null);
});

test('un destino transitable conserva la coordenada marcada y uno sin acceso no inventa una ruta', () => {
  const nav = new GpsNavigation({ width: 20, zMin: 0, zMax: 20, cost: () => 1 });
  const marked = { x: 12.4, z: 16.7, name: 'Calle' };
  assert.equal(nav.setWaypoint(marked, { x: 0, z: 0 }, 0), true);
  assert.equal(nav.waypoint.x, marked.x);
  assert.equal(nav.waypoint.z, marked.z);
  assert.deepEqual(nav.route.at(-1), { x: marked.x, z: marked.z });

  const blocked = new GpsNavigation({ width: 20, zMin: 0, zMax: 20, cost: () => Infinity });
  assert.equal(blocked.setWaypoint(marked, { x: 0, z: 0 }, 0), false);
  assert.deepEqual(blocked.route, []);
});

test('routeLengthTo mide lo mismo que la ruta marcada', () => {
  const places = [city.reserved.sell, city.reserved.shop, { x: 75, z: -30 }, { x: 81, z: 168 }, { x: 12.4, z: 80.3 }];
  for (const place of places) {
    const nav = city.createGpsNavigation();
    const meters = nav.routeLengthTo(START, place);
    assert.equal(nav.setWaypoint({ ...place, name: 'Prueba' }, START, 0), true);
    assert.ok(Math.abs(meters - nav.remainingDistance(START)) < 1e-6, `${place.x}, ${place.z}: ${meters} y ${nav.remainingDistance(START)}`);
  }
});

test('routeLengthTo no toca el destino activo', () => {
  const nav = city.createGpsNavigation();
  nav.setWaypoint({ ...city.reserved.sell, name: 'Activo', icon: '♻️' }, START, 0);
  nav.update({ x: START.x - 8, z: START.z }, 100);
  const state = () => structuredClone({ waypoint: nav.waypoint, route: nav.route, length: nav.routeLength, suffix: nav._suffix, progress: nav._progress });
  const before = state();
  for (const place of [city.reserved.shop, { x: 75, z: -30 }, { x: 81, z: 168 }, { x: 75, z: 262 }]) nav.routeLengthTo(START, place);
  assert.deepEqual(state(), before);
});

test('a pie el orden cambia: desde la orilla del lago el mercado queda antes que Colpatria', () => {
  const from = { x: 75, z: 226 };
  const place = (name) => cityLandmarks().find(l => l.name === name);
  const straight = (to) => Math.hypot(to.x - from.x, to.z - from.z);
  const d69 = place('Mercado Doña Inés'), colpatria = place('Torre Colpatria');
  assert.ok(straight(colpatria) < straight(d69));
  assert.ok(gps.routeLengthTo(from, d69) < gps.routeLengthTo(from, colpatria));
});

test('routeLengthTo devuelve null si no hay camino y mide en recta dentro de un mismo tile', () => {
  assert.equal(gps.routeLengthTo({ x: 75, z: 262 }, city.reserved.shop), null, 'nadando lejos de la orilla');
  const blocked = new GpsNavigation({ width: 20, zMin: 0, zMax: 20, cost: () => Infinity });
  assert.equal(blocked.routeLengthTo({ x: 0, z: 0 }, { x: 6, z: 8 }), null);
  const open = new GpsNavigation({ width: 20, zMin: 0, zMax: 20, tileSize: 2, cost: () => 1 });
  assert.ok(Math.abs(open.routeLengthTo({ x: 6.2, z: 8 }, { x: 6.6, z: 8.3 }) - .5) < 1e-9);
  assert.equal(open.routeLengthTo({ x: 6, z: 8 }, { x: 6, z: 8 }), 0);
});

test('routeLengthTo desde la acera de un edificio mide hasta esa acera, no hasta su interior', () => {
  for (const name of ['Torre Colpatria', 'Mercado Doña Inés']) {
    const place = cityLandmarks().find(l => l.name === name);
    const door = gps._point(gps._nearestOpen(place.x, place.z));
    const from = { x: door.x + .3, z: door.z };
    const nav = city.createGpsNavigation();
    const meters = nav.routeLengthTo(from, place);
    assert.equal(nav.setWaypoint({ ...place }, from, 0), true);
    assert.ok(Math.abs(meters - nav.remainingDistance(from)) < 1e-6, `${name}: ${meters} y ${nav.remainingDistance(from)}`);
    assert.ok(meters < 1, `${name}: ${meters}`);
  }
});

test('el GPS sigue el paseo del lago y puede terminar en un punto preciso del césped', () => {
  const entrance = { x: 250, z: 262 }, lawn = { x: 145.1, z: 269.3 };
  assert.ok(gps.costAt(180, 262) < gps.costAt(lawn.x, lawn.z));
  assert.ok(gps.setWaypoint(lawn, entrance, 0));
  assert.ok(gps.route.some(p => p.x < 165 && p.z === entrance.z), 'sigue por el paseo hasta cerca del destino');
  assert.deepEqual(gps.route.at(-1), lawn);
});
