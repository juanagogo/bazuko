// src/entities/Dog.js
// "El Chato": Compañero canino criollo callejero de Bogotá con anatomía low-poly articulada y comportamiento orgánico
import * as THREE from 'three';

export const DOG_STORAGE_KEY = 'vagabundo.mascota_config';

export const DOG_DEFAULTS = Object.freeze({
  nombre: 'El Chato',
  color: '#965a28',
  accesorio: 'bufanda',
  tamano: 1.0
});

// Límites seguros del Parque Tercer Milenio (césped y plazoleta junto al cambuche, lejos de calzadas)
export const CENTRAL_PARK_BOUNDS = Object.freeze({
  minX: 99.5,
  maxX: 114.5,
  minZ: 91.5,
  maxZ: 112.5
});

/**
 * Construye las tonalidades derivadas del pelaje a partir de un color base hexadecimal.
 */
export function deriveDogPalette(hexColor = DOG_DEFAULTS.color) {
  const base = new THREE.Color();
  try {
    base.set(hexColor || DOG_DEFAULTS.color);
  } catch {
    base.set(DOG_DEFAULTS.color);
  }
  const undercoat = base.clone().lerp(new THREE.Color(0xf5dec0), 0.48);
  const saddle = base.clone().multiplyScalar(0.62);
  const muzzle = base.clone().lerp(new THREE.Color(0xd89b60), 0.35);
  return {
    coat: base.getHex(),
    undercoat: undercoat.getHex(),
    saddle: saddle.getHex(),
    muzzle: muzzle.getHex(),
    dark: 0x22150c,
    eyeShine: 0xfafafa,
    tongue: 0xe86f88
  };
}

function shortestAngleDiff(current, target) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

export class Dog {
  constructor(scene, position = new THREE.Vector3(26, 0, 32)) {
    this.scene = scene;
    this.kind = 'dog';
    this.title = DOG_DEFAULTS.nombre;
    this.nombre = DOG_DEFAULTS.nombre;
    this.color = DOG_DEFAULTS.color;
    this.accesorio = DOG_DEFAULTS.accesorio;
    this.tamano = DOG_DEFAULTS.tamano;

    this.isFriend = false;
    this.state = 'idle';
    this.time = 0;
    this._walkPhase = 0.35;
    this._gaitBlend = 0;
    this._barkTimer = 0;
    this._threatBarkTimer = 0;
    this._lastBarkTime = -99999;
    this._petCooldown = 0;
    this._petReactionTimer = 0;
    this._sniffTimer = 0;
    this._routeTimer = 0;
    this._route = [];
    this._delta = new THREE.Vector3();
    this.sleeping = false;

    this.position = position.clone();
    this.homePosition = position.clone();
    this.parkBounds = this._computeParkBounds(position);
    this._roamState = 'wander';
    this._roamTimer = 0;
    this._roamTarget = null;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    this._loadCustomization();
    this._buildModel();
    if (scene) scene.add(this.group);
  }

  _computeParkBounds(pos) {
    if (
      pos.x >= CENTRAL_PARK_BOUNDS.minX - 4 &&
      pos.x <= CENTRAL_PARK_BOUNDS.maxX + 4 &&
      pos.z >= CENTRAL_PARK_BOUNDS.minZ - 4 &&
      pos.z <= CENTRAL_PARK_BOUNDS.maxZ + 4
    ) {
      return { ...CENTRAL_PARK_BOUNDS };
    }
    return {
      minX: pos.x - 6.5,
      maxX: pos.x + 6.5,
      minZ: pos.z - 6.5,
      maxZ: pos.z + 6.5
    };
  }

  _isSafeParkPoint(x, z) {
    const b = this.parkBounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
    // Evitar meterse dentro de la estructura del cambuche
    if (Math.hypot(x - 112.98, z - 94.64) < 2.6) return false;

    // Evitar cualquier obstáculo con colisión sólida a ras de suelo (bancas, árboles, postes)
    if (this.navigation?.collisions?.colliders) {
      const clearance = 0.85; // Margen para que no elija un punto pegado a una banca u objeto
      for (const { box } of this.navigation.collisions.colliders) {
        if (!box) continue;
        if (box.min.y <= 1.2 && box.max.y >= 0.05) {
          if (
            x >= box.min.x - clearance &&
            x <= box.max.x + clearance &&
            z >= box.min.z - clearance &&
            z <= box.max.z + clearance
          ) {
            return false;
          }
        }
      }
    }

    const map = this.navigation?.district?.map;
    if (map) {
      const tx = Math.round(x / 2);
      const tz = Math.round(z / 2);
      const tile = map[tz]?.[tx];
      if (!['grass', 'plaza', 'dirt'].includes(tile)) return false;
    }
    return true;
  }

  _pickParkTarget() {
    const b = this.parkBounds;
    // Intentar primero encontrar un objetivo con línea recta despejada sin obstáculos en medio
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 2.0 + Math.random() * 5.0;
      const x = THREE.MathUtils.clamp(this.position.x + Math.cos(angle) * dist, b.minX + 0.6, b.maxX - 0.6);
      const z = THREE.MathUtils.clamp(this.position.z + Math.sin(angle) * dist, b.minZ + 0.6, b.maxZ - 0.6);
      if (this._isSafeParkPoint(x, z)) {
        const candidate = new THREE.Vector3(x, this.position.y, z);
        if (!this.navigation?.clearLine || this.navigation.clearLine(this.position, candidate)) {
          return candidate;
        }
      }
    }
    // Si no encontró línea recta limpia tras varios intentos, elegir un punto seguro
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 1.5 + Math.random() * 3.5;
      const x = THREE.MathUtils.clamp(this.position.x + Math.cos(angle) * dist, b.minX + 0.6, b.maxX - 0.6);
      const z = THREE.MathUtils.clamp(this.position.z + Math.sin(angle) * dist, b.minZ + 0.6, b.maxZ - 0.6);
      if (this._isSafeParkPoint(x, z)) {
        return new THREE.Vector3(x, this.position.y, z);
      }
    }
    const cx = THREE.MathUtils.clamp((b.minX + b.maxX) * 0.5, b.minX + 1, b.maxX - 1);
    const cz = THREE.MathUtils.clamp((b.minZ + b.maxZ) * 0.5 + 2, b.minZ + 1, b.maxZ - 1);
    return new THREE.Vector3(cx, this.position.y, cz);
  }

  /**
   * Intenta avanzar en la dirección deseada. Si encuentra un obstáculo como una banca,
   * prueba ángulos de evasión suaves (+-30°, +-60°, +-90°) para bordearlo orgánicamente.
   */
  _tryMoveWithEvasion(toX, toZ, step, collisions) {
    if (!collisions) {
      const dist = Math.hypot(toX, toZ);
      if (dist < 0.001) return { moved: 0, angle: 0 };
      const move = Math.min(step, dist);
      this.position.x += (toX / dist) * move;
      this.position.z += (toZ / dist) * move;
      return { moved: move, angle: Math.atan2(toX, toZ) };
    }

    const baseAngle = Math.atan2(toX, toZ);
    const offsets = [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57];
    const prevPos = this.position.clone();

    for (const offset of offsets) {
      const angle = baseAngle + offset;
      const testDelta = new THREE.Vector3(Math.sin(angle) * step, 0, Math.cos(angle) * step);
      this.position.copy(prevPos);
      collisions.resolveMove(this.position, testDelta, 0.24, this.position);
      const actualMoved = Math.hypot(this.position.x - prevPos.x, this.position.z - prevPos.z);
      if (actualMoved > step * 0.55) {
        return { moved: actualMoved, angle };
      }
    }

    this.position.copy(prevPos);
    return { moved: 0, angle: baseAngle };
  }

  _loadCustomization() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DOG_STORAGE_KEY) : null;
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.nombre) {
        this.nombre = String(saved.nombre).trim() || DOG_DEFAULTS.nombre;
        this.title = this.nombre;
      }
      if (saved?.color) this.color = saved.color;
      if (saved?.accesorio) this.accesorio = saved.accesorio;
      if (saved?.tamano !== undefined) {
        const size = Number(saved.tamano);
        if (Number.isFinite(size)) this.tamano = Math.max(0.6, Math.min(1.6, size));
      }
    } catch { /* sin almacenamiento */ }
  }

  _clearModel() {
    const geometries = new Set();
    const materials = new Set();
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      child.traverse((obj) => {
        if (obj.geometry) geometries.add(obj.geometry);
        if (obj.material) materials.add(obj.material);
      });
    }
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
  }

  _buildModel() {
    this._clearModel();
    const palette = deriveDogPalette(this.color);
    const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

    const coatMat = mat(palette.coat);
    const underMat = mat(palette.undercoat);
    const saddleMat = mat(palette.saddle);
    const muzzleMat = mat(palette.muzzle);
    const darkMat = mat(palette.dark);
    const shineMat = new THREE.MeshBasicMaterial({ color: palette.eyeShine });
    const tongueMat = mat(palette.tongue);

    // 1. Tórax profundo (pecho canino) y lomo oscuro (montura criolla)
    const thoraxGeo = new THREE.BoxGeometry(0.34, 0.30, 0.38);
    this.body = new THREE.Mesh(thoraxGeo, coatMat);
    this.body.position.set(0, 0.39, 0.11);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.group.add(this.body);

    const saddleGeo = new THREE.BoxGeometry(0.32, 0.05, 0.56);
    const saddle = new THREE.Mesh(saddleGeo, saddleMat);
    saddle.position.set(0, 0.14, -0.10);
    this.body.add(saddle);

    // Pechera clara ("pecho blanco/crema" típico de perro criollo)
    const chestGeo = new THREE.BoxGeometry(0.24, 0.21, 0.10);
    this.chestPatch = new THREE.Mesh(chestGeo, underMat);
    this.chestPatch.position.set(0, 0.35, 0.27);
    this.group.add(this.chestPatch);

    // 2. Abdomen recogido (cintura atlética canina / abdominal tuck) y grupa
    const abdomenGeo = new THREE.BoxGeometry(0.28, 0.24, 0.34);
    this.abdomen = new THREE.Mesh(abdomenGeo, coatMat);
    this.abdomen.position.set(0, 0.41, -0.18);
    this.abdomen.rotation.x = 0.08;
    this.abdomen.castShadow = true;
    this.abdomen.receiveShadow = true;
    this.group.add(this.abdomen);

    // 3. Cuello musculoso inclinado
    const neckGeo = new THREE.BoxGeometry(0.23, 0.23, 0.20);
    this.neck = new THREE.Mesh(neckGeo, coatMat);
    this.neck.position.set(0, 0.48, 0.26);
    this.neck.rotation.x = 0.30;
    this.neck.castShadow = true;
    this.group.add(this.neck);

    // 4. Grupo articulado de Cabeza (pivote en la nuca)
    this.head = new THREE.Group();
    this.head.position.set(0, 0.56, 0.36);
    this.group.add(this.head);

    const craniumGeo = new THREE.BoxGeometry(0.26, 0.22, 0.25);
    const cranium = new THREE.Mesh(craniumGeo, coatMat);
    cranium.position.set(0, 0.02, 0.02);
    cranium.castShadow = true;
    this.head.add(cranium);

    // Cejas expresivas
    const browGeo = new THREE.BoxGeometry(0.065, 0.025, 0.04);
    this.browL = new THREE.Mesh(browGeo, saddleMat);
    this.browL.position.set(0.075, 0.095, 0.14);
    this.browL.rotation.z = -0.15;
    this.head.add(this.browL);

    this.browR = new THREE.Mesh(browGeo, saddleMat);
    this.browR.position.set(-0.075, 0.095, 0.14);
    this.browR.rotation.z = 0.15;
    this.head.add(this.browR);

    // Ojos con brillo especular
    const eyeGeo = new THREE.BoxGeometry(0.04, 0.045, 0.03);
    const shineGeo = new THREE.BoxGeometry(0.016, 0.016, 0.01);
    for (const side of [1, -1]) {
      const eye = new THREE.Mesh(eyeGeo, darkMat);
      eye.position.set(side * 0.08, 0.04, 0.14);
      this.head.add(eye);

      const shine = new THREE.Mesh(shineGeo, shineMat);
      shine.position.set(side * 0.086, 0.05, 0.155);
      this.head.add(shine);
    }

    // Hocico alargado con puente nasal, mandíbula inferior, lengua y trufa húmeda
    const snoutGeo = new THREE.BoxGeometry(0.15, 0.10, 0.19);
    this.snout = new THREE.Mesh(snoutGeo, muzzleMat);
    this.snout.position.set(0, -0.025, 0.20);
    this.snout.castShadow = true;
    this.head.add(this.snout);

    const bridgeGeo = new THREE.BoxGeometry(0.10, 0.03, 0.17);
    const nasalBridge = new THREE.Mesh(bridgeGeo, saddleMat);
    nasalBridge.position.set(0, 0.025, 0.19);
    this.head.add(nasalBridge);

    const jawGeo = new THREE.BoxGeometry(0.125, 0.042, 0.16);
    this.jaw = new THREE.Mesh(jawGeo, darkMat);
    this.jaw.position.set(0, -0.085, 0.17);
    this.head.add(this.jaw);

    const tongueGeo = new THREE.BoxGeometry(0.06, 0.02, 0.095);
    this.tongue = new THREE.Mesh(tongueGeo, tongueMat);
    this.tongue.position.set(0, -0.072, 0.23);
    this.tongue.rotation.x = 0.28;
    this.head.add(this.tongue);

    const noseGeo = new THREE.BoxGeometry(0.075, 0.055, 0.055);
    this.nose = new THREE.Mesh(noseGeo, darkMat);
    this.nose.position.set(0, 0.005, 0.30);
    this.head.add(this.nose);

    // Orejas criollas semi-caídas articuladas (base erguida + punta doblada)
    const createEar = (side) => {
      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.125, 0.10, -0.01);
      earPivot.rotation.z = -side * 0.28;

      const baseGeo = new THREE.BoxGeometry(0.065, 0.10, 0.085);
      const earBase = new THREE.Mesh(baseGeo, saddleMat);
      earBase.position.set(side * 0.01, 0.03, 0);
      earPivot.add(earBase);

      const tipGeo = new THREE.BoxGeometry(0.07, 0.11, 0.095);
      const earTip = new THREE.Mesh(tipGeo, darkMat);
      earTip.position.set(side * 0.03, -0.03, 0.03);
      earTip.rotation.x = 0.45;
      earTip.rotation.z = -side * 0.35;
      earPivot.add(earTip);

      return earPivot;
    };

    this.leftEar = createEar(1);
    this.rightEar = createEar(-1);
    this.head.add(this.leftEar);
    this.head.add(this.rightEar);

    // 5. Cola curva articulada en dos segmentos (base + punta en sable)
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.48, -0.35);
    this.tail.rotation.x = -Math.PI / 3.4;
    this.group.add(this.tail);

    const tailBaseGeo = new THREE.CylinderGeometry(0.032, 0.048, 0.22, 6);
    const tailBase = new THREE.Mesh(tailBaseGeo, coatMat);
    tailBase.position.set(0, 0.10, -0.02);
    tailBase.castShadow = true;
    this.tail.add(tailBase);

    const tailTipGeo = new THREE.CylinderGeometry(0.016, 0.032, 0.18, 6);
    this.tailTip = new THREE.Mesh(tailTipGeo, saddleMat);
    this.tailTip.position.set(0, 0.24, 0.02);
    this.tailTip.rotation.x = 0.38;
    this.tail.add(this.tailTip);

    // 6. Extremidades delanteras articuladas desde el hombro (hombro -> antebrazo -> pata digitígrada)
    const createFrontLeg = (x) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(x, 0.30, 0.22);

      const upperGeo = new THREE.BoxGeometry(0.095, 0.16, 0.10);
      const upper = new THREE.Mesh(upperGeo, coatMat);
      upper.position.set(0, -0.07, 0);
      upper.castShadow = true;
      shoulder.add(upper);

      const forearmGroup = new THREE.Group();
      forearmGroup.position.set(0, -0.14, 0);
      shoulder.add(forearmGroup);

      const lowerGeo = new THREE.BoxGeometry(0.08, 0.14, 0.085);
      const lower = new THREE.Mesh(lowerGeo, coatMat);
      lower.position.set(0, -0.06, 0.005);
      lower.castShadow = true;
      forearmGroup.add(lower);

      const pawGeo = new THREE.BoxGeometry(0.092, 0.052, 0.125);
      const paw = new THREE.Mesh(pawGeo, underMat);
      paw.position.set(0, -0.135, 0.025);
      forearmGroup.add(paw);

      shoulder.userData.lowerJoint = forearmGroup;
      return shoulder;
    };

    this.legFL = createFrontLeg(0.125);
    this.legFR = createFrontLeg(-0.125);
    this.group.add(this.legFL);
    this.group.add(this.legFR);

    // 7. Extremidades traseras con muslo, corvejón (hock) angulado y pata trasera
    const createHindLeg = (x) => {
      const hip = new THREE.Group();
      hip.position.set(x, 0.31, -0.24);

      const thighGeo = new THREE.BoxGeometry(0.11, 0.17, 0.135);
      const thigh = new THREE.Mesh(thighGeo, coatMat);
      thigh.position.set(0, -0.07, 0.01);
      thigh.rotation.x = 0.18;
      thigh.castShadow = true;
      hip.add(thigh);

      const hockGroup = new THREE.Group();
      hockGroup.position.set(0, -0.15, -0.025);
      hip.add(hockGroup);

      const metatarsusGeo = new THREE.BoxGeometry(0.076, 0.14, 0.082);
      const metatarsus = new THREE.Mesh(metatarsusGeo, coatMat);
      metatarsus.position.set(0, -0.06, 0.01);
      metatarsus.rotation.x = -0.16;
      metatarsus.castShadow = true;
      hockGroup.add(metatarsus);

      const pawGeo = new THREE.BoxGeometry(0.092, 0.052, 0.125);
      const paw = new THREE.Mesh(pawGeo, underMat);
      paw.position.set(0, -0.14, 0.035);
      hockGroup.add(paw);

      hip.userData.lowerJoint = hockGroup;
      return hip;
    };

    this.legBL = createHindLeg(0.125);
    this.legBR = createHindLeg(-0.125);
    this.group.add(this.legBL);
    this.group.add(this.legBR);

    // 8. Accesorio personalizable (pañuelo bogotano rojo por defecto, collar con placa o gorra)
    this._buildAccessory(mat);

    const scaleY = this.sleeping ? this.tamano * 0.55 : this.tamano;
    this.group.scale.set(this.tamano, scaleY, this.tamano);
  }

  _buildAccessory(mat) {
    this.accessoryGroup = new THREE.Group();
    this.group.add(this.accessoryGroup);

    if (this.accesorio === 'bufanda') {
      const scarfMat = mat(0xd63031);
      const bandGeo = new THREE.BoxGeometry(0.29, 0.075, 0.21);
      const band = new THREE.Mesh(bandGeo, scarfMat);
      band.position.set(0, 0.46, 0.26);
      band.rotation.x = 0.25;
      this.accessoryGroup.add(band);

      const bibGeo = new THREE.ConeGeometry(0.10, 0.14, 3);
      const bib = new THREE.Mesh(bibGeo, scarfMat);
      bib.position.set(0, 0.39, 0.35);
      bib.rotation.x = Math.PI - 0.35;
      bib.rotation.y = Math.PI;
      this.accessoryGroup.add(bib);
    } else if (this.accesorio === 'collar') {
      const collarMat = mat(0x2980b9);
      const tagMat = mat(0xf1c40f);
      const bandGeo = new THREE.BoxGeometry(0.27, 0.055, 0.19);
      const band = new THREE.Mesh(bandGeo, collarMat);
      band.position.set(0, 0.46, 0.26);
      band.rotation.x = 0.25;
      this.accessoryGroup.add(band);

      const tagGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.015, 8);
      const tag = new THREE.Mesh(tagGeo, tagMat);
      tag.position.set(0, 0.41, 0.36);
      tag.rotation.x = Math.PI / 2;
      this.accessoryGroup.add(tag);
    } else if (this.accesorio === 'gorra') {
      const capMat = mat(0xf39c12);
      const visorMat = mat(0xd35400);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.065, 0.21), capMat);
      crown.position.set(0, 0.14, 0.02);
      this.head.add(crown);

      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.022, 0.11), visorMat);
      visor.position.set(0, 0.115, 0.15);
      visor.rotation.x = 0.12;
      this.head.add(visor);
    }
  }

  applyCustomization({ nombre, color, accesorio, tamano } = {}) {
    if (nombre !== undefined) {
      this.nombre = String(nombre).trim() || DOG_DEFAULTS.nombre;
      this.title = this.nombre;
    }
    if (color !== undefined) this.color = color;
    if (accesorio !== undefined) this.accesorio = accesorio;
    if (tamano !== undefined) {
      const parsed = Number(tamano);
      if (Number.isFinite(parsed)) this.tamano = Math.max(0.6, Math.min(1.6, parsed));
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DOG_STORAGE_KEY, JSON.stringify({
          nombre: this.nombre,
          color: this.color,
          accesorio: this.accesorio,
          tamano: this.tamano
        }));
      }
    } catch { /* sin almacenamiento */ }
    this._buildModel();
  }

  getDistractionBonus() {
    return this.isFriend ? 0.10 : 0;
  }

  befriend() {
    this.isFriend = true;
    this._barkTimer = 0;
  }

  pet() {
    if (this._petCooldown > 0) return false;
    this._petCooldown = 20;
    this._petReactionTimer = 1.4;
    this.time += 2;
    return true;
  }

  bark(reason = '¡Guau!') {
    const now = performance.now();
    if (now - this._lastBarkTime < 7000) return;
    this._lastBarkTime = now;

    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: `🐕 ${this.title}: ${reason}`, type: 'info' }
    }));
    window.dispatchEvent(new CustomEvent('dog-bark'));
  }

  _turnTowards(targetAngle, rate, dt) {
    const diff = shortestAngleDiff(this.group.rotation.y, targetAngle);
    this.group.rotation.y += diff * Math.min(1, rate * dt);
    // Inclinación espinal natural al girar (la cabeza guía el giro y la grupa acompaña)
    const bank = THREE.MathUtils.clamp(diff * 0.25, -0.22, 0.22);
    this.abdomen.rotation.y = THREE.MathUtils.lerp(this.abdomen.rotation.y || 0, -bank * 0.7, Math.min(1, 10 * dt));
    return diff;
  }

  _animateLegs(phase, amplitude = 0.42) {
    const swingA = Math.sin(phase) * amplitude;
    const swingB = Math.sin(phase + Math.PI) * amplitude;

    this.legFL.rotation.x = swingA;
    this.legBR.rotation.x = swingA;
    this.legFR.rotation.x = swingB;
    this.legBL.rotation.x = swingB;

    // Flexión de carpo y corvejón al levantar la pata en fase de balanceo
    const bendA = Math.max(0, -Math.cos(phase)) * amplitude * 0.85;
    const bendB = Math.max(0, -Math.cos(phase + Math.PI)) * amplitude * 0.85;

    const flLower = this.legFL.userData.lowerJoint;
    const frLower = this.legFR.userData.lowerJoint;
    const blLower = this.legBL.userData.lowerJoint;
    const brLower = this.legBR.userData.lowerJoint;

    if (flLower) flLower.rotation.x = -bendA;
    if (frLower) frLower.rotation.x = -bendB;
    if (blLower) blLower.rotation.x = bendB * 0.7;
    if (brLower) brLower.rotation.x = bendA * 0.7;
  }

  _relaxLegs(dt) {
    const damp = Math.min(1, 12 * dt);
    for (const leg of [this.legFL, this.legFR, this.legBL, this.legBR]) {
      leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, 0, damp);
      if (leg.userData.lowerJoint) {
        leg.userData.lowerJoint.rotation.x = THREE.MathUtils.lerp(leg.userData.lowerJoint.rotation.x, 0, damp);
      }
    }
    this.abdomen.rotation.y = THREE.MathUtils.lerp(this.abdomen.rotation.y || 0, 0, damp);
  }

  _resetLegs() {
    this.legFL.rotation.x = 0;
    this.legFR.rotation.x = 0;
    this.legBL.rotation.x = 0;
    this.legBR.rotation.x = 0;
    for (const leg of [this.legFL, this.legFR, this.legBL, this.legBR]) {
      if (leg.userData.lowerJoint) leg.userData.lowerJoint.rotation.x = 0;
    }
  }

  _checkThreats(npcs = []) {
    if (this._threatBarkTimer > 0) return false;
    for (const n of npcs) {
      if (n?.position && n.alerta > 0.6 && this.position.distanceTo(n.position) < 3.5) {
        this.state = 'alerta';
        this._threatBarkTimer = 6.0;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: `🐕 ¡${this.title} gruñe y alerta de un peatón desconfiado!`, type: 'info' }
          }));
        }
        return true;
      }
    }
    return false;
  }

  _updateParkLife(dt, playerPosition, distToPlayer) {
    const excited = this._petReactionTimer > 0;
    this._roamTimer -= dt;

    // Si el jugador se acerca en el parque, El Chato muestra curiosidad sin salir del parque
    if (distToPlayer < 5.5 && distToPlayer > 1.8 && this._roamState !== 'curious' && Math.random() < 0.08) {
      this._roamState = 'curious';
      this._roamTimer = 2.6;
    }

    if (this._roamTimer <= 0) {
      const roll = Math.random();
      if (distToPlayer < 4.5 && roll < 0.45) {
        this._roamState = 'curious';
        this._roamTimer = 2.0 + Math.random() * 1.8;
      } else if (roll < 0.58) {
        this._roamState = 'wander';
        this._roamTarget = this._pickParkTarget();
        this._roamTimer = 4.5 + Math.random() * 3.5;
      } else if (roll < 0.84) {
        this._roamState = 'sniff';
        this._roamTimer = 2.2 + Math.random() * 2.0;
      } else {
        this._roamState = 'look';
        this._roamTimer = 1.8 + Math.random() * 1.8;
      }
    }

    if (this._roamState === 'wander' && this._roamTarget) {
      const toTargetX = this._roamTarget.x - this.position.x;
      const toTargetZ = this._roamTarget.z - this.position.z;
      const rem = Math.hypot(toTargetX, toTargetZ);

      if (rem < 0.35) {
        this._roamState = 'sniff';
        this._roamTimer = 1.8 + Math.random() * 1.6;
      } else {
        this.state = 'wander';
        const wanderSpeed = 1.75;
        const step = Math.min(wanderSpeed * dt, rem);
        const prevX = this.position.x;
        const prevZ = this.position.z;

        const moveResult = this._tryMoveWithEvasion(toTargetX, toTargetZ, step, this.navigation?.collisions);
        const turnDiff = this._turnTowards(moveResult.angle, 6.5, dt);

        // Si quedó bloqueado contra un obstáculo (como una banca)
        if (moveResult.moved < step * 0.25) {
          this._stuckTimer = (this._stuckTimer || 0) + dt;
          if (this._stuckTimer > 0.35) {
            // Se atascó: suspender carrera, olfatear el obstáculo curiosamente y elegir nuevo rumbo
            this._stuckTimer = 0;
            this._roamState = 'sniff';
            this._roamTimer = 1.6 + Math.random() * 1.2;
            this._roamTarget = this._pickParkTarget();
            this.state = 'idle';
            this._gaitBlend = 0;
            this._relaxLegs(dt);
            return;
          }
        } else {
          this._stuckTimer = Math.max(0, (this._stuckTimer || 0) - dt * 2);
        }

        // Mantener estrictamente dentro del parque y fuera de calzadas
        if (!this._isSafeParkPoint(this.position.x, this.position.z)) {
          this.position.x = THREE.MathUtils.clamp(prevX, this.parkBounds.minX, this.parkBounds.maxX);
          this.position.z = THREE.MathUtils.clamp(prevZ, this.parkBounds.minZ, this.parkBounds.maxZ);
          this._roamTarget = this._pickParkTarget();
        }

        this.position.y = this.navigation?.district?.getGroundHeight?.(this.position.x, this.position.z) ?? this.position.y;
        this.group.position.copy(this.position);

        this._walkPhase += dt * 10.5;
        this._gaitBlend = THREE.MathUtils.lerp(this._gaitBlend, 1, Math.min(1, 10 * dt));
        this._animateLegs(this._walkPhase, 0.32 * this._gaitBlend);

        const bounce = Math.abs(Math.sin(this._walkPhase)) * 0.018;
        this.body.position.y = 0.39 + bounce;
        this.abdomen.position.y = 0.41 + bounce * 0.85;
        this.head.position.y = 0.55 + Math.sin(this._walkPhase * 2) * 0.012;
        this.head.rotation.x = 0.14 + Math.sin(this._walkPhase) * 0.04;
        this.head.rotation.y = THREE.MathUtils.clamp(turnDiff * 0.35, -0.28, 0.28);
        this.head.rotation.z = 0;
        this.leftEar.rotation.x = -0.08 + Math.sin(this._walkPhase * 2) * 0.06;
        this.rightEar.rotation.x = -0.08 + Math.cos(this._walkPhase * 2) * 0.06;
        return;
      }
    }

    // Estados estacionarios orgánicos en el parque ('sniff', 'curious', 'look')
    this.state = 'idle';
    this._gaitBlend = THREE.MathUtils.lerp(this._gaitBlend, 0, Math.min(1, 10 * dt));
    this._relaxLegs(dt);

    const breath = Math.sin(this.time * 3.0) * 0.008;
    const hop = excited ? Math.abs(Math.sin(this.time * 16)) * 0.04 : 0;
    this.body.position.y = 0.39 + breath + hop;
    this.abdomen.position.y = 0.41 + breath * 0.65 + hop;

    if (this._roamState === 'sniff') {
      // Olfateando el pasto del parque con barrido suave del hocico
      this.head.position.y = THREE.MathUtils.lerp(this.head.position.y, 0.51, Math.min(1, 8 * dt));
      this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, 0.38 + Math.sin(this.time * 16) * 0.05, Math.min(1, 8 * dt));
      this.head.rotation.y = Math.sin(this.time * 3.2) * 0.22;
      this.head.rotation.z = Math.sin(this.time * 2.1) * 0.05;
      this.leftEar.rotation.x = 0.12 + Math.sin(this.time * 8) * 0.04;
      this.rightEar.rotation.x = 0.12 - Math.sin(this.time * 8) * 0.04;
    } else if (this._roamState === 'curious' && playerPosition) {
      // Mirando al jugador con inclinación curiosa de cabeza
      const angleToPlayer = Math.atan2(playerPosition.x - this.position.x, playerPosition.z - this.position.z);
      this._turnTowards(angleToPlayer, 5.0, dt);
      this.head.position.y = 0.56 + hop;
      this.head.rotation.x = -0.08 + Math.sin(this.time * 2.2) * 0.04;
      this.head.rotation.y = Math.sin(this.time * 1.5) * 0.10;
      this.head.rotation.z = Math.sin(this.time * 2.4) * 0.16;
      this.leftEar.rotation.x = 0.16;
      this.rightEar.rotation.x = 0.16;
    } else {
      // Observando el parque con movimientos suaves de cabeza y orejas
      this.head.position.y = 0.56 + hop;
      this.head.rotation.x = Math.sin(this.time * 1.4) * 0.05;
      this.head.rotation.y = Math.sin(this.time * 1.1) * 0.24;
      this.head.rotation.z = Math.sin(this.time * 0.9) * 0.06;
      this.leftEar.rotation.x = Math.sin(this.time * 2.2) * 0.05;
      this.rightEar.rotation.x = -Math.sin(this.time * 2.2) * 0.05;
    }
  }

  update(dt, playerPosition, pickups = [], npcs = []) {
    this.time += dt;
    this._petCooldown = Math.max(0, this._petCooldown - dt);
    this._petReactionTimer = Math.max(0, this._petReactionTimer - dt);
    this._threatBarkTimer = Math.max(0, this._threatBarkTimer - dt);
    this._sniffTimer = Math.max(0, this._sniffTimer - dt);
    if (this.sleeping) return;

    // Movimiento expresivo de la cola (más alegre cuando es amigo o recién acariciado)
    const excited = this._petReactionTimer > 0;
    const tailSpeed = excited ? 22 : (this.isFriend ? 14 : (this._roamState === 'curious' ? 11 : 6.5));
    const tailAmp = excited ? 0.65 : (this.isFriend ? 0.45 : (this._roamState === 'curious' ? 0.34 : 0.22));
    const tailAngle = Math.sin(this.time * tailSpeed) * tailAmp;
    this.tail.rotation.z = tailAngle;
    this.tail.rotation.y = Math.cos(this.time * tailSpeed * 0.5) * (tailAmp * 0.35);

    // Jadeo sutil de la lengua
    if (this.tongue) {
      const pant = (this.isFriend || this._roamState === 'curious') ? 0.23 + Math.sin(this.time * 12) * 0.015 : 0.21;
      this.tongue.position.z = pant;
    }

    if (!playerPosition) return;

    const dx = playerPosition.x - this.position.x;
    const dz = playerPosition.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (this.isFriend) {
      // Si queda atrapado demasiado lejos (> 32 m), reubicar cerca de un punto transitable del jugador
      if (dist > 32) {
        this.resetNear(playerPosition);
      }

      const stopDist = 2.4;
      const followSpeed = dist > 6 ? 4.8 : 3.4;

      if (dist > stopDist) {
        this.state = 'follow';
        this._routeTimer -= dt;
        if (this.navigation && this._routeTimer <= 0) {
          this._route = this.navigation.route(this.position, playerPosition);
          this._routeTimer = 1;
        }
        while (this._route.length && this.position.distanceTo(this._route[0]) < 0.45) this._route.shift();
        const target = this.navigation ? this._route[0] : playerPosition;
        let turnDiff = 0;
        if (target) {
          this._delta.copy(target).sub(this.position).setY(0);
          const remaining = this._delta.length();
          const moveDist = Math.min(followSpeed * dt, remaining, dist - stopDist);

          const moveResult = this._tryMoveWithEvasion(this._delta.x, this._delta.z, moveDist, this.navigation?.collisions);
          turnDiff = this._turnTowards(moveResult.angle, 9.5, dt);

          if (moveResult.moved < moveDist * 0.25) {
            this._followStuckTimer = (this._followStuckTimer || 0) + dt;
            if (this._followStuckTimer > 0.35) {
              this._routeTimer = 0; // Forzar recálculo inmediato de ruta para bordear el obstáculo
              this._followStuckTimer = 0;
            }
          } else {
            this._followStuckTimer = Math.max(0, (this._followStuckTimer || 0) - dt * 2);
          }
        }
        this.position.y = this.navigation?.district?.getGroundHeight?.(this.position.x, this.position.z) ?? this.position.y;
        this.group.position.copy(this.position);

        // Animación de trote cuadrúpedo con fase continua, rebote de lomo y orejas
        const strideFreq = dist > 6 ? 16.5 : 13.5;
        const strideAmp = dist > 6 ? 0.50 : 0.40;
        this._walkPhase += dt * strideFreq;
        this._gaitBlend = THREE.MathUtils.lerp(this._gaitBlend, 1, Math.min(1, 12 * dt));
        this._animateLegs(this._walkPhase, strideAmp * this._gaitBlend);

        const bounce = Math.abs(Math.sin(this._walkPhase)) * 0.025;
        this.body.position.y = 0.39 + bounce;
        this.abdomen.position.y = 0.41 + bounce * 0.85;
        this.head.position.y = 0.56 + Math.sin(this._walkPhase * 2) * 0.015;
        this.head.rotation.x = dist > 6 ? 0.08 : 0.02;
        this.head.rotation.y = THREE.MathUtils.clamp(turnDiff * 0.35, -0.3, 0.3);
        this.head.rotation.z = 0;
        this.leftEar.rotation.x = -0.15 + Math.sin(this._walkPhase * 2) * 0.08;
        this.rightEar.rotation.x = -0.15 + Math.cos(this._walkPhase * 2) * 0.08;
      } else {
        this.state = 'idle';
        const targetAngle = Math.atan2(dx, dz);
        this._turnTowards(targetAngle, 6.0, dt);
        this._gaitBlend = THREE.MathUtils.lerp(this._gaitBlend, 0, Math.min(1, 10 * dt));
        this._relaxLegs(dt);

        // Respiración suave, reacción de caricias u olfateo en reposo
        const breath = Math.sin(this.time * 3.2) * 0.008;
        const hop = excited ? Math.abs(Math.sin(this.time * 16)) * 0.04 : 0;
        this.body.position.y = 0.39 + breath + hop;
        this.abdomen.position.y = 0.41 + breath * 0.6 + hop;

        if (this._sniffTimer > 0) {
          this.head.rotation.x = 0.34 + Math.sin(this.time * 18) * 0.06;
          this.head.rotation.y = Math.sin(this.time * 4.0) * 0.18;
          this.head.rotation.z = 0;
          this.head.position.y = 0.52;
        } else {
          this.head.rotation.x = excited ? -0.15 : Math.sin(this.time * 1.8) * 0.04;
          this.head.rotation.y = Math.sin(this.time * 1.2) * 0.12;
          this.head.rotation.z = excited ? Math.sin(this.time * 6) * 0.08 : Math.sin(this.time * 1.5) * 0.06;
          this.head.position.y = 0.56 + hop;
        }
        this.leftEar.rotation.x = excited ? 0.18 : Math.sin(this.time * 2.5) * 0.04;
        this.rightEar.rotation.x = excited ? 0.18 : -Math.sin(this.time * 2.5) * 0.04;
      }

      // Alerta de peatones sospechosos cercanos
      if (npcs.length) this._checkThreats(npcs);

      // Olfato / Alerta de canecas o bolsas con materiales útiles
      this._barkTimer += dt;
      if (this._barkTimer > 10) {
        this._barkTimer = 0;
        const nearLoot = pickups.some((p) => !p.used && p.position && p.position.distanceTo(this.position) < 8.5);
        if (nearLoot) {
          this._sniffTimer = 2.5;
          this.bark('¡Olfatea algo valioso en la basura cercana!');
        }
      }
    } else {
      // Vida autónoma dentro del parque sin salir a la calle
      this._updateParkLife(dt, playerPosition, dist);
    }
  }

  destroy() {
    if (this.scene) this.scene.remove(this.group);
    this._clearModel();
  }

  resetNear(position) {
    const nearest = this.navigation?.nearest(position) ?? -1;
    this.position.copy(nearest >= 0 ? this.navigation.point(nearest) : position);
    if (!this.isFriend) {
      this.parkBounds = this._computeParkBounds(this.position);
      this.position.x = THREE.MathUtils.clamp(this.position.x, this.parkBounds.minX, this.parkBounds.maxX);
      this.position.z = THREE.MathUtils.clamp(this.position.z, this.parkBounds.minZ, this.parkBounds.maxZ);
    }
    this.position.y = this.navigation?.district?.getGroundHeight?.(this.position.x, this.position.z) ?? this.position.y;
    this.group.position.copy(this.position);
    this._route = [];
    this._routeTimer = 0;
  }

  restAt(position) {
    if (!this.isFriend) return;
    this.resetNear(position.clone().add(new THREE.Vector3(1, 0, 0)));
    this.sleeping = true;
    this.state = 'sleep';
    this.group.scale.set(this.tamano, this.tamano * 0.55, this.tamano);
    this.head.rotation.x = -0.35;
    this.head.rotation.y = 0;
    this._resetLegs();
  }

  wake() {
    this.sleeping = false;
    this.state = 'idle';
    this.group.scale.setScalar(this.tamano);
    this.head.rotation.x = 0;
  }
}
