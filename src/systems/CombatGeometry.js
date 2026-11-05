import * as THREE from 'three';

const EPSILON = 1e-7;
const _localFrom = new THREE.Vector3();
const _localTo = new THREE.Vector3();
const _inverse = new THREE.Quaternion();

const finitePosition = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// Intersección del segmento finito con el interior de la caja. Rozar una cara no
// bloquea; empezar dentro sí. También sirve en el espacio local de una OBB.
function crossesBox(from, to, min, max) {
  let near = 0, far = 1;
  for (const axis of ['x', 'y', 'z']) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < EPSILON) {
      if (from[axis] <= min[axis] + EPSILON || from[axis] >= max[axis] - EPSILON) return false;
    } else {
      let a = (min[axis] - from[axis]) / delta;
      let b = (max[axis] - from[axis]) / delta;
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near >= far - EPSILON) return false;
    }
  }
  return far > EPSILON && near < 1 - EPSILON;
}

function blocksLine(entry, from, to, ignoreVehicle) {
  if (ignoreVehicle && (entry.vehicle === ignoreVehicle || entry.vehicle?.car === ignoreVehicle || entry.mesh === ignoreVehicle)) return false;
  const { obb } = entry;
  if (obb) {
    const inverse = obb.inverse ?? _inverse.copy(obb.quaternion).invert();
    _localFrom.copy(from).sub(obb.center).applyQuaternion(inverse);
    _localTo.copy(to).sub(obb.center).applyQuaternion(inverse);
    const half = obb.halfSize;
    return crossesBox(_localFrom, _localTo, { x: -half.x, y: -half.y, z: -half.z }, half);
  }
  const box = entry.box ?? entry;
  return !!(box.min && box.max && crossesBox(from, to, box.min, box.max));
}

/** Puntos de los pies; el segmento se traza a la altura del pecho de ambos. */
export function hasClearCombatLine({ from, to, collisions = null, chestHeight = 1.05, ignoreVehicle = null }) {
  if (!finitePosition(from) || !finitePosition(to)) return false;
  if (!collisions) return true;
  const a = { x: from.x, y: from.y + chestHeight, z: from.z };
  const b = { x: to.x, y: to.y + chestHeight, z: to.z };
  const statics = Array.isArray(collisions) ? collisions : collisions.queryStatic
    ? collisions.queryStatic(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), [])
    : collisions.colliders ?? [];
  for (const entry of statics) if (blocksLine(entry, a, b, ignoreVehicle)) return false;
  for (const entry of collisions.dynamicColliders ?? []) if (blocksLine(entry, a, b, ignoreVehicle)) return false;
  return true;
}

/** El agua bajo un puente no cuenta como inmersión del personaje que va encima. */
export function isCombatInWater(position, getWaterInfo) {
  const water = getWaterInfo?.(position.x, position.z);
  return !!water && position.y < water.surfaceY - .15;
}

export function canReachCombatTarget({ from, to, collisions = null, maxDistance = Infinity,
  maxHeightDifference = .85, chestHeight = 1.05, getWaterInfo = null,
  fromInWater = false, toInWater = false, ignoreVehicle = null }) {
  if (!finitePosition(from) || !finitePosition(to)) return false;
  if (Math.abs(from.y - to.y) > maxHeightDifference) return false;
  if (Math.hypot(to.x - from.x, to.z - from.z) > maxDistance) return false;
  if (fromInWater || toInWater || isCombatInWater(from, getWaterInfo) || isCombatInWater(to, getWaterInfo)) return false;
  return hasClearCombatLine({ from, to, collisions, chestHeight, ignoreVehicle });
}

/** Avance a pie con barrido de sólidos y muestreo corto del suelo y la ribera. */
export function resolveCombatWalk({ from, to, groundHeight, isWalkable = () => true,
  getWaterInfo = null, collisions = null, radius = .32 }, result = new THREE.Vector3()) {
  const dx = to.x - from.x, dz = to.z - from.z;
  result.copy(from);
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .2));
  const delta = new THREE.Vector3(dx / steps, 0, dz / steps);
  const next = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    next.copy(result).add(delta);
    if (collisions?.resolveMove) collisions.resolveMove(result, delta, radius, next);
    next.y = groundHeight?.(next.x, next.z, result.y) ?? result.y;
    if (!Number.isFinite(next.y) || Math.abs(next.y - result.y) > .4 || !isWalkable(next.x, next.z)) break;
    const water = getWaterInfo?.(next.x, next.z);
    if (water && next.y <= water.surfaceY + .08) break;
    if (!hasClearCombatLine({ from: result, to: next, collisions, chestHeight: .8 })) break;
    result.copy(next);
  }
  return result;
}
