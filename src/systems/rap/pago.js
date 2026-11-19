// src/systems/rap/pago.js
// Quién va en el vagón, cómo reacciona cada uno y cuánto da al final, según cómo me fue. Sin DOM ni audio.
// Un rap bueno deja en promedio unos $ 5.000, más que el pasaje; uno regular no alcanza ni para la mitad.

import { PASAJEROS } from '../../data/rapLetras.js';
import { cop } from '../../utils/money.js';

export const PAGO = {
  porNivel: {
    durisimo: { prob: 0.85, min: 600, max: 1800 },
    bien: { prob: 0.6, min: 300, max: 900 },
    regular: { prob: 0.3, min: 100, max: 400 },
    mal: { prob: 0.05, min: 100, max: 200 },
    bajado: { prob: 0, min: 0, max: 0 },
  },
  billete: 5000,       // el de corbata o la turista, si me luzco
  billeteProb: 0.35,
  malOlor: 0.5,        // con mal olor, la mitad de las ganas de dar
  maxProb: 0.97,
  pasajeros: 5,
};

/** Lo que cuesta rapear y lo que deja en el ánimo. */
export const EFECTOS_RAP = {
  energiaMin: 10,      // con menos no me da la voz
  energia: 6,
  sed: 6,
  animo: { durisimo: 8, bien: 4, regular: 0, mal: -4, bajado: -6, cancelado: -2 },
  xpPorPasajero: 3,
  minutosBajado: 12,   // lo que se demora llegar a pie desde la estación de antes
};

const redondear = (n) => Math.round(n / 100) * 100;
const unoDe = (lista, random) => lista[Math.floor(random() * lista.length) % lista.length];

/** Cinco pasajeros distintos al azar. */
export function elegirPasajeros(random = Math.random, n = PAGO.pasajeros, pool = PASAJEROS) {
  const bolsa = [...pool];
  for (let i = bolsa.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)) % (i + 1);
    [bolsa[i], bolsa[j]] = [bolsa[j], bolsa[i]];
  }
  return bolsa.slice(0, Math.min(n, bolsa.length));
}

/** Qué tan contento va cada uno mientras rimo (0 a 1): el flow de lo que va, movido por su gusto. */
export function interes(pasajero, flowParcial) {
  return Math.max(0, Math.min(1, 0.5 + (flowParcial - 0.5) * pasajero.gusto * 1.4));
}

/** Lo que hace mientras rimo: bueno desde la mitad de interés. */
export const gestoDurante = (pasajero, flowParcial) => pasajero.durante[interes(pasajero, flowParcial) >= 0.5 ? 'bueno' : 'malo'];

/** Lo que dice o hace al final, según si me dio algo. Si me bajaron, reacciona como si me hubiera ido mal. */
export function reaccion(pasajero, nivel, dio = false, random = Math.random) {
  const porNivel = pasajero.dichos[nivel === 'bajado' ? 'mal' : nivel] ?? pasajero.dichos.mal;
  return unoDe(porNivel[dio ? 'da' : 'nada'], random);
}

/**
 * Cobra el rap: cada pasajero decide por su cuenta. Todo en múltiplos de $ 100.
 * Devuelve { filas: [{ pasajero, dicho, pesos, billete }], total, pagaron }.
 */
export function cobrar({ pasajeros, nivel, malOlor = false, random = Math.random }) {
  const regla = PAGO.porNivel[nivel] ?? PAGO.porNivel.bajado;
  const filas = pasajeros.map((pasajero) => {
    const prob = Math.min(PAGO.maxProb, regla.prob * pasajero.gusto * (malOlor ? PAGO.malOlor : 1));
    let pesos = 0, billete = false;
    if (random() < prob) {
      if (pasajero.billete && nivel === 'durisimo' && random() < PAGO.billeteProb) {
        pesos = PAGO.billete;
        billete = true;
      } else {
        pesos = Math.max(100, redondear(regla.min + random() * (regla.max - regla.min)));
      }
    }
    // Primero se decide la plata y después qué dice: «Tome» solo sale si me dio.
    const dicho = reaccion(pasajero, nivel, pesos > 0, random);
    return { pasajero, dicho, pesos, billete };
  });
  const total = filas.reduce((s, f) => s + f.pesos, 0);
  return { filas, total, pagaron: filas.filter((f) => f.pesos > 0).length };
}

/** El texto del aviso que queda al llegar: lo que me hice, y una sola cosa más. */
export function avisoDelRap({ nivel, total, destino, minutos }) {
  if (nivel === 'cancelado') return `Llegué a ${destino} en ${minutos} min. Me dio pena y no rapeé.`;
  if (nivel === 'bajado') return `Me bajaron antes y llegué a pie a ${destino} en ${minutos} min.`;
  const plata = total > 0 ? `Rapeando en el vagón me hice ${cop(total)}.` : 'Rapeé en el vagón, pero nadie me dio nada.';
  return `Llegué a ${destino} en ${minutos} min. ${plata}`;
}
