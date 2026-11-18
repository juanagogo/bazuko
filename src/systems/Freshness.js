// src/systems/Freshness.js
// La comida de la calle se daña. Cada unidad perecible del costal lleva la hora de juego en que se daña
// (`vence`, la pone InventorySystem al entrar); al pasar esa hora la unidad se vuelve «Comida dañada».
// Lo que está en la caleta se daña igual: el tiempo no se detiene porque esté guardado.
import { ITEMS } from '../data/items.js';

/** Fracción de vida que le queda a la unidad más vieja de una fila: 1 recién comprada, 0 dañada. */
export function freshness(entry, now) {
  const perece = ITEMS[entry?.id]?.perece;
  if (!perece || !entry.vence?.length || typeof now !== 'number') return 1;
  return Math.max(0, Math.min(1, (entry.vence[0] - now) / perece));
}

/** Horas que le quedan a la unidad más vieja, o null si no se daña. */
export function hoursLeft(entry, now) {
  if (!ITEMS[entry?.id]?.perece || !entry.vence?.length || typeof now !== 'number') return null;
  return Math.max(0, entry.vence[0] - now);
}

/** «Se daña en 3 h», «Se daña ya», o null. */
export function freshnessLabel(entry, now) {
  const h = hoursLeft(entry, now);
  if (h === null) return null;
  if (h < 1) return 'Se daña ya';
  return `Se daña en ${Math.floor(h)} h`;
}

/**
 * Revisa una lista de filas (costal o caleta) y convierte lo vencido. Devuelve { id: unidades dañadas }.
 * `addSpoiled(qty)` recibe las unidades dañadas para ponerlas donde toca.
 */
export function spoilEntries(entries, now, { onRemove, addSpoiled }) {
  const spoiled = {};
  for (const entry of [...entries]) {
    const perece = ITEMS[entry.id]?.perece;
    if (!perece) continue;
    // Lo que entró sin hora (partidas viejas, pruebas) empieza a contar desde ahora.
    entry.vence ??= [];
    while (entry.vence.length < entry.qty) entry.vence.push(now + perece);
    let n = 0;
    while (n < entry.vence.length && entry.vence[n] <= now) n++;
    if (!n) continue;
    spoiled[entry.id] = n;
    onRemove(entry.id, n);
    addSpoiled(n);
  }
  return spoiled;
}

export class FreshnessSystem {
  /** @param {{ inventory, caleta?, now: () => number }} deps */
  constructor({ inventory, caleta = null, now }) {
    this.inventory = inventory;
    this.caleta = caleta;
    this.now = now;
    this._timer = 0;
    this._warned = new Set();
  }

  /** Cada dos segundos basta: una hora de juego son minutos reales. */
  update(dt) {
    this._timer += dt;
    if (this._timer < 2) return null;
    this._timer = 0;
    return this.check();
  }

  check() {
    const now = this.now();
    if (typeof now !== 'number') return null;
    const inv = this.inventory;
    const bag = spoilEntries(inv.items, now, {
      onRemove: (id, n) => inv.remove(id, n),
      // Lo dañado no pesa más que lo fresco que reemplaza: siempre cabe.
      addSpoiled: (n) => { inv.add(ITEMS.comidaDanada, n); },
    });
    const caleta = this.caleta;
    const stash = caleta ? spoilEntries(caleta.items, now, {
      onRemove: (id, n) => {
        const entry = caleta.items.find((e) => e.id === id);
        entry.vence.splice(0, n);
        entry.qty -= n;
        if (entry.qty <= 0) caleta.items.splice(caleta.items.indexOf(entry), 1);
      },
      addSpoiled: (n) => {
        let entry = caleta.items.find((e) => e.id === 'comidaDanada');
        if (!entry) caleta.items.push(entry = { id: 'comidaDanada', qty: 0 });
        entry.qty += n;
      },
    }) : {};
    // Un aviso antes de que se dañe lo del costal: una vez por fila y por vencimiento.
    const soon = [];
    for (const entry of inv.items) {
      const h = hoursLeft(entry, now);
      if (h === null || h > 1.5) continue;
      const key = `${entry.id}:${entry.vence[0]}`;
      if (this._warned.has(key)) continue;
      this._warned.add(key);
      soon.push(entry.name);
    }
    if (this._warned.size > 200) this._warned.clear();
    // La barra de frescura del costal se mueve con el reloj, no con lo que entra o sale: se avisa a la vista.
    if (inv.items.some((e) => ITEMS[e.id]?.perece)) inv._notify?.();
    return { bag, stash, soon };
  }
}
