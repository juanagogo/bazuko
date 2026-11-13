import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

// El tráfico, los carros, las colisiones y lo que deciden los agentes son reales; solo se sustituye la carga de modelos GLB.
// `animated` cuenta los cuadros en que algún personaje se animó (el LOD de los NPC congela la pose de lejos).
let animated = 0;
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() { animated++; }, snapPose() {}, setWeapon() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, randomReal: (_, base) => ({ ...base }),
  optionsFor: () => [{ id: 'test' }], REAL_DEFAULT: {}
} });
const textures = await import('../src/world/bogota/textures.js');
mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { PoliceFootSystem } = await import('../src/systems/PoliceFootSystem.js');
const { POLICE_FOOT } = await import('../src/entities/PoliceOfficer.js');
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { TrafficRoute } = await import('../src/world/bogota/TrafficRoute.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');
const { Car } = await import('../src/entities/Car.js');

const DT = 1 / 30;
let events;
beforeEach(() => {
  globalThis.window = new EventTarget();
  events = [];
  for (const type of ['police-arrest', 'police-escaped', 'toast']) window.addEventListener(type, e => events.push({ type, detail: e.detail }));
});
const count = type => events.filter(event => event.type === type).length;

/**
 * Una patrulla (o dos) en el tramo de arriba del circuito, rumbo a +X, y el jugador adelante.
 * Sin entorno de colisiones el carro de la persecución va derecho, como en las pruebas de TrafficSystem.
 */
function setup({ level = 1, police = 1, player = [60, 0], collisions = null, walkable = () => true, playerVehicle = null,
  second = [0, 60], district = {}, environment = null } = {}) {
  const scene = new THREE.Scene();
  const traffic = new TrafficSystem(scene, [new TrafficRoute(0, 200, 0, 200, 3.2)], { carsPerRoute: 0, policeCount: police, random: () => .5 });
  traffic.vehicles.forEach((vehicle, index) => {
    vehicle.distance = vehicle.nextDistance = 20 - index * 40;
    vehicle.route.sample(vehicle.distance, vehicle.car.position, new THREE.Vector3());
    vehicle.car.group.rotation.y = index ? -Math.PI / 2 : 0;
    if (index) vehicle.car.position.set(second[0], 0, second[1]);
  });
  if (environment) traffic.setEnvironment(environment);
  traffic.wantedLevel = level;
  const people = [];
  const playerObject = { position: new THREE.Vector3(player[0], 0, player[1]) };
  const system = new PoliceFootSystem(scene, { player: playerObject, random: () => .5, getPlayerVehicle: playerVehicle });
  system.setup({ isWalkableAt: walkable, getGroundHeight: () => 0, ...district }, traffic, people, { collisions });
  const vehicle = traffic.vehicles[0];
  const unit = vehicle.crew;
  return { scene, traffic, system, vehicle, unit, player: playerObject, people };
}

function step(world, dt = DT, extra = {}) {
  world.traffic.update(dt, { player: world.player.position });
  world.system.update(dt, extra);
}

function runUntil(world, done, seconds = 30, onStep = null) {
  for (let t = 0; t < seconds; t += DT) {
    onStep?.(t);
    step(world);
    if (done()) return t;
  }
  return Infinity;
}

const exitOf = (world, officer = world.unit.partner) => runUntil(world, () => officer.state !== 'dentro');

test('la patrulla no captura con el carro: frena del todo y después se baja el acompañante', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  let speedAtExit = null, phases = new Set();
  const t = runUntil(world, () => {
    phases.add(world.unit.phase);
    if (world.unit.partner.state !== 'dentro' && speedAtExit === null) speedAtExit = world.vehicle.speed;
    return speedAtExit !== null;
  });
  assert.ok(Number.isFinite(t), 'el acompañante se bajó');
  assert.ok(phases.has('frenando'), 'frenó antes de bajarse');
  assert.equal(speedAtExit, 0, 'nadie se baja de un carro andando');
  assert.equal(world.unit.phase, 'parada');
  assert.equal(world.unit.driver.state, 'dentro', 'con fichado 1 el conductor se queda al volante');
  const gap = world.vehicle.car.position.distanceTo(world.player.position);
  assert.ok(gap > POLICE_FOOT.catchRange * 2 && gap < POLICE_FOOT.dismountRange + 2, `paró a ${gap.toFixed(1)} m`);
  assert.equal(count('police-arrest'), 0);
  assert.equal(world.vehicle.state, 'chase');
  assert.equal(world.vehicle.hold, true, 'mientras haya alguien afuera queda marcada como en espera');
  assert.equal(world.traffic._canRetire(world.vehicle), false);
  assert.equal(world.vehicle.car.pursuit, false, 'parqueada: sin sirena');
  assert.ok(world.people.includes(world.unit.partner), 'a pie, los carros lo respetan y se le puede pegar');
});

test('con el jugador quieto, el agente lo alcanza y el arresto sale una sola vez, el mismo de siempre', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const t = runUntil(world, () => count('police-arrest') > 0, 20);
  assert.ok(Number.isFinite(t), 'lo arrestó');
  const officer = world.unit.partner;
  assert.ok(officer.position.distanceTo(world.player.position) <= POLICE_FOOT.catchRange + .05);
  for (let i = 0; i < 60; i++) step(world);
  assert.equal(count('police-arrest'), 1, 'una sola vez');
  assert.equal(events.find(event => event.type === 'police-arrest').detail.reason, 'a-pie');
  assert.ok(world.traffic.inPursuit, 'hasta que el juego cierre el arresto sigue la persecución');
  world.traffic.endPursuit();
  assert.equal(officer.state, 'dentro');
  assert.equal(officer.root.visible, false);
  assert.equal(world.unit.fit.doorAmount(1), 0, 'la puerta queda cerrada');
  assert.equal(world.vehicle.state, 'patrol');
  assert.equal(world.vehicle.hold, false);
  assert.equal(world.people.length, 0);
  assert.equal(world.traffic.inPursuit, false);
});

test('captura a 1,2 m sostenida 0,4 s, no a 3 m como el carro', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  runUntil(world, () => world.unit.partner.state === 'persecucion');
  const officer = world.unit.partner;
  // Lo mantiene a 2,5 m, dentro de los 3 m a los que captura el carro (`POLICE_CATCH_RANGE`): a pie no lo agarra.
  for (let t = 0; t < 3; t += DT) {
    const away = new THREE.Vector3().subVectors(world.player.position, officer.position).setY(0).normalize();
    world.player.position.copy(officer.position).addScaledVector(away, 2.5);
    step(world);
  }
  assert.equal(count('police-arrest'), 0);
  // Quieto al lado: lo agarra cuando pasan 0,4 s a menos de 1,2 m.
  let close = null;
  const t = runUntil(world, () => {
    const d = officer.position.distanceTo(world.player.position);
    if (close === null && d <= POLICE_FOOT.catchRange) close = 0;
    else if (close !== null) close += DT;
    return count('police-arrest') > 0;
  }, 5);
  assert.ok(Number.isFinite(t));
  assert.ok(close >= POLICE_FOOT.catchHold - DT * 1.5, `lo sostuvo ${close?.toFixed(2)} s`);
});

test('bajarse no tiene saltos: del asiento a la puerta en pasos cortos, sentado al principio y de pie al final', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner, car = world.vehicle.car;
  const local = new THREE.Vector3().copy(officer.position);
  car.group.worldToLocal(local);
  assert.ok(Math.abs(local.z) < car.width / 2, 'arranca adentro, en su silla');
  assert.equal(officer.poseParams.stance, 'banca');
  assert.equal(world.unit.fit.doors[1].wanted, true, 'abre su puerta');
  let previous = officer.position.clone(), largest = 0, stoodUp = false;
  runUntil(world, () => {
    largest = Math.max(largest, officer.position.distanceTo(previous));
    previous.copy(officer.position);
    if (officer.poseParams.stance === 'banca' && officer.poseParams.stanceWeight < .5) stoodUp = true;
    return officer.state === 'persecucion';
  }, 4);
  assert.ok(largest < .12, `el mayor salto por cuadro fue ${largest.toFixed(3)} m`);
  assert.ok(stoodUp, 'se para de a poco');
  const outside = car.group.worldToLocal(officer.position.clone());
  assert.ok(Math.abs(outside.z) > car.width / 2 + .3, 'terminó afuera, junto a la puerta');
  assert.equal(officer.poseParams.stanceWeight, 0, 'la postura de sentado se va sin pesar');
  assert.equal(world.unit.fit.doorAmount(1), 1, 'la puerta queda abierta mientras persigue');
});

test('quien corre derecho se le va: pique y cansancio, lo busca, desiste, se sube y la patrulla sigue su ronda', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  const officer = world.unit.partner;
  // El jugador sale corriendo a 6 m/s por la calle en cuanto la patrulla frena.
  const escape = new THREE.Vector3(1, 0, 0);
  runUntil(world, () => world.unit.phase === 'frenando');
  runUntil(world, () => officer.state === 'persecucion', 10, () => world.player.position.addScaledVector(escape, 6 * DT));
  let tired = false, searched = false, escaped = null, maxSprint = 0;
  const t = runUntil(world, () => {
    if (officer.sprintLeft <= 0) tired = true;
    if (officer.state === 'busqueda') searched = true;
    if (escaped === null && count('police-escaped')) escaped = officer.state;
    return world.vehicle.state === 'patrol';
  }, 90, () => {
    world.player.position.addScaledVector(escape, 6 * DT);
    if (officer.state === 'persecucion') maxSprint = Math.max(maxSprint, officer.walkSpeed);
  });
  assert.ok(Number.isFinite(t), 'la patrulla volvió a su ronda');
  assert.ok(tired, 'el pique se le acabó');
  assert.ok(maxSprint > 6 && maxSprint <= POLICE_FOOT.sprintSpeed + .01, `corrió a ${maxSprint.toFixed(2)} m/s`);
  // A 6 m/s el agente cansado no le acorta distancia: o lo pierde de vista y lo busca, o desiste por eso (`sin-avance`).
  assert.ok(searched || world.unit.endReason === 'sin-avance', `lo buscó o desistió por no alcanzarlo (${world.unit.endReason})`);
  // Sale al desistir (un momento después, para que el HUD no lo bote), no cuando ya se subieron.
  assert.ok(['regreso', 'subiendo'].includes(escaped), `el aviso de escape salió con el agente en ${escaped}`);
  assert.equal(count('police-escaped'), 1);
  assert.equal(count('police-arrest'), 0);
  assert.equal(officer.state, 'dentro');
  assert.equal(world.unit.fit.doorAmount(1), 0);
  assert.equal(world.unit.fit.passengerInside, true);
  assert.equal(world.vehicle.hold, false);
  assert.equal(world.vehicle.stoppedFor ?? 0, 0);
  assert.equal(world.traffic.inPursuit, false);
});

test('el aviso de escape sale con la persecución ya apagada al menos un repintado del HUD, y no si vuelven por él', () => {
  // La placa del HUD se repinta a 10 Hz y los avisos de información que llegan en plena persecución se botan.
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  world.unit._desist();
  let off = 0, offWhenEscaped = null;
  runUntil(world, () => count('police-escaped') > 0, 3, () => {
    off = world.traffic.inPursuit ? 0 : off + DT;
  });
  offWhenEscaped = off;
  assert.equal(count('police-escaped'), 1);
  assert.ok(offWhenEscaped >= .1, `salió con la persecución apagada hace ${offWhenEscaped.toFixed(2)} s`);
  // Desisten y le pegan a uno antes del aviso: no hubo escape.
  const again = setup();
  events.length = 0;
  again.traffic._startChase(again.vehicle);
  exitOf(again);
  runUntil(again, () => again.unit.partner.state === 'persecucion');
  again.unit._desist();
  step(again);
  assert.equal(again.unit.partner.takeHit({ damage: 10, attackId: 7 }), 0, 'el golpe cuenta');
  for (let t = 0; t < 1; t += DT) step(again);
  assert.equal(count('police-escaped'), 0);
});

test('a quien camina lo alcanza', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const t = runUntil(world, () => count('police-arrest') > 0, 30, () => world.player.position.x += 3 * DT);
  assert.ok(Number.isFinite(t));
});

test('sin verlo detrás de una pared: va al último punto, mira, vuelve caminando y se sube', () => {
  const collisions = new CollisionSystem();
  const world = setup({ collisions });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  // El jugador se mete detrás de un muro de 10 m, a 25 m del agente.
  const wall = new THREE.Mesh();
  wall.position.set(officer.position.x + 20, 0, officer.position.z);
  collisions.add(wall, new THREE.Vector3(1, 3, 10));
  const seenAt = world.player.position.copy(wall.position).add(new THREE.Vector3(-2, 0, 6)).clone();
  step(world);
  world.player.position.set(wall.position.x + 4, 0, wall.position.z);
  const phases = [];
  const t = runUntil(world, () => {
    if (phases.at(-1) !== officer.state) phases.push(officer.state);
    return world.vehicle.state === 'patrol';
  }, 80);
  assert.ok(Number.isFinite(t), 'volvió a la ronda');
  assert.deepEqual(phases.filter((state, i) => phases.indexOf(state) === i), ['persecucion', 'busqueda', 'regreso', 'subiendo', 'dentro']);
  assert.ok(officer.searchPoint.distanceTo(seenAt) < .01, 'buscó donde lo vio por última vez');
  assert.equal(count('police-escaped'), 1);
});

test('fichado 2: el conductor también se baja con el jugador a menos de 6 m; con fichado 1 no', () => {
  for (const level of [1, 2]) {
    const world = setup({ level });
    world.traffic._startChase(world.vehicle);
    exitOf(world);
    // El jugador se arrima a la patrulla parada.
    const car = world.vehicle.car;
    world.player.position.copy(car.position).add(new THREE.Vector3(0, 0, -5));
    for (let t = 0; t < 1; t += DT) step(world);
    assert.equal(world.unit.driver.state !== 'dentro', level >= 2, `fichado ${level}`);
    if (level >= 2) {
      assert.equal(world.unit.driver.doorSide, -1, 'por su puerta');
      assert.equal(car.driverInside, false, 'la figura sentada se va con él');
    }
  }
});

test('fichado 2: si el carro no llega hasta el jugador unos segundos, el conductor se baja', () => {
  const world = setup({ level: 2 });
  world.traffic._startChase(world.vehicle);
  runUntil(world, () => world.unit.phase === 'frenando');
  world.player.position.x += 6; // lejos del carro: el conductor no tiene por qué bajarse todavía
  exitOf(world);
  assert.equal(world.unit.driver.state, 'dentro');
  world.system._carCanReach = () => false;
  const t = runUntil(world, () => world.unit.driver.state !== 'dentro', 6);
  assert.ok(t >= POLICE_FOOT.driverUnreachable - 1 && t < 6, `se bajó a los ${t.toFixed(1)} s`);
});

test('fichado 1: el conductor vuelve al volante a cerrarle el paso y frena si el compañero deja de correr', () => {
  const world = setup({ level: 1, player: [60, 0] });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  const t = runUntil(world, () => world.unit.phase === 'cierre', 10, () => world.player.position.x += 6 * DT);
  assert.ok(Number.isFinite(t), 'arrancó a cerrarle el paso');
  assert.equal(world.unit.fit.doorAmount(1), 0, 'cerró la puerta del compañero antes de arrancar');
  assert.equal(world.vehicle.car.pursuit, true);
  runUntil(world, () => world.vehicle.speed > 1, 5, () => world.player.position.x += 6 * DT);
  officer.startReturn();
  const stop = runUntil(world, () => world.unit.phase === 'parada', 8);
  assert.ok(Number.isFinite(stop), 'paró a esperarlo');
});

test('cerrándole el paso no lo escolta: si lo alcanza con el compañero lejos, frena y se baja también el conductor', () => {
  const world = setup({ level: 1, player: [60, 0] });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner, driver = world.unit.driver;
  runUntil(world, () => officer.state === 'persecucion');
  runUntil(world, () => world.unit.phase === 'cierre', 10, () => world.player.position.x += 6 * DT);
  // El compañero se quedó atrás (sin pique, lejos) y el carro alcanza al jugador, que trota.
  officer.position.x -= 40;
  officer.sprintLeft = 0;
  const t = runUntil(world, () => driver.state !== 'dentro', 30, () => world.player.position.x += 4 * DT);
  assert.ok(Number.isFinite(t), 'el conductor se bajó a cerrarle el paso de verdad');
  assert.ok(Math.abs(world.vehicle.speed) < .05, 'con el carro quieto');
  assert.equal(world.unit.phase, 'parada');
});

test('cerrándole el paso sin camino para el carro: no se queda varado en la vía, se orilla y espera', () => {
  const world = setup({ level: 1, player: [60, 0] });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  runUntil(world, () => world.unit.phase === 'cierre', 10, () => world.player.position.x += 6 * DT);
  world.system._carCanReach = () => false;
  const t = runUntil(world, () => world.unit.phase === 'parada', 10, () => world.player.position.x += 6 * DT);
  assert.ok(t < POLICE_FOOT.driverUnreachable + 4, `paró a los ${t.toFixed(1)} s`);
  assert.equal(world.unit.driver.state, 'dentro', 'con fichado 1 el conductor espera en el carro');
});

test('fichado 3: llega otra patrulla de refuerzo y los agentes vienen con la pistola, señalando', () => {
  const world = setup({ level: 3, police: 2 });
  const [first, second] = world.traffic.vehicles;
  world.traffic._startChase(first);
  step(world);
  assert.equal(second.state, 'chase', 'la otra patrulla viene');
  assert.equal(second.crew.reinforcing, true);
  assert.ok(first.crew.officers.every(officer => officer.armed));
  exitOf(world);
  const officer = first.crew.partner;
  let pointed = false;
  runUntil(world, () => (pointed = officer.poseParams.point === 1) || count('police-arrest') > 0, 20);
  assert.ok(pointed, 'apunta al acercarse');
  assert.ok(second.crew.officers.every(officer => officer.armed));
});

test('fichado 3: el refuerzo no sale de una patrulla que vuelve a su carril ni de una retenida; viene otra', () => {
  for (const mark of ['volviendo', 'retenida']) {
    // Las dos de ronda quedan a la misma distancia del jugador: sin la regla vendría la primera de la lista.
    const world = setup({ level: 3, police: 3 });
    const [first, held, free] = world.traffic.vehicles;
    if (mark === 'volviendo') held.rejoinTarget = held.car.position.clone().add(new THREE.Vector3(30, 0, 0));
    else held.hold = true;
    world.traffic._startChase(first);
    step(world);
    assert.equal(held.state, 'patrol', `${mark}: sigue en lo suyo`);
    assert.equal(held.crew.reinforcing, false, mark);
    assert.equal(free.state, 'chase', `${mark}: el refuerzo es la otra`);
    assert.equal(free.crew.reinforcing, true, mark);
  }
});

test('una persecución que no movió a la patrulla trabada no le reinicia el tope para volver a su carril', () => {
  // Encerrada en una caja, de regreso a su carril y a 30 m del jugador: entra a la fuerza a los 30 s de no avanzar.
  const trapped = () => {
    const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(-100, 100, 3, 60, 3.2)], { carsPerRoute: 0, policeCount: 1, random: () => .5 });
    const [patrol] = traffic.vehicles;
    const wall = new THREE.Box3(new THREE.Vector3(-50, -1, -20), new THREE.Vector3(-10, 5, 1));
    traffic.setEnvironment({ collisions: { colliders: [{ box: wall }] }, getGroundHeight: () => 0 });
    traffic._startChase(patrol);
    patrol.car.position.set(-30, 0, -2);
    traffic.endPursuit();
    return { traffic, patrol };
  };
  const player = new THREE.Vector3(-30, 0, -32);
  const untilBack = (traffic, patrol) => {
    let seconds = 0;
    while (patrol.rejoinTarget && seconds < 40) { traffic.update(.1, { player }); seconds += .1; }
    return seconds;
  };
  for (const moved of [false, true]) {
    const { traffic, patrol } = trapped();
    for (let frame = 0; frame < 200; frame++) traffic.update(.1, { player });
    assert.ok(patrol.rejoinTarget, 'a los 20 s sigue trabada');
    // Persigue 3 s (o la mueven unos metros, todavía adentro de la caja) y la persecución termina.
    traffic._startChase(patrol);
    for (let frame = 0; frame < 30; frame++) traffic.update(.1, { player });
    if (moved) patrol.car.position.x += 5;
    traffic.endPursuit();
    assert.ok(patrol.rejoinTarget, 'vuelve a su carril');
    const seconds = untilBack(traffic, patrol);
    assert.equal(patrol.rejoinTarget, null, 'entró a su carril');
    if (moved) assert.ok(seconds > 25, `se movió: el tope empieza de nuevo (${seconds.toFixed(1)} s)`);
    else assert.ok(seconds < 12, `sin moverse cuenta lo que ya llevaba: ${seconds.toFixed(1)} s más`);
    traffic.dispose();
  }
});

test('dos agentes no corren en fila: el conductor abre por un flanco', () => {
  const world = setup({ level: 2 });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  world.unit._forceDriver = true;
  runUntil(world, () => world.unit.driver.state === 'persecucion' && world.unit.partner.state === 'persecucion', 5);
  let spread = 0;
  runUntil(world, () => false, 3, () => {
    world.player.position.x += 5 * DT;
    const a = world.unit.partner.position, b = world.unit.driver.position;
    spread = Math.max(spread, Math.abs(a.z - b.z));
  });
  assert.ok(spread > 1.5, `separación lateral ${spread.toFixed(2)} m`);
});

test('golpear a un agente: aguanta, reacciona y su compañero se baja', () => {
  const world = setup({ level: 1 });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  const attacker = { position: officer.position.clone().add(new THREE.Vector3(.8, 0, 0)) };
  assert.equal(officer.takeHit({ damage: 30, attacker, attackId: 1 }), 0, 'acepta el golpe, sin plata');
  assert.equal(officer.takeHit({ damage: 30, attacker, attackId: 1 }), false, 'el mismo golpe no cuenta dos veces');
  assert.ok(officer.health >= 40, 'no queda tendido');
  assert.equal(officer.isKnockedOut, false);
  for (let t = 0; t < .2; t += DT) step(world);
  assert.equal(world.unit.driver.state, 'bajando', 'el compañero responde');
});

test('un golpe al que ya volvía lo devuelve a la persecución', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  world.unit._desist();
  assert.equal(officer.state, 'regreso');
  assert.equal(world.traffic.inPursuit, false);
  officer.takeHit({ damage: 10, attacker: { position: officer.position.clone().add(new THREE.Vector3(.5, 0, 0)) } });
  assert.equal(officer.state, 'persecucion');
  assert.equal(world.unit.mode, 'persigue');
  assert.equal(world.traffic.inPursuit, true);
});

test('la distancia de la placa es la del agente más cercano, no la del carro parqueado', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  runUntil(world, () => world.unit.partner.state === 'persecucion');
  world.player.position.x += 8;
  for (let t = 0; t < .5; t += DT) step(world);
  const info = world.traffic.pursuitInfo;
  const officer = world.unit.partner;
  assert.ok(Math.abs(info.distance - officer.position.distanceTo(world.player.position)) < .4);
  assert.ok(info.distance < world.vehicle.car.position.distanceTo(world.player.position));
});

test('se orilla fuera del carril si puede, lejos del jugador', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  runUntil(world, () => world.unit.phase === 'parada');
  const car = world.vehicle.car.position;
  // El carril del tramo de arriba va por z = 0.
  assert.ok(Math.abs(car.z) >= 2, `quedó a ${Math.abs(car.z).toFixed(2)} m del eje del carril`);
  assert.equal(world.system._laneBlock(car.x, car.z, 1, 0, world.vehicle.car), 0);
});

test('parada tapando el carril con el conductor adentro: cierra la puerta del compañero y se corre a un sitio libre', () => {
  const world = setup({ level: 1 });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner, vehicle = world.vehicle, car = vehicle.car, fit = world.unit.fit;
  runUntil(world, () => officer.state === 'persecucion');
  // No alcanzó a orillarse: quedó sobre el eje del carril (z = 0), mirando por la calle.
  car.position.z = 0;
  car.group.rotation.y = 0;
  const blocking = () => world.system._laneBlock(car.position.x, car.position.z, Math.cos(car.group.rotation.y), -Math.sin(car.group.rotation.y), car) > 0;
  assert.equal(blocking(), true);
  // El compañero va lejos del carro, buscándolo, y no hay a quién cerrarle el paso.
  world.player.position.set(car.position.x + 30, 0, 40);
  officer.position.set(car.position.x + 20, 0, 6);
  officer.startSearch(new THREE.Vector3(car.position.x + 24, 0, 8));
  let movedWithDoorOpen = false;
  const t = runUntil(world, () => world.unit.phase === 'parada' && !blocking(), 12, () => {
    if (Math.abs(vehicle.speed) > .05 && fit.doorAmount(officer.doorSide) > 0) movedWithDoorOpen = true;
  });
  assert.ok(Number.isFinite(t), 'se corrió fuera del carril');
  assert.equal(movedWithDoorOpen, false, 'no arranca con la puerta abierta');
  assert.equal(world.unit.driver.state, 'dentro');
  assert.ok(Math.abs(car.position.z) >= 2, `quedó a ${Math.abs(car.position.z).toFixed(2)} m del eje del carril`);
});

test('parqueada con la gente afuera: estroboscópicas y direccionales prendidas', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const car = world.vehicle.car;
  const before = car._visualTime;
  for (let t = 0; t < 1; t += DT) step(world);
  assert.ok(car._visualTime > before + .9, 'las luces siguen andando');
  assert.equal(car._turnSignal, 'hazard');
});

test('sin el carro, el agente que quedó afuera se va cuando nadie lo ve', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  world.traffic.vehicles.splice(world.traffic.vehicles.indexOf(world.vehicle), 1);
  // Con cámara mirándolo, se queda.
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  camera.position.copy(officer.position).add(new THREE.Vector3(0, 2, 8));
  camera.lookAt(officer.position);
  step(world, DT, { camera });
  assert.equal(officer.state, 'persecucion');
  camera.lookAt(officer.position.clone().add(new THREE.Vector3(0, 0, 40)));
  step(world, DT, { camera });
  assert.equal(officer.state, 'dentro');
  assert.equal(world.people.includes(officer), false);
  assert.equal(world.system.units.length, 0, 'la tripulación sin carro se suelta');
});

test('de vuelta sin camino: pasado el plazo se sube de una, pero solo donde nadie lo vea', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  world.unit._desist();
  officer.returnTimer = POLICE_FOOT.returnTimeout + 1;
  officer.position.x += 30; // lejos, para que no alcance a llegar en un cuadro
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  camera.position.copy(officer.position).add(new THREE.Vector3(0, 2, 8));
  camera.lookAt(officer.position);
  step(world, DT, { camera });
  assert.equal(officer.state, 'regreso', 'a la vista sigue caminando');
  step(world, DT);
  assert.equal(officer.state, 'dentro', 'sin nadie mirando, se sube');
  for (let t = 0; t < 1; t += DT) step(world);
  assert.equal(world.vehicle.state, 'patrol');
});

test('si cambió de puerta antes de subirse, al quedar adentro se cierran las dos y la patrulla sigue', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner, fit = world.unit.fit;
  runUntil(world, () => officer.state === 'persecucion');
  world.unit._desist();
  // Llega cerca de su puerta (el carro se la abre) y después la ruta lo manda por la otra.
  const first = officer.doorSide, door = fit.doorPoint(first, new THREE.Vector3());
  officer.position.set(door.x + 2, door.y, door.z);
  step(world);
  for (let t = 0; t < .5; t += DT) world.unit.fit.update(DT);
  assert.ok(fit.doorAmount(first) > 0, 'la abrió al acercarse');
  officer.doorSide = -first;
  officer._doorCheck = 3;
  officer.returnTimer = POLICE_FOOT.returnTimeout + 1;
  officer.position.x += 70;
  step(world);
  assert.equal(officer.state, 'dentro');
  for (let t = 0; t < 1; t += DT) step(world);
  assert.deepEqual([fit.doorAmount(-1), fit.doorAmount(1)], [0, 0], 'ninguna puerta queda abierta');
  assert.equal(world.vehicle.state, 'patrol', 'la patrulla vuelve a su ronda');
  assert.equal(world.vehicle.hold, false);
});

test('con la patrulla orillada en diagonal llega a su puerta y se sube caminando, sin atravesar la carrocería', () => {
  const collisions = new CollisionSystem();
  const world = setup({ collisions });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner, car = world.vehicle.car;
  runUntil(world, () => officer.state === 'persecucion');
  // La caja de colisión de los carros va alineada a los ejes: en diagonal, crece y tapa la puerta.
  car.group.rotation.y = .6;
  collisions.setVehicles([car]);
  const door = world.unit.fit.doorPoint(officer.doorSide, new THREE.Vector3());
  const out = door.clone().sub(car.position).setY(0).normalize();
  // Desiste ya puesto a 3 m de su puerta: lo que lleva caminado de vuelta se mide desde ahí, no desde donde corría.
  officer.position.copy(door).addScaledVector(out, 3);
  world.unit._desist();
  let inside = 0;
  const yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const t = runUntil(world, () => officer.state === 'subiendo', 10, () => {
    collisions.setVehicles([car]);
    const dx = officer.position.x - car.position.x, dz = officer.position.z - car.position.z;
    const along = dx * fx + dz * fz, across = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(along) < car.length / 2 && Math.abs(across) < car.width / 2) inside++;
  });
  assert.ok(t < 6, `se subió por la puerta a los ${t.toFixed(1)} s`);
  assert.equal(inside, 0, 'nunca pisa dentro de la carrocería');
});

test('si la ruta por andenes pasa por un carro detenido, lo rodea en vez de empujarlo hasta que se acaba el plazo', () => {
  const collisions = new CollisionSystem();
  const world = setup({ collisions });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  world.unit._desist();
  const door = world.unit.fit.doorPoint(officer.doorSide, new THREE.Vector3());
  const out = new THREE.Vector3(0, 0, officer.doorSide);
  // Un carro quieto atravesado entre el agente y su puerta; la red de andenes no sabe de carros.
  const parked = new Car(world.scene, door.clone().addScaledVector(out, 5), Math.PI / 2);
  officer.position.copy(door).addScaledVector(out, 10);
  officer.returnTimer = 0;
  officer.routes = { routeTo: () => [parked.position.clone(), door.clone()] };
  const t = runUntil(world, () => officer.state === 'subiendo', 20, () => collisions.setVehicles([world.vehicle.car, parked]));
  assert.ok(t < 12, `llegó a la puerta a los ${t.toFixed(1)} s`);
});

test('jugador en un carro: sigue en carro mientras se mueve; quieto, se bajan los dos y van a su puerta', () => {
  // A la vista de la patrulla (25 m) y algo más lento que ella: la persecución en carro no se pierde por distancia.
  const playerCar = { position: new THREE.Vector3(45, 0, 0), speed: 6,
    door(side, target) { return target.set(this.position.x, 0, this.position.z - 1.4); } };
  const world = setup({ level: 1, playerVehicle: () => playerCar });
  world.player.position.copy(playerCar.position);
  world.traffic._startChase(world.vehicle);
  for (let t = 0; t < 6; t += DT) {
    playerCar.position.x += 6 * DT;
    world.player.position.copy(playerCar.position);
    step(world);
  }
  assert.equal(world.unit.partner.state, 'dentro', 'nadie se baja detrás de un carro andando');
  playerCar.speed = 0;
  const t = runUntil(world, () => world.unit.partner.out && world.unit.driver.out, 12);
  assert.ok(Number.isFinite(t), 'se bajan los dos');
  const arrest = runUntil(world, () => count('police-arrest') > 0, 20);
  assert.ok(Number.isFinite(arrest), 'lo sacan del carro');
});

test('una patrulla sin tripulación se porta como siempre', () => {
  const world = setup();
  world.system.dispose();
  assert.equal(world.vehicle.crew, null);
  world.traffic._startChase(world.vehicle);
  const t = runUntil(world, () => count('police-arrest') > 0, 20);
  assert.ok(Number.isFinite(t), 'sin tripulación, el carro captura como siempre');
});

// ---------- casos de borde: el arresto, la vista compartida, desistir, las puertas y los carriles ----------

/** El agente más cercano al jugador en el momento del arresto (para saber si fue un agente o el carro). */
function arrestWitness(world) {
  const log = [];
  window.addEventListener('police-arrest', () => {
    const officers = world.system.officers.filter(officer => officer.onFoot);
    log.push({
      officer: Math.min(Infinity, ...officers.map(officer => officer.position.distanceTo(world.player.position))),
      car: Math.hypot(world.player.position.x - world.vehicle.car.position.x, world.player.position.z - world.vehicle.car.position.z)
    });
  });
  return log;
}

test('cerrándole el paso, el carro no arresta aunque el jugador se le meta contra la carrocería: solo un agente a 1,2 m', () => {
  const world = setup({ level: 1, player: [60, 0] });
  const arrests = arrestWitness(world);
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const unit = world.unit, car = world.vehicle.car;
  runUntil(world, () => unit.partner.state === 'persecucion');
  runUntil(world, () => unit.phase === 'cierre', 15, () => world.player.position.x += 6 * DT);
  assert.equal(unit.phase, 'cierre');
  // El compañero quedó lejos: si alguien lo agarra en los próximos segundos tiene que ser el conductor, ya a pie.
  unit.partner.position.x -= 40;
  unit.partner.sprintLeft = 0;
  world.player.position.z = 1.5;
  runUntil(world, () => arrests.length > 0, 8, () => {
    world.player.position.x += Math.sign(car.position.x - world.player.position.x) * 6 * DT;
  });
  for (const arrest of arrests) assert.ok(arrest.officer <= POLICE_FOOT.catchRange + .05, `arresto con el agente a ${arrest.officer.toFixed(2)} m y el carro a ${arrest.car.toFixed(2)} m`);
});

test('persiguiendo en carro tampoco arresta el carro, aunque el carro del jugador se le arrime', () => {
  // El carro del jugador va despacio (no está quieto) y pasa pegado a la patrulla, a menos de los 3 m de `POLICE_CATCH_RANGE`.
  const playerCar = { position: new THREE.Vector3(40, 0, 0), speed: 1,
    door(side, target) { return target.set(this.position.x, 0, this.position.z - 1.4); } };
  const world = setup({ level: 1, playerVehicle: () => playerCar });
  world.player.position.copy(playerCar.position);
  const arrests = arrestWitness(world);
  world.traffic._startChase(world.vehicle);
  let closest = Infinity;
  runUntil(world, () => false, 6, () => {
    playerCar.position.x = Math.max(world.vehicle.car.position.x + 2.2, playerCar.position.x - 4 * DT);
    world.player.position.copy(playerCar.position);
    closest = Math.min(closest, world.vehicle.car.position.distanceTo(playerCar.position));
  });
  assert.ok(closest < 3, `se le arrimó a ${closest.toFixed(2)} m`);
  for (const arrest of arrests) assert.ok(arrest.officer <= POLICE_FOOT.catchRange + .05, `arresto con el carro a ${arrest.car.toFixed(2)} m`);
});

test('con los dos afuera el carro no ve: solo cuentan los agentes', () => {
  const world = setup({ level: 2 });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  world.unit._forceDriver = true;
  runUntil(world, () => world.unit.driver.state === 'persecucion', 5);
  for (const officer of world.unit.officers) officer.canSee = () => false;
  // De frente al carro, a la vista y cerca.
  world.player.position.copy(world.vehicle.car.position).add(new THREE.Vector3(8, 0, 0));
  step(world);
  assert.equal(world.unit.carSees, false);
  assert.equal(world.unit.seen, false);
});

test('dos agentes en el mismo punto se separan', () => {
  const world = setup({ level: 2 });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  world.unit._forceDriver = true;
  runUntil(world, () => world.unit.driver.state === 'persecucion' && world.unit.partner.state === 'persecucion', 5);
  // Lejos del carro, para que su carrocería no se meta en la cuenta.
  world.unit.partner.position.copy(world.vehicle.car.position).add(new THREE.Vector3(0, 0, 8));
  world.unit.driver.position.copy(world.unit.partner.position);
  world.system._separate();
  assert.ok(world.unit.driver.position.distanceTo(world.unit.partner.position) >= .69);
});

test('el jugador a más de 55 m de todos y sin verlo: desisten de una, sin buscarlo', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  runUntil(world, () => world.unit.partner.state === 'persecucion');
  world.player.position.x += 90;
  const t = runUntil(world, () => world.unit.mode === 'desiste', 2);
  assert.ok(t < 1, `desistió a los ${t.toFixed(2)} s`);
  assert.equal(world.unit.endReason, 'lejos');
});

test('un robo delante del agente que vuelve al carro: es testigo y la patrulla vuelve a perseguir con él afuera', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  // Lo perdieron lejos del carro y el agente viene caminando de vuelta.
  officer.position.x += 20;
  world.player.position.set(officer.position.x + 60, 0, 30);
  world.unit._desist();
  step(world);
  assert.equal(officer.state, 'regreso');
  assert.equal(world.traffic.inPursuit, false);
  events.length = 0;
  world.player.position.copy(officer.position).add(new THREE.Vector3(5, 0, 0));
  assert.equal(world.traffic.witnessesTheft(world.player.position), true, 'cuenta como testigo');
  assert.equal(world.traffic.alertForTheft(world.player.position), true, 'arranca la persecución');
  assert.equal(world.unit.mode, 'persigue');
  assert.equal(officer.state, 'persecucion', 'sigue desde donde está, ya afuera');
  assert.equal(world.traffic.inPursuit, true);
  for (let t = 0; t < 1; t += DT) step(world);
  assert.equal(count('police-escaped'), 0, 'no sale el aviso de escape que estaba pendiente');
  const t = runUntil(world, () => count('police-arrest') > 0, 10);
  assert.ok(Number.isFinite(t), 'lo agarra');
});

test('un robo que el agente que vuelve no alcanza a ver (detrás de una pared) no lo pone de testigo', () => {
  const collisions = new CollisionSystem();
  // El carro también mira contra las paredes (el tráfico usa las colisiones del entorno).
  const world = setup({ collisions, environment: { collisions, getGroundHeight: () => 0 } });
  world.traffic._startChase(world.vehicle);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  officer.position.x += 20;
  world.player.position.set(officer.position.x + 60, 0, 30);
  world.unit._desist();
  step(world);
  assert.equal(officer.state, 'regreso');
  const wall = new THREE.Mesh();
  wall.position.copy(officer.position).add(new THREE.Vector3(3, 0, 0));
  collisions.add(wall, new THREE.Vector3(1, 4, 12));
  world.player.position.copy(officer.position).add(new THREE.Vector3(6, 0, 0));
  assert.equal(world.traffic.witnessesTheft(world.player.position), false);
  assert.equal(world.traffic.alertForTheft(world.player.position), false);
  assert.equal(world.unit.mode, 'desiste');
});

test('una sola vista para toda la persecución: si la primera patrulla lo ve, el refuerzo no lo da por perdido', () => {
  const collisions = new CollisionSystem();
  const world = setup({ level: 3, police: 2, second: [0, 100], collisions });
  // Un muro tapa al refuerzo; la primera patrulla sí lo ve.
  const wall = new THREE.Mesh();
  wall.position.set(40, 0, 25);
  collisions.add(wall, new THREE.Vector3(16, 6, 1));
  const [first, second] = world.traffic.vehicles;
  world.traffic._startChase(first);
  let reinforcementBlind = 0, longest = 0;
  runUntil(world, () => count('police-arrest') > 0, 8, () => {
    if (second.state !== 'chase') return;
    if (!second.crew.seen) reinforcementBlind += DT;
    assert.equal(second.crew.anyoneSees, first.crew.seen || second.crew.seen);
    longest = Math.max(longest, second.chaseTime);
  });
  // El reloj de los 40 s del refuerzo solo cuenta lo que nadie lo ve (aquí, ratos de menos de un segundo).
  assert.ok(longest < 1, `el reloj del refuerzo llegó a ${longest.toFixed(2)} s`);
  assert.ok(reinforcementBlind > 5, `el refuerzo no lo vio ${reinforcementBlind.toFixed(1)} s`);
  assert.equal(count('police-escaped'), 0);
});

/**
 * PR #84 como quedaría integrado con esta persecución: abandona a los 6 s sin que nadie de la persecución
 * lo vea, y su aviso sale donde sale `police-escaped`, una sola vez, cuando ya nadie persigue.
 */
function withPr84(traffic) {
  const plan = traffic._planChase.bind(traffic), apply = traffic._applyChase.bind(traffic);
  traffic._planChase = (vehicle, stepTime, player, returning = false) => {
    plan(vehicle, stepTime, player, returning);
    if (returning || !player || vehicle._chaseCaught || vehicle._chaseGiveUp) return;
    const sees = vehicle.crew ? vehicle.crew.anyoneSees : traffic._canWitness(vehicle, player);
    vehicle._lostSightTime = sees ? 0 : (vehicle._lostSightTime || 0) + stepTime;
    if (vehicle._lostSightTime >= 6) { vehicle._chaseGiveUp = true; vehicle.nextSpeed = 0; }
  };
  traffic._applyChase = (vehicle, stepTime) => {
    const lost = vehicle._chaseGiveUp && vehicle._lostSightTime >= 6;
    const result = apply(vehicle, stepTime);
    if (lost && !traffic.inPursuit && !traffic._arrestDispatched) {
      window.dispatchEvent(Object.assign(new Event('toast'), { detail: { text: '¡Me les perdí de vista a los tombos! La patrulla desistió de la persecución.', type: 'rare' } }));
    }
    return result;
  };
}
const lostToasts = () => events.filter(event => event.type === 'toast' && /Me les perdí/.test(event.detail.text)).length;

test('con #84 y refuerzo: ningún aviso de desistir mientras alguien de la persecución lo ve', () => {
  const collisions = new CollisionSystem();
  const world = setup({ level: 3, police: 2, second: [0, 100], collisions });
  withPr84(world.traffic);
  const wall = new THREE.Mesh();
  wall.position.set(40, 0, 25);
  collisions.add(wall, new THREE.Vector3(16, 6, 1));
  world.traffic._startChase(world.traffic.vehicles[0]);
  const t = runUntil(world, () => count('police-arrest') > 0, 30);
  assert.ok(Number.isFinite(t), 'lo arrestan');
  assert.equal(lostToasts(), 0);
});

test('con #84 y refuerzo, si nadie lo ve en 6 s abandonan las dos y el aviso sale una sola vez', () => {
  const collisions = new CollisionSystem();
  // A 54 m de la primera (más lejos, el tráfico la daría por perdida por distancia) y a 116 m del refuerzo.
  const world = setup({ level: 3, police: 2, player: [74, 0], second: [0, 90], collisions });
  withPr84(world.traffic);
  // Escondido de las dos desde el principio, entre muros.
  for (const [x, z, w, d] of [[70, 0, 1, 30], [75, -12, 30, 1], [75, 12, 30, 1]]) {
    const wall = new THREE.Mesh();
    wall.position.set(x, 0, z);
    collisions.add(wall, new THREE.Vector3(w, 6, d));
  }
  world.traffic._startChase(world.traffic.vehicles[0]);
  const t = runUntil(world, () => world.traffic.vehicles.every(vehicle => vehicle.state === 'patrol'), 20);
  assert.ok(t > 5.5 && t < 7, `abandonaron a los ${t.toFixed(2)} s`);
  for (let i = 0; i < 30; i++) step(world);
  assert.equal(lostToasts(), 1);
  assert.equal(count('police-escaped'), 1);
});

test('el aviso de escape sale una sola vez por persecución, aunque desistan las dos patrullas', () => {
  const world = setup({ level: 3, police: 2, second: [0, 60] });
  const [first, second] = world.traffic.vehicles;
  world.traffic._startChase(first);
  runUntil(world, () => first.crew.partner.state === 'persecucion' && second.state === 'chase', 10);
  first.crew._desist();
  for (let t = 0; t < 1; t += DT) step(world);
  assert.equal(count('police-escaped'), 0, 'el refuerzo sigue persiguiendo');
  second.crew._desist();
  for (let t = 0; t < 2; t += DT) step(world);
  assert.equal(count('police-escaped'), 1);
  // Y si las dos desisten en el mismo cuadro, también una.
  const again = setup({ level: 3, police: 2, second: [0, 60] });
  events.length = 0;
  again.traffic._startChase(again.traffic.vehicles[0]);
  runUntil(again, () => again.traffic.vehicles.every(vehicle => vehicle.state === 'chase' && vehicle.crew.mode === 'persigue'), 5);
  for (const vehicle of again.traffic.vehicles) vehicle.crew._desist();
  for (let t = 0; t < 2; t += DT) step(again);
  assert.equal(count('police-escaped'), 1);
});

test('si una patrulla desiste y la otra lo da por perdido en carro al momento, «Los despisté» sale una sola vez', () => {
  const world = setup({ police: 2, second: [0, 60] });
  const [first, second] = world.traffic.vehicles;
  world.traffic._startChase(first);
  runUntil(world, () => first.crew.partner.state === 'persecucion', 10);
  world.traffic._startChase(second);
  step(world);
  assert.equal(second.crew.mode, 'persigue');
  first.crew._desist();
  // La segunda se devuelve en carro antes de que salga el aviso de la primera (sale un momento después).
  const plan = world.traffic._planChase.bind(world.traffic);
  world.traffic._planChase = (vehicle, ...rest) => {
    const result = plan(vehicle, ...rest);
    if (vehicle === second) vehicle._chaseGiveUp = true;
    return result;
  };
  step(world);
  assert.equal(second.state, 'patrol', 'se devolvió en carro');
  for (let t = 0; t < 2; t += DT) step(world);
  assert.equal(count('police-escaped'), 1);
});

test('quien corre derecho a 5,5 m/s: el agente se agota, no le acorta distancia y desisten, diciendo por qué', () => {
  for (const level of [1, 2, 3]) {
    globalThis.window = new EventTarget();
    events = [];
    for (const type of ['police-arrest', 'police-escaped']) window.addEventListener(type, e => events.push({ type, detail: e.detail }));
    const world = setup({ level });
    world.traffic._startChase(world.vehicle);
    const escape = new THREE.Vector3(1, 0, 0);
    runUntil(world, () => world.unit.phase === 'frenando');
    const t = runUntil(world, () => count('police-escaped') > 0 || count('police-arrest') > 0, 120, () => {
      world.player.position.addScaledVector(escape, 5.5 * DT);
    });
    assert.ok(Number.isFinite(t) && t < 75, `fichado ${level}: terminó a los ${t.toFixed(1)} s`);
    assert.equal(count('police-arrest'), 0, `fichado ${level}`);
    assert.equal(world.unit.endReason, 'sin-avance', `fichado ${level}`);
    assert.equal(events.find(event => event.type === 'police-escaped').detail.reason, 'sin-avance');
    assert.ok(world.unit.officers.some(officer => officer.lastLine), 'alguno lo dice');
  }
});

test('después de 25 s corriendo el agente ya no da más: 4,6 m/s', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  officer.sprintLeft = 0;
  officer.runTime = POLICE_FOOT.exhaustAfter - 1;
  let before = 0, after = Infinity;
  runUntil(world, () => false, 2.5, () => {
    world.player.position.x = officer.position.x + 15;
    if (!officer.moving) return;
    if (officer.runTime < POLICE_FOOT.exhaustAfter - .1) before = Math.max(before, officer.walkSpeed);
    else if (officer.runTime > POLICE_FOOT.exhaustAfter + .1) after = Math.min(after, officer.walkSpeed);
  });
  assert.ok(Math.abs(before - 5.4) < .05, `cansado a ${before.toFixed(2)} m/s`);
  assert.ok(Math.abs(after - 4.6) < .05, `agotado a ${after.toFixed(2)} m/s`);
});

test('jugador nadando a la vista: esperan en la orilla gritándole, sin ir y venir, y a los 40 s desisten', () => {
  // Agua desde x = 70: el agente no entra, y a quien nada no lo puede agarrar.
  const getWaterInfo = x => x > 70 ? { surfaceY: .6 } : null;
  const world = setup({ district: { getWaterInfo }, environment: { collisions: null, getGroundHeight: () => 0, getWaterInfo } });
  world.traffic._startChase(world.vehicle);
  world.player.position.set(76, 0, 0);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion', 10);
  const from = runUntil(world, () => officer.position.x > 68.5, 15);
  assert.ok(Number.isFinite(from), 'llegó a la orilla');
  let walked = 0, shouts = 0, last = officer.position.clone();
  const t = runUntil(world, () => world.unit.mode !== 'persigue', 60, () => {
    walked += officer.position.distanceTo(last);
    last.copy(officer.position);
    if (officer.shoutTimer > 2.3) shouts++;
  });
  assert.ok(t > 34 && t < 42, `desistieron a los ${t.toFixed(1)} s de estar en la orilla (${world.unit.endReason}, desde ${from.toFixed(1)} s)`);
  assert.equal(world.unit.endReason, 'inalcanzable');
  assert.ok(walked < 2, `en la orilla caminó ${walked.toFixed(2)} m`);
  assert.ok(shouts > 3, 'le grita');
  assert.equal(count('police-arrest'), 0);
});

test('tope de 90 s: desisten, salvo que lo tengan a menos de 10 m', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  runUntil(world, () => world.unit.partner.state === 'persecucion');
  // Cerca, a 6 m y alejándose al paso del agente: no lo suelta.
  world.unit._clock = POLICE_FOOT.pursuitCap + 1;
  world.player.position.copy(world.unit.partner.position).add(new THREE.Vector3(6, 0, 0));
  step(world);
  assert.equal(world.unit.mode, 'persigue');
  world.player.position.copy(world.unit.partner.position).add(new THREE.Vector3(14, 0, 0));
  step(world);
  assert.equal(world.unit.mode, 'desiste');
  assert.equal(world.unit.endReason, 'tope');
});

test('a más de 40 m del jugador, el agente afuera sigue animándose', async () => {
  const world = setup();
  await Promise.all(world.system.officers.map(officer => officer.ready));
  world.traffic._startChase(world.vehicle);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  world.unit._desist();
  world.player.position.set(officer.position.x + 60, 0, 0);
  officer.position.x += 12;
  const from = officer.position.clone();
  animated = 0;
  // Coge aire y avisa por radio (2,2 s) y después camina.
  for (let i = 0; i < 150; i++) step(world);
  assert.ok(officer.position.distanceTo(from) > 1, 'camina');
  assert.ok(animated > 10, `se animó en ${animated} cuadros`);
});

test('no se orilla donde la puerta de alguno quede dando a donde no se camina', () => {
  // Del lado del jugador, pasado z = 2,6, no se camina (un muro, una baranda, el borde de un puente).
  const walkable = (x, z) => z < 2.6;
  const world = setup({ walkable });
  world.traffic._startChase(world.vehicle);
  runUntil(world, () => world.unit.phase === 'parada');
  const fit = world.unit.fit;
  for (const side of [-1, 1]) {
    const door = fit.doorPoint(side, new THREE.Vector3());
    assert.ok(walkable(door.x, door.z), `la puerta ${side} da a (${door.x.toFixed(1)}, ${door.z.toFixed(1)})`);
  }
  const car = world.vehicle.car;
  assert.equal(world.system._laneBlock(car.position.x, car.position.z, Math.cos(car.group.rotation.y), -Math.sin(car.group.rotation.y), car), 0, 'y sin tapar el carril');
});

/** Lo deja volviendo al carro, parado, a `offset` de su puerta. */
function returning(world, offset) {
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  world.player.position.set(world.vehicle.car.position.x + 80, 0, 60);
  world.unit._desist();
  officer.position.copy(world.unit.fit.doorPoint(officer.doorSide, new THREE.Vector3())).add(offset);
  officer.returnTimer = 0;
  return officer;
}

test('si su puerta quedó contra un pilar, vuelve por la otra', () => {
  const collisions = new CollisionSystem();
  const world = setup({ collisions });
  const officer = returning(world, new THREE.Vector3(0, 0, 4));
  const door = world.unit.fit.doorPoint(1, new THREE.Vector3());
  const pillar = new THREE.Mesh();
  pillar.position.copy(door);
  collisions.add(pillar, new THREE.Vector3(1.6, 4, 1.2));
  // Sin saber del pilar al parar: se da cuenta porque no avanza, y cambia de puerta.
  const t = runUntil(world, () => officer.state === 'dentro', 25);
  assert.ok(t < 18, `se subió a los ${t.toFixed(1)} s`);
  assert.equal(officer.doorSide, -1);
  // Sabiéndolo al parar: va de una por la otra.
  const again = setup({ collisions: new CollisionSystem() });
  const other = returning(again, new THREE.Vector3(0, 0, 4));
  const block = new THREE.Mesh();
  block.position.copy(again.unit.fit.doorPoint(1, new THREE.Vector3()));
  again.system.collisions.add(block, new THREE.Vector3(1.6, 4, 1.2));
  again.unit._checkDoors();
  assert.deepEqual([again.unit._doorOk[-1], again.unit._doorOk[1]], [true, false]);
  const t2 = runUntil(again, () => other.state === 'subiendo', 15);
  assert.ok(t2 < 8, `llegó a la otra puerta a los ${t2.toFixed(1)} s`);
  assert.equal(other.doorSide, -1);
});

test('sin andén cerca de ninguna puerta, la que da contra un carro parqueado no sirve: vuelve derecho por la otra', () => {
  const collisions = new CollisionSystem();
  const world = setup({ collisions });
  const officer = returning(world, new THREE.Vector3());
  const unit = world.unit, fit = unit.fit, car = world.vehicle.car;
  // Parada en la calzada, lejos de los andenes, con un carro parqueado pegado a la puerta 1.
  world.system.routes = { nodes: [], nodeAt: () => -1, grid: [], tileSize: 2 };
  const door = fit.doorPoint(1, new THREE.Vector3()), out = door.clone().sub(car.position).setY(0).normalize();
  const parked = new Car(world.scene, door.clone().addScaledVector(out, .7).setY(0), car.group.rotation.y);
  collisions.setVehicles([car, parked]);
  unit._checkDoors();
  assert.deepEqual([unit._doorOk[-1], unit._doorOk[1]], [true, false], 'la de la calle sirve; la tapada, no');
  // Vuelve por detrás del carro parqueado, del lado de la puerta tapada.
  const heading = new THREE.Vector3(Math.cos(car.group.rotation.y), 0, -Math.sin(car.group.rotation.y));
  officer.position.copy(door).addScaledVector(heading, -4.5).addScaledVector(out, .9);
  officer.doorSide = 1;
  let boarded = false, towardBlocked = 0;
  const t = runUntil(world, () => officer.state === 'dentro', 25, () => {
    collisions.setVehicles([car, parked]);
    boarded ||= officer.state === 'subiendo';
    if (officer.state === 'regreso' && officer.doorSide === 1) towardBlocked += DT;
  });
  assert.ok(towardBlocked <= 1.1, `fue ${towardBlocked.toFixed(1)} s hacia la puerta tapada`);
  assert.equal(boarded, true, 'se subió por una puerta, no apareció adentro');
  assert.equal(officer.doorSide, -1);
  assert.ok(t < 9, `adentro a los ${t.toFixed(1)} s`);
});

test('con un carro parado detrás de la patrulla, no va derecho a la esquina contra él: sigue la ruta que lo rodea', () => {
  const collisions = new CollisionSystem();
  const world = setup({ collisions });
  const officer = returning(world, new THREE.Vector3());
  const unit = world.unit, fit = unit.fit, car = world.vehicle.car, yaw = car.group.rotation.y;
  const heading = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), right = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const at = (along, across) => car.position.clone().addScaledVector(heading, along).addScaledVector(right, across).setY(0);
  // La puerta 1 da contra un carro parqueado y ninguna a un andén: solo sirve la -1. Detrás de la patrulla quedó un carro
  // parado en su carril, y el agente viene por detrás de ese carro.
  world.system.routes = { nodes: [], nodeAt: () => -1, grid: [], tileSize: 2 };
  const parked = new Car(world.scene, at(.4, 2.2), yaw), behind = new Car(world.scene, at(-8, 0), yaw);
  collisions.setVehicles([car, parked, behind]);
  unit._checkDoors();
  assert.deepEqual([unit._doorOk[-1], unit._doorOk[1]], [true, false]);
  officer.position.copy(at(-12.3, .4));
  officer.doorSide = -1;
  // La red de andenes lo lleva por el costado del carro parado, a 2,8 m del eje del carril.
  officer.routes = { routeTo: (from, to) => [at(-12.3, 2.8), at(-3, 2.8), at(-3, -1.6), to.clone()] };
  let boarded = false;
  const t = runUntil(world, () => officer.state === 'dentro', 30, () => {
    collisions.setVehicles([car, parked, behind]);
    boarded ||= officer.state === 'subiendo';
  });
  assert.equal(boarded, true, 'se subió por la puerta, no apareció adentro');
  assert.equal(officer.doorSide, -1);
  assert.ok(t < 16, `adentro a los ${t.toFixed(1)} s`);
});

test('volviendo por el otro lado del carro: se sube por la puerta que le queda cerca, sin darle la vuelta', () => {
  const world = setup();
  const officer = returning(world, new THREE.Vector3());
  const fit = world.unit.fit, own = officer.doorSide;
  // Quedó a 3 m de la otra puerta, del lado contrario a la suya.
  const near = fit.doorPoint(-own, new THREE.Vector3());
  const out = near.clone().sub(world.vehicle.car.position).setY(0).normalize();
  officer.position.copy(near).addScaledVector(out, 3);
  let walked = 0;
  const last = officer.position.clone();
  const t = runUntil(world, () => officer.state === 'subiendo', 15, () => { walked += officer.position.distanceTo(last); last.copy(officer.position); });
  assert.ok(t < 5, `llegó a los ${t.toFixed(1)} s`);
  assert.equal(officer.doorSide, -own, 'la de su lado');
  assert.ok(walked < 5, `caminó ${walked.toFixed(1)} m`);
});

test('no se corre de un carril con un agente junto al carro, sea de la patrulla que sea', () => {
  const world = setup({ level: 1, police: 2, second: [0, 90] });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner, car = world.vehicle.car;
  runUntil(world, () => officer.state === 'persecucion');
  car.position.z = 0;
  car.group.rotation.y = 0;
  world.player.position.set(car.position.x + 30, 0, 40);
  officer.position.set(car.position.x + 20, 0, 6);
  officer.startSearch(new THREE.Vector3(car.position.x + 24, 0, 8));
  // Un agente de la otra patrulla, parado a 2 m del costado del carro.
  const other = world.traffic.vehicles[1].crew.partner, start = car.position.clone();
  other.state = 'regreso';
  for (let t = 0; t < 6; t += DT) {
    other.position.set(start.x + 1, 0, 3);
    step(world);
    assert.equal(world.unit._relocating || world.unit.phase !== 'parada', false, `no se corre con él al lado (t = ${t.toFixed(1)})`);
  }
  assert.ok(car.position.distanceTo(start) < .2, 'sigue donde estaba');
  // Ya sin él, sí se corre.
  other.state = 'dentro';
  other.position.set(0, -50, 90);
  const t = runUntil(world, () => car.position.distanceTo(start) > 1.5, 8);
  assert.ok(Number.isFinite(t), 'sin nadie al lado se corre');
});

test('el corredor del bus cuenta como carril: parar encima es tapar', () => {
  const bus = { startZ: -40, endZ: 40, laneX: 120, pathX: (z, lane) => lane, width: 2.6, groundHeight: () => 0 };
  const world = setup({ district: { busServices: [bus] } });
  const car = world.vehicle.car;
  car.position.set(120, 0, 5);
  car.group.rotation.y = -Math.PI / 2; // a lo largo del corredor
  world.vehicle.speed = 0;
  assert.ok(world.system._laneBlock(120, 5, 0, 1, car) > 0, 'sobre el corredor');
  assert.equal(world.system._blocking(world.vehicle), true);
  // A 4 m del corredor ya no lo tapa.
  car.position.set(124.5, 0, 5);
  assert.equal(world.system._blocking(world.vehicle), false);
});

/** Corredor del bus por x = 120, a lo largo de z, y la patrulla parada encima, a lo largo. */
function onBusway(options = {}) {
  const bus = { startZ: -40, endZ: 80, laneX: 120, pathX: (z, lane) => lane, width: 2.6, groundHeight: () => 0 };
  const world = setup({ ...options, district: { busServices: [bus] } });
  const busBlock = () => {
    const car = world.vehicle.car, yaw = car.group.rotation.y;
    return world.system._busBlock(car.position.x, car.position.z, Math.cos(yaw), -Math.sin(yaw), car);
  };
  // Un carril de carros a cada lado del corredor, como en la Caracas: junto al corredor no hay sitio que no tape algo.
  const lane = x => ({ length: 120, sample: (d, point, direction) => { direction?.set(0, 0, 1); return point.set(x, 0, -40 + d); } });
  const caracas = () => world.system._buildLanes([...world.traffic.routes, lane(116), lane(124)], [bus]);
  return { world, busBlock, bus, caracas };
}

test('entre tapar un carril y tapar el corredor del bus, tapa el carril: el bus no tiene por dónde rodearla', () => {
  const { world, caracas } = onBusway();
  caracas();
  const vehicle = world.vehicle, car = vehicle.car;
  car.position.set(120, 0, 0);
  car.group.rotation.y = -Math.PI / 2;
  vehicle.speed = 0;
  world.player.position.set(140, 0, 30);
  const target = new THREE.Vector3();
  assert.equal(world.system._chooseStop(vehicle, world.traffic, target), true);
  assert.equal(world.system._busBlock(target.x, target.z, 0, 1, car), 0, `para en x = ${target.x.toFixed(1)}, encima del corredor`);
});

test('escoger dónde parar barre la carrocería solo hasta el primer sitio bueno al que llega, no en todos', () => {
  const world = setup();
  const vehicle = world.vehicle, traffic = world.traffic;
  vehicle.speed = 0;
  let calls = 0;
  traffic.environment = {};
  // El sitio de mejor puntaje está bloqueado; el segundo no.
  let blocked = null;
  traffic._chaseClearance = (v, nx, nz, length) => {
    calls++;
    if (blocked === null) { blocked = [nx, nz]; return 0; }
    return nx === blocked[0] && nz === blocked[1] ? 0 : length;
  };
  const target = new THREE.Vector3();
  assert.equal(world.system._chooseStop(vehicle, traffic, target), true);
  assert.equal(calls, 2, `${calls} barridos de la carrocería`);
});

// ---------- el tráfico alrededor de la patrulla parada ----------

/** Un carril recto por z = `z`, de x = 0 a x = 200, hacia +X (`dx` = 1) o hacia -X (`dx` = -1). */
const street = (z, dx = 1) => ({ length: 200, sample: (d, point, direction) => {
  direction?.set(dx, 0, 0);
  return point.set(dx > 0 ? d : 200 - d, 0, z);
} });
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

test('atravesada, la trompa metida en un carril lo tapa: lo que pasa por ahí es ancho de través', () => {
  const world = setup();
  world.system._buildLanes([street(0)]);
  const car = world.vehicle.car;
  // Mirando hacia -Z con el centro a 3 m del eje del carril: la trompa queda a menos de un metro del eje.
  assert.ok(world.system._laneBlock(100, 3, 0, -1, car) > 0, 'con la trompa adentro tapa');
  assert.equal(world.system._laneBlock(100, 4.5, 0, -1, car), 0, 'con la trompa afuera, no');
  // A lo largo, el ancho de lo que pasa no la alarga hacia adelante ni hacia atrás: orillada a 2,2 m del eje, no tapa.
  assert.equal(world.system._laneBlock(100, 2.2, 1, 0, car), 0);
  // Y es lo mismo que ve el tráfico: un carro que viene por ese carril frena detrás de la trompa.
  const patrol = world.vehicle;
  patrol.car.position.set(100, 0, 3);
  patrol.car.group.rotation.y = Math.PI / 2;
  const civilian = world.traffic._spawn(world.scene, world.traffic.routes[0], 90, false);
  assert.equal(world.system._inPathOf(patrol, civilian), true);
});

test('entre cortar un sentido de un solo carril y tapar un carril de un sentido que tiene otro libre, tapa el carril', () => {
  const world = setup();
  // Hacia -X un solo carril (z = -3,2); hacia +X dos (z = 0 y z = 3,2). Junto a la calle no hay dónde parar sin tapar.
  world.system._buildLanes([street(-3.2, -1), street(0), street(3.2)]);
  world.system._isWalkable = (x, z) => z < -4.3 || z > 5.5;
  const vehicle = world.vehicle, car = vehicle.car;
  car.position.set(100, 0, 0);
  car.group.rotation.y = 0;
  vehicle.speed = 0;
  world.player.position.set(112, 0, -12); // del lado del carril de un solo sentido, donde sí se baja por una puerta
  const target = new THREE.Vector3(), axis = new THREE.Vector3();
  assert.equal(world.system._chooseStop(vehicle, world.traffic, target, { axis }), true);
  const heading = axis.lengthSq() > 0 ? axis : new THREE.Vector3(target.x - car.position.x, 0, target.z - car.position.z).normalize();
  assert.ok(world.system._laneBlock(target.x, target.z, heading.x, heading.z, car) > 0, 'aquí no hay sitio sin tapar');
  assert.equal(world.system._laneCut(target.x, target.z, heading.x, heading.z, car), 0,
    `para en (${target.x.toFixed(1)}, ${target.z.toFixed(1)}) y corta un sentido entero`);
});

test('orillada junto al carril queda derecha, con su eje, y llega en curva sin coletear', () => {
  const world = setup();
  const car = world.vehicle.car;
  world.traffic._startChase(world.vehicle);
  let swerve = 0;
  runUntil(world, () => world.unit.phase === 'parada', 30, () => {
    if (world.unit.phase === 'frenando') swerve = Math.max(swerve, Math.abs(wrapAngle(car.group.rotation.y)));
  });
  // El carril va hacia +X: su eje es el rumbo 0.
  assert.ok(Math.abs(wrapAngle(car.group.rotation.y)) < 10 * Math.PI / 180, `quedó a ${(wrapAngle(car.group.rotation.y) * 180 / Math.PI).toFixed(1)}° del eje`);
  assert.ok(swerve < .9, `coleteó ${(swerve * 180 / Math.PI).toFixed(0)}°`);
  assert.ok(Math.abs(car.position.z) >= 2, `quedó a ${Math.abs(car.position.z).toFixed(2)} m del eje del carril`);
  assert.equal(world.system._laneBlock(car.position.x, car.position.z, 1, 0, car), 0);
});

/**
 * La patrulla parada encima del carril (z = 0), con el compañero buscando a 5 m del carro (ni tan lejos como para correrla
 * por tapar el carril, ni tan cerca como para no poder arrancar) y un carro que viene detrás por ese carril. Con `civilian`
 * en false, sin el carro. Al lado va otro carril hacia +X (z = -3,2): tapar el de z = 0 no corta el sentido, salvo con
 * `cut`.
 */
function heldBehind({ level = 1, driverAway = false, civilian = true, cut = false } = {}) {
  const world = setup({ level, player: [60, 0] });
  if (!cut) world.system._buildLanes([...world.traffic.routes, street(-3.2)]);
  world.traffic._startChase(world.vehicle);
  const unit = world.unit, car = world.vehicle.car;
  runUntil(world, () => unit.partner.state !== 'dentro' && (!driverAway || unit.driver.state !== 'dentro'));
  runUntil(world, () => unit.partner.state === 'persecucion' && (!driverAway || unit.driver.state === 'persecucion'));
  car.position.set(100, 0, 0);
  car.group.rotation.y = 0;
  // Fuera de la vista de todos, pero no tan lejos como para desistir de una.
  world.player.position.set(100, 0, 48);
  const search = (officer, x, z) => {
    officer.position.set(x, 0, z);
    officer.startSearch(officer.position);
    officer.searchPhase = 'mirar';
    officer.searchTimer = 60;
  };
  search(unit.partner, 102, 4.6);
  if (driverAway) search(unit.driver, 100, -10);
  return { world, unit, car, civilian: civilian ? world.traffic._spawn(world.scene, world.traffic.routes[0], 100 - 3.2 - 12, false) : null };
}

test('con un carro retenido detrás más de 8 s, la patrulla se corre aunque el compañero ande cerca', () => {
  const { world, unit, car, civilian } = heldBehind();
  const start = car.position.clone();
  let worst = 0;
  runUntil(world, () => false, 18, () => { worst = Math.max(worst, civilian.stoppedFor ?? 0); });
  assert.ok(car.position.distanceTo(start) > 1.5, 'la patrulla se corrió');
  assert.equal(world.system._laneBlock(car.position.x, car.position.z, Math.cos(car.group.rotation.y), -Math.sin(car.group.rotation.y), car), 0, 'a un sitio libre');
  assert.ok(worst > 6 && worst < 12, `el carro de atrás esperó ${worst.toFixed(1)} s`);
  assert.ok(civilian.car.position.x > start.x + 3, 'y siguió por su carril');
  assert.equal(unit.mode, 'persigue', 'sin dejar de buscarlo');
});

test('con los dos afuera y un carro retenido detrás, el conductor vuelve de afán a correrla', () => {
  const { world, unit, car, civilian } = heldBehind({ level: 2, driverAway: true });
  const start = car.position.clone();
  let worst = 0, fastest = 0, gestured = false;
  // Hasta que la corre (a los 20 s sin acortarle distancia desistirían de todos modos).
  runUntil(world, () => unit.phase === 'parada' && car.position.distanceTo(start) > 1.5, 19.5, () => {
    worst = Math.max(worst, civilian.stoppedFor ?? 0);
    if (unit.driver.state === 'regreso' && unit.driver.moving) fastest = Math.max(fastest, unit.driver.walkSpeed);
    gestured ||= unit.driver.state === 'regreso' && !!unit.driver.poseParams.stance;
  });
  assert.ok(car.position.distanceTo(start) > 1.5, 'la patrulla se corrió');
  assert.equal(unit.driver.state, 'dentro', 'con el conductor al volante');
  assert.ok(fastest >= POLICE_FOOT.hurrySpeed - .05, `volvió a ${fastest.toFixed(1)} m/s`);
  assert.equal(gestured, false, 'sin quedarse cogiendo aire');
  assert.ok(worst < 16, `el carro de atrás esperó ${worst.toFixed(1)} s`);
  assert.equal(unit.partner.state, 'busqueda', 'el compañero sigue buscándolo');
});

test('parada encima de un carril, con fichado 2 el conductor no se baja: se queda al volante y la quita de ahí', () => {
  const world = setup({ level: 2 });
  // Al lado va otro carril hacia +X: tapar el de z = 0 no corta el sentido (eso tiene su propia regla).
  world.system._buildLanes([...world.traffic.routes, street(-3.2)]);
  world.traffic._startChase(world.vehicle);
  runUntil(world, () => world.unit.phase === 'frenando');
  world.player.position.x += 6; // lejos del carro: el conductor no tiene por qué bajarse todavía
  exitOf(world);
  const unit = world.unit, car = world.vehicle.car;
  runUntil(world, () => unit.partner.state === 'persecucion');
  assert.equal(unit.driver.state, 'dentro', 'con el jugador lejos el conductor se quedó');
  // Quedó encima del carril y el carro no tiene por dónde llegarle al jugador: con fichado 2, orillada, el conductor se
  // bajaría ya.
  car.position.set(100, 0, 0);
  car.group.rotation.y = 0;
  world.vehicle.speed = 0;
  world.player.position.set(105, 0, 30);
  world.system._carCanReach = () => false;
  unit._reachable = false;
  unit._unreachable = POLICE_FOOT.driverUnreachable + 1;
  const blocking = () => world.system._blocking(world.vehicle);
  assert.ok(blocking());
  let outBlocking = false;
  const t = runUntil(world, () => unit.driver.out, 12, () => {
    if (unit.driver.out && blocking()) outBlocking = true;
  });
  assert.equal(outBlocking, false, 'se bajó con la patrulla tapando el carril');
  assert.ok(Number.isFinite(t), 'ya orillada, con el carro sin camino, sí se baja');
  assert.equal(blocking(), false, 'la patrulla quedó fuera del carril');
});

test('cortando del todo un sentido, aunque no venga nadie, a los 8 s se corre a donde deje pasar', () => {
  const { world, unit, car } = heldBehind({ cut: true, civilian: false });
  const start = car.position.clone(), yaw = () => car.group.rotation.y;
  assert.ok(world.system._laneCut(car.position.x, car.position.z, 1, 0, car) > 0, 'el carril de z = 0 es el único hacia +X');
  let movedAt = Infinity;
  runUntil(world, () => unit.phase === 'parada' && car.position.distanceTo(start) > 1.5, 15, t => {
    if (movedAt === Infinity && car.position.distanceTo(start) > .05) movedAt = t;
  });
  assert.ok(movedAt > 7.5 && movedAt < 10, `arrancó a los ${movedAt.toFixed(1)} s`);
  assert.equal(world.system._laneCut(car.position.x, car.position.z, Math.cos(yaw()), -Math.sin(yaw()), car), 0, 'ya no corta el sentido');
  assert.equal(unit.mode, 'persigue');
});

test('con un carro retenido detrás y ningún sitio libre a dónde correrse, desisten de afán y se van', () => {
  const { world, unit, car, civilian } = heldBehind();
  const choose = world.system._chooseStop.bind(world.system);
  world.system._chooseStop = (vehicle, traffic, target, options = {}) => options.free || options.uncut ? false : choose(vehicle, traffic, target, options);
  const start = car.position.clone();
  let worst = 0, gestured = false;
  runUntil(world, () => world.vehicle.state === 'patrol' && civilian.speed > 1, 30, () => {
    worst = Math.max(worst, civilian.stoppedFor ?? 0);
    gestured ||= unit.partner.state === 'regreso' && !!unit.partner.poseParams.stance;
  });
  assert.equal(unit.endReason, 'estorbo');
  assert.equal(gestured, false, 'vuelve sin coger aire');
  assert.ok(worst < 14, `el carro de atrás esperó ${worst.toFixed(1)} s`);
  assert.ok(car.position.x > start.x + 3, 'la patrulla siguió su ronda');
  assert.equal(world.vehicle.state, 'patrol');
});

test('una patrulla trabada con el carro que se le metió encima puede apartarse de él, pero no echársele más encima', () => {
  const collisions = new CollisionSystem();
  const world = setup({ collisions, environment: { collisions, getGroundHeight: () => 0 } });
  world.traffic._startChase(world.vehicle);
  const car = world.vehicle.car;
  car.position.set(100, 0, 0);
  car.group.rotation.y = 0;
  // El de al lado le metió la trompa: las cajas ya se tocan.
  const other = new Car(world.scene, new THREE.Vector3(103.5, 0, 1.6));
  collisions.setVehicles([car, other]);
  const clear = (nx, nz) => world.traffic._chaseClearance(world.vehicle, nx, nz, 3);
  const toward = new THREE.Vector3(3.5, 0, 1.6).normalize();
  assert.ok(clear(-1, 0) > 2.9, 'hacia atrás, alejándose, sí se mueve');
  assert.ok(clear(-toward.x, -toward.z) > 2.9, 'derecho en contra de él también');
  assert.equal(clear(1, 0), 0, 'hacia adelante, contra él, no');
  assert.equal(clear(toward.x, toward.z), 0, 'derecho hacia él, menos');
  // Sin trabarse, el mismo carro un poco más allá sigue atajándola como siempre.
  other.position.set(105.5, 0, 1.6);
  collisions.setVehicles([car, other]);
  assert.ok(clear(1, 0) < 1.5, `avanzó ${clear(1, 0).toFixed(1)} m hacia un carro que no tocaba`);
  assert.ok(clear(-1, 0) > 2.9);
});

test('sobre el corredor del bus el conductor no se baja: se queda al volante y la quita de ahí', () => {
  const { world, busBlock } = onBusway({ level: 2 });
  world.traffic._startChase(world.vehicle);
  runUntil(world, () => world.unit.phase === 'frenando');
  world.player.position.x += 6; // lejos del carro: el conductor no tiene por qué bajarse todavía
  exitOf(world);
  const unit = world.unit, car = world.vehicle.car;
  runUntil(world, () => unit.partner.state === 'persecucion');
  assert.equal(unit.driver.state, 'dentro', 'con el jugador lejos el conductor se quedó');
  // Quedó sobre el corredor y el carro no tiene por dónde llegarle al jugador: con fichado 2, en otra parte, el conductor
  // se bajaría ya.
  car.position.set(120, 0, 10);
  car.group.rotation.y = -Math.PI / 2;
  world.vehicle.speed = 0;
  world.player.position.set(125, 0, 30);
  world.system._carCanReach = () => false;
  unit._reachable = false;
  unit._unreachable = POLICE_FOOT.driverUnreachable + 1;
  assert.ok(busBlock() > 0);
  let outOnBus = false, movedWithDoorOpen = false;
  const t = runUntil(world, () => unit.driver.out, 12, () => {
    if (unit.driver.out && busBlock() > 0) outOnBus = true;
    if (Math.abs(world.vehicle.speed) > .05 && (unit.fit.doorAmount(-1) > 0 || unit.fit.doorAmount(1) > 0)) movedWithDoorOpen = true;
  });
  assert.equal(outOnBus, false, 'se bajó con la patrulla encima del corredor');
  assert.equal(movedWithDoorOpen, false, 'no arranca con una puerta abierta');
  assert.ok(Number.isFinite(t), 'ya fuera del corredor, con el jugador cerca, sí se baja');
  assert.equal(busBlock(), 0, 'la patrulla quedó fuera del corredor');
});

test('ya desistiendo, la patrulla parada sobre el corredor del bus se corre antes de que vuelva el compañero', () => {
  const { world, busBlock, caracas } = onBusway({ level: 1 });
  caracas(); // sin sitio libre de todo: se corre a uno que tapa un carril de carros, pero no el corredor
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const unit = world.unit, officer = unit.partner, vehicle = world.vehicle, car = vehicle.car;
  runUntil(world, () => officer.state === 'persecucion');
  car.position.set(120, 0, 10);
  car.group.rotation.y = -Math.PI / 2;
  vehicle.speed = 0;
  officer.position.set(140, 0, 30);
  world.player.position.set(180, 0, 90);
  unit._desist('perdido');
  assert.equal(officer.state, 'regreso');
  let offAt = Infinity, boardedOnBus = false, movedWithDoorOpen = false, boardingMoving = false;
  const t = runUntil(world, () => unit.mode === 'ronda', 60, time => {
    if (offAt === Infinity && unit.phase === 'parada' && busBlock() === 0) offAt = time;
    if (officer.state === 'subiendo' && busBlock() > 0) boardedOnBus = true;
    if (Math.abs(vehicle.speed) > .05 && (unit.fit.doorAmount(-1) > 0 || unit.fit.doorAmount(1) > 0)) movedWithDoorOpen = true;
    if (Math.abs(vehicle.speed) > .05 && officer.state === 'subiendo') boardingMoving = true;
  });
  assert.ok(offAt < 8, `fuera del corredor a los ${offAt.toFixed(1)} s`);
  assert.equal(boardedOnBus, false, 'se subió con la patrulla encima del corredor');
  assert.equal(movedWithDoorOpen, false, 'no arranca con una puerta abierta');
  assert.equal(boardingMoving, false, 'nadie se sube con el carro andando');
  assert.ok(Number.isFinite(t), 'se subió y la patrulla siguió su ronda');
});

test('si la patrulla parada sobre el corredor tiene al bus esperando, el que vuelve no se demora: trota, sin coger aire', () => {
  const { world, caracas } = onBusway({ level: 1 });
  caracas();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const unit = world.unit, officer = unit.partner, vehicle = world.vehicle, car = vehicle.car;
  runUntil(world, () => officer.state === 'persecucion');
  car.position.set(120, 0, 10);
  car.group.rotation.y = -Math.PI / 2;
  vehicle.speed = 0;
  unit._checkDoors();
  // Encajonada: sin sitio a donde correrse, y el bus parado a su lado.
  world.system._chooseStop = () => false;
  const bus = { position: new THREE.Vector3(120, 0, 24), speed: 0, length: 22, width: 2.6, group: { visible: false } };
  world.traffic.setBus(bus);
  officer.position.set(120, 0, 50);
  officer.runTime = 10; // venía corriendo: sin el bus, cogería aire
  world.player.position.set(200, 0, 120);
  unit._desist('perdido');
  let fastest = 0, gestured = false;
  const t = runUntil(world, () => officer.state === 'subiendo', 20, () => {
    fastest = Math.max(fastest, officer.moving ? officer.walkSpeed : 0);
    gestured ||= officer.poseParams.stance === 'sin-aire' || officer.poseParams.stance === 'radio-solapa';
  });
  assert.equal(gestured, false, 'no se queda cogiendo aire con el bus esperando');
  assert.ok(fastest >= POLICE_FOOT.hurrySpeed - .05, `vuelve a ${fastest.toFixed(1)} m/s`);
  assert.ok(t < 40 / POLICE_FOOT.hurrySpeed + 2, `llegó a la puerta a los ${t.toFixed(1)} s`);
  // Sin el bus, vuelve caminando como siempre.
  bus.position.set(300, 0, 300);
  officer.position.set(120, 0, 50);
  officer.state = 'persecucion';
  unit.resume(world.player.position);
  unit._desist('perdido');
  fastest = 0;
  runUntil(world, () => false, 4, () => { fastest = Math.max(fastest, officer.moving ? officer.walkSpeed : 0); });
  assert.ok(fastest <= POLICE_FOOT.walkSpeed + .05, `sin el bus, a ${fastest.toFixed(1)} m/s`);
});

test('si no logra volver, el conductor va por él y para a unos metros; nadie se sube ni abre con el carro andando', () => {
  // Un separador con matas entre él y el carro (z de 8 a 10): a pie no se pasa, el carro sí. Llega hasta x = 100.
  const walkable = (x, z) => !(z > 8 && z < 10 && x < 100);
  const world = setup({ walkable });
  const officer = returning(world, new THREE.Vector3(10, 0, 14));
  const car = world.vehicle.car, start = car.position.clone(), fit = world.unit.fit;
  assert.ok(officer.position.z > 10 && car.position.z < 8, 'el separador queda entre los dos');
  // La cámara lo está mirando: no puede subirse de una.
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  camera.position.copy(officer.position).add(new THREE.Vector3(0, 8, 14));
  camera.lookAt(officer.position);
  let movingWithDoor = false, boardingWhileMoving = false, t = 0;
  while (officer.state !== 'dentro' && t < 50) {
    if (Math.abs(world.vehicle.speed) > .05) {
      if (fit.doorAmount(-1) > 0 || fit.doorAmount(1) > 0) movingWithDoor = true;
      if (officer.state === 'subiendo') boardingWhileMoving = true;
    }
    step(world, DT, { camera });
    t += DT;
  }
  assert.equal(officer.state, 'dentro', 'se subió');
  assert.ok(t < POLICE_FOOT.returnCap - 5, `se subió caminando a los ${t.toFixed(1)} s`);
  assert.ok(car.position.distanceTo(start) > 5, `el carro fue por él (${car.position.distanceTo(start).toFixed(1)} m)`);
  assert.ok(car.position.z > 10, 'del lado de él');
  assert.equal(movingWithDoor, false, 'ninguna puerta abierta con el carro andando');
  assert.equal(boardingWhileMoving, false, 'nadie se sube con el carro andando');
});

test('una recogida que cortó el fin de la persecución no queda pendiente: en la siguiente nadie se baja mientras frena', () => {
  const walkable = (x, z) => !(z > 8 && z < 10 && x < 100);
  const world = setup({ walkable });
  const officer = returning(world, new THREE.Vector3(10, 0, 14));
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  camera.position.copy(officer.position).add(new THREE.Vector3(0, 8, 14));
  camera.lookAt(officer.position);
  // El conductor decide ir por él y cierra las puertas para arrancar; antes de arrancar, la persecución termina.
  for (let t = 0; t < 40 && !world.unit._pickedUp; t += DT) step(world, DT, { camera });
  assert.ok(world.unit._pickedUp, 'iba a recogerlo');
  world.traffic.endPursuit();
  assert.equal(officer.state, 'dentro');
  // Otra persecución: frena, para y después se baja el compañero. Bajándose, el carro ya no vuelve a frenar (podría andar).
  world.player.position.set(world.vehicle.car.position.x + 25, 0, world.vehicle.car.position.z);
  world.traffic._startChase(world.vehicle);
  let brakingWithSomeoneOut = false;
  for (let t = 0; t < 15 && officer.state !== 'persecucion'; t += DT) {
    step(world);
    if (world.unit.phase === 'frenando' && world.unit.anyoneOut) brakingWithSomeoneOut = true;
  }
  assert.equal(officer.state, 'persecucion', 'se bajó y lo persigue');
  assert.equal(brakingWithSomeoneOut, false);
});

test('volviendo: a los 45 s se sube de una aunque la cámara lo esté mirando', () => {
  const collisions = new CollisionSystem();
  const world = setup({ collisions });
  const officer = returning(world, new THREE.Vector3(6, 0, 8));
  world.system._carCanReach = () => false; // el carro no puede ir por él
  // Encerrado entre cuatro muros.
  for (const [x, z, w, d] of [[0, 2, 6, 1], [0, -2, 6, 1], [2.5, 0, 1, 6], [-2.5, 0, 1, 6]]) {
    const wall = new THREE.Mesh();
    wall.position.set(officer.position.x + x, 0, officer.position.z + z);
    collisions.add(wall, new THREE.Vector3(w, 4, d));
  }
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  camera.position.copy(officer.position).add(new THREE.Vector3(0, 6, 12));
  camera.lookAt(officer.position);
  let t = 0;
  while (officer.state === 'regreso' && t < 60) { step(world, DT, { camera }); t += DT; }
  assert.equal(officer.state, 'dentro');
  assert.ok(t > POLICE_FOOT.returnCap - 1 && t < POLICE_FOOT.returnCap + 1, `se subió a los ${t.toFixed(1)} s`);
});

test('con la patrulla andando, el que vuelve espera: ni abre la puerta ni se sube', () => {
  const world = setup();
  // A un paso de su puerta: si no esperara, se subiría de una.
  const officer = returning(world, new THREE.Vector3(.2, 0, 0));
  officer._gesture = 0; // ya cogió aire y avisó por radio: lo que se prueba es que espere al carro
  const unit = world.unit, fit = unit.fit;
  fit.restore();
  fit.setPassengerInside(false);
  // Se está corriendo unos metros (como al reubicarse): el carro anda.
  unit.phase = 'frenando';
  unit._brakeClock = 0;
  unit.stopTarget.copy(world.vehicle.car.position).add(new THREE.Vector3(12, 0, 0));
  world.vehicle.speed = 2;
  let opened = false;
  for (let i = 0; i < 20; i++) {
    step(world);
    if (Math.abs(world.vehicle.speed) > .05 && fit.doorAmount(1) > 0) opened = true;
    assert.notEqual(officer.state === 'subiendo' && Math.abs(world.vehicle.speed) > .05, true, 'no se sube andando');
    assert.equal(officer.state, 'regreso', 'lo espera afuera');
    assert.equal(officer.moving, false, 'quieto, mirándolo');
  }
  assert.equal(opened, false);
});

test('una sola ruta nueva por cuadro entre todos los agentes', () => {
  const world = setup({ level: 2, police: 2, second: [40, 20], player: [55, 10] });
  let calls = 0, most = 0, total = 0;
  for (const officer of world.system.officers) officer.routes = { routeTo: () => { calls++; total++; return []; } };
  for (const vehicle of world.traffic.vehicles) world.traffic._startChase(vehicle);
  runUntil(world, () => world.system.officers.filter(officer => officer.onFoot).length >= 3, 12);
  // Se aleja: lejos de ellos (más de 8 m) ya no van derecho, van por la red de andenes.
  world.player.position.set(75, 0, 25);
  runUntil(world, () => false, 4, () => { most = Math.max(most, calls); calls = 0; });
  assert.ok(total > 3, `${total} rutas`);
  assert.ok(world.system.officers.filter(officer => officer.onFoot).length >= 3, 'tres o cuatro agentes a pie');
  assert.equal(most, 1, `hasta ${most} por cuadro`);
});

test('el agarrón se ve venir: estira el brazo y se le echa encima; si se le zafa, manotazo al aire y media marcha', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  officer.sprintLeft = 0;
  // Lo tiene a 1 m: empieza el agarrón.
  const near = () => world.player.position.set(officer.position.x + 1, 0, officer.position.z);
  runUntil(world, () => officer.catchTimer > .2, 2, near);
  assert.equal(officer.poseParams.point, 1, 'estira el brazo');
  assert.ok(officer.poseParams.style?.stoop > .3, 'se le echa encima');
  // Se zafa antes de los 0,4 s.
  world.player.position.set(officer.position.x + 4, 0, officer.position.z);
  runUntil(world, () => officer._fumble > 0, 1, () => world.player.position.set(officer.position.x + 4, 0, officer.position.z));
  assert.ok(officer._fumble > 0, 'agarrón fallido');
  assert.equal(officer.catchTimer, 0);
  // Mientras se recompone, el brazo queda abajo aunque lo tenga a 3 m, donde normalmente lo señalaría.
  assert.ok(3 < POLICE_FOOT.warnRange);
  // El brazo sigue de largo (con el tronco tras él) mientras el de señalar se recoge; después un traspié y se recompone.
  let fastest = 0, pointed = 0, swing = 0, stumbleAt = null, lastSwing = 0;
  for (let t = 0; t < 1 && officer._fumble > 0; t += DT) {
    world.player.position.set(officer.position.x + 3, 0, officer.position.z);
    step(world);
    if (officer._fumble > 0) pointed = Math.max(pointed, officer.poseParams.point ?? 0);
    if (officer._fumble > 0 && officer.moving) fastest = Math.max(fastest, officer.walkSpeed);
    if (officer.poseParams.stance === 'manotazo') { swing += DT; lastSwing = t; }
    if (stumbleAt === null && officer.poseParams.style?.limp > 0) stumbleAt = t;
  }
  assert.ok(fastest > 0 && fastest <= POLICE_FOOT.tiredSpeed / 2 + .05, `a media marcha: ${fastest.toFixed(2)} m/s`);
  assert.equal(pointed, 0, 'brazo abajo mientras se recompone');
  // El de señalar se recoge con e^(-7 t): a menos de 0,3 a los 0,17 s; el manotazo lo tapa hasta entonces y un poco más.
  assert.ok(swing > .25 && swing < .36, `el brazo de largo ${swing.toFixed(2)} s`);
  assert.ok(stumbleAt !== null && stumbleAt >= lastSwing, 'el traspié viene después del manotazo');
  assert.ok(officer.sees && officer.distance < POLICE_FOOT.warnRange, 'ya recompuesto, lo tiene cerca y a la vista');
  step(world);
  assert.equal(officer.poseParams.point, 1, 'y ya recompuesto lo vuelve a señalar');
  assert.equal(count('police-arrest'), 0);
  // Si lo sostiene, el arresto sale una vez.
  runUntil(world, () => count('police-arrest') > 0, 5, () => world.player.position.set(officer.position.x + .8, 0, officer.position.z));
  for (let i = 0; i < 30; i++) step(world);
  assert.equal(count('police-arrest'), 1);
});

test('bajada de afán: 1,4 s con fichado 1 y 0,95 con fichado 2; la puerta de un tirón, con rebote; el conductor después', () => {
  for (const [level, seconds] of [[1, 1.4], [2, .95]]) {
    const world = setup({ level });
    world.unit._forceDriver = level >= 2;
    world.traffic._startChase(world.vehicle);
    const { partner, driver, fit } = world.unit;
    runUntil(world, () => partner.state === 'bajando');
    world.unit._forceDriver = level >= 2;
    let t = 0, doorOpen = null, widest = 0, driverOut = null;
    while (partner.state === 'bajando' && t < 3) {
      step(world);
      t += DT;
      if (doorOpen === null && fit.doorAmount(partner.doorSide) >= 1) doorOpen = t;
      widest = Math.max(widest, Math.abs(fit.doors[partner.doorSide].pivot.rotation.y));
      if (driverOut === null && driver.state === 'bajando') driverOut = t;
    }
    assert.ok(Math.abs(t - seconds) < .1, `fichado ${level}: se bajó en ${t.toFixed(2)} s`);
    assert.ok(doorOpen !== null && doorOpen <= .26, `fichado ${level}: la puerta abrió en ${doorOpen?.toFixed(2)} s`);
    assert.ok(widest > 1.12 * 1.02, `fichado ${level}: rebota contra el tope (${widest.toFixed(3)} rad)`);
    if (level >= 2) assert.ok(driverOut !== null && driverOut >= .3 && driverOut <= .5, `el conductor sale ${driverOut?.toFixed(2)} s después`);
  }
});

test('cansado corre encorvado, agotado más; al desistir frena, coge aire, avisa por radio y vuelve caminando pesado', () => {
  const world = setup();
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  const away = () => world.player.position.set(officer.position.x + 15, 0, officer.position.z);
  officer.sprintLeft = 0;
  runUntil(world, () => false, .3, away);
  const tired = officer.poseParams.style?.stoop ?? 0;
  officer.runTime = POLICE_FOOT.exhaustAfter + 1;
  runUntil(world, () => false, .3, away);
  const exhausted = officer.poseParams.style?.stoop ?? 0;
  assert.ok(tired > 0 && exhausted > tired, `encorvado ${tired} y después ${exhausted}`);
  assert.ok(officer.moving, 'venía corriendo');
  world.unit._desist('sin-avance');
  const from = officer.position.clone();
  const beats = [];
  let t = 0, halted = 0;
  while (t < 7) {
    step(world);
    t += DT;
    const { stance, style } = officer.poseParams;
    const what = stance ?? (officer.moving ? 'camina' : 'quieto');
    if (beats.at(-1)?.what !== what) beats.push({ what, t, frames: [] });
    beats.at(-1).frames.push({ t, style, look: officer.poseParams.look ?? 0, speed: officer.moving ? officer.walkSpeed : 0 });
    if (beats.length === 1) halted = officer.position.distanceTo(from);
  }
  const order = beats.map(beat => beat.what);
  assert.deepEqual(order.slice(0, 4), ['camina', 'sin-aire', 'radio-solapa', 'camina'], order.join(' > '));
  const [halt, breath, radio, walk] = beats;
  const length = (beat, next) => next.t - beat.t;
  // Frena: dos pasos cortos, el tronco adelante y los brazos caídos, cada vez más despacio.
  assert.ok(breath.t > .3 && breath.t < .42, `frena ${breath.t.toFixed(2)} s`);
  assert.ok(halted > .3 && halted < 1.5, `frenando avanza ${halted.toFixed(2)} m`);
  assert.ok(halt.frames.every(frame => frame.style?.stoop >= .5 && frame.style?.swing <= .3), 'con el tronco adelante y los brazos caídos');
  assert.ok(halt.frames.at(-1).speed < halt.frames[0].speed, 'cada vez más despacio');
  // Sin aire: la cabeza cuelga y a la mitad se levanta.
  assert.ok(length(breath, radio) >= 1 - DT && length(breath, radio) <= 1.4 + DT, `sin aire ${length(breath, radio).toFixed(2)} s`);
  assert.ok(breath.frames[0].style?.headDown > 0, 'la cabeza cuelga');
  assert.ok(breath.frames.at(-1).style?.headDown < 0, 'y se levanta a mirar');
  // Radio: se endereza con un último resuello, mirando hacia donde lo vieron.
  assert.ok(Math.abs(length(radio, walk) - POLICE_FOOT.radio) < 2 * DT, `radio ${length(radio, walk).toFixed(2)} s`);
  assert.ok(radio.frames[0].style?.stoop < 0, 'último resuello');
  assert.equal(radio.frames.at(-1).style, undefined, 'y ya derecho');
  // Vuelve caminando pesado, más despacio, y a los 2 s camina como siempre.
  const heavy = walk.frames.filter(frame => frame.speed > 0 && frame.style?.stoop > .15);
  assert.ok(heavy.length > 30, `caminó pesado ${heavy.length} cuadros`);
  assert.ok(heavy.every(frame => frame.style.swing < 1 && frame.style.headDown > 0), 'hombros caídos y la cabeza baja');
  assert.ok(Math.max(...heavy.map(frame => frame.speed)) < POLICE_FOOT.walkSpeed * .85, 'más despacio');
  const after = walk.frames.filter(frame => frame.t > heavy.at(-1).t + .1 && frame.speed > 0);
  assert.ok(after.length && after.every(frame => frame.style === undefined), 'después camina como siempre');
  assert.ok(officer.lastLine, 'lo dice');
});
