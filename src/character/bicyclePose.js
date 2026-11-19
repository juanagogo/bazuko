import { Euler, Quaternion, Vector3 } from 'three';
import { PoseRig } from './poseRig.js';
import { CART_HANDLE } from '../entities/cartVisual.js';

const GRIPS = new Map();
const FINGERS = /Hand(?:Thumb|Index|Middle|Ring|Pinky)[123]$/i;
const SIDES = ['left', 'right'];

/** El puño se hornea una vez por cuerpo, en el marco del manubrio derecho. */
export function bicycleGrips(id, scene) {
  if (GRIPS.has(id)) return GRIPS.get(id);
  const rig = new PoseRig(scene);
  const fingers = new Vector3(0, -.19, 1), palm = new Vector3(0, -1, -.19);
  const grips = {};
  for (const side of SIDES) {
    rig.hand(side, fingers, palm).curl(side, .83, .72);
    grips[side] = rig.joints[`${side}Hand`].getWorldQuaternion(new Quaternion());
  }
  grips.fingers = new Map([...rig.bones].filter(([name]) => FINGERS.test(name)).map(([name, bone]) => [name, bone.quaternion.clone()]));
  GRIPS.set(id, grips);
  return grips;
}

/**
 * Capa visible del ciclista. Se resuelve después de que la cicla ya viró y avanzó las bielas.
 * Las cuatro extremidades comparten el IK de ActionPose y se restauran antes del próximo clip.
 */
export class BicyclePose {
  constructor(actionPose, { grips = null, bones = null, hands = null } = {}) {
    this.action = actionPose;
    this.short = actionPose.procedural;
    this.grips = grips;
    this.legs = actionPose._legs.map(leg => ({
      ...leg, hand: hands?.[leg.name] ?? leg.hand,
      shoulder: actionPose.joints[leg.arm], elbow: actionPose.joints[leg.foreArm], wristTarget: new Vector3()
    }));
    const joints = new Set(Object.values(actionPose.joints).filter(Boolean));
    for (const leg of this.legs) if (leg.toe) joints.add(leg.toe);
    for (const name of grips?.fingers.keys() ?? []) {
      const bone = bones.get(name);
      if (bone) joints.add(bone);
    }
    this.slots = [...joints].map(bone => ({ bone, bind: bone.quaternion.clone(), previous: new Quaternion(), finger: grips?.fingers.get(bone.name) }));
    const frameQ = actionPose.frame.getWorldQuaternion(new Quaternion()).invert();
    this.bind = new Map([...joints].map(bone => [bone, bone.getWorldQuaternion(new Quaternion()).premultiply(frameQ)]));
    this.hipsPosition = new Vector3();
    this.bodyQ = new Quaternion();
    this.barQ = new Quaternion();
    this.worldQ = new Quaternion();
    this.parentQ = new Quaternion();
    this.lean = new Quaternion();
    this.euler = new Euler();
    this.goal = new Vector3();
    this.offset = new Vector3();
    this.scale = new Vector3();
    this.shoulder = new Vector3();
    this.elbow = new Vector3();
    this.active = false;
  }

  restore() {
    if (!this.active) return;
    this.active = false;
    for (const { bone, previous } of this.slots) bone.quaternion.copy(previous);
    this.action.joints.hips.position.copy(this.hipsPosition);
  }

  orient(bone, quaternion) {
    if (!bone) return;
    bone.quaternion.copy(bone.parent.getWorldQuaternion(this.parentQ).invert().multiply(quaternion));
  }

  /** Gira los ejes de reposo del hueso dentro del marco inclinado de la bicicleta. */
  tilt(bone, pitch, yaw = 0) {
    if (!bone) return;
    this.lean.setFromEuler(this.euler.set(pitch, yaw, 0, 'YXZ'));
    this.orient(bone, this.worldQ.copy(this.bodyQ).multiply(this.lean).multiply(this.bind.get(bone)));
  }

  torso(joints, steer, lean = 0) {
    this.tilt(joints.lowerSpine, .41 + lean, steer * .07);
    this.tilt(joints.midSpine, .57 + lean, steer * .18);
    this.tilt(joints.spine, (this.short ? .67 : .70) + lean, steer * .34);
  }

  /** El manubrio de la carreta usa los mismos puños, con las piernas libres para caminar. */
  fitCart(cart) {
    const action = this.action, j = action.joints, weight = cart.gripWeight;
    if (!j.hips || weight <= 0) return;
    this.restore();
    this.active = true;
    this.hipsPosition.copy(j.hips.position);
    for (const { bone, previous } of this.slots) previous.copy(bone.quaternion);
    action.frame.getWorldQuaternion(this.bodyQ);
    action._forward.set(0, 0, 1).applyQuaternion(this.bodyQ);
    action._side.set(1, 0, 0).applyQuaternion(this.bodyQ);
    action._frameQ.copy(this.bodyQ);
    cart.group.getWorldQuaternion(this.barQ);

    let reachGap = 0;
    for (const leg of this.legs) {
      cart.group.localToWorld(leg.wristTarget.set(leg.side * CART_HANDLE.x,
        CART_HANDLE.y + (this.short ? .014 : .026), CART_HANDLE.z - (this.short ? .012 : .047)));
      if (!leg.shoulder || !leg.elbow || !leg.hand) continue;
      leg.shoulder.getWorldPosition(this.shoulder);
      leg.elbow.getWorldPosition(this.elbow);
      leg.hand.getWorldPosition(this.goal);
      const arm = this.shoulder.distanceTo(this.elbow) + this.elbow.distanceTo(this.goal);
      reachGap = Math.max(reachGap, this.shoulder.distanceTo(leg.wristTarget) - arm * .96);
    }
    const spine = j.lowerSpine ?? j.spine;
    if (spine) {
      const lean = Math.min(.51, .14 + reachGap * 2.8) * weight;
      this.lean.setFromAxisAngle(action._side, lean);
      this.orient(spine, spine.getWorldQuaternion(this.worldQ).premultiply(this.lean));
    }
    for (const leg of this.legs) {
      action._armTo(leg, leg.wristTarget, weight);
      if (this.grips && leg.hand?.parent) {
        this.worldQ.copy(this.barQ).multiply(this.grips[leg.name]);
        leg.hand.quaternion.slerp(leg.hand.parent.getWorldQuaternion(this.parentQ).invert().multiply(this.worldQ), weight);
      }
    }
    for (const { bone, finger } of this.slots) if (finger) bone.quaternion.slerp(finger, weight);
  }

  fit(bike, shoes = null) {
    const action = this.action, j = action.joints;
    if (!bike.saddle || !bike.grips || !bike.pedals || !j.hips) return;
    this.restore();
    this.active = true;
    this.hipsPosition.copy(j.hips.position);
    for (const { bone, bind, previous, finger } of this.slots) {
      previous.copy(bone.quaternion);
      bone.quaternion.copy(finger ?? bind);
    }
    const small = this.short;
    const size = action.frame.getWorldScale(this.scale).y;
    bike.setSaddleDrop(small ? .10 : 0);
    bike.setCrankRadius(small ? .11 - Math.max(0, 1 - size) * .625 : .11);
    bike.bikeBody.getWorldQuaternion(this.bodyQ);
    bike.steerGroup.getWorldQuaternion(this.barQ);
    // La cadera queda encima del acolchado y la mirada hacia la calle.
    bike.saddle.localToWorld(this.goal.set(0, .025 + (small ? .014 : .071) * size, small ? .052 : .021));
    j.hips.position.copy(j.hips.parent.worldToLocal(this.goal));
    const steer = bike.steerAngle;
    this.tilt(j.hips, small ? .13 : .21);
    this.torso(j, steer);
    let reachGap = 0;
    for (const leg of this.legs) {
      const grip = bike.grips[leg.side === 1 ? 1 : 0];
      grip.getWorldPosition(leg.wristTarget);
      leg.wristTarget.add(this.offset.set(0, small ? .015 : .028 * size, small ? -.006 : -.057 * size).applyQuaternion(this.barQ));
      if (!leg.shoulder || !leg.elbow || !leg.hand) continue;
      leg.shoulder.getWorldPosition(this.shoulder);
      leg.elbow.getWorldPosition(this.elbow);
      leg.hand.getWorldPosition(this.goal);
      const arm = this.shoulder.distanceTo(this.elbow) + this.elbow.distanceTo(this.goal);
      const shortfall = this.shoulder.distanceTo(leg.wristTarget) - arm * .965;
      // La mano puede ir hacia el extremo interior del mismo puño al virar.
      if (shortfall > 0) leg.wristTarget.add(this.offset.set(-leg.side * Math.min(.034, shortfall * .64), 0, 0).applyQuaternion(this.barQ));
      reachGap = Math.max(reachGap, this.shoulder.distanceTo(leg.wristTarget) - arm * .965);
    }
    // Si el puño exterior queda lejos al virar, la espalda acompaña el alcance sin estirar el brazo.
    if (reachGap > 0) this.torso(j, steer, Math.min(.23, reachGap * 3.7));
    this.tilt(j.neck, .25);
    this.tilt(j.head, .065, steer * .18);

    action._forward.set(0, 0, 1).applyQuaternion(this.bodyQ);
    action._side.set(1, 0, 0).applyQuaternion(this.bodyQ);
    action._frameQ.copy(this.bodyQ);
    const phase = Math.cos(bike.pedalRotation);
    const soleY = small ? ({ botas: .0525, chanclas: .0425 })[shoes] ?? .05 : .082;
    for (const leg of this.legs) {
      const index = leg.side === 1 ? 1 : 0;
      const pedal = bike.pedals[index];
      action._armTo(leg, leg.wristTarget, 1);
      if (this.grips && leg.hand) this.orient(leg.hand, this.worldQ.copy(this.barQ).multiply(this.grips[leg.name]));

      // La bola de la suela se mantiene sobre la plataforma y el tobillo baja al cerrar el ciclo.
      const pitch = small ? .18 - .23 * leg.side * phase : .09 - .13 * leg.side * phase;
      this.lean.setFromEuler(this.euler.set(pitch, leg.side * .045, 0, 'YXZ'));
      const footQ = this.worldQ.copy(this.bodyQ).multiply(this.lean);
      pedal.localToWorld(this.goal.set(leg.side * (small ? .021 : .006), .010, 0));
      this.goal.sub(this.offset.set(0, -soleY, small ? .112 : .104).multiplyScalar(size).applyQuaternion(footQ));
      action._legTo(leg, this.goal.y, 1, 0, this.goal);
      if (leg.foot) this.orient(leg.foot, footQ.multiply(this.bind.get(leg.foot)));
    }
  }
}
