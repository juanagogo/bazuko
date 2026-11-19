import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.window ??= new EventTarget();
const { Car } = await import('../src/entities/Car.js');
const { CAR_MODEL_IDS } = await import('../src/world/bogota/vehicles.js');

const newCar = options => new Car(new THREE.Scene(), new THREE.Vector3(), 0, { variant: 3, ...options });
const triangles = geometry => (geometry.index?.count ?? geometry.attributes.position.count) / 3;

test('con las luces prendidas el haz alumbra delante de la trompa y tiñe el piso detrás de la cola', () => {
  const car = newCar({ traffic: true, model: 'sedanPopular' }), beam = car.vehicle.beam, plain = beam.geometry;
  car.setNight(false, false);
  assert.ok(beam.geometry === plain, 'de día y sin lluvia el haz no se toca');
  car.setNight(true, false);
  assert.equal(triangles(beam.geometry), 4);
  beam.geometry.computeBoundingBox();
  const { min, max } = beam.geometry.boundingBox, L = car.vehicle.length;
  // El haz cuelga del carro: su X más la posición del haz da metros desde el centro del carro.
  assert.ok(beam.position.x + max.x > L / 2 + 8, 'el charco de los faros llega lejos');
  assert.ok(beam.position.x + min.x < -L / 2 - 2.5, 'el rojo de los stops queda detrás de la cola');
  car.dispose();
});

test('la luz sobre el piso se comparte entre carros del mismo largo, no viste al parqueado y pesa más con lluvia', () => {
  const a = newCar({ traffic: true, model: 'citadino' }), b = newCar({ traffic: true, model: 'citadino' }), parked = newCar({ model: 'citadino' });
  for (const car of [a, b, parked]) car.setNight(true, true);
  assert.ok(a.vehicle.beam.geometry === b.vehicle.beam.geometry, 'una geometría por largo de carro');
  assert.ok(a.vehicle.beam.material.map === b.vehicle.beam.material.map, 'una sola textura');
  assert.ok(a.vehicle.beam.material !== b.vehicle.beam.material, 'la fuerza va por carro');
  assert.ok(parked.vehicle.beam === null);
  const wet = a.vehicle.beam.material.opacity;
  a.setNight(true, false);
  assert.ok(wet > a.vehicle.beam.material.opacity, 'el piso mojado devuelve más luz');
  for (const car of [a, b, parked]) car.dispose();
});

test('con el haz vestido cada vehículo sigue dentro del presupuesto de geometría y llamadas', () => {
  const fleet = [...CAR_MODEL_IDS.map(id => ['carro', id]), ['taxi', 'citadino'], ['taxi', 'sedanPopular'], ['police', 'sedanPopular'], ['police', 'suv'], ['buseta', 'buseta']];
  for (const [kind, model] of fleet) {
    const car = new Car(new THREE.Scene(), new THREE.Vector3(), 0, { kind, model, traffic: true, variant: 1 });
    car.setNight(true, false);
    let calls = 0, count = 0;
    car.group.traverse(o => {
      if (!o.isMesh || o === car.marker) return;
      calls++; count += triangles(o.geometry);
    });
    // La buseta lleva una malla más: sus pasajeros pintados.
    assert.ok(calls <= (model === 'buseta' ? 15 : 14), `${kind}/${model}: ${calls} llamadas`);
    const budget = model === 'citadino' ? 7400 : 7000;
    assert.ok(count <= budget, `${kind}/${model}: ${count} triángulos`);
    car.dispose();
  }
});
