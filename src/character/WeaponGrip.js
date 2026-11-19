import { MathUtils, Object3D, Quaternion, Raycaster, Vector3 } from 'three';
import { PoseRig } from './poseRig.js';

const poses = new WeakMap();
const held = new Set(['cuchillo', 'botella_picada', 'arma']);

// Dos rayos por dedo, una sola vez por cuerpo y objeto. Se mide la madera o el vidrio del modelo que lleva la mano.
function surface(model, x, y, z, dx, dz) {
  const start = model.localToWorld(new Vector3(x, y, z));
  const direction = model.localToWorld(new Vector3(x + dx, y, z + dz)).sub(start).normalize();
  const hit = new Raycaster(start, direction).intersectObject(model, true)[0];
  return hit && model.worldToLocal(hit.point);
}

function bake(source, object, id, fist) {
  const rig = new PoseRig(source);
  for (const joint of fist) rig.bones.get(joint.name).quaternion.copy(joint.rotation);
  const model = object.clone();
  rig.joints.rightHand.add(model);
  model.updateWorldMatrix(true, true);
  for (const { finger, chain } of rig.fingers.right) {
    const [base, middle, last] = chain;
    const thumb = finger === 'Thumb', little = finger === 'Pinky', board = id === 'arma';
    const sign = thumb ? -1 : 1;
    const baseAt = model.worldToLocal(rig.where(base));
    const y = MathUtils.clamp(baseAt.y, -.046, .035);
    const edge = surface(model, sign * .14, y, 0, -sign, 0)?.x;
    if (edge == null) continue;
    // El pulgar envuelve desde el otro lado. La tabla obliga a rodear su canto antes de llegar a la cara posterior.
    const around = board && !thumb;
    const firstX = edge + sign * (around ? .028 : thumb ? .003 : .021);
    const first = model.localToWorld(new Vector3(firstX, baseAt.y + (thumb ? .009 : 0), around ? .012 : -.022)).sub(rig.where(base));
    rig.point(base, first.x, first.y, first.z);
    const targetX = edge * (board ? (little ? .90 : .80) : (thumb ? .16 : little ? .32 : -.25));
    const targetY = baseAt.y - (thumb ? .008 : 0);
    const back = surface(model, targetX * .99, targetY, -.13, 0, 1);
    if (!back) continue;
    // El centro de la yema queda medio espesor de piel por fuera de la superficie.
    const target = model.localToWorld(new Vector3(targetX, targetY, back.z - .0045));
    const pole = model.localToWorld(new Vector3(sign * .12, targetY + (thumb ? .09 : 0), -.16)).sub(rig.where(middle));
    const tip = new Object3D();
    tip.position.y = last.position.length() * .7;
    last.add(tip);
    rig.reach(middle, last, tip, target, pole);
  }
  return fist.map(({ name }) => ({ name, rotation: rig.bones.get(name).quaternion.clone() }));
}

/** La mano de cada portador guarda y devuelve los dedos que el clip tenía antes de agarrar el objeto. */
export function createWeaponGrip(bones, source, fists, object, id) {
  if (!held.has(id) || !fists?.R?.length || !object) return null;
  let byItem = poses.get(fists);
  if (!byItem) { byItem = new Map(); poses.set(fists, byItem); }
  if (!byItem.has(id)) byItem.set(id, bake(source, object, id, fists.R));
  const slots = byItem.get(id).map(({ name, rotation }) => ({ bone: bones.get(name), rotation, saved: new Quaternion() }));
  let applied = false;
  return {
    apply() {
      if (applied) return;
      applied = true;
      for (const { bone, rotation, saved } of slots) {
        saved.copy(bone.quaternion);
        bone.quaternion.copy(rotation);
      }
    },
    restore() {
      if (!applied) return;
      applied = false;
      for (const { bone, saved } of slots) bone.quaternion.copy(saved);
    }
  };
}
