// Pruebas de los buses de Bogotá: reparto de libreas, carga por hora, tope de gente instanciada y que lejos no cuesta.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { LIVERIES, pickLivery, liveryKey } from '../src/world/bogota/busLiveries.js';
import { makeVehicle, liveryOf, windowMaskOf } from '../src/world/bogota/vehicles.js';
import {
  BusPassengers, CAPACITY, MAX_BUSES, NEAR, PACKED, PEOPLE_PER_BUS, headcount, loadBase, loadFor, rosterOf,
} from '../src/systems/BusPassengers.js';

const mix = seed => { let h = Math.imul(seed + 0x9e37, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return h >>> 0; };

test('los pesos de las libreas suman 100', () => {
  assert.equal(LIVERIES.reduce((sum, l) => sum + l.share, 0), 100);
});

test('el reparto de libreas sigue los pesos: mucho azul y buseta rayada, poco verde y rojo', () => {
  const N = 40000, count = {};
  for (let i = 0; i < N; i++) { const { livery } = pickLivery(mix(i)); count[livery.id] = (count[livery.id] ?? 0) + 1; }
  for (const livery of LIVERIES) assert.ok(Math.abs(count[livery.id] / N * 100 - livery.share) < 1.5, `${livery.id}: ${count[livery.id]}`);
  assert.ok(count.zonal > count.complementario && count.complementario > count.especial && count.especial > count.alimentador && count.alimentador > count.troncal);
});

test('las busetas rayadas son las viejas y reparten seis variantes de rayas', () => {
  const stripes = new Set();
  for (let i = 0; i < 4000; i++) { const { livery, stripe } = pickLivery(mix(i)); if (livery.old) stripes.add(stripe); }
  assert.equal(stripes.size, 6);
  assert.deepEqual(LIVERIES.filter(l => l.old).map(l => l.id), ['busetaVieja']);
  assert.equal(liveryKey(LIVERIES[1], 3), 'busetaVieja3');
  assert.equal(liveryKey(LIVERIES[0], 3), 'zonal');
});

test('la buseta que sale de la fábrica trae su librea, su máscara de ventanas y su semilla, y comparte pintura por librea', () => {
  const a = makeVehicle('buseta', 11), b = makeVehicle('buseta', 11);
  assert.ok(a.livery && a.livery.key);
  assert.equal(a.livery.key, liveryOf(a.seed).key);
  assert.equal(a.windowMask, windowMaskOf(a.seed, a.livery));
  assert.ok(a.windowMask >= 0 && a.windowMask < 4096);
  assert.equal(a.bodyVisual.material, b.bodyVisual.material);
  assert.equal(makeVehicle('carro', 3).livery, null);
  a.dispose(); b.dispose();
});

test('algunas ventanas van abiertas y otras cerradas', () => {
  let open = 0, total = 0;
  for (let i = 0; i < 400; i++) { const m = windowMaskOf(mix(i), liveryOf(mix(i))); for (let k = 0; k < 12; k++) { open += m >> k & 1; total++; } }
  assert.ok(open / total > .25 && open / total < .6);
});

test('la carga: llena en las horas pico, a medias al mediodía y casi vacía de noche', () => {
  for (const h of [7, 7.5, 8, 18, 18.5, 19]) assert.ok(loadBase(h) >= .8, `pico ${h}`);
  for (const h of [11, 12, 13, 14]) assert.ok(loadBase(h) > .3 && loadBase(h) < .6, `mediodía ${h}`);
  for (const h of [0, 1, 2, 3, 23.5]) assert.ok(loadBase(h) < .12, `noche ${h}`);
  assert.ok(loadBase(7.5) > loadBase(12) && loadBase(12) > loadBase(2));
});

test('la suerte de cada bus reparte llenos y vacíos y el pico llena más que el mediodía', () => {
  const avg = h => { let s = 0; for (let i = 0; i < 200; i++) s += headcount(loadFor(h, i / 199)); return s / 200; };
  assert.ok(avg(7.5) > avg(12) * 1.4 && avg(12) > avg(2) * 3);
  assert.equal(headcount(loadFor(7.5, .95)), CAPACITY);
  assert.ok(headcount(loadFor(2, .9)) <= 5);
  assert.ok(loadFor(7.5, .9) >= PACKED && loadFor(12, .9) < PACKED);
  assert.equal(headcount(0), 0);
});

function fakeBus(x, z, seed, { instanced = false } = {}) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const vehicle = { livery: liveryOf(seed), seed, windowMask: windowMaskOf(seed, liveryOf(seed)) };
  return { car: { group, instanced, vehicle } };
}
const camera = (x = 0, z = 0) => new THREE.Vector3(x, 2, z);

test('el tope de gente: con cincuenta busetas encima solo se arman las más cercanas y nunca sobra una instancia', () => {
  const scene = new THREE.Scene(), pax = new BusPassengers(scene);
  const buses = Array.from({ length: 50 }, (_, i) => fakeBus(i % 10 * 2, Math.floor(i / 10) * 3, mix(i) | 0));
  const drawn = pax.sync(buses, camera(), 7.5, 0);
  assert.equal(drawn, MAX_BUSES);
  assert.ok(pax.batch.nHeads <= MAX_BUSES * PEOPLE_PER_BUS);
  assert.equal(pax.batch.heads.count, pax.batch.nHeads);
  assert.ok(pax.batch.boxes.count <= pax.batch.capacity.boxes);
  assert.ok(pax.stats.people <= MAX_BUSES * PEOPLE_PER_BUS);
  pax.dispose();
});

test('lejos de la cámara no se toca ni una instancia, y las busetas del lote lejano no llevan gente', () => {
  const scene = new THREE.Scene(), pax = new BusPassengers(scene);
  const far = Array.from({ length: 60 }, (_, i) => fakeBus(NEAR + 5 + i, 0, i + 1));
  assert.equal(pax.sync(far, camera(), 7.5, 0), 0);
  assert.equal(pax.batch.nHeads, 0); assert.equal(pax.batch.nBoxes, 0);
  assert.equal(pax.batch.boxes.count, 0);
  assert.equal(pax.batch.root.visible, false);
  const version = pax.batch.boxes.instanceMatrix.version;
  for (let i = 0; i < 5; i++) pax.sync(far, camera(), 7.5, i);
  assert.equal(pax.batch.boxes.instanceMatrix.version, version, 'sin gente no se suben matrices');
  const lejano = Array.from({ length: 5 }, (_, i) => fakeBus(i, 0, i + 1, { instanced: true }));
  assert.equal(pax.sync(lejano, camera(), 7.5, 0), 0);
  assert.equal(pax.sync([fakeBus(3, 3, 5)], null, 7.5, 0), 0);
  pax.dispose();
});

test('un bus cercano lleva más gente en la hora pico que de noche, y la lista de pasajeros es fija por semilla', () => {
  const scene = new THREE.Scene(), pax = new BusPassengers(scene), bus = fakeBus(2, 2, 77);
  bus.car.vehicle._luck = .9;
  pax.sync([bus], camera(), 7.5, 0); const rush = pax.stats.people;
  pax.sync([bus], camera(), 2, 0); const night = pax.stats.people;
  assert.ok(rush > 40 && night < 8, `${rush} vs ${night}`);
  const first = rosterOf(bus.car.vehicle).map(p => p.shirt.getHex());
  assert.deepEqual(rosterOf(fakeBus(0, 0, 77).car.vehicle).map(p => p.shirt.getHex()), first);
  assert.equal(first.length, CAPACITY);
  pax.dispose();
});
