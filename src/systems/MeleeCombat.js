import * as THREE from 'three';

/** Segmento a la altura del torso: un golpe no puede rodear una esquina. */
export function hasMeleeLine(from, to, collisions) {
  if (!collisions) return true;
  const origin = new THREE.Vector3(from.x, from.y + 1.15, from.z);
  const destination = new THREE.Vector3(to.x, to.y + 1.15, to.z);
  const direction = destination.clone().sub(origin);
  const distance = direction.length();
  if (distance < 0.001) return true;
  const ray = new THREE.Ray(origin, direction.divideScalar(distance));
  const statics = collisions.queryStatic?.(Math.min(from.x, to.x), Math.min(from.z, to.z),
    Math.max(from.x, to.x), Math.max(from.z, to.z)) ?? collisions.colliders ?? [];
  const hit = new THREE.Vector3();
  for (const { box, obb } of [...statics, ...(collisions.dynamicColliders ?? [])]) {
    let testRay = ray, testBox = box;
    if (obb) {
      testRay = new THREE.Ray(origin.clone().sub(obb.center).applyQuaternion(obb.inverse),
        ray.direction.clone().applyQuaternion(obb.inverse));
      testBox = new THREE.Box3(obb.halfSize.clone().negate(), obb.halfSize.clone());
    }
    if (testBox && testRay.intersectBox(testBox, hit) && hit.distanceTo(testRay.origin) < distance - 0.001) return false;
  }
  return true;
}
