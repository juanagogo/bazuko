// src/world/bogota/carParts.js
// Piezas de los vehículos: lotes de vértices y parches proyectados sobre la rejilla de la carrocería.
// Todo se acumula por material compartido; así un carro completo se dibuja en pocas llamadas.
import * as THREE from 'three';
import { CELL, ROW_COUNT, curve, lerp } from './carLoft.js';
import { RECT, rectUv } from './carAtlas.js';

const WHITE = rectUv(RECT.white, .5, .5);
// Una pieza en espejo que nace a menos de esto del eje empata ahí con su copia: es el `off` del parche, que aleja del eje unos milímetros.
const ON_AXIS = .004;

/** Lote de vértices con normal, UV, color con máscara de metal en alfa y canal de lámpara. */
export class Batch {
  constructor({ color = true, uv = true, lamp = false, colorSize = 4 } = {}) {
    this.P = []; this.N = []; this.U = []; this.C = []; this.L = []; this.I = [];
    this.hasColor = color; this.hasUv = uv; this.hasLamp = lamp; this.colorSize = colorSize;
    this.count = 0;
  }

  v(x, y, z, nx, ny, nz, u = WHITE[0], v = WHITE[1], r = 1, g = 1, b = 1, a = 0, lamp = 0) {
    this.P.push(x, y, z); this.N.push(nx, ny, nz);
    if (this.hasUv) this.U.push(u, v);
    if (this.hasColor) { if (this.colorSize === 4) this.C.push(r, g, b, a); else this.C.push(r, g, b); }
    if (this.hasLamp) this.L.push(lamp);
    return this.count++;
  }

  tri(a, b, c) { this.I.push(a, b, c); }
  quad(a, b, c, d) { this.I.push(a, b, c, a, c, d); }
  get triangles() { return this.I.length / 3; }

  toGeometry(name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.P), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.N), 3));
    if (this.hasUv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.U), 2));
    if (this.hasColor) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.C), this.colorSize));
    if (this.hasLamp) g.setAttribute('lamp', new THREE.BufferAttribute(new Float32Array(this.L), 1));
    g.setIndex(this.count > 65000 ? new THREE.BufferAttribute(new Uint32Array(this.I), 1) : new THREE.BufferAttribute(new Uint16Array(this.I), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.name = name;
    return g;
  }
}

const srgb = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export const COLOR = Object.freeze({
  trim: srgb('#17191b'), dark: srgb('#060708'), liner: srgb('#040405'), chrome: srgb('#dfe3e6'), rubber: srgb('#101112'),
  plastic: srgb('#26282a'), plasticLight: srgb('#3b3e41'), gray: srgb('#55585b'), silver: srgb('#a9adb1'), seat: srgb('#2a2b2d'),
  dash: srgb('#141516'), exhaust: srgb('#3a3c3e'), headliner: srgb('#5d5e5e'), pocket: srgb('#0c0d0e'),
});

/** Vuelca a los lotes las celdas de la carrocería, a ambos lados; los vértices comparten posición y normal. */
export function emitBody(body, kinds, batches, ao) {
  const { ns } = body, NR = ROW_COUNT, P = body.P, N = body.N, UV = body.UV;
  const areaMin = 1e-7;
  for (const side of [1, -1]) {
    const maps = new Map();
    const index = (kind, si, r) => {
      let map = maps.get(kind);
      if (!map) maps.set(kind, map = new Int32Array(ns * NR).fill(-1));
      const id = si * NR + r;
      if (map[id] >= 0) return map[id];
      const i = id * 3, k = id * 2, x = P[i], y = P[i + 1], z = body.closes(si) ? 0 : P[i + 2] * side;
      const nx = N[i], ny = N[i + 1], nz = N[i + 2] * side;
      let vertex;
      if (kind === CELL.PAINT) {
        const a = ao(x, y, r);
        vertex = batches.paint.v(x, y, z, nx, ny, nz, UV[k], UV[k + 1], a[0], a[1], a[2]);
      } else if (kind === CELL.GLASS) {
        vertex = batches.glass.v(x, y, z, nx, ny, nz);
      } else {
        const c = kind === CELL.CHROME ? COLOR.chrome : kind === CELL.DARK ? COLOR.dark : COLOR.trim;
        vertex = batches.trim.v(x, y, z, nx, ny, nz, WHITE[0], WHITE[1], c[0], c[1], c[2], kind === CELL.CHROME ? 1 : 0);
      }
      map[id] = vertex;
      return vertex;
    };
    for (let si = 0; si < ns - 1; si++) for (let r = 0; r < NR - 1; r++) {
      const kind = kinds[si * NR + r];
      if (kind === CELL.SKIP) continue;
      const a = (si * NR + r) * 3, b = ((si + 1) * NR + r) * 3, c = ((si + 1) * NR + r + 1) * 3, d = (si * NR + r + 1) * 3;
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
      const wx = P[d] - P[b], wy = P[d + 1] - P[b + 1], wz = P[d + 2] - P[b + 2];
      const area = (uy * wz - uz * wy) ** 2 + (uz * wx - ux * wz) ** 2 + (ux * wy - uy * wx) ** 2;
      if (area < areaMin * areaMin) continue;
      const batch = kind === CELL.PAINT ? batches.paint : kind === CELL.GLASS ? batches.glass : batches.trim;
      const A = index(kind, si, r), B = index(kind, si + 1, r), C = index(kind, si + 1, r + 1), D = index(kind, si, r + 1);
      if (side > 0) batch.quad(A, B, C, D); else batch.quad(A, D, C, B);
    }
  }
}

/**
 * Rejilla libre: fn(i, j) da [x, y, z]. Calcula normales por diferencias y orienta las caras hacia `out`
 * (por defecto, desde el centro del carro). Con mirror añade la copia en −Z, con la orientación corregida.
 */
export function addGrid(batch, cols, rows, fn, { uv = null, color = COLOR.trim, metal = 0, lamp = 0, mirror = true, out = null } = {}) {
  const W = cols + 1, H = rows + 1, pts = new Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) pts[j * W + i] = fn(i, j);
  const normalAt = (i, j) => {
    const a = pts[j * W + Math.max(0, i - 1)], b = pts[j * W + Math.min(cols, i + 1)];
    const c = pts[Math.max(0, j - 1) * W + i], d = pts[Math.min(rows, j + 1) * W + i];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - c[0], vy = d[1] - c[1], vz = d[2] - c[2];
    // La diferencia del borde es de un solo lado y deja z en la normal: sin esto, las dos mitades de una parrilla no empatan en el eje.
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = mirror && Math.abs(pts[j * W + i][2]) < ON_AXIS ? 0 : ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  const center = pts[Math.floor(H / 2) * W + Math.floor(W / 2)];
  const dir = out ?? [center[0], center[1] - .7, center[2]];
  const n0 = normalAt(Math.floor(W / 2), Math.floor(H / 2));
  const flip = n0[0] * dir[0] + n0[1] * dir[1] + n0[2] * dir[2] < 0;
  for (const side of mirror ? [1, -1] : [1]) {
    const base = batch.count;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = pts[j * W + i], n = normalAt(i, j), s = flip ? -1 : 1, t = uv ? uv(i / cols, j / rows, side) : WHITE;
      const c = typeof color === 'function' ? color(i / cols, j / rows) : color;
      batch.v(p[0], p[1], p[2] * side, n[0] * s, n[1] * s, n[2] * s * side, t[0], t[1], c[0], c[1], c[2], metal, typeof lamp === 'function' ? lamp(side) : lamp);
    }
    const reversed = flip !== (side < 0);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = base + j * W + i, b = a + 1, c = a + W + 1, d = a + W;
      if (reversed) batch.quad(a, d, c, b); else batch.quad(a, b, c, d);
    }
  }
}

const asCurve = v => typeof v === 'function' ? v : Array.isArray(v) ? curve(v) : () => v;

// Suma al alfa de metal: el sombreador acerca la profundidad de lo marcado para que la chapa no lo atraviese.
export const PATCH_FLAG = 2;

/**
 * Parche envolvente: nariz o cola, a metros desde el eje central y alturas por curvas top/bot.
 * Las columnas caen sobre los vértices de la propia chapa: una cuerda nunca corta la curva de la esquina,
 * y por eso la carrocería no atraviesa faros, parrillas ni stops.
 */
export function patchAround(batch, body, end, { a0, a1, top, bot, rows = 2, off = .005, bulge = 0, rect = null, flipU = false, maxStep = .3, metal = 0, ...rest }) {
  const T = asCurve(top), B = asCurve(bot), ymid = (T((a0 + a1) / 2) + B((a0 + a1) / 2)) / 2;
  const marks = [a0, a1];
  // Una sección casi sobre el eje no aporta columna: dejaría una tira de menos de 3 mm con otra normal en el centro de la pieza.
  for (const { a, z } of body.planCurve(end, ymid)) if (a === 0 || z >= .003) for (const signed of [a, -a]) if (signed > a0 + .006 && signed < a1 - .006) marks.push(signed);
  marks.sort((p, q) => p - q);
  const columns = [marks[0]];
  for (let i = 1; i < marks.length; i++) {
    const gap = marks[i] - columns[columns.length - 1];
    if (gap < .004) continue;
    const n = Math.ceil(gap / maxStep);
    for (let k = 1; k <= n; k++) columns.push(columns[columns.length - 1] + (marks[i] - columns[columns.length - 1]) / (n - k + 1));
  }
  const count = columns.length - 1, span = a1 - a0;
  const fn = (i, j) => {
    const a = columns[i], u = (a - a0) / span, v = j / rows, y = lerp(B(a), T(a), v);
    const o = off + bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    const p = body.around(end, Math.abs(a), y, o);
    if (a < 0) p[2] = -p[2];
    return p;
  };
  const crossing = a0 < 0 && a1 > 0;
  const uvAt = (u, v) => { const a = columns[Math.round(u * count)], t = (a - a0) / span; return rectUv(rect, flipU ? 1 - t : t, 1 - v); };
  addGrid(batch, count, rows, fn, { uv: rect ? uvAt : null, mirror: !crossing, out: [end === 'nose' ? 1 : -1, .15, 0], metal: metal + PATCH_FLAG, ...rest });
}

/** Vuelve las aristas de un contorno (a, y) en el intervalo de alturas que cubre cada columna. */
function outlineSpan(outline, a) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [a0, y0] = outline[i], [a1, y1] = outline[(i + 1) % outline.length];
    if (a < Math.min(a0, a1) - 1e-6 || a > Math.max(a0, a1) + 1e-6) continue;
    if (Math.abs(a1 - a0) < 1e-6) { lo = Math.min(lo, y0, y1); hi = Math.max(hi, y0, y1); continue; }
    const y = lerp(y0, y1, (a - a0) / (a1 - a0));
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return [lo, hi];
}

/**
 * Parche con contorno libre en (a, y), a ≥ 0 y en espejo. La UV es plana sobre `box`: el dibujo del atlas no se tuerce
 * con la forma, y el mismo contorno sirve de recorte para el dibujo y para la malla.
 */
export function patchOutline(batch, body, end, { outline, box = null, rect = null, rows = 2, off = .005, bulge = 0, maxStep = .16, metal = 0, ...rest }) {
  const as = outline.map(p => p[0]), ys = outline.map(p => p[1]);
  const aMin = Math.min(...as), aMax = Math.max(...as), ymid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const marks = [...as];
  for (const { a } of body.planCurve(end, ymid)) if (a > aMin + .006 && a < aMax - .006) marks.push(a);
  marks.sort((p, q) => p - q);
  const columns = [marks[0]];
  for (let i = 1; i < marks.length; i++) {
    const last = columns[columns.length - 1], gap = marks[i] - last;
    if (gap < .012) continue;
    const n = Math.ceil(gap / maxStep);
    for (let k = 1; k <= n; k++) columns.push(last + gap * k / n);
  }
  if (columns[columns.length - 1] < aMax - 1e-4) columns.push(aMax);
  // Una punta exacta dejaría una columna sin altura y su normal en cero, y esa esquina se vería negra.
  const spans = columns.map(a => { const [lo, hi] = outlineSpan(outline, a), mid = (lo + hi) / 2; return hi - lo < .003 ? [mid - .0015, mid + .0015] : [lo, hi]; }), count = columns.length - 1;
  const yOf = (i, j) => lerp(spans[i][0], spans[i][1], j / rows);
  const fn = (i, j) => {
    const a = columns[i], u = (a - aMin) / (aMax - aMin);
    return body.around(end, a, yOf(i, j), off + bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * j / rows));
  };
  const b = box ?? [aMin, aMax, Math.min(...ys), Math.max(...ys)];
  const uv = rect ? (u, v) => {
    const i = Math.round(u * count), j = Math.round(v * rows);
    return rectUv(rect, (columns[i] - b[0]) / (b[1] - b[0]), (b[3] - yOf(i, j)) / (b[3] - b[2]));
  } : null;
  addGrid(batch, count, rows, fn, { uv, out: [end === 'nose' ? 1 : -1, .15, .35], metal: metal + PATCH_FLAG, ...rest });
}

/** Línea fina sobre nariz o cola: costuras de tapas y parachoques, y cromos delgados. */
export function seamLine(batch, body, end, pts, { width = .007, off = .0045, color = COLOR.dark, metal = 0, maxStep = .14, ...rest } = {}) {
  const line = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, y0] = pts[i], [a1, y1] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(a1 - a0, y1 - y0) / maxStep));
    for (let k = 0; k < n; k++) line.push([lerp(a0, a1, k / n), lerp(y0, y1, k / n)]);
  }
  line.push(pts[pts.length - 1]);
  const count = line.length - 1;
  const fn = (i, j) => {
    const p = line[Math.max(0, i - 1)], q = line[Math.min(count, i + 1)], da = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(da, dy) || 1, s = (j - .5) * width;
    return body.around(end, Math.max(0, line[i][0] - dy / l * s), line[i][1] + da / l * s, off);
  };
  addGrid(batch, count, 1, fn, { color, out: [end === 'nose' ? 1 : -1, .15, .35], metal: metal + PATCH_FLAG, ...rest });
}

/** Parche lateral: x y altura; la profundidad sale de la chapa. */
export function patchSide(batch, body, { x0, x1, top, bot, cols = 4, rows = 1, off = .004, bulge = 0, rect = null, flipU = false, metal = 0, ...rest }) {
  const T = asCurve(top), B = asCurve(bot);
  const fn = (i, j) => {
    const u = i / cols, v = j / rows, x = lerp(x0, x1, u), y = lerp(B(x), T(x), v);
    const o = off + bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    return [x, y, body.sideZ(x, y) + o];
  };
  addGrid(batch, cols, rows, fn, { uv: rect ? (u, v, side) => rectUv(rect, side > 0 === flipU ? 1 - u : u, 1 - v) : null, out: [0, 0, 1], metal: metal + PATCH_FLAG, ...rest });
}

/** Parche sobre techo, capó o baúl, proyectado desde arriba. */
export function patchTop(batch, body, { x0, x1, z0, z1, cols = 3, rows = 2, off = .006, rect = null, mirror = false, uvFn = null, ...rest }) {
  const fn = (i, j) => {
    const x = lerp(x0, x1, i / cols), z = lerp(z0, z1, j / rows);
    return [x, body.topY(x, z) + off, z];
  };
  addGrid(batch, cols, rows, fn, { uv: uvFn ?? (rect ? (u, v) => rectUv(rect, u, v) : null), mirror, out: [0, 1, 0], ...rest });
}

/** Geometría de Three (caja, cilindro…) volcada al lote, ya transformada. */
export function addGeo(batch, geometry, { color = COLOR.trim, metal = 0, lamp = 0, uv = null, matrix = null, position = null, rotation = null, scale = null, mirror = false } = {}) {
  if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
  if (scale) geometry.scale(...scale);
  if (position) geometry.translate(...position);
  if (matrix) geometry.applyMatrix4(matrix);
  const p = geometry.attributes.position, n = geometry.attributes.normal, tuv = geometry.attributes.uv, idx = geometry.index;
  for (const side of mirror ? [1, -1] : [1]) {
    const base = batch.count;
    for (let i = 0; i < p.count; i++) {
      const t = uv ? uv(tuv ? tuv.getX(i) : 0, tuv ? tuv.getY(i) : 0) : WHITE;
      const c = typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : color;
      batch.v(p.getX(i), p.getY(i), p.getZ(i) * side, n.getX(i), n.getY(i), n.getZ(i) * side, t[0], t[1], c[0], c[1], c[2], metal, lamp);
    }
    const count = idx ? idx.count : p.count;
    for (let i = 0; i < count; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      if (side > 0) batch.tri(base + a, base + b, base + c); else batch.tri(base + a, base + c, base + b);
    }
  }
  geometry.dispose();
}

export const box = (batch, size, position, opts = {}) => addGeo(batch, new THREE.BoxGeometry(...size), { position, ...opts });

/** Barra de sección rectangular entre dos puntos. */
export function bar(batch, a, b, w, d, opts = {}) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), dir = end.clone().sub(start), len = dir.length();
  const g = new THREE.BoxGeometry(w, len, d);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(...start.add(end).multiplyScalar(.5).toArray());
  addGeo(batch, g, opts);
}

/** Tubo de pocos lados entre dos puntos (escape, antena, barras). */
export function tube(batch, a, b, r, segments = 6, opts = {}) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), dir = end.clone().sub(start), len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, segments, 1, opts.open ?? false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(...start.add(end).multiplyScalar(.5).toArray());
  const { open, ...rest } = opts;
  addGeo(batch, g, rest);
}

/** Forro negro del paso de rueda: el hueco se ve hondo y oscuro, no se ve a través del carro. */
export function addWheelWells(batch, body) {
  const { axleF, axleR, archR, archY } = body.spec, R = archR - .004;
  for (const ax of [axleF, axleR]) {
    const hw = body.hw(ax), inner = Math.max(hw - .34, .25);
    const N = 7;
    addGrid(batch, N, 1, (i, j) => {
      const a = Math.PI * i / N;
      return [ax + R * Math.cos(a), archY + R * Math.sin(a), j ? hw - .004 : inner];
    }, { color: COLOR.liner, out: [0, -1, 0] });
    // Pared interior: se ve por encima y detrás de la llanta.
    addGrid(batch, N, 1, (i, j) => {
      const a = Math.PI * i / N;
      return j ? [ax + R * Math.cos(a), archY + R * Math.sin(a), inner] : [ax + R * Math.cos(a), archY - .12, inner];
    }, { color: COLOR.liner, out: [0, 0, 1] });
  }
}

// ===== Ruedas =====

/**
 * Rueda vista desde +Z: neumático con flanco y banda, rin hondo y disco con el diseño del atlas.
 * La cara interior es una tapa oscura: sin ella, la rueda del lado lejano se ve como una media luna bajo el carro.
 */
export function makeWheelGeometry({ r, width, rim = 'rimTapa', depth = .022, spokes = 0, rimRatio = .66, tireColor = '#141517', outward = 1, segments = 22, rimSegments = 16 }) {
  const b = new Batch();
  const hw = width / 2, Rr = r * rimRatio, TAU = Math.PI * 2;
  const tire = srgb(tireColor), wall = srgb('#1b1c1e'), rimC = srgb('#b9bdc1'), dark = srgb('#060607');
  // Perfil del neumático, de la pestaña del rin a la banda. El contorno es lo que más delata una rueda: se le
  // dan más lados y se quitan anillos que casi no se ven, para que el costo no suba.
  const profile = [
    [Rr + .004, hw - .012, wall, 0], [Rr + (r - Rr) * .5, hw + .002, wall, 0],
    [r - .012, hw - .022, tire, 0], [r, hw - .05, tire, 0], [r, -hw + .03, tire, 0],
  ];
  const ring = (p0, p1, sides = segments) => {
    const base = b.count, dr = p1[0] - p0[0], dz = p1[1] - p0[1], len = Math.hypot(dr, dz) || 1;
    // Normal del tramo del perfil: perpendicular, hacia afuera de la rueda.
    const nr = -dz / len, nz = dr / len;
    for (let i = 0; i <= sides; i++) {
      const a = TAU * i / sides, c = Math.cos(a), s = Math.sin(a);
      b.v(p0[0] * c, p0[0] * s, p0[1], nr * c, nr * s, nz, WHITE[0], WHITE[1], p0[2][0], p0[2][1], p0[2][2], p0[3]);
      b.v(p1[0] * c, p1[0] * s, p1[1], nr * c, nr * s, nz, WHITE[0], WHITE[1], p1[2][0], p1[2][1], p1[2][2], p1[3]);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      b.quad(a, a + 1, a + 3, a + 2);
    }
  };
  for (let i = 0; i < profile.length - 1; i++) ring(profile[i], profile[i + 1]);
  const cap = b.count;
  for (let i = 0; i < 12; i++) {
    const a = TAU * i / 12;
    b.v(r * .99 * Math.cos(a), r * .99 * Math.sin(a), -hw + .03, 0, 0, -1, WHITE[0], WHITE[1], dark[0], dark[1], dark[2], 0);
  }
  for (let i = 1; i < 11; i++) b.tri(cap, cap + i + 1, cap + i);
  // Pestaña brillante y barril hondo del rin.
  const lipFront = hw - .012, floor = lipFront - depth;
  ring([Rr * .99, floor, srgb('#26282b'), .2], [Rr * 1.02, lipFront - .004, rimC, .85], rimSegments);
  ring([Rr * 1.02, lipFront - .004, rimC, .85], [Rr + .006, lipFront, rimC, .85], rimSegments);
  // Disco con el dibujo del rin.
  const rect = RECT[rim] ?? RECT.rimTapa, RD = Rr * .99;
  const base = b.count;
  const centerUv = rectUv(rect, .5, .5);
  b.v(0, 0, floor, 0, 0, 1, centerUv[0], centerUv[1], 1, 1, 1, .55);
  for (let i = 0; i <= rimSegments; i++) {
    const a = TAU * i / rimSegments, c = Math.cos(a), s = Math.sin(a), t = rectUv(rect, .5 + .5 * c, .5 - .5 * s);
    b.v(RD * c, RD * s, floor, 0, 0, 1, t[0], t[1], 1, 1, 1, .55);
  }
  for (let i = 0; i < rimSegments; i++) b.tri(base, base + 1 + i, base + 2 + i);
  // Rayos en relieve: la luz del sol los separa del fondo.
  for (let k = 0; k < spokes; k++) {
    const a = k * TAU / spokes - Math.PI / 2, c = Math.cos(a), s = Math.sin(a), dirX = c, dirY = s, px = -s, py = c;
    const r0 = Rr * .2, r1 = Rr * .96, w0 = Rr * (spokes > 5 ? .065 : .1), w1 = Rr * (spokes > 5 ? .055 : .085), zb = floor + .002, zt = lipFront - .006;
    const q = [
      [dirX * r0 + px * w0, dirY * r0 + py * w0], [dirX * r1 + px * w1, dirY * r1 + py * w1],
      [dirX * r1 - px * w1, dirY * r1 - py * w1], [dirX * r0 - px * w0, dirY * r0 - py * w0],
    ];
    const m = rimC, ba = b.count;
    for (const [x, y] of q) b.v(x, y, zt, 0, 0, 1, WHITE[0], WHITE[1], m[0], m[1], m[2], .8);
    b.quad(ba, ba + 1, ba + 2, ba + 3);
    // Lados del rayo.
    for (const [i0, i1, nx, ny] of [[0, 1, px, py], [2, 3, -px, -py]]) {
      const bb = b.count;
      b.v(q[i0][0], q[i0][1], zt, nx, ny, 0, WHITE[0], WHITE[1], m[0] * .7, m[1] * .7, m[2] * .7, .7);
      b.v(q[i1][0], q[i1][1], zt, nx, ny, 0, WHITE[0], WHITE[1], m[0] * .7, m[1] * .7, m[2] * .7, .7);
      b.v(q[i1][0], q[i1][1], zb, nx, ny, 0, WHITE[0], WHITE[1], dark[0], dark[1], dark[2], 0);
      b.v(q[i0][0], q[i0][1], zb, nx, ny, 0, WHITE[0], WHITE[1], dark[0], dark[1], dark[2], 0);
      b.quad(bb, bb + 3, bb + 2, bb + 1);
    }
  }
  if (spokes) {
    // Maza en relieve.
    const hub = b.count, m = rimC, rh = Rr * .24, zh = lipFront - .004;
    b.v(0, 0, zh, 0, 0, 1, WHITE[0], WHITE[1], m[0], m[1], m[2], .85);
    for (let i = 0; i <= 8; i++) { const a = TAU * i / 8; b.v(rh * Math.cos(a), rh * Math.sin(a), zh, 0, 0, 1, WHITE[0], WHITE[1], m[0], m[1], m[2], .85); }
    for (let i = 0; i < 8; i++) b.tri(hub, hub + 1 + i, hub + 2 + i);
  }
  // El lado izquierdo usa una copia en espejo: la cara con diseño queda siempre hacia afuera.
  if (outward < 0) {
    for (let i = 2; i < b.P.length; i += 3) b.P[i] = -b.P[i];
    for (let i = 2; i < b.N.length; i += 3) b.N[i] = -b.N[i];
    for (let i = 0; i < b.I.length; i += 3) { const t = b.I[i + 1]; b.I[i + 1] = b.I[i + 2]; b.I[i + 2] = t; }
  }
  return b.toGeometry(`Rueda ${rim}`);
}
