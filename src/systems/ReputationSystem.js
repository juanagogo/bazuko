// src/systems/ReputationSystem.js
// Lo que el barrio piensa del jugador, de -100 (le tienen miedo) a 100 (lo quieren). Sube con trabajo honrado y
// encargos; baja con robos, peleas y capturas. No es moral: cambia cómo responde la calle.
//  - Testigos: con buena fama llaman menos a la Policía; con mala, casi siempre.
//  - «Te tienen fichado» se enfría antes con buena fama y tarda más con mala.
//  - La limosna rinde más si lo quieren y menos si le tienen miedo.
//  - El cosquilleo se nota más cuando lo tienen en la mira.

export const FAMA_MIN = -100;
export const FAMA_MAX = 100;

/** Cuánto mueve cada cosa. Los golpes de una pelea cuentan una vez cada `peleaCada` segundos. */
export const FAMA = {
  vender: 1, fabricar: 1, encargo: 4, limosna: 0,
  retrovisor: -2, retrovisorPillado: -3, roboDirecto: -5, cosquilleoPillado: -4, robarALosSuyos: -2,
  pelea: -2, peleaCada: 6, carro: -4, llamada: -3, arresto: -6,
};

/** Los peldaños, de peor a mejor, con lo que se dice en el barrio. */
export const PELDANOS = [
  { desde: -100, id: 'temido', label: 'Me tienen miedo' },
  { desde: -50, id: 'malvisto', label: 'Me miran mal' },
  { desde: -20, id: 'nadie', label: 'Nadie me conoce' },
  { desde: 20, id: 'conocido', label: 'Ya me conocen' },
  { desde: 50, id: 'querido', label: 'Me quieren' },
];

export function peldanoDe(valor) {
  let p = PELDANOS[0];
  for (const x of PELDANOS) if (valor >= x.desde) p = x;
  return p;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class ReputationSystem {
  constructor({ target = typeof window !== 'undefined' ? window : null } = {}) {
    this.valor = 0;
    this._peleaS = 0;
    this._target = target;
    this._handlers = [];
    if (target?.addEventListener) {
      const on = (name, fn) => { target.addEventListener(name, fn); this._handlers.push([name, fn]); };
      on('sell', () => this.sumar(FAMA.vender));
      on('craft', () => this.sumar(FAMA.fabricar));
      on('steal', (e) => this.sumar(e?.detail?.caught ? FAMA.retrovisorPillado : FAMA.retrovisor));
      on('carjack', () => this.sumar(FAMA.carro));
      on('witness-call', () => this.sumar(FAMA.llamada));
      on('police-arrest', () => this.sumar(FAMA.arresto));
      on('street-fight', () => { if (this._peleaS <= 0) { this._peleaS = FAMA.peleaCada; this.sumar(FAMA.pelea); } });
      on('robo-peaton', (e) => this.sumar((e?.detail?.directo ? FAMA.roboDirecto : FAMA.cosquilleoPillado) + (e?.detail?.deLosSuyos ? FAMA.robarALosSuyos : 0)));
      on('encargo-cumplido', () => this.sumar(FAMA.encargo));
    }
  }

  /** De -1 a 1: lo que usan los demás sistemas para escalar su efecto. */
  get factor() { return this.valor / FAMA_MAX; }

  get peldano() { return peldanoDe(this.valor); }

  sumar(delta) {
    if (!Number.isFinite(delta) || delta === 0) return this.valor;
    const antes = this.peldano;
    this.valor = clamp(this.valor + delta, FAMA_MIN, FAMA_MAX);
    const ahora = this.peldano;
    if (ahora !== antes && this._target?.dispatchEvent && typeof CustomEvent !== 'undefined') {
      const mejor = ahora.desde > antes.desde;
      this._target.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `En el barrio: ${ahora.label.toLowerCase()}`, type: mejor ? 'rare' : 'warn' },
      }));
      this._target.dispatchEvent(new CustomEvent('fama', { detail: { valor: this.valor, peldano: ahora.id } }));
    }
    return this.valor;
  }

  update(dt) { if (this._peleaS > 0) this._peleaS = Math.max(0, this._peleaS - dt); }

  /** Probabilidad de que un testigo llame: de la mitad (lo quieren) a casi siempre (le tienen miedo). */
  probabilidadDeLlamar(base) { return clamp(base * (1 - .45 * this.factor), .2, 1); }

  /** Segundos para que baje un nivel de fichado. */
  segundosDeCalma(base) { return base * (1 - .3 * this.factor); }

  /** Lo que rinde la limosna. */
  get multiplicadorLimosna() { return 1 + .4 * this.factor; }

  /** Lo que se suma a la probabilidad de que noten el cosquilleo. */
  get alertaExtra() { return -.15 * this.factor; }

  serialize() { return { valor: this.valor }; }

  deserialize(data) {
    const v = Number(data?.valor);
    this.valor = Number.isFinite(v) ? clamp(v, FAMA_MIN, FAMA_MAX) : 0;
    return true;
  }

  dispose() {
    for (const [name, fn] of this._handlers) this._target?.removeEventListener?.(name, fn);
    this._handlers.length = 0;
  }
}
