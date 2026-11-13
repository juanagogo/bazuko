// Resortes de segundo orden con estado { x, v }. Se integran con la solución exacta de la ecuación para
// un objetivo fijo durante el paso: la misma curva a 30, 60 o 144 FPS y estables con dt de 0,1 s o más.
// A diferencia del acercamiento exponencial, arrancan con la velocidad que traían: no hay tirón al cambiar
// de objetivo. Sin Three ni memoria por cuadro.

/** Estado nuevo de un resorte en `x` y quieto. */
export const spring = (x = 0) => ({ x, v: 0 });

/** Amortiguamiento crítico (ζ = 1): llega sin pasarse. `omega` en rad/s (≈ 4,7 / tiempo de asentamiento). */
export function criticalSpring(state, target, omega, dt) {
  if (!(dt > 0) || !Number.isFinite(target)) return state.x;
  const x0 = state.x - target, v0 = state.v;
  const e = Math.exp(-omega * dt), c = v0 + omega * x0;
  state.x = target + (x0 + c * dt) * e;
  state.v = (v0 - omega * c * dt) * e;
  return state.x;
}

/**
 * Amortiguamiento crítico hacia una meta que se mueve en línea recta de `from` a `to` durante el paso.
 * Es la solución exacta con la velocidad de la meta: seguir a algo que se mueve deja el mismo retraso
 * (2·v/ω en régimen) a 20 o a 144 FPS, cosa que no pasa si la meta se toma quieta en cada paso.
 */
export function followSpring(state, from, to, omega, dt) {
  if (!(dt > 0) || !Number.isFinite(from) || !Number.isFinite(to)) return criticalSpring(state, to, omega, dt);
  const goalSpeed = (to - from) / dt, lag = 2 * goalSpeed / omega;
  // Desvío respecto a la respuesta de régimen (la meta menos su retraso), que se apaga como un resorte crítico.
  const x0 = state.x - (from - lag), v0 = state.v - goalSpeed;
  const e = Math.exp(-omega * dt), c = v0 + omega * x0;
  state.x = to - lag + (x0 + c * dt) * e;
  state.v = goalSpeed + (v0 - omega * c * dt) * e;
  return state.x;
}

/** Subamortiguado (0 < ζ < 1): se pasa un poco y vuelve, como un brazo que sigue al cuerpo. */
export function dampedSpring(state, target, omega, zeta, dt) {
  if (zeta >= 1) return criticalSpring(state, target, omega, dt);
  if (!(dt > 0) || !Number.isFinite(target)) return state.x;
  const x0 = state.x - target, v0 = state.v;
  const a = zeta * omega, wd = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-a * dt), cos = Math.cos(wd * dt), sin = Math.sin(wd * dt);
  const b = (v0 + a * x0) / wd;
  state.x = target + e * (x0 * cos + b * sin);
  state.v = e * (v0 * cos - (a * b + wd * x0) * sin);
  return state.x;
}

/** Lleva el resorte a `x` sin velocidad (teletransportes, cambios de modelo). */
export function snapSpring(state, x = 0) {
  state.x = x; state.v = 0;
  return x;
}
