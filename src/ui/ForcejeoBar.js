// src/ui/ForcejeoBar.js
// Barra del forcejeo por la zorra. No toca el DOM hasta el primer `mostrar`.

import { TEXTOS_ZORRA } from '../data/zorra.js';

export class ForcejeoBar {
  constructor(parent = document.body) {
    this.parent = parent;
    this.el = null;
    this.relleno = null;
  }

  _crear() {
    const el = document.createElement('div');
    el.id = 'forcejeo-bar';
    const ayuda = document.createElement('div');
    ayuda.className = 'forcejeo-ayuda';
    ayuda.textContent = TEXTOS_ZORRA.ayudaForcejeo;
    const pista = document.createElement('div');
    pista.className = 'forcejeo-pista';
    this.relleno = document.createElement('div');
    this.relleno.className = 'forcejeo-relleno';
    pista.appendChild(this.relleno);
    el.append(ayuda, pista);
    this.parent.appendChild(el);
    this.el = el;
  }

  /** @param {number} barra 0..1 */
  mostrar(barra) {
    if (!this.el) this._crear();
    const p = Math.max(0, Math.min(1, barra));
    this.relleno.style.width = `${(p * 100).toFixed(1)}%`;
    this.el.classList.add('active');
  }

  ocultar() {
    this.el?.classList.remove('active');
  }
}
