import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { STREET_CANE_GRIP, STREET_CANE_LENGTH } from './streetCane.js';

const SUPPORT = .46; // La fase 0 de la marcha es el pie izquierdo adelante.
const RUN_GRIP_TIME = .2;

/** Lee una rama por sus transformaciones locales. El render sigue siendo dueño de las matrices del esqueleto. */
function readWorldFrame(node, out, local) {
  out.identity();
  for (; node; node = node.parent) {
    if (node.matrixAutoUpdate) local.compose(node.position, node.quaternion, node.scale);
    else local.copy(node.matrix);
    out.premultiply(local);
  }
  return out;
}

/** El codo acompaña la carga para mantener la contera en el mismo punto del andén. */
class CaneArm {
  constructor(hand, forearm, arm) {
    this.hand = hand;
    this.forearm = forearm;
    this.arm = arm;
    this.slots = [arm, forearm, hand].map(bone => ({ bone, rotation: new Quaternion() }));
    this.adjusted = false;
    this.parent = new Matrix4();
    this.local = new Matrix4();
    this.inverse = new Matrix4();
    this.forearmQ = new Quaternion();
    this.handQ = new Quaternion();
    this.deltaQ = new Quaternion();
    this.conjugate = new Quaternion();
    this.elbow = new Vector3();
    this.wrist = new Vector3();
    this.scale = new Vector3();
    this.grip = new Vector3();
    this.pole = new Vector3();
    this.target = new Vector3();
    this.reach = new Vector3();
    this.error = new Vector3();
    this.upperDir = new Vector3();
    this.lowerDir = new Vector3();
    this.axis = new Vector3();
  }

  restore() {
    if (!this.adjusted) return;
    for (const { bone, rotation } of this.slots) bone.quaternion.copy(rotation);
    this.adjusted = false;
  }

  fit(tip, grip, length, weight) {
    const { hand, forearm, arm, elbow, wrist, upperDir, lowerDir, reach, pole, target, axis, deltaQ, conjugate } = this;
    const parent = readWorldFrame(arm.parent, this.parent, this.local);
    this.inverse.copy(parent).invert();
    target.copy(tip).applyMatrix4(this.inverse);
    const shoulder = arm.position;
    elbow.copy(forearm.position).multiply(arm.scale).applyQuaternion(arm.quaternion).add(shoulder);
    this.forearmQ.copy(arm.quaternion).multiply(forearm.quaternion);
    wrist.copy(hand.position).multiply(forearm.scale).multiply(arm.scale).applyQuaternion(this.forearmQ).add(elbow);
    this.handQ.copy(this.forearmQ).multiply(hand.quaternion);
    const size = this.scale.copy(arm.scale).multiply(forearm.scale).multiply(hand.scale);
    this.grip.copy(grip).multiply(size).applyQuaternion(this.handQ).add(wrist);
    const beam = this.error.copy(this.grip).sub(target);
    const measured = beam.length();
    if (measured < 1e-6) return;
    beam.multiplyScalar(length * size.y / measured - 1);
    const worldError = axis.copy(beam).applyMatrix4(parent).distanceTo(pole.setFromMatrixPosition(parent));
    reach.copy(beam).multiplyScalar(weight * Math.min(1, .105 / Math.max(worldError, 1e-6))).add(wrist).sub(shoulder);
    upperDir.copy(elbow).sub(shoulder);
    lowerDir.copy(wrist).sub(elbow);
    const a = upperDir.length(), b = lowerDir.length();
    if (a < 1e-6 || b < 1e-6 || reach.lengthSq() < 1e-12) return;
    const d = MathUtils.clamp(reach.length(), Math.abs(a - b) + 1e-5, (a + b) * .998);
    reach.normalize();
    pole.copy(upperDir).addScaledVector(reach, -upperDir.dot(reach));
    if (pole.lengthSq() < 1e-12) {
      pole.set(0, 0, -1);
      pole.addScaledVector(reach, -pole.dot(reach));
    }
    const along = (a * a + d * d - b * b) / (2 * d);
    const elbowGoal = axis.copy(reach).multiplyScalar(along).addScaledVector(pole.normalize(), Math.sqrt(Math.max(0, a * a - along * along)));

    for (const { bone, rotation } of this.slots) rotation.copy(bone.quaternion);
    this.adjusted = true;
    deltaQ.setFromUnitVectors(upperDir.normalize(), target.copy(elbowGoal).normalize());
    arm.quaternion.premultiply(deltaQ);
    const lowerGoal = target.copy(reach).multiplyScalar(d).sub(elbowGoal).normalize();
    deltaQ.setFromUnitVectors(lowerDir.normalize().applyQuaternion(deltaQ), lowerGoal);
    forearm.quaternion.premultiply(conjugate.copy(arm.quaternion).invert().multiply(deltaQ).multiply(arm.quaternion));
    hand.quaternion.copy(arm.quaternion).multiply(forearm.quaternion).invert().multiply(this.handQ);
  }
}

/** Coloca el bastón rígido alrededor del mango. Los dedos y el largo del palo conservan su forma. */
export class CaneMotion {
  constructor(mesh, walk, run) {
    this.mesh = mesh;
    this.walk = walk;
    this.run = run;
    this.runWeight = 0;
    this.poseWeight = 0;
    this.planted = false;
    this.anchor = new Vector3();
    this.fromTip = new Vector3();
    this.swinging = false;
    this.walking = false;
    this.yaw = null;
    this.turning = false;
    this.lastTip = new Vector3();
    this.haveTip = false;
    this.toWorld = new Matrix4();
    this.fromWorld = new Matrix4();
    this.transform = new Matrix4();
    const hand = mesh.parent, forearm = hand?.parent, arm = forearm?.parent;
    this.arm = /RightForeArm$/i.test(forearm?.name) && /RightArm$/i.test(arm?.name) ? new CaneArm(hand, forearm, arm) : null;
    this.gripOffset = new Vector3();
    this.shaft = new Vector3();
    this.grip = new Vector3();
    this.gripWorld = new Vector3();
    this.normal = new Vector3();
    this.direction = new Vector3();
    this.at = new Vector3();
    this.tip = new Vector3();
    this.baseAxis = new Vector3();
    this.rotation = new Quaternion();
    this.walkPose = new Quaternion();
    this.position = new Vector3();
    this.target = new Vector3();
  }

  state() {
    return { planted: this.planted, anchor: this.anchor.clone(), lastTip: this.lastTip.clone(), haveTip: this.haveTip,
      fromTip: this.fromTip.clone(), swinging: this.swinging, walking: this.walking, yaw: this.yaw, turning: this.turning,
      runWeight: this.runWeight, poseWeight: this.poseWeight };
  }

  applyState(state) {
    this.planted = state.planted;
    this.anchor.copy(state.anchor);
    this.lastTip.copy(state.lastTip);
    this.haveTip = state.haveTip;
    this.fromTip.copy(state.fromTip);
    this.swinging = state.swinging;
    this.walking = state.walking;
    this.yaw = state.yaw;
    this.turning = state.turning;
    this.runWeight = state.runWeight;
    this.poseWeight = state.poseWeight;
  }

  restore() { this.arm?.restore(); }

  _handFrame(mesh, pose) {
    readWorldFrame(mesh.parent, this.toWorld, this.transform);
    this.fromWorld.copy(this.toWorld).invert();
    const e = this.toWorld.elements;
    this.normal.set(e[1], e[5], e[9]);
    this.normalScale = this.normal.length();
    this.normal.multiplyScalar(1 / this.normalScale);
    this.gripOffset.set(...STREET_CANE_GRIP).multiply(mesh.scale);
    this.shaft.set(0, -STREET_CANE_LENGTH, 0).multiply(mesh.scale).sub(this.gripOffset);
    this.length = this.shaft.length();
    this.baseRotation = pose.quaternion;
    this.grip.copy(this.gripOffset).applyQuaternion(this.baseRotation).add(pose.position);
    this.gripWorld.copy(this.grip).applyMatrix4(this.toWorld);
  }

  /** Intersección del largo del bastón con el plano del piso, en el espacio del puño. */
  _aim(x, y, z) {
    const rise = MathUtils.clamp((y - this.gripWorld.y) / (this.normalScale * this.length), -1, 1);
    const direction = this.direction.set(x, y, z).applyMatrix4(this.fromWorld).sub(this.grip);
    direction.addScaledVector(this.normal, -direction.dot(this.normal)).normalize();
    direction.multiplyScalar(Math.sqrt(1 - rise * rise)).addScaledVector(this.normal, rise);
    this.tip.copy(this.grip).addScaledVector(direction, this.length).applyMatrix4(this.toWorld);
    const base = this.baseAxis.copy(this.shaft).normalize().applyQuaternion(this.baseRotation);
    this.rotation.setFromUnitVectors(base, direction).multiply(this.baseRotation);
  }

  /** Durante las mezclas de agarre gira sobre el mango si la contera va a barrer por debajo del piso. */
  clearGround(mesh, groundHeight, yaw) {
    this._handFrame(mesh, mesh);
    this.tip.copy(this.shaft).applyQuaternion(mesh.quaternion).add(this.grip).applyMatrix4(this.toWorld);
    const { x, z } = this.tip, floor = groundHeight(x, z) + .015;
    if (!(this.tip.y < floor)) return false;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const offset = this.direction.set(x - this.gripWorld.x, 0, z - this.gripWorld.z);
    if (offset.lengthSq() < .0064) offset.set(-cos, 0, sin);
    const tx = this.gripWorld.x + offset.x, tz = this.gripWorld.z + offset.z;
    this._aim(tx, floor, tz);
    const underTip = groundHeight(this.tip.x, this.tip.z) + .015;
    if (Number.isFinite(underTip) && underTip > floor) this._aim(tx, underTip, tz);
    mesh.quaternion.copy(this.rotation);
    mesh.position.copy(this.grip).sub(this.gripOffset.applyQuaternion(mesh.quaternion));
    return true;
  }

  update(dt, { phase, speed, running, active, rising, groundHeight, yaw }) {
    const run = running ? 1 : 0;
    const pose = active && groundHeight ? 1 : 0;
    this.runWeight += MathUtils.clamp(run - this.runWeight, -dt / RUN_GRIP_TIME, dt / RUN_GRIP_TIME);
    this.poseWeight += MathUtils.clamp(pose - this.poseWeight, -dt / .16, dt / .16);
    const { mesh, walk, runWeight } = this;
    this.walkPose.copy(walk.quaternion);
    this.position.copy(walk.position);
    if (this.poseWeight > 0 && runWeight < 1 && groundHeight) {
      this._handFrame(mesh, walk);
      const walking = speed >= .15 && !rising && !running;
      const turned = this.yaw === null ? 0 : MathUtils.euclideanModulo(yaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI;
      const turning = walking && Math.abs(turned) > dt * 1.8;
      this.yaw = yaw;
      const swing = walking ? MathUtils.clamp((phase - SUPPORT) / (1 - SUPPORT), 0, 1) : 0;
      const plant = walking && swing === 0 && !turning;
      const forward = walking ? (swing === 0 ? .23 - .39 * phase / SUPPORT : .23) : .11;
      const lift = walking ? .078 * Math.sin(Math.PI * swing) ** 2 : 0;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const { x, z } = this.gripWorld;
      const at = this.at.set(x + sin * forward - cos * .12, 0, z + cos * forward + sin * .12);
      if (plant) {
        if (!this.planted) this.anchor.copy(this.haveTip && this.walking && !this.turning ? this.lastTip : at);
        if (Math.hypot(at.x - this.anchor.x, at.z - this.anchor.z) < 1) {
          at.x = this.anchor.x; at.z = this.anchor.z;
        }
      } else if (swing > 0) {
        if (!this.swinging) this.fromTip.copy(this.haveTip && this.walking ? this.lastTip : at);
        at.lerp(this.fromTip, 1 - MathUtils.smoothstep(swing, 0, 1));
      }
      if (turning && this.haveTip) at.lerp(this.lastTip, Math.exp(-dt * 15));
      this.planted = plant;
      this.swinging = swing > 0;
      this.walking = walking;
      this.turning = turning;
      // La contera siempre queda al lado derecho de la mano, lejos de los zapatos.
      const outward = (x - at.x) * cos + (at.z - z) * sin;
      if (outward < .075) { at.x -= cos * (.075 - outward); at.z += sin * (.075 - outward); }
      const clearance = (rising ? .017 : .006) + lift;
      const floor = groundHeight(at.x, at.z);
      if (Number.isFinite(floor)) {
        if (this.arm && walking && !turning) {
          const press = Math.max(1 - MathUtils.smoothstep(swing, 0, .23), MathUtils.smoothstep(swing, .77, 1));
          const weight = press * this.poseWeight;
          if (weight > 0) {
            this.arm.fit(this.target.set(at.x, floor + clearance, at.z), this.grip, this.length, weight);
            this._handFrame(mesh, walk);
          }
        }
        this._aim(at.x, floor + clearance, at.z);
        // En un sardinel, el punto al que alcanza realmente el palo puede quedar en la baldosa contigua.
        const underTip = groundHeight(this.tip.x, this.tip.z);
        if (Number.isFinite(underTip) && Math.abs(underTip - floor) > .003) this._aim(at.x, underTip + clearance, at.z);
        this.walkPose.slerp(this.rotation, this.poseWeight);
        this.position.copy(this.grip).sub(this.direction.copy(this.gripOffset).applyQuaternion(this.walkPose));
        this.lastTip.copy(this.shaft).applyQuaternion(this.walkPose).add(this.grip).applyMatrix4(this.toWorld);
        this.haveTip = true;
      }
    } else {
      this.haveTip = this.planted = this.swinging = this.walking = this.turning = false;
      this.yaw = null;
    }
    mesh.position.lerpVectors(this.position, this.run.position, runWeight);
    mesh.quaternion.slerpQuaternions(this.walkPose, this.run.quaternion, runWeight);
    const changingSupport = this.poseWeight > 0 && this.poseWeight < 1 && runWeight === 0;
    const changingGrip = runWeight > 0 && runWeight < 1;
    if (groundHeight && (changingSupport || changingGrip) && this.clearGround(mesh, groundHeight, yaw) && changingSupport) {
      this.lastTip.copy(this.tip);
    }
  }
}
