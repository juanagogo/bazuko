import * as THREE from 'three';

const PEDESTRIAN_TILES = new Set(['sidewalk', 'dirt', 'grass', 'plaza', 'floor']);
const TRAFFIC_TILES = new Set(['road', 'busway']);

/** Red compartida: rutas por centros de tiles, sin diagonales que corten esquinas. */
export class PedestrianNavigation {
  constructor(map, tileSize, { isCrossing = () => false, isBlocked = () => false, groundHeight = () => 0 } = {}) {
    this.tileSize = tileSize;
    this.groundHeight = groundHeight;
    this.nodes = [];
    this.grid = map.map(row => new Int32Array(row.length).fill(-1));
    for (let z = 0; z < map.length; z++) for (let x = 0; x < map[z].length; x++) {
      const type = map[z][x];
      if (isBlocked(x, z) || !(PEDESTRIAN_TILES.has(type) || (TRAFFIC_TILES.has(type) && isCrossing(x, z)))) continue;
      this.grid[z][x] = this.nodes.length;
      this.nodes.push({ x, z, crossing: TRAFFIC_TILES.has(type), neighbors: [] });
    }
    for (const node of this.nodes) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const id = this.grid[node.z + dz]?.[node.x + dx] ?? -1;
        if (id >= 0) node.neighbors.push(id);
      }
    }
    // Se reutilizan entre NPC; solo se buscan rutas al terminar un recorrido.
    this._queue = new Int32Array(this.nodes.length);
    this._previous = new Int32Array(this.nodes.length);
    this._distance = new Int32Array(this.nodes.length);
  }

  nodeAt(x, z) {
    return this.grid[Math.round(z / this.tileSize)]?.[Math.round(x / this.tileSize)] ?? -1;
  }

  isWalkableAt(x, z) { return this.nodeAt(x, z) >= 0; }

  _point(id) {
    const node = this.nodes[id];
    const x = node.x * this.tileSize, z = node.z * this.tileSize;
    return new THREE.Vector3(x, this.groundHeight(x, z), z);
  }

  nearestPoint(x, z) {
    let nearest = -1, distance = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node.crossing) continue;
      const d = (node.x * this.tileSize - x) ** 2 + (node.z * this.tileSize - z) ** 2;
      if (d < distance) { distance = d; nearest = i; }
    }
    return nearest < 0 ? null : this._point(nearest);
  }

  createRoute(position, random = Math.random) {
    const start = this.nodeAt(position.x, position.z);
    if (start < 0) return [];
    const queue = this._queue, previous = this._previous, distance = this._distance;
    previous.fill(-1);
    previous[start] = start;
    distance[start] = 0;
    queue[0] = start;
    let head = 0, tail = 1;
    const destinations = [], nearby = [];
    while (head < tail) {
      const id = queue[head++], node = this.nodes[id];
      if (id !== start && !node.crossing) {
        nearby.push(id);
        if (distance[id] >= 8) destinations.push(id);
      }
      if (distance[id] >= 22) continue;
      for (const next of node.neighbors) {
        if (previous[next] !== -1) continue;
        previous[next] = id;
        distance[next] = distance[id] + 1;
        queue[tail++] = next;
      }
    }
    const choices = destinations.length ? destinations : nearby;
    if (!choices.length) return [];
    let id = choices[Math.floor(random() * choices.length)];
    const route = [];
    while (id !== start) { route.push(this._point(id)); id = previous[id]; }
    route.push(this._point(start));
    return route.reverse();
  }

  /** Ruta más corta hasta `goal`, de a lo sumo `maxSteps` tiles; `[]` si no es alcanzable. */
  createRouteTo(position, goal, maxSteps = 60) {
    const start = this.nodeAt(position.x, position.z), end = this.nodeAt(goal.x, goal.z);
    if (start < 0 || end < 0) return [];
    const queue = this._queue, previous = this._previous, distance = this._distance;
    previous.fill(-1);
    previous[start] = start;
    distance[start] = 0;
    queue[0] = start;
    let head = 0, tail = 1;
    while (head < tail && previous[end] === -1) {
      const id = queue[head++];
      if (distance[id] >= maxSteps) continue;
      for (const next of this.nodes[id].neighbors) {
        if (previous[next] !== -1) continue;
        previous[next] = id;
        distance[next] = distance[id] + 1;
        queue[tail++] = next;
      }
    }
    if (previous[end] === -1) return [];
    const route = [];
    for (let id = end; id !== start; id = previous[id]) route.push(this._point(id));
    route.push(this._point(start));
    return route.reverse();
  }
}
