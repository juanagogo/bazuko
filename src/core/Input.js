// src/core/Input.js

export class Input {
  constructor() {
    this.keys = {};
    this.pressedThisFrame = new Set();

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (e.code?.startsWith?.('Arrow') || e.code === 'Space') e.preventDefault?.();
        if (!this.keys[e.code]) this.pressedThisFrame.add(e.code);
        if (e.code === 'Space') this.pressedThisFrame.add('KeySpace');
        this.keys[e.code] = true;
      });

      window.addEventListener('keyup', (e) => {
        this.keys[e.code] = false;
        if (e.code === 'Space') this.keys['KeySpace'] = false;
      });

      window.addEventListener('mousedown', (e) => {
        if (e.target?.closest?.('input, textarea, select, button, [contenteditable="true"], .menu, .creator, #hud, #topbar, #controls-help')) return;
        if (e.button === 0) {
          this.pressedThisFrame.add('Mouse0');
        }
      });

      window.addEventListener('blur', () => {
        this.keys = {};
        this.pressedThisFrame.clear();
      });
    }
  }

  isDown(code) {
    return !!this.keys[code];
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
    return {
      x: (this.isDown('KeyD') ? 1 : 0) - (this.isDown('KeyA') ? 1 : 0),
      z: (this.isDown('KeyS') ? 1 : 0) - (this.isDown('KeyW') ? 1 : 0)
    };
  }

  get isRunning() {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight');
  }
}
