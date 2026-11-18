// Pruebas de la gente del andén: más en la hora pico, tope de instancias y cero costo lejos de la estación.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CAP, NEAR, OPS_PER_FRAME, SLOT_COUNT, StationCrowd, buildSlots, platformDensity } from '../src/systems/StationCrowd.js';
import { fakePool } from './fakePool.js';
import { TERMINAL } from '../src/world/bogota/TransitTerminal.js';

const near = () => new THREE.Vector3(TERMINAL.x, 2, TERMINAL.z + 20);
const far = () => new THREE.Vector3(TERMINAL.x + NEAR + 50, 2, TERMINAL.z);

test('el andén se llena en la hora pico y casi se vacía de noche', () => {
  for (const h of [7, 7.5, 8, 18, 19]) assert.ok(platformDensity(h) >= .8, `pico ${h}`);
  for (const h of [11, 12, 14]) assert.ok(platformDensity(h) > .35 && platformDensity(h) < .6);
  for (const h of [0, 2, 3]) assert.ok(platformDensity(h) < .1);
});

const run = (crowd, camera, hour, frames = 40) => { let n = 0; for (let i = 0; i < frames; i++) n = crowd.update(camera, hour, true, 1 / 30); return n; };

test('hay gente de borde a borde del andén, irregular, de miradas distintas, y los turnos son estables', () => {
  const slots = buildSlots();
  assert.ok(slots.length > 300 && slots.length <= SLOT_COUNT);
  const xs = slots.map(s => s.x);
  assert.ok(Math.min(...xs) < TERMINAL.x - 1.2 && Math.max(...xs) > TERMINAL.x + 1.2);
  assert.deepEqual(buildSlots().map(s => s.turn), slots.map(s => s.turn));
  for (const s of slots) assert.ok(s.x > TERMINAL.x - 2 && s.x < TERMINAL.x + 2 && s.z < -9 && s.z > -51);
  const gaps = new Set(slots.slice(1, 80).map((s, i) => (s.z - slots[i].z).toFixed(2)));
  assert.ok(gaps.size > 20, 'no es una grilla: los pasos son desiguales');
  const toward = slots.filter(s => Math.abs(Math.cos(s.yaw)) > .6).length;
  assert.ok(toward > slots.length * .6 && toward < slots.length, 'la mayoría mira a la calzada, otros no');
});

test('en la hora pico hay más gente real que a mediodía y que de noche, siempre bajo el tope', async () => {
  const pool = await fakePool(120), crowd = new StationCrowd(null, pool);
  const rush = run(crowd, near(), 7.5), noon = run(crowd, near(), 12.5), night = run(crowd, near(), 2);
  assert.ok(rush > noon && noon > night && night > 0, `${rush} ${noon} ${night}`);
  assert.ok(rush <= CAP && pool.inUse === night);
  assert.equal(run(crowd, near(), 7.5), CAP, 'a tope cuando el jugador está cerca');
  assert.ok([...pool.figures].filter(f => f.group.visible).length === CAP);
  assert.ok([...pool.figures].every(f => !f.live), 'esperan quietos');
});

test('solo se presta gente a las personas más cercanas a la cámara', async () => {
  const pool = await fakePool(120), crowd = new StationCrowd(null, pool);
  const camera = new THREE.Vector3(TERMINAL.x, 2, -12);
  run(crowd, camera, 7.5);
  const zs = [...crowd.held.keys()].map(i => crowd.slots[i].z);
  assert.ok(Math.max(...zs) - Math.min(...zs) < 30 && Math.min(...zs) > -42, 'el grupo queda alrededor de la cámara');
  const first = [...crowd.held.keys()].sort();
  const mover = new THREE.Vector3(TERMINAL.x, 2, -48);
  run(crowd, mover, 7.5, 80);
  assert.notDeepEqual([...crowd.held.keys()].sort(), first, 'al moverse la cámara, la gente se recicla hacia ella');
  assert.equal(pool.inUse, crowd.held.size);
});

test('cada cuadro solo se prestan unas pocas personas', async () => {
  const pool = await fakePool(120), crowd = new StationCrowd(null, pool);
  crowd.update(near(), 7.5, true, 1 / 30);
  assert.ok(pool.inUse > 0 && pool.inUse <= OPS_PER_FRAME);
});

test('lejos de la estación o donde no hay estación no se presta ni se arma nada, y todos vuelven', async () => {
  const pool = await fakePool(120), crowd = new StationCrowd(null, pool);
  assert.equal(run(crowd, far(), 7.5), 0);
  assert.equal(crowd.slots, null, 'ni los puestos se arman');
  assert.equal(pool.inUse, 0);
  assert.equal(crowd.update(near(), 7.5, false, 1 / 30), 0);
  run(crowd, near(), 7.5);
  assert.ok(pool.inUse > 15);
  run(crowd, far(), 7.5, 3);
  assert.equal(pool.inUse, 0);
  assert.equal(pool.figures.every(f => !f.group.visible), true);
});
