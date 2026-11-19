import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Group, Scene, Vector3 } from 'three';
import { rng } from '../src/world/bogota/textures.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';
import { StreetMinds } from '../src/entities/npc/mind.js';

mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1, createRealisticCharacter: async () => ({ group: new Group(), update() {}, dispose() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, real) => real, optionsFor: () => [{ id: 'test' }]
} });
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { ZonaCero } = await import('../src/world/districts/ZonaCero.js');
const { World } = await import('../src/world/World.js');

// El distrito y su red de peatones son los del juego. Se omite la geometría estática para poder
// construir varias instancias con azaros distintos en la misma prueba.
function buildResidents(scene) {
  this.scene = scene;
  this.map = this._layout();
  this.reserved = { shop: { x: STREET_X.world(34), z: STREET_Z.world(29) } };
  this._marketArrival = { walkers: this._spawnPeople(), checkAt: 0, nearSince: null };
  this.trafficPedestrians = [...this.npcs];
}

function releaseResidents() {
  this.minds?.dispose();
  for (const npc of this.npcs) npc.dispose();
}

const json = value => JSON.parse(JSON.stringify(value));
const appearance = npc => ({ arquetipo: npc.person.arquetipo, model: npc.look, role: npc.voiceRole });

test('una baja y una herida corresponden a las mismas personas al salir del distrito, guardar y recargar', async t => {
  t.mock.method(Bogota.prototype, 'build', buildResidents);
  t.mock.method(Bogota.prototype, 'dispose', releaseResidents);
  t.mock.method(ZonaCero.prototype, 'build', () => {});
  t.mock.method(ZonaCero.prototype, 'dispose', () => {});
  const random = t.mock.method(Math, 'random', rng(2761));
  const originalWindow = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { globalThis.window = originalWindow; });
  let deaths = 0;
  const world = new World(new Scene());
  window.addEventListener('npc-death', event => {
    deaths++;
    assert.equal(world.active.recordNpcDeath(event.detail.victim), true);
  });
  world.loadDistrict('Bogota');
  const city = world.active;
  await Promise.all(city.npcs.map(npc => npc.ready));
  const ids = city.npcs.map(npc => npc.stableId);
  assert.equal(new Set(ids).size, 80);
  const people = new Map(city.npcs.map(npc => [npc.stableId, appearance(npc)]));
  const victim = city.npcs.find(npc => npc.voiceRole === 'vecina_parque'), partner = victim.fijo.pareja;
  const hurt = city._marketArrival.walkers[0];
  hurt.say = () => {};
  const firstReward = hurt.takeHit({ damage: 17 });
  assert.ok(firstReward > 0);
  city.minds = new StreetMinds(city);
  city.minds.beginFrame(.016, victim.position, []);
  const survivorTemper = hurt.mind.temper;
  assert.ok(city.minds.minds.includes(victim.mind));
  victim.position.copy(hurt.home);
  const deathPoint = victim.position.clone();
  victim.root.rotation.y = 1.8;
  assert.ok(victim.takeHit({ damage: victim.health }) > 0);
  assert.equal(deaths, 1);
  assert.equal(partner.fijo.pareja, null);
  assert.equal(city.minds.minds.some(mind => mind.npc === victim), false);
  assert.equal(city.recordNpcDeath(victim), false);
  victim.emergencyReported = true;
  victim.emergencyAided = true;

  const saved = json(world.getPopulationSaveData());
  assert.equal(Object.keys(saved.people).length, 2);
  world.loadDistrict('ZonaCero');
  assert.deepEqual(json(world.getPopulationSaveData()), saved);
  random.mock.mockImplementation(rng(991723));
  world.loadDistrict('Bogota');
  const returning = world.active;
  await Promise.all(returning.npcs.map(npc => npc.ready));
  assert.deepEqual(returning.npcs.map(npc => npc.stableId), ids);
  for (const npc of returning.npcs) assert.deepEqual(appearance(npc), people.get(npc.stableId), npc.stableId);
  const corpse = returning.npcs.find(npc => npc.stableId === victim.stableId);
  assert.ok(corpse.isDead && corpse.deathSettled && corpse.looted);
  assert.ok(corpse.emergencyReported && corpse.emergencyAided);
  assert.deepEqual(corpse.position.toArray(), deathPoint.toArray());
  assert.equal(corpse.takeHit({ damage: 99 }), false);
  assert.equal(deaths, 1);
  const survivor = returning.npcs.find(npc => npc.stableId === hurt.stableId);
  assert.equal(survivor.health, hurt.maxHealth - 17);
  assert.equal(survivor.looted, true);
  survivor.say = () => {};
  assert.equal(survivor.takeHit({ damage: 1 }), 0, 'el guardado conserva el primer botín');

  const outsider = returning.npcs[0];
  assert.equal(city.recordNpcDeath(outsider), false);
  returning.update(.03, corpse.position, null);
  assert.ok(returning.npcs.includes(corpse));
  returning.update(2, corpse.position.clone().add(new Vector3(75, 0, 0)), null);
  assert.equal(corpse._disposed, true);
  assert.equal(returning.npcs.includes(corpse), false);
  assert.equal(returning.trafficPedestrians.includes(corpse), false);
  const reload = new World(new Scene());
  reload.loadDistrict('Bogota', undefined, json(world.getPopulationSaveData()));
  const fewer = reload.active;
  assert.deepEqual(fewer.npcs.map(npc => npc.stableId), ids.filter(id => id !== corpse.stableId));
  assert.equal(fewer.npcs.find(npc => npc.stableId === partner.stableId).fijo.pareja, null);
  assert.equal(fewer.npcs.some(npc => npc.isDead), false);
  fewer.minds = new StreetMinds(fewer);
  fewer.minds.beginFrame(.016, deathPoint, []);
  assert.deepEqual(fewer.npcs.find(npc => npc.stableId === hurt.stableId).mind.temper, survivorTemper);
  assert.equal(deaths, 1);
  releaseResidents.call(fewer);
  releaseResidents.call(returning);
});

test('una partida anterior al registro obtiene población viva y los domicilios de una partida nueva tienen otras identidades', t => {
  t.mock.method(Math, 'random', rng(19387));
  const original = new Bogota();
  const fresh = new Bogota();
  buildResidents.call(original, new Scene());
  buildResidents.call(fresh, new Scene());
  assert.equal(original.npcs.length, 80);
  assert.deepEqual(json(original.getPopulationSaveData()).people, {});
  const previous = new Set(original.npcs.map(npc => npc.stableId));
  assert.ok(fresh.npcs.every(npc => !npc.isDead && !previous.has(npc.stableId)));
  releaseResidents.call(original);
  releaseResidents.call(fresh);
});

test('reordenar los domicilios o registrar un recién llegado en el lugar de una baja no le transfiere esa vida', async () => {
  const origin = new Vector3(12, 0, 20), slot = (city, name) => city._resident(name, origin, { arquetipo: 'estudiante' });
  const first = new Bogota({ seed: 275 });
  first.scene = new Scene();
  const lost = slot(first, 'andén-norte'), survivor = slot(first, 'andén-sur');
  lost.takeHit({ damage: lost.health });
  first.recordNpcDeath(lost);
  const duplicate = slot(first, 'andén-sur');
  assert.equal(duplicate, survivor);
  assert.equal(first.npcs.length, 2);

  const next = new Bogota(json(first.getPopulationSaveData()));
  next.scene = new Scene();
  const newcomer = slot(next, 'andén-occidente'), returns = slot(next, 'andén-sur'), body = slot(next, 'andén-norte');
  await Promise.all([...first.npcs, ...next.npcs].map(npc => npc.ready));
  assert.equal(returns.stableId, survivor.stableId);
  assert.equal(body.stableId, lost.stableId);
  assert.notEqual(newcomer.stableId, lost.stableId);
  assert.deepEqual(next.npcs.map(npc => npc.isDead), [false, false, true]);
  assert.equal(next.recordNpcDeath(lost), false);
  releaseResidents.call(first);
  releaseResidents.call(next);
});
