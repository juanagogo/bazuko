// tools/peatones/montaje.mjs
// La ciudad como la monta el juego, en Node, para medir peatones y tráfico sin navegador: Bogotá completa, sus 88
// NPC, los parqueados, la flota con dos patrullas y los buses. Sustituye solo lo que pide Canvas, WebGL o GLB, como
// tests/helpers/traffic-world.js. `root` es la carpeta del árbol que se mide: así el mismo montaje corre sobre dos árboles.
//
// Se importa desde un script que corre con `node --experimental-test-module-mocks`.
import { mock } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Generador sembrado del montaje de tráfico (el de tests/helpers/traffic-world.js). */
export function seededRandom(randomSeed) {
  let state = 0;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const seed = () => { state = Math.imul(randomSeed + 1, 2654435761) >>> 0; };
  return { next, seed };
}

/** Carga los módulos reales de `root` con las sustituciones de las pruebas. */
export async function loadTree(root) {
  const url = file => pathToFileURL(path.join(root, file)).href;
  // El mismo THREE que importan los módulos del árbol (la entrada `import` del paquete).
  const THREE = await import(url('node_modules/three/build/three.module.js'));
  const textures = await import(url('src/world/bogota/textures.js'));
  const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
  const replacements = { ...textures };
  for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
  for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
  mock.module(url('src/world/bogota/textures.js'), { namedExports: replacements });
  mock.module(url('src/utils/signs.js'), { namedExports: { signTexture: () => new THREE.Texture() } });
  mock.module(url('src/character/RealisticCharacter.js'), { namedExports: {
    REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
    loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
  } });
  const [{ TrafficSystem }, { Car }, { Bogota }, { CollisionSystem }, { parkedCarOffset }] = await Promise.all([
    import(url('src/systems/TrafficSystem.js')), import(url('src/entities/Car.js')), import(url('src/world/districts/Bogota.js')),
    import(url('src/systems/CollisionSystem.js')), import(url('src/world/bogota/parkedCars.js'))
  ]);
  return { THREE, TrafficSystem, Car, Bogota, CollisionSystem, parkedCarOffset };
}

/**
 * Monta la ciudad como `Game` al poblar Bogotá, con el azar sembrado (igual que `runLikeTheGame` de
 * tests/helpers/traffic-world.js). Devuelve lo necesario para correr cuadros.
 */
export async function buildCity(tree, randomSeed, { density = 'normal' } = {}) {
  const { THREE, TrafficSystem, Car, Bogota, CollisionSystem, parkedCarOffset } = tree;
  const random = seededRandom(randomSeed);
  random.seed();
  Math.random = random.next;
  const scene = new THREE.Scene(), collisions = new CollisionSystem(), city = new Bogota();
  city.build(scene, collisions);
  await Promise.all(city.npcs.map(npc => npc.ready));
  random.seed();
  const parking = city.getParkingSpots();
  for (let i = parking.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parking[i], parking[j]] = [parking[j], parking[i]];
  }
  const placed = [], parked = [];
  for (let i = 0; i < Math.round(5 * city.populationScale); i++) {
    const spot = parking.find(p => placed.every(q => Math.hypot(p.x - q.x, p.z - q.z) > 8));
    if (!spot) break;
    placed.push(spot);
    const car = new Car(scene, new THREE.Vector3(spot.x, 0, spot.z), spot.rot);
    const offset = parkedCarOffset(spot, car.width);
    car.position.x += offset.x; car.position.z += offset.z;
    parked.push(car);
  }
  const traffic = new TrafficSystem(scene, city.getTrafficRoutes(), { policeCount: 2, random: random.next });
  traffic.setDensity(density);
  traffic.setParkedCars(parked);
  traffic.signals = city.signals;
  traffic.setBus(city.busServices);
  // El perro: lo que los carros y los peatones respetan además de los NPC (game.js arma esta misma lista).
  const dog = { position: new THREE.Vector3(city.reserved.bed.x + 2, 0, city.reserved.bed.z + 3) };
  city.trafficPedestrians = [...city.npcs, dog];
  return { scene, collisions, city, traffic, parked, dog, random };
}
