// src/systems/rebusque/reacciones.js
// Qué hace cada conductor al terminar un trabajo del semáforo: paga, da propina, regala comida, se excusa, sube el
// vidrio, no mira, pita, insulta o se pone bravo. Puro: recibe el contexto y el azar, y devuelve la reacción.
import { CLASE_REACCION, ORDEN_REACCION, PESOS_REACCION, PROPINA, COMIDA_REGALADA, TOPE_POSITIVAS } from '../../data/rebusqueReacciones.js';

const redondeo = pesos => Math.round(pesos / 100) * 100;

/**
 * Probabilidad de cada reacción (suman 1) para un carro.
 * @param {object} c contexto: `id` del trabajo, `tipoCarro` ('carro' | 'taxi' | 'buseta' | 'moto'), `calidad` del show
 *   (0 a 1, 0,5 es normal), `fama` (−1 a 1), `franja` (de JornadaSystem), `sucio`, `lluvia`, `repeticion` (trabajos en
 *   esta esquina en la última hora), `quemado` (me vieron robando aquí hoy) y `cansado` (más de diez shows hoy).
 */
export function pesosReaccion({ id, tipoCarro = 'carro', calidad = .5, fama = 0, franja = null, sucio = false,
  lluvia = false, repeticion = 0, quemado = false, cansado = false } = {}) {
  const base = PESOS_REACCION[id];
  if (!base) return null;
  const q = Math.min(1, Math.max(0, Number.isFinite(calidad) ? calidad : .5));
  const f = Math.min(1, Math.max(-1, Number.isFinite(fama) ? fama : 0));
  const show = id === 'malabares';
  // Hora y fama mueven lo bueno y lo malo; el show mueve sobre todo la paga y la propina. Con tope.
  const positivas = (franja?.limosna ?? 1) * (1 + .3 * f);
  const hostiles = (franja?.golpe ?? 1) * (1 - .5 * f);
  const mult = { paga: positivas * (show ? .85 + .3 * q : 1), propina: positivas * (show ? .5 + q : 1) };
  let extra = 1;
  if (sucio) extra *= .5;
  if (lluvia) extra *= id === 'vidrios' ? .4 : show ? .6 : 1;
  extra *= Math.max(.6, Math.pow(.9, Math.max(0, repeticion)));
  if (quemado) extra *= .3;
  if (cansado) extra *= .8;
  const w = {};
  let fijas = 0, neutras = 0;
  for (const tipo of ORDEN_REACCION) {
    let peso = base[tipo] ?? 0;
    if (!peso) continue;
    const clase = CLASE_REACCION[tipo];
    if (clase === 'positiva') {
      peso *= Math.min(TOPE_POSITIVAS, mult[tipo] ?? positivas) * extra;
      if (tipo === 'paga' && tipoCarro === 'taxi') peso *= .8;
      if (tipo === 'paga' && tipoCarro === 'buseta') peso *= 1.1;
    } else if (clase === 'hostil') {
      peso *= hostiles;
      if (tipo === 'insulto' && quemado) peso *= 2;
    } else if (tipo === 'ventana') {
      // Una moto no tiene vidrio que subir: el que no quiere, no mira.
      if (tipoCarro === 'moto') { w.ignora = (w.ignora ?? 0) + peso; neutras += peso; continue; }
      if (sucio) peso *= 2;
    }
    w[tipo] = (w[tipo] ?? 0) + peso;
    if (clase === 'neutra') neutras += peso; else fijas += peso;
  }
  // Lo positivo y lo hostil quedan con su probabilidad exacta; las neutras llenan lo que sobra.
  if (fijas >= 1 || neutras <= 0) {
    const total = fijas || 1;
    for (const tipo in w) w[tipo] = CLASE_REACCION[tipo] === 'neutra' ? 0 : w[tipo] / total;
  } else {
    const resto = (1 - fijas) / neutras;
    for (const tipo in w) if (CLASE_REACCION[tipo] === 'neutra') w[tipo] *= resto;
  }
  return w;
}

/** Monto de una reacción positiva. `r` en [0, 1). */
export function montoDe(tipo, def, { calidad = .5, r = 0, r2 = 1 } = {}) {
  const q = Math.min(1, Math.max(0, calidad));
  if (tipo === 'paga') {
    const [min, max] = def.paga;
    const escala = def.id === 'malabares' ? .9 + .2 * q : 1;
    return redondeo((min + r * (max - min)) * escala);
  }
  if (tipo === 'compra') return def.paga[0];
  if (tipo === 'propina') {
    if (def.consume) return PROPINA.dulce;
    return r2 < PROPINA.probBillete ? PROPINA.billete : redondeo(PROPINA.min + r * (PROPINA.max - PROPINA.min));
  }
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
  const r2 = tipo === 'propina' && !def.consume ? random() : 1;
  const item = tipo === 'comida' ? COMIDA_REGALADA[Math.min(COMIDA_REGALADA.length - 1, Math.floor(r * COMIDA_REGALADA.length))] : null;
  return { tipo, pesos: montoDe(tipo, def, { calidad: contexto.calidad, r, r2 }), item };
}

/** Valor esperado de un carro en pesos (para el balance y sus pruebas). */
export function valorEsperado(contexto, def) {
  const w = pesosReaccion({ ...contexto, id: def.id });
  if (!w) return 0;
  const q = contexto.calidad ?? .5;
  const paga = montoDe('paga', def, { calidad: q, r: .5 });
  const propina = def.consume ? PROPINA.dulce
    : PROPINA.probBillete * PROPINA.billete + (1 - PROPINA.probBillete) * (PROPINA.min + PROPINA.max) / 2;
  return (w.paga ?? 0) * paga + (w.compra ?? 0) * (def.paga?.[0] ?? 0) + (w.propina ?? 0) * propina;
}
