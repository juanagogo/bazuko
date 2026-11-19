import * as THREE from 'three';

export const DOG_LEGS = [
  ['brazo_L', 'antebrazo_L', 'mano_L'],
  ['brazo_R', 'antebrazo_R', 'mano_R'],
  ['muslo_L', 'pierna_L', 'pie_L'],
  ['muslo_R', 'pierna_R', 'pie_R'],
];

const TURN = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const { clamp, smoothstep } = THREE.MathUtils;
const SUPPORT_REACH = .11;

/** Apoyo de las patas del esqueleto existente, con el arco de avance a partir de su fase de marcha. */
export class DogStride {
  constructor(group, rig) {
    this.group = group;
    const inverseRotation = group.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.legs = DOG_LEGS.map(([upperName, lowerName, pawName], i) => {
      const upper = rig.get(upperName).bone, lower = rig.get(lowerName).bone, paw = rig.get(pawName).bone;
      return {
        upper, lower, paw,
        a: lower.position.length(), b: paw.position.length(),
        rest: group.worldToLocal(paw.getWorldPosition(new THREE.Vector3())),
        soleRotation: paw.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverseRotation),
        toe: i < 2 ? .087 : .102, heel: i < 2 ? -.032 : -.016,
        anchor: new THREE.Vector3(), planted: false, releasing: false, contactYaw: 0,
      };
    });
    this.rest = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.ankle = new THREE.Vector3();
    this.hip = new THREE.Vector3();
    this.knee = new THREE.Vector3();
    this.axis = new THREE.Vector3();
    this.pole = new THREE.Vector3();
    this.bend = new THREE.Vector3();
    this.joint = new THREE.Vector3();
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.parentRotation = new THREE.Quaternion();
    this.delta = new THREE.Quaternion();
  }

  reset() {
    for (const leg of this.legs) leg.planted = leg.releasing = false;
  }

  apply(phase, offsets, stridePerRadian, weight, district, advance) {
    if (weight < .02) { this.reset(); return; }
    const body = this.group;
    const yaw = body.rotation.y, size = body.scale.x;
    const reach = SUPPORT_REACH * size;
    const half = reach / stridePerRadian;
    body.updateWorldMatrix(true, true);
    this.pole.set(Math.sin(yaw), 0, Math.cos(yaw));

    this.legs.forEach((leg, i) => {
      const rawPhase = (phase + offsets[i]) % 1;
      const angle = (rawPhase > .5 ? rawPhase - 1 : rawPhase) * TURN;
      const stance = advance && Math.abs(angle) <= half;
      const swing = ((angle < 0 ? angle + TURN : angle) - half) / (TURN - 2 * half);
      const travel = stance ? -angle * stridePerRadian : reach * (2 * smoothstep(swing, 0, 1) - 1);

      this.rest.copy(leg.rest).multiplyScalar(size).applyAxisAngle(UP, yaw).add(body.position);
      this.goal.copy(this.rest).addScaledVector(this.pole, travel);
      if (stance) {
        if (!leg.planted) {
          leg.anchor.copy(this.goal);
          leg.contactYaw = yaw;
        }
        this.goal.copy(leg.anchor);
        leg.releasing = false;
      } else {
        if (leg.planted) leg.releasing = true;
        if (leg.releasing) this.goal.lerp(leg.anchor, 1 - smoothstep(swing, 0, .35));
      }
      leg.planted = stance;

      const footYaw = stance ? leg.contactYaw : yaw;
      this.ankle.setFromMatrixPosition(leg.paw.matrixWorld);
      this.goal.x = THREE.MathUtils.lerp(this.ankle.x, this.goal.x, weight);
      this.goal.z = THREE.MathUtils.lerp(this.ankle.z, this.goal.z, weight);
      const ground = this.floorAtPaw(leg, footYaw, size, district);
      const floor = ground + (leg.rest.y + .005) * size;
      const lift = advance && !stance ? Math.sin(Math.PI * clamp(swing, 0, 1)) * .086 * size : 0;
      this.goal.y = Math.max(floor, THREE.MathUtils.lerp(this.ankle.y, floor + lift, weight));
      this.solve(leg, footYaw, size, district);
    });
  }

  floorAtPaw(leg, yaw, size, district) {
    if (!district?.getGroundHeight) return this.group.position.y;
    const forwardX = Math.sin(yaw) * size, forwardZ = Math.cos(yaw) * size;
    const sideX = forwardZ * .036, sideZ = -forwardX * .036;
    // En bordillos se mide la planta por sus extremos para que el borde de la pata no entre en el escalón.
    const { x, z } = this.goal;
    return Math.max(
      district.getGroundHeight(x + forwardX * leg.toe + sideX, z + forwardZ * leg.toe + sideZ),
      district.getGroundHeight(x + forwardX * leg.toe - sideX, z + forwardZ * leg.toe - sideZ),
      district.getGroundHeight(x + forwardX * leg.heel + sideX, z + forwardZ * leg.heel + sideZ),
      district.getGroundHeight(x + forwardX * leg.heel - sideX, z + forwardZ * leg.heel - sideZ)
    );
  }

  /** Dobla codo o corvejón sin cambiar la longitud de los dos huesos. */
  solve(leg, yaw, size, district) {
    const { upper, lower, paw } = leg;
    this.hip.setFromMatrixPosition(upper.matrixWorld);
    const a = leg.a * size, b = leg.b * size, maxReach = a + b - .001;
    this.axis.copy(this.goal).sub(this.hip);
    this.axis.y = clamp(this.axis.y, -maxReach, maxReach);
    const horizontal = Math.hypot(this.axis.x, this.axis.z);
    const lateralReach = Math.sqrt(Math.max(0, maxReach * maxReach - this.axis.y * this.axis.y));
    if (horizontal > lateralReach) {
      this.axis.x *= lateralReach / horizontal;
      this.axis.z *= lateralReach / horizontal;
      // Al acortar el paso una pata puede quedar del otro lado de un bordillo.
      this.goal.copy(this.hip).add(this.axis);
      const floor = this.floorAtPaw(leg, yaw, size, district) + (leg.rest.y + .005) * size;
      this.axis.y = clamp(Math.max(this.axis.y, floor - this.hip.y), -maxReach, maxReach);
      this.axis.clampLength(0, maxReach);
    }
    const distance = this.axis.length();
    if (distance < Math.abs(a - b) + .001) return;
    this.goal.copy(this.hip).add(this.axis);
    this.axis.divideScalar(distance);
    this.bend.copy(this.pole).addScaledVector(this.axis, -this.pole.dot(this.axis)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    this.joint.copy(this.hip).addScaledVector(this.axis, along).addScaledVector(this.bend, Math.sqrt(Math.max(0, a * a - along * along)));

    this.knee.setFromMatrixPosition(lower.matrixWorld);
    this.aim(upper, this.hip, this.knee, this.joint);
    this.knee.setFromMatrixPosition(lower.matrixWorld);
    this.ankle.setFromMatrixPosition(paw.matrixWorld);
    this.aim(lower, this.knee, this.ankle, this.goal);

    const rotation = this.rotation.setFromAxisAngle(UP, yaw).multiply(leg.soleRotation);
    paw.quaternion.copy(lower.getWorldQuaternion(this.parentRotation).invert().multiply(rotation));
    paw.updateWorldMatrix(false, false);
  }

  aim(bone, pivot, child, goal) {
    this.from.copy(child).sub(pivot).normalize();
    this.to.copy(goal).sub(pivot).normalize();
    const turn = this.delta.setFromUnitVectors(this.from, this.to);
    const world = bone.getWorldQuaternion(this.rotation).premultiply(turn);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(this.parentRotation).invert().multiply(world));
    bone.updateWorldMatrix(false, true);
  }
}
