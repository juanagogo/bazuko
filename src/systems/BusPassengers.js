// src/systems/BusPassengers.js
// Pasajeros de las busetas cercanas: personas reales de la calle (PeoplePool) sentadas, de pie en el pasillo, colgadas de
// la puerta y el cobrador asomado agitando la mano. Solo las 3 busetas más cercanas a la cámara y a menos de NEAR metros
// llevan gente (las dos primeras llenas, la tercera a medias); al alejarse, cada persona vuelve al grupo para otro bus.

export const MAX_BUSES = 3;      // busetas con pasajeros a la vez
export const FILL = [20, 14, 6]; // tope de gente real por puesto de cercanía
export const NEAR = 30;          // metros a la cámara
export const OPS_PER_FRAME = 6;  // personas que se prestan o devuelven por cuadro: sin tirones al llegar un bus
export const SEATS = 24;         // seis filas de dos por lado
export const AISLE = 30;
export const PRESSED = 24;
export const FRONT = 6;
export const DOOR = 3;
export const CAPACITY = SEATS + AISLE + PRESSED + FRONT + DOOR;
export const PEOPLE_PER_BUS = CAPACITY + 1;
export const PACKED = .85;       // desde esta carga el bus va lleno hasta la puerta

const FLOOR = .92, STEP = .6;

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

function slots() {
  const seats = [], aisle = [], front = [], pressed = [];
  // Sentados delante de cada respaldo; de pie en el hueco entre filas pegados al vidrio, en el pasillo y adelante.
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) for (const zz of [.4, .82]) seats.push({ kind: 'seat', x: -2.95 + i * .96 + .3, y: FLOOR, z: side * zz, yaw: 0, side });
  for (let i = 0; i < 10; i++) for (const z of [-.2, 0, .2]) aisle.push({ kind: 'stand', x: -3.1 + i * .5 + (z ? .12 : 0), y: FLOOR, z });
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) for (const zz of [.55, .88]) pressed.push({ kind: 'stand', x: -2.95 + i * .96 + .74, y: FLOOR, z: side * zz });
  for (const [x, z] of [[2.5, .3], [2.5, .75], [2.95, .2], [2.95, .62], [3.3, .3], [3.3, .72]]) front.push({ kind: 'stand', x, y: FLOOR, z });
  const door = [[3.18, 1.15], [3.46, 1.14], [3.32, 1.27]].map(([x, z]) => ({ kind: 'door', x, y: STEP, z, yaw: -Math.PI / 2 }));
  return { seats, aisle, front, door, pressed };
}
const SLOTS = slots();

// Cómo esperan los de pie que no se agarran del tubo.
export const WAITING = ['bolsillos', 'celular', 'brazos-cruzados', 'manos-atras', 'hablar', 'bolsillos', 'cambiar-peso'];

/** Los pasajeros posibles de una buseta, en el orden en que suben: sentados, contra el vidrio, pasillo, frente y puerta. Fijos por semilla. */
export function rosterOf(vehicle) {
  if (vehicle._roster) return vehicle._roster;
  const rnd = mulberry(vehicle.seed ?? 1);
  const people = [];
  const add = (slot, extra = {}) => people.push({ yaw: rnd() < .5 ? 0 : Math.PI, bar: false, waiting: Math.floor(rnd() * WAITING.length), ...slot, ...extra });
  for (const s of shuffle(SLOTS.seats.slice(), rnd)) add(s);
  const standing = [...shuffle(SLOTS.pressed.slice(), rnd), ...shuffle(SLOTS.aisle.slice(), rnd), ...SLOTS.front];
  for (const s of standing) add(s, { yaw: pick([0, 0, Math.PI, Math.PI / 2, -Math.PI / 2], rnd), bar: rnd() < .45 });
  for (const s of SLOTS.door) add(s, { bar: true });
  vehicle._roster = people;
  vehicle._cobrador = vehicle.livery?.old ? rnd() < .85 : rnd() < .3;
  vehicle._luck ??= rnd();
  return people;
}

/** La postura de la persona: sentada en la banca, agarrada del tubo, o esperando como cualquiera en la calle. */
export function stanceOf(p) {
  if (p.kind === 'seat') return 'banca';
  if (p.kind === 'door' || p.bar) return 'agarrado';
  return WAITING[p.waiting % WAITING.length];
}

const COBRADOR = { x: 3.34, y: STEP, z: 1.2, yaw: -Math.PI / 2 };

export class BusPassengers {
  /** @param {import('./PeoplePool.js').PeoplePool} pool */
  constructor(scene, pool) {
    this.pool = pool;
    this.stats = { buses: 0, people: 0 };
    this._near = [];
    this._held = new Set();  // busetas que tienen gente prestada
    this._ops = 0;
  }

  _place(figure, bus, p, time, bob = 0) {
    const g = figure.group, c = bus.c, s = bus.s;
    g.position.set(bus.x + p.x * c + p.z * s, bus.y + p.y + bob, bus.z - p.x * s + p.z * c);
    g.rotation.y = bus.yaw + p.yaw + Math.PI / 2;
  }

  /** Ajusta cuántas personas reales tiene prestadas el bus: las que sobran vuelven al grupo, las que faltan se posan. */
  _fill(v, target, roster, withCobrador) {
    const crowd = v._crowd ??= [];
    while (crowd.length > target) { this.pool.release(crowd.pop()); this._ops++; }
    while (crowd.length < target && this._ops < OPS_PER_FRAME) {
      const figure = this.pool.acquire();
      if (!figure) break;
      this.pool.pose(figure, { stance: stanceOf(roster[crowd.length]) });
      crowd.push(figure);
      this._ops++;
    }
    if (withCobrador && !v._cobFigure && this._ops < OPS_PER_FRAME) {
      const figure = this.pool.acquire();
      if (figure) { this.pool.pose(figure, { action: 'saludo', live: true }); v._cobFigure = figure; this._ops++; }
    } else if (!withCobrador && v._cobFigure) { this.pool.release(v._cobFigure); v._cobFigure = null; }
  }

  /** `time` y `dt` en segundos; `hour` es la hora del juego. */
  sync(vehicles, cameraPosition, hour, time = 0, dt = 0) {
    const near = this._near;
    near.length = 0;
    this._ops = 0;
    if (cameraPosition && Number.isFinite(hour)) {
      for (const vehicle of vehicles) {
        const car = vehicle.car, v = car?.vehicle;
        if (!v?.livery || car.instanced || car.group.visible === false) continue;
        const dx = car.group.position.x - cameraPosition.x, dz = car.group.position.z - cameraPosition.z, d2 = dx * dx + dz * dz;
        if (d2 > NEAR * NEAR) continue;
        near.push({ car, v, d2 });
      }
      near.sort((a, b) => a.d2 - b.d2);
      if (near.length > MAX_BUSES) near.length = MAX_BUSES;
    }
    // Las que ya no están entre las cercanas devuelven a su gente.
    for (const v of this._held) {
      if (near.some(n => n.v === v)) continue;
      this._fill(v, 0, null, false);
      this._held.delete(v);
    }
    let people = 0;
    near.forEach(({ car, v }, rank) => {
      const roster = rosterOf(v), count = headcount(loadFor(hour, v._luck));
      this._held.add(v);
      const target = Math.min(count, FILL[rank], roster.length);
      this._fill(v, target, roster, !!v._cobrador && count > 3 && rank < 2);
      const g = car.group;
      this._bus ??= {};
      const bus = this._bus;
      bus.x = g.position.x; bus.y = g.position.y; bus.z = g.position.z; bus.yaw = g.rotation.y;
      bus.c = Math.cos(bus.yaw); bus.s = Math.sin(bus.yaw);
      const crowd = v._crowd ?? [];
      for (let i = 0; i < crowd.length; i++) this._place(crowd[i], bus, roster[i], time);
      people += crowd.length;
      if (v._cobFigure) {
        this._place(v._cobFigure, bus, COBRADOR, time);
        this.pool.animate(v._cobFigure, dt, { action: 'saludo' });
        people++;
      }
    });
    this.stats.buses = near.length; this.stats.people = people;
    return near.length;
  }

  dispose() {
    for (const v of this._held) this._fill(v, 0, null, false);
    this._held.clear();
  }
}

