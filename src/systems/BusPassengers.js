// src/systems/BusPassengers.js
// Pasajeros de las busetas cercanas: sentados, de pie en el pasillo, colgados de la puerta y el cobrador asomado.
// Todos van en el mismo PersonBatch (dos llamadas de dibujo). Solo se arma gente para las busetas más cercanas a
// la cámara y a menos de NEAR metros; lejos no se toca ni una matriz, y el lote lejano ni siquiera lleva gente.
import * as THREE from 'three';
import { PersonBatch, SKIN, SHIRTS, PANTS, HAIR } from './PersonBatch.js';

export const MAX_BUSES = 8;      // busetas con pasajeros a la vez
export const NEAR = 30;          // metros a la cámara
export const SEATS = 24;         // seis filas de dos por lado
export const AISLE = 30;
export const PRESSED = 24;
export const FRONT = 6;
export const DOOR = 3;
export const CAPACITY = SEATS + AISLE + PRESSED + FRONT + DOOR;
export const PEOPLE_PER_BUS = CAPACITY + 1;
export const PACKED = .85;       // desde esta carga el bus va lleno hasta la puerta

const FLOOR = .92, SEAT_TOP = 1.25, STEP = .6;

// Carga de pasajeros por hora (0 vacío, 1 reventando): pico de 6 a 9 y de 17 a 20, medio vacío al mediodía, pocos de noche.
const LOAD_CURVE = [[0, .04], [4.5, .05], [5.5, .3], [6, .75], [7.5, 1], [9, .85], [10, .5], [12, .42], [14, .45], [16, .6], [17, .85], [18.5, 1], [20, .7], [21.5, .3], [23, .1], [24, .04]];

export function loadBase(hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < LOAD_CURVE.length; i++) {
    const [h1, v1] = LOAD_CURVE[i];
    if (h <= h1) { const [h0, v0] = LOAD_CURVE[i - 1], t = (h - h0) / (h1 - h0); return v0 + (v1 - v0) * t; }
  }
  return LOAD_CURVE[LOAD_CURVE.length - 1][1];
}

/** Carga de un bus concreto: la de la hora, más o menos según su suerte (0..1). */
export const loadFor = (hour, luck) => Math.min(1, Math.max(0, loadBase(hour) * (.5 + luck * .7)));

/** Cuántos pasajeros lleva con esa carga: de ahí arriba, hasta la puerta. */
export const headcount = load => load >= PACKED ? CAPACITY : Math.round(load * (CAPACITY - DOOR));

const mulberry = seed => () => {
  seed = seed + 0x6d2b79f5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];
const shuffle = (list, rnd) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
const windowOf = (x, side) => Math.min(5, Math.max(0, Math.floor((x + 3.46) / 1.18))) + (side > 0 ? 6 : 0);

function slots() {
  const seats = [], aisle = [], front = [], pressed = [];
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) for (const zz of [.4, .8]) seats.push({ kind: 'seat', x: -2.95 + i * .96 + .26, y: SEAT_TOP - .9 + .05, z: side * zz, yaw: 0, side });
  for (let i = 0; i < 10; i++) for (const z of [-.2, 0, .2]) aisle.push({ kind: 'stand', x: -3.1 + i * .5 + (z ? .12 : 0), y: FLOOR, z });
  // De pie en el hueco entre filas, pegados al vidrio.
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) for (const zz of [.55, .88]) pressed.push({ kind: 'stand', x: -2.95 + i * .96 + .72, y: FLOOR, z: side * zz });
  for (const [x, z] of [[2.5, .3], [2.5, .75], [2.95, .2], [2.95, .62], [3.3, .3], [3.3, .72]]) front.push({ kind: 'stand', x, y: FLOOR, z });
  const door = [[3.18, 1.15], [3.46, 1.14], [3.32, 1.27]].map(([x, z]) => ({ kind: 'door', x, y: STEP, z, yaw: -Math.PI / 2, legs: true }));
  return { seats, aisle, front, door, pressed };
}
const SLOTS = slots();

/** Los pasajeros posibles de una buseta, en el orden en que suben: sentados, pasillo, frente y puerta. Fijos por semilla. */
export function rosterOf(vehicle) {
  if (vehicle._roster) return vehicle._roster;
  const rnd = mulberry(vehicle.seed ?? 1), mask = vehicle.windowMask ?? 0;
  const look = () => ({ shirt: pick(SHIRTS, rnd), pants: pick(PANTS, rnd), skin: pick(SKIN, rnd), hair: pick(HAIR, rnd), phase: rnd() * 6.28 });
  const people = [];
  const add = (slot, extra = {}) => people.push({ legs: false, yaw: rnd() < .5 ? 0 : Math.PI, arm: false, ...slot, ...look(), ...extra });
  for (const s of shuffle(SLOTS.seats.slice(), rnd)) {
    const open = mask >> windowOf(s.x, s.side) & 1;
    add(s, { arm: open && rnd() < .4 ? { out: s.side } : false });
  }
  const standing = [...shuffle(SLOTS.aisle.slice(), rnd), ...shuffle(SLOTS.pressed.slice(), rnd), ...SLOTS.front];
  for (const s of standing) add(s, { yaw: pick([0, 0, Math.PI, Math.PI / 2, -Math.PI / 2], rnd), arm: rnd() < .6 ? { up: rnd() < .5 ? 1 : -1 } : false });
  for (const s of SLOTS.door) add(s, { arm: { up: 1 } });
  vehicle._roster = people;
  vehicle._cobrador = vehicle.livery?.old ? rnd() < .85 : rnd() < .3;
  vehicle._luck ??= rnd();
  return people;
}

const CAP = { x: 3.34, y: STEP, z: 1.3 };
const ARM_Q = new THREE.Quaternion(), AXIS_Z = new THREE.Vector3(0, 0, 1);

/** Dibuja una persona en el marco {x, y, z, yaw, c, s} (traslación y giro del bus). */
export function drawPerson(batch, f, p, time) {
  const bob = p.kind === 'stand' ? Math.sin(time * 1.6 + p.phase) * .012 : 0;
  const yaw = f.yaw + p.yaw, y0 = p.y + bob;
  // Local de la persona al mundo: primero el giro propio, luego el del bus.
  const at = (ox, oy, oz) => {
    const ca = Math.cos(p.yaw), sa = Math.sin(p.yaw);
    const lx = p.x + ox * ca + oz * sa, lz = p.z - ox * sa + oz * ca;
    return [f.x + lx * f.c + lz * f.s, f.y + oy, f.z - lx * f.s + lz * f.c];
  };
  const put = (ox, oy, oz, sx, sy, sz, color, q) => batch.box(...at(ox, oy, oz), yaw, sx, sy, sz, color, q);
  if (p.legs) for (const side of [-1, 1]) put(0, y0 + .45, side * .11, .17, .9, .17, p.pants);
  put(0, y0 + 1.19, 0, .27, .6, .5, p.shirt);
  batch.head(...at(0, y0 + 1.66, 0), .125, p.skin);
  put(-.02, y0 + 1.745, 0, .21, .06, .22, p.hair);
  if (p.pack) put(-.2, y0 + 1.22, 0, .16, .42, .34, p.pack);
  if (p.arm?.up) put(0, y0 + 1.5, p.arm.up * .27, .09, .5, .09, p.skin);
  if (p.arm?.out) put(0, 1.66, p.arm.out * 1.14 - p.z, .1, .1, .5, p.skin);
}

function drawCobrador(batch, f, time, shirt, skin) {
  const sway = Math.sin(time * 1.3) * .02, y0 = CAP.y;
  const p = { x: CAP.x, y: y0, z: CAP.z, yaw: -Math.PI / 2, legs: true, shirt, pants: PANTS[1], skin, hair: HAIR[0], phase: 0, kind: 'cob' };
  drawPerson(batch, f, p, time);
  // Brazo en alto que llama a los que esperan: sube hacia delante y se agita.
  const theta = .9 + Math.sin(time * 9) * .45, len = .62;
  ARM_Q.setFromAxisAngle(AXIS_Z, -theta);
  const cx = CAP.x + Math.sin(theta) * len / 2, cy = y0 + 1.4 + sway + Math.cos(theta) * len / 2, cz = CAP.z + .12;
  batch.box(f.x + cx * f.c + cz * f.s, f.y + cy, f.z - cx * f.s + cz * f.c, f.yaw, .09, len, .09, skin, ARM_Q);
}

export class BusPassengers {
  constructor(scene) {
    this.batch = new PersonBatch(scene, { people: MAX_BUSES * PEOPLE_PER_BUS, name: 'Pasajeros de buseta' });
    this.stats = { buses: 0, people: 0 };
    this._frame = { x: 0, y: 0, z: 0, yaw: 0, c: 1, s: 0 };
    this._near = [];
  }

  /** Arma los pasajeros de las busetas cercanas. `time` en segundos; `hour` es la hora del juego. */
  sync(vehicles, cameraPosition, hour, time = 0) {
    const batch = this.batch, near = this._near;
    near.length = 0;
    if (cameraPosition && Number.isFinite(hour)) {
      for (const vehicle of vehicles) {
        const car = vehicle.car, v = car?.vehicle;
        if (!v?.livery || car.instanced || car.group.visible === false) continue;
        const dx = car.group.position.x - cameraPosition.x, dz = car.group.position.z - cameraPosition.z, d2 = dx * dx + dz * dz;
        if (d2 > NEAR * NEAR) continue;
        near.push({ car, v, d2 });
      }
      if (near.length > MAX_BUSES) { near.sort((a, b) => a.d2 - b.d2); near.length = MAX_BUSES; }
    }
    batch.begin();
    const f = this._frame;
    let people = 0;
    for (const { car, v } of near) {
      const roster = rosterOf(v), count = headcount(loadFor(hour, v._luck));
      const g = car.group;
      f.x = g.position.x; f.y = g.position.y; f.z = g.position.z; f.yaw = g.rotation.y;
      f.c = Math.cos(f.yaw); f.s = Math.sin(f.yaw);
      // Lleno hasta la puerta: los tres colgados van al final de la lista y solo suben con la carga alta.
      const upto = Math.min(count, roster.length);
      for (let i = 0; i < upto; i++) drawPerson(batch, f, roster[i], time);
      people += upto;
      if (v._cobrador && count > 3) { drawCobrador(batch, f, time, SHIRTS[(v.seed >>> 4) % SHIRTS.length], SKIN[(v.seed >>> 9) % SKIN.length]); people++; }
    }
    batch.end();
    this.stats.buses = near.length; this.stats.people = people;
    return near.length;
  }

  dispose() { this.batch.dispose(); }
}
