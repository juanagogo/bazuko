import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { Box3, Group, Scene, Vector3 } from 'three';
import { WitnessSystem, WITNESS } from '../src/systems/WitnessSystem.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { MeleeCombat } from '../src/systems/MeleeCombat.js';
import { StreetMinds, seededRandom } from '../src/entities/npc/mind.js';
import { TEMPERS } from '../src/entities/npc/temperament.js';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';

mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => ({ group: new Group(), update() {}, snapPose() {}, dispose() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08,
} });
const { Npc } = await import('../src/entities/Npc.js');

beforeEach(t => {
  globalThis.window = new EventTarget();
  globalThis.document = { getElementById() { return null; }, createElement() { return { style: {}, remove() {} }; }, body: { appendChild() {} } };
  t.mock.method(Math, 'random', seededRandom(4321));
});

const point = (x, z, y = 0) => new Vector3(x, y, z);
const forward = (npc, at) => { npc.root.rotation.y = Math.atan2(at.x - npc.position.x, at.z - npc.position.z); };

function street(t) {
  const district = { npcs: [] }, renders = new Scene(), calls = [], dispatches = [];
  const game = {
    world: { active: district }, collisions: new CollisionSystem(), player: { root: new Group(), position: point(21, 20) },
    steal: { buscado: 0, _calma: 90 }, traffic: { wantedLevel: 0, dispatchTo: (...args) => dispatches.push(args) },
  };
  const minds = new StreetMinds(district), witnesses = new WitnessSystem(game, { random: () => 0 });
  const navigation = new PedestrianNavigation(Array.from({ length: 30 }, () => Array(30).fill('sidewalk')), 2);
  window.addEventListener('npc-emergency-call', e => calls.push(e.detail));
  async function add(x, z, tipo = 'indiferente', y = 0) {
    const npc = new Npc(renders, point(x, z, y), { arquetipo: 'oficinista', navigation, facing: 0, groundHeight: () => y,
      isWalkable: (x, z) => navigation.isWalkableAt(x, z), collisions: game.collisions, speed: 1.65 });
    await npc.ready;
    district.npcs.push(npc);
    minds.beginFrame(.01, game.player.position);
    npc.mind.temper = { ...npc.mind.temper, ...TEMPERS[tipo], tipo };
    npc.stance = null; npc.target = null; npc.wait = 1000; npc.route = [];
    npc.say = text => { (npc.lines ??= []).push(text); };
    return npc;
  }
  function run(seconds, step = () => {}) {
    const dt = 1 / 30;
    for (let i = 0; i < Math.ceil(seconds / dt); i++) {
      witnesses.update(dt);
      minds.beginFrame(dt, game.player.position);
      for (const npc of district.npcs) npc.update(dt, { player: game.player.position });
      step();
    }
  }
  t.after(() => { witnesses.dispose(); minds.dispose(); for (const npc of district.npcs) npc.dispose(); });
  return { game, minds, witnesses, calls, dispatches, add, run };
}

function kill(npc, attacker, attackId = 1) {
  npc.takeHit({ attacker, attackId, damage: npc.health, knockback: 0 });
  assert.equal(npc.isDead, true);
}

test('el lugar de la víctima, la pared, la cota y el rumbo distinguen ver de oír', async t => {
  const s = street(t);
  const victim = await s.add(22, 20), clear = await s.add(18, 20), back = await s.add(22, 26);
  const wall = await s.add(29, 20), floor = await s.add(22, 18, 'indiferente', 4), far = await s.add(55, 50);
  s.game.collisions.colliders.push({ box: new Box3(point(25, 16), point(26, 24, 5)) });
  for (const npc of [clear, wall, floor]) forward(npc, victim.position);
  back.root.rotation.y = 0;
  const other = { position: point(21, 20) };
  s.game.player.position.copy(far.position);
  kill(victim, other);
  const observations = s.witnesses.deaths.incidents[0].observers;
  assert.equal(observations.get(clear).attacker, other);
  assert.equal(observations.get(clear).victim, victim);
  for (const npc of [back, wall, floor]) {
    assert.equal(observations.get(npc).heard, true);
    assert.equal(observations.get(npc).attacker, null);
    assert.equal(observations.get(npc).victim, null);
  }
  assert.equal(observations.has(far), false);
  assert.equal(observations.has(victim), false);
  assert.equal(clear.mind.aware.memory.grudge(s.minds.time), 0);
  // Al darse la vuelta descubre a la persona en el suelo, incluso con el causante todavía a su lado.
  s.run(1.25);
  assert.ok(Math.abs(back.root.rotation.y) > 1, 'la persona se vuelve realmente hacia lo que oyó a su espalda');
  assert.equal(observations.get(back).victim, victim);
  assert.equal(observations.get(back).attacker, null);
  assert.equal(observations.get(wall).victim, null);
});

test('la llamada empieza a resguardo y el auxilio llega a pie cuando el agresor deja la zona', async t => {
  const s = street(t), victim = await s.add(21, 21);
  const reporter = await s.add(23, 21, 'avisador'), helper = await s.add(21, 29, 'bravo'), fearful = await s.add(24, 25, 'miedoso');
  for (const npc of [reporter, helper, fearful]) forward(npc, victim.position);
  kill(victim, s.game.player);
  assert.ok(fearful.fleeTimer > 0);
  assert.equal(reporter.mind.aware.memory.strongest(s.minds.time)?.tipo, 'muerte');
  const start = helper.position.clone();
  let callAt, helpedAt;
  const watch = () => {
    if (!callAt && reporter.witnessing === 'llamar') callAt = reporter.position.clone();
    if (!helpedAt && helper.witnessing === 'auxiliar') helpedAt = helper.position.clone();
  };
  s.run(7, watch);
  assert.ok(callAt && callAt.distanceTo(s.game.player.position) >= 6.95);
  assert.ok(start.distanceTo(helper.position) < .5, 'nadie camina hacia el atacante que aún está junto al cuerpo');
  assert.equal(helpedAt, undefined);
  s.game.player.position.set(45, 0, 40);
  s.run(18, watch);
  assert.ok(helpedAt && helpedAt.distanceTo(victim.position) <= 1.45);
  assert.ok(start.distanceTo(helpedAt) > 5, 'recurrió a la locomoción real');
  assert.equal(victim.emergencyAided, true);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].accusedPlayer, true);
  assert.equal(s.dispatches.length, 1);
  assert.equal(s.game.steal.buscado, 1);
});

for (const defenseFirst of [false, true]) {
  test(`dos víctimas de un mismo golpe, defensa ${defenseFirst ? 'primero' : 'después'}: un aviso por el civil identificado`, async t => {
    const s = street(t), civilian = await s.add(21, 21), aggressor = await s.add(21.4, 21);
    const witness = await s.add(21, 11, 'avisador');
    aggressor.isAggressor = true;
    civilian.health = aggressor.health = 1;
    forward(witness, civilian.position);
    const hit = new MeleeCombat();
    s.game.player.equippedWeapon = 'arma';
    assert.ok(hit.start(s.game.player));
    const ordered = defenseFirst ? [aggressor, civilian] : [civilian, aggressor];
    const contact = hit.update(.8, s.game.player, ordered);
    assert.equal(contact.hits.length, 2);
    window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: s.game.player, hits: ordered, results: contact.hits } }));
    assert.equal(s.witnesses.deaths.incidents.length, 2);
    s.game.player.position.set(48, 0, 45);
    s.run(11);
    assert.equal(s.calls.length, 1);
    assert.equal(s.dispatches.length, 1);
    assert.equal(s.calls[0].accusedPlayer, true);
    assert.equal(s.calls[0].victim, civilian);
    assert.deepEqual(new Set(s.calls[0].reports.map(r => r.victim)), new Set([aggressor, civilian]));
    assert.equal(s.dispatches[0][0].distanceTo(s.calls[0].position), 0);
    assert.equal(s.game.steal.buscado, 1);
  });
}

test('quien vio una muerte ajena, una defensa o sólo encontró el cuerpo pide ayuda sin acusar al jugador', async t => {
  const s = street(t), victim = await s.add(21, 21), witness = await s.add(21, 10, 'avisador');
  victim.isAggressor = true;
  forward(witness, victim.position);
  kill(victim, s.game.player);
  s.run(8);
  assert.equal(s.calls[0].attacker, s.game.player, 'el testigo distingue quién intervino');
  assert.equal(s.calls[0].accusedPlayer, false);
  assert.equal(witness.mind.aware.memory.grudge(s.minds.time), 0);
  const other = await s.add(20, 20);
  forward(witness, other.position);
  const stranger = { position: point(21, 20) };
  kill(other, stranger, 3);
  s.run(8);
  assert.equal(s.calls[1].attacker, stranger);
  assert.equal(s.calls[1].accusedPlayer, false);
  assert.equal(s.dispatches.length, 0);
  assert.equal(s.game.steal.buscado, 0);
});

test('ver a la persona caer, con el agresor tapado, permite pedir auxilio sin identificarlo', async t => {
  const s = street(t), victim = await s.add(21, 21), witness = await s.add(21, 12, 'avisador');
  s.game.player.position.set(24, 0, 20);
  s.game.collisions.colliders.push({ box: new Box3(point(22.1, 15.5), point(23.5, 18.5, 4)) });
  forward(witness, victim.position);
  kill(victim, s.game.player);
  const seen = s.witnesses.deaths.incidents[0].observers.get(witness);
  assert.equal(seen.victim, victim);
  assert.equal(seen.attacker, null);
  s.run(8);
  assert.equal(s.calls[0].victim, victim);
  assert.equal(s.calls[0].attacker, null);
  assert.equal(s.calls[0].accusedPlayer, false);
  assert.equal(s.dispatches.length, 0);
});

test('una pelea que escala a muerte dentro del enfriamiento sustituye su llamada pendiente', async t => {
  const s = street(t), victim = await s.add(21, 21), witness = await s.add(21, 11, 'avisador');
  forward(witness, victim.position);
  s.witnesses.report('pelea', victim);
  assert.equal(s.witnesses.calls[0].kind, 'pelea');
  assert.ok(s.witnesses._cooldown > 0);
  kill(victim, s.game.player);
  assert.equal(s.witnesses.calls.length, 0);
  s.game.player.position.set(47, 0, 47);
  s.run(15);
  assert.equal(s.calls.length, 1);
  assert.equal(s.dispatches.length, 1);
  assert.equal(s.dispatches[0][2], 'muerte');
});

test('al volver se descubre el cuerpo restaurado sin autor y un reporte recibido sobrevive al reset', async t => {
  const s = street(t), body = await s.add(23, 21), witness = await s.add(22, 10, 'avisador');
  body.restoreDeath();
  forward(witness, body.position);
  s.run(8);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].victim, body);
  assert.equal(s.calls[0].attacker, null);
  assert.equal(s.calls[0].accusedPlayer, false);
  assert.equal(body.emergencyReported, true);
  s.witnesses.reset();
  assert.equal(witness.deathResponse, null);
  s.run(10);
  assert.equal(s.calls.length, 1);
  assert.equal(s.game.steal.buscado, 0);
});

for (const family of ['roadRage', 'policeFoot', 'limpieza']) {
  test(`un testigo descubre tras recargar el cuerpo de ${family} que está fuera de district.npcs`, async t => {
    const s = street(t), body = await s.add(23, 20), witness = await s.add(23, 11, 'avisador'), gone = await s.add(22, 20);
    body.restoreDeath(); gone.restoreDeath(); gone.dispose();
    s.game.world.active.npcs = [witness];
    const key = { roadRage: 'fallenDrivers', policeFoot: 'officers', limpieza: 'members' }[family];
    s.game[family] = { [key]: [body, gone] };
    t.after(() => body.dispose());
    forward(witness, body.position);
    s.run(8);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].victim, body);
    assert.equal(s.calls[0].attacker, null);
    assert.equal(s.calls[0].accusedPlayer, false);
    assert.ok(s.witnesses.deaths.incidents.every(scene => scene.victim !== gone));
    assert.equal(body.emergencyReported, true);
    assert.equal(s.dispatches.length, 0);
  });
}

test('si golpean a quien estaba llamando, otro avisador puede terminar una sola llamada', async t => {
  const s = street(t), victim = await s.add(21, 21);
  const first = await s.add(21, 13, 'avisador'), second = await s.add(20, 10, 'avisador');
  forward(first, victim.position); forward(second, victim.position);
  kill(victim, s.game.player);
  s.run(.5);
  assert.equal(first.witnessing, 'llamar');
  first.takeHit({ damage: 5, attacker: null });
  s.game.player.position.set(43, 0, 43);
  s.run(9);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].npc, second);
  assert.equal(s.dispatches.length, 1);
  assert.equal(first.deathResponse, null);
});

test('dos interlocutores que perciben la caída cortan la charla y el indiferente sale junto a su compañero asustado', async t => {
  const s = street(t), victim = await s.add(21, 21);
  const companion = await s.add(21, 26), fearful = await s.add(21.9, 26, 'miedoso');
  companion.talk = { partner: fearful }; fearful.talk = { partner: companion };
  forward(companion, victim.position); forward(fearful, victim.position);
  kill(victim, s.game.player);
  assert.equal(companion.talk, null); assert.equal(fearful.talk, null);
  assert.ok(companion.fleeTimer > 0 && fearful.fleeTimer > 0);
  assert.ok(companion.fleeDir.dot(fearful.fleeDir) > .9);
  const start = companion.position.clone();
  s.run(.65);
  assert.ok(companion.position.distanceTo(start) > .25);
  assert.ok(companion.position.distanceTo(fearful.position) < 3);
});

test('la llamada incluye únicamente a las víctimas que llegó a ver quien tomó el teléfono', async t => {
  const s = street(t), aggressor = await s.add(21, 20), civilian = await s.add(21, 22.5);
  const witness = await s.add(21, 12, 'avisador');
  aggressor.isAggressor = true;
  forward(witness, aggressor.position);
  s.game.collisions.colliders.push({ box: new Box3(point(19, 21), point(23, 21.4, 4)) });
  kill(aggressor, s.game.player, 15); kill(civilian, s.game.player, 15);
  s.game.player.position.set(47, 0, 47);
  s.run(9);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].victim, aggressor);
  assert.deepEqual(s.calls[0].reports.map(report => report.victim), [aggressor]);
  assert.equal(s.calls[0].accusedPlayer, false);
  assert.equal(s.dispatches.length, 0);
  assert.equal(civilian.emergencyReported, undefined);
});

test('un mismo golpe que hiere al civil y mata al agresor dispara un solo despacho por la lesión civil', async t => {
  const s = street(t), aggressor = await s.add(21, 21), civilian = await s.add(21.5, 21);
  const witness = await s.add(21, 11, 'avisador');
  aggressor.isAggressor = true; aggressor.health = 1;
  forward(witness, civilian.position);
  const melee = new MeleeCombat();
  s.game.player.equippedWeapon = 'arma';
  assert.ok(melee.start(s.game.player));
  const contact = melee.update(.8, s.game.player, [aggressor, civilian]);
  assert.ok(aggressor.isDead && civilian.health > 0 && civilian.health < civilian.maxHealth);
  window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: s.game.player, hits: [aggressor, civilian], results: contact.hits } }));
  s.game.player.position.set(47, 0, 47);
  s.run(15);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].reports.length, 1);
  assert.equal(s.calls[0].reports[0].victim, aggressor);
  assert.equal(s.calls[0].injury.victim, civilian);
  assert.equal(s.dispatches.length, 1);
  assert.equal(s.dispatches[0][2], 'pelea');
  assert.equal(s.game.steal.buscado, 1);
});

test('si el camino está cerrado quien ayuda no atraviesa la pared ni finge haber atendido al caído', async t => {
  const s = street(t), body = await s.add(21, 21), helper = await s.add(21, 29, 'curioso');
  forward(helper, body.position);
  kill(body, s.game.player);
  s.game.player.position.set(47, 0, 47);
  s.game.collisions.colliders.push({ box: new Box3(point(0, 24), point(58, 24.7, 4)) });
  s.run(12);
  assert.ok(helper.position.z >= 24.7);
  assert.equal(helper.witnessing, null);
  assert.equal(helper.deathResponse, null);
  assert.ok(!body.emergencyAided);
});

test('el puño no mortal conecta el resultado real con el testigo aunque la posición sea un objeto sencillo', async t => {
  const s = street(t), victim = await s.add(21, 21), witness = await s.add(21, 10, 'avisador');
  forward(witness, victim.position);
  const melee = new MeleeCombat();
  assert.ok(melee.start(s.game.player));
  const result = melee.update(.7, s.game.player, [victim]);
  assert.equal(result.hits[0].position.clone, undefined);
  window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: s.game.player, hits: [victim], results: result.hits } }));
  assert.equal(s.witnesses.calls.length, 1);
  assert.equal(witness.witnessing, 'llamar');
  s.game.player.position.set(40, 0, 40);
  s.run(WITNESS.callSeconds + 1);
  assert.equal(s.witnesses.deaths.incidents.length, 0);
  assert.equal(s.dispatches.length, 1);
});
