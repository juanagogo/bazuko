// Turnos por objetivo; todos los tiempos siguen la simulación y respetan la pausa.
const turnos = new WeakMap();
const PROVOCACIONES = ['¡Malparido!', '¡Gonorrea!', '¡Hijueputa!'];
export class NpcCombat {
  constructor(npc) { this.npc = npc; this.state = 'libre'; this.timer = 0; }
  entrarEnCombate(objetivo, golpeDirecto = false) {
    if (!objetivo?.position || this.npc.hp <= 0) return;
    this.objetivo = objetivo;
    if (this.state === 'libre') {
      this.state = 'provocar'; this.timer = 0; this.provocaciones = 0;
      this.golpes = golpeDirecto ? 1 : 0; this.escalar = false;
    } else if (golpeDirecto) {
      this.golpes++;
      this.escalar = this.golpes >= 2;
    }
  }
  liberarFicha() { turnos.get(this.objetivo)?.delete(this); }
  intentarEsquiva() {
    if (!['acercarse', 'preparar', 'recuperar'].includes(this.state) || this.npc.reactionTimer > 0 || this.npc.grabbed) return false;
    if (Math.random() >= .4) return false;
    this.liberarFicha(); this.state = 'pivotar'; this.timer = .97;
    this.npc.assaultAction = 'pivotar'; this.npc.combatActionDuration = .97;
    return true;
  }
  update(dt) {
    const n = this.npc, p = this.objetivo;
    if (!p || this.state === 'libre') return;
    if (n.hp <= 0 || p.stats?.salud <= 0 || n._disposed) { this.dispose(); return; }
    this.timer -= dt;
    const d = n._direction.copy(p.position).sub(n.position); d.y = 0;
    const distance = d.length();
    if (distance > 25) { this.dispose(); return; }
    if (this.state !== 'pivotar') {
      const angle = Math.atan2(d.x, d.z) - (n.root.rotation.y || 0);
      n.root.rotation.y = (n.root.rotation.y || 0) + Math.atan2(Math.sin(angle), Math.cos(angle)) * (1 - Math.exp(-12 * dt));
    }
    if (this.state === 'provocar') {
      if (this.timer <= 0) {
        if (this.provocaciones >= 2) {
          n.assaultAction = null;
          this.state = this.escalar ? 'acercarse' : 'advertido';
          return;
        }
        n.assaultAction = 'provocar'; n.combatActionDuration = 3.23;
        n.say?.(PROVOCACIONES[this.provocaciones], 3.2);
        this.provocaciones++; this.timer = 3.23;
      } else if (!n.assaultAction) n.assaultAction = 'provocar';
      return;
    }
    if (this.state === 'advertido') {
      if (this.escalar) this.state = 'acercarse';
      return;
    }
    if (this.state === 'pivotar') {
      n.assaultAction = 'pivotar'; n.combatActionDuration = .97;
      const step = Math.min(dt, Math.max(0, this.timer + dt)) * .65;
      const next = n._nextPosition.copy(n.position);
      if (distance > .1) {
        next.x += d.z / distance * step; next.z -= d.x / distance * step;
        if (n.isWalkable(next.x, next.z)) { next.y = n.groundHeight(next.x, next.z); n.position.copy(next); }
      }
      if (this.timer <= 0) { n.assaultAction = null; this.state = 'acercarse'; }
      return;
    }
    if (this.state === 'preparar' && this.timer <= 0) {
      n.assaultAction = 'golpe_jab'; n.combatActionDuration = .7; this.state = 'golpear'; this.timer = .3;
    } else if (this.state === 'golpear' && this.timer <= 0) {
      if (p.action !== 'pivotar' && distance < 1.9 && Math.abs(p.position.y - n.position.y) < 1.2) {
        if (p.stats) p.stats.salud = Math.max(0, p.stats.salud - (p.isBlocking ? 2 : 5));
        p.receiveAssaultHit?.(d.normalize()); p.audio?.playPunchHit?.();
      }
      this.state = 'recuperar'; this.timer = .4;
    } else if (this.state === 'recuperar' && this.timer <= 0) {
      this.liberarFicha(); n.assaultAction = 'pivotar'; n.combatActionDuration = .97;
      this.state = 'pivotar'; this.timer = .97;
    }
    if (this.state !== 'acercarse') return;
    let slots = turnos.get(p); if (!slots) turnos.set(p, slots = new Set());
    const stop = slots.size < 2 ? 1.5 : 3;
    if (distance > stop) {
      const next = n._nextPosition.copy(n.position).addScaledVector(d.normalize(), Math.min(distance - stop, dt * 3.8));
      if (n.isWalkable(next.x, next.z)) { next.y = n.groundHeight(next.x, next.z); n.position.copy(next); }
    } else if (slots.size < 2 && this.timer <= 0) {
      slots.add(this); this.state = 'preparar'; this.timer = .3;
    }
  }
  dispose() { this.liberarFicha(); this.objetivo = null; this.state = 'libre'; this.npc.assaultAction = null; }
}
