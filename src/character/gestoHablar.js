// src/character/gestoHablar.js
// Mientras alguien habla, la cabeza se le mueve un poco: no hay hueso de mandíbula ni gestos de cara en los
// personajes, así que lo que se ve es un vaivén leve de la cabeza. Va sumado al giro `look` que ya suaviza
// ActionPose, solo con el modelo completo y cerca; si no, vale exactamente 0 y no despierta nada.

export const GESTO_HABLAR = Object.freeze({ amplitud: .06, entrada: 150, cerca: 10 });
const W1 = 2 * Math.PI * 2.1, W2 = 2 * Math.PI * 3.7;

/** Giro de cabeza (rad) de `npc` en `now` (ms): suma de dos senos con fase propia, con entrada y salida de 150 ms. */
export function gestoHablar(npc, now = globalThis.performance?.now?.() ?? Date.now()) {
  const desde = npc?._hablaDesde, hasta = npc?._hablaHasta;
  if (!(hasta > now) || !(now >= desde)) return 0;
  if (!npc.character || npc.character !== npc.fullChar || !(npc._playerDist < GESTO_HABLAR.cerca)) return 0;
  const fase = ((npc.vozSemilla ?? 0) % 1000) / 1000 * 2 * Math.PI;
  const t = (now - desde) / 1000;
  const envolvente = Math.min(1, (now - desde) / GESTO_HABLAR.entrada, (hasta - now) / GESTO_HABLAR.entrada);
  return GESTO_HABLAR.amplitud * envolvente * (Math.sin(W1 * t + fase) * .6 + Math.sin(W2 * t + fase * 1.7) * .4);
}
