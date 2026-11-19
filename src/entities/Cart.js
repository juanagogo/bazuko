// src/entities/Cart.js
// Carreta de Balineras de Reciclaje Bogotana
// Vehículo rústico de tracción humana que aumenta drásticamente la capacidad de carga (+120 kg).
import * as THREE from 'three';
import { CART_AXLE, CART_HANDLE, CART_STAND, createCartVisual } from './cartVisual.js';
import { cartGround, cartHitsWall, fitCartAxle, turnBetween } from './cartMovement.js';

const HANDLE_DISTANCE = 1.4, ATTACH_TIME = .38, MAX_PITCH = .39;
const { clamp, lerp, smoothstep } = THREE.MathUtils;

function clearFraction(length, step, clearAt) {
  const samples = Math.max(1, Math.ceil(length / step));
  let safe = 0;
  for (let i = 1; i <= samples; i++) {
    let end = i / samples;
    if (clearAt(end)) { safe = end; continue; }
    for (let j = 0; j < 7; j++) {
      const middle = (end + safe) / 2;
      if (clearAt(middle)) safe = middle;
      else end = middle;
    }
    return safe;
  }
  return 1;
}

export class Cart {
  constructor(scene, position = new THREE.Vector3(25, 0, 31), { groundHeight = null, collisions = null } = {}) {
    this.scene = scene;
    this.kind = 'cart';
    this.title = 'Carreta de balineras';
    this.isAttached = false;
    this.capacityBonus = 120; // kg extra de capacidad
    this.position = position.clone();

    this.groundHeight = groundHeight;
    this.collisions = collisions;
    this._nearby = [];
    this._heading = 0;
    this._previous = { x: NaN, z: NaN, y: NaN, yaw: 0, height: 0, roll: 0 };
    this._support = { height: 0, roll: 0 };
    this._axleOffset = new THREE.Vector3();
    this._standProbe = new THREE.Vector3();
    this._leftAngle = this._rightAngle = 0;
    this._standFold = this.gripWeight = 0;
    this._rumbleTimer = 0;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    this._buildModel();
    scene.add(this.group);
    this._place(0, null);
  }

  _buildModel() {
    Object.assign(this, createCartVisual(this.group));
  }

  /** Con la carreta enganchada: lo que aguanto sin ella, que es lo de siempre, sin su bono. */
  aguanteSinCarreta(inventory) {
    return inventory ? Math.max(10, inventory.maxWeight - this.capacityBonus) : Infinity;
  }

  /** Solo la suelto si lo que llevo cabe sin ella; con más encima, primero descargo (vender, botar o comer). */
  puedeSoltar(inventory) {
    return (inventory?.totalWeight ?? 0) <= this.aguanteSinCarreta(inventory);
  }

  toggleGrab(player, inventory, animate = true) {
    if (!this.isAttached) {
      this.isAttached = true;
      if (player) player.hasCart = true;
      if (inventory) inventory.maxWeight += this.capacityBonus;
      if (animate && player?.position) {
        this._coupling = { x: this.position.x, z: this.position.z, yaw: this._heading, time: 0 };
        player.faceTowards?.(this.position);
      }

      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: 'Enganché la carreta: +120 kg, pero pesa.', kind: 'info' }
        }));
      }
    } else {
      const sinCarreta = this.aguanteSinCarreta(inventory);
      if (!this.puedeSoltar(inventory)) {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: `Tengo que descargar antes de dejar la carreta: llevo ${Math.ceil(inventory.totalWeight)} kg y sin ella aguanto ${Math.floor(sinCarreta)}.`, kind: 'warn' }
          }));
        }
        return this.isAttached;
      }
      this.isAttached = false;
      this._coupling = null;
      if (player) player.hasCart = false;
      if (inventory) inventory.maxWeight = sinCarreta;

      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: 'Dejé la carreta aquí.', kind: 'info' }
        }));
      }
    }
    return this.isAttached;
  }

  _clear(x, z, yaw, y) {
    const ground = cartGround(this.groundHeight, x, z, y);
    return !cartHitsWall(this.collisions, x, z, yaw, ground, this._nearby);
  }

  /** Al mover el tirador, la caja vira desde el eje anterior. Retroceder en su línea no cambia el rumbo. */
  limitPlayerMove(from, to, yaw, nextYaw) {
    const old = this.position;
    if (this._coupling || Math.abs(Math.hypot(old.x - from.x, old.z - from.z) - HANDLE_DISTANCE) > .12) return nextYaw;
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    if (distance <= 1e-6) return yaw;
    const bearing = (x, z) => Math.atan2(old.x - x, old.z - z);
    if (this.collisions && this._clear(old.x, old.z, yaw, from.y)) {
      const t = clearFraction(distance, .07, f => {
        const x = lerp(from.x, to.x, f), z = lerp(from.z, to.z, f);
        const heading = bearing(x, z);
        return this._clear(x + Math.sin(heading) * HANDLE_DISTANCE, z + Math.cos(heading) * HANDLE_DISTANCE, heading, from.y);
      });
      to.x = lerp(from.x, to.x, t);
      to.z = lerp(from.z, to.z, t);
    }
    return yaw + turnBetween(yaw, bearing(to.x, to.z));
  }

  _follow(player, dt) {
    const yaw = player.root?.rotation.y ?? 0;
    const { x, y, z } = player.position;
    let nextX = x + Math.sin(yaw) * HANDLE_DISTANCE;
    let nextZ = z + Math.cos(yaw) * HANDLE_DISTANCE;
    let nextYaw = yaw;
    const coupling = this._coupling;
    if (coupling) {
      coupling.time += dt;
      const progress = smoothstep(coupling.time, 0, ATTACH_TIME);
      nextX = lerp(coupling.x, nextX, progress);
      nextZ = lerp(coupling.z, nextZ, progress);
      nextYaw = coupling.yaw + turnBetween(coupling.yaw, yaw) * progress;
      if (progress === 1) this._coupling = null;
    }
    if (this._clear(nextX, nextZ, nextYaw, y)) {
      this.position.set(nextX, y, nextZ);
      this._heading = nextYaw;
    }
  }

  /** La partida comienza junto al cambuche. Si trae la carreta, ya queda colocada antes de mostrar el mundo. */
  placeWithCarrier(player) {
    if (!this.isAttached || !player) return;
    this._coupling = null;
    this._follow(player, 0);
    this._standFold = this.gripWeight = 1;
    this._place(0, player);
  }

  _setBodyPose(pitch, fold) {
    const { x, z } = this.position, { height, roll } = this._support;
    // YZX aplica cabeceo alrededor del eje, balanceo por las dos alturas y finalmente rumbo.
    this.group.rotation.set(pitch, this._heading, roll, 'YZX');
    this._axleOffset.set(0, CART_AXLE.height, 0).applyQuaternion(this.group.quaternion);
    this.group.position.set(x, height, z).sub(this._axleOffset);
    this.kickstand.rotation.x = fold * 1.39;
  }

  _fitStand(pitch, fold, reference, contact) {
    if (!this.groundHeight) return pitch;
    const points = this.kickstand.geometry.attributes.position, point = this._standProbe;
    for (let attempt = 0; attempt < 6; attempt++) {
      this._setBodyPose(pitch, fold);
      this.kickstand.updateWorldMatrix(true, false);
      let gap = Infinity;
      for (let i = 0; i < points.count; i++) {
        point.fromBufferAttribute(points, i).applyMatrix4(this.kickstand.matrixWorld);
        gap = Math.min(gap, point.y - cartGround(this.groundHeight, point.x, point.z, reference));
      }
      if (Math.abs(gap) < .001 || (!contact && gap > 0)) break;
      const next = clamp(pitch + gap * 1.45, -MAX_PITCH, MAX_PITCH);
      if (next === pitch) break;
      pitch = next;
    }
    return pitch;
  }

  _place(dt, carrier) {
    const { x, y, z } = this.position, yaw = this._heading;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const previous = this._previous;
    const axleFloor = cartGround(this.groundHeight, x, z, y);
    fitCartAxle(this.groundHeight, x, z, s, c, axleFloor, this._support);
    const { height, roll } = this._support;
    const base = height - CART_AXLE.height;
    const standGround = cartGround(this.groundHeight, x + s * CART_STAND.z, z + c * CART_STAND.z, axleFloor);
    const fold = this._standFold;
    const restingPitch = fold < .999 ? this._fitStand(Math.atan2(base - standGround, CART_STAND.z), 0, axleFloor, true) : 0;
    const pushingPitch = Math.atan2((carrier?.position.y ?? y) - base, -CART_HANDLE.z);
    let pitch = clamp(lerp(restingPitch, pushingPitch, fold), -MAX_PITCH, MAX_PITCH);
    if (fold > .001 && fold < .93) pitch = this._fitStand(pitch, fold, axleFloor, false);

    let travel = 0;
    if (dt > 0 && Number.isFinite(previous.x)) {
      const dx = x - previous.x, dz = z - previous.z;
      if (Math.hypot(dx, dz) < 2.4) {
        const turn = turnBetween(previous.yaw, yaw), middle = previous.yaw + turn / 2;
        const forward = dx * Math.sin(middle) + dz * Math.cos(middle);
        const curve = turn * CART_AXLE.halfTrack;
        const slope = height - previous.height, cross = CART_AXLE.halfTrack * (Math.sin(roll) - Math.sin(previous.roll));
        const left = forward + curve, right = forward - curve;
        this._leftAngle += Math.sign(left) * Math.hypot(left, slope - cross) / CART_AXLE.radius;
        this._rightAngle += Math.sign(right) * Math.hypot(right, slope + cross) / CART_AXLE.radius;
        travel = (Math.abs(left) + Math.abs(right)) / 2;
      }
    }

    this._setBodyPose(pitch, fold);
    this.leftWheel.rotation.x = this._leftAngle - pitch;
    this.rightWheel.rotation.x = this._rightAngle - pitch;
    Object.assign(previous, { x, z, y, yaw, height, roll });
    return travel;
  }

  update(dt, player, audio) {
    const carrier = this.isAttached ? player : null;
    if (carrier) this._follow(carrier, dt);
    this._standFold = THREE.MathUtils.damp(this._standFold, carrier ? 1 : 0, 15, dt);
    this.gripWeight = THREE.MathUtils.damp(this.gripWeight, carrier ? (this._coupling ? smoothstep(this._coupling.time, .1, ATTACH_TIME) : 1) : 0, 17, dt);
    const prior = this._previous;
    if (!carrier && this._standFold < .001 && prior.x === this.position.x && prior.y === this.position.y && prior.z === this.position.z) return;
    const travel = this._place(dt, carrier);
    if (carrier && travel > dt * .2) {
      this._rumbleTimer += dt;
      if (this._rumbleTimer > .22) {
        this._rumbleTimer = 0;
        audio?.playCartRumble?.();
      }
    }
  }

  saveState() {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      rotation: this._heading,
      isAttached: this.isAttached
    };
  }

  loadState(state, player, inventory) {
    if (!state) return;
    if (typeof state.x === 'number') this.position.x = state.x;
    if (typeof state.y === 'number') this.position.y = state.y;
    if (typeof state.z === 'number') this.position.z = state.z;
    if (typeof state.rotation === 'number') this._heading = state.rotation;

    if (state.isAttached && !this.isAttached) {
      this.toggleGrab(player, inventory, false);
    }
    this._place(0, null);
  }

  dispose() {
    this.scene.remove(this.group);
    this._disposeVisual();
  }
}
