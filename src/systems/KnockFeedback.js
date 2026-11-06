// src/systems/KnockFeedback.js
// Cuando el jugador le pega a algo sólido, suena un golpe corto (metálico en un carro, hueco en una
// caneca o una pared); un parqueado activa su alarma y se mece unos centímetros. Sin GTA: solo el aviso.
import * as THREE from 'three';

export const KNOCK = {
  cooldown: .18,     // segundos entre golpes: un combo no dispara seis veces por cuadro
  reach: .35,        // margen sobre el alcance del golpe
  rockAngle: .05,    // radianes de balanceo del parqueado (~4 cm en su borde)
  rockTime: .35
};

const _candidates = [];
const _fall = [];
const _target = { entry: null, x: 0, y: 0, z: 0 };

export class KnockFeedback {
  /**
   * @param {{ player: object, audio?: object, collisions?: object }} deps
   */
  constructor({ player, audio = null, collisions = null } = {}) {
    this.player = player;
    this.audio = audio;
    this.collisions = collisions;
    this._attackId = null;
    this._resolvedId = null;
    this._impactAt = 0;
    this._cooldown = 0;
    this._rocks = [];
  }

  /** El impacto ocurre al terminar la anticipación del golpe, una sola vez por ataque. */
  update(dt) {
    if (dt > 0) {
      if (this._cooldown > 0) this._cooldown = Math.max(0, this._cooldown - dt);
      this._updateRocks(dt);
    }
    const melee = this.player?.melee;
    const attack = melee?.attack;
    if (!attack || !this.player?.root) { this._attackId = null; return; }
    if (attack.id !== this._attackId) {
      this._attackId = attack.id;
      this._resolvedId = null;
      this._impactAt = attack.timing?.windup ?? 0;
    }
    if (this._resolvedId === attack.id || (melee.elapsed ?? 0) < this._impactAt) return;
    this._resolvedId = attack.id;
    if (this._cooldown > 0) return;
    const range = (attack.timing?.range ?? 1.6) + KNOCK.reach;
    if (!this._findTarget(range)) return;
    this._cooldown = KNOCK.cooldown;
    this._react(_target.entry);
  }

  /** Lo sólido más cercano al frente y a la altura del pecho, entre estático, vehículos y lo que solo ocupa sitio. */
  _findTarget(range) {
    const collisions = this.collisions;
    if (!collisions) return false;
    const p = this.player.position, yaw = this.player.root.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    collisions.queryStatic?.(p.x - range, p.z - range, p.x + range, p.z + range, _candidates);
    for (const entry of collisions.dynamicColliders ?? []) _candidates.push(entry);
    // La consulta de lo que solo ocupa sitio vacía su resultado: va en su propia lista para no borrar las anteriores.
    collisions.queryFallObstacles?.(p.x - range, p.z - range, p.x + range, p.z + range, _fall);
    for (const entry of _fall) _candidates.push(entry);
    let bestSq = range * range;
    _target.entry = null;
    for (const entry of _candidates) {
      const { box } = entry;
      if (!box) continue;
      const cx = Math.max(box.min.x, Math.min(p.x, box.max.x));
      const cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
      const dx = cx - p.x, dz = cz - p.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > bestSq) continue;
      // Solo lo que queda al frente, y a la altura del puño.
      if (dx * fx + dz * fz < -0.05 && distanceSq > .04) continue;
      if (box.max.y < p.y + .1 || box.min.y > p.y + 1.85) continue;
      bestSq = distanceSq;
      _target.entry = entry;
      _target.x = cx; _target.y = p.y + .8; _target.z = cz;
    }
    return !!_target.entry;
  }

  _react(entry) {
    const car = entry.vehicle ?? null;
    const metal = !!car;
    this.audio?.playKnock?.(_target, { metal });
    if (!car) return;
    if (!car.traffic && car.vehicle?.group) {
      this.audio?.playCarAlarm?.(car);
      this._rock(car);
    }
    if (typeof globalThis.window !== 'undefined') {
      globalThis.window.dispatchEvent?.(new CustomEvent('solid-hit', { detail: { car } }));
    }
  }

  /** El parqueado se mece unos centímetros y vuelve a su puesto. */
  _rock(car) {
    if (this._rocks.some(rock => rock.car === car)) return;
    this._rocks.push({ car, t: KNOCK.rockTime });
  }

  _updateRocks(dt) {
    for (let index = this._rocks.length - 1; index >= 0; index--) {
      const rock = this._rocks[index];
      rock.t -= dt;
      const group = rock.car.vehicle?.group;
      if (!group || rock.t <= 0) {
        if (group) group.rotation.z = 0;
        this._rocks.splice(index, 1);
        continue;
      }
      // Un solo vaivén: sube y baja una vez y el carro queda quieto.
      group.rotation.z = KNOCK.rockAngle * Math.sin((rock.t / KNOCK.rockTime) * Math.PI);
    }
  }
}
