// Tráfico: la franja ciega al costado de la trayectoria, el bus que baja al sur, las motos en el rebusque y dos que
// se esperan mutuamente sin cruce que los arbitre.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { TrafficSignals, signalState } = await import('../src/world/bogota/TrafficSignals.js');
const { Moto } = await import('../src/entities/Moto.js');
const { MOTO_LATERAL } = await import('../src/world/bogota/motos.js');

beforeEach(() => { globalThis.window = new EventTarget(); });

/** Un carro solo, en el tramo recto de arriba (z = 0, hacia +X), a `x` y `speed`. */
function straight(x = 20, speed = 12) {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0];
  // El tramo recto de arriba empieza en x = radio.
  vehicle.distance = x - 3.2; vehicle.routeTimer = 1e9;
  vehicle.car.position.set(x, 0, 0); vehicle.car.group.rotation.y = 0;
  vehicle.speed = speed;
  return { traffic, vehicle };
}

function drive(traffic, player, seconds, dt = .05) {
  const hits = [];
  for (let t = 0; t < seconds; t += dt) traffic.update(dt, { player, onPlayerHit: hit => hits.push(hit) });
  return hits;
}

test('al costado de la trayectoria, entre el frenado y el radio de impacto, el carro pasa despacio y no atropella', () => {
  for (const gap of [.56, .6, .64]) {
    const { traffic, vehicle } = straight();
    const player = new THREE.Vector3(80, 0, vehicle.car.width / 2 + gap);
    let minSpeedNear = Infinity;
    const hits = [];
    for (let t = 0; t < 40; t += .05) {
      traffic.update(.05, { player, onPlayerHit: hit => hits.push(hit) });
      if (Math.abs(vehicle.car.position.x - player.x) < vehicle.car.length / 2 + .65) minSpeedNear = Math.min(minSpeedNear, vehicle.speed);
    }
    assert.equal(hits.length, 0, `a ${gap} m del costado no lo atropella`);
    assert.ok(vehicle.car.position.x > player.x + vehicle.car.length, `sigue su camino, no tranca el carril (x ${vehicle.car.position.x.toFixed(1)})`);
    assert.ok(minSpeedNear < .6, `pasa por su lado a paso lento (${minSpeedNear.toFixed(2)} m/s)`);
    traffic.dispose();
  }
});

test('sin el paso lento, la misma escena era un atropello a toda marcha (control de la prueba anterior)', () => {
  const { traffic, vehicle } = straight();
  const player = new THREE.Vector3(80, 0, vehicle.car.width / 2 + .6);
  const hits = [];
  traffic._personBeside = () => false;
  for (let t = 0; t < 20; t += .05) traffic.update(.05, { player, onPlayerHit: hit => hits.push(hit) });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].speed > 5, `velocidad del golpe ${hits[0].speed}`);
  traffic.dispose();
});

/**
 * Una fila de `n` carros quietos (el primero en x≈100), con el jugador quieto `ahead` metros delante del primero, a
 * `gap` metros del costado (negativo: del otro costado; |gap| < .55: dentro de la trayectoria).
 */
function queueFromRest(n, ahead, gap) {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 400, 0, 400, 3.2)], { carsPerRoute: n, random: () => .5 });
  traffic.vehicles.forEach((vehicle, i) => {
    vehicle.routeTimer = 1e9; vehicle.distance = 100 - i * 6.5; vehicle.speed = 0;
    vehicle.route.sample(vehicle.distance, vehicle.car.position, traffic._direction); vehicle.car.group.rotation.y = 0;
  });
  const lead = traffic.vehicles[0];
  return { traffic, player: new THREE.Vector3(lead.car.position.x + ahead, 0, Math.sign(gap) * (lead.car.width / 2 + Math.abs(gap))) };
}

test('un carro que arranca desde quieto no le llega encima a quien está en su camino o al costado', () => {
  // Antes el arranque suave (3 m/s³) seguía acelerando hasta 1,5 s después de verlo: golpes a 2–4,6 m/s desde 14–40 m.
  for (const n of [1, 4]) for (const ahead of [6, 10, 14, 22, 30, 40]) for (const gap of [-.6, -.45, 0, .45, .6, .68]) {
    const { traffic, player } = queueFromRest(n, ahead, gap);
    const hits = [], passed = new Set();
    for (let t = 0; t < 70 && passed.size < n; t += .05) {
      traffic.update(.05, { player, onPlayerHit: hit => hits.push(hit.speed.toFixed(2)) });
      for (const vehicle of traffic.vehicles) if (vehicle.car.position.x > player.x + 3) passed.add(vehicle);
    }
    assert.deepEqual(hits, [], `${n} carro(s), ${ahead} m adelante, a ${gap} m del costado`);
    // Al costado lo pasan todos (a paso lento); en su camino lo esperan.
    if (Math.abs(gap) > .5) assert.equal(passed.size, n, `${n}/${ahead}/${gap}: pasan`);
    traffic.dispose();
  }
});

test('quien está más allá de la franja no frena a nadie', () => {
  const { traffic, vehicle } = straight();
  const player = new THREE.Vector3(80, 0, vehicle.car.width / 2 + .9);
  const speeds = [];
  for (let t = 0; t < 10; t += .05) {
    traffic.update(.05, { player });
    if (Math.abs(vehicle.car.position.x - player.x) < 4) speeds.push(vehicle.speed);
  }
  assert.ok(speeds.length && Math.min(...speeds) > 8, `sigue a su paso (${Math.min(...speeds).toFixed(1)} m/s)`);
  traffic.dispose();
});

test('el bus que baja al sur tiene su propia reserva: no espera a quien cruza la línea del otro bus', () => {
  const route = new TrafficRoute(-30, 30, 3, 40, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  const node = { x0: -10, x1: 10, z0: -7, z1: 7 };
  signals.nodes = [node];
  signals.update(18);
  assert.equal(signalState(signals.time, 1), 0, 'verde para los buses');
  // Al norte por x = 6 (rumbo −Z) y al sur por x = −6 (rumbo +Z), como los dos de la Caracas.
  const bus = (x, z, direction) => ({ position: new THREE.Vector3(x, 0, z), group: new THREE.Group(), length: 18.2, width: 2.52,
    laneX: x, direction, heading: { x: 0, z: direction } });
  const north = bus(6, 30, -1), south = bus(-6, -30, 1);
  traffic.setBus([north, south]);
  // Un carro que ya cruza hacia +X por z = 3 y que solo ha pasado la línea del bus del sur.
  const vehicle = traffic.vehicles[0];
  vehicle.route = new TrafficRoute(-30, 30, 3, 40, 3.2);
  const segment = vehicle.route.segments[0];
  vehicle.distance = 0 - segment.x; vehicle.routeTimer = 1e9;
  vehicle.car.position.set(0, 0, 3); vehicle.car.group.rotation.y = 0;
  // El segundo cuadro ya sabe cuánto le falta al que está dentro.
  traffic._coordinateIntersections();
  traffic._coordinateIntersections();
  const state = signals.reservations.get(node);
  assert.equal(state.owners.size, 1, 'el carro tiene el cruce');
  assert.ok(state.busPlans.get(north) !== state.busPlans.get(south), 'cada bus con su trayectoria');
  assert.ok(state.busPlans.get(south).points.every(p => p.x === -6));
  assert.ok(state.busBlockedFor.has(north), 'al bus del norte le corta su línea');
  assert.ok(!state.busBlockedFor.has(south), 'al del sur ya no: el carro está pasada su línea');
  assert.equal(signals.busClearance(south.position, south.length, 1, south), Infinity, 'el del sur sigue');
  assert.ok(Number.isFinite(signals.busClearance(north.position, north.length, -1, north)), 'el del norte espera');
  traffic.dispose();
});

test('un carro que espera en verde le cede el cruce también al bus que baja al sur', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(-30, 30, 3, 40, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  const node = { x0: -10, x1: 10, z0: -7, z1: 7 };
  signals.nodes = [node];
  signals.update(18);
  const south = { position: new THREE.Vector3(-6, 0, -7 - 9.1 - 3), group: new THREE.Group(), length: 18.2, width: 2.52,
    laneX: -6, direction: 1, heading: { x: 0, z: 1 } };
  traffic.setBus([south]);
  const vehicle = traffic.vehicles[0];
  // Antes del cruce, por z = 3 hacia +X: su trayectoria corta la línea del bus.
  vehicle.distance = -16 - (-30 + 3.2); vehicle.routeTimer = 1e9;
  vehicle.car.position.set(-16, 0, 3); vehicle.car.group.rotation.y = 0;
  traffic._coordinateIntersections();
  const state = signals.reservations.get(node);
  assert.ok(state.queue.includes(vehicle), 'el carro pide el cruce');
  assert.equal(state.owners.has(vehicle), false, 'pero espera al bus que entra por z0');
  traffic.dispose();
});

test('stoppedAtRed no le ofrece a las motos el rebusque del parabrisas, salvo que se pidan', () => {
  const t = Object.create(TrafficSystem.prototype);
  t.signals = { redAhead: () => true };
  const moto = new Moto(new THREE.Vector3(2, 0, 0), 0, { variant: 0, occupancy: [true, false, false], helmets: [true, false, false], color: '#f00' });
  const car = { position: new THREE.Vector3(3, 0, 0), group: { rotation: { y: 0 } } };
  t.vehicles = [{ car: moto, speed: 0, stopped: true }, { car, speed: 0, stopped: true }];
  assert.deepEqual(t.stoppedAtRed(new THREE.Vector3(), 6).map(v => v.car), [car]);
  assert.deepEqual(t.stoppedAtRed(new THREE.Vector3(), 6, { motos: true }).map(v => v.car), [moto, car]);
});

/**
 * Semilla 13 del arnés: un carro sube por x = 349 y una moto de otro circuito dobla en esa esquina hacia el mismo
 * carril. Cada uno es el que le tapa el camino al otro y no hay cruce con semáforo que los arbitre.
 */
function merge() {
  const scene = new THREE.Scene();
  const straightRoute = new TrafficRoute(264, 349, 33, 190, 3.2), turning = new TrafficRoute(264, 349, 152, 190, 3.2);
  const traffic = new TrafficSystem(scene, [straightRoute, turning], { carsPerRoute: 0, random: () => .5 });
  const top = 349 - 264 - 6.4, arc = Math.PI * 3.2 / 2;
  const car = traffic._spawn(scene, straightRoute, top + arc + (148.42 - 36.2), false);
  const moto = traffic._spawn(scene, turning, top + 3.2 * .266, false);
  // El conteo de la flota decide el tipo: aquí se fija a mano.
  if (!moto.car.isMoto) {
    moto.car.dispose();
    moto.car = traffic._newMoto(7, 0);
    moto.lateral = MOTO_LATERAL; moto.gap = 1.1;
  }
  if (car.car.isMoto) assert.fail('el primero debe ser carro');
  for (const v of [car, moto]) {
    v.routeTimer = 1e9; v.speed = 0;
    v.route.sample(v.distance, v.car.position, traffic._direction);
    if (v.lateral) traffic._lateral(v.car.position, traffic._direction, v.lateral);
    v.car.group.rotation.y = Math.atan2(-traffic._direction.z, traffic._direction.x);
  }
  return { traffic, car, moto };
}

/** Cuánto se meten dos carrocerías una en la otra (separación por ejes, negativo si no se tocan). */
function penetration(a, b) {
  const box = car => { const h = car.group.rotation.y; return { c: car.position, ax: [[Math.cos(h), -Math.sin(h)], [Math.sin(h), Math.cos(h)]], half: [car.length / 2, car.width / 2] }; };
  const A = box(a), B = box(b);
  let min = Infinity;
  for (const [x, z] of [...A.ax, ...B.ax]) {
    const extent = o => Math.abs(o.ax[0][0] * x + o.ax[0][1] * z) * o.half[0] + Math.abs(o.ax[1][0] * x + o.ax[1][1] * z) * o.half[1];
    min = Math.min(min, extent(A) + extent(B) - Math.abs((B.c.x - A.c.x) * x + (B.c.z - A.c.z) * z));
  }
  return min;
}

test('dos que se tapan mutuamente en una esquina sin semáforo se destraban: pasa el de adelante', () => {
  const { traffic, car, moto } = merge();
  const start = { car: car.distance, moto: moto.distance };
  traffic.update(.1, {});
  assert.equal(car.blockedBy, moto, 'la moto le tapa el camino al carro');
  assert.equal(moto.blockedBy, car, 'y el carro a la moto');
  let first = null, worst = -Infinity;
  for (let t = 0; t < 12; t += .1) {
    traffic.update(.1, {});
    first ??= car.deadlockPass ? 'carro' : moto.deadlockPass ? 'moto' : null;
    worst = Math.max(worst, penetration(car.car, moto.car));
  }
  assert.equal(first, 'moto', 'la moto ya iba adelante, doblando hacia el carril');
  assert.ok(worst <= .25, `al pasar a lo sumo se rozan, no se meten uno en el otro (${worst.toFixed(2)} m)`);
  assert.ok(car.distance - start.car > 10, `el carro avanzó ${(car.distance - start.car).toFixed(1)} m`);
  assert.ok(moto.distance - start.moto > 10, `la moto avanzó ${(moto.distance - start.moto).toFixed(1)} m`);
  traffic.dispose();
});

test('el que pasa en un desbloqueo no se le mete encima al otro si su camino le corta la carrocería', () => {
  // A va al este por z = 0; B está quieto atravesado (rumbo norte, x = 50) justo en el camino de A.
  const scene = new THREE.Scene();
  const east = new TrafficRoute(0, 400, 0, 400, 3.2), north = new TrafficRoute(50, 100, -30, 100, 3.2);
  const traffic = new TrafficSystem(scene, [east, north], { carsPerRoute: 0, random: () => .5 });
  const sideStart = north.segments.slice(0, 6).reduce((sum, segment) => sum + segment.length, 0);
  const a = traffic._spawn(scene, east, 40 - 3.2, false), b = traffic._spawn(scene, north, sideStart + 96.8, false);
  for (const v of [a, b]) {
    v.routeTimer = 1e9; v.speed = 0;
    v.route.sample(v.distance, v.car.position, traffic._direction);
    v.car.group.rotation.y = Math.atan2(-traffic._direction.z, traffic._direction.x);
  }
  b.hold = true;
  a.deadlockPass = b; a.deadlockUntil = Infinity;
  let worst = -Infinity;
  for (let t = 0; t < 10; t += .05) {
    traffic.update(.05, {});
    worst = Math.max(worst, penetration(a.car, b.car));
  }
  assert.ok(a.car.position.x > 42, `se arrima (x ${a.car.position.x.toFixed(1)})`);
  assert.ok(worst <= .25, `pero a lo sumo lo roza, no se mete en la carrocería del otro (${worst.toFixed(2)} m)`);
  traffic.dispose();
});

test('sin el desbloqueo, la misma esquina los deja esperándose para siempre (control)', () => {
  const { traffic, car, moto } = merge();
  traffic._breakDeadlocks = () => {};
  const start = { car: car.distance, moto: moto.distance };
  for (let t = 0; t < 30; t += .1) traffic.update(.1, {});
  assert.ok(car.distance - start.car < 1 && moto.distance - start.moto < 1);
  traffic.dispose();
});

test('el desbloqueo no toca a quien espera detrás de otro ni a quien espera un rojo', () => {
  const t = Object.create(TrafficSystem.prototype);
  t._time = 10;
  const at = (x, yaw = 0) => ({ position: new THREE.Vector3(x, 0, 0), group: { rotation: { y: yaw } } });
  const a = { car: at(0), state: 'patrol', stoppedFor: 20 }, b = { car: at(6), state: 'patrol', stoppedFor: 20 };
  t.vehicles = [a, b];
  a.blockedBy = b; b.blockedBy = null; // cola normal
  t._breakDeadlocks();
  assert.equal(a.deadlockPass, undefined);
  b.blockedBy = a; b.state = 'chase'; // una patrulla persiguiendo no entra
  t._breakDeadlocks();
  assert.equal(a.deadlockPass, undefined);
  b.state = 'patrol'; b.stoppedFor = 2; // aún no llevan los segundos
  t._breakDeadlocks();
  assert.equal(a.deadlockPass, undefined);
  b.stoppedFor = 20;
  t._breakDeadlocks();
  assert.equal(b.deadlockPass, a, 'pasa el que va adelante (b, en el rumbo de a)');
  assert.equal(a.deadlockPass, undefined);
});
