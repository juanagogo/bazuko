// Turnos por objetivo; todos los tiempos siguen la simulación y respetan la pausa.
const turnos = new WeakMap();
const PROVOCACIONES = ['¡Malparido!', '¡Gonorrea!', '¡Hijueputa!'];
export class NpcCombat {
  constructor(npc) { this.npc = npc; this.state = 'libre'; this.timer = 0; this.routeTimer = 0; this.route = []; this.routeIndex = 0; this.age = 0; }
  entrarEnCombate(objetivo, golpeDirecto = false) {
    if (!objetivo?.position || this.npc.hp <= 0) return;
    if (this.objetivo && this.objetivo !== objetivo) this.dispose();
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
  update(dt) {
    const n = this.npc, p = this.objetivo;
    if (!p || this.state === 'libre') return;
    if (n.hp <= 0 || p.stats?.salud <= 0 || n._disposed) { this.dispose(); return; }
    this.age += dt;
    if (this.age > 25) { this.dispose(); return; }
    if (this.activationDelay > 0) { this.activationDelay -= dt; return; }
    this.timer -= dt;
    this.routeTimer -= dt;
    if (this.mob && (this.voiceTimer = (this.voiceTimer ?? 0) - dt) <= 0) {
      n.speakScenario?.(this.robberyChase ? 'theftChase' : 'mob');
      this.voiceTimer = this.robberyChase ? 9 : 5;
    }
    const d = n._direction.copy(p.position).sub(n.position); d.y = 0;
    const distance = d.length();
    if (distance > 25) { this.dispose(); return; }
    const angle = Math.atan2(d.x, d.z) - (n.root.rotation.y || 0);
    n.root.rotation.y = (n.root.rotation.y || 0) + Math.atan2(Math.sin(angle), Math.cos(angle)) * (1 - Math.exp(-12 * dt));
    if (this.state === 'provocar') {
      if (this.timer <= 0) {
        if (this.provocaciones >= 2) {
          n.assaultAction = null;
          this.state = this.escalar ? 'acercarse' : 'advertido';
          return;
        }
        n.assaultAction = 'provocar'; n.combatActionDuration = 3.23;
        if (n.speakScenario) n.speakScenario('taunt');
        else n.say?.(PROVOCACIONES[this.provocaciones], 3.2);
        this.provocaciones++; this.timer = 3.23;
      } else if (!n.assaultAction) n.assaultAction = 'provocar';
      return;
    }
    if (this.state === 'advertido') {
      if (this.escalar) this.state = 'acercarse';
      return;
    }
    if (this.state === 'preparar' && this.timer <= 0) {
      n.assaultAction = 'golpe_jab'; n.combatActionDuration = .7; this.state = 'golpear'; this.timer = .3;
    } else if (this.state === 'golpear' && this.timer <= 0) {
      if (distance < 1.9 && Math.abs(p.position.y - n.position.y) < 1.2 &&
          p._lastCollisions?.hasClearStrike?.(n.position, p.position) !== false) {
        if (p.receiveAssaultHit) p.receiveAssaultHit(d.normalize(), 5);
        else if (p.stats) p.stats.salud = Math.max(0, p.stats.salud - (p.isBlocking ? 2 : 5));
        p.audio?.playPunchHit?.();
      }
      this.state = 'recuperar'; this.timer = .4;
    } else if (this.state === 'recuperar' && this.timer <= 0) {
      this.liberarFicha(); n.assaultAction = null; this.state = 'acercarse'; this.timer = .35 + Math.random() * .4;
    }
    if (this.state !== 'acercarse') return;
    let slots = turnos.get(p); if (!slots) turnos.set(p, slots = new Set());
    const stop = slots.size < 2 ? 1.5 : 3;
    if (distance <= stop && p._lastCollisions?.hasClearStrike?.(n.position, p.position) === false) {
      this.followRoute(dt, p.position);
      return;
    }
    if (distance > stop) {
      const next = n._nextPosition.copy(n.position).addScaledVector(d.normalize(), Math.min(distance - stop, dt * 3.8));
      if (n.isWalkable(next.x, next.z)) { next.y = n.groundHeight(next.x, next.z); n.position.copy(next); }
      else this.followRoute(dt, p.position);
    } else if (slots.size < 2 && this.timer <= 0) {
      slots.add(this); this.state = 'preparar'; this.timer = .3;
    }
  }
  // Red peatonal existente: recalcular como máximo una vez por segundo al encontrar obstáculos.
  followRoute(dt, goal) {
    const n = this.npc, nav = n.navigation;
    if (!nav?.nodes || !nav.nodeAt) return;
    if (this.routeTimer <= 0) {
      this.routeTimer = 1;
      const near = nav.nearestPoint(goal.x, goal.z);
      const start = nav.nodeAt(n.position.x, n.position.z);
      const end = near ? nav.nodeAt(near.x, near.z) : -1;
      this.route = []; this.routeIndex = 0;
      if (start < 0 || end < 0) return;
      const previous = new Map([[start, -1]]), queue = [start];
      for (let i = 0; i < queue.length && !previous.has(end); i++) {
        for (const id of nav.nodes[queue[i]].neighbors) if (!previous.has(id)) {
          previous.set(id, queue[i]); queue.push(id);
        }
      }
      if (previous.has(end)) {
        for (let id = end; id !== start && id >= 0; id = previous.get(id)) this.route.push(nav._point(id));
        this.route.reverse();
      }
    }
    const point = this.route[this.routeIndex]; if (!point) return;
    const dir = n._direction.copy(point).sub(n.position); dir.y = 0;
    const dist = dir.length();
    if (dist < .15) { this.routeIndex++; return; }
    const next = n._nextPosition.copy(n.position).addScaledVector(dir.normalize(), Math.min(dist, dt * 3.8));
    if (n.isWalkable(next.x, next.z)) { next.y = n.groundHeight(next.x, next.z); n.position.copy(next); }
  }
  dispose() {
    this.liberarFicha();
    this.age = 0; this.timer = 0; this.activationDelay = 0; this.voiceTimer = 0;
    this.mob = false; this.route = []; this.routeTimer = 0;
    this.robberyChase = false;
    this.objetivo = null; this.state = 'libre'; this.npc.assaultAction = null;
  }
}
