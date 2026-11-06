import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { MOTO_LATERAL, MOTO_LAYOUTS, MOTO_VARIANTS, MotoFleet } from '../src/world/bogota/motos.js';
import { Moto } from '../src/entities/Moto.js';
import { trafficTargetVehicles, motoShare } from '../src/systems/trafficDensity.js';

/** Cuenta vértices por puesto y por casco en la geometría de una variante. */
function tags(geometry) {
  const rider = geometry.attributes.aRider.array, seats = [0, 0, 0];
  let helmetVerts = 0;
  for (let i = 0; i < rider.length; i += 2) {
    if (rider[i] > 0) seats[rider[i] - 1]++;
    if (rider[i + 1] > .5) helmetVerts++;
  }
  return { seats, helmetVerts, total: rider.length / 2 };
}

test('cada variante trae su geometría con los puestos y el casco marcados', () => {
  const fleet = new MotoFleet(new THREE.Group(), 4);
  const geoms = fleet.batches.map(batch => batch.mesh.geometry);
  assert.equal(geoms.length, MOTO_VARIANTS.length);
  geoms.forEach((geometry, index) => {
    const { seats, helmetVerts, total } = tags(geometry);
    assert.equal(total, geometry.attributes.position.count, `Variante ${MOTO_VARIANTS[index]}`);
    assert.ok(seats[0] > 0, `${MOTO_VARIANTS[index]} sin conductor`);
    assert.ok(helmetVerts > 0, `${MOTO_VARIANTS[index]} sin casco que esconder`);
    assert.equal(geometry.attributes.aRider.itemSize, 2);
  });
  // El domicilio carga la caja en el puesto de atrás: nadie va sentado ahí.
  const delivery = tags(geoms[MOTO_VARIANTS.indexOf('domicilio')]);
  assert.equal(delivery.seats[1], 0);
  assert.equal(delivery.seats[2], 0);
  assert.deepEqual(MOTO_LAYOUTS.domicilio, [[0]]);
  assert.equal(fleet.drawn, 0);
  fleet.dispose();
});

test('la flota dibuja una instancia por moto viva y la esconde cuando se apaga', () => {
  const fleet = new MotoFleet(new THREE.Group(), 8);
  const moto = new Moto(new THREE.Vector3(10, 0, 5), .5, {
    variant: 0, occupancy: [true, true, true], helmets: [true, false, true], color: '#c21d1a'
  });
  const vehicle = { car: moto, speed: 2 };
  fleet.sync([vehicle, { car: { isMoto: false } }]);
  assert.equal(fleet.drawn, 1);
  const batch = fleet.batches[0];
  assert.equal(batch.mesh.count, 1);
  assert.deepEqual([...batch.riders.array.slice(0, 3)], [1, 1, 1]);
  assert.deepEqual([...batch.helmets.array.slice(0, 3)], [1, 0, 1]);
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
