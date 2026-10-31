import { GRAVITY, boardY } from '../src/features/bolirana/rules.mjs';
export const BALL_RADIUS = 0.105;
const slope = 0.28,
  norm = Math.hypot(1, slope),
  ny = 1 / norm,
  nz = slope / norm;
const distance = (p) => (p.y + slope * p.z - 2.05) / norm;
const onBoard = (p) => Math.abs(p.x) <= 1.76 && p.z >= -4 && p.z <= 1.5;
// El primer contacto del segmento evita que una bola rodante salte un hueco.
export function crossedHole(from, to, holes) {
  let best = null;
  for (const h of holes) {
    const dx = to.x - from.x,
      dz = to.z - from.z,
      ox = from.x - h.center.x,
      oz = (from.z - h.center.z) * norm;
    const vx = dx,
      vz = dz * norm,
      r = h.radius - BALL_RADIUS;
    if (r <= 0) continue;
    const a = vx * vx + vz * vz,
      c = ox * ox + oz * oz - r * r;
    let t = 0;
    if (c > 0) {
      if (a < 1e-12) continue;
      const b = 2 * (ox * vx + oz * vz),
        disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0 || t > 1) continue;
    }
    if (!best || t < best.t) best = { hole: h, t };
  }
  return best?.hole ?? null;
}
export function stepBall(b, dt, holes, frog) {
  const old = { ...b.p };
  b.age += dt;
  if (b.rolling) {
    // Gravedad proyectada sobre el tablero y resistencia opuesta al movimiento.
    const az = (((GRAVITY * slope) / (1 + slope * slope)) * 5) / 7;
    b.v.z += az * dt;
    const speed = Math.hypot(b.v.x, b.v.z * norm),
      drag = Math.max(0, 1 - (0.12 * GRAVITY * dt) / Math.max(speed, 0.001));
    b.v.x *= drag;
    b.v.z *= drag;
    b.v.y = -slope * b.v.z;
  } else b.v.y -= GRAVITY * dt;
  b.p.x += b.v.x * dt;
  b.p.y += b.v.y * dt;
  b.p.z += b.v.z * dt;
  if (!b.rolling && old.z > frog.z && b.p.z <= frog.z) {
    const t = (old.z - frog.z) / (old.z - b.p.z);
    if (
      Math.hypot(
        old.x + (b.p.x - old.x) * t,
        old.y + (b.p.y - old.y) * t - frog.y
      ) < 0.17
    )
      return { points: 20, rana: true };
  }
  const before = distance(old) - BALL_RADIUS,
    after = distance(b.p) - BALL_RADIUS;
  if (b.rolling && onBoard(old)) {
    const hole = crossedHole(old, b.p, holes);
    if (hole) return { points: hole.value, rana: false };
  } else if (before >= 0 && after <= 0) {
    const t = before / (before - after),
      hit = { x: old.x + (b.p.x - old.x) * t, z: old.z + (b.p.z - old.z) * t };
    if (onBoard(hit)) {
      const hole = crossedHole(hit, hit, holes);
      if (hole) return { points: hole.value, rana: false };
      b.p.y -= after * ny;
      b.p.z -= after * nz;
      const vn = b.v.y * ny + b.v.z * nz;
      // La restitución afecta la componente normal y conserva el movimiento lateral.
      b.v.x *= 0.86;
      b.v.y = (b.v.y - vn * ny) * 0.86 - vn * 0.28 * ny;
      b.v.z = (b.v.z - vn * nz) * 0.86 - vn * 0.28 * nz;
      if (Math.abs(vn) * 0.28 < 0.65) {
        b.rolling = true;
        b.v.y = -slope * b.v.z;
      }
    }
  }
  if (onBoard(b.p) && distance(b.p) < BALL_RADIUS + 0.35) {
    const edge = 1.76 - BALL_RADIUS;
    if (Math.abs(b.p.x) > edge) {
      b.p.x = Math.sign(b.p.x) * edge;
      b.v.x = -Math.sign(b.p.x) * Math.abs(b.v.x) * 0.45;
    }
    if (b.p.z < -3.85 && b.v.z < 0) {
      b.p.z = -3.85;
      b.v.z = -b.v.z * 0.4;
    }
  }
  if (b.rolling) {
    if (onBoard(b.p)) b.p.y = boardY(b.p.z) + BALL_RADIUS * norm;
    else b.rolling = false;
  }
  if (b.age > 7 || b.p.y < 0.1 || b.p.z < -5.5 || Math.abs(b.p.x) > 4)
    return { points: 0, rana: false };
  return null;
}
