// src/entities/npc/crossing.js
// Cruzar mirando el tráfico. Quien llega al borde del andén con un cruce por delante mira los carros y los buses:
// cruza cuando el que viene tarda en llegar más que lo que él tarda en cruzar, más un margen (los impacientes aceptan
// huecos más cortos). Donde hay semáforo espera su turno: los carros que le cruzan el paso en rojo, y tiempo de rojo
// suficiente. Nadie espera para siempre: pasada su paciencia (12 a 18 s) cruza en cuanto no tenga un carro que viene
// encima, y a los 2 s más cruza igual (nadie pasa de 20 s en el borde); los que vienen ya frenan por la gente.
// Un carro quieto no es uno que viene, aunque tenga la trompa sobre la cebra: no se lo espera. Si la carrocería tapa
// la línea del paso, se la rodea por un lado pisable y no se entra en ella; si no hay lado, se cambia de camino.
// Si ya va cruzando y se le acerca un carro, apura el paso.
import { signalState } from '../../world/bogota/TrafficSignals.js';

export const CROSS = {
  margin: 1.5,       // s de margen sobre el tiempo de cruzar
  impatientMargin: .5, // s del más impaciente
  waitMin: 12,       // s: el más impaciente no espera más
  waitMax: 18,       // s: el más paciente tampoco (más el margen `grace`: 20 s)
  band: 1,           // m a cada lado de su línea que ocupa el paso de cebra
  look: 55,          // m: carros más lejos no cuentan
  stopped: .5,       // m/s: más despacio es un carro detenido (en cola, en el semáforo o frenado por alguien)
  hurry: 1.5,        // ritmo al apurarse con un carro encima
  grace: 2,          // s que se le dan, pasada la paciencia, para no meterse delante de uno que ya llega
  lastChance: .8,    // s: pasada la paciencia cruza si el primero tarda más que esto
  signalReach: 4,    // m del borde del cruce: la cebra pegada al cruce obedece su semáforo
  curbGap: .6,       // m entre centros que guardan dos que esperan en el mismo borde (un cuerpo y un poco)
  cycle: 36,         // s del ciclo de los semáforos (ver TrafficSignals.signalState)
  skirt: .35,        // m que el centro deja por fuera de la carrocería quieta (el cuerpo no entra en la caja)
  skirtRate: 1.8     // m/s al correrse de lado para rodear un carro quieto
};

/**
 * Cuánto tarda un vehículo en meterse en el paso de cebra de A a B (en s). Infinity si no lo cruza, si ya pasó o
 * si está detenido. 0 si lo está pisando en marcha.
 * `v`: { x, z, hx, hz, speed, halfLength, halfWidth }. `span`: { ax, az, ux, uz, length }.
 */
export function vehicleArrival(v, span) {
  const { ax, az, ux, uz, length } = span;
  const px = ax - v.x, pz = az - v.z;                  // del vehículo al punto A
  const denom = v.hx * uz - v.hz * ux;                  // cruz(h, u): cero si va paralelo al paso de cebra
  const wide = v.halfWidth + CROSS.band;
  if (Math.abs(denom) < .3) {
    // Paralelo: solo cuenta si va andando encima de la franja.
    const along = -(px * ux + pz * uz), across = Math.abs(-px * uz + pz * ux);
    return v.speed >= CROSS.stopped && along > -v.halfLength && along < length + v.halfLength && across < v.halfWidth + CROSS.band ? 0 : Infinity;
  }
  const t = (px * uz - pz * ux) / denom;               // metros, por su rumbo, hasta la línea del peatón
  const k = (px * v.hz - pz * v.hx) / denom;           // dónde corta esa línea, medido desde A
  if (k < -wide || k > length + wide) return Infinity; // cruza la línea fuera del paso
  // Detenido no se le viene encima, aunque esté sobre la cebra: en rojo los carros paran con la trompa en ella.
  // La carrocería quieta no se atraviesa: la aparta skirtStopped.
  if (v.speed < CROSS.stopped) return Infinity;
  if (t + v.halfLength + CROSS.band < 0) return Infinity; // ya pasó
  const front = t - v.halfLength - CROSS.band;
  return front <= 0 ? 0 : front / v.speed;              // 0: la está pisando
}

/** ¿Acepta el hueco? Cruza si lo que tarda el primero en llegar supera su tiempo de cruzar más el margen. */
export function acceptGap(arrival, crossTime, margin) {
  return arrival > crossTime + margin;
}

/** Margen y espera máxima según su impaciencia (0 paciente .. 1 impaciente). */
export function crossingTemper(impatience) {
  return {
    margin: CROSS.margin - (CROSS.margin - CROSS.impatientMargin) * impatience,
    maxWait: CROSS.waitMax - (CROSS.waitMax - CROSS.waitMin) * impatience
  };
}

/**
 * El semáforo que manda en este paso de cebra, si hay: el cruce de calles junto al punto medio. Devuelve el eje de
 * los carros que le cruzan el paso (0 van por X, 1 van por Z) o −1 sin semáforo.
 */
export function signalFor(signals, span) {
  if (!signals?.nodes) return { node: null, axis: -1 };
  const mx = span.ax + span.ux * span.length / 2, mz = span.az + span.uz * span.length / 2;
  const reach = CROSS.signalReach;
  for (const node of signals.nodes) {
    if (mx < node.x0 - reach || mx > node.x1 + reach || mz < node.z0 - reach || mz > node.z1 + reach) continue;
    // Quien anda por X cruza una vía de carros que van por Z, y al revés.
    return { node, axis: Math.abs(span.ux) >= Math.abs(span.uz) ? 1 : 0 };
  }
  return { node: null, axis: -1 };
}

/** ¿Le da el semáforo? Rojo para los carros que le cruzan, con tiempo de rojo para llegar al otro lado. */
export function signalAllows(time, axis, crossTime) {
  if (axis < 0) return true;
  if (signalState(time, axis) !== 2) return false;
  const phase = ((time - axis * CROSS.cycle / 2) % CROSS.cycle + CROSS.cycle) % CROSS.cycle;
  return CROSS.cycle - phase >= crossTime + .5;
}

const _v = { x: 0, z: 0, hx: 0, hz: 0, speed: 0, halfLength: 0, halfWidth: 0 };

/**
 * El primero que llega al paso de cebra entre los carros del tráfico (`{ car, speed }`) y los buses de la troncal.
 * Devuelve sus segundos (Infinity si nadie) y deja en `span.threat` quién es, para mirarlo. Sin crear objetos.
 */
export function firstArrival(span, vehicles, buses, y = 0) {
  let best = Infinity;
  span.threat = null;
  const mx = span.ax + span.ux * span.length / 2, mz = span.az + span.uz * span.length / 2;
  const reach = CROSS.look + span.length / 2, reach2 = reach * reach;
  for (let i = 0; i < (vehicles?.length ?? 0); i++) {
    const vehicle = vehicles[i], car = vehicle?.car;
    if (!car?.position) continue;
    const dx = car.position.x - mx, dz = car.position.z - mz;
    if (dx * dx + dz * dz > reach2) continue;
    const yaw = car.group?.rotation.y ?? 0;
    _v.x = car.position.x; _v.z = car.position.z; _v.hx = Math.cos(yaw); _v.hz = -Math.sin(yaw);
    _v.speed = vehicle.speed ?? 0; _v.halfLength = (car.length ?? 4.4) / 2; _v.halfWidth = (car.width ?? 1.9) / 2;
    const t = vehicleArrival(_v, span);
    if (t < best) { best = t; span.threat = car; }
  }
  for (let i = 0; i < (buses?.length ?? 0); i++) {
    const bus = buses[i];
    // El que va por el viaducto pasa por encima; el que está fuera de servicio no se ve.
    if (!bus?.position || bus.group?.visible === false || bus.position.y - y > 2.5) continue;
    const dx = bus.position.x - mx, dz = bus.position.z - mz;
    if (dx * dx + dz * dz > reach2) continue;
    const yaw = bus.group?.rotation.y ?? 0; // BusService: rotation.y = atan2(−h.x, −h.z)
    _v.x = bus.position.x; _v.z = bus.position.z; _v.hx = -Math.sin(yaw); _v.hz = -Math.cos(yaw);
    _v.speed = bus.speed ?? 0; _v.halfLength = bus.length / 2; _v.halfWidth = bus.width / 2;
    const t = vehicleArrival(_v, span);
    if (t < best) { best = t; span.threat = bus; }
  }
  return best;
}

const _box = { lo: 0, hi: 0 };
const _slab = { t0: 0, t1: 1 };
const _merge = { lo: 0, hi: 0, any: false };

/** ¿El segmento (x0, z0)→(x1, z1) toca la caja? En el plano del vehículo, por losas, sin crear objetos. */
function segmentHitsBody(x0, z0, x1, z1, v) {
  const dx = x0 - v.x, dz = z0 - v.z, ex = x1 - v.x, ez = z1 - v.z;
  const lx0 = dx * v.hx + dz * v.hz, lz0 = dx * v.hz - dz * v.hx;
  const lx1 = ex * v.hx + ez * v.hz, lz1 = ex * v.hz - ez * v.hx;
  const hx = v.halfLength + .04, hz = v.halfWidth + .04;
  const range = _slab;
  range.t0 = 0; range.t1 = 1;
  if (!slab(lx0, lx1 - lx0, hx, range) || !slab(lz0, lz1 - lz0, hz, range)) return false;
  return range.t0 <= range.t1;
}

function slab(p, d, h, range) {
  if (Math.abs(d) < 1e-9) return p >= -h && p <= h;
  let a = (-h - p) / d, b = (h - p) / d;
  if (a > b) { const s = a; a = b; b = s; }
  if (a > range.t0) range.t0 = a;
  if (b < range.t1) range.t1 = b;
  return range.t0 <= range.t1;
}

/**
 * Intervalo lateral (metros a la derecha de la línea, derecha = (uz, −ux)) que tapa la carrocería quieta de `v`
 * sobre el tramo. false si va en marcha, si no pisa el tramo o si no tapa la línea. Escribe en `_box`.
 */
function stoppedOnLine(v, span) {
  if (v.speed >= CROSS.stopped) return false;
  const { ax, az, ux, uz, length } = span;
  const rx = uz, rz = -ux;
  const dx = v.x - ax, dz = v.z - az;
  const alongC = dx * ux + dz * uz, latC = dx * rx + dz * rz;
  const rvx = v.hz, rvz = -v.hx;
  const halfAlong = v.halfLength * Math.abs(v.hx * ux + v.hz * uz) + v.halfWidth * Math.abs(rvx * ux + rvz * uz);
  const halfLat = v.halfLength * Math.abs(v.hx * rx + v.hz * rz) + v.halfWidth * Math.abs(rvx * rx + rvz * rz);
  if (alongC + halfAlong < 0 || alongC - halfAlong > length) return false;
  const lo = latC - halfLat, hi = latC + halfLat;
  if (hi < 0 || lo > 0) return false;
  _box.lo = lo; _box.hi = hi;
  return true;
}

function fillCar(vehicle) {
  const car = vehicle?.car;
  if (!car?.position) return false;
  const yaw = car.group?.rotation.y ?? 0;
  _v.x = car.position.x; _v.z = car.position.z; _v.hx = Math.cos(yaw); _v.hz = -Math.sin(yaw);
  _v.speed = vehicle.speed ?? 0; _v.halfLength = (car.length ?? 4.4) / 2; _v.halfWidth = (car.width ?? 1.9) / 2;
  return true;
}

function fillBus(bus, y) {
  if (!bus?.position || bus.group?.visible === false || bus.position.y - y > 2.5) return false;
  const yaw = bus.group?.rotation.y ?? 0;
  _v.x = bus.position.x; _v.z = bus.position.z; _v.hx = -Math.sin(yaw); _v.hz = -Math.cos(yaw);
  _v.speed = bus.speed ?? 0; _v.halfLength = bus.length / 2; _v.halfWidth = bus.width / 2;
  return true;
}

/** ¿Algún carro o bus quieto tiene el segmento dentro de la carrocería? */
export function segmentHitsStopped(x0, z0, x1, z1, vehicles, buses, y = 0) {
  for (let i = 0; i < (vehicles?.length ?? 0); i++) {
    if (!fillCar(vehicles[i]) || _v.speed >= CROSS.stopped) continue;
    if (segmentHitsBody(x0, z0, x1, z1, _v)) return true;
  }
  for (let i = 0; i < (buses?.length ?? 0); i++) {
    if (!fillBus(buses[i], y) || _v.speed >= CROSS.stopped) continue;
    if (segmentHitsBody(x0, z0, x1, z1, _v)) return true;
  }
  return false;
}

/** ¿La línea corrida `d` metros a la derecha cabe en el piso y no entra en un carro quieto? */
function sideClear(span, d, vehicles, buses, y, walkable, walkThis) {
  const { ax, az, ux, uz, length } = span;
  const rx = uz, rz = -ux;
  const steps = Math.max(1, Math.ceil(length / .5));
  for (let i = 0; i <= steps; i++) {
    const s = Math.min(length, i * .5);
    const x = ax + ux * s + rx * d, z = az + uz * s + rz * d;
    if (walkable && !walkable.call(walkThis, x, z)) return false;
    if (segmentHitsStopped(x, z, x, z, vehicles, buses, y)) return false;
  }
  return true;
}

/**
 * Metros a la derecha de la línea del cruce para no entrar en un carro o bus quieto cuya carrocería tapa esa línea.
 * 0 si la línea está libre. NaN si la tapan y ningún lado sigue siendo piso: hay que cambiar de camino.
 * `prefer` conserva el lado ya elegido si todavía sirve. `walkable` es `npc.isWalkable` (se llama con `walkThis`).
 * Sin crear objetos.
 */
function touchStopped(span) {
  if (!stoppedOnLine(_v, span)) return;
  if (!_merge.any) {
    if (_box.lo <= 0 && _box.hi >= 0) { _merge.lo = _box.lo; _merge.hi = _box.hi; _merge.any = true; }
    return;
  }
  if (_box.hi < _merge.lo || _box.lo > _merge.hi) return;
  if (_box.lo < _merge.lo) _merge.lo = _box.lo;
  if (_box.hi > _merge.hi) _merge.hi = _box.hi;
}

export function skirtStopped(span, vehicles, buses, y, walkable, walkThis, prefer = 0) {
  const merged = _merge;
  merged.lo = 0; merged.hi = 0; merged.any = false;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < (vehicles?.length ?? 0); i++) if (fillCar(vehicles[i])) touchStopped(span);
    for (let i = 0; i < (buses?.length ?? 0); i++) if (fillBus(buses[i], y)) touchStopped(span);
  }
  if (!merged.any) return 0;
  const lo = merged.lo, hi = merged.hi;
  if (prefer && sideClear(span, prefer, vehicles, buses, y, walkable, walkThis) &&
    (prefer >= hi + CROSS.skirt - 1e-3 || prefer <= lo - CROSS.skirt + 1e-3)) return prefer;
  const plus = hi + CROSS.skirt, minus = lo - CROSS.skirt;
  const plusOk = sideClear(span, plus, vehicles, buses, y, walkable, walkThis);
  const minusOk = sideClear(span, minus, vehicles, buses, y, walkable, walkThis);
  if (plusOk && minusOk) return Math.abs(plus) <= Math.abs(minus) ? plus : minus;
  if (plusOk) return plus;
  if (minusOk) return minus;
  return NaN;
}
