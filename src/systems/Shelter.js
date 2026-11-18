// src/systems/Shelter.js
// El hogar de paso: una noche bajo techo, con ducha y comida caliente, a cambio de sus reglas.
// Se entra de 6 p. m. a 11 p. m., hay cupo casi todas las noches y no se entra con sustancias ni armas:
// las sustancias se entregan (no vuelven) y las armas se dejan en la portería hasta la mañana.
// Ahí no se roba a nadie, pero tampoco se consume: el vicio baja más que en el cambuche.
import { ITEMS } from '../data/items.js';

export const HOGAR = {
  abre: 18,
  cierra: 23,
  cupoProb: 0.75,   // noches con cupo
  energia: 70,
  salud: 25,
  higiene: 85,      // sale bañado: la higiene queda por lo menos en esto
  hambre: 45,
  sed: 45,
  animo: 10,
  vicio: 25,        // lo que baja el vicio en una noche sin consumir
};

/** ¿Está recibiendo gente a esta hora? */
export const isOpen = (hour) => hour >= HOGAR.abre && hour < HOGAR.cierra;

/** El cupo de una noche es siempre el mismo para ese día: volver a preguntar no lo cambia. */
export function hasRoom(day) {
  // Un hash pequeño y estable del día.
  let h = (day * 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h % 1000) / 1000 < HOGAR.cupoProb;
}

/** Lo que hay que entregar o dejar en la portería para poder entrar. */
export function contraband(inventory, equippedWeapon = null) {
  const sustancias = [], armas = [];
  for (const entry of inventory?.items ?? []) {
    const item = ITEMS[entry.id];
    if (!item) continue;
    if (item.substance) sustancias.push({ id: entry.id, qty: entry.qty, name: item.name });
    else if (item.weapon) armas.push({ id: entry.id, qty: entry.qty, name: item.name, usos: entry.usos, enMano: item.weapon === equippedWeapon });
  }
  return { sustancias, armas };
}

/**
 * Entra: entrega sustancias y deja armas en la portería. Devuelve lo que quedó guardado para devolverlo.
 * El juego se encarga de dormir y de las necesidades con `nightEffects`.
 */
export function checkIn(inventory, equippedWeapon = null) {
  const { sustancias, armas } = contraband(inventory, equippedWeapon);
  for (const s of sustancias) inventory.remove(s.id, s.qty);
  for (const a of armas) inventory.remove(a.id, a.qty);
  return { entregadas: sustancias, porteria: armas.map(({ id, qty, usos }) => ({ id, qty, usos })) };
}

/** Al salir, la portería devuelve las armas que quepan. Devuelve las que no cupieron. */
export function checkOut(inventory, porteria = []) {
  const quedan = [];
  for (const a of porteria) {
    const item = ITEMS[a.id];
    if (!item) continue;
    let dadas = 0;
    while (dadas < a.qty && inventory.add(item, 1)) dadas++;
    const entry = inventory.items.find((e) => e.id === a.id);
    if (entry && Number.isFinite(a.usos) && dadas > 0) entry.usos = a.usos;
    if (dadas < a.qty) quedan.push({ id: a.id, qty: a.qty - dadas, name: item.name });
  }
  return quedan;
}

/** Cómo cambian las necesidades tras una noche en el hogar. */
export function nightEffects(stats) {
  const up = (k, v) => { stats[k] = Math.min(100, (stats[k] ?? 0) + v); };
  up('energia', HOGAR.energia);
  up('salud', HOGAR.salud);
  up('hambre', HOGAR.hambre);
  up('sed', HOGAR.sed);
  up('animo', HOGAR.animo);
  stats.higiene = Math.max(stats.higiene ?? 0, HOGAR.higiene);
  stats.vicio = Math.max(0, (stats.vicio ?? 0) - HOGAR.vicio);
}
