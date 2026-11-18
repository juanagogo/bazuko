// tests/wardrobe.test.js
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../src/data/items.js';
import { openCambuche } from '../src/ui/placeMenus.js';
import { HUD } from '../src/ui/HUD.js';

function dom() {
  const nodo = (tag) => ({
    tag, className: '', textContent: '', children: [], attributes: {}, style: {}, dataset: {},
    addEventListener(evt, fn) { this['on' + evt] = fn; },
    removeEventListener() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    append(...n) {
      for (const item of n) {
        if (typeof item === 'string') this.textContent += item;
        this.children.push(item);
      }
    },
    appendChild(n) { this.children.push(n); return n; },
    prepend(...n) { this.children.unshift(...n); },
    replaceChildren(...n) { this.children = n; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext() { return { fillStyle: '', fillRect() {}, strokeStyle: '', strokeRect() {}, fillText() {} }; }
  });
  globalThis.document = { createElement: nodo, getElementById: () => nodo('div'), activeElement: null };
  globalThis.window = new EventTarget();
  globalThis.window.__game = null;
  return nodo;
}

test.before(() => {
  dom();
  mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}')));
});
test.after(() => mock.restoreAll());

test('el objeto ropaLimpia existe, es consumible y usable', () => {
  const item = ITEMS.ropaLimpia;
  assert.ok(item, 'ropaLimpia está en el catálogo de ITEMS');
  assert.equal(item.usable, true);
  assert.equal(item.consumable, 'higiene');
  assert.equal(item.amount, 30);
  assert.equal(item.animo, 15);
});

test('openCambuche incluye la opción de Cambiar ropa', () => {
  let menuConfig = null;
  let wardrobeOpened = false;

  const menu = {
    isOpen: false,
    open(cfg) { menuConfig = cfg; this.isOpen = true; },
    close() { this.isOpen = false; },
    refresh() {}
  };

  const game = {
    menu,
    built: { base: true },
    inventory: { count: () => 10, items: [] },
    clock: { isNight: false },
    openWardrobe: () => { wardrobeOpened = true; }
  };

  openCambuche(game);
  assert.ok(menuConfig, 'se abrió el menú del cambuche');
  const rendered = menuConfig.render();

  const botones = rendered.foot.filter(n => n.tag === 'button');
  const btnRopa = botones.find(b => b.textContent?.includes('Cambiar ropa') || b.children?.some(c => String(c).includes('Cambiar ropa')));
  assert.ok(btnRopa, 'existe el botón Cambiar ropa en el cambuche');

  // Ejecutar el clic en cambiar ropa
  btnRopa.onclick();
  assert.equal(menu.isOpen, false, 'cerró el menú de cambuche');
  assert.equal(wardrobeOpened, true, 'abrió el ropero');
});

test('el botón de la siesta queda apagado con su motivo a la vista; de noche no lo pide', () => {
  const pie = (motivo, isNight = false) => {
    let config = null;
    openCambuche({
      menu: { isOpen: false, open(cfg) { config = cfg; this.isOpen = true; }, close() {}, refresh() {} },
      built: { base: true }, inventory: { count: () => 10, items: [] }, clock: { isNight },
      motivoSinSiesta: () => motivo, sleep() {}, openWardrobe() {}
    });
    const foot = config.render().foot;
    const dormir = foot.find(n => n.tag === 'button' && /siesta|Dormir hasta/.test(n.textContent));
    return { nota: foot[0].textContent, apagado: 'disabled' in dormir.attributes };
  };
  assert.deepEqual(pie(null), { nota: 'Dormir guarda la partida.', apagado: false });
  assert.deepEqual(pie({ reason: 'descansado', horas: 4 }), { nota: 'Ya eché una siesta: puedo echar otra en 4 h.', apagado: true });
  assert.deepEqual(pie({ reason: 'descansado' }), { nota: 'Todavía no tengo sueño para una siesta.', apagado: true });
  assert.deepEqual(pie({ reason: 'descansado' }, true), { nota: 'Dormir guarda la partida.', apagado: false });
});

test('si el juego se niega a la siesta, el aviso dice el motivo', () => {
  const antes = globalThis.window;
  globalThis.window = new EventTarget(); // los oyentes del HUD no se quedan para las demás pruebas
  try {
    const avisos = [];
    const hud = Object.assign(Object.create(HUD.prototype), { _toast: (text, kind) => avisos.push([text, kind]) });
    hud._bindEvents();
    const falla = detail => window.dispatchEvent(new CustomEvent('sleep-fail', { detail }));
    falla({ reason: 'descansado', horas: 2 });
    falla({ reason: 'descansado' });
    falla({ reason: 'nobase' });
    assert.deepEqual(avisos, [
      ['Ya eché una siesta: puedo echar otra en 2 h.', 'warn'],
      ['Todavía no tengo sueño para una siesta.', 'warn'],
      ['Primero toca armar el cambuche (8 cartones)', 'warn']
    ]);
  } finally { globalThis.window = antes; }
});

test('usar ropaLimpia desde el inventario aplica higiene, ánimo y abre el ropero', () => {
  let wardrobeOpened = false;
  const game = {
    inventoryUI: { close() {} },
    stats: { higiene: 20, animo: 40 },
    openWardrobe: () => { wardrobeOpened = true; },
    audio: { play() {} }
  };
  window.__game = game;

  const hud = Object.assign(Object.create(HUD.prototype), {
    _toast() {}
  });

  const inv = {
    items: [{ id: 'ropaLimpia', qty: 1 }],
    remove(id, qty) {
      const idx = this.items.findIndex(x => x.id === id);
      if (idx >= 0) this.items.splice(idx, qty);
    }
  };

  hud._useItem('ropaLimpia', inv);

  assert.equal(game.stats.higiene, 50, 'higiene sube +30');
  assert.equal(game.stats.animo, 55, 'ánimo sube +15');
  assert.equal(inv.items.length, 0, 'se consume del inventario');
  assert.equal(wardrobeOpened, true, 'abre el sistema de cambio de ropa');
});

test('openWardrobe en Game invoca creator.open con initialTab ropa y Vestirme', async () => {
  let openArgs = null;
  let saved = false;
  let lookApplied = false;

  const mockCreator = {
    open(current, opts) {
      openArgs = { current, opts };
      return Promise.resolve({ ...current, real: { ...current.real, ropa: 'chaqueta' } });
    }
  };

  const game = {
    creator: mockCreator,
    look: { real: { ropa: 'buzo' } },
    audio: { play() {} },
    _applyLook(l) { this.look = l; lookApplied = true; },
    _save() { saved = true; },
    async openWardrobe() {
      const look = await this.creator.open(this.look, { initialTab: 'ropa', doneLabel: 'Vestirme' });
      if (look) {
        await this._applyLook(look);
        this._save();
      }
    }
  };

  await game.openWardrobe();

  assert.ok(openArgs);
  assert.equal(openArgs.opts.initialTab, 'ropa');
  assert.equal(openArgs.opts.doneLabel, 'Vestirme');
  assert.equal(lookApplied, true);
  assert.equal(saved, true);
  assert.equal(game.look.real.ropa, 'chaqueta');
});
