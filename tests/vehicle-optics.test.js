// Faros, stops y parrillas de los modelos modernos: cada uno con su forma y sus luces, sin cruzar la carrocería.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVehicle } from '../src/world/bogota/vehicles.js';
import { OPTICS } from '../src/world/bogota/carLamps.js';
import { LAMP } from '../src/world/bogota/carModels.js';

const MODERN = ['citadino', 'sedanPopular', 'hatchPopular', 'sedanDeportivo', 'suv', 'pickup', 'furgon'];

test('cada modelo moderno tiene faro y stop propios', () => {
  const outlines = new Set();
  for (const id of MODERN) for (const part of ['Head', 'Tail']) {
    const optic = OPTICS[id + part];
    assert.ok(optic, `falta ${id}${part}`);
    const shape = JSON.stringify(optic.outline);
    assert.ok(!outlines.has(shape), `${id}${part} repite el contorno de otro modelo`);
    outlines.add(shape);
  }
});

test('faro y stop tienen su parte de cada luz y encienden en la malla', () => {
  for (const id of MODERN) {
    const lamps = OPTICS[`${id}Head`].parts.map(p => p.lamp), tails = OPTICS[`${id}Tail`].parts.map(p => p.lamp);
    assert.ok(lamps.includes('HEAD') && lamps.includes('signal'), `${id}: faro sin luz o sin direccional`);
    assert.ok(tails.includes('TAIL') && tails.includes('signal'), `${id}: stop sin freno o sin direccional`);
    const v = makeVehicle('carro', 1, { beams: false, model: id }), found = new Set();
    v.group.traverse(o => {
      const a = o.isMesh && o.geometry.attributes.lamp;
      if (a) for (let i = 0; i < a.count; i++) found.add(Math.round(a.getX(i)));
    });
    for (const channel of [LAMP.HEAD, LAMP.TAIL, LAMP.LEFT, LAMP.RIGHT]) assert.ok(found.has(channel), `${id}: sin canal ${channel}`);
    v.dispose();
  }
});

test('ninguna pieza proyectada salta el paso de rueda ni cruza por debajo del carro', () => {
  for (const id of MODERN) {
    const v = makeVehicle('carro', 1, { beams: false, model: id });
    const mesh = v.bodyVisual.children.find(c => c.name === 'Lámparas y placas');
    assert.ok(mesh, `${id}: sin lámparas`);
    const { position: p } = mesh.geometry.attributes, index = mesh.geometry.index;
    const n = index ? index.count : p.count, at = i => index ? index.getX(i) : i;
    for (let i = 0; i < n; i += 3) {
      const xs = [at(i), at(i + 1), at(i + 2)].map(k => p.getX(k));
      assert.ok(Math.max(...xs) - Math.min(...xs) < .45, `${id}: triángulo de ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} m de largo`);
    }
    v.dispose();
  }
});
