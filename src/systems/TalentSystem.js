// src/systems/TalentSystem.js
import { TALENTS } from '../data/talents.js';

export class TalentSystem {
  constructor() {
    this.points = 0;
    this.unlocked = {}; // { talentId: true }
  }

  /** Devuelve el objeto de talento por id */
  get(id) { return TALENTS[id]; }

  /** ¿Está desbloqueado? */
  has(id) { return !!this.unlocked[id]; }

  /** ¿Se puede desbloquear (puntos + requisitos)? */
  canUnlock(id) {
    const t = TALENTS[id];
    if (!t) return false;
    if (this.has(id)) return false;
    if (this.points < t.cost) return false;
    return t.requires.every((r) => this.has(r));
  }

  unlock(id) {
    if (!this.canUnlock(id)) return false;
    this.points -= TALENTS[id].cost;
    this.unlocked[id] = true;
    window.dispatchEvent(new CustomEvent('talent-unlock', {
      detail: { name: TALENTS[id].name }
    }));
    return true;
  }

  addPoints(n) { this.points += n; }

  /**
   * Devuelve el valor acumulado de un efecto entre todos los
   * talentos desbloqueados. Multiplica todos los multiplicadores.
   */
  getEffect(effectKey, base = 1) {
    let val = base;
    for (const id of Object.keys(this.unlocked)) {
      const eff = TALENTS[id]?.effects?.[effectKey];
      if (eff !== undefined) {
        // diseaseResist conserva su nombre en el catálogo, pero también es un multiplicador.
        if (effectKey.includes('Mult') || effectKey === 'diseaseResist') val *= eff;
        else val += eff;
      }
    }
    return val;
  }

  serialize() {
    return { points: this.points, unlocked: this.unlocked };
  }

  deserialize(d) {
    this.points = d?.points ?? 0;
    this.unlocked = d?.unlocked ?? {};
  }
}
