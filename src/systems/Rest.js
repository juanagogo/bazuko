// Opciones de descanso fuera del cambuche. Los valores se muestran antes de dormir.
import { WITHDRAWAL } from '../utils/constants.js';
import { HOGAR, hasRoom, isOpen } from './Shelter.js';

export const RESIDENCIA = Object.freeze({
  precio: 8000, horas: 8, energia: 80, salud: 20, animo: 30,
  higiene: 25, hambre: -20, sed: -20,
});

export const BANCA = Object.freeze({
  precio: 0, horas: 3, energia: 25, salud: 0, animo: 5,
  higiene: -5, hambre: -10, sed: -10, roboProb: .25, roboDinero: .2,
});

/** Categoría y condiciones reales del descanso para los filtros del mapa. */
export function restMapInfo(type, { built = {}, hour = 0, day = 1 } = {}) {
  if (type === 'cambuche') return { type, price: 0, status: built.base ? 'ready' : 'build' };
  if (type === 'residencia') return { type, price: RESIDENCIA.precio, hours: RESIDENCIA.horas, status: 'ready' };
  return { type: 'refugio', price: 0, opens: HOGAR.abre, closes: HOGAR.cierra,
    status: !isOpen(hour) ? 'closed' : !hasRoom(day) ? 'full' : 'ready' };
}

export function restEffects(stats, option) {
  for (const key of ['energia', 'salud', 'animo', 'higiene', 'hambre', 'sed']) {
    stats[key] = Math.max(0, Math.min(100, (stats[key] ?? 0) + option[key]));
  }
  stats.vicio = Math.max(0, (stats.vicio ?? 0) - WITHDRAWAL.vicioDormir * option.horas / 8);
}

/** Dormir fuera no expone la caleta del cambuche ni hereda sus paredes. */
export function benchTheft(stats, random = Math.random) {
  if (random() >= BANCA.roboProb) return null;
  const lost = Math.floor(Math.max(0, stats.dinero ?? 0) * BANCA.roboDinero);
  stats.dinero -= lost;
  return lost;
}
