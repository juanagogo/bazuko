import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ITEMS, LOOT_COMMON } from '../src/data/items.js';
import { HUD } from '../src/ui/HUD.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';

let hud, inv, ids;

beforeEach(() => {
  globalThis.window = new EventTarget();
  window.__game = { stats: new StatsSystem(), audio: { play() {} }, player: { playAction() {} } };
  hud = Object.assign(Object.create(HUD.prototype), { _toast() {}, _renderInventory() {} });
  inv = new InventorySystem();
  ids = [];
  window.addEventListener('substance-consumed', (e) => ids.push(e.detail.id));
});

test('la basura puede traer pegante, hierba y pastilla con sus pesos', () => {
  const weight = (id) => LOOT_COMMON.find((e) => e.item === id)?.weight;
  assert.equal(weight('pegante'), 1.0);
  assert.equal(weight('hierba'), 1.5);
  assert.equal(weight('pastilla'), 0.3);
});

test('los demás pesos de la basura no cambian', () => {
  const others = Object.fromEntries(LOOT_COMMON
    .filter((e) => !['pegante', 'hierba', 'pastilla'].includes(e.item))
    .map((e) => [e.item, e.weight]));
  assert.deepEqual(others, { lata: 33, botella: 24, carton: 17, chatarra: 8, cable: 4, pilas: 3, pan: 4, agua: 3,
    lataComida: 2, vendaje: 1, cigarrillo: 2, madera: 3, lona: 0.6, colchon: 0.4, vela: 0.8 });
});

test('consumir una sustancia avisa substance-consumed con su id y conserva sus efectos', () => {
  inv.add(ITEMS.pegante, 1);
  window.__game.stats.vicio = 30;
  hud._useItem('pegante', inv);
  assert.deepEqual(ids, ['pegante']);
  assert.equal(window.__game.stats.vicio, 70);
  assert.equal(inv.count('pegante'), 0);
});

test('la comida y el cigarrillo no avisan substance-consumed', () => {
  inv.add(ITEMS.pan, 1);
  inv.add(ITEMS.cigarrillo, 1);
  hud._useItem('pan', inv);
  hud._useItem('cigarrillo', inv);
  assert.deepEqual(ids, []);
  assert.equal(inv.count('pan'), 0);
  assert.equal(inv.count('cigarrillo'), 0);
});
