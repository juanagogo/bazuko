// Pruebas de la gente real en las motos cercanas: tope del grupo, reuso y cambio entre cerca (real) y lejos (horneada).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { MotoRiders } from '../src/world/bogota/motoRiders.js';
import { RealRiders, REAL_NEAR } from '../src/world/bogota/realRiders.js';

const fakeBake = async () => {
  const person = () => {
    const geometry = new THREE.BoxGeometry(.3, .8, .3);
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
    return geometry;
  };
  return { adult: [{ driver: person(), pillion: person() }], kid: [{ tank: person(), pillion: person() }] };
};

const fakeFactory = async () => {
  const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshBasicMaterial());
  return { holder: new THREE.Group(), shell: mesh(), visor: mesh() };
};

async function setup(copies = { driver: 2, pillion: 1, tank: 1 }) {
  const root = new THREE.Group();
  const riders = new MotoRiders(root, { bake: fakeBake, capacity: 8 });
  riders.real = new RealRiders(root, { factory: fakeFactory, copies, looks: { adult: 1, kid: 1 } });
  await Promise.all(riders.real.tasks().map(task => task()));
  await riders.ready;
  return { root, riders };
}

const moto = (x, z) => new THREE.Matrix4().makeTranslation(x, 0, z);
const SWAY = { roll: 0, pitch: 0 };
const camera = new THREE.Vector3(0, 2, 0);
const add = (riders, x, role = 'driver', helmet = null) => riders.add('adult', 0, role, moto(x, 0), [0, .8], SWAY, 0, helmet);
const frame = (riders, build) => { riders.begin(camera); build(); riders.end(); };
const baked = riders => riders.lots.get('adult:0:driver').count;

test('el grupo se precarga con el tope de copias por apariencia y puesto', async () => {
  const { riders } = await setup();
  assert.equal(riders.real.size, 2 + 1 + 1 + 1);
  assert.equal(riders.real.free.get('adult:0:driver').length, 2);
});

test('los conductores cercanos son personas reales hasta agotar el grupo y el resto va horneado', async () => {
  const { riders } = await setup();
  frame(riders, () => { for (const x of [3, 5, 7, 9]) add(riders, x); });
  assert.equal(riders.real.used, 2);
  assert.equal(baked(riders), 2);
  assert.equal(riders.drawn, 4);
});

test('las personas reales son las de los más cercanos, sin importar el orden en que llegan', async () => {
  const { riders } = await setup();
  frame(riders, () => { for (const x of [9, 4, 7, 2]) add(riders, x); });
  const at = riders.real.taken.map(f => f.holder.matrix.elements[12]).sort((a, b) => a - b);
  assert.deepEqual(at, [2, 4]);
});

test('lejos de REAL_NEAR todos van horneados y no se presta nadie', async () => {
  const { riders, root } = await setup();
  frame(riders, () => add(riders, REAL_NEAR + 5));
  assert.equal(riders.real.used, 0);
  assert.equal(baked(riders), 1);
  assert.equal(root.children.filter(c => c.name === 'Persona en moto').length, 0);
});

test('la persona se reusa de un cuadro a otro y vuelve al grupo al alejarse la moto', async () => {
  const { riders, root } = await setup();
  frame(riders, () => add(riders, 3));
  const first = riders.real.taken[0];
  assert.equal(first.holder.parent, root);
  frame(riders, () => add(riders, 4));
  assert.equal(riders.real.taken[0], first, 'misma persona, no una nueva');
  assert.equal(riders.real.size, 5, 'el grupo no crece');
  frame(riders, () => add(riders, REAL_NEAR + 10));
  assert.equal(riders.real.used, 0);
  assert.equal(first.holder.parent, null);
  assert.equal(first.holder.visible, false);
  assert.ok(riders.real.free.get('adult:0:driver').includes(first));
  frame(riders, () => add(riders, 3));
  assert.equal(riders.real.taken[0].holder.parent, root);
});

test('el casco solo se ve si la moto lo lleva y toma su color', async () => {
  const { riders } = await setup();
  const red = new THREE.Color(1, 0, 0);
  frame(riders, () => { add(riders, 2, 'driver', red); add(riders, 4); });
  const [near, other] = riders.real.taken;
  assert.equal(near.shell.visible, true);
  assert.equal(near.shell.material.color.r, 1);
  assert.equal(other.shell.visible, false);
});

test('sin grupo (o sin cámara) todos van horneados como antes', async () => {
  const { riders } = await setup({ driver: 0, pillion: 0, tank: 0 });
  frame(riders, () => add(riders, 3));
  assert.equal(riders.real.used, 0);
  assert.equal(baked(riders), 1);
  riders.real = null;
  frame(riders, () => add(riders, 3));
  assert.equal(baked(riders), 1);
});

test('nunca hay más de REAL_MAX personas reales a la vez aunque haya copias de sobra', async () => {
  const root = new THREE.Group();
  const riders = new MotoRiders(root, { bake: fakeBake, capacity: 8 });
  riders.real = new RealRiders(root, { factory: fakeFactory, copies: { driver: 6, pillion: 0, tank: 0 }, looks: { adult: 1, kid: 0 }, max: 3 });
  await Promise.all(riders.real.tasks().map(task => task()));
  await riders.ready;
  frame(riders, () => { for (const x of [1, 2, 3, 4, 5, 6]) add(riders, x); });
  assert.equal(riders.real.used, 3);
  assert.equal(baked(riders), 3);
});
