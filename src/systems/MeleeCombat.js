import { hasClearCombatLine } from './CombatGeometry.js';
import { WEAPONS, DEFAULT_WEAPON, COMBO_WINDOW, CHAIN_AT, comboStep } from '../data/weapons.js';

export const MELEE_ATTACK = Object.freeze({
  windup: WEAPONS.punos.windup, impact: WEAPONS.punos.windup,
  duration: WEAPONS.punos.windup + WEAPONS.punos.active + WEAPONS.punos.recovery,
  cooldown: .78, range: WEAPONS.punos.range, maxHeightDifference: .85, minFacingDot: WEAPONS.punos.arc
});
export const ATTACK_ENERGY = 8;
let nextAttackId = 1;

const validPosition = (position) => position && ['x', 'y', 'z'].every(axis => Number.isFinite(position[axis]));

/** Una sola máquina de estados controla energía, combos y contacto. Player acredita el resultado. */
export class MeleeCombat {
  constructor() {
    this.attack = null;
    this.elapsed = 0;
    this.duration = MELEE_ATTACK.duration;
    this.cooldownRemaining = 0;
    this.comboStep = 0;
    this.comboTimer = 0;
    this.queued = false;
    this._attacker = null;
    this._comboWeapon = null;
    this._resolved = false;

  }

  get active() { return !!this.attack; }
  get progress() { return Math.min(1, this.elapsed / this.duration); }
  get phase() { return this.attack?.phase ?? 'idle'; }

  _canAttack(attacker) {
    return validPosition(attacker?.position) && Number.isFinite(attacker?.root?.rotation?.y)
      && !attacker.isStunned && !attacker.isSwimming && attacker.isGrounded !== false
      && !attacker.hasCart && !attacker.sorting && !(attacker.stats?.salud <= 0);
  }

  _spendEnergy(attacker) {
    if (typeof attacker.stats?.energia !== 'number') return true;
    if (attacker.stats.energia < ATTACK_ENERGY) {
      if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: 'No doy más para pelear. Tengo que descansar.', type: 'warn' }
      }));
      return false;
    }
    attacker.stats.energia -= ATTACK_ENERGY;
    return true;
  }

  start(attacker) {
    const weapon = WEAPONS[attacker?.equippedWeapon] ?? WEAPONS[DEFAULT_WEAPON];
    const continuation = this._attacker === attacker && this.comboTimer > 0 && this.comboStep > 0 && this._comboWeapon === weapon.id;
    if (this.active || !this._canAttack(attacker) || (!continuation && this.cooldownRemaining > 1e-8)) return false;
    if (!this._spendEnergy(attacker)) return false;
    this._begin(attacker, weapon, continuation ? this.comboStep : 0);
    return true;
  }

  queue(attacker) {
    const a = this.attack;
    if (!a || attacker !== this._attacker || !this._canAttack(attacker) || this.queued
      || a.step + 1 >= WEAPONS[a.weapon].combo) return false;
    if (!this._spendEnergy(attacker)) return false;
    this.queued = true;
    return true;
  }

  _begin(attacker, weapon, step) {
    const timing = comboStep(weapon, step);
    this.attack = { id: nextAttackId++, weapon: weapon.id, step, phase: 'windup', t: 0, progress: 0, timing };
    this.elapsed = 0;
    this.duration = timing.windup + timing.active + timing.recovery;
    this.cooldownRemaining = Math.max(MELEE_ATTACK.cooldown, this.duration);
    this._attacker = attacker;
    this._comboWeapon = weapon.id;
    this.comboTimer = 0;
    this.queued = false;
    this._resolved = false;
    attacker.audio?.playWhoosh?.();
  }

  cancel() {
    this.attack = null;
    this.queued = false;
    this.comboStep = this.comboTimer = 0;
    this._attacker = null;
    this._resolved = true;
    // Cambiar arma, caer o nadar no elimina la recuperación pendiente.
  }

  _clearLine(attacker, target) {
    return hasClearCombatLine({ from: attacker.position, to: target.position, collisions: attacker._lastCollisions });
  }

  _targets(attacker, npcs, attack) {
    const weapon = WEAPONS[attack.weapon];
    const forwardX = Math.sin(attacker.root.rotation.y), forwardZ = Math.cos(attacker.root.rotation.y);
    let closest = null, closestDistance = Infinity;
    const targets = [], seen = new Set();
    for (const npc of npcs ?? []) {
      if (!npc || seen.has(npc) || npc._disposed || npc.isKnockedOut || npc.isSwimming || !validPosition(npc.position)
        || (typeof npc.takeHit !== 'function' && typeof npc.takePunch !== 'function')) continue;
      seen.add(npc);
      if (Math.abs(npc.position.y - attacker.position.y) > MELEE_ATTACK.maxHeightDifference) continue;
      const dx = npc.position.x - attacker.position.x, dz = npc.position.z - attacker.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > attack.timing.range) continue;
      const facing = distance > 1e-6 ? (dx * forwardX + dz * forwardZ) / distance : 1;
      if (facing < weapon.arc || !this._clearLine(attacker, npc)) continue;
      if (weapon.hitAll) targets.push(npc);
      else if (distance < closestDistance) { closest = npc; closestDistance = distance; }
    }
    if (closest) targets.push(closest);
    return targets;
  }

  _impact(attacker, npcs, attack) {
    const hits = [];
    for (const target of this._targets(attacker, npcs, attack)) {
      const dx = target.position.x - attacker.position.x, dz = target.position.z - attacker.position.z;
      const distance = Math.hypot(dx, dz);
      const dir = distance > 1e-6 ? { x: dx / distance, z: dz / distance }
        : { x: Math.sin(attacker.root.rotation.y), z: Math.cos(attacker.root.rotation.y) };
      const reward = typeof target.takeHit === 'function'
        ? target.takeHit({ attackId: attack.id, id: attack.id, attacker, weapon: attack.weapon,
          damage: attack.timing.damage, knockback: attack.timing.knockback, dir })
        : target.takePunch(attacker);
      if (reward === false || !Number.isFinite(reward) || reward < 0) continue;
      hits.push({ target, reward });
    }
    if (!hits.length) return null;
    attacker.audio?.playPunchHit?.();
    return { target: hits[0].target, reward: hits.reduce((sum, hit) => sum + hit.reward, 0), hits };
  }

  /** Un resultado por golpe, incluso con varios objetivos; dt=0 pausa también las ventanas. */
  update(dt, attacker, npcs = []) {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    const a = this.attack;
    if (!a) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (!this.comboTimer) this.comboStep = 0;
      return null;
    }
    if (attacker !== this._attacker || !this._canAttack(attacker)) { this.cancel(); return null; }
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    a.t += dt;
    let contact = null;
    for (;;) {
      const timing = a.timing;
      if (a.phase === 'windup') {
        if (a.t + 1e-8 < timing.windup) { a.progress = a.t / timing.windup; break; }
        a.t = Math.max(0, a.t - timing.windup);
        a.phase = 'active';
        if (!this._resolved) { this._resolved = true; contact = this._impact(attacker, npcs, a); }
      } else if (a.phase === 'active') {
        if (a.t + 1e-8 < timing.active) { a.progress = a.t / timing.active; break; }
        a.t = Math.max(0, a.t - timing.active);
        a.phase = 'recovery';
      } else {
        if (this.queued && a.t + 1e-8 >= timing.recovery * CHAIN_AT) {
          // La siguiente anticipación empieza visible en cero, sin impacto adicional en este frame.
          this._begin(attacker, WEAPONS[a.weapon], a.step + 1);
          break;
        }
        if (a.t + 1e-8 < timing.recovery) { a.progress = a.t / timing.recovery; break; }
        this.attack = null;
        this.elapsed = this.duration;
        this.comboStep = a.step + 1 < WEAPONS[a.weapon].combo ? a.step + 1 : 0;
        this.comboTimer = this.comboStep ? COMBO_WINDOW : 0;
        break;
      }
    }
    return contact;
  }
}
