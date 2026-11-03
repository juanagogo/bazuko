// src/systems/Forcejeo.js
// Lógica pura del forcejeo por la zorra: sin DOM ni three.js.

import { FORCEJEO } from '../data/zorra.js';

export function fuerzaJugador({ energia, enAbstinencia, origenMult = 1 }, cfg = FORCEJEO) {
  let fuerza = 1;
  if (energia < cfg.energiaBaja) fuerza *= cfg.multEnergiaBaja;
  if (enAbstinencia) fuerza *= cfg.multAbstinencia;
  return fuerza * origenMult;
}

export function crearForcejeo(fuerza, cfg = FORCEJEO) {
  return { barra: cfg.barraInicial, tiempo: 0, fuerza, resultado: null };
}

export function pulsarForcejeo(f, cfg = FORCEJEO) {
  if (f.resultado) return;
  f.barra = Math.min(1, f.barra + cfg.empuje * f.fuerza);
  if (f.barra >= 1) f.resultado = 'victoria';
}

export function avanzarForcejeo(f, dt, cfg = FORCEJEO) {
  if (f.resultado) return;
  f.barra = Math.max(0, f.barra - cfg.tironNpc * dt);
  f.tiempo += dt;
  if (f.barra <= 0 || f.tiempo >= cfg.duracion) f.resultado = 'derrota';
}

export function cancelarForcejeo(f) {
  if (!f.resultado) f.resultado = 'derrota';
}

/** Ids de materiales ganados: entre `min` y `max`, ambos incluidos */
export function botinForcejeo(random = Math.random, cfg = FORCEJEO) {
  const { min, max, materiales } = cfg.botin;
  const cantidad = min + Math.floor(random() * (max - min + 1));
  return Array.from({ length: cantidad }, () => materiales[Math.floor(random() * materiales.length)]);
}
