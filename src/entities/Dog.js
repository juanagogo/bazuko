// src/entities/Dog.js
// "El Chato": compañero canino criollo callejero de Bogotá. Único perro del juego.
// Modelo de tools/modelos/generar_perro.py; la animación mueve sus huesos por código.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const DOG_COATS = Object.freeze({
  canela: { label: 'Canela', color: '#a8652e' },
  chocolate: { label: 'Chocolate', color: '#5c3a22' },
  negro: { label: 'Negro', color: '#2e2925' },
  crema: { label: 'Crema', color: '#d8c3a0' },
  gris: { label: 'Gris', color: '#7d7872' }
});
export const DOG_ACCESSORIES = Object.freeze({ panuelo: 'Pañuelo rojo', collar: 'Collar azul', gorra: 'Gorra', ninguno: 'Ninguno' });
export const DOG_DEFAULT_LOOK = Object.freeze({ pelaje: 'canela', accesorio: 'panuelo', tamano: 1 });
const SIZE_RANGE = [.8, 1.25];

const STOP_DIST = 2.2;
const CATCH_UP_DIST = 45;
const BARK_COOLDOWN = 7;
const PET_COOLDOWN = 20;
const LEG = .4; // largo de la pata del modelo, para que la zancada no deslice
const HOME_RADIUS = 5;

// Desfase de cada pata en el ciclo según la marcha (FL, FR, HL, HR).
const GAITS = [
  { speed: 0, offsets: [.25, .75, 0, .5], swing: .32 },   // paso
  { speed: 2.4, offsets: [0, .5, .5, 0], swing: .45 },    // trote
  { speed: 5.2, offsets: [0, .12, .55, .67], swing: .62 } // galope
];

const loader = new GLTFLoader();
let modelPromise = null;
const loadModel = () => modelPromise ??= loader.loadAsync(`${import.meta.env?.BASE_URL ?? '/'}models/perro.glb`);

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const smooth = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Corrige una apariencia guardada; acepta un pelaje de la lista o un color #rrggbb. */
export function normalizeDogLook(raw = {}) {
  const look = { ...DOG_DEFAULT_LOOK, ...(raw ?? {}) };
  if (!DOG_COATS[look.pelaje] && !/^#[0-9a-f]{6}$/i.test(look.pelaje)) look.pelaje = DOG_DEFAULT_LOOK.pelaje;
  if (!DOG_ACCESSORIES[look.accesorio]) look.accesorio = DOG_DEFAULT_LOOK.accesorio;
  look.tamano = THREE.MathUtils.clamp(Number(look.tamano) || 1, ...SIZE_RANGE);
  return { pelaje: look.pelaje, accesorio: look.accesorio, tamano: look.tamano };
}

/** Configuración de la antigua mascota personalizable, para no perderla al unificar los perros. */
export function legacyPetLook(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem('vagabundo.mascota_config') ?? 'null');
    if (!saved) return null;
    return normalizeDogLook({
      pelaje: saved.color, accesorio: saved.accesorio === 'bufanda' ? 'panuelo' : saved.accesorio, tamano: saved.tamano
    });
  } catch { return null; }
}

export class Dog {
  constructor(scene, position = new THREE.Vector3(26, 0, 32), look = DOG_DEFAULT_LOOK) {
    this.scene = scene;
    this.kind = 'dog';
    this.title = 'El Chato';
    this.isFriend = false;
    this.time = 0;
    this.sleeping = false;
    this.state = 'idle';
    this.speed = 0;
    this.look = normalizeDogLook(look);
    this._barkTimer = 0;
    this._lastBarkTime = -Infinity;
    this._petCooldown = 0;
    this._happy = 0;
    this._hop = 0;
    this._still = 0;
    this._routeTimer = 0;
    this._route = [];
    this._wanderTarget = null;
    this._wanderPause = 2;
    this._phase = 0;
    this._posture = { sit: 0, lie: 0, sniff: 0, alert: 0 };
    this._lookAt = null;
    this._delta = new THREE.Vector3();

    this.position = position.clone();
    this.home = position.clone();
    this.group = new THREE.Group();
    this.group.name = 'El Chato';
    this.group.position.copy(this.position);
    this.group.scale.setScalar(this.look.tamano);
    scene.add(this.group);
  }

  preloadModel() {
    return this._modelPromise ??= loadModel().then(gltf => {
      if (this._destroyed) return;
      this._mountModel(gltf.scene);
    });
  }

  _mountModel(source) {
    const model = cloneSkinned(source);
    model.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false; // la malla con huesos se recorta mal al animar
      object.material = object.material.clone();
      if (object.material.name === 'pelaje') this._coat = object.material;
    });
    this.group.add(model);
    this.model = model;
    this._rig = new Map();
    this.group.updateMatrixWorld(true);
    const groupInverse = this.group.getWorldQuaternion(new THREE.Quaternion()).invert();
    model.traverse(bone => {
      if (!bone.isBone) return;
      // Ejes del perro expresados en el espacio de cada hueso en reposo.
      const toLocal = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(groupInverse).invert();
      this._rig.set(bone.name, {
        bone, rest: bone.quaternion.clone(), position: bone.position.clone(),
        axes: [X, Y, Z].map(axis => axis.clone().applyQuaternion(toLocal))
      });
    });
    this._applyLook();
  }

  setLook(look) {
    this.look = normalizeDogLook({ ...this.look, ...look });
    this._applyLook();
    return this.look;
  }

  _applyLook() {
    this.group.scale.setScalar(this.look.tamano);
    this._coat?.color.set(DOG_COATS[this.look.pelaje]?.color ?? this.look.pelaje);
    if (!this._rig) return;
    if (this._accessory) {
      this._accessory.removeFromParent();
      this._accessory.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      this._accessory = null;
    }
    const accessory = createAccessory(this.look.accesorio);
    const parent = this._rig.get(this.look.accesorio === 'gorra' ? 'cabeza' : 'cuello')?.bone;
    if (!accessory || !parent) return;
    // Se arma en el espacio del perro en reposo y se ata al hueso conservando la posición.
    this._resetPose();
    this.model.add(accessory);
    this.model.updateMatrixWorld(true);
    parent.attach(accessory);
    this._accessory = accessory;
  }

  befriend() {
    this.isFriend = true;
    this._barkTimer = 0;
    this._happy = 1;
  }

  pet() {
    if (this._petCooldown > 0) return false;
    this._petCooldown = PET_COOLDOWN;
    this._happy = 1;
    this._hop = 1;
    this._still = 0;
    return true;
  }

  /** Reduce la probabilidad de que noten un robo mientras El Chato distrae cerca. */
  distractionBonus(playerPosition) {
    if (!this.isFriend || this.sleeping || !playerPosition) return 0;
    return this.position.distanceTo(playerPosition) < 6 ? .1 : 0;
  }

  bark(reason = '¡Guau!') {
    if (this.time - this._lastBarkTime < BARK_COOLDOWN) return false;
    this._lastBarkTime = this.time;
    this._posture.alert = 1;
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: `🐕 El Chato: ${reason}`, type: 'info' }
    }));
    window.dispatchEvent(new CustomEvent('dog-bark'));
    return true;
  }

  update(dt, playerPosition, pickups = [], npcs = []) {
    this.time += dt;
    this._petCooldown = Math.max(0, this._petCooldown - dt);
    this._happy = Math.max(0, this._happy - dt * .25);
    this._hop = Math.max(0, this._hop - dt * 2.2);
    let desiredSpeed = 0;
    let goal = null;
    this._lookAt = null;

    if (this.sleeping) {
      this.state = 'sleep';
    } else if (this.isFriend && playerPosition) {
      const dist = Math.hypot(playerPosition.x - this.position.x, playerPosition.z - this.position.z);
      // Si quedó muy atrás (bus, viaducto, ruta imposible), aparece cerca del jugador.
      if (dist > CATCH_UP_DIST) {
        this.resetNear(this._delta.copy(this.position).sub(playerPosition).setY(0).setLength(STOP_DIST + .3).add(playerPosition));
        return this._animate(dt);
      }
      if (dist > STOP_DIST) {
        goal = playerPosition;
        desiredSpeed = dist > 9 ? 7 : dist > 4.5 ? 3.6 : 1.5;
        this.state = 'follow';
      } else {
        this.state = 'idle';
        this._lookAt = playerPosition;
      }
      this._sniffAndAlert(dt, pickups, npcs);
    } else {
      // Sin dueño: merodea cerca de su lugar, olfatea y mira a quien se acerca.
      const near = playerPosition && playerPosition.distanceTo(this.position) < 4;
      if (near) {
        this._lookAt = playerPosition;
        this._wanderTarget = null;
        this.state = 'idle';
      } else if (this._wanderTarget) {
        goal = this._wanderTarget;
        desiredSpeed = 1.1;
        this.state = 'wander';
        if (this.position.distanceTo(goal) < .5) { this._wanderTarget = null; this._wanderPause = 3 + Math.random() * 6; }
      } else if ((this._wanderPause -= dt) <= 0) {
        this._wanderTarget = this._pickWanderTarget();
      } else {
        this.state = 'idle';
      }
    }

    this.speed = smooth(this.speed, desiredSpeed, desiredSpeed > this.speed ? 4 : 7, dt);
    if (goal && this.speed > .05) this._moveToward(goal, dt, playerPosition);
    this._still = this.speed < .2 && this._hop <= 0 ? this._still + dt : 0;
    this._groundAndPlace();
    this._animate(dt);
  }

  _sniffAndAlert(dt, pickups, npcs) {
    this._barkTimer += dt;
    if (this._barkTimer > 10) {
      this._barkTimer = 0;
      if (pickups.some(p => !p.used && p.position && p.position.distanceTo(this.position) < 8.5)) {
        this._posture.sniff = 1;
        this.bark('¡Olfatea algo valioso en la basura cercana!');
      }
    }
    for (const npc of npcs) {
      if (npc?.position && npc.alerta > .6 && npc.position.distanceTo(this.position) < 4) {
        this._lookAt = npc.position;
        this.bark('¡Le ladra a un sospechoso que te está mirando!');
        break;
      }
    }
  }

  _pickWanderTarget() {
    const angle = Math.random() * Math.PI * 2, radius = 1.5 + Math.random() * (HOME_RADIUS - 1.5);
    const target = this.home.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    const nav = this.navigation;
    if (!nav) return target;
    const index = nav.nearest(target);
    return index >= 0 ? nav.point(index) : null;
  }

  _moveToward(goal, dt, playerPosition) {
    this._routeTimer -= dt;
    if (this.navigation && this._routeTimer <= 0) {
      this._route = this.navigation.route(this.position, goal);
      this._routeTimer = 1;
    }
    while (this._route.length && this.position.distanceTo(this._route[0]) < .18) this._route.shift();
    const target = this.navigation ? this._route[0] : goal;
    if (!target) return;
    this._delta.copy(target).sub(this.position).setY(0);
    const remaining = this._delta.length();
    // Al seguir, se detiene a STOP_DIST del jugador.
    const toPlayer = this.state === 'follow' && playerPosition
      ? Math.hypot(playerPosition.x - this.position.x, playerPosition.z - this.position.z) - STOP_DIST : Infinity;
    const step = Math.min(this.speed * dt, remaining, Math.max(0, toPlayer));
    if (step <= 0) return;
    this._delta.multiplyScalar(step / Math.max(.001, remaining));
    // Gira con suavidad hacia donde avanza.
    const heading = Math.atan2(this._delta.x, this._delta.z);
    this.group.rotation.y += wrapAngle(heading - this.group.rotation.y) * Math.min(1, 9 * dt);
    if (this.navigation?.collisions) this.navigation.collisions.resolveMove(this.position, this._delta, .24, this.position);
    else this.position.add(this._delta);
  }

  _groundAndPlace() {
    this.position.y = this.navigation?.district.getGroundHeight?.(this.position.x, this.position.z) ?? this.position.y;
    this.group.position.copy(this.position);
  }

  // ---------- animación por huesos ----------

  _resetPose() {
    for (const { bone, rest, position } of this._rig.values()) {
      bone.quaternion.copy(rest);
      bone.position.copy(position);
    }
  }

  /** Gira un hueso sobre los ejes del perro (x: lateral, y: vertical, z: hacia delante). */
  _turn(name, x = 0, y = 0, z = 0) {
    const joint = this._rig.get(name);
    if (!joint) return;
    if (x) joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.axes[0], x));
    if (y) joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.axes[1], y));
    if (z) joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.axes[2], z));
  }

  _animate(dt) {
    const p = this._posture;
    const resting = this.sleeping || this._still > 14;
    const sitting = !resting && this._still > 2.5;
    p.lie = smooth(p.lie, resting ? 1 : 0, 3, dt);
    p.sit = smooth(p.sit, sitting ? 1 : 0, 4, dt);
    p.sniff = smooth(p.sniff, this.state === 'wander' && Math.sin(this.time * .7) > .6 ? 1 : 0, 3, dt) * (1 - p.lie);
    p.alert = Math.max(0, p.alert - dt * .5);
    // Si mira hacia otro lado, gira el cuerpo quieto en el sitio.
    if (this._lookAt && this.speed < .2 && p.lie < .5) {
      const heading = Math.atan2(this._lookAt.x - this.position.x, this._lookAt.z - this.position.z);
      const diff = wrapAngle(heading - this.group.rotation.y);
      if (Math.abs(diff) > .9) this.group.rotation.y += diff * Math.min(1, 3 * dt);
    }
    if (!this._rig) return;
    this._resetPose();

    // Marcha: frecuencia según la velocidad para que las patas apoyadas no deslicen.
    const speed = this.speed;
    const blend = gaitAt(speed);
    const omega = speed / (LEG * blend.swing);
    this._phase = (this._phase + omega * dt / (Math.PI * 2)) % 1;
    const move = THREE.MathUtils.clamp(speed / .4, 0, 1) * (1 - p.lie) * (1 - p.sit);
    const legs = [['brazo', 'antebrazo', 'mano', 'L', true], ['brazo', 'antebrazo', 'mano', 'R', true],
      ['muslo', 'pierna', 'pie', 'L', false], ['muslo', 'pierna', 'pie', 'R', false]];
    legs.forEach(([upper, lower, foot, side, front], i) => {
      const t = (this._phase + blend.offsets[i]) * Math.PI * 2;
      const swing = Math.sin(t) * blend.swing * move;
      const lift = Math.max(0, -Math.cos(t)) * move;
      const sit = p.sit, lie = p.lie;
      if (front) {
        this._turn(`${upper}_${side}`, swing + sit * .55 - lie * 1.25);
        this._turn(`${lower}_${side}`, lift * .9 - sit * .15 + lie * .15);
        this._turn(`${foot}_${side}`, lift * .5 + lie * .9);
      } else {
        this._turn(`${upper}_${side}`, swing - sit * .75 - lie * 1.1);
        this._turn(`${lower}_${side}`, -lift * .7 + sit * 1.9 + lie * 2.1);
        this._turn(`${foot}_${side}`, lift * .6 - sit * 1.2 - lie * 1.1);
      }
    });

    // Tronco: rebote del trote, flexión del galope, sentarse y echarse.
    const gallop = THREE.MathUtils.smoothstep(speed, 4.4, 6);
    const bounce = Math.abs(Math.sin(this._phase * Math.PI * 2)) * move;
    const raiz = this._rig.get('raiz');
    const breath = Math.sin(this.time * (this.sleeping ? 1.6 : 3.2)) * .006;
    const hop = Math.sin(this._hop * Math.PI) * .16;
    raiz.bone.position.y += -.012 * bounce - p.sit * .3 - p.lie * .29 + hop;
    raiz.bone.position.z -= p.sit * .04;
    this._turn('pelvis', -p.sit * .55 + Math.sin(this._phase * Math.PI * 2) * .09 * gallop, 0, 0);
    this._turn('pecho', breath * 4 - Math.sin(this._phase * Math.PI * 2) * .08 * gallop);

    // Cabeza: mira a su objetivo, olfatea el suelo, apoya la cabeza al dormir.
    let yaw = 0, pitch = 0;
    if (this._lookAt) {
      const heading = Math.atan2(this._lookAt.x - this.position.x, this._lookAt.z - this.position.z);
      yaw = THREE.MathUtils.clamp(wrapAngle(heading - this.group.rotation.y), -.8, .8);
      pitch = -.15;
    }
    this._headYaw = smooth(this._headYaw ?? 0, yaw, 5, dt);
    this._headPitch = smooth(this._headPitch ?? 0, pitch, 5, dt);
    const nod = Math.sin(this._phase * Math.PI * 4) * .05 * move;
    this._turn('cuello', p.sit * .5 + p.sniff * .75 + p.lie * (this.sleeping ? .55 : .2) + nod + this._headPitch * .5,
      this._headYaw * .6);
    this._turn('cabeza', p.sniff * .35 + (this.sleeping ? .25 : 0) * p.lie + this._headPitch * .5 - p.alert * .2,
      this._headYaw * .4, Math.sin(this.time * 1.3) * .06 * (1 - move) * (1 - p.lie));

    // Orejas caídas que rebotan; alerta las levanta.
    const flop = Math.sin(this._phase * Math.PI * 4 + .8) * .25 * move;
    for (const [side, s] of [['L', 1], ['R', -1]]) this._turn(`oreja_${side}`, flop - p.alert * .5, 0, s * (p.alert * .4 - flop * .3));

    // Cola: más rápida y amplia según el ánimo; enroscada al dormir.
    const mood = this.isFriend ? .45 + this._happy * .55 : .2;
    const rate = this.isFriend ? 9 + this._happy * 9 : 4;
    const wag = Math.sin(this.time * rate) * mood * (1 - p.lie * .8);
    this._turn('cola_1', -.25 * (1 - p.lie) + p.lie * .35, wag * .6 + p.lie * .35);
    this._turn('cola_2', .15 * p.lie, Math.sin(this.time * rate - .6) * mood * .7 * (1 - p.lie) + p.lie * .35);
    this._turn('cola_3', 0, Math.sin(this.time * rate - 1.2) * mood * .8 * (1 - p.lie) + p.lie * .3);
  }

  destroy() {
    this._destroyed = true;
    this.scene.remove(this.group);
    const geometries = new Set(), materials = new Set();
    this.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    // La geometría del modelo pertenece al banco cargado y se comparte entre partidas.
    this.model?.traverse(object => { if (object.isSkinnedMesh) geometries.delete(object.geometry); });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  resetNear(position) {
    const nearest = this.navigation?.nearest(position) ?? -1;
    this.position.copy(nearest >= 0 ? this.navigation.point(nearest) : position);
    this.group.position.copy(this.position);
    this._route = []; this._routeTimer = 0;
    this.speed = 0;
  }

  restAt(position) {
    if (!this.isFriend) return;
    this.resetNear(position.clone().add(new THREE.Vector3(1, 0, 0)));
    this.sleeping = true;
    this._posture.lie = 1;
    this._animate(0);
  }

  wake() {
    this.sleeping = false;
    this._still = 0;
  }
}

const _q = new THREE.Quaternion();

function gaitAt(speed) {
  let i = 0;
  while (i < GAITS.length - 2 && speed > GAITS[i + 1].speed) i++;
  const a = GAITS[i], b = GAITS[i + 1];
  const t = THREE.MathUtils.smoothstep(speed, a.speed + (b.speed - a.speed) * .6, b.speed);
  return {
    offsets: a.offsets.map((o, k) => THREE.MathUtils.lerp(o, b.offsets[k], t)),
    swing: THREE.MathUtils.lerp(a.swing, b.swing, t)
  };
}

/** Accesorios en el espacio del perro en reposo (mira a +Z, cuello hacia +Y+Z). */
function createAccessory(kind) {
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: .85 });
  const group = new THREE.Group();
  group.name = `accesorio-${kind}`;
  const neck = new THREE.Vector3(0, .515, .255);
  if (kind === 'panuelo' || kind === 'collar') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(.112, kind === 'collar' ? .015 : .022, 6, 18),
      mat(kind === 'collar' ? 0x2a6fb5 : 0xc62f2a));
    band.position.copy(neck);
    band.rotation.x = -Math.PI / 4;
    band.scale.set(1, 1.12, 1);
    group.add(band);
    if (kind === 'panuelo') {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.09, .16, 3), band.material);
      tip.position.set(0, .45, .36);
      tip.rotation.set(Math.PI + .5, 0, 0);
      tip.scale.set(1, 1, .35);
      group.add(tip);
    } else {
      const tag = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .006, 10), mat(0xd9b44a));
      tag.position.set(0, .44, .355);
      tag.rotation.x = Math.PI / 2 - .6;
      group.add(tag);
    }
  } else if (kind === 'gorra') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.085, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe39b2a));
    cap.position.set(0, .725, .35);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .01, 12, 1, false, -Math.PI / 2, Math.PI), cap.material);
    brim.position.set(0, .728, .41);
    brim.scale.set(1.2, 1, 1.1);
    group.add(cap, brim);
  } else {
    return null;
  }
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return group;
}
