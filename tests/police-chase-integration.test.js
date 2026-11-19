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
    assert.equal(collisions.dynamicColliders[0].box.intersectsBox(collisions.dynamicColliders[1].box), false);
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

test('la llamada de un testigo manda la patrulla libre más cercana al sitio y, si no lo encuentra, desiste', () => {
  const state = setup();
  const { traffic, vehicle, collisions } = state;
  wall(collisions, [-30, 0, 9.6], [30, 4, 10]);
  assert.equal(traffic.dispatchTo(new THREE.Vector3(15, 0, 0)), true);
  assert.equal(vehicle.state, 'chase');
  assert.equal(traffic.dispatchTo(new THREE.Vector3(15, 0, 0)), false, 'no manda otra mientras ya persigue');
  const player = new THREE.Vector3(15, 0, 14); // ya se fue detrás del muro
  for (let i = 0; i < 600 && traffic.inPursuit; i++) traffic.update(.1, { player });
  assert.equal(state.arrests, 0);
  assert.equal(traffic.inPursuit, false, 'desistió');
  assert.equal(state.escapes, 1);
  traffic.dispose();
});

test('una llamada lejos de toda patrulla no manda a nadie', () => {
  const { traffic, vehicle } = setup();
  assert.equal(traffic.dispatchTo(new THREE.Vector3(500, 0, 500)), false);
  assert.equal(vehicle.state, 'patrol');
  traffic.dispose();
});

test('la llamada alcanza hasta 55 m, salta a la patrulla que está parada y escoge la más cercana', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40)],
    { carsPerRoute: 0, policeCount: 2, random: () => .2 });
  traffic.setEnvironment({ collisions: new CollisionSystem(), getGroundHeight: (_x, _z, y) => y });
  const [cerca, lejos] = traffic.vehicles;
  cerca.car.position.set(10, 0, 0);
  lejos.car.position.set(30, 0, 0);
  assert.equal(traffic.dispatchTo(new THREE.Vector3(85, 0, 0)), false, 'a 55 m o más no llega');
  assert.equal(traffic.dispatchTo(new THREE.Vector3(84, 0, 0)), true, 'a 54 m sí');
  assert.equal(lejos.state, 'chase');
  assert.equal(cerca.state, 'patrol', 'sale una sola');
  traffic.endPursuit();
  for (const v of traffic.vehicles) { v.state = 'patrol'; v.rejoinTarget = null; }
  cerca.hold = true; // un conductor bravo la tiene parada
  assert.equal(traffic.dispatchTo(new THREE.Vector3(0, 0, 0)), true);
  assert.equal(cerca.state, 'patrol', 'la que está quieta no sale');
  assert.equal(lejos.state, 'chase');
  traffic.endPursuit();
  for (const v of traffic.vehicles) { v.state = 'patrol'; v.rejoinTarget = null; }
  cerca.hold = false;
  assert.equal(traffic.dispatchTo(new THREE.Vector3(0, 0, 0)), true);
  assert.equal(cerca.state, 'chase', 'libres las dos, la más cercana');
  assert.equal(lejos.state, 'patrol');
  traffic.dispose();
});

test('la llamada no manda una segunda patrulla mientras otra persigue, ni una que el jugador ya dejó atrás', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40)],
    { carsPerRoute: 0, policeCount: 2, random: () => .2 });
  traffic.setEnvironment({ collisions: new CollisionSystem(), getGroundHeight: (_x, _z, y) => y });
  const [una, otra] = traffic.vehicles;
  una.car.position.set(10, 0, 0);
  otra.car.position.set(30, 0, 0);
  let escapes = 0;
  window.addEventListener('police-escaped', () => escapes++);
  // El jugador ya corrió 80 m desde el sitio de la llamada: ninguna patrulla alcanzaría a perseguirlo.
  assert.equal(traffic.dispatchTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-80, 0, 0)), false);
  for (let i = 0; i < 20; i++) traffic.update(.1, { player: new THREE.Vector3(-80, 0, 0) });
  assert.equal(escapes, 0, 'ningún «los despisté» por una persecución que no hubo');
  assert.equal(traffic.dispatchTo(new THREE.Vector3(0, 0, 0)), true);
  assert.equal(una.state, 'chase');
  assert.equal(traffic.dispatchTo(new THREE.Vector3(30, 0, 0)), false, 'ya lo están buscando');
  assert.equal(otra.state, 'patrol');
  traffic.dispose();
});

function patrolsForEmergency(t, distances = [2]) {
  const route = new TrafficRoute(0, 80, 0, 55, 3);
  const traffic = new TrafficSystem(new THREE.Scene(), [route],
    { carsPerRoute: 0, policeCount: distances.length, random: () => .2 });
  t.after(() => traffic.dispose());
  const collisions = new CollisionSystem();
  traffic.setEnvironment({ collisions, getGroundHeight: (_x, _z, y) => y });
  const direction = new THREE.Vector3();
  for (const [i, patrol] of traffic.vehicles.entries()) {
    patrol.distance = patrol.nextDistance = distances[i];
    route.sample(distances[i], patrol.car.position, direction);
    patrol.car.group.rotation.y = Math.atan2(-direction.z, direction.x);
  }
  const position = new THREE.Vector3(35, .12, 4);
  return { traffic, collisions, call: { position, victim: { position: position.clone() }, accusedPlayer: false } };
}

test('el 123 sin acusación manda una sola patrulla por su carril, prende estacionarias al llegar y retoma la ronda', t => {
  const { traffic, collisions, call } = patrolsForEmergency(t, [2, 100]);
  const [patrol, other] = traffic.vehicles;
  patrol.speed = 6;
  traffic.wantedLevel = 2;
  let arrests = 0, escapes = 0;
  window.addEventListener('police-arrest', () => arrests++);
  window.addEventListener('police-escaped', () => escapes++);
  const context = { player: new THREE.Vector3(35, 0, 2.5) };
  collisions.setVehicles(traffic.vehicles.map(v => v.car));
  assert.equal(traffic.respondToEmergency(call), true);
  const response = traffic.emergencyResponse;
  assert.equal(response.vehicle, patrol);
  assert.equal(traffic.respondToEmergency(call), false);
  const sample = new THREE.Vector3(), direction = new THREE.Vector3();
  for (let i = 0; i < 300 && !response.onScene; i++) {
    const before = patrol.car.position.clone(), speed = patrol.speed;
    traffic.update(.1, context);
    collisions.setVehicles(traffic.vehicles.map(v => v.car));
    patrol.route.sample(patrol.distance, sample, direction);
    assert.ok(patrol.car.position.distanceTo(sample) < 1e-6);
    assert.ok(patrol.car.position.distanceTo(before) <= patrol.cruiseSpeed * .1 + 1e-6);
    assert.ok(speed - patrol.speed < .5, 'frena gradualmente');
    assert.equal(traffic.pursuitInfo, null);
  }
  assert.equal(response.onScene, true);
  assert.equal(patrol.speed, 0);
  assert.ok(patrol.car.position.distanceTo(call.position) < 8);
  assert.equal(patrol.car._turnSignal, 'hazard');
  assert.equal(other.car.pursuit, false);
  assert.equal(patrol.car.pursuit, false);
  const stopped = patrol.car.position.clone();
  const { left, right } = patrol.car.vehicle.signalMaterials, brightness = new Set();
  for (let i = 0; i < 40; i++) {
    traffic.update(.1, context);
    assert.equal(left.emissiveIntensity, right.emissiveIntensity);
    brightness.add(left.emissiveIntensity);
  }
  assert.equal(brightness.size, 2, 'las dos luces de parqueo se encienden y apagan juntas');
  assert.ok(patrol.car.position.equals(stopped));
  assert.equal(traffic.respondToEmergency(call), false, 'sigue atendiendo');
  for (let i = 0; i < 55; i++) traffic.update(.1, context);
  assert.equal(traffic.emergencyResponse, null);
  assert.ok(patrol.car.position.distanceTo(stopped) > 1);
  assert.notEqual(patrol.car._turnSignal, 'hazard');
  assert.deepEqual([arrests, escapes, traffic.wantedLevel], [0, 0, 2]);
});

test('la patrulla atascada respeta el semáforo y no da el auxilio por atendido ni salta aunque esté fuera de vista', t => {
  const { traffic, call } = patrolsForEmergency(t);
  const [patrol] = traffic.vehicles, initial = patrol.car.position.clone();
  traffic.signals = { blocks: () => true };
  patrol.stoppedFor = 60;
  assert.equal(traffic.respondToEmergency(call), true);
  const response = traffic.emergencyResponse;
  for (let i = 0; i < 84; i++) traffic.update(.5, { player: new THREE.Vector3(600, 0, 600) });
  assert.ok(patrol.car.position.equals(initial));
  assert.equal(response.onScene, false);
  assert.equal(traffic.emergencyResponse, null);
  assert.equal(traffic.inPursuit, false);
});

test('el aviso necesita paso por su ruta y visión del incidente desde la misma planta y fuera del cruce', t => {
  const { traffic, collisions, call } = patrolsForEmergency(t);
  wall(collisions, [0, 0, 2], [80, 4, 2.2]);
  assert.equal(traffic.respondToEmergency(call), false, 'un muro separa el carril del incidente');
  collisions.clear();
  wall(collisions, [18, 0, -4], [18.1, 4, 4]);
  assert.equal(traffic.respondToEmergency(call), false, 'un muro atraviesa el recorrido antes de la parada');
  collisions.clear();
  assert.equal(traffic.respondToEmergency({ ...call, position: new THREE.Vector3(35, 7.82, 4) }), false);
  traffic.environment.getGroundHeight = x => x > 14 && x < 20 ? 7.82 : 0;
  assert.equal(traffic.respondToEmergency(call), false, 'una cota inalcanzable en el trayecto');
  traffic.environment.getGroundHeight = () => 0;
  traffic.signals = { nodes: [{ x0: 22, x1: 48, z0: -3, z1: 3 }] };
  assert.equal(traffic.respondToEmergency(call), false, 'los únicos puntos a la vista quedan dentro del cruce');
  traffic.signals = null;
  assert.equal(traffic.respondToEmergency(call), true);
  call.victim.position.y = 7.82;
  const response = traffic.emergencyResponse;
  for (let i = 0; i < 100 && traffic.emergencyResponse; i++) traffic.update(.5);
  assert.equal(response.onScene, false, 'comprueba que todavía ve a la víctima al llegar');
});

test('la llamada acusatoria queda para la denuncia y una persecución real tiene prioridad sobre el auxilio', t => {
  const { traffic, call } = patrolsForEmergency(t, [2, 100]);
  assert.equal(traffic.respondToEmergency({ ...call, accusedPlayer: true }), false);
  assert.equal(traffic.respondToEmergency(call), true);
  const [responding, other] = traffic.vehicles;
  assert.equal(traffic.dispatchTo(other.car.position), true);
  assert.equal(other.state, 'chase');
  assert.equal(responding.state, 'patrol');
  assert.equal(traffic.emergencyResponse, null);
  assert.equal(traffic.respondToEmergency(call), false);
});

test('si la persona cayó en el carril la patrulla para antes del cuerpo y puede ver un robo desde allí', t => {
  const { traffic, call } = patrolsForEmergency(t);
  call.victim.position.z = call.position.z = 0;
  const [patrol] = traffic.vehicles;
  assert.equal(traffic.respondToEmergency(call), true);
  const response = traffic.emergencyResponse;
  for (let i = 0; i < 300 && !response.onScene; i++) traffic.update(.1, { pedestrians: [call.victim] });
  assert.equal(response.onScene, true);
  assert.ok(patrol.car.position.x + patrol.car.length / 2 < call.position.x - .8);
  assert.equal(patrol.car._turnSignal, 'hazard');
  assert.equal(traffic.alertForTheft(patrol.car.position.clone().add(new THREE.Vector3(3, 0, 2))), true);
  assert.equal(traffic.inPursuit, true);
  assert.equal(traffic.emergencyResponse, null);
  assert.equal(patrol.car._turnSignal, null);
});

test('sin patrulla libre el aviso permanece civil, también cuando la unidad espera un conductor de relevo', t => {
  const { traffic, call } = patrolsForEmergency(t);
  const [patrol] = traffic.vehicles;
  patrol.crew = { awaitingDriver: true };
  assert.equal(traffic.respondToEmergency(call), false);
  patrol.crew = null;
  patrol.hold = true;
  assert.equal(traffic.respondToEmergency(call), false);
  patrol.hold = false;
  patrol.rejoinTarget = new THREE.Vector3();
  assert.equal(traffic.respondToEmergency(call), false);
  const empty = patrolsForEmergency(t, []);
  assert.equal(empty.traffic.respondToEmergency(empty.call), false);
});
