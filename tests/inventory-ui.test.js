import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ITEMS } from '../src/data/items.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { InventoryUI, useVerb } from '../src/ui/InventoryUI.js';

// Elementos mínimos: cuentan escrituras de innerHTML para comprobar que no se reescribe el DOM.
class FakeEl {
  constructor() {
    this.writes = 0; this._html = ''; this.textContent = ''; this.className = '';
    this.hidden = false; this.disabled = false; this.title = ''; this.style = {};
    this.attrs = {}; this.children = []; this.dataset = {};
    const self = this;
    this.classList = {
      _set() { return new Set(self.className.split(/\s+/).filter(Boolean)); },
      toggle(c, on) { const s = this._set(); (on ?? !s.has(c)) ? s.add(c) : s.delete(c); self.className = [...s].join(' '); },
      add(...cs) { const s = this._set(); cs.forEach((c) => s.add(c)); self.className = [...s].join(' '); },
      remove(...cs) { const s = this._set(); cs.forEach((c) => s.delete(c)); self.className = [...s].join(' '); },
      contains(c) { return this._set().has(c); }
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; this.writes++; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  focus() { globalThis.document.activeElement = this; }
  get offsetWidth() { return 0; }
}

function panel(inv) {
  globalThis.document = { createElement: () => new FakeEl(), activeElement: null };
  globalThis.requestAnimationFrame = () => 0; // la prueba dibuja a mano con render()
  const sounds = [];
  const game = { audio: { play: (s) => sounds.push(s) }, hud: { _useItem: (id, i) => i.remove(id, 1) } };
  const ui = Object.assign(Object.create(InventoryUI.prototype), {
    inv, game, isOpen: true, selected: 0, _focusSlot: false,
    _cache: { slots: [], selected: [], detail: null, quick: [], cap: '' },
    slotEls: [], gridEl: new FakeEl(), root: { contains: (el) => !!el }, _toast() {}
  });
  for (const k of ['loadEl', 'loadText', 'loadFill', 'loadFlag', 'countEl', 'bench', 'dPedestal', 'dArt', 'dQty', 'dName',
    'dRarity', 'dEffect', 'dNote', 'dMeta', 'dReason', 'btnUse', 'useArt', 'useLabel', 'btnDrop1', 'btnDropAll']) ui[k] = new FakeEl();
  ui.hotEls = inv.hotbar.map(() => new FakeEl());
  ui._growSlots(inv.slotCount);
  ui.render = () => { ui._renderGrid(); ui._renderDetail(); ui._restoreFocus(); };
  return { ui, sounds };
}

test('el inventario conserva la selección y el foco al redibujar', () => {
  const inv = new InventorySystem(60);
  inv.add(ITEMS.pan, 2); inv.add(ITEMS.carton, 3); inv.add(ITEMS.agua, 1);
  const { ui } = panel(inv);
  ui.select(1); ui.render();
  const slot = ui.slotEls[1].el;
  assert.ok(slot.classList.contains('selected'));
  assert.equal(slot.getAttribute('aria-pressed'), 'true');
  assert.equal(document.activeElement, slot, 'la casilla elegida recibe el foco');

  inv.add(ITEMS.pan, 1); ui.render();
  assert.equal(ui.selected, 1);
  assert.ok(ui.slotEls[1].el.classList.contains('selected'));
  assert.equal(ui.slotEls[0].el.classList.contains('selected'), false);
  assert.equal(document.activeElement, slot);
  assert.match(ui.dName.textContent, /Cartón/);
});

test('no reescribe casillas ni detalle cuando nada cambia', () => {
  const inv = new InventorySystem(60);
  inv.add(ITEMS.pan, 2); inv.add(ITEMS.carton, 3);
  const { ui } = panel(inv);
  ui.render();
  const writes = () => ui.slotEls.map((s) => s.el.writes).reduce((a, b) => a + b, 0) + ui.dArt.writes;
  const first = writes();
  ui.render(); ui.render();
  assert.equal(writes(), first, 'un redibujado sin cambios no toca el DOM');

  ui.select(1); ui.render();
  assert.equal(ui.slotEls[0].el.writes + ui.slotEls[1].el.writes, 2, 'mover la selección solo cambia clases');

  inv.add(ITEMS.carton, 1); ui.render();
  assert.equal(ui.slotEls[0].el.writes, 1, 'la casilla del pan sigue intacta');
  assert.equal(ui.slotEls[1].el.writes, 2, 'solo se reescribe la casilla cuya cantidad cambió');
  assert.match(ui.slotEls[1].el.innerHTML, /×4/);
});

test('las acciones del banco dependen del objeto elegido', () => {
  const inv = new InventorySystem(60);
  inv.add(ITEMS.pan, 1); inv.add(ITEMS.carton, 3); inv.add(ITEMS.popo, 2);
  inv.bindHotbar(2, 'pan');
  const { ui } = panel(inv);

  ui.render(); // pan: usable, una unidad
  assert.equal(ui.btnUse.disabled, false); assert.equal(ui.btnUse.hidden, false);
  assert.equal(ui.useLabel.textContent, 'Comer');
  assert.equal(ui.btnDrop1.disabled, false); assert.equal(ui.btnDropAll.disabled, false, 'con una sola unidad también se puede tirar: no sale tachado');
  assert.deepEqual(ui.hotEls.map((b) => b.disabled), [false, false, false, false, false]);
  assert.equal(ui.hotEls[2].getAttribute('aria-pressed'), 'true');
  assert.match(ui.dEffect.textContent, /\+25 hambre, \+5 ánimo/);
  assert.match(ui.slotEls[0].el.innerHTML, /inv-slot-key[^>]*>3</);

  ui.select(1); ui.render(); // cartón: no se usa
  assert.equal(ui.btnUse.hidden, true); assert.equal(ui.btnUse.disabled, true);
  assert.equal(ui.btnDropAll.disabled, false);
  assert.ok(ui.hotEls.every((b) => b.disabled), 'solo lo usable va a la barra rápida');
  assert.equal(ui.dReason.textContent, 'Se vende en la recicladora');

  ui.select(2); ui.render(); // popó: lanzar y explicar la X
  assert.equal(ui.useLabel.textContent, 'Lanzar');
  assert.match(ui.dNote.textContent, /X en la calle/);

  ui.select(7); ui.render(); // casilla vacía
  assert.equal(ui.dName.textContent, 'Casilla vacía');
  assert.ok(ui.btnUse.disabled && ui.btnDrop1.disabled && ui.btnDropAll.disabled);
});

test('marca rareza, familia y carga del costal sin depender solo del color', () => {
  const inv = new InventorySystem(10);
  inv.add(ITEMS.moneda, 1); inv.add(ITEMS.colchon, 1); inv.add(ITEMS.madera, 1); inv.add(ITEMS.agua, 1);
  const { ui } = panel(inv);
  ui.render();
  assert.match(ui.slotEls[0].el.className, /cat-valor/);
  assert.match(ui.slotEls[0].el.innerHTML, /inv-slot-rare[^>]*>★</);
  assert.match(ui.slotEls[0].el.getAttribute('aria-label'), /moneda vieja ×1/i);
  assert.match(ui.slotEls[3].el.className, /cat-comida.*usable|usable.*cat-comida/);
  assert.equal(ui.loadText.textContent, '8,5 de 10 kg');
  assert.equal(ui.loadFlag.textContent, 'casi lleno');
  inv.maxWeight = inv.totalWeight; ui.render();
  assert.equal(ui.loadFlag.textContent, 'lleno');
  assert.equal(ui.loadEl.className, 'inv-load full');
});

test('las partidas antiguas con más de 20 tipos muestran todas sus casillas', () => {
  const inv = new InventorySystem(500);
  const ids = Object.keys(ITEMS).slice(0, 23);
  for (const id of ids) inv.add(ITEMS[id], 1);
  const { ui } = panel(inv);
  ui.render();
  assert.equal(inv.slotCount, 25);
  assert.equal(ui.slotEls.length, 25);
  assert.ok(ui.slotEls.slice(0, 23).every((s) => !s.el.classList.contains('is-empty')));
  ui.select(24); ui.render();
  assert.equal(ui.selected, 24);
  for (const id of ids.slice(0, 5)) inv.remove(id, 1);
  ui.render();
  assert.equal(ui.selected, 19, 'la selección se ajusta si sobran casillas');
  assert.ok(ui.slotEls.slice(20).every((s) => s.el.hidden));
});

test('usar y tirar descuentan, suenan y animan el pedestal', () => {
  const inv = new InventorySystem(60);
  inv.add(ITEMS.pan, 2); inv.add(ITEMS.carton, 3);
  const { ui, sounds } = panel(inv);
  ui.render();
  ui.useSelected();
  assert.equal(inv.count('pan'), 1);
  assert.ok(ui.bench.classList.contains('just-used'));
  ui.select(1); ui.render();
  ui._drop(true);
  assert.equal(inv.count('carton'), 0);
  assert.deepEqual(sounds, ['empty']);
  assert.ok(ui.bench.classList.contains('just-dropped') && !ui.bench.classList.contains('just-used'));
});

test('el verbo del botón principal sigue la lógica de uso', () => {
  assert.equal(useVerb(ITEMS.agua), 'Beber');
  assert.equal(useVerb(ITEMS.cafe), 'Beber');
  assert.equal(useVerb(ITEMS.vacuna), 'Curarse');
  assert.equal(useVerb(ITEMS.aguapanela), 'Beber', 'también cura la gripe, pero se gasta aunque no la haya');
  assert.equal(useVerb(ITEMS.cigarrillo), 'Consumir');
  assert.equal(useVerb(ITEMS.jabon), 'Asearse');
  assert.equal(useVerb(ITEMS.vendaje), 'Aplicar');
  assert.equal(useVerb(ITEMS.radioTransistor), 'Sintonizar');
  assert.equal(useVerb(ITEMS.pilas), 'Cambiar pilas');
});
