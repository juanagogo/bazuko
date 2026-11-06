import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { MOTO_CAPACITY, MOTO_LATERAL, MOTO_LOAD_COUNT, MOTO_LAYOUTS, MOTO_VARIANTS, MotoFleet, motoLoad } from '../src/world/bogota/motos.js';
import { Moto } from '../src/entities/Moto.js';
import { trafficTargetVehicles, motoShare } from '../src/systems/trafficDensity.js';

/** Cuenta vértices por puesto, por casco y por parte en la geometría de una variante. */
function tags(geometry) {
  const rider = geometry.attributes.aRider.array, seats = [0, 0, 0, 0, 0], parts = new Map();
  let helmetVerts = 0, garmentVerts = 0;
  for (let i = 0; i < rider.length; i += 4) {
    const slot = rider[i], head = rider[i + 1], garment = rider[i + 2], part = rider[i + 3];
    if (slot > 0) seats[slot - 1]++;
    if (head > .5) helmetVerts++;
    if (garment > .5) garmentVerts++;
    if (part > .5) parts.set(part, (parts.get(part) ?? 0) + 1);
  }
  return { seats, parts, helmetVerts, garmentVerts, total: rider.length / 4 };
}

test('cada variante trae su geometría con los puestos, el casco y los accesorios marcados', () => {
  const fleet = new MotoFleet(new THREE.Group(), 4);
  const geoms = fleet.batches.map(batch => batch.mesh.geometry);
  assert.equal(geoms.length, MOTO_VARIANTS.length);
  geoms.forEach((geometry, index) => {
    const { seats, parts, helmetVerts, garmentVerts, total } = tags(geometry);
    assert.equal(total, geometry.attributes.position.count, `Variante ${MOTO_VARIANTS[index]}`);
    assert.ok(seats[0] > 0, `${MOTO_VARIANTS[index]} sin conductor`);
    assert.ok(helmetVerts > 0, `${MOTO_VARIANTS[index]} sin casco que esconder`);
    assert.ok(garmentVerts > 0, `${MOTO_VARIANTS[index]} sin ropa teñible`);
    assert.equal(geometry.attributes.aRider.itemSize, 4);
    assert.equal(geometry.attributes.aSeatAt.itemSize, 3);
    // El presupuesto se mantiene por variante: siguen siendo pocos triángulos por moto.
    assert.ok(geometry.index.count / 3 < 15000, `${MOTO_VARIANTS[index]} con demasiados triángulos`);
    // Piernas, brazos, bolsa y morral: las partes que la animación y los accesorios necesitan.
    for (const part of [2, 3, 4, 5]) assert.ok(parts.get(part) > 0, `${MOTO_VARIANTS[index]} sin parte ${part}`);
  });
  // El domicilio lleva la caja en la parrilla: nadie va sentado detrás del conductor.
  const delivery = tags(geoms[MOTO_VARIANTS.indexOf('domicilio')]);
  assert.equal(delivery.seats[1], 0);
  assert.equal(delivery.seats[2], 0);
  assert.equal(fleet.drawn, 0);
  fleet.dispose();
});

test('la carga reparte de una a cinco personas, con niños delante y atrás', () => {
  const loads = Array.from({ length: MOTO_LOAD_COUNT }, (_, count) => motoLoad(count));
  const size = load => load.occupancy.filter(Boolean).length;
  assert.deepEqual(new Set(loads.map(size)), new Set([1, 2, 3, 4, 5]));
  assert.ok(loads.filter(load => size(load) <= 2).length > loads.length / 2, 'la mayoría lleva uno o dos');
  assert.ok(loads.some(load => load.occupancy[1]), 'nadie en el tanque');
  assert.ok(loads.some(load => load.occupancy[3] && load.helmets[3]), 'ningún parrillero con casco');
  assert.ok(loads.some(load => load.bags.some(Boolean)), 'sin bolsas de mercado');
  assert.ok(loads.some(load => load.packs.filter(Boolean).length >= 2), 'sin colegio con morrales');
  assert.ok(loads.some(load => load.variant === MOTO_VARIANTS.indexOf('domicilio')), 'sin domiciliarios');
  // El puesto del fondo también se reparte: la familia de cinco ocupa los cinco.
  const family = motoLoad(8);
  assert.deepEqual([...family.occupancy], [true, true, true, true, true]);
  assert.deepEqual([...family.kids], [false, true, true, true, false]);
  // El lote sostiene cientos de motos repartidas entre las cuatro variantes.
  const budget = new MotoFleet(new THREE.Group());
  assert.ok(budget.batches.every(batch => batch.capacity === MOTO_CAPACITY));
  assert.ok(MOTO_CAPACITY >= 128, 'el tráfico denso pone cientos de motos');
  budget.dispose();
  // Determinista: la misma moto reparte siempre la misma carga.
  const a = motoLoad(7), b = motoLoad(7);
  assert.deepEqual(a, b);
  // El niño del tanque nunca maneja y los cascos de atrás son cosa de cada carga.
  loads.forEach((load, count) => {
    assert.ok(load.occupancy[0], `Moto ${count} sin conductor`);
    if (load.kids.some(Boolean)) assert.ok(load.kids[1] || load.kids[2] || load.kids[3] || load.kids[4]);
  });
  assert.deepEqual(MOTO_LAYOUTS.domicilio, [[0], [0]]);
});

test('la flota dibuja una instancia por moto viva y la esconde cuando se apaga', () => {
  const fleet = new MotoFleet(new THREE.Group(), 8);
  const moto = new Moto(new THREE.Vector3(10, 0, 5), .5, {
    variant: 0, occupancy: [true, true, true, false, false], helmets: [true, false, true, false, false],
    kids: [false, true, false, false, false], bags: [false, false, true, false, false],
    packs: [false, false, false, false, false], cloth: [1, 4, 2, 0, 0], color: '#c21d1a', phase: 1.2
  });
  const vehicle = { car: moto, speed: 2, acceleration: .4, _driveContext: { steering: .1 } };
  fleet.sync([vehicle, { car: { isMoto: false } }]);
  assert.equal(fleet.drawn, 1);
  const batch = fleet.batches[0];
  assert.equal(batch.mesh.count, 1);
  // Puestos 0, 1 y 2 ocupados; cascos 0 y 2; tamaño de niño solo en el 1; bolsa en el 2.
  assert.deepEqual([...batch.bits.array.slice(0, 4)], [1 | 2 | 4, 1 | 4, 2, 4]);
  assert.equal(batch.packs.array[0], 0);
  assert.equal(batch.cloth.array[0], 1 + 4 * 8 + 2 * 64);
  assert.ok(Math.abs(batch.motion.array[0] - .4) < 1e-5 && batch.motion.array[1] === 2);
  assert.ok(Math.abs(batch.motion.array[2] - .1) < 1e-5 && Math.abs(batch.motion.array[3] - 1.2) < 1e-5);
  // La esfera cubre lo dibujado: el lote se descarta cuando ninguna moto está a la vista.
  assert.ok(batch.mesh.boundingSphere.radius > MOTO_LATERAL);
  moto.setDrawn(false);
  fleet.sync([vehicle]);
  assert.equal(fleet.drawn, 0);
  assert.equal(batch.mesh.count, 0);
  fleet.dispose();
});

test('las motos son una tajada mayor de la flota en las horas pico', () => {
  assert.ok(motoShare(7) > motoShare(3) + .05, `${motoShare(7)} contra ${motoShare(3)}`);
  assert.ok(motoShare(7) <= .5 && motoShare(3) >= .25);
  assert.ok(trafficTargetVehicles(7, 'normal') > trafficTargetVehicles(3, 'normal'));
});
