// Lo que comparten las pruebas de tráfico: los módulos reales con las texturas de Canvas sustituidas y el montaje de
// una partida entera. Cada archivo de `tests/traffic*.test.js` corre en su propio proceso, a la vez que los demás.
import { beforeEach, mock } from 'node:test';
import * as THREE from 'three';
import * as textures from '../../src/world/bogota/textures.js';
import { trafficTargetVehicles } from '../../src/systems/trafficDensity.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

// Usa los carros reales, sustituyendo solo las texturas de Canvas por texturas vacías.
const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
export const { TrafficSystem } = await import('../../src/systems/TrafficSystem.js');
export const { Car } = await import('../../src/entities/Car.js');
export const { Bogota } = await import('../../src/world/districts/Bogota.js');
export const { TrafficSignals, signalState } = await import('../../src/world/bogota/TrafficSignals.js');
export const { CAR_MODELS, PRIVATE_MIX } = await import('../../src/world/bogota/carModels.js');
export const { BusService } = await import('../../src/world/bogota/BusService.js');
export const { CollisionSystem } = await import('../../src/systems/CollisionSystem.js');
export const { parkedCarOffset, parkedCarShift } = await import('../../src/world/bogota/parkedCars.js');

/** Generador sembrado (mulberry32). */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// three.js gasta `Math.random` en el UUID de cada objeto que crea, y los cachés de módulo (materiales y letreros de la
// ciudad, piezas y pinturas de carro) hacen que cuántos gaste dependa de lo que ya armaron las pruebas anteriores del
// mismo proceso. La primera ciudad que se arma llena los de la ciudad: esta, armada una sola vez y con su propia
// semilla, hace que todas las demás gasten lo mismo.
let warmCity = null;
function warmUpCity() {
  warmCity ??= (async () => {
    const original = Math.random;
    Math.random = seededRandom(0x2F6B1C3D);
    try {
      const scene = new THREE.Scene(), city = new Bogota();
      city.build(scene, new CollisionSystem());
      await Promise.all(city.npcs.map(npc => npc.ready));
      city.dispose(scene);
    } finally {
      Math.random = original;
    }
  })();
  return warmCity;
}

/** Monta el tráfico como Game al poblar Bogotá, con el azar sembrado, y lo corre con city.update como Game._loop. */
export async function runLikeTheGame(randomSeed, minutes, { chases = false, density = 'normal', hour = 7 } = {}) {
  await warmUpCity();
  const original = Math.random;
  // Un generador por cada uso del azar: la ciudad, los parqueados, el tráfico y los UUID de los carros que se arman.
  // Así lo que gasten los carros al armarse, que depende de los cachés, no mueve el azar de nadie.
  const base = Math.imul(randomSeed + 1, 2654435761);
  const next = seededRandom(base), parkedRandom = seededRandom(base ^ 0x68E31DA4);
  const trafficRandom = seededRandom(base ^ 0x2545F491), builderRandom = seededRandom(base ^ 0x1B873593);
  Math.random = next;
  // El habla de los peatones sortea con `performance.now()`: sin congelar el reloj, el azar que gastan depende de la
  // máquina y cada corrida da una ciudad distinta. Con este reloj de mentira las semillas se repiten.
  const realNow = performance.now;
  let clock = 0;
  performance.now = () => (clock += 100);
  try {
    const scene = new THREE.Scene(), collisions = new CollisionSystem(), city = new Bogota();
    city.build(scene, collisions);
    await Promise.all(city.npcs.map(npc => npc.ready));
    // Los parqueados y el tráfico no dependen de cuánto azar gastó la ciudad al levantarse.
    Math.random = builderRandom;
    const parking = city.getParkingSpots();
    for (let i = parking.length - 1; i > 0; i--) {
      const j = Math.floor(parkedRandom() * (i + 1));
      [parking[i], parking[j]] = [parking[j], parking[i]];
    }
    const placed = [], parked = [];
    for (let i = 0; i < Math.round(5 * city.populationScale); i++) {
      const spot = parking.find(p => placed.every(q => Math.hypot(p.x - q.x, p.z - q.z) > 8));
      if (!spot) break;
      placed.push(spot);
      // Lo mismo que sortea Car sin estas opciones, pero del generador de los parqueados.
      const kind = parkedRandom() < 0.3 ? 'taxi' : 'carro', variant = Math.floor(parkedRandom() * 10000);
      const car = new Car(scene, new THREE.Vector3(spot.x, 0, spot.z), spot.rot, { kind, variant });
      const offset = parkedCarOffset(spot, car.width);
      car.position.x += offset.x; car.position.z += offset.z;
      parked.push(car);
    }
    const traffic = new TrafficSystem(scene, city.getTrafficRoutes(), { policeCount: 2, random: trafficRandom });
    traffic.onVehicleRemoved = () => { removals++; };
    traffic.setDensity(density);
    traffic.setParkedCars(parked);
    traffic.signals = city.signals;
    traffic.setBus(city.busServices);
    const pedestrians = [...city.npcs, { position: new THREE.Vector3(city.reserved.bed.x + 2, 0, city.reserved.bed.z + 3) }];
    const player = new THREE.Vector3(112.98, 0, 97.84);
    const stoppedFor = new Map(), travel = new Map(), farFor = new Map(), firstSeen = new Map();
    let farWorst = { seconds: 0 }, removals = 0;
    let worst = { seconds: 0 };
    // El jugador aparece junto a una patrulla y corre por la calle; al acabar la persecución vuelve al inicio.
    let chasing = false, nextChase = 20, started = 0, heading = [1, 0], time = 0;
    const patrols = traffic.vehicles.filter(vehicle => vehicle.police), moved = new THREE.Vector3(), step = new THREE.Vector3();
    if (chases) {
      traffic.setEnvironment({ collisions, getGroundHeight: (x, z, y) => city.getMovementGroundHeight(x, z, y), getWaterInfo: (x, z) => city.getWaterInfo(x, z) });
      const finish = () => { chasing = false; nextChase = time + 30; traffic.endPursuit(); player.set(112.98, 0, 97.84); };
      window.addEventListener('police-arrest', finish);
      window.addEventListener('police-escaped', finish);
    }
    Math.random = next;
    for (let frame = 0; frame < minutes * 600; frame++) {
      time = frame * .1;
      if (chases) {
        if (!chasing && time >= nextChase) {
          const patrol = patrols[started++ % patrols.length], { x, z } = patrol.car.position;
          player.set(x + 6, city.getGroundHeight(x + 6, z), z);
          traffic._startChase(patrol);
          chasing = true;
          heading = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
        }
        if (chasing) {
          collisions.resolveMove(player, step.set(heading[0] * .5, 0, heading[1] * .5), .35, moved);
          if (moved.distanceTo(player) > .25 && city.isWalkableAt(moved.x, moved.z)) player.set(moved.x, city.getGroundHeight(moved.x, moved.z), moved.z);
          else heading = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
        }
        collisions.setVehicles([...parked, ...traffic.vehicles.map(vehicle => vehicle.car)], city.busServices);
      }
      city.update(.1, player, null, traffic.vehicles);
      // El carro que el tráfico repone saca sus UUID de su generador, no del de la ciudad.
      Math.random = builderRandom;
      traffic.update(.1, { player, pedestrians, hour });
      Math.random = next;
      for (const vehicle of traffic.vehicles) {
        travel.set(vehicle, (travel.get(vehicle) ?? 0) + vehicle.speed * .1);
        if (!firstSeen.has(vehicle)) firstSeen.set(vehicle, frame);
        const seconds = vehicle.speed < .05 ? (stoppedFor.get(vehicle) ?? 0) + .1 : 0;
        stoppedFor.set(vehicle, seconds);
        if (seconds > worst.seconds) worst = { seconds, kind: vehicle.car.kind, x: vehicle.car.position.x, z: vehicle.car.position.z };
        // Igual que el del juego: parado y fuera de la vista, el montaje lo retira; solo el que se ve se queda.
        const away = vehicle.car.position.distanceTo(player) > 60;
        const farStopped = away && vehicle.speed < .05 ? (farFor.get(vehicle) ?? 0) + .1 : 0;
        farFor.set(vehicle, farStopped);
        if (farStopped > farWorst.seconds) farWorst = { seconds: farStopped, kind: vehicle.car.kind, x: vehicle.car.position.x, z: vehicle.car.position.z };
      }
    }
    // El que menos anduvo entre los que ya rodaban a mitad de camino: los repuestos que entran al final no cuentan.
    const settled = traffic.vehicles.filter(vehicle => firstSeen.get(vehicle) < minutes * 300);
    const shortest = settled.length ? Math.min(...settled.map(vehicle => travel.get(vehicle))) : 0;
    // Dónde quedó cada carro y cada peatón: dos corridas con la misma semilla tienen que dar la misma huella.
    let fingerprint = 0x811c9dc5;
    for (const { position } of [...traffic.vehicles.map(vehicle => vehicle.car), ...city.npcs]) {
      for (const value of [position.x, position.z]) fingerprint = Math.imul(fingerprint ^ Math.round(value * 1000), 16777619) >>> 0;
    }
    city.dispose(scene);
    return { parked: parked.length, npcs: city.npcs.length, vehicles: traffic.vehicles.length, radio: traffic._resizeDistance(), worst, farWorst, removals, shortest, chases: started, fingerprint };
  } finally {
    Math.random = original;
    performance.now = realNow;
  }
}

/** Flota que pide la ciudad en el pico de la mañana con esa densidad, más las dos patrullas del montaje. */
export const expectedFleet = density => trafficTargetVehicles(7, density) + 2;
