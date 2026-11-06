// src/data/encargos.js
// Encargos: lo que sigue después de la cadena de la primera hora. Uno a la vez, sin fin, cada uno sale de una
// plantilla con su cantidad y paga más con la racha. Mismos campos que los objetivos (ver objectives.js): título en
// infinitivo, pista en primera persona, y `event`, `progress` o `done` para cumplirse.
import { cop } from '../utils/money.js';

const count = (game, id) => game.inventory?.count?.(id) ?? 0;

/** Lo que paga un encargo: crece un 25 % por cada uno seguido, hasta el doble y medio. */
export function pagoDeEncargo(base, racha) {
  return Math.round(base * (1 + .25 * Math.min(6, Math.max(0, racha))) / 100) * 100;
}

/**
 * Cada plantilla recibe `n` (la cantidad ya elegida) y `base` (lo que valía el contador al empezar, para los que
 * cuentan desde el estado del juego). `rango` da la cantidad mínima y máxima; `pago` es la recompensa sin racha.
 */
export const ENCARGOS = {
  reciclar: {
    rango: [2, 4], pago: 2500, xp: 25,
    hacer: (n) => ({
      title: `Vender material ${n} veces`,
      hint: 'Llevo latas, botellas, chatarra o cable a la recicladora.',
      target: 'sell', event: 'sell', goal: n,
    }),
  },
  latas: {
    rango: [8, 16], pago: 3000, xp: 25,
    hacer: (n, base) => ({
      title: `Juntar ${n} latas`,
      hint: 'Las latas salen de bolsas y canecas. Cuento las que tengo en el costal.',
      goal: n, progress: (g) => count(g, 'lata') - base,
    }),
  },
  botellas: {
    rango: [5, 10], pago: 3000, xp: 25,
    hacer: (n, base) => ({
      title: `Juntar ${n} botellas`,
      hint: 'Reviso la basura de los parques y las esquinas.',
      goal: n, progress: (g) => count(g, 'botella') - base,
    }),
  },
  ahorrar: {
    rango: [5000, 15000], paso: 1000, pago: 2000, xp: 30,
    hacer: (n, base) => ({
      title: `Ganar ${cop(n)}`,
      hint: 'Reciclo, pido limosna con B o vendo lo que encuentro.',
      goal: n, progress: (g) => (g.stats?.dinero ?? 0) + (g.caleta?.plata ?? 0) - base, money: true,
    }),
  },
  fabricar: {
    rango: [1, 2], pago: 3500, xp: 30,
    hacer: (n) => ({
      title: n > 1 ? `Fabricar ${n} cosas` : 'Fabricar algo',
      hint: 'Con C abro la mesa y armo una receta con lo que llevo.',
      event: 'craft', goal: n,
    }),
  },
  carro: {
    rango: [1, 1], pago: 6000, xp: 50,
    hacer: () => ({
      title: 'Robar un carro',
      hint: 'Junto a un carro parqueado o detenido en el semáforo, oprimo Y. Mejor sin testigos.',
      event: 'carjack', goal: 1,
    }),
  },
  despistar: {
    rango: [1, 1], pago: 8000, xp: 60,
    hacer: () => ({
      title: 'Despistar a una patrulla',
      hint: 'Si me persiguen, me pierdo detrás de un muro o me meto al cambuche.',
      // Una patrulla que se quedó trancada en el tráfico no la despistó él.
      event: 'police-escaped', accept: (d) => d?.reason !== 'trancada', goal: 1,
    }),
  },
};

export const TIPOS_DE_ENCARGO = Object.keys(ENCARGOS);

/** Los eventos de window que algún encargo cuenta. */
export const EVENTOS_DE_ENCARGO = [...new Set(TIPOS_DE_ENCARGO.map((t) => ENCARGOS[t].hacer(1, 0).event).filter(Boolean))];
