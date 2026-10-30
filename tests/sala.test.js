import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRUEBAS } from '../src/sala/pruebas.js';

test('cada prueba de la sala tiene id único, nombre, descripción y montaje', () => {
  const ids = PRUEBAS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  for (const p of PRUEBAS) {
    assert.match(p.id, /^[a-z]+$/, `${p.id}: el id va en la URL (?prueba=)`);
    assert.ok(p.nombre && p.descripcion, p.id);
    assert.equal(typeof p.montar, 'function', p.id);
  }
});
