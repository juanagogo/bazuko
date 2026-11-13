import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/disparadores/preRegistro';

const evento = (userName: string) => ({ userName, request: { userAttributes: {} }, response: {} } as any);

test('acepta un nombre valido y confirma la cuenta', async () => {
  const salida = await handler(evento('Jairo117'));
  assert.equal(salida.response.autoConfirmUser, true);
  assert.equal(salida.response.autoVerifyEmail, false);
});

test('rechaza nombres invalidos aunque no vengan del juego', async () => {
  await assert.rejects(handler(evento('Hola Mundo')), /nombre_caracteres/);
  await assert.rejects(handler(evento('ab')), /nombre_corto/);
  await assert.rejects(handler(evento('SuperAdmin')), /nombre_prohibido/);
});
