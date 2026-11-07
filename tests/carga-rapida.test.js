// La carga más corta: cargar con el creador abierto, el carril del bus guardado y la navegación del perro
// con el índice de colisiones. Todo debe dar exactamente lo mismo que antes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CreatorGate } from '../src/core/Startup.js';
import { BUS_DETOUR, BUS_AXIS_MIN_X, BUS_AXIS_MAX_X, busPathX, bridgeCenter, bridgeNormal } from '../src/world/bogota/Colpatria.js';
import { LAKE_BRIDGE, onLakeBridge } from '../src/world/bogota/LakePark.js';
import { CompanionNavigation } from '../src/systems/CompanionNavigation.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

test('con el creador abierto las tareas pasan de a una; abierto, todas a la vez', async () => {
  const gate = new CreatorGate();
  const first = deferred(), second = deferred();
  const started = [];
  const a = gate.run(() => { started.push('a'); return first.promise; });
  const b = gate.run(() => { started.push('b'); return second.promise; });
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(started, ['a'], 'la segunda espera a que termine la primera');
  first.resolve();
  await a;
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(started, ['a', 'b']);
  gate.open();
  const c = gate.run(() => { started.push('c'); return 'c'; });
  assert.deepEqual(started, ['a', 'b', 'c'], 'abierta corre en el acto, aunque haya otra en curso');
  assert.equal(await c, 'c');
  second.resolve();
  await b;
});

test('una tarea que falla con el creador abierto no traba a las siguientes', async () => {
  const gate = new CreatorGate();
  const failed = gate.run(() => Promise.reject(new Error('sin red')));
  const next = gate.run(() => 'sigue');
  await assert.rejects(failed, /sin red/);
  assert.equal(await next, 'sigue');
});

// La búsqueda de antes, copiada tal cual: el carril guardado debe dar el mismo número.
function searchedPathX(z, laneX = 78.5) {
  if (z <= BUS_DETOUR.z0 - 5 || z >= BUS_DETOUR.z1 + 5) return laneX;
  const offset = laneX - 75;
  let lo = z - 10, hi = z + 10;
  for (let i = 0; i < 28; i++) {
    const t = (lo + hi) / 2;
    if (t + bridgeNormal(t).z * offset < z) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  return bridgeCenter(t) + bridgeNormal(t).x * offset;
}

test('el carril del bus guardado da el mismo número y no sale de su franja', () => {
  for (let z = BUS_DETOUR.z0 - 20; z <= BUS_DETOUR.z1 + 20; z += .37) {
    for (const lane of [78.5, 71.5, LAKE_BRIDGE.x0, LAKE_BRIDGE.x1]) {
      const expected = searchedPathX(z, lane);
      assert.equal(busPathX(z, lane), expected);
      assert.equal(busPathX(z, lane), expected, 'también la segunda vez, desde lo guardado');
    }
    const x = busPathX(z);
    assert.ok(x >= BUS_AXIS_MIN_X && x <= BUS_AXIS_MAX_X + 3.5, `carril en ${x} para Z ${z}`);
  }
});

test('el puente del lago responde igual con el descarte por franja', () => {
  const reference = (x, z) => z >= LAKE_BRIDGE.z0 && z <= LAKE_BRIDGE.z1
    && x >= searchedPathX(z, LAKE_BRIDGE.x0) && x <= searchedPathX(z, LAKE_BRIDGE.x1);
  for (let z = LAKE_BRIDGE.z0 - 5; z <= LAKE_BRIDGE.z1 + 5; z += .9) {
    for (let x = 40; x <= 160; x += .7) assert.equal(onLakeBridge(x, z), reference(x, z), `x ${x}, z ${z}`);
  }
});

test('la navegación del perro con el índice ve las mismas paredes que revisando todas las cajas', () => {
  const collisions = new CollisionSystem();
  const box = (x0, z0, x1, z1) => collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 3, z1)) });
  box(10, 10, 14, 30); box(20, 4, 60, 6); box(31.9, 40, 32.1, 70); box(-5, -5, 0, 100);
  const district = { map: Array.from({ length: 50 }, () => Array(50).fill('road')), isWalkableAt: () => true };
  const indexed = new CompanionNavigation(district, collisions);
  const everyBox = new CompanionNavigation(district, { colliders: collisions.colliders });
  assert.deepEqual(indexed.walkable, everyBox.walkable);
  for (let z = -2; z < 80; z += .13) for (let x = -2; x < 70; x += .17) {
    assert.equal(indexed.isOpen(x, z), everyBox.isOpen(x, z), `x ${x}, z ${z}`);
  }
});
