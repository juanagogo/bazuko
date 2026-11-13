// src/entities/npc/crossing.js
// Cruzar mirando el tráfico. Quien llega al borde del andén con un cruce por delante mira los carros y los buses:
// cruza cuando el que viene tarda en llegar más que lo que él tarda en cruzar, más un margen (los impacientes aceptan
// huecos más cortos). Donde hay semáforo espera su turno: los carros que le cruzan el paso en rojo, y tiempo de rojo
// suficiente. Nadie espera para siempre: pasada su paciencia (12 a 18 s) cruza en cuanto no tenga un carro encima, y
// a los 2 s más cruza igual (nadie pasa de 20 s en el borde); los carros ya frenan por la gente.
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
  cycle: 36          // s del ciclo de los semáforos (ver TrafficSignals.signalState)
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
