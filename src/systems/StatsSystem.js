// src/systems/StatsSystem.js
import { DECAY, MENTAL_DECAY_NIGHT, STAT_THRESHOLDS, SURVIVAL_DAMAGE, WITHDRAWAL, XP_PER_LEVEL } from '../utils/constants.js';

/** Necesidades del jugador (0-100, 100 = satisfecha) */
export const NEEDS = ['hambre', 'sed', 'energia', 'salud', 'higiene', 'animo', 'vicio'];

export class StatsSystem {
  constructor() {
    this.hambre  = 100;
    this.sed     = 100;
    this.energia = 100;
    this.salud   = 100;
    this.higiene = 100;   // NUEVA
    this.animo   = 100;   // NUEVA
    this.vicio   = 80;    // ansiedad por consumir: si se vacía, abstinencia
    this.dinero  = 0;     // pesos colombianos
    this.xp      = 0;
    this.level   = 1;
    this.calor   = 0;     // segundos de calor corporal / protección contra el frío
    this.isFreezing = false;

    this.diseaseSystem = null;
  }

  get saludMental() {
    return this.animo;
  }

  set saludMental(v) {
    this.animo = v;
  }

  /** Abstinencia: el vicio está por debajo del umbral */
  get inWithdrawal() {
    return this.vicio < STAT_THRESHOLDS.vicioAbstinencia;
  }

  /**
   * Nivel de abstinencia (0 a 100).
   * 0 si vicio >= 20. Conforme vicio baja de 20 a 0, abstinencia sube de 0 a 100.
   */
  get abstinencia() {
    if (this.vicio >= STAT_THRESHOLDS.vicioAbstinencia) return 0;
    return Math.round(((STAT_THRESHOLDS.vicioAbstinencia - this.vicio) / STAT_THRESHOLDS.vicioAbstinencia) * 100);
  }

  /** Abstinencia alta: genera alucinaciones y paranoia */
  get isHighWithdrawal() {
    return this.abstinencia >= (STAT_THRESHOLDS.abstinenciaAlta ?? 50);
  }

  /** Abstinencia crítica: genera psicosis inducida y problemas motores severos */
  get isCriticalWithdrawal() {
    return this.abstinencia >= (STAT_THRESHOLDS.abstinenciaCritica ?? 80);
  }

  setDiseaseSystem(ds) {
    this.diseaseSystem = ds;
  }

  update(dt, player, diseaseSystem = null, clock = null, talentSystem = null, weather = null) {
    if (diseaseSystem) this.diseaseSystem = diseaseSystem;
    const ds = diseaseSystem ?? this.diseaseSystem;
    // ===== Efectos agregados de enfermedades =====
    const fx = (typeof ds?.getAggregatedEffects === 'function' ? ds.getAggregatedEffects() : null) ?? {
      healthDrain: ds?.healthDrain ?? 0,
      mentalDrain: ds?.mentalDrain ?? 0,
      speedMultiplier: 1,
      hungerDrainMultiplier: 1,
      energyDrainMultiplier: 1,
      hygieneDrain: 0,
      canEat: true
    };

    const decayMult = talentSystem?.getEffect('decayMult', 1) ?? 1;

    // ===== Sistema térmico y frío bogotano ("La Nevera") =====
    if (this.calor > 0) {
      this.calor = Math.max(0, this.calor - dt);
    }
    const isCold = !!(clock?.isNight && weather?.isRaining) && this.calor <= 0;
    this.isFreezing = isCold;
    if (isCold) {
      // El frío nocturno con lluvia cala los huesos y desgasta la energía
      this.energia = Math.max(0, this.energia - 0.35 * dt);
    }

    // ===== Decay base =====
    this.hambre  = Math.max(0, this.hambre  - DECAY.hambre  * fx.hungerDrainMultiplier * dt * decayMult);
    this.sed     = Math.max(0, this.sed     - DECAY.sed     * dt * decayMult);
    this.energia = Math.max(0, this.energia - DECAY.energia * fx.energyDrainMultiplier * dt);

    // Higiene: baja más rápido si estás en la calle (siempre) + efecto de enfermedad
    this.higiene = Math.max(0, this.higiene - (DECAY.higiene + fx.hygieneDrain) * dt);

    // Vicio: la ansiedad crece con el tiempo
    const wasWithdrawal = this.inWithdrawal;
    const wasHighWithdrawal = this.isHighWithdrawal;
    this.vicio = Math.max(0, this.vicio - DECAY.vicio * dt);
    if (this.inWithdrawal !== wasWithdrawal) {
      window.dispatchEvent(new CustomEvent('withdrawal', {
        detail: { active: this.inWithdrawal, abstinencia: this.abstinencia }
      }));
    }
    if (this.isHighWithdrawal !== wasHighWithdrawal) {
      window.dispatchEvent(new CustomEvent('withdrawal-high', {
        detail: { active: this.isHighWithdrawal, abstinencia: this.abstinencia }
      }));
    }

    // Único cálculo de ánimo (saludMental es un alias): incluye noche, enfermedades y talentos.
    const mentalDecayMult = talentSystem?.getEffect('mentalDecayMult', 1) ?? 1;
    let animoDecay = DECAY.animo + (clock?.isNight ? MENTAL_DECAY_NIGHT : 0) + fx.mentalDrain;
    if (this.hambre < 30) animoDecay *= 1.5;
    if (this.sed < 30)    animoDecay *= 1.5;
    if (this.energia < 30) animoDecay *= 1.3;
    if (this.isFreezing)  animoDecay *= 1.25;
    if (this.calor > 0)   animoDecay *= 0.8;
    if (this.inWithdrawal) {
      animoDecay *= WITHDRAWAL.animoMult;
      if (this.isCriticalWithdrawal) animoDecay *= 2.2;
      else if (this.isHighWithdrawal) animoDecay *= 1.6;
    }
    this.animo = Math.max(0, this.animo - animoDecay * mentalDecayMult * dt);

    // ===== Daño por stats críticos =====
    let damage = 0;
    if (this.hambre === 0)  damage += SURVIVAL_DAMAGE.hambre;
    if (this.sed === 0)     damage += SURVIVAL_DAMAGE.sed;
    if (this.inWithdrawal)  damage += WITHDRAWAL.saludPorSeg;
    damage += fx.healthDrain;

    if (damage > 0) {
      this.salud = Math.max(0, this.salud - damage * dt);
    }

    // ===== Regeneración natural =====
    if (
      this.hambre > 50 &&
      this.sed > 50 &&
      this.energia > 50 &&
      this.higiene > 40 &&
      this.animo > 40 &&
      !this.inWithdrawal &&
      this.salud < 100 &&
      fx.healthDrain === 0
    ) {
      this.salud = Math.min(100, this.salud + 0.5 * dt);
    }

    // ===== Subir de nivel =====
    while (this.xp >= XP_PER_LEVEL * this.level) {
      this.xp -= XP_PER_LEVEL * this.level;
      this.level++;
      if (talentSystem) talentSystem.addPoints(1);
      window.dispatchEvent(new CustomEvent('levelup', {
        detail: { level: this.level }
      }));
    }
  }

  addXP(amount, talentSystem = null) {
    const mult = talentSystem?.getEffect('xpMult', 1) ?? 1;
    this.xp += Math.round(amount * mult);
  }

  canEat() {
    const ds = this.diseaseSystem;
    const fx = typeof ds?.getAggregatedEffects === 'function' ? ds.getAggregatedEffects() : null;
    return fx?.canEat ?? true;
  }

  /** ===== Multiplicadores de efectos ===== */

  /** Velocidad: se reduce si ánimo bajo o enfermedad */
  getSpeedMultiplier() {
    let mult = 1.0;
    const ds = this.diseaseSystem;
    const fx = typeof ds?.getAggregatedEffects === 'function' ? ds.getAggregatedEffects() : null;
    if (fx?.speedMultiplier) mult *= fx.speedMultiplier;

    if (this.animo < STAT_THRESHOLDS.animoVelocidad) mult *= 0.8;
    if (this.animo === 0) mult *= 0.7; // crítico
    if (this.energia === 0) mult *= 0.5;
    if (this.inWithdrawal) {
      mult *= WITHDRAWAL.velocidad;
      if (this.isCriticalWithdrawal) mult *= 0.75; // temblores y desorientación motora
      else if (this.isHighWithdrawal) mult *= 0.88;
    }
    return mult;
  }

  /** Probabilidad extra de enfermedad por higiene baja */
  getDiseaseChanceMultiplier() {
    if (this.higiene < STAT_THRESHOLDS.higieneEnfermedad) return 1.5;
    return 1.0;
  }

  /** Nivel de desaturación visual por ánimo (0 = normal, 1 = gris total) */
  getDesaturation() {
    if (this.animo >= STAT_THRESHOLDS.animoVision) return 0;
    const t = 1 - (this.animo / STAT_THRESHOLDS.animoVision);
    return Math.min(1, t);
  }

  /** NPCs te rechazan si estás muy sucio (para futuro) */
  isRejectedByNPCs() {
    return this.higiene < STAT_THRESHOLDS.higieneRechazo;
  }

  /** ===== Serialización ===== */
  serialize() {
    return {
      hambre: this.hambre,
      sed: this.sed,
      energia: this.energia,
      salud: this.salud,
      higiene: this.higiene,
      animo: this.animo,
      vicio: this.vicio,
      dinero: this.dinero,
      xp: this.xp,
      level: this.level,
      calor: Math.round(this.calor)
    };
  }

  deserialize(d) {
    if (!d) return;
    if (d.hambre !== undefined)  this.hambre  = d.hambre;
    if (d.sed !== undefined)     this.sed     = d.sed;
    if (d.energia !== undefined) this.energia = d.energia;
    if (d.salud !== undefined)   this.salud   = d.salud;
    if (d.higiene !== undefined) this.higiene = d.higiene;
    if (d.animo !== undefined)   this.animo   = d.animo;
    else if (d.saludMental !== undefined) this.animo = d.saludMental;
    if (d.vicio !== undefined)   this.vicio   = d.vicio;
    if (d.dinero !== undefined)  this.dinero  = d.dinero;
    if (d.xp !== undefined)      this.xp      = d.xp;
    if (d.level !== undefined)   this.level   = d.level;
    if (d.calor !== undefined)   this.calor   = d.calor;
  }
}
