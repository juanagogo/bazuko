// src/systems/InventorySystem.js
import { INVENTORY_MAX_WEIGHT } from '../utils/constants.js';
import { ITEMS } from '../data/items.js';

export class InventorySystem {
  constructor(maxWeight = INVENTORY_MAX_WEIGHT) {
    this.items = []; // [{ id, name, weight, value, qty, rare? }]
    this.maxWeight = maxWeight;
    this.hotbar = Array(5).fill(null);
    this._listeners = new Set();
  }

  get slotCount() { return Math.max(20, Math.ceil(this.items.length / 5) * 5); }
  get usedSlots() { return this.items.length; }
  get slots() { return this.items; }
  onChange(callback) { this._listeners.add(callback); return () => this._listeners.delete(callback); }
  _notify() { for (const callback of this._listeners) callback(); }
  sort() { this.items.sort((a, b) => a.name.localeCompare(b.name, 'es')); this._notify(); }
  removeAt(index, quantity = 1) {
    const item = this.items[index];
    if (!item) return 0;
    const count = Math.min(quantity, item.qty);
    this.remove(item.id, count);
    return count;
  }
  bindHotbar(index, id) {
    if (index < 0 || index >= 5 || (id && !ITEMS[id])) return;
    this.hotbar[index] = id; this._notify();
  }

  get totalWeight() {
    return this.items.reduce((s, i) => s + i.weight * i.qty, 0);
  }

  get isFull() {
    return this.totalWeight >= this.maxWeight;
  }

  get itemCount() {
    return this.items.reduce((s, i) => s + i.qty, 0);
  }

  /**
   * `vence`: horas de juego en que se dañan las unidades que entran, si ya las traen (de la caleta).
   * Sin eso, lo perecible recibe su vencimiento con la hora de ahora (`now`, que pone el juego).
   * `force`: entra aunque no quepa, para lo que reemplaza algo que ya iba en el costal (la comida que se daña).
   */
  add(item, qty = 1, { vence = null, force = false } = {}) {
    if (!item) return false;
    if (!force && this.totalWeight + item.weight * qty > this.maxWeight) return false;

    let existing = this.items.find((i) => i.id === item.id);
    if (existing) {
      existing.qty += qty;
    } else {
      const { vence: _v, usos: _u, ...clean } = item;
      this.items.push(existing = { ...clean, qty });
    }
    const perece = ITEMS[item.id]?.perece;
    const now = this.now?.();
    if (perece && (vence?.length || typeof now === 'number')) {
      const lots = vence?.length ? vence.slice(0, qty) : [];
      while (lots.length < qty) lots.push(now + perece);
      existing.vence = [...(existing.vence ?? []), ...lots].sort((a, b) => a - b);
    }
    this._notify();
    return true;
  }

  /** Lo que sale primero es lo más viejo; un arma que sale se lleva su desgaste. */
  remove(itemId, qty = 1) {
    const idx = this.items.findIndex((x) => x.id === itemId);
    if (idx === -1) return false;

    const entry = this.items[idx];
    entry.qty -= qty;
    if (Array.isArray(entry.vence)) entry.vence.splice(0, Math.max(0, entry.vence.length - Math.max(0, entry.qty)));
    if (qty > 0 && 'usos' in entry) delete entry.usos;
    if (entry.qty <= 0) this.items.splice(idx, 1);
    this._notify();
    return true;
  }

  count(itemId) {
    return this.items.find((i) => i.id === itemId)?.qty ?? 0;
  }

  /** Vacía el inventario sin devolver valor. */
  clear() {
    this.items = [];
    this._notify();
  }

  /** Vacía y devuelve el dinero total */
  sellAll(priceMultiplier = 1) {
    const total = this.items.reduce(
      (s, i) => s + i.value * i.qty * priceMultiplier,
      0
    );
    this.items = [];
    this._notify();
    return Math.round(total);
  }

  serialize() { return { items: this.items, hotbar: this.hotbar }; }
  // Refresca cada objeto con el catálogo actual (precios y efectos pueden haber cambiado)
  deserialize(d) {
    this.items = (d.items ?? []).map((i) => {
      if (!ITEMS[i.id]) return i;
      const entry = { ...ITEMS[i.id], qty: i.qty };
      // Vencimientos y desgaste del arma: se guardan con el costal.
      if (Array.isArray(i.vence) && ITEMS[i.id].perece) entry.vence = i.vence.filter(Number.isFinite).slice(-i.qty);
      if (Number.isFinite(i.usos) && ITEMS[i.id].durabilidad) entry.usos = Math.min(i.usos, ITEMS[i.id].durabilidad);
      return entry;
    });
    this.hotbar = Array.from({ length: 5 }, (_, i) => ITEMS[d.hotbar?.[i]] ? d.hotbar[i] : null);
    this._notify();
  }
}
