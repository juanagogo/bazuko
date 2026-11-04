// src/core/Input.js
import { GamepadInput } from './Gamepad.js';

const TOQUE_RECIENTE_MS = 800;

export class Input {
  constructor() {
    this.keys = {};
    this._gamepadKeys = {};
    this.pressedThisFrame = new Set();
    this.gamepad = new GamepadInput();
    this.touch = { move: { x: 0, y: 0 }, running: false }; // lo escribe TouchControls
    this._ultimoToque = -Infinity;

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (this.locked) return;
        if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (e.code?.startsWith?.('Arrow') || e.code === 'Space') e.preventDefault?.();
        const keys = e.gamepadInput ? this._gamepadKeys : this.keys;
        if (!this.isDown(e.code)) this.pressedThisFrame.add(e.code);
        if (e.code === 'Space') this.pressedThisFrame.add('KeySpace');
        keys[e.code] = true;
      });

      window.addEventListener('keyup', (e) => {
        const keys = e.gamepadInput ? this._gamepadKeys : this.keys;
        keys[e.code] = false;
        if (e.code === 'Space') keys['KeySpace'] = false;
        if (e.gamepadReset && !this.keys[e.code]) {
          this.pressedThisFrame.delete(e.code);
          if (e.code === 'Space') this.pressedThisFrame.delete('KeySpace');
        }
      });

      // Tras un toque el navegador manda un clic de ratón de cortesía: no es un golpe.
      const toque = (e) => { if (e.pointerType === 'touch' || e.pointerType === 'pen') this._ultimoToque = performance.now(); };
      window.addEventListener('pointerdown', toque, true);
      window.addEventListener('pointerup', toque, true);

      window.addEventListener('mousedown', (e) => {
        if (this.locked) return;
        if (performance.now() - this._ultimoToque < TOQUE_RECIENTE_MS) return;
        if (e.target?.closest?.('input, textarea, select, button, [contenteditable="true"], .menu, .creator, #hud, #topbar, #controls-help, #quickbar')) return;
        if (e.button === 0) {
          this.pressedThisFrame.add('Mouse0');
        }
      });

      window.addEventListener('blur', () => {
        this.keys = {};
        this._gamepadKeys = {};
        this.pressedThisFrame.clear();
        this.touch.move.x = 0;
        this.touch.move.y = 0;
        this.touch.running = false;
      });
    }
  }

  isDown(code) {
    return !this.locked && !!(this.keys[code] || this._gamepadKeys[code]);
  }

  /**
   * Devuelve true UNA sola vez por pulsación.
   * Útil para interactuar (evita spam al mantener la tecla).
   */
  consumePress(code) {
    if (this.pressedThisFrame.has(code)) {
      this.pressedThisFrame.delete(code);
      return true;
    }
    return false;
  }

  /** Llamar al FINAL del frame en Game.js */
  endFrame() {
    this.pressedThisFrame.clear();
  }

  get axis() {
    const x = (this.isDown('KeyD') ? 1 : 0) - (this.isDown('KeyA') ? 1 : 0);
    const z = (this.isDown('KeyS') ? 1 : 0) - (this.isDown('KeyW') ? 1 : 0);
    // El stick izquierdo solo cuenta si el teclado no está moviendo al personaje.
    const stick = this.locked ? null : this.gamepad.move;
    if ((x || z) || !stick) return { x, z };
    // La palanca del dedo cuenta si el mando tampoco lo está moviendo.
    const dedo = this.touch.move;
    if (!stick.x && !stick.y && (dedo.x || dedo.y)) return { x: dedo.x, z: dedo.y };
    return { x: stick.x, z: stick.y };
  }

  /** La palanca del dedo es la que está moviendo: su arriba es el arriba de la pantalla, sea cual sea la cámara. */
  get palancaManda() {
    const dedo = this.touch.move, { x, z } = this.axis;
    return !this.locked && (dedo.x !== 0 || dedo.y !== 0) && x === dedo.x && z === dedo.y;
  }

  /** Stick derecho del mando, para girar la cámara. */
  get look() {
    return this.locked ? { x: 0, y: 0 } : this.gamepad.look;
  }

  get isRunning() {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight') || (!this.locked && (this.gamepad.running || this.touch.running));
  }
}
