import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { ALARM, SENSES, canSee, decayAlarm, levelFor, sightRange, strength } from '../src/entities/npc/perception.js';
import { STIMULI, StimulusBus } from '../src/entities/npc/stimuli.js';
import { TEMPERS, rollTemperament } from '../src/entities/npc/temperament.js';
import { FLIGHT, FlightPlanner } from '../src/entities/npc/flight.js';
import { REACT, REPORT_PHRASES, STAND_PHRASES } from '../src/entities/npc/awareness.js';
import { MIND, StreetMinds, seededRandom } from '../src/entities/npc/mind.js';
import { NpcConversations } from '../src/systems/NpcConversations.js';
import { npcSexo } from '../src/systems/StreetVoices.js';
import { sightClear, solidAt } from '../src/entities/npc/room.js';
import { AVOID } from '../src/entities/npc/steering.js';

// Ver, oír y reaccionar por grados: el cono y el oído, la alerta con histéresis, los temperamentos, el canal de
// estímulos, la huida por la red y peatones de verdad (Npc real, red real) que ven un robo o una pelea.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, snapPose() {}, dispose() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
const { Npc } = await import('../src/entities/Npc.js');

const realRandom = Math.random;
beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = { getElementById() { return null; }, createElement() { return { style: {}, remove() {} }; }, body: { appendChild() {} } };
  Math.random = seededRandom(99);
});
afterEach(() => { Math.random = realRandom; });

/**
 * Red desde un dibujo: '.' andén, 'r' calzada que se puede cruzar (como una cebra), '#' muro. Cada carácter es una
 * baldosa de 2 m (x a la derecha, z hacia abajo).
 */
function navFrom(rows) {
  return new PedestrianNavigation(rows.map(row => [...row].map(c => (c === '.' ? 'sidewalk' : c === 'r' ? 'road' : 'building'))), 2,
    { isCrossing: (x, z) => rows[z][x] === 'r' });
}
const plaza = (w = 30, h = 20) => navFrom(Array.from({ length: h }, () => '.'.repeat(w)));

async function walker(at, navigation, arquetipo = 'oficinista', extra = {}) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(...at), {
    arquetipo, navigation, facing: 0, groundHeight: () => 0, isWalkable: (x, z) => navigation.isWalkableAt(x, z), ...extra
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

/** Fija el temperamento (los demás rasgos quedan, como su impaciencia). */
function temper(npc, tipo) { npc.mind.temper = { ...npc.mind.temper, ...TEMPERS[tipo], tipo }; }

/** Cajas sólidas estáticas, con la consulta de CollisionSystem. */
function solids(boxes) {
  return {
    boxes,
    queryStatic(minX, minZ, maxX, maxZ, out) {
      out.length = 0;
      for (const box of boxes) if (box.max.x >= minX && box.min.x <= maxX && box.max.z >= minZ && box.min.z <= maxZ) out.push({ box });
      return out;
    }
  };
}
const box = (x0, z0, x1, z1, height = 2.5) => new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, height, z1));

/** Quieto en su sitio mirando hacia `yaw` (0 = +Z). */
function stand(npc, yaw = 0) { npc.target = null; npc.route = []; npc.wait = 1e9; npc.root.rotation.y = yaw; npc.stance = null; }

test('el cono de visión: de frente hasta su alcance, de lado hasta 57°, de espaldas solo muy cerca; de noche y con lluvia ve menos', () => {
  const range = sightRange();
  assert.equal(range, SENSES.sight);
  assert.equal(canSee(0, 0, 0, 0, 10, range), true, 'de frente');
  assert.equal(canSee(0, 0, 0, 0, 17, range), false, 'más allá del alcance');
  const at = deg => [Math.sin(deg * Math.PI / 180) * 10, Math.cos(deg * Math.PI / 180) * 10];
  assert.equal(canSee(0, 0, 0, ...at(50), range), true, 'a 50°');
  assert.equal(canSee(0, 0, 0, ...at(62), range), false, 'a 62°: fuera del cono de 115°');
  assert.equal(canSee(0, 0, 0, 0, -10, range), false, 'a la espalda');
  assert.equal(canSee(0, 0, 0, 0, -2, range), true, 'a la espalda pero encima');
  assert.equal(canSee(0, 0, Math.PI / 2, 10, 0, range), true, 'mirando a +X');
  assert.ok(sightRange(true) < range && sightRange(false, true) < range && sightRange(true, true) < sightRange(true));
  assert.ok(sightRange(true) >= 9 && sightRange(true) <= 10, 'de noche ve unos 10 m');
});

test('oír y ver: un grito se oye a la espalda, un robo callado solo se ve; con la distancia pesa menos', () => {
  const range = sightRange();
  assert.ok(strength('grito', 8, false, 1, 16, range) > 0, 'el grito se oye sin verlo');
  assert.equal(strength('robo', 5, false, 1, 16, range), 0, 'el robo no hace ruido');
  assert.ok(strength('robo', 5, true, 1, 16, range) > 0);
  assert.ok(strength('pelea', 3, true, 1, 16, range) > strength('pelea', 10, true, 1, 16, range));
  assert.equal(strength('pito', 40, false, 1, 22, range), 0, 'fuera de su radio no se oye');
  assert.ok(strength('pelea', 3, true, 1, 16, range) > strength('sirena', 3, false, 1, 35, range), 'una pelea asusta más que una sirena');
});

test('la alerta tiene histéresis: subir de nivel pide más que quedarse, y baja sola pasado el aguante', () => {
  let level = 0;
  const steps = [[.1, 0], [.16, 1], [.1, 1], [.07, 0], [.45, 2], [.35, 2], [.29, 1], [.75, 3], [.6, 3], [.54, 2], [1, 3], [0, 0]];
  for (const [alarm, expected] of steps) {
    level = levelFor(alarm, level);
    assert.equal(level, expected, `alerta ${alarm}`);
  }
  for (let k = 0; k < 3; k++) assert.ok(ALARM.exit[k] < ALARM.enter[k]);
  assert.equal(decayAlarm(.8, 1, 1), .8, 'recién asustado no baja');
  assert.ok(Math.abs(decayAlarm(.8, 1, ALARM.hold + 1) - (.8 - ALARM.decay)) < 1e-9);
  assert.ok(Math.abs(decayAlarm(.8, 3, ALARM.hold + 1) - (.8 - ALARM.decay)) < 1e-9, 'solo cuenta lo que pasó después del aguante');
  assert.equal(decayAlarm(.05, 10, 30), 0);
});

test('los temperamentos son umbrales: el miedoso se asusta más que el indiferente, el bravo planta cara y el avisador avisa', () => {
  assert.deepEqual(Object.keys(TEMPERS).sort(), ['avisador', 'bravo', 'curioso', 'indiferente', 'miedoso']);
  assert.ok(TEMPERS.miedoso.gain > TEMPERS.curioso.gain && TEMPERS.curioso.gain > TEMPERS.indiferente.gain);
  assert.ok(TEMPERS.curioso.watch > TEMPERS.indiferente.watch && TEMPERS.miedoso.watch === 0);
  assert.equal(TEMPERS.bravo.stand, 1); assert.equal(TEMPERS.avisador.report, 1);
  for (const t of Object.values(TEMPERS)) assert.deepEqual(Object.keys(t).sort(), ['far', 'fearReach', 'gain', 'glance', 'report', 'stand', 'watch']);
  assert.ok(TEMPERS.miedoso.fearReach > TEMPERS.curioso.fearReach && TEMPERS.curioso.fearReach < REACT.ring[0], 'el curioso mira desde el corrillo');
  // Ante una pelea: el miedoso la mira de lejos o se va, el indiferente sigue de largo mirando de reojo.
  assert.ok(TEMPERS.miedoso.far > 0 && TEMPERS.miedoso.far < 1 && TEMPERS.indiferente.watch === 0 && TEMPERS.indiferente.glance);
  // Sale de su arquetipo y de su azar: el mismo azar da el mismo carácter.
  const count = arquetipo => {
    const random = seededRandom(5), seen = {};
    for (let i = 0; i < 400; i++) { const { tipo } = rollTemperament({ arquetipo, real: { edad: 'adulto' } }, random); seen[tipo] = (seen[tipo] ?? 0) + 1; }
    return seen;
  };
  const senora = count('senora'), obrero = count('obrero');
  assert.ok(senora.miedoso > (senora.bravo ?? 0), JSON.stringify(senora));
  assert.ok((obrero.bravo ?? 0) > (obrero.miedoso ?? 0), JSON.stringify(obrero));
  assert.deepEqual(rollTemperament({ arquetipo: 'abuelo' }, seededRandom(3)), rollTemperament({ arquetipo: 'abuelo' }, seededRandom(3)));
});

test('el canal guarda los últimos estímulos, los apaga con el tiempo y junta los golpes de una pelea en una escena', () => {
  const bus = new StimulusBus();
  const first = bus.emit('grito', 1, 1, 0, 1, null, 0);
  assert.equal(bus.alive(first, 1), true);
  assert.equal(bus.alive(first, STIMULI.grito.life + .1), false, 'un grito dura poco');
  for (let i = 0; i < 70; i++) bus.emit('pito', i, 0, 0, 1, null, 1);
  assert.equal(bus.alive(first, 1), false, 'pisado en el anillo');
  assert.equal(bus.oldest, bus.count - 64);
  bus.emit('pelea', 10, 10, 0, 1, null, 2);
  bus.emit('pelea', 13, 10, 0, 1, null, 3); // el mismo pleito, corrido 3 m
  bus.emit('pelea', 40, 10, 0, 1, null, 3); // otro
  const live = bus.scenes.filter(s => s.kind && s.until >= 3);
  assert.equal(live.length, 2);
  const near = bus.sceneNear(12, 12, 25, 3);
  assert.equal(near.x, 13);
  assert.equal(near.until, 3 + STIMULI.pelea.scene);
  assert.equal(bus.sceneNear(12, 12, 25, 3 + STIMULI.pelea.scene + .1), null, 'se acabó');
});

test('huir por la red: lejos de la amenaza, sin pasar cerca de ella, y −1 solo en un rincón de verdad', () => {
  // Plaza abierta: con la amenaza al este, termina al oeste y más lejos.
  const nav = plaza(), planner = new FlightPlanner(nav);
  const goal = planner.plan(30, 20, 36, 20);
  assert.ok(goal >= 0);
  const end = nav._point(goal), route = planner.route(goal);
  assert.ok(end.x < 30, `terminó en x=${end.x}`);
  assert.ok(Math.hypot(end.x - 36, end.z - 20) - 6 >= FLIGHT.gain);
  for (const p of route) assert.ok(Math.hypot(p.x - 36, p.z - 20) >= 3, 'el camino no pasa por encima de la amenaza');
  // Para cualquier lado de donde venga la amenaza, nunca hacia ella.
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8, tx = 30 + Math.cos(a) * 5, tz = 20 + Math.sin(a) * 5;
    const g = planner.plan(30, 20, tx, tz), p = nav._point(g);
    assert.ok((p.x - 30) * (tx - 30) + (p.z - 20) * (tz - 20) < 0, `amenaza a ${k * 22.5}°`);
  }
  // Pasillo cerrado al oeste con la amenaza en la única salida: no hay a dónde.
  const rows = (branch) => Array.from({ length: 12 }, (_, z) => [...Array(20)].map((_, x) =>
    (z === 10 && x >= 1 && x <= 18) || (branch && x === 3 && z >= 1 && z <= 10) ? '.' : '#').join(''));
  const closed = new FlightPlanner(navFrom(rows(false)));
  assert.equal(closed.plan(4, 20, 18, 20), -1, 'rincón: se agacha');
  // Con una salida de lado, la toma aunque el primer paso sea hacia la amenaza lejana.
  const open = new FlightPlanner(navFrom(rows(true)));
  const out = open.plan(4, 20, 18, 20);
  assert.ok(out >= 0, 'hay salida');
  assert.equal(open.nav.nodes[out].x, 3, 'por el ramal del norte');
});

test('quien ve un robo de frente se asusta, retrocede un momento y huye por la red, lejos y sin chocar con nada', async () => {
  const nav = plaza();
  const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 30], nav, 'senora');
  const s = scene([victim, witness]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI); // el testigo mira hacia el robo (−Z)
  temper(witness, 'miedoso');
  // Como steal.js: marca a la víctima y, si lo pilla, ella grita y huye.
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  let backed = false, routed = false, cowered = false, offNet = 0, farthest = 0;
  run(s, 8, player, () => {
    const a = witness.mind.aware;
    if (a.reaction === 1) backed = true;
    if (witness._fleeRouted) routed = true;
    if (witness._cowering) cowered = true;
    if (!nav.isWalkableAt(witness.position.x, witness.position.z)) offNet++;
    farthest = Math.max(farthest, Math.hypot(witness.position.x - player.x, witness.position.z - player.z));
  });
  assert.equal(witness.mind.aware.level >= 2 || witness.fleeTimer > 0 || farthest > 15, true);
  assert.ok(backed, 'retrocedió de frente antes de correr');
  assert.ok(routed, 'huyó por una ruta de la red');
  assert.equal(cowered, false, 'no se agachó en una plaza abierta');
  assert.equal(offNet, 0, 'se salió de la red');
  assert.ok(farthest > 16, `se alejó hasta ${farthest.toFixed(1)} m`);
  // La víctima también huye con cabeza.
  assert.ok(victim.mind.aware.level === 3 && victim.mind.aware.threat === s.minds._playerAgent);
});

test('reacciones por grados: el indiferente solo voltea a mirar el robo, sin huir', async () => {
  const nav = plaza();
  // A 10 m, con el robo a unos 50° de su frente: lo ve, y para mirarlo tiene que voltear la cabeza.
  const victim = await walker([30, 0, 20], nav), witness = await walker([38, 0, 26], nav);
  const s = scene([victim, witness]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI);
  temper(witness, 'indiferente');
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  let maxLevel = 0, looked = false;
  run(s, 5, player, () => {
    maxLevel = Math.max(maxLevel, witness.mind.aware.level);
    const g = witness.mind.gaze(null);
    if (g !== null && Math.abs(g) > .05) looked = true;
  });
  assert.equal(maxLevel, 1, 'curiosidad, no más');
  assert.equal(witness.fleeTimer, 0);
  assert.ok(looked, 'volteó la cabeza');
});

test('el bravo le planta cara al que pelea en vez de huir, y lo dice', async () => {
  const nav = plaza();
  const brave = await walker([30, 0, 26], nav, 'obrero');
  const s = scene([brave]);
  const player = new THREE.Vector3(30, 0, 21);
  run(s, .2, player);
  stand(brave, Math.PI);
  temper(brave, 'bravo');
  const said = [];
  brave.say = text => said.push(text);
  // Dos golpes del jugador a alguien, a 5 m del bravo.
  window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: player } } }));
  run(s, .5, player);
  window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: player } } }));
  let stood = false;
  run(s, 3, player, () => { if (brave.mind.aware.reaction === 2) stood = true; });
  assert.ok(stood, 'se plantó');
  assert.equal(brave.fleeTimer, 0, 'no huyó');
  assert.ok(said.some(t => STAND_PHRASES.includes(t)), said.join(' / '));
  // De cara al jugador.
  const yaw = brave.root.rotation.y, toPlayer = Math.atan2(player.x - brave.position.x, player.z - brave.position.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(yaw - toPlayer), Math.cos(yaw - toPlayer))) < .3);
});

test('el avisador grita que llamen a la policía y deja el aviso para quien quiera oírlo', async () => {
  const nav = plaza();
  const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 28], nav, 'vendedor');
  const s = scene([victim, witness]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI);
  temper(witness, 'avisador');
  const said = [], reports = [];
  witness.say = text => said.push(text);
  window.addEventListener('npc-police-report', e => reports.push(e.detail));
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  run(s, 3, player);
  assert.equal(reports.length, 1, 'un aviso, no uno por cuadro');
  assert.equal(reports[0].tipo, 'robo');
  assert.equal(reports[0].npc, witness);
  assert.ok(said.some(t => REPORT_PHRASES.includes(t)));
});

test('lo que el juego da por no visto no lo ve nadie: ni robo, ni grito, ni aviso, ni recuerdo', async () => {
  // steal.js marca a la víctima (`_robadoTimer`) sin alarmarla en los dos casos en que dice que nadie se dio cuenta:
  // «Cosquilleo limpio: nadie se dio cuenta.» y «Fallé el cosquilleo, pero disimulé.». Lo que dice el juego manda.
  const nav = plaza();
  const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 23.5], nav, 'vendedor');
  const s = scene([victim, witness]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI); // a 3,5 m, de cara al cosquilleo
  temper(witness, 'avisador');
  const said = [], reports = [];
  witness.say = text => said.push(text);
  victim.say = text => said.push(text);
  window.addEventListener('npc-police-report', e => reports.push(e.detail));
  const emitted = s.minds.bus.count;
  victim._robadoTimer = 10;
  run(s, 3, player);
  assert.equal(s.minds.bus.count, emitted, 'no dejó ningún estímulo');
  assert.equal(reports.length, 0, 'nadie avisó a la policía');
  assert.deepEqual(said, []);
  assert.equal(witness.mind.aware.level, 0);
  assert.equal(witness.mind.aware.memory.grudge(s.minds.time), 0);
  assert.equal(witness.mind.refusesAlms(), false);
  assert.equal(victim.mind.aware.memory.grudge(s.minds.time), 0);
  assert.equal(victim.fleeTimer, 0);
});

/** Pelea del jugador en `fight`: un golpe por segundo durante `seconds` (lo que avisa el juego con `street-fight`). */
function fighting(seconds, player) {
  let next = 0;
  return t => {
    if (t < seconds && t >= next) { next += 1; window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: player } } })); }
  };
}

const angleTo = (npc, p) => {
  const a = npc.root.rotation.y - Math.atan2(p.x - npc.position.x, p.z - npc.position.z);
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
};

test('corrillo: voltean la cabeza a los 0,3-0,8 s, llegan a paso vivo y escalonados en 3 a 6 s, y quedan en arco a 4-6 m, de cara y a un metro del de al lado, sin nada que les tape', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  // Un puesto de 1,2 m de lado a 2,5 m de la pelea: desde detrás de él no se vería nada.
  const kiosk = box(39.4, 26.3, 40.6, 27.5);
  const collisions = solids([kiosk]);
  // Seis curiosos a 9-11 m, a los dos lados de la pelea, mirando de lado (para mirar tienen que voltear la cabeza).
  const spots = [[30, 0, 30], [31, 0, 34], [30.5, 0, 26], [50, 0, 30], [49, 0, 34], [49.5, 0, 25.5]];
  const people = [];
  for (const at of spots) people.push(await walker(at, nav, 'estudiante', { collisions }));
  const s = scene(people);
  const player = fight; // el jugador es el que pelea
  run(s, .2, player);
  for (const npc of people) { stand(npc, Math.atan2(fight.x - npc.position.x, fight.z - npc.position.z) + Math.PI / 2); temper(npc, 'curioso'); }
  const head = new Map(), arrived = new Map(), last = new Map(people.map(n => [n, n.position.clone()])), walked = new Map(), moving = new Map();
  const joined = new Map(); // orden en que se arrimaron
  const blow = fighting(12, player);
  run(s, 12, player, t => {
    blow(t);
    for (const n of people) {
      const g = n.mind.gaze(null);
      if (!head.has(n) && g !== null && Math.abs(g) >= REACT.gazeMax / 2) head.set(n, t);
      const a = n.mind.aware;
      if (a.watching && !joined.has(n)) joined.set(n, joined.size);
      // El paso: lo andado en los cuadros en que anda hacia su puesto, entre el tiempo que anduvo.
      const step = n.position.distanceTo(last.get(n));
      last.get(n).copy(n.position);
      if (a.watching && n.target && step > 1e-4) { walked.set(n, (walked.get(n) ?? 0) + step); moving.set(n, (moving.get(n) ?? 0) + 1 / 30); }
      if (a.watching && !n.target && Math.hypot(n.position.x - a.watchX, n.position.z - a.watchZ) < .05 && !arrived.has(n)) arrived.set(n, t);
    }
  });
  const heads = [...head.values()].sort((a, b) => a - b), times = [...arrived.values()].sort((a, b) => a - b);
  assert.equal(heads.length, people.length, 'todos voltearon la cabeza');
  assert.ok(heads[0] >= .3 && heads[0] <= .8 && heads.at(-1) <= 1.05, `cabezas a los ${heads.map(t => t.toFixed(2)).join(', ')} s`);
  assert.ok(times.length >= 5, `${times.length} llegaron a su puesto`);
  assert.ok(times[0] >= 2.5 && times.at(-1) <= 6.2, `llegaron a los ${times.map(t => t.toFixed(1)).join(', ')} s`);
  assert.ok(times.at(-1) - times[0] >= .6, `escalonados, no todos a la vez: ${times.map(t => t.toFixed(1)).join(', ')}`);
  for (const n of arrived.keys()) {
    const speed = walked.get(n) / moving.get(n);
    assert.ok(speed >= REACT.briskSpeed - .15, `a paso vivo: ${speed.toFixed(2)} m/s`);
  }
  const watchers = people.filter(n => arrived.has(n));
  for (const n of watchers) {
    const d = Math.hypot(n.position.x - fight.x, n.position.z - fight.z);
    assert.ok(d >= 4 && d <= 6, `a ${d.toFixed(2)} m`);
    assert.ok(angleTo(n, fight) < .35, `de cara a la pelea (${angleTo(n, fight).toFixed(2)} rad)`);
    assert.ok(sightClear(collisions, 0, n.position.x, n.position.z, fight.x, fight.z), `detrás del puesto en (${n.position.x.toFixed(1)}, ${n.position.z.toFixed(1)})`);
    const others = watchers.filter(o => o !== n).map(o => o.position.distanceTo(n.position));
    assert.ok(Math.min(...others) >= .9 && Math.min(...others) <= 1.25, `al de al lado a ${Math.min(...others).toFixed(2)} m`);
  }
  // Se acaba (8 s después del último golpe) y se dispersan de a pocos: cada uno entre 8 y 15 s después del golpe, en
  // franjas por el orden en que se arrimaron (el 1.º y el 5.º en los primeros 1,75 s, el 2.º y el 6.º en los siguientes...).
  const lastBlow = s.minds.time - 1 - 1 / 30, left = new Map();
  run(s, 16, player, () => {
    for (const n of watchers) if (!left.has(n) && !n.mind.aware.watching) left.set(n, s.minds.time - lastBlow);
  });
  assert.equal(people.filter(n => n.mind.aware.watching).length, 0, 'se fueron');
  const gone = [...left.values()].sort((a, b) => a - b);
  assert.ok(gone[0] >= 7.9 && gone.at(-1) <= 15.3, `se fueron a los ${gone.map(t => t.toFixed(1)).join(', ')} s del último golpe`);
  assert.ok(gone.at(-1) - gone[0] >= 1.5, `de a pocos, no todos a la vez: ${gone.map(t => t.toFixed(1)).join(', ')}`);
  const band = (REACT.leave[1] - REACT.leave[0]) / 4, think = .3; // lo que tarda en notarlo, a su turno de pensar
  const bands = [...joined.entries()].filter(([n]) => left.has(n)).map(([n, k]) => ({ k, at: +(left.get(n) - 8 - REACT.leave[0]).toFixed(2) }));
  assert.ok(bands.every(({ k, at }) => at >= (k % 4) * band - .05 && at <= (k % 4 + 1) * band + think), `fuera de su franja: ${JSON.stringify(bands)}`);
});

test('corrillo: quien llega justo por detrás de un kiosco no se para donde el kiosco le tapa; se corre hasta donde ve', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  // El kiosco de 1,2 m a 2,5 m de la pelea, y dos curiosos que llegan por detrás de él: su puesto más a mano (el de su
  // lado de la primera fila) queda a la sombra del kiosco.
  const collisions = solids([box(39.4, 26.3, 40.6, 27.5)]);
  const people = [await walker([40, 0, 19], nav, 'estudiante', { collisions }), await walker([41, 0, 18.5], nav, 'estudiante', { collisions })];
  const s = scene(people);
  run(s, .2, fight);
  for (const n of people) { stand(n, Math.atan2(fight.x - n.position.x, fight.z - n.position.z)); temper(n, 'curioso'); }
  const arrived = new Set(), blow = fighting(10, fight);
  run(s, 9, fight, t => {
    blow(t);
    for (const n of people) if (n.mind.aware.watching && !n.target) arrived.add(n);
  });
  assert.equal(arrived.size, people.length, 'los dos llegaron a su puesto');
  for (const n of people) {
    const d = Math.hypot(n.position.x - fight.x, n.position.z - fight.z);
    assert.ok(d >= 4 && d <= 6, `a ${d.toFixed(2)} m`);
    assert.ok(sightClear(collisions, 0, n.position.x, n.position.z, fight.x, fight.z), `el kiosco le tapa desde (${n.position.x.toFixed(1)}, ${n.position.z.toFixed(1)})`);
  }
  for (const n of people) n.dispose();
});

test('corrillo: trabado camino a su puesto (alguien quieto encima), no da media vuelta: busca otro puesto o se queda mirando desde ahí', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  const curious = await walker([30, 0, 30], nav, 'estudiante'), still = await walker([20, 0, 50], nav, 'oficinista');
  const s = scene([curious, still]);
  run(s, .2, fight);
  stand(curious, Math.PI / 2); temper(curious, 'curioso');
  stand(still, 0); temper(still, 'indiferente');
  const a = curious.mind.aware, blow = fighting(14, fight);
  let spot = null, turned = false, blocked = 0, closest = Infinity;
  const routes = new Set();
  run(s, 12, fight, t => {
    blow(t);
    // En cuanto elige su puesto, alguien se le planta encima y no se mueve de ahí.
    if (!spot && a.watching) spot = new THREE.Vector3(a.watchX, 0, a.watchZ);
    if (spot) { still.position.copy(spot); still.target = null; still.route = []; still.wait = 1e9; }
    else still.position.set(20, 0, 50);
    if (spot) closest = Math.min(closest, curious.position.distanceTo(still.position));
    if (curious.mind.blockedFor > 0) blocked = Math.max(blocked, curious.mind.blockedFor);
    if (a.watching && curious.target && !routes.has(curious.route)) {
      routes.add(curious.route);
      if (Math.hypot(curious.route.at(-1).x - fight.x, curious.route.at(-1).z - fight.z) > 6.5) turned = true;
    }
  });
  assert.ok(spot, 'eligió un puesto');
  assert.ok(blocked > AVOID.stuckYield, `quedó trabado (${blocked.toFixed(2)} s): la prueba tiene sentido`);
  assert.ok(!turned, 'no dio media vuelta');
  assert.ok(a.watching && !curious.target, 'sigue en el corrillo, quieto en un puesto');
  const d = Math.hypot(curious.position.x - fight.x, curious.position.z - fight.z);
  assert.ok(d >= 4 && d <= 6, `mira desde ${d.toFixed(2)} m`);
  assert.ok(closest >= .5, `no se le echó encima (${closest.toFixed(2)} m)`);
  curious.dispose(); still.dispose();
});

test('corrillo con gente que llega cruzándose, a pasos distintos: llegan a su puesto en 3 a 6 s (alguno, de malas, a 9), sin dar media vuelta ni quedarse trabado', async () => {
  // Seis curiosos a 10 m, tres de cada lado de la pelea. Para quedar juntos unos se cruzan con otros; el último trecho
  // hasta el puesto lo van derecho, y quien queda trabado se queda donde está o busca otro puesto, no se devuelve.
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  const rel = [[9.4, -3.4], [10, 0], [-9.4, 3.4], [-10, 0], [9.4, 3.4], [-9.4, -3.4]];
  for (const walks of [[.77, 1, 1.39, 1.17, .74, 1.24], [.6, .6, .6, .6, .6, .6], [1.3, .6, 1, .9, 1.25, .7]]) {
    const people = [];
    for (const [k, [x, z]] of rel.entries()) {
      const n = await walker([fight.x + x, 0, fight.z + z], nav, 'estudiante');
      n.walkSpeed = walks[k];
      people.push(n);
    }
    const s = scene(people);
    run(s, .2, fight);
    for (const n of people) { stand(n, Math.atan2(fight.x - n.position.x, fight.z - n.position.z)); temper(n, 'curioso'); }
    const arrived = new Map(), routes = new Map();
    let turned = 0;
    const blow = fighting(12, fight);
    run(s, 9, fight, t => {
      blow(t);
      for (const n of people) {
        const a = n.mind.aware;
        if (a.watching && n.target) {
          // Media vuelta: la ruta nueva lo aleja de la pelea.
          if (routes.has(n) && routes.get(n) !== n.route && Math.hypot(n.route.at(-1).x - fight.x, n.route.at(-1).z - fight.z) > 6.5) turned++;
          routes.set(n, n.route);
        }
        if (a.watching && !n.target && !arrived.has(n)) arrived.set(n, t);
      }
    });
    const times = people.map(n => arrived.get(n));
    assert.equal(turned, 0, `${walks}: alguien dio media vuelta`);
    const said = `${walks}: llegaron a los ${times.map(t => t?.toFixed(1)).join(', ')} s`;
    assert.ok(times.every(t => t !== undefined && t >= 2.5 && t <= 9), said);
    assert.ok(times.filter(t => t <= 6.2).length >= 5, said);
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const gap = people[i].position.distanceTo(people[j].position);
      assert.ok(gap >= .9, `${walks}: dos mirones a ${gap.toFixed(2)} m`);
    }
    for (const n of people) n.dispose();
  }
});

test('quien va al corrillo de una pelea del jugador no le saca el cuerpo al que pelea: va derecho a su puesto, sin abrirse', async () => {
  // Al jugador que pelea le tiene recelo y se acuerda de lo que hizo: andando por ahí le deja 3 m o más. Camino a su
  // puesto en el corrillo (a 4,4 m) eso no cuenta: la ruta ya pasa lejos y abrirse lo sacaría de su camino.
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  const people = [];
  for (const [x, z] of [[30, 27], [50, 33], [37, 40]]) people.push(await walker([x, 0, z], nav, 'estudiante'));
  const s = scene(people);
  run(s, .2, fight);
  for (const n of people) { stand(n, Math.atan2(fight.x - n.position.x, fight.z - n.position.z)); temper(n, 'curioso'); }
  const blow = fighting(10, fight), widest = new Map(), arrived = new Map();
  run(s, 8, fight, t => {
    blow(t);
    for (const n of people) {
      const a = n.mind.aware;
      if (a.watching && n.target) widest.set(n, Math.max(widest.get(n) ?? 0, Math.abs(n.mind.side)));
      if (a.watching && !n.target && !arrived.has(n)) arrived.set(n, t);
    }
  });
  assert.ok(people.every(n => n.mind.aware.level >= 2 && n.mind.aware.threat === s.minds._playerAgent), 'le tienen recelo al que pelea');
  for (const n of people) {
    assert.ok(arrived.has(n), 'llegó a su puesto');
    assert.ok((widest.get(n) ?? 0) < .1, `se abrió ${(widest.get(n) ?? 0).toFixed(2)} m de su camino`);
  }
});

test('corrillo junto a la calle: nadie se para en la calzada, todos miran desde el andén, a 4-6 m y a 0,9 m o más del de al lado', async () => {
  // Andén arriba, calzada de 8 m que se puede cruzar (baldosas 14 a 17: z de 27 a 35) y andén abajo. La pelea, a 1 m
  // del borde: la mitad del anillo cae en la calzada. Dos curiosos están en el otro andén, a 1,5 m del borde y a 11 m
  // de la pelea: los puestos de su lado, los que tienen más cerca, caen todos en la calzada, y a los del otro lado no
  // alcanzan a llegar a tiempo. No toman ninguno.
  const nav = navFrom(Array.from({ length: 30 }, (_, row) => (row >= 14 && row < 18 ? 'r' : '.').repeat(40)));
  const fight = new THREE.Vector3(40, 0, 26);
  const spots = [[30, 0, 16], [50, 0, 16], [40, 0, 14], [31, 0, 22], [49, 0, 22], [38, 0, 36.5], [42, 0, 36.5]];
  const people = [];
  for (const at of spots) people.push(await walker(at, nav, 'estudiante'));
  const s = scene(people);
  const player = fight;
  run(s, .2, player);
  for (const npc of people) { stand(npc, Math.atan2(fight.x - npc.position.x, fight.z - npc.position.z)); temper(npc, 'curioso'); }
  // Pelea larga (20 s).
  let t0 = -1, onRoad = 0, standingOnRoad = 0;
  run(s, 20, player, t => {
    if (t - t0 >= 1) { t0 = t; window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: player } } })); }
    for (const n of people) {
      const a = n.mind.aware;
      if (a.watching && nav.nodes[nav.nodeAt(a.watchX, a.watchZ)]?.crossing) onRoad++;
      if (a.watching && !n.target && nav.nodes[nav.nodeAt(n.position.x, n.position.z)]?.crossing) standingOnRoad++;
    }
  });
  // Los que ya están en su puesto (los demás todavía van llegando).
  const watchers = people.filter(n => n.mind.aware.watching && !n.target);
  assert.ok(watchers.length >= 3, `${watchers.length} mirando`);
  assert.equal(onRoad, 0, 'ningún puesto del corrillo en la calzada');
  assert.equal(standingOnRoad, 0, 'nadie se queda mirando parado en la calzada');
  for (const n of people.slice(5)) {
    assert.ok(n.mind.aware.level >= 1, 'los del otro andén la notaron');
    assert.ok(n.position.z > 35, `uno del otro andén quedó en (${n.position.x.toFixed(1)}, ${n.position.z.toFixed(1)})`);
  }
  for (const n of watchers) {
    const id = nav.nodeAt(n.position.x, n.position.z);
    assert.ok(id >= 0 && !nav.nodes[id].crossing, `parado en la calzada en (${n.position.x.toFixed(1)}, ${n.position.z.toFixed(1)})`);
    const d = Math.hypot(n.position.x - fight.x, n.position.z - fight.z);
    assert.ok(d >= 3.9 && d <= 6.1, `a ${d.toFixed(1)} m`);
  }
  for (let i = 0; i < watchers.length; i++) for (let j = i + 1; j < watchers.length; j++) {
    const gap = watchers[i].position.distanceTo(watchers[j].position);
    assert.ok(gap >= .9, `${gap.toFixed(2)} m entre dos mirones`);
  }
});

test('reacción en cadena: primero la cabeza, después el cuerpo y después los pies; el miedoso de una, el curioso un rato después', async () => {
  const results = {};
  for (const tipo of ['miedoso', 'curioso']) {
    const nav = plaza();
    // El testigo, al otro lado del jugador: la víctima huye hacia −X, lejos de él (si no, se quitaría de su camino).
    const victim = await walker([30, 0, 20], nav), witness = await walker([33, 0, 22], nav);
    const s = scene([victim, witness]);
    const player = new THREE.Vector3(31, 0, 20);
    run(s, .2, player);
    stand(victim); stand(witness, Math.atan2(30 - 33, 20 - 22)); // de cara a la víctima: ve el robo
    temper(witness, tipo);
    victim._robadoTimer = 10;
    victim.alarmedByTheft(player);
    const x0 = witness.position.x, z0 = witness.position.z, yaw0 = witness.root.rotation.y;
    let noticed = null, body = null, feet = null;
    run(s, 2, player, t => {
      const a = witness.mind.aware;
      if (noticed === null && a.reaction !== 0) noticed = t;
      if (body === null && Math.abs(Math.atan2(Math.sin(witness.root.rotation.y - yaw0), Math.cos(witness.root.rotation.y - yaw0))) > .02) body = t;
      if (feet === null && Math.hypot(witness.position.x - x0, witness.position.z - z0) > .02) feet = t;
    });
    assert.ok(noticed !== null && body !== null && feet !== null, `${tipo}: ${noticed} ${body} ${feet}`);
    // Mientras tanto la cabeza ya mira al peligro: `gaze` apunta a la amenaza desde que lo notó.
    assert.ok(noticed < body && body < feet, `${tipo}: notó ${noticed.toFixed(2)}, cuerpo ${body.toFixed(2)}, pies ${feet.toFixed(2)}`);
    results[tipo] = feet - noticed;
  }
  assert.ok(results.miedoso >= .12 && results.miedoso <= .22, `miedoso: ${results.miedoso.toFixed(2)} s`);
  assert.ok(results.curioso >= .3 && results.curioso <= .45, `curioso: ${results.curioso.toFixed(2)} s`);
  assert.ok(REACT.startle[0] >= .15 && REACT.startle[1] <= .6);
});

test('huyendo mira atrás cada tanto al principio, sigue mientras el peligro está cerca y para lejos cuando deja de verlo', async () => {
  const nav = plaza();
  const victim = await walker([16, 0, 20], nav);
  victim.walkSpeed = .9; // corre a 2,2 m/s: en los 8 s de siempre no alcanzaría a alejarse 25 m
  const s = scene([victim]);
  const player = new THREE.Vector3(15, 0, 20);
  run(s, .2, player);
  stand(victim);
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  const looks = [];
  let looking = false, stoppedAt = null, stopDistance = null;
  run(s, 25, player, t => {
    const a = victim.mind.aware, now = victim.fleeTimer > 0 && s.minds.time < a.lookBackUntil;
    if (now && !looking) looks.push(t);
    looking = now;
    const d = Math.hypot(victim.position.x - player.x, victim.position.z - player.z);
    if (stoppedAt === null && t > .5 && !(victim.fleeTimer > 0)) { stoppedAt = t; stopDistance = d; }
  });
  assert.ok(looks.length >= 2 && looks[0] < 1.6, `miradas atrás a los ${looks.map(x => x.toFixed(1)).join(', ')} s`);
  for (let k = 1; k < looks.length; k++) assert.ok(looks[k] - looks[k - 1] >= 1.4 && looks[k] - looks[k - 1] <= 2.8, `cada ~2 s: ${looks.map(x => x.toFixed(1)).join(', ')}`);
  assert.ok(looks.at(-1) <= REACT.lookBacks + .5, 'solo al principio');
  assert.ok(stoppedAt !== null, 'no paró de huir');
  assert.ok(stopDistance >= REACT.safe - .5 && stopDistance <= 32, `paró a ${stopDistance?.toFixed(1)} m (a los ${stoppedAt?.toFixed(1)} s)`);
});

test('al huir arranca a correr en 0,3 a 0,5 s, no de golpe', async () => {
  const nav = plaza();
  const victim = await walker([16, 0, 20], nav);
  const s = scene([victim]);
  const player = new THREE.Vector3(15, 0, 20);
  run(s, .2, player);
  stand(victim);
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  const full = victim.walkSpeed * 2.4, speeds = [];
  let last = victim.position.clone();
  run(s, 1, player, t => {
    speeds.push([t, victim.position.distanceTo(last) * 30]);
    last = victim.position.clone();
  }, 1 / 30);
  const first = speeds.find(([, v]) => v > .05), fast = speeds.find(([, v]) => v >= full * .95);
  assert.ok(first && fast, JSON.stringify(speeds.slice(0, 20)));
  assert.ok(first[1] < full * .6, `arrancó a ${first[1].toFixed(2)} m/s de ${full.toFixed(2)}`);
  const ramp = fast[0] - first[0];
  assert.ok(ramp >= .25 && ramp <= .55, `llegó a correr en ${ramp.toFixed(2)} s`);
});

test('con recelo del jugador lo rodea a 3 m o más en vez de pasarle rozando', async () => {
  const nav = plaza();
  const npc = await walker([20, 0, 20], nav);
  const s = scene([npc]);
  const player = new THREE.Vector3(30, 0, 20);
  run(s, .1, player);
  const route = [];
  for (let x = 22; x <= 50; x += 2) route.push(new THREE.Vector3(x, 0, 20));
  npc.route = route; npc.routeIndex = 0; npc.target = route[0]; npc.wait = 0;
  // Lo vio hacer algo malo hace un momento.
  const a = npc.mind.aware;
  a.alarm = .5; a.level = 2; a.threat = s.minds._playerAgent; a.threatAt = 0; a.lastStimulus = s.minds.time;
  npc.mind.playerRoom = REACT.wary;
  let closest = Infinity;
  run(s, 40, player, () => { closest = Math.min(closest, Math.hypot(npc.position.x - player.x, npc.position.z - player.z)); return npc.position.x < 49; });
  assert.ok(closest >= 2.8, `pasó a ${closest.toFixed(2)} m`);
});

test('de noche ve menos: el robo a 12 m de frente lo nota de día y no de noche', async () => {
  const results = {};
  for (const night of [false, true]) {
    const nav = plaza();
    const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 32], nav);
    const district = { npcs: [victim, witness], trafficPedestrians: [victim, witness], busServices: [{ night }] };
    const s = { district, minds: new StreetMinds(district) };
    const player = new THREE.Vector3(31, 0, 20);
    run(s, .2, player);
    stand(victim); stand(witness, Math.PI);
    temper(witness, 'curioso');
    // Algo que no hace ruido y solo se ve: un robo que el juego da por visto, sin el grito de la víctima.
    s.minds.emit('robo', victim.position.x, victim.position.z, 0, 1, s.minds._playerAgent);
    run(s, 2, player);
    results[night ? 'noche' : 'dia'] = witness.mind.aware.level;
  }
  assert.ok(results.dia >= 1, JSON.stringify(results));
  assert.equal(results.noche, 0, JSON.stringify(results));
});

test('la mirada gira suave, no pasa de 70° y vuelve al frente al acabar', async () => {
  const nav = plaza();
  const npc = await walker([30, 0, 20], nav);
  const s = scene([npc]);
  const player = new THREE.Vector3(30, 0, 50);
  run(s, .1, player);
  stand(npc, 0);
  const a = npc.mind.aware;
  a.lookAt(40, 21, 1.5); // casi 90° a la izquierda
  let max = 0, jump = 0, last = 0;
  const values = [];
  run(s, 3, player, () => {
    const g = npc.mind.gaze(null) ?? 0;
    values.push(g);
    max = Math.max(max, Math.abs(g));
    jump = Math.max(jump, Math.abs(g - last));
    last = g;
  });
  assert.ok(max <= REACT.gazeMax + .02, `giró ${max.toFixed(2)} rad`);
  assert.ok(max > 1, 'llegó a mirar');
  assert.ok(jump < .15, `saltó ${jump.toFixed(3)} rad en un cuadro`);
  assert.equal(npc.mind.gaze(null), null, 'volvió al frente');
});

test('a lo lejos, animado cada 0,1 s, la cabeza va y vuelve igual de rápido que de cerca', async () => {
  const times = {};
  for (const every of [1, 6]) {
    const nav = plaza();
    const npc = await walker([30, 0, 20], nav);
    const s = scene([npc]);
    const player = new THREE.Vector3(30, 0, 50);
    run(s, .1, player);
    stand(npc, 0);
    npc.mind.aware.lookAt(40, 21, 1); // casi 90° a la izquierda, un segundo
    // Npc pide la mirada solo cuando se anima: de cerca cada cuadro; pasados 20 m de la cámara, cada 6 cuadros.
    let frame = 0, peak = 0, back = null;
    run(s, 4, player, t => {
      if (frame++ % every) return;
      const g = npc.mind.gaze(null);
      peak = Math.max(peak, Math.abs(g ?? 0));
      if (back === null && t > 1 && g === null) back = t;
    }, 1 / 60);
    times[every] = { peak, back };
  }
  assert.ok(times[6].peak > 1, `de lejos llegó a girar ${times[6].peak.toFixed(2)} rad`);
  assert.ok(times[1].back !== null && times[6].back !== null, JSON.stringify(times));
  assert.ok(Math.abs(times[6].back - times[1].back) < .35, `volvió al frente a los ${times[1].back.toFixed(2)} s de cerca y ${times[6].back.toFixed(2)} s de lejos`);
});

test('percibir y reaccionar no gastan el azar del juego', async () => {
  const nav = plaza();
  const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 28], nav);
  const s = scene([victim, witness]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI);
  temper(witness, 'miedoso');
  let calls = 0;
  const seeded = Math.random;
  const wrap = (obj, name) => {
    const original = obj[name].bind(obj);
    obj[name] = (...args) => { Math.random = () => { calls++; return seeded(); }; try { return original(...args); } finally { Math.random = seeded; } };
  };
  wrap(witness.mind.aware, 'perceive'); wrap(witness.mind.aware, 'hold'); wrap(witness.mind.aware, 'fleeSmart');
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  run(s, 4, player);
  assert.ok(witness.mind.aware.level >= 2 || witness.fleeTimer > 0, 'reaccionó');
  assert.equal(calls, 0, `${calls} llamadas a Math.random`);
});

test('la sirena suena solo si la patrulla persigue con ella prendida (car.pursuit), no por estar en persecución', () => {
  const s = scene([]);
  const sirens = () => { let n = 0; for (let i = 0; i < Math.min(s.minds.bus.count, 64); i++) if (s.minds.bus.kind[i] === 'sirena') n++; return n; };
  const patrol = (x, pursuit) => ({ police: true, state: 'chase', car: { position: new THREE.Vector3(x, 0, 0), pursuit } });
  // Los agentes se bajaron a pie: sigue en persecución, pero con la sirena apagada.
  const parked = patrol(10, false);
  s.minds.beginFrame(1, null, [parked]);
  s.minds.beginFrame(1, null, [parked]);
  assert.equal(sirens(), 0, 'sin sirena prendida no hay nada que oír');
  // La que persigue con la sirena prendida suena una vez por segundo.
  const chasing = patrol(20, true);
  s.minds.beginFrame(1, null, [parked, chasing]);
  assert.equal(sirens(), 1);
  assert.equal(s.minds.bus.x[0], 20);
  assert.equal(s.minds.bus.origin[0], chasing);
  // Un carro particular nunca suena, aunque algo le marque `pursuit`.
  s.minds.beginFrame(1, null, [{ police: false, state: 'patrol', car: { position: new THREE.Vector3(30, 0, 0), pursuit: true } }]);
  assert.equal(sirens(), 1);
});

test('una subclase de Npc (un agente a pie, el escuadrón) no tiene mente: no huye, no recela ni se entera del chisme', async () => {
  const nav = plaza();
  class Agente extends Npc {}
  const agent = new Agente(new THREE.Scene(), new THREE.Vector3(30, 0, 20), {
    navigation: nav, facing: 0, groundHeight: () => 0, isWalkable: (x, z) => nav.isWalkableAt(x, z)
  });
  await agent.ready;
  const witness = await walker([31, 0, 20], nav);
  const s = scene([agent, witness]);
  const player = new THREE.Vector3(34, 0, 20);
  run(s, .2, player);
  assert.equal(agent.person, null, 'una subclase no tiene arquetipo');
  assert.equal(agent.mind, null, 'sin arquetipo no hay mente');
  assert.ok(witness.mind, 'el peatón de al lado sí piensa');
  assert.equal(s.minds.minds.length, 1);
  // Al lado de alguien que se acuerda de un robo, el agente no se entera; sigue siendo un obstáculo para los demás.
  witness.mind.aware.memory.remember('robo', 1, s.minds.time);
  stand(witness);
  run(s, 3, player);
  assert.equal(agent.mind, null);
  assert.ok(s.minds.grid.agents.includes(agent), 'los demás lo ven y lo esquivan');
});

test('los turnos de pensar siguen repartidos tras los tirones: nunca más de 16 en un cuadro y nadie pasa dos turnos sin pensar', () => {
  const npcs = Array.from({ length: 80 }, (_, i) => ({
    person: { arquetipo: 'oficinista' }, position: new THREE.Vector3(i % 10, 0, Math.floor(i / 10)), root: { rotation: { y: 0 } }
  }));
  const minds = new StreetMinds({ npcs, trafficPedestrians: npcs });
  const player = new THREE.Vector3(5, 0, 5); // todos cerca: piensan 4,5 veces por segundo
  const last = new Map();
  let most = 0, steady = 0, longest = 0;
  for (let frame = 0; frame < 60 * 30; frame++) {
    // A 60 cuadros por segundo, con un cuadro de 0,1 s cada 3 s (otra pestaña, un modelo que carga, un GC grande).
    minds.beginFrame(frame % 180 === 179 ? .1 : 1 / 60, player);
    let thinking = 0;
    for (const mind of minds.minds) {
      if (!mind.thinking) continue;
      thinking++;
      if (last.has(mind)) longest = Math.max(longest, minds.time - last.get(mind));
      last.set(mind, minds.time);
    }
    most = Math.max(most, thinking);
    // Pasados unos cuadros del tirón, cada uno vuelve a su turno: se reparten como antes (80 en 0,22 s, unos 6 por cuadro).
    if (frame > 180 && (frame + 1) % 180 > 4) steady = Math.max(steady, thinking);
  }
  assert.equal(last.size, 80, 'todos pensaron');
  assert.ok(most <= MIND.perFrame && MIND.perFrame <= 16, `${most} pensaron en un mismo cuadro`);
  assert.ok(steady <= 10, `lejos de los tirones, ${steady} pensaron en un mismo cuadro: se amontonaron`);
  assert.ok(longest <= 2 * MIND.tick, `alguien pasó ${longest.toFixed(2)} s sin pensar`);
});

test('sentado en la banca no se mueve por miedo: mira desde su sitio, sin meterse en el espaldar ni salir corriendo', async () => {
  const nav = plaza();
  // Mira hacia +Z; el espaldar le queda 20 cm detrás.
  const collisions = solids([box(29, 19.6, 31, 19.8, 1.1)]);
  const seated = await walker([30, 0, 20], nav, 'senora', { fijo: { stance: 'banca' }, collisions });
  const victim = await walker([33, 0, 24], nav);
  const s = scene([seated, victim]);
  const player = new THREE.Vector3(34, 0, 24);
  run(s, .3, player);
  stand(victim);
  victim.position.set(33, 0, 24);
  temper(seated, 'miedoso');
  const home = seated.position.clone();
  // Un raponazo a 5 m, de frente y algo a la derecha: lo ve y lo oye.
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  let moved = 0, inside = 0, scared = false, looked = 0;
  run(s, 4, player, () => {
    moved = Math.max(moved, Math.hypot(seated.position.x - home.x, seated.position.z - home.z));
    if (solidAt(collisions, seated.position.x, 0, seated.position.z)) inside++;
    if (seated.mind.aware.level === 3) scared = true;
    looked = Math.max(looked, Math.abs(seated.mind.gaze(seated.stance) ?? 0));
  });
  assert.ok(scared, 'se asustó');
  assert.ok(moved < .02, `se corrió ${moved.toFixed(2)} m sentado`);
  assert.equal(inside, 0, 'se metió en el espaldar');
  assert.equal(seated.stance, 'banca');
  assert.equal(seated.fleeTimer, 0, 'no salió corriendo');
  assert.ok(looked > .3, `volteó a mirar ${looked.toFixed(2)} rad`);
});

test('de pie, el paso atrás no atraviesa un poste: se aparta hacia el lado libre; sin sitio a ningún lado, se queda', async () => {
  for (const boxed of [false, true]) {
    const nav = plaza();
    // Mira hacia +Z, hacia el robo. Un poste de 24 cm le queda 35 cm detrás; encajonado, también hay muros a los lados.
    const list = [box(29.88, 19.53, 30.12, 19.77)];
    if (boxed) list.push(box(29.3, 18, 29.5, 21), box(30.5, 18, 30.7, 21));
    const collisions = solids(list);
    const witness = await walker([30, 0, 20], nav, 'senora', { collisions });
    const victim = await walker([30, 0, 26], nav);
    const s = scene([witness, victim]);
    const player = new THREE.Vector3(31, 0, 26);
    run(s, .3, player);
    stand(witness, 0); stand(victim);
    witness.position.set(30, 0, 20); victim.position.set(30, 0, 26);
    temper(witness, 'miedoso');
    const start = witness.position.clone();
    victim._robadoTimer = 10;
    victim.alarmedByTheft(player);
    let backed = false, moved = 0, inside = 0;
    run(s, 3, player, () => {
      if (witness.mind.aware.reaction !== 1) return;
      backed = true;
      moved = Math.max(moved, Math.hypot(witness.position.x - start.x, witness.position.z - start.z));
      if (solidAt(collisions, witness.position.x, 0, witness.position.z)) inside++;
    });
    assert.ok(backed, 'reaccionó con el paso atrás');
    assert.equal(inside, 0, `${boxed ? 'encajonado' : 'con el poste'}: ${inside} cuadros dentro de algo sólido`);
    if (boxed) assert.ok(moved < .02, `encajonado se movió ${moved.toFixed(2)} m`);
    else assert.ok(moved > .3, `no se apartó (${moved.toFixed(2)} m)`);
  }
});

test('de pie en el borde del andén, el paso atrás no se sale de la red: se aparta de lado', async () => {
  // La fila de arriba (z < 1) no es andén; el testigo está a 30 cm del borde, de espaldas a él.
  const nav = navFrom(['#'.repeat(30), ...Array.from({ length: 19 }, () => '.'.repeat(30))]);
  const witness = await walker([30, 0, 1.3], nav, 'senora');
  const victim = await walker([30, 0, 7], nav);
  const s = scene([witness, victim]);
  const player = new THREE.Vector3(31, 0, 7);
  run(s, .3, player);
  stand(witness, 0); stand(victim);
  witness.position.set(30, 0, 1.3); victim.position.set(30, 0, 7);
  temper(witness, 'miedoso');
  const start = witness.position.clone();
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  let backed = false, moved = 0, offNet = 0;
  run(s, 3, player, () => {
    if (witness.mind.aware.reaction !== 1) return;
    backed = true;
    moved = Math.max(moved, Math.hypot(witness.position.x - start.x, witness.position.z - start.z));
    if (!nav.isWalkableAt(witness.position.x, witness.position.z)) offNet++;
  });
  assert.ok(backed);
  assert.equal(offNet, 0, 'se salió de la red');
  assert.ok(moved > .3, `no se apartó (${moved.toFixed(2)} m)`);
});

test('el vendedor atiende su puesto: no tiene mente aunque tenga arquetipo', async () => {
  const nav = plaza();
  const seller = await walker([30, 0, 20], nav, 'vendedor', { fijo: { stance: 'atender' } });
  seller.isVendor = true; // como Bogota._vendor
  const other = await walker([34, 0, 20], nav);
  const s = scene([seller, other]);
  run(s, .2, new THREE.Vector3(32, 0, 22));
  assert.ok(seller.person, 'tiene arquetipo');
  assert.equal(seller.mind, null);
  assert.deepEqual(s.minds.minds.map(m => m.npc), [other]);
});

/** Un audio de mentira con lo que usa NpcConversations: cargado, suena hasta que se para. */
class FakeSound {
  constructor() { this.id = 0; this.playingId = null; this.unloaded = false; }
  state() { return 'loaded'; }
  play() { this.playingId = ++this.id; return this.playingId; }
  playing(id) { return this.playingId === id; }
  stop(id) { if (this.playingId === id) this.playingId = null; }
  volume() {}
  duration() { return 3; }
  unload() { this.unloaded = true; }
}

test('quien conversa y reacciona (se asusta o se arrima a mirar) deja la charla: se corta para los dos, se calla la voz y nadie sigue hablando solo', async () => {
  for (const caso of ['susto', 'corrillo']) {
    const nav = plaza();
    const a = await walker([20, 0, 20], nav), b = await walker([22, 0, 20], nav);
    const s = scene([a, b]);
    const player = new THREE.Vector3(20, 0, 26);
    run(s, .2, player);
    stand(a, Math.PI / 2); stand(b, -Math.PI / 2);
    temper(a, caso === 'susto' ? 'miedoso' : 'curioso'); temper(b, 'indiferente');
    const conversation = {
      id: 'prueba', hablantes: { A: { sexo: npcSexo(a) }, B: { sexo: npcSexo(b) } },
      lineas: [{ hablante: 'A', texto: 'Uno.', file: 'a1' }, { hablante: 'B', texto: 'Dos.', file: 'b1' }, { hablante: 'A', texto: 'Tres.', file: 'a2' }]
    };
    const sounds = [];
    const talks = new NpcConversations({ conversations: [conversation], random: () => 0, load: () => { const x = new FakeSound(); sounds.push(x); return x; } });
    let ms = 0;
    const talking = () => { ms += 1000 / 30; talks.update(player, [a, b], ms); };
    run(s, 2.5, player, talking);
    const speaker = [a, b].find(n => n._bubbleTimer > 0);
    assert.ok(a.talk && b.talk && sounds.some(x => x.playingId) && speaker, `${caso}: conversan y uno tiene la palabra, con su frase en pantalla`);
    // Una pelea: a 3 m del miedoso, o a 12 m del curioso (se arrima a mirar). Al indiferente no le hace nada.
    const fighter = { position: caso === 'susto' ? new THREE.Vector3(17, 0, 20) : new THREE.Vector3(21, 0, 32) };
    let reactedAt = null, endedAt = null, backed = false, frames = 0, alone = false;
    run(s, 3, player, t => {
      if (frames++ % 30 === 0) window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: fighter } }));
      // Ya en el cuadro en que se va, antes de que el sistema de conversaciones lo note, el otro no queda en la charla.
      if (!a.talk && b.talk) alone = true;
      talking();
      const aware = a.mind.aware;
      if (aware.reaction === 1) backed = true;
      if (reactedAt === null && (aware.reaction !== 0 || aware.watching)) reactedAt = t;
      if (endedAt === null && !talks.busy) endedAt = t;
    });
    assert.ok(reactedAt !== null, `${caso}: reaccionó`);
    assert.ok(endedAt !== null && endedAt - reactedAt <= 1 / 15 + 1e-9, `${caso}: la charla siguió ${(endedAt - reactedAt).toFixed(2)} s después de reaccionar`);
    assert.equal(a.talk, null); assert.equal(b.talk, null);
    assert.ok(!alone, `${caso}: el otro se quedó un cuadro en la charla, hablando solo`);
    assert.ok(sounds.every(x => x.playingId === null && x.unloaded), `${caso}: la voz se calló y se soltaron los audios`);
    assert.ok(!(speaker._bubbleTimer > 0), `${caso}: la frase de quien hablaba se borró`);
    if (caso === 'susto') {
      assert.ok(backed, 'retrocedió de cara al peligro');
      assert.ok(a.fleeTimer > 0 || Math.hypot(a.position.x - 17, a.position.z - 20) > 6, 'y se fue');
    } else {
      assert.ok(a.mind.aware.watching, 'se fue a mirar la pelea');
      assert.ok(Math.hypot(a.position.x - 21, a.position.z - 32) < 9.5, 'y ya va para allá');
    }
    // El otro no se queda en la charla: sigue con lo suyo.
    assert.notEqual(b.stance, 'hablar');
    a.dispose(); b.dispose();
  }
});

test('quien va a mirar una pelea o ya la está mirando no se pone a conversar: está pendiente de otra cosa', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  // Dos curiosos juntos a 10 m de la pelea; el jugador es quien pelea y los tiene a menos de 8 m al llegar.
  const a = await walker([30, 0, 30], nav), b = await walker([30, 0, 32], nav);
  const s = scene([a, b]);
  run(s, .2, fight);
  for (const n of [a, b]) { stand(n, Math.PI / 2); temper(n, 'curioso'); }
  const conversation = {
    id: 'prueba', hablantes: { A: { sexo: npcSexo(a) }, B: { sexo: npcSexo(b) } },
    lineas: [{ hablante: 'A', texto: 'Uno.', file: 'a1' }, { hablante: 'B', texto: 'Dos.', file: 'b1' }]
  };
  const talks = new NpcConversations({ conversations: [conversation], random: () => 0, load: () => new FakeSound() });
  let ms = 0, talkedWatching = 0, watched = 0;
  const blow = fighting(10, fight);
  run(s, 10, fight, t => {
    blow(t);
    ms += 1000 / 30;
    talks.update(fight, [a, b], ms);
    for (const n of [a, b]) if (n.mind.aware.watching) { watched++; if (n.talk) talkedWatching++; }
  });
  assert.ok(watched > 0 && a.mind.aware.watching && b.mind.aware.watching, 'los dos se fueron a mirar');
  assert.equal(talkedWatching, 0, 'nadie conversó mientras miraba');
  assert.ok(!talks.busy, 'no arrancó ninguna charla');
  a.dispose(); b.dispose();
});

test('el miedoso ante una pelea la mira de lejos, a 8 a 10 m, o se va; el indiferente sigue de largo mirando de reojo, sin aflojar el paso', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  // Dos miedosos a 9 y 13 m que la miran de lejos, uno a 6 m que también querría pero le queda cerca, y uno que se va.
  const far9 = await walker([31, 0, 30], nav, 'senora'), far13 = await walker([40, 0, 43], nav, 'senora');
  const near6 = await walker([46, 0, 30], nav, 'senora'), leaves = await walker([40, 0, 19], nav, 'senora');
  // El indiferente pasa caminando a 7 m.
  const passer = await walker([30, 0, 37], nav, 'oficinista');
  const people = [far9, far13, near6, leaves, passer];
  const s = scene(people);
  run(s, .2, fight);
  for (const n of [far9, far13, near6, leaves]) {
    stand(n, Math.atan2(fight.x - n.position.x, fight.z - n.position.z));
    n.mind.temper = { ...n.mind.temper, ...TEMPERS.miedoso, tipo: 'miedoso', far: n === leaves ? 0 : 1 };
  }
  temper(passer, 'indiferente');
  const route = [];
  for (let x = 32; x <= 56; x += 2) route.push(new THREE.Vector3(x, 0, 37));
  passer.route = route; passer.routeIndex = 0; passer.target = route[0]; passer.wait = 0; passer.stance = null;
  const blow = fighting(10, fight);
  let closest = { far9: Infinity, far13: Infinity }, glanced = 0, looking = 0, minPace = 1, passerWatched = false;
  const fled = new Set();
  run(s, 10, fight, t => {
    blow(t);
    for (const [key, n] of [['far9', far9], ['far13', far13]]) {
      const a = n.mind.aware;
      if (a.watching && !n.target) closest[key] = Math.min(closest[key], Math.hypot(n.position.x - fight.x, n.position.z - fight.z));
    }
    for (const n of people) if (n.fleeTimer > 0) fled.add(n);
    const g = passer.mind.gaze(null);
    if (g !== null && Math.abs(g) > .3) looking++;
    if (t > 1 && t < 6) { glanced++; minPace = Math.min(minPace, passer.mind.paceFactor()); }
    if (passer.mind.aware.watching) passerWatched = true;
  });
  for (const [key, n] of [['far9', far9], ['far13', far13]]) {
    const a = n.mind.aware, d = Math.hypot(n.position.x - fight.x, n.position.z - fight.z);
    assert.ok(a.watching && a.watchFar && !n.target, `${key}: mira de lejos`);
    assert.ok(d >= 8 && d <= 10 && closest[key] >= 8, `${key}: a ${d.toFixed(1)} m (lo más cerca, ${closest[key].toFixed(1)})`);
    assert.ok(angleTo(n, fight) < .35, `${key}: de cara a la pelea`);
    assert.ok(!fled.has(n), `${key}: no huyó`);
  }
  assert.ok(fled.has(near6) && !near6.mind.aware.watching, 'a 6 m no se queda: huye');
  assert.ok(fled.has(leaves) && Math.hypot(leaves.position.x - fight.x, leaves.position.z - fight.z) > 14, 'el que no quiere mirar se va');
  assert.equal(passerWatched, false, 'el indiferente no se arrima');
  assert.equal(minPace, 1, `el indiferente no afloja (ritmo ${minPace.toFixed(2)})`);
  assert.ok(looking > 0 && looking < glanced, 'mira de reojo: a ratos, no todo el tiempo');
  assert.ok(passer.position.x > 41, `siguió su camino (x = ${passer.position.x.toFixed(1)})`);
});

test('asustado en plena calzada no se queda ahí: sale al andén que no lo acerca al peligro (sigue o se devuelve) y ahí reacciona', async () => {
  // Andén arriba (z 0..6), calzada que se cruza (z 8..16) y andén abajo (z 18..). Cruza de arriba abajo por x = 20.
  const map = Array.from({ length: 14 }, (_, z) => Array.from({ length: 30 }, () => (z >= 4 && z <= 8 ? 'road' : 'sidewalk')));
  // La pelea, a 4 m de la cebra: a unos 9 m de él en mitad de la calzada y a menos de 16 m del andén por el que sale.
  for (const [caso, fighterZ, exitZ] of [['peligro adelante', 20, 'atras'], ['peligro atrás', 4, 'adelante']]) {
    const nav = new PedestrianNavigation(map, 2, { isCrossing: x => x === 10 });
    const npc = await walker([20, 0, 2], nav, 'senora');
    const route = [];
    for (let z = 4; z <= 24; z += 2) route.push(new THREE.Vector3(20, 0, z));
    npc.route = route; npc.routeIndex = 0; npc.target = route[0]; npc.wait = 0; npc.stance = null;
    const s = scene([npc]);
    const player = new THREE.Vector3(24, 0, fighterZ);
    run(s, 1 / 30, player);
    temper(npc, 'miedoso');
    npc.mind.temper.far = 0;
    const onRoad = () => nav.nodes[nav.nodeAt(npc.position.x, npc.position.z)]?.crossing;
    // Cruza hasta la mitad de la calzada.
    run(s, 20, player, () => npc.position.z < 12);
    assert.ok(onRoad() && npc.mind.crossing.state === 2, `${caso}: va cruzando`);
    const z0 = npc.position.z;
    let still = 0, worstStill = 0, reactedOnRoad = false, reacted = null, last = npc.position.clone(), frames = 0;
    run(s, 6, player, t => {
      if (frames++ % 30 === 0) window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: player } } }));
      const step = npc.position.distanceTo(last);
      last.copy(npc.position);
      if (onRoad()) {
        still = step < .2 / 30 ? still + 1 / 30 : 0;
        worstStill = Math.max(worstStill, still);
        if (npc.mind.aware.reaction !== 0) reactedOnRoad = true;
      } else if (reacted === null && (npc.mind.aware.reaction !== 0 || npc.fleeTimer > 0)) reacted = { t, z: npc.position.z };
    });
    assert.ok(worstStill < .1, `${caso}: quieto en la calzada ${worstStill.toFixed(2)} s`);
    assert.equal(reactedOnRoad, false, `${caso}: reaccionó en plena calzada`);
    assert.ok(reacted, `${caso}: ya en el andén, reaccionó`);
    // Salió por el lado que no lo acerca al peligro.
    if (exitZ === 'atras') assert.ok(reacted.z < z0 && reacted.z <= 7.5, `${caso}: se devolvió (salió en z = ${reacted.z.toFixed(1)})`);
    else assert.ok(reacted.z > z0 && reacted.z >= 16.5, `${caso}: terminó de cruzar (salió en z = ${reacted.z.toFixed(1)})`);
    npc.dispose();
  }
});

test('huyendo a su paso de siempre, para lejos: pasados 25 m y 3 s sin ver el peligro, no sigue corriendo hasta que se le acabe la huida', async () => {
  const nav = plaza();
  const victim = await walker([16, 0, 20], nav); // 1,3 m/s: corre a 3,1 m/s
  const s = scene([victim]);
  const player = new THREE.Vector3(15, 0, 20);
  run(s, .2, player);
  stand(victim);
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  run(s, .5, player);
  victim.fleeTimer = 30; // una huida larga: si para, es por la distancia
  let stoppedAt = null, stopDistance = null;
  run(s, 25, player, t => {
    if (stoppedAt === null && !(victim.fleeTimer > 0)) { stoppedAt = t; stopDistance = Math.hypot(victim.position.x - player.x, victim.position.z - player.z); }
  });
  assert.ok(stoppedAt !== null, 'siguió huyendo los 30 s');
  assert.ok(stopDistance >= REACT.safe - .5 && stopDistance <= 36, `paró a ${stopDistance.toFixed(1)} m (a los ${stoppedAt.toFixed(1)} s)`);
  assert.ok(stoppedAt < 15, `paró a los ${stoppedAt.toFixed(1)} s`);
});

test('quien se está parando del piso cuando se asusta no retrocede ni huye todavía: mira desde ahí', async () => {
  const nav = plaza();
  const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 25], nav, 'senora');
  const s = scene([victim, witness]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI);
  temper(witness, 'miedoso');
  // Se estaba levantando de agacharse (Npc._stopCowering): todavía no tiene la cadera arriba.
  witness._riseLeft = 5;
  const start = witness.position.clone();
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  let flinched = false, backed = false;
  run(s, REACT.flinch - .2, player, () => {
    if (witness.mind.aware.reaction === 3) flinched = true;
    if (witness.mind.aware.reaction === 1) backed = true;
  });
  assert.ok(flinched && !backed, 'se quedó mirando');
  assert.ok(witness.position.distanceTo(start) < .02, 'no se movió');
});

test('de pie, el paso atrás mira cada cuadro: si algo se le atraviesa a medio retroceso, no se mete en ello', async () => {
  const nav = plaza();
  const boxes = [];
  const collisions = solids(boxes);
  const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 24], nav, 'senora', { collisions });
  const s = scene([victim, witness]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI);
  temper(witness, 'miedoso');
  witness.mind.temper.far = 0;
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  run(s, 2, player, () => witness.mind.aware.reaction !== 1 || witness.mind.system.time < witness.mind.aware.reactionAt);
  assert.equal(witness.mind.aware.reaction, 1, 'empezó a retroceder');
  // Ya decidido hacia dónde, aparece algo justo detrás (un carro que se parquea, otro puesto).
  const a = witness.mind.aware, p = witness.position;
  const cx = p.x + a.backX * .75, cz = p.z + a.backZ * .75;
  boxes.push(box(cx - .3, cz - .3, cx + .3, cz + .3));
  assert.ok(!solidAt(collisions, p.x, 0, p.z), 'todavía no lo toca');
  let inside = 0;
  run(s, 1, player, () => { if (solidAt(collisions, witness.position.x, 0, witness.position.z)) inside++; });
  assert.equal(inside, 0, 'se metió en lo que se le atravesó');
});

test('empujado dentro de un poste, el paso atrás lo saca: estar ya dentro no le cierra la salida', async () => {
  const nav = plaza();
  // El poste le queda justo encima: lo empujaron dentro (el cuerpo mide 20 cm de radio).
  const collisions = solids([box(29.9, 24.1, 30.1, 24.3)]);
  const victim = await walker([30, 0, 20], nav), witness = await walker([30, 0, 24], nav, 'senora', { collisions });
  const s = scene([victim, witness]);
  const player = new THREE.Vector3(31, 0, 20);
  run(s, .2, player);
  stand(victim); stand(witness, Math.PI);
  temper(witness, 'miedoso');
  witness.mind.temper.far = 0;
  assert.ok(solidAt(collisions, witness.position.x, 0, witness.position.z), 'empieza dentro del poste');
  victim._robadoTimer = 10;
  victim.alarmedByTheft(player);
  let backed = false;
  run(s, 2, player, () => { if (witness.mind.aware.reaction === 1) backed = true; });
  assert.ok(backed, 'retrocedió');
  assert.ok(!solidAt(collisions, witness.position.x, 0, witness.position.z) || witness.fleeTimer > 0, 'salió del poste');
  assert.ok(Math.hypot(witness.position.x - 30, witness.position.z - 24) > .3, 'se movió');
});

test('un atropello no es culpa del jugador que pasaba al lado: solo cuenta como suyo el golpe que dio él', async () => {
  for (const by of ['carro', 'jugador']) {
    const nav = plaza();
    const hit = await walker([30, 0, 20], nav), witness = await walker([30, 0, 26], nav, 'vendedor');
    const s = scene([hit, witness]);
    const player = new THREE.Vector3(31.5, 0, 20); // a 1,5 m del golpeado
    run(s, .2, player);
    stand(hit, Math.PI / 2); stand(witness, Math.PI);
    temper(witness, 'avisador');
    const reports = [];
    window.addEventListener('npc-police-report', e => reports.push(e.detail));
    // Como TrafficSystem al atropellar (sin atacante) o como el golpe del jugador (MeleeCombat, con atacante).
    if (by === 'carro') hit.takeHit({ damage: 10, dir: { x: -1, z: 0 }, knockback: 2, weapon: 'carro' });
    else hit.takeHit({ damage: 10, attacker: { position: player }, weapon: 'punos', attackId: 1 });
    run(s, 2, player);
    const victimGrudge = hit.mind.aware.memory.grudge(s.minds.time), witnessGrudge = witness.mind.aware.memory.grudge(s.minds.time);
    if (by === 'carro') {
      assert.equal(victimGrudge, 0, 'el atropellado no culpa al jugador');
      assert.equal(witnessGrudge, 0, 'el testigo tampoco');
      assert.equal(reports.length, 0, 'nadie llama a la policía por el jugador');
    } else {
      assert.ok(victimGrudge > .5 && witnessGrudge > 0, 'el golpe del jugador sí se recuerda');
      assert.equal(reports.length, 1);
    }
    hit.dispose(); witness.dispose();
  }
});

test('reciclado en otra calle (relocate) la mente vuelve a empezar: sin corrillo, susto ni cruce a medias; recuerda lo que vio', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  const npc = await walker([31, 0, 30], nav, 'estudiante');
  const s = scene([npc]);
  run(s, .2, fight);
  stand(npc, Math.PI / 2);
  temper(npc, 'curioso');
  const blow = fighting(6, fight);
  run(s, 6, fight, blow);
  const a = npc.mind.aware, scene0 = a.watching;
  assert.ok(scene0 && scene0.watchers === 1, 'mira la pelea');
  npc.mind.aware.memory.remember('pelea', 1, s.minds.time);
  // Lo que haría PedestrianCrowd al reciclarlo: lo pone en otra parte con otra ruta y le reinicia la mente.
  npc.position.set(10, 0, 10);
  npc.route = [new THREE.Vector3(12, 0, 10), new THREE.Vector3(20, 0, 10)]; npc.routeIndex = 0; npc.target = npc.route[0]; npc.wait = 0;
  npc.mind.reset();
  assert.equal(a.watching, null);
  assert.equal(scene0.watchers, 0, 'soltó su puesto del corrillo');
  assert.equal(a.reaction, 0); assert.equal(a.level, 0); assert.equal(npc.mind.side, 0); assert.equal(npc.mind.crossing.state, 0);
  assert.ok(a.memory.grudge(s.minds.time) > 0, 'es la misma persona: se acuerda');
  run(s, 3, fight);
  assert.ok(npc.position.x > 13, `sigue su ruta nueva (x = ${npc.position.x.toFixed(1)})`);
});

test('reciclado mientras conversa: la charla se corta para los dos, sin nadie hablando solo', async () => {
  const nav = plaza();
  const a = await walker([20, 0, 20], nav), b = await walker([22, 0, 20], nav);
  const s = scene([a, b]);
  const player = new THREE.Vector3(20, 0, 26);
  run(s, .2, player);
  stand(a, Math.PI / 2); stand(b, -Math.PI / 2);
  const conversation = {
    id: 'prueba', hablantes: { A: { sexo: npcSexo(a) }, B: { sexo: npcSexo(b) } },
    lineas: [{ hablante: 'A', texto: 'Uno.', file: 'a1' }, { hablante: 'B', texto: 'Dos.', file: 'b1' }, { hablante: 'A', texto: 'Tres.', file: 'a2' }]
  };
  const sounds = [];
  const talks = new NpcConversations({ conversations: [conversation], random: () => 0, load: () => { const x = new FakeSound(); sounds.push(x); return x; } });
  let ms = 0;
  const talking = () => { ms += 1000 / 30; talks.update(player, [a, b], ms); };
  run(s, 2.5, player, talking);
  assert.ok(a.talk && b.talk && talks.busy, 'conversan');
  // PedestrianCrowd lo recicla en otra calle.
  a.position.set(10, 0, 10);
  a.route = [new THREE.Vector3(12, 0, 10), new THREE.Vector3(20, 0, 10)]; a.routeIndex = 0; a.target = a.route[0]; a.wait = 0;
  a.mind.reset();
  assert.equal(a.talk, null); assert.equal(b.talk, null, 'el otro no se queda hablando solo');
  assert.ok(!(a._bubbleTimer > 0) && !(b._bubbleTimer > 0), 'las frases se borraron');
  talking();
  assert.ok(!talks.busy, 'la conversación terminó');
  assert.ok(sounds.every(x => x.playingId === null), 'la voz se calló');
  a.dispose(); b.dispose();
});

test('escondido (fuera de district.npcs) no piensa ni ocupa un puesto del corrillo; al volver piensa otra vez', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  const a = await walker([31, 0, 30], nav, 'estudiante'), b = await walker([49, 0, 30], nav, 'estudiante');
  const s = scene([a, b]);
  run(s, .2, fight);
  for (const n of [a, b]) { stand(n, Math.atan2(fight.x - n.position.x, fight.z - n.position.z)); temper(n, 'curioso'); }
  const blow = fighting(10, fight);
  run(s, 2, fight, blow);
  const scene0 = a.mind.aware.watching;
  assert.ok(scene0 && b.mind.aware.watching === scene0 && scene0.watchers === 2);
  // PedestrianCrowd.hide lo saca de la lista de la calle.
  s.district.npcs.splice(s.district.npcs.indexOf(b), 1);
  const nextTick = b.mind.nextTick;
  run(s, 2, fight, t => blow(t + 2));
  assert.equal(b.mind.aware.watching, null, 'soltó su puesto');
  assert.equal(scene0.watchers, 1);
  assert.equal(b.mind.nextTick, nextTick, 'no pensó escondido');
  s.district.npcs.push(b);
  run(s, 1, fight);
  assert.ok(b.mind.nextTick > nextTick, 'de vuelta en la calle, piensa');
});
