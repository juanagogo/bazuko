// src/entities/Car.js
import * as THREE from 'three';
import { CAR_COOLDOWN, INTERACT_RANGE } from '../utils/constants.js';
import { makeVehicle } from '../world/bogota/vehicles.js';
import { getDriverGeometry } from '../world/bogota/VehicleBody.js';
import { markerGeometry, markerMaterial } from '../world/bogota/carMarker.js';
import { createImportedModel, disposeImportedInstance } from '../utils/ImportedModels.js';

const SHIRTS = ['#8a2b2b', '#2b4a8a', '#3a3a3a', '#c9b27a', '#2f6b45', '#e0e0e0'];
const SKINS = ['#e0b08a', '#c68a5e', '#9a6440', '#6e4529'];
// A esta distancia ya no se distinguen conductor, espejos ni plumillas: ahorran llamadas de dibujo.
const DETAIL_NEAR = 34, DETAIL_FAR = 40;
const TAIL_DAY = .14, TAIL_NIGHT = 1, TAIL_BRAKE = 2.4;

/** Conductor sentado: una sola malla compartida por combinación de ropa y piel; visible por las ventanas. */
function createSeatedDriver(height, material) {
  const group = new THREE.Group();
  group.name = 'Conductor';
  const shirt = SHIRTS[Math.floor(Math.random() * SHIRTS.length)], skin = SKINS[Math.floor(Math.random() * SKINS.length)];
  const body = new THREE.Mesh(getDriverGeometry(shirt, skin), material);
  body.name = 'Cuerpo del conductor';
  body.position.y = height;
  group.add(body);
  // Frente hacia +X local; en Colombia se conduce desde el lado izquierdo (−Z).
  group.position.set(.05, 0, -.36);
  return group;
}

// INTERACT_RANGE (1,8 m) menos este recargo: desde un espejo el aviso se alcanza a un metro.
const MIRROR_REACH_PENALTY = .8;
// El contorno sale unos pasos antes que el aviso, para ver a cuál carro se está llegando, y se esconde algo más lejos de donde
// salió: quien se queda parado en el límite no lo ve entrar y salir.
const MARKER_SHOW = INTERACT_RANGE + 2.2, MARKER_HIDE = MARKER_SHOW + .6, MARKER_FADE = .3;

export class Car {
  constructor(scene, position, rotation = 0, { traffic = false, kind = null, variant = null, model = null } = {}) {
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
    // El haz solo lo muestra quien circula: un parqueado no gasta un material en algo que nunca enciende.
    // Solo el que circula anima ruedas y plumillas; el resto las lleva unidas a sus molduras y ahorra seis llamadas.
    const v = makeVehicle(resolvedKind, Number.isFinite(variant) ? Math.trunc(variant) : Math.floor(Math.random() * 10000), { beams: traffic, model, parked: !traffic });
    this.vehicle = v;
    this.length = v.length;
    this.width = v.width;
    // El constructor visual decide qué proyecta sombra: nunca los haces ni los vidrios.
    if (!v.visualManaged) v.group.traverse((o) => {
      if (o.isMesh && !o.material?.transparent) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.group.add(v.group);
    this._bodyRestY = v.bodyVisual?.position.y ?? 0;
    this._wetMaterials = (v.wetMaterials ?? []).map(material => ({ material, roughness: material.roughness }));

    // Retrovisores (lo que se roba): dos soportes y una sola malla con ambos, que siempre se roban y vuelven juntos.
    this.mirrors = [];
    const anchors = v.mirrorAnchors ?? [-1, 1].map(side => new THREE.Vector3(.82, 1.02, side * (v.width / 2 + .1)));
    for (const anchor of anchors) {
      const holder = new THREE.Group();
      holder.name = 'Retrovisor';
      holder.position.copy(anchor);
      (v.bodyVisual ?? this.group).add(holder);
      this.mirrors.push(holder);
    }
    this._mirrorMesh = new THREE.Mesh(v.mirrorGeometry, v.trimMaterial);
    this._mirrorMesh.name = 'Carcasas y lunas de los retrovisores';
    this._mirrorMesh.position.copy(anchors[0]).negate();
    this.mirrors[0].add(this._mirrorMesh);

    // Contorno en el piso: solo en un parqueado y con el jugador cerca (`_updateMarker`).
    this.marker = new THREE.Mesh(markerGeometry(v.length, v.width), markerMaterial(1));
    this.marker.name = 'Contorno del carro';
    this.marker.visible = false;
    this._markerNear = false;
    this._markerFade = 0;
    this.group.add(this.marker);

    // Solo los carros en circulación llevan conductor; los estacionados activan la alarma.
    this.driver = traffic ? createSeatedDriver(v.driverHeight ?? (this.modelKind === 'car2' ? 1.45 : 1.62), v.trimMaterial) : null;
    if (this.driver) {
      if (v.driverAnchor) this.driver.position.copy(v.driverAnchor);
      (v.bodyVisual ?? this.group).add(this.driver);
    }
    this._detailNear = true;
    if (v.bodyVisual) v.bodyVisual.onBeforeRender = (renderer, scene, camera) => this._updateDetail(camera);
  }

  /** De lejos se apagan las piezas pequeñas; solo cambia con histéresis para no parpadear en el umbral. */
  _updateDetail(camera) {
    const e = camera.matrixWorld.elements, p = this.group.position;
    const dx = e[12] - p.x, dz = e[14] - p.z, d2 = dx * dx + dz * dz;
    const near = this._detailNear ? d2 < DETAIL_FAR * DETAIL_FAR : d2 < DETAIL_NEAR * DETAIL_NEAR;
    if (near === this._detailNear) return;
    this._detailNear = near;
    this._mirrorMesh.visible = near;
    if (this.driver) this.driver.children[0].visible = near;
    for (const wiper of this.vehicle.wipers ?? []) wiper.visible = near;
  }

  /** Muestra u oculta al conductor sentado (se baja del carro o vuelve a subir). */
  setDriverInside(inside) {
    this.driverInside = inside;
    if (this.driver) this.driver.visible = inside && !this.driverHidden;
  }

  /** Punto junto a la puerta del conductor, en metros del mundo. Cada modelo la tiene a la altura de su asiento; `side` la pasa al otro lado. */
  driverDoor(target = new THREE.Vector3(), side = this.vehicle.driverDoor?.side ?? -1) {
    this.group.updateMatrixWorld();
    const door = this.vehicle.driverDoor;
    return target.set(door?.x ?? .05, 0, side * (this.width / 2 + .55)).applyMatrix4(this.group.matrixWorld).setY(this.group.position.y);
  }

  get position() { return this.group.position; }

  /** Si `steal` daría algo: a una patrulla no se le roban los espejos y los ya robados tardan en volver. */
  get stealable() { return this.kind !== 'police' && !this.used && this.cooldown <= 0; }

  /**
   * Distancia para el aviso de robar: al centro o, con un recargo, a un espejo. En un carro largo el espejo queda a varios metros
   * del centro y, sin esto, el aviso no sale parado junto a él. El recargo acorta el alcance desde el espejo a un metro, para que
   * en un carro normal el aviso no salga mucho más lejos ni le quite el turno a una tienda o a la basura que estén más cerca.
   * Sin espejos que robar solo cuenta el centro.
   */
  interactDistance(point) {
    const p = this.group.position, center = p.distanceTo(point);
    if (!this.stealable) return center;
    const cos = Math.cos(this.group.rotation.y), sin = Math.sin(this.group.rotation.y), dy = p.y - point.y;
    let mirror = Infinity;
    for (const { position: a } of this.mirrors) {
      const dx = p.x + a.x * cos + a.z * sin - point.x, dz = p.z - a.x * sin + a.z * cos - point.z;
      mirror = Math.min(mirror, dx * dx + dy * dy + dz * dz);
    }
    return Math.min(center, Math.sqrt(mirror) + MIRROR_REACH_PENALTY);
  }

  preloadModel() {
    // La carrocería administrada conserva ruedas, cristales y piezas móviles al terminar la carga.
    if (this.vehicle.visualManaged || this.kind === 'police') return this._modelPromise ??= Promise.resolve();
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
    if (!this.stealable) return null;

    const items = [];
    const mirrorCount = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < mirrorCount; i++) items.push('retrovisor');
    if (!this.traffic && Math.random() < 0.2) items.push('radio');

    const caughtChance = 0.25 * caughtMult;
    const caught = Math.random() < caughtChance;

    this.used = true;
    this.cooldown = CAR_COOLDOWN;
    this.mirrors.forEach((m) => (m.visible = false));
    this._markerFade = 0;
    this.marker.visible = false;

    return { items, caught };
  }

  /** @param {THREE.Vector3} [playerPosition] sin ella el contorno de un parqueado se apaga */
  update(dt, playerPosition = null) {
    if (!(dt > 0) || this._disposed) return;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.used = false;
        this.mirrors.forEach((m) => (m.visible = true));
      }
    }
    if (!this.traffic) this._updateMarker(dt, playerPosition);
    // El tráfico avanza sus visuales en cada subpaso. Un estacionado está vacío: no hay quien mueva las plumillas con la lluvia.
  }

  /** Funde el contorno de un parqueado según lo cerca que esté el jugador, medido igual que el aviso de robar. */
  _updateMarker(dt, player) {
    const reach = this._markerNear ? MARKER_HIDE : MARKER_SHOW;
    this._markerNear = !!player && this.stealable && this.interactDistance(player) < reach;
    const fade = Math.max(0, Math.min(1, this._markerFade + (this._markerNear ? dt : -dt) / MARKER_FADE));
    if (fade === this._markerFade) return;
    this._markerFade = fade;
    this.marker.visible = fade > 0;
    if (fade > 0) this.marker.material = markerMaterial(fade);
  }

  /** Dobla el contorno sobre el sardinel, que queda a `distance` metros del centro hacia `side` en la Z local. */
  setCurb(side, distance) {
    this.marker.geometry = markerGeometry(this.length, this.width, distance);
    this.marker.rotation.y = side > 0 ? 0 : Math.PI;
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
      this._braking = braking;
      this._applyTail();
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
      // Con más brillo el tono de pantalla lavaba el rojo a durazno y el azul a lila.
      lights.blue.color.set(on ? '#1a6cff' : '#061028').multiplyScalar(on ? 1.8 : 0.35);
      lights.red.color.set(on ? '#061028' : '#ff1a2a').multiplyScalar(on ? 0.35 : 1.8);
    }
  }

  _applyTail() {
    const level = this._braking ? TAIL_BRAKE : this._lightsOn ? TAIL_NIGHT : TAIL_DAY;
    this.vehicle.tailMat?.color?.set('#ff120a').multiplyScalar(level);
  }

  setNight(isNight, isRaining = false, isFoggy = false) {
    this.setWeather({ isRaining });
    // De día los faros van apagados: se encienden con la noche, la lluvia o la neblina. Solo si hay conductor; un parqueado sigue apagado.
    const on = this.traffic && (isNight || isRaining || isFoggy);
    this._lightsOn = on;
    if (this.vehicle.headlightMaterial) this.vehicle.headlightMaterial.emissiveIntensity = !on ? .02 : isNight ? 1.35 : .8;
    this._applyTail();
    if (this.vehicle?.beam) {
      this.vehicle.beam.visible = on;
      this.vehicle.beam.material.opacity = isNight ? 0.38 : .28;
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
    if (this.vehicle.bodyVisual) this.vehicle.bodyVisual.onBeforeRender = () => {};
    this.group.remove(this.vehicle.group);
    // Conductor, espejos y contorno usan recursos compartidos con el resto de la flota.
    this.vehicle.dispose();
  }
}
