// Agarre corto: H sujeta/suelta, J derriba; el NPC forcejea y se libera por tiempo.
export class GrappleSystem {
  constructor(player) { this.player = player; this.target = null; this.timer = 0; }
  release() {
    if (this.target) { this.target.grabbed = false; this.target.assaultAction = null; }
    this.target = null; this.player.action = null; this.player.actionTimer = 0;
  }
  update(dt, npcs, collisions) {
    const p = this.player;
    if (p.input?.consumePress?.('KeyH')) {
      if (this.target) this.release();
      else {
        const n = npcs.find(n => n.hp > 0 && !n.grabbed && n.position.distanceTo(p.position) < 1.4);
        if (n) {
          this.target = n; n.grabbed = true; n.combatAI?.dispose(); this.timer = 3;
          p.combat?.dispose(); n.say?.('¡Suélteme, parce!');
        }
      }
    }
    const n = this.target; if (!n) return false;
    this.timer -= dt;
    if (this.timer <= 0 || n._disposed || n.hp <= 0 || p.stats?.salud <= 0 || p.isStunned || n.position.distanceTo(p.position) > 3) { this.release(); return false; }
    p.velocity.set(0, 0, 0); p.playAction('agarrar', .2); n.assaultAction = 'ser_agarrado';
    const delta = p._delta.set(Math.sin(p.root.rotation.y) * .85, 0, Math.cos(p.root.rotation.y) * .85);
    const next = p._before.copy(p.position).add(delta);
    if (collisions) collisions.resolveMove(p.position, delta, .35, next);
    if (!n.isWalkable(next.x, next.z)) { this.release(); return false; }
    n.position.copy(next); n.root.position.copy(next); n.root.rotation.y = p.root.rotation.y + Math.PI;
    if (p.input?.consumePress?.('KeyJ')) {
      this.release();
      n.velocity.copy(delta).normalize().multiplyScalar(2); n.applyDamage(10);
      n.assaultAction = 'derribo'; n.reactionTimer = n.hp <= 0 ? Infinity : 1.2;
    }
    return true;
  }
}
