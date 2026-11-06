// src/systems/StationCrowd.js
// Fila interminable de gente esperando en el andén de la estación, de borde a borde, de cara a la calzada: más en la hora
// pico, casi vacía de noche. Es un PersonBatch estático (dos llamadas de dibujo); solo se arma al acercarse la cámara y
// se vuelve a armar únicamente cuando cambia la densidad. Lejos de la estación no cuesta nada.
import { PersonBatch, SKIN, SHIRTS, PANTS, HAIR } from './PersonBatch.js';
import { drawPerson } from './BusPassengers.js';
import { TERMINAL } from '../world/bogota/TransitTerminal.js';

export const NEAR = 120;
export const Z0 = -50, Z1 = -10;
const FILES = [73.5, 74.0, 74.5, 75.0, 75.5, 76.0, 76.5], STEP = .56;
export const SLOT_COUNT = FILES.length * (Math.floor((Z1 - Z0) / STEP) + 1);
const LEVELS = 20;

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

/** Todos los puestos posibles con su turno (0..1): con densidad d se ocupan los de turno menor que d. */
export function buildSlots(seed = 71) {
  const rnd = mulberry(seed), slots = [];
  for (const file of FILES) for (let z = Z0; z <= Z1 + 1e-6; z += STEP) {
    const x = file + (rnd() - .5) * .2, zz = z + (rnd() - .5) * .3, west = file < 75 || (file === 75 && rnd() < .5);
    slots.push({
      x, z: zz, y: 0, legs: true, kind: 'wait', phase: 0,
      // De cara a la calzada que les toca; algunos miran a lo largo de la fila o hacia el bus que llega.
      yaw: rnd() < .8 ? (west ? Math.PI : 0) : pick([Math.PI / 2, -Math.PI / 2], rnd),
      turn: rnd(),
      shirt: pick(SHIRTS, rnd), pants: pick(PANTS, rnd), skin: pick(SKIN, rnd), hair: pick(HAIR, rnd),
      pack: rnd() < .35 ? pick(SHIRTS, rnd) : null, arm: false,
    });
  }
  return slots;
}

export class StationCrowd {
  constructor(scene) {
    this.batch = new PersonBatch(scene, { people: SLOT_COUNT, name: 'Gente de la estación' });
    this.slots = null;
    this.level = -1;
    this.people = 0;
    this._frame = { x: 0, y: TERMINAL.platformY, z: 0, yaw: 0, c: 1, s: 0 };
  }

  /** `active` es falso donde no hay estación. Devuelve cuántas personas se dibujan. */
  update(cameraPosition, hour, active = true) {
    const near = active && cameraPosition && Number.isFinite(hour) &&
      Math.hypot(cameraPosition.x - TERMINAL.x, cameraPosition.z - TERMINAL.z) < NEAR;
    if (!near) { if (this.batch.root.visible) { this.batch.begin(); this.batch.end(); this.level = -1; this.people = 0; } return 0; }
    const level = Math.round(Math.min(1, Math.max(0, platformDensity(hour))) * LEVELS);
    if (level === this.level) return this.people;
    this.level = level;
    this.slots ??= buildSlots();
    const density = level / LEVELS, batch = this.batch;
    batch.begin();
    let people = 0;
    for (const slot of this.slots) {
      if (slot.turn >= density) continue;
      drawPerson(batch, this._frame, slot, 0);
      people++;
    }
    batch.end();
    return this.people = people;
  }

  dispose() { this.batch.dispose(); }
}
