// La partida guardada: el candado de la escritura, lo que se acepta de un archivo y la ida y vuelta.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../src/core/game.js';
import { SaveSystem } from '../src/systems/SaveSystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { ITEMS } from '../src/data/items.js';

const almacen = () => {
  const datos = new Map();
  globalThis.localStorage = {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  };
  return datos;
};

const partida = (extra = {}) => ({
  stats: { dinero: 1000, salud: 80 }, clock: { day: 2, hour: 9 }, inventory: { items: [] },
  talents: {}, diseases: {}, player: { pos: [112.98, 0, 97.84] }, ...extra
});

/** Lo que hay escrito en el almacenamiento del navegador. */
const guardado = () => globalThis.localStorage.getItem('habitante-de-calle-save-v1');

test('guardar deja la partida; un almacenamiento lleno devuelve false sin llevarse lo guardado', () => {
  const datos = almacen();
  const save = new SaveSystem();
  assert.equal(save.save(partida()), true);
  assert.equal(JSON.parse(guardado()).v, 2);
  assert.deepEqual(save.load().player.pos, [112.98, 0, 97.84]);

  const lleno = datos.get('habitante-de-calle-save-v1');
  globalThis.localStorage.setItem = () => { throw new Error('lleno'); };
  assert.equal(save.save(partida({ stats: { dinero: 9 } })), false, 'lleno no revienta');
  assert.equal(datos.get('habitante-de-calle-save-v1'), lleno, 'lo guardado antes sigue igual');
});

test('una partida que trae el juego de verdad se acepta', () => {
  almacen();
  const save = new SaveSystem();
  const stats = new StatsSystem(), inventory = new InventorySystem();
  inventory.add(ITEMS.pan, 2);
  const estado = { ...partida(), stats: stats.serialize(), inventory: inventory.serialize() };
  const leida = save.leerArchivo(save.comoTexto(estado));
  assert.ok(leida, 'lo que serializa el juego no se rechaza a sí mismo');
  assert.equal(leida.inventory.items.length, 1);
});

test('un archivo que no es una partida de este juego no entra, y no toca la que había', () => {
  almacen();
  const save = new SaveSystem();
  save.save(partida());
  const antes = guardado();
  const ajenos = [
    'no es json', '[]', 'null', '"texto"', '{"hola":1}',
    JSON.stringify({ ...partida(), v: 99 }),
    JSON.stringify({ ...partida(), v: 'dos' }),
    JSON.stringify({ ...partida(), stats: null }),
    JSON.stringify({ ...partida(), clock: 5 }),
    JSON.stringify({ ...partida(), clock: {} }),
    JSON.stringify({ ...partida(), clock: { day: 1 } }),
    JSON.stringify({ ...partida(), inventory: { items: 'x' } }),
    JSON.stringify({ ...partida(), inventory: { items: [null] } }),
    JSON.stringify({ ...partida(), inventory: { items: [{ id: 'pan', qty: 'dos' }] } }),
    JSON.stringify({ ...partida(), inventory: { items: [{ id: 'pan', qty: -5 }] } }),
    JSON.stringify({ ...partida(), inventory: { items: [{ id: 'fantasma', qty: 1 }] } }),
    JSON.stringify({ ...partida(), diseases: { active: { sarna: 5 } } }),
    JSON.stringify({ ...partida(), diseases: { active: { sarna: { timeLeft: 'x' } } } }),
    JSON.stringify({ ...partida(), v: undefined, stats: { dinero: 1e307 } }),
    JSON.stringify({ ...partida(), stats: { salud: 'x' } }),
    JSON.stringify({ ...partida(), look: 'x' }),
    JSON.stringify({ ...partida(), gps: 7 }),
    JSON.stringify({ ...partida(), player: { pos: [1, 2] } }),
    JSON.stringify({ ...partida(), player: { pos: ['x', 2, 3] } }),
    JSON.stringify({ ...partida(), player: { pos: [1, 2, null] } }),
  ];
  for (const ajeno of ajenos) assert.equal(save.leerArchivo(ajeno), null, ajeno);
  assert.equal(guardado(), antes, 'el archivo ajeno no pisó la partida');
});

test('una partida de este juego entra con su posición, y las v1 pasan los dólares a pesos', () => {
  almacen();
  const save = new SaveSystem();
  save.save(partida());
  const buena = save.leerArchivo(guardado());
  assert.equal(buena.player.pos[0], 112.98);
  assert.equal(buena.v, 2);

  const v1 = JSON.parse(guardado());
  delete v1.v;
  v1.stats.dinero = 10;
  const textoV1 = JSON.stringify(v1);
  assert.equal(save.leerArchivo(textoV1).stats.dinero, 2500, 'por archivo');
  globalThis.localStorage.setItem('habitante-de-calle-save-v1', textoV1);
  assert.equal(save.load().stats.dinero, 2500, 'por la partida guardada');
});

test('importar un archivo ajeno avisa y no aplica ni guarda nada', () => {
  const avisos = [];
  globalThis.window = { dispatchEvent: (e) => avisos.push(e.detail) };
  const aplicadas = [];
  const guardadas = [];
  const serial = { serialize: () => ({}) };
  const base = {
    _save: () => { guardadas.push('x'); return true; },
    _resetAfterRelocation() {},
    menu: { refresh() {} },
    stats: serial, clock: serial, inventory: serial, talents: serial, diseases: serial,
    world: { active: null }, look: {}, built: {}, costal: false, radio: null, dog: null, cart: null, gps: null,
    player: { position: { toArray: () => [0, 0, 0], copy: () => {} }, root: { position: { copy: () => {} } } },
    cameraRig: {},
  };
  const juego = (texto, lectura) => Object.assign(Object.create(Game.prototype), base, {
    save: { leerArchivo: () => lectura },
    _aplicarPartida: (d) => aplicadas.push(d),
    _save: () => { guardadas.push(texto); return true; },
  });
  Game.prototype._importarTexto.call(juego('ajeno', null), 'ajeno');
  assert.deepEqual(aplicadas, []);
  assert.deepEqual(guardadas, [], 'un archivo ajeno no cambia la partida guardada');
  assert.equal(avisos.length, 1);

  const datos = partida();
  Game.prototype._importarTexto.call(juego('buena', datos), 'buena');
  assert.deepEqual(aplicadas, [datos], 'la partida del archivo se aplica');
  assert.deepEqual(guardadas, ['buena'], 'y queda guardada');
  assert.equal(avisos[avisos.length - 1].text, 'Partida importada');

  // Un archivo que pasa la revisión pero revienta al aplicarse: avisa, no guarda y vuelve a la que había.
  const respaldo = { stats: {}, clock: {}, inventory: {}, talents: {}, diseases: {}, player: {} };
  const rompe = Object.assign(Object.create(Game.prototype), base, {
    save: { leerArchivo: () => partida() },
    _estado: () => respaldo,
    _aplicarPartida: (d) => { if (d !== respaldo) throw new Error('no se pudo'); aplicadas.push(d); },
    _save: () => { guardadas.push('rompe'); return true; },
  });
  Game.prototype._importarTexto.call(rompe, 'rompe');
  assert.deepEqual(guardadas, ['buena'], 'la partida del navegador no se toca');
  assert.equal(aplicadas[aplicadas.length - 1], respaldo, 'y la que estaba en curso vuelve a su sitio');
  assert.equal(avisos[avisos.length - 1].text, 'Ese archivo no se pudo aplicar.');
});
