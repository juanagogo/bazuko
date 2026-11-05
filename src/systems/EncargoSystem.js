// src/systems/EncargoSystem.js
// Un encargo a la vez cuando ya terminó la cadena de la primera hora. Reutiliza ObjectiveSystem para contar eventos y
// medir el avance; aquí solo se elige el siguiente, se lleva la racha y se guarda. No depende del DOM ni de Three.js.
import { ObjectiveSystem } from './ObjectiveSystem.js';
import { ENCARGOS, TIPOS_DE_ENCARGO, pagoDeEncargo } from '../data/encargos.js';

export class EncargoSystem {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.state = null;   // { tipo, n, base }
    this.racha = 0;      // encargos cumplidos en total
    this._obj = null;
    this.ultimo = null;  // tipo del último cumplido: el siguiente no lo repite
  }

  /** El encargo actual, con los campos de un objetivo; null si todavía no hay. */
  get current() { return this._obj?.current ?? null; }

  /** Lo que da el contador base de un tipo al empezar: lo ya tenido no cuenta. */
  _base(tipo, game) {
    if (tipo === 'latas') return game.inventory?.count?.('lata') ?? 0;
    if (tipo === 'botellas') return game.inventory?.count?.('botella') ?? 0;
    if (tipo === 'ahorrar') return game.stats?.dinero ?? 0;
    return 0;
  }

  _build() {
    const plantilla = ENCARGOS[this.state?.tipo];
    if (!plantilla) { this._obj = null; return; }
    const { n, base, tipo } = this.state;
    const def = {
      id: `encargo-${this.racha + 1}-${tipo}`,
      ...plantilla.hacer(n, base),
      reward: { dinero: pagoDeEncargo(plantilla.pago, this.racha), xp: plantilla.xp },
    };
    this._obj = new ObjectiveSystem([def]);
  }

  /** Elige el siguiente, distinto del anterior, y cuenta desde el estado actual del juego. */
  next(game) {
    const previo = this.state?.tipo ?? this.ultimo;
    const tipos = TIPOS_DE_ENCARGO.filter((t) => t !== previo);
    const tipo = tipos[Math.floor(this.random() * tipos.length) % tipos.length];
    const { rango: [min, max], paso = 1 } = ENCARGOS[tipo];
    const pasos = Math.floor((max - min) / paso);
    // Con la racha suben un poco las cantidades, sin pasar del máximo.
    const extra = Math.min(pasos, Math.floor(this.racha / 3));
    const n = Math.min(max, min + paso * (extra + Math.floor(this.random() * (pasos - extra + 1))));
    this.state = { tipo, n, base: this._base(tipo, game) };
    this._build();
    return this.current;
  }

  notify(name, detail) { return this._obj?.notify(name, detail) ?? false; }

  progress(game) { return this._obj?.progress(game) ?? { value: 0, goal: 1 }; }

  /** Devuelve el encargo cumplido (con su recompensa) o null; el siguiente lo pide el juego con `next`. */
  update(game) {
    const done = this._obj?.update(game) ?? null;
    if (!done) return null;
    this.racha++;
    this.ultimo = this.state?.tipo ?? null;
    this.state = null;
    this._obj = null;
    return done;
  }

  serialize() {
    return { state: this.state ? { ...this.state } : null, racha: this.racha, ultimo: this.ultimo, counter: this._obj?.counter ?? 0 };
  }

  deserialize(data) {
    if (!data || typeof data !== 'object') return false;
    this.racha = Number.isInteger(data.racha) && data.racha > 0 ? data.racha : 0;
    this.ultimo = ENCARGOS[data.ultimo] ? data.ultimo : null;
    const s = data.state;
    if (s && ENCARGOS[s.tipo] && Number.isFinite(s.n) && s.n > 0 && Number.isFinite(s.base)) {
      this.state = { tipo: s.tipo, n: s.n, base: s.base };
      this._build();
      if (Number.isInteger(data.counter) && data.counter > 0) this._obj.counter = data.counter;
    } else {
      this.state = null;
      this._obj = null;
    }
    return true;
  }
}
