import * as THREE from 'three';
import { SpatialGrid } from '../core/SpatialGrid.js';

const AXES = ['x', 'y', 'z'];

export class CollisionSystem {
  constructor() {
    this.colliders = []; // { box: THREE.Box3, mesh }
    this.dynamicColliders = [];
    this._vehicles = new Map();
    this._staticGrid = new SpatialGrid();
    this._staticOrder = new Map();
    this._moveCandidates = [];
    this._cameraCandidates = [];
    this._occlusionCandidates = [];
    this._extent = new THREE.Vector3();
    this._orientedLocal = new THREE.Vector3();
    this._orientedHalf = new THREE.Vector3();
    this._orientedDelta = new THREE.Vector3();
    this._orientedPlayerResult = { local: this._orientedLocal, half: this._orientedHalf };
    this._strikeRay = new THREE.Ray();
    this._strikePoint = new THREE.Vector3();
    this._strikeCandidates = [];
  }

  /** Registra un mesh como sólido. size opcional para hitbox custom. */
  add(mesh, size) {
    const box = size
      ? new THREE.Box3().setFromCenterAndSize(
          mesh.position.clone().setY(mesh.position.y + size.y / 2),
          size
        )
      : new THREE.Box3().setFromObject(mesh);
    this.colliders.push({ box, mesh });
    this.invalidateStaticIndex();
  }

  clear() {
    this.colliders = []; this.dynamicColliders = []; this._vehicles.clear();
    this.invalidateStaticIndex(); this._staticGrid.clear(); this._staticOrder.clear();
  }

  invalidateStaticIndex() { this._indexedColliders = null; }

  queryStatic(minX, minZ, maxX, maxZ, result = this._cameraCandidates) {
    // Los constructores de distritos también añaden cajas directamente al array.
    if (this._indexedColliders !== this.colliders || this._indexedCount !== this.colliders.length) {
      this._staticGrid.clear(); this._staticOrder.clear();
      this.colliders.forEach((entry, index) => {
        const { min, max } = entry.box;
        this._staticGrid.insert(entry, min.x, min.z, max.x, max.z);
        this._staticOrder.set(entry, index);
      });
      this._indexedColliders = this.colliders;
      this._indexedCount = this.colliders.length;
    }
    this._staticGrid.query(minX, minZ, maxX, maxZ, result);
    // Mantener el orden de resolución anterior, incluso si una caja ocupa varias celdas.
    result.sort((a, b) => this._staticOrder.get(a) - this._staticOrder.get(b));
    return result;
  }

  /** Segmento a la altura del torso: un puñetazo no atraviesa un sólido. */
  hasClearStrike(from, to) {
    const ray = this._strikeRay;
    ray.origin.copy(from); ray.origin.y += 1.1;
    ray.direction.copy(to).sub(from);
    const distance = ray.direction.length();
    if (distance < .001) return true;
    ray.direction.divideScalar(distance);
    const candidates = this.queryStatic(Math.min(from.x, to.x), Math.min(from.z, to.z),
      Math.max(from.x, to.x), Math.max(from.z, to.z), this._strikeCandidates);
    const blocked = ({ box }) => ray.intersectBox(box, this._strikePoint) &&
      ray.origin.distanceToSquared(this._strikePoint) < distance * distance;
    return !candidates.some(blocked) && !this.dynamicColliders.some(blocked);
  }

  /** Consulta conservadora del volumen cámara/jugador; admite falsos positivos. */
  mayOccludePlayer(camera, player) {
    const margin = .8;
    const candidates = this.queryStatic(Math.min(camera.x, player.x - margin), Math.min(camera.z, player.z - margin),
      Math.max(camera.x, player.x + margin), Math.max(camera.z, player.z + margin), this._occlusionCandidates);
    const minY = Math.min(camera.y, player.y), maxY = Math.max(camera.y, player.y + 2.2);
    const minX = Math.min(camera.x, player.x - margin), maxX = Math.max(camera.x, player.x + margin);
    const minZ = Math.min(camera.z, player.z - margin), maxZ = Math.max(camera.z, player.z + margin);
    const intersects = ({ box }) => box.max.x >= minX && box.min.x <= maxX && box.max.z >= minZ && box.min.z <= maxZ && box.max.y >= minY && box.min.y <= maxY;
    return candidates.some(intersects) || this.dynamicColliders.some(intersects);
  }

  /** Cajas simples; el bus conserva además orientación para la colisión precisa. */
  setVehicles(cars = [], bus = null) {
    const present = new Set(cars);
    const buses = new Set([bus].flat().filter(Boolean));
    for (const vehicle of buses) present.add(vehicle);
    for (const vehicle of this._vehicles.keys()) if (!present.has(vehicle)) this._vehicles.delete(vehicle);
    this.dynamicColliders.length = 0;
    for (const vehicle of present) {
      let entry = this._vehicles.get(vehicle);
      if (!entry) { entry = { vehicle, box: new THREE.Box3() }; this._vehicles.set(vehicle, entry); }
      const isBus = buses.has(vehicle);
      if (isBus) {
        entry.obb ??= { center: new THREE.Vector3(), halfSize: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
          inverse: new THREE.Quaternion(), axes: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] };
        const o = entry.obb;
        o.quaternion.copy(vehicle.group.quaternion); o.inverse.copy(o.quaternion).invert();
        o.halfSize.set(vehicle.width / 2, 3.5 / 2, vehicle.length / 2);
        o.center.set(0, o.halfSize.y, 0).applyQuaternion(o.quaternion).add(vehicle.position);
        o.axes[0].set(1,0,0).applyQuaternion(o.quaternion);
        o.axes[1].set(0,1,0).applyQuaternion(o.quaternion);
        o.axes[2].set(0,0,1).applyQuaternion(o.quaternion);
        const extent = this._extent.set(0, 0, 0);
        for (let i = 0; i < 3; i++) {
          const axis = o.axes[i], half = o.halfSize.getComponent(i);
          extent.x += Math.abs(axis.x) * half; extent.y += Math.abs(axis.y) * half; extent.z += Math.abs(axis.z) * half;
        }
        entry.box.min.copy(o.center).sub(extent); entry.box.max.copy(o.center).add(extent);
        this.dynamicColliders.push(entry);
        continue;
      }
      delete entry.obb;
      const c = isBus ? Math.abs(Math.sin(vehicle.group.rotation.y)) : Math.abs(Math.cos(vehicle.group.rotation.y));
      const s = isBus ? Math.abs(Math.cos(vehicle.group.rotation.y)) : Math.abs(Math.sin(vehicle.group.rotation.y));
      const halfX = (c * vehicle.length + s * vehicle.width) / 2;
      const halfZ = (s * vehicle.length + c * vehicle.width) / 2;
      const p = vehicle.position;
      entry.box.min.set(p.x - halfX, p.y, p.z - halfZ);
      entry.box.max.set(p.x + halfX, p.y + (isBus ? 3 : 1.65), p.z + halfZ);
      this.dynamicColliders.push(entry);
    }
  }

  /**
   * Resuelve el movimiento del player (radio `radius`).
   * Devuelve nueva posición válida.
   */
  resolveMove(currentPos, delta, radius = 0.4, result = new THREE.Vector3()) {
    const pos = result.copy(currentPos);
    // Un vehículo que avanza lentamente empuja hacia la cara más próxima.
    for (const entry of this.dynamicColliders) {
      const { box, obb } = entry;
      if (pos.y > box.max.y || pos.y + 1.6 < box.min.y) continue;
      if (obb) { this._pushFromOriented(pos, radius, obb); continue; }
      const x0 = box.min.x - radius, x1 = box.max.x + radius;
      const z0 = box.min.z - radius, z1 = box.max.z + radius;
      if (pos.x <= x0 || pos.x >= x1 || pos.z <= z0 || pos.z >= z1) continue;
      const distances = [pos.x - x0, x1 - pos.x, pos.z - z0, z1 - pos.z];
      const face = distances.indexOf(Math.min(...distances));
      if (face === 0) pos.x = x0; else if (face === 1) pos.x = x1;
      else if (face === 2) pos.z = z0; else pos.z = z1;
    }

    this._moveAxis(pos, radius, 'x', 'z', delta.x);
    this._moveAxis(pos, radius, 'z', 'x', delta.z);

    return pos;
  }

  _moveAxis(pos, radius, axis, other, delta) {
    if (delta === 0) return;
    const epsilon = 1e-7;
    const start = pos[axis];
    let end = start + delta;
    for (const { box, vehicle, layered, obb } of this._movementColliders(pos, radius, axis, delta)) {
      if ((vehicle || layered) && (pos.y > box.max.y || pos.y + 1.6 < box.min.y)) continue;
      if (obb) {
        const movement = this._orientedDelta.set(0, 0, 0);
        movement[axis] = end - start;
        const t = this._orientedSweep(pos, movement, radius, obb);
        if (t !== null) end = start + (end - start) * Math.max(0, t - epsilon);
        continue;
      }
      // El contacto tangencial no es penetración (incluye error de coma flotante).
      if (pos[other] <= box.min[other] - radius + epsilon ||
          pos[other] >= box.max[other] + radius - epsilon) continue;
      const min = box.min[axis] - radius;
      const max = box.max[axis] + radius;
      if (delta > 0 && start <= min + epsilon && end > min) {
        end = Math.max(start, min);
      } else if (delta < 0 && start >= max - epsilon && end < max) {
        end = Math.min(start, max);
      } else if (start > min + epsilon && start < max - epsilon) {
        // Una posición ya solapada puede salir por el lado más cercano,
        // pero nunca se corrige saltando al otro extremo de una manzana.
        if ((delta > 0 && start < (min + max) / 2) ||
            (delta < 0 && start > (min + max) / 2)) end = start;
      }
    }
    pos[axis] = end;
  }

  _orientedPlayer(pos, radius, obb) {
    const local = this._orientedLocal.set(pos.x, pos.y + .8, pos.z).sub(obb.center).applyQuaternion(obb.inverse);
    const half = this._orientedHalf.copy(obb.halfSize);
    for (let i = 0; i < 3; i++) {
      const a = obb.axes[i];
      half.setComponent(i, half.getComponent(i) + radius * Math.hypot(a.x, a.z) + .8 * Math.abs(a.y));
    }
    return this._orientedPlayerResult;
  }

  _pushFromOriented(pos, radius, obb) {
    const { local, half } = this._orientedPlayer(pos, radius, obb);
    if (Math.abs(local.x) >= half.x - 1e-7 ||
        Math.abs(local.y) >= half.y - 1e-7 ||
        Math.abs(local.z) >= half.z - 1e-7) return;
    let best = Infinity, pushAxis = -1, pushAmount = 0;
    for (let i = 0; i < 3; i++) {
      const a = obb.axes[i], horizontal = a.x * a.x + a.z * a.z;
      if (horizontal < 1e-6) continue;
      const depth = half.getComponent(i) - Math.abs(local.getComponent(i)) + 1e-6;
      const distance = depth / Math.sqrt(horizontal);
      if (distance < best) {
        best = distance;
        pushAxis = i;
        pushAmount = (local.getComponent(i) < 0 ? -1 : 1) * depth / horizontal;
      }
    }
    if (pushAxis >= 0) {
      pos.x += obb.axes[pushAxis].x * pushAmount;
      pos.z += obb.axes[pushAxis].z * pushAmount;
    }
  }

  _orientedSweep(pos, movement, radius, obb) {
    const { local, half } = this._orientedPlayer(pos, radius, obb);
    const delta = this._orientedDelta.copy(movement).applyQuaternion(obb.inverse);
    let near = 0, far = 1;
    for (const axis of AXES) {
      if (Math.abs(delta[axis]) < 1e-10) {
        if (Math.abs(local[axis]) >= half[axis] - 1e-7) return null;
      } else {
        let a = (-half[axis] - local[axis]) / delta[axis], b = (half[axis] - local[axis]) / delta[axis];
        if (a > b) { const swap = a; a = b; b = swap; }
        near = Math.max(near, a); far = Math.min(far, b);
        if (near > far || far < 0) return null;
      }
    }
    return near <= 1 && far > 1e-8 ? near : null;
  }

  *_allColliders() { yield* this.colliders; yield* this.dynamicColliders; }

  *_movementColliders(pos, radius, axis, delta) {
    const endX = pos.x + (axis === 'x' ? delta : 0), endZ = pos.z + (axis === 'z' ? delta : 0);
    yield* this.queryStatic(Math.min(pos.x, endX) - radius, Math.min(pos.z, endZ) - radius,
      Math.max(pos.x, endX) + radius, Math.max(pos.z, endZ) + radius, this._moveCandidates);
    yield* this.dynamicColliders;
  }
}
