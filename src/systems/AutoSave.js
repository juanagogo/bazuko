// src/systems/AutoSave.js
// Guardado solo: cada minuto de reloj y en el último momento, cuando la pestaña se esconde o se va a
// cerrar. `puede` decide los momentos que no son firmes (cargando, en el creador, preso, muerto,
// dormido).

export const AUTO_SAVE_SECONDS = 60;
const CADA_MS = AUTO_SAVE_SECONDS * 1000;

export class AutoSave {
  constructor({ guardar, puede }) {
    this.guardar = guardar;
    this.puede = puede;
    this._proximo = null;
  }

  /** Se llama desde el bucle con el reloj de rAF: guarda cuando pasa el intervalo. */
  update(now) {
    if (this._proximo === null) { this._proximo = now + CADA_MS; return false; }
    if (now < this._proximo) return false;
    this._proximo = now + CADA_MS;
    return this.guardarAhora();
  }

  /** Guarda ya, si el momento lo permite. Devuelve si guardó. */
  guardarAhora() { return this.puede() && this.guardar() !== false; }

  /** Escucha la pestaña. Devuelve la función que lo suelta. */
  enganchar() {
    const escondida = () => { if (globalThis.document?.hidden) this.guardarAhora(); };
    const cerrar = () => this.guardarAhora();
    globalThis.document?.addEventListener?.('visibilitychange', escondida);
    globalThis.window?.addEventListener?.('pagehide', cerrar);
    return () => {
      globalThis.document?.removeEventListener?.('visibilitychange', escondida);
      globalThis.window?.removeEventListener?.('pagehide', cerrar);
    };
  }
}
