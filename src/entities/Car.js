// src/entities/Car.js
import * as THREE from 'three';
import { COLORS, CAR_COOLDOWN } from '../utils/constants.js';
import { makeVehicle } from '../world/bogota/vehicles.js';

export class Car {
  constructor(scene, position, rotation = 0, { traffic = false } = {}) {
    this.scene = scene;
    this.used = false;
    this.cooldown = 0;
    this.traffic = traffic;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = rotation;
    scene.add(this.group);

    // Carro realista (portado de rebusque): particular o taxi amarillo, frente hacia +X local
    const kind = Math.random() < 0.3 ? 'taxi' : 'carro';
    const v = makeVehicle(kind, Math.floor(Math.random() * 8), { beams: true });
    this.vehicle = v;
    if (!traffic && v.beam) v.beam.visible = false;
    this.length = v.length;
    this.width = v.width;
    v.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(v.group);

    // Retrovisores (lo que se roba): a los lados, en la base del parabrisas
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.05, metalness: 0.8 });
    this.mirrors = [];
    for (const side of [-1, 1]) {
      const m = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.2), mirrorMat);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), glassMat);
      glass.rotation.y = -Math.PI / 2;
      glass.position.x = -0.065;
      m.add(shell, glass);
      m.position.set(0.82, 1.02, side * (v.width / 2 + 0.1));
      this.group.add(m);
      this.mirrors.push(m);
    }

    // Marcador flotante
    const markerGeo = new THREE.RingGeometry(1.2, 1.5, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_RED,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.marker.visible = !traffic;
    this.group.add(this.marker);
  }

  get position() { return this.group.position; }

  /**
   * Robar retrovisores.
   * @param {number} caughtMult - mult de probabilidad de atrapar (talentos)
   * @returns { items, caught }
   */
  steal(caughtMult = 1) {
    if (this.traffic || this.used || this.cooldown > 0) return null;

    const items = [];
    const mirrorCount = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < mirrorCount; i++) items.push('retrovisor');
    if (Math.random() < 0.2) items.push('radio');

    const caughtChance = 0.25 * caughtMult;
    const caught = Math.random() < caughtChance;

    this.used = true;
    this.cooldown = CAR_COOLDOWN;
    this.mirrors.forEach((m) => (m.visible = false));
    this.marker.visible = false;

    return { items, caught };
  }

  update(dt) {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.used = false;
        this.mirrors.forEach((m) => (m.visible = true));
        this.marker.visible = true;
      }
    }
    if (this.marker.visible) {
      this.marker.rotation.z += dt * 0.5;
    }
  }

  animateDrive(distance, braking) {
    for (const wheel of this.vehicle.wheels) wheel.rotation.z -= distance / 0.33;
    if (braking !== this._braking) {
      this.vehicle.tailMat.color.set('#ff1a12').multiplyScalar(braking ? 3.5 : 1.4);
      this._braking = braking;
    }
  }

  setNight(isNight, isRaining = false) {
    const on = this.traffic || isNight || isRaining;
    if (this.vehicle?.beam) {
      this.vehicle.beam.visible = on;
      this.vehicle.beam.material.opacity = isNight ? 0.38 : (isRaining ? 0.28 : 0.18);
    }
    if (this.vehicle?.flares) {
      for (const f of this.vehicle.flares) f.visible = on;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.remove(this.vehicle.group);
    this.vehicle.dispose();
    const geometries = new Set(), materials = new Set();
    this.group.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
}
