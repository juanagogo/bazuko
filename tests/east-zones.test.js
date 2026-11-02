import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { CITY_WIDTH, CITY_HEIGHT } from '../src/world/bogota/CityLayout.js';
import { BASE_CITY_WIDTH, CARRERA_3, CARRERA_5, CHURCH, EAST_SEAM, FOUNTAIN, MARKET, PLAZA, TEUSAQUILLO_PARK, TOWERS, TOWERS_LOT, insideTower } from '../src/world/bogota/EastZones.js';
import { neighborhoodAt } from '../src/world/bogota/NeighborhoodIdentity.js';
import { planUrbanBuildings } from '../src/world/bogota/UrbanBuildings.js';
import { planEastLots } from '../src/world/bogota/EastBuildings.js';
import { scanCityEdge } from '../src/world/bogota/CityEdge.js';
import { cityLandmarks, streetLabels } from '../src/world/bogota/CityMapRaster.js';
import { cobblestones, detailSheet, muralSheet, redBrick, towerFacade } from '../src/world/bogota/ZoneTextures.js';

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
const { Bogota } = await import('../src/world/districts/Bogota.js');

// Cada casa vieja queda anotada por sus tiles: el diseño de cada una sale de ellos y de su orden.
const recordHouses = target => {
  const calls = [], original = target._house;
  target._house = function (tiles, dx, dz, face, alongX, isB, ...rest) {
    calls.push(JSON.stringify([tiles, dx, dz, face, alongX, isB]));
    return original.call(this, tiles, dx, dz, face, alongX, isB, ...rest);
  };
  return calls;
};
const city = new Bogota();
const scene = new THREE.Scene(), collisions = new CollisionSystem();
const houses = recordHouses(city);
city.build(scene, collisions);
const map = city.map;
const oldCity = map.map(row => [...row.slice(0, EAST_SEAM), 'wall']);
after(() => city.dispose(scene));

test('la ciudad crece hacia el oriente sin mover nada de la parte anterior', () => {
  assert.equal(map[0].length, CITY_WIDTH);
  assert.equal(map.length, CITY_HEIGHT);
  assert.equal(CITY_WIDTH, 200);
  assert.equal(BASE_CITY_WIDTH, 120);
  assert.deepEqual(planUrbanBuildings(map), planUrbanBuildings(oldCity), 'los lotes y sus diseños siguen iguales, tile por tile');
  // Lo que era muro en la columna vieja pasa a ser ciudad sólida o transitable, no una pared suelta.
  const types = new Set();
  for (let z = 2; z < CITY_HEIGHT - 2; z++) types.add(map[z][EAST_SEAM]);
  assert.ok(!types.has('wall'));
  assert.ok(types.has('building'));
  assert.ok(types.has('road'));
  assert.ok(types.has('sidewalk'));
});

test('las casas de la parte vieja salen iguales, en el mismo orden, con la ciudad ampliada o sin ampliar', () => {
  const before = new Bogota(), beforeScene = new THREE.Scene();
  before._layout = () => oldCity.map(row => [...row]);
  const oldHouses = recordHouses(before);
  before.build(beforeScene, new CollisionSystem());
  before.dispose(beforeScene);
  assert.ok(oldHouses.length > 100);
  assert.deepEqual(houses, oldHouses);
});

test('las calles del centro siguen hasta la Carrera 5 y las manzanas nuevas no dejan solares vacíos', () => {
  for (let z = 1; z < CITY_HEIGHT - 1; z++) assert.equal(map[z][CARRERA_5[0] + 2], 'road', `Carrera 5 en Z ${z}`);
  const { lots, patios } = planEastLots(map);
  assert.ok(lots.length > 90);
  assert.ok(lots.some(lot => lot.zone === 'colonial'));
  assert.ok(lots.some(lot => lot.zone === 'ladrillo'));
  assert.ok(lots.some(lot => lot.commercial));
  const taken = new Map();
  for (const piece of [...lots, ...patios]) for (let z = piece.z0; z <= piece.z1; z++) for (let x = piece.x0; x <= piece.x1; x++) {
    assert.ok(!taken.has(`${x},${z}`), `lote repetido en ${x},${z}`);
    assert.equal(map[z][x], 'building', `lote sobre ${map[z][x]} en ${x},${z}`);
    taken.set(`${x},${z}`, piece);
  }
  const inside = (box, x, z) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
  for (let z = 0; z < CITY_HEIGHT; z++) for (let x = EAST_SEAM; x < CITY_WIDTH; x++) {
    if (map[z][x] !== 'building' || taken.has(`${x},${z}`)) continue;
    assert.ok(inside(CHURCH, x, z) || inside(TOWERS_LOT, x, z), `solar sin construir en ${x},${z}`);
  }
});

test('los dos barrios se distinguen y avisan a quien pinta la calzada', () => {
  assert.equal(neighborhoodAt(300, 60).streets.paintedLines, false);
  assert.equal(neighborhoodAt(300, 60).streets.cobbles, true);
  assert.equal(neighborhoodAt(300, 200).streets.paintedLines, true);
  assert.equal(neighborhoodAt(300, 200).streets.cobbles, false);
  assert.notEqual(neighborhoodAt(300, 60).id, neighborhoodAt(300, 200).id);
  assert.notEqual(neighborhoodAt(50, 60).streets?.paintedLines, false, 'el centro conserva sus líneas');
});

test('a pie se llega desde el cambuche a cada lugar nuevo, y aparecen con nombre en el mapa', () => {
  const nav = city._createPedestrianNavigation();
  const start = nav.nodeAt(nav.nearestPoint(city.reserved.spawn.x, city.reserved.spawn.z).x, nav.nearestPoint(city.reserved.spawn.x, city.reserved.spawn.z).z);
  const visited = new Set([start]), queue = [start];
  for (let head = 0; head < queue.length; head++) for (const next of nav.nodes[queue[head]].neighbors) {
    if (!visited.has(next)) { visited.add(next); queue.push(next); }
  }
  const gps = city.createGpsNavigation();
  for (const zone of [PLAZA, TEUSAQUILLO_PARK, TOWERS_LOT, MARKET]) {
    const place = cityLandmarks().find(landmark => landmark.name === zone.name);
    assert.ok(place, `${zone.name} figura en el mapa`);
    assert.ok(Number.isFinite(place.x) && place.x > 240, zone.name);
    assert.ok(gps.findPath(city.reserved.spawn, place), `el GPS llega a ${zone.name}`);
    const near = nav.nearestPoint(place.x, place.z);
    assert.ok(visited.has(nav.nodeAt(near.x, near.z)), `los peatones llegan a ${zone.name}`);
  }
  const names = streetLabels().map(label => label.name);
  for (const name of ['Carrera 5', 'Carrera 4', 'Carrera 3', 'Calle 8A', 'Calle 6', 'Calle 5']) assert.ok(names.includes(name), name);
  assert.ok(streetLabels().every(label => typeof label.name === 'string'));
  assert.ok(gps.findPath(city.reserved.spawn, { x: CARRERA_3[0] * 2, z: 60 }));
});

test('basura y peatones también llegan al oriente, sin caer sobre la fuente ni los puestos', () => {
  const grid = city.getSpawnGrid();
  const east = grid.filter(point => point.x > 240);
  assert.ok(east.length > 150);
  for (const point of east) {
    assert.ok(Math.hypot(point.x - FOUNTAIN.x, point.z - FOUNTAIN.z) >= FOUNTAIN.radius, 'fuera de la fuente');
    assert.ok(TOWERS.every(tower => !insideTower(tower, point.x, point.z)));
    assert.ok(city.isWalkableAt(point.x, point.z));
  }
  const walkers = city.npcs.filter(npc => npc.position?.x > 240 || npc.home?.x > 240);
  assert.ok(walkers.length >= 10, `peatones en el oriente: ${walkers.length}`);
  assert.equal(city.pigeonFlocks.length, 4);
  assert.ok(city.pigeonFlocks.some(flock => flock.birds[0].position.x > 240));
  assert.ok(city.getParkingSpots().some(spot => spot.x > 240));
});

test('el borde sigue sólido, sin muro a la vista: cierres donde llega una calle y ciudad de fondo detrás', () => {
  // Las cuatro orillas siguen siendo tile de muro: nadie se sale de la ciudad.
  for (let x = 0; x < CITY_WIDTH; x++) assert.equal(map[CITY_HEIGHT - 1][x], 'wall');
  for (let z = 0; z < CITY_HEIGHT; z++) assert.equal(map[z][0] + map[z][CITY_WIDTH - 1], 'wallwall');
  const runs = scanCityEdge(map);
  assert.ok(runs.some(run => run.kind === 'closure' && run.road));
  assert.ok(runs.some(run => run.kind === 'fence'));
  assert.ok(runs.some(run => run.kind === 'facade'));
  for (const side of ['norte', 'sur', 'occidente', 'oriente']) assert.ok(runs.some(run => run.side.name === side), side);
  for (const run of runs.filter(entry => entry.kind === 'closure')) {
    const { side, a, b } = run;
    const middle = Math.round((a + b) / 2);
    const [ix, iz] = side.inner(map, middle);
    assert.equal(collisions.queryStatic(ix * 2 - 1, iz * 2 - 1, ix * 2 + 1, iz * 2 + 1).length > 0, true, `cierre sólido en ${side.name} ${middle}`);
  }
  // El fondo son pocas mallas instanciadas sin colisiones, fuera de los sectores que descarta la cámara.
  const backdrop = city.backdrop;
  let meshes = 0;
  backdrop.traverse(object => { if (object.isMesh) meshes++; });
  assert.ok(meshes <= 10, `mallas de fondo: ${meshes}`);
  assert.ok(backdrop.userData.blockCount > 500);
  assert.ok(!city.renderSectors.includes(backdrop));
  assert.ok(!collisions.colliders.some(({ box }) => box.min.x > CITY_WIDTH * 2 + 1 || box.min.z > CITY_HEIGHT * 2 + 1));
});

test('la ciudad de fondo solo oculta los costados que la cámara no alcanza a ver', () => {
  const backdrop = city.backdrop;
  const terrain = backdrop.children.find(child => !child.isInstancedMesh);
  const parts = backdrop.children.filter(child => child.isInstancedMesh);
  assert.ok(parts.length > 1);
  const camera = new THREE.PerspectiveCamera(55, 1.6, .1, 180);
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(55) / 2) * 1.6;
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  let hiddenInstances = 0, total = 0;
  for (const [x, z, lookX, lookZ] of [[113, 97, 113, 40], [113, 97, 300, 97], [113, 97, 113, 300], [113, 97, -50, 97],
    [300, 60, 400, 60], [380, 300, 500, 400], [75, -60, 75, -200], [12, 12, -60, -60]]) {
    camera.position.set(x, 3, z);
    camera.lookAt(lookX, 2, lookZ);
    camera.updateMatrixWorld();
    terrain.onBeforeRender(null, null, camera);
    for (const part of parts) {
      total += part.count;
      if (part.visible) continue;
      hiddenInstances += part.count;
      for (let i = 0; i < part.count; i++) {
        part.getMatrixAt(i, matrix);
        point.setFromMatrixPosition(matrix).applyMatrix4(camera.matrixWorldInverse);
        // Lo que está dentro del ancho del cuadro no puede quedar oculto, por lejos que esté.
        assert.ok(point.z > 0 || Math.abs(point.x) > -point.z * halfWidth, `bloque oculto a la vista desde ${x},${z}`);
      }
    }
  }
  assert.ok(hiddenInstances > total * .25, `solo se ocultó ${hiddenInstances} de ${total}`);
  // En isométrica las torres se abren al acercarse: su silueta de fondo no puede quedar tapando.
  const inTower = () => parts.some(part => {
    if (!part.visible) return false;
    for (let i = 0; i < part.count; i++) {
      part.getMatrixAt(i, matrix);
      point.setFromMatrixPosition(matrix);
      if (TOWERS.some(tower => insideTower(tower, point.x, point.z))) return true;
    }
    return false;
  });
  camera.position.set(384, 16, 297);
  camera.lookAt(372, 0, 285);
  camera.updateMatrixWorld();
  terrain.onBeforeRender(null, null, camera);
  assert.ok(inTower(), 'en tercera persona la silueta sigue para cuando la torre real sale de alcance');
  camera.userData.cameraMode = 'isometric';
  terrain.onBeforeRender(null, null, camera);
  assert.ok(!inTower(), 'en isométrica no queda silueta dentro de las torres');
  for (const part of parts) part.visible = true;
});

test('las torres curvas quedan dentro de su lote y la plaza libre de construcciones', () => {
  assert.ok(TOWERS.length >= 2);
  let solid = 0;
  for (let z = TOWERS_LOT.z0; z <= TOWERS_LOT.z1; z++) for (let x = TOWERS_LOT.x0; x <= TOWERS_LOT.x1; x++) {
    if (TOWERS.some(tower => insideTower(tower, x * 2, z * 2))) { solid++; assert.equal(map[z][x], 'building'); }
  }
  assert.ok(solid > 40);
  for (let z = PLAZA.z0; z <= PLAZA.z1; z++) for (let x = PLAZA.x0; x <= PLAZA.x1; x++) {
    const churchTile = x >= CHURCH.x0 && x <= CHURCH.x1 && z >= CHURCH.z0 && z <= CHURCH.z1;
    if (!churchTile) assert.notEqual(map[z][x], 'building');
  }
});

test('las texturas de los barrios se crean sin navegador', () => {
  assert.equal(typeof document, 'undefined');
  for (const make of [cobblestones, redBrick, muralSheet, detailSheet]) assert.ok(make().map.isTexture);
  assert.ok(towerFacade().emissiveMap.isTexture);
});
