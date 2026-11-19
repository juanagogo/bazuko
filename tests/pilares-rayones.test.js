import test from 'node:test';
import assert from 'node:assert/strict';

// Lienzo falso que anota los trazos de línea: el rayón ya no va pintado en la columna de los pilares.
const trazos = [];
const degradado = { addColorStop() {} };
const ctx = new Proxy({}, {
  get: (_, clave) => /^create(Linear|Radial)Gradient$/.test(clave) ? () => degradado
    : ['moveTo', 'lineTo', 'bezierCurveTo'].includes(clave) ? (...args) => trazos.push([clave, ...args]) : () => {},
  set: () => true
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const { concretoGastado } = await import('../src/world/bogota/concretoViaducto.js');
test('el concreto del pilar ya no lleva el mismo rayón pintado en todos', () => {
  concretoGastado();
  const enPilar = trazos.filter(([, x]) => x >= 768 && x <= 896);
  assert.deepEqual(enPilar, []);
});

