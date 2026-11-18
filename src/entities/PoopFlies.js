// src/entities/PoopFlies.js
// Las moscas de todas las popós en dos mallas instanciadas: cuerpos y alas. Llegan escalonadas cuando
// la popó queda sola, rondan encima y de vez en cuando una se posa. Lejos o fuera de cámara no se dibujan.
import * as THREE from 'three';

export const FLIES_PER_POOP = Object.freeze({ alta: 6, media: 6, baja: 3 });
/** Radio del cuerpo en metros: unas tres veces una mosca real, para que se noten desde la cámara. */
export const FLY_SIZE = .015;
export const FLY_ARRIVE = 1, FLY_STAGGER = .22, FLY_TRAVEL = .8;
export const FLY_LAND_PERIOD = 6, FLY_LANDED = 2.4;
const MAX_PER_POOP = Math.max(...Object.values(FLIES_PER_POOP));

const hash = (seed, i) => { const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return s - Math.floor(s); };
const clamp01 = x => Math.max(0, Math.min(1, x));

export class PoopFlies {
  constructor(scene, { maxPiles = 8 } = {}) {
    this.scene = scene;
    this.capacity = maxPiles * MAX_PER_POOP;
    const body = new THREE.SphereGeometry(FLY_SIZE, 6, 4);
    body.scale(1, .8, 1.55);
    const wing = new THREE.PlaneGeometry(FLY_SIZE * 2.1, FLY_SIZE);
    wing.translate(FLY_SIZE * 1.05, 0, -FLY_SIZE * .3);
    wing.rotateX(-Math.PI / 2);
    this.bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: .35, metalness: .3 }), this.capacity);
    this.wings = new THREE.InstancedMesh(wing, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false
    }), this.capacity * 2);
    for (const mesh of [this.bodies, this.wings]) {
      mesh.frustumCulled = false; // las instancias se reparten por toda la ciudad
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
    }
    this._count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._flap = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._wingAt = new THREE.Vector3();
    this._hide();
    scene.add(this.bodies, this.wings);
  }

  get count() { return this._count; }

  /** Sin moscas queda una instancia invisible: el programa se compila igual durante la carga. */
  _hide() {
    this._m.makeScale(0, 0, 0);
    this.bodies.setMatrixAt(0, this._m);
    this.wings.setMatrixAt(0, this._m);
    this.bodies.count = this.wings.count = 1;
    this.bodies.instanceMatrix.needsUpdate = this.wings.instanceMatrix.needsUpdate = true;
  }

  update(dt, piles, { time = 0, quality = 'alta' } = {}) {
    const perPile = FLIES_PER_POOP[quality] ?? FLIES_PER_POOP.alta;
    let n = 0;
    for (const pile of piles) {
      if (!pile.visible || pile.settledAge == null) continue;
      const size = 1 - (pile.fade ?? 0);
      for (let f = 0; f < perPile && n < this.capacity; f++) {
        const k = clamp01((pile.settledAge - FLY_ARRIVE - f * FLY_STAGGER) / FLY_TRAVEL);
        if (k <= 0) continue;
        this._place(n++, pile, f, k, time, size);
      }
    }
    this._count = n;
    if (!n) { this._hide(); return; }
    this.bodies.count = n;
    this.wings.count = n * 2;
    this.bodies.instanceMatrix.needsUpdate = this.wings.instanceMatrix.needsUpdate = true;
  }

  _place(i, pile, f, k, time, size) {
    const seed = pile.seed ?? 0;
    const r = .14 + hash(seed, f) * .16, h = .12 + hash(seed, f + 10) * .24;
    const speed = 1.4 + hash(seed, f + 20) * 2.4, dir = hash(seed, f + 30) < .5 ? 1 : -1;
    const landed = f === 0 && k >= 1 && ((time + seed) % FLY_LAND_PERIOD) < FLY_LANDED;
    let yaw, flap;
    if (landed) {
      // Camina un poquito encima del montón, con las alas quietas.
      this._p.set(pile.top.x + Math.sin(time * 1.3) * .01, pile.top.y + .012, pile.top.z + Math.cos(time * 1.1) * .01);
      yaw = time * .6;
      flap = 0;
    } else {
      const a = seed + f + time * speed * dir, far = (1 - k) * 1.5;
      this._p.set(
        pile.position.x + Math.cos(a) * (r + far) + Math.sin(time * 3.1 + seed + f) * .045,
        pile.position.y + h + (1 - k) * .8 + Math.sin(time * 4.3 + seed * 2 + f) * .05,
        pile.position.z + Math.sin(a) * (r + far) + Math.cos(time * 2.7 + seed + f) * .045
      );
      yaw = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
      flap = Math.sin(time * 95 + f) * .7;
    }
    this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this._s.setScalar(size);
    this.bodies.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
    this._wingAt.set(0, FLY_SIZE * .55 * size, 0).add(this._p);
    for (const side of [1, -1]) {
      this._flap.setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * flap).premultiply(this._q);
      this._s.set(side * size, size, size);
      this.wings.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), this._m.compose(this._wingAt, this._flap, this._s));
    }
  }

  dispose() {
    for (const mesh of [this.bodies, this.wings]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
  }
}
