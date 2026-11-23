import { CAMBUCHE } from '../data/cambuche.js';

/** Intercala nueve zonas para repartir las bolsas, incluso con mapas rectangulares. */
export function spreadPickupPositions(positions, width, height) {
  const zones = Array.from({ length: 9 }, () => []);
  for (const position of positions) {
    const x = Math.min(2, Math.max(0, Math.floor(position.x / width * 3)));
    const z = Math.min(2, Math.max(0, Math.floor(position.z / height * 3)));
    zones[z * 3 + x].push(position);
  }
  const result = [];
  while (result.length < positions.length) {
    for (const zone of zones) if (zone.length) result.push(zone.pop());
  }
  return result;
}

/** Reserva materiales para un cambuche completo en cada ciclo de basura. */
export function distributeShelterLoot(pickups, random = Math.random) {
  if (!pickups.length) return;
  const requirements = {};
  for (const piece of CAMBUCHE) for (const [id, quantity] of Object.entries(piece.req)) {
    requirements[id] = (requirements[id] ?? 0) + quantity;
  }
  const slots = [...pickups];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  for (const pickup of pickups) pickup.guaranteedLoot = [];
  let index = 0;
  for (const [id, quantity] of Object.entries(requirements)) {
    // Los comunes forman pequeños lotes; lona, colchón y vela ocupan una bolsa cada uno.
    const stack = ['carton', 'lata', 'madera'].includes(id) ? 2 : 1;
    for (let remaining = quantity; remaining > 0; remaining -= stack) {
      const pickup = slots[index++ % slots.length];
      for (let n = 0; n < Math.min(stack, remaining); n++) pickup.guaranteedLoot.push(id);
    }
  }
}

/**
 * Coloca exactamente una radioTransistor en la basura si el jugador aún no la ha encontrado.
 * Evita duplicados en respawns y preserva el botín único (Issue #19).
 */
export function distributeRadioLoot(pickups, hasRadio = false) {
  if (hasRadio || !pickups || !pickups.length) return;
  // Si ya hay un pickup con radioTransistor garantizado, no duplicar
  if (pickups.some((p) => p.guaranteedLoot?.includes('radioTransistor'))) return;
  // Asignar en un punto disponible
  const target = pickups[1 % pickups.length] ?? pickups[0];
  if (target) {
    target.guaranteedLoot ??= [];
    target.guaranteedLoot.push('radioTransistor');
  }
}
