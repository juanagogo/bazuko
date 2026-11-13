// Partidas y clasificacion con un almacen en memoria: solo el anfitrion presente informa, solo cuentan cuentas presentes,
// lo imposible no cuenta, nada se acredita dos veces y la tabla no saca cuentas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Almacen } from '../src/comun/almacen';
import { crearManejador as crearPartidas } from '../src/http/partidas';
import { crearManejador as crearClasificacion } from '../src/http/clasificacion';
import { acreditable, revisarResultados } from '../src/reglas/partidas';

type Fila = Record<string, any>;

function memoria() {
  const perfiles = new Map<string, Fila>();
  const stats = new Map<string, Fila>();
  const partidas = new Map<string, Fila>();
  const almacen: Almacen = {
    async perfil(c) { return perfiles.get(c); },
    async crearPerfil(f) { perfiles.set(f.cuenta, f); return true; },
    async guardarPerfil(f) { perfiles.set(f.cuenta, f); },
    async perfilPorNombre(n) { return [...perfiles.values()].find((p) => p.nombreMin === n); },
    async estadisticas(c) { return stats.get(c); },
    async presencia() { return undefined; },
    async amistad() { return undefined; },
    async borrarCuenta() {},
    async dentroDelLimite() { return true; },
    async enPartida(codigo, cuenta) { return partidas.get(`${codigo}|${cuenta}`); },
    async guardarEnPartida(f) { partidas.set(`${f.partida}|${f.cuenta}`, { ...f }); },
    async moverMarca(codigo, cuenta, antes, nueva, contada) {
      const f = partidas.get(`${codigo}|${cuenta}`);
      if (!f || f.marca !== antes) return false;
      f.marca = nueva; f.contada = contada;
      return true;
    },
    async sumarEstadisticas(cuenta, nombre, suma, ahora) {
      const f = stats.get(cuenta) ?? { cuenta, partidas: 0, dias: 0, plata: 0, peleas: 0, muertes: 0, tiempo: 0 };
      for (const [k, v] of Object.entries(suma)) f[k] = (f[k] ?? 0) + v;
      Object.assign(f, { nombre, tabla: 'T', actualizado: ahora });
      stats.set(cuenta, f);
    },
    async mejores(tabla, hasta) {
      return [...stats.values()].filter((f) => f.tabla === 'T').sort((a, b) => b[tabla] - a[tabla]).slice(0, hasta).map((f) => ({ nombre: f.nombre, valor: f[tabla] }));
    },
    async cuantosSobre(tabla, valor) { return [...stats.values()].filter((f) => f.tabla === 'T' && f[tabla] > valor).length; },
  };
  for (const [c, n] of [['sub-a', 'Anfi'], ['sub-b', 'Beto'], ['sub-c', 'Caro']]) perfiles.set(c, { cuenta: c, nombre: n, nombreMin: n.toLowerCase() });
  return { almacen, stats, partidas };
}

const evento = (sub: string, path: Record<string, string>, body?: unknown, query?: Record<string, string>) => ({
  requestContext: { authorizer: { jwt: { claims: { sub } } } } as any,
  pathParameters: path,
  body: body === undefined ? undefined : JSON.stringify(body),
  isBase64Encoded: false,
  queryStringParameters: query,
});
const cuerpo = (r: any) => (r.body ? JSON.parse(r.body) : undefined);

function partida() {
  const m = memoria();
  let ahora = 1000;
  const h = crearPartidas(m.almacen, () => ahora);
  const presente = (sub: string, anfitrion = false) => h(evento(sub, { codigo: 'BZK7AQ', accion: 'presente' }, { anfitrion }));
  const resultado = (sub: string, jugadores: unknown[]) => h(evento(sub, { codigo: 'BZK7AQ', accion: 'resultado' }, { jugadores }));
  return { m, presente, resultado, pasar: (s: number) => { ahora += s; } };
}

test('el anfitrion acredita a los presentes, una sola vez, y cuenta la partida despues de un minuto', async () => {
  const p = partida();
  await p.presente('sub-a', true);
  await p.presente('sub-b');
  p.pasar(600);
  const r = await p.resultado('sub-a', [
    { nombre: 'Anfi', dias: 0, plata: 3000, peleas: 2, muertes: 0, tiempo: 600 },
    { nombre: 'beto', dias: 1, plata: 500, peleas: 0, muertes: 2, tiempo: 600 },
  ]);
  assert.equal(r.statusCode, 200);
  assert.equal(cuerpo(r).acreditados, 2);
  assert.equal(p.m.stats.get('sub-b')?.nombre, 'Beto');   // el nombre de la cuenta, no como lo escribio el anfitrion
  assert.equal(p.m.stats.get('sub-b')?.partidas, 1);
  assert.equal(p.m.stats.get('sub-a')?.plata, 3000);
  // el mismo informe otra vez, sin que pase tiempo: no suma nada
  await p.resultado('sub-a', [{ nombre: 'Anfi', dias: 0, plata: 3000, peleas: 2, muertes: 0, tiempo: 600 }]);
  assert.equal(p.m.stats.get('sub-a')?.plata, 3000);
  // un minuto despues: suma lo nuevo pero no otra partida
  p.pasar(60);
  await p.resultado('sub-a', [{ nombre: 'Anfi', dias: 0, plata: 100, peleas: 0, muertes: 0, tiempo: 60 }]);
  assert.equal(p.m.stats.get('sub-a')?.plata, 3100);
  assert.equal(p.m.stats.get('sub-a')?.partidas, 1);
  assert.equal(p.m.stats.get('sub-a')?.tiempo, 660);
});

test('un invitado no puede mandar resultados y una cuenta que no entro no recibe nada', async () => {
  const p = partida();
  await p.presente('sub-a', true);
  await p.presente('sub-b');
  p.pasar(300);
  assert.equal((await p.resultado('sub-b', [{ nombre: 'Beto', plata: 1000, tiempo: 300 }])).statusCode, 403);
  assert.equal((await p.resultado('sub-c', [{ nombre: 'Caro', plata: 1000, tiempo: 300 }])).statusCode, 403);
  const r = await p.resultado('sub-a', [{ nombre: 'Caro', plata: 1000, tiempo: 300 }, { nombre: 'Nadie', plata: 5, tiempo: 300 }]);
  assert.equal(cuerpo(r).acreditados, 0);
  assert.equal(p.m.stats.size, 0);
});

test('los valores imposibles no cuentan y el tiempo no pasa del real', async () => {
  const p = partida();
  await p.presente('sub-a', true);
  await p.presente('sub-b');
  p.pasar(120);
  await p.resultado('sub-a', [
    { nombre: 'Anfi', dias: 30, tiempo: 120 },              // 30 dias en dos minutos
    { nombre: 'Beto', plata: 10, tiempo: 150 },             // 30 s de mas: se recorta
  ]);
  assert.equal(p.m.stats.get('sub-a'), undefined);
  assert.equal(p.m.stats.get('sub-b')?.tiempo, 120);
  assert.equal(acreditable({ nombre: 'x', dias: 0, plata: 0, peleas: 0, muertes: 0, tiempo: 9999 }, 60), null);
  assert.equal(revisarResultados({ jugadores: [{ nombre: 'Beto', plata: -5 }] }), null);
  assert.equal(revisarResultados({ jugadores: [{ nombre: 'Beto' }, { nombre: 'BETO' }] }), null);
  assert.equal(revisarResultados({ jugadores: [{ nombre: 'a b' }] }), null);
});

test('la clasificacion ordena, pagina, da el puesto propio y no saca cuentas', async () => {
  const m = memoria();
  for (let i = 0; i < 25; i++) m.stats.set(`sub-${i}`, { cuenta: `sub-${i}`, nombre: `Jug${i}`, tabla: 'T', partidas: 1, dias: i, plata: i * 100, peleas: 0, muertes: 0, tiempo: 60 });
  const h = crearClasificacion(m.almacen);
  const r = await h(evento('sub-3', { tabla: 'plata' }, undefined, { cuantos: '10' }));
  assert.equal(r.statusCode, 200);
  const t = cuerpo(r);
  assert.equal(t.filas.length, 10);
  assert.deepEqual(t.filas[0], { puesto: 1, nombre: 'Jug24', valor: 2400 });
  assert.equal(t.siguiente, 10);
  assert.deepEqual(t.yo, { puesto: 22, valor: 300 });
  assert.ok(!r.body!.includes('sub-'));
  const ultima = cuerpo(await h(evento('sub-3', { tabla: 'plata' }, undefined, { cuantos: '10', desde: '20' })));
  assert.equal(ultima.filas.length, 5);
  assert.equal(ultima.filas[0].puesto, 21);
  assert.equal(ultima.siguiente, null);
  const sinFila = cuerpo(await h(evento('sub-nuevo', { tabla: 'dias' }, undefined, {})));
  assert.equal(sinFila.yo, null);
  assert.equal((await h(evento('sub-3', { tabla: 'cuenta' }, undefined, {}))).statusCode, 400);
  assert.equal((await h(evento('sub-3', { tabla: 'plata' }, undefined, { cuantos: '1000' }))).statusCode, 400);
  assert.equal((await h(evento('sub-3', { tabla: 'plata' }, undefined, { desde: '-1' }))).statusCode, 400);
});
