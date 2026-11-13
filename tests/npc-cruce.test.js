import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { CROSS, acceptGap, crossingTemper, firstArrival, signalAllows, signalFor, vehicleArrival } from '../src/entities/npc/crossing.js';
import { StreetMinds, seededRandom } from '../src/entities/npc/mind.js';
import { NpcConversations } from '../src/systems/NpcConversations.js';
import { npcSexo } from '../src/systems/StreetVoices.js';

// Cruzar mirando el tráfico: la cuenta de cuándo llega un carro al paso de cebra, el hueco, el semáforo y peatones de
// verdad (Npc real, red real) en el borde de una calle con carros de mentira que se mueven en línea recta.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, snapPose() {}, dispose() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
const { Npc } = await import('../src/entities/Npc.js');

const realRandom = Math.random;
beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = { getElementById() { return null; }, createElement() { return { style: {}, remove() {} }; }, body: { appendChild() {} } };
  Math.random = seededRandom(4321);
});
afterEach(() => { Math.random = realRandom; });

// Andén abajo (filas 0 a 3, z 0..6 m), calzada a lo largo de X (filas 4 a 8, z 8..16 m) y andén arriba (filas 9 y 10).
// El paso de cebra son las columnas 10 y 11 (x 20 y 22 m): de borde a borde, de z 6 a z 18.
const CURB = 6, FAR_CURB = 18, LANE_Z = 12;
function street() {
  const map = Array.from({ length: 11 }, (_, z) => Array.from({ length: 30 }, () => (z >= 4 && z <= 8 ? 'road' : 'sidewalk')));
  return new PedestrianNavigation(map, 2, { isCrossing: x => x === 10 || x === 11 });
}

async function walker(at, navigation, arquetipo = 'oficinista', isWalkable = (x, z) => navigation.isWalkableAt(x, z)) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(...at), { arquetipo, navigation, facing: 0, groundHeight: () => 0, isWalkable });
  await npc.ready;
  npc.walkSpeed = 1.3;
  npc.person.pausa = 0;
  return npc;
}

/** Ruta recta por la columna x, de z0 a z1 (centros de baldosa). */
function across(npc, x, z0, z1) {
  const route = [];
  for (let z = z0 + 2; z <= z1; z += 2) route.push(new THREE.Vector3(x, 0, z));
  npc.route = route; npc.routeIndex = 0; npc.target = route[0]; npc.wait = 0; npc.stance = null; npc.action = null;
}

/** Un carro del tráfico, como los ve la mente: `{ car: { position, length, width, group.rotation.y }, speed }`. */
function car(x, z, speed, yaw = 0) {
  return { car: { position: new THREE.Vector3(x, 0, z), length: 4.4, width: 1.9, group: { rotation: { y: yaw } } }, speed };
}

/** Corre la calle como Bogota.update: mentes, NPC y después los carros avanzan por su rumbo. */
function run({ district, minds }, seconds, { vehicles = [], player = new THREE.Vector3(20, 0, -6), onFrame = () => {}, dt = 1 / 30, signals = null } = {}) {
  for (let t = 0; t < seconds; t += dt) {
    if (signals) signals.time += dt;
    minds.beginFrame(dt, player, vehicles);
    for (const npc of district.npcs) npc.update(dt, { player });
    for (const v of vehicles) {
      const yaw = v.car.group.rotation.y;
      v.car.position.x += Math.cos(yaw) * v.speed * dt;
      v.car.position.z -= Math.sin(yaw) * v.speed * dt;
    }
    if (onFrame(t) === false) return t;
  }
  return seconds;
}

function scene(npcs, signals = null) {
  const district = { npcs, trafficPedestrians: [...npcs], signals };
  return { district, minds: new StreetMinds(district) };
}

const SPAN = { ax: 20, az: CURB, ux: 0, uz: 1, length: FAR_CURB - CURB };
const vehicle = (x, z, hx, hz, speed) => ({ x, z, hx, hz, speed, halfLength: 2.2, halfWidth: .95 });

test('cuándo llega un carro al paso de cebra: de frente, ya pasado, detenido, encima y lejos del paso', () => {
  // A 30 m del paso, a 10 m/s: la trompa (2,2 m) y el margen de la franja (1 m) llegan antes.
  assert.ok(Math.abs(vehicleArrival(vehicle(-10, LANE_Z, 1, 0, 10), SPAN) - 2.68) < 1e-9);
  assert.ok(Math.abs(vehicleArrival(vehicle(50, LANE_Z, -1, 0, 10), SPAN) - 2.68) < 1e-9, 'por el otro carril, igual');
  assert.equal(vehicleArrival(vehicle(30, LANE_Z, 1, 0, 10), SPAN), Infinity, 'ya pasó');
  assert.equal(vehicleArrival(vehicle(5, LANE_Z, 1, 0, 0), SPAN), Infinity, 'detenido antes del paso');
  assert.equal(vehicleArrival(vehicle(19, LANE_Z, 1, 0, 0), SPAN), Infinity, 'detenido con la trompa en la cebra, como en rojo');
  assert.equal(vehicleArrival(vehicle(20.5, LANE_Z, 1, 0, 5), SPAN), 0, 'pasando por encima');
  assert.equal(vehicleArrival(vehicle(-10, 40, 1, 0, 10), SPAN), Infinity, 'por otra calle');
  assert.equal(vehicleArrival(vehicle(20, -20, 0, 1, 10), SPAN), Infinity, 'paralelo al paso, lejos de la franja');
  // Entre todos, el primero; y quién es, para mirarlo.
  const near = car(0, LANE_Z, 10), far = car(-30, 10, 10), stopped = car(10, 14, 0), away = car(40, LANE_Z, 10);
  const span = { ...SPAN, threat: null };
  assert.ok(Math.abs(firstArrival(span, [far, stopped, near, away], []) - (20 - 3.2) / 10) < 1e-9);
  assert.equal(span.threat, near.car);
  assert.equal(firstArrival(span, [stopped, away], []), Infinity);
  // El bus de la troncal: su rumbo sale de rotation.y = atan2(−h.x, −h.z). Hacia +X: π/2 da h = (−1, 0)… luego −π/2.
  const bus = { position: new THREE.Vector3(0, 0, LANE_Z), speed: 10, length: 18, width: 2.6, group: { visible: true, rotation: { y: -Math.PI / 2 } } };
  assert.ok(Math.abs(firstArrival(span, [], [bus]) - (20 - 9 - 1) / 10) < 1e-9);
  bus.position.y = 6;
  assert.equal(firstArrival(span, [], [bus]), Infinity, 'el bus por el viaducto pasa por encima');
});

test('el hueco y la paciencia: el impaciente acepta menos margen y espera menos', () => {
  assert.equal(acceptGap(12, 9.6, 1.5), true);
  assert.equal(acceptGap(10.5, 9.6, 1.5), false);
  assert.equal(acceptGap(10.5, 9.6, .5), true);
  const calm = crossingTemper(0), hasty = crossingTemper(1);
  assert.equal(calm.margin, CROSS.margin); assert.equal(hasty.margin, CROSS.impatientMargin);
  assert.equal(calm.maxWait, 18); assert.equal(hasty.maxWait, 12);
  for (let k = 0; k <= 10; k++) {
    const { maxWait, margin } = crossingTemper(k / 10);
    // Con el margen para no meterse delante del que ya llega, nadie pasa de 20 s.
    assert.ok(maxWait >= 12 && maxWait + CROSS.grace <= 20 && margin >= .5 && margin <= 1.5);
  }
});

test('el semáforo: la cebra pegada al cruce obedece, y cruza solo con rojo para los carros y tiempo para llegar', () => {
  // El cruce de calles queda al lado de la cebra, como en la ciudad: la cebra es el andén prolongado hasta él.
  const signals = { nodes: [{ x0: 30, x1: 50, z0: 7, z1: 17 }], time: 0 };
  // Del punto medio (x 20) al cruce hay 10 m: no es su semáforo.
  assert.equal(signalFor(signals, SPAN).axis, -1);
  signals.nodes[0].x0 = 23;
  // Anda por Z: le cruzan los que van por X (eje 0).
  assert.equal(signalFor(signals, SPAN).axis, 0);
  assert.equal(signalFor(signals, { ax: 24, az: 4, ux: 1, uz: 0, length: 12 }).axis, 1);
  assert.equal(signalFor(null, SPAN).axis, -1);
  const crossTime = 9.6;
  assert.equal(signalAllows(5, 0, crossTime), false, 'verde para los carros');
  assert.equal(signalAllows(15, 0, crossTime), false, 'amarillo');
  assert.equal(signalAllows(18, 0, crossTime), true, 'rojo recién puesto');
  assert.equal(signalAllows(30, 0, crossTime), false, 'rojo a punto de acabar: no alcanza');
  assert.equal(signalAllows(5, 1, crossTime), true, 'el otro eje sigue en rojo');
  assert.equal(signalAllows(5, -1, crossTime), true, 'sin semáforo');
});

test('con la calle libre cruza sin detenerse', async () => {
  const nav = street();
  const npc = await walker([20, 0, 2], nav);
  across(npc, 20, 2, 20);
  const s = scene([npc]);
  let waited = 0, maxWait = 0;
  const end = run(s, 30, { onFrame: () => {
    maxWait = Math.max(maxWait, npc.mind.crossing.waited);
    if (npc.mind.waiting) waited++;
    return npc.position.z < 19.9;
  } });
  assert.equal(waited, 0, 'no se paró en el borde');
  assert.equal(maxWait, 0);
  assert.ok(end < 15, `tardó ${end.toFixed(1)} s en 18 m`);
});

test('espera en el borde a que pase el carro que viene y después cruza', async () => {
  const nav = street();
  const npc = await walker([20, 0, 2], nav);
  across(npc, 20, 2, 20);
  const s = scene([npc]);
  // El carro sale a 50 m del paso cuando el peatón ya casi llega al borde.
  const traffic = [car(-30, LANE_Z, 9)];
  let onRoadWithCar = 0, waitedMax = 0, started = null;
  run(s, 40, { vehicles: traffic, onFrame: t => {
    const c = traffic[0].car.position, onRoad = npc.position.z > CURB + .6;
    // En la calzada mientras el carro todavía no pasa el paso de cebra (con su largo).
    if (onRoad && c.x < 20 + 2.2 + 1.5 && c.x > 20 - 25) onRoadWithCar++;
    waitedMax = Math.max(waitedMax, npc.mind.crossing.waited);
    if (started === null && onRoad) started = t;
    return npc.position.z < 19.9;
  } });
  assert.equal(onRoadWithCar, 0, 'se bajó a la calzada con el carro encima');
  assert.ok(waitedMax > .5, `esperó ${waitedMax.toFixed(2)} s`);
  assert.ok(waitedMax < npc.mind.crossing.maxWait, 'el carro pasó antes de que se le acabara la paciencia');
  assert.ok(npc.position.z >= 19.9, 'terminó de cruzar');
  // El carro pasa el paso hacia los 6 s: cruza poco después, no se queda pegado.
  assert.ok(started > 4 && started < 8.5, `bajó a los ${started?.toFixed(1)} s`);
});

test('nadie espera para siempre: con carros seguidos cruza en el primer hueco que le queda al acabarse su paciencia (12 a 18 s)', async () => {
  for (const [arquetipo, seed] of [['estudiante', 1], ['abuelo', 2]]) {
    Math.random = seededRandom(seed);
    const nav = street();
    const npc = await walker([20, 0, 4], nav, arquetipo);
    across(npc, 20, 4, 20);
    const s = scene([npc]);
    // Una fila de carros a 10 m/s cada 40 m: nunca hay un hueco de 11 s, siempre uno de más de un segundo.
    const traffic = [0, 1, 2, 3].map(k => car(-60 + k * 40, LANE_Z, 10));
    let waitedMax = 0;
    run(s, 40, { vehicles: traffic, onFrame: () => {
      for (const v of traffic) if (v.car.position.x > 80) v.car.position.x -= 160;
      waitedMax = Math.max(waitedMax, npc.mind.crossing.waited);
      return npc.position.z < 19.9;
    } });
    const { maxWait } = npc.mind.crossing;
    assert.ok(maxWait >= 12 && maxWait <= 18, `${arquetipo}: paciencia ${maxWait}`);
    assert.ok(waitedMax >= maxWait - .1, `${arquetipo}: esperó ${waitedMax.toFixed(1)} s de ${maxWait.toFixed(1)}`);
    assert.ok(waitedMax <= Math.min(20, maxWait + CROSS.grace) + .05, `${arquetipo}: esperó ${waitedMax.toFixed(1)} s, más que su tope`);
    assert.ok(npc.position.z >= 19.9, `${arquetipo}: no cruzó`);
  }
});

test('con un carro siempre encima de la franja no hay hueco que valga: cruza igual a los 2 s de acabarse su paciencia, nunca después de 20', async () => {
  for (const [arquetipo, seed] of [['estudiante', 1], ['abuelo', 2]]) {
    Math.random = seededRandom(seed);
    const nav = street();
    const npc = await walker([20, 0, 4], nav, arquetipo);
    across(npc, 20, 4, 20);
    const s = scene([npc]);
    // Un carro que va despacio a lo largo de la cebra, encima de ella: su llegada es 0 todo el tiempo.
    const traffic = [car(21, LANE_Z, 1, -Math.PI / 2)];
    let waitedMax = 0, arrival = Infinity;
    run(s, 40, { vehicles: traffic, onFrame: () => {
      traffic[0].car.position.z = LANE_Z;
      if (npc.mind.waiting) arrival = Math.min(arrival, firstArrival(npc.mind.crossing, traffic, null));
      waitedMax = Math.max(waitedMax, npc.mind.crossing.waited);
      return npc.position.z < 19.9;
    } });
    const { maxWait } = npc.mind.crossing;
    assert.equal(arrival, 0, `${arquetipo}: el carro no estaba encima`);
    assert.ok(waitedMax >= maxWait + CROSS.grace - .1, `${arquetipo}: esperó ${waitedMax.toFixed(1)} s de ${(maxWait + CROSS.grace).toFixed(1)}`);
    assert.ok(waitedMax <= 20 + .05, `${arquetipo}: esperó ${waitedMax.toFixed(1)} s, más de 20`);
    assert.ok(npc.position.z >= 19.9, `${arquetipo}: no cruzó`);
  }
});

test('el abuelo espera más que el estudiante con los mismos carros', async () => {
  const waits = {};
  for (const arquetipo of ['estudiante', 'abuelo']) {
    Math.random = seededRandom(7);
    const nav = street();
    const npc = await walker([20, 0, 4], nav, arquetipo);
    across(npc, 20, 4, 20);
    const traffic = [0, 1, 2, 3].map(k => car(-60 + k * 40, LANE_Z, 10));
    let waitedMax = 0;
    run(scene([npc]), 40, { vehicles: traffic, onFrame: () => {
      for (const v of traffic) if (v.car.position.x > 80) v.car.position.x -= 160;
      waitedMax = Math.max(waitedMax, npc.mind.crossing.waited);
      return npc.position.z < 19.9;
    } });
    waits[arquetipo] = waitedMax;
  }
  assert.ok(waits.abuelo > waits.estudiante, JSON.stringify(waits));
});

test('si ya va cruzando y se le viene un carro, apura el paso', async () => {
  const nav = street();
  const npc = await walker([20, 0, 4], nav);
  across(npc, 20, 4, 20);
  const traffic = [];
  let hurried = 0, fastest = 0, looked = 0, glances = 0, wasLooking = false;
  run(scene([npc]), 30, { vehicles: traffic, onFrame: () => {
    // A media calle aparece un carro a 40 m que no alcanza a frenar en la cuenta del peatón.
    if (!traffic.length && npc.position.z > 10) traffic.push(car(-20, 14, 9));
    // La cabeza, como la pide Npc al animarse: apurado, mira hacia el carro (viene por −X, a su izquierda: ángulo < 0).
    const look = npc.mind.gaze(null);
    if (npc.mind.crossing.hurry) {
      hurried++; fastest = Math.max(fastest, npc.mind.paceFactor());
      if (look < -.3) looked++;
      if (look < -.3 && !wasLooking) glances++;
    }
    wasLooking = look < -.3;
    return npc.position.z < 19.9;
  } });
  assert.ok(hurried > 0, 'no apuró el paso');
  assert.equal(fastest, CROSS.hurry);
  // Lo mira de a ratos (vistazos), no con la cabeza torcida todo el camino.
  assert.ok(looked > hurried * .25 && looked < hurried * .75, `miró el carro en ${looked} de ${hurried} cuadros apurado`);
  assert.ok(glances >= 2, `${glances} vistazos al carro`);
  assert.equal(npc.mind.crossing.hurry, false, 'del otro lado vuelve a su paso');
});

test('con semáforo espera el rojo de los carros aunque la calle esté libre, y cruza con él', async () => {
  const nav = street();
  const npc = await walker([20, 0, 4], nav, 'abuelo');
  across(npc, 20, 4, 20);
  // El cruce de calles empieza 1 m al lado de la cebra. A los 10 s del ciclo: verde para los que van por X.
  const signals = { nodes: [{ x0: 23, x1: 40, z0: 7, z1: 17 }], time: 10 };
  let started = null;
  run(scene([npc], signals), 30, { signals, onFrame: () => {
    if (started === null && npc.position.z > CURB + .6) started = signals.time;
    return npc.position.z < 19.9;
  } });
  assert.ok(npc.mind.crossing.maxWait > 9, 'el abuelo aguanta el verde');
  assert.ok(started >= 17 && started < 18, `bajó con el semáforo en ${started?.toFixed(2)}`);
});

test('dos que llegan al mismo borde por un pasillo sin sitio al lado hacen fila: el de atrás espera sin encimarse ni buscar otro camino', async () => {
  const nav = street();
  // Hasta el borde solo se llega por un pasillo de medio metro (entre un puesto y un poste, digamos).
  const corridor = (x, z) => nav.isWalkableAt(x, z) && (z > CURB + .5 || Math.abs(x - 20) < .25);
  const a = await walker([20, 0, 2], nav, 'oficinista', corridor), b = await walker([20, 0, 0], nav, 'oficinista', corridor);
  across(a, 20, 2, 20); across(b, 20, 0, 20);
  b.route.unshift(new THREE.Vector3(20, 0, 0)); b.target = b.route[0];
  const routeB = b.route;
  // Carros seguidos durante 8 s; después la calle queda libre.
  const traffic = [0, 1, 2, 3].map(k => car(-60 + k * 40, LANE_Z, 10));
  let closest = Infinity, bothWaited = 0;
  run(scene([a, b]), 40, { vehicles: traffic, onFrame: t => {
    for (const v of traffic) if (v.car.position.x > 80) v.car.position.x -= t < 8 ? 160 : 1000;
    closest = Math.min(closest, Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z));
    if (a.mind.waiting && b.mind.waiting) bothWaited++;
    return a.position.z < 19.9 || b.position.z < 19.9;
  } });
  assert.ok(bothWaited > 30, 'los dos esperaron a la vez');
  assert.equal(b.route, routeB, 'el de atrás no cambió de camino');
  assert.ok(closest >= .5, `se encimaron: ${closest.toFixed(2)} m`);
  assert.ok(a.position.z >= 19.9 && b.position.z >= 19.9, 'cruzaron los dos');
});

test('lejos del jugador, donde nadie se esquiva, dos que esperan en el mismo borde no quedan uno dentro del otro: el que llegó después se corre un cuerpo', async () => {
  const nav = street();
  const far = new THREE.Vector3(20, 0, -80); // a más de 40 m: no hay esquiva
  const traffic = () => [0, 1, 2, 3].map(k => car(-60 + k * 40, LANE_Z, 10));
  const wait = (a, b, cars) => {
    let closest = Infinity, both = 0, apartAt = null, firstMoved = 0, onRoad = false, at = null, gap = 0, crossedA = false, crossedB = false;
    run(scene([a, b]), 40, { vehicles: cars, player: far, onFrame: t => {
      for (const v of cars) if (v.car.position.x > 80) v.car.position.x -= t < 10 ? 160 : 1000;
      const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      if (a.mind.waiting && b.mind.waiting) {
        both++;
        if (!at) at = a.position.clone();
        firstMoved = Math.max(firstMoved, a.position.distanceTo(at));
        if (both > 75) closest = Math.min(closest, d); // 2,5 s después de coincidir (lejos piensan una vez por segundo)
        if (apartAt === null && d >= .54) apartAt = both / 30;
        if (b.position.z > CURB + .3) onRoad = true;
        gap = Math.abs(b.position.x - a.position.x);
      }
      // Al llegar siguen su vida (otra ruta): cuenta que cada uno haya llegado al otro andén.
      crossedA ||= a.position.z >= 19.9; crossedB ||= b.position.z >= 19.9;
      return !(crossedA && crossedB);
    } });
    return { closest, both, apartAt, firstMoved, onRoad, gap, crossed: crossedA && crossedB };
  };
  // Los dos por la misma columna: sin esquiva, el segundo llega exactamente al punto donde espera el primero.
  const a = await walker([20, 0, 2], nav), b = await walker([20, 0, 0], nav);
  across(a, 20, 2, 20); across(b, 20, 0, 20);
  b.route.unshift(new THREE.Vector3(20, 0, 0)); b.target = b.route[0];
  const open = wait(a, b, traffic());
  assert.ok(open.both > 90, `los dos esperaron a la vez (${open.both} cuadros)`);
  assert.ok(open.apartAt !== null && open.apartAt < 2.5 && open.closest >= .54, `quedaron a ${open.closest.toFixed(2)} m; apartados a los ${open.apartAt} s`);
  assert.ok(open.firstMoved < .01 && !open.onRoad, `el primero se movió ${open.firstMoved.toFixed(2)} m; ${open.onRoad ? 'el segundo bajó a la calzada' : ''}`);
  assert.ok(open.crossed, 'cruzaron los dos');
  assert.ok(open.gap > .4, `el segundo se corrió a lo largo del borde, no hacia atrás (${open.gap.toFixed(2)} m)`);
  // Por un pasillo sin sitio a los lados: el segundo da el paso hacia atrás.
  const corridor = (x, z) => nav.isWalkableAt(x, z) && (z > CURB + .5 || Math.abs(x - 20) < .25);
  const c = await walker([20, 0, 2], nav, 'oficinista', corridor), d = await walker([20, 0, 0], nav, 'oficinista', corridor);
  across(c, 20, 2, 20); across(d, 20, 0, 20);
  d.route.unshift(new THREE.Vector3(20, 0, 0)); d.target = d.route[0];
  const narrow = wait(c, d, traffic());
  assert.ok(narrow.both > 90 && narrow.closest >= .54 && narrow.firstMoved < .01, `en el pasillo quedaron a ${narrow.closest.toFixed(2)} m`);
  assert.ok(narrow.crossed && narrow.gap < .1, 'cruzaron los dos por el pasillo');
});

/** Un audio de mentira con lo que usa NpcConversations: cargado, suena hasta que se para. */
class FakeSound {
  constructor() { this.id = 0; this.playingId = null; }
  state() { return 'loaded'; }
  play() { this.playingId = ++this.id; return this.playingId; }
  playing(id) { return this.playingId === id; }
  stop(id) { if (this.playingId === id) this.playingId = null; }
  volume() {}
  duration() { return 3; }
  unload() {}
}

test('quien espera en el borde para cruzar, o va cruzando, no entra en una conversación: está pendiente de los carros', async () => {
  // Dos juntos en el mismo borde, carros seguidos y el jugador a pocos metros: para las conversaciones son la pareja
  // que más parece estar ya junta. Antes los elegía, ninguno se volteaba (esperar va antes que conversar) y la charla
  // se caía a los 5 s sin una palabra; después no volvían a intentarlo en minutos.
  const nav = street();
  const a = await walker([20, 0, 3], nav), b = await walker([22, 0, 3], nav);
  across(a, 20, 2, 20); across(b, 22, 2, 20);
  const s = scene([a, b]);
  const player = new THREE.Vector3(21, 0, 0);
  // Carros seguidos durante 16 s; después la calle queda libre y cruzan.
  const traffic = [0, 1, 2, 3].map(k => car(-60 + k * 40, LANE_Z, 10));
  const cars = t => { for (const v of traffic) if (v.car.position.x > 80) v.car.position.x -= t < 16 ? 160 : 1000; };
  // Primero llegan al borde y se ponen a esperar.
  const atCurb = run(s, 8, { vehicles: traffic, player, onFrame: t => { cars(t); return !(a.mind.waiting && b.mind.waiting); } });
  assert.ok(a.mind.waiting && b.mind.waiting, 'los dos esperan en el borde');
  const conversation = {
    id: 'prueba', hablantes: { A: { sexo: npcSexo(a) }, B: { sexo: npcSexo(b) } },
    lineas: [{ hablante: 'A', texto: 'Uno.', file: 'a1' }, { hablante: 'B', texto: 'Dos.', file: 'b1' }]
  };
  const talks = new NpcConversations({ conversations: [conversation], random: () => 0, load: () => new FakeSound() });
  let ms = 0, waited = 0, crossing = 0, talked = 0;
  run(s, 30, { vehicles: traffic, player, onFrame: t => {
    cars(atCurb + t);
    ms += 1000 / 30;
    talks.update(player, [a, b], ms);
    if (a.mind.waiting && b.mind.waiting) waited++;
    if (a.mind.crossing.state === 2 || b.mind.crossing.state === 2) crossing++;
    if (talks.busy) talked++;
    return a.position.z < 19.9 || b.position.z < 19.9;
  } });
  assert.ok(waited > 5 * 30 && crossing > 0, `esperaron juntos ${(waited / 30).toFixed(1)} s y cruzaron`);
  assert.equal(talked, 0, `hubo una charla en curso ${(talked / 30).toFixed(1)} s`);
  assert.ok(a.position.z >= 19.9 && b.position.z >= 19.9, 'cruzaron los dos');
});

test('reciclado en otra calle (relocate) mientras espera en el borde o va cruzando: suelta el cruce y anda su ruta nueva', async () => {
  for (const phase of ['esperando', 'cruzando']) {
    const nav = street();
    const npc = await walker([20, 0, 3], nav);
    across(npc, 20, 2, 20);
    const s = scene([npc]);
    // Esperando: carros seguidos. Cruzando: la calle libre, hasta que va por la mitad de la calzada.
    const traffic = phase === 'esperando' ? [0, 1, 2, 3].map(k => car(-60 + k * 40, LANE_Z, 10)) : [];
    const cars = () => { for (const v of traffic) if (v.car.position.x > 80) v.car.position.x -= 160; };
    run(s, 12, { vehicles: traffic, onFrame: () => {
      cars();
      return phase === 'esperando' ? !(npc.mind.waiting && npc.mind.crossing.waited > 1) : !(npc.mind.crossing.state === 2 && npc.position.z > LANE_Z - 2);
    } });
    assert.equal(npc.mind.crossing.state, phase === 'esperando' ? 1 : 2, `${phase}: a medio cruce`);
    // Lo que haría PedestrianCrowd al reciclarlo: lo pone en otro andén con una ruta que no cruza y le reinicia la mente.
    npc.position.set(4, 0, 2);
    npc.route = [6, 8, 10, 12].map(x => new THREE.Vector3(x, 0, 2)); npc.routeIndex = 0; npc.target = npc.route[0]; npc.wait = 0;
    npc.mind.reset();
    const c = npc.mind.crossing;
    assert.ok(c.state === 0 && c.waited === 0 && !c.hurry && c.target === null, `${phase}: el cruce quedó a medias (estado ${c.state})`);
    let held = 0;
    run(s, 4, { vehicles: traffic, onFrame: () => { cars(); if (npc.mind.crossing.state !== 0) held++; } });
    assert.equal(held, 0, `${phase}: siguió pendiente de un cruce en la calle nueva`);
    assert.ok(npc.position.x > 8, `${phase}: no anduvo su ruta nueva (x = ${npc.position.x.toFixed(1)})`);
    npc.dispose();
  }
});

test('cruzar no cambia el azar del juego: la mente no llama a Math.random', async () => {
  const nav = street();
  const npc = await walker([20, 0, 2], nav);
  across(npc, 20, 2, 20);
  const s = scene([npc]);
  const traffic = [car(-30, LANE_Z, 9)];
  run(s, 1 / 30, { vehicles: traffic }); // el primer cuadro le arma la mente
  // Solo cuenta lo que pasa en el borde y al cruzar: el resto del Npc (miradas, paradas) sí usa el del juego.
  let calls = 0;
  const seeded = Math.random;
  npc.mind.holdWalk = (holdWalk => dt => {
    Math.random = () => { calls++; return seeded(); };
    try { return holdWalk(dt); } finally { Math.random = seeded; }
  })(npc.mind.holdWalk.bind(npc.mind));
  let waited = 0;
  run(s, 20, { vehicles: traffic, onFrame: () => { if (npc.mind.waiting) waited++; return npc.position.z < 19.9; } });
  assert.ok(waited > 0, 'tenía que esperar al carro');
  assert.equal(calls, 0, `${calls} llamadas a Math.random`);
});
