import * as THREE from 'three';

const ACTIONS = new Set(['golpear', 'recibirGolpe', 'defender', 'asustado']);
const smooth = value => { const x = THREE.MathUtils.clamp(value, 0, 1); return x * x * (3 - 2 * x); };

export function isCombatAction(action) { return ACTIONS.has(action); }

/** Progreso de la acción, independiente del reloj del mundo y de los FPS. */
export function sampleCombatPose(action, progress = 0) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const pose = {
    weight: 1, lean: 0.04, twist: 0, head: 0,
    left: { side: -0.3, up: 0.08, forward: 0.35 },
    right: { side: -0.3, up: 0.02, forward: 0.3 },
    armLx: -1, armRx: -1, armLz: 0.18, armRz: -0.18, elbL: -1.9, elbR: -1.9
  };
  if (action === 'golpear') {
    const extension = p < 0.22 ? 0 : p < 0.367 ? smooth((p - 0.22) / 0.147) : 1 - smooth((p - 0.367) / 0.38);
    pose.weight = smooth(p / 0.12) * smooth((1 - p) / 0.22);
    pose.lean = 0.04 + extension * 0.12;
    pose.twist = -0.22 + extension * 0.46;
    pose.right = { side: 0.08 - extension * 0.18, up: 0.04 + extension * 0.03, forward: 0.24 + extension * 0.74 };
    pose.armRx = -0.75 - extension * 0.8;
    pose.elbR = -2.1 + extension * 2;
  } else if (action === 'recibirGolpe') {
    const recoil = Math.sin(Math.PI * p);
    pose.weight = smooth(p / 0.1) * smooth((1 - p) / 0.35);
    pose.lean = -0.27 * recoil;
    pose.twist = -0.12 * recoil;
    pose.head = -0.22 * recoil;
  } else if (action === 'asustado') {
    pose.lean = 0.17; pose.head = 0.15;
    pose.left = { side: -0.2, up: 0.15, forward: 0.2 };
    pose.right = { side: -0.2, up: 0.15, forward: 0.2 };
    pose.armLx = pose.armRx = -1.3;
    pose.elbL = pose.elbR = -2.25;
    pose.armLz = 0.4; pose.armRz = -0.4;
  }
  return pose;
}

/** Capa por instancia: restaura antes del mixer y orienta los brazos en el espacio del cuerpo. */
export function createCombatPose(root, bones) {
  const find = name => [...bones].find(([key]) => key.replace(/[^a-z0-9]/gi, '').endsWith(name))?.[1];
  const arms = ['Left', 'Right'].map((side, index) => ({
    upper: find(side + 'Arm'), lower: find(side + 'ForeArm'), hand: find(side + 'Hand'), side: index ? -1 : 1
  })).filter(arm => arm.upper && arm.lower && arm.hand);
  const spine = find('Spine2'), head = find('Head');
  const changed = [...new Set([spine, head, ...arms.flatMap(arm => [arm.upper, arm.lower])].filter(Boolean))];
  const baseline = new Map(changed.map(bone => [bone, bone.quaternion.clone()]));
  const rootRotation = new THREE.Quaternion(), inverseRoot = new THREE.Quaternion();
  const current = new THREE.Quaternion(), parentRotation = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), wrist = new THREE.Vector3();
  const desired = new THREE.Vector3(), direction = new THREE.Vector3(), pole = new THREE.Vector3(), elbowTarget = new THREE.Vector3();
  const localShoulder = new THREE.Vector3(), childPosition = new THREE.Vector3(), origin = new THREE.Vector3();
  let applied = false;

  function restore() {
    if (!applied) return;
    for (const bone of changed) bone.quaternion.copy(baseline.get(bone));
    applied = false;
  }

  function rotateBody(bone, pitch, yaw, weight) {
    if (!bone) return;
    bone.getWorldQuaternion(current);
    bone.parent.getWorldQuaternion(parentRotation).invert();
    rotation.setFromEuler(euler.set(pitch, yaw, 0));
    rotation.premultiply(rootRotation).multiply(inverseRoot).multiply(current);
    bone.quaternion.slerp(parentRotation.multiply(rotation), weight);
    bone.updateWorldMatrix(false, true);
  }

  function aim(bone, child, target, weight) {
    bone.getWorldPosition(origin);
    child.getWorldPosition(childPosition).sub(origin).normalize();
    direction.copy(target).sub(origin).normalize();
    rotation.setFromUnitVectors(childPosition, direction);
    bone.getWorldQuaternion(current);
    bone.parent.getWorldQuaternion(parentRotation).invert();
    bone.quaternion.slerp(parentRotation.multiply(rotation.multiply(current)), weight);
    bone.updateWorldMatrix(false, true);
  }

  function poseArm(arm, target, weight) {
    arm.upper.getWorldPosition(shoulder);
    arm.lower.getWorldPosition(elbow);
    arm.hand.getWorldPosition(wrist);
    const upperLength = shoulder.distanceTo(elbow), lowerLength = elbow.distanceTo(wrist);
    const length = upperLength + lowerLength;
    if (length < 1e-5) return;
    localShoulder.copy(shoulder); root.worldToLocal(localShoulder);
    // Las proporciones se calculan sobre los huesos de esta edad y nivel de detalle.
    const rootScale = root.getWorldScale(childPosition).x;
    const localLength = length / Math.abs(rootScale || 1);
    desired.set(localShoulder.x + target.side * arm.side * localLength,
      localShoulder.y + target.up * localLength, localShoulder.z + target.forward * localLength);
    root.localToWorld(desired);
    direction.copy(desired).sub(shoulder);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(upperLength - lowerLength) + 1e-5, length - 1e-5);
    direction.normalize();
    desired.copy(shoulder).addScaledVector(direction, distance);
    pole.set(arm.side, -0.65, -0.15).applyQuaternion(rootRotation);
    pole.addScaledVector(direction, -pole.dot(direction)).normalize();
    const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    elbowTarget.copy(shoulder).addScaledVector(direction, along).addScaledVector(pole, bend);
    aim(arm.upper, arm.lower, elbowTarget, weight);
    aim(arm.lower, arm.hand, desired, weight);
  }

  return {
    restore,
    apply(action, progress = 0) {
      if (!isCombatAction(action)) return;
      const pose = sampleCombatPose(action, progress);
      for (const bone of changed) baseline.get(bone).copy(bone.quaternion);
      applied = true;
      root.updateWorldMatrix(true, true);
      root.getWorldQuaternion(rootRotation); inverseRoot.copy(rootRotation).invert();
      rotateBody(spine, pose.lean, pose.twist, pose.weight);
      rotateBody(head, pose.head, 0, pose.weight);
      for (const arm of arms) poseArm(arm, arm.side < 0 ? pose.right : pose.left, pose.weight);
    }
  };
}
