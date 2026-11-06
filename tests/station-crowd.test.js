// Pruebas de la gente del andén: más en la hora pico, tope de instancias y cero costo lejos de la estación.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { NEAR, SLOT_COUNT, StationCrowd, buildSlots, platformDensity } from '../src/systems/StationCrowd.js';
import { TERMINAL } from '../src/world/bogota/TransitTerminal.js';

const near = () => new THREE.Vector3(TERMINAL.x, 2, TERMINAL.z + 20);
const far = () => new THREE.Vector3(TERMINAL.x + NEAR + 50, 2, TERMINAL.z);

test('el andén se llena en la hora pico y casi se vacía de noche', () => {
  for (const h of [7, 7.5, 8, 18, 19]) assert.ok(platformDensity(h) >= .8, `pico ${h}`);
  for (const h of [11, 12, 14]) assert.ok(platformDensity(h) > .35 && platformDensity(h) < .6);
  for (const h of [0, 2, 3]) assert.ok(platformDensity(h) < .1);
});

test('hay gente de borde a borde del andén y los turnos son estables', () => {
  const slots = buildSlots();
  assert.equal(slots.length, SLOT_COUNT);
  const xs = slots.map(s => s.x);
  assert.ok(Math.min(...xs) < TERMINAL.x - 1.2 && Math.max(...xs) > TERMINAL.x + 1.2);
  assert.deepEqual(buildSlots().map(s => s.turn), slots.map(s => s.turn));
  for (const s of slots) assert.ok(s.x > TERMINAL.x - 2 && s.x < TERMINAL.x + 2 && s.z < -9 && s.z > -51);
});

test('en la hora pico se dibuja más gente que a mediodía y que de noche, siempre bajo el tope', () => {
  const scene = new THREE.Scene(), crowd = new StationCrowd(scene);
  const rush = crowd.update(near(), 7.5), noon = crowd.update(near(), 12.5), night = crowd.update(near(), 2);
  assert.ok(rush > noon && noon > night && night > 0, `${rush} ${noon} ${night}`);
  assert.ok(rush <= SLOT_COUNT && crowd.batch.heads.count <= crowd.batch.capacity.heads);
  assert.ok(crowd.batch.boxes.count <= crowd.batch.capacity.boxes);
  crowd.dispose();
});

test('lejos de la estación o donde no hay estación no se arma ni se sube nada', () => {
  const scene = new THREE.Scene(), crowd = new StationCrowd(scene);
  assert.equal(crowd.update(far(), 7.5), 0);
  assert.equal(crowd.slots, null, 'ni los puestos se arman');
  assert.equal(crowd.batch.root.visible, false);
  assert.equal(crowd.update(near(), 7.5, false), 0);
  assert.equal(crowd.slots, null);
  const version = crowd.batch.boxes.instanceMatrix.version;
  for (let i = 0; i < 5; i++) crowd.update(far(), 7.5);
  assert.equal(crowd.batch.boxes.instanceMatrix.version, version);
  crowd.dispose();
});

test('solo se vuelve a armar cuando cambia la densidad, y al alejarse se vacía', () => {
  const scene = new THREE.Scene(), crowd = new StationCrowd(scene);
  crowd.update(near(), 7.5);
  const version = crowd.batch.boxes.instanceMatrix.version;
  crowd.update(near(), 7.5); crowd.update(near(), 7.5001);
  assert.equal(crowd.batch.boxes.instanceMatrix.version, version);
  crowd.update(far(), 7.5);
  assert.equal(crowd.batch.boxes.count, 0);
  assert.equal(crowd.update(near(), 7.5) > 0, true);
  crowd.dispose();
});
