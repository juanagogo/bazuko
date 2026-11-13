// Perfil propio y publico con un almacen en memoria: la cuenta sale del token y ningun pedido llega a otra cuenta ni saca campos internos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Almacen } from '../src/comun/almacen';
import { crearManejador as crearYo } from '../src/http/yo';
import { crearManejador as crearJugadores } from '../src/http/jugadores';
import { revisarApariencia, revisarCambios } from '../src/reglas/perfil';

type Fila = Record<string, any>;

function memoria() {
  const perfiles = new Map<string, Fila>();
  const stats = new Map<string, Fila>();
  const amistades = new Map<string, Fila>();
  const presencia = new Map<string, Fila>();
  const almacen: Almacen = {
    async perfil(c) { return perfiles.get(c); },
    async crearPerfil(f) { if (perfiles.has(f.cuenta)) return false; perfiles.set(f.cuenta, f); return true; },
    async guardarPerfil(f) { perfiles.set(f.cuenta, f); },
    async perfilPorNombre(n) { return [...perfiles.values()].find((p) => p.nombreMin === n); },
    async estadisticas(c) { return stats.get(c); },
    async presencia(c) { return presencia.get(c); },
    async amistad(c, o) { return amistades.get(`${c}|${o}`); },
    async borrarCuenta(c) {
      perfiles.delete(c); stats.delete(c); presencia.delete(c);
      for (const clave of [...amistades.keys()]) if (clave.startsWith(`${c}|`) || clave.endsWith(`|${c}`)) amistades.delete(clave);
    },
    async dentroDelLimite() { return true; },
    async enPartida() { return undefined; },
    async guardarEnPartida() {},
    async moverMarca() { return false; },
    async sumarEstadisticas() {},
    async mejores() { return []; },
    async cuantosSobre() { return 0; },
  };
  return { almacen, perfiles, stats, amistades, presencia };
}

const evento = (sub: string, username: string, method: string, body?: unknown, nombre?: string) => ({
  requestContext: { http: { method }, authorizer: { jwt: { claims: { sub, username } } } } as any,
  body: body === undefined ? undefined : JSON.stringify(body),
  isBase64Encoded: false,
  pathParameters: nombre ? { nombre } : undefined,
});

const cuerpo = (r: any) => (r.body ? JSON.parse(r.body) : undefined);

test('GET /yo crea el perfil con el nombre del token y no saca campos internos', async () => {
  const m = memoria();
  m.stats.set('sub-1', { cuenta: 'sub-1', partidas: 2, dias: 5, plata: 1200.9, peleas: 1, tiempo: 900, tabla: 'todos' });
  const r = await crearYo(m.almacen, () => 1000)(evento('sub-1', 'Jairo117', 'GET'));
  assert.equal(r.statusCode, 200);
  const yo = cuerpo(r);
  assert.deepEqual(Object.keys(yo).sort(), ['apariencia', 'creado', 'estadisticas', 'nombre', 'visibilidad']);
  assert.equal(yo.nombre, 'Jairo117');
  assert.equal(yo.creado, 1000);
  assert.deepEqual(yo.estadisticas, { partidas: 2, dias: 5, plata: 1200, peleas: 1, tiempo: 900 });
  assert.ok(!r.body!.includes('sub-1') && !r.body!.includes('nombreMin'));
  assert.equal(m.perfiles.get('sub-1')?.nombreMin, 'jairo117');
});

test('PUT /yo solo cambia la cuenta del token y solo apariencia y visibilidad', async () => {
  const m = memoria();
  const yo = crearYo(m.almacen);
  await yo(evento('sub-1', 'Rosa', 'GET'));
  await yo(evento('sub-2', 'Pedro', 'GET'));
  const r = await yo(evento('sub-2', 'Pedro', 'PUT', { visibilidad: 'amigos', apariencia: { pelo: 3, piel: 'morena', gorra: true } }));
  assert.equal(r.statusCode, 200);
  assert.equal(m.perfiles.get('sub-2')?.visibilidad, 'amigos');
  assert.equal(m.perfiles.get('sub-1')?.visibilidad, 'todos');   // la otra cuenta no se toca
  for (const malo of [{ nombre: 'Otro' }, { cuenta: 'sub-1' }, { estadisticas: { plata: 1e9 } }, { visibilidad: 'nadie' }, { apariencia: { a: { b: 1 } } }]) {
    const x = await yo(evento('sub-2', 'Pedro', 'PUT', malo));
    assert.equal(x.statusCode, 400, JSON.stringify(malo));
  }
  assert.equal(m.perfiles.get('sub-2')?.nombre, 'Pedro');
});

test('sin token valido no hay perfil', async () => {
  const m = memoria();
  const r = await crearYo(m.almacen)({ requestContext: { http: { method: 'GET' } } as any, body: undefined, isBase64Encoded: false });
  assert.equal(r.statusCode, 403);
});

test('DELETE /yo borra lo de la cuenta y sus amistades de los dos lados', async () => {
  const m = memoria();
  const yo = crearYo(m.almacen);
  await yo(evento('sub-1', 'Rosa', 'GET'));
  await yo(evento('sub-2', 'Pedro', 'GET'));
  m.amistades.set('sub-1|sub-2', { estado: 'amigos' });
  m.amistades.set('sub-2|sub-1', { estado: 'amigos' });
  const r = await yo(evento('sub-1', 'Rosa', 'DELETE'));
  assert.equal(r.statusCode, 204);
  assert.ok(!m.perfiles.has('sub-1'));
  assert.ok(m.perfiles.has('sub-2'));
  assert.equal(m.amistades.size, 0);
});

test('GET /jugadores: perfil publico, visibilidad y bloqueos', async () => {
  const m = memoria();
  const yo = crearYo(m.almacen);
  const jugadores = crearJugadores(m.almacen);
  await yo(evento('sub-1', 'Rosa', 'GET'));
  await yo(evento('sub-2', 'Pedro', 'GET'));
  let r = await jugadores(evento('sub-2', 'Pedro', 'GET', undefined, 'ROSA'));
  assert.equal(r.statusCode, 200);
  assert.equal(cuerpo(r).nombre, 'Rosa');
  assert.ok(!r.body!.includes('sub-1') && !r.body!.includes('visibilidad') && !r.body!.includes('creado'));
  await yo(evento('sub-1', 'Rosa', 'PUT', { visibilidad: 'amigos' }));
  r = await jugadores(evento('sub-2', 'Pedro', 'GET', undefined, 'rosa'));
  assert.deepEqual(cuerpo(r), { nombre: 'Rosa' });
  m.amistades.set('sub-1|sub-2', { estado: 'bloqueado' });
  r = await jugadores(evento('sub-2', 'Pedro', 'GET', undefined, 'rosa'));
  assert.equal(r.statusCode, 404);
  r = await jugadores(evento('sub-2', 'Pedro', 'GET', undefined, 'nadie'));
  assert.equal(r.statusCode, 404);
  r = await jugadores(evento('sub-2', 'Pedro', 'GET', undefined, 'ro sa'));
  assert.equal(r.statusCode, 400);
});

test('la apariencia es un objeto plano y chico', () => {
  assert.deepEqual(revisarApariencia({ pelo: 1, color: 'rojo', gorra: false }), { pelo: 1, color: 'rojo', gorra: false });
  assert.equal(revisarApariencia([1, 2]), 'invalida');
  assert.equal(revisarApariencia({ 'mal clave': 1 }), 'invalida');
  assert.equal(revisarApariencia({ largo: 'x'.repeat(81) }), 'invalida');
  assert.equal(revisarApariencia(Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`c${i}`, i]))), 'invalida');
  assert.equal(revisarCambios('texto'), 'invalido');
});
