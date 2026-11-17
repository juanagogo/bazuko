// src/systems/rebusque/reacciones.js
// Qué hace cada conductor al terminar un trabajo del semáforo: paga, da propina, regala comida, se excusa, sube el
// vidrio, no mira, pita o insulta. Puro: recibe el contexto y el azar, y devuelve la reacción.
import { CLASE_REACCION, ORDEN_REACCION, PESOS_REACCION, PROPINA, COMIDA_REGALADA } from '../../data/rebusqueReacciones.js';

const redondeo = pesos => Math.round(pesos / 100) * 100;

/**
 * Probabilidad de cada reacción (suman 1) para un carro.
 * @param {object} c contexto: `id` del trabajo, `tipoCarro` ('carro' | 'taxi'), `sucio` y `lluvia`.
 */
export function pesosReaccion({ id, tipoCarro = 'carro', sucio = false, lluvia = false } = {}) {
  const base = PESOS_REACCION[id];
  if (!base) return null;
  let extra = 1;
  if (sucio) extra *= .5;
  if (lluvia) extra *= .6;
  const w = {};
  let fijas = 0, neutras = 0;
  for (const tipo of ORDEN_REACCION) {
    let peso = base[tipo] ?? 0;
    if (!peso) continue;
    const clase = CLASE_REACCION[tipo];
    if (clase === 'positiva') {
      peso *= extra;
      if (tipo === 'paga' && tipoCarro === 'taxi') peso *= .8;
    } else if (tipo === 'ventana' && sucio) peso *= 2;
    w[tipo] = peso;
    if (clase === 'neutra') neutras += peso; else fijas += peso;
  }
  // Lo positivo y lo hostil quedan con su probabilidad exacta; las neutras llenan lo que sobra.
  const resto = (1 - fijas) / neutras;
  for (const tipo in w) if (CLASE_REACCION[tipo] === 'neutra') w[tipo] *= resto;
  return w;
}

/** Monto de una reacción positiva. `r` en [0, 1); `r2` decide el billete de la propina. */
export function montoDe(tipo, def, { r = 0, r2 = 1 } = {}) {
  if (tipo === 'paga') {
    const [min, max] = def.paga;
    return redondeo(min + r * (max - min));
  }
  if (tipo === 'propina') return r2 < PROPINA.probBillete ? PROPINA.billete : redondeo(PROPINA.min + r * (PROPINA.max - PROPINA.min));
  return 0;
}

/**
 * Una sola tirada acumulada por carro, con la paga primero: random() = 0 da paga con el mínimo.
 * Devuelve `{ tipo, pesos, item }` (`item`: id de la comida regalada).
 */
export function elegirReaccion(contexto, def, random = Math.random) {
  const w = pesosReaccion({ ...contexto, id: def.id });
  if (!w) return { tipo: 'ignora', pesos: 0, item: null };
  const roll = random();
  let acumulado = 0, tipo = 'ignora';
  for (const t of ORDEN_REACCION) {
    if (!w[t]) continue;
    acumulado += w[t];
    if (roll < acumulado) { tipo = t; break; }
  }
  const r = random();
  const r2 = tipo === 'propina' ? random() : 1;
  const item = tipo === 'comida' ? COMIDA_REGALADA[Math.min(COMIDA_REGALADA.length - 1, Math.floor(r * COMIDA_REGALADA.length))] : null;
  return { tipo, pesos: montoDe(tipo, def, { r, r2 }), item };
}
