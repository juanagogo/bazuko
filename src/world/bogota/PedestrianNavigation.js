import * as THREE from 'three';

const PEDESTRIAN_TILES = new Set(['sidewalk', 'dirt', 'grass', 'plaza', 'floor']);
const TRAFFIC_TILES = new Set(['road', 'busway']);
/** Lo más que sube o baja un tramo: un escalón o un bordillo. Más que eso no se camina, sería saltar de piso. */
const MAX_STEP = .6;

/** Red compartida: rutas por centros de tiles, sin diagonales que corten esquinas. */
export class PedestrianNavigation {
  /**
   * `isUnderDeck` marca calzada que no lleva tráfico abajo porque va por encima, como el bus sobre el puente:
   * sigue siendo de paso, pero lo sólido sí le corta los tramos, porque ahí no hay reparto de cruce que cuidar.
   */
  constructor(map, tileSize, { isCrossing = () => false, isBlocked = () => false, groundHeight = () => 0, isUnderDeck = () => false } = {}) {
    this.tileSize = tileSize;
    this.groundHeight = groundHeight;
    this.nodes = [];
    this.grid = map.map(row => new Int32Array(row.length).fill(-1));
    for (let z = 0; z < map.length; z++) for (let x = 0; x < map[z].length; x++) {
      const type = map[z][x];
      if (isBlocked(x, z) || !(PEDESTRIAN_TILES.has(type) || (TRAFFIC_TILES.has(type) && isCrossing(x, z)))) continue;
      this.grid[z][x] = this.nodes.length;
      this.nodes.push({ x, z, crossing: TRAFFIC_TILES.has(type), underDeck: isUnderDeck(x, z), neighbors: [] });
    }
    const heightOf = ({ x, z }) => groundHeight(x * tileSize, z * tileSize);
    for (const node of this.nodes) {
      const height = heightOf(node);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const id = this.grid[node.z + dz]?.[node.x + dx] ?? -1;
        if (id >= 0 && Math.abs(heightOf(this.nodes[id]) - height) <= MAX_STEP) node.neighbors.push(id);
      }
    }
    this._markMainNetwork();
    // Se reutilizan entre NPC; solo se buscan rutas al terminar un recorrido.
    this._queue = new Int32Array(this.nodes.length);
    this._previous = new Int32Array(this.nodes.length);
    this._distance = new Int32Array(this.nodes.length);
  }

  /** La red principal es el grupo más grande de nodos unidos entre sí. De un bolsillo suelto no se llega a ninguna parte. */
  _markMainNetwork() {
    const group = new Int32Array(this.nodes.length).fill(-1), sizes = [];
    this.nodes.forEach((_, first) => {
      if (group[first] >= 0) return;
      const stack = [first], id = sizes.length;
      let size = 0;
      group[first] = id;
      while (stack.length) {
        size++;
        for (const next of this.nodes[stack.pop()].neighbors) {
          if (group[next] < 0) { group[next] = id; stack.push(next); }
        }
      }
      sizes.push(size);
    });
    const main = sizes.indexOf(Math.max(...sizes));
    this.nodes.forEach((node, id) => { node.main = group[id] === main; });
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
      if (node.crossing || !node.neighbors.length) continue;
      const d = (node.x * this.tileSize - x) ** 2 + (node.z * this.tileSize - z) ** 2;
      if (d < distance) { distance = d; nearest = i; }
    }
    return nearest < 0 ? null : this._point(nearest);
  }

  /**
   * Corta los tramos que atraviesan algo sólido: una columna, un muro, una caja. Los nodos se quedan, por quien
   * ya esté parado ahí, pero nadie vuelve a pasar por esos tramos. Se hace una vez, con la ciudad ya armada.
   * `furniture` son las cajas { minX, maxX, minZ, maxZ } de lo que estorba sin tener colisión: las bancas.
   */
  cutSolidEdges(collisions, radius = .2, furniture = []) {
    const found = [], tile = this.tileSize;
    this.nodes.forEach((node, id) => {
      for (const other of [...node.neighbors]) {
        const next = this.nodes[other];
        // Los cruces siguen como están: de ahí depende el tráfico. Bajo un tablero no hay tráfico que cuidar.
        if (other < id || (node.crossing && !node.underDeck) || (next.crossing && !next.underDeck)) continue;
        const minX = Math.min(node.x, next.x) * tile - radius, maxX = Math.max(node.x, next.x) * tile + radius;
        const minZ = Math.min(node.z, next.z) * tile - radius, maxZ = Math.max(node.z, next.z) * tile + radius;
        const low = Math.min(this.groundHeight(node.x * tile, node.z * tile), this.groundHeight(next.x * tile, next.z * tile));
        const solid = furniture.some(box => box.maxX > minX && box.minX < maxX && box.maxZ > minZ && box.minZ < maxZ)
          || collisions.queryStatic(minX, minZ, maxX, maxZ, found).some(({ box }) =>
          box.max.x > minX && box.min.x < maxX && box.max.z > minZ && box.min.z < maxZ && box.max.y > low + .5 && box.min.y < low + 1.2);
        if (!solid) continue;
        node.neighbors.splice(node.neighbors.indexOf(other), 1);
        next.neighbors.splice(next.neighbors.indexOf(id), 1);
      }
    });
    this._markMainNetwork();
  }

  createRoute(position, random = Math.random) {
    let start = this.nodeAt(position.x, position.z);
    if (start >= 0 && !this.nodes[start].main) start = this._nearestNode(position.x, position.z); // quedó encerrado por lo sólido
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

  /** Nodo de la red principal, que no sea cruce, más cercano a un punto que no cae en ella (una banca, un rincón, un bolsillo encerrado). */
  _nearestNode(x, z) {
    const here = this.nodeAt(x, z);
    if (here >= 0 && this.nodes[here].main && this.nodes[here].neighbors.length) return here;
    let nearest = -1, distance = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node.crossing || !node.main || !node.neighbors.length) continue;
      const d = (node.x * this.tileSize - x) ** 2 + (node.z * this.tileSize - z) ** 2;
      if (d < distance) { distance = d; nearest = i; }
    }
    return nearest;
  }

  /** ¿Está en el centro de una baldosa que no es cruce? Es donde se puede esperar sin estorbarle a nadie. */
  isRestingAt({ x, z }) {
    const node = this.nodes[this.nodeAt(x, z)];
    return !!node && !node.crossing && node.neighbors.length > 0 && Math.hypot(node.x * this.tileSize - x, node.z * this.tileSize - z) < .05;
  }

  /**
   * Ruta corta al centro de la baldosa de andén más cercana por la red: para esperar sin estorbar. Quien ya
   * está en una baldosa normal solo va a su centro; quien está en un cruce sale por el lado más corto.
   */
  routeToRest(from) {
    const start = this._nearestNode(from.x, from.z);
    if (start < 0) return [];
    const queue = this._queue, previous = this._previous;
    previous.fill(-1);
    previous[start] = start;
    queue[0] = start;
    let head = 0, tail = 1;
    while (head < tail) {
      const id = queue[head++];
      if (!this.nodes[id].crossing) {
        const route = [];
        for (let at = id; at !== start; at = previous[at]) route.push(this._point(at));
        if (id === start) route.push(this._point(start));
        return route.reverse();
      }
      for (const next of this.nodes[id].neighbors) {
        if (previous[next] !== -1) continue;
        previous[next] = id;
        queue[tail++] = next;
      }
    }
    return [];
  }

  /**
   * Ruta de vuelta a un sitio: el último tramo es recto hasta el punto exacto, que puede quedar fuera
   * de la red. Vacía si no hay camino. Se pide rara vez: solo quien se asustó y regresa a su lugar.
   */
  routeTo(from, to) {
    const start = this._nearestNode(from.x, from.z), goal = this._nearestNode(to.x, to.z);
    if (start < 0 || goal < 0) return [];
    const queue = this._queue, previous = this._previous;
    previous.fill(-1);
    previous[start] = start;
    queue[0] = start;
    let head = 0, tail = 1;
    while (head < tail && previous[goal] === -1) {
      for (const next of this.nodes[queue[head++]].neighbors) {
        if (previous[next] !== -1) continue;
        previous[next] = queue[head - 1];
        queue[tail++] = next;
      }
    }
    if (previous[goal] === -1) return [];
    const route = [to.clone()];
    for (let id = goal; id !== start; id = previous[id]) route.push(this._point(id));
    return route.reverse();
  }
}
