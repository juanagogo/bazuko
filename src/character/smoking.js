// src/character/smoking.js
// Fumar un cigarrillo: el cigarrillo en la mano izquierda, la calada (llevarlo a la boca) y el humo.
// La calada se suma sobre la pose del mixer, como los golpes, así se puede fumar caminando.
import * as THREE from 'three';
import { findBone } from './props.js';
import { rotateInFrame } from './melee.js';

export const SMOKE_DURATION = 600;    // segundos que dura un cigarrillo (10 minutos)
export const PUFF_INTERVAL = 30;      // segundos entre caladas
export const FIRST_PUFF = 2;          // la primera calada llega enseguida, al prenderlo

// Calada: subir la mano, aspirar, bajarla y botar el humo. En segundos desde que empieza.
export const PUFF = { raise: 0.8, hold: 1.4, lower: 0.8, exhale: 1.6 };
export const PUFF_LENGTH = PUFF.raise + PUFF.hold + PUFF.lower;

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Qué tan cerca de la boca está la mano: 0 abajo, 1 en la boca. */
export function puffReach(t) {
  if (t == null) return 0;
  if (t < PUFF.raise) return smooth(t / PUFF.raise);
  if (t < PUFF.raise + PUFF.hold) return 1;
  return 1 - smooth((t - PUFF.raise - PUFF.hold) / PUFF.lower);
}

/** Qué tan encendida está la brasa: se aviva mientras aspira. */
export function emberGlow(t) {
  if (t == null || t < PUFF.raise * 0.6) return 0;
  const end = PUFF.raise + PUFF.hold;
  if (t < end) return smooth((t - PUFF.raise * 0.6) / 0.4);
  return 1 - smooth((t - end) / 0.5);
}

/** ¿Está botando el humo de la calada? (empieza al bajar la mano) */
export const isExhaling = (t) => t != null && t >= PUFF.raise + PUFF.hold && t < PUFF.raise + PUFF.hold + PUFF.exhale;

// Lo que se puede fumar: id del objeto → cómo se ve, de qué color es el humo y qué efecto de
// consumo (SubstanceEffects) dispara cada calada.
export const SMOKABLES = {
  cigarrillo: { name: 'cigarrillo', emoji: '🚬', paper: '#f1ede4', filter: '#c98a4a', radius: 0.0045, smoke: '#d8d8d8' },
  hierba:     { name: 'porro',      emoji: '🌿', paper: '#e6dfc8', filter: '#f4f1e8', radius: 0.0058, smoke: '#8fdc74', effect: 'hierba' }
};
export const smokable = (id) => SMOKABLES[id] ?? SMOKABLES.cigarrillo;

// ---------- el cigarrillo ----------

const shared = {};
function geometries(r) {
  // el porro es más grueso hacia la brasa (cono) y la boquilla es de cartón
  const cone = r > SMOKABLES.cigarrillo.radius ? 1.25 : 1;
  return shared[r] ??= {
    paper: new THREE.CylinderGeometry(r * cone, r, 0.06, 8).translate(0, 0.03, 0),
    filter: new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.02, 8).translate(0, -0.01, 0),
    ember: new THREE.CylinderGeometry(r * cone * 1.02, r * cone * 0.9, 0.006, 8).translate(0, 0.063, 0)
  };
}

/**
 * Cigarrillo (o porro, con `kind` = 'hierba') con filtro y brasa. El origen es donde lo pisan
 * los dedos; +Y apunta a la brasa. `tip` marca la brasa (de ahí sale el humo) y `setGlow` la aviva.
 */
export function createCigarette(kind = 'cigarrillo') {
  const look = smokable(kind);
  const g = geometries(look.radius);
  const paper = new THREE.MeshStandardMaterial({ color: look.paper, roughness: 0.9 });
  const filter = new THREE.MeshStandardMaterial({ color: look.filter, roughness: 0.8 });
  const ember = new THREE.MeshBasicMaterial({ color: '#ff5a1f' });
  const object = new THREE.Group();
  object.name = 'prop-cigarrillo';
  object.add(new THREE.Mesh(g.paper, paper), new THREE.Mesh(g.filter, filter), new THREE.Mesh(g.ember, ember));
  object.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const tip = new THREE.Object3D();
  tip.position.y = 0.066;
  object.add(tip);
  const base = new THREE.Color('#ff5a1f');
  return {
    object, tip,
    setGlow(glow) { ember.color.copy(base).multiplyScalar(1.2 + glow * 2.5); },
    dispose() {
      paper.dispose(); filter.dispose(); ember.dispose();
      object.removeFromParent();
    }
  };
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();

/** Pone el cigarrillo entre los dedos de la mano izquierda del esqueleto Mixamo. */
/** Pega `object` al hueso de la mano con los ejes de la mano (+Y hacia los dedos), en la muñeca. */
export function attachToHand(root, hand, object) {
  // attach() lo pasa al hueso sin moverlo de donde nació
  root.updateMatrixWorld(true);
  root.worldToLocal(hand.getWorldPosition(_p));
  root.getWorldQuaternion(_r).invert();
  object.position.copy(_p);
  object.quaternion.copy(_r.multiply(hand.getWorldQuaternion(_q)));
  root.add(object);
  hand.attach(object);
}

export function attachCigaretteToHand(root, bones, kind = 'cigarrillo') {
  const hand = findBone(bones, 'LeftHand');
  if (!hand) return null;
  const cig = createCigarette(kind);
  attachToHand(root, hand, cig.object);
  // entre el índice y el corazón, atravesado respecto a los dedos y con la brasa hacia afuera
  cig.object.position.add(new THREE.Vector3(0, 0.085, 0.015).applyQuaternion(cig.object.quaternion));
  cig.object.rotateZ(-Math.PI / 2);
  return cig;
}

// Brazo izquierdo en ejes del personaje (+X su izquierda, +Z al frente): con la mano en la boca y,
// sosteniéndolo abajo, con el codo apenas doblado.
export const SMOKE_POSE = {
  mouthArm: [-0.61, -0.9, 0.08],
  mouthForearm: [-1.92, -0.22, 0.08],
  holdForearm: [-0.45, 0, 0]
};

/** Superposición de la calada para el esqueleto Mixamo. Llamar cada cuadro después de `mixer.update`. */
export function createSmokeOverlay(bones, frame) {
  const arm = findBone(bones, 'LeftArm');
  const forearm = findBone(bones, 'LeftForeArm');
  const head = findBone(bones, 'Head');
  let hold = 0, reach = 0;
  return {
    get active() { return hold > 0.001 || reach > 0.001; },
    apply(dt, smoke) {
      const k = 1 - Math.exp(-10 * dt);
      hold += ((smoke ? 1 : 0) - hold) * k;
      reach += ((smoke ? puffReach(smoke.puff) : 0) - reach) * Math.min(1, k * 2);
      if (!arm || !forearm || (hold < 0.001 && reach < 0.001)) return;
      const { mouthArm, mouthForearm, holdForearm } = SMOKE_POSE;
      rotateInFrame(frame, arm, mouthArm[0] * reach, mouthArm[1] * reach, mouthArm[2] * reach);
      const f = (i) => holdForearm[i] * hold * (1 - reach) + mouthForearm[i] * reach;
      rotateInFrame(frame, forearm, f(0), f(1), f(2));
      // inclina un poco la cabeza hacia la mano al aspirar
      if (head) rotateInFrame(frame, head, 0.12 * reach, 0.1 * reach, 0);
    },
    /** Boca en coordenadas del mundo, para sacar el humo de la calada. */
    mouth(target) {
      if (!head) return null;
      head.getWorldPosition(target);
      frame.getWorldQuaternion(_q);
      return target.add(_p.set(0, 0.02, 0.11).applyQuaternion(_q));
    }
  };
}

// ---------- humo ----------

const MAX_PUFFS = 90;
let smokeTexture = null;
function texture() {
  if (smokeTexture || typeof document === 'undefined') return smokeTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(230,230,230,0.9)');
  g.addColorStop(0.45, 'rgba(210,210,210,0.35)');
  g.addColorStop(1, 'rgba(200,200,200,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  smokeTexture = new THREE.CanvasTexture(c);
  return smokeTexture;
}

/**
 * Humo con un grupo fijo de sprites reutilizables: el hilo que sale de la brasa y las bocanadas.
 * Vive en la escena (no en el personaje) para que el humo se quede atrás al caminar.
 */
export class SmokePuffs {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'humo-cigarrillo';
    scene.add(this.group);
    this.puffs = [];
    this._next = 0;
    const map = texture();
    for (let i = 0; i < MAX_PUFFS; i++) {
      const material = new THREE.SpriteMaterial({ map, color: '#d8d8d8', transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({ sprite, life: 0, age: 0, velocity: new THREE.Vector3(), size: 0, grow: 0, alpha: 0 });
    }
  }

  /** Suelta una partícula en `position` (mundo). */
  emit(position, { velocity = null, size = 0.04, grow = 0.25, life = 2.5, alpha = 0.35, color = '#d8d8d8' } = {}) {
    const p = this.puffs[this._next];
    this._next = (this._next + 1) % this.puffs.length;
    p.sprite.position.copy(position);
    p.velocity.set((Math.random() - 0.5) * 0.06, 0.18 + Math.random() * 0.08, (Math.random() - 0.5) * 0.06);
    if (velocity) p.velocity.add(velocity);
    p.size = size; p.grow = grow; p.life = life; p.age = 0; p.alpha = alpha;
    p.sprite.material.color.set(color);
    p.sprite.visible = true;
  }

  update(dt) {
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      if (p.age >= p.life) { p.sprite.visible = false; continue; }
      const k = p.age / p.life;
      p.velocity.multiplyScalar(Math.exp(-1.2 * dt)); // el aire frena la bocanada
      p.velocity.y += 0.05 * dt;                       // y el humo caliente sube
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.scale.setScalar(p.size + p.grow * k);
      p.sprite.material.opacity = p.alpha * (1 - k) * Math.min(1, p.age * 6);
    }
  }

  dispose() {
    for (const p of this.puffs) p.sprite.material.dispose();
    this.group.removeFromParent();
  }
}
