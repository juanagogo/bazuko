// src/systems/TrafficNet.js
// Red de tráfico (lógica pura, sin THREE): nodos semaforizados, rutas de los autos y fases de semáforo.
//
//  - Nodos semaforizados (cajas axis-aligned): 3 calle x avenida H ('ha'), 3 calle x avenida V ('va') y la plaza
//    donde se cruzan las dos avenidas ('plaza'). Total 16 semáforos (4 en la plaza + 2 por cruce con calle).
//    `reg[eje]` indica qué ejes están regulados: en la plaza ambos (buses y autos de las dos avenidas); en los
//    cruces calle x avenida solo el acceso de la CALLE (los carriles TM y normales de la avenida no se detienen:
//    ahí solo cruzan peatones por la cebra y las estaciones de 18 u ocupan esa zona). Los cruces calle x calle
//    ('ss') no llevan semáforo: ceder el paso simple (los que viajan en Z esperan si hay un vehículo que viaja en X
//    a menos de 9 u de la intersección) y todo auto frena ante cualquier vehículo que tenga delante.
//  - Las calles terminan contra las avenidas (la zona verde no se cruza en auto): los autos de una calle giran
//    a la derecha hacia el carril normal de la avenida, y desde los carriles normales de la avenida pueden
//    girar a la derecha hacia las calles. Todas las rutas van de muro a muro (nacen/mueren fuera del mundo,
//    ocultas por los planos de recorte) y se recorren por la derecha.
//  - Cada ruta es una polilínea con giros de 90° redondeados; para cada nodo que atraviesa se precalcula una
//    "puerta" (línea de pare): s al que el frente del auto debe detenerse si la luz de su eje no está en verde.
//  - Semáforo de 2 fases por nodo (eje 0 = viaja en X, eje 1 = viaja en Z), global y sincronizado:
//    verde 9 s / ámbar 2 s / rojo común 1 s / verde del otro eje ...
import { WORLD_W, WORLD_D } from '../utils/constants.js';

// Temporización por tipo de nodo (s): verde / ámbar / rojo común entre fases (despeje).
//  - calles (cruces calle x avenida): ciclo 24 s (9/2/1); solo regula autos y peatones.
//  - plaza TM x TM: el articulado (19 u, a 4 u/s) tarda ~11 s en despejar la plaza (24 u + su largo), por eso
//    el rojo común es de 12 s (más 2 s de ámbar = 14 s de despeje tras el último verde): ciclo 52 s (12/2/12).
export const TIMING_STREET = { g: 9, a: 2, r: 1 };
export const TIMING_PLAZA = { g: 12, a: 2, r: 12 };
export const SIGNAL_GREEN = TIMING_STREET.g;
export const SIGNAL_AMBER = TIMING_STREET.a;
export const SIGNAL_ALLRED = TIMING_STREET.r;
export const STOP_OFFSET = 0.8;   // el frente del vehículo se detiene 0.8 u antes del borde de la intersección
export const STOP_LINE_OFFSET = 0.5; // la línea blanca se pinta 0.5 u antes del borde
const BOUND = 5;                  // las rutas empiezan/terminan 5 u fuera del mundo (el auto mide ~4.7)
const TURN_R = 2;                 // radio de los giros a la derecha

// Estados de luz
export const GREEN = 0, AMBER = 1, RED = 2;

/** Estado de la luz para un eje (0 = viaja en X, 1 = viaja en Z) en el instante t */
export function signalState(t, axis, tm = TIMING_STREET) {
  const cycle = 2 * (tm.g + tm.a + tm.r);
  const v = (((t + (axis === 0 ? 0 : cycle / 2)) % cycle) + cycle) % cycle;
  if (v < tm.g) return GREEN;
  if (v < tm.g + tm.a) return AMBER;
  return RED;
}

/** Centros de las calles (tramos 'road') de un eje del layout */
function roadCenters(kinds, tile) {
  const out = [];
  let st = -1;
  for (let i = 0; i <= kinds.length; i++) {
    const on = i < kinds.length && kinds[i] === 'road';
    if (on && st < 0) st = i;
    if (!on && st >= 0) { out.push(((st + i - 1) / 2) * tile); st = -1; }
  }
  return out;
}

// ---------- Rutas (polilíneas con giros redondeados) ----------

function buildPath(wps, r = TURN_R) {
  const pts = [wps[0][0], wps[0][1]];
  for (let i = 1; i < wps.length; i++) {
    const v = wps[i];
    const next = wps[i + 1];
    if (!next) { pts.push(v[0], v[1]); continue; }
    const p = wps[i - 1];
    let d0x = v[0] - p[0], d0z = v[1] - p[1]; const l0 = Math.hypot(d0x, d0z); d0x /= l0; d0z /= l0;
    let d1x = next[0] - v[0], d1z = next[1] - v[1]; const l1 = Math.hypot(d1x, d1z); d1x /= l1; d1z /= l1;
    const cx = v[0] - d0x * r + d1x * r, cz = v[1] - d0z * r + d1z * r;
    const STEPS = 6;
    for (let k = 0; k <= STEPS; k++) {
      const t = (k / STEPS) * (Math.PI / 2);
      const c = Math.cos(t), s = Math.sin(t);
      pts.push(cx + (-d1x * c + d0x * s) * r, cz + (-d1z * c + d0z * s) * r);
    }
  }
  const n = pts.length / 2;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  return { pts: Float32Array.from(pts), cum, n, len: cum[n - 1], gates: [] };
}

/** Posición y rumbo (unitario) en s. `cursor` ({i}) acelera consultas monótonas; out = {x,z,hx,hz} */
export function pathAt(path, s, out, cursor = null) {
  const { pts, cum, n } = path;
  let i = cursor ? cursor.i : 0;
  if (i >= n - 1 || cum[i] > s) i = 0;
  while (i < n - 2 && cum[i + 1] < s) i++;
  if (cursor) cursor.i = i;
  const sl = cum[i + 1] - cum[i] || 1;
  let u = (s - cum[i]) / sl;
  if (u < 0) u = 0;
  const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3];
  out.x = x0 + (x1 - x0) * u; out.z = z0 + (z1 - z0) * u;
  out.hx = (x1 - x0) / sl; out.hz = (z1 - z0) / sl;
  return out;
}

const _o = { x: 0, z: 0, hx: 0, hz: 0 };
const inBox = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;

/** Puertas (líneas de pare) de una ruta: una por nodo atravesado, ordenadas por s */
function computeGates(path, nodes) {
  const inside = new Array(nodes.length).fill(false);
  for (let s = 0; s <= path.len; s += 0.25) {
    pathAt(path, s, _o);
    for (let k = 0; k < nodes.length; k++) {
      const now = inBox(nodes[k], _o.x, _o.z);
      if (now && !inside[k]) {
        const axis = Math.abs(_o.hx) > Math.abs(_o.hz) ? 0 : 1;
        if (nodes[k].reg[axis]) path.gates.push({ node: nodes[k], axis, sEntry: s - STOP_OFFSET, hx: Math.sign(_o.hx) * (axis === 0 ? 1 : 0), hz: Math.sign(_o.hz) * (axis === 1 ? 1 : 0), px: _o.x, pz: _o.z });
      }
      inside[k] = now;
    }
  }
  path.gates.sort((a, b) => a.sEntry - b.sEntry);
}

/**
 * Construye la red a partir del layout y las avenidas (computeAvenues).
 * Devuelve { nodes, routes, busGates(lane) }.
 */
export function buildTrafficNet(layout, avenues, tile = 2) {
  const { H, V } = avenues;
  const hStreets = roadCenters(layout.yKinds, tile); // centros z de las calles horizontales
  const vStreets = roadCenters(layout.xKinds, tile); // centros x de las calles verticales

  const nodes = [];
  const mk = (kind, x0, x1, z0, z1, reg) => {
    const n = { id: nodes.length, kind, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, reg, timing: kind === 'plaza' ? TIMING_PLAZA : TIMING_STREET };
    nodes.push(n);
    return n;
  };
  // regulan la calle; ademas el auto que gira hacia el carril de la avenida cede ante los vehiculos que ya vienen por el
  for (const Xc of vStreets) mk('ha', Xc - 2, Xc + 2, H.c - H.half, H.c + H.half, [false, true]).merge = true;
  for (const Zc of hStreets) mk('va', V.c - V.half, V.c + V.half, Zc - 2, Zc + 2, [true, false]).merge = true;
  for (const Xc of vStreets) {
    for (const Zc of hStreets) { const n = mk('ss', Xc - 2, Xc + 2, Zc - 2, Zc + 2, [false, true]); n.yield = true; }
  }
  mk('plaza', V.c - V.half, V.c + V.half, H.c - H.half, H.c + H.half, [true, true]);

  const X0 = -BOUND, X1 = WORLD_W + BOUND, Z0 = -BOUND, Z1 = WORLD_D + BOUND;
  const hN = H.c - H.nOff, hS = H.c + H.nOff;   // carriles normales de la avenida H (norte: -X, sur: +X)
  const vW = V.c - V.nOff, vE = V.c + V.nOff;   // carriles normales de la avenida V (oeste: +Z, este: -Z)
  const wps = [];
  // Rectas de muro a muro por los carriles normales de las avenidas
  wps.push([[X1, hN], [X0, hN]], [[X0, hS], [X1, hS]], [[vW, Z0], [vW, Z1]], [[vE, Z1], [vE, Z0]]);
  for (const Zc of hStreets) {
    wps.push(
      [[X0, Zc + 1], [vW, Zc + 1], [vW, Z1]],     // calle -> carril oeste de la V (giro a la derecha)
      [[X1, Zc - 1], [vE, Zc - 1], [vE, Z0]],     // calle -> carril este de la V
      [[vW, Z0], [vW, Zc - 1], [X0, Zc - 1]],     // carril oeste de la V -> calle (hacia el oeste)
      [[vE, Z1], [vE, Zc + 1], [X1, Zc + 1]]      // carril este de la V -> calle (hacia el este)
    );
  }
  for (const Xc of vStreets) {
    wps.push(
      [[Xc - 1, Z0], [Xc - 1, hN], [X0, hN]],     // calle -> carril norte de la H
      [[Xc + 1, Z1], [Xc + 1, hS], [X1, hS]],     // calle -> carril sur de la H
      [[X1, hN], [Xc + 1, hN], [Xc + 1, Z0]],     // carril norte de la H -> calle (hacia el norte)
      [[X0, hS], [Xc - 1, hS], [Xc - 1, Z1]]      // carril sur de la H -> calle (hacia el sur)
    );
  }
  const routes = wps.map((w) => {
    const p = buildPath(w);
    computeGates(p, nodes);
    return p;
  });

  /** Puertas de un carril recto de bus: s medido como progreso del bus (ver BusTM) */
  function busGates(lane, a0Start, a1End) {
    const gates = [];
    const ax = lane.axis === 'x' ? 0 : 1;
    for (const n of nodes) {
      const lo = ax === 0 ? n.z0 : n.x0, hi = ax === 0 ? n.z1 : n.x1;
      if (!(lane.c > lo + 0.1 && lane.c < hi - 0.1)) continue;
      if (!n.reg[ax]) continue; // ese eje no está regulado en este nodo
      const e0 = ax === 0 ? n.x0 : n.z0, e1 = ax === 0 ? n.x1 : n.z1;
      const sEntry = lane.dir > 0 ? (e0 - a0Start) - STOP_OFFSET : (a1End - e1) - STOP_OFFSET;
      const sExit = lane.dir > 0 ? e1 - a0Start : a1End - e0; // salida de la intersección (coordenada s del frente)
      gates.push({ node: n, axis: ax, sEntry, sExit, hx: ax === 0 ? lane.dir : 0, hz: ax === 1 ? lane.dir : 0, px: lane.axis === 'x' ? e0 : lane.c, pz: lane.axis === 'x' ? lane.c : e0 });
    }
    gates.sort((a, b) => a.sEntry - b.sEntry);
    return gates;
  }

  return { nodes, routes, busGates, hStreets, vStreets, avenues };
}

// ---------- Ceder el paso (cruces calle x calle sin semáforo) ----------
let _yBoxes = null, _yFrame = 0;
/** Llamar una vez por frame con las cajas móviles (autos y buses) antes de evaluar puertas */
export function beginTrafficFrame(boxes) { _yBoxes = boxes; _yFrame++; }
function yieldRed(node) {
  if (node._yf === _yFrame) return node._yr;
  node._yf = _yFrame; node._yr = false;
  if (!_yBoxes) return false;
  for (let i = 0; i < _yBoxes.length; i++) {
    const b = _yBoxes[i];
    if (!b.enabled || b.hx <= b.hz) continue; // solo vehículos que viajan en X
    if (Math.abs(b.x - node.cx) < 11 + b.hx && Math.abs(b.z - node.cz) < 2 + b.hz) { node._yr = true; break; }
  }
  return node._yr;
}

// Giro a la derecha desde una calle hacia el carril normal de la avenida: cede ante vehiculos del carril que llegan
function mergeRed(g) {
  if (!_yBoxes) return false;
  const n = g.node;
  const ha = n.kind === 'ha';
  const laneC = ha ? (g.hz > 0 ? n.z0 + 2 : n.z1 - 2) : (g.hx > 0 ? n.x0 + 2 : n.x1 - 2);
  const flow = ha ? (g.hz > 0 ? -1 : 1) : (g.hx > 0 ? 1 : -1);
  const pc = ha ? g.px : g.pz;
  for (let i = 0; i < _yBoxes.length; i++) {
    const b = _yBoxes[i];
    if (!b.enabled) continue;
    if (ha) {
      if (b.hx <= b.hz || Math.abs(b.z - laneC) >= 2.2 + Math.min(b.hz, 1)) continue;
      const rel = (b.x - pc) * -flow;
      if (rel > -3 && rel < 12 + b.hx) return true;
    } else {
      if (b.hz <= b.hx || Math.abs(b.x - laneC) >= 2.2 + Math.min(b.hx, 1)) continue;
      const rel = (b.z - pc) * -flow;
      if (rel > -3 && rel < 12 + b.hz) return true;
    }
  }
  return false;
}

/**
 * Limita la velocidad de un vehículo según la próxima puerta cuya luz no está en verde.
 * state: objeto del vehículo con { commit } (puerta a la que ya se comprometió a pasar).
 * Devuelve la velocidad máxima permitida (Infinity = sin límite).
 */
export function gateLimit(gates, t, sFront, v, dec, state) {
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    if (g.sEntry < sFront - 0.15) continue;           // ya la cruzó
    if (state.commit === g) return Infinity;           // decidió pasar con ámbar
    let st = g.node.yield ? (yieldRed(g.node) ? RED : GREEN) : signalState(t, g.axis, g.node.timing);
    if (st !== RED && g.node.merge && mergeRed(g)) st = RED;
    if (st === GREEN) { if (state.commit && state.commit !== g) state.commit = null; return Infinity; }
    const d = g.sEntry - sFront;                       // distancia hasta la línea de pare
    const brake = (v * v) / (2 * dec);
    if (st === AMBER && brake > d + 0.3 && v > 1) { state.commit = g; return Infinity; } // no alcanza a frenar: pasa
    if (st === RED && d < 0.4 && v > 2.5) { state.commit = g; return Infinity; }        // recién se pasó la línea
    return Math.sqrt(2 * dec * Math.max(0, d)) * 0.95;
  }
  return Infinity;
}
