// src/systems/ObjectiveSystem.js
// Lleva el objetivo actual de la cadena de primera hora. No depende del DOM ni
// de Three.js: el juego le pasa su estado en `update(game)` y los eventos en `notify`.
import { OBJECTIVES } from '../data/objectives.js';

export class ObjectiveSystem {
  constructor(defs = OBJECTIVES) {
    this.defs = defs;
    this.index = 0;
    this.counter = 0;   // eventos contados para el objetivo actual
    this.completed = [];
  }

  get current() { return this.defs[this.index] ?? null; }
  get finished() { return this.index >= this.defs.length; }
  get total() { return this.defs.length; }

  /** Cuenta un evento del juego si corresponde al objetivo actual. */
  notify(name, detail) {
    const def = this.current;
    if (!def?.event || def.event !== name) return false;
    if (def.accept && !def.accept(detail)) return false;
    this.counter++;
    return true;
  }

  /** Avance del objetivo actual como { value, goal }; goal 1 para los de sí/no. */
  progress(game) {
    const def = this.current;
    if (!def) return { value: 0, goal: 1 };
    const goal = def.goal ?? 1;
    let value = def.progress ? def.progress(game) : def.event ? this.counter : 0;
    if (this._isDone(def, game)) value = goal;
    return { value: Math.max(0, Math.min(goal, Number(value) || 0)), goal };
  }

  _isDone(def, game) {
    const goal = def.goal ?? 1;
    if (def.done?.(game)) return true;
    if (def.progress && def.progress(game) >= goal) return true;
    if (def.event && this.counter >= goal) return true;
    return false;
  }

  _advance(def) {
    this.completed.push(def.id);
    this.index++;
    this.counter = 0;
  }

  /**
   * Revisa el objetivo actual y avanza como mucho uno por llamada para que cada
   * logro tenga su aviso. Devuelve el objetivo cumplido o null.
   */
  update(game) {
    const def = this.current;
    if (!def || !this._isDone(def, game)) return null;
    this._advance(def);
    return def;
  }

  /**
   * Partidas guardadas antes de los objetivos: salta en silencio los que el
   * estado ya cumple, sin entregar recompensas. Devuelve cuántos saltó.
   */
  catchUp(game) {
    let skipped = 0;
    while (this.current && this._isDone(this.current, game)) {
      this._advance(this.current);
      skipped++;
    }
    return skipped;
  }

  serialize() {
    return { index: this.index, counter: this.counter, completed: [...this.completed] };
  }

  /**
   * Acepta el estado guardado; los ids pesan más que el índice si la lista cambia. Sin datos vuelve al primero, para
   * que `catchUp` ponga al día una partida o un archivo de antes de los objetivos desde el principio.
   */
  deserialize(data) {
    if (!data || typeof data !== 'object') {
      this.index = 0;
      this.counter = 0;
      this.completed = [];
      return false;
    }
    const known = new Set(this.defs.map(d => d.id));
    const completed = Array.isArray(data.completed) ? data.completed.filter(id => known.has(id)) : null;
    if (completed) {
      this.completed = completed;
      const done = new Set(completed);
      const next = this.defs.findIndex(d => !done.has(d.id));
      this.index = next === -1 ? this.defs.length : next;
    } else if (Number.isInteger(data.index)) {
      this.index = Math.max(0, Math.min(this.defs.length, data.index));
      this.completed = this.defs.slice(0, this.index).map(d => d.id);
    }
    this.counter = Number.isInteger(data.counter) && data.counter > 0 ? data.counter : 0;
    return true;
  }
}
