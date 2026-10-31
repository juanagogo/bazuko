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
      if (!pp) { this.pending = null; return; }
      const yaw = player.getYaw?.() ?? player.root?.rotation?.y ?? 0;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      
      let target = null, mejor = Infinity;
      for (const npc of npcs) {
        if (!npc?.position || npc.hp <= 0 || npc._disposed) continue;
        if (Math.abs(npc.position.y - pp.y) > 1.2) continue;
        const dx = npc.position.x - pp.x, dz = npc.position.z - pp.z, d = Math.hypot(dx, dz);
        if (d > 1e-3 && d <= hit.reach && (dx * fx + dz * fz) / d > hit.arc && d < mejor) { 
          if (player._lastCollisions?.hasClearStrike?.(pp, npc.position) === false) continue;
          mejor = d; 
          target = npc; 
        }
      }
      
      if (target?.takePunch) {
        const drop = target.takePunch(player, { tipo: kind, dmg: hit.dmg, knock: hit.knock, stun: hit.stun, derriba: !!hit.derriba, dir: _v.set(fx, 0, fz) });
        (this.audio ?? player.audio)?.playPunchHit?.(hit.peso === 'fuerte');
        if (drop && typeof player.stats?.dinero === 'number') player.stats.dinero += drop;
        this.camera?.shake?.(hit.peso === 'fuerte' ? .35 : .18, HITSTOP_MS / 1000);
        this._hitstopUntil = this.clock + HITSTOP_MS / 1000;

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
    
    const candidates = npcs.filter(npc => npc?.position && npc !== victima && npc !== atacante &&
      !(npc.hp <= 0) && !npc._disposed && (npc.valentia ?? 0) > .3 &&
      Math.abs(npc.position.y - victima.position.y) < 1.2 &&
      npc.position.distanceToSquared(victima.position) <= 64)
      .sort((a, b) => a.position.distanceToSquared(victima.position) - b.position.distanceToSquared(victima.position));
    for (const [index, npc] of candidates.slice(0, 5).entries()) {
      if (npc.combatAI?.state !== 'libre') continue;
      npc.beginAssault?.(atacante, 'golpe_jab', index * .15);
      npc.speakScenario?.('mob');
    }
  }

  dispose() { 
    this.pending = null; 
    this._hitstopUntil = 0; 
  }
}
