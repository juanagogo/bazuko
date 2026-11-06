// src/ui/burbujaVoz.js
// El subtítulo de quien habla sin ser un peatón: la patrulla (gritos, megáfono, radio y arresto), el jíbaro, el
// voceador del bus y los conductores. Usa la misma burbuja y el mismo reparto de frases.js que la gente: cada
// fuente tiene un Hablante que se hace pasar por peatón (posición, burbuja y medidas) mientras dura lo que dice.
import * as THREE from 'three';
import { acabarFrase, empezarFrase } from './frases.js';

export const BURBUJAS = Object.freeze({ maximo: 3, minimoS: 1.5, despuesS: .4 });

/** Un sitio que habla. `source.position` se copia en cada cuadro, subida `offsetY` (el bus es alto). */
export class Hablante {
  constructor(source, { offsetY = 0, doc = globalThis.document } = {}) {
    this.source = source;
    this.offsetY = offsetY;
    this.doc = doc;
    this.position = new THREE.Vector3();
    this._projPos = new THREE.Vector3();
    this._bubbleEl = null;
    this._fraseW = 0; this._fraseH = 0; this._fraseVista = 'no';
    this.tiempo = 0;
    this._seguir();
  }

  get hablando() { return !!this._bubbleEl; }

  _seguir() {
    const p = this.source?.position;
    if (p) this.position.set(p.x, p.y + this.offsetY, p.z);
  }

  /** Muestra `text` durante `seconds`; lo nuevo reemplaza lo que estuviera diciendo. */
  decir(text, seconds) {
    const doc = this.doc;
    if (!text || !doc?.createElement) return false;
    this.callar();
    const container = doc.getElementById?.('npc-bubbles-container') ?? doc.body;
    if (!container) return false;
    const el = doc.createElement('div');
    el.className = 'npc-bubble';
    el.textContent = text;
    container.appendChild(el);
    this._bubbleEl = el;
    this._fraseW = el.offsetWidth ?? 0;
    this._fraseH = el.offsetHeight ?? 0;
    this._fraseVista = 'no';
    if (el.style) el.style.display = 'none';
    this.tiempo = Math.max(BURBUJAS.minimoS, seconds || 0);
    this._seguir();
    empezarFrase(this);
    return true;
  }

  update(dt) {
    if (!this._bubbleEl) return;
    this._seguir();
    if ((this.tiempo -= dt) <= 0) this.callar();
  }

  callar() {
    if (!this._bubbleEl) return;
    this._bubbleEl.remove?.();
    this._bubbleEl = null;
    acabarFrase(this);
  }
}

/** Los subtítulos vivos: uno por fuente y como mucho `BURBUJAS.maximo`; si sobra uno, se va el más viejo. */
export class Burbujas {
  constructor({ doc = globalThis.document } = {}) {
    this.doc = doc;
    this._de = new WeakMap();   // fuente → Hablante
    this._vivos = [];
  }

  get vivos() { return this._vivos.length; }

  decir(source, text, seconds, { offsetY = 0 } = {}) {
    if (!source?.position || !text) return false;
    let hablante = this._de.get(source);
    if (!hablante) { hablante = new Hablante(source, { offsetY, doc: this.doc }); this._de.set(source, hablante); }
    hablante.offsetY = offsetY;
    if (!hablante.decir(text, seconds + BURBUJAS.despuesS)) return false;
    const index = this._vivos.indexOf(hablante);
    if (index >= 0) this._vivos.splice(index, 1);
    this._vivos.push(hablante);
    while (this._vivos.length > BURBUJAS.maximo) this._vivos.shift().callar();
    return true;
  }

  update(dt) {
    for (let i = this._vivos.length - 1; i >= 0; i--) {
      const hablante = this._vivos[i];
      hablante.update(dt);
      if (!hablante.hablando) this._vivos.splice(i, 1);
    }
  }

  clear() { for (const hablante of this._vivos) hablante.callar(); this._vivos.length = 0; }
}
