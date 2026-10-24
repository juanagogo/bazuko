// src/entities/Car.js
import * as THREE from 'three';
import { COLORS, CAR_COOLDOWN } from '../utils/constants.js';
import { makeVehicle } from '../world/bogota/vehicles.js';
import { createImportedModel, disposeImportedInstance } from '../utils/ImportedModels.js';

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

    // Carro realista: particular, taxi o patrulla, frente hacia +X local
    const r = Math.random();
    const kind = r < 0.35 ? 'taxi' : (r < 0.42 ? 'police' : 'carro');
    this.kind = kind;
    this.modelKind = kind === 'taxi' ? 'car2' : 'car1';
    const v = makeVehicle(kind, Math.floor(Math.random() * 8), { beams: false });
    this.vehicle = v;
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

    // Conductor visible en vehículos en circulación
    if (traffic) {
      this.driver = this._createDriver(kind);
      this.group.add(this.driver);
    }
  }

  _createDriver(kind) {
    const group = new THREE.Group();
    group.name = 'Driver';
    const seatX = 0.15;
    const seatY = 0.55;
    const seatZ = 0.35;
    group.position.set(seatX, seatY, seatZ);

    const skinTones = [0xc68642, 0x8d5524, 0xe0ac69, 0xf1c27d, 0x513524];
    const skinColor = skinTones[Math.floor(Math.random() * skinTones.length)];
    const shirtColors = kind === 'taxi'
      ? [0x223344, 0x333333, 0x2c3e50, 0x4a6572]
      : kind === 'police'
        ? [0x15382b, 0x0f231b]
        : [0x2c3e50, 0x7f8c8d, 0x34495e, 0x8e44ad, 0xc0392b, 0x27ae60];
    const shirtColor = shirtColors[Math.floor(Math.random() * shirtColors.length)];
    const mat = (col) => new THREE.MeshLambertMaterial({ color: col, flatShading: true });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.34), mat(shirtColor));
    torso.position.y = 0.22;
    torso.castShadow = true;
    group.add(torso);

    // Cabeza
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.19, 0.18), mat(skinColor));
    head.position.y = 0.48;
    head.castShadow = true;
    group.add(head);

    // Cabello / Gorra
    const hairMat = mat(kind === 'police' ? 0x0f231b : [0x111111, 0x2d1e12, 0x4a3728][Math.floor(Math.random() * 3)]);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.08, 0.19), hairMat);
    hair.position.set(0, 0.58, 0);
    group.add(hair);

    // Volante
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 8), mat(0x1a1a1a));
    wheel.rotation.z = Math.PI / 4;
    wheel.position.set(0.26, 0.32, 0);
    group.add(wheel);

    // Brazos
    const armMat = mat(shirtColor);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.09), armMat);
    armL.position.set(0.14, 0.26, 0.14);
    armL.rotation.y = -0.3;
    group.add(armL);

    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.09), armMat);
    armR.position.set(0.14, 0.26, -0.14);
    armR.rotation.y = 0.3;
    group.add(armR);

    return group;
  }

  get position() { return this.group.position; }

  preloadModel() {
    return this._modelPromise ??= createImportedModel(this.modelKind).then(model => {
      if (this._disposed) { disposeImportedInstance(model); return; }
      this.group.remove(this.vehicle.group);
      this.vehicle.dispose();
      this.importedModel = model;
      this.group.add(model);
      // Las ruedas del GLB están integradas en una sola malla texturizada.
      this.vehicle = { group: model, wheels: [], tailMat: null, dispose() { disposeImportedInstance(model); } };
    });
  }

  /**
   * Robar retrovisores.
   * @param {number} caughtMult - mult de probabilidad de atrapar (talentos)
   * @returns { items, caught }
   */
  steal(caughtMult = 1) {
    if (this.used || this.cooldown > 0) return null;

    const items = [];
    const mirrorCount = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < mirrorCount; i++) items.push('retrovisor');
    if (!this.traffic && Math.random() < 0.2) items.push('radio');

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
        this.marker.visible = !this.traffic;
      }
    }
    if (this.marker.visible) {
      this.marker.rotation.z += dt * 0.5;
    }
  }

  animateDrive(distance, braking) {
    for (const wheel of this.vehicle.wheels) wheel.rotation.z -= distance / 0.33;
    if (this.vehicle.tailMat && braking !== this._braking) {
      this.vehicle.tailMat.color.set('#ff1a12').multiplyScalar(braking ? 3 : 1.4);
      this._braking = braking;
    }
    if (this.vehicle?.policeLights) {
      this._sirenTime = (this._sirenTime || 0) + 0.15;
      const phase = Math.sin(this._sirenTime * 8);
      this.vehicle.policeLights.blue.color.set(phase > 0 ? '#1a6cff' : '#04153b').multiplyScalar(phase > 0 ? 3.5 : 0.4);
      this.vehicle.policeLights.red.color.set(phase < 0 ? '#ff1a2a' : '#3b0408').multiplyScalar(phase < 0 ? 3.5 : 0.4);
    }
  }

  dispose() {
    this._disposed = true;
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
