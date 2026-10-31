// src/character/pipe.js
// Fumar basuco: agachado, la pipa en la mano izquierda contra la boca y el encendedor en la derecha
// debajo de la cazoleta. Es una acción quieta y corta; la bocanada sale al bajar las manos.
import * as THREE from 'three';
import { findBone } from './props.js';
import { rotateInFrame } from './melee.js';
import { attachToHand } from './smoking.js';

// En segundos desde que empieza: agacharse y subir las manos, prender y aspirar, bajarlas.
export const BASUCO = { bend: 0.9, light: 3.2, lower: 0.9, exhale: 2.8 };
export const BASUCO_LENGTH = BASUCO.bend + BASUCO.light + BASUCO.lower;     // quieto con la pipa
export const BASUCO_TOTAL = BASUCO.bend + BASUCO.light + BASUCO.exhale;      // hasta el fin del humo

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** 0 de pie, 1 agachado con la pipa en la boca */
export function basucoReach(t) {
  if (t == null) return 0;
  if (t < BASUCO.bend) return smooth(t / BASUCO.bend);
  if (t < BASUCO.bend + BASUCO.light) return 1;
  return 1 - smooth((t - BASUCO.bend - BASUCO.light) / BASUCO.lower);
}

/** La llama del encendedor: se prende al llegar arriba y se apaga al dejar de aspirar */
export const isLit = (t) => t != null && t >= BASUCO.bend * 0.8 && t < BASUCO.bend + BASUCO.light;
/** La bocanada sale al bajar las manos */
export const isBasucoExhaling = (t) => t != null && t >= BASUCO.bend + BASUCO.light && t < BASUCO_TOTAL;

// ---------- pipa y encendedor ----------

/** Pipa de tubo metálico con cazoleta. El origen es donde la agarra la mano; +Y apunta a la cazoleta. */
export function createPipe() {
  const metal = new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.8, roughness: 0.35 });
  const burnt = new THREE.MeshStandardMaterial({ color: '#3b3330', metalness: 0.4, roughness: 0.6 });
  const ember = new THREE.MeshBasicMaterial({ color: '#ff6a2a' });
  const object = new THREE.Group();
  object.name = 'prop-pipa';
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 8).translate(0, 0.03, 0), metal);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8).translate(0, 0.1, 0), burnt);
  const coal = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6).translate(0, 0.11, 0), ember);
  object.add(tube, bowl, coal);
  object.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const mouthpiece = new THREE.Object3D();
  mouthpiece.position.y = -0.04;
  const top = new THREE.Object3D();
  top.position.y = 0.112;
  object.add(mouthpiece, top);
  const base = new THREE.Color('#ff6a2a');
  const dark = new THREE.Color('#2a2220');
  return {
    object, mouthpiece, top,
    setGlow(glow) { ember.color.copy(dark).lerp(base, Math.min(1, glow)).multiplyScalar(1 + glow * 1.6); },
    dispose() {
      for (const m of [tube, bowl, coal]) m.geometry.dispose();
      metal.dispose(); burnt.dispose(); ember.dispose();
      object.removeFromParent();
    }
  };
}

/** Encendedor plástico con llama. El origen es donde lo agarra la mano; +Y apunta a la llama. */
export function createLighter() {
  const plastic = new THREE.MeshStandardMaterial({ color: '#c8322b', roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b8bcc0', metalness: 0.8, roughness: 0.3 });
  const fire = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, depthWrite: false });
  const object = new THREE.Group();
  object.name = 'prop-encendedor';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.075, 0.012).translate(0, -0.0125, 0), plastic);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.01, 0.012).translate(0, 0.03, 0), steel);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.024, 8).translate(0, 0.012, 0), fire);
  flame.position.y = 0.035;
  flame.visible = false;
  object.add(body, head, flame);
  object.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const tip = new THREE.Object3D();
  tip.position.y = 0.058;
  object.add(tip);
  return {
    object, tip,
    /** Llama prendida o apagada; `t` la hace titilar */
    setFlame(on, t = 0) {
      flame.visible = on;
      if (on) flame.scale.set(1, 0.85 + 0.25 * Math.abs(Math.sin(t * 23) * Math.cos(t * 7)), 1);
    },
    dispose() {
      for (const m of [body, head, flame]) m.geometry.dispose();
      plastic.dispose(); steel.dispose(); fire.dispose();
      object.removeFromParent();
    }
  };
}

const _hand = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _off = new THREE.Vector3();

// El encendedor sale por encima del puño derecho, de pie: hacia los dedos y un poco arriba.
export const LIGHTER_GRIP = { along: 0.075, out: 0.02, up: 0.035 };

/** Pipa en la mano izquierda y encendedor en la derecha del esqueleto Mixamo */
export function attachBasucoProps(root, bones) {
  const left = findBone(bones, 'LeftHand');
  const right = findBone(bones, 'RightHand');
  if (!left || !right) return null;
  const pipe = createPipe();
  const lighter = createLighter();
  attachToHand(root, left, pipe.object);
  attachToHand(root, right, lighter.object);
  // la pipa sale entre el pulgar y el índice; el encendedor, empuñado con la llama hacia arriba
  pipe.object.position.add(new THREE.Vector3(0, 0.07, 0.02).applyQuaternion(pipe.object.quaternion));
  pipe.object.rotateZ(-Math.PI / 2);
  return {
    pipe, lighter,
    update(t) {
      // el encendedor queda de pie (con el rumbo del personaje) aunque gire la muñeca
      const parent = lighter.object.parent;
      right.getWorldPosition(_hand);
      right.getWorldQuaternion(_hq);
      _hand.add(_off.set(0, LIGHTER_GRIP.along, LIGHTER_GRIP.out).applyQuaternion(_hq));
      _hand.y += LIGHTER_GRIP.up;
      lighter.object.position.copy(parent.worldToLocal(_hand));
      lighter.object.quaternion.copy(parent.getWorldQuaternion(_pq).invert().multiply(root.getWorldQuaternion(_hq)));
      const lit = isLit(t);
      lighter.setFlame(lit, t);
      pipe.setGlow(lit ? 0.6 + 0.4 * Math.sin(t * 9) ** 2 : Math.max(0, 1 - (t - BASUCO.bend - BASUCO.light)));
    },
    dispose() { pipe.dispose(); lighter.dispose(); }
  };
}

// Pose en ejes del personaje (+X su izquierda, +Z al frente), con las manos en la boca y agachado.
export const BASUCO_POSE = {
  leftArm: [-0.66, -1.16, -0.25],
  leftForearm: [-2.18, -0.61, 0.4],
  rightArm: [-1.3, 1.08, 0.2],
  rightForearm: [-1.04, -0.16, -0.76],
  spine: 0.45,   // inclina el tronco hacia adelante (repartido entre las vértebras)
  head: 0.18,    // y la cabeza hacia las manos
  thigh: -0.38,  // muslos adelante...
  knee: 0.75,    // ...rodillas dobladas
  drop: 0.06     // m que baja el cuerpo al doblar las rodillas
};

/** Superposición del basuco para el esqueleto Mixamo. Llamar cada cuadro después de `mixer.update`. */
export function createBasucoOverlay(bones, frame) {
  const b = (name) => findBone(bones, name);
  const arms = { la: b('LeftArm'), lf: b('LeftForeArm'), ra: b('RightArm'), rf: b('RightForeArm') };
  const spines = [b('Spine'), b('Spine1')].filter(Boolean);
  const head = b('Head');
  const legs = [[b('LeftUpLeg'), b('LeftLeg')], [b('RightUpLeg'), b('RightLeg')]];
  let reach = 0;
  return {
    get active() { return reach > 0.001; },
    /** Cuánto bajar el cuerpo este cuadro (para que los pies sigan en el piso) */
    get drop() { return BASUCO_POSE.drop * reach; },
    apply(dt, t) {
      reach += (basucoReach(t) - reach) * Math.min(1, dt * 14);
      if (reach < 0.001) return;
      const P = BASUCO_POSE, r = reach;
      const rot = (bone, v, k = r) => bone && rotateInFrame(frame, bone, v[0] * k, v[1] * k, v[2] * k);
      for (const bone of spines) rotateInFrame(frame, bone, P.spine * r / spines.length, 0, 0);
      for (const [thigh, shin] of legs) {
        if (thigh) rotateInFrame(frame, thigh, P.thigh * r, 0, 0);
        if (shin) rotateInFrame(frame, shin, P.knee * r, 0, 0);
      }
      rot(arms.la, P.leftArm); rot(arms.lf, P.leftForearm);
      rot(arms.ra, P.rightArm); rot(arms.rf, P.rightForearm);
      if (head) rotateInFrame(frame, head, P.head * r, 0, 0);
    }
  };
}
