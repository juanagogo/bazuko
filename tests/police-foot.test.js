import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { SKIN_ALBEDO } from '../src/character/look.js';
import { PATROL_COLORS } from '../src/character/patrolUniform.js';

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
const { POLICE_FOOT, POLICE_GRAB, POLICE_GRAB_LINES } = await import('../src/entities/PoliceOfficer.js');
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { TrafficRoute } = await import('../src/world/bogota/TrafficRoute.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');
const { Car } = await import('../src/entities/Car.js');
const { seatLift } = await import('../src/entities/patrolCar.js');
const { getDriverGeometry } = await import('../src/world/bogota/VehicleBody.js');

const DT = 1 / 30;
let events;
beforeEach(() => {
  globalThis.window = new EventTarget();
  events = [];
  for (const type of ['police-arrest', 'police-escaped', 'police-grab', 'police-release', 'npc-death', 'population-changed', 'toast']) window.addEventListener(type, e => events.push({ type, detail: e.detail }));
});
const count = type => events.filter(event => event.type === type).length;

/**
 * Una patrulla (o dos) en el tramo de arriba del circuito, rumbo a +X, y el jugador adelante.
 * Sin entorno de colisiones el carro de la persecución va derecho, como en las pruebas de TrafficSystem.
 */
function setup({ level = 1, police = 1, player = [60, 0], collisions = null, walkable = () => true, playerVehicle = null,
  second = [0, 60], district = {}, environment = null, roster = null } = {}) {
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
  system.restoreRoster(roster);
  system.setup({ isWalkableAt: walkable, getGroundHeight: () => 0, ...district }, traffic, people, { collisions });
  const vehicle = traffic.vehicles[0];
  const unit = vehicle.crew;
  return { scene, traffic, system, vehicle, unit, player: playerObject, people };
}

test('cada figura sentada conserva el tono de piel y el chaleco del agente que sale por su puerta', async () => {
  const { system } = setup({ police: 2 });
  for (const { driver, partner, fit } of system.units) {
    for (const [officer, seated, passenger] of [
      [driver, fit.car.driver.children[0], false],
      [partner, fit.passenger.children[0], true]
    ]) {
      await officer.ready;
      const skin = new THREE.Color().setRGB(...SKIN_ALBEDO[officer.look.piel]);
      const vest = {
        color: passenger ? PATROL_COLORS.chaleco : PATROL_COLORS.chalecoConductor,
        tape: PATROL_COLORS.cinta,
        passenger
      };
      const matching = getDriverGeometry(PATROL_COLORS.uniforme, `#${skin.getHexString()}`, PATROL_COLORS.gorra, vest);
      assert.equal(seated.geometry, matching, officer.role);
    }
  }
});

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
  again.player.position.copy(again.unit.partner.position).x += .8;
  assert.equal(again.unit.partner.takeHit({ damage: 10, attackId: 7, attacker: again.player }), 0, 'el golpe cuenta');
  for (let t = 0; t < 1; t += DT) step(again);
  assert.equal(count('police-escaped'), 0);
});

test('golpear a un agente: aguanta, reacciona y su compañero se baja', () => {
  const world = setup({ level: 1 });
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  const attacker = world.player;
  attacker.position.copy(officer.position).x += .8;
  assert.equal(officer.takeHit({ damage: 30, attacker, attackId: 1 }), 0, 'acepta el golpe, sin plata');
  assert.equal(officer.takeHit({ damage: 30, attacker, attackId: 1 }), false, 'el mismo golpe no cuenta dos veces');
  assert.equal(officer.health, officer.maxHealth - 15, 'el uniforme amortigua la mitad del daño');
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
  world.player.position.copy(officer.position).x += .5;
  officer.takeHit({ damage: 10, attacker: world.player });
  assert.equal(officer.state, 'persecucion');
  assert.equal(world.unit.mode, 'persigue');
  assert.equal(world.traffic.inPursuit, true);
});

test('el agente a cero suelta al jugador, conserva su identidad y sigue en el suelo al cerrar la persecución', async () => {
  const world = setup();
  const { unit, traffic, player, people } = world, officer = unit.partner;
  await officer.ready;
  traffic._startChase(world.vehicle);
  assert.ok(Number.isFinite(runUntil(world, () => officer.onFoot)));
  player.position.copy(officer.position).x += .5;
  const first = { attacker: player, damage: 140, attackId: 11 };
  assert.equal(officer.takeHit(first), 0);
  assert.equal(officer.health, 30);
  assert.equal(officer.takeHit(first), false);
  officer._grab = { phase: 'agarre' };
  const last = { attacker: player, damage: 65, attackId: 12, weapon: 'punos' };
  assert.equal(officer.takeHit(last), 0);
  assert.equal(officer.takeHit(last), false);
  assert.equal(count('npc-death'), 1);
  const death = events.find(event => event.type === 'npc-death').detail;
  assert.equal(death.victim, officer);
  assert.equal(death.attacker, player);
  assert.deepEqual([death.previousHealth, death.health, death.weapon, death.attackId, death.wasAggressor], [30, 0, 'punos', 12, false]);
  assert.ok(death.position.equals(officer.position));
  assert.equal(count('police-release'), 1);
  assert.equal(officer.grabbing, false);
  assert.equal(people.includes(officer), false);
  assert.equal(officer.canSee(player.position), false);
  traffic.endPursuit();
  officer.enterCar();
  officer.startExit(unit.fit, 1, player.position);
  officer.startBoard();
  officer.startSearch(player.position);
  officer.startReturn();
  officer.resumeChase();
  assert.equal(officer.think(1, {}), null);
  assert.equal(unit.fit.passengerInside, false);
  assert.equal(unit.driver.state, 'dentro');
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  camera.position.copy(officer.position).add(new THREE.Vector3(0, 2, 8));
  camera.lookAt(officer.position);
  const point = officer.position.clone();
  for (let i = 0; i < 60; i++) step(world, .5, { camera });
  assert.equal(unit.partner, officer);
  assert.deepEqual([officer.isDead, officer.deathSettled, officer.health, officer.state, officer.root.visible], [true, true, 0, 'dead', true]);
  assert.ok(officer.position.equals(point));
  assert.equal(count('police-arrest'), 0);
  assert.equal(count('npc-death'), 1);
});

test('el último agente caído deja la patrulla inmóvil y vacía hasta el relevo fuera de la vista', async () => {
  const world = setup({ level: 2 }), { unit, traffic, system, vehicle, player } = world;
  traffic._startChase(vehicle);
  unit._forceDriver = true;
  assert.ok(Number.isFinite(runUntil(world, () => unit.partner.onFoot && unit.driver.onFoot, 20, () => {
    if (unit.parked) unit._forceDriver = true;
  })));
  const [partner, driver] = unit.officers;
  await Promise.all([partner.ready, driver.ready]);
  for (const officer of [driver, partner]) officer._grab = { phase: 'agarre' };
  assert.equal(driver.takeHit({ damage: 200 }), 0);
  assert.equal(count('police-release'), 0, 'el acompañante todavía lo sostiene');
  assert.equal(traffic.inPursuit, true, 'el acompañante conserva su turno');
  assert.equal(partner.takeHit({ damage: 200 }), 0);
  assert.equal(count('police-release'), 1);
  assert.equal(traffic.inPursuit, false);
  const carAt = vehicle.car.position.clone();
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  player.position.copy(carAt).z += 30;
  camera.position.copy(player.position).y += 3;
  camera.lookAt(carAt);
  for (let i = 0; i < 120; i++) step(world, .5, { camera });
  traffic.endPursuit();
  for (let i = 0; i < 10; i++) step(world, .5, { camera });
  assert.equal(vehicle.state, 'uncrewed');
  assert.ok(vehicle.car.position.equals(carAt));
  assert.equal(unit.fit.passengerInside, false);
  assert.equal(vehicle.car.driverInside, false);
  assert.equal(traffic.witnessesTheft(carAt), false);
  assert.equal(traffic.alertForTheft(carAt), false);
  assert.equal(traffic.dispatchTo(carAt, carAt), false);
  assert.equal(system.active, false);
  assert.equal(world.people.length, 0);
  assert.equal(count('police-arrest'), 0);
  assert.equal(count('npc-death'), 2);
  assert.equal(count('police-escaped'), 0, 'la baja de la tripulación no anuncia un escape ni enciende la radio');
  camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 0, 20)));
  step(world, DT, { camera });
  assert.equal(partner.bodyReleased && driver.bodyReleased, true);
  for (const [fresh, fallen] of [[unit.partner, partner], [unit.driver, driver]]) {
    assert.notEqual(fresh, fallen);
    assert.notEqual(fresh.stableId, fallen.stableId);
    assert.equal(fresh.health, fresh.maxHealth);
    assert.equal(fresh.state, 'dentro');
    assert.equal(fallen.isDead, true);
  }
  assert.equal(vehicle.state, 'patrol');
  assert.equal(unit.fit.passengerInside && vehicle.car.driverInside, true);
  assert.equal(count('npc-death'), 2);
  assert.equal(count('population-changed'), 1, 'el relevo completo queda listo para guardar en ese cuadro');
  const relieved = setup({ roster: system.serializeRoster() }).unit;
  assert.deepEqual(relieved.officers.map(o => o.stableId), unit.officers.map(o => o.stableId));
  assert.deepEqual(relieved.officers.map(o => o._voz), unit.officers.map(o => o._voz));
  assert.notEqual(relieved.partner._voz, relieved.driver._voz);
  assert.ok(relieved.officers.every(o => !o.isDead));
});

test('un golpe ajeno no reabre la persecución; el guardado conserva al agente caído sin repetir el incidente', () => {
  const world = setup(), { unit, player } = world, officer = unit.partner;
  world.traffic._startChase(world.vehicle);
  assert.ok(Number.isFinite(runUntil(world, () => officer.onFoot)));
  unit._desist();
  const stranger = { position: officer.position.clone() };
  assert.equal(officer.takeHit({ damage: 150, attacker: stranger }), 0);
  assert.equal(unit.mode, 'desiste');
  assert.equal(officer.takeHit({ damage: 50, attacker: null }), 0);
  assert.equal(unit.mode, 'desiste');
  assert.equal(events.find(event => event.type === 'npc-death').detail.attacker, null);
  assert.equal(count('npc-death'), 1);
  officer.emergencyReported = true;
  officer.emergencyAided = true;
  const save = JSON.parse(JSON.stringify(world.system.serializeRoster()));
  const loaded = setup(), originalDriver = loaded.unit.driver;
  loaded.system.restoreRoster(save);
  const fallen = loaded.unit.partner;
  assert.deepEqual([fallen.stableId, fallen.health, fallen.state, fallen.deathSettled], [officer.stableId, 0, 'dead', true]);
  assert.ok(fallen.position.equals(officer.position));
  assert.equal(loaded.unit.fit.passengerInside, false);
  assert.equal(loaded.unit.driver, originalDriver);
  assert.deepEqual([fallen.emergencyReported, fallen.emergencyAided], [true, true]);
  loaded.system.restoreRoster(save);
  assert.equal(loaded.unit.partner, fallen);
  assert.equal(count('npc-death'), 1);
  // El distrito también reconstruye la flota al viajar.
  loaded.system.setup({}, loaded.traffic, loaded.people);
  const rebuilt = loaded.system.units[0];
  assert.ok(rebuilt.partner.isDead);
  assert.equal(rebuilt.partner.stableId, officer.stableId);
  assert.ok(rebuilt.partner.emergencyReported && rebuilt.partner.emergencyAided);
  assert.equal(count('npc-death'), 1);
  assert.equal(fallen.takeHit({ damage: 50, attacker: player }), false);
});

test('el compañero vivo sí puede completar el arresto cuando cae un agente', () => {
  const world = setup(), { unit, player } = world, victim = unit.partner;
  world.traffic._startChase(world.vehicle);
  assert.ok(Number.isFinite(runUntil(world, () => victim.onFoot)));
  player.position.copy(victim.position).x += .5;
  victim.takeHit({ attacker: player, damage: 200 });
  assert.equal(unit.driver.state, 'bajando');
  player.position.copy(unit.fit.doorPoint(-1)).z -= 2;
  assert.ok(Number.isFinite(runUntil(world, () => count('police-arrest') === 1, 15)));
  assert.equal(events.find(event => event.type === 'police-arrest').detail.reason, 'a-pie');
  assert.equal(victim.isDead, true);
  assert.equal(count('police-escaped'), 0);
});

test('un agente herido conserva la salud al subirse, al recargar y al salir otra vez de la patrulla', () => {
  const world = setup(), officer = world.unit.partner;
  world.traffic._startChase(world.vehicle);
  assert.ok(Number.isFinite(runUntil(world, () => officer.onFoot)));
  world.player.position.copy(officer.position).x += .5;
  assert.equal(officer.takeHit({ attacker: world.player, damage: 12, attackId: 1 }), 0);
  const roster = JSON.parse(JSON.stringify(world.system.serializeRoster()));
  assert.equal(roster.slots[officer.slot].health, 94);
  world.traffic.endPursuit();
  assert.deepEqual([officer.state, officer.health], ['dentro', 94]);
  for (const loaded of [setup({ roster }), setup()]) {
    loaded.system.restoreRoster(roster);
    const same = loaded.unit.partner;
    assert.deepEqual([same.stableId, same.health, same.state], [officer.stableId, 94, 'dentro']);
    loaded.traffic._startChase(loaded.vehicle);
    assert.ok(Number.isFinite(runUntil(loaded, () => same.onFoot)));
    assert.equal(same.health, 94);
    assert.equal(same.takeHit({ damage: 188 }), 0);
    assert.equal(same.isDead, true);
    loaded.system.restoreRoster(roster);
    assert.ok(same.isDead, 'un registro anterior a la baja no revive al mismo agente');
  }
});

test('el relevo de un solo asiento conserva la voz del compañero y toma el otro timbre policial', () => {
  const world = setup(), { unit, traffic, player } = world;
  const voice = unit.driver._voz, first = unit.partner;
  traffic._startChase(world.vehicle);
  assert.ok(Number.isFinite(runUntil(world, () => first.onFoot)));
  first.takeHit({ damage: 200 });
  traffic.endPursuit();
  player.position.x += 120;
  for (let i = 0; i < 6; i++) step(world, .5);
  assert.notEqual(unit.partner.stableId, first.stableId);
  assert.equal(unit.driver._voz, voice);
  assert.notEqual(unit.partner._voz, voice);
  const loaded = setup({ roster: world.system.serializeRoster() }).unit;
  assert.deepEqual(loaded.officers.map(o => o._voz), unit.officers.map(o => o._voz));
});

test('desmontar el sistema a pie conserva inmóvil una patrulla que perdió al conductor', () => {
  const roster = { slots: [{ generation: 0, fallen: { position: [25, 0, 1], yaw: 0 } }] };
  const world = setup({ roster }), { vehicle, system, traffic, player } = world;
  const parked = vehicle.car.position.clone();
  system.dispose();
  traffic.endPursuit();
  player.position.copy(parked);
  assert.equal(traffic.alertForTheft(parked), false);
  for (let i = 0; i < 10; i++) step(world, .5);
  assert.equal(vehicle.state, 'uncrewed');
  assert.ok(vehicle.car.position.equals(parked));
  assert.equal(count('police-arrest'), 0);
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

// ---------- el tráfico alrededor de la patrulla parada ----------

/** Un carril recto por z = `z`, de x = 0 a x = 200, hacia +X (`dx` = 1) o hacia -X (`dx` = -1). */
const street = (z, dx = 1) => ({ length: 200, sample: (d, point, direction) => {
  direction?.set(dx, 0, 0);
  return point.set(dx > 0 ? d : 200 - d, 0, z);
} });
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// ---------- la patrulla es un carro: por la calzada ----------

/**
 * La calle del circuito (z = 0) con 10 m de calzada (|z| <= 5, las baldosas de -2 a 2), andén de 4 m a cada lado (+0,12)
 * y grama más allá (+0,06). Las baldosas son de 2 m, como en Bogotá.
 */
const ROAD_EDGE = 5;
const roadType = (tx, tz) => Math.abs(tz) <= 2 ? 'road' : Math.abs(tz) <= 4 ? 'sidewalk' : 'grass';
const roadDistrict = {
  tileTypeAt: roadType,
  getGroundHeight: (x, z) => ({ road: 0, sidewalk: .12, grass: .06 })[roadType(Math.round(x / 2), Math.round(z / 2))]
};

/** Puntos del contorno y del centro de la carrocería, sin margen: dónde va el carro de verdad. */
function bodyPoints(car) {
  const yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw), points = [];
  for (const along of [-1, -.5, 0, .5, 1]) for (const across of [-1, 0, 1]) {
    const a = along * car.length / 2, s = across * car.width / 2;
    points.push([car.position.x + fx * a - fz * s, car.position.z + fz * a + fx * s]);
  }
  return points;
}
const offRoad = car => bodyPoints(car).filter(([, z]) => Math.abs(z) > ROAD_EDGE).length;

/** ¿La carrocería pisa la caja `box` (x0, z0, x1, z1)? Barre la planta del carro de a 10 cm. */
function bodyOver(car, [x0, z0, x1, z1]) {
  const yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw);
  for (let a = -car.length / 2; a <= car.length / 2 + 1e-6; a += .1) for (let s = -car.width / 2; s <= car.width / 2 + 1e-6; s += .1) {
    const x = car.position.x + fx * a - fz * s, z = car.position.z + fz * a + fx * s;
    if (x > x0 && x < x1 && z > z0 && z < z1) return true;
  }
  return false;
}

/**
 * La patrulla de vuelta a su carril, ya con todos adentro: parada en (x, z) rumbo a +X, y el punto del carril al que
 * vuelve a `back` m detrás de ella. Devuelve los segundos hasta que entra y el mayor salto de un cuadro al otro.
 */
function returnToLane(world, { x, z, back }) {
  const { vehicle, traffic } = world, car = vehicle.car;
  traffic._startChase(vehicle);
  car.position.set(x, 0, z);
  car.group.rotation.y = 0;
  traffic.endPursuit();
  vehicle.distance = vehicle.nextDistance = x - back;
  vehicle.route.sample(vehicle.distance, vehicle.rejoinTarget, new THREE.Vector3());
  const last = car.position.clone();
  let jump = 0;
  const seconds = runUntil(world, () => !vehicle.rejoinTarget, 40, () => {
    jump = Math.max(jump, Math.hypot(car.position.x - last.x, car.position.z - last.z));
    last.copy(car.position);
  });
  return { seconds, jump: Math.max(jump, Math.hypot(car.position.x - last.x, car.position.z - last.z)) };
}

const fromBody = (car, point) => {
  const yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw), dx = point.x - car.position.x, dz = point.z - car.position.z;
  return Math.hypot(Math.max(0, Math.abs(dx * fx + dz * fz) - car.length / 2), Math.max(0, Math.abs(-dx * fz + dz * fx) - car.width / 2));
};

/**
 * La patrulla frena rumbo a +X y, en cuanto el compañero abre su puerta (la de +Z), el jugador aparece a `across` m de
 * ese costado (negativo: del otro lado) y a `along` m hacia adelante. Devuelve los segundos desde que abrió la puerta
 * hasta quedar a 3 m del carro del lado del jugador, lo más que estuvo quieto y lo más cerca que pasó de la carrocería.
 */
function exitToward(level, across, along = 0) {
  const world = setup({ level, player: [60, 0] });
  world.traffic._startChase(world.vehicle);
  const officer = world.unit.partner, car = world.vehicle.car;
  let clock = 0, opened = null, clear = null, closest = Infinity, still = 0, worst = 0;
  const last = new THREE.Vector3();
  runUntil(world, () => clear !== null, 20, () => {
    clock += DT;
    if (officer.state === 'dentro') return;
    if (opened === null) {
      opened = clock;
      world.player.position.set(car.position.x + along, 0, car.position.z + Math.sign(across) * (car.width / 2 + Math.abs(across)));
    }
    if (!officer.onFoot) { last.copy(officer.position); return; }
    still = officer.position.distanceTo(last) < .3 * DT ? still + DT : 0;
    last.copy(officer.position);
    worst = Math.max(worst, still);
    closest = Math.min(closest, fromBody(car, officer.position));
    const side = (officer.position.z - car.position.z) * Math.sign(across);
    if (side > 0 && fromBody(car, officer.position) >= 3) clear = clock;
  });
  assert.equal(officer.doorSide, 1);
  assert.ok(Math.abs(car.group.rotation.y) < .2, 'la patrulla quedó rumbo a +X');
  return { seconds: clear === null ? Infinity : clear - opened, worst, closest };
}

/** El compañero ya afuera, persiguiendo y a más de 6 m de su patrulla. */
function onFootAway(world) {
  world.traffic._startChase(world.vehicle);
  exitOf(world);
  const officer = world.unit.partner;
  runUntil(world, () => officer.state === 'persecucion');
  runUntil(world, () => officer.position.distanceTo(world.vehicle.car.position) > 6, 6);
  return officer;
}

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
  // La escena empieza aquí: lo que alcanzaron a acortarle antes no cuenta para desistir por falta de avance.
  unit._gapBest = unit._gap();
  unit._gapClock = 0;
  return { world, unit, car, civilian: civilian ? world.traffic._spawn(world.scene, world.traffic.routes[0], 100 - 3.2 - 12, false) : null };
}

/** Lo mínimo del DOM para armar los menús, como en las pruebas del ropero. */
function menuDocument() {
  const node = tag => ({
    tag, className: '', textContent: '', children: [], attributes: {}, style: {}, dataset: {},
    addEventListener(type, listener) { this[`on${type}`] = listener; }, removeEventListener() {},
    setAttribute(key, value) { this.attributes[key] = value; },
    append(...items) { for (const item of items) { if (typeof item === 'string') this.textContent += item; this.children.push(item); } },
    appendChild(item) { this.children.push(item); return item; }, prepend() {}, replaceChildren(...items) { this.children = items; },
    querySelector: () => null, querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} })
  });
  return { createElement: node, createElementNS: (_, tag) => node(tag), getElementById: () => null, activeElement: null };
}
