// src/systems/DiseaseSystem.js
import {
  DISEASE_BASE_CHANCE,
  DISEASE_SORT_MULT,
  DISEASE_DIRTY_SLEEP_CHANCE,
  STAT_THRESHOLDS
} from '../utils/constants.js';
import { DISEASES } from '../data/diseases.js';

const fromSource = (fuente) => Object.values(DISEASES).filter((d) => d.fuente === fuente).map((d) => d.id);
const TRASH = fromSource('basura');
const TRASH_AND_CUTS = [...TRASH, ...fromSource('corte')];

export class DiseaseSystem {
  constructor() {
    this.active = {}; // { id: { timeLeft } }
  }

  get hasAny() { return Object.keys(this.active).length > 0; }

  get list() {
    return Object.entries(this.active).map(([id, d]) => ({
      ...DISEASES[id],
      timeLeft: d.timeLeft
    }));
  }

  /**
   * Intenta infectar al jugador al recoger basura.
   * @param {boolean} sorted - si se seleccionó la basura (más riesgo)
   * @param {number} resistanceMult - mult de resistencia (talentos)
   * @param {{ cut?: boolean }} [options] - `cut`: la bolsa traía metal (latas, chatarra) y hay riesgo de tétanos
   * @returns {object|null} enfermedad contraída o null
   */
  tryInfect(sorted = false, resistanceMult = 1, { cut = false } = {}) {
    let chance = DISEASE_BASE_CHANCE;
    if (sorted) chance *= DISEASE_SORT_MULT;
    chance *= resistanceMult;

    if (Math.random() > chance) return null;

    const ids = cut ? TRASH_AND_CUTS : TRASH;
    return this._contract(ids[Math.floor(Math.random() * ids.length)]);
  }

  /**
   * Dormir sucio (higiene por debajo del umbral de enfermedad) puede pegar sarna.
   * @returns {object|null} enfermedad contraída o null
   */
  tryInfectWhileSleeping(higiene, resistanceMult = 1) {
    if (higiene >= STAT_THRESHOLDS.higieneEnfermedad) return null;
    if (Math.random() > DISEASE_DIRTY_SLEEP_CHANCE * resistanceMult) return null;
    return this._contract('sarna');
  }

  _contract(id) {
    // No apilar la misma enfermedad
    if (this.active[id]) {
      this.active[id].timeLeft = DISEASES[id].duration;
      return null;
    }

    this.active[id] = { timeLeft: DISEASES[id].duration };
    window.dispatchEvent(new CustomEvent('disease', {
      detail: { name: DISEASES[id].name, emoji: DISEASES[id].emoji }
    }));
    return DISEASES[id];
  }

  /** Cura todas las enfermedades (al despertar en el hospital) */
  cureAll() {
    this.active = {};
  }

  /** Cura una enfermedad específica. Devuelve si el jugador la tenía. */
  cure(id) {
    if (!this.active[id]) return false;
    delete this.active[id];
    return true;
  }

  update(dt) {
    for (const id of Object.keys(this.active)) {
      this.active[id].timeLeft -= dt;
      if (this.active[id].timeLeft <= 0) {
        delete this.active[id];
        window.dispatchEvent(new CustomEvent('disease-cured', {
          detail: { name: DISEASES[id]?.name ?? id }
        }));
      }
    }
  }

  /** Drenaje total de salud por segundo */
  get healthDrain() {
    return Object.entries(this.active).reduce(
      (s, [id]) => s + (DISEASES[id]?.healthDrain ?? 0), 0
    );
  }

  /** Drenaje total de salud mental por segundo */
  get mentalDrain() {
    return Object.entries(this.active).reduce(
      (s, [id]) => s + (DISEASES[id]?.mentalDrain ?? 0), 0
    );
  }

  /** Efectos agregados de todas las enfermedades activas */
  getAggregatedEffects() {
    let healthDrain = 0;
    let mentalDrain = 0;
    let speedMultiplier = 1;
    let hungerDrainMultiplier = 1;
    let energyDrainMultiplier = 1;
    let hygieneDrain = 0;
    let canEat = true;

    for (const id of Object.keys(this.active)) {
      const def = DISEASES[id];
      if (!def) continue;
      healthDrain += def.healthDrain ?? 0;
      mentalDrain += def.mentalDrain ?? 0;
      if (def.speedMultiplier) speedMultiplier *= def.speedMultiplier;
      if (def.hungerDrainMultiplier) hungerDrainMultiplier *= def.hungerDrainMultiplier;
      if (def.energyDrainMultiplier) energyDrainMultiplier *= def.energyDrainMultiplier;
      if (def.hygieneDrain) hygieneDrain += def.hygieneDrain;
      if (def.canEat === false) canEat = false;
    }

    return {
      healthDrain: healthDrain || this.healthDrain,
      mentalDrain: mentalDrain || this.mentalDrain,
      speedMultiplier,
      hungerDrainMultiplier,
      energyDrainMultiplier,
      hygieneDrain,
      canEat
    };
  }

  serialize() { return { active: this.active }; }

  deserialize(d) {
    const active = { ...(d?.active ?? {}) };
    // Las partidas anteriores guardaban la intoxicación con su id en inglés.
    if (active.intoxication) active.intoxicacion ??= active.intoxication;
    delete active.intoxication;
    this.active = active;
  }
}
