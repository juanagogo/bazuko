// src/core/Input.js
import { GamepadInput } from './Gamepad.js';

export class Input {
  constructor() {
    this.keys = {};
    this._gamepadKeys = {};
    this.pressedThisFrame = new Set();
    this.gamepad = new GamepadInput();

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

      window.addEventListener('mousedown', (e) => {
        if (this.locked) return;
        if (e.target?.closest?.('input, textarea, select, button, [contenteditable="true"], .menu, .creator, #hud, #topbar, #controls-help')) return;
        if (e.button === 0) {
          this.pressedThisFrame.add('Mouse0');
        }
      });

      window.addEventListener('blur', () => {
        this.keys = {};
        this._gamepadKeys = {};
        this.pressedThisFrame.clear();
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
    return { x: stick.x, z: stick.y };
  }

  /** Stick derecho del mando, para girar la cámara. */
  get look() {
    return this.locked ? { x: 0, y: 0 } : this.gamepad.look;
  }

  get isRunning() {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight') || (!this.locked && this.gamepad.running);
  }
}
