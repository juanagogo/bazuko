import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { TEMPERS } from '../src/entities/npc/temperament.js';
import { REACT, REPORT_PHRASES } from '../src/entities/npc/awareness.js';
import { StreetMinds, seededRandom } from '../src/entities/npc/mind.js';

// Quién se para a mirar una pelea y cómo: el plazo según la distancia, el anillo de afuera del bravo y del avisador,
// el indiferente que mira de paso, el reparto del arco, el tope y la calle de por medio. Peatones de verdad (Npc real,
// red real) en una plaza o en una calle dibujada; la ciudad entera va en tests/npc-corrillo-ciudad.test.js.
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

/** Red desde un dibujo: '.' andén, 'r' calzada que se puede cruzar. Cada carácter es una baldosa de 2 m. */
function navFrom(rows) {
  return new PedestrianNavigation(rows.map(row => [...row].map(c => (c === '.' ? 'sidewalk' : c === 'r' ? 'road' : 'building'))), 2,
    { isCrossing: (x, z) => rows[z][x] === 'r' });
}
const plaza = (w = 40, h = 30) => navFrom(Array.from({ length: h }, () => '.'.repeat(w)));

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

/** Fija el temperamento. Con `sure`, sin el azar de si le dan ganas de mirar: mira. */
function temper(npc, tipo, sure = false) { npc.mind.temper = { ...npc.mind.temper, ...TEMPERS[tipo], tipo, ...(sure ? { watch: 1 } : {}) }; }

/** Quieto en su sitio, de cara a `at`. */
function stand(npc, at) {
  npc.target = null; npc.route = []; npc.wait = 1e9; npc.stance = null;
  npc.root.rotation.y = Math.atan2(at.x - npc.position.x, at.z - npc.position.z);
}

/** Andando derecho por `z`, de `x0` a `x1`, de dos en dos metros. */
function walkAlong(npc, x0, x1, z) {
  const route = [];
  for (let x = x0; x <= x1; x += 2) route.push(new THREE.Vector3(x, 0, z));
  npc.route = route; npc.routeIndex = 0; npc.target = route[0]; npc.wait = 0; npc.stance = null;
  npc.root.rotation.y = Math.PI / 2;
  return route;
}

/** Pelea en `at`: un golpe por segundo durante `seconds` (lo que avisa el juego con `street-fight`). */
function fighting(seconds, at) {
  let next = 0;
  return t => {
    if (t < seconds && t >= next) { next += 1; window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: at } } })); }
  };
}

const far = (npc, p) => Math.hypot(npc.position.x - p.x, npc.position.z - p.z);
const angleTo = (npc, p) => {
  const a = npc.root.rotation.y - Math.atan2(p.x - npc.position.x, p.z - npc.position.z);
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
};
const inPlace = npc => { const a = npc.mind.aware; return !!a.watching && !npc.target; };

/** Cambia constantes de REACT mientras dura la prueba. */
function withReact(t, changes) {
  const before = {};
  for (const key of Object.keys(changes)) { before[key] = REACT[key]; REACT[key] = changes[key]; }
  t.after(() => Object.assign(REACT, before));
}

test('plazo según la distancia: el curioso va si a paso vivo alcanza a llegar con pelea por ver; a 15 m de una pelea larga va, y a un golpe suelto solo va el que lo tiene cerca', async () => {
  const nav = plaza(50, 30);
  const fight = new THREE.Vector3(50, 0, 30);
  // Pelea larga (10 golpes): un curioso a 15 m tiene casi 11 m hasta el arco, más de 6 s a paso vivo. Le alcanza.
  const longWay = await walker([34.9, 0, 30], nav, 'estudiante');
  let s = scene([longWay]);
  run(s, .2, fight);
  stand(longWay, fight); temper(longWay, 'curioso');
  let arrived = null, blow = fighting(10, fight);
  const from = far(longWay, fight);
  run(s, 14, fight, t => {
    blow(t);
    if (arrived === null && inPlace(longWay)) arrived = t;
  });
  assert.ok(from > 15 && from < 16, `está a ${from.toFixed(1)} m`);
  assert.ok(arrived !== null, 'a 15 m de una pelea larga, va y llega');
  // De la primera trompada al final de la escena van 18 s: le quedaron más de `watchLeft` para mirar.
  assert.ok(REACT.fight - arrived >= REACT.watchLeft, `le quedan ${(REACT.fight - arrived).toFixed(1)} s de pelea`);
  const d = far(longWay, fight);
  assert.ok(d >= 4 && d <= 6 && angleTo(longWay, fight) < .35, `quedó a ${d.toFixed(1)} m, de cara`);
  longWay.dispose();

  // Un golpe suelto arma una escena de 8 s. A 12 m (7,6 m hasta el arco) no llegaría con 3 s por ver: no va. El que
  // lo tiene a 8 m sí: llega, mira hasta que se acaba y se va de 1 a 4 s después.
  const farOne = await walker([38, 0, 30], nav, 'estudiante'), nearOne = await walker([50, 0, 22], nav, 'estudiante');
  s = scene([farOne, nearOne]);
  run(s, .2, fight);
  for (const n of [farOne, nearOne]) { stand(n, fight); temper(n, 'curioso'); }
  const start = farOne.position.clone();
  let farWatched = false, farNoticed = false, nearArrived = null, nearLeft = null;
  blow = fighting(1, fight);
  run(s, 14, fight, t => {
    blow(t);
    if (farOne.mind.aware.watching) farWatched = true;
    if (farOne.mind.aware.level >= 1) farNoticed = true;
    if (nearArrived === null && inPlace(nearOne)) nearArrived = t;
    if (nearArrived !== null && nearLeft === null && !nearOne.mind.aware.watching) nearLeft = t;
  });
  assert.ok(farNoticed, 'el de 12 m lo notó');
  assert.equal(farWatched, false, 'y no va: llegaría cuando ya no hay nada que ver');
  assert.ok(farOne.position.distanceTo(start) < .3, 'se queda donde estaba');
  assert.ok(nearArrived !== null && nearArrived < 8 - REACT.watchLeft + .5, `el de 8 m llega a los ${nearArrived?.toFixed(1)} s`);
  assert.ok(nearLeft !== null && nearLeft >= 8 + REACT.leave[0] - .1 && nearLeft <= 8 + REACT.leave[1] + .7, `y se va a los ${nearLeft?.toFixed(1)} s (la escena acaba a los 8)`);
  farOne.dispose(); nearOne.dispose();
});

test('anillo de afuera: el bravo y el avisador miran sin arrimarse, cada uno a la distancia a la que está tranquilo (de 6 a 9 m); el avisador mira un momento, avisa y sigue en lo suyo; el bravo se queda hasta el final', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  // El que pelea es el jugador. Un bravo y un avisador a 13 m, y otro bravo que ya está a 8,8 m: se queda donde está.
  const bravo = await walker([27, 0, 30], nav), teller = await walker([40, 0, 43], nav), here = await walker([48.8, 0, 30], nav);
  const people = [bravo, teller, here];
  const s = scene(people);
  run(s, .2, fight);
  for (const n of people) stand(n, fight);
  temper(bravo, 'bravo', true); temper(here, 'bravo', true); temper(teller, 'avisador', true);
  const reports = [], said = [];
  window.addEventListener('npc-police-report', e => reports.push({ npc: e.detail.npc, tipo: e.detail.tipo, at: s.minds.time }));
  teller.say = text => { said.push(text); };
  const hereAt = here.position.clone(), closest = new Map(people.map(n => [n, Infinity])), arrived = new Map();
  let tellerLeft = null, planted = false;
  const blow = fighting(12, fight);
  run(s, 12, fight, t => {
    blow(t);
    for (const n of people) {
      if (n.mind.aware.watching) closest.set(n, Math.min(closest.get(n), far(n, fight)));
      if (!arrived.has(n) && inPlace(n)) arrived.set(n, s.minds.time);
      if (n.mind.aware.reaction !== 0) planted = true;
    }
    if (arrived.has(teller) && tellerLeft === null && !teller.mind.aware.watching) tellerLeft = s.minds.time;
  });
  assert.equal(arrived.size, 3, 'los tres miran desde su puesto');
  // Cada uno, un poco más allá de su radio de miedo, y nunca más cerca que eso.
  for (const [n, name, reach] of [[bravo, 'el bravo', TEMPERS.bravo.fearReach], [teller, 'el avisador', TEMPERS.avisador.fearReach]]) {
    assert.ok(closest.get(n) > reach, `${name} se arrimó hasta ${closest.get(n).toFixed(2)} m (su radio es ${reach})`);
    assert.ok(closest.get(n) >= REACT.outer[0] && closest.get(n) <= REACT.outer[1], `${name} miró desde ${closest.get(n).toFixed(2)} m`);
    assert.ok(closest.get(n) <= reach + REACT.outerOff + .2, `${name} quedó a ${closest.get(n).toFixed(2)} m: a su distancia, no más lejos`);
    assert.ok(arrived.get(n) > 2 && arrived.get(n) < 8, `${name} tuvo que andar hasta su puesto`);
  }
  assert.ok(here.position.distanceTo(hereAt) < .05, 'el que ya estaba a su distancia mira desde donde está');
  for (const n of [bravo, here]) {
    assert.ok(n.mind.aware.watching && n.mind.aware.watchRow === 2, 'el bravo sigue mirando, desde el anillo de afuera');
    assert.ok(angleTo(n, fight) < .35, 'de cara a la pelea');
  }
  assert.equal(planted, false, 'nadie le planta cara ni retrocede: la pelea no les queda encima');
  // El avisador: mira de 3 a 5 s desde su puesto, avisa (no antes) y se va.
  assert.equal(reports.length, 1, `avisó una vez (${reports.length})`);
  assert.equal(reports[0].npc, teller); assert.equal(reports[0].tipo, 'pelea');
  const looked = reports[0].at - arrived.get(teller);
  assert.ok(looked >= REACT.tell[0] - .05 && looked <= REACT.tell[1] + .4, `miró ${looked.toFixed(1)} s antes de avisar`);
  assert.ok(said.some(text => REPORT_PHRASES.includes(text)) && !said.includes(REPORT_PHRASES[0]), `lo dijo, y no habló de un robo: ${JSON.stringify(said)}`);
  assert.ok(tellerLeft !== null && tellerLeft - reports[0].at < .1, 'y dejó de mirar');
  // Se acaba (8 s después del último golpe): los bravos se van de a pocos.
  run(s, 14, fight);
  assert.equal(people.filter(n => n.mind.aware.watching).length, 0, 'al acabarse se van');
  for (const n of people) n.dispose();
});

test('mirón de paso: el indiferente que pasa a 6-10 m se detiene donde va, de cara, de 2 a 5 s, y sigue por su misma ruta; no busca puesto ni se desvía ni vuelve a pararse; el que pasa a más de 10 m sigue de largo', async (t) => {
  withReact(t, { passStop: 1 });
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  const fighter = new THREE.Vector3(40, 0, 30), player = new THREE.Vector3(40, 0, 12);
  // Uno pasa a 7 m de la pelea y otro a 13 m.
  const passer = await walker([28, 0, 37], nav), away = await walker([28, 0, 43], nav);
  const s = scene([passer, away]);
  run(s, .2, player);
  temper(passer, 'indiferente'); temper(away, 'indiferente');
  const route = walkAlong(passer, 30, 64, 37);
  walkAlong(away, 30, 64, 43);
  const stops = [];
  let stop = null, sideways = 0, awayPace = 1, awayWatched = false, row = null, watchers = 0, facing = Infinity;
  const blow = fighting(12, fighter);
  run(s, 22, player, t => {
    blow(t);
    const a = passer.mind.aware;
    sideways = Math.max(sideways, Math.abs(passer.position.z - 37));
    if (a.watching) {
      if (!stop) { stop = { from: t, x: passer.position.x, z: passer.position.z, d: far(passer, fight), moved: 0 }; stops.push(stop); row = a.watchRow; }
      stop.until = t;
      stop.moved = Math.max(stop.moved, Math.hypot(passer.position.x - stop.x, passer.position.z - stop.z));
      watchers = Math.max(watchers, a.watching.watchers);
      if (t - stop.from > 1) facing = Math.min(facing, angleTo(passer, fight));
    } else stop = null;
    awayPace = Math.min(awayPace, away.mind.paceFactor());
    if (away.mind.aware.watching) awayWatched = true;
  });
  assert.equal(stops.length, 1, `se detuvo una vez (${stops.length})`);
  const only = stops[0], time = only.until - only.from;
  assert.ok(only.d >= REACT.outer[0] && only.d <= REACT.passBy, `se detuvo a ${only.d.toFixed(1)} m`);
  assert.ok(time >= REACT.passLook[0] - .05 && time <= REACT.passLook[1] + .4, `miró ${time.toFixed(1)} s`);
  assert.ok(only.moved < .05, 'quieto mientras mira');
  assert.ok(facing < .35, `de cara a la pelea (${facing.toFixed(2)} rad)`);
  assert.equal(row, 2, 'cuenta en el anillo de afuera, sin casilla del arco');
  assert.equal(watchers, 1, 'y en el tope del corrillo');
  assert.ok(sideways < .5, `no se desvió (${sideways.toFixed(2)} m de su línea)`);
  assert.equal(passer.route, route, 'conserva su ruta');
  assert.ok(passer.target && passer.position.x > only.x + 8, `y siguió por ella (x = ${passer.position.x.toFixed(1)})`);
  assert.equal(awayWatched, false, 'el que pasa a 13 m no se detiene');
  assert.equal(awayPace, 1, 'ni afloja el paso');
  passer.dispose(); away.dispose();
});

test('el indiferente afloja y mira mientras tiene la pelea adelante o al lado; cuando ya la dejó atrás vuelve a su paso', async (t) => {
  withReact(t, { passStop: 0 });
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30), player = new THREE.Vector3(40, 0, 12);
  // Pasa a 4 m: de frente la tiene hasta que la cruza; 4,5 m más allá ya le queda a la espalda.
  const passer = await walker([32, 0, 34], nav);
  const s = scene([passer]);
  run(s, .2, player);
  temper(passer, 'indiferente');
  walkAlong(passer, 34, 64, 34);
  let before = 0, slowBefore = 0, after = 0, slowAfter = 0;
  const blow = fighting(22, fight);
  run(s, 24, player, t => {
    blow(t);
    const x = passer.position.x, pace = passer.mind.paceFactor();
    if (x > 35 && x < 40) { before++; if (pace === REACT.slow) slowBefore++; }
    // Desde 2 m después de dejarla atrás (un turno de pensar y lo que dura el aflojar) y mientras sigue a menos de 10 m.
    if (x > 46.5 && far(passer, fight) < REACT.passBy) { after++; if (pace === REACT.slow) slowAfter++; }
  });
  assert.ok(before > 60 && slowBefore >= before * .9, `con la pelea adelante afloja (${slowBefore} de ${before} cuadros)`);
  assert.ok(after > 20 && slowAfter === 0, `con la pelea a la espalda va a su paso (${slowAfter} de ${after} cuadros aflojando)`);
  passer.dispose();
});

test('reparto: seis curiosos que llegan por el mismo lado no quedan en montón; cada uno toma el puesto libre más cercano que no quede pegado a otro', async () => {
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  const people = [];
  for (const at of [[30, 0, 30], [30.5, 0, 27.5], [30.5, 0, 32.5], [29, 0, 29], [29, 0, 31.5], [28.5, 0, 26]]) people.push(await walker(at, nav, 'estudiante'));
  const s = scene(people);
  run(s, .2, fight);
  for (const n of people) { stand(n, fight); temper(n, 'curioso'); }
  const blow = fighting(12, fight);
  run(s, 12, fight, blow);
  const watchers = people.filter(inPlace);
  assert.ok(watchers.length >= 5, `${watchers.length} en su puesto`);
  const angles = watchers.map(n => Math.atan2(n.position.x - fight.x, n.position.z - fight.z));
  for (const n of watchers) {
    const d = far(n, fight);
    assert.ok(d >= 4 && d <= 6, `a ${d.toFixed(2)} m`);
    const nearest = Math.min(...watchers.filter(o => o !== n).map(o => o.position.distanceTo(n.position)));
    assert.ok(nearest >= 1.5, `pegado a otro: a ${nearest.toFixed(2)} m`);
  }
  // Todos llegaron por el oeste (−X) y aun así ocupan buena parte de ese lado del arco, de la primera fila sobre todo.
  const west = angles.map(a => Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))));
  const span = Math.max(...angles.map(a => Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)))) - Math.min(...angles.map(a => Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))));
  assert.ok(Math.max(...west) < Math.PI / 2 + .2, 'nadie dio la vuelta hasta el otro lado');
  assert.ok(span >= 100 * Math.PI / 180, `ocupan ${(span * 180 / Math.PI).toFixed(0)}° de arco`);
  assert.ok(watchers.filter(n => n.mind.aware.watchRow === 0).length >= 4, 'la primera fila primero');
  for (const n of people) n.dispose();
});

test('tope: con mucha gente alrededor el corrillo no pasa de ocho, contando el arco, el anillo de afuera, los de paso y los que miran de lejos', async (t) => {
  withReact(t, { passStop: 1 });
  const nav = plaza(40, 30);
  const fight = new THREE.Vector3(40, 0, 30);
  const people = [], kinds = [];
  const add = async (at, tipo) => { people.push(await walker(at, nav, 'estudiante')); kinds.push(tipo); };
  // Seis curiosos a 9 m, repartidos; dos bravos y un avisador a 12 m; dos miedosos que la miran de lejos y dos de paso.
  for (let k = 0; k < 6; k++) await add([40 + Math.sin(k * Math.PI / 3) * 9, 0, 30 + Math.cos(k * Math.PI / 3) * 9], 'curioso');
  await add([28, 0, 31], 'bravo'); await add([52, 0, 29], 'bravo'); await add([41, 0, 42], 'avisador');
  await add([47, 0, 37], 'miedoso'); await add([33, 0, 23], 'miedoso');
  await add([28, 0, 37.5], 'indiferente'); await add([28, 0, 22.5], 'indiferente');
  const s = scene(people);
  run(s, .2, fight);
  people.forEach((n, k) => {
    if (kinds[k] === 'indiferente') { temper(n, 'indiferente'); walkAlong(n, 30, 64, n.position.z); return; }
    stand(n, fight);
    n.mind.temper = { ...n.mind.temper, ...TEMPERS[kinds[k]], tipo: kinds[k], ...(kinds[k] === 'miedoso' ? { far: 1 } : {}) };
  });
  const wanted = new Set(), blow = fighting(12, fight);
  let most = 0, counted = 0;
  run(s, 12, fight, t => {
    blow(t);
    let now = 0;
    for (const n of people) if (n.mind.aware.watching) { now++; wanted.add(n); }
    most = Math.max(most, now);
    const sc = s.minds.bus.sceneNear(fight.x, fight.z, 4, s.minds.time);
    if (sc) { counted = Math.max(counted, sc.watchers); assert.equal(sc.watchers, now, 'la escena lleva la cuenta de todos los que miran'); }
  });
  assert.equal(most, REACT.watchers, `llegaron a ${most} a la vez`);
  assert.equal(counted, REACT.watchers);
  assert.ok(wanted.size > REACT.watchers || people.length - wanted.size >= 3, 'a los demás no les quedó sitio');
  for (const n of people) n.dispose();
});

test('con la calle de por medio nadie cruza para mirar: el bravo y el de paso miran desde su andén si ya quedan a su distancia, y el curioso del otro lado sigue en lo suyo', async (t) => {
  withReact(t, { passStop: 1 });
  // Andén arriba, calzada de 8 m que se puede cruzar (z de 27 a 35) y andén abajo. La pelea, a 1 m del borde.
  const nav = navFrom(Array.from({ length: 30 }, (_, row) => (row >= 14 && row < 18 ? 'r' : '.').repeat(40)));
  const fight = new THREE.Vector3(40, 0, 26);
  // En el otro andén: un bravo a 9,7 m, un curioso a 10,5 m y un indiferente que pasa a 10 m de la pelea.
  const bravo = await walker([41, 0, 35.6], nav), curious = await walker([37, 0, 36], nav, 'estudiante'), passer = await walker([28, 0, 35.6], nav);
  // Y en el de la pelea, un curioso a 9 m: él sí se arrima.
  const same = await walker([31, 0, 25], nav, 'estudiante');
  const people = [bravo, curious, passer, same];
  const s = scene(people);
  run(s, .2, fight);
  stand(bravo, fight); temper(bravo, 'bravo');
  stand(curious, fight); temper(curious, 'curioso');
  stand(same, fight); temper(same, 'curioso');
  temper(passer, 'indiferente'); walkAlong(passer, 30, 64, 35.6);
  const road = n => !!nav.nodes[nav.nodeAt(n.position.x, n.position.z)]?.crossing;
  const bravoAt = bravo.position.clone(), curiousAt = curious.position.clone();
  let onRoad = 0, passerStopped = null, curiousWatched = false;
  const blow = fighting(12, fight);
  run(s, 12, fight, t => {
    blow(t);
    for (const n of people) if (road(n)) onRoad++;
    if (curious.mind.aware.watching) curiousWatched = true;
    if (passer.mind.aware.watching && !passerStopped) passerStopped = passer.position.clone();
  });
  assert.equal(onRoad, 0, 'nadie pisó la calzada');
  assert.ok(bravo.mind.aware.watching && bravo.position.distanceTo(bravoAt) < .05, 'el bravo mira desde su andén, donde estaba');
  assert.ok(curious.mind.aware.level >= 1 && !curiousWatched && curious.position.distanceTo(curiousAt) < .3, 'el curioso del otro andén la notó y no fue');
  assert.ok(passerStopped && passerStopped.z > 35 && far({ position: passerStopped }, fight) <= REACT.passBy, 'el de paso se detuvo en su andén');
  assert.ok(inPlace(same) && far(same, fight) <= 6, 'el curioso del mismo andén sí se arrimó');
  for (const n of people) n.dispose();
});
