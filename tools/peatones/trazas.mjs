// tools/peatones/trazas.mjs
// Trazas vistas desde arriba de cuatro escenas de peatones, en Node, con los Npc y la red de verdad sobre mapas
// pequeños (como las pruebas). Corre sobre cualquier árbol: si el árbol no tiene `src/entities/npc/mind.js` (la base),
// los peatones andan sin mente. Escribe un JSON con las muestras (cada 0,1 s) y unas medidas por escena; las dibuja
// tools/peatones/trazas-svg.mjs.
//
//   node --experimental-test-module-mocks tools/peatones/trazas.mjs <árbol> <salida.json> [frente,anden,cruce,robo,...]
//
// - frente: dos de frente por la mitad de un andén de 6 m.
// - anden: 16 peatones con sus propias rutas por un andén de 6 m × 80 m durante 20 s.
// - cruce: cuatro que cruzan un paso de cebra sin semáforo mientras pasan carros de a dos, con huecos largos entre
//   pareja y pareja. Los carros frenan si hay alguien en la franja delante de ellos, como en el juego.
// - robo: 11 peatones en una plaza; a los 4 s el jugador roba a uno y lo pillan (lo que hace steal.js).
// - poste: dos de frente por un andén con un poste de 24 cm a 40 cm de su línea, justo donde se cruzan.
// - trabados: dos de frente y alguien parado a 40 cm de su línea donde se cruzan (el desempate).
// - paraguas: dos de frente, los dos con el paraguas abierto.
// - calzada: una señora cruza la calle y, en la mitad, estalla una pelea en el andén al que va (y en el de atrás).
// - corrillo: una pelea de 12 s en una plaza con seis curiosos a 10 m, tres de cada lado.
import { mock } from 'node:test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, salida, lista = 'frente,anden,cruce,robo'] = process.argv.slice(2);
const url = file => pathToFileURL(path.join(root, file)).href;
const THREE = await import(url('node_modules/three/build/three.module.js'));
mock.module(url('src/character/RealisticCharacter.js'), { namedExports: {
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, snapPose() {}, dispose() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
globalThis.window = new EventTarget();
globalThis.document = { getElementById() { return null; }, createElement() { return { style: {}, remove() {} }; }, body: { appendChild() {} } };
const { Npc } = await import(url('src/entities/Npc.js'));
const { PedestrianNavigation } = await import(url('src/world/bogota/PedestrianNavigation.js'));
const minds = existsSync(path.join(root, 'src/entities/npc/mind.js')) ? await import(url('src/entities/npc/mind.js')) : null;

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DT = 1 / 60, SAMPLE = .1;

async function walker(nav, at, opts = {}) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(at[0], 0, at[1]), {
    arquetipo: opts.arquetipo ?? 'oficinista', navigation: nav, facing: opts.facing ?? 0, groundHeight: () => 0,
    isWalkable: (x, z) => nav.isWalkableAt(x, z), collisions: opts.collisions ?? null
  });
  await npc.ready;
  if (opts.speed) npc.walkSpeed = opts.speed;
  if (npc.person) npc.person.pausa = 0;
  return npc;
}

/** Ruta recta por centros de baldosa (cada 2 m) de `from` a `to`, en línea por x o por z. */
function straight(npc, [x0, z0], [x1, z1]) {
  const route = [], n = Math.round(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) / 2);
  for (let k = 1; k <= n; k++) route.push(new THREE.Vector3(x0 + (x1 - x0) * k / n, 0, z0 + (z1 - z0) * k / n));
  npc.route = route; npc.routeIndex = 0; npc.target = route[0]; npc.wait = 0; npc.stance = null; npc.action = null;
}

/** Corre la escena y guarda cada 0,1 s dónde está cada uno y cómo está. */
function simulate({ npcs, seconds, player, vehicles = [], onFrame = () => {} }) {
  const district = { npcs, trafficPedestrians: npcs };
  const street = minds ? new minds.StreetMinds(district) : null;
  const samples = [];
  let next = 0;
  for (let frame = 0, t = 0; t < seconds; frame++, t = frame * DT) {
    onFrame(t, street);
    street?.beginFrame(DT, player, vehicles);
    for (const npc of npcs) npc.update(DT, { player });
    if (t + 1e-9 >= next) {
      next += SAMPLE;
      samples.push({
        t: +t.toFixed(2),
        people: npcs.map(n => {
          const m = n.mind, a = m?.aware;
          return [+n.position.x.toFixed(3), +n.position.z.toFixed(3), a ? a.level : (n.fleeTimer > 0 ? 3 : 0), n.fleeTimer > 0 ? 1 : 0,
            +(m?.side ?? 0).toFixed(3), +(m ? m.paceFactor() : 1).toFixed(2), m?.waiting ? 1 : 0, +n.root.rotation.y.toFixed(3)];
        }),
        cars: vehicles.map(v => [+v.car.position.x.toFixed(2), +v.car.position.z.toFixed(2)]),
        player: player ? [player.x, player.z] : null
      });
    }
  }
  street?.dispose();
  return samples;
}

/** Cajas sólidas estáticas (postes), con la consulta de CollisionSystem. */
function solids(boxes) {
  return { queryStatic(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    for (const box of boxes) if (box.max.x >= minX && box.min.x <= maxX && box.max.z >= minZ && box.min.z <= maxZ) out.push({ box });
    return out;
  } };
}
const pole = (x, z, size = .24) => new THREE.Box3(new THREE.Vector3(x - size / 2, 0, z - size / 2), new THREE.Vector3(x + size / 2, 3, z + size / 2));
const sidewalkMap = (w = 40, h = 3) => ({ w, h, tiles: () => 'sidewalk' });
const tempers = minds ? (await import(url('src/entities/npc/temperament.js'))).TEMPERS : null;
const setTemper = (npc, tipo) => { if (npc.mind && tempers) npc.mind.temper = { ...npc.mind.temper, ...tempers[tipo], tipo }; };
const fight = at => window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: at } } }));

/** Dos de frente por z = 2 de un andén de 6 m (de x 4 a 36), con lo que haga falta alrededor. */
async function headOn({ collisions = null, still = null, onFrame = () => {}, seconds = 26 } = {}) {
  const row = Array.from({ length: 40 }, () => 'sidewalk');
  const nav = new PedestrianNavigation([row, row, row], 2);
  const a = await walker(nav, [4, 2], { speed: 1.3, collisions }), b = await walker(nav, [36, 2], { speed: 1.3, facing: Math.PI, collisions });
  straight(a, [4, 2], [36, 2]); straight(b, [36, 2], [4, 2]);
  const npcs = [a, b];
  if (still) {
    const c = await walker(nav, still, { speed: 1.3 });
    c.route = []; c.target = null; c.wait = 1e9;
    npcs.push(c);
  }
  const samples = simulate({ npcs, seconds, player: new THREE.Vector3(20, 0, 12), onFrame: t => {
    if (still) npcs[2].position.set(still[0], 0, still[1]);
    onFrame(t, npcs);
  } });
  const d = pairDistances(samples, 0, 1);
  const passed = samples.findIndex(s => s.people[0][0] > s.people[1][0] + .3);
  return { samples, metrics: { closest: +Math.min(...d).toFixed(2), passedAt: passed >= 0 ? samples[passed].t : null } };
}

const pairDistances = (samples, i, j) => samples.map(s => Math.hypot(s.people[i][0] - s.people[j][0], s.people[i][1] - s.people[j][1]));

const scenes = {
  async frente() {
    Math.random = seeded(11);
    const row = Array.from({ length: 40 }, () => 'sidewalk');
    const nav = new PedestrianNavigation([row, row, row], 2);
    const a = await walker(nav, [4, 2], { speed: 1.3 }), b = await walker(nav, [36, 2], { speed: 1.3, facing: Math.PI });
    straight(a, [4, 2], [36, 2]); straight(b, [36, 2], [4, 2]);
    const samples = simulate({ npcs: [a, b], seconds: 20, player: new THREE.Vector3(20, 0, -8) });
    const d = pairDistances(samples, 0, 1);
    let closest = 0;
    d.forEach((v, k) => { if (v < d[closest]) closest = k; });
    // Desde cuándo se corren de lado (más de 5 cm de la línea) antes del máximo acercamiento.
    const off = samples.findIndex(s => Math.abs(s.people[0][1] - 2) > .05 || Math.abs(s.people[1][1] - 2) > .05);
    let lateral = 0, minPace = 1;
    for (let k = 1; k < samples.length; k++) for (let p = 0; p < 2; p++) {
      lateral = Math.max(lateral, Math.abs(samples[k].people[p][1] - samples[k - 1].people[p][1]) / SAMPLE);
      minPace = Math.min(minPace, samples[k].people[p][5]);
    }
    return { map: { w: 40, h: 3, tiles: () => 'sidewalk' }, samples, metrics: {
      closest: +d[closest].toFixed(2), closestAt: samples[closest].t,
      dodgeLead: off >= 0 ? +(samples[closest].t - samples[off].t).toFixed(2) : null,
      maxLateral: +lateral.toFixed(2), minPace
    } };
  },

  async anden() {
    Math.random = seeded(22);
    const row = Array.from({ length: 40 }, () => 'sidewalk');
    const nav = new PedestrianNavigation([row, row, row], 2);
    const random = seeded(23), npcs = [];
    for (let k = 0; k < 16; k++) {
      const x = 4 + random() * 72, z = Math.floor(random() * 3) * 2, east = k % 2 === 0;
      const npc = await walker(nav, [x, z], { facing: east ? Math.PI / 2 : -Math.PI / 2 });
      straight(npc, [Math.round(x / 2) * 2, z], [east ? 78 : 0, z]);
      npcs.push(npc);
    }
    const samples = simulate({ npcs, seconds: 20, player: new THREE.Vector3(40, 0, -8) });
    let contacts = 0, closest = Infinity, lateral = 0, hardStops = 0;
    const touching = new Set();
    for (let k = 0; k < samples.length; k++) {
      const people = samples[k].people;
      for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
        const d = Math.hypot(people[i][0] - people[j][0], people[i][1] - people[j][1]);
        closest = Math.min(closest, d);
        const key = `${i}-${j}`;
        if (d < .5 && !touching.has(key)) { contacts++; touching.add(key); } else if (d > .7) touching.delete(key);
      }
      if (k > 2) for (let i = 0; i < people.length; i++) {
        const before = samples[k - 1].people[i], earlier = samples[k - 3].people[i];
        // De lado respecto a su ruta: lo que cambia el corrimiento de la mente (la base no tiene: 0).
        lateral = Math.max(lateral, Math.abs(people[i][4] - before[4]) / SAMPLE);
        // Frenazo: de andar (más de 0,8 m/s en los 0,2 s de antes) a casi quieto en 0,1 s.
        const speedNow = Math.hypot(people[i][0] - before[0], people[i][1] - before[1]) / SAMPLE;
        const speedBefore = Math.hypot(before[0] - earlier[0], before[1] - earlier[1]) / (2 * SAMPLE);
        if (speedBefore > .8 && speedNow < .15) hardStops++;
      }
    }
    return { map: { w: 40, h: 3, tiles: () => 'sidewalk' }, samples, metrics: { contacts, closest: +closest.toFixed(2), maxLateral: +lateral.toFixed(2), hardStops } };
  },

  async cruce() {
    Math.random = seeded(33);
    // Andén abajo (filas 0 a 3), calzada (4 a 8) y andén arriba (9 y 10); la cebra son las columnas 10 y 11.
    const map = Array.from({ length: 11 }, (_, z) => Array.from({ length: 30 }, () => (z >= 4 && z <= 8 ? 'road' : 'sidewalk')));
    const nav = new PedestrianNavigation(map, 2, { isCrossing: x => x === 10 || x === 11 });
    const npcs = [];
    for (let k = 0; k < 4; k++) {
      const x = k % 2 ? 22 : 20;
      const npc = await walker(nav, [x, 2], { speed: 1.25 });
      npc.target = null; npc.route = []; npc.wait = 1e9;
      npcs.push(npc);
    }
    const LANE = 12, vehicles = [];
    const car = x => ({ car: { position: new THREE.Vector3(x, 0, LANE), length: 4.4, width: 1.9, group: { rotation: { y: 0 } } }, speed: 9, cruise: 9 });
    const starts = [0, 3.2, 6.4, 9.6];
    // Carros de a dos (a 2,5 s uno del otro) y huecos largos entre pareja y pareja: hay cuándo cruzar y cuándo esperar.
    const arrivals = [0, 2.5, 17, 19.5, 34];
    const samples = simulate({ npcs, seconds: 30, player: new THREE.Vector3(20, 0, -6), vehicles, onFrame: t => {
      if (vehicles.length < arrivals.length && t + 1e-9 >= arrivals[vehicles.length]) vehicles.push(car(-30));
      for (let k = 0; k < npcs.length; k++) if (t >= starts[k] && npcs[k].wait > 1e8) straight(npcs[k], [npcs[k].position.x, 2], [npcs[k].position.x, 20]);
      for (const v of vehicles) {
        // Frena si alguien pisa la franja delante de él (de 2 a 14 m antes del paso), como TrafficSystem.
        const before = 19 - (v.car.position.x + v.car.length / 2);
        const someone = npcs.some(n => n.position.x > 18.5 && n.position.x < 23.5 && Math.abs(n.position.z - LANE) < 3.2);
        const want = someone && before > -.5 && before < 14 ? 0 : v.cruise;
        v.speed += Math.max(-8 * DT, Math.min(3 * DT, want - v.speed));
        v.car.position.x += v.speed * DT;
      }
    } });
    // Por cada uno: cuánto esperó en el borde y con cuánto tiempo bajó a la calzada.
    const metrics = npcs.map((_, i) => {
      let waited = 0, stepOn = null, carStops = 0;
      for (let k = 0; k < samples.length; k++) {
        const s = samples[k], [, z, , , , , waiting] = s.people[i];
        if (waiting) waited += SAMPLE;
        if (!stepOn && z > 7) {
          // El carro más cercano que todavía no pasa la franja.
          let eta = Infinity;
          s.cars.forEach(([x], c) => {
            const speed = k ? (x - samples[k - 1].cars[c]?.[0]) / SAMPLE : 9;
            const gap = 19 - (x + 2.2);
            if (gap > -2 && speed > .5) eta = Math.min(eta, gap / speed);
          });
          stepOn = { t: s.t, eta: Number.isFinite(eta) ? +eta.toFixed(2) : null };
        }
      }
      // Veces que un carro pasó de andar a quedarse quieto (lo frenó alguien en la franja).
      if (i === 0) for (let c = 0; c < samples.at(-1).cars.length; c++) {
        let moving = true;
        for (let k = 1; k < samples.length; k++) {
          const a = samples[k - 1].cars[c], b = samples[k].cars[c];
          if (!a || !b) continue;
          const speed = (b[0] - a[0]) / SAMPLE;
          if (moving && speed < .5) carStops++;
          moving = speed >= .5;
        }
      }
      return { waited: +waited.toFixed(1), stepOn, carStops };
    });
    return { map: { w: 30, h: 11, tiles: (x, z) => (z >= 4 && z <= 8 ? (x === 10 || x === 11 ? 'crossing' : 'road') : 'sidewalk') }, samples, metrics };
  },

  async poste() {
    Math.random = seeded(55);
    const box = pole(21, 1.6), collisions = solids([box]);
    const { samples, metrics } = await headOn({ collisions });
    // Muestras en que alguno quedó metido en el poste (el cuerpo, 20 cm de radio; rozarlo justo en el borde no cuenta).
    const r = .2 - 1e-3;
    const inside = samples.filter(s => s.people.some(([x, z]) => x > box.min.x - r && x < box.max.x + r && z > box.min.z - r && z < box.max.z + r)).length;
    return { map: { ...sidewalkMap(), boxes: [[box.min.x, box.min.z, box.max.x, box.max.z]] }, samples, metrics: { ...metrics, inside } };
  },

  async trabados() {
    Math.random = seeded(66);
    const { samples, metrics } = await headOn({ still: [20, 2.4] });
    return { map: sidewalkMap(), samples, metrics };
  },

  async paraguas() {
    Math.random = seeded(77);
    // La postura la pone Npc al llover (person.paraguas); aquí se fija en cada cuadro.
    const { samples, metrics } = await headOn({ onFrame: (t, npcs) => { for (const n of npcs) n.stance = 'paraguas'; } });
    return { map: sidewalkMap(), samples, metrics };
  },

  async calzada() {
    Math.random = seeded(88);
    // Andén arriba (z 0 a 7), calzada (8 a 17, la cebra en x 20) y andén abajo. Dos señoras cruzan de arriba abajo;
    // cuando van por la mitad, una pelea: para la de x 20, en el andén de abajo; para la de x 34, en el de arriba.
    const map = Array.from({ length: 14 }, (_, z) => Array.from({ length: 30 }, () => (z >= 4 && z <= 8 ? 'road' : 'sidewalk')));
    const nav = new PedestrianNavigation(map, 2, { isCrossing: x => x === 10 || x === 17 });
    const npcs = [];
    for (const x of [20, 34]) {
      const npc = await walker(nav, [x, 2], { arquetipo: 'senora', speed: 1.1 });
      straight(npc, [x, 2], [x, 26]);
      npcs.push(npc);
    }
    const fights = [new THREE.Vector3(24, 0, 20), new THREE.Vector3(38, 0, 4)];
    let started = null, next = 0;
    const samples = simulate({ npcs, seconds: 14, player: new THREE.Vector3(30, 0, -10), onFrame: t => {
      if (t > .05 && t < .07) for (const n of npcs) { setTemper(n, 'miedoso'); if (n.mind) n.mind.temper.far = 0; }
      if (started === null && npcs.every(n => n.position.z >= 11)) started = t;
      if (started !== null && t >= next && t < started + 6) { next = t + 1; for (const f of fights) fight(f); }
    } });
    const metrics = npcs.map((_, i) => {
      const from = samples.findIndex(s => started !== null && s.t >= started);
      const out = samples.findIndex((s, k) => k > from && (s.people[i][1] < 7 || s.people[i][1] > 17));
      return { onRoadAfter: out >= 0 ? +(samples[out].t - started).toFixed(1) : null, exit: out >= 0 ? (samples[out].people[i][1] < 7 ? 'se devolvió' : 'terminó de cruzar') : null };
    });
    return { map: { w: 30, h: 14, tiles: (x, z) => (z >= 4 && z <= 8 ? (x === 10 || x === 17 ? 'crossing' : 'road') : 'sidewalk'), marks: fights.map(f => [f.x, f.z]) }, samples, metrics };
  },

  async corrillo() {
    Math.random = seeded(99);
    const rows = Array.from({ length: 30 }, () => Array.from({ length: 40 }, () => 'sidewalk'));
    const nav = new PedestrianNavigation(rows, 2);
    const center = new THREE.Vector3(40, 0, 30), npcs = [];
    for (const [k, [x, z]] of [[9.4, -3.4], [10, 0], [9.4, 3.4], [-9.4, -3.4], [-10, 0], [-9.4, 3.4]].entries()) {
      const npc = await walker(nav, [center.x + x, center.z + z], { arquetipo: 'estudiante', speed: [.8, 1.1, .7, 1.3, .9, 1.2][k] });
      npc.route = []; npc.target = null; npc.wait = 1e9; npc.root.rotation.y = Math.atan2(-x, -z);
      npcs.push(npc);
    }
    let next = .1;
    const samples = simulate({ npcs, seconds: 30, player: center, onFrame: t => {
      if (t > .05 && t < .07) for (const n of npcs) setTemper(n, 'curioso');
      if (t >= next && t < 12) { next += 1; fight(center); }
    } });
    const arrived = npcs.map((_, i) => {
      const k = samples.findIndex((s, j) => j > 0 && s.t > 1 && Math.hypot(s.people[i][0] - samples[j - 1].people[i][0], s.people[i][1] - samples[j - 1].people[i][1]) < .005 && Math.hypot(s.people[i][0] - center.x, s.people[i][1] - center.z) < 6.2);
      return k >= 0 ? samples[k].t : null;
    });
    const at8 = samples.find(s => s.t >= 8).people.map(([x, z]) => [x, z]);
    let gap = Infinity;
    for (let i = 0; i < at8.length; i++) for (let j = i + 1; j < at8.length; j++) gap = Math.min(gap, Math.hypot(at8[i][0] - at8[j][0], at8[i][1] - at8[j][1]));
    return { map: { w: 40, h: 30, tiles: () => 'sidewalk', marks: [[center.x, center.z]] }, samples, metrics: {
      arrived, ring: at8.map(([x, z]) => +Math.hypot(x - center.x, z - center.z).toFixed(2)), minGap: +gap.toFixed(2)
    } };
  },

  async robo() {
    Math.random = seeded(44);
    const rows = Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => 'sidewalk'));
    const nav = new PedestrianNavigation(rows, 2);
    const random = seeded(45), npcs = [];
    const player = new THREE.Vector3(30, 0, 20);
    for (let k = 0; k < 11; k++) {
      const a = random() * Math.PI * 2, r = 4 + random() * 14;
      npcs.push(await walker(nav, [30 + Math.sin(a) * r, 20 + Math.cos(a) * r * .8], { arquetipo: ['oficinista', 'senora', 'obrero', 'estudiante', 'abuelo'][k % 5], facing: random() * 6.28 }));
    }
    let victim = null, tipos = null;
    const samples = simulate({ npcs, seconds: 24, player, onFrame: t => {
      if (!tipos && t > .1) tipos = npcs.map(n => n.mind?.temper?.tipo ?? null); // antes de que se apaguen las mentes
      if (victim || t < 4) return;
      // El jugador le mete la mano al más cercano y lo pillan: lo que hace steal.js (_robadoTimer y alarmedByTheft).
      victim = npcs.reduce((best, n) => (n.position.distanceTo(player) < best.position.distanceTo(player) ? n : best));
      victim.position.set(player.x + .8, 0, player.z);
      victim._robadoTimer = 30;
      victim.alarmedByTheft(player);
    } });
    const vi = npcs.indexOf(victim);
    const metrics = npcs.map((n, i) => {
      const first = samples.findIndex(s => s.t > 4 && s.people[i][2] >= 1);
      const fled = samples.findIndex(s => s.t > 4 && s.people[i][3]);
      const d0 = Math.hypot(samples[40].people[i][0] - player.x, samples[40].people[i][1] - player.z);
      const d1 = Math.hypot(samples.at(-1).people[i][0] - player.x, samples.at(-1).people[i][1] - player.z);
      return { i, victim: i === vi, tipo: tipos[i], react: first >= 0 ? +(samples[first].t - 4).toFixed(1) : null,
        maxLevel: Math.max(...samples.map(s => s.people[i][2])), fled: fled >= 0 ? +(samples[fled].t - 4).toFixed(1) : null,
        from: +d0.toFixed(1), to: +d1.toFixed(1) };
    });
    return { map: { w: 30, h: 20, tiles: () => 'sidewalk' }, samples, metrics, victim: vi };
  }
};

const out = { root: path.basename(path.resolve(root)), minds: !!minds, scenes: {} };
for (const name of lista.split(',')) {
  const scene = await scenes[name]();
  const tiles = [];
  for (let z = 0; z < scene.map.h; z++) for (let x = 0; x < scene.map.w; x++) tiles.push(scene.map.tiles(x, z));
  out.scenes[name] = { ...scene, map: { w: scene.map.w, h: scene.map.h, size: 2, tiles, boxes: scene.map.boxes ?? [], marks: scene.map.marks ?? [] } };
  console.log(name, JSON.stringify(scene.metrics));
}
await writeFile(salida, JSON.stringify(out));
process.exit(0);
