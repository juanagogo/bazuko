// Dónde quedan la pila, el hogar de paso y las estaciones: sobre la ciudad completa, con sus cajas sólidas.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { INTERACT_RANGE, TILE_SIZE } from '../src/utils/constants.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { pedestrianCrossings } from '../src/world/bogota/StreetCrossings.js';

const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture(), signMesh: () => new THREE.Group() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { streetLifePlaces, restorePilaWaypoint, isFreeSpot, TRANSIT_ANCHORS } = await import('../src/world/bogota/streetLifePlaces.js');
const { PilaPublica, HogarDePaso, TransitStop } = await import('../src/entities/StreetLifeProps.js');

const city = new Bogota(), scene = new THREE.Scene(), collisions = new CollisionSystem();
city.build(scene, collisions);
const parks = city.pigeonFlocks.map((flock) => flock.bounds);
const places = streetLifePlaces(city, collisions, { parks });
const gps = city.createGpsNavigation();

test('hay pilas en varios parques, separadas y lejos de lo reservado', () => {
  assert.equal(places.pilas.length, 3);
  for (const p of places.pilas) {
    assert.equal(city.tileTypeAt(Math.round(p.x / TILE_SIZE), Math.round(p.z / TILE_SIZE)), 'plaza');
    assert.ok(Object.values(city.reserved).every((r) => Math.hypot(p.x - r.x, p.z - r.z) >= 5));
  }
  for (let i = 0; i < places.pilas.length; i++) for (let j = i + 1; j < places.pilas.length; j++) {
    const a = places.pilas[i], b = places.pilas[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 40, 'una por parque');
  }
});

test('la ruta a cada pila termina frente a la llave, fuera del sólido y al alcance de uso', () => {
  const solids = new CollisionSystem();
  solids.colliders.push(...collisions.colliders);
  for (const { x, z, previous } of places.pilas) {
    const pila = new PilaPublica(scene, new THREE.Vector3(x, city.getGroundHeight(x, z), z));
    pila.previous = previous;
    solids.add(pila.group, pila.collider.size);
    const saved = { name: 'Pila pública', icon: '💧', ...previous };
    const goal = restorePilaWaypoint(saved, [pila]);
    assert.deepEqual(goal, { ...saved, x: pila.approach.x, z: pila.approach.z });
    for (const manual of [{ ...saved, name: 'Punto marcado' }, { ...saved, x: saved.x + 1 }]) {
      assert.equal(restorePilaWaypoint(manual, [pila]), manual);
    }
    assert.ok(gps.setWaypoint(goal, city.reserved.spawn));
    const end = gps.route.at(-1);
    assert.deepEqual(end, { x: goal.x, z: goal.z });
    assert.equal(city.tileTypeAt(Math.round(end.x / TILE_SIZE), Math.round(end.z / TILE_SIZE)), 'plaza');
    assert.ok(isFreeSpot(city, solids, end.x, end.z, .5));
    assert.ok(Math.hypot(end.x - x, end.z - z) < INTERACT_RANGE);
    assert.ok(isFreeSpot(city, solids, previous.x, previous.z, .65), 'el cruce original queda libre');
    pila.dispose();
  }
});

test('el cuenco de la pila deja el agua visible por debajo del borde', () => {
  const pila = new PilaPublica(scene, new THREE.Vector3());
  pila.group.updateMatrixWorld(true);
  const down = new THREE.Vector3(0, -1, 0);
  const hit = x => new THREE.Raycaster(new THREE.Vector3(x, 2, 0), down).intersectObject(pila.group)[0];
  const water = hit(0), rim = hit(.68);
  assert.ok(water.object.material.color.b > water.object.material.color.r);
  assert.ok(water.point.y + .12 < rim.point.y);
  assert.ok(water.object.material.transparent && !water.object.material.depthWrite);
  const under = new THREE.Raycaster(new THREE.Vector3(.002, 2, .013), down).intersectObject(pila.group);
  assert.equal(under[0].object, water.object);
  const drain = under.find(item => item.object.name.endsWith('sumidero'));
  assert.ok(drain && drain.point.y < water.point.y - .03 && drain.point.y > .598, 'rejilla bajo la lámina de agua');
  const side = new THREE.Raycaster(new THREE.Vector3(.24, 2, .12), down).intersectObject(pila.group);
  assert.equal(side[0].object, water.object);
  assert.ok(side[1].point.y > drain.point.y, 'el fondo baja hacia la rejilla');
  pila.dispose();
});

test('la pila conserva su huella, acceso y cinco mallas con acabados aislados', () => {
  const parent = new THREE.Scene();
  const pila = new PilaPublica(parent, new THREE.Vector3()), second = new PilaPublica(parent, new THREE.Vector3(4, 0, 0), Math.PI / 2);
  const hogar = new HogarDePaso(parent, new THREE.Vector3());
  const bounds = new THREE.Box3().setFromObject(pila.group);
  assert.ok(Math.abs(bounds.min.x + .75) < .001 && Math.abs(bounds.max.x - .75) < .001);
  assert.ok(Math.abs(bounds.min.z + .45) < .001 && Math.abs(bounds.max.z - .45) < .001);
  assert.ok(Math.abs(bounds.max.y - 1.171) < .001);
  assert.deepEqual(pila.collider.size.toArray(), [1.5, 1, .9]);
  assert.deepEqual(pila.approach.toArray(), [0, 0, 1.3]);
  assert.ok(second.approach.distanceTo(new THREE.Vector3(5.3, 0, 0)) < 1e-8);
  assert.equal(pila.group.children.length, 5);
  const materiales = pila.group.children.map(mesh => mesh.material);
  assert.ok(materiales.every((m, i) => m === second.group.children[i].material));
  assert.ok(materiales[0].bumpMap && materiales[1].map === materiales[0].map);
  hogar.group.traverse(part => { if (part.isMesh) assert.ok(!materiales.includes(part.material)); });
  for (const p of [pila, second, hogar]) p.dispose();
});

test('el hogar de paso queda en un andén, contra una fachada, a una caminada del cambuche', () => {
  const h = places.hogar;
  assert.ok(h, 'hay hogar de paso');
  assert.equal(city.tileTypeAt(Math.round(h.x / 2), Math.round(h.z / 2)), 'sidewalk');
  const d = Math.hypot(h.x - city.reserved.bed.x, h.z - city.reserved.bed.z);
  assert.ok(d >= 45 && d <= 110, `a ${d.toFixed(0)} m del cambuche`);
  assert.ok(isFreeSpot(city, collisions, h.x, h.z, .9));
});

test('las tres paradas del transporte existen, se llega a pie y no hay cajas encima', () => {
  assert.deepEqual(places.transit.map((s) => s.id), TRANSIT_ANCHORS.map((a) => a.id));
  for (const s of places.transit) {
    assert.ok(isFreeSpot(city, collisions, s.x, s.z), s.id);
    assert.ok(gps.isRoutable(s.x, s.z), `${s.id} en ${s.x}, ${s.z} no se alcanza a pie`);
    assert.ok(Math.hypot(s.x - TRANSIT_ANCHORS.find((a) => a.id === s.id).x, s.z - TRANSIT_ANCHORS.find((a) => a.id === s.id).z) <= 10);
  }
});

test('el lector del Portal deja libre la guía táctil y el pasaje se activa desde el centro de la rampa', () => {
  const stop = places.transit.find((s) => s.id === 'portal');
  const position = new THREE.Vector3(stop.x, city.getGroundHeight(stop.x, stop.z), stop.z);
  const portal = new TransitStop(new THREE.Scene(), position, stop);
  const readerBounds = new THREE.Box3().setFromObject(portal.group);

  assert.ok(readerBounds.min.x > 73.084, 'el lector queda por dentro de la baranda');
  assert.ok(readerBounds.max.x < 73.84, 'el lector queda fuera de la guía táctil');
  assert.equal(portal.stop, stop);
  assert.deepEqual(portal.position, position);
  assert.ok(Math.abs(75 - portal.position.x) < INTERACT_RANGE);
  portal.dispose();
});

test('el acceso de Calle 72 se lee desde oriente y deja su lector dentro de la huella de la pila', () => {
  const stop = places.transit.find(item => item.id === 'metro72');
  assert.deepEqual([stop.x, stop.z], [77, 112]);
  const ground = city.getGroundHeight(stop.x, stop.z);
  const access = new TransitStop(new THREE.Scene(), new THREE.Vector3(stop.x, ground, stop.z), stop);
  access.group.updateMatrixWorld(true);

  const support = collisions.queryStatic(stop.x - 2, stop.z - 1, stop.x, stop.z + 1, [])
    .find(entry => entry.mesh.name === 'Pila del Metro');
  assert.ok(support);
  const nearGround = new THREE.Box3();
  const vertex = new THREE.Vector3();
  for (const mesh of access.group.children) {
    const points = mesh.geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      vertex.fromBufferAttribute(points, i).applyMatrix4(mesh.matrixWorld);
      if (vertex.y <= ground + 1.8) nearGround.expandByPoint(vertex);
    }
  }
  assert.ok(Math.abs(nearGround.min.y - ground) < .001);
  assert.ok(support.box.containsBox(nearGround), 'El lector aprovecha el obstáculo de la pila');

  const sign = access.group.getObjectByName('Rótulo del Metro en Calle 72');
  const east = new THREE.Raycaster(new THREE.Vector3(stop.x + 10, ground + 2.25, stop.z + .38), new THREE.Vector3(-1, 0, 0));
  assert.equal(east.intersectObject(access.group)[0]?.object, sign);
  assert.ok(isFreeSpot(city, collisions, stop.x, stop.z));
  assert.ok(isFreeSpot(city, collisions, stop.x, stop.z + 1.6, .5), 'Se puede salir a pie al bajarse');
  assert.equal(access.gpsWaypoint.arrivalDistance, INTERACT_RANGE);
  assert.equal(access.acceptsGpsArrival(access.position, access), true);
  assert.equal(access.acceptsGpsArrival(access.position, null), false);
  access.dispose();
});

test('el andén de Calle 72 termina en la cebra real, a cota del prado y libre de la calzada', () => {
  const landing = city.group.getObjectByName('Andén peatonal de Calle 72');
  const bounds = new THREE.Box3().setFromObject(landing);
  assert.equal(bounds.max.x, 81);
  assert.ok(Math.abs(bounds.max.y - .06) < 1e-6);
  const crossing = pedestrianCrossings(city.map).find(step => step.x === 81 && step.z === 87 && step.dx === 1);
  assert.ok(crossing);
  assert.ok(Math.abs(bounds.min.z - (crossing.z - crossing.width / 2)) < 1e-5);
  for (const [x, z] of [[80, 87], [80, 103], [78.9, 107], [77, 112], [77, 113.6]]) {
    assert.equal(city.getGroundTypeAt(x, z), 'sidewalk');
    assert.equal(city.getMovementGroundHeight(x, z, 0), .06);
    assert.ok(isFreeSpot(city, collisions, x, z, .4));
  }
  assert.equal(city.getGroundTypeAt(81.1, 87), 'road');
  assert.equal(city.getGroundTypeAt(78.9, 98), 'grass');
});

test('el GPS de Calle 72 usa la cebra, vuelve a planear dentro del separador y restaura el destino de antes', () => {
  const stop = places.transit.find(item => item.id === 'metro72');
  const route = city.createGpsNavigation();
  const saved = { name: stop.name, x: stop.x, z: stop.z, icon: '🚏' };
  const east = { x: 112.98, z: 97.84 };
  assert.ok(route.setWaypoint(saved, east, 0));
  assert.deepEqual(route.serialize(), saved);
  const assertCrossing = edge => {
    const cross = route.route.slice(1).flatMap((end, i) => {
      const start = route.route[i];
      if ((start.x < edge) === (end.x < edge)) return [];
      return [start.z + (end.z - start.z) * (edge - start.x) / (end.x - start.x)];
    });
    assert.equal(cross.length, 1);
    assert.ok(cross[0] >= 85.6 && cross[0] <= 88.4);
  };
  assertCrossing(93);
  assertCrossing(81);
  assert.ok(route.route.some(({ x, z }) => x === 80 && z >= 103.4 && z <= 106));

  const median = { x: 70, z: 115.8 };
  assert.equal(route.update(median, 1500), 'replanned');
  assert.ok(route.route.every(({ x, z }) => x >= 69 && x <= 81 && z > 105));
  assert.ok(route.setWaypoint(saved, { x: 77, z: 113.6 }));
  assert.ok(route.route.every(({ x, z }) => x >= 76.5 && x <= 79 && z >= 111));

  const oldPosition = { x: 85, z: 110 };
  assert.ok(route.setWaypoint(saved, oldPosition));
  assert.ok(route.route.every(({ x, z }) => x <= 86 && z >= 108 && z <= 114));
  const other = { x: 77, z: 112, name: 'Punto marcado' };
  const usualPath = route.findPath(east, other);
  route.destinationBarrier = null;
  assert.deepEqual(route.findPath(east, other), usualPath);
});

test('siempre los mismos sitios: el jugador los aprende', () => {
  assert.deepEqual(streetLifePlaces(city, collisions, { parks }), places);
});

test('los objetos se arman sin luces y sueltan su geometría al cerrar', () => {
  const s = new THREE.Scene();
  const props = [
    new PilaPublica(s, new THREE.Vector3()), new HogarDePaso(s, new THREE.Vector3()),
    new TransitStop(s, new THREE.Vector3(), { name: 'Prueba', sistema: 'Metro' })
  ];
  let lights = 0;
  s.traverse((o) => { if (o.isLight) lights++; });
  assert.equal(lights, 0);
  assert.deepEqual(props.map((p) => p.kind), ['pila', 'hogar', 'transit']);
  for (const p of props) p.dispose();
  assert.equal(s.children.length, 0);
});
