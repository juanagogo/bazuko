// src/entities/Car.js
import * as THREE from 'three';
import { COLORS, CAR_COOLDOWN } from '../utils/constants.js';
import { makeVehicle } from '../world/bogota/vehicles.js';
import { createImportedModel, disposeImportedInstance } from '../utils/ImportedModels.js';

const SHIRTS = [0x8a2b2b, 0x2b4a8a, 0x3a3a3a, 0xc9b27a, 0x2f6b45, 0xe0e0e0];
const SKINS = [0xe0b08a, 0xc68a5e, 0x9a6440, 0x6e4529];

/** Conductor sentado: torso y cabeza simples, visibles por las ventanas sin cargar un personaje completo. */
function createSeatedDriver(height) {
  const group = new THREE.Group();
  group.name = 'Conductor';
  const shirt = new THREE.MeshStandardMaterial({ color: SHIRTS[Math.floor(Math.random() * SHIRTS.length)], roughness: .9 });
  const skin = new THREE.MeshStandardMaterial({ color: SKINS[Math.floor(Math.random() * SKINS.length)], roughness: .8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(.26, .42, .38), shirt);
  torso.position.y = height - .62;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.11, 10, 8), skin);
  head.position.y = height - .3;
  group.add(torso, head);
  // Frente hacia +X local; en Colombia se conduce desde el lado izquierdo (−Z).
  group.position.set(.05, 0, -.36);
  return group;
}

const CRIOLLOS = new Set(['zapatico', 'huevito', 'amigofiel']);

export class Car {
  constructor(scene, position, rotation = 0, { traffic = false, kind = null, variant = null } = {}) {
    this.scene = scene;
    this.used = false;
    this.cooldown = 0;
    this.traffic = traffic;
    this.pursuit = false;
    this.driverInside = true;
    this._visualTime = 0;
    this._roadPhase = 0;
    this._wiperPhase = 0;
    this._steering = 0;
    this._motionWeight = 0;
    this._previousSpeed = null;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = rotation;
    scene.add(this.group);

    // Carro realista (portado de rebusque): particular, taxi o policía; frente hacia +X local
    const resolvedKind = kind ?? (Math.random() < 0.3 ? 'taxi' : 'carro');
    this.kind = resolvedKind;
    this.modelKind = resolvedKind === 'taxi' ? 'car2' : 'car1';
    const v = makeVehicle(resolvedKind, Number.isFinite(variant) ? Math.trunc(variant) : Math.floor(Math.random() * 8), { beams: true });
    this.vehicle = v;
    if (!traffic && v.beam) v.beam.visible = false;
    this.length = v.length;
    this.width = v.width;
    // El constructor visual decide qué proyecta sombra: nunca los haces ni los vidrios.
    if (!v.visualManaged) v.group.traverse((o) => {
      if (o.isMesh && !o.material?.transparent) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.group.add(v.group);
    this._bodyRestY = v.bodyVisual?.position.y ?? 0;
    this._wetMaterials = (v.wetMaterials ?? []).map(material => ({ material, roughness: material.roughness }));

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
      const anchor = v.mirrorAnchors?.[this.mirrors.length];
      if (anchor) m.position.copy(anchor);
      else m.position.set(0.82, 1.02, side * (v.width / 2 + 0.1));
      (v.bodyVisual ?? this.group).add(m);
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

    // Solo los carros en circulación llevan conductor; los estacionados activan la alarma.
    this.driver = traffic ? createSeatedDriver(v.driverHeight ?? (this.modelKind === 'car2' ? 1.45 : 1.62)) : null;
    if (this.driver) {
      if (v.driverAnchor) this.driver.position.copy(v.driverAnchor);
      (v.bodyVisual ?? this.group).add(this.driver);
    }
  }

  /** Muestra u oculta al conductor sentado (se baja del carro o vuelve a subir). */
  setDriverInside(inside) {
    this.driverInside = inside;
    if (this.driver) this.driver.visible = inside && !this.driverHidden;
  }

  /** Punto junto a la puerta del conductor, en metros del mundo. */
  driverDoor(target = new THREE.Vector3()) {
    this.group.updateMatrixWorld();
    return target.set(.05, 0, -(this.width / 2 + .55)).applyMatrix4(this.group.matrixWorld).setY(this.group.position.y);
  }

  get position() { return this.group.position; }

  preloadModel() {
    // La carrocería administrada conserva ruedas, cristales y piezas móviles al terminar la carga.
    if (this.vehicle.visualManaged || this.kind === 'police' || CRIOLLOS.has(this.vehicle.model)) return this._modelPromise ??= Promise.resolve();
    return this._modelPromise ??= createImportedModel(this.modelKind).then(model => {
      if (this._disposed) { disposeImportedInstance(model); return; }
      for (const mirror of this.mirrors) this.group.add(mirror);
      if (this.driver) this.group.add(this.driver);
      this.group.remove(this.vehicle.group);
      this.vehicle.dispose();
      this.importedModel = model;
      this.group.add(model);
      // Las ruedas del GLB están integradas en una sola malla texturizada.
      this.vehicle = { group: model, wheels: [], tailMat: null, dispose() { disposeImportedInstance(model); } };
      // Sus ventanas son opacas: el conductor sentado no se vería y solo añadiría llamadas de dibujo.
      this.driverHidden = true;
      if (this.driver) this.driver.visible = false;
    });
  }

  /**
   * Robar retrovisores.
   * @param {number} caughtMult - mult de probabilidad de atrapar (talentos)
   * @returns { items, caught }
   */
  steal(caughtMult = 1) {
    // A una patrulla no se le roban los espejos.
    if (this.kind === 'police' || this.used || this.cooldown > 0) return null;

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
    if (!(dt > 0) || this._disposed) return;
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
    // El tráfico avanza sus visuales en cada subpaso; los estacionados también limpian la lluvia.
    if (!this.traffic) this.animateDrive(0, false, { dt, speed: 0 });
  }

  /** Distancia firmada en metros; dirección en radianes (+ izquierda), todo con tiempo de simulación. */
  animateDrive(distance, braking = false, { dt = 0, speed, acceleration, steering = 0, turnSignal = null } = {}) {
    if (this._disposed) return;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const travel = Number.isFinite(distance) ? distance : 0;
    const v = this.vehicle;
    for (const wheel of v.wheels ?? []) {
      const radius = wheel.userData.radius ?? v.wheelRadius ?? .33;
      if (radius > 0) wheel.rotation.z -= travel / radius;
    }
    if (this.vehicle.tailMat && braking !== this._braking) {
      this.vehicle.tailMat.color.set('#ff1a12').multiplyScalar(braking ? 3.5 : 1.4);
      this._braking = braking;
    }
    // Una llamada legacy sin dt sigue girando ruedas/freno, pero no inventa tiempo para los efectos.
    if (step <= 0) return;
    this._visualTime += step;
    this._roadPhase = (this._roadPhase + Math.abs(travel) * 2.8) % (Math.PI * 2);
    const velocity = Number.isFinite(speed) ? speed : travel / step;
    const accel = Number.isFinite(acceleration) ? acceleration
      : this._previousSpeed === null ? 0 : (velocity - this._previousSpeed) / step;
    this._previousSpeed = velocity;
    const damp = -Math.expm1(-9 * step);
    const targetSteering = Number.isFinite(steering) ? THREE.MathUtils.clamp(steering, -.34, .34) : 0;
    this._steering += (targetSteering - this._steering) * damp;
    for (const pivot of v.frontWheelPivots ?? []) pivot.rotation.y = this._steering;
    this._motionWeight += (Math.min(Math.abs(velocity) / 5, 1) - this._motionWeight) * damp;
    if (v.bodyVisual) {
      const body = v.bodyVisual;
      const pitch = THREE.MathUtils.clamp(accel * .007, -.035, .028);
      const lateral = velocity * velocity * Math.tan(this._steering) / (v.wheelbase ?? this.length * .58);
      const roll = THREE.MathUtils.clamp(lateral * .008, -.035, .035);
      body.rotation.z += (pitch - body.rotation.z) * damp;
      body.rotation.x += (roll - body.rotation.x) * damp;
      body.position.y = this._bodyRestY + Math.sin(this._roadPhase) * .006 * this._motionWeight;
    }
    if (turnSignal !== this._turnSignal) {
      this._turnSignal = turnSignal;
      this._signalTime = 0;
    }
    this._signalTime = (this._signalTime ?? 0) + step;
    const blink = (this._signalTime ?? 0) % .8 < .4;
    const signals = v.signalMaterials;
    if (signals) {
      signals.left.emissiveIntensity = blink && (turnSignal === 'left' || turnSignal === 'hazard') ? 2.5 : .12;
      signals.right.emissiveIntensity = blink && (turnSignal === 'right' || turnSignal === 'hazard') ? 2.5 : .12;
    }
    if (this._isRaining || this._wiperPhase > 0) {
      // Termina el barrido al dejar de llover y aparca en el ángulo de reposo.
      const phase = this._wiperPhase + step / 1.15;
      this._wiperPhase = this._isRaining ? phase % 1 : phase >= 1 ? 0 : phase;
    }
    for (const wiper of v.wipers ?? []) {
      wiper.rotation.z = (wiper.userData.restAngle ?? 0) +
        (wiper.userData.sweepAngle ?? 1.25) * (.5 - .5 * Math.cos(this._wiperPhase * Math.PI * 2));
    }
    const lights = v.policeLights;
    if (lights) {
      const on = Math.floor(this._visualTime / (this.pursuit ? .09 : .16)) % 2 === 0;
      lights.blue.color.set(on ? '#1a6cff' : '#061028').multiplyScalar(on ? 4 : 0.35);
      lights.red.color.set(on ? '#061028' : '#ff1a2a').multiplyScalar(on ? 0.35 : 4);
    }
  }

  setNight(isNight, isRaining = false) {
    this.setWeather({ isRaining });
    if (this.vehicle.headlightMaterial) this.vehicle.headlightMaterial.emissiveIntensity = isNight ? 1.35 : isRaining ? .8 : .55;
    const on = this.traffic || isNight || isRaining;
    if (this.vehicle?.beam) {
      this.vehicle.beam.visible = on;
      this.vehicle.beam.material.opacity = isNight ? 0.38 : (isRaining ? 0.28 : 0.18);
    }
    if (this.vehicle?.flares) {
      for (const f of this.vehicle.flares) f.visible = on;
    }
  }

  setWeather({ isRaining = false } = {}) {
    if (this._isRaining === !!isRaining) return;
    this._isRaining = !!isRaining;
    for (const { material, roughness } of this._wetMaterials) material.roughness = roughness * (this._isRaining ? .75 : 1);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.scene.remove(this.group);
    // Espejos y conductor pertenecen al carro, aunque acompañen la suspensión de bodyVisual.
    for (const mirror of this.mirrors) this.group.add(mirror);
    if (this.driver) this.group.add(this.driver);
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
