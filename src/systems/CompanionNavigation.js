import * as THREE from 'three';

/** Una cuadrícula compartida con el mapa; BFS solo al cambiar de destino, sin física extra. */
export class CompanionNavigation {
  constructor(district, collisions) {
    this.district = district;
    this.collisions = collisions;
    this.step = 2;
    this.width = district.map?.[0]?.length ?? 0;
    this.height = district.map?.length ?? 0;
    this.previous = new Int32Array(this.width * this.height);
    this.queue = new Int32Array(this.previous.length);
    this.walkable = new Uint8Array(this.previous.length);
    this.edges = new Uint8Array(this.previous.length);
    this.checked = new Uint8Array(this.previous.length);
    for (let z = 0; z < this.height; z++) for (let x = 0; x < this.width; x++) {
      this.walkable[z * this.width + x] = this.isOpen(x * this.step, z * this.step) ? 1 : 0;
    }
  }

  isOpen(x, z) {
    if (!this.district.isWalkableAt(x, z)) return false;
    return !(this.collisions?.colliders ?? []).some(({ box }) =>
      box && box.min.y <= 1.2 && box.max.y >= 0.05 &&
      x > box.min.x - .24 && x < box.max.x + .24 && z > box.min.z - .24 && z < box.max.z + .24);
  }

  clearLine(from, to) {
    const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .3));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      if (!this.isOpen(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) return false;
    }
    return true;
  }

  nearest(position) {
    let id = -1, best = Infinity;
    for (let i = 0; i < this.walkable.length; i++) {
      if (!this.walkable[i]) continue;
      const dx = (i % this.width) * this.step - position.x;
      const dz = Math.floor(i / this.width) * this.step - position.z;
      const d = dx * dx + dz * dz;
      if (d < best) { id = i; best = d; }
    }
    return id;
  }

  point(id) {
    const x = (id % this.width) * this.step, z = Math.floor(id / this.width) * this.step;
    return new THREE.Vector3(x, this.district.getGroundHeight?.(x, z) ?? 0, z);
  }

  route(from, to) {
    if (this.clearLine(from, to)) return [to.clone()];
    const start = this.nearest(from), target = this.nearest(to);
    if (start < 0 || target < 0) return [];
    const previous = this.previous, queue = this.queue;
    previous.fill(-1); previous[start] = start; queue[0] = start;
    let head = 0, tail = 1;
    while (head < tail && previous[target] < 0) {
      const id = queue[head++], x = id % this.width, z = Math.floor(id / this.width);
      const neighbors = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]];
      for (let direction = 0; direction < 4; direction++) {
        const [nx, nz] = neighbors[direction];
        if (nx < 0 || nz < 0 || nx >= this.width || nz >= this.height) continue;
        const next = nz * this.width + nx;
        if (!this.walkable[next] || previous[next] >= 0) continue;
        const bit = 1 << direction;
        if (!(this.checked[id] & bit)) {
          this.checked[id] |= bit;
          if (this.clearLine(this.point(id), this.point(next))) this.edges[id] |= bit;
        }
        if (!(this.edges[id] & bit)) continue;
        previous[next] = id; queue[tail++] = next;
      }
    }
    if (previous[target] < 0) return [];
    const route = [];
    for (let id = target; id !== start; id = previous[id]) route.push(this.point(id));
    route.push(this.point(start)); route.reverse();
    if (!this.clearLine(from, route[0])) {
      if (route.length > 1 && this.clearLine(from, route[1])) {
        route.shift();
      }
    }
    return route;
  }
}
