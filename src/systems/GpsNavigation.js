// src/systems/GpsNavigation.js
// GPS a pie: A* sobre la grilla de tiles con preferencia por andenes y cruces.
// La grilla incluye filas con Z negativa para la extensión del Portal del Centro.

const SQRT2 = Math.SQRT2;
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export const GPS_ARRIVAL_DISTANCE = 4;
export const GPS_OFF_ROUTE_DISTANCE = 6;
const REPLAN_INTERVAL = 1000;

export class GpsNavigation {
  /**
   * @param {{width: number, zMin: number, zMax: number, tileSize?: number, cost: (tx: number, tz: number) => number}} grid
   * `cost` devuelve el coste de pisar el tile (Infinity si no es transitable).
   */
  constructor({ width, zMin, zMax, tileSize = 2, cost }) {
    this.tileSize = tileSize;
    this.width = width;
    this.zMin = zMin;
    this.height = zMax - zMin + 1;
    const size = this.width * this.height;
    this.cost = new Float32Array(size);
    for (let row = 0; row < this.height; row++) for (let x = 0; x < width; x++) {
      this.cost[row * width + x] = cost(x, row + zMin);
    }
    // Búfers reutilizados entre búsquedas; `stamp` evita limpiar los arreglos.
    this._g = new Float32Array(size);
    this._parent = new Int32Array(size);
    this._stamp = new Uint32Array(size);
    this._closed = new Uint32Array(size);
    this._search = 0;
    this._heap = new Int32Array(size * 8);
    this._heapF = new Float32Array(size * 8);

    this.waypoint = null;
    this.route = [];
    this.routeLength = 0;
    this._suffix = [];
    this._progress = 0;
    this._lastPlan = -Infinity;
  }

  _index(tx, tz) {
    const row = tz - this.zMin;
    if (tx < 0 || tx >= this.width || row < 0 || row >= this.height) return -1;
    return row * this.width + tx;
  }

  costAt(x, z) {
    const i = this._index(Math.round(x / this.tileSize), Math.round(z / this.tileSize));
    return i < 0 ? Infinity : this.cost[i];
  }

  isRoutable(x, z) { return Number.isFinite(this.costAt(x, z)); }

  /** Tile transitable más cercano (en espiral), útil para destinos dentro de edificios. */
  _nearestOpen(x, z, maxRadius = 16) {
    const tx = Math.round(x / this.tileSize), tz = Math.round(z / this.tileSize);
    const direct = this._index(tx, tz);
    if (direct >= 0 && Number.isFinite(this.cost[direct])) return direct;
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= maxRadius && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const i = this._index(tx + dx, tz + dz);
        if (i < 0 || !Number.isFinite(this.cost[i])) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }

  _point(i) {
    return { x: (i % this.width) * this.tileSize, z: (Math.floor(i / this.width) + this.zMin) * this.tileSize };
  }

  _push(size, node, f) {
    const heap = this._heap, heapF = this._heapF;
    let i = size;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapF[parent] <= f) break;
      heap[i] = heap[parent]; heapF[i] = heapF[parent];
      i = parent;
    }
    heap[i] = node; heapF[i] = f;
  }

  _pop(size) {
    const heap = this._heap, heapF = this._heapF;
    const top = heap[0];
    const last = heap[size - 1], lastF = heapF[size - 1];
    let i = 0;
    const n = size - 1;
    while (true) {
      let child = 2 * i + 1;
      if (child >= n) break;
      if (child + 1 < n && heapF[child + 1] < heapF[child]) child++;
      if (heapF[child] >= lastF) break;
      heap[i] = heap[child]; heapF[i] = heapF[child];
      i = child;
    }
    heap[i] = last; heapF[i] = lastF;
    return top;
  }

  /** Ruta en coordenadas del mundo, o null si no hay camino a pie. */
  findPath(from, to) {
    const start = this._nearestOpen(from.x, from.z, 6);
    const goal = this._nearestOpen(to.x, to.z);
    if (start < 0 || goal < 0) return null;
    const width = this.width, cost = this.cost, g = this._g, parent = this._parent;
    const stamp = this._stamp, closed = this._closed;
    const search = ++this._search;
    const gx = goal % width, gz = Math.floor(goal / width);
    const h = (i) => {
      const dx = Math.abs((i % width) - gx), dz = Math.abs(Math.floor(i / width) - gz);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    stamp[start] = search; g[start] = 0; parent[start] = -1;
    let size = 0;
    this._push(size++, start, h(start));
    let found = false;
    while (size > 0) {
      const current = this._pop(size--);
      if (closed[current] === search) continue;
      closed[current] = search;
      if (current === goal) { found = true; break; }
      const cx = current % width, cz = Math.floor(current / width);
      for (const [dx, dz] of NEIGHBORS) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nx >= width || nz < 0 || nz >= this.height) continue;
        const next = nz * width + nx;
        const step = cost[next];
        if (!Number.isFinite(step) || closed[next] === search) continue;
        // Sin cortar esquinas de edificios en diagonal.
        if (dx && dz && (!Number.isFinite(cost[cz * width + nx]) || !Number.isFinite(cost[nz * width + cx]))) continue;
        const tentative = g[current] + step * (dx && dz ? SQRT2 : 1);
        if (stamp[next] === search && tentative >= g[next]) continue;
        stamp[next] = search; g[next] = tentative; parent[next] = current;
        if (size < this._heap.length) this._push(size++, next, tentative + h(next));
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i >= 0; i = parent[i]) cells.push(i);
    cells.reverse();
    return this._smooth(cells);
  }

  /**
   * Línea de visión sobre la grilla: cada tile atravesado debe pertenecer a la ruta
   * original o costar como mucho lo mismo que los tiles que el atajo omite.
   */
  _clear(a, b, maxCost) {
    const pa = this._point(a), pb = this._point(b);
    const steps = Math.ceil(Math.hypot(pb.x - pa.x, pb.z - pa.z) / (this.tileSize * .35));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const i = this._index(Math.round((pa.x + (pb.x - pa.x) * t) / this.tileSize),
        Math.round((pa.z + (pb.z - pa.z) * t) / this.tileSize));
      if (i < 0 || !(this.cost[i] <= maxCost || this._closed[i] === this._pathMark)) return false;
    }
    return true;
  }

  _smooth(cells) {
    if (cells.length <= 2) return cells.map(i => this._point(i));
    // `_closed` ya no se usa tras la búsqueda; marca las celdas de la ruta con un sello propio.
    this._pathMark = ++this._search;
    for (const i of cells) this._closed[i] = this._pathMark;
    const points = [this._point(cells[0])];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let next = anchor + 1, maxCost = 0;
      for (let j = anchor + 2; j < cells.length; j++) {
        const segmentMax = Math.max(maxCost, this.cost[cells[j - 1]]);
        if (!this._clear(cells[anchor], cells[j], segmentMax)) break;
        next = j; maxCost = segmentMax;
      }
      points.push(this._point(cells[next]));
      anchor = next;
    }
    return points;
  }

  /**
   * Fija un destino y calcula la ruta desde `from`.
   * @returns {boolean} true si existe ruta a pie.
   */
  setWaypoint(waypoint, from, now = performance.now()) {
    if (!waypoint || !Number.isFinite(waypoint.x) || !Number.isFinite(waypoint.z)) return false;
    this.waypoint = { name: 'Punto marcado', icon: '📍', ...waypoint };
    return this._plan(from, now);
  }

  clear() {
    this.waypoint = null;
    this.route = [];
    this.routeLength = 0;
    this._suffix = [];
    this._progress = 0;
  }

  _plan(from, now) {
    this._lastPlan = now;
    const path = from ? this.findPath(from, this.waypoint) : null;
    if (!path) {
      this.route = [];
      this.routeLength = 0;
      this._suffix = [];
      return false;
    }
    // El último punto es el destino real aunque esté dentro de un solar.
    const end = path[path.length - 1];
    if (Math.hypot(end.x - this.waypoint.x, end.z - this.waypoint.z) > .5 && this.isRoutable(this.waypoint.x, this.waypoint.z)) {
      path.push({ x: this.waypoint.x, z: this.waypoint.z });
    }
    this.route = path;
    this._suffix = new Array(path.length).fill(0);
    for (let i = path.length - 2; i >= 0; i--) {
      this._suffix[i] = this._suffix[i + 1] + Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
    }
    this.routeLength = this._suffix[0] ?? 0;
    this._progress = 0;
    return true;
  }

  /** Distancia del jugador a la ruta y avance del tramo actual. */
  _track(pos) {
    const route = this.route;
    let best = Infinity, bestSeg = this._progress;
    // Solo se busca hacia adelante para no retroceder en rutas que se cruzan.
    for (let i = this._progress; i < route.length - 1 && i < this._progress + 12; i++) {
      const a = route[i], b = route[i + 1];
      const vx = b.x - a.x, vz = b.z - a.z, len2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((pos.x - a.x) * vx + (pos.z - a.z) * vz) / len2));
      const d = Math.hypot(a.x + vx * t - pos.x, a.z + vz * t - pos.z);
      if (d < best - .01) { best = d; bestSeg = i; }
    }
    this._progress = bestSeg;
    return best;
  }

  /**
   * Avanza el GPS. Devuelve 'arrived' al llegar, 'replanned' al recalcular o null.
   */
  update(pos, now = performance.now()) {
    if (!this.waypoint || !pos) return null;
    if (Math.hypot(pos.x - this.waypoint.x, pos.z - this.waypoint.z) < GPS_ARRIVAL_DISTANCE) {
      const reached = this.waypoint;
      this.clear();
      this.lastArrival = reached;
      return 'arrived';
    }
    const off = this.route.length > 1 ? this._track(pos) : Infinity;
    if (off > GPS_OFF_ROUTE_DISTANCE && now - this._lastPlan >= REPLAN_INTERVAL) {
      this._plan(pos, now);
      return 'replanned';
    }
    return null;
  }

  /** Puntos que faltan, empezando por el jugador. */
  remainingRoute(pos) {
    if (!this.route.length) return [];
    return [{ x: pos.x, z: pos.z }, ...this.route.slice(this._progress + 1)];
  }

  remainingDistance(pos) {
    if (!this.waypoint) return 0;
    const next = this.route[this._progress + 1];
    if (!next) return Math.hypot(this.waypoint.x - pos.x, this.waypoint.z - pos.z);
    return Math.hypot(next.x - pos.x, next.z - pos.z) + this._suffix[this._progress + 1];
  }

  /** Punto de la ruta a `ahead` metros del jugador, para indicar el giro siguiente. */
  lookAhead(pos, ahead = 10) {
    if (!this.waypoint) return null;
    const route = this.remainingRoute(pos);
    if (route.length < 2) return { x: this.waypoint.x, z: this.waypoint.z };
    let left = ahead;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len >= left) { const t = left / (len || 1); return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; }
      left -= len;
    }
    return route[route.length - 1];
  }

  serialize() {
    if (!this.waypoint) return null;
    const { x, z, name, icon } = this.waypoint;
    return { x, z, name, icon };
  }
}
