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

test('si vende o pierde lo que tenía, la base baja: «Juntar latas» cuenta las que junta desde ahí', () => {
  const game = fakeGame({ latas: 20 });
  const sys = new EncargoSystem();
  sys.state = { tipo: 'latas', n: 8, base: sys._base('latas', game) };
  sys._build();
  game.items.lata = 0; // vendió todo en la recicladora
  assert.equal(sys.update(game), null);
  assert.equal(sys.state.base, 0, 'la base baja a lo que queda');
  game.items.lata = 5;
  assert.deepEqual(sys.progress(game), { value: 5, goal: 8 });
  game.items.lata = 8;
  assert.deepEqual(sys.progress(game), { value: 8, goal: 8 });
  assert.equal(sys.update(game)?.title, 'Juntar 8 latas');
});

test('tras un arresto que deja la plata en 0, «Ganar» cuenta lo que gana después, con caleta incluida', () => {
  const game = fakeGame({ dinero: 80000 });
  game.caleta = { plata: 0 };
  const sys = new EncargoSystem();
  sys.state = { tipo: 'ahorrar', n: 5000, base: sys._base('ahorrar', game) };
  sys._build();
  game.stats.dinero = 0; // arresto
  assert.equal(sys.update(game), null);
  game.stats.dinero = 3000;
  game.caleta.plata = 2000;
  assert.deepEqual(sys.progress(game), { value: 5000, goal: 5000 });
  assert.ok(sys.update(game), 'se cumple con lo ganado tras el arresto');
});

test('la base baja sin perder los eventos contados ni se mueve si el contador sube', () => {
  const game = fakeGame({ latas: 3 });
  const sys = new EncargoSystem();
  sys.state = { tipo: 'latas', n: 8, base: 3 };
  sys._build();
  game.items.lata = 6;
  sys.progress(game);
  assert.equal(sys.state.base, 3, 'subir no cambia la base');
  const obj = sys._obj;
  sys.progress(game);
  assert.equal(sys._obj, obj, 'sin bajar no se reconstruye nada');
  game.items.lata = 1;
  sys.progress(game);
  assert.equal(JSON.parse(JSON.stringify(sys.serialize())).state.base, 1, 'la base nueva se guarda');
});

test('importar un archivo sin encargos vuelve al principio: sin racha ni encargo de la partida anterior', () => {
  const game = fakeGame();
  const sys = new EncargoSystem({ random: () => 0 });
  sys.racha = 11;
  sys.ultimo = 'latas';
  sys.next(game);
  assert.ok(sys.current);
  assert.equal(sys.deserialize(undefined), false);
  assert.equal(sys.current, null);
  assert.equal(sys.state, null);
  assert.equal(sys.racha, 0);
  assert.equal(sys.ultimo, null);
});

test('tirar latas y recogerlas no cumple «Juntar latas»; si se pierden en el suelo, la base baja', async () => {
  const THREE = await import('three');
  const { ITEMS } = await import('../src/data/items.js');
  const { InventorySystem } = await import('../src/systems/InventorySystem.js');
  const { InteractionSystem } = await import('../src/systems/InteractionSystem.js');
  const { DroppedItemSystem } = await import('../src/systems/DroppedItemSystem.js');
  const { DROP_LIFETIME } = await import('../src/entities/DroppedItem.js');
  globalThis.window ??= new EventTarget();
  const game = {
    sceneMgr: { scene: new THREE.Scene() },
    inventory: new InventorySystem(50),
    player: { position: new THREE.Vector3(), root: new THREE.Group(), playAction() {} },
    world: { active: { isWalkableAt: () => true, getGroundHeight: () => 0 } },
    collisions: { colliders: [], dynamicColliders: [] },
    stats: { dinero: 0 },
    _save() {},
  };
  game.interaction = new InteractionSystem(game.player, game.inventory, { addXP() {} }, { play() {} }, { tryInfect() {} }, {});
  game.droppedItems = new DroppedItemSystem(game);
  game.inventory.add(ITEMS.lata, 12);
  const sys = new EncargoSystem();
  sys.state = { tipo: 'latas', n: 10, base: sys._base('latas', game) };
  sys._build();
  assert.equal(sys.state.base, 12);

  // Tirar todo: el costal queda en 0, pero las latas siguen siendo suyas en el suelo.
  assert.equal(game.droppedItems.drop('lata', 12).quantity, 12);
  assert.equal(sys.update(game), null);
  assert.equal(sys.state.base, 12, 'tirar no baja la base');
  assert.equal(game.droppedItems.collect(game.droppedItems.items[0]), 12);
  assert.equal(sys.update(game), null, 'recoger lo tirado no es juntar');
  assert.deepEqual(sys.progress(game), { value: 0, goal: 10 });

  // Si las deja perder, ya no las tiene: la base baja y cuenta lo que junte desde ahí.
  game.droppedItems.drop('lata', 12);
  game.droppedItems.update(DROP_LIFETIME + 1);
  assert.equal(game.droppedItems.items.length, 0);
  assert.equal(sys.update(game), null);
  assert.equal(sys.state.base, 0);
  game.inventory.add(ITEMS.lata, 10);
  assert.equal(sys.update(game)?.title, 'Juntar 10 latas');
});
