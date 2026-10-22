// src/systems/InventorySystem.js
import { INVENTORY_MAX_WEIGHT } from '../utils/constants.js';
import { ITEMS } from '../data/items.js';

export class InventorySystem {
  constructor(maxWeight = INVENTORY_MAX_WEIGHT) {
    this.items = []; // [{ id, name, weight, value, qty, rare? }]
    this.maxWeight = maxWeight;
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

  add(item, qty = 1) {
    if (!item) return false;
    if (this.totalWeight + item.weight * qty > this.maxWeight) return false;

    const existing = this.items.find((i) => i.id === item.id);
    if (existing) {
      existing.qty += qty;
    } else {
      this.items.push({ ...item, qty });
    }
    return true;
  }

  remove(itemId, qty = 1) {
    const idx = this.items.findIndex((x) => x.id === itemId);
    if (idx === -1) return false;

    this.items[idx].qty -= qty;
    if (this.items[idx].qty <= 0) this.items.splice(idx, 1);
    return true;
  }

  count(itemId) {
    return this.items.find((i) => i.id === itemId)?.qty ?? 0;
  }

  /** Vacía el inventario sin devolver valor. */
  clear() {
    this.items = [];
  }

  /** Vacía y devuelve el dinero total */
  sellAll(priceMultiplier = 1) {
    const total = this.items.reduce(
      (s, i) => s + i.value * i.qty * priceMultiplier,
      0
    );
    this.items = [];
    return Math.round(total);
  }

  serialize() { return { items: this.items }; }
  // Refresca cada objeto con el catálogo actual (precios y efectos pueden haber cambiado)
  deserialize(d) {
    this.items = (d.items ?? []).map((i) => (ITEMS[i.id] ? { ...ITEMS[i.id], qty: i.qty } : i));
  }
}