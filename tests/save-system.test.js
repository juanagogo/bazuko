// La partida guardada no se pierde ni se daña: suma de verificación, respaldo, migraciones y saneado.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SaveSystem, KEY_DANADA, KEY_RESPALDO, SAVE_VERSION, sanearPartida, sumaDeVerificacion
} from '../src/systems/SaveSystem.js';

const KEY = 'habitante-de-calle-save-v1';

const memoria = (inicial = {}) => {
  const datos = new Map(Object.entries(inicial));
  return {
    datos, lleno: false,
    getItem(k) { return datos.has(k) ? datos.get(k) : null; },
    setItem(k, v) { if (this.lleno) throw new Error('QuotaExceededError'); datos.set(k, String(v)); },
    removeItem(k) { datos.delete(k); }
  };
};

const partida = (dinero = 1000) => ({
  stats: { dinero, salud: 80, hambre: 60 }, clock: { day: 2, hour: 9 },
  inventory: { items: [{ id: 'pan', qty: 2 }] }, talents: {}, diseases: {},
  player: { pos: [112.98, 0, 97.84] }, built: { base: true }
});

test('guardar deja la partida con su suma y la carga igual', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  assert.equal(save.save(partida()), true);
  assert.equal(almacen.getItem(`${KEY}-suma`), sumaDeVerificacion(almacen.getItem(KEY)));
  const leida = save.load();
  assert.equal(leida.stats.dinero, 1000);
  assert.equal(leida.v, SAVE_VERSION);
  assert.deepEqual(leida.inventory.items, [{ id: 'pan', qty: 2 }]);
  assert.equal(save.restoredFromBackup, false);
});

test('la partida anterior queda como respaldo', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  save.save(partida(1000));
  save.save(partida(2000));
  assert.equal(JSON.parse(almacen.getItem(KEY_RESPALDO)).stats.dinero, 1000);
  assert.equal(JSON.parse(almacen.getItem(KEY)).stats.dinero, 2000);
});

test('una partida cortada se aparta y se sigue desde el respaldo, avisando una vez', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  save.save(partida(1000));
  save.save(partida(2000));
  const cortada = almacen.getItem(KEY).slice(0, 30);
  almacen.setItem(KEY, cortada);

  assert.equal(save.load().stats.dinero, 1000);
  assert.equal(save.restoredFromBackup, true);
  assert.equal(almacen.getItem(KEY_DANADA), cortada, 'la dañada queda aparte, no se borra');
  assert.equal(save.fueRecuperada(), true);
  assert.equal(save.fueRecuperada(), false, 'el aviso sale una sola vez');
  assert.equal(save.fueApartada(), false, 'no se dice que se empieza de cero');
  // El respaldo volvió a ser la principal: recargar ya no falla.
  assert.equal(new SaveSystem(almacen).load().stats.dinero, 1000);
});

test('una partida que se lee pero no coincide con su suma tampoco pasa', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  save.save(partida(1000));
  save.save(partida(2000));
  almacen.setItem(KEY, almacen.getItem(KEY).replace('"dinero":2000', '"dinero":9999999'));
  assert.equal(save.load().stats.dinero, 1000);
  assert.equal(save.restoredFromBackup, true);
});

test('cortarse entre la suma y la partida recupera la anterior sin perder nada', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  save.save(partida(1000));
  save.save(partida(2000));
  // Se escribió la suma nueva y la partida no alcanzó.
  almacen.setItem(`${KEY}-suma`, 'ffffffff');
  assert.equal(save.load().stats.dinero, 1000);
});

test('sin respaldo bueno se aparta y se empieza de cero', () => {
  const almacen = memoria({ [KEY]: '{basura', [KEY_RESPALDO]: 'tampoco' });
  const save = new SaveSystem(almacen);
  assert.equal(save.load(), null);
  assert.equal(almacen.getItem(KEY_DANADA), '{basura');
  assert.equal(save.fueApartada(), true);
  assert.equal(save.fueRecuperada(), false);
});

test('sin partida principal no se resucita el respaldo', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  save.save(partida(1000));
  save.save(partida(2000));
  save.apartar(); // lo que hace game.js cuando la partida no se pudo aplicar
  assert.equal(new SaveSystem(almacen).load(), null);
});

test('una partida dañada no pasa a respaldo', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  save.save(partida(1000));
  almacen.setItem(KEY, '{basura');
  save.save(partida(3000));
  assert.equal(almacen.getItem(KEY_RESPALDO), null);
  assert.equal(save.load().stats.dinero, 3000);
});

test('lleno: devuelve false y deja la partida y su suma como estaban', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  save.save(partida(1000));
  almacen.lleno = true;
  assert.equal(save.save(partida(2000)), false);
  almacen.lleno = false;
  assert.equal(save.load().stats.dinero, 1000);
  assert.equal(save.restoredFromBackup, false);
  assert.equal(new SaveSystem(null).save(partida()), false);
  assert.equal(new SaveSystem(null).load(), null);
});

test('las partidas sin suma (de antes) cargan y las v1 pasan de dólares a pesos', () => {
  const v2 = memoria({ [KEY]: JSON.stringify({ ...partida(10), v: 2 }) });
  assert.equal(new SaveSystem(v2).load().stats.dinero, 10);
  const v1 = memoria({ [KEY]: JSON.stringify(partida(10)) });
  assert.equal(new SaveSystem(v1).load().stats.dinero, 2500);
});

test('una partida de una versión más nueva no se carga ni se pisa', () => {
  const futura = JSON.stringify({ ...partida(), v: SAVE_VERSION + 1 });
  const almacen = memoria({ [KEY]: futura });
  assert.equal(new SaveSystem(almacen).load(), null);
  assert.equal(almacen.getItem(KEY_DANADA), futura, 'queda aparte para un juego más nuevo');
});

test('el saneado corrige lo imposible sin tirar la partida', () => {
  const data = sanearPartida({
    stats: { hambre: 250, sed: -5, energia: 'mucha', dinero: -40, xp: NaN },
    clock: { day: 0, hour: 30 },
    inventory: { items: [{ id: 'pan', qty: 1 }, { id: 'fantasma', qty: 1 }, null] },
    player: { pos: [1, null, 3] },
    built: { base: true },
    radio: 7
  });
  assert.equal(data.stats.hambre, 100);
  assert.equal(data.stats.sed, 0);
  assert.equal('energia' in data.stats, false);
  assert.equal(data.stats.dinero, 0);
  assert.equal('xp' in data.stats, false);
  assert.deepEqual(data.clock, { day: 1, hour: 6 });
  assert.deepEqual(data.inventory.items, [{ id: 'pan', qty: 1 }]);
  assert.equal(data.player, undefined);
  assert.deepEqual(data.built, { base: true });
  assert.equal('radio' in data, false);

  const sinReloj = sanearPartida({ stats: {} });
  assert.deepEqual(sinReloj.clock, { day: 1, hour: 6 });
});

test('clear quita la partida, el respaldo y sus sumas, pero no la apartada', () => {
  const almacen = memoria({ [KEY_DANADA]: 'vieja' });
  const save = new SaveSystem(almacen);
  save.save(partida(1)); save.save(partida(2));
  save.clear();
  assert.deepEqual([...almacen.datos.keys()], [KEY_DANADA]);
});

test('sin respaldo, una partida legible con la suma vieja se carga igual', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  save.save(partida(1000));
  almacen.setItem(KEY, JSON.stringify({ ...partida(5), v: 2 }));
  assert.equal(save.load().stats.dinero, 5);
  assert.equal(almacen.getItem(`${KEY}-suma`), null);
});

test('el saneado conserva las secciones que no conoce, como objetivos y carro robado', () => {
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  const objectives = { index: 3, done: ['comer'] };
  const carroRobado = { id: 'taxi-2', pos: [1, 0, 2] };
  save.save({ ...partida(), objectives, carroRobado });
  const leida = save.load();
  assert.deepEqual(leida.objectives, objectives);
  assert.deepEqual(leida.carroRobado, carroRobado);
});

test('una segunda partida apartada no pisa la primera, y el respaldo de la apartada sobrevive a la partida nueva', async () => {
  const { KEYS_APARTADAS, KEY_RESPALDO_APARTADO, KEYS_RESPALDO_APARTADO } = await import('../src/systems/SaveSystem.js');
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  const dinero = (texto) => texto && JSON.parse(texto).stats.dinero;
  save.save(partida(1)); // viejo-A
  save.save(partida(2)); // viejo-B: no se deja aplicar y game.js la aparta
  save.apartar();
  assert.equal(new SaveSystem(almacen).load(), null, 'sin principal se empieza de cero');
  save.save(partida(3)); // el creador
  save.save(partida(4)); // el guardado solo: el respaldo pasa a ser la partida nueva
  assert.equal(dinero(almacen.getItem(KEY_DANADA)), 2);
  assert.equal(dinero(almacen.getItem(KEY_RESPALDO_APARTADO)), 1, 'viejo-A sigue a mano');
  save.apartar(); // otra falla, ya con la partida nueva
  assert.equal(dinero(almacen.getItem(KEYS_APARTADAS[0])), 4);
  assert.equal(dinero(almacen.getItem(KEYS_APARTADAS[1])), 2, 'viejo-B no se perdió');
  assert.equal(dinero(almacen.getItem(KEYS_RESPALDO_APARTADO[0])), 3, 'con la nueva va su respaldo');
  assert.equal(dinero(almacen.getItem(KEYS_RESPALDO_APARTADO[1])), 1, 'viejo-A corrió con viejo-B, no se pisó');
  save.apartar(); // sin principal no hace nada
  save.save(partida(4));
  save.apartar(); // la misma otra vez: no corre la fila
  assert.equal(dinero(almacen.getItem(KEYS_APARTADAS[1])), 2);
  assert.equal(dinero(almacen.getItem(KEYS_RESPALDO_APARTADO[1])), 1);
  assert.equal(almacen.getItem(KEYS_APARTADAS[2]), null);
});

test('la fila de apartadas lleva cada respaldo con su partida y no deja uno ajeno en un puesto', async () => {
  const { KEYS_APARTADAS, KEYS_RESPALDO_APARTADO } = await import('../src/systems/SaveSystem.js');
  const almacen = memoria();
  const save = new SaveSystem(almacen);
  const dinero = (texto) => texto && JSON.parse(texto).stats.dinero;
  save.save(partida(1)); save.save(partida(2));
  save.apartar(); // 2 con respaldo 1
  save.save(partida(3)); // la primera de la partida nueva: el respaldo sigue siendo 1, el de la apartada
  almacen.removeItem(KEY_RESPALDO); // y si no hay respaldo, la apartada va sin él
  save.apartar(); // 3 sin respaldo
  save.save(partida(5)); save.save(partida(6));
  save.apartar(); // 6 con respaldo 5
  assert.deepEqual(KEYS_APARTADAS.map((k) => dinero(almacen.getItem(k))), [6, 3, 2]);
  assert.deepEqual(KEYS_RESPALDO_APARTADO.map((k) => dinero(almacen.getItem(k))), [5, null, 1]);
  save.save(partida(7)); save.save(partida(8));
  save.apartar(); // la más vieja sale de la fila con su respaldo
  assert.deepEqual(KEYS_APARTADAS.map((k) => dinero(almacen.getItem(k))), [8, 6, 3]);
  assert.deepEqual(KEYS_RESPALDO_APARTADO.map((k) => dinero(almacen.getItem(k))), [7, 5, null]);
});
