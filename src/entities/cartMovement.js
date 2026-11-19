import { CART_AXLE } from './cartVisual.js';

const { halfTrack, radius } = CART_AXLE;
// Muestrea la parte baja de la banda. El borde empieza a cargar la rueda antes de alcanzar el eje.
const tread = Array.from({ length: 25 }, (_, i) => {
  const angle = (i - 12) * Math.PI / 36;
  return { y: -radius * Math.cos(angle), z: radius * Math.sin(angle) };
});
const widths = [-.042, 0, .042];

export const turnBetween = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function cartGround(heightAt, x, z, reference) {
  const height = heightAt?.(x, z, reference);
  // Al costado de un puente la búsqueda puede devolver el piso inferior. El eje se queda en su capa.
  return Number.isFinite(height) && Math.abs(height - reference) <= .6 ? height : reference;
}

function wheelHeight(heightAt, x, z, sin, cos, reference, side, roll) {
  const rc = Math.cos(roll), rs = Math.sin(roll);
  let height = -Infinity;
  for (const r of tread) for (const width of widths) {
    const offset = (side * halfTrack + width) * rc - r.y * rs;
    const ground = cartGround(heightAt, x + cos * offset + sin * r.z, z - sin * offset + cos * r.z, reference);
    height = Math.max(height, ground - r.y * rc - width * rs);
  }
  return height;
}

export function fitCartAxle(heightAt, x, z, sin, cos, reference, out) {
  let roll = 0, left, right;
  for (let pass = 0; pass < 3; pass++) {
    left = wheelHeight(heightAt, x, z, sin, cos, reference, -1, roll);
    right = wheelHeight(heightAt, x, z, sin, cos, reference, 1, roll);
    const next = Math.asin(Math.max(-.34, Math.min(.34, (right - left) / (2 * halfTrack))));
    if (Math.abs(next - roll) < .001) break;
    roll = next;
  }
  const drop = halfTrack * Math.sin(roll);
  out.roll = roll;
  out.height = Math.max(left + drop, right - drop);
}

// Huella de la caja y del costal lateral. El borde bajo queda por encima del sardinel.
const HALF_X = .84, HALF_Z = .89;

export function cartHitsWall(collisions, x, z, yaw, floor, candidates) {
  if (!collisions?.queryStatic) return false;
  const s = Math.sin(yaw), c = Math.cos(yaw), as = Math.abs(s), ac = Math.abs(c);
  const extentX = ac * HALF_X + as * HALF_Z, extentZ = as * HALF_X + ac * HALF_Z;
  const near = collisions.queryStatic(x - extentX, z - extentZ, x + extentX, z + extentZ, candidates);
  for (const { box: { min, max } } of near) {
    if (max.y <= floor + .24 || min.y >= floor + 1.29) continue;
    const dx = (min.x + max.x) / 2 - x, dz = (min.z + max.z) / 2 - z;
    const w = (max.x - min.x) / 2, d = (max.z - min.z) / 2;
    if (Math.abs(dx) >= w + extentX || Math.abs(dz) >= d + extentZ) continue;
    if (Math.abs(dx * c - dz * s) < HALF_X + ac * w + as * d
      && Math.abs(dx * s + dz * c) < HALF_Z + as * w + ac * d) return true;
  }
  return false;
}
