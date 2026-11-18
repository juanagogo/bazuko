import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { CrowdGrid } from '../src/entities/npc/crowd.js';
import { AVOID, chooseSide, closestApproach, easeSide, passSide, sideStepRoom } from '../src/entities/npc/steering.js';
import { StreetMinds, seededRandom } from '../src/entities/npc/mind.js';
import { pathClear, solidAt } from '../src/entities/npc/room.js';
import { NpcConversations } from '../src/systems/NpcConversations.js';
import { npcSexo } from '../src/systems/StreetVoices.js';

// Esquivarse en la calle: la cuenta del máximo acercamiento, el lado, la rejilla y dos peatones de verdad (Npc real,
// red real) que se cruzan. El cuerpo es una sustitución: solo se mira lo que se le pide.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, snapPose() {}, dispose() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
const { Npc } = await import('../src/entities/Npc.js');

const realRandom = Math.random;
beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = { getElementById() { return null; }, createElement() { return { style: {}, remove() {} }; }, body: { appendChild() {} } };
  Math.random = seededRandom(1234);
});
afterEach(() => { Math.random = realRandom; });

/** Andén de `rows` baldosas de ancho (2 m cada una) y 40 de largo, a lo largo de X. */
function sidewalk(rows = 3) {
  const row = Array.from({ length: 40 }, () => 'sidewalk');
  return new PedestrianNavigation(Array.from({ length: rows }, () => row), 2);
}

async function walker(at, navigation, opts = {}) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(...at), {
    arquetipo: 'oficinista', navigation, facing: 0, groundHeight: () => 0,
    isWalkable: opts.isWalkable ?? ((x, z) => navigation.isWalkableAt(x, z)), collisions: opts.collisions ?? null
  });
  await npc.ready;
  npc.walkSpeed = 1.3;
  npc.person.pausa = 0;
  return npc;
}

/** Cajas sólidas estáticas (postes, puestos), con la consulta de CollisionSystem. */
function solids(boxes) {
  return {
    queryStatic(minX, minZ, maxX, maxZ, out) {
      out.length = 0;
      for (const box of boxes) if (box.max.x >= minX && box.min.x <= maxX && box.max.z >= minZ && box.min.z <= maxZ) out.push({ box });
      return out;
    }
  };
}
const pole = (x, z, size = .24) => new THREE.Box3(new THREE.Vector3(x - size / 2, 0, z - size / 2), new THREE.Vector3(x + size / 2, 3, z + size / 2));

/** Ruta recta por centros de baldosa, de `fromX` a `toX` sobre la fila z. */
function straight(npc, fromX, toX, z) {
  const route = [];
  const dir = Math.sign(toX - fromX);
  for (let x = fromX + 2 * dir; dir > 0 ? x <= toX : x >= toX; x += 2 * dir) route.push(new THREE.Vector3(x, 0, z));
  npc.route = route; npc.routeIndex = 0; npc.target = route[0]; npc.wait = 0; npc.stance = null; npc.action = null;
}

function street(npcs, extra = []) {
  const district = { npcs, trafficPedestrians: [...npcs, ...extra] };
  return { district, minds: new StreetMinds(district) };
}

/** Corre la calle `seconds` a `dt`, como Bogota.update: primero las mentes y luego cada NPC. */
function run({ district, minds }, seconds, player, onFrame = () => {}, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) {
    minds.beginFrame(dt, player);
    for (const npc of district.npcs) npc.update(dt, { player });
    onFrame(t);
  }
}

test('máximo acercamiento: de frente se encuentran a la suma de las velocidades; al alejarse, ahora', () => {
  const out = {};
  closestApproach(0, 4, 0, -2.4, 5, out);
  assert.ok(Math.abs(out.t - 4 / 2.4) < 1e-9);
  assert.ok(out.dist < 1e-9);
  closestApproach(1, 4, 0, -2.4, 5, out);
  assert.ok(Math.abs(out.dist - 1) < 1e-9, 'pasa a un metro de lado');
  closestApproach(0, 4, 0, 1, 5, out);
  assert.equal(out.t, 0, 'se aleja: el momento más cercano es ahora');
  assert.equal(out.dist, 4);
  closestApproach(-3, 3, 1, -1, 1, out);
  assert.equal(out.t, 1, 'no mira más allá del horizonte');
  closestApproach(2, 0, 0, 0, 5, out);
  assert.equal(out.t, 0, 'quieto los dos: ahora');
});

test('lado: de frente los dos a su derecha; si el otro ya pasa por un lado, al contrario', () => {
  // Mirando hacia +Z, la derecha es −X.
  assert.equal(chooseSide(0, 1, 0, 0), 1);
  assert.equal(chooseSide(0, 1, .1, 0), 1, 'casi centrado: a la derecha');
  assert.equal(chooseSide(0, 1, -.8, 0), -1, 'el otro le queda a la derecha: se corre a la izquierda');
  assert.equal(chooseSide(0, 1, .8, 0), 1, 'el otro le queda a la izquierda: a la derecha');
  // Los dos que vienen de frente, cada uno desde su lado, eligen moverse en sentidos opuestos del mundo.
  const a = chooseSide(1, 0, 0, 0), b = chooseSide(-1, 0, 0, 0);
  assert.equal(a, 1); assert.equal(b, 1);
  const aWorldZ = a * 1, bWorldZ = b * -1; // derecha de +X es +Z; derecha de −X es −Z
  assert.ok(aWorldZ * bWorldZ < 0, 'se separan');
});

test('la rejilla trae a los vecinos, estima su velocidad y no repite a nadie', () => {
  const grid = new CrowdGrid(2);
  const agents = Array.from({ length: 9 }, (_, i) => ({ position: new THREE.Vector3(i * 1.5, 0, 0) }));
  for (const a of agents) grid.add(a, a.position, 1 / 60);
  const out = new Int32Array(32);
  const n = grid.query(3, 0, 3, out);
  const found = new Set(Array.from(out.subarray(0, n), i => grid.agents[i]));
  assert.equal(found.size, n, 'sin repetidos');
  for (const a of agents) if (Math.abs(a.position.x - 3) <= 3) assert.ok(found.has(a), `falta el de x=${a.position.x}`);
  // Siguiente cuadro: el primero anduvo 2 cm, el segundo fue puesto a 10 m.
  grid.clear();
  agents[0].position.x += .02; agents[1].position.x += 10;
  for (const a of agents) grid.add(a, a.position, 1 / 60);
  assert.ok(Math.abs(grid.velocityX(agents[0]) - .6) < 1e-6, `${grid.velocityX(agents[0])}`);
  assert.equal(grid.velocityX(agents[1]), 0, 'un salto no es velocidad');
  // La velocidad vive en la rejilla, no en el agente: no se le pegan campos a quien pasa.
  assert.equal(Object.keys(agents[0]).join(), 'position');
});

test('en un gentío de más de 32 el jugador siempre entra en la consulta de vecinos', () => {
  // La lista de vecinos tiene 32 puestos. El jugador entra primero en la rejilla y queda al final de la cadena de su
  // celda: en un corrillo grande era el primero en caerse, y con él la esquiva y el miedo hacia él.
  const player = new THREE.Vector3(10, 0, 10);
  const crowd = Array.from({ length: 60 }, (_, i) => ({ position: new THREE.Vector3(8.2 + (i % 8) * .45, 0, 8.2 + Math.floor(i / 8) * .45) }));
  const { minds } = street([], crowd);
  minds.beginFrame(1 / 60, player);
  for (const [x, z, r] of [[10, 10, 3], [9, 11, 6], [11.5, 8.5, 1.5]]) {
    const n = minds.grid.query(x, z, r, minds.neighbors);
    assert.equal(n, minds.neighbors.length, 'la lista va llena');
    const found = Array.from(minds.neighbors.subarray(0, n), i => minds.grid.agents[i]);
    assert.ok(found.includes(minds._playerAgent), `el jugador falta en la consulta desde (${x}, ${z})`);
    assert.equal(new Set(found).size, n, 'sin repetidos');
  }
  // Lejos del jugador la consulta no lo mete por meterlo.
  const far = minds.grid.query(40, 40, 3, minds.neighbors);
  assert.ok(!Array.from(minds.neighbors.subarray(0, far), i => minds.grid.agents[i]).includes(minds._playerAgent));
});

test('dos peatones de frente por el mismo andén se cruzan con su espacio, cada uno corriéndose su parte, sin zigzag', async () => {
  for (const off of [0, .2]) {
    const nav = sidewalk(3);
    const a = await walker([4, 0, 2], nav), b = await walker([36, 0, 2 + off], nav);
    straight(a, 4, 36, 2); straight(b, 36, 4, 2 + off);
    const scene = street([a, b]);
    const player = new THREE.Vector3(20, 0, 12); // cerca, para que piensen, pero fuera del andén
    // Zigzag: el desvío de uno respecto al otro venía creciendo y se devuelve más de 2 cm (o al revés), estando a menos
    // de 4 m. Abrirse para pasar y cerrarse después es un cambio; temblar son más.
    let closest = Infinity, swings = 0, way = 0, edge = b.position.z - a.position.z;
    const most = [0, 0];
    run(scene, 26, player, () => {
      const gap = a.position.distanceTo(b.position);
      closest = Math.min(closest, gap);
      most[0] = Math.max(most[0], Math.abs(a.mind.side)); most[1] = Math.max(most[1], Math.abs(b.mind.side));
      if (gap >= 4) return;
      const lateral = b.position.z - a.position.z;
      if (!way) { if (Math.abs(lateral - edge) > .02) { way = Math.sign(lateral - edge); edge = lateral; } }
      else if ((lateral - edge) * way > 0) edge = lateral;
      else if (Math.abs(lateral - edge) > .02) { swings++; way = -way; edge = lateral; }
    });
    assert.ok(closest >= .8, `desfase ${off}: se acercaron a ${closest.toFixed(2)} m`);
    assert.ok(swings <= 1, `desfase ${off}: ${swings} cambios de lado: zigzag`);
    // Cada uno pone lo suyo: ninguno se queda en su línea esperando que el otro se corra todo.
    assert.ok(Math.min(...most) >= .3 && Math.abs(most[0] - most[1]) < .1, `desfase ${off}: uno se corrió ${most[0].toFixed(2)} m y el otro ${most[1].toFixed(2)} m`);
    assert.ok(a.position.x > 30 && b.position.x < 10, `desfase ${off}: no llegaron: ${a.position.x.toFixed(1)} y ${b.position.x.toFixed(1)}`);
    a.dispose(); b.dispose();
  }
});

test('dos de frente escogen lado a unos 5 m, se corren a no más de 0,5 m/s sin frenar, sostienen el lado hasta cruzarse y después vuelven a su línea', async () => {
  const nav = sidewalk(3);
  const a = await walker([4, 0, 2], nav), b = await walker([36, 0, 2], nav);
  straight(a, 4, 36, 2); straight(b, 36, 4, 2);
  const scene = street([a, b]);
  let t = 0, startGap = null, lateral = 0, minPace = 1, crossedAt = null, backAt = null, heldLeast = Infinity;
  const last = [0, 0], most = [0, 0];
  run(scene, 22, new THREE.Vector3(20, 0, -8), () => {
    t += 1 / 60;
    const gap = a.position.distanceTo(b.position);
    if (startGap === null && (Math.abs(a.mind.side) > .02 || Math.abs(b.mind.side) > .02)) startGap = gap;
    [a, b].forEach((npc, k) => {
      lateral = Math.max(lateral, Math.abs(npc.mind.side - last[k]) * 60);
      last[k] = npc.mind.side;
      most[k] = Math.max(most[k], Math.abs(npc.mind.side));
      minPace = Math.min(minPace, npc.mind.paceFactor());
    });
    if (crossedAt === null && a.position.x > b.position.x) {
      crossedAt = t;
      // Al cruzarse siguen corridos casi todo lo que se corrieron: el lado no se venció antes.
      heldLeast = Math.min(Math.abs(a.mind.side) / most[0], Math.abs(b.mind.side) / most[1]);
    }
    if (crossedAt !== null && backAt === null && Math.abs(a.mind.side) < .02 && Math.abs(b.mind.side) < .02) backAt = t;
  });
  assert.ok(startGap !== null && startGap >= 4 && startGap <= 6, `empezaron a correrse a ${startGap?.toFixed(2)} m`);
  assert.ok(lateral <= AVOID.sideRate + 1e-6 && AVOID.sideRate <= .5, `de lado a ${lateral.toFixed(2)} m/s`);
  assert.ok(minPace > .9, `bajó el paso a ${minPace.toFixed(2)}`);
  assert.ok(heldLeast >= .95, `al cruzarse ya había soltado el lado (${heldLeast.toFixed(2)} de lo corrido)`);
  assert.ok(backAt !== null && backAt - crossedAt >= .3 && backAt - crossedAt <= 2, `volvieron a su línea ${(backAt - crossedAt).toFixed(2)} s después de cruzarse`);
  a.dispose(); b.dispose();
});

test('con el jugador plantado en medio del andén lo rodea en vez de caminarle encima', async () => {
  const nav = sidewalk(3);
  const a = await walker([4, 0, 2], nav);
  straight(a, 4, 36, 2);
  const scene = street([a]);
  const player = new THREE.Vector3(20, 0, 2);
  let closest = Infinity;
  run(scene, 30, player, () => { closest = Math.min(closest, a.position.distanceTo(player)); });
  assert.ok(closest >= .75, `pasó a ${closest.toFixed(2)} m del jugador`);
  assert.ok(a.position.x > 30, `se quedó en x=${a.position.x.toFixed(1)}`);
  a.dispose();
});

test('con poco sitio a los lados el de menor número cede y el otro pasa sin rozarlo', async () => {
  const nav = sidewalk(1);
  // Pasillo de 60 cm entre una pared y un puesto: cada uno se corre como mucho 30 cm.
  const narrow = (x, z) => nav.isWalkableAt(x, z) && Math.abs(z) < .3;
  const a = await walker([4, 0, 0], nav, { isWalkable: narrow }), b = await walker([36, 0, 0], nav, { isWalkable: narrow });
  straight(a, 4, 36, 0); straight(b, 36, 4, 0);
  const scene = street([a, b]);
  const player = new THREE.Vector3(20, 0, 15);
  let closest = Infinity, aStopped = 0, bStopped = 0;
  run(scene, 30, player, () => {
    const d = a.position.distanceTo(b.position);
    closest = Math.min(closest, d);
    if (d < 2.5) { if (!a.moving) aStopped++; if (!b.moving) bStopped++; }
  });
  assert.ok(a.mind.id < b.mind.id);
  assert.ok(closest >= .5, `se rozaron: ${closest.toFixed(2)} m`);
  assert.ok(aStopped > bStopped, `cede el de menor número (${aStopped} cuadros quieto contra ${bStopped})`);
  assert.ok(Math.abs(a.position.x - b.position.x) > 6, 'los dos siguieron su camino');
  a.dispose(); b.dispose();
});

test('sin ningún sitio nadie se atraviesa y quien cede busca otro camino en vez de esperar para siempre', async () => {
  const nav = sidewalk(1);
  const wall = (x, z) => nav.isWalkableAt(x, z) && Math.abs(z) < .15;
  const a = await walker([4, 0, 0], nav, { isWalkable: wall }), b = await walker([36, 0, 0], nav, { isWalkable: wall });
  straight(a, 4, 36, 0); straight(b, 36, 4, 0);
  const scene = street([a, b]);
  const player = new THREE.Vector3(20, 0, 15);
  let closest = Infinity, firstReroute = null, time = 0;
  const routes = [a.route, b.route];
  run(scene, 25, player, () => {
    time += 1 / 60;
    closest = Math.min(closest, a.position.distanceTo(b.position));
    if (firstReroute === null && (a.route !== routes[0] || b.route !== routes[1])) firstReroute = time;
  });
  assert.ok(closest >= .5, `se atravesaron: ${closest.toFixed(2)} m`);
  assert.ok(firstReroute !== null && firstReroute < 20, `nadie buscó otro camino (${firstReroute})`);
  a.dispose(); b.dispose();
});

test('a quien viene corriendo le abre paso: frena y se aparta de su línea', async () => {
  const nav = sidewalk(3);
  const a = await walker([4, 0, 2], nav);
  straight(a, 4, 36, 2);
  // Un agente cualquiera de la lista de la calle (un policía a pie, un conductor bravo): corre hacia él a 6 m/s.
  const runner = { position: new THREE.Vector3(16, 0, 2) };
  const scene = street([a], [runner]);
  const player = new THREE.Vector3(20, 0, 14);
  let minPace = 1, closest = Infinity, startZ = a.position.z, maxShift = 0;
  run(scene, 2.4, player, () => {
    runner.position.x -= 6 / 60;
    minPace = Math.min(minPace, a.mind.paceFactor());
    closest = Math.min(closest, a.position.distanceTo(runner.position));
    maxShift = Math.max(maxShift, Math.abs(a.position.z - startZ));
  });
  assert.ok(minPace < .5, `no frenó (ritmo ${minPace.toFixed(2)})`);
  assert.ok(maxShift > .3, `no se apartó (${maxShift.toFixed(2)} m)`);
  assert.ok(closest > .6, `pasó a ${closest.toFixed(2)} m`);
  a.dispose();
});

test('lejos del jugador no gasta en esquivar: va por su línea a su paso', async () => {
  const nav = sidewalk(3);
  const a = await walker([4, 0, 2], nav), b = await walker([36, 0, 2], nav);
  straight(a, 4, 36, 2); straight(b, 36, 4, 2);
  const scene = street([a, b]);
  // Se cruzan de frente hacia los 12 s; cerca del jugador, a esa altura ya se estarían corriendo de lado.
  let side = 0, pace = 1, crossed = false;
  run(scene, 25, new THREE.Vector3(300, 0, 300), () => {
    side = Math.max(side, Math.abs(a.mind.side), Math.abs(b.mind.side));
    pace = Math.min(pace, a.mind.paceFactor(), b.mind.paceFactor());
    if (a.position.x > b.position.x) crossed = true;
  });
  assert.ok(crossed, 'se cruzaron');
  assert.equal(side, 0);
  assert.equal(pace, 1);
  a.dispose(); b.dispose();
});

test('quien arranca ruta todavía corrido de lado llega a su primer punto y sigue, sin dar vueltas alrededor', async () => {
  // Dos que arrancan del mismo sitio: uno se corre para no pisar al otro. En el primer tramo (sin punto anterior) la
  // línea no se puede medir desde donde va: el punto corrido giraría con él y daría vueltas alrededor.
  const nav = sidewalk(3);
  const a = await walker([20, 0, 2.02], nav), b = await walker([20, 0, 2], nav);
  b.wait = 1e9; b.target = null; b.route = [];
  straight(a, 20, 34, 2);
  const scene = street([a, b]);
  let reached = null;
  run(scene, 14, new THREE.Vector3(20, 0, -6), t => { if (reached === null && a.routeIndex >= 1) reached = t; });
  assert.ok(reached !== null && reached < 3, `llegó al primer punto (a 2 m) a los ${reached} s`);
  assert.ok(a.position.x > 31, `quedó en x = ${a.position.x.toFixed(2)}`);
  a.dispose(); b.dispose();
});

test('esquivar no cambia el azar del juego: Math.random sigue la misma secuencia', async () => {
  const nav = sidewalk(3);
  const a = await walker([4, 0, 2], nav), b = await walker([36, 0, 2], nav);
  straight(a, 4, 36, 2); straight(b, 36, 4, 2);
  const scene = street([a, b]);
  let calls = 0;
  const seeded = Math.random;
  Math.random = () => { calls++; return seeded(); };
  run(scene, 6, new THREE.Vector3(20, 0, 12));
  Math.random = seeded;
  assert.equal(calls, 0, `${calls} llamadas a Math.random al esquivar`);
  assert.ok(AVOID.personal >= .4 && AVOID.personal <= .5);
  a.dispose(); b.dispose();
});

test('un empujón del jugador lo corre un poco y lo hace quejarse, sin repetir la queja a cada paso', async () => {
  const nav = sidewalk(3);
  const a = await walker([20, 0, 2], nav);
  a.wait = 30; a.target = null; a.route = [];
  const said = [];
  a.say = text => said.push(text);
  const scene = street([a]);
  const player = new THREE.Vector3(18.6, 0, 2);
  const start = a.position.clone();
  // El jugador anda hacia él a 3 m/s y se le mete encima.
  run(scene, 1.2, player, () => { player.x += 3 / 60; });
  assert.ok(a.position.distanceTo(start) > .1, 'no lo corrió');
  assert.equal(said.length <= 1, true, `${said.length} quejas en un segundo`);
  const { PUSH_PHRASES } = await import('../src/entities/npc/mind.js');
  for (const text of said) assert.ok(PUSH_PHRASES.includes(text));
  a.dispose();
});

test('parado en el andén, se quita de lado cuando alguien viene corriendo derecho hacia él', async () => {
  const nav = sidewalk(3);
  const a = await walker([20, 0, 2], nav);
  a.wait = 30; a.target = null; a.route = [];
  const runner = { position: new THREE.Vector3(28, 0, 2.1) };
  const scene = street([a], [runner]);
  const player = new THREE.Vector3(20, 0, 14);
  let closest = Infinity;
  run(scene, 2, player, () => { runner.position.x -= 6 / 60; closest = Math.min(closest, a.position.distanceTo(runner.position)); });
  assert.ok(closest > .7, `lo rozó a ${closest.toFixed(2)} m`);
  assert.ok(nav.isWalkableAt(a.position.x, a.position.z), 'se quedó en el andén');
  a.dispose();
});

test('correrse de lado mira todo el trecho: un poste al costado, aunque no esté adelante, no deja sitio de ese lado', async () => {
  const nav = sidewalk(3);
  // Va hacia +X por z = 2: su derecha es +Z. Poste a 35 cm a su derecha, justo al lado (no 80 cm adelante).
  const a = await walker([10, 0, 2], nav, { collisions: solids([pole(10, 2.35)]) });
  straight(a, 10, 36, 2);
  street([a]).minds.beginFrame(1 / 60, new THREE.Vector3(10, 0, 8));
  a.mind._segX = 1; a.mind._segZ = 0; a.mind.side = 0;
  assert.equal(a.mind.roomFor(.6), false, 'a la derecha está el poste');
  assert.equal(a.mind.roomFor(-.6), true, 'a la izquierda hay sitio');
  // El poste más adelante, en la línea nueva: tampoco.
  const b = await walker([10, 0, 2], nav, { collisions: solids([pole(10.8, 2.6)]) });
  straight(b, 10, 36, 2);
  street([b]).minds.beginFrame(1 / 60, new THREE.Vector3(10, 0, 8));
  b.mind._segX = 1; b.mind._segZ = 0; b.mind.side = 0;
  assert.equal(b.mind.roomFor(.6), false);
  assert.equal(b.mind.roomFor(-.6), true);
  a.dispose(); b.dispose();
});

test('dos de frente con un poste a 55 cm de la línea: se cruzan sin que ninguno pase por encima del poste', async () => {
  const report = [];
  for (let x = 16; x <= 24; x++) {
    const nav = sidewalk(3);
    const collisions = solids([pole(x, 2.55)]); // a la derecha del que va hacia +X, donde se corre para esquivar
    const a = await walker([4, 0, 2], nav, { collisions }), b = await walker([36, 0, 2], nav, { collisions });
    straight(a, 4, 36, 2); straight(b, 36, 4, 2);
    const scene = street([a, b]);
    let inside = 0, closest = Infinity;
    run(scene, 26, new THREE.Vector3(20, 0, 12), () => {
      for (const npc of [a, b]) if (solidAt(collisions, npc.position.x, 0, npc.position.z)) inside++;
      closest = Math.min(closest, a.position.distanceTo(b.position));
    });
    report.push({ x, inside, closest: +closest.toFixed(2), a: +a.position.x.toFixed(1), b: +b.position.x.toFixed(1) });
    a.dispose(); b.dispose();
  }
  assert.ok(report.every(r => r.inside === 0), JSON.stringify(report.filter(r => r.inside)));
  assert.ok(report.every(r => r.closest >= .5), JSON.stringify(report));
  assert.ok(report.every(r => r.a > 30 && r.b < 10), `no llegaron: ${JSON.stringify(report)}`);
});

test('al volver a su línea tampoco se mete en un poste ni se sale del andén', async () => {
  // Quedó corrido 60 cm a la izquierda de una línea nueva (pasa tras una esquina o al tomar otra ruta) y nadie le
  // estorba: vuelve despacio a la línea, de lado. Justo a su derecha, en el camino de vuelta, el borde o un poste.
  const cases = [
    { kind: 'borde', nav: sidewalk(1), line: 0, at: [10, 0, .85], collisions: null },    // andén de z = -1 a z = 1
    { kind: 'poste', nav: sidewalk(3), line: 2, at: [10, 0, 2], collisions: solids([pole(10.5, 2.45, .3)]) }
  ];
  for (const { kind, nav, line, at, collisions } of cases) {
    const a = await walker(at, nav, { collisions });
    a.route = [new THREE.Vector3(8, 0, line), new THREE.Vector3(20, 0, line)]; a.routeIndex = 1; a.target = a.route[1]; a.wait = 0;
    const scene = street([a]);
    const player = new THREE.Vector3(10, 0, 9);
    scene.minds.beginFrame(1 / 60, player);
    a.mind._steerFrame = scene.minds.frame; a.mind.side = -.6; a.mind.sideHold = 0;
    let offNet = 0, inside = 0;
    run(scene, 3, player, () => {
      if (!nav.isWalkableAt(a.position.x, a.position.z)) offNet++;
      if (collisions && solidAt(collisions, a.position.x, 0, a.position.z)) inside++;
    });
    assert.equal(offNet, 0, `${kind}: se salió del andén`);
    assert.equal(inside, 0, `${kind}: se metió en el poste`);
    assert.ok(a.position.x > 12, `${kind}: siguió su camino (x = ${a.position.x.toFixed(1)})`);
    a.dispose();
  }
});

test('corrido de lado con un poste más adelante en esa línea: vuelve a la suya antes de llegar, sin pisar el poste ni dejar la ruta', async () => {
  // Andar hacia adelante solo mira la red, no los sólidos: lo que hay en la línea corrida lo tiene que ver la mente.
  // Va hacia +X por z = 2, corrido 60 cm a la izquierda (z = 1,4); el poste está en esa línea, a 1 a 1,4 m.
  for (const ahead of [1, 1.2, 1.4]) {
    const nav = sidewalk(3), collisions = solids([pole(10 + ahead, 1.4, .3)]);
    const a = await walker([10, 0, 1.4], nav, { collisions });
    a.route = [new THREE.Vector3(8, 0, 2), new THREE.Vector3(30, 0, 2)]; a.routeIndex = 1; a.target = a.route[1]; a.wait = 0;
    const route = a.route, scene = street([a]), player = new THREE.Vector3(10, 0, 9);
    scene.minds.beginFrame(1 / 60, player);
    a.mind._steerFrame = scene.minds.frame; a.mind.side = -.6; a.mind.sideHold = 0;
    let inside = 0;
    run(scene, 3, player, () => { if (solidAt(collisions, a.position.x, 0, a.position.z)) inside++; });
    assert.equal(inside, 0, `poste a ${ahead} m: se metió en él`);
    assert.equal(a.route, route, `poste a ${ahead} m: dejó su ruta`);
    assert.ok(a.position.x > 12.5, `poste a ${ahead} m: siguió su camino (x = ${a.position.x.toFixed(1)})`);
    a.dispose();
  }
});

test('frente a frente junto a un poste no se quedan trabados: uno cede con un desempate fijo y el otro pasa, sin copiarse de lado', async () => {
  // Andén recto, los dos por z = 2, y un poste de 24 cm a 0,4 m de la línea: del lado al que se corre el que va hacia
  // −X. Varias posiciones del poste a lo largo y a los dos lados.
  const report = [];
  for (const pz of [1.6, 2.4]) for (let px = 17; px <= 24; px++) {
    const nav = sidewalk(3), collisions = solids([pole(px, pz)]);
    const a = await walker([4, 0, 2], nav, { collisions }), b = await walker([36, 0, 2], nav, { collisions });
    straight(a, 4, 36, 2); straight(b, 36, 4, 2);
    const scene = street([a, b]);
    let stuck = 0, worst = 0, inside = 0, closest = Infinity, flips = 0, tieBreaks = 0;
    const last = [a.position.clone(), b.position.clone()], lastSide = [0, 0];
    run(scene, 26, new THREE.Vector3(20, 0, 12), () => {
      const d = a.position.distanceTo(b.position);
      closest = Math.min(closest, d);
      // Trabados: cerca y ninguno de los dos avanza hacia donde va.
      const ax = a.position.x - last[0].x, bx = last[1].x - b.position.x;
      stuck = d < 1.2 && ax < .1 / 60 && bx < .1 / 60 ? stuck + 1 / 60 : 0;
      worst = Math.max(worst, stuck);
      // El desempate: cede (se queda) el de menor número, nunca el otro.
      if (a.mind.yielding && a.mind.passing) tieBreaks++;
      if (b.mind.yielding && b.mind.passing) tieBreaks = -Infinity;
      [a, b].forEach((n, k) => {
        last[k].copy(n.position);
        if (solidAt(collisions, n.position.x, 0, n.position.z)) inside++;
        // Copiarse de lado: el que ya se corrió para un lado se devuelve y se corre para el otro.
        const side = Math.abs(n.mind.side) > .1 ? Math.sign(n.mind.side) : 0;
        if (d < 3 && side && lastSide[k] && side !== lastSide[k]) flips++;
        if (side) lastSide[k] = side;
      });
    });
    assert.ok(a.mind.id < b.mind.id);
    report.push({ px, pz, worst: +worst.toFixed(2), inside, closest: +closest.toFixed(2), flips, tieBreaks, a: +a.position.x.toFixed(1), b: +b.position.x.toFixed(1) });
    a.dispose(); b.dispose();
  }
  assert.ok(report.every(r => r.worst <= AVOID.standoff + .25), `trabados: ${JSON.stringify(report.filter(r => r.worst > AVOID.standoff + .25))}`);
  assert.ok(report.every(r => r.inside === 0), JSON.stringify(report.filter(r => r.inside)));
  assert.ok(report.every(r => r.closest >= .55), `se rozaron: ${JSON.stringify(report.filter(r => r.closest < .55))}`);
  assert.ok(report.every(r => r.flips === 0), `se copiaron de lado: ${JSON.stringify(report.filter(r => r.flips))}`);
  assert.ok(report.every(r => r.a > 30 && r.b < 10), `no llegaron: ${JSON.stringify(report)}`);
  assert.ok(report.every(r => r.tieBreaks >= 0), `cedió el de mayor número: ${JSON.stringify(report.filter(r => r.tieBreaks < 0))}`);
});

test('trabados frente a frente, cede siempre el de menor número: espera en su sitio y el otro se corre y pasa, sin espejo', async () => {
  // Se encuentran de golpe a 0,7 m (uno sale de una puerta): los dos frenan en seco y quedan frente a frente. En un
  // andén ancho y en un pasillo de 60 cm, y con los números al revés (que no dependa de quién va hacia dónde).
  const report = [];
  for (const [narrow, gap, swap] of [[false, .7, false], [false, .7, true], [true, .7, false], [true, .7, true]]) {
    const nav = sidewalk(3);
    const isWalkable = narrow ? (x, z) => nav.isWalkableAt(x, z) && Math.abs(z - 2) < .3 : undefined;
    const first = await walker([20, 0, 2], nav, { isWalkable }), second = await walker([20 + gap, 0, 2], nav, { isWalkable });
    const [a, b] = swap ? [second, first] : [first, second]; // a va hacia +X; `first` tiene el número menor
    a.position.set(20, 0, 2); b.position.set(20 + gap, 0, 2);
    straight(a, 20, 36, 2); straight(b, 20 + gap, 4, 2);
    const low = first, high = second, scene = street([first, second]); // el número sale del orden en la calle
    let t = 0, tie = null, wrong = 0, passedAt = null, closest = Infinity, crept = 0, flips = 0;
    const lastSide = [0, 0], lowFrom = low.position.clone();
    run(scene, 6, new THREE.Vector3(20, 0, 12), () => {
      t += 1 / 60;
      closest = Math.min(closest, a.position.distanceTo(b.position));
      if (high.mind.yielding && high.mind.passing) wrong++;
      if (low.mind.yielding && low.mind.passing) {
        tie ??= t;
        // Mientras cede no avanza hacia el otro (el paso atrás sí se vale).
        crept = Math.max(crept, (low.position.x - lowFrom.x) * (low === a ? 1 : -1));
      } else lowFrom.copy(low.position);
      if (passedAt === null && a.position.x > b.position.x + .3) passedAt = t;
      [a, b].forEach((n, k) => {
        const side = Math.abs(n.mind.side) > .05 ? Math.sign(n.mind.side) : 0;
        if (side && lastSide[k] && side !== lastSide[k]) flips++;
        if (side) lastSide[k] = side;
      });
    });
    assert.ok(low.mind.id < high.mind.id);
    report.push({ narrow, gap, swap, tie: tie && +tie.toFixed(2), wrong, crept: +crept.toFixed(3), passedAt: passedAt && +passedAt.toFixed(2), closest: +closest.toFixed(2), flips });
    a.dispose(); b.dispose();
  }
  const bad = (what, ok) => assert.ok(report.every(ok), `${what}: ${JSON.stringify(report.filter(r => !ok(r)))}`);
  bad('nunca cede el de mayor número', r => r.wrong === 0);
  bad('quien cede no avanza', r => r.crept < .02);
  bad('el desempate llega a los 0,4 s de quedar trabados', r => r.tie === null || r.tie < AVOID.standoff + .2);
  bad('se pasan en menos de 2 s', r => r.passedAt !== null && r.passedAt < 2);
  bad('sin rozarse', r => r.closest >= .5);
  bad('sin cambiar de lado', r => r.flips === 0);
  assert.ok(report.filter(r => r.tie !== null).length >= 2, `hizo falta el desempate: ${JSON.stringify(report)}`);
});

test('de golpe a un metro y un poco corridos de lado: cada uno se aparta de donde le queda el otro, sin pasarse por delante', async () => {
  // Así de cerca ya no hay tiempo de que los dos se corran a su derecha: con el otro corrido 8 a 24 cm hacia ese lado,
  // se le cruzaban por delante y quedaban frente a frente.
  const report = [];
  for (const gap of [.9, 1.1]) for (const off of [.08, .16, .24, -.16]) {
    const nav = sidewalk(3);
    const a = await walker([20, 0, 2], nav), b = await walker([20 + gap, 0, 2 + off], nav);
    straight(a, 20, 36, 2); straight(b, 20 + gap, 4, 2 + off);
    const scene = street([a, b]);
    let closest = Infinity, apart = Infinity, tie = 0, passed = false;
    run(scene, 4, new THREE.Vector3(20, 0, 12), () => {
      closest = Math.min(closest, a.position.distanceTo(b.position));
      if (a.position.x < b.position.x) apart = Math.min(apart, Math.abs(a.position.z - b.position.z));
      if ((a.mind.yielding && a.mind.passing) || (b.mind.yielding && b.mind.passing)) tie++;
      if (a.position.x > b.position.x + .3) passed = true;
    });
    report.push({ gap, off, closest: +closest.toFixed(2), apart: +apart.toFixed(2), tie, passed });
    a.dispose(); b.dispose();
  }
  const bad = (what, ok) => assert.ok(report.every(ok), `${what}: ${JSON.stringify(report.filter(r => !ok(r)))}`);
  bad('ninguno se le pasa por delante al otro', r => r.apart >= Math.abs(r.off) - .01);
  bad('no hace falta desempate', r => r.tie === 0);
  bad('se pasan sin rozarse', r => r.passed && r.closest >= .6);
});

test('con alguien parado junto a la línea justo donde se cruzan, llegando a la vez cede el de menor número y los dos pasan sin echarse encima ni devolverse', async () => {
  // El jugador (o alguien quieto) a 30-50 cm de la línea de los dos: los dos lo tienen que rodear por el mismo lado y
  // ahí no caben a la vez. Llegan al mismo tiempo: cede el de menor número, antes del quieto, y el otro pasa. Antes se
  // acercaban a 6-12 cm, uno daba media vuelta o quedaban frente a frente hasta el desempate.
  const report = [];
  for (const [who, z] of [['jugador', 2.3], ['jugador', 2.4], ['jugador', 2.5], ['peatón', 2.4]]) {
    const nav = sidewalk(3);
    const a = await walker([6, 0, 2], nav), b = await walker([34, 0, 2], nav);
    straight(a, 6, 36, 2); straight(b, 34, 4, 2);
    const still = who === 'peatón' ? await walker([20, 0, z], nav) : null;
    if (still) { still.route = []; still.target = null; still.wait = 1e6; }
    const player = who === 'jugador' ? new THREE.Vector3(20, 0, z) : new THREE.Vector3(20, 0, 12);
    const scene = street(still ? [a, b, still] : [a, b]);
    const routes = [a.route, b.route];
    let closest = Infinity, wrong = 0, agreed = 0, turned = false, aIn = false, bIn = false;
    run(scene, 26, player, () => {
      if (still) still.position.set(20, 0, z);
      closest = Math.min(closest, a.position.distanceTo(b.position));
      if (b.mind.yielding && (b.mind.passing || b.mind.neckWith === a)) wrong++;
      if (a.mind.neckWith === b && !a.mind.neckFirst && b.mind.neckFirst) agreed++;
      // Cambiar de ruta antes de llegar es devolverse; al llegar, cada uno toma la siguiente.
      aIn ||= a.position.x > 35.5; bIn ||= b.position.x < 4.5;
      if ((!aIn && a.route !== routes[0]) || (!bIn && b.route !== routes[1])) turned = true;
    });
    report.push({ who, z, closest: +closest.toFixed(2), agreed, wrong, turned, aIn, bIn });
    a.dispose(); b.dispose(); still?.dispose();
  }
  const bad = (what, ok) => assert.ok(report.every(ok), `${what}: ${JSON.stringify(report.filter(r => !ok(r)))}`);
  bad('no se echan encima', r => r.closest >= .45);
  bad('ninguno se devuelve y los dos llegan', r => !r.turned && r.aIn && r.bIn);
  bad('nunca cede el de mayor número', r => r.wrong === 0);
  bad('se pusieron de acuerdo: cede el de menor número', r => r.agreed > 0);
});

/**
 * Dos de frente por z = 2 (`a` de `aFrom` a `aTo`, `b` de `bFrom` a `bTo`) y alguien quieto en (20, z): el jugador o
 * un peatón parado. Devuelve lo que se mide en cada caso: distancias más cortas, tiempo a menos de 0,55 m, paso atrás,
 * si alguno cambió de ruta antes de llegar, cuándo llegó cada uno, el ritmo más bajo, quién cedió el cuello y cuántas
 * veces cambió de sentido de lado (más de 15 cm) antes de pasar al quieto.
 */
async function threeBodies({ who, z, aFrom, aTo, bFrom, bTo, order = 'ab', seconds = 40, onFrame = () => {} }) {
  const nav = sidewalk(3);
  const a = await walker([aFrom, 0, 2], nav), b = await walker([bFrom, 0, 2], nav);
  straight(a, aFrom, aTo, 2); straight(b, bFrom, bTo, 2);
  const still = who === 'peatón' ? await walker([20, 0, z], nav) : null;
  if (still) { still.route = []; still.target = null; still.wait = 1e6; }
  const player = who === 'jugador' ? new THREE.Vector3(20, 0, z) : new THREE.Vector3(20, 0, 12);
  const npcs = order === 'ab' ? [a, b] : [b, a]; // el número sale del orden en la calle
  const scene = street(still ? [...npcs, still] : npcs);
  const track = [[a, aTo, Math.sign(aTo - aFrom)], [b, bTo, Math.sign(bTo - bFrom)]].map(([npc, to, dir]) =>
    ({ npc, to, dir, route: npc.route, best: -Infinity, back: 0, at: null, turned: false, minPace: 1, yielded: false, first: false,
      edge: 2, way: 0, swings: 0 }));
  let ab = Infinity, still2 = Infinity, under = 0, time = 0;
  run(scene, seconds, player, () => {
    time += 1 / 60;
    if (still) still.position.set(20, 0, z);
    for (const w of track) {
      if (w.at !== null) continue;
      const p = w.npc.position.x * w.dir;
      w.best = Math.max(w.best, p); w.back = Math.max(w.back, w.best - p);
      if (w.npc.route !== w.route) w.turned = true;
      w.minPace = Math.min(w.minPace, w.npc.mind.paceFactor());
      if (w.npc.mind.neckWith) { if (w.npc.mind.neckFirst) w.first = true; else w.yielded = true; }
      if ((w.npc.position.x - 20) * w.dir < 0) {
        const pz = w.npc.position.z, dz = pz - w.edge;
        if (dz * w.way > 0 || (w.way === 0 && Math.abs(dz) > .15)) { w.edge = pz; w.way ||= Math.sign(dz); }
        else if (Math.abs(dz) > .15) { w.swings++; w.way = -w.way; w.edge = pz; }
      }
      if ((w.npc.position.x - w.to) * w.dir > -.5) w.at = time;
    }
    onFrame(a, b, time);
    if (track.every(w => w.at !== null)) return;
    const dab = a.position.distanceTo(b.position), da = Math.hypot(a.position.x - 20, a.position.z - z), db = Math.hypot(b.position.x - 20, b.position.z - z);
    ab = Math.min(ab, dab); still2 = Math.min(still2, da, db);
    if (Math.min(dab, da, db) < .55) under += 1 / 60;
  });
  const ids = [a.mind.id, b.mind.id];
  a.dispose(); b.dispose(); still?.dispose();
  return { ab, still: still2, under, track, ids };
}

/** Segundos que tarda en llegar andando solo, sin nadie más en el andén. */
const freeWalk = new Map();
async function aloneTime(from, to) {
  const key = `${from}>${to}`;
  if (!freeWalk.has(key)) {
    const nav = sidewalk(3), w = await walker([from, 0, 2], nav);
    straight(w, from, to, 2);
    let at = null, time = 0;
    run(street([w]), 40, new THREE.Vector3(20, 0, 12), () => { time += 1 / 60; if (at === null && (w.position.x - to) * Math.sign(to - from) > -.5) at = time; });
    w.dispose();
    freeWalk.set(key, at);
  }
  return freeWalk.get(key);
}

test('con alguien quieto a menos de 1 m de la línea, dos que vienen de frente lo rodean por turnos: nadie se devuelve ni se echa encima y el que cede pierde poco (252 casos)', async () => {
  // El quieto (el jugador o un peatón) de 0 a 1 m de la línea, cada 10 cm y a los dos lados; tres puntos de encuentro y
  // los dos sentidos. Sin mente llegan a la vez que andando solos, pero se atraviesan: a 0-0,01 m entre los dos y, con
  // el quieto a menos de 0,5 m de la línea, a través de él. Con la esquiva de antes, en un tercio de los casos alguno
  // se quedaba trabado junto al quieto y daba media vuelta, y se acercaban a 0,25 m.
  const report = [];
  const zs = Array.from({ length: 21 }, (_, k) => +(1 + k * .1).toFixed(1));
  for (const mirror of [false, true]) for (const who of ['jugador', 'peatón']) for (const z of zs) for (const bx of [32, 34, 36]) {
    const [aFrom, aTo, bFrom, bTo] = mirror ? [34, 4, 40 - bx, 36] : [6, 36, bx, 4];
    const r = await threeBodies({ who, z, aFrom, aTo, bFrom, bTo });
    const [wa, wb] = r.track, fa = await aloneTime(aFrom, aTo), fb = await aloneTime(bFrom, bTo);
    const delays = [wa.at === null ? Infinity : wa.at - fa, wb.at === null ? Infinity : wb.at - fb];
    report.push({ mirror, who, z, bx, ab: +r.ab.toFixed(2), still: +r.still.toFixed(2), under: +r.under.toFixed(2),
      turned: wa.turned || wb.turned, back: +Math.max(wa.back, wb.back).toFixed(2), swings: Math.max(wa.swings, wb.swings),
      yielder: +Math.max(...delays).toFixed(2), other: +Math.min(...delays).toFixed(2) });
  }
  const bad = (what, ok) => assert.ok(report.every(ok), `${what}: ${JSON.stringify(report.filter(r => !ok(r)).slice(0, 6))}`);
  assert.equal(report.length, 252);
  bad('nadie cambia de ruta antes de llegar', r => !r.turned);
  bad('ningún paso atrás de más de 0,3 m', r => r.back <= .3);
  bad('los dos llegan; el que cede pierde 2,5 s o menos y el otro 0,8 s o menos', r => r.yielder <= 2.5 && r.other <= .8);
  bad('a 0,5 m o más entre los dos y del quieto', r => r.ab >= .5 && r.still >= .5);
  bad('no más de 0,3 s a menos de 0,55 m', r => r.under <= .3);
  // Quien pasa primero solo se abre; quien cede se pone detrás del quieto y después lo rodea. Nada de salirse hacia el
  // lado libre y devolverse al acordar el cuello.
  bad('a lo sumo una vuelta de lado antes de pasar al quieto', r => r.swings <= 1);
});

test('pasa primero el que llega antes al quieto, aunque tenga el número menor; el número solo desempata', async () => {
  // El quieto en (20; 2,55). Los dos andan igual de rápido: llega antes el que está más cerca.
  const cases = [
    { aFrom: 8, bFrom: 34, order: 'ab', first: 'a' },  // a (número menor) a 12 m y b a 14 m: pasa a
    { aFrom: 6, bFrom: 32, order: 'ab', first: 'b' },  // a a 14 m y b a 12 m: pasa b
    { aFrom: 8, bFrom: 34, order: 'ba', first: 'a' },  // con los números al revés, lo mismo
    { aFrom: 6, bFrom: 34, order: 'ab', first: 'b' },  // a la vez: cede el de menor número (a)
    { aFrom: 6, bFrom: 34, order: 'ba', first: 'a' }   // a la vez y con los números al revés: cede b
  ];
  for (const c of cases) {
    const r = await threeBodies({ who: 'jugador', z: 2.55, aFrom: c.aFrom, aTo: 36, bFrom: c.bFrom, bTo: 4, order: c.order });
    const [wa, wb] = r.track, [first, second] = c.first === 'a' ? [wa, wb] : [wb, wa];
    const label = JSON.stringify({ ...c, ids: r.ids });
    assert.ok(first.first && !first.yielded, `${label}: no pasó primero el que debía`);
    assert.ok(second.yielded && !second.first, `${label}: no cedió el otro`);
    assert.ok(first.minPace > .95, `${label}: el que pasa primero bajó el paso a ${first.minPace.toFixed(2)}`);
  }
});

test('quien cede el cuello baja el paso desde unos 3 m y, si tiene que parar, para antes del quieto y no a su lado', async () => {
  // Llegan a la vez (cede a, el de menor número). Se mide dónde empieza a frenar y dónde queda parado, a lo largo de su
  // línea y respecto al quieto en (20; 1,4).
  let slowAt = null, stoppedAt = null;
  const r = await threeBodies({ who: 'jugador', z: 1.4, aFrom: 6, aTo: 36, bFrom: 34, bTo: 4, onFrame: a => {
    const ahead = 20 - a.position.x;
    if (slowAt === null && a.mind.neckWith && a.mind.paceFactor() < .95) slowAt = ahead;
    if (stoppedAt === null && a.mind.neckWith && a.mind.paceFactor() < .02) stoppedAt = ahead;
  } });
  assert.ok(r.track[0].yielded, 'cedió a');
  assert.ok(r.track[0].swings <= 1, `a fue y vino de lado ${r.track[0].swings} veces antes del quieto`);
  assert.ok(slowAt !== null && slowAt >= 2.4 && slowAt <= 3.6, `empezó a frenar a ${slowAt?.toFixed(2)} m del quieto`);
  assert.ok(stoppedAt === null || stoppedAt >= 1, `quedó parado a ${stoppedAt?.toFixed(2)} m del quieto`);
  assert.ok(r.still >= .7 && r.ab >= .8, `pasaron a ${r.still.toFixed(2)} m del quieto y a ${r.ab.toFixed(2)} m entre ellos`);
});

test('si con bajar el paso le alcanza para llegar después del otro al quieto, nadie se detiene', async () => {
  // El que cede llega 1,5 s después: frena un poco y sigue. Ninguno de los dos queda quieto un solo cuadro, y mientras
  // cede no baja de `neckPace` (no frena como para parar antes del quieto).
  for (const [aFrom, bFrom] of [[6, 36], [6, 32]]) {
    let stopped = 0, aIn = false, bIn = false, yieldPace = 1;
    const r = await threeBodies({ who: 'jugador', z: 2.6, aFrom, aTo: 36, bFrom, bTo: 4, onFrame: (a, b) => {
      for (const n of [a, b]) if (n.mind.neckWith && !n.mind.neckFirst) yieldPace = Math.min(yieldPace, n.mind.paceFactor());
      // Hasta que cada uno llega: después toma otra ruta y puede quedarse un rato donde está.
      aIn ||= a.position.x > 35.5; bIn ||= b.position.x < 4.5;
      if (!aIn && !a.moving) stopped++;
      if (!bIn && !b.moving) stopped++;
    } });
    assert.ok(r.track.some(w => w.yielded), `${aFrom}/${bFrom}: no hizo falta ceder`);
    assert.equal(stopped, 0, `${aFrom}/${bFrom}: alguien se detuvo ${stopped} cuadros`);
    assert.ok(yieldPace >= AVOID.neckPace, `${aFrom}/${bFrom}: mientras cedía bajó a ${yieldPace.toFixed(2)} de su paso`);
  }
});

test('a alguien quieto lo rodea por el lado en que cabe aunque no sea el suyo, sin quedarse trabado ni cambiar de ruta', async () => {
  // Va hacia +X corrido 0,8 m a su derecha (z = 2,8, el tope) después de esquivar a alguien; el quieto está a 0,65 m
  // de su línea, a ese lado (z = 2,65): rodearlo por la derecha no cabe. Antes elegía la derecha igual, quedaba
  // encajonado y a los 1,2 s daba media vuelta.
  for (const who of ['jugador', 'peatón']) {
    const nav = sidewalk(3);
    const a = await walker([10, 0, 2.8], nav);
    a.route = [new THREE.Vector3(8, 0, 2), new THREE.Vector3(36, 0, 2)]; a.routeIndex = 1; a.target = a.route[1]; a.wait = 0;
    const route = a.route;
    const still = who === 'peatón' ? await walker([12.5, 0, 2.65], nav) : null;
    if (still) { still.route = []; still.target = null; still.wait = 1e6; }
    const player = who === 'jugador' ? new THREE.Vector3(12.5, 0, 2.65) : new THREE.Vector3(12.5, 0, 12);
    const scene = street(still ? [a, still] : [a]);
    scene.minds.beginFrame(1 / 60, player);
    a.mind._steerFrame = scene.minds.frame; a.mind.side = .8; a.mind.sideHold = 0;
    let closest = Infinity;
    run(scene, 6, player, () => {
      if (still) still.position.set(12.5, 0, 2.65);
      closest = Math.min(closest, Math.hypot(a.position.x - 12.5, a.position.z - 2.65));
    });
    assert.equal(a.route, route, `${who}: cambió de ruta`);
    assert.ok(a.position.x > 15, `${who}: no pasó (x = ${a.position.x.toFixed(2)})`);
    assert.ok(closest >= .6, `${who}: pasó a ${closest.toFixed(2)} m del quieto`);
    a.dispose(); still?.dispose();
  }
});

test('frente a alguien quieto y sin ningún lado libre espera unos 4 s antes de buscar otro camino', async () => {
  // Pasillo de 60 cm y el jugador parado en medio: no hay por dónde. Antes se daba por trabado al 1,2 s.
  const nav = sidewalk(3);
  const a = await walker([10, 0, 2], nav, { isWalkable: (x, z) => nav.isWalkableAt(x, z) && Math.abs(z - 2) < .3 });
  straight(a, 10, 36, 2);
  const route = a.route, player = new THREE.Vector3(16, 0, 2);
  let time = 0, blockedSince = null, reroutedAfter = null;
  run(street([a]), 20, player, () => {
    time += 1 / 60;
    // Desde que ya no avanza (a menos de un cuarto de su paso) hasta que suelta la ruta.
    if (blockedSince === null && a.mind.paceFactor() < .25) blockedSince = time;
    if (reroutedAfter === null && a.route !== route) reroutedAfter = time - blockedSince;
  });
  assert.ok(blockedSince !== null, 'no quedó trabado');
  assert.ok(reroutedAfter !== null && reroutedAfter >= AVOID.deadEnd - .1 && reroutedAfter <= AVOID.deadEnd + 1,
    `buscó otro camino ${reroutedAfter?.toFixed(2)} s después de quedar trabado`);
  assert.ok(AVOID.deadEnd >= 4);
  a.dispose();
});

test('detrás de alguien que va muy despacio por donde no lo puede adelantar, lo sigue: no busca otro camino', async () => {
  // Pasillo de 60 cm. A 0,32 m/s el de adelante va a menos de un cuarto del paso del de atrás, que va casi parado más
  // de 4 s, como trabado; pero el de adelante se mueve: no es un callejón.
  for (const slow of [.32, .5]) {
    const nav = sidewalk(3);
    const isWalkable = (x, z) => nav.isWalkableAt(x, z) && Math.abs(z - 2) < .3;
    const a = await walker([8, 0, 2], nav, { isWalkable }), b = await walker([10, 0, 2], nav, { isWalkable });
    straight(a, 8, 36, 2); straight(b, 10, 36, 2);
    b.walkSpeed = slow;
    const route = a.route;
    let slowFor = 0, longest = 0;
    run(street([a, b]), 12, new THREE.Vector3(20, 0, 12), () => {
      slowFor = a.mind.paceFactor() < .25 ? slowFor + 1 / 60 : 0;
      longest = Math.max(longest, slowFor);
    });
    if (slow < .33) assert.ok(longest > AVOID.deadEnd, `${slow} m/s: casi parado solo ${longest.toFixed(2)} s seguidos`);
    assert.equal(a.route, route, `${slow} m/s: buscó otro camino`);
    assert.ok(a.position.x > 11 && a.position.x < b.position.x, `${slow} m/s: quedó en x = ${a.position.x.toFixed(2)}, el otro en ${b.position.x.toFixed(2)}`);
    a.dispose(); b.dispose();
  }
});

test('con alguien encima de golpe se para en seco pero no en un cuadro: en unos 0,17 s, sin pasar por encima', async () => {
  // Pasillo sin sitio a los lados: no lo puede rodear.
  const nav = sidewalk(3);
  const a = await walker([10, 0, 2], nav, { isWalkable: (x, z) => nav.isWalkableAt(x, z) && Math.abs(z - 2) < .15 });
  straight(a, 10, 36, 2);
  // Alguien quieto que aparece a 0,6 m adelante (salió de una puerta, se agachó a recoger algo).
  const other = { position: new THREE.Vector3(30, 0, 30) };
  const scene = street([a], [other]);
  const player = new THREE.Vector3(10, 0, 9);
  run(scene, 1, player);
  assert.ok(a.mind.paceFactor() > .95, 'iba a su paso');
  const from = a.position.x;
  other.position.set(from + .6, 0, 2);
  const paces = [];
  run(scene, .4, player, () => paces.push(a.mind.paceFactor()));
  assert.ok(paces[0] > .8, `frenó de golpe en un cuadro (${paces[0].toFixed(2)})`);
  const stopped = paces.findIndex(p => p === 0);
  assert.ok(stopped > 0 && stopped / 60 <= .22, `se detuvo a los ${(stopped / 60).toFixed(2)} s`);
  // Lo que avanza mientras frena (unos 11 cm a 1,3 m/s), no más: no se le mete encima.
  assert.ok(a.position.x - from < .15, `avanzó ${(a.position.x - from).toFixed(2)} m después de verlo`);
  assert.ok(a.position.distanceTo(other.position) > .45, `quedó a ${a.position.distanceTo(other.position).toFixed(2)} m`);
  a.dispose();
});

test('con el paraguas abierto pide 25 cm más: dos con paraguas se cruzan más abiertos que sin él', async () => {
  const pass = async umbrella => {
    const nav = sidewalk(3);
    const a = await walker([4, 0, 2], nav), b = await walker([36, 0, 2], nav);
    straight(a, 4, 36, 2); straight(b, 36, 4, 2);
    const scene = street([a, b]);
    let closest = Infinity;
    run(scene, 26, new THREE.Vector3(20, 0, 12), () => {
      // La postura del paraguas la pone Npc al llover (person.paraguas); aquí se fija en cada cuadro.
      if (umbrella) { a.stance = 'paraguas'; b.stance = 'paraguas'; }
      closest = Math.min(closest, a.position.distanceTo(b.position));
    });
    a.dispose(); b.dispose();
    return closest;
  };
  const without = await pass(false), withUmbrella = await pass(true);
  assert.ok(AVOID.umbrella >= .2 && AVOID.umbrella <= .3);
  assert.ok(withUmbrella >= without + .3, `sin paraguas a ${without.toFixed(2)} m, con paraguas a ${withUmbrella.toFixed(2)} m`);
});

test('la gente que está en district.npcs entra en la rejilla aunque no esté en trafficPedestrians, y quien no está en la calle no', async () => {
  // Como con la gente que PedestrianCrowd muestra y esconde: `trafficPedestrians` se copió una sola vez al empezar.
  const nav = sidewalk(3);
  const a = await walker([4, 0, 2], nav), b = await walker([36, 0, 2], nav), gone = await walker([20, 0, 4], nav);
  straight(a, 4, 36, 2); straight(b, 36, 4, 2);
  const dog = { position: new THREE.Vector3(30, 0, 0) };
  const district = { npcs: [a, gone], trafficPedestrians: [a, gone, dog] };
  const minds = new StreetMinds(district);
  minds.beginFrame(1 / 60, new THREE.Vector3(20, 0, 12));
  // `b` aparece en la calle (show) y `gone` se esconde (hide); la lista de los carros sigue como estaba.
  district.npcs.push(b);
  district.npcs.splice(district.npcs.indexOf(gone), 1);
  let closest = Infinity;
  const scene = { district, minds };
  run(scene, 26, new THREE.Vector3(20, 0, 12), () => { closest = Math.min(closest, a.position.distanceTo(b.position)); });
  assert.ok(closest >= .7, `no se vieron: pasaron a ${closest.toFixed(2)} m`);
  minds.beginFrame(1 / 60, new THREE.Vector3(20, 0, 12));
  const agents = minds.grid.agents.slice(0, minds.grid.count);
  assert.ok(agents.includes(a) && agents.includes(b) && agents.includes(dog), 'los de la calle y el perro');
  assert.ok(!agents.includes(gone), 'el escondido no');
  assert.equal(new Set(agents).size, agents.length, 'nadie dos veces');
  a.dispose(); b.dispose(); gone.dispose();
});

test('el paso que mira los sólidos deja salir de una caja en la que ya está, y no deja entrar en otra', async () => {
  const nav = sidewalk(3);
  const collisions = solids([pole(20, 2, .3)]);
  const a = await walker([20.1, 0, 2.1], nav, { collisions });
  assert.ok(solidAt(collisions, a.position.x, 0, a.position.z), 'empieza dentro');
  assert.equal(pathClear(a, a.position.x, a.position.z, .6, 0), true, 'sale');
  a.position.set(19, 0, 2);
  assert.equal(pathClear(a, a.position.x, a.position.z, 1, 0), false, 'desde fuera no entra');
  a.dispose();
});

/**
 * Gente en un andén. `movers` ({ from, to, z = 2, speed }) andan en línea recta, en el orden de la calle (de ahí sale
 * el número); `stills` ({ kind: 'jugador' | 'peatón', x, z }) están quietos, o andan muy despacio hacia `to` a `speed`.
 * Quien llega a su destino sale de la calle. `playerStep(player, time)` mueve al jugador en cada cuadro.
 * Devuelve lo más cerca que estuvieron dos que andan (`between`) y uno que anda de un quieto (`toStill`), y de cada
 * caminante: cuándo llegó, cuánto se devolvió, si cambió de ruta, su parada más larga y cuánto pasó a menos de 0,6 m
 * de un quieto.
 */
async function crowd({ rows = 3, isWalkable, movers, stills = [], seconds = 40, onFrame = () => {}, playerStep = null }) {
  const nav = sidewalk(rows), opts = { isWalkable };
  const walkers = [];
  for (const m of movers) {
    const z = m.z ?? 2, npc = await walker([m.from, 0, z], nav, opts);
    straight(npc, m.from, m.to, z);
    if (m.speed) npc.walkSpeed = m.speed;
    walkers.push({ npc, dir: Math.sign(m.to - m.from), to: npc.route.at(-1).x, route: npc.route, best: -Infinity, back: 0, at: null, turned: false,
      stopped: 0, longestStop: 0, close: 0 });
  }
  let player = new THREE.Vector3(20, 0, 12);
  const quiet = [];
  for (const s of stills) {
    if (s.kind === 'jugador') { player = new THREE.Vector3(s.x, 0, s.z); quiet.push({ position: player }); continue; }
    const npc = await walker([s.x, 0, s.z], nav, opts);
    if (s.to !== undefined) { straight(npc, s.x, s.to, s.z); npc.walkSpeed = s.speed; quiet.push(Object.assign(npc, { slow: true })); continue; }
    npc.route = []; npc.target = null; npc.wait = 1e6;
    quiet.push(Object.assign(npc, { pin: s }));
  }
  const scene = street([...walkers.map(w => w.npc), ...quiet.filter(q => q.pin || q.slow)]);
  let between = Infinity, toStill = Infinity, time = 0;
  run(scene, seconds, player, () => {
    time += 1 / 60;
    if (playerStep) playerStep(player, time);
    for (const q of quiet) if (q.pin) q.position.set(q.pin.x, 0, q.pin.z);
    const walking = walkers.filter(w => w.at === null);
    for (const w of walking) {
      const p = w.npc.position.x * w.dir;
      w.best = Math.max(w.best, p); w.back = Math.max(w.back, w.best - p);
      if (w.npc.route !== w.route) w.turned = true;
      w.stopped = w.npc.mind.paceFactor() < .05 ? w.stopped + 1 / 60 : 0;
      w.longestStop = Math.max(w.longestStop, w.stopped);
      let near = Infinity;
      for (const q of quiet) near = Math.min(near, Math.hypot(w.npc.position.x - q.position.x, w.npc.position.z - q.position.z));
      toStill = Math.min(toStill, near);
      if (near < .6) w.close += 1 / 60;
      for (const o of walking) if (o !== w) between = Math.min(between, w.npc.position.distanceTo(o.npc.position));
    }
    onFrame(walkers, time);
    for (const w of walking) {
      if ((w.npc.position.x - w.to) * w.dir <= -.5) continue;
      // Llegó: sale de la calle, para que su paseo de después no se mezcle con lo que se mide.
      w.at = time;
      const i = scene.district.npcs.indexOf(w.npc);
      scene.district.npcs.splice(i, 1); scene.district.trafficPedestrians.splice(scene.district.trafficPedestrians.indexOf(w.npc), 1);
    }
  });
  for (const w of walkers) w.npc.dispose();
  for (const q of quiet) q.dispose?.();
  return { between, toStill, walkers };
}

/** En qué orden pasan junto a x = 20 (cada uno con la letra de `names` que le toca por su puesto en `movers`). */
const orderAt20 = (names, order = [], seen = new Set()) => Object.assign(walkers => {
  walkers.forEach((w, k) => { if (!seen.has(k) && (w.npc.position.x - 20) * w.dir > .3) { seen.add(k); order.push(names[k]); } });
}, { order });

test('quien cede un paso angosto deja pasar también al que viene en fila detrás, y no se le echa encima al quieto', async () => {
  // `a` va de 6 a 36; `b` viene de 34 a 4 y `c` lo sigue 2 o 3 m detrás; hay alguien quieto en x = 20, a 0,2-0,6 m de
  // la línea. `a` le cede el paso a `b`. Antes, cuando `b` pasaba, `c` ya estaba junto al quieto y le tocaba ceder a
  // él (tiene el número menor): para ceder se corría hasta la línea del quieto y se le metía encima (a 5 cm).
  const report = [];
  for (const who of ['jugador', 'peatón']) for (const z of [2.2, 2.4, 2.6]) for (const behind of [2, 3]) {
    const passing = orderAt20('cab');
    const r = await crowd({ movers: [{ from: 34 + behind, to: 4 }, { from: 6, to: 36 }, { from: 34, to: 4 }], stills: [{ kind: who, x: 20, z }], onFrame: passing });
    report.push({ who, z, behind, order: passing.order.join(''), between: +r.between.toFixed(2), toStill: +r.toStill.toFixed(2),
      arrived: r.walkers.every(w => w.at !== null), turned: r.walkers.some(w => w.turned), back: Math.max(...r.walkers.map(w => w.back)),
      wait: +r.walkers[1].longestStop.toFixed(2) });
  }
  const bad = (what, ok) => assert.ok(report.every(ok), `${what}: ${JSON.stringify(report.filter(r => !ok(r)))}`);
  bad('pasan los dos de la fila y después quien cedió', r => r.order === 'bca');
  bad('nadie queda a menos de medio metro del quieto', r => r.toStill >= .5);
  bad('los que andan no se rozan', r => r.between >= .6);
  bad('todos llegan, sin devolverse ni cambiar de ruta', r => r.arrived && !r.turned && r.back < .1);
  bad('quien cede espera poco', r => r.wait < 4);
});

test('la fila tiene tope: pasan con el primero los que vienen pegados a él y alcanzan en 4 s; a quien viene lejos o tarde no lo espera', async () => {
  const file = async (n, gap, speed, from = 34, aLast = false) => {
    const names = aLast ? `${'bcde'.slice(0, n)}a` : `a${'bcde'.slice(0, n)}`;
    const passing = orderAt20(names);
    const row = Array.from({ length: n }, (_, k) => ({ from: from + gap * k, to: 4, speed }));
    const r = await crowd({ movers: aLast ? [...row, { from: 6, to: 36 }] : [{ from: 6, to: 36 }, ...row], stills: [{ kind: 'peatón', x: 20, z: 2.4 }], seconds: 70, onFrame: passing });
    return { order: passing.order.join(''), toStill: +r.toStill.toFixed(2), between: +r.between.toFixed(2), turned: r.walkers.some(w => w.turned),
      wait: +r.walkers[aLast ? n : 0].longestStop.toFixed(2) };
  };
  const safe = r => r.toStill >= .5 && r.between >= .6 && !r.turned;
  // Dos en fila, el segundo 2 m detrás: pasan los dos. Con el segundo 5 m detrás no es una fila: `a` pasa entre ellos.
  const near = await file(2, 2), far = await file(2, 5);
  assert.ok(near.order === 'bca' && safe(near), JSON.stringify(near));
  assert.ok(far.order === 'bac' && safe(far), JSON.stringify(far));
  // Una fila lenta (0,45 m/s), cada 2,6 m: el segundo pasa con el primero; el tercero llegaría más de 4 s después del
  // primero y ya no entra en la fila: `a` pasa antes.
  const slow = await file(3, 2.6, .45, 24.3);
  assert.ok(slow.order === 'bcad' && safe(slow) && AVOID.queueTime === 4, JSON.stringify(slow));
  // Pegados (cada 2 m), el que sigue ya va metido en el paso cuando el anterior sale: el que ya va pasando, pasa. Quien
  // cede espera a los cuatro, sin desesperarse ni buscar otro camino.
  const tight = await file(4, 2);
  assert.ok(tight.order === 'bcdea' && safe(tight) && tight.wait < 6, JSON.stringify(tight));
  // Y al revés: quien ya se metió en el paso mientras esperaba no vuelve a ceder; pasa él y el siguiente de la fila
  // espera, sin rozarse.
  const inNeck = await file(4, 2.3, undefined, 32, true);
  assert.ok(inNeck.order === 'bcade' && safe(inNeck), JSON.stringify(inNeck));
});

test('ningún paso de lado le mete el cuerpo encima a otro: se acorta cuanto más cerca lo tiene, y alejarse siempre se puede', () => {
  const touch = AVOID.body * 2;
  const part = (other, dx, dz, moving = 0) => {
    const grid = new CrowdGrid(8), me = { position: new THREE.Vector3(0, 0, 0) }, it = { position: new THREE.Vector3(...other) };
    grid.add(me, me.position, 1 / 60); grid.add(it, it.position, 1 / 60);
    // Unos cuadros andando, para que la rejilla le estime la velocidad; termina donde se pidió.
    if (moving) for (let k = 11; k >= 0; k--) { grid.clear(); it.position.x = other[0] - k * moving / 60; grid.add(me, me.position, 1 / 60); grid.add(it, it.position, 1 / 60); }
    return sideStepRoom(grid, me, dx, dz);
  };
  // El otro, a su derecha (+z). Lejos: el paso entero. Dentro del margen: en proporción. Tocándose: nada.
  assert.equal(part([0, 0, touch + AVOID.touchRoom + .01], 0, .01), 1);
  assert.ok(Math.abs(part([0, 0, touch + AVOID.touchRoom / 2], 0, .01) - .5) < 1e-6);
  assert.equal(part([0, 0, touch - .02], 0, .01), 0);
  // Alejarse, o un paso que no va hacia él (lo tiene justo delante), no se recorta.
  assert.equal(part([0, 0, touch], 0, -.01), 1);
  assert.equal(part([touch + .05, 0, 0], 0, .01), 1);
  // Tampoco hacia quien anda (un peatón que pasa); solo a quien viene corriendo no lo mira: de ese se quita como sea.
  assert.ok(Math.abs(part([0, 0, touch + AVOID.touchRoom / 2], 0, .01, 1.3) - .5) < .05);
  assert.equal(part([0, 0, touch + AVOID.touchRoom / 2], 0, .01, AVOID.runner + .5), 1);
  // En otro piso (el tablero, una escalera) no cuenta.
  assert.equal(part([0, 3, touch], 0, .01), 1);
});

test('el paso de lado arranca y frena suave, no pasa de su velocidad y llega sin pasarse; si venía rápido, frena firme', () => {
  const mind = { side: 0, sideVel: 0 }, dt = 1 / 60;
  let top = 0, jerk = 0, over = 0, frames = 0;
  while (mind.side !== .43 && frames < 600) {
    const before = mind.sideVel;
    mind.side = easeSide(mind, .43, AVOID.sideRate, AVOID.sideAccel, dt);
    top = Math.max(top, Math.abs(mind.sideVel));
    if (Math.abs(before) > .05 || Math.abs(mind.sideVel) > .05) jerk = Math.max(jerk, Math.abs(mind.sideVel - before) / dt); // el último centímetro no cuenta
    over = Math.max(over, mind.side - .43);
    frames++;
  }
  assert.ok(mind.side === .43 && mind.sideVel === 0, `no llegó: ${mind.side}`);
  assert.ok(top <= AVOID.sideRate + 1e-9 && AVOID.sideRate <= .5, `de lado a ${top.toFixed(2)} m/s`);
  assert.ok(jerk <= AVOID.sideAccel * 1.2, `arrancó o frenó a ${jerk.toFixed(2)} m/s²`);
  assert.ok(over <= 1e-9, `se pasó ${over.toFixed(3)} m`);
  assert.ok(frames / 60 > 1.1 && frames / 60 < 1.8, `tardó ${(frames / 60).toFixed(2)} s`);
  // Viene a 1,3 m/s (se quitaba de quien corre) y le queda un palmo: no se pasa de largo más de un par de dedos.
  Object.assign(mind, { side: 0, sideVel: 1.3 });
  let far = 0;
  for (let k = 0; k < 120; k++) { mind.side = easeSide(mind, .1, AVOID.sideRate, AVOID.sideAccel, dt); far = Math.max(far, mind.side); }
  assert.ok(far < .35 && Math.abs(mind.side - .1) < 1e-6, `llegó hasta ${far.toFixed(2)} m y quedó en ${mind.side.toFixed(2)}`);
});

test('a un quieto lo rodea por el lado que ya lleva si caben los dos, y no por donde hay alguien parado', () => {
  // Al jugador que le da recelo lo rodea a 1,2 m y puede correrse hasta 1,2 m: plantado justo en su línea caben los dos
  // lados. Sigue por el que ya trae; sin ninguno, a su derecha.
  const mind = side => ({ side, roomFor: () => true });
  assert.equal(passSide(mind(-.3), 0, 1.2, 1.2), -1.2);
  assert.equal(passSide(mind(.3), 0, 1.2, 1.2), 1.2);
  assert.equal(passSide(mind(0), 0, 1.2, 1.2), 1.2);
  // Con alguien parado justo donde le pasaría (uno que espera su turno junto al quieto), ese lado no cuenta.
  const grid = new CrowdGrid(8), me = { position: new THREE.Vector3(0, 0, 0) }, still = { position: new THREE.Vector3(3, 0, 0) };
  const waiting = { position: new THREE.Vector3(3, 0, 1.1) };
  for (const body of [me, still, waiting]) grid.add(body, body.position, 1 / 60);
  const walking = { side: 0, npc: me, system: { grid }, _segX: 1, _segZ: 0, roomFor: () => true };
  assert.equal(passSide(walking, 0, 1.2, 1.2, 0, still), -1.2, 'a su derecha hay alguien parado: por la izquierda');
  assert.equal(passSide(walking, 0, 1.2, 1.2, 1, still), -1.2, 'aunque ya hubiera elegido la derecha');
  waiting.position.z = -1.1; grid.clear();
  for (const body of [me, still, waiting]) grid.add(body, body.position, 1 / 60);
  assert.equal(passSide(walking, 0, 1.2, 1.2, 0, still), 1.2);
});

test('con una pared a un lado le pasa justo al quieto, despacio, sin tocarlo ni cambiar de ruta; si no cabe ni justo, espera a un metro', async () => {
  for (const who of ['jugador', 'peatón']) {
    // Andén de 1,4 m entre paredes y el quieto en el centro: a cada lado queda menos de lo que pide para pasar sin
    // frenar (0,7 m), pero más que el justo (0,62 m).
    let speedBeside = null;
    const just = await crowd({ isWalkable: (x, z) => z > 1.3 && z < 2.7 && x > 0 && x < 80, movers: [{ from: 6, to: 36 }], stills: [{ kind: who, x: 20, z: 2 }], seconds: 30,
      onFrame: ws => { const n = ws[0].npc; if (n.position.x > 19.2 && n.position.x < 20) speedBeside = Math.max(speedBeside ?? 0, n.mind.paceFactor() * n.walkSpeed); } });
    const w = just.walkers[0];
    assert.ok(w.at !== null && !w.turned && w.back < .1, `${who}: no pasó (${JSON.stringify(w, ['at', 'turned', 'back'])})`);
    assert.ok(just.toStill >= AVOID.squeeze && just.toStill < AVOID.enough, `${who}: le pasó a ${just.toStill.toFixed(2)} m`);
    assert.ok(speedBeside !== null && speedBeside <= AVOID.threadSpeed + .2, `${who}: a su lado iba a ${speedBeside?.toFixed(2)} m/s`);
    assert.ok(w.longestStop < .5, `${who}: se paró ${w.longestStop.toFixed(2)} s`);
    // Andén de 1,2 m: no cabe por ningún lado. Se acerca hasta un metro y ahí espera, sin arrimársele.
    let waitedAt = Infinity;
    const none = await crowd({ isWalkable: (x, z) => z > 1.4 && z < 2.6 && x > 0 && x < 80, movers: [{ from: 6, to: 36 }], stills: [{ kind: who, x: 20, z: 2 }], seconds: 3.9 + 10 / 1.3,
      onFrame: ws => { const n = ws[0].npc; if (n.mind.paceFactor() < .05) waitedAt = Math.min(waitedAt, 20 - n.position.x); } });
    assert.ok(none.toStill >= .9 && waitedAt >= .9 && waitedAt < 1.4, `${who}: esperó a ${waitedAt.toFixed(2)} m y llegó a ${none.toStill.toFixed(2)} m del quieto`);
    assert.ok(!none.walkers[0].turned, `${who}: cambió de ruta antes de esperar unos 4 s`);
  }
});

test('entre dos quietos con hueco, si no hay por dónde rodearlos, pasa por el medio despacio y de a uno; sin hueco espera sin arrimarse', async () => {
  const lane = (x, z) => z > 1 && z < 3 && x > 0 && x < 80;
  const pair = sep => [{ kind: 'peatón', x: 20, z: 2 - sep / 2 }, { kind: 'peatón', x: 20, z: 2 + sep / 2 }];
  // Hueco de 1,4 m en un andén de 2 m: por fuera no cabe.
  let speedIn = 0, together = 0;
  const inGap = ws => {
    const inside = ws.filter(w => w.at === null && Math.abs(w.npc.position.x - 20) < .3);
    if (inside.length > 1) together++;
    for (const w of inside) speedIn = Math.max(speedIn, w.npc.mind.paceFactor() * w.npc.walkSpeed);
  };
  const one = await crowd({ isWalkable: lane, movers: [{ from: 6, to: 36 }], stills: pair(1.4), onFrame: inGap });
  assert.ok(one.walkers[0].at !== null && !one.walkers[0].turned, 'no pasó entre los dos');
  assert.ok(one.toStill >= .65 && speedIn <= AVOID.threadSpeed + .25, `pasó a ${one.toStill.toFixed(2)} m de uno y a ${speedIn.toFixed(2)} m/s`);
  // Dos de frente por el mismo hueco: uno espera a un par de metros a que el otro salga.
  speedIn = 0;
  const two = await crowd({ isWalkable: lane, movers: [{ from: 6, to: 36 }, { from: 34, to: 4 }], stills: pair(1.4), onFrame: inGap });
  assert.ok(two.walkers.every(w => w.at !== null && !w.turned && w.back < .1), `no pasaron los dos: ${JSON.stringify(two.walkers.map(w => [w.at, w.turned, w.back]))}`);
  assert.equal(together, 0, 'los dos en el hueco a la vez');
  assert.ok(two.between >= .6 && two.toStill >= .55, `se acercaron a ${two.between.toFixed(2)} m, y a ${two.toStill.toFixed(2)} m de un quieto`);
  assert.ok(Math.max(...two.walkers.map(w => w.close)) <= 2, 'más de 2 s a menos de 0,6 m de un quieto');
  // El que viene por el hueco anda muy despacio (0,45 m/s) y tarda más de 4 s en salir: quien espera su turno lo
  // espera todo ese rato. Esperar el turno no es estar trabado: no da media vuelta.
  const slowTurn = await crowd({ isWalkable: lane, movers: [{ from: 6, to: 36 }, { from: 26, to: 4, speed: .45 }], stills: pair(1.4), seconds: 70 });
  assert.ok(slowTurn.walkers.every(w => w.at !== null && !w.turned && w.back < .1), `con uno lento por el hueco: ${JSON.stringify(slowTurn.walkers.map(w => [w.at, w.turned, +w.back.toFixed(2)]))}`);
  // Hueco de 1,1 m: no pasa. Espera a un metro del más cercano, sin meterse ni rozarlos.
  const closed = await crowd({ isWalkable: lane, movers: [{ from: 6, to: 36 }], stills: pair(1.1), seconds: 18 });
  assert.ok(closed.toStill >= .9 && closed.walkers[0].close === 0, `llegó a ${closed.toStill.toFixed(2)} m`);
  assert.ok(closed.walkers[0].longestStop > 3, `esperó ${closed.walkers[0].longestStop.toFixed(2)} s`);
  // La única otra ruta lo devuelve por donde vino, mucho más de 10 m: no la toma, espera a que se muevan. Pero nadie
  // espera para siempre: a los 20 s de esperar da media vuelta.
  assert.ok(!closed.walkers[0].turned, 'dio media vuelta a los pocos segundos de esperar');
  const patient = await crowd({ isWalkable: lane, movers: [{ from: 6, to: 36 }], stills: pair(1.1), seconds: 42 });
  assert.ok(patient.walkers[0].turned && patient.walkers[0].longestStop > 15, `tras ${patient.walkers[0].longestStop.toFixed(1)} s esperando ${patient.walkers[0].turned ? 'tomó otra ruta' : 'seguía ahí'}`);
});

test('a quien anda tan despacio que casi no avanza lo rodean como a un quieto; quien bajó el paso para ceder no cuenta como quieto', async () => {
  // Uno que va a 0,1 m/s por su ruta, a medio metro de la línea de dos que vienen de frente: lo rodean por turnos.
  // Antes no contaba como quieto (tiene ruta) y uno de los dos terminaba dando media vuelta.
  const slow = await crowd({ movers: [{ from: 6, to: 36 }, { from: 32, to: 4 }], stills: [{ kind: 'peatón', x: 20, z: 2.5, to: 38, speed: .1 }] });
  assert.ok(slow.walkers.every(w => w.at !== null && !w.turned && w.back < .5), `con uno muy lento: ${JSON.stringify(slow.walkers.map(w => [w.at, w.turned, +w.back.toFixed(2)]))}`);
  assert.ok(slow.toStill >= .6 && slow.between >= .6, `a ${slow.toStill.toFixed(2)} m del lento y a ${slow.between.toFixed(2)} m entre ellos`);
  // Una fila lenta (0,7 m/s) pasa junto a un quieto mientras otro espera su turno parado. El que espera tiene ruta y solo
  // bajó el paso: no cuenta como otro quieto. Si contara, el último de la fila vería el paso cerrado por dos quietos y
  // daría media vuelta.
  const paused = await crowd({ movers: [{ from: 6, to: 36 }, { from: 26, to: 4, speed: .7 }, { from: 28, to: 4, speed: .7 }, { from: 30, to: 4, speed: .7 }],
    stills: [{ kind: 'peatón', x: 20, z: 2.4 }], seconds: 70 });
  assert.ok(paused.walkers.every(w => w.at !== null && !w.turned && w.back < .5), `con uno que espera su turno: ${JSON.stringify(paused.walkers.map(w => [w.at, w.turned, +w.back.toFixed(2)]))}`);
  // Dos de cada lado llegan a un quieto casi a la vez: los de un lado esperan su turno parados un poco antes. Tienen
  // ruta y solo bajaron el paso: para los que vienen de frente siguen siendo gente que anda, y se esquivan con ellos
  // como siempre. Si al parar contaran como quietos, cerrarían el paso con el quieto de verdad y dos darían media vuelta.
  const turns = await crowd({ movers: [{ from: 6, to: 36 }, { from: 3, to: 36 }, { from: 34, to: 4 }, { from: 37.2, to: 4 }], stills: [{ kind: 'peatón', x: 20, z: 1.6 }], seconds: 70 });
  assert.ok(turns.walkers.every(w => w.at !== null && !w.turned && w.back < .5), `dos de cada lado: ${JSON.stringify(turns.walkers.map(w => [w.at, w.turned, +w.back.toFixed(2)]))}`);
});

test('dos que quedan cara a cara justo a la distancia de parada, junto a un quieto, no se quedan ahí: un respiro no borra la cuenta de trabado', async () => {
  // Un quieto casi en la línea; uno va, otro viene de frente y un tercero llega más rápido detrás del primero. El
  // primero cede junto al quieto y los otros dos quedan cara a cara a la distancia de parada, donde «lo tengo encima»
  // se prende y se apaga de un cuadro a otro. Si cada respiro borra la cuenta, el desempate no llega nunca: se quedan
  // 24 s parados y el que cedió da media vuelta. Con la cuenta firme, uno pasa (abriéndose un poco más de su tope,
  // porque al otro no le cabe correrse) y siguen los tres.
  const jam = await crowd({ movers: [{ from: 6, to: 36 }, { from: 34, to: 4 }, { from: 3.5, to: 36, speed: 1.6 }], stills: [{ kind: 'peatón', x: 20, z: 1.7 }], seconds: 70 });
  const seen = JSON.stringify(jam.walkers.map(w => [w.at, w.turned, +w.back.toFixed(2), +w.longestStop.toFixed(2)]));
  assert.ok(jam.walkers.every(w => w.at !== null && !w.turned && w.back < .5), `tres y un quieto: ${seen}`);
  assert.ok(jam.walkers.every(w => w.longestStop < 6), `alguno se quedó parado: ${seen}`);
  // Pasan justos (hombro con hombro), sin encimarse.
  assert.ok(jam.between >= .5 && jam.toStill >= .5, `se acercaron a ${jam.between.toFixed(2)} m, y a ${jam.toStill.toFixed(2)} m del quieto`);
});

test('quien eligió un lado por donde no cabe lo suelta cuando el otro lado lleva medio segundo libre, y no antes', async () => {
  // Uno va adelante en su mismo sentido, a 0,2 m/s y a 0,4 m de su línea, y de frente viene otro por el lado ancho:
  // se abre por el angosto, donde no le cabe pasar al lento. Mientras el de frente sigue ahí, el lado es firme. Cuando
  // ya pasó, el lado ancho queda libre: antes seguía 4 s detrás del lento, a su paso, y se devolvía 30 m.
  let side = 0, crossedAt = null, sawAt = null, time = 0;
  const run = await crowd({ movers: [{ from: 6, to: 36 }, { from: 36, to: 4 }], stills: [{ kind: 'peatón', x: 20, z: 1.6, to: 2, speed: .2 }], seconds: 45,
    onFrame: ws => {
      time += 1 / 60;
      const m = ws[1].npc.mind, other = ws[0].npc.position.x - ws[1].npc.position.x; // > 0: el de frente ya quedó atrás
      if (m.side > .5) side = Math.max(side, m.side);
      if (sawAt === null && side > .5 && other > .5) sawAt = time;
      if (crossedAt === null && side > .5 && m.side < 0) { crossedAt = time; assert.ok(other > .5, 'soltó el lado con el de frente todavía ahí'); }
    } });
  const w = run.walkers[1];
  assert.ok(side > .5, `no se abrió por el lado angosto (${side.toFixed(2)})`);
  assert.ok(w.at !== null && !w.turned && w.back < .5 && w.longestStop < 1, `detrás del lento: ${JSON.stringify([w.at, w.turned, +w.back.toFixed(2), +w.longestStop.toFixed(2)])}`);
  assert.ok(crossedAt !== null && crossedAt - sawAt >= AVOID.letGo && crossedAt - sawAt < 4, `cambió de lado ${crossedAt === null ? 'nunca' : (crossedAt - sawAt).toFixed(2) + ' s después de quedar libre'}`);
  assert.ok(run.between >= .6 && run.toStill >= .6, `se acercaron a ${run.between.toFixed(2)} m, y a ${run.toStill.toFixed(2)} m del lento`);
});

test('un grupo que cierra el andén no se rodea por la calzada; arrimado a un borde no pisa la raya; y si el quieto se le viene encima se abre un poco más', async () => {
  // Pared a un lado y calzada al otro (se puede pisar, pero no es andén). Dos quietos sin hueco tapan el andén: no baja
  // a la calzada a rodearlos; espera.
  let farthest = -Infinity;
  const road = await crowd({ rows: 2, isWalkable: (x, z) => z > 1.2 && z < 5 && x > 0 && x < 80, movers: [{ from: 6, to: 36 }],
    stills: [{ kind: 'peatón', x: 20, z: 1.6 }, { kind: 'peatón', x: 20, z: 2.6 }], seconds: 12,
    onFrame: ws => { farthest = Math.max(farthest, ws[0].npc.position.z); } });
  assert.ok(farthest < 3 && road.toStill >= .9, `llegó hasta z = ${farthest.toFixed(2)} (el andén termina en 3) y a ${road.toStill.toFixed(2)} m de ellos`);
  // Andén de 1,8 m y el jugador parado casi en la línea: los dos que vienen de frente le pasan pegados a la pared. El que
  // se arrima deja dos dedos al borde; pegado a la raya misma, el paso siguiente no sería pisable y soltaría la ruta.
  const edge = await crowd({ isWalkable: (x, z) => z > 1 && z < 2.8 && x > 0 && x < 80, movers: [{ from: 6, to: 36 }, { from: 32, to: 4 }], stills: [{ kind: 'jugador', x: 20, z: 1.9 }] });
  assert.ok(edge.walkers.every(w => w.at !== null && !w.turned), `junto a la pared: ${JSON.stringify(edge.walkers.map(w => [w.at, w.turned]))}`);
  // El jugador, parado a medio metro de la línea, da un paso de 1 m hacia quien ya lo rodea y se le mete al lado: el
  // peatón se corre un poco más de la cuenta (hay andén) y sigue, en vez de quedar encajonado y devolverse.
  const step = await crowd({ movers: [{ from: 6, to: 36 }, { from: 32, to: 4 }], stills: [{ kind: 'jugador', x: 20, z: 1.5 }],
    playerStep: (player, t) => { if (t >= 9 && t < 9.4) player.z += 1 / .4 / 60; } });
  assert.ok(step.walkers.every(w => w.at !== null && !w.turned && w.back < .5), `con el jugador que se le mete: ${JSON.stringify(step.walkers.map(w => [w.at, w.turned, +w.back.toFixed(2)]))}`);
  assert.ok(step.toStill >= .45, `quedó a ${step.toStill.toFixed(2)} m del jugador`);
});

test('a una pareja de Calle viva que conversa atravesada en el andén la rodea con tiempo, sin meterse entre los dos ni cambiar de ruta', async () => {
  class Sound {
    constructor() { this.id = 0; this.playingId = null; }
    state() { return 'loaded'; }
    play() { this.playingId = ++this.id; return this.playingId; }
    playing(id) { return this.playingId === id; }
    stop(id) { if (this.playingId === id) this.playingId = null; }
    volume() {} duration() { return 3; } unload() {}
  }
  const report = [];
  for (const [rows, zc] of [[3, 1.7], [3, 2], [3, 2.3], [2, 1.4], [2, 1.7], [2, 2]]) {
    // Dos que se quedan hablando a metro y medio uno del otro, atravesados; el tercero viene por el andén.
    const nav = sidewalk(rows);
    // Calle viva solo junta a quienes tienen voz: se busca gente que la tenga.
    const talker = async at => { for (;;) { const npc = await walker(at, nav); if (npcSexo(npc)) return npc; npc.dispose(); } };
    const one = await talker([20, 0, zc - .75]), other = await talker([20, 0, zc + .75]), w = await walker([4, 0, 2], nav);
    for (const t of [one, other]) { t.route = []; t.target = null; t.wait = 1e6; }
    straight(w, 4, 36, 2);
    const route = w.route;
    const lines = Array.from({ length: 10 }, (_, k) => ({ hablante: k % 2 ? 'B' : 'A', texto: `L${k}`, file: `f${k}` }));
    const talks = new NpcConversations({ conversations: [{ id: 'c', hablantes: { A: { sexo: npcSexo(one) }, B: { sexo: npcSexo(other) } }, lineas: lines }], random: () => 0, load: () => new Sound() });
    const player = new THREE.Vector3(20, 0, 8), scene = street([one, other, w]);
    let ms = 0, time = 0, talking = false, turned = false, at = null, best = -Infinity, back = 0, closest = Infinity, close = 0, startAt = null, between = false, stopped = 0;
    run(scene, 40, player, () => {
      time += 1 / 60; ms += 1000 / 60;
      talks.update(player, scene.district.npcs, ms);
      if (one.talk?.ready && other.talk?.ready) talking = true;
      if (at !== null) return;
      best = Math.max(best, w.position.x); back = Math.max(back, best - w.position.x);
      if (w.route !== route) turned = true;
      const near = Math.min(w.position.distanceTo(one.position), w.position.distanceTo(other.position));
      closest = Math.min(closest, near);
      if (near < .6) close += 1 / 60;
      if (w.mind.paceFactor() < .05) stopped += 1 / 60;
      if (startAt === null && Math.abs(w.mind.side) > .05) startAt = 20 - w.position.x;
      if (Math.abs(w.position.x - 20) < .3 && w.position.z > Math.min(one.position.z, other.position.z) && w.position.z < Math.max(one.position.z, other.position.z)) between = true;
      if (w.position.x > 35.5) at = time;
    });
    report.push({ ancho: rows * 2, zc, talking, arrived: at !== null, turned, back: +back.toFixed(2), closest: +closest.toFixed(2), close: +close.toFixed(2),
      startAt: startAt && +startAt.toFixed(2), between, stopped: +stopped.toFixed(2) });
    for (const n of [one, other, w]) n.dispose();
  }
  const bad = (what, ok) => assert.ok(report.every(ok), `${what}: ${JSON.stringify(report.filter(r => !ok(r)))}`);
  // Alguno de los dos puede estar en otra cosa (con el celular) y no entrar en la charla: igual son dos quietos.
  assert.ok(report.filter(r => r.talking).length >= 4, `conversan en ${report.filter(r => r.talking).length} de ${report.length}`);
  bad('pasa sin devolverse ni cambiar de ruta', r => r.arrived && !r.turned && r.back < .1);
  bad('decide por dónde a 4 m o más', r => r.startAt >= 4);
  bad('no se mete entre los dos ni se les arrima', r => !r.between && r.closest >= .65 && r.close === 0);
  bad('no se queda parado', r => r.stopped < .5);
});
