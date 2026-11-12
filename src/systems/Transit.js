// src/systems/Transit.js
// Viajar en TransMilenio o en el Metro entre sus tres paradas. Se paga el pasaje o se cuela uno por el
// torniquete; colarse sale gratis, pero a veces lo pilla la Policía y, si ya estaba fichado, es más fácil.
// En el vagón se puede pedir: la gente da poco y, con mal olor, nada.

export const PASAJE = 3200;

export const TRANSIT = {
  colarse: 0.2,          // probabilidad de que lo pillen colándose sin estar fichado
  colarsePorNivel: 0.12, // y lo que suma cada nivel de fichado
  multaAnimo: 6,         // ánimo que se pierde cuando lo bajan
  minutosBase: 8,        // minutos de juego de cualquier viaje
  metrosPorMinuto: 25,   // y los que suma la distancia
  pedirMin: 600,
  pedirMax: 3500,
  pedirNadie: 0.3,       // a veces nadie da nada en el vagón
};

/** Minutos de juego que tarda el viaje entre dos paradas. */
export function travelMinutes(a, b) {
  return Math.round(TRANSIT.minutosBase + Math.hypot(a.x - b.x, a.z - b.z) / TRANSIT.metrosPorMinuto);
}

/** Probabilidad de que lo pillen colándose con ese nivel de fichado (0 a 3). */
export function sneakRisk(buscado = 0) {
  return Math.min(0.85, TRANSIT.colarse + TRANSIT.colarsePorNivel * Math.max(0, buscado));
}

/**
 * Resuelve un viaje. `modo`: 'pagar' o 'colarse'; `pedir`: pedir plata en el vagón.
 * Devuelve { ok, motivo?, pagado, ganado, pillado }. No mueve al jugador: eso lo hace el juego.
 */
export function resolveTrip({ modo, pedir = false, dinero = 0, buscado = 0, malOlor = false, random = Math.random }) {
  if (modo === 'pagar' && dinero < PASAJE) return { ok: false, motivo: 'plata', pagado: 0, ganado: 0, pillado: false };
  if (modo === 'colarse' && random() < sneakRisk(buscado)) return { ok: false, motivo: 'pillado', pagado: 0, ganado: 0, pillado: true };
  let ganado = 0;
  if (pedir && !malOlor && random() >= TRANSIT.pedirNadie) {
    ganado = Math.round((TRANSIT.pedirMin + random() * (TRANSIT.pedirMax - TRANSIT.pedirMin)) / 100) * 100;
  }
  return { ok: true, pagado: modo === 'pagar' ? PASAJE : 0, ganado, pillado: false };
}
