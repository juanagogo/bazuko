// src/core/Gamepad.js
// Mando con el mapeo estándar del navegador (Xbox, PlayStation y genéricos).
// Los sticks y gatillos se leen como valores analógicos; los botones se
// traducen a las mismas teclas del teclado para reutilizar todos los atajos.

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

const KEY_NAMES = { Escape: 'Escape', Space: ' ', Enter: 'Enter', Tab: 'Tab' };

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

export class GamepadInput {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.running = false;
    this._held = new Set();
    this._index = null;
    if (typeof window === 'undefined' || typeof navigator?.getGamepads !== 'function') return;

    window.addEventListener('gamepadconnected', (e) => {
      if (this._index === null) this._index = e.gamepad.index;
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: '🎮 Control conectado', type: 'info' } }));
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this._index) return;
      this._release();
      this._index = null;
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: '🎮 Control desconectado', type: 'warn' } }));
    });
    // Se lee en su propio ciclo para que Escape y los paneles respondan aunque el juego esté en pausa.
    const poll = () => { this.poll(); requestAnimationFrame(poll); };
    requestAnimationFrame(poll);
  }

  poll() {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads[this._index] ?? [...pads].find(Boolean);
    if (!pad) return;
    this._index = pad.index;
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    this.move = deadZone(lx, ly);
    this.look = deadZone(rx, ry);
    this.running = RUN_BUTTONS.some(index => pressed(pad.buttons[index]));
    for (const [index, code] of Object.entries(BUTTON_KEYS)) {
      const down = pressed(pad.buttons[index]);
      const id = `${index}:${code}`;
      if (down && !this._held.has(id)) {
        this._held.add(id);
        this._key('keydown', code);
      } else if (!down && this._held.has(id)) {
        this._held.delete(id);
        this._key('keyup', code);
      }
    }
  }

  _release() {
    for (const id of this._held) this._key('keyup', id.split(':')[1]);
    this._held.clear();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.running = false;
  }

  _key(type, code) {
    const key = KEY_NAMES[code] ?? code.replace(/^Key/, '').toLowerCase();
    const event = new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true });
    (document.body ?? window).dispatchEvent(event);
  }
}
