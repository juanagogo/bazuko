// src/systems/ZorraSystem.js
// Estado de la zorra del jugador y reglas puras de capacidad, velocidad y compra.

import { ZORRA } from '../data/zorra.js';
import { originEffect } from '../data/origins.js';

const ESTADOS = ['none', 'pushing', 'dropped'];
const EPSILON = 1e-9;

const posValida = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

export class ZorraSystem {
  constructor() {
    this.estado = 'none';
    this.pos = null;
    this.rot = 0;
  }

  get empujando() { return this.estado === 'pushing'; }

  tieneZorra() { return this.estado !== 'none'; }

  /** Kilos extra de capacidad: solo mientras se empuja */
  bonoPeso() { return this.empujando ? ZORRA.bonoPeso : 0; }

  obtener() {
    if (this.tieneZorra()) return false;
    this.estado = 'pushing';
    return true;
  }

  soltar(pos, rot) {
    if (!this.empujando) return false;
    this.estado = 'dropped';
    this.pos = [...pos];
    this.rot = rot;
    return true;
  }

  agarrar() {
    if (this.estado !== 'dropped') return false;
    this.estado = 'pushing';
    this.pos = null;
    return true;
  }

  serialize() {
    return { state: this.estado, pos: this.pos ? [...this.pos] : null, rot: this.rot };
  }

  deserialize(d) {
    const estado = ESTADOS.includes(d?.state) ? d.state : 'none';
    this.rot = Number.isFinite(d?.rot) ? d.rot : 0;
    this.pos = null;
    this.estado = estado;
    if (estado === 'dropped') {
      if (posValida(d.pos)) this.pos = [...d.pos];
      else this.estado = 'pushing'; // no perder una zorra comprada
    }
  }
}

export function movimientoJugador({ empujando = false, sobrepeso = false, forcejeando = false } = {}) {
  const mult = sobrepeso || forcejeando ? 0 : (empujando ? ZORRA.multVelocidad : 1);
  return { mult, puedeCorrer: !empujando && mult > 0 };
}

export function haySobrepeso(totalWeight, maxWeight) {
  return totalWeight > maxWeight + EPSILON;
}

export function precioZorra(originId) {
  return Math.round(ZORRA.precio * originEffect(originId, 'zorraDiscount', 1));
}

export function ofertaZorra({ dinero, tieneZorra, originId }) {
  const precio = precioZorra(originId);
  if (tieneZorra) return { precio, disponible: false, motivo: 'tiene' };
  if (dinero < precio) return { precio, disponible: false, motivo: 'dinero' };
  return { precio, disponible: true, motivo: null };
}

/** Unidades a quitar, de a una desde el objeto más pesado, hasta que quepa. No modifica `items`. */
export function objetosADescartar(items, capacidad) {
  const restantes = items.map((i) => ({ id: i.id, weight: i.weight, qty: i.qty }));
  let total = restantes.reduce((s, i) => s + i.weight * i.qty, 0);
  const quitados = new Map();
  while (total > capacidad + EPSILON) {
    const pesado = restantes
      .filter((i) => i.qty > 0)
      .reduce((m, i) => (!m || i.weight > m.weight ? i : m), null);
    if (!pesado) break;
    pesado.qty -= 1;
    total -= pesado.weight;
    quitados.set(pesado.id, (quitados.get(pesado.id) ?? 0) + 1);
  }
  return [...quitados];
}
