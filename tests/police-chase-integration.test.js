import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { POLICE_CHASE_TIMEOUT } from '../src/utils/constants.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');

beforeEach(() => { globalThis.window = new EventTarget(); });

function setup(environment = {}) {
  const collisions = new CollisionSystem();
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40)],
    { carsPerRoute: 0, policeCount: 1, random: () => .2 });
  traffic.setEnvironment({ collisions, getGroundHeight: (_x, _z, y) => y, ...environment });
  const vehicle = traffic.vehicles[0];
  vehicle.car.position.set(0, 0, 0);
  vehicle.car.group.rotation.y = 0;
  let arrests = 0, escapes = 0;
  window.addEventListener('police-arrest', () => arrests++);
  window.addEventListener('police-escaped', () => escapes++);
  return { traffic, vehicle, collisions, get arrests() { return arrests; }, get escapes() { return escapes; } };
}

function wall(collisions, min, max) {
  const entry = { box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)) };
  collisions.colliders.push(entry);
  return entry;
}

test('captura una sola vez a corta distancia y misma planta, ignorando su propia carrocería', () => {
  const setupState = setup();
  const { traffic, vehicle, collisions } = setupState;
  collisions.setVehicles([vehicle.car]);
  assert.equal(traffic.alertForTheft(new THREE.Vector3(2.6, .2, 0)), true);
  for (let i = 0; i < 10; i++) traffic.update(.1, { player: new THREE.Vector3(2.6, .2, 0) });
  assert.equal(setupState.arrests, 1);
  traffic.dispose();
});

test('una patrulla bajo el viaducto no presencia ni captura al jugador sobre el tablero', () => {
  const state = setup({ getGroundHeight: (_x, _z, currentY) => currentY > 7 ? 7.82 : 0 });
  const { traffic, vehicle } = state;
  const player = new THREE.Vector3(.5, 7.82, 0);
  assert.equal(traffic.witnessesTheft(player), false);
  traffic._startChase(vehicle);
  for (let i = 0; i < 60; i++) traffic.update(.1, { player });
  assert.equal(state.arrests, 0);
  assert.equal(vehicle.car.position.y, 0);
  traffic.dispose();
});

test('un muro entre patrulla y jugador impide avistar el robo y capturar aunque estén cerca', () => {
  const state = setup();
  const { traffic, vehicle, collisions } = state;
  wall(collisions, [2.35, 0, -30], [2.55, 4, 30]);
  const player = new THREE.Vector3(2.9, 0, 0);
  assert.equal(traffic.witnessesTheft(player), false);
  traffic._startChase(vehicle);
  for (let i = 0; i < 10; i++) traffic.update(.1, { player });
  assert.equal(state.arrests, 0);
  assert.ok(vehicle.car.position.x < 2.35);
  traffic.dispose();
});

test('la persecución no entra al agua ni salta al lecho del lago para alcanzar al nadador', () => {
  const water = x => x >= 5 ? { surfaceY: -.18, bottomY: -3, depth: 2.82 } : null;
  const state = setup({ getWaterInfo: water, getGroundHeight: x => water(x) ? -3 : 0 });
  const { traffic, vehicle } = state;
  traffic._startChase(vehicle);
  for (let i = 0; i < 180; i++) {
    traffic.update(.1, { player: new THREE.Vector3(18, -1, 0) });
    const car = vehicle.car;
    const halfX = Math.abs(Math.cos(car.group.rotation.y)) * car.length / 2 + Math.abs(Math.sin(car.group.rotation.y)) * car.width / 2;
    assert.ok(car.position.x + halfX < 5, 'toda la carrocería permanece en tierra');
    assert.equal(car.position.y, 0);
  }
  assert.equal(state.arrests, 0);
  traffic.dispose();
});

test('el puente permite perseguir y capturar en el mismo tablero aunque haya agua debajo', () => {
  const state = setup({ getGroundHeight: () => 7.82,
    getWaterInfo: () => ({ surfaceY: -.18, bottomY: -6.18, depth: 6 }) });
  const { traffic, vehicle, collisions } = state;
  vehicle.car.position.y = 7.82;
  wall(collisions, [-20, 7.76, -10], [40, 7.82, 10]);
  const player = new THREE.Vector3(10, 7.82, 0);
  traffic._startChase(vehicle);
  for (let i = 0; i < 100 && !state.arrests; i++) traffic.update(.1, { player });
  assert.equal(state.arrests, 1);
  assert.equal(vehicle.car.position.y, 7.82);
  traffic.dispose();
});

test('no captura dentro del agua somera aunque el desnivel sea menor de 85 centímetros', () => {
  const state = setup({ getWaterInfo: x => x > 2 ? { surfaceY: 0, bottomY: -.2, depth: .2 } : null });
  const { traffic, vehicle } = state;
  traffic._startChase(vehicle);
  traffic.update(.1, { player: new THREE.Vector3(2.8, -.1, 0) });
  assert.equal(state.arrests, 0);
  traffic.dispose();
});

test('el barrido no atraviesa un muro fino durante un fotograma lento a velocidad de persecución', () => {
  const state = setup();
  const { traffic, vehicle, collisions } = state;
  wall(collisions, [5, 0, -100], [5.05, 4, 100]);
  traffic._startChase(vehicle);
  vehicle.speed = 7.5;
  for (let i = 0; i < 20; i++) {
    traffic.update(.5, { player: new THREE.Vector3(18, 0, 0) });
    const car = vehicle.car;
    const halfX = Math.abs(Math.cos(car.group.rotation.y)) * car.length / 2 + Math.abs(Math.sin(car.group.rotation.y)) * car.width / 2;
    assert.ok(car.position.x + halfX < 5);
  }
  assert.equal(state.arrests, 0);
  traffic.dispose();
});

test('la patrulla rodea un obstáculo pequeño y continúa la persecución', () => {
  const state = setup();
  const { traffic, vehicle, collisions } = state;
  const obstacle = wall(collisions, [6, 0, -1.5], [10, 4, 1.5]);
  traffic._startChase(vehicle);
  const player = new THREE.Vector3(18, 0, 0);
  let detoured = false;
  for (let i = 0; i < 300 && !state.arrests; i++) {
    traffic.update(.1, { player });
    collisions.setVehicles([vehicle.car]);
    assert.equal(collisions.dynamicColliders[0].box.intersectsBox(obstacle.box), false);
    detoured ||= Math.abs(vehicle.car.position.z) > 2.5;
  }
  assert.equal(detoured, true);
  assert.equal(state.arrests, 1);
  traffic.dispose();
});

test('la persecución respeta el volumen de los vehículos y del bus sin cambiar su prioridad', () => {
  const state = setup();
  const { traffic, vehicle, collisions } = state;
  const bus = { position: new THREE.Vector3(6, 0, 0), width: 2, length: 20,
    group: new THREE.Group() };
  bus.group.position.copy(bus.position);
  collisions.setVehicles([vehicle.car], bus);
  traffic._startChase(vehicle);
  vehicle.speed = 7.5;
  for (let i = 0; i < 30; i++) {
    traffic.update(.1, { player: new THREE.Vector3(20, 0, 0) });
    collisions.setVehicles([vehicle.car], bus);
    // Con el coche girando su caja es orientada: sus envolventes pueden tocarse sin que los cuerpos se toquen.
    assert.equal(collisions.dynamicColliders[1].box.containsPoint(vehicle.car.position), false);
    assert.equal(collisions.dynamicColliders[0].box.containsPoint(bus.position), false);
  }
  assert.equal(state.arrests, 0);
  assert.equal(bus.position.x, 6);
  traffic.dispose();
});

test('al vencer el tiempo de persecución escapa sin teletransportar la patrulla al otro lado de un muro', () => {
  const state = setup();
  const { traffic, vehicle, collisions } = state;
  vehicle.car.position.set(10, 0, 8);
  wall(collisions, [5, 0, 3], [15, 4, 4]);
  traffic._startChase(vehicle);
  vehicle.chaseTime = POLICE_CHASE_TIMEOUT - .01;
  const before = vehicle.car.position.clone();
  traffic.update(.1, { player: new THREE.Vector3(15, 0, 8) });
  assert.equal(state.escapes, 1);
  assert.equal(traffic.inPursuit, false);
  assert.ok(vehicle.car.position.distanceTo(before) < .2);
  assert.ok(vehicle.rejoinTarget, 'vuelve al carril mediante movimiento comprobado');
  traffic.dispose();
});

test('el regreso desde una calle despejada alcanza el carril caminando su recorrido y reanuda la ronda', () => {
  const { traffic, vehicle } = setup();
  vehicle.car.position.set(10, 0, 8);
  traffic._startChase(vehicle);
  traffic.endPursuit();
  assert.ok(vehicle.rejoinTarget);
  const previous = vehicle.car.position.clone();
  for (let i = 0; i < 200 && vehicle.rejoinTarget; i++) {
    traffic.update(.1);
    assert.ok(vehicle.car.position.distanceTo(previous) <= .8, 'sin salto de vuelta al carril');
    previous.copy(vehicle.car.position);
  }
  assert.equal(vehicle.rejoinTarget, null);
  const distance = vehicle.distance;
  for (let i = 0; i < 20; i++) traffic.update(.1);
  assert.notEqual(vehicle.distance, distance);
  traffic.dispose();
});

test('la persecución no asciende de golpe a un tablero alto aunque el destino esté encima', () => {
  const state = setup({ getGroundHeight: x => x > 5 ? 7.82 : 0 });
  const { traffic, vehicle } = state;
  traffic._startChase(vehicle);
  for (let i = 0; i < 100; i++) {
    traffic.update(.1, { player: new THREE.Vector3(12, 7.82, 0) });
    assert.equal(vehicle.car.position.y, 0);
    assert.ok(vehicle.car.position.x < 5);
  }
  assert.equal(state.arrests, 0);
  traffic.dispose();
});

test('las consultas de persecución no cambian velocidades ni rutas del patrullaje normal', () => {
  const a = setup(), b = setup();
  a.traffic.environment = null;
  b.traffic.setEnvironment({ getWaterInfo() { throw new Error('No consultar agua al patrullar'); },
    getGroundHeight() { throw new Error('No consultar suelo al patrullar'); } });
  for (let i = 0; i < 100; i++) { a.traffic.update(.1); b.traffic.update(.1); }
  assert.equal(a.vehicle.distance, b.vehicle.distance);
  assert.equal(a.vehicle.speed, b.vehicle.speed);
  assert.ok(a.vehicle.car.position.equals(b.vehicle.car.position));
  a.traffic.dispose(); b.traffic.dispose();
});

test('detrás de un muro la patrulla va adonde lo vio por última vez y, sin verlo, lo da por perdido', () => {
  const state = setup();
  const { traffic, vehicle, collisions } = state;
  let reason = null;
  window.addEventListener('police-escaped', e => { reason = e.detail?.reason; });
  traffic.alertForTheft(new THREE.Vector3(8, 0, 0));
  traffic.update(.1, { player: new THREE.Vector3(8, 0, 0) });
  // Se mete detrás de un muro largo: la patrulla deja de verlo.
  wall(collisions, [10, 0, -30], [10.4, 4, 30]);
  const player = new THREE.Vector3(14, 0, 0);
  let sinVer = 0;
  for (let i = 0; i < 200 && traffic.inPursuit; i++) {
    traffic.update(.1, { player });
    if (traffic.pursuitInfo?.seen === false) sinVer++;
  }
  assert.ok(sinVer > 0, 'el aviso sabe que no lo ven');
  assert.equal(traffic.inPursuit, false);
  assert.equal(state.arrests, 0);
  assert.equal(reason, 'vista');
  assert.ok(vehicle.car.position.x < 10, 'no atraviesa el muro');
  traffic.dispose();
});

test('cuanto más fichado, más aguanta sin verlo y más lejos persigue', () => {
  const { traffic } = setup();
  const base = { lost: traffic.lostSightSeconds, range: traffic.giveUpRange, time: traffic.chaseTimeout };
  traffic.wantedLevel = 3;
  assert.ok(traffic.lostSightSeconds > base.lost);
  assert.ok(traffic.giveUpRange > base.range);
  assert.ok(traffic.chaseTimeout > base.time);
  assert.equal(traffic.maxChasers, 3);
  traffic.wantedLevel = 1;
  assert.equal(traffic.maxChasers, 1);
  traffic.dispose();
});

test('escondido en el cambuche no lo capturan aunque la patrulla llegue encima', () => {
  const state = setup();
  const { traffic } = state;
  let reason = null;
  window.addEventListener('police-escaped', e => { reason = e.detail?.reason; });
  const player = new THREE.Vector3(6, 0, 0);
  traffic.alertForTheft(player);
  for (let i = 0; i < 200 && traffic.inPursuit; i++) traffic.update(.1, { player, playerHidden: true });
  assert.equal(state.arrests, 0);
  assert.equal(traffic.inPursuit, false);
  assert.equal(reason, 'escondido');
  traffic.dispose();
});

test('con nivel 2 la patrulla que lo ve pide refuerzos por radio a la libre más cercana', () => {
  const collisions = new CollisionSystem();
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 80, 0, 80)],
    { carsPerRoute: 0, policeCount: 2, random: () => .2 });
  traffic.setEnvironment({ collisions, getGroundHeight: (_x, _z, y) => y });
  const [first, second] = traffic.vehicles;
  first.car.position.set(0, 0, 0); first.car.group.rotation.y = 0;
  second.car.position.set(40, 0, 30);
  let radios = 0;
  window.addEventListener('police-radio', () => radios++);
  traffic.wantedLevel = 2;
  const player = new THREE.Vector3(30, 0, 0);
  traffic._startChase(first);
  for (let i = 0; i < 30; i++) traffic.update(.1, { player });
  assert.equal(radios, 1);
  assert.equal(second.state, 'chase');
  // Con nivel 1 no hay refuerzo.
  traffic.endPursuit();
  traffic.wantedLevel = 1;
  traffic._startChase(first);
  for (let i = 0; i < 30; i++) traffic.update(.1, { player });
  assert.equal(radios, 1);
  traffic.dispose();
});

test('la llamada de un testigo manda la patrulla al sitio y, si no lo ve allá, desiste', () => {
  const state = setup();
  const { traffic, vehicle, collisions } = state;
  let reason = null;
  window.addEventListener('police-escaped', e => { reason = e.detail?.reason; });
  wall(collisions, [-30, 0, 9.6], [30, 4, 10]);
  assert.equal(traffic.dispatchTo(new THREE.Vector3(15, 0, 0)), true);
  assert.equal(vehicle.state, 'chase');
  const player = new THREE.Vector3(15, 0, 14); // ya se fue detrás del muro
  for (let i = 0; i < 200 && traffic.inPursuit; i++) traffic.update(.1, { player });
  assert.equal(state.arrests, 0);
  assert.equal(reason, 'vista');
  assert.ok(vehicle.car.position.x > 5, 'alcanzó a ir hacia la llamada');
  traffic.dispose();
});
