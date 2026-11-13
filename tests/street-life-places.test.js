// Dónde quedan la pila, el hogar de paso y las estaciones: sobre la ciudad completa, con sus cajas sólidas.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

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
const { streetLifePlaces, isFreeSpot, TRANSIT_ANCHORS } = await import('../src/world/bogota/streetLifePlaces.js');
const { PilaPublica, HogarDePaso, TransitStop } = await import('../src/entities/StreetLifeProps.js');

const city = new Bogota(), scene = new THREE.Scene(), collisions = new CollisionSystem();
city.build(scene, collisions);
const parks = city.pigeonFlocks.map((flock) => flock.bounds);
const places = streetLifePlaces(city, collisions, { parks });
const gps = city.createGpsNavigation();

test('hay pilas en varios parques, separadas y lejos de lo reservado', () => {
  assert.ok(places.pilas.length >= 2, `pilas: ${places.pilas.length}`);
  for (const p of places.pilas) {
    assert.ok(['grass', 'plaza', 'dirt'].includes(city.tileTypeAt(Math.round(p.x / 2), Math.round(p.z / 2))), `${p.x}, ${p.z}`);
    assert.ok(Object.values(city.reserved).every((r) => Math.hypot(p.x - r.x, p.z - r.z) >= 5));
  }
  for (let i = 0; i < places.pilas.length; i++) for (let j = i + 1; j < places.pilas.length; j++) {
    const a = places.pilas[i], b = places.pilas[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 40, 'una por parque');
  }
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
