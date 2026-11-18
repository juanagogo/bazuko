// Los choques del tráfico: el golpe, el carril trancado con la cola detrás, la discusión y el despeje.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { CRASH, CrashSystem, crashChance } = await import('../src/systems/CrashSystem.js');
const { overlapDepth, vehicleBox } = await import('../src/systems/VehicleOverlap.js');

/** Una calle recta con una fila de carros que van de oeste a este. */
function street(count = 6, spacing = 22) {
  const scene = new THREE.Scene(), route = new TrafficRoute(0, 600, 0, 90);
  const traffic = new TrafficSystem(scene, [route], { carsPerRoute: 0, policeCount: 0, random: () => .5 });
  traffic._motoThreshold = 11;
  const cars = [];
  for (let i = 0; i < count; i++) {
    traffic._spawnCount = 8;
    const vehicle = traffic._spawn(scene, route, 60 + i * spacing, false);
    vehicle.speed = vehicle.cruiseSpeed = 10;
    cars.push(vehicle);
  }
  return { traffic, cars, route };
}

function fakeRage() {
  const calls = { argue: 0, end: 0 };
  return { calls, argue: () => { calls.argue++; return [{}, {}]; }, endArgue: () => { calls.end++; } };
}

const bodies = (traffic) => {
  const a = {}, b = {}, list = traffic.vehicles;
  let worst = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    worst = Math.max(worst, overlapDepth(vehicleBox(list[i].car, false, a), vehicleBox(list[j].car, false, b)));
  }
  return worst;
};

test('la probabilidad de choque sube en las horas pico y baja de madrugada', () => {
  assert.ok(crashChance(8) > crashChance(12));
  assert.ok(crashChance(18) > crashChance(12));
  assert.ok(crashChance(3) < crashChance(12));
  assert.ok(crashChance(8) <= .2, 'sigue siendo raro');
});

test('un choque por detrás frena a los dos, los avería, suena el golpe y los conductores se bajan a discutir', () => {
  const { traffic, cars } = street();
  const rage = fakeRage(), sounds = [];
  const crashes = new CrashSystem({ traffic, roadRage: rage, audio: { playCarCrash: (p) => sounds.push(p.x) }, random: () => .5 });
  const [hit, hurt] = [cars[1], cars[2]];
  const crash = crashes.crash({ kind: 'rear', hit, hurt });
  assert.ok(crash && crashes.active);
  assert.equal(sounds.length, 1, 'suena el choque una vez');
  for (const vehicle of [hit, hurt]) {
    assert.equal(vehicle.speed, 0);
    assert.ok(vehicle.hold, 'quedan trancando el carril');
    assert.ok(vehicle.car.wreckLevel >= CRASH.damage[0] && vehicle.car.wreckLevel <= CRASH.damage[1], 'daño en los dos carros');
  }
  const gap = (hurt.distance - hit.distance) - (hit.car.length + hurt.car.length) / 2;
  assert.ok(gap >= 0 && gap < .5, `pegados sin montarse: ${gap.toFixed(2)} m`);
  assert.equal(crashes.crashes[0], crash);
  for (let i = 0; i < 20; i++) crashes.update(.1, {});
  assert.equal(rage.calls.argue, 1, 'los conductores se bajan a discutir');
  traffic.dispose();
});

test('el choque traba el carril y el tráfico se va represando detrás; al despejarse todo vuelve a rodar', () => {
  const { traffic, cars } = street();
  const rage = fakeRage();
  const crashes = new CrashSystem({ traffic, roadRage: rage, random: () => 0 });
  const [behind, third] = [cars[0], cars[1]];
  const crash = crashes.crash({ kind: 'rear', hit: cars[2], hurt: cars[3] });
  const lane = [cars[4], cars[5]];
  // los de adelante siguen su camino; los de atrás llegan al choque y se quedan en la cola
  for (let frame = 0; frame < 700; frame++) {
    traffic.update(.1);
    crashes.update(.1, {});
    assert.ok(bodies(traffic) <= .3, 'nadie se mete dentro del choque');
    if (crash.time > crash.duration - 1) break;
  }
  assert.ok(behind.speed < .3 && third.speed < .3, 'la cola quedó detenida detrás del choque');
  assert.ok(cars[3].distance < cars[2].distance + 40 && behind.distance < cars[2].distance, 'ninguno pasó al choque');
  assert.ok(crashes.active, 'sigue ahí hasta que se despeje');
  assert.ok(lane.every(v => v.distance > cars[3].distance), 'los de adelante ya se fueron');
  const queuedAt = behind.distance;
  for (let frame = 0; frame < 20; frame++) { traffic.update(.1); crashes.update(.1, {}); }
  assert.equal(crashes.active, false, 'el choque se despejó');
  assert.equal(rage.calls.end, 1, 'los conductores suben');
  for (let frame = 0; frame < 160; frame++) { traffic.update(.1); crashes.update(.1, {}); }
  assert.ok(behind.distance > queuedAt + 10 && cars[2].distance > crash.vehicles[0].distance - 1, 'la cola avanza otra vez');
  assert.ok(!cars[2].hold && !cars[3].hold);
  traffic.dispose();
});

test('nunca nace a la vista: ni cerca del jugador ni en el cuadro de la cámara; y es raro', () => {
  const { traffic } = street(8, 5);
  const crashes = new CrashSystem({ traffic, random: () => 0 });
  const player = new THREE.Vector3(78, 0, 0);
  for (let t = 0; t < 120; t += .5) crashes.update(.5, { hour: 8, player });
  assert.equal(crashes.total, 0, 'con todos los carros a menos de la distancia mínima no choca nadie');
  const far = new THREE.Vector3(2000, 0, 2000);
  for (let t = 0; t < 120 && !crashes.total; t += .5) crashes.update(.5, { hour: 8, player: far });
  assert.ok(crashes.total >= 1, 'lejos del jugador sí');
  // el cuadro de la cámara: a 35 m y de frente se ve; de espaldas no
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, .1, 300);
  camera.position.set(0, 3, 0); camera.lookAt(35, 0, 0); camera.updateMatrixWorld(true);
  const where = new THREE.Vector3(35, 0, 0), eye = new THREE.Vector3(0, 0, 0);
  assert.equal(crashes._seen(where, eye, camera), true, 'a la vista de la cámara');
  assert.equal(crashes._seen(new THREE.Vector3(-35, 0, 0), eye, camera), false, 'a la espalda de la cámara');
  assert.equal(crashes._seen(new THREE.Vector3(CRASH.minDistance - 1, 0, 0), eye, null), true, 'cerca del jugador');
  assert.equal(crashes._seen(new THREE.Vector3(CRASH.farView + 5, 0, 0), eye, camera), false, 'lejos aunque la cámara mire para allá');
  const calm = new CrashSystem({ traffic: street(8, 12).traffic, random: () => .99 });
  for (let t = 0; t < 600; t += .5) calm.update(.5, { hour: 12, player: far });
  assert.equal(calm.total, 0, 'con mala suerte no pasa nada');
});

test('hay un tope de choques a la vez y reset los despeja todos', () => {
  const { traffic, cars } = street(8);
  const rage = fakeRage();
  const crashes = new CrashSystem({ traffic, roadRage: rage, random: () => .5 });
  crashes.crash({ kind: 'rear', hit: cars[0], hurt: cars[1] });
  crashes.crash({ kind: 'rear', hit: cars[3], hurt: cars[4] });
  assert.equal(crashes.crash({ kind: 'rear', hit: cars[0], hurt: cars[5] }), null, 'un carro ya chocado no vuelve a chocar');
  assert.equal(crashes.crashes.length, CRASH.maxActive);
  crashes.reset();
  assert.equal(crashes.active, false);
  assert.ok(cars.every(v => !v.hold && !v.crash));
  traffic.dispose();
});
