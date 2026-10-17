// src/systems/InventorySystem.js
// Inventario por casillas (apilables) con límite de peso.
// - slots: array fijo; cada casilla es null o { id, qty }
// - los datos del item (nombre, peso, valor...) se leen siempre de ITEMS
import { INVENTORY_MAX_WEIGHT, INVENTORY_SLOTS, HOTBAR_SLOTS } from '../utils/constants.js';
import { ITEMS, getStackMax, isUsable } from '../data/items.js';

const EPS = 1e-6;

export class InventorySystem {
  constructor(maxWeight = INVENTORY_MAX_WEIGHT, slotCount = INVENTORY_SLOTS) {
    this.slotCount = slotCount;
    this.slots = new Array(slotCount).fill(null);
    this.hotbar = new Array(HOTBAR_SLOTS).fill(null); // ids de item asignados a teclas 1-5
    this._maxWeight = maxWeight;

    this.version = 0;      // sube con cada cambio (la UI compara en vez de reconstruir)
    this._listeners = new Set();
    this._dirty = true;    // cachés de peso/cantidad/lista
    this._weight = 0;
    this._count = 0;
    this._items = [];
  }

  // ===== Cambios / eventos =====

  /** Suscribe un callback de cambio. Devuelve la función para cancelar. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _changed() {
    this.version++;
    this._dirty = true;
    for (const fn of this._listeners) fn(this);
  }

  // ===== Capacidad =====

  get maxWeight() { return this._maxWeight; }
  set maxWeight(v) {
    if (v === this._maxWeight) return; // game.js lo asigna cada frame: solo notifica si cambia
    this._maxWeight = v;
    this._changed();
  }

  _refresh() {
    if (!this._dirty) return;
    this._dirty = false;
    // Lista agregada por id (compat. con dealer/interacción que leen `items`)
    const byId = new Map();
    let w = 0, c = 0;
    for (const s of this.slots) {
      if (!s) continue;
      const def = ITEMS[s.id];
      w += (def?.weight ?? 0) * s.qty;
      c += s.qty;
      const e = byId.get(s.id);
      if (e) e.qty += s.qty;
      else byId.set(s.id, { ...def, id: s.id, qty: s.qty });
    }
    this._weight = w;
    this._count = c;
    this._items = Array.from(byId.values());
  }

  get totalWeight() { this._refresh(); return this._weight; }
  get itemCount() { this._refresh(); return this._count; }
  /** Lista agregada [{ id, name, weight, value, qty, ... }] (solo lectura) */
  get items() { this._refresh(); return this._items; }

  get usedSlots() {
    let n = 0;
    for (const s of this.slots) if (s) n++;
    return n;
  }

  /** Unidades de `item` que aún caben (peso, casillas libres y stacks parciales) */
  maxAddable(item) {
    const def = ITEMS[item?.id];
    if (!def) return 0;
    const stackMax = getStackMax(def);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += stackMax;
      else if (s.id === def.id) room += stackMax - s.qty;
    }
    const byWeight = def.weight > 0
      ? Math.floor((this._maxWeight - this.totalWeight + EPS) / def.weight)
      : room;
    return Math.max(0, Math.min(room, byWeight));
  }

  canAdd(item, qty = 1) { return this.maxAddable(item) >= qty; }

  /** Sin espacio para casi nada (peso o casillas) */
  get isFull() {
    if (this.totalWeight >= this._maxWeight - EPS) return true;
    return this.slots.every((s) => s && s.qty >= getStackMax(ITEMS[s.id]));
  }

  // ===== Operaciones =====

  /** Añade todo o nada. Devuelve true si cupo. */
  add(item, qty = 1) {
    if (!item || qty <= 0 || !this.canAdd(item, qty)) return false;
    this._place(item.id, qty);
    this._autoBind(item.id);
    this._changed();
    return true;
  }

  // Reparte en stacks existentes y luego casillas libres (asume que cabe)
  _place(id, qty) {
    const stackMax = getStackMax(ITEMS[id]);
    for (const s of this.slots) {
      if (qty <= 0) return;
      if (s && s.id === id && s.qty < stackMax) {
        const n = Math.min(qty, stackMax - s.qty);
        s.qty += n; qty -= n;
      }
    }
    for (let i = 0; i < this.slots.length && qty > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(qty, stackMax);
        this.slots[i] = { id, qty: n };
        qty -= n;
      }
    }
    return qty; // sobrante (0 si cupo todo)
  }

  /** Quita hasta `qty` unidades de un id (empieza por el último stack). */
  remove(itemId, qty = 1) {
    let left = qty;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== itemId) continue;
      const n = Math.min(left, s.qty);
      s.qty -= n; left -= n;
      if (s.qty <= 0) this.slots[i] = null;
    }
    if (left === qty) return false;
    this._changed();
    return true;
  }

  /** Quita de una casilla concreta. Devuelve unidades quitadas. */
  removeAt(index, qty = 1) {
    const s = this.slots[index];
    if (!s) return 0;
    const n = Math.min(qty, s.qty);
    s.qty -= n;
    if (s.qty <= 0) this.slots[index] = null;
    this._changed();
    return n;
  }

  count(itemId) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === itemId) n += s.qty;
    return n;
  }

  /** Mueve/intercambia/fusiona casillas */
  moveSlot(from, to) {
    if (from === to || !this.slots[from] || to < 0 || to >= this.slotCount) return false;
    const a = this.slots[from], b = this.slots[to];
    if (b && b.id === a.id) {
      const n = Math.min(a.qty, getStackMax(ITEMS[a.id]) - b.qty);
      if (n > 0) {
        b.qty += n; a.qty -= n;
        if (a.qty <= 0) this.slots[from] = null;
      } else {
        this.slots[from] = b; this.slots[to] = a;
      }
    } else {
      this.slots[from] = b; this.slots[to] = a;
    }
    this._changed();
    return true;
  }

  /** Agrupa stacks y ordena: consumibles, curas, sustancias, resto por nombre, tesoros al final. */
  sort() {
    const totals = new Map();
    for (const s of this.slots) if (s) totals.set(s.id, (totals.get(s.id) ?? 0) + s.qty);
    const rank = (d) => d.cure ? 1 : d.substance ? 2 : d.consumable ? 0 : d.rare ? 4 : 3;
    const ids = Array.from(totals.keys()).sort((x, y) => {
      const dx = ITEMS[x], dy = ITEMS[y];
      return (rank(dx) - rank(dy)) || dx.name.localeCompare(dy.name, 'es');
    });
    this.slots.fill(null);
    for (const id of ids) this._place(id, totals.get(id));
    this._changed();
  }

  /** Vacía y devuelve el dinero total */
  sellAll(priceMultiplier = 1) {
    let total = 0;
    for (const s of this.slots) {
      if (s) total += (ITEMS[s.id]?.value ?? 0) * s.qty * priceMultiplier;
    }
    if (this.usedSlots > 0) {
      this.slots.fill(null);
      this._changed();
    }
    return Math.round(total);
  }

  // ===== Barra de acceso rápido =====

  bindHotbar(index, itemId) {
    if (index < 0 || index >= this.hotbar.length) return;
    if (itemId) for (let i = 0; i < this.hotbar.length; i++) if (this.hotbar[i] === itemId) this.hotbar[i] = null;
    this.hotbar[index] = itemId ?? null;
    this._changed();
  }

  // Asigna automáticamente consumibles nuevos a una tecla libre (o a una cuyo item se agotó)
  _autoBind(id) {
    const def = ITEMS[id];
    if (!isUsable(def) || def.substance || this.hotbar.includes(id)) return;
    let free = this.hotbar.indexOf(null);
    if (free < 0) free = this.hotbar.findIndex((h) => this.count(h) === 0);
    if (free >= 0) this.hotbar[free] = id;
  }

  /** Vacía todo el inventario (casillas y accesos rápidos). No toca el dinero (vive en stats). */
  clear() {
    this.slots.fill(null);
    this.hotbar.fill(null);
    this._changed();
  }

  // ===== Persistencia =====

  serialize() {
    return {
      v: 2,
      slots: this.slots.map((s) => (s ? { id: s.id, qty: s.qty } : null)),
      hotbar: this.hotbar.slice()
    };
  }

  /** Acepta formato v2 ({slots}) y el antiguo v1 ({items:[{id,qty,...}]}). Nunca lanza. */
  deserialize(d) {
    try {
      this.slots.fill(null);
      this.hotbar.fill(null);
      if (d && Array.isArray(d.slots)) {
        for (let i = 0; i < this.slotCount && i < d.slots.length; i++) {
          const s = d.slots[i];
          const def = s && ITEMS[s.id];
          const qty = Math.floor(Number(s?.qty));
          if (def && qty > 0) this.slots[i] = { id: s.id, qty: Math.min(qty, getStackMax(def)) };
        }
      } else if (d && Array.isArray(d.items)) {
        // Migración v1: sin límite de peso (no se pierde nada de la partida vieja)
        for (const it of d.items) {
          const qty = Math.floor(Number(it?.qty));
          if (ITEMS[it?.id] && qty > 0) this._place(it.id, qty);
        }
      }
      if (d && Array.isArray(d.hotbar)) {
        for (let i = 0; i < this.hotbar.length; i++) {
          const h = d.hotbar[i];
          if (typeof h === 'string' && ITEMS[h] && isUsable(ITEMS[h])) this.hotbar[i] = h;
        }
      } else {
        for (const s of this.slots) if (s) this._autoBind(s.id);
      }
    } catch (err) {
      console.warn('[Inventory] datos guardados inválidos, inventario vacío', err);
      this.slots.fill(null);
      this.hotbar.fill(null);
    }
    this._changed();
  }
}
