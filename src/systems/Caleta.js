// src/systems/Caleta.js
// La caleta: un hueco escondido en el cambuche para guardar lo que no quiero cargar. Cabe más cuanto más
// armado esté el cambuche, y lo que hay adentro se queda aunque me muera, me detengan o me roben el costal.
// Solo sin paredes, durmiendo de noche, hay una probabilidad pequeña de que alguien la encuentre.
import { ITEMS } from '../data/items.js';

/** Kilos que suma cada pieza del cambuche. Sin base no hay caleta. */
export const CALETA_KG = { base: 6, techo: 3, paredes: 8, cama: 3, fogon: 2, vela: 1 };
/** Sin paredes, de cada robo nocturno esta es la probabilidad de que también encuentren la caleta. */
export const CALETA_ROBO_PROB = 0.25;
/** Y lo que se llevan de ella cuando la encuentran. */
export const CALETA_ROBO_FRACCION = 0.5;

const round2 = (n) => Math.round(n * 100) / 100;

export class Caleta {
  constructor() {
    this.items = []; // [{ id, qty, vence?, usos? }]
  }

  /** Kilos que caben con lo que hay armado. */
  capacity(built = {}) {
    if (!built.base) return 0;
    return Object.entries(CALETA_KG).reduce((kg, [pieza, extra]) => kg + (built[pieza] ? extra : 0), 0);
  }

  get weight() {
    return round2(this.items.reduce((kg, e) => kg + (ITEMS[e.id]?.weight ?? 0) * e.qty, 0));
  }

  count(id) { return this.items.find((e) => e.id === id)?.qty ?? 0; }

  /** Cuántas unidades de `id` caben ahora mismo. */
  room(id, built) {
    const w = ITEMS[id]?.weight ?? 0;
    const free = this.capacity(built) - this.weight;
    if (w <= 0) return free >= 0 && this.capacity(built) > 0 ? Infinity : 0;
    return Math.max(0, Math.floor((free + 1e-6) / w));
  }

  /**
   * Pasa `qty` unidades del costal a la caleta. Devuelve cuántas pasaron (0 si no cabe nada).
   * Lo que se pudre o se gasta (vencimientos y usos del arma) viaja con la unidad.
   */
  store(inventory, id, qty, built) {
    const n = Math.min(qty, inventory.count(id), this.room(id, built));
    if (n <= 0) return 0;
    const from = inventory.items.find((e) => e.id === id);
    // Se copian antes: `remove` ya descarta del costal los vencimientos más viejos y el desgaste.
    const lots = { vence: from?.vence?.slice(0, n), usos: from?.usos };
    inventory.remove(id, n);
    let entry = this.items.find((e) => e.id === id);
    if (!entry) this.items.push(entry = { id, qty: 0 });
    entry.qty += n;
    mergeLots(entry, lots);
    return n;
  }

  /** Pasa de la caleta al costal lo que quepa. Devuelve cuántas pasaron. */
  take(inventory, id, qty) {
    const entry = this.items.find((e) => e.id === id);
    const item = ITEMS[id];
    if (!entry || !item) return 0;
    const free = inventory.maxWeight - inventory.totalWeight;
    const fits = item.weight > 0 ? Math.floor((free + 1e-6) / item.weight) : Infinity;
    const n = Math.min(qty, entry.qty, fits);
    if (n <= 0) return 0;
    const lots = takeLots(entry, n);
    entry.qty -= n;
    if (entry.qty <= 0) this.items.splice(this.items.indexOf(entry), 1);
    const before = inventory.count(id);
    inventory.add(item, n, { vence: lots.vence });
    const dest = inventory.items.find((e) => e.id === id);
    if (dest && typeof lots.usos === 'number' && before <= 0) dest.usos = lots.usos;
    return n;
  }

  /** Robo nocturno sin paredes: a veces dan con la caleta y se llevan la mitad. Devuelve lo perdido. */
  robOnSleep(random = Math.random) {
    if (!this.items.length || random() >= CALETA_ROBO_PROB) return [];
    const lost = [];
    for (const entry of [...this.items]) {
      const n = Math.ceil(entry.qty * CALETA_ROBO_FRACCION);
      takeLots(entry, n);
      entry.qty -= n;
      lost.push({ id: entry.id, qty: n });
      if (entry.qty <= 0) this.items.splice(this.items.indexOf(entry), 1);
    }
    return lost;
  }

  serialize() { return { items: this.items.map((e) => ({ ...e })) }; }

  deserialize(data) {
    this.items = (data?.items ?? [])
      .filter((e) => ITEMS[e?.id] && e.qty > 0)
      .map((e) => ({ ...e, qty: Math.floor(e.qty) }));
  }
}

// Cada unidad perecible lleva su hora de vencimiento y cada arma sus usos: al mover unidades se mueven las más viejas.
function takeLots(entry, n) {
  if (!entry) return {};
  const out = {};
  if (Array.isArray(entry.vence)) out.vence = entry.vence.splice(0, n);
  if (typeof entry.usos === 'number') out.usos = entry.usos;
  return out;
}

function mergeLots(entry, lots) {
  if (lots.vence?.length) {
    entry.vence = [...(entry.vence ?? []), ...lots.vence].sort((a, b) => a - b);
  }
  // El arma desgastada que llega queda encima solo si no había otra en uso.
  if (typeof lots.usos === 'number' && typeof entry.usos !== 'number') entry.usos = lots.usos;
}
