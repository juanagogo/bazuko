import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfilPublico, CAMPOS_PUBLICOS } from '../src/comun/publico';

const guardado = { cuenta: 'sub-secreto', nombre: 'Rosa', nombreMin: 'rosa', apariencia: { pelo: 2 }, visibilidad: 'todos', correo: 'x@y.z', creado: 1 };
const stats = { cuenta: 'sub-secreto', partidas: 3, dias: 10, plata: 500.7, peleas: 2, muertes: 1, tiempo: 3600, tabla: 'T' };
const presencia = { cuenta: 'sub-secreto', estado: 'jugando', sala: 'BZK7AQ', conexionId: 'abc' };

test('solo salen campos de la lista blanca', () => {
  const salida = perfilPublico(guardado, stats, presencia, { esAmigo: true, esUnoMismo: false });
  for (const campo of Object.keys(salida)) assert.ok((CAMPOS_PUBLICOS as readonly string[]).includes(campo), campo);
  const texto = JSON.stringify(salida);
  for (const secreto of ['sub-secreto', 'x@y.z', 'abc', 'muertes', 'nombreMin']) assert.ok(!texto.includes(secreto), secreto);
  assert.equal(salida.sala, 'BZK7AQ');
  assert.equal(salida.estadisticas?.plata, 500);
});

test('la sala solo la ven los amigos', () => {
  assert.equal(perfilPublico(guardado, stats, presencia, { esAmigo: false, esUnoMismo: false }).sala, null);
});

test('con visibilidad amigos, un extrano ve solo el nombre', () => {
  const salida = perfilPublico({ ...guardado, visibilidad: 'amigos' }, stats, presencia, { esAmigo: false, esUnoMismo: false });
  assert.deepEqual(salida, { nombre: 'Rosa' });
});
