// src/ui/ObjectiveTracker.js
// El objetivo actual, en un cartón debajo de la tira de arriba a la izquierda. Solo reescribe la página cuando
// cambia el texto o el avance. Si el objetivo tiene lugar, una cinta (o la tecla Y) marca la ruta en el GPS.
import { cop } from '../utils/money.js';

export const TECLA_RUTA = 'KeyY';

export class ObjectiveTracker {
  constructor({ onRoute } = {}) {
    this.onRoute = onRoute;
    this._key = null;
    const doc = globalThis.document;
    if (!doc?.createElement) return;
    this.root = doc.createElement('div');
    this.root.id = 'objetivo';
    this.root.className = 'carton corte-c';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => {
      const boton = e.target?.closest?.('.objetivo__ruta');
      if (!boton) return;
      this.onRoute?.();
      boton.blur?.();
    });
    (doc.getElementById('app') ?? doc.body)?.appendChild(this.root);
  }

  /**
   * @param {object|null} def objetivo actual (null cuando terminó la cadena)
   * @param {{value:number, goal:number}} progress
   * @param {number} index posición (0…total)
   * @param {number} total
   */
  render(def, progress, index, total) {
    if (!this.root) return;
    const fmt = (v) => def?.money ? cop(v) : String(Math.floor(v));
    const key = def ? `${def.id}|${fmt(progress.value)}|${progress.goal}` : 'fin';
    if (key === this._key) return;
    this._key = key;
    if (!def) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    const pct = Math.round(100 * progress.value / progress.goal);
    this.root.innerHTML =
      `<span class="objetivo__cuenta">Objetivo ${index + 1} de ${total}</span>`
      + `<strong class="objetivo__titulo">${escapeHTML(def.title)}</strong>`
      + `<span class="objetivo__pista fino">${escapeHTML(def.hint)}</span>`
      + (progress.goal > 1
        ? `<span class="objetivo__avance"><span class="objetivo__barra"><i class="masa" style="width:${pct}%"></i></span>`
          + `<span class="cifra">${fmt(progress.value)} de ${fmt(progress.goal)}</span></span>`
        : '')
      + (def.target ? '<button type="button" class="cinta objetivo__ruta"><kbd>Y</kbd> Marcar ruta</button>' : '');
  }
}

function escapeHTML(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
