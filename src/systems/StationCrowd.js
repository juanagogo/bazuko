// src/systems/StationCrowd.js
// Fila interminable de gente esperando en el andén de la estación, de borde a borde y de cara a la calzada: más en la hora
// pico, casi vacía de noche. Son personas reales de la calle (PeoplePool), posadas quietas; solo las más cercanas a la
// cámara (hasta CAP) y solo si la cámara está a menos de NEAR de la estación. Lejos no cuesta nada y todas vuelven al grupo.
import { TERMINAL } from '../world/bogota/TransitTerminal.js';

export const NEAR = 120;
export const CAP = 24;           // personas reales a la vez en el andén
export const OPS_PER_FRAME = 6;
export const Z0 = -50, Z1 = -10;
const FILES = [73.5, 74.0, 74.5, 75.0, 75.5, 76.0, 76.5], STEP = .56;
export const SLOT_COUNT = FILES.length * (Math.floor((Z1 - Z0) / (STEP * .45)) + 1);
const RESELECT = .6;             // s entre una y otra revisión de a quién prestarle gente
export const WAITING = ['bolsillos', 'celular', 'brazos-cruzados', 'manos-atras', 'hablar', 'telefono', 'cambiar-peso', 'bolsillos'];

// Cuánta gente hay en el andén según la hora: pico de 6 a 9 y de 17 a 20.
const CURVE = [[0, .04], [5, .06], [6, .6], [7.5, 1], [9, .8], [11, .45], [14, .5], [16, .65], [17.5, .95], [19, 1], [20.5, .5], [22, .15], [24, .04]];
export function platformDensity(hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < CURVE.length; i++) {
    const [h1, v1] = CURVE[i];
    if (h <= h1) { const [h0, v0] = CURVE[i - 1]; return v0 + (v1 - v0) * (h - h0) / (h1 - h0); }
  }
  return CURVE[CURVE.length - 1][1];
}

const mulberry = seed => () => {
  seed = seed + 0x6d2b79f5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];

/** Todos los puestos posibles con su turno (0..1): con densidad d se ocupan los de turno menor que d. Una fila floja e irregular, no una grilla. */
export function buildSlots(seed = 71) {
  const rnd = mulberry(seed), slots = [];
  for (const file of FILES) {
    // Cada fila avanza a pasos desiguales, y a ratos se amontona o deja un hueco.
    for (let z = Z0 + rnd() * .3; z <= Z1; z += STEP * (.45 + rnd() * .9)) {
      const x = file + (rnd() - .5) * .42, zz = z + (rnd() - .5) * .3, west = x < 75 || (x < 75.2 && rnd() < .5);
      const toward = west ? Math.PI : 0;
      slots.push({
        x, z: zz, y: 0, waiting: Math.floor(rnd() * WAITING.length),
        // De cara a la calzada que les toca, con desvío; algunos miran a lo largo de la fila o a cualquier lado.
        yaw: rnd() < .72 ? toward + (rnd() - .5) * .9 : rnd() < .6 ? pick([Math.PI / 2, -Math.PI / 2], rnd) + (rnd() - .5) * .6 : rnd() * Math.PI * 2,
        turn: rnd()
      });
    }
  }
  return slots;
}

export class StationCrowd {
  /** @param {import('./PeoplePool.js').PeoplePool} pool */
  constructor(scene, pool) {
    this.pool = pool;
    this.slots = null;
    this.held = new Map();   // índice de puesto -> persona prestada
    this.people = 0;
    this._wanted = null;
    this._timer = 0;
  }

  _release(index) {
    this.pool.release(this.held.get(index));
    this.held.delete(index);
  }

  /** Los puestos de turno bajo la densidad más cercanos a la cámara: CAP de gente a tope de densidad, menos en las otras horas. */
  _choose(cameraPosition, density) {
    const slots = this.slots, dist = i => (slots[i].x - cameraPosition.x) ** 2 + (slots[i].z - cameraPosition.z) ** 2, list = [];
    for (let i = 0; i < slots.length; i++) if (slots[i].turn < density) list.push(i);
    list.sort((a, b) => dist(a) - dist(b));
    return new Set(list.slice(0, Math.max(1, Math.round(CAP * density))));
  }

  /** `active` es falso donde no hay estación. Devuelve cuántas personas se ven. */
  update(cameraPosition, hour, active = true, dt = 0) {
    const near = active && cameraPosition && Number.isFinite(hour) &&
      Math.hypot(cameraPosition.x - TERMINAL.x, cameraPosition.z - TERMINAL.z) < NEAR;
    if (!near) {
      if (this.held.size) { for (const i of [...this.held.keys()]) this._release(i); this._wanted = null; this.people = 0; }
      return 0;
    }
    this.slots ??= buildSlots();
    this._timer -= dt;
    if (!this._wanted || this._timer <= 0) {
      this._timer = RESELECT;
      this._wanted = this._choose(cameraPosition, Math.min(1, Math.max(0, platformDensity(hour))));
    }
    let ops = 0;
    for (const i of [...this.held.keys()]) if (!this._wanted.has(i)) { this._release(i); ops++; }
    for (const i of this._wanted) {
      if (ops >= OPS_PER_FRAME) break;
      if (this.held.has(i)) continue;
      const figure = this.pool.acquire();
      if (!figure) break;
      const slot = this.slots[i], g = figure.group;
      this.pool.pose(figure, { stance: WAITING[slot.waiting] });
      g.position.set(slot.x, TERMINAL.platformY + slot.y, slot.z);
      g.rotation.y = slot.yaw + Math.PI / 2;
      this.held.set(i, figure);
      ops++;
    }
    return this.people = this.held.size;
  }

  dispose() { for (const i of [...this.held.keys()]) this._release(i); }
}
