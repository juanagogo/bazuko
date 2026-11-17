import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { GOSSIP_PHRASES, MEMORY, Memory, RECLAIM_PHRASES, RECOGNIZE_PHRASES, REFUSE_PHRASES, allRefuseAlms, refusalFor } from '../src/entities/npc/memory.js';
import { STIMULI } from '../src/entities/npc/stimuli.js';
import { TEMPERS } from '../src/entities/npc/temperament.js';
import { StreetMinds, seededRandom } from '../src/entities/npc/mind.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { Clock, DAY_CYCLE_SECONDS } from '../src/core/Clock.js';

// La memoria de la calle: lo malo que le vieron hacer al jugador se recuerda unos minutos, se cuenta al de al lado
// más flojo, y mientras dura lo reconocen, le dan espacio, no le dan limosna y la víctima huye o le reclama.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, snapPose() {}, dispose() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
const { Npc } = await import('../src/entities/Npc.js');

const realRandom = Math.random;
beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = { getElementById() { return null; }, createElement() { return { style: {}, remove() {} }; }, body: { appendChild() {} } };
  Math.random = seededRandom(77);
});
afterEach(() => { Math.random = realRandom; });

const plaza = (w = 30, h = 20) => new PedestrianNavigation(Array.from({ length: h }, () => Array(w).fill('sidewalk')), 2);

async function walker(at, navigation, arquetipo = 'oficinista') {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(...at), {
    arquetipo, navigation, facing: 0, groundHeight: () => 0, isWalkable: (x, z) => navigation.isWalkableAt(x, z)
  });
  await npc.ready;
  npc.walkSpeed = 1.3;
  npc.person.pausa = 0;
  return npc;
}

function scene(npcs) {
  const district = { npcs, trafficPedestrians: [...npcs] };
  return { district, minds: new StreetMinds(district) };
}

function run({ district, minds }, seconds, player, onFrame = () => {}, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    minds.beginFrame(dt, player);
    for (const npc of district.npcs) npc.update(dt, { player });
    if (onFrame(t) === false) return t;
  }
  return seconds;
}

function temper(npc, tipo) { npc.mind.temper = { ...npc.mind.temper, ...TEMPERS[tipo], tipo }; }
function stand(npc, yaw = 0) { npc.target = null; npc.route = []; npc.wait = 1e9; npc.root.rotation.y = yaw; npc.stance = null; }
/** Pone al jugador a `d` m delante del NPC (según hacia dónde mira). */
function inFront(npc, player, d) {
  const yaw = npc.root.rotation.y;
  player.set(npc.position.x + Math.sin(yaw) * d, 0, npc.position.z + Math.cos(yaw) * d);
}

test('se acuerda unos minutos: 3 lo que vio, 5 lo que le hicieron, y un mismo hecho repetido no ocupa otro puesto', () => {
  const memory = new Memory();
  memory.remember('robo', 1, 0);
  assert.equal(memory.grudge(0), 1);
  assert.ok(Math.abs(memory.grudge(MEMORY.witness / 2) - .5) < 1e-9);
  assert.equal(memory.grudge(MEMORY.witness), 0, 'a los 3 min se le olvidó');
  const victim = new Memory();
  victim.remember('golpe', 1, 0, { victim: true });
  assert.ok(victim.grudge(MEMORY.witness) > .35, 'la víctima se acuerda más');
  assert.equal(victim.victimOf(100).tipo, 'golpe');
  assert.equal(victim.grudge(MEMORY.victim), 0);
  assert.equal(victim.victimOf(MEMORY.victim), null);
  // Cada golpe de una pelea refresca el mismo recuerdo.
  const fight = new Memory();
  for (let t = 0; t < 10; t++) fight.remember('pelea', .6, t);
  assert.equal(fight.acts.filter(a => a.tipo).length, 1);
  assert.ok(Math.abs(fight.grudge(9) - .6) < 1e-9);
  // Lo nuevo pisa lo que pesa menos.
  fight.remember('robo', .9, 20); fight.remember('popo', .3, 21); fight.remember('golpe', .8, 22);
  assert.deepEqual(fight.acts.map(a => a.tipo).sort(), ['golpe', 'pelea', 'robo']);
  assert.equal(fight.refusesAlms(22), true);
  assert.equal(fight.refusesAlms(400), false);
});

test('el chisme pasa al de al lado más flojo, se apaga a la tercera y no se repite a cada rato', () => {
  const a = new Memory(), b = new Memory(), c = new Memory(), d = new Memory();
  a.remember('robo', .8, 0);
  assert.equal(a.tell(b, 0), true);
  assert.ok(Math.abs(b.grudge(0) - .4) < 1e-9);
  assert.equal(b.acts.find(x => x.tipo).heard, true);
  assert.equal(a.tell(c, 1), false, 'una vez cada 10 s');
  assert.equal(b.tell(c, 0), true);
  assert.ok(Math.abs(c.grudge(0) - .2) < 1e-9);
  assert.equal(c.tell(d, 0), false, 'a la tercera ya no vale la pena contarlo');
  assert.equal(d.grudge(0), 0);
  // Quien ya lo sabe más fuerte no se entera de nada nuevo.
  const e = new Memory();
  e.remember('robo', 1, 10);
  assert.equal(a.tell(e, 12), false);
});

test('pedir limosna: si toda la gente de alrededor se acuerda de algo, nadie da y se lo dicen; el perro no cuenta', () => {
  const said = [];
  const person = refuses => ({ person: {}, position: new THREE.Vector3(), mind: { refusesAlms: () => refuses, sayRefusal() { said.push(refuses); } } });
  const dog = { position: new THREE.Vector3() };
  assert.equal(allRefuseAlms([person(true), dog, person(true)]), true);
  assert.equal(said.length, 2);
  assert.equal(allRefuseAlms([person(true), person(false)]), false, 'alguien no sabe nada');
  assert.equal(allRefuseAlms([dog]), false);
  assert.equal(allRefuseAlms([{ person: {}, position: new THREE.Vector3() }]), false, 'un vendedor sin mente sí podría dar');
  // En el juego: InteractionSystem._beg.
  const stats = new StatsSystem();
  stats.higiene = 100; stats.energia = 100; stats.dinero = 0;
  const player = { position: new THREE.Vector3(0, 0, 0), playBeg() {} };
  const interaction = new InteractionSystem(player, { add: () => true }, stats, { play: () => {} }, null, { getEffect: (_k, b) => b }, null);
  interaction.setPedestrians([Object.assign(person(true), { position: new THREE.Vector3(2, 0, 0) })]);
  let result = null;
  window.addEventListener('beg-result', e => { result = e.detail; });
  interaction._beg();
  assert.equal(result?.reason, 'memoria');
  assert.equal(result.success, false);
  assert.equal(stats.dinero, 0);
  // Con alguien al lado que no sabe nada, se pide como siempre.
  const other = new InteractionSystem(player, { add: () => true }, stats, { play: () => {} }, null, { getEffect: (_k, b) => b }, null);
  other.setPedestrians([Object.assign(person(true), { position: new THREE.Vector3(2, 0, 0) }), Object.assign(person(false), { position: new THREE.Vector3(-2, 0, 0) })]);
  result = null;
  other._beg();
  assert.ok(result && result.reason !== 'memoria', JSON.stringify(result));
});

test('al negar la limosna dice por qué: si fue su víctima, si lo vio o si se lo contaron, y qué hizo', async () => {
  const cases = [
    ['robo', { victim: true }, /usted fue el que me robó/], ['robo', {}, /lo vi robando/], ['robo', { heard: true }, /contaron que anda robando/],
    ['golpe', {}, /lo vi pegándole/], ['popo', { victim: true }, /me tiró la popó/], ['pelea', { heard: true }, /dijeron que anda buscando pelea/]
  ];
  for (const [tipo, how, expected] of cases) {
    const memory = new Memory();
    memory.remember(tipo, 1, 50, how);
    assert.match(refusalFor(memory.strongest(50)), expected);
  }
  // Para todo lo malo que se recuerda hay frase de las tres maneras, y cada una dice cómo lo sabe.
  const how = { victima: /usted (fue|me)/i, vio: /\bvi\b/, chisme: /(contaron|dijeron)/ };
  for (const kind of Object.keys(STIMULI).filter(k => STIMULI[k].bad)) {
    for (const [why, re] of Object.entries(how)) assert.match(REFUSE_PHRASES[why][kind] ?? '', re, `${why} ${kind}`);
  }
  // En la calle: el que se lo oyó a otro no dice «yo lo vi».
  const nav = new PedestrianNavigation([Array.from({ length: 10 }, () => 'sidewalk')], 2);
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(4, 0, 0), { arquetipo: 'oficinista', navigation: nav, groundHeight: () => 0, isWalkable: () => true });
  await npc.ready;
  const district = { npcs: [npc], trafficPedestrians: [npc] }, minds = new StreetMinds(district);
  minds.beginFrame(1 / 30, new THREE.Vector3(20, 0, 0));
  npc.mind.aware.memory.remember('robo', .46, minds.time, { heard: true });
  const said = [];
  npc.say = text => said.push(text);
  for (let k = 0; k < 20; k++) npc.mind.sayRefusal();
  assert.ok(said.length > 0 && said.every(text => /contaron que anda robando/.test(text)), said.join(' | '));
  minds.dispose();
});

test('a quien le hacen un cosquilleo limpio no se entera de nada; si lo pilla, se acuerda como víctima', async () => {
  for (const caught of [false, true]) {
    const nav = plaza();
    const victim = await walker([30, 0, 20], nav, 'senora');
    const s = scene([victim]);
    const player = new THREE.Vector3(30, 0, 21);
    run(s, .2, player);
    stand(victim); // de cara al jugador
    victim._robadoTimer = 10;
    if (caught) victim.alarmedByTheft(player);
    run(s, 2, player);
    const memory = victim.mind.aware.memory;
    if (caught) assert.equal(memory.victimOf(s.minds.time)?.tipo, 'robo');
    else {
      assert.equal(memory.grudge(s.minds.time), 0, JSON.stringify(memory.acts));
      assert.equal(victim.mind.refusesAlms(), false);
    }
  }
});

test('quien vio un robo lo reconoce un minuto después: le da espacio, no limosna, y alguien que no vio nada pasa más cerca', async () => {
  const closest = {};
  for (const saw of [true, false]) {
    Math.random = seededRandom(31);
    const nav = plaza();
    const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 28], nav, 'estudiante');
    const s = scene([victim, witness]);
    const player = new THREE.Vector3(31, 0, 20);
    run(s, .2, player);
    stand(victim); stand(witness, saw ? Math.PI : 0); // de cara al robo, o de espaldas
    temper(witness, 'curioso');
    // Lo pillaron: la víctima grita (eso se oye de espaldas) y el robo solo lo ve quien mira.
    victim._robadoTimer = 10;
    victim.alarmedByTheft(player);
    run(s, 2, player);
    // La víctima se va de la calle: si al acabar de huir pasara junto al testigo se lo contaría (el chisme), y aquí se
    // mide solo lo que el testigo vio o no vio.
    victim.position.set(56, 0, 2); stand(victim);
    s.district.npcs.splice(s.district.npcs.indexOf(victim), 1);
    // El jugador se va lejos; pasa un minuto y al testigo ya se le pasó el susto.
    player.set(300, 0, 300);
    run(s, 60, player, () => {}, .1);
    assert.equal(witness.mind.aware.level, 0, 'ya está tranquilo');
    if (saw) assert.equal(witness.mind.refusesAlms(), true, 'no le da limosna');
    else assert.equal(witness.mind.refusesAlms(), false);
    // Ahora camina por una fila donde está parado el jugador.
    player.set(30, 0, 30);
    witness.position.set(10, 0, 30);
    const route = [];
    for (let x = 12; x <= 50; x += 2) route.push(new THREE.Vector3(x, 0, 30));
    witness.route = route; witness.routeIndex = 0; witness.target = route[0]; witness.wait = 0; witness.root.rotation.y = Math.PI / 2;
    let near = Infinity;
    run(s, 40, player, () => { near = Math.min(near, Math.hypot(witness.position.x - player.x, witness.position.z - player.z)); return witness.position.x < 49; });
    closest[saw ? 'vio' : 'noVio'] = near;
  }
  // Lo vio de lejos (un cosquilleo, no un raponazo) y hace un minuto: no le saca el cuerpo del todo, pero sí bastante más.
  assert.ok(closest.vio >= 2 && closest.vio - closest.noVio >= 1, JSON.stringify(closest));
});

test('la víctima lo reconoce minuto y medio después: la miedosa lo dice y huye, la brava le reclama de frente', async () => {
  for (const tipo of ['miedoso', 'bravo']) {
    Math.random = seededRandom(tipo === 'bravo' ? 8 : 9);
    const nav = plaza();
    const victim = await walker([30, 0, 20], nav, tipo === 'bravo' ? 'obrero' : 'senora');
    const s = scene([victim]);
    const player = new THREE.Vector3(31, 0, 20);
    run(s, .2, player);
    stand(victim);
    temper(victim, tipo);
    victim._robadoTimer = 10;
    victim.alarmedByTheft(player);
    run(s, 1, player);
    player.set(300, 0, 300); // fuera de la vista
    run(s, 90, player, () => {}, .1);
    assert.equal(victim.fleeTimer, 0, `${tipo}: ya dejó de huir`);
    assert.equal(victim.mind.aware.level, 0, `${tipo}: ya se calmó`);
    stand(victim, victim.root.rotation.y);
    const said = [];
    victim.say = text => said.push(text);
    inFront(victim, player, 6);
    let fled = false, stood = false;
    run(s, 3, player, () => { if (victim.fleeTimer > 0) fled = true; if (victim.mind.aware.reaction === 2) stood = true; });
    if (tipo === 'miedoso') {
      assert.ok(fled, 'huyó al reconocerlo');
      assert.ok(said.includes(RECOGNIZE_PHRASES.robo), said.join(' / '));
    } else {
      assert.ok(stood && !fled, 'le plantó cara');
      assert.ok(said.some(t => RECLAIM_PHRASES.includes(t)), said.join(' / '));
    }
  }
});

test('pasados los 5 minutos la víctima ya no lo reconoce', async () => {
  const nav = plaza();
  const victim = await walker([30, 0, 20], nav, 'senora');
  const s = scene([victim]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim);
  temper(victim, 'miedoso');
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  player.set(300, 0, 300); // fuera de la vista
  run(s, MEMORY.victim + 10, player, () => {}, .1);
  stand(victim, victim.root.rotation.y);
  inFront(victim, player, 6);
  let maxLevel = 0;
  run(s, 3, player, () => { maxLevel = Math.max(maxLevel, victim.mind.aware.level); });
  assert.equal(victim.mind.aware.memory.grudge(s.minds.time), 0);
  assert.equal(maxLevel, 0);
  assert.equal(victim.fleeTimer, 0);
});

test('el chisme en la calle: el que vio le cuenta al de al lado, que se entera a medias', async () => {
  const nav = plaza();
  const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 27], nav, 'senora'), friend = await walker([32, 0, 28], nav);
  const s = scene([victim, witness, friend]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI); stand(friend, 0); // la amiga está de espaldas: no ve nada
  temper(witness, 'curioso'); temper(friend, 'curioso');
  const said = [];
  witness.say = text => said.push(text);
  // Lo pillaron: la víctima grita (la amiga lo oye, pero no ve quién fue) y el robo lo ve el testigo.
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  run(s, 3, player);
  player.set(300, 0, 300); // fuera de la vista
  run(s, 12, player);
  const now = s.minds.time, told = witness.mind.aware.memory.grudge(now), heard = friend.mind.aware.memory, got = heard.grudge(now);
  assert.ok(told >= MEMORY.recognize, `el testigo se acuerda: ${told}`);
  assert.ok(got > 0, 'se enteró');
  assert.ok(got <= told * MEMORY.hearsay + 1e-6, `${got} de ${told}`);
  // Todo lo que sabe la amiga se lo contaron: ella no vio nada.
  assert.ok(heard.acts.filter(a => a.tipo).every(a => a.heard), JSON.stringify(heard.acts));
  assert.ok(said.every(t => GOSSIP_PHRASES.includes(t)), said.join(' / '));
  // Sin el testigo al lado, la amiga no se entera de nada.
  Math.random = seededRandom(77);
  const nav2 = plaza();
  const victim2 = await walker([30, 0, 20], nav2), alone = await walker([32, 0, 28], nav2);
  const s2 = scene([victim2, alone]);
  const player2 = new THREE.Vector3(31, 0, 20);
  run(s2, .2, player2);
  stand(victim2); stand(alone, 0); temper(alone, 'curioso');
  victim2._robadoTimer = 10;
  victim2.alarmedByTheft(player2);
  run(s2, 3, player2);
  assert.equal(alone.mind.aware.memory.grudge(s2.minds.time), 0);
});

test('dormir hace olvidar lo que avanza el reloj del mundo en esas horas, sin mover los turnos de pensar', async () => {
  const nav = plaza();
  const witness = await walker([30, 0, 28], nav), victim = await walker([20, 0, 28], nav);
  const s = scene([witness, victim]);
  run(s, .2, new THREE.Vector3(300, 0, 300));
  const now = s.minds.time, ticks = [witness.mind.nextTick, victim.mind.nextTick];
  witness.mind.aware.memory.remember('robo', 1, now);
  victim.mind.aware.memory.remember('golpe', 1, now, { victim: true });
  assert.equal(witness.mind.refusesAlms(), true);
  // Cuánto dura una hora con el reloj que monta el juego (game.js: `new Clock({ dayLengthSeconds: DAY_CYCLE_SECONDS })`).
  const clock = new Clock({ dayLengthSeconds: DAY_CYCLE_SECONDS }), hour0 = clock.hour;
  clock.update(1);
  const perHour = 1 / (clock.hour - hour0);
  // Una siesta de 2 horas (game.js emite `sleep-end` con las horas que durmió): lo que pasaría despierto en 2 horas.
  window.dispatchEvent(new CustomEvent('sleep-end', { detail: { hours: 2 } }));
  assert.ok(Math.abs(witness.mind.aware.memory.grudge(now) - (1 - 2 * perHour / MEMORY.witness)) < 1e-9);
  assert.ok(Math.abs(victim.mind.aware.memory.grudge(now) - (1 - 2 * perHour / MEMORY.victim)) < 1e-9, 'a la víctima le dura más');
  assert.ok(witness.mind.aware.memory.grudge(now) > .5, 'tras una siesta el testigo todavía se acuerda');
  // Una noche entera (8 horas más) ya pasa de lo que dura cualquier recuerdo.
  window.dispatchEvent(new CustomEvent('sleep-end', { detail: { hours: 8 } }));
  assert.ok(10 * perHour >= MEMORY.victim);
  assert.equal(witness.mind.aware.memory.grudge(now), 0);
  assert.equal(victim.mind.aware.memory.grudge(now), 0);
  assert.equal(witness.mind.refusesAlms(), false);
  assert.equal(victim.mind.aware.memory.victimOf(now), null);
  // Solo la memoria: el reloj de las mentes y sus turnos siguen donde estaban.
  assert.equal(s.minds.time, now);
  assert.deepEqual([witness.mind.nextTick, victim.mind.nextTick], ticks);
});
