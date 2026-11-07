// src/systems/PedestrianCrowd.js
// La gente que rodea al jugador: cuántos caminan a esa hora, por andén o por parque, y dónde nacen. Sin Three ni DOM.

// Fracción de la gente de calle que sale a esa hora, respecto al pico. Entrada (6 a 9), mediodía ocupado, salida (17 a 20).
const STREET_CURVE = [[0, .12], [5, .15], [6, .7], [7.5, 1], [9, .85], [12, .7], [15, .6], [17, .9], [18.5, 1], [20, .75], [21.5, .35], [23, .16], [24, .12]];
// Los parques son del día: vivos de mañana a media tarde y casi vacíos al oscurecer.
const PARK_CURVE = [[0, .02], [5.5, .02], [7, .4], [10, .85], [13, 1], [16, .9], [18, .5], [19.5, .12], [21, .03], [24, .02]];

// Gente de calle y de parque que cabe dentro de la burbuja a su hora de mayor afluencia.
export const STREET_PEAK = 230, PARK_PEAK = 60;
// Techo de caminantes que existen a la vez: quien sale de la burbuja se reutiliza, no se crea otro.
export const POOL_MAX = 330;

function sample(curve, hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  for (let i = 0; i < curve.length - 1; i++) {
    const [a, fa] = curve[i], [b, fb] = curve[i + 1];
    if (h <= b) return fa + (fb - fa) * (h - a) / (b - a);
  }
  return curve[curve.length - 1][1];
}

export function streetFactor(hour) { return sample(STREET_CURVE, hour); }
export function parkFactor(hour) { return sample(PARK_CURVE, hour); }

/** Cuántos caminantes quiere la burbuja a esa hora, por andén y por parque. */
export function crowdTargets(hour) {
  return { street: Math.round(STREET_PEAK * streetFactor(hour)), park: Math.round(PARK_PEAK * parkFactor(hour)) };
}

const FRESH_SECONDS = 2, CREATES_PER_FRAME = 8, MOVES_PER_FRAME = 40, SLOW_MOVES = 3;
const FRESH_JUMP = 35, TRIES = 40, NEAR = 6;

export class PedestrianCrowd {
  /**
   * `streets` y `parks`: nodos { x, z } ya en metros. `create(x, z)` hace un caminante nuevo; `place(npc, x, z)` lo
   * lleva a otro punto; `show(npc)` y `hide(npc)` lo meten o sacan de la lista de gente viva.
   */
  constructor({ streets, parks, create, place, show, hide, canMove = () => true, random = Math.random }) {
    this.streets = streets; this.parks = parks;
    this.create = create; this.place = place; this.show = show; this.hide = hide; this.canMove = canMove;
    this.random = random;
    this.active = []; this.pool = [];
    this.kinds = new Map();
    this.fresh = FRESH_SECONDS;
    this.lastX = null; this.lastZ = null;
    this.created = 0;
  }

  count(kind) { let n = 0; for (const npc of this.active) if (this.kinds.get(npc) === kind) n++; return n; }

  /** Una hora de reloj, el centro de la burbuja y su radio; `forward` es hacia donde mira la cámara. */
  update(dt, hour, center, radius, forward = null, view = center) {
    if (this.lastX === null || Math.hypot(center.x - this.lastX, center.z - this.lastZ) > FRESH_JUMP) this.fresh = FRESH_SECONDS;
    this.lastX = center.x; this.lastZ = center.z;
    const target = crowdTargets(hour), radiusSq = radius * radius;
    let street = 0, park = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const npc = this.active[i], dx = npc.position.x - center.x, dz = npc.position.z - center.z;
      if (dx * dx + dz * dz > radiusSq * 1.3 && this.canMove(npc)) { this._retire(i); continue; }
      if (this.kinds.get(npc) === 'park') park++; else street++;
    }
    const fresh = this.fresh > 0;
    if (fresh) this.fresh -= dt;
    let moves = fresh ? MOVES_PER_FRAME : SLOW_MOVES;
    this.createBudget = fresh ? CREATES_PER_FRAME : 1;
    for (const kind of ['street', 'park']) {
      let have = kind === 'street' ? street : park;
      const want = target[kind];
      while (have < want && moves > 0) {
        if (!this._add(kind, center, radius, forward, view, fresh)) break;
        have++; moves--;
      }
      // Sobran: se va primero quien está más lejos.
      if (have > want * 1.1 + 2) this._retireFarthest(kind, center);
    }
  }

  _add(kind, center, radius, forward, view, fresh) {
    const nodes = kind === 'park' ? this.parks : this.streets;
    if (!nodes.length) return false;
    for (let tries = 0; tries < TRIES; tries++) {
      const node = nodes[Math.floor(this.random() * nodes.length)];
      const dx = node.x - center.x, dz = node.z - center.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      const vx = node.x - view.x, vz = node.z - view.z, fromView = Math.hypot(vx, vz);
      if (fromView < NEAR) continue;
      // Fuera de una vista nueva nadie aparece delante de la cámara y cerca: entra por los bordes.
      if (!fresh && forward && (vx * forward.x + vz * forward.z) > 0 && fromView < radius * .6) continue;
      let npc = this.pool.pop();
      if (npc) this.place(npc, node.x, node.z);
      else if (this.created < POOL_MAX && this.createBudget > 0) { npc = this.create(node.x, node.z); this.created++; this.createBudget--; }
      else return false;
      this.kinds.set(npc, kind);
      this.active.push(npc);
      this.show(npc);
      return true;
    }
    return false;
  }

  _retire(index) {
    const [npc] = this.active.splice(index, 1);
    this.hide(npc);
    this.pool.push(npc);
  }

  _retireFarthest(kind, center) {
    let best = -1, bestSq = -1;
    this.active.forEach((npc, index) => {
      if (this.kinds.get(npc) !== kind || !this.canMove(npc)) return;
      const d = (npc.position.x - center.x) ** 2 + (npc.position.z - center.z) ** 2;
      if (d > bestSq) { bestSq = d; best = index; }
    });
    if (best >= 0) this._retire(best);
  }
}
