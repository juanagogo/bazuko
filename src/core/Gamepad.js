// src/core/Gamepad.js
// Mando con el mapeo estándar del navegador (Xbox, PlayStation y genéricos).
// Los sticks y gatillos se leen como valores analógicos; los botones se
// traducen a las mismas teclas del teclado para reutilizar todos los atajos.

import { modoEntrada, ponerModo } from './modoEntrada.js';

const DEAD_ZONE = 0.2;
const TRIGGER_THRESHOLD = 0.3;

// Índices del mapeo estándar: https://w3c.github.io/gamepad/#remapping
export const BUTTON_KEYS = {
  0: 'KeyE',        // A: interactuar
  1: 'Escape',      // B: cerrar panel o volver
  2: 'KeyQ',        // X: mantener junto a basura, tienda del dealer
  3: 'KeyI',        // Y: inventario
  4: 'KeyV',        // LB: cambiar cámara
  5: 'KeyG',        // RB: golpear
  6: 'Space',       // LT: saltar
  8: 'KeyM',        // View: mapa
  9: 'Escape',      // Menu: pausa
  11: 'KeyN',       // R3: radar
  12: 'KeyR',       // Cruceta arriba: radio
  13: 'KeyX',       // Cruceta abajo: lanzar o popó
  14: 'KeyB',       // Cruceta izquierda: limosna
  15: 'KeyF',       // Cruceta derecha: boost
};
const RUN_BUTTONS = [7, 10]; // RT o L3: correr
const ACORDE = 4; // LB: tocado solo cambia la cámara, al soltarlo; sostenido da lo que no cabe en el mando
/** Con LB sostenido: las casillas en la cruceta y en A, Fabricar en Y y Mañas en X. */
export const CON_LB = { 12: 'Digit1', 15: 'Digit2', 13: 'Digit3', 14: 'Digit4', 0: 'Digit5', 3: 'KeyC', 2: 'KeyT' };

/** La pestaña Controles de la pausa, para quien juega con mando. */
export const CONTROLES_CON_MANDO = [
  ['Moverse', [['Stick izquierdo', 'Caminar'], ['RT', 'Correr'], ['LT', 'Brincar'], ['Stick derecho', 'Mirar'], ['LB', 'Cambiar la cámara, al soltarlo']]],
  ['Hacer', [['A', 'Lo que dice la cinta'], ['X', 'Robo directo. Sostenido: seleccionar basura'], ['RB', 'Pegar'], ['Arriba', 'Radio'], ['Abajo', 'Lanzar'], ['Izquierda', 'Pedir'], ['Derecha', 'Envión']]],
  ['Paneles', [['Y', 'El costal'], ['LB+Y', 'Fabricar'], ['LB+X', 'Mañas'], ['LB+cruceta', 'Casillas 1 a 4: arriba, derecha, abajo, izquierda'], ['LB+A', 'Casilla 5'], ['View', 'El mapa'], ['R3', 'El radar'], ['Menú', 'Pausa'], ['B', 'Cerrar o volver']]],
];
const DIRECTIONS = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex], [role="button"], .talent-node.available';
const NAV_THRESHOLD = .55;
const NAV_DELAY = 350;
const NAV_INTERVAL = 140;

const KEY_NAMES = { Escape: 'Escape', Space: ' ', Enter: 'Enter', Tab: 'Tab' };

/** Una tecla como la del teclado, marcada para que soltar la física no suelte esta. También la usan los controles táctiles. */
export function emitirTecla(type, code, reset = false) {
  const key = KEY_NAMES[code] ?? code.replace(/^Key/, '').toLowerCase();
  const event = new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'gamepadInput', { value: true });
  Object.defineProperty(event, 'gamepadReset', { value: reset });
  (globalThis.document?.body ?? globalThis.window)?.dispatchEvent(event);
}

function deadZone(x, y) {
  const length = Math.hypot(x, y);
  if (length < DEAD_ZONE) return { x: 0, y: 0 };
  // Reescala para que el movimiento empiece suave justo después de la zona muerta.
  const scale = Math.min(1, (length - DEAD_ZONE) / (1 - DEAD_ZONE)) / length;
  return { x: x * scale, y: y * scale };
}

function pressed(button) {
  return !!button && (button.pressed || button.value > TRIGGER_THRESHOLD);
}

/** La entrada modal se resuelve antes de traducir botones a acciones del juego. */
export function getGamepadContext(game = globalThis.window?.__game, doc = globalThis.document) {
  if (!game) return { kind: 'gameplay' };
  if (game.photoMode?.active) return { kind: 'photo', root: game.photoMode.root, close: () => game.photoMode.exit() };
  if (game.creator?.isOpen) return { kind: 'creator', root: doc?.getElementById?.('creator-modal'), close: () => doc?.getElementById?.('creator-close')?.click() };
  if (game.menu?.isOpen) return { kind: 'menu', root: game.menu.root, close: () => game.menu.dismiss() };
  if (game.inventoryUI?.isOpen) return { kind: 'inventory', root: game.inventoryUI.root, action: action => game.inventoryUI.handleGamepad(action) };
  for (const [flag, panel, toggle] of [['_craftOpen', 'craftPanel', 'toggleCraftPanel'], ['_talentOpen', 'talentPanel', 'toggleTalentPanel'], ['_dealerOpen', 'dealerPanel', 'toggleDealerPanel']]) {
    if (game.hud?.[flag]) return { kind: panel, root: game.hud[panel], close: () => game.hud[toggle]() };
  }
  if (game.paused || game.isSleeping || game._loading || game._running === false) return { kind: 'blocked' };
  return { kind: 'gameplay' };
}

function controls(root) {
  return [...(root?.querySelectorAll?.(FOCUSABLE) ?? [])].filter(element =>
    !element.disabled && element.getAttribute?.('aria-disabled') !== 'true' &&
    !element.closest?.('[hidden], [inert], [aria-hidden="true"]') &&
    (!element.getClientRects || element.getClientRects().length > 0));
}

function focus(element) {
  // Los nodos de talentos tienen clic pero no eran controles enfocables.
  if (element?.matches?.('.talent-node.available') && !element.hasAttribute?.('tabindex')) element.tabIndex = 0;
  element?.focus?.({ preventScroll: true });
  element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function navigate(root, direction) {
  const elements = controls(root), active = globalThis.document?.activeElement;
  if (!elements.length) return;
  const current = elements.indexOf(active), forward = direction === 'down' || direction === 'right';
  // Izquierda/derecha ajustan controles nativos; arriba/abajo salen del control.
  if (current >= 0 && (direction === 'left' || direction === 'right')) {
    if (active.matches?.('input[type="range"]')) {
      const step = active.step === 'any' ? 1 : Number(active.step || 1);
      const value = Math.max(Number(active.min || 0), Math.min(Number(active.max || 100), Number(active.value) + (forward ? step : -step)));
      active.value = String(value);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (active.matches?.('select')) {
      active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + (forward ? 1 : -1)));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }
  const next = current < 0 ? (forward ? 0 : elements.length - 1) : (current + (forward ? 1 : -1) + elements.length) % elements.length;
  focus(elements[next]);
}

function confirm(root) {
  const elements = controls(root), active = globalThis.document?.activeElement;
  if (!elements.includes(active)) { focus(elements[0]); return; }
  // Un KeyboardEvent sintético no activa botones de forma nativa. El clic
  // explícito mantiene sus validaciones (disabled, formulario, callback, etc.).
  if (active.matches?.('button, a[href], [role="button"], .talent-node.available, input[type="checkbox"], input[type="radio"], input[type="submit"]')) active.click();
  else focus(active);
}

export class GamepadInput {
  constructor({ getContext = getGamepadContext, now = () => performance.now() } = {}) {
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.running = false;
    this._held = new Set();
    this._index = null;
    this.getContext = getContext;
    this.now = now;
    this._blockedButtons = new Set();
    this._buttons = new Set();
    this._focused = true;
    this._context = null;
    this._needsNeutral = false;
    if (typeof window === 'undefined' || typeof globalThis.navigator?.getGamepads !== 'function') return;

    window.addEventListener('gamepadconnected', (e) => {
      if (this._index === null) this._index = e.gamepad.index;
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: 'Control conectado', type: 'info' } }));
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this._index) return;
      this._release();
      this._index = null;
      this._needsNeutral = true;
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: 'Control desconectado', type: 'warn' } }));
    });
    const suspend = () => { this._release(); this._needsNeutral = true; };
    window.addEventListener('blur', () => { this._focused = false; suspend(); });
    window.addEventListener('focus', () => { this._focused = true; });
    globalThis.document?.addEventListener?.('visibilitychange', () => { if (document.hidden) suspend(); });
    // Se lee en su propio ciclo para que Escape y los paneles respondan aunque el juego esté en pausa.
    const poll = () => { this.poll(); requestAnimationFrame(poll); };
    requestAnimationFrame(poll);
  }

  poll() {
    if (!this._focused || globalThis.document?.hidden) {
      this._release(); this._needsNeutral = true; return;
    }
    const pads = globalThis.navigator?.getGamepads?.() ?? [];
    const pad = pads[this._index] ?? [...pads].find(Boolean);
    if (!pad) { this._release(); this._needsNeutral = true; return; }
    this._index = pad.index;
    const context = this.getContext() ?? { kind: 'blocked' };
    if ((this._context && this._changed(context)) || this._needsNeutral) this._transition(context, pad);
    this._context = context;
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    if (modoEntrada() !== 'mando' && (pad.buttons.some(pressed) || Math.hypot(lx, ly) > DEAD_ZONE || Math.hypot(rx, ry) > DEAD_ZONE)) ponerModo('mando');
    if (Math.hypot(lx, ly) <= DEAD_ZONE) this._moveBlocked = false;
    if (Math.hypot(rx, ry) <= DEAD_ZONE) this._lookBlocked = false;
    for (const index of this._blockedButtons) if (!pressed(pad.buttons[index])) this._blockedButtons.delete(index);
    const down = index => !this._blockedButtons.has(index) && pressed(pad.buttons[index]);
    const move = this._moveBlocked ? { x: 0, y: 0 } : deadZone(lx, ly);
    this.move = context.kind === 'gameplay' ? move : { x: 0, y: 0 };
    this.look = ['gameplay', 'photo'].includes(context.kind) && !this._lookBlocked ? deadZone(rx, ry) : { x: 0, y: 0 };
    this.running = context.kind === 'gameplay' && RUN_BUTTONS.some(down);
    if (context.kind !== 'gameplay') {
      if (context.kind !== 'blocked') this._pollModal(context, pad, down, move);
      this._buttons = new Set(pad.buttons.flatMap((button, index) => pressed(button) ? [index] : []));
      this._checkTransition(pad);
      return;
    }
    if (this._acorde(pad, down)) return;
    for (const [index, code] of Object.entries(BUTTON_KEYS)) {
      if (Number(index) === ACORDE) continue;
      const isDown = down(Number(index));
      const id = `${index}:${code}`;
      if (isDown && !this._held.has(id)) {
        this._held.add(id);
        this._key('keydown', code);
        if (this._checkTransition(pad)) break;
      } else if (!isDown && this._held.has(id)) {
        this._held.delete(id);
        this._key('keyup', code);
      }
    }
  }

  /** LB y lo que se oprime mientras está abajo. Devuelve true si eso cambió de contexto, por ejemplo al abrir Fabricar. */
  _acorde(pad, down) {
    const lb = down(ACORDE);
    if (lb && !this._lb) this._lb = { solo: true };
    if (this._lb) {
      for (const [index, code] of Object.entries(CON_LB)) {
        if (!down(Number(index))) continue;
        this._lb.solo = false;
        // Hasta soltarlo, ese botón no hace lo suyo: un acorde no da también radio ni costal.
        this._blockedButtons.add(Number(index));
        this._soltarSiSostenido(Number(index));
        this._key('keydown', code);
        this._key('keyup', code);
        if (this._checkTransition(pad)) return true;
      }
    }
    if (!lb && this._lb) {
      const { solo } = this._lb;
      this._lb = null;
      if (solo) {
        this._key('keydown', BUTTON_KEYS[ACORDE]);
        this._key('keyup', BUTTON_KEYS[ACORDE]);
        if (this._checkTransition(pad)) return true;
      }
    }
    return false;
  }

  _soltarSiSostenido(index) {
    const id = `${index}:${BUTTON_KEYS[index]}`;
    if (this._held.delete(id)) this._key('keyup', BUTTON_KEYS[index]);
  }

  _changed(context) { return this._context?.kind !== context.kind || this._context?.root !== context.root; }

  _checkTransition(pad) {
    const context = this.getContext() ?? { kind: 'blocked' };
    if (!this._changed(context)) return false;
    this._transition(context, pad);
    return true;
  }

  _transition(context, pad) {
    this._release();
    this._context = context;
    this._needsNeutral = false;
    this._blockedButtons = new Set(pad.buttons.flatMap((button, index) => pressed(button) ? [index] : []));
    this._buttons = new Set(this._blockedButtons);
    this._moveBlocked = Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > DEAD_ZONE;
    this._lookBlocked = Math.hypot(pad.axes[2] ?? 0, pad.axes[3] ?? 0) > DEAD_ZONE;
  }

  _pollModal(context, pad, down, move) {
    const action = value => {
      if (context.action) context.action(value);
      else if (value === 'confirm') confirm(context.root);
      else if (value === 'back') context.close?.();
      else navigate(context.root, value);
    };
    // Cerrar/confirmar tienen prioridad: una pulsación nunca hace dos acciones.
    if ([1, 9].some(index => down(index) && !this._buttons.has(index))) { action('back'); return; }
    if (down(0) && !this._buttons.has(0)) { action('confirm'); return; }
    let direction = Object.entries(DIRECTIONS).find(([index]) => down(Number(index)))?.[1];
    if (!direction && Math.max(Math.abs(move.x), Math.abs(move.y)) >= NAV_THRESHOLD) {
      direction = Math.abs(move.x) > Math.abs(move.y) ? (move.x > 0 ? 'right' : 'left') : (move.y > 0 ? 'down' : 'up');
    }
    const now = this.now();
    if (!direction) { this._navDirection = null; return; }
    if (direction !== this._navDirection) {
      this._navDirection = direction;
      this._nextNavigation = now + NAV_DELAY;
      action(direction);
    } else if (now >= this._nextNavigation) {
      this._nextNavigation = now + NAV_INTERVAL;
      action(direction);
    }
  }

  _release() {
    for (const id of this._held) this._key('keyup', id.split(':')[1], true);
    this._held.clear();
    this._lb = null;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.running = false;
    this._navDirection = null;
  }

  _key(type, code, reset = false) { emitirTecla(type, code, reset); }
}
