import test from 'node:test';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { fachadaDeTorre } from '../src/world/bogota/fachadaColpatria.js';
import { buildColpatria } from '../src/world/bogota/Colpatria.js';

// Lienzo falso: acepta cualquier trazo y no pinta nada.
const degradado = { addColorStop() {} };
const ctx = new Proxy({}, { get: (_, clave) => /^create(Linear|Radial)Gradient$/.test(clave) ? () => degradado : () => {}, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

test('el vestíbulo del acceso lee su muestra de la fachada: de pie a cabeza, en una sola columna dentro de un nervio', () => {
  const { u, pie, cabeza } = fachadaDeTorre().vestibulo;
  // Los nervios ocupan el primer y el último octavo de cada vano, que en la torre tapan las costillas.
  assert.ok(u > 0 && u < .125 / 4 && pie > 0 && pie < cabeza && cabeza < 1);
  // Las filas de la muestra no caen en la planta baja del anexo, la única franja de su vidrio que se ve (v de -5/48 a 0).
  assert.ok(cabeza < 1 - 5 / 48);
  const { uv, position } = buildColpatria().getObjectByName('Vestíbulo de acceso').geometry.attributes;
  for (let i = 0; i < uv.count; i++) {
    assert.ok(Math.abs(uv.getX(i) - u) < 1e-6);
    assert.ok(Math.abs(uv.getY(i) - (position.getY(i) < 0 ? pie : cabeza)) < 1e-6);
  }
});

test('la planta comercial del anexo lee la misma muestra: de su pie, en el piso, a su cabeza, bajo los paneles grises', () => {
  const { u, pie, cabeza } = fachadaDeTorre().vestibulo;
  const torre = buildColpatria(), anexo = torre.getObjectByName('Edificio anexo gris');
  const { uv, position } = anexo.geometry.attributes, alto = new THREE.Box3().setFromObject(anexo).max.y;
  const paneles = new THREE.Box3().setFromObject(torre.getObjectByName('Paneles grises del anexo'));
  assert.ok(Math.abs(paneles.min.y - 5) < 1e-6);
  for (let i = 0; i < uv.count; i++) {
    const y = position.getY(i) + alto / 2;
    assert.ok(Math.abs(uv.getX(i) - u) < 1e-6);
    assert.ok(Math.abs(uv.getY(i) - (pie + y / 5 * (cabeza - pie))) < 1e-6);
  }
});
