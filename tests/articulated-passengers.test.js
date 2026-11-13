// Pruebas de los pasajeros reales del bus articulado: cuelgan del bus, solo si la cámara está cerca, y vuelven al grupo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { PASSENGER_SLOTS } from '../src/world/bogota/BusBody.js';
import { ArticulatedPassengers, FILL, NEAR, OPS_PER_FRAME, articulatedSlots } from '../src/systems/ArticulatedPassengers.js';
import { fakePool } from './fakePool.js';

PASSENGER_SLOTS.length = 0;
for (let section = 0; section < 2; section++) {
  const seats = [];
  for (let z = 1; z < 8; z += .82) for (const x of [-1.05, -.6, 1.05]) seats.push([x, z + section * -11]);
  PASSENGER_SLOTS[section] = { seats, first: section ? -9.8 : 1.2, last: section ? -2.2 : 8.6, doors: [section ? -7 : 3, section ? -4 : 6] };
}

const fakeBus = (x, z) => { const group = new THREE.Group(); group.position.set(x, 0, z); return { group }; };
const camera = (x = 0, z = 0) => new THREE.Vector3(x, 2, z);
const run = (riders, buses, cam, hour = 7.5, frames = 40) => { for (let i = 0; i < frames; i++) riders.update(buses, cam, hour); };

test('los puestos del articulado: asientos primero y luego el pasillo, sin parar en las puertas, siempre iguales', () => {
  const slots = articulatedSlots();
  assert.ok(slots.length > 40);
  const firstStanding = slots.findIndex(s => s.kind === 'stand');
  assert.ok(slots.slice(0, firstStanding).every(s => s.kind === 'seat') && slots.slice(firstStanding).every(s => s.kind === 'stand'));
  assert.deepEqual(articulatedSlots().map(s => s.x), slots.map(s => s.x));
  assert.ok(slots.filter(s => s.kind === 'seat').every(s => s.stance === 'banca'));
  assert.ok(slots.filter(s => s.kind === 'stand').some(s => s.stance === 'agarrado'));
});

test('el bus cercano lleva gente real colgada de su grupo y se mueve con él', async () => {
  const pool = await fakePool(100), riders = new ArticulatedPassengers(pool), bus = fakeBus(5, 5);
  riders.update([bus], camera(), 7.5);
  assert.ok(pool.inUse > 0 && pool.inUse <= OPS_PER_FRAME, 'pocas por cuadro');
  run(riders, [bus], camera());
  assert.ok(pool.inUse > 10 && pool.inUse <= FILL[0]);
  assert.equal(bus.group.children.length, pool.inUse);
  assert.ok(bus.group.children.every(c => c.visible));
  const first = bus.group.children[0];
  bus.group.position.set(9, 0, 9);
  bus.group.updateMatrixWorld(true);
  assert.ok(first.getWorldPosition(new THREE.Vector3()).x > 7, 'va con el bus');
});

test('lejos de la cámara no se presta nadie, y al alejarse todos vuelven al grupo y a la escena', async () => {
  const pool = await fakePool(100), riders = new ArticulatedPassengers(pool), bus = fakeBus(NEAR + 10, 0);
  run(riders, [bus], camera());
  assert.equal(pool.inUse, 0);
  assert.equal(pool.figures.reduce((n, f) => n + f.character.updates, 0), 0);
  bus.group.position.set(5, 0, 5);
  run(riders, [bus], camera());
  assert.ok(pool.inUse > 10);
  bus.group.position.set(NEAR + 20, 0, 0);
  run(riders, [bus], camera(), 7.5, 20);
  assert.equal(pool.inUse, 0);
  assert.equal(bus.group.children.length, 0);
  assert.ok(pool.figures.every(f => !f.group.parent), 'fuera de la escena mientras están libres');
});

test('el bus más cercano va más lleno, y de noche casi vacío', async () => {
  const pool = await fakePool(100), riders = new ArticulatedPassengers(pool);
  const a = fakeBus(3, 3), b = fakeBus(20, 3);
  run(riders, [a, b], camera());
  assert.ok(riders._held.get(a).length > riders._held.get(b).length);
  const rush = riders.stats.people;
  run(riders, [a, b], camera(), 2);
  assert.ok(riders.stats.people < rush / 2, `${riders.stats.people} < ${rush}`);
});
