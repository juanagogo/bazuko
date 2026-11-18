import test from 'node:test';
import assert from 'node:assert/strict';
import { PedestrianCrowd, POOL_MAX, crowdTargets, parkFactor, streetFactor } from '../src/systems/PedestrianCrowd.js';

function seeded(seed = 5) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

function makeCrowd() {
  const streets = [], parks = [];
  for (let x = 0; x < 400; x += 4) { streets.push({ x, z: 0 }); streets.push({ x, z: 30 }); }
  for (let x = 100; x < 140; x += 4) for (let z = 60; z < 100; z += 4) parks.push({ x, z });
  const shown = new Set();
  const crowd = new PedestrianCrowd({
    streets, parks, random: seeded(),
    create: (x, z) => ({ position: { x, z } }),
    place: (npc, x, z) => { npc.position.x = x; npc.position.z = z; },
    show: npc => shown.add(npc), hide: npc => shown.delete(npc)
  });
  return { crowd, shown };
}

test('la gente de calle sube en las horas pico y baja de noche', () => {
  assert.ok(streetFactor(7.5) > streetFactor(12) && streetFactor(18.5) > streetFactor(12));
  assert.ok(streetFactor(12) > streetFactor(23));
  assert.ok(crowdTargets(7.5).street > crowdTargets(23).street * 4);
});

test('de noche los parques quedan casi vacíos y los andenes conservan gente', () => {
  assert.ok(parkFactor(13) > .9 && parkFactor(23) < .05);
  const night = crowdTargets(23);
  assert.ok(night.street > night.park * 5, `${night.street} contra ${night.park}`);
  assert.ok(crowdTargets(13).park > night.park * 10);
});

test('la burbuja se llena de una vez, reparte parque y andén y no pasa del tope', () => {
  const { crowd, shown } = makeCrowd();
  const center = { x: 120, z: 40 };
  for (let frame = 0; frame < 60; frame++) crowd.update(.05, 13, center, 95, null, center);
  assert.ok(shown.size > 100, `${shown.size} vivos`);
  assert.ok(crowd.count('park') > 0 && crowd.count('street') > crowd.count('park'));
  assert.ok(crowd.created <= POOL_MAX);
  for (const npc of shown) assert.ok(Math.hypot(npc.position.x - center.x, npc.position.z - center.z) <= 95);
});

test('tras un viaje la gente de atrás sale y la burbuja nueva se llena reutilizando a los mismos', () => {
  const { crowd, shown } = makeCrowd();
  crowd.update(.05, 8, { x: 60, z: 10 }, 95, null, { x: 60, z: 10 });
  for (let frame = 0; frame < 60; frame++) crowd.update(.05, 8, { x: 60, z: 10 }, 95);
  const made = crowd.created, before = new Set(shown);
  const far = { x: 340, z: 10 };
  for (let frame = 0; frame < 60; frame++) crowd.update(.05, 8, far, 95);
  assert.ok([...shown].every(npc => Math.hypot(npc.position.x - far.x, npc.position.z - far.z) <= 95 * 1.3 + 1));
  assert.ok(shown.size > 60, `${shown.size} vivos tras el viaje`);
  assert.ok([...shown].some(npc => before.has(npc)), 'reutiliza a los caminantes');
  assert.ok(crowd.created <= POOL_MAX && crowd.created >= made);
});

test('de madrugada la gente sobrante se retira', () => {
  const { crowd, shown } = makeCrowd();
  const center = { x: 120, z: 40 };
  for (let frame = 0; frame < 80; frame++) crowd.update(.05, 7.5, center, 95);
  const rush = shown.size;
  for (let frame = 0; frame < 400; frame++) crowd.update(.05, 23.5, center, 95);
  assert.ok(shown.size < rush / 2, `${rush} pasó a ${shown.size}`);
});
