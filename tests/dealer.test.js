import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { DrugDealer } from '../src/entities/DrugDealer.js';
import { ITEMS, dealerOffer, dealerPrice } from '../src/data/items.js';
import { TALENTS } from '../src/data/talents.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { HUD } from '../src/ui/HUD.js';
import { cop } from '../src/utils/money.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function dealerScene(t) {
  const stats = new StatsSystem();
  stats.dinero = 0;
  const inventory = new InventorySystem();
  inventory.add(ITEMS.basuco, 2);
  inventory.add(ITEMS.pastilla, 1);
  const interaction = new InteractionSystem({ position: new THREE.Vector3() }, inventory, stats, { play() {} },
    null, { getEffect: (_key, base) => base }, null);
  const dealer = new DrugDealer(new THREE.Scene(), new THREE.Vector3(1, 0, 0));
  t.after(() => dealer.dispose());
  interaction.register(dealer);
  return { stats, inventory, interaction, dealer };
}

// Una tecla pulsada una sola vez
const press = (code) => {
  const pending = new Set([code]);
  return { isDown: () => false, consumePress: (key) => pending.delete(key) };
};

test('comprarle al dealer para revenderle nunca deja ganancia, ni con el mejor talento', () => {
  const best = Math.max(...Object.values(TALENTS).map((talent) => talent.effects?.substancePriceMult ?? 1));
  assert.ok(best > 1, 'hay un talento que mejora el precio');
  for (const item of Object.values(ITEMS).filter((i) => i.substance)) {
    assert.ok(dealerOffer(item, best) < dealerPrice(item), `${item.id}: paga ${dealerOffer(item, best)} y cobra ${dealerPrice(item)}`);
  }
});

test('E junto al dealer abre su tienda y no vende nada sin preguntar', (t) => {
  const { stats, inventory, interaction, dealer } = dealerScene(t);
  const opened = [];
  window.addEventListener('dealer-toggle', (e) => opened.push(e.detail.dealer));
  interaction.update(0.016, press('KeyE'), { isNight: true });
  assert.deepEqual(opened, [dealer]);
  assert.equal(inventory.count('basuco'), 2);
  assert.equal(inventory.count('pastilla'), 1);
  assert.equal(stats.dinero, 0);
});

test('de noche le vende solo la sustancia elegida y paga lo que anuncia la tienda', (t) => {
  t.mock.method(Math, 'random', () => 0.99); // sin requisa
  const { stats, inventory, interaction } = dealerScene(t);
  const result = interaction.sellSubstancesToDealer('basuco', { isNight: true });
  assert.equal(result.earned, dealerOffer(ITEMS.basuco) * 2);
  assert.equal(stats.dinero, result.earned);
  assert.equal(inventory.count('basuco'), 0);
  assert.equal(inventory.count('pastilla'), 1, 'lo demás se queda en el costal');
});

test('de día el dealer no compra y no se pierde nada', (t) => {
  const { stats, inventory, interaction } = dealerScene(t);
  const refusals = [];
  window.addEventListener('substance-fail', (e) => refusals.push(e.detail.reason));
  assert.equal(interaction.sellSubstancesToDealer('basuco', { isNight: false }), null);
  assert.deepEqual(refusals, ['day']);
  assert.equal(inventory.count('basuco'), 2);
  assert.equal(stats.dinero, 0);
});

test('en una requisa la policía se lleva lo que ibas a vender y no te pagan', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const { stats, inventory, interaction } = dealerScene(t);
  const raids = [];
  window.addEventListener('substance-raid', (e) => raids.push(e.detail.lost));
  assert.deepEqual(interaction.sellSubstancesToDealer('basuco', { isNight: true }), { earned: 0, raided: true });
  assert.deepEqual(raids, [[`${ITEMS.basuco.name} ×2`]]);
  assert.equal(stats.dinero, 0);
  assert.equal(inventory.count('basuco'), 0);
  assert.equal(inventory.count('pastilla'), 1);
});

// La tienda con lo justo para seguir el foco: reescribirla lo borra, como en el navegador, y un botón deshabilitado no lo recibe.
function focusPanel() {
  const seen = { focused: null };
  const node = (props = {}) => ({
    tabIndex: 0, listeners: [], ...props,
    addEventListener(type, fn) { this.listeners.push([type, fn]); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter(([name, listener]) => name !== type || listener !== fn); },
    removeAttribute(name) { if (name === 'tabindex') this.tabIndex = null; },
    focus() { if (!this.disabled) seen.focused = this; },
    scrollIntoView() {},
    fire(type, event = {}) { for (const [name, fn] of this.listeners) if (name === type) fn(event); },
  });
  const panel = {
    buttons: [], notice: null,
    set innerHTML(html) {
      seen.focused = null;
      this.notice = html.includes('class="dealer-empty"') ? node() : null;
      this.buttons = [...html.matchAll(/<button class="(dealer-(?:buy|sell)-btn)" data-id="([^"]+)"([^>]*)>/g)].map(([, kind, id, attrs]) => {
        const row = node();
        return node({ kind, dataset: { id }, disabled: attrs.includes('disabled'), closest: (selector) => (selector === '.dealer-product' ? row : null) });
      });
    },
    querySelectorAll(selector) { return this.buttons.filter(button => `.${button.kind}` === selector); },
    querySelector(selector) { return selector === '.dealer-empty' ? this.notice : null; },
  };
  return { panel, seen };
}

function focusShop(t, night = true) {
  const scene = dealerScene(t);
  const { panel, seen } = focusPanel();
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), dealerPanel: panel });
  window.__game = { ...scene, clock: { isNight: night } };
  t.mock.method(Math, 'random', () => .99); // sin requisa
  const buyButton = (id) => panel.querySelectorAll('.dealer-buy-btn').find(button => button.dataset.id === id);
  const sellButtons = () => panel.querySelectorAll('.dealer-sell-btn');
  const press = (button, detail = 0) => button.fire('click', { detail, stopPropagation() {} });
  return { ...scene, hud, panel, seen, buyButton, sellButtons, press };
}

test('con el mando, la compra que deshabilita su botón deja el foco en esa fila, hasta que la cruceta se va', (t) => {
  const { stats, hud, seen, buyButton, press } = focusShop(t);
  stats.dinero = dealerPrice(ITEMS.tintico) * 2;
  hud.renderDealer();
  press(buyButton('tintico'));
  assert.equal(seen.focused, buyButton('tintico'), 'aún alcanza: sigue en su botón');
  press(seen.focused);
  assert.equal(stats.dinero, 0);
  assert.equal(buyButton('tintico').disabled, true);
  const row = buyButton('tintico').closest('.dealer-product');
  assert.equal(seen.focused, row);
  assert.equal(row.tabIndex, -1);
  globalThis.document = { hasFocus: () => false };
  t.after(() => { delete globalThis.document; });
  row.fire('blur');
  assert.equal(row.tabIndex, -1, 'cambiar de ventana no la saca: al volver el foco sigue ahí');
  globalThis.document = { hasFocus: () => true };
  row.fire('blur');
  assert.equal(row.tabIndex, null, 'la fila solo se puede enfocar mientras espera');
  assert.equal(row.listeners.length, 0);
});

test('con el mando, vender sigue en la última fila y, sin ventas, deja el foco en el aviso', (t) => {
  const { hud, panel, seen, sellButtons, press } = focusShop(t);
  hud.renderDealer();
  press(sellButtons()[1]);
  assert.deepEqual(sellButtons().map(button => button.dataset.id), ['basuco']);
  assert.equal(seen.focused, sellButtons()[0], 'la última que queda');
  press(seen.focused);
  assert.equal(sellButtons().length, 0);
  assert.equal(seen.focused, panel.notice);
  assert.equal(panel.notice.tabIndex, -1);
});

test('con el ratón la tienda no se queda con el foco', (t) => {
  const { stats, hud, seen, buyButton, sellButtons, press } = focusShop(t);
  stats.dinero = dealerPrice(ITEMS.tintico);
  hud.renderDealer();
  press(buyButton('tintico'), 1);
  assert.equal(seen.focused, null);
  press(sellButtons()[0], 1);
  assert.equal(seen.focused, null);
});

test('la tienda muestra lo que cobra y, de noche, una fila con lo que paga por cada sustancia', (t) => {
  const { stats, inventory, interaction, dealer } = dealerScene(t);
  const panel = { html: '', set innerHTML(value) { this.html = value; }, querySelectorAll: () => [] };
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), dealerPanel: panel });
  window.__game = { stats, inventory, interaction, dealer, clock: { isNight: false } };
  hud.renderDealer();
  assert.ok(panel.html.includes(cop(dealerPrice(ITEMS.basuco))));
  assert.ok(!panel.html.includes('dealer-sell-btn'), 'de día no hay nada que vender');
  window.__game.clock.isNight = true;
  hud.renderDealer();
  assert.equal(panel.html.match(/class="dealer-sell-btn"/g).length, 2);
  assert.ok(panel.html.includes(cop(dealerOffer(ITEMS.basuco) * 2)));
  assert.ok(panel.html.includes('paga 1,8×'));
  // Con Contactos la cuenta de cada fila sube: la frase no puede seguir diciendo lo de antes.
  interaction.substancePriceMult = () => 1.3;
  hud.renderDealer();
  assert.ok(panel.html.includes('paga 2,34×'));
  assert.ok(panel.html.includes(cop(dealerOffer(ITEMS.basuco, 1.3) * 2)));
});
