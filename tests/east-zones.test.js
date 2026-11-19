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
import { towerSilhouette } from '../src/world/bogota/EastLandmarks.js';
import { buildTeusaquilloGarden, onTeusaquilloApron } from '../src/world/bogota/TeusaquilloGarden.js';
import { COLPATRIA } from '../src/world/bogota/Colpatria.js';
import { cityLandmarks, streetLabels } from '../src/world/bogota/CityMapRaster.js';
import { cobblestones, detailSheet, muralSheet, redBrick, towerFacade } from '../src/world/bogota/ZoneTextures.js';

const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), roughnessMap: null, emissiveMap: new THREE.Texture() });
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

test('los jardines de Teusaquillo acompañan las bancas y dejan libres senderos, troncos y residuos', () => {
  const ground = (x, z) => city.getGroundHeight(x, z);
  const garden = buildTeusaquilloGarden({ detail: city.zoneMaterials.detail, brick: city.zoneMaterials.brick,
    soil: city.groundMaterials.dirt }, ground);
  assert.equal(city.group.getObjectByName(garden.name)?.children.length, 1, 'el follaje tiene su propio lote');
  const trees = city.treePlan.filter(({ x, z }) => x > 321 && x < 341 && z > 253 && z < 270);
  for (const mesh of garden.children) {
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.getAttribute('uv');
    assert.equal(uv.count, pos.count);
    assert.ok(uv.array.every(Number.isFinite), mesh.name);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      assert.equal(city.tileTypeAt(Math.round(x / 2), Math.round(z / 2)), 'grass', `${x}, ${z}`);
      assert.ok(trees.every(tree => Math.hypot(x - tree.x, z - tree.z) > .92), 'se conserva la tierra abierta al pie de los troncos');
    }
  }
  assert.deepEqual(city.benchSpots.filter(({ x, z }) => x > 320 && x < 342 && z >= 253 && z <= 315)
    .map(({ x, y, z }) => [x, y, z]), [[326, .06, 264], [336, .06, 264], [326, .06, 300], [336, .06, 300]]);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 2);
  for (const x of [326, 336]) for (const dz of [-.68, .68]) {
    ray.ray.origin.set(x, 1.5, 264 + dz);
    const hit = ray.intersectObject(garden, true)[0]?.point;
    assert.ok(hit && hit.y > .06 && hit.y < .07, 'losetas a ras bajo los apoyos');
  }
  const trash = city.getSpawnGrid().filter(({ x, z }) => x >= 320 && x <= 342 && z >= 253 && z <= 268);
  assert.ok(trash.length > 0);
  for (const { x, z } of trash) for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    ray.ray.origin.set(x + Math.cos(a) * .63, 1.5, z + Math.sin(a) * .63);
    assert.ok(ray.intersectObject(garden, true).every(({ point }) => point.y < ground(point.x, point.z) + .012), `residuo en ${x}, ${z}`);
  }
  for (const mesh of city.group.getObjectByName('Calle: cables y mobiliario').children) {
    if (mesh.name !== 'Calle' || !mesh.geometry.boundingBox?.intersectsBox(
      new THREE.Box3(new THREE.Vector3(325, 0, 262), new THREE.Vector3(337.2, .40, 266)))) continue;
    const { index, attributes: { position } } = mesh.geometry;
    for (let i = 0; i < index.count; i += 3) {
      const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const roots = vertices.filter(j => Math.abs(position.getY(j) - .06) < .001);
      if (roots.length !== 2) continue;
      const tip = vertices.find(j => !roots.includes(j)), height = position.getY(tip);
      if (height > .11 && height < .38) assert.equal(onTeusaquilloApron(position.getX(tip), position.getZ(tip)), false,
        'los penachos del césped dejan libres las dos losetas');
    }
  }
  for (const mesh of garden.children) {
    mesh.geometry.dispose();
    if (mesh.name.startsWith('Herbáceas') || mesh.material.name === 'Loseta mate de las bancas') mesh.material.dispose();
  }
});

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

test('las torres conservan su cresta y su fachada en profundidad más allá del plano lejano', () => {
  for (const tower of TOWERS) {
    const buildings = city.buildingVisibility.buildings.filter(({ root }) => root.position.x === tower.cx && root.position.z === tower.cz);
    const peaks = new Set(towerSilhouette(tower).map(entry => entry.h));
    assert.ok(peaks.size >= 4, 'hay descansos entre los extremos y la cresta');
    let highest = 0;
    for (const building of buildings) {
      const facade = building.wallParts[0].meshes.find(mesh => mesh.material.userData.pastFar);
      assert.ok(facade && !facade.frustumCulled, 'el mismo balcón se dibuja antes y después del far');
      const points = facade.geometry.attributes.position;
      let band = false, recessed = false;
      for (let i = 0; i < points.count; i++) {
        const r = Math.hypot(points.getX(i), points.getZ(i)), y = points.getY(i);
        assert.ok(r <= tower.radius + .001 && r >= tower.radius - tower.thickness - .001);
        if (Math.abs(y - 3.96) < .001 && Math.abs(r - tower.radius) < .001) band = true;
        if (Math.abs(y - 2.98) < .001 && Math.abs(r - (tower.radius - .84)) < .001) recessed = true;
        highest = Math.max(highest, y);
      }
      assert.ok(band && recessed, 'el antepecho y el vidrio ocupan planos diferentes');
      assert.ok(building.batches.some(batch => batch.material.userData.pastFar && !batch.mesh.frustumCulled));
    }
    const expectedPeak = Math.round(tower.floors / 2) * 2 * 3.1 + .5;
    assert.ok(Math.abs(highest - expectedPeak) < .001);
    assert.ok(highest < COLPATRIA.height);
  }
});

test('las texturas de los barrios se crean sin navegador', () => {
  assert.equal(typeof document, 'undefined');
  for (const make of [cobblestones, redBrick, muralSheet, detailSheet]) assert.ok(make().map.isTexture);
  assert.ok(towerFacade().emissiveMap.isTexture);
});
