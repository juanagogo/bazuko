// El agarrón del agente a pie: aviso, zarpazo y traspié, contra un jugador de guion con la inercia del juego (su
// velocidad va hacia la pedida con 1 - e^(-22 dt); soltando las teclas o agarrado, con 18).
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

globalThis.window = new EventTarget();
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, snapPose() {}, setWeapon() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, randomReal: (_, base) => ({ ...base }), optionsFor: () => [{ id: 'test' }], REAL_DEFAULT: {}
} });
const textures = await import('../src/world/bogota/textures.js');
mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { PoliceFootSystem } = await import('../src/systems/PoliceFootSystem.js');
const { POLICE_FOOT, POLICE_GRAB, POLICE_GRAB_LINES, POLICE_GRAB_PLATE } = await import('../src/entities/PoliceOfficer.js');
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { TrafficRoute } = await import('../src/world/bogota/TrafficRoute.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');

const DT = 1 / 60, RUN = 6, WALK = 3, DEG = Math.PI / 180;
let events, clock;
beforeEach(() => {
  globalThis.window = new EventTarget();
  events = [];
  clock = 0;
  for (const type of ['police-arrest', 'police-escaped', 'police-grab', 'toast']) {
    window.addEventListener(type, e => events.push({ type, text: e.detail?.text ?? null, kind: e.detail?.type ?? null, plate: e.detail?.placa ?? null, leads: e.detail?.manda ?? null, t: clock }));
  }
});
const first = (type, text = null) => events.find(e => e.type === type && (text === null || e.text === text)) ?? null;
const count = (type, text = null) => events.filter(e => e.type === type && (text === null || e.text === text)).length;

/**
 * El acompañante ya afuera y corriendo con todo el pique, `gap` m detrás del jugador, que va con rumbo `heading` por un
 * potrero sin nada, lejos de la patrulla. `want(speed, angle)` es lo que pide el teclado; `step()` avanza un cuadro.
 */
function chase({ gap = 4, heading = .3, level = 1, collisions = null } = {}) {
  // Cada persecución cuenta sus propios avisos.
  events.length = 0;
  clock = 0;
  const scene = new THREE.Scene();
  const traffic = new TrafficSystem(scene, [new TrafficRoute(0, 400, 0, 400, 3.2)], { carsPerRoute: 0, policeCount: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0];
  vehicle.distance = vehicle.nextDistance = 20;
  vehicle.route.sample(vehicle.distance, vehicle.car.position, new THREE.Vector3());
  vehicle.car.group.rotation.y = 0;
  traffic.wantedLevel = level;
  const player = { position: new THREE.Vector3(60, 0, 0) };
  const system = new PoliceFootSystem(scene, { player, random: () => .5 });
  system.setup({ isWalkableAt: () => true, getGroundHeight: () => 0 }, traffic, [], { collisions });
  const unit = vehicle.crew, officer = unit.partner, p = player.position;
  const velocity = new THREE.Vector3(), asked = new THREE.Vector3();
  const world = { unit, officer, p, velocity, heading, held: false };
  world.want = (speed, angle = world.heading) => asked.set(Math.cos(angle) * speed, 0, Math.sin(angle) * speed);
  world.step = () => {
    clock += DT;
    if (first('police-grab')) world.held = true; // el juego le suelta el teclado
    const goal = world.held ? _zero : asked, k = 1 - Math.exp(-(world.held || goal.lengthSq() === 0 ? 18 : 22) * DT);
    velocity.x += (goal.x - velocity.x) * k;
    velocity.z += (goal.z - velocity.z) * k;
    p.addScaledVector(velocity, DT);
    traffic.update(DT, { player: p });
    system.update(DT, {});
  };
  world.until = (done, seconds = 20) => { for (let t = 0; t < seconds; t += DT) { world.step(); if (done()) return true; } return false; };
  world.distance = () => Math.hypot(p.x - officer.position.x, p.z - officer.position.z);
  traffic._startChase(vehicle);
  assert.ok(world.until(() => officer.state === 'persecucion', 30), 'se bajó');
  p.x += Math.cos(heading) * 25;
  p.z += Math.sin(heading) * 25;
  officer.position.set(p.x - Math.cos(heading) * gap, 0, p.z - Math.sin(heading) * gap);
  officer.root.rotation.y = Math.atan2(Math.cos(heading), Math.sin(heading));
  officer.sprintLeft = POLICE_FOOT.sprintTime;
  officer._pace = POLICE_FOOT.sprintSpeed;
  officer._pointClock = 0;
  officer._exitClock = officer._roundHold = 0;
  officer._route = [];
  return world;
}
const _zero = new THREE.Vector3();
const AVISO = POLICE_GRAB_LINES.aviso, ZAFO = POLICE_GRAB_LINES.zafo, ENCIMA = POLICE_GRAB_LINES.encima;

/** Corre derecho y, a `delay` s del aviso, quiebra `angle` grados. Devuelve el mundo ya resuelto el zarpazo. */
function dodge({ delay, angle, gap = 4, heading = .3 }) {
  const world = chase({ gap, heading });
  world.want(RUN);
  assert.ok(world.until(() => first('toast', AVISO)), 'avisó');
  const warned = clock;
  world.until(() => clock - warned >= delay - 1e-9, 2);
  world.heading += angle * DEG;
  world.want(RUN);
  world.until(() => first('toast', ZAFO) || first('police-grab'), 2);
  return world;
}

test('las medidas del agarrón: pique en 0,6 s, aviso de medio segundo a 2 m, zarpazo corto y traspié caro', () => {
  const G = POLICE_GRAB;
  const sprint = POLICE_FOOT.sprintSpeed / G.accel;
  assert.ok(sprint > .55 && sprint < .65, `de quieto al pique en ${sprint.toFixed(2)} s`);
  assert.ok(Math.abs(G.warn - 2) < .01 && Math.abs(G.warnTime - .5) < .01);
  assert.ok(G.warnTurn <= 60 * DEG + 1e-9 && G.lungeTurn <= 60 * DEG + 1e-9, 'avisando y echándose gira 60° por segundo a lo sumo');
  assert.ok(G.lunge >= .12 && G.lunge <= .15);
  assert.ok(Math.abs(G.reach - 1.3) < .01 && Math.abs(G.cone - 40 * DEG) < 1e-9);
  assert.ok(Math.abs(G.hold - .3) < .01);
  assert.ok(Math.abs(G.stumble - .9) < .01 && G.stumbleSpeed >= 1.5 && G.stumbleSpeed <= 2 && G.stumbleSprint === 1.5);
  assert.ok(G.pointClear >= .5, 'el brazo de señalar (e^(-7 t)) ya va en 0,03 cuando avisa');
});

test('arranca de quieto: llega al pique en unos 0,6 s, no de un cuadro al otro', () => {
  const world = chase({ gap: 30 });
  const { officer } = world;
  officer._pace = 0;
  world.want(RUN);
  let reached = null;
  const from = clock;
  world.until(() => {
    if (clock - from < .3) assert.ok(officer.groundSpeed < POLICE_FOOT.sprintSpeed * .65, `a los ${(clock - from).toFixed(2)} s ya iba a ${officer.groundSpeed.toFixed(1)} m/s`);
    if (officer.groundSpeed >= POLICE_FOOT.sprintSpeed - .05) reached = clock - from;
    return reached !== null;
  }, 2);
  assert.ok(reached > .5 && reached < .75, `llegó al pique en ${reached?.toFixed(2)} s`);
});

for (const [name, speed] of [['quieto', 0], ['caminando', WALK], ['corriendo derecho', RUN]]) {
  test(`${name}: avisa a 2 m con su grito y su línea, medio segundo después se echa, lo agarra y a los 0,3 s lo arresta`, () => {
    const world = chase();
    const { officer } = world;
    if (speed) world.want(speed);
    assert.ok(world.until(() => count('police-arrest') > 0), 'lo arrestó');
    const warn = first('toast', AVISO), grab = first('police-grab'), arrest = first('police-arrest');
    assert.ok(warn && grab, 'avisó y lo agarró');
    assert.equal(count('toast', AVISO), 1, 'un solo aviso');
    assert.equal(count('toast', ZAFO), 0);
    assert.equal(officer.lastLine, AVISO, 'lo gritó');
    assert.ok(Math.abs(grab.t - warn.t - (POLICE_GRAB.warnTime + POLICE_GRAB.lunge)) <= DT * 2.5, `del aviso al agarre ${(grab.t - warn.t).toFixed(2)} s`);
    assert.ok(Math.abs(arrest.t - grab.t - POLICE_GRAB.hold) <= DT * 2.5, `del agarre al arresto ${(arrest.t - grab.t).toFixed(2)} s`);
    assert.ok(world.distance() <= POLICE_GRAB.reach, `lo tiene a ${world.distance().toFixed(2)} m`);
    assert.ok(world.velocity.length() < .2, 'agarrado, frenó');
    for (let i = 0; i < 60; i++) world.step();
    assert.equal(count('police-arrest'), 1, 'una sola vez');
  });
}

test('el aviso se ve venir: el brazo de señalar ya está abajo, casi no gira y las poses van en orden', () => {
  const world = chase();
  const { officer } = world;
  world.want(RUN);
  const seen = [];
  let warnedAt = null, turned = 0, yaw = null, pointing = 0, lungeFrames = 0, pointClock = null;
  world.until(() => {
    const phase = officer._grab?.phase ?? null;
    if (phase && warnedAt === null) { warnedAt = clock; pointClock = officer._pointClock; }
    if (phase) {
      pointing = Math.max(pointing, officer.poseParams.point ?? 0);
      if (seen.at(-1) !== officer.poseParams.stance) seen.push(officer.poseParams.stance);
      assert.equal(officer.poseParams.stanceWeight, 1);
    }
    if (phase === 'aviso') {
      if (yaw !== null) turned = Math.max(turned, Math.abs(Math.atan2(Math.sin(officer.root.rotation.y - yaw), Math.cos(officer.root.rotation.y - yaw))) / DT);
      yaw = officer.root.rotation.y;
    }
    if (phase === 'zarpazo') lungeFrames++;
    return count('police-arrest') > 0;
  });
  assert.ok(pointClock >= POLICE_GRAB.pointClear, `llevaba ${pointClock?.toFixed(2)} s sin señalar`);
  assert.equal(pointing, 0, 'el brazo es de la pose, no de la capa de señalar');
  assert.ok(turned <= POLICE_GRAB.warnTurn + 1e-6, `giró a ${(turned / DEG).toFixed(0)}° por segundo`);
  assert.deepEqual(seen, ['aviso', 'zarpazo', 'agarre']);
  // A 30 cuadros por segundo, el zarpazo son tres o cuatro.
  assert.ok(lungeFrames / 2 >= 3 && lungeFrames / 2 <= 4.5, `${lungeFrames} cuadros a 60 por segundo`);
});

test('quebrar a tiempo: el zarpazo pasa de largo, «¡Se le zafó!», y el traspié le cuesta metros y pique', () => {
  for (const [delay, angle] of [[.2, 90], [.25, -80], [.3, 100], [.3, -110], [.22, 75]]) {
    const world = dodge({ delay, angle });
    const { officer } = world, label = `${angle}° a los ${delay} s`;
    assert.equal(count('toast', ZAFO), 1, label);
    // Los dos avisos van como advertencia y con su texto corto para la placa de la persecución: no hacen cola.
    assert.deepEqual([first('toast', AVISO).kind, first('toast', ZAFO).kind], ['warn', 'warn'], label);
    assert.deepEqual([first('toast', AVISO).plate, first('toast', ZAFO).plate], [POLICE_GRAB_PLATE.aviso, POLICE_GRAB_PLATE.zafo], label);
    // El aviso manda en la placa; el «¡SE ZAFÓ!» solo informa.
    assert.deepEqual([first('toast', AVISO).leads, first('toast', ZAFO).leads], [true, false], label);
    // Yéndose de largo ya no dice «¡Quieto ahí!».
    assert.equal(officer.lastLine, POLICE_GRAB_LINES.traspie, label);
    assert.equal(count('police-grab'), 0, label);
    assert.equal(officer.poseParams.stance, 'traspie', label);
    // El traspié: 0,9 s, baja a 1,75 m/s y así sigue; al final el jugador le sacó entre 3,5 y 4,5 m.
    const sprint = officer.sprintLeft, gap = world.distance(), from = clock;
    let slowest = Infinity, pointing = 0;
    world.until(() => {
      if (clock - from > POLICE_GRAB.stumbleLow + DT) slowest = Math.min(slowest, officer.groundSpeed);
      if (officer._stumble > 0) {
        pointing = Math.max(pointing, officer.poseParams.point ?? 0);
        assert.ok(officer.groundSpeed <= POLICE_FOOT.sprintSpeed + .1);
        if (clock - from > POLICE_GRAB.stumbleLow + DT) assert.ok(officer.groundSpeed <= POLICE_GRAB.stumbleSpeed + .1, `${label}: iba a ${officer.groundSpeed.toFixed(2)} m/s`);
      }
      return !(officer._stumble > 0);
    }, 2);
    assert.ok(Math.abs(clock - from - POLICE_GRAB.stumble) <= DT * 2, `${label}: duró ${(clock - from).toFixed(2)} s`);
    assert.ok(slowest >= 1.5 && slowest <= 2, `${label}: bajó a ${slowest.toFixed(2)} m/s`);
    assert.equal(pointing, 0, 'recomponiéndose no señala');
    const lost = world.distance() - gap;
    assert.ok(lost >= 3.5 && lost <= 4.5, `${label}: perdió ${lost.toFixed(2)} m`);
    assert.ok(sprint <= POLICE_FOOT.sprintTime - POLICE_GRAB.stumbleSprint, `${label}: le quedaban ${sprint.toFixed(2)} s de pique`);
    // Y la persecución sigue: no lo arrestó de carambola.
    world.until(() => false, 1);
    assert.equal(count('police-arrest'), 0, label);
    assert.equal(officer.state, 'persecucion');
  }
});

test('quebrar tarde no salva, quebrar antes del aviso tampoco y el zigzag a ciegas tampoco', () => {
  // Tarde: a 0,45 s o más del aviso ya está echado.
  for (const [delay, angle] of [[.45, 90], [.5, -90], [.55, 100]]) {
    const world = dodge({ delay, angle });
    assert.equal(count('police-grab'), 1, `${angle}° a los ${delay} s`);
    assert.ok(world.until(() => count('police-arrest') > 0, 1));
  }
  // Antes: con el agente a 2,7 m todavía no ha avisado; el aviso llega después y lo coge igual.
  for (const angle of [90, -90]) {
    const world = chase();
    world.want(RUN);
    world.until(() => world.distance() < 2.7);
    assert.equal(count('toast', AVISO), 0);
    world.heading += angle * DEG;
    world.want(RUN);
    assert.ok(world.until(() => count('police-arrest') > 0), `quiebre de ${angle}° antes del aviso`);
    assert.equal(count('toast', ZAFO), 0);
  }
  // Zigzag: 45° a cada lado cada 0,3 s, sin mirar el aviso.
  const world = chase();
  let sign = 1, since = 0;
  assert.ok(world.until(() => {
    since += DT;
    if (since >= .3) { since = 0; sign = -sign; }
    if (!world.held) world.want(RUN, world.heading + sign * 45 * DEG);
    return count('police-arrest') > 0;
  }), 'al del zigzag lo arrestó');
});

/** Maneras de correr sin mirar el aviso: lo que pide el teclado a los `t` s, con rumbo de salida `base`. */
const BLIND = {
  // En redondo, `rate` grados por segundo.
  circle: rate => (t, base) => base + t * rate * DEG,
  // De lado a lado: `angle` grados a cada lado, cambiando cada `period` s.
  weave: (angle, period) => (t, base) => base + (Math.floor(t / period) % 2 ? angle : -angle) * DEG
};

/** Corre a ciegas hasta el arresto o `seconds`. Devuelve los segundos que duró, o Infinity. */
function runBlind(world, turn, seconds) {
  const base = world.heading, from = clock;
  let t = 0;
  const caught = world.until(() => {
    t += DT;
    if (!world.held) world.want(RUN, turn(t, base));
    return count('police-arrest') > 0;
  }, seconds);
  return caught ? clock - from : Infinity;
}

test('a ciegas no se salva: en redondo o de lado a lado se le zafa dos veces y a la tercera se le tira encima', () => {
  const ways = {
    'en redondo a 120° por segundo': BLIND.circle(120), 'en redondo a 240° por segundo': BLIND.circle(240),
    'de lado a lado, 60° cada 0,5 s': BLIND.weave(60, .5), 'de lado a lado, 90° cada 0,5 s': BLIND.weave(90, .5),
    'de lado a lado, 90° cada segundo': BLIND.weave(90, 1)
  };
  for (const [name, turn] of Object.entries(ways)) {
    const world = chase(), { officer } = world;
    const stances = new Set();
    const step = world.step;
    world.step = () => { step(); if (officer._grab?.sure) stances.add(officer.poseParams.stance); };
    const seconds = runBlind(world, turn, 15);
    assert.ok(seconds < 15, `${name}: sin arresto a los 15 s, con ${count('toast', ZAFO)} zarpazos al aire`);
    // Dos zarpazos al aire como mucho; si los hubo, el tercero ya no es un zarpazo: lo dice y se ve distinto.
    assert.ok(count('toast', ZAFO) <= POLICE_GRAB.sure, `${name}: ${count('toast', ZAFO)} zarpazos al aire`);
    if (count('toast', ZAFO) === POLICE_GRAB.sure) {
      assert.equal(count('toast', ENCIMA), 1, name);
      assert.equal(first('toast', ENCIMA).plate, POLICE_GRAB_PLATE.encima, name);
      assert.ok(stances.has('embestida') && !stances.has('aviso') && !stances.has('zarpazo'), `${name}: ${[...stances]}`);
      assert.equal(officer._misses, 0, `${name}: al agarrarlo la cuenta vuelve a cero`);
    }
  }
});

test('girar hasta el primer zarpazo al aire y de ahí correr derecho tampoco salva: al que viene girando se le tira encima de una', () => {
  // Un zarpazo al aire es el escape de ese agente (4 m y 1,5 s de pique), y al que gira sin parar el zarpazo derecho le cae
  // siempre al aire: sin mirar el aviso, bastaba dar una vuelta y salir derecho.
  const keys = (rate, each) => (t, base) => base + Math.floor(t * rate / each) * each * DEG;
  const ways = {
    'en redondo a 90° por segundo': BLIND.circle(90), 'en redondo a 120° por segundo': BLIND.circle(120),
    'en redondo a 180° por segundo': BLIND.circle(180), 'rotando las ocho direcciones, 120° por segundo': keys(120, 45),
    'rotando las ocho direcciones, 90° por segundo': keys(90, 45)
  };
  for (const [name, turn] of Object.entries(ways)) for (const gap of [4, 6]) {
    const world = chase({ gap }), base = world.heading, label = `${name}, a ${gap} m`;
    let t = 0, leaves = null;
    const caught = world.until(() => {
      t += DT;
      if (leaves === null && first('toast', ZAFO)) leaves = clock + .5;
      // Hasta medio segundo después del primer zarpazo al aire sigue girando; de ahí, derecho por donde iba.
      if (!world.held && (leaves === null || clock < leaves)) world.want(RUN, world.heading = turn(t, base));
      else if (!world.held) world.want(RUN);
      return count('police-arrest') > 0;
    }, 25);
    assert.ok(caught, `${label}: se fue, con ${count('toast', ZAFO)} zarpazos al aire y el agente a ${world.distance().toFixed(1)} m`);
    assert.equal(count('toast', ZAFO), 0, `${label}: ${count('toast', ZAFO)} zarpazos al aire`);
    assert.equal(first('toast', AVISO), null, `${label}: no le echa el zarpazo derecho`);
    assert.equal(first('toast', ENCIMA).plate, POLICE_GRAB_PLATE.encima, label);
  }
  // La curva corta también: empieza a girar cuando lo tiene a 3 m y a los 2 s sale derecho.
  for (const rate of [90, 120, 180]) {
    const world = chase({ gap: 5 }), base = world.heading;
    let from = null;
    world.want(RUN);
    const caught = world.until(() => {
      if (from === null && world.distance() < 3) from = clock;
      if (!world.held && from !== null && clock - from < 2) world.want(RUN, world.heading = base + (clock - from) * rate * DEG);
      else if (!world.held) world.want(RUN);
      return count('police-arrest') > 0;
    }, 25);
    assert.ok(caught, `curva de 2 s a ${rate}° por segundo: se fue, con el agente a ${world.distance().toFixed(1)} m`);
  }
  // Un quiebre suelto no es venir girando: al que corre derecho y quiebra a tiempo le sigue echando el zarpazo de siempre.
  for (const angle of [70, 90, 110, -110]) {
    const world = dodge({ delay: .25, angle });
    assert.ok(first('toast', ZAFO) && !first('toast', ENCIMA) && !first('police-grab'), `quiebre de ${angle}°: se zafa de un zarpazo corriente`);
    assert.ok(world.officer._seenTurning < POLICE_GRAB.sureSweptTime, `quiebre de ${angle}°: ${world.officer._seenTurning.toFixed(2)} s girando`);
  }
});

test('dando vueltas no hay persecución sin fin: el agente le corta el camino en vez de girar por dentro', () => {
  // A 70° por segundo el jugador da vueltas de 4,9 m de radio. Corriendo a la cola, el agente ya sin pique se queda girando
  // por dentro sin llegar a los 2 m del aviso. Yendo adonde él va a estar, lo alcanza.
  for (const rate of [55, 70, 90]) {
    const world = chase(), { officer } = world;
    officer.sprintLeft = 0;
    const seconds = runBlind(world, BLIND.circle(rate), 60);
    assert.ok(seconds < 30, `a ${rate}° por segundo: sin arresto a los ${Math.min(seconds, 60).toFixed(0)} s, con el agente a ${world.distance().toFixed(1)} m`);
  }
});

test('la cuenta de zarpazos al aire se borra si se le aleja o si pasa un rato: el que se zafa y huye no paga por los quiebres buenos', () => {
  // Con dos zarpazos al aire a cuestas y ya sin pique, a 7 m del jugador, que corre derecho.
  const world = chase({ gap: 7 }), { officer } = world;
  officer._misses = POLICE_GRAB.sure;
  officer._missClock = 0;
  officer.sprintLeft = 0;
  // A `sureFar` m la cuenta vuelve a cero, y el siguiente es otra vez un aviso de los de siempre.
  world.want(RUN);
  assert.ok(world.until(() => world.distance() > POLICE_GRAB.sureFar, 5), 'se le alejó');
  world.until(() => false, DT * 2);
  assert.equal(officer._misses, 0);
  // Y sin alejarse, a los `sureForget` s sin otro zarpazo también.
  officer._misses = POLICE_GRAB.sure;
  officer._missClock = 0;
  const p = world.p;
  officer.position.set(p.x - 5, 0, p.z);
  world.step = (step => () => { step(); officer.position.set(p.x - 5, 0, p.z); officer._dropGrab(); })(world.step);
  world.until(() => false, POLICE_GRAB.sureForget - .1);
  assert.equal(officer._misses, POLICE_GRAB.sure, 'todavía se acuerda');
  world.until(() => false, .2);
  assert.equal(officer._misses, 0, 'ya se le olvidó');
});

test('quieto junto a un poste: con el poste en medio lo ve, no se queda mirándolo, da un paso de lado y lo agarra', () => {
  // Un poste de 30 cm a medio metro del jugador, del lado por donde llega el agente: justo en la línea y a cada lado.
  for (const aside of [0, .12, -.12]) {
    const collisions = new CollisionSystem();
    const world = chase({ gap: 6, heading: 0, collisions });
    const post = new THREE.Mesh();
    post.position.set(world.p.x - .5, 0, world.p.z + aside);
    collisions.add(post, new THREE.Vector3(.3, 3, .3));
    world.want(0);
    const label = `poste ${aside} m al lado`, from = clock;
    assert.ok(world.until(() => first('police-arrest'), 10), `${label}: sin arresto a los 10 s, con el agente a ${world.distance().toFixed(2)} m`);
    // Con el poste rozando la línea, el primer zarpazo puede dar contra el poste: lo agarra al segundo.
    assert.ok(count('toast', AVISO) <= 2, `${label}: ${count('toast', AVISO)} avisos`);
    assert.ok(first('police-arrest').t - from < 5, `${label}: lo arrestó a los ${(first('police-arrest').t - from).toFixed(1)} s`);
  }
});

test('avisando, si lo pierde de vista o se le va lejos no se echa al aire; golpeado, suelta el agarrón', () => {
  const far = chase();
  far.want(RUN);
  far.until(() => far.officer._grab?.phase === 'aviso');
  // Arrancó en un carro: de un cuadro al otro quedó a 12 m.
  far.p.x += Math.cos(far.heading) * 12;
  far.p.z += Math.sin(far.heading) * 12;
  far.until(() => !far.officer._grab, 1);
  assert.equal(far.officer._grab, null);
  assert.equal(count('toast', ZAFO), 0, 'no hubo zarpazo');
  assert.ok(!(far.officer._stumble > 0), 'ni traspié');

  const hit = chase();
  hit.want(RUN);
  hit.until(() => hit.officer._grab?.phase === 'aviso');
  hit.officer.takeHit({ damage: 5, dir: new THREE.Vector3(1, 0, 0), attackId: 'prueba' });
  assert.equal(hit.officer._grab, null, 'golpeado suelta el agarrón');
});
