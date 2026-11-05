import * as THREE from 'three';
import { chainSunField } from './SunFieldShader.js';

// Semáforo de Bogotá hecho por código: una sola geometría compartida por las
// instancias de cada sector. Origen en la base, a nivel de calzada. +X es el rumbo
// del conductor (las luces miran a −X) y −Z sale sobre la calzada: el poste le
// queda a la derecha. InstancedMesh no admite espejos, y aquí no hacen falta.
export const SIGNAL_POLE = Object.freeze({
  radius: .068, top: 6.6, baseY: .13,
  reach: 3.5, armLength: 3.95, // del poste al centro del carril y a la punta del brazo
  headY: 5.45, lowHeadY: 3.2, pedY: 2.42
});

/** Códigos del atributo por vértice: qué luz es cada triángulo. */
export const LENS = Object.freeze({
  NONE: 0, RED: 1, AMBER: 2, GREEN: 3,
  // Peatonal: «paralelo» sigue el eje del poste; «cruzado», el otro.
  STOP_PARALLEL: 4, WALK_PARALLEL: 5, STOP_CROSS: 6, WALK_CROSS: 7,
  RETRO: 8, DECAL_SET: 9
});

/** La misma regla del shader, para comprobarla sin GPU. `states` = [eje 0, eje 1]. */
export function lensLit(code, axis, states) {
  const own = states[axis], cross = states[1 - axis];
  if (code === LENS.RED) return own === 2;
  if (code === LENS.AMBER) return own === 1;
  if (code === LENS.GREEN) return own === 0;
  if (code === LENS.STOP_PARALLEL) return own !== 0;
  if (code === LENS.WALK_PARALLEL) return own === 0;
  if (code === LENS.STOP_CROSS) return cross !== 0;
  if (code === LENS.WALK_CROSS) return cross === 0;
  return false;
}

// ---------- atlas ----------

const ATLAS = 256;
const cell = (x0, y0, x1, y1) => ({ u0: (x0 + .5) / ATLAS, v0: (y0 + .5) / ATLAS, u1: (x1 - .5) / ATLAS, v1: (y1 - .5) / ATLAS });
const WHITE_TEXEL = { u0: 252.5 / ATLAS, v0: 252.5 / ATLAS, u1: 252.5 / ATLAS, v1: 252.5 / ATLAS };
const CELLS = {
  zocalo: cell(0, 0, 128, 128),
  galv: cell(128, 0, 256, 128),
  box: cell(0, 128, 128, 192),
  rust: cell(0, 192, 64, 256),
  concrete: cell(64, 192, 128, 256),
  white: WHITE_TEXEL, // un solo texel blanco: el color lo da el vértice
  decal: i => cell(128 + 32 * (i % 4), 128 + 32 * (i >> 2), 160 + 32 * (i % 4), 160 + 32 * (i >> 2))
};

export function createRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruido de valor periódico en X: la franja da la vuelta al poste sin costura.
export function createNoise(seed) {
  const random = createRandom(seed), table = Float32Array.from({ length: 4096 }, () => random());
  const at = (x, y, period) => table[((((x % period) + period) % period) * 73 + y * 179) & 4095];
  const smooth = t => t * t * (3 - 2 * t);
  const value = (x, y, period) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const a = at(ix, iy, period), b = at(ix + 1, iy, period), c = at(ix, iy + 1, period), d = at(ix + 1, iy + 1, period);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, period) => (value(x, y, period) * 4 + value(x * 2, y * 2, period * 2) * 2 + value(x * 4, y * 4, period * 4)) / 7;
}

export const mix = (a, b, t) => a + (b - a) * t;
export const ramp = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Sin canvas: funciona igual en Node y deja el mismo resultado en cada partida. */
export function createSignalAtlas() {
  const data = new Uint8Array(ATLAS * ATLAS * 4).fill(255);
  const noise = createNoise(0x5e3a), random = createRandom(0xb0607a);
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= ATLAS || y >= ATLAS) return;
    const i = (y * ATLAS + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  };
  const read = (x, y) => { const i = (y * ATLAS + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const mixInto = (x, y, r, g, b, t) => {
    if (x < 0 || y < 0 || x >= ATLAS || y >= ATLAS) return;
    const [pr, pg, pb] = read(x, y);
    put(x, y, mix(pr, r, t), mix(pg, g, t), mix(pb, b, t));
  };

  // Zócalo: pintura oscura gastada, franja amarilla arriba, óxido y salpicado de calle abajo.
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const u = x / 128, h = y / 127;
    const blot = noise(u * 8, h * 5, 8), chip = noise(u * 24 + 3, h * 18, 24), rust = noise(u * 10 + 7, h * 9 + 2, 10);
    let r = 40 + blot * 22, g = 43 + blot * 22, b = 44 + blot * 20;
    const band = ramp(.76, .775, h) * (1 - ramp(.92, .935, h));
    if (band > 0) { const v = .72 + blot * .4; r = mix(r, 205 * v, band); g = mix(g, 166 * v, band); b = mix(b, 36 * v, band); }
    // El desconchado deja ver metal gris y, más abajo, óxido.
    const wear = chip - mix(.6, .7, ramp(0, .5, h)) + (h > .93 ? .08 : 0);
    if (wear > 0) { const t = ramp(0, .06, wear); r = mix(r, 122, t); g = mix(g, 122, t); b = mix(b, 118, t); }
    // El óxido nace en lo desconchado y cerca del piso; es café oscuro, no naranja.
    const oxide = ramp(.46, .66, rust + (1 - ramp(0, .3, h)) * .22) * ramp(-.08, .04, wear + (1 - h) * .16);
    r = mix(r, 58 + rust * 36, oxide); g = mix(g, 38 + rust * 20, oxide); b = mix(b, 26 + rust * 10, oxide);
    const splash = (1 - ramp(0, .14, h)) * (.5 + blot * .5);
    r = mix(r, 104, splash * .6); g = mix(g, 100, splash * .6); b = mix(b, 92, splash * .6);
    put(x, y, r, g, b);
  }
  for (let i = 0; i < 46; i++) { // rayones horizontales de bolsas, bicicletas y patadas
    const y = Math.floor(random() * 96), x0 = Math.floor(random() * 128), length = 6 + random() * 26, tone = 110 + random() * 60;
    for (let k = 0; k < length; k++) mixInto((x0 + k) % 128, y + (k >> 4), tone, tone, tone - 6, .45);
  }

  // Galvanizado: moteado de zinc, chorreones verticales y gotas de óxido.
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const u = x / 128, h = y / 127;
    const spangle = noise(u * 16, h * 6, 16), grain = noise(u * 48, h * 22, 48), streak = noise(u * 22 + 5, h * 1.4, 22);
    const v = 118 + spangle * 58 + grain * 16 - ramp(.45, .75, streak) * 34;
    put(128 + x, y, v * .97, v, v * 1.01);
  }
  for (let i = 0; i < 11; i++) {
    const x0 = Math.floor(random() * 128), y0 = 20 + Math.floor(random() * 104), length = 16 + random() * 40, strength = .25 + random() * .4;
    for (let k = 0; k < length; k++) {
      const fade = (1 - k / length) * strength;
      mixInto(128 + (x0 % 128), y0 - k, 78, 52, 34, fade);
      mixInto(128 + ((x0 + 1) % 128), y0 - k, 78, 52, 34, fade * .6);
    }
  }

  // Gabinete: lámina pintada, con mugre bajando y la puerta marcada.
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const u = x / 128, h = y / 63;
    const blot = noise(u * 6 + 11, h * 4 + 5, 6), drip = noise(u * 30, h * 2.2 + 9, 30);
    const v = 142 + blot * 40 - ramp(.5, .8, drip) * (1 - h) * 44;
    put(x, 128 + y, v * .98, v * .99, v * .92);
  }
  for (let x = 0; x < 128; x++) for (const y of [3, 60]) mixInto(x, 128 + y, 30, 30, 30, .8);
  for (let y = 3; y < 61; y++) for (const x of [5, 122]) mixInto(x, 128 + y, 30, 30, 30, .8);

  // Óxido suelto para tornillos y base.
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const n = noise(x / 5 + 2, y / 5 + 13, 64);
    put(x, 192 + y, 52 + n * 50, 36 + n * 28, 26 + n * 14);
  }

  // Dado de concreto: más oscuro que el andén y manchado hacia la platina.
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const n = noise(x / 6 + 31, y / 6 + 3, 64), fine = noise(x / 1.6 + 7, y / 1.6, 64);
    const stain = 1 - ramp(.25, .95, Math.hypot(x - 31.5, y - 31.5) / 32);
    const v = (126 + n * 42 + fine * 16) * (1 - stain * .3);
    put(64 + x, 192 + y, v, v * .985, v * .94);
  }

  // Calcomanías y restos de cartel, sin textos legibles: renglones y manchas.
  const rows = (x, y, w, h, color, gap = 4, fill = .9) => {
    for (let row = 0; row < h; row += gap) {
      const stop = x + Math.floor(w * (.55 + random() * .45) * fill);
      for (let px = x; px < stop; px++) {
        if (random() < .16) continue;
        put(px, y + row, ...color); put(px, y + row + 1, ...color);
      }
    }
  };
  const designs = [
    { bg: [232, 230, 220], draw: (x, y) => { rows(x + 3, y + 5, 26, 22, [24, 24, 26]); } },
    { bg: [232, 190, 34], draw: (x, y) => { for (let a = 0; a < 200; a++) { const t = a / 200 * Math.PI * 2; put(Math.round(x + 16 + Math.cos(t) * 7), Math.round(y + 20 + Math.sin(t) * 7), 20, 20, 20); } rows(x + 4, y + 4, 24, 6, [20, 20, 20], 3); } },
    { bg: [186, 40, 34], draw: (x, y) => { for (let px = 2; px < 30; px++) for (let py = 12; py < 20; py++) put(x + px, y + py, 240, 236, 228); rows(x + 5, y + 14, 22, 4, [186, 40, 34], 3); } },
    { bg: [30, 72, 150], draw: (x, y) => { rows(x + 4, y + 6, 24, 20, [236, 238, 240], 5); } },
    { bg: [208, 202, 182], draw: (x, y) => { for (let px = 1; px < 31; px++) for (let py = 22; py < 31; py++) put(x + px, y + py, 44, 120, 74); rows(x + 4, y + 3, 24, 16, [46, 42, 40], 3); } },
    { bg: [22, 22, 24], draw: (x, y) => { let py = 16; for (let px = 3; px < 29; px++) { py += Math.round(random() * 4 - 2); py = Math.max(5, Math.min(27, py)); put(x + px, y + py, 232, 232, 232); put(x + px, y + py + 1, 232, 232, 232); } } },
    { bg: [240, 136, 28], draw: (x, y) => { rows(x + 4, y + 5, 24, 22, [26, 22, 18], 6); } },
    { bg: [236, 236, 232], draw: (x, y) => { for (let px = 1; px < 31; px++) for (let py = 24; py < 31; py++) put(x + px, y + py, 196, 44, 40); rows(x + 4, y + 4, 24, 16, [30, 30, 34], 4); } }
  ];
  for (let i = 0; i < 16; i++) {
    const cx = 128 + 32 * (i % 4), cy = 128 + 32 * (i >> 2), design = designs[i % designs.length];
    const fade = i < 8 ? .9 : .66; // la segunda tanda está más lavada por sol y lluvia
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const n = noise(cx / 7 + x / 9, cy / 7 + y / 9, 128) * .36 + .82;
      put(cx + x, cy + y, ...design.bg.map(value => mix(170, value, fade) * n));
    }
    design.draw(cx, cy);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { // bordes rotos y mugre
      if (noise(cx / 3 + x / 3, cy / 3 + y / 3, 256) > .68) mixInto(cx + x, cy + y, 142, 140, 130, .7);
    }
  }
  for (let y = 248; y < 256; y++) for (let x = 248; x < 256; x++) put(x, y, 255, 255, 255);

  const texture = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
}

// ---------- geometría ----------

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
const color = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

export class SignalMesher {
  constructor() {
    this.position = []; this.normal = []; this.color = []; this.uv = [];
    this.surface = []; this.lens = []; this.lensUv = []; this.index = [];
    this.frame = new THREE.Matrix4();
    this.normalFrame = new THREE.Matrix3();
    this.lamps = [];
    this.paint = null;
  }

  within(matrix, draw) {
    const previous = this.frame.clone();
    this.frame.multiply(matrix);
    this.normalFrame.getNormalMatrix(this.frame);
    draw();
    this.frame.copy(previous);
    this.normalFrame.getNormalMatrix(previous);
  }

  /** `u` y `v` van de 0 a 1 dentro de la celda de la pintura actual. */
  vertex(x, y, z, nx, ny, nz, u = .5, v = .5, lensU = 0, lensV = 0) {
    const { paint } = this;
    _a.set(x, y, z).applyMatrix4(this.frame);
    _n.set(nx, ny, nz).applyMatrix3(this.normalFrame).normalize();
    this.position.push(_a.x, _a.y, _a.z);
    this.normal.push(_n.x, _n.y, _n.z);
    this.color.push(...paint.rgb);
    this.uv.push(mix(paint.cell.u0, paint.cell.u1, u), mix(paint.cell.v0, paint.cell.v1, v));
    this.surface.push(paint.rough, paint.metal);
    this.lens.push(paint.lens);
    this.lensUv.push(lensU, lensV);
    return this.lens.length - 1;
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute('signalSurface', new THREE.Float32BufferAttribute(this.surface, 2));
    geometry.setAttribute('signalLens', new THREE.Float32BufferAttribute(this.lens, 1));
    geometry.setAttribute('signalLensUv', new THREE.Float32BufferAttribute(this.lensUv, 2));
    geometry.setIndex(this.index);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  /** Orienta cada triángulo con sus normales: evita revisar a mano cada recorrido. */
  tri(a, b, c) {
    const p = this.position, n = this.normal;
    _a.set(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
    _b.set(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]).sub(_a);
    _c.set(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]).sub(_a);
    _b.cross(_c);
    const facing = _b.x * (n[a * 3] + n[b * 3] + n[c * 3]) + _b.y * (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1]) + _b.z * (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
    if (facing >= 0) this.index.push(a, b, c); else this.index.push(a, c, b);
  }

  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  /** Polígono convexo plano. Cada punto: [x, y, z, u?, v?, lensU?, lensV?]. */
  flat(points, normal) {
    const ids = points.map(([x, y, z, u, v, lu, lv]) => this.vertex(x, y, z, ...normal, u ?? .5 + z * .9, v ?? .5 + y * .7, lu, lv));
    for (let i = 1; i < ids.length - 1; i++) this.tri(ids[0], ids[i], ids[i + 1]);
  }

  box(cx, cy, cz, sx, sy, sz, skip = '') {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const face = (name, normal, a, b, c, d) => {
      if (skip.includes(name)) return;
      this.flat([[...a, 0, 0], [...b, 1, 0], [...c, 1, 1], [...d, 0, 1]], normal);
    };
    face('l', [-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    face('r', [1, 0, 0], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    face('b', [0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    face('t', [0, 1, 0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    face('n', [0, 0, -1], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    face('f', [0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  }

  /** Tubo con marco de transporte paralelo, sin torsión en las curvas. */
  sweep(points, radius, segments, { capStart = false, capEnd = false, vStart = 0, vEnd = 1 } = {}) {
    const count = points.length, radii = points.map((_, i) => Array.isArray(radius) ? radius[i] : radius);
    const lengths = [0];
    for (let i = 1; i < count; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    const total = lengths[count - 1] || 1;
    const tangent = new THREE.Vector3(), previousTangent = new THREE.Vector3(), turn = new THREE.Quaternion();
    const normal = new THREE.Vector3(), binormal = new THREE.Vector3(), direction = new THREE.Vector3();
    const rings = [];
    for (let i = 0; i < count; i++) {
      tangent.subVectors(points[Math.min(count - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
      if (i === 0) {
        normal.set(Math.abs(tangent.y) > .9 ? 1 : 0, Math.abs(tangent.y) > .9 ? 0 : 1, 0);
        normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
      } else {
        turn.setFromUnitVectors(previousTangent, tangent);
        normal.applyQuaternion(turn).normalize();
      }
      previousTangent.copy(tangent);
      binormal.crossVectors(tangent, normal);
      const span = lengths[Math.min(count - 1, i + 1)] - lengths[Math.max(0, i - 1)] || 1;
      const slope = (radii[Math.min(count - 1, i + 1)] - radii[Math.max(0, i - 1)]) / span;
      const ring = [];
      for (let k = 0; k <= segments; k++) {
        const angle = k / segments * Math.PI * 2;
        direction.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle));
        const px = points[i].x + direction.x * radii[i], py = points[i].y + direction.y * radii[i], pz = points[i].z + direction.z * radii[i];
        _c.copy(direction).addScaledVector(tangent, -slope).normalize();
        ring.push(this.vertex(px, py, pz, _c.x, _c.y, _c.z, k / segments, mix(vStart, vEnd, lengths[i] / total)));
      }
      rings.push(ring);
      if ((i === 0 && capStart) || (i === count - 1 && capEnd)) {
        const flip = i === 0 ? -1 : 1;
        const center = this.vertex(points[i].x, points[i].y, points[i].z, tangent.x * flip, tangent.y * flip, tangent.z * flip);
        const edge = ring.map(id => this.vertex(this.localOf(id, 0), this.localOf(id, 1), this.localOf(id, 2), tangent.x * flip, tangent.y * flip, tangent.z * flip));
        for (let k = 0; k < segments; k++) this.tri(center, edge[k], edge[k + 1]);
      }
    }
    for (let i = 0; i < count - 1; i++) for (let k = 0; k < segments; k++) {
      this.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
    }
  }

  // Las tapas reutilizan el anillo, ya transformado: se deshace el marco para no aplicarlo dos veces.
  localOf(id, axis) {
    _b.set(this.position[id * 3], this.position[id * 3 + 1], this.position[id * 3 + 2]);
    _b.applyMatrix4(_inverse.copy(this.frame).invert());
    return _b.getComponent(axis);
  }

  /** Extruye un contorno frontal (plano Y-Z) a lo largo de X. */
  prism(outline, cy, cz, xFront, xBack, { front = true, back = true, sides = true, v0 = 0, v1 = 1 } = {}) {
    const ids = [];
    if (sides) {
      outline.forEach(p => ids.push([
        this.vertex(xFront, cy + p.y, cz + p.z, 0, p.ny, p.nz, .5 + (p.z + p.y) * .6, v0),
        this.vertex(xBack, cy + p.y, cz + p.z, 0, p.ny, p.nz, .5 + (p.z + p.y) * .6, v1)
      ]));
      for (let i = 0; i < outline.length; i++) {
        const j = (i + 1) % outline.length;
        this.quad(ids[i][0], ids[i][1], ids[j][1], ids[j][0]);
      }
    }
    if (front) this.flat(outline.map(p => [xFront, cy + p.y, cz + p.z]), [-1, 0, 0]);
    if (back) this.flat(outline.map(p => [xBack, cy + p.y, cz + p.z]), [1, 0, 0]);
  }

  /** Lente con domo: centro y anillos, con el centro más cerca del conductor. */
  dome(cy, cz, x, radius, segments, rings, bulge) {
    const code = this.paint.lens;
    const facing = _a.set(-1, 0, 0).applyMatrix3(this.normalFrame).normalize().clone();
    const center = _a.set(x, cy, cz).applyMatrix4(this.frame).clone();
    this.lamps.push({ code, center, normal: facing, size: radius });
    let previous = null;
    for (let ring = 0; ring < rings.length; ring++) {
      const t = rings[ring], radial = t * radius;
      const bx = x - bulge * (1 - t * t);
      const ids = [];
      if (t === 0) ids.push(this.vertex(bx, cy, cz, -1, 0, 0, .5, .5, 0, 0));
      else for (let k = 0; k <= segments; k++) {
        const angle = k / segments * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
        const tilt = t * bulge / radius * 2;
        ids.push(this.vertex(bx, cy + sin * radial, cz + cos * radial, -1, sin * tilt, cos * tilt, .5, .5, cos * t, sin * t));
      }
      if (previous) {
        if (previous.length === 1) for (let k = 0; k < segments; k++) this.tri(previous[0], ids[k], ids[k + 1]);
        else for (let k = 0; k < segments; k++) this.quad(previous[k], ids[k], ids[k + 1], previous[k + 1]);
      }
      previous = ids;
    }
  }
}

const _inverse = new THREE.Matrix4();

/** Contorno de rectángulo con esquinas redondas en el plano Y-Z. */
export function roundedRect(width, height, radius, steps) {
  const points = [], w = width / 2 - radius, h = height / 2 - radius;
  [[w, h, 0], [-w, h, Math.PI / 2], [-w, -h, Math.PI], [w, -h, Math.PI * 1.5]].forEach(([cz, cy, start]) => {
    for (let i = 0; i <= steps; i++) {
      const angle = start + i / steps * Math.PI / 2, nz = Math.cos(angle), ny = Math.sin(angle);
      points.push({ z: cz + nz * radius, y: cy + ny * radius, nz, ny });
    }
  });
  return points;
}

const paint = (hex, rough, metal, cellRegion = CELLS.white, lens = LENS.NONE) => ({ rgb: color(hex), rough, metal, cell: cellRegion, lens });

// Colores apagados: oscuros, pero con su tono.
const PAINT = {
  galv: paint('#ffffff', .5, .32, CELLS.galv),
  galvDark: paint('#c8cbcb', .58, .3, CELLS.galv),
  zocalo: paint('#ffffff', .68, .05, CELLS.zocalo),
  rust: paint('#ffffff', .88, .1, CELLS.rust),
  concrete: paint('#ffffff', .95, 0, CELLS.concrete),
  housing: paint('#3a3b3c', .56, .02, CELLS.box),
  housingInner: paint('#070708', .8, 0),
  plate: paint('#1f2021', .7, .05, CELLS.box),
  plateBack: paint('#6f7273', .68, .3, CELLS.box),
  retro: { ...paint('#f7c414', .52, 0, CELLS.box, LENS.RETRO), rgb: color('#f7c414').map(value => value * 2.1) },
  clamp: paint('#6e7274', .5, .6),
  box: paint('#ffffff', .62, .2, CELLS.box),
  boxDark: paint('#2b2d2e', .55, .3),
  cable: paint('#101112', .7, 0),
  buttonBody: paint('#d9a914', .55, .05),
  buttonFace: paint('#20201f', .4, .3),
  windowGlass: paint('#050606', .28, 0),
  lens: {
    [LENS.RED]: paint('#520b06', .16, 0, CELLS.white, LENS.RED),
    [LENS.AMBER]: paint('#5a3a05', .16, 0, CELLS.white, LENS.AMBER),
    [LENS.GREEN]: paint('#06402a', .16, 0, CELLS.white, LENS.GREEN)
  }
};

function vehicleHead(m, { plate = false, cornerSteps = 2 } = {}) {
  const width = .4, module = .36, depth = .2, radius = .138, xFront = -depth / 2;
  m.paint = PAINT.housing;
  const outline = roundedRect(width, module - .01, .04, cornerSteps);
  [LENS.RED, LENS.AMBER, LENS.GREEN].forEach((code, i) => {
    const y = module * (1 - i);
    m.paint = PAINT.housing;
    m.prism(outline, y, 0, xFront, depth / 2);
    // Bisagra y cierre: rompen la caja lisa cuando se mira de lado.
    m.box(0, y + .06, -width / 2 - .006, .05, .05, .012, 'rf');
    m.box(0, y - .06, -width / 2 - .006, .05, .05, .012, 'rf');
    m.box(0, y, width / 2 + .006, .05, .07, .012, 'ln');
    m.paint = PAINT.lens[code];
    // El domo no necesita más anillos: normal y UV de la lente varían linealmente con el radio.
    m.dome(y, 0, xFront - .002, radius, 12, [0, 1], .028);
    visor(m, y, 0, xFront, radius + .01, .2, 9);
  });
  if (plate) backPlate(m, depth / 2 - .025);
}

/** Visera recortada: larga arriba, corta a los lados y abierta por debajo. */
function visor(m, cy, cz, xBack, radius, depth, segments) {
  const start = -.42, end = Math.PI + .42, wall = .007;
  const reach = angle => depth * (.3 + .7 * ramp(-.35, .92, Math.sin(angle)));
  const outer = [], inner = [], lipOuter = [], lipInner = [];
  for (let k = 0; k <= segments; k++) {
    const angle = mix(start, end, k / segments), cos = Math.cos(angle), sin = Math.sin(angle), d = reach(angle);
    // Se abre un poco hacia afuera, como las viseras moldeadas.
    const flare = radius * 1.05;
    m.paint = PAINT.housing;
    outer.push([
      m.vertex(xBack, cy + sin * (radius + wall), cz + cos * (radius + wall), 0, sin, cos),
      m.vertex(xBack - d, cy + sin * (flare + wall), cz + cos * (flare + wall), 0, sin, cos)
    ]);
    lipOuter.push(m.vertex(xBack - d, cy + sin * (flare + wall), cz + cos * (flare + wall), -1, 0, 0));
    lipInner.push(m.vertex(xBack - d, cy + sin * flare, cz + cos * flare, -1, 0, 0));
    m.paint = PAINT.housingInner;
    inner.push([
      m.vertex(xBack, cy + sin * radius, cz + cos * radius, 0, -sin, -cos),
      m.vertex(xBack - d, cy + sin * flare, cz + cos * flare, 0, -sin, -cos)
    ]);
  }
  for (let k = 0; k < segments; k++) {
    m.quad(outer[k][0], outer[k][1], outer[k + 1][1], outer[k + 1][0]);
    m.quad(inner[k][0], inner[k][1], inner[k + 1][1], inner[k + 1][0]);
    m.quad(lipOuter[k], lipInner[k], lipInner[k + 1], lipOuter[k + 1]);
  }
}

/** Contraplaca negra con borde amarillo retrorreflectivo. */
function backPlate(m, x, { steps = 2, sides = true } = {}) {
  const outer = roundedRect(.76, 1.36, .06, steps), inner = roundedRect(.65, 1.25, .035, steps), y = .0;
  m.paint = PAINT.retro;
  const front = outer.map(p => m.vertex(x, y + p.y, p.z, -1, 0, 0, .5 + p.z * .9, .5 + p.y * .7));
  const rim = inner.map(p => m.vertex(x, y + p.y, p.z, -1, 0, 0, .5 + p.z * .9, .5 + p.y * .7));
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    m.quad(front[i], rim[i], rim[j], front[j]);
  }
  m.paint = PAINT.plate;
  m.flat(inner.map(p => [x - .001, y + p.y, p.z]), [-1, 0, 0]);
  m.paint = PAINT.plateBack;
  m.prism(outer, y, 0, x + .0005, x + .012, { front: false, sides });
}

/** Figura peatonal en una ventana: se dibuja con polígonos para seguir nítida. */
function pedFigure(m, cy, x, walking) {
  const scale = .1;
  const lens = (y, z) => [y / scale, z / scale];
  const limb = (z0, y0, z1, y1, thick) => {
    const dz = z1 - z0, dy = y1 - y0, length = Math.hypot(dz, dy) || 1, ny = dz / length * thick / 2, nz = -dy / length * thick / 2;
    const corner = (z, y) => [x, cy + y, z, .5, .5, ...lens(z, y)];
    m.flat([corner(z0 - nz, y0 - ny), corner(z1 - nz, y1 - ny), corner(z1 + nz, y1 + ny), corner(z0 + nz, y0 + ny)], [-1, 0, 0]);
  };
  const head = (z, y, radius) => {
    const ring = [];
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, pz = z + Math.cos(a) * radius, py = y + Math.sin(a) * radius; ring.push([x, cy + py, pz, .5, .5, ...lens(pz, py)]); }
    m.flat(ring, [-1, 0, 0]);
  };
  if (walking) {
    head(.008, .071, .0165);
    limb(.004, .05, -.004, -.006, .032);       // torso inclinado
    limb(.002, .044, .04, .012, .012);         // brazo adelante
    limb(.004, .044, -.036, .01, .012);        // brazo atrás
    limb(-.004, -.004, .036, -.04, .016); limb(.036, -.04, .046, -.082, .014);    // pierna adelante
    limb(-.006, -.004, -.024, -.05, .016); limb(-.024, -.05, -.056, -.078, .014); // pierna atrás
  } else {
    head(0, .074, .0165);
    limb(0, .053, 0, -.006, .042);             // torso
    limb(.03, .05, .032, -.002, .013);         // brazos pegados
    limb(-.03, .05, -.032, -.002, .013);
    limb(.011, -.006, .012, -.082, .017);      // piernas juntas
    limb(-.011, -.006, -.012, -.082, .017);
  }
}

function pedHead(m, stopCode, walkCode) {
  const width = .28, height = .52, depth = .13, xFront = -depth / 2, spot = .225;
  m.paint = PAINT.housing;
  m.prism(roundedRect(width, height, .025, 1), 0, 0, xFront, depth / 2);
  for (const [code, y, walking] of [[stopCode, .125, false], [walkCode, -.125, true]]) {
    m.paint = PAINT.windowGlass;
    m.flat(roundedRect(spot, spot, .012, 1).map(p => [xFront - .001, y + p.y, p.z]), [-1, 0, 0]);
    const lit = walking ? '#07361f' : '#470c08';
    m.paint = paint(lit, .3, 0, CELLS.white, code);
    const facing = _a.set(-1, 0, 0).applyMatrix3(m.normalFrame).normalize().clone();
    m.lamps.push({ code, center: _a.set(xFront, y, 0).applyMatrix4(m.frame).clone(), normal: facing, size: .1 });
    pedFigure(m, y, xFront - .002, walking);
    // Tejadillo de cada ventana.
    m.paint = PAINT.housing;
    m.box(xFront - .05, y + spot / 2 + .004, 0, .1, .007, spot + .02, 'r');
    m.box(xFront - .03, y + spot / 2 - .03, -spot / 2 - .009, .06, .065, .006, 'nr');
    m.box(xFront - .03, y + spot / 2 - .03, spot / 2 + .009, .06, .065, .006, 'fr');
  }
}

function pushButton(m) {
  m.paint = PAINT.buttonBody;
  m.box(0, 0, 0, .05, .17, .09);
  m.paint = PAINT.buttonFace;
  m.box(-.026, -.02, 0, .004, .1, .07, 'r');
  m.paint = PAINT.clamp;
  m.sweep([new THREE.Vector3(-.03, -.02, 0), new THREE.Vector3(-.042, -.02, 0)], .023, 6, { capEnd: true });
}

/** Cada poste luce solo un juego de calcomanías según su posición: no se repiten iguales. */
function decal(m, set, index, y, angle, width, height, tilt = 0) {
  const steps = 3, radius = SIGNAL_POLE.radius + .0016, span = width / radius;
  m.paint = paint('#ffffff', .78, 0, CELLS.decal(index), set < 0 ? LENS.NONE : LENS.DECAL_SET + set);
  const ids = [];
  for (let i = 0; i <= steps; i++) {
    const a = angle + (i / steps - .5) * span, cos = Math.cos(a), sin = Math.sin(a), lift = (i / steps - .5) * tilt;
    ids.push([
      m.vertex(cos * radius, y - height / 2 + lift, sin * radius, cos, 0, sin, i / steps, 0),
      m.vertex(cos * radius, y + height / 2 + lift, sin * radius, cos, 0, sin, i / steps, 1)
    ]);
  }
  for (let i = 0; i < steps; i++) m.quad(ids[i][0], ids[i + 1][0], ids[i + 1][1], ids[i][1]);
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// El fuste es recto: su silueta no cambia con menos lados, y las normales suaves lo siguen mostrando redondo.
const POLE_SIDES = 8;
// A esta distancia la cabeza mide ocho píxeles en baja, y el lote de ese cruce pasa al poste liviano.
export const FAR_SIGNAL_DISTANCE = 50;

// Ménsula: tubo que sube suave sobre la calzada.
const armY = d => 5.85 + .38 * (1 - (1 - d / SIGNAL_POLE.armLength) ** 2);

/** Devuelve la geometría del poste y la lista de lámparas para el resplandor. */
export function createSignalGeometry() {
  const m = new SignalMesher(), S = SIGNAL_POLE, R = S.radius, base = S.baseY;

  // Dado de concreto y platina con pernos: también tapa el desnivel en prados.
  m.paint = PAINT.concrete;
  m.box(0, base / 2, 0, .64, base, .64, 'b');
  m.paint = PAINT.clamp;
  m.box(0, base + .012, 0, .32, .024, .32, 'b');
  m.paint = PAINT.rust;
  for (const [x, z] of [[-.125, -.125], [.125, -.125], [-.125, .125], [.125, .125]]) {
    m.sweep([V(x, base + .024, z), V(x, base + .056, z)], .017, 6, { capEnd: true });
  }

  // Poste delgado de base ancha: zócalo pintado y fuste galvanizado.
  m.paint = PAINT.zocalo;
  m.sweep([V(0, base + .024, 0), V(0, base + .1, 0), V(0, base + .3, 0), V(0, 1.05, 0)], [.118, .092, .074, R], 10);
  m.paint = PAINT.galv;
  m.sweep([V(0, 1.05, 0), V(0, S.top, 0)], R, POLE_SIDES);
  m.paint = PAINT.galvDark;
  m.sweep([V(0, S.top, 0), V(0, S.top + .025, 0), V(0, S.top + .04, 0)], [R, R * .8, R * .35], 6, { capEnd: true, vStart: .9, vEnd: 1 });

  // Ménsula, con tirante hasta la punta del poste.
  const armPoint = d => V(0, armY(d), -d);
  m.paint = PAINT.galv;
  m.sweep([.0, .9, 1.7, 2.6, S.armLength].map(armPoint), [.062, .054, .05, .046, .042], 6, { capEnd: true });
  m.paint = PAINT.galvDark;
  m.sweep([V(0, 5.74, 0), V(0, 5.97, 0)], R + .012, POLE_SIDES, { capStart: true, capEnd: true });  // collar del brazo
  m.flat([[.01, 5.76, -R, 0, 0], [.01, armY(.34) - .03, -.34, 1, 0], [.01, armY(.02) - .02, -R, 1, 1]], [1, 0, 0]);
  m.flat([[-.01, 5.76, -R, 0, 0], [-.01, armY(.34) - .03, -.34, 1, 0], [-.01, armY(.02) - .02, -R, 1, 1]], [-1, 0, 0]);
  const tieTop = V(0, 6.5, -R), tieEnd = V(0, armY(2.05) + .03, -2.05);
  m.sweep([V(0, 6.46, 0), V(0, 6.54, 0)], R + .01, POLE_SIDES);
  m.paint = PAINT.clamp;
  m.sweep([tieTop, tieTop.clone().lerp(tieEnd, .44)], .014, 4);
  m.sweep([tieTop.clone().lerp(tieEnd, .44), tieTop.clone().lerp(tieEnd, .56)], .024, 4, { capStart: true, capEnd: true }); // templador
  m.sweep([tieTop.clone().lerp(tieEnd, .56), tieEnd], .014, 4);
  m.sweep([V(0, armY(1.98), -1.98), V(0, armY(2.12), -2.12)], .058, 6, { capStart: true, capEnd: true });

  // Cabeza principal, colgada de un tubo vertical con abrazaderas al brazo.
  const armAtHead = armY(S.reach);
  m.paint = PAINT.clamp;
  m.sweep([V(.075, armAtHead + .1, -S.reach), V(.075, S.headY - .62, -S.reach)], .022, 4, { capStart: true, capEnd: true });
  for (const offset of [-.1, .1]) m.sweep([V(0, armY(S.reach + offset), -S.reach - offset - .022), V(0, armY(S.reach + offset), -S.reach - offset + .022)], .056, 6, { capStart: true, capEnd: true });
  m.box(.045, armAtHead, -S.reach, .05, .05, .24);
  m.box(.045, S.headY + .4, -S.reach, .05, .04, .12);
  m.box(.045, S.headY - .4, -S.reach, .05, .04, .12);
  const mainHead = new THREE.Matrix4().makeTranslation(-.075, S.headY, -S.reach);
  m.within(mainHead, () => vehicleHead(m, { plate: true, cornerSteps: 1 }));
  for (const lamp of m.lamps) lamp.reflects = true; // está sobre el carril: su reflejo cae en el asfalto
  // Cable que cuelga del poste a la cabeza.
  m.paint = PAINT.cable;
  const cable = [V(.03, 5.68, -R), V(.05, 5.62, -.8), V(.06, 5.6, -1.6), V(.07, 5.66, -2.4), V(.08, 5.74, -3.0), V(.08, 5.82, -S.reach + .28)];
  m.sweep(cable, .009, 3, { capEnd: true });

  // Cabeza baja sobre el poste, con dos brazos cortos.
  m.paint = PAINT.clamp;
  for (const y of [S.lowHeadY + .36, S.lowHeadY - .36]) {
    m.sweep([V(0, y - .022, 0), V(0, y + .022, 0)], R + .009, POLE_SIDES);
    m.box(-(R + .03), y, 0, .07, .05, .05, 'lr');
  }
  m.within(new THREE.Matrix4().makeTranslation(-(R + .165), S.lowHeadY, 0), () => vehicleHead(m));

  // Peatonales: una por cada cebra que llega a la esquina, de frente al que espera al otro lado.
  // La que mira al brazo sirve a la cebra que cruza esta vía: anda con el eje cruzado.
  const pedFrames = [
    [-Math.PI / 2, 0, -(R + .105), LENS.STOP_CROSS, LENS.WALK_CROSS],
    [Math.PI, R + .105, 0, LENS.STOP_PARALLEL, LENS.WALK_PARALLEL]
  ];
  for (const [yaw, x, z, stopCode, walkCode] of pedFrames) {
    const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, S.pedY, z);
    m.within(frame, () => {
      pedHead(m, stopCode, walkCode);
      m.paint = PAINT.clamp;
      m.box(.085, .14, 0, .05, .04, .05, 'lr');
      m.box(.085, -.14, 0, .05, .04, .05, 'lr');
    });
    m.within(new THREE.Matrix4().makeRotationY(yaw).setPosition(x * .98, 1.16, z * .98), () => pushButton(m));
    m.paint = PAINT.clamp;
  }
  for (const y of [S.pedY + .14, S.pedY - .14]) m.sweep([V(0, y - .018, 0), V(0, y + .018, 0)], R + .008, POLE_SIDES);

  // Caja de control en el lado de la acera, con su ducto subiendo por el poste.
  const cabinet = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 1.56, R + .08);
  m.within(cabinet, () => {
    m.paint = PAINT.box;
    m.box(0, 0, 0, .13, .42, .25);
    m.paint = PAINT.boxDark;
    m.box(-.002, .222, 0, .17, .022, .29);
    m.box(-.069, -.02, .09, .012, .05, .022);
    m.box(.075, .13, 0, .02, .04, .12);
    m.box(.075, -.13, 0, .02, .04, .12);
  });
  m.paint = PAINT.clamp;
  m.sweep([V(0, 1.78, R + .018), V(0, 5.72, R + .018)], .014, 5, { capEnd: true });
  for (const y of [2.6, 4.1]) m.sweep([V(0, y - .012, 0), V(0, y + .012, 0)], R + .008, POLE_SIDES);

  // Calcomanías: unas fijas y un juego por poste, sobre todo a la altura de la mano.
  decal(m, -1, 4, 1.34, -.5, .17, .25, .012);
  decal(m, 0, 0, 1.72, 2.5, .1, .07, .008);
  decal(m, 0, 1, 1.28, 1.3, .08, .08);
  decal(m, 0, 11, 1.95, -1.1, .15, .2, -.01);
  decal(m, 1, 2, 1.5, 2.9, .11, .08, .01);
  decal(m, 1, 12, 1.2, -1.9, .16, .22);
  decal(m, 1, 5, 1.88, .6, .07, .09);
  decal(m, 2, 3, 1.26, 2.2, .12, .08, -.012);
  decal(m, 2, 15, 1.7, -2.6, .13, .18);
  decal(m, 2, 9, 1.92, 1.1, .09, .06);
  decal(m, 3, 6, 1.42, 3.4, .09, .09, .01);
  decal(m, 3, 7, 1.84, -2.0, .12, .16, .012);
  decal(m, 3, 8, 1.22, .9, .1, .07);

  return { geometry: m.build(), lamps: m.lamps };
}

/** La cabeza vehicular de lejos: una caja con las mismas lentes y viseras de tres lados. */
function farVehicleHead(m, plate) {
  const module = .36, depth = .2, xFront = -depth / 2;
  m.paint = PAINT.housing;
  m.box(0, 0, 0, depth, module * 3 - .01, .4);
  [LENS.RED, LENS.AMBER, LENS.GREEN].forEach((code, i) => {
    const y = module * (1 - i);
    m.paint = PAINT.lens[code];
    m.dome(y, 0, xFront - .002, .138, 8, [0, 1], .028);
    visor(m, y, 0, xFront, .148, .2, 3);
  });
  if (plate) backPlate(m, depth / 2 - .025, { steps: 1, sides: false });
}

/** La peatonal de lejos: la figura encendida es un cuadro de la misma área, sin dibujo. */
function farPedHead(m, stopCode, walkCode) {
  const depth = .13, xFront = -depth / 2, spot = .225, w = .0225, h = .081;
  m.paint = PAINT.housing;
  m.box(0, 0, 0, depth, .52, .28);
  for (const [code, y, lit] of [[stopCode, .125, '#470c08'], [walkCode, -.125, '#07361f']]) {
    m.paint = PAINT.windowGlass;
    m.flat([[xFront - .001, y - spot / 2, -spot / 2], [xFront - .001, y - spot / 2, spot / 2], [xFront - .001, y + spot / 2, spot / 2], [xFront - .001, y + spot / 2, -spot / 2]], [-1, 0, 0]);
    m.paint = paint(lit, .3, 0, CELLS.white, code);
    const corner = (dy, dz) => [xFront - .002, y + dy, dz, .5, .5, dz * 10, dy * 10];
    m.flat([corner(-h, -w), corner(-h, w), corner(h, w), corner(h, -w)], [-1, 0, 0]);
  }
}

/**
 * El mismo poste para quien lo ve a más de FAR_SIGNAL_DISTANCE: conserva silueta, lentes y fases, y
 * suelta lo que ya no llega a un píxel (pernos, abrazaderas, botones, cable y calcomanías).
 */
export function createFarSignalGeometry() {
  const m = new SignalMesher(), S = SIGNAL_POLE, R = S.radius, base = S.baseY;
  m.paint = PAINT.concrete;
  m.box(0, base / 2, 0, .64, base, .64, 'b');
  m.paint = PAINT.zocalo;
  m.sweep([V(0, base + .024, 0), V(0, base + .3, 0), V(0, 1.05, 0)], [.118, .074, R], 5);
  m.paint = PAINT.galv;
  m.sweep([V(0, 1.05, 0), V(0, S.top, 0)], R, 5, { capEnd: true });
  m.sweep([0, 1.7, S.armLength].map(d => V(0, armY(d), -d)), [.062, .05, .042], 5, { capEnd: true });
  m.paint = PAINT.clamp;
  m.sweep([V(0, 6.5, -R), V(0, armY(2.05) + .03, -2.05)], .014, 3);
  m.within(new THREE.Matrix4().makeTranslation(-.075, S.headY, -S.reach), () => farVehicleHead(m, true));
  m.within(new THREE.Matrix4().makeTranslation(-(R + .165), S.lowHeadY, 0), () => farVehicleHead(m, false));
  for (const [yaw, x, z, stopCode, walkCode] of [
    [-Math.PI / 2, 0, -(R + .105), LENS.STOP_CROSS, LENS.WALK_CROSS],
    [Math.PI, R + .105, 0, LENS.STOP_PARALLEL, LENS.WALK_PARALLEL]
  ]) m.within(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, S.pedY, z), () => farPedHead(m, stopCode, walkCode));
  m.within(new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 1.56, R + .08), () => {
    m.paint = PAINT.box;
    m.box(0, 0, 0, .13, .42, .25);
  });
  return m.build();
}

/** Un cuadro por lámpara; el shader deja solo el de la luz encendida. */
export function createHaloGeometry(lamps) {
  const position = [], corner = [], normal = [], code = [], size = [], index = [];
  // Tamaño negativo: el mismo cuadro, pero tendido en el piso como reflejo.
  const quads = [...lamps.map(lamp => [lamp, lamp.size]), ...lamps.filter(lamp => lamp.reflects).map(lamp => [lamp, -lamp.size])];
  quads.forEach(([lamp, quadSize], i) => {
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      position.push(lamp.center.x, lamp.center.y, lamp.center.z);
      corner.push(cx, cy);
      normal.push(lamp.normal.x, lamp.normal.y, lamp.normal.z);
      code.push(lamp.code);
      size.push(quadSize);
    }
    const base = i * 4;
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('haloCorner', new THREE.Float32BufferAttribute(corner, 2));
  geometry.setAttribute('haloNormal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('haloCode', new THREE.Float32BufferAttribute(code, 1));
  geometry.setAttribute('haloSize', new THREE.Float32BufferAttribute(size, 1));
  geometry.setIndex(index);
  // Los cuadros se abren en el shader: los límites incluyen el resplandor y el reflejo.
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += 12;
  geometry.computeBoundingBox();
  geometry.boundingBox.expandByScalar(12);
  return geometry;
}

// ---------- materiales ----------

// Qué luz prende: el mismo criterio de lensLit, sobre los dos ejes del cruce.
const SIGNAL_RULE = /* glsl */`
  float signalAxisState(float axis) { return axis < .5 ? trafficStates.x : trafficStates.y; }
  float signalLit(float code, float axis) {
    float own = signalAxisState(axis), cross = signalAxisState(1. - axis);
    if (code < 3.5) return step(abs(own - (3. - code)), .5);
    float go = step(code < 5.5 ? own : cross, .5);
    return abs(code - 4.) < .5 || abs(code - 6.) < .5 ? 1. - go : go;
  }
  bool signalIsRed(float code) { return code < 1.5 || abs(code - 4.) < .5 || abs(code - 6.) < .5; }
`;

/** Material compartido por todos los sectores; prende la lente activa sin tocar buffers. */
export function createSignalMaterial(states, night, atlas) {
  const material = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: .6, metalness: .1 });
  material.name = 'Semáforo';
  material.customProgramCacheKey = () => 'signal-model-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.trafficStates = states;
    shader.uniforms.signalNight = night;
    shader.vertexShader = /* glsl */`
      attribute float trafficAxis;
      attribute float signalLens;
      attribute vec2 signalSurface;
      attribute vec2 signalLensUv;
      uniform vec2 trafficStates;
      uniform float signalNight;
      varying vec2 vSignalSurface;
      varying vec2 vSignalLensUv;
      varying vec3 vSignalGlow;
      varying float vSignalLit;
      varying float vSignalRetro;
      ${SIGNAL_RULE}
      // Con componentes negativas para que ACES no lave el color al subir el brillo.
      vec3 signalHue(float code) {
        if (signalIsRed(code)) return vec3(1., -.03, -.012);
        return code < 2.5 ? vec3(1., .2, -.03) : vec3(-.38, 1., .14);
      }
    ` + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      vSignalSurface = signalSurface;
      vSignalLensUv = signalLensUv;
      vSignalLit = 0.; vSignalRetro = 0.; vSignalGlow = vec3(0.);
      if (signalLens > 8.5) {
        // Cada poste muestra un solo juego de calcomanías.
        float signalSet = mod(floor(instanceMatrix[3].x * .37 + instanceMatrix[3].z * .71), 4.);
        if (abs(signalLens - 9. - signalSet) > .5) transformed = vec3(0.);
      } else if (signalLens > 7.5) {
        vSignalRetro = mix(.01, .16, signalNight);
      } else if (signalLens > .5) {
        vSignalLit = signalLit(signalLens, trafficAxis);
        vSignalGlow = signalHue(signalLens) * vSignalLit;
      }
    `);
    shader.fragmentShader = /* glsl */`
      varying vec2 vSignalSurface;
      varying vec2 vSignalLensUv;
      varying vec3 vSignalGlow;
      varying float vSignalLit;
      varying float vSignalRetro;
    ` + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSignalSurface.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSignalSurface.y;')
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        if (vSignalLit > .5) {
          // Matriz de LED: se ve de cerca y se funde a lo lejos para no titilar.
          vec2 ledGrid = vSignalLensUv * 8.;
          ledGrid.x += .5 * mod(floor(ledGrid.y), 2.);
          float ledDot = 1. - smoothstep(.16, .46, length(fract(ledGrid) - .5));
          float ledFar = clamp(fwidth(ledGrid.y) * 1.6, 0., 1.);
          float lensCore = 1. - smoothstep(.0, 1., length(vSignalLensUv));
          float lensPower = mix(.5 + ledDot * 1.5, 1.25, ledFar) * (1. + lensCore * lensCore * 1.5);
          diffuseColor.rgb *= .3;
          totalEmissiveRadiance += vSignalGlow * lensPower;
        }
        totalEmissiveRadiance += diffuseColor.rgb * vSignalRetro;
      `);
  };
  return chainSunField(material);
}

/** Resplandor aditivo y reflejo en el piso mojado: sin luces nuevas. */
export function createHaloMaterial(states, night, wet) {
  return new THREE.ShaderMaterial({
    name: 'Resplandor de semáforo',
    uniforms: { trafficStates: states, signalNight: night, signalWet: wet },
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false, fog: false,
    vertexShader: /* glsl */`
      attribute vec2 haloCorner;
      attribute vec3 haloNormal;
      attribute float haloCode;
      attribute float haloSize;
      attribute float trafficAxis;
      uniform vec2 trafficStates;
      uniform float signalNight;
      uniform float signalWet;
      varying vec2 vHaloCorner;
      varying vec3 vHaloTint;
      varying float vHaloStreak;
      ${SIGNAL_RULE}
      vec3 signalTint(float code) {
        if (signalIsRed(code)) return vec3(1., .1, .06);
        return code < 2.5 ? vec3(1., .5, .06) : vec3(.06, 1., .52);
      }
      void main() {
        vHaloCorner = haloCorner;
        vHaloTint = vec3(0.);
        vHaloStreak = 0.;
        // Fuera de pantalla si no prende o si se mira desde atrás.
        gl_Position = vec4(2., 2., 2., 1.);
        if (signalLit(haloCode, trafficAxis) < .5) return;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.);
        vec3 facingNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * haloNormal);
        vec3 toCamera = cameraPosition - world.xyz;
        float distanceToCamera = length(toCamera);
        float facing = smoothstep(.05, .5, dot(facingNormal, toCamera / distanceToCamera));
        if (facing <= 0.) return;
        vec3 tint = signalTint(haloCode) * facing;
        if (haloSize < 0.) {
          // El reflejo cae sobre la línea que une la lámpara con quien mira, más cerca
          // de la lámpara que del ojo. Sin agua no hay espejo y no se dibuja.
          float strength = signalWet * mix(.06, .5, signalNight);
          vec2 toEye = cameraPosition.xz - world.xz;
          float reach = length(toEye);
          if (strength < .01 || reach < 2.) return;
          vec2 along = toEye / reach, across = vec2(-along.y, along.x);
          float middle = min(reach * .3, 11.), halfLength = clamp(reach * .3, 2.5, 8.5);
          vec2 point = world.xz + along * (middle + haloCorner.y * halfLength) + across * haloCorner.x * (.55 + reach * .012);
          gl_Position = projectionMatrix * viewMatrix * vec4(point.x, .045, point.y, 1.);
          vHaloTint = tint * strength;
          vHaloStreak = 1.;
          return;
        }
        vec4 view = viewMatrix * world;
        view.xyz += normalize(-view.xyz) * min(.4, distanceToCamera * .5); // por delante de la visera
        // A lo lejos el destello casi no se encoge en pantalla, como en una foto.
        float radius = haloSize * mix(3.2, 7.5, signalNight) * (1. + min(distanceToCamera, 90.) * mix(.012, .028, signalNight));
        view.xy += haloCorner * radius;
        gl_Position = projectionMatrix * view;
        vHaloTint = tint * mix(.2, .85, signalNight);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vHaloCorner;
      varying vec3 vHaloTint;
      varying float vHaloStreak;
      void main() {
        float r = length(vHaloCorner);
        float glow = pow(max(0., 1. - r), 2.6) + pow(max(0., 1. - r * 3.), 2.) * .6;
        float streak = pow(max(0., 1. - vHaloCorner.y * vHaloCorner.y), 2.) * pow(max(0., 1. - abs(vHaloCorner.x)), 2.);
        gl_FragColor = vec4(vHaloTint * mix(glow, streak, vHaloStreak), 1.);
      }
    `
  });
}

/** Luminancia del cielo a nivel de noche (1) o de día (0). */
export function nightFromSky(sky) {
  const luminance = sky.r * .2126 + sky.g * .7152 + sky.b * .0722;
  return 1 - ramp(.015, .16, luminance);
}
