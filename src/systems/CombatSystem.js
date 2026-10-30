// src/systems/CombatSystem.js
import * as THREE from 'three';

// arc = coseno del medio ángulo (más alto = más estrecho).
export const GOLPES = Object.freeze({
  jab: { clip: 'golpe_jab', dur: .34, hitAt: .42, reach: 1.85, arc: .26, dmg: 4, knock: .18, stun: .12, peso: 'ligero' },
  cross: { clip: 'golpe_cross', dur: .46, hitAt: .50, reach: 1.95, arc: .64, dmg: 7, knock: .30, stun: .20, peso: 'fuerte' },
  patada: { clip: 'patada', dur: .62, hitAt: .55, reach: 2.20, arc: .76, dmg: 10, knock: .50, stun: .35, peso: 'fuerte', derriba: true }
});

export const COMBO_VENTANA = .55;
export const HITSTOP_MS = 70;
const _v = new THREE.Vector3();

const INSULTOS_BANDA = [
  "¡Malparido!",
  "¡Hijueputa!",
  "¡Gonorrea, se metió con la gente equivocada!",
  "¡Gonorrea!",
  "¡Qué boleta, bájese de la nube!"
];

export class CombatSystem {
  constructor({ audio = null, camera = null } = {}) {
    this.audio = audio; 
    this.camera = camera; 
    this.pending = null;
    this.comboUntil = 0; 
    this._ultimoFueJab = false; 
    this._hitstopUntil = 0; 
    this.clock = 0;
  }

  begin(player, npcs, tipoForzado = null, now = performance.now() / 1000) {
    if (this.pending || this.clock < this._hitstopUntil) return false;
    const kind = tipoForzado ?? (now < this.comboUntil && this._ultimoFueJab ? 'cross' : 'jab');
    const hit = GOLPES[kind];
    if (!hit) return false;
    this.pending = { player, npcs, kind, hit, elapsed: 0, impacted: false };
    this.comboUntil = now + COMBO_VENTANA;
    this._ultimoFueJab = kind === 'jab';
    player.playAction(hit.clip, hit.dur);
    (this.audio ?? player.audio)?.playWhoosh?.();
    return true;
  }

  update(dt) {
    this.clock += dt;
    if (this.clock < this._hitstopUntil) return;
    const event = this.pending; 
    if (!event) return;
    
    event.elapsed += dt;
    
    if (!event.impacted && event.elapsed >= event.hit.dur * event.hit.hitAt) {
      event.impacted = true;
      const { player, hit, npcs, kind } = event;
      const pp = player.getPosition?.() ?? player.position ?? player.root?.position;
      const yaw = player.getYaw?.() ?? player.root?.rotation?.y ?? 0;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      
      let target = null, mejor = Infinity;
      for (const npc of npcs) {
        if (!npc?.position || npc.hp <= 0 || npc._disposed) continue;
        const dx = npc.position.x - pp.x, dz = npc.position.z - pp.z, d = Math.hypot(dx, dz);
        if (d > 1e-3 && d <= hit.reach && (dx * fx + dz * fz) / d > hit.arc && d < mejor) { 
          mejor = d; 
          target = npc; 
        }
      }
      
      if (target?.takePunch) {
        // La esquiva gana prioridad antes del impacto: no dispara reacción ni sonido de golpe.
        if (target.combatAI?.state === 'pivotar' || target.combatAI?.intentarEsquiva?.()) return;
        const drop = target.takePunch(player, { tipo: kind, dmg: hit.dmg, knock: hit.knock, stun: hit.stun, derriba: !!hit.derriba, dir: _v.set(fx, 0, fz).clone() });
        (this.audio ?? player.audio)?.playPunchHit?.(hit.peso === 'fuerte');
        if (drop && typeof player.stats?.dinero === 'number') player.stats.dinero += drop;
        this.camera?.shake?.(hit.peso === 'fuerte' ? .35 : .18, HITSTOP_MS / 1000);
        this._hitstopUntil = this.clock + HITSTOP_MS / 1000;

        // 👇 ¡AQUÍ SE DISPARA EL LINCHAMIENTO (pasando el array de npcs) 👇
        this.alertarALaBanda(player, target, npcs);
      }
    }
    if (event.elapsed >= event.hit.dur) this.pending = null;
  }

  /**
   * Busca NPCs cercanos en el mismo array y los vuelve hostiles.
   */
  alertarALaBanda(atacante, victima, npcs) {
    if (!victima?.position || !npcs) return;
    
    for (const npc of npcs) {
      // Ignoramos a la víctima original, a los muertos y al mismo atacante
      if (npc === victima || npc.hp <= 0 || npc === atacante) continue;
      
      // Calculamos distancia rápida (sin raíz cuadrada)
      const dx = npc.position.x - victima.position.x;
      const dz = npc.position.z - victima.position.z;
      if (dx * dx + dz * dz > 64) continue; // Si está a más de 8 metros (8^2 = 64), lo ignoramos
      
      // Si el NPC es valiente, se une al linchamiento
      const valentia = npc.valentia ?? Math.random();
      if (valentia > 0.3) {
        if (npc.combatAI) {
          npc.combatAI.entrarEnCombate(atacante);
        }
        if (typeof npc.say === 'function') {
          npc.say(INSULTOS_BANDA[Math.floor(Math.random() * INSULTOS_BANDA.length)]);
        }
      }
    }
  }

  dispose() { 
    this.pending = null; 
    this._hitstopUntil = 0; 
  }
}
