// src/systems/RouteFinder.js
// Ruta a pie hasta el destino marcado en el mapa (como el GPS de GTA). A* sobre la grilla
// de tiles del distrito: prefiere andenes y plazas, cruza la calle cuando conviene y evita
// manzanas, agua y el carril del TransMilenio.

const COSTS = {
  sidewalk: 1, plaza: 1, floor: 1, terminal: 1,
  dirt: 1.1, grass: 1.15, road: 1.3, busway: 4
};
const DIAGONAL = Math.SQRT2;

export class RouteFinder {
  /**
   * @param {{ tile: number, tx0: number, tz0: number, tx1: number, tz1: number,
   *   typeAt: (tx:number, tz:number) => string|null }} city descripción de describeCity
   * @param {(x:number, z:number) => boolean} isWalkable
   */
  constructor(city, isWalkable = () => true) {
    this.tile = city.tile;
    this.tx0 = city.tx0; this.tz0 = city.tz0;
    this.cols = city.tx1 - city.tx0 + 1;
    this.rows = city.tz1 - city.tz0 + 1;
    const count = this.cols * this.rows;
    this.cost = new Float32Array(count); // 0 = no transitable
    this.street = new Uint8Array(count); // asfalto: se cruza en perpendicular, nunca en diagonal
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tx = c + this.tx0, tz = r + this.tz0;
        const type = city.typeAt(tx, tz);
        if (!type || !isWalkable(tx * this.tile, tz * this.tile)) continue;
        this.cost[r * this.cols + c] = COSTS[type] ?? 1.2;
        this.street[r * this.cols + c] = type === 'road' || type === 'busway' ? 1 : 0;
      }
    }
    this._g = new Float32Array(count);
    this._from = new Int32Array(count);
    this._stamp = new Uint32Array(count);
    this._closed = new Uint32Array(count);
    this._search = 0;
  }

  _cell(x, z) {
    const c = Math.round(x / this.tile) - this.tx0, r = Math.round(z / this.tile) - this.tz0;
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }

  _point(cell) {
    return { x: (cell % this.cols + this.tx0) * this.tile, z: (Math.floor(cell / this.cols) + this.tz0) * this.tile };
  }

  isWalkable(x, z) {
    const cell = this._cell(x, z);
    return cell >= 0 && this.cost[cell] > 0;
  }

  /** Celda transitable más cercana (p. ej. si el destino cae sobre un edificio). */
  nearestWalkable(x, z, maxRadius = 30) {
    const c0 = Math.round(x / this.tile) - this.tx0, r0 = Math.round(z / this.tile) - this.tz0;
    const maxRing = Math.ceil(maxRadius / this.tile);
    for (let ring = 0; ring <= maxRing; ring++) {
      let best = -1, bestDist = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const cell = r * this.cols + c;
          if (!this.cost[cell]) continue;
          const d = dc * dc + dr * dr;
          if (d < bestDist) { best = cell; bestDist = d; }
        }
      }
      if (best >= 0) return this._point(best);
    }
    return null;
  }

  /**
   * @returns {{x:number, z:number}[] | null} puntos del mundo desde el origen hasta el destino
   */
  find(from, to) {
    const start = this._cell(...this._snap(from)), goal = this._cell(...this._snap(to));
    if (start < 0 || goal < 0) return null;
    const search = ++this._search;
    const { cols, cost, _g: g, _from: came, _stamp: stamp, _closed: closed } = this;
    const gc = goal % cols, gr = Math.floor(goal / cols);
    const h = cell => {
      const dc = Math.abs(cell % cols - gc), dr = Math.abs(Math.floor(cell / cols) - gr);
      return Math.max(dc, dr) + (DIAGONAL - 1) * Math.min(dc, dr);
    };
    const heap = new MinHeap();
    g[start] = 0; came[start] = -1; stamp[start] = search;
    heap.push(start, h(start));
    while (heap.size) {
      const cell = heap.pop();
      if (closed[cell] === search) continue;
      closed[cell] = search;
      if (cell === goal) return this._smooth(this._trace(goal), from, to);
      const c = cell % cols, r = Math.floor(cell / cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) continue;
          const next = nr * cols + nc;
          if (!cost[next] || closed[next] === search) continue;
          // En diagonal no se cortan esquinas de manzanas.
          if (dr && dc && (!cost[r * cols + nc] || !cost[nr * cols + c])) continue;
          // Las calles se siguen y se cruzan en ángulo recto, como la ruta del GPS.
          if (dr && dc && (this.street[cell] || this.street[next] || this.street[r * cols + nc] || this.street[nr * cols + c])) continue;
          const step = (dr && dc ? DIAGONAL : 1) * (cost[cell] + cost[next]) / 2;
          const score = g[cell] + step;
          if (stamp[next] === search && score >= g[next]) continue;
          stamp[next] = search; g[next] = score; came[next] = cell;
          heap.push(next, score + h(next));
        }
      }
    }
    return null;
  }

  _snap(point) {
    if (this.isWalkable(point.x, point.z)) return [point.x, point.z];
    const near = this.nearestWalkable(point.x, point.z);
    return near ? [near.x, near.z] : [point.x, point.z];
  }

  _trace(goal) {
    const cells = [];
    for (let cell = goal; cell >= 0; cell = this._from[cell]) cells.push(cell);
    return cells.reverse();
  }

  /** Quita puntos alineados y atajos rectos por zonas del mismo costo. */
  _smooth(cells, from, to) {
    const points = cells.map(cell => this._point(cell));
    const out = [points[0]];
    let anchor = 0;
    for (let i = 2; i < points.length; i++) {
      if (!this._straight(points[anchor], points[i])) {
        out.push(points[i - 1]);
        anchor = i - 1;
      }
    }
    if (points.length > 1) out.push(points[points.length - 1]);
    // Extremos exactos cuando son transitables.
    if (this.isWalkable(from.x, from.z)) out[0] = { x: from.x, z: from.z };
    if (this.isWalkable(to.x, to.z)) out[out.length - 1] = { x: to.x, z: to.z };
    return out;
  }

  /** El tramo recto solo pasa por celdas transitables del mismo costo que su inicio. */
  _straight(a, b) {
    const base = this.cost[this._cell(a.x, a.z)];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.tile * .5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cost = this.cost[this._cell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)];
      if (!cost || cost !== base) return false;
    }
    return true;
  }
}

/** Distancia de la ruta restante y el índice del tramo más cercano al jugador. */
export function routeProgress(route, x, z) {
  let best = 0, bestDist = Infinity, bestT = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const vx = b.x - a.x, vz = b.z - a.z, len = vx * vx + vz * vz;
    const t = len ? Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / len)) : 0;
    const d = Math.hypot(a.x + vx * t - x, a.z + vz * t - z);
    if (d < bestDist) { best = i; bestDist = d; bestT = t; }
  }
  let remaining = 0;
  if (route.length > 1) {
    const a = route[best], b = route[best + 1];
    remaining = Math.hypot(b.x - a.x, b.z - a.z) * (1 - bestT) + bestDist;
    for (let i = best + 1; i < route.length - 1; i++) remaining += Math.hypot(route[i + 1].x - route[i].x, route[i + 1].z - route[i].z);
  }
  return { segment: best, offRoute: bestDist, remaining };
}

class MinHeap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const { items, keys } = this;
    let i = items.length;
    items.push(item); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p]; keys[i] = keys[p]; i = p;
    }
    items[i] = item; keys[i] = key;
  }
  pop() {
    const { items, keys } = this;
    const top = items[0], lastItem = items.pop(), lastKey = keys.pop();
    if (items.length) {
      let i = 0;
      const n = items.length;
      while (true) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        items[i] = items[child]; keys[i] = keys[child]; i = child;
      }
      items[i] = lastItem; keys[i] = lastKey;
    }
    return top;
  }
}
