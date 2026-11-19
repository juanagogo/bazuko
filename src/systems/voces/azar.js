// src/systems/voces/azar.js
// El azar de las voces. Es propio: lo que sortean (qué frase sale, con qué voz, cuándo, con qué tono) no gasta el
// azar del juego (`Math.random`), ni al crearlo. Así, con una semilla fija, el juego da lo mismo con voces o sin ellas.

/** Un azar nuevo. Sin `semilla` arranca del reloj, distinto en cada partida. */
export function azarDeVoces(semilla = Date.now()) {
  let s = Math.trunc(semilla) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
