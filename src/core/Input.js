// src/core/Input.js

export class Input {
  constructor() {
    this.keys = {};
    this.pressedThisFrame = new Set();
    this._locked = false; // true mientras un overlay (inventario) captura el teclado

    // Teclas cuyo comportamiento por defecto (scroll de página) se bloquea
    const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

    window.addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!this.keys[e.code]) this.pressedThisFrame.add(e.code);
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      this.keys[e.code] = false;
    });

    // Evita teclas "pegadas" al perder el foco
    const clear = () => { this.keys = {}; this.pressedThisFrame.clear(); };
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  }

  /** Bloquea/desbloquea el input de juego (las teclas se siguen registrando) */
  get locked() { return this._locked; }
  set locked(v) {
    this._locked = !!v;
    this.pressedThisFrame.clear();
  }

  isDown(code) {
    return !this._locked && !!this.keys[code];
  }

  /**
   * Devuelve true UNA sola vez por pulsación.
   * Útil para interactuar (evita spam al mantener la tecla).
   */
  consumePress(code) {
    if (this._locked) return false;
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

  /** Acción lógica activa si cualquiera de sus teclas está pulsada */
  get forward() { return this.isDown('KeyW') || this.isDown('ArrowUp'); }
  get backward() { return this.isDown('KeyS') || this.isDown('ArrowDown'); }
  get left() { return this.isDown('KeyA') || this.isDown('ArrowLeft'); }
  get right() { return this.isDown('KeyD') || this.isDown('ArrowRight'); }

  get axis() {
    // Objeto reutilizado (se lee varias veces por frame): no guardar la referencia
    const a = this._axis || (this._axis = { x: 0, z: 0 });
    a.x = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    a.z = (this.backward ? 1 : 0) - (this.forward ? 1 : 0);
    return a;
  }

  get isRunning() {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight');
  }
}