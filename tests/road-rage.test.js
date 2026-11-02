import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

// La IA, el tráfico y los carros son reales; solo se sustituye la carga de modelos GLB.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const textures = await import('../src/world/bogota/textures.js');
mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { RoadRageSystem } = await import('../src/systems/RoadRageSystem.js');
const { ROAD_RAGE } = await import('../src/entities/AngryDriver.js');
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { TrafficRoute } = await import('../src/world/bogota/TrafficRoute.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');
const { Car } = await import('../src/entities/Car.js');
const { StatsSystem } = await import('../src/systems/StatsSystem.js');
const { PLAYER_SPEED_WALK, PLAYER_SPEED_RUN } = await import('../src/utils/constants.js');

let toasts;
beforeEach(() => {
  globalThis.window = new EventTarget();
  toasts = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
});

function setup({ random = () => 0 } = {}) {
  const scene = new THREE.Scene();
  const traffic = new TrafficSystem(scene, [new TrafficRoute(0, 200, 0, 200, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0];
  const player = {
    position: new THREE.Vector3(), isStunned: false, hits: 0,
    receiveHit() { this.hits++; }
  };
  const stats = new StatsSystem();
  const people = [];
  const system = new RoadRageSystem(scene, { player, stats, random });
  system.setup({ isWalkableAt: () => true, getGroundHeight: () => 0 }, traffic, people);
  return { system, traffic, vehicle, player, stats, people };
}

/** Lleva el carro a velocidad de crucero; el tráfico no considera al jugador en estas pruebas. */
function cruise(traffic, player, seconds = 6) {
  for (let t = 0; t < seconds; t += 1 / 30) traffic.update(1 / 30);
}

function run(system, traffic, player, seconds, step = 1 / 30) {
  for (let t = 0; t < seconds; t += step) {
    traffic.update(step);
    system.update(step);
  }
}

/** Roba el espejo y espera a que el conductor se baje, con el jugador cerca del carro. */
function triggerAndExit(system, traffic, vehicle, player) {
  system.trigger(vehicle.car);
  for (let t = 0; t < 12 && system.state !== 'out'; t += 1 / 30) {
    player.position.copy(vehicle.car.position).add(new THREE.Vector3(6, 0, 6));
    traffic.update(1 / 30);
    system.update(1 / 30);
  }
}

/** Carro detenido por el robo, aún con el conductor adentro, y sus dos puertas libres de obstáculos. */
function stoppedWithCollisions() {
  const scene = new THREE.Scene();
  const traffic = new TrafficSystem(scene, [new TrafficRoute(0, 200, 0, 200, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0];
  const player = { position: new THREE.Vector3(), isStunned: false, hits: 0, receiveHit() { this.hits++; } };
  const collisions = new CollisionSystem();
  const system = new RoadRageSystem(scene, { player, stats: new StatsSystem(), random: () => 0 });
  system.setup({ isWalkableAt: () => true, getGroundHeight: () => 0 }, traffic, [], { collisions });
  return { scene, traffic, vehicle, player, collisions, system };
}

function stopNearPlayer({ traffic, vehicle, system, player }) {
  for (let t = 0; t < 6; t += 1 / 30) traffic.update(1 / 30);
  system.trigger(vehicle.car);
  for (let t = 0; t < 12 && vehicle.speed > .01; t += 1 / 30) {
    traffic.update(1 / 30);
    player.position.copy(vehicle.car.position).add(new THREE.Vector3(5, 0, 5));
  }
  assert.ok(vehicle.speed <= .01);
}

test('si la puerta da contra un parqueado, se baja por el otro lado, persigue y regresa por ahí', () => {
  const world = stoppedWithCollisions(), { traffic, vehicle, player, collisions, system, scene } = world;
  stopNearPlayer(world);
  const car = vehicle.car, normalSide = car.vehicle.driverDoor.side;
  const blocked = car.driverDoor(), free = car.driverDoor(new THREE.Vector3(), -normalSide);
  assert.ok(blocked.distanceTo(free) > car.width, 'son las dos puertas');
  // Un parqueado de verdad sobre la puerta: es una caja dinámica, igual que en el juego.
  const parked = new Car(scene, blocked.clone(), car.group.rotation.y, { kind: 'carro', model: 'citadino', variant: 3 });
  collisions.setVehicles([parked]);
  player.position.copy(free).add(new THREE.Vector3(8, 0, 8).setLength(9));
  system.update(1 / 30);
  assert.equal(system.state, 'out');
  // En el mismo cuadro ya dio el primer paso de la persecución.
  const start = system.driver.position.clone();
  assert.ok(start.distanceTo(free) < .3, `salió en ${start.toArray()} y la puerta libre es ${free.toArray()}`);
  assert.ok(toasts.some(text => /varilla/.test(text)));

  run(system, traffic, player, 1);
  assert.ok(system.driver.position.distanceTo(start) > 2, 'no quedó encerrado: camina');
  assert.ok(system.driver.position.distanceTo(player.position) < start.distanceTo(player.position), 'y persigue');

  // Se aburre y vuelve a la misma puerta, no a la que está tapada.
  player.position.copy(free).add(new THREE.Vector3(60, 0, 60));
  run(system, traffic, player, 2);
  assert.equal(system.driver.state, 'return');
  let walked = 0;
  while (system.state !== 'idle' && walked < ROAD_RAGE.returnTimeout + 1) { traffic.update(1 / 30); system.update(1 / 30); walked += 1 / 30; }
  assert.equal(system.state, 'idle');
  // Hacia la puerta tapada el carro le corta el paso y solo subiría al agotar el tope.
  assert.ok(walked < ROAD_RAGE.returnTimeout / 2, `tardó ${walked.toFixed(1)} s en subir`);
  assert.equal(vehicle.hold, false, 'y el carro sigue');
  parked.dispose();
});

test('con la puerta libre se baja por donde corresponde a su modelo', () => {
  const world = stoppedWithCollisions(), { vehicle, player, system } = world;
  stopNearPlayer(world);
  system.update(1 / 30);
  assert.equal(system.state, 'out');
  assert.equal(system._doorSide, vehicle.car.vehicle.driverDoor.side);
  assert.ok(system.driver.position.distanceTo(vehicle.car.driverDoor()) < .3);
});

test('si frena tan lejos que no alcanzaría al jugador, no se baja ni avisa, y el carro sigue', () => {
  const world = stoppedWithCollisions(), { traffic, vehicle, player, system } = world;
  stopNearPlayer(world);
  toasts.length = 0;
  player.position.copy(vehicle.car.driverDoor()).add(new THREE.Vector3(0, 0, ROAD_RAGE.giveUpDistance));
  system.update(1 / 30);
  assert.equal(system.state, 'idle');
  assert.equal(system.driver.active, false, 'nunca se bajó');
  assert.deepEqual(toasts, [], 'ni la varilla ni el que se rindió');
  assert.equal(vehicle.hold, false);
  assert.equal(vehicle.car.driver.visible, true, 'sigue sentado');
  for (let t = 0; t < 3; t += 1 / 30) traffic.update(1 / 30);
  assert.ok(vehicle.speed > 1, `${vehicle.speed}`);
});

test('justo dentro del alcance sí se baja y persigue', () => {
  const world = stoppedWithCollisions(), { vehicle, player, system } = world;
  stopNearPlayer(world);
  toasts.length = 0;
  player.position.copy(vehicle.car.driverDoor()).add(new THREE.Vector3(0, 0, ROAD_RAGE.giveUpDistance - 1));
  system.update(1 / 30);
  assert.equal(system.state, 'out');
  assert.equal(system.driver.state, 'chase');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /varilla/);
});

test('los carros en circulación llevan conductor visible y los estacionados no', () => {
  const { vehicle } = setup();
  assert.ok(vehicle.car.driver);
  assert.equal(vehicle.car.driver.visible, true);
  // Del lado izquierdo del carro, como en Colombia (frente hacia +X local).
  assert.ok(vehicle.car.driver.position.z < 0);
});

test('el carro frena gradualmente al retenerlo y sigue su ruta al liberarlo', () => {
  const { traffic, vehicle, player } = setup();
  cruise(traffic, player);
  const speed = vehicle.speed;
  assert.ok(speed > 5);
  traffic.hold(vehicle.car, true);
  traffic.update(.1);
  assert.ok(vehicle.speed > speed * .8, 'no se detiene de golpe');
  for (let t = 0; t < 12; t += 1 / 30) traffic.update(1 / 30);
  assert.ok(vehicle.speed < .05, `${vehicle.speed}`);
  traffic.hold(vehicle.car, false);
  for (let t = 0; t < 3; t += 1 / 30) traffic.update(1 / 30);
  assert.ok(vehicle.speed > 1);
});

test('solo a veces, solo en carros en circulación y un conductor a la vez', () => {
  const lucky = setup({ random: () => .99 });
  assert.equal(lucky.system.trigger(lucky.vehicle.car), false);
  const { system, vehicle } = setup();
  assert.equal(system.trigger({ traffic: false }), false);
  assert.equal(system.trigger(vehicle.car), true);
  assert.equal(vehicle.hold, true);
  assert.equal(system.trigger(vehicle.car), false);
});

test('se baja cuando el carro se detiene, persigue más rápido que caminar y más lento que correr', () => {
  const { system, traffic, vehicle, player, people } = setup();
  cruise(traffic, player);
  system.trigger(vehicle.car);
  system.update(1 / 30);
  assert.equal(system.driver.active, false, 'espera a que el carro se detenga');
  triggerAndExit(system, traffic, vehicle, player);
  assert.equal(system.state, 'out');
  assert.ok(vehicle.speed < .05, `${vehicle.speed}`);
  assert.equal(vehicle.car.driver.visible, false);
  assert.ok(people.includes(system.driver), 'los carros lo respetan como peatón');
  assert.ok(toasts.some(text => /varilla/.test(text)));

  // El jugador queda a 20 m: en un segundo el conductor recorre su velocidad de persecución.
  const driver = system.driver;
  player.position.set(driver.position.x + 20, 0, driver.position.z);
  const before = player.position.distanceTo(driver.position);
  run(system, traffic, player, 1);
  const closed = before - player.position.distanceTo(driver.position);
  assert.ok(Math.abs(closed - ROAD_RAGE.chaseSpeed) < .3, `${closed}`);
  assert.ok(ROAD_RAGE.chaseSpeed > PLAYER_SPEED_WALK && ROAD_RAGE.chaseSpeed < PLAYER_SPEED_RUN);
});

test('levanta la varilla antes de golpear: apartarse a tiempo evita el daño', () => {
  const { system, traffic, vehicle, player, stats } = setup({ random: () => 0 });
  cruise(traffic, player);
  triggerAndExit(system, traffic, vehicle, player);
  const driver = system.driver;
  driver.attackTimer = 0;

  // Esquiva: se aleja apenas empieza el aviso.
  player.position.set(driver.position.x + 1, 0, driver.position.z);
  system.update(1 / 30);
  assert.equal(driver.state, 'windup');
  assert.equal(driver.action, 'lanzar');
  player.position.x += 4;
  run(system, traffic, player, ROAD_RAGE.windup + ROAD_RAGE.strikeTime + .05);
  assert.equal(stats.salud, 100);

  // Quieto al alcance: recibe el golpe mínimo con random 0.
  driver.attackTimer = 0;
  player.position.set(driver.position.x + 1, 0, driver.position.z);
  for (let t = 0; t < ROAD_RAGE.windup + ROAD_RAGE.strikeTime + .1; t += 1 / 30) {
    player.position.set(driver.position.x + 1, 0, driver.position.z);
    system.update(1 / 30);
  }
  assert.equal(stats.salud, 100 - ROAD_RAGE.damage[0]);
  assert.equal(player.hits, 1);
});

test('se rinde si el jugador escapa, vuelve a su carro y el tráfico continúa', () => {
  const { system, traffic, vehicle, player, people } = setup();
  cruise(traffic, player);
  triggerAndExit(system, traffic, vehicle, player);
  // Lo aleja unos metros del carro para verlo caminar de vuelta.
  system.driver.position.x += 6;
  player.position.set(system.driver.position.x + ROAD_RAGE.giveUpDistance + 5, 0, system.driver.position.z);
  run(system, traffic, player, 1 / 30);
  assert.equal(system.driver.state, 'return');
  assert.ok(toasts.some(text => /dejó de perseguirme/.test(text)));
  run(system, traffic, player, 15);
  assert.equal(system.active, false);
  assert.equal(vehicle.hold, false);
  assert.equal(vehicle.car.driver.visible, true);
  assert.ok(!people.includes(system.driver));
  run(system, traffic, player, 3);
  assert.ok(vehicle.speed > 1);
});

test('si una caja le corta el regreso, sube igual y el tráfico continúa', () => {
  const { system, traffic, vehicle, player } = setup();
  cruise(traffic, player);
  triggerAndExit(system, traffic, vehicle, player);
  system.driver.position.x += 6;
  player.position.set(system.driver.position.x + ROAD_RAGE.giveUpDistance + 5, 0, system.driver.position.z);
  run(system, traffic, player, 1 / 30);
  assert.equal(system.driver.state, 'return');
  // Sin poder dar un paso, como contra una pared.
  system.driver.isWalkable = () => false;
  const stuckAt = system.driver.position.clone();
  run(system, traffic, player, ROAD_RAGE.returnTimeout - 1);
  assert.equal(system.driver.state, 'return');
  assert.ok(system.driver.position.distanceTo(stuckAt) < .01);
  run(system, traffic, player, 2);
  assert.equal(system.active, false);
  assert.equal(vehicle.hold, false);
});

test('al recuperarse tras morir, el conductor ya está en su carro', () => {
  const { system, traffic, vehicle, player, people } = setup();
  cruise(traffic, player);
  triggerAndExit(system, traffic, vehicle, player);
  assert.equal(system.state, 'out');
  system.reset();
  assert.equal(system.active, false);
  assert.equal(system.driver.root.visible, false);
  assert.equal(vehicle.hold, false);
  assert.equal(vehicle.car.driver.visible, true);
  assert.equal(people.length, 0);
});
