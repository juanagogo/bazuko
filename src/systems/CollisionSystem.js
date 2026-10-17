import * as THREE from 'three';

const CELL = 4; // tamaño de celda de la grilla espacial (unidades de mundo)

export class CollisionSystem {
  constructor() {
    this.colliders = [];   // { box: THREE.Box3, mesh }
    this.circles = [];     // { x, z, r, enabled } obstáculos circulares dinámicos (bolsas, etc.)
    this.boxes = [];       // { x, z, hx, hz, enabled } cajas alineadas a los ejes que se mueven (buses)
    this._grid = new Map(); // "cx,cz" -> collider[]
    this._out = new THREE.Vector3(); // resultado reutilizable de resolveMove
    this._cand = [];
  }

  /** Registra un mesh como sólido. size opcional para hitbox custom. */
  add(mesh, size) {
    const box = size
      ? new THREE.Box3().setFromCenterAndSize(
          mesh.position.clone().setY(mesh.position.y + size.y / 2),
          size
        )
      : new THREE.Box3().setFromObject(mesh);
    const c = { box, mesh };
    this.colliders.push(c);
    const x0 = Math.floor(box.min.x / CELL), x1 = Math.floor(box.max.x / CELL);
    const z0 = Math.floor(box.min.z / CELL), z1 = Math.floor(box.max.z / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = cx + ',' + cz;
        let a = this._grid.get(k);
        if (!a) this._grid.set(k, (a = []));
        a.push(c);
      }
    }
  }

  /** Obstáculo circular. Devuelve un handle { x, z, r, enabled } que se puede mover/desactivar. */
  addCircle(x, z, r) {
    const c = { x, z, r, enabled: true };
    this.circles.push(c);
    return c;
  }

  removeCircle(c) {
    const i = this.circles.indexOf(c);
    if (i >= 0) this.circles.splice(i, 1);
  }

  /** Caja dinámica (centro x,z; semi-ejes hx,hz). Devuelve un handle que se puede mover/desactivar. */
  addMovingBox(x, z, hx, hz) {
    const b = { x, z, hx, hz, enabled: true };
    this.boxes.push(b);
    return b;
  }

  removeMovingBox(b) {
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  clear() {
    this.colliders = [];
    this.circles = [];
    this.boxes = [];
    this._grid.clear();
  }

  /**
   * Resuelve el movimiento del player (radio `radius`).
   * Devuelve nueva posición válida (Vector3 reutilizado: copiarlo, no guardarlo).
   */
  resolveMove(currentPos, delta, radius = 0.4) {
    const pos = this._out.copy(currentPos);

    // Eje X
    pos.x += delta.x;
    this._pushOut(pos, radius, 'x', delta.x);

    // Eje Z
    pos.z += delta.z;
    this._pushOut(pos, radius, 'z', delta.z);

    // Círculos (bolsas): empujar radialmente; luego revalidar contra cajas
    let pushed = false;
    for (let i = 0; i < this.circles.length; i++) {
      const c = this.circles[i];
      if (!c.enabled) continue;
      let dx = pos.x - c.x, dz = pos.z - c.z;
      const min = radius + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        let d = Math.sqrt(d2);
        if (d < 1e-5) { dx = 1; dz = 0; d = 1; }
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
        pushed = true;
      }
    }

    // Cajas móviles (buses): se sale por el eje de menor penetración (el bus no atraviesa al jugador;
    // si lo alcanza por detrás lo empuja en su sentido, a menos velocidad que la del jugador)
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.enabled) continue;
      const dx = pos.x - b.x, dz = pos.z - b.z;
      const px = b.hx + radius - Math.abs(dx);
      const pz = b.hz + radius - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) pos.x += dx >= 0 ? px : -px;
        else pos.z += dz >= 0 ? pz : -pz;
        pushed = true;
      }
    }
    if (pushed) this._pushOutMin(pos, radius);

    return pos;
  }

  // Rellena this._cand con los colliders de las celdas cercanas (sin closures)
  _gather(pos, radius) {
    const cand = this._cand;
    cand.length = 0;
    const x0 = Math.floor((pos.x - radius) / CELL), x1 = Math.floor((pos.x + radius) / CELL);
    const z0 = Math.floor((pos.z - radius) / CELL), z1 = Math.floor((pos.z + radius) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const a = this._grid.get(cx + ',' + cz);
        if (a) for (let i = 0; i < a.length; i++) cand.push(a[i]);
      }
    }
    return cand;
  }

  _pushOut(pos, radius, axis, dir) {
    for (const c of this._gather(pos, radius)) {
      if (
        pos.x + radius > c.box.min.x && pos.x - radius < c.box.max.x &&
        pos.z + radius > c.box.min.z && pos.z - radius < c.box.max.z
      ) {
        // Está dentro → empujar por el eje que se movió
        if (axis === 'x') {
          pos.x = dir > 0 ? c.box.min.x - radius : c.box.max.x + radius;
        } else {
          pos.z = dir > 0 ? c.box.min.z - radius : c.box.max.z + radius;
        }
      }
    }
  }

  // Saca de las cajas por el eje de menor penetración (tras un empujón circular)
  _pushOutMin(pos, radius) {
    for (const c of this._gather(pos, radius)) {
      const b = c.box;
      if (
        pos.x + radius > b.min.x && pos.x - radius < b.max.x &&
        pos.z + radius > b.min.z && pos.z - radius < b.max.z
      ) {
        const l = pos.x + radius - b.min.x, r = b.max.x - (pos.x - radius);
        const t = pos.z + radius - b.min.z, d = b.max.z - (pos.z - radius);
        const m = Math.min(l, r, t, d);
        if (m === l) pos.x -= l;
        else if (m === r) pos.x += r;
        else if (m === t) pos.z -= t;
        else pos.z += d;
      }
    }
  }
}
