// src/character/poseRig.js
// Herramientas para hornear poses al cargar, sobre una copia del cuerpo que nadie dibuja: apuntar un
// hueso, llevar una muñeca o un tobillo a un punto y orientar manos y pies, en el espacio del
// personaje (+X su izquierda, +Y arriba, +Z al frente). Aquí sí se usan matrices de mundo; por
// cuadro solo se aplica el resultado, en espacio local. Nunca se usa fuera del horneado.
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const SIDE = { left: 1, right: -1 };
const cap = word => word[0].toUpperCase() + word.slice(1);

/** Nombre corto de cada articulación → final del nombre del hueso Mixamo. */
const JOINTS = {
  hips: 'Hips', spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2', neck: 'Neck', head: 'Head',
  leftShoulder: 'LeftShoulder', leftArm: 'LeftArm', leftForeArm: 'LeftForeArm', leftHand: 'LeftHand',
  rightShoulder: 'RightShoulder', rightArm: 'RightArm', rightForeArm: 'RightForeArm', rightHand: 'RightHand',
  leftUpLeg: 'LeftUpLeg', leftLeg: 'LeftLeg', leftFoot: 'LeftFoot', leftToe: 'LeftToeBase',
  rightUpLeg: 'RightUpLeg', rightLeg: 'RightLeg', rightFoot: 'RightFoot', rightToe: 'RightToeBase'
};
const NEXT = { spine: 'spine1', spine1: 'spine2', spine2: 'neck', neck: 'head' };
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3();
const _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion();
const _m = new Matrix4(), _e = new Euler();

/** Copia manipulable de un cuerpo: siempre parte de la pose de enlace o de la que se recuerde. */
export class PoseRig {
  /** `scene` es el cuerpo cargado. Solo se copia: sus mallas comparten geometría con el original. */
  constructor(scene) {
    this.root = clone(scene);
    this.root.position.set(0, 0, 0); this.root.quaternion.identity(); this.root.scale.setScalar(1);
    this.bones = new Map();
    this.root.traverse(node => { if (node.isBone) this.bones.set(node.name, node); });
    const values = [...this.bones.values()];
    const named = suffix => values.find(bone => bone.name.replace(/[^a-z0-9]/gi, '').toLowerCase().endsWith(suffix.toLowerCase()));
    this.joints = {};
    for (const [key, suffix] of Object.entries(JOINTS)) {
      const bone = named(suffix);
      if (!bone) throw new Error(`El cuerpo no tiene el hueso ${suffix}`);
      this.joints[key] = bone;
    }
    this.fingers = { left: [], right: [] };
    for (const side of ['left', 'right']) {
      for (const finger of [...FINGERS, 'Thumb']) {
        const chain = [1, 2, 3].map(i => named(`${cap(side)}Hand${finger}${i}`)).filter(Boolean);
        this.fingers[side].push({ finger, chain });
      }
    }
    this.hips = this.joints.hips;
    this.root.updateMatrixWorld(true);
    this.bindQ = new Map(values.map(bone => [bone, bone.quaternion.clone()]));
    this.bindP = this.hips.position.clone();
    // Orientación de mundo en la pose de enlace: de ella salen la cabeza al frente y la planta plana.
    this.bindWorld = new Map(values.map(bone => [bone, bone.getWorldQuaternion(new Quaternion())]));
    this.axes = new Map(values.map(bone => {
      const child = this._childOf(bone);
      return [bone, child?.position.lengthSq() > 1e-8 ? child.position.clone().normalize() : new Vector3(0, 1, 0)];
    }));
    this.length = {
      arm: this._boneLength('leftArm', 'leftForeArm'), forearm: this._boneLength('leftForeArm', 'leftHand'),
      thigh: this._boneLength('leftUpLeg', 'leftLeg'), shin: this._boneLength('leftLeg', 'leftFoot'),
      torso: [this._boneLength('spine', 'spine1'), this._boneLength('spine1', 'spine2'), this._boneLength('spine2', 'neck')]
    };
    // Medidas del cuerpo de pie, de las que salen las posturas.
    this.marks = {
      hipJoint: this.where('leftUpLeg', new Vector3()), ankleY: this.where('leftFoot').y, kneeY: this.where('leftLeg').y,
      hipY: this.hips.position.y, chest: this.where('spine2', new Vector3()), neck: this.where('neck', new Vector3()),
      head: this.where('head', new Vector3()), shoulder: this.where('leftArm', new Vector3())
    };
  }

  _childOf(bone) {
    for (const [key, next] of Object.entries(NEXT)) if (bone === this.joints[key]) return this.joints[next];
    const pick = { leftUpLeg: 'leftLeg', leftLeg: 'leftFoot', leftFoot: 'leftToe', rightUpLeg: 'rightLeg', rightLeg: 'rightFoot', rightFoot: 'rightToe',
      leftArm: 'leftForeArm', leftForeArm: 'leftHand', rightArm: 'rightForeArm', rightForeArm: 'rightHand' };
    for (const [key, next] of Object.entries(pick)) if (bone === this.joints[key]) return this.joints[next];
    // La mano apunta a la base del dedo corazón, no al primer hijo.
    const middle = bone.children.find(child => /HandMiddle1$/.test(child.name));
    return middle ?? bone.children.find(child => child.isBone);
  }

  _boneLength(from, to) { return this.where(from).distanceTo(this.where(to)); }

  /** Vuelve a la pose de enlace, o a la que se guardó con `remember`. */
  reset() {
    for (const [bone, q] of this.reference ?? this.bindQ) bone.quaternion.copy(q);
    this.hips.position.copy(this.referenceHip ?? this.bindP);
    this.root.updateMatrixWorld(true);
    return this;
  }

  /** La pose actual pasa a ser la referencia de `reset` y de `capture`. */
  remember() {
    this.reference = new Map([...this.bones.values()].map(bone => [bone, bone.quaternion.clone()]));
    this.referenceHip = this.hips.position.clone();
    return this;
  }

  /** Pone el esqueleto como un clip en el instante `time`. */
  applyClip(clip, time = 0) {
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      const bone = this.bones.get(track.name.slice(0, dot));
      if (!bone) continue;
      const value = track.createInterpolant().evaluate(time);
      if (track.name.endsWith('.quaternion')) bone.quaternion.fromArray(value);
      else if (bone === this.hips && track.name.endsWith('.position')) bone.position.fromArray(value);
    }
    this.root.updateMatrixWorld(true);
    return this;
  }

  /** Posición en el espacio del personaje. */
  where(key, target = new Vector3()) {
    const bone = typeof key === 'string' ? this.joints[key] : key;
    return bone.getWorldPosition(target);
  }

  /** Mueve la cadera, en ejes del personaje. */
  moveHips(x, y, z) {
    this.hips.position.x += x; this.hips.position.y += y; this.hips.position.z += z;
    this.root.updateMatrixWorld(true);
    return this;
  }

  /** Gira un hueso por (x, y, z) en ejes del personaje, sumado a su pose actual. */
  turn(key, x, y, z = 0) {
    const bone = this.joints[key];
    _q.setFromEuler(_e.set(x, y, z, 'YXZ'));
    bone.getWorldQuaternion(_q2).premultiply(_q);
    bone.parent.getWorldQuaternion(_q3).invert();
    bone.quaternion.copy(_q3.multiply(_q2));
    bone.updateMatrixWorld(true);
    return this;
  }

  /** Orienta un hueso en el mundo: su pose de enlace girada por (x, y, z) en ejes del personaje. */
  orient(key, x = 0, y = 0, z = 0) {
    const bone = this.joints[key];
    _q.setFromEuler(_e.set(x, y, z, 'YXZ'));
    _q2.copy(this.bindWorld.get(bone)).premultiply(_q);
    bone.parent.getWorldQuaternion(_q3).invert();
    bone.quaternion.copy(_q3.multiply(_q2));
    bone.updateMatrixWorld(true);
    return this;
  }

  /** Apunta un hueso (hacia su hijo) en una dirección, con el giro mínimo desde su pose actual. */
  point(key, x, y, z) {
    const bone = this.joints[key];
    bone.getWorldQuaternion(_q);
    _a.copy(this.axes.get(bone)).applyQuaternion(_q).normalize();
    _b.set(x, y, z).normalize();
    _q2.setFromUnitVectors(_a, _b);
    _q.premultiply(_q2);
    bone.parent.getWorldQuaternion(_q3).invert();
    bone.quaternion.copy(_q3.multiply(_q));
    bone.updateMatrixWorld(true);
    return this;
  }

  _reach(upper, lower, end, target, pole) {
    const start = this.where(upper, new Vector3());
    const toTarget = _a.copy(target).sub(start);
    const first = this.where(lower, new Vector3()).distanceTo(start);
    const second = this.where(end, new Vector3()).distanceTo(this.where(lower, new Vector3()));
    const distance = Math.min(first + second - 1e-3, Math.max(Math.abs(first - second) + 1e-3, toTarget.length()));
    const dir = toTarget.normalize();
    const along = (first * first + distance * distance - second * second) / (2 * distance);
    const out = Math.sqrt(Math.max(0, first * first - along * along));
    const side = _b.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = _c.copy(start).addScaledVector(dir, along).addScaledVector(side, out);
    this.point(upper, elbow.x - start.x, elbow.y - start.y, elbow.z - start.z);
    const joint = this.where(lower, new Vector3());
    const aim = _d.copy(target).sub(joint);
    this.point(lower, aim.x, aim.y, aim.z);
    return this;
  }

  /** Lleva la muñeca a `target`; el codo sale hacia `pole`. */
  reachArm(side, target, pole) { return this._reach(`${side}Arm`, `${side}ForeArm`, `${side}Hand`, target, pole); }

  /** Lleva el tobillo a `target`; la rodilla sale hacia `pole`. */
  reachLeg(side, target, pole) { return this._reach(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, target, pole); }

  /** Planta plana sobre el piso, con la punta girada `out` radianes hacia afuera. */
  flatFoot(side, out = 0, pitch = 0) {
    const sign = SIDE[side];
    this.orient(`${side}Foot`, pitch, sign * out, 0);
    this.orient(`${side}Toe`, 0, sign * out, 0);
    return this;
  }

  /**
   * Orienta la mano: `fingers` hacia donde apuntan los dedos y `palm` hacia donde mira la palma.
   * Reparte parte del giro en el antebrazo para que la muñeca no se retuerza.
   */
  hand(side, fingers, palm) {
    const hand = this.joints[`${side}Hand`], forearm = this.joints[`${side}ForeArm`];
    const { axis, palm: localPalm } = this._handFrame(side);
    const localSide = new Vector3().crossVectors(axis, localPalm).normalize();
    const f = new Vector3(fingers.x, fingers.y, fingers.z).normalize();
    const p = new Vector3(palm.x, palm.y, palm.z);
    p.addScaledVector(f, -p.dot(f)).normalize();
    const s = new Vector3().crossVectors(f, p).normalize();
    const world = new Quaternion().setFromRotationMatrix(_m.makeBasis(s, f, p));
    const local = new Quaternion().setFromRotationMatrix(_m.makeBasis(localSide, axis, localPalm));
    const goal = world.multiply(local.invert());
    // Lo que la muñeca tendría que girar desde la mano sin doblar; el antebrazo se lleva la parte
    // que es giro sobre su propio eje, hasta poco más de la mitad.
    forearm.getWorldQuaternion(_q);
    const neutral = _q.clone().multiply(this.bindQ.get(hand));
    const needed = goal.clone().multiply(neutral.invert());
    const forearmAxis = _c.copy(this.axes.get(forearm)).applyQuaternion(_q).normalize();
    const along = needed.x * forearmAxis.x + needed.y * forearmAxis.y + needed.z * forearmAxis.z;
    const twist = new Quaternion(forearmAxis.x * along, forearmAxis.y * along, forearmAxis.z * along, needed.w).normalize();
    const share = new Quaternion().slerp(twist, .55);
    _q.premultiply(share);
    forearm.parent.getWorldQuaternion(_q3).invert();
    forearm.quaternion.copy(_q3.multiply(_q));
    forearm.updateMatrixWorld(true);
    forearm.getWorldQuaternion(_q3).invert();
    hand.quaternion.copy(_q3.multiply(goal));
    hand.updateMatrixWorld(true);
    return this;
  }

  /** Ejes locales de la mano: hacia los dedos y hacia donde mira la palma. */
  _handFrame(side) {
    const hand = this.joints[`${side}Hand`];
    const axis = this.axes.get(hand);
    const index = this.fingers[side].find(item => item.finger === 'Index').chain[0];
    const pinky = this.fingers[side].find(item => item.finger === 'Pinky').chain[0];
    const across = new Vector3().copy(index.position).sub(pinky.position).normalize();
    return { axis, palm: new Vector3().crossVectors(axis, across).normalize().multiplyScalar(SIDE[side]) };
  }

  /** Cierra los dedos: 0 suelto, 1 puño. El pulgar con `thumb` aparte. Parte de la pose de enlace. */
  curl(side, amount, thumb = amount * .6) {
    const { axis, palm } = this._handFrame(side);
    // Cerrar lleva los dedos hacia la palma: el mismo eje vale para las tres falanges.
    const close = new Vector3().crossVectors(axis, palm).normalize();
    const hand = this.joints[`${side}Hand`];
    const toHand = new Quaternion();
    for (const { finger, chain } of this.fingers[side]) {
      toHand.identity();
      chain.forEach((bone, i) => {
        const bind = this.bindQ.get(bone);
        toHand.multiply(bind);
        // Eje de la mano llevado al hueso sin doblar; el pulgar cierra menos y cruza la palma.
        const localAxis = _a.copy(finger === 'Thumb' ? _b.copy(close).multiplyScalar(.5).addScaledVector(axis, -.5) : close)
          .applyQuaternion(_q.copy(toHand).invert()).normalize();
        const angle = finger === 'Thumb' ? thumb * (i === 0 ? .25 : .6) : amount * (i === 0 ? 1.05 : i === 1 ? 1.45 : .9);
        bone.quaternion.copy(bind).multiply(_q2.setFromAxisAngle(localAxis, angle));
      });
    }
    hand.updateMatrixWorld(true);
    return this;
  }
}
