import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ENCARGOS, TIPOS_DE_ENCARGO, EVENTOS_DE_ENCARGO, pagoDeEncargo } from '../src/data/encargos.js';
import { EncargoSystem } from '../src/systems/EncargoSystem.js';

function fakeGame({ dinero = 0, latas = 0 } = {}) {
  const items = { lata: latas, botella: 0 };
  return { stats: { dinero }, inventory: { count: (id) => items[id] ?? 0, items }, items };
}

test('cada plantilla da un encargo con texto, sin emojis, con forma de cumplirse y destino válido', () => {
  for (const tipo of TIPOS_DE_ENCARGO) {
    const { rango: [min, max], hacer } = ENCARGOS[tipo];
    for (const n of [min, max]) {
      const def = hacer(n, 0);
      assert.ok(def.title && def.hint, tipo);
      assert.doesNotMatch(def.title + def.hint, /\p{Extended_Pictographic}/u);
      assert.ok(def.event || def.progress || def.done, tipo);
      if (def.target) assert.ok(['bed', 'sell', 'shop', 'craft', 'dog'].includes(def.target));
    }
  }
  assert.ok(EVENTOS_DE_ENCARGO.includes('police-escaped'));
});

test('la racha sube el pago hasta dos veces y media', () => {
  assert.equal(pagoDeEncargo(2000, 0), 2000);
  assert.equal(pagoDeEncargo(2000, 2), 3000);
  assert.equal(pagoDeEncargo(2000, 50), 5000);
});

test('lo que ya tenía no cuenta: «Juntar latas» cuenta desde las del costal al empezar', () => {
  const game = fakeGame({ latas: 5 });
  const sys = new EncargoSystem({ random: () => 0 });
  // random 0 elige el primer tipo distinto del anterior: reciclar. Se fuerza latas.
  sys.state = { tipo: 'latas', n: 8, base: sys._base('latas', game) };
  sys._build();
  assert.deepEqual(sys.progress(game), { value: 0, goal: 8 });
  game.items.lata = 13;
  const done = sys.update(game);
  assert.equal(done.title, 'Juntar 8 latas');
  assert.ok(done.reward.dinero > 0);
  assert.equal(sys.racha, 1);
  assert.equal(sys.current, null);
});

test('los encargos de evento cuentan y el siguiente nunca repite el tipo anterior', () => {
  const game = fakeGame();
  const sys = new EncargoSystem({ random: () => 0 });
  const first = sys.next(game);
  assert.equal(sys.state.tipo, 'reciclar');
  for (let i = 0; i < first.goal; i++) sys.notify('sell', {});
  assert.ok(sys.update(game));
  sys.next(game);
  assert.notEqual(sys.state.tipo, 'reciclar');
});

test('se guarda y se recupera con su avance', () => {
  const game = fakeGame();
  const sys = new EncargoSystem({ random: () => 0 });
  sys.next(game);
  sys.notify('sell', {});
  const copy = new EncargoSystem();
  assert.equal(copy.deserialize(JSON.parse(JSON.stringify(sys.serialize()))), true);
  assert.equal(copy.current.title, sys.current.title);
  assert.equal(copy.progress(game).value, 1);
  assert.equal(copy.deserialize({ state: { tipo: 'nada', n: 1, base: 0 } }), true);
  assert.equal(copy.current, null, 'un tipo desconocido se descarta');
});

test('el juego pasa a los encargos al terminar la cadena y los guarda', () => {
  const source = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(source, /encargos: this\.encargos\?\.serialize\(\)/);
  assert.match(source, /this\.encargos\?\.deserialize\(data\.encargos\)/);
  assert.match(source, /this\.objectives\.finished && this\.encargos\) \{ this\._updateEncargos\(\)/);
});
