// Mismos casos que cpp/tests/NameRulesTest.cpp: si cambia uno, cambia el otro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisarNombre, revisarContrasena } from '../src/reglas/nombres';

test('nombres validos', () => {
  for (const n of ['Jairo', 'jairo117', 'ABC', 'Vergara', 'Computador', 'Maricarmen', 'a1b2c3d4e5f6g7h8']) assert.equal(revisarNombre(n), null, n);
});

test('nombres invalidos', () => {
  const casos: Array<[unknown, string]> = [
    ['ab', 'corto'], ['', 'corto'], ['a1b2c3d4e5f6g7h8i', 'largo'],
    ['Hola Mundo', 'caracteres'], ['Ñandu', 'caracteres'], ['José', 'caracteres'], ['juan_p', 'caracteres'], ['juan-p', 'caracteres'],
    ['emoji😀', 'caracteres'], [42, 'caracteres'], [null, 'caracteres'],
    ['SuperAdmin', 'prohibido'], ['Bazuko2', 'prohibido'], ['soporte', 'prohibido'], ['Soporte99', 'prohibido'], ['MIERDA', 'prohibido'],
  ];
  for (const [n, falla] of casos) assert.equal(revisarNombre(n), falla, String(n));
});

test('contrasenas', () => {
  assert.equal(revisarContrasena('corta', 'Jairo'), 'corta');
  assert.equal(revisarContrasena('jairo117', 'Jairo117'), 'igual_al_nombre');
  assert.equal(revisarContrasena('calle larga 7', 'Jairo'), null);
});
