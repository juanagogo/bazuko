// Combate ligero: separa la pulsación del instante real de impacto.
export const GOLPES = {
  jab: { clip: 'golpe_jab', dur: .34, hitAt: .42, reach: 1.85, arc: .25, dmg: 4, knock: .18, stun: .12 },
  cross: { clip: 'golpe_cross', dur: .46, hitAt: .5, reach: 1.95, arc: .2, dmg: 7, knock: .3, stun: .2 },
  patada: { clip: 'patada', dur: .62, hitAt: .55, reach: 2.2, arc: .12, dmg: 10, knock: .5, stun: .35 }
};

export class CombatSystem {
  constructor() { this.pending = null; this.comboUntil = 0; this.combo = 0; }
  begin(player, npcs, now = performance.now() / 1000) {
    if (this.pending) return false;
    this.combo = now < this.comboUntil ? 1 - this.combo : 0;
    const kind = this.combo ? 'cross' : 'jab';
    const hit = GOLPES[kind];
    this.pending = { player, npcs, kind, hit, elapsed: 0, impacted: false };
    this.comboUntil = now + .55;
    player.playAction(hit.clip, hit.dur);
    player.audio?.playWhoosh?.();
    return true;
  }
  update(dt) {
    const event = this.pending; if (!event) return;
    event.elapsed += dt;
    if (!event.impacted && event.elapsed >= event.hit.dur * event.hit.hitAt) {
      event.impacted = true;
      const { player, hit, npcs } = event;
      const fx = Math.sin(player.root.rotation.y), fz = Math.cos(player.root.rotation.y);
      const target = npcs.find(npc => {
        if (!npc?.position) return false;
        const dx = npc.position.x - player.position.x, dz = npc.position.z - player.position.z;
        const d = Math.hypot(dx, dz); return d <= hit.reach && (dx * fx + dz * fz) / (d || 1) > hit.arc;
      });
      if (target?.takePunch) {
        const drop = target.takePunch(player, hit);
        target.receiveCombatHit?.({ ...hit, direction: { x: fx, z: fz } });
        player.audio?.playPunchHit?.();
        if (drop && typeof player.stats?.dinero === 'number') player.stats.dinero += drop;
      }
    }
    if (event.elapsed >= event.hit.dur) this.pending = null;
  }
}
