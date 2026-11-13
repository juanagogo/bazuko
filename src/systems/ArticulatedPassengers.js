// src/systems/ArticulatedPassengers.js
// Pasajeros del bus articulado de la estación: las mismas personas reales de la calle (PeoplePool) sentadas en sus asientos
// y de pie en el pasillo, colgando del grupo del bus para que se muevan con él. Solo los buses a menos de NEAR de la cámara
// llevan gente (el más cercano más llena); al alejarse, todas vuelven al grupo.
import { PASSENGER_SLOTS, BUS_FLOOR } from '../world/bogota/BusBody.js';
import { loadBase } from './BusPassengers.js';

export const NEAR = 40;
export const FILL = [16, 6];     // gente real por puesto de cercanía
export const OPS_PER_FRAME = 6;
const WAITING = ['bolsillos', 'celular', 'brazos-cruzados', 'manos-atras', 'hablar'];

const mulberry = seed => () => {
  seed = seed + 0x6d2b79f5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

let cached = null;
/** Los puestos del articulado en el orden en que se llenan: asientos primero, luego el pasillo, siempre iguales. */
export function articulatedSlots() {
  const sections = PASSENGER_SLOTS.filter(Boolean);
  if (!sections.length) return [];
  if (cached && cached.sections === sections.length) return cached.list;
  const rnd = mulberry(5), seats = [], standing = [];
  for (const { seats: chairs, first, last, doors } of sections) {
    for (const [x, z] of chairs) seats.push({ kind: 'seat', x: x + (x < 0 ? .02 : -.02), z: z + .12, yaw: 0, stance: 'banca' });
    for (let z = first + .3; z <= last; z += .8) {
      if (doors.some(c => Math.abs(z - c) < .9)) continue;
      for (const x of [-.05, .42]) standing.push({ kind: 'stand', x: x + (rnd() - .5) * .1, z: z + (rnd() - .5) * .25, yaw: rnd() < .5 ? 0 : Math.PI + (rnd() - .5) * .8, stance: rnd() < .45 ? 'agarrado' : WAITING[Math.floor(rnd() * WAITING.length)] });
    }
  }
  const shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  const list = [...shuffle(seats), ...shuffle(standing)];
  cached = { sections: sections.length, list };
  return list;
}

export class ArticulatedPassengers {
  /** @param {import('./PeoplePool.js').PeoplePool} pool */
  constructor(pool) {
    this.pool = pool;
    this.stats = { buses: 0, people: 0 };
    this._held = new Map();   // bus -> personas prestadas
    this._pos = { x: 0, z: 0 };
  }

  _fill(bus, target, slots) {
    const crowd = this._held.get(bus) ?? [];
    this._held.set(bus, crowd);
    while (crowd.length > target) { this.pool.release(crowd.pop()); this._ops++; }
    while (crowd.length < target && this._ops < OPS_PER_FRAME) {
      const figure = this.pool.acquire();
      if (!figure) break;
      const slot = slots[crowd.length];
      this.pool.pose(figure, { stance: slot.stance });
      bus.group.add(figure.group);
      figure.group.position.set(slot.x, BUS_FLOOR, slot.z);
      figure.group.rotation.set(0, slot.yaw, 0);
      crowd.push(figure);
      this._ops++;
    }
    return crowd.length;
  }

  /** `buses`: los BusService del distrito (cada uno con su `group`). */
  update(buses, cameraPosition, hour) {
    this._ops = 0;
    const slots = articulatedSlots(), near = [];
    if (cameraPosition && Number.isFinite(hour) && slots.length) {
      for (const bus of buses ?? []) {
        const g = bus.group, d2 = (g.position.x - cameraPosition.x) ** 2 + (g.position.z - cameraPosition.z) ** 2;
        if (g.visible !== false && d2 < NEAR * NEAR) near.push({ bus, d2 });
      }
      near.sort((a, b) => a.d2 - b.d2);
    }
    for (const bus of [...this._held.keys()]) if (!near.some(n => n.bus === bus)) { this._fill(bus, 0, slots); this._held.delete(bus); }
    let people = 0;
    near.forEach(({ bus }, rank) => {
      const want = Math.round(Math.min(FILL[Math.min(rank, FILL.length - 1)], slots.length) * Math.min(1, .35 + loadBase(hour) * .75));
      people += this._fill(bus, want, slots);
    });
    this.stats.buses = near.length; this.stats.people = people;
    return near.length;
  }

  dispose() { for (const bus of [...this._held.keys()]) this._fill(bus, 0, []); this._held.clear(); }
}
