import test from 'node:test';
import assert from 'node:assert/strict';
import { concretoGastado, cubiertaDeEstacion, polisombraDeObra } from '../src/world/bogota/concretoViaducto.js';
import { buildColpatriaViaduct } from '../src/world/bogota/ColpatriaViaduct.js';
import { buildMetroBogota } from '../src/world/bogota/MetroBogota.js';
import { buildColpatria } from '../src/world/bogota/Colpatria.js';

// Lienzo falso: acepta cualquier trazo y no pinta nada.
const degradado = { addColorStop() {} };
const ctx = new Proxy({}, { get: (_, clave) => /^create(Linear|Radial)Gradient$/.test(clave) ? () => degradado : () => {}, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };


test('cada pieza de concreto cae en su columna del lienzo y comparte los materiales de su estructura', () => {
  const puente = buildColpatriaViaduct(null);
  const dentro = (o, desde, hasta, indices) => { const uv = o.geometry.attributes.uv; for (const i of indices) assert.ok(uv.getX(i) >= desde / 1024 && uv.getX(i) <= hasta / 1024, `${o.name}: u ${uv.getX(i)}`); };
  const losa = puente.children.find(o => o.name === 'Tablero de concreto');
  dentro(losa, 64, 704, [4, 5, 6, 7]); dentro(losa, 0, 768, [0, 1, 2, 3]);
  const pilar = puente.children.find(o => o.name === 'Pilar'), barrera = puente.children.find(o => o.name === 'Barrera lateral');
  dentro(pilar, 768, 896, [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]);
  dentro(barrera, 896, 960, [...Array(24).keys()]);
  assert.equal(losa.material, pilar.material); assert.equal(losa.material, barrera.material);
  assert.ok(losa.material.map, 'el concreto del puente lleva el lienzo');
  const materiales = grupo => { const vistos = new Set(); grupo.traverse(o => o.material && vistos.add(o.material)); return vistos.size; };
  const metro = buildMetroBogota();
  const concreto = new Set();
  metro.traverse(mesh => { if (/Concreto/.test(mesh.material?.name)) concreto.add(mesh.material); });
  assert.equal(concreto.size, 2, 'los andenes y el estribo comparten concreto con el tablero');
  assert.deepEqual([materiales(puente), materiales(metro), materiales(buildColpatria())], [3, 15, 7]);
});

