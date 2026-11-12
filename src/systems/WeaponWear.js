// src/systems/WeaponWear.js
// Las armas hechas en la mesa se gastan: cada golpe que conecta le quita un uso al arma en la mano, y al
// llegar a cero se parte. Si hay otra igual en el costal, esa sale entera. Los puños no se gastan.
// El desgaste vive en la fila del costal (`usos`), así que se guarda con la partida y viaja a la caleta.
import { ITEMS } from '../data/items.js';

/** Por debajo de esta fracción el arma se ve y se avisa como gastada. */
export const WEAR_WARN = 0.25;

/** Usos que le quedan al arma de esa fila, o null si no se gasta. */
export function usesLeft(entry) {
  const max = ITEMS[entry?.id]?.durabilidad;
  if (!max) return null;
  return Number.isFinite(entry.usos) ? Math.max(0, Math.min(max, entry.usos)) : max;
}

/** Fracción de vida del arma de esa fila (1 nueva), o null si no se gasta. */
export function wearFraction(entry) {
  const left = usesLeft(entry);
  return left === null ? null : left / ITEMS[entry.id].durabilidad;
}

/**
 * Un golpe que conectó con el arma `weaponId`. Devuelve qué pasó:
 * `{ broke: true }` si se partió, `{ warn: true }` al cruzar el umbral de gastada, o `{}`.
 */
export function wearWeapon(inventory, weaponId) {
  const entry = inventory?.items?.find((e) => ITEMS[e.id]?.weapon === weaponId);
  if (!entry || !ITEMS[entry.id].durabilidad) return {};
  const max = ITEMS[entry.id].durabilidad;
  const before = usesLeft(entry);
  const after = before - 1;
  if (after <= 0) {
    inventory.remove(entry.id, 1); // `remove` le quita el desgaste: la siguiente sale entera
    return { broke: true, name: ITEMS[entry.id].name, left: inventory.count(entry.id) };
  }
  entry.usos = after;
  inventory._notify?.();
  const warn = before / max > WEAR_WARN && after / max <= WEAR_WARN;
  return warn ? { warn: true, name: ITEMS[entry.id].name } : {};
}
