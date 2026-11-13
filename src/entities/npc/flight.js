// src/entities/npc/flight.js
// Huir con cabeza. En vez de correr derecho hasta toparse con una esquina, quien huye busca por la red de andenes un
// sitio lejos de la amenaza: nunca por un camino que lo acerque a ella, mejor donde hay gente o cerca de una
// patrulla, y sin cruzar calles de más. Si no hay ningún sitio que lo aleje (un rincón de verdad),
// se rinde y lo dice: ahí se agacha, como antes.
//
// La búsqueda reusa arreglos del tamaño de la red: planear no crea objetos; armar la ruta sí (unos puntos, al huir).

import { hypot } from './hypot.js';

export const FLIGHT = {
  depth: 24,      // baldosas de búsqueda (unos 48 m)
  minDepth: 6,    // un destino a menos de esto no es huir
  gain: 4,        // m más lejos de la amenaza que ahora, como mínimo
  keep: 3,        // m: el camino no pasa más cerca de la amenaza que esto (o que donde ya está)
  keepShare: .6,  // ...ni que esta parte de la distancia de ahora, si la amenaza está lejos
  slack: .6,      // m que puede acercarse el primer paso con la amenaza encima (moverse de lado en la cuadrícula)
  slackFar: 2.1,  // con la amenaza a más de 6 m: una baldosa, para tomar una salida de lado
  crossCost: 1.5, // por cada baldosa de calzada del camino
  shortlist: 8    // los mejores por distancia que se miran con calma (gente, patrulla)
};

export class FlightPlanner {
  constructor(nav) {
    const n = nav.nodes.length;
    this.nav = nav;
    this.prev = new Int32Array(n);
    this.depth = new Int16Array(n);
    this.closest = new Float32Array(n);
    this.crossings = new Int16Array(n);
    this.first = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.visit = 0;
    this.bestIds = new Int32Array(FLIGHT.shortlist);
    this.bestScores = new Float32Array(FLIGHT.shortlist);
    this.lastScore = -Infinity;
  }

  /**
   * El mejor destino para huir de (tx, tz) desde (x, z), o −1 si no hay ninguno que lo aleje. `bonus(px, pz)`
   * suma puntos por lo que hay allá (gente, una patrulla); se mira solo para los mejores candidatos.
   */
  plan(x, z, tx, tz, bonus = null) {
    const nav = this.nav, T = nav.tileSize;
    let start = nav.nodeAt(x, z);
    if (start < 0 || !nav.nodes[start].main) start = nav._nearestNode(x, z);
    if (start < 0) return -1;
    const stamp = ++this.visit;
    const { prev, depth, closest, crossings, first, queue } = this;
    const sx = nav.nodes[start].x * T, sz = nav.nodes[start].z * T;
    const startD = hypot(sx - tx, sz - tz);
    const keep = Math.max(Math.min(FLIGHT.keep, startD - .5), startD * FLIGHT.keepShare);
    const slack = startD > 6 ? FLIGHT.slackFar : FLIGHT.slack;
    const ids = this.bestIds, scores = this.bestScores;
    let kept = 0;
    this.stamp[start] = stamp; prev[start] = start; depth[start] = 0; closest[start] = startD; crossings[start] = 0; first[start] = start;
    queue[0] = start;
    let head = 0, tail = 1;
    while (head < tail) {
      const id = queue[head++], node = nav.nodes[id];
      const px = node.x * T, pz = node.z * T, d = hypot(px - tx, pz - tz);
      if (id !== start && depth[id] >= FLIGHT.minDepth && !node.crossing && closest[id] >= keep) {
        const firstNode = nav.nodes[first[id]];
        const firstD = hypot(firstNode.x * T - tx, firstNode.z * T - tz);
        const gain = d - startD;
        if (gain >= FLIGHT.gain && firstD >= startD - slack) {
          const score = gain - crossings[id] * FLIGHT.crossCost;
          // Lista corta de los mejores, ordenada de mayor a menor.
          if (kept < ids.length || score > scores[kept - 1]) {
            let k = kept < ids.length ? kept++ : kept - 1;
            while (k > 0 && scores[k - 1] < score) { ids[k] = ids[k - 1]; scores[k] = scores[k - 1]; k--; }
            ids[k] = id; scores[k] = score;
          }
        }
      }
      if (depth[id] >= FLIGHT.depth) continue;
      for (const next of node.neighbors) {
        if (this.stamp[next] === stamp) continue;
        const other = nav.nodes[next];
        this.stamp[next] = stamp;
        prev[next] = id;
        depth[next] = depth[id] + 1;
        crossings[next] = crossings[id] + (other.crossing ? 1 : 0);
        closest[next] = Math.min(closest[id], hypot(other.x * T - tx, other.z * T - tz));
        first[next] = id === start ? next : first[id];
        queue[tail++] = next;
      }
    }
    if (!kept) { this.lastScore = -Infinity; return -1; }
    let best = ids[0], bestScore = -Infinity;
    for (let k = 0; k < kept; k++) {
      const node = nav.nodes[ids[k]];
      const score = scores[k] + (bonus ? bonus(node.x * T, node.z * T) : 0);
      if (score > bestScore) { bestScore = score; best = ids[k]; }
    }
    this.lastScore = bestScore;
    return best;
  }

  /** La ruta del último plan hasta `goal`: los centros de baldosa desde la de partida. */
  route(goal) {
    const nav = this.nav, route = [];
    for (let id = goal; ; id = this.prev[id]) {
      route.push(nav._point(id));
      if (this.prev[id] === id) break;
    }
    return route.reverse();
  }
}
