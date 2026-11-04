import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadInput, getGamepadContext } from '../src/core/Gamepad.js';
import { Input } from '../src/core/Input.js';
import { InventoryUI } from '../src/ui/InventoryUI.js';
import { Menu } from '../src/ui/Menu.js';

class Control extends EventTarget {
  constructor(tag = 'button', props = {}) {
    super(); this.tagName = tag.toUpperCase(); this.attributes = {}; this.clicks = 0;
    Object.assign(this, props);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  closest() { return this.hidden ? this : null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim();
      return value === this.tagName.toLowerCase() ||
        value === `input[type="${this.type}"]` && this.tagName === 'INPUT';
    });
  }
  focus() { document.activeElement = this; }
  scrollIntoView() {}
  click() { this.clicks++; this.onClick?.(); }
}

function fixture(t) {
  const originals = new Map(['window', 'document', 'KeyboardEvent', 'requestAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalPads = Object.getOwnPropertyDescriptor(globalThis.navigator, 'getGamepads');
  const events = [];
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false, activeElement: null, body: window, getElementById: () => null });
  globalThis.KeyboardEvent = class extends Event {
    constructor(type, init) { super(type, init); this.code = init.code; this.key = init.key; }
  };
  globalThis.requestAnimationFrame = () => 1;
  let pad = { index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  Object.defineProperty(globalThis.navigator, 'getGamepads', { configurable: true, value: () => pad ? [pad] : [] });
  window.addEventListener('keydown', event => events.push(`${event.type}:${event.code}`));
  window.addEventListener('keyup', event => events.push(`${event.type}:${event.code}`));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    if (originalPads) Object.defineProperty(globalThis.navigator, 'getGamepads', originalPads); else delete globalThis.navigator.getGamepads;
  });
  return {
    events,
    set(buttons = [], axes = [0, 0, 0, 0]) {
      pad = { index: 0, axes, buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: buttons.includes(index), value: buttons.includes(index) ? 1 : 0 })) };
    },
    disconnect() { pad = null; }
  };
}

function inventory(game) {
  const used = [], dropped = [];
  const ui = Object.assign(Object.create(InventoryUI.prototype), {
    game, isOpen: true, selected: 0, _cache: {}, _schedule() {},
    root: { classList: { remove() {} }, contains: () => false }, tipEl: { style: {} },
    slotEls: Array.from({ length: 30 }, () => ({ el: new Control() })),
    inv: { slotCount: 30, slots: Array.from({ length: 30 }, (_, index) => ({ id: `item${index}`, qty: 2 })), removeAt(index, count) { dropped.push([index, count]); } },
    _useItem(id, index) { used.push([id, index]); }
  });
  game.inventoryUI = ui;
  return { ui, used, dropped };
}

test('inventario: cruceta y stick seleccionan, A usa y B cierra sin descartar ni filtrar acciones', t => {
  const f = fixture(t), game = {}, { ui, used, dropped } = inventory(game);
  let now = 0;
  const pad = new GamepadInput({ getContext: () => getGamepadContext(game), now: () => now });
  f.set([13]); pad.poll();
  assert.equal(ui.selected, 5, 'abajo avanza una fila, no tira el objeto');
  f.set(); pad.poll(); f.set([0]); pad.poll(); pad.poll();
  assert.deepEqual(used, [['item5', 5]], 'A usa una sola vez');
  f.set(); pad.poll(); f.set([], [0, 1, 0, 0]); pad.poll();
  assert.equal(ui.selected, 10);
  now = 349; pad.poll(); assert.equal(ui.selected, 10);
  now = 350; pad.poll(); assert.equal(ui.selected, 15);
  f.set(); pad.poll(); f.set([2, 3, 4, 5, 6, 7, 8, 10, 11]); pad.poll();
  assert.equal(ui.selected, 15);
  assert.equal(pad.running, false); assert.deepEqual(pad.move, { x: 0, y: 0 });
  assert.deepEqual(dropped, []); assert.deepEqual(f.events, []);
  f.set(); pad.poll(); f.set([1]); pad.poll();
  assert.equal(ui.isOpen, false);
  assert.deepEqual(f.events, [], 'B no abre la pausa al cerrar el costal');
});

test('menú: navega solo controles visibles, confirma clic y ajusta sliders sin atajos de juego', t => {
  const f = fixture(t);
  const first = new Control(), disabled = new Control('button', { disabled: true });
  const hidden = new Control('button', { hidden: true }), slider = new Control('input', { type: 'range', min: '0', max: '100', step: '10', value: '40' });
  const last = new Control(), root = { querySelectorAll: () => [first, disabled, hidden, slider, last] };
  let changes = 0;
  slider.addEventListener('input', () => changes++);
  const pad = new GamepadInput({ getContext: () => ({ kind: 'menu', root }) });
  first.focus(); f.set([13]); pad.poll(); assert.equal(document.activeElement, slider);
  f.set(); pad.poll(); f.set([15]); pad.poll();
  assert.equal(slider.value, '50'); assert.equal(changes, 1);
  f.set(); pad.poll(); f.set([13]); pad.poll(); assert.equal(document.activeElement, last);
  f.set(); pad.poll(); f.set([0]); pad.poll(); pad.poll();
  assert.equal(last.clicks, 1); assert.deepEqual(f.events, []);
});

test('foto: el stick derecho encuadra, A activa captura y B sale sin movimiento ni ataque', t => {
  const f = fixture(t), capture = new Control(), root = { querySelectorAll: () => [capture] };
  const game = { photoMode: { active: true, root, exit() { this.active = false; } } };
  const pad = new GamepadInput({ getContext: () => getGamepadContext(game) });
  capture.focus(); f.set([0, 5, 7], [1, 0, .8, 0]); pad.poll(); pad.poll();
  assert.equal(capture.clicks, 1); assert.equal(pad.running, false);
  assert.deepEqual(pad.move, { x: 0, y: 0 }); assert.ok(pad.look.x > 0);
  assert.deepEqual(f.events, []);
  f.set(); pad.poll(); f.set([1, 5], [1, 0, 1, 0]); pad.poll(); pad.poll();
  assert.equal(game.photoMode.active, false);
  assert.deepEqual(pad.move, { x: 0, y: 0 }); assert.deepEqual(pad.look, { x: 0, y: 0 });
  assert.deepEqual(f.events, [], 'RB sostenido al salir no inicia un golpe');
  f.set(); pad.poll(); f.set([5], [1, 0, 0, 0]); pad.poll();
  assert.deepEqual(f.events, ['keydown:KeyG']); assert.equal(pad.move.x, 1);
});

test('el creador cierra con B; una recuperación no descartable requiere confirmar su botón', t => {
  const f = fixture(t), close = new Control(), root = { querySelectorAll: () => [close] };
  const game = { creator: { isOpen: true } };
  document.getElementById = id => id === 'creator-modal' ? root : id === 'creator-close' ? close : null;
  close.onClick = () => { game.creator.isOpen = false; };
  const pad = new GamepadInput({ getContext: () => getGamepadContext(game) });
  f.set([1]); pad.poll(); assert.equal(close.clicks, 1);
  const recovery = new Control();
  game.menu = Object.assign(Object.create(Menu.prototype), {
    root: { hidden: false, querySelectorAll: () => [recovery] }, _dismissible: false,
    close() { this.root.hidden = true; }
  });
  f.set(); pad.poll(); f.set([1]); pad.poll();
  assert.equal(game.menu.isOpen, true, 'B respeta dismissible=false');
  recovery.onClick = () => game.menu.close(); recovery.focus();
  f.set(); pad.poll(); f.set([0]); pad.poll();
  assert.equal(recovery.clicks, 1); assert.equal(game.menu.isOpen, false);
  assert.deepEqual(f.events, []);
});

test('abrir un panel libera las teclas sostenidas y exige neutral antes de confirmar o caminar', t => {
  const f = fixture(t), game = {};
  const { ui } = inventory(game); ui.isOpen = false;
  const input = new Input(); game.input = input;
  input.gamepad.getContext = () => getGamepadContext(game);
  window.addEventListener('keydown', event => { if (event.code === 'KeyI') ui.isOpen = true; });
  f.set([2], [1, 0, 0, 0]); input.gamepad.poll();
  assert.equal(input.isDown('KeyQ'), true);
  f.set([0, 2, 3], [1, 0, 0, 0]); input.gamepad.poll();
  assert.equal(ui.isOpen, true); assert.equal(input.isDown('KeyQ'), false);
  const before = [...f.events]; input.gamepad.poll();
  assert.deepEqual(f.events, before, 'el mismo pulso no se repite en el panel');
  assert.deepEqual(input.axis, { x: 0, z: 0 });
  f.set(); input.gamepad.poll(); f.set([1], [1, 0, 0, 0]); input.gamepad.poll();
  assert.equal(ui.isOpen, false); assert.deepEqual(input.axis, { x: 0, z: 0 });
  f.set(); input.gamepad.poll(); f.set([], [1, 0, 0, 0]); input.gamepad.poll();
  assert.deepEqual(input.axis, { x: 1, z: 0 });
});

test('ocultar, perder foco o desconectar suelta botones y no revive entradas mantenidas', t => {
  const f = fixture(t), pad = new GamepadInput();
  const active = () => { f.set([0, 7], [1, 0, 1, 0]); pad.poll(); assert.equal(pad.running, true); };
  const neutral = () => { f.set(); pad.poll(); };
  active();
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(pad.running, false); assert.deepEqual(pad.move, { x: 0, y: 0 });
  document.hidden = false; pad.poll(); assert.equal(pad.running, false);
  neutral(); active();
  window.dispatchEvent(new Event('blur')); pad.poll(); assert.equal(pad.running, false);
  window.dispatchEvent(new Event('focus')); pad.poll(); assert.equal(pad.running, false);
  neutral(); active();
  f.disconnect(); pad.poll(); assert.equal(pad.running, false);
  assert.deepEqual(pad.look, { x: 0, y: 0 });
  f.set([0, 7], [1, 0, 1, 0]); pad.poll(); assert.equal(pad.running, false);
  neutral(); active();
  const disconnected = new Event('gamepaddisconnected'); disconnected.gamepad = { index: 0 };
  window.dispatchEvent(disconnected);
  assert.equal(pad.running, false);
  assert.equal(f.events.filter(event => event === 'keydown:KeyE').length, 4);
  assert.equal(f.events.filter(event => event === 'keyup:KeyE').length, 4);
});

test('soltar el mando no cancela la misma tecla sostenida en el teclado ni al revés', t => {
  const f = fixture(t), input = new Input();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
  f.set([2]); input.gamepad.poll(); f.set(); input.gamepad.poll();
  assert.equal(input.isDown('KeyQ'), true);
  f.set([2]); input.gamepad.poll();
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }));
  assert.equal(input.isDown('KeyQ'), true);
  f.set(); input.gamepad.poll(); assert.equal(input.isDown('KeyQ'), false);
});

test('una pulsación pendiente no salta ni interactúa al volver de una pestaña oculta', t => {
  const f = fixture(t), input = new Input();
  f.set([0, 6]); input.gamepad.poll();
  assert.equal(input.pressedThisFrame.has('KeyE'), true);
  assert.equal(input.pressedThisFrame.has('Space'), true);
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(input.consumePress('KeyE'), false);
  assert.equal(input.consumePress('Space'), false);
  assert.equal(input.consumePress('KeySpace'), false);
  document.hidden = false; input.gamepad.poll();
  assert.equal(input.isDown('KeyE'), false);
  assert.equal(input.consumePress('Space'), false);
});
