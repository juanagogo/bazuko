import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Bogota, SHELTER_LOCATION } from '../src/world/districts/Bogota.js';
import { describeCity, streetNameAt, streetBands } from '../src/ui/CityMap.js';
import { RouteFinder, routeProgress } from '../src/systems/RouteFinder.js';
import { inTerminal } from '../src/world/bogota/TransitTerminal.js';
import { Minimap } from '../src/ui/Minimap.js';

const city = new Bogota();
city.map = city._layout();
const WALKABLE = new Set(['road', 'busway', 'sidewalk', 'dirt', 'grass', 'plaza', 'floor']);
city.isWalkableAt = (x, z) => inTerminal(x, z) || WALKABLE.has(city.map[Math.round(z / 2)]?.[Math.round(x / 2)]);
const description = describeCity(city);
const finder = new RouteFinder(description, city.isWalkableAt);
const start = { x: SHELTER_LOCATION.x, z: SHELTER_LOCATION.z + 3.2 };

/** Comprueba cada medio metro que la ruta no atraviese manzanas ni agua. */
function assertWalkable(route) {
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .5);
    for (let s = 0; s <= steps; s++) {
      const x = a.x + (b.x - a.x) * s / steps, z = a.z + (b.z - a.z) * s / steps;
      assert.ok(finder.isWalkable(x, z), `tramo ${i} pasa por ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  }
}

test('el mapa incluye la grilla de la ciudad y la estación del norte', () => {
  assert.equal(description.width, 120);
  assert.equal(description.height, 161);
  assert.ok(description.bounds.z0 <= -74);
  assert.equal(description.typeAt(Math.round(75 / 2), Math.round(-30 / 2)), 'terminal');
  assert.equal(description.typeAt(-1, 10), null);
});

test('la ruta a pie llega a parques, al Portal y al lago sin cruzar manzanas ni agua', () => {
  for (const goal of [{ x: 195, z: 55 }, { x: 75, z: -30 }, { x: 205, z: 290 }, { x: 30, z: 60 }]) {
    const route = finder.find(start, goal);
    assert.ok(route?.length > 1, JSON.stringify(goal));
    assert.deepEqual(route[0], start);
    assert.deepEqual(route.at(-1), finder.isWalkable(goal.x, goal.z) ? goal : finder.nearestWalkable(goal.x, goal.z));
    assertWalkable(route);
    // No es mucho más larga que la distancia recta: sigue calles y andenes.
    const { remaining } = routeProgress(route, start.x, start.z);
    assert.ok(remaining < Math.hypot(goal.x - start.x, goal.z - start.z) * 1.8, `${remaining}`);
  }
});

test('un destino sobre el agua o un edificio se ajusta al punto transitable más cercano', () => {
  const water = { x: 60, z: 250 };
  assert.equal(finder.isWalkable(water.x, water.z), false);
  const near = finder.nearestWalkable(water.x, water.z);
  assert.ok(near && finder.isWalkable(near.x, near.z));
  const route = finder.find(start, water);
  assert.ok(route);
  assertWalkable(route);
});

test('el avance por la ruta mide lo que falta y cuánto se desvía el jugador', () => {
  const route = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  assert.deepEqual(routeProgress(route, 0, 0), { segment: 0, offRoute: 0, remaining: 20 });
  const halfway = routeProgress(route, 10, 5);
  assert.equal(halfway.segment, 1);
  assert.equal(halfway.remaining, 5);
  assert.equal(routeProgress(route, 5, 7).offRoute, 5);
});

test('el nombre de la calle del jugador sale de las mismas bandas del trazado', () => {
  const bands = streetBands();
  const calle = bands.find(b => b.axis === 'z');
  const carrera = bands.find(b => b.axis === 'x' && b.name !== 'Avenida Caracas');
  const midZ = (calle.from + calle.to) / 2, midX = (carrera.from + carrera.to) / 2;
  assert.equal(streetNameAt(5, midZ, bands), calle.name);
  assert.equal(streetNameAt(midX, midZ, bands), `${calle.name} con ${carrera.name}`);
  assert.equal(streetNameAt(SHELTER_LOCATION.x, SHELTER_LOCATION.z, bands), null);
});

beforeEach(() => {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.window = new EventTarget();
  const info = { textContent: '' };
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
  globalThis.document = {
    getElementById(id) {
      if (id === 'minimap-container') return { classList: { toggle() {} } };
      if (id === 'minimap-canvas') return { width: 130, height: 130, getContext: () => ctx, addEventListener() {} };
      if (id === 'minimap-info') return info;
      return null;
    }
  };
});

test('con destino marcado el radar indica la distancia de la ruta en lugar del punto más cercano', () => {
  const map = new Minimap();
  const pois = [{ name: 'Cambuche', icon: '⛺', x: 2, z: 2 }];
  map.update({ x: 0, z: 0 }, 0, pois, 1000, { waypoint: { x: 0, z: 50 }, route: [{ x: 0, z: 0 }, { x: 0, z: 50 }], remaining: 63 });
  assert.match(map.infoEl.textContent, /Destino: 63m/);
  map.update({ x: 0, z: 0 }, 0, pois, 1500, { waypoint: { x: 0, z: 50, label: 'Recicladora' }, remaining: 63 });
  assert.match(map.infoEl.textContent, /Recicladora: 63m/);
  map.update({ x: 0, z: 0 }, 0, pois, 2000);
  assert.match(map.infoEl.textContent, /Cambuche/);
});
