import * as THREE from 'three';

/** Color lineal listo para atributos de vértice; `k` oscurece o aclara sin pasar otra vez por sRGB. */
export const rgb = (hex, k = 1) => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};
export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

const isList = value => Array.isArray(value[0]);

/**
 * Acumula triángulos de una sola malla con color por vértice. El bus y la estación se dibujan con
 * pocas llamadas porque cada material es una sola geometría; el color por vértice hace de sombra
 * horneada, que en calidad baja es la única que hay.
 */
export class MeshKit {
  constructor({ slide = false, alpha = false } = {}) {
    this.positions = []; this.normals = []; this.colors = []; this.uvs = []; this.indices = [];
    this.slides = slide ? [] : null;
    this.alphas = alpha ? [] : null;
    this.slideValue = 0;
    this.alphaValue = 1;
    this.uvOf = null;
    this.matrix = null;
  }

  get vertexCount() { return this.positions.length / 3; }
  get triangleCount() { return this.indices.length / 3; }

  vertex(p, n, c, uv) {
    let [x, y, z] = p, [nx, ny, nz] = n;
    if (this.matrix) {
      const e = this.matrix.elements;
      const px = x, py = y, pz = z, qx = nx, qy = ny, qz = nz;
      x = e[0] * px + e[4] * py + e[8] * pz + e[12];
      y = e[1] * px + e[5] * py + e[9] * pz + e[13];
      z = e[2] * px + e[6] * py + e[10] * pz + e[14];
      nx = e[0] * qx + e[4] * qy + e[8] * qz;
      ny = e[1] * qx + e[5] * qy + e[9] * qz;
      nz = e[2] * qx + e[6] * qy + e[10] * qz;
    }
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(c[0], c[1], c[2]);
    if (this.alphas) this.alphas.push(c[3] ?? this.alphaValue);
    this.uvs.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
    if (this.slides) this.slides.push(this.slideValue);
    return this.vertexCount - 1;
  }

  /** Cuadrilátero; `facing` voltea el orden si quedó mirando al lado contrario. */
  quad(a, b, c, d, color, { normal = null, facing = null, uv = null } = {}) {
    const flat = unit(cross(sub(c, a), sub(d, b)));
    const reference = facing ?? (normal ? (isList(normal) ? normal[0] : normal) : flat);
    const flip = dot(flat, reference) < 0;
    const face = flip ? [-flat[0], -flat[1], -flat[2]] : flat;
    const points = [a, b, c, d];
    const n = i => normal ? (isList(normal) ? normal[i] : normal) : face;
    const col = i => isList(color) ? color[i] : color;
    const tex = i => uv ? uv[i] : (this.uvOf?.(points[i], n(i)) ?? [0, 0]);
    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) this.vertex(points[i], n(i), col(i), tex(i));
    if (flip) this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Caja con caras planas. `bottom` oscurece los vértices de abajo: sombra de contacto sin mapas de sombra. */
  box(x, y, z, sx, sy, sz, color, { bottom = 1, top = 1, skip = '', rotation = null } = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const m = rotation ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)) : null;
    const at = (a, b, c) => {
      if (!m) return [x + a, y + b, z + c];
      const v = new THREE.Vector3(a, b, c).applyMatrix4(m);
      return [x + v.x, y + v.y, z + v.z];
    };
    const dir = v => { if (!m) return v; const w = new THREE.Vector3(...v).applyMatrix4(m); return [w.x, w.y, w.z]; };
    const lo = shade(color, bottom), hi = shade(color, top);
    const side = [lo, lo, hi, hi];
    const faces = {
      px: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], side, [1, 0, 0]],
      nx: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], side, [-1, 0, 0]],
      pz: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], side, [0, 0, 1]],
      nz: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], side, [0, 0, -1]],
      py: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], hi, [0, 1, 0]],
      ny: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], lo, [0, -1, 0]]
    };
    for (const [key, [a, b, c, d, col, n]] of Object.entries(faces)) {
      if (skip.includes(key)) continue;
      const normal = dir(n);
      this.quad(at(...a), at(...b), at(...c), at(...d), col, { normal, facing: normal });
    }
  }

  /** Tronco de caja con la base abajo: casetas, equipos de techo, bases. */
  frustum(x, z, y0, y1, sx0, sz0, sx1, sz1, color, { bottom = 1, skipTop = false } = {}) {
    const low = shade(color, bottom);
    const corner = (sx, sz, y) => [
      [x - sx / 2, y, z + sz / 2], [x + sx / 2, y, z + sz / 2], [x + sx / 2, y, z - sz / 2], [x - sx / 2, y, z - sz / 2]
    ];
    const a = corner(sx0, sz0, y0), b = corner(sx1, sz1, y1);
    const facings = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(a[i], a[j], b[j], b[i], [low, low, color, color], { facing: facings[i] });
    }
    if (!skipTop) this.quad(b[0], b[1], b[2], b[3], color, { facing: [0, 1, 0] });
  }

  /**
   * Tubo sobre una polilínea. Con pocos lados y `flat` da perfiles cuadrados que marcan aristas;
   * con seis u ocho lados suaves da pasamanos redondos por muy pocos triángulos.
   */
  tube(points, radius, sides, color, { flat = false, caps = true, twist = Math.PI / 4 } = {}) {
    const count = points.length;
    const tangents = points.map((_, i) => unit(sub(points[Math.min(i + 1, count - 1)], points[Math.max(i - 1, 0)])));
    let seed = Math.abs(tangents[0][1]) > .9 ? [1, 0, 0] : [0, 1, 0];
    const rings = [];
    let n = unit(cross(tangents[0], seed));
    for (let i = 0; i < count; i++) {
      const t = tangents[i];
      n = unit(sub(n, t.map(v => v * dot(n, t))));
      const b = cross(t, n);
      const ring = [];
      for (let k = 0; k < sides; k++) {
        const angle = twist + k / sides * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
        const dir = [n[0] * c + b[0] * s, n[1] * c + b[1] * s, n[2] * c + b[2] * s];
        ring.push({ p: [points[i][0] + dir[0] * radius, points[i][1] + dir[1] * radius, points[i][2] + dir[2] * radius], dir });
      }
      rings.push(ring);
    }
    for (let i = 0; i + 1 < count; i++) for (let k = 0; k < sides; k++) {
      const l = (k + 1) % sides;
      const a = rings[i][k], b = rings[i][l], c = rings[i + 1][l], d = rings[i + 1][k];
      if (flat) {
        const center = [(a.dir[0] + b.dir[0]), (a.dir[1] + b.dir[1]), (a.dir[2] + b.dir[2])];
        this.quad(a.p, b.p, c.p, d.p, color, { facing: center });
      } else {
        this.quad(a.p, b.p, c.p, d.p, color, { normal: [a.dir, b.dir, c.dir, d.dir], facing: a.dir });
      }
    }
    if (caps) for (const [ring, sign] of [[rings[0], -1], [rings[count - 1], 1]]) {
      const axis = tangents[sign < 0 ? 0 : count - 1].map(v => v * sign);
      for (let k = 1; k + 1 < sides; k++) {
        const base = this.vertexCount;
        const tri = [ring[0].p, ring[k].p, ring[k + 1].p];
        for (const p of tri) this.vertex(p, axis, color, this.uvOf?.(p, axis));
        const flat2 = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
        if (dot(flat2, axis) < 0) this.indices.push(base, base + 2, base + 1);
        else this.indices.push(base, base + 1, base + 2);
      }
    }
  }

  /** Disco plano que mira hacia `normal`; opcional un aro exterior de otro color. */
  disc(center, normal, radius, segments, color, { rim = null, edge = null } = {}) {
    const n = unit(normal);
    const a = unit(Math.abs(n[1]) > .9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));
    const b = cross(n, a);
    const at = (r, t) => [
      center[0] + (a[0] * Math.cos(t) + b[0] * Math.sin(t)) * r,
      center[1] + (a[1] * Math.cos(t) + b[1] * Math.sin(t)) * r,
      center[2] + (a[2] * Math.cos(t) + b[2] * Math.sin(t)) * r
    ];
    const middle = this.vertex(center, n, color, this.uvOf?.(center, n));
    const first = this.vertexCount;
    for (let i = 0; i < segments; i++) {
      const p = at(radius, i / segments * Math.PI * 2);
      this.vertex(p, n, edge ?? color, this.uvOf?.(p, n));
    }
    for (let i = 0; i < segments; i++) this.indices.push(middle, first + (i + 1) % segments, first + i);
    // Verifica el sentido con el primer triángulo: la base puede salir invertida según la normal.
    const p = this.positions, i0 = first * 3, i1 = (first + 1) * 3, m = middle * 3;
    const tangent = [p[i1] - p[i0], p[i1 + 1] - p[i0 + 1], p[i1 + 2] - p[i0 + 2]];
    const radial = [p[i0] - p[m], p[i0 + 1] - p[m + 1], p[i0 + 2] - p[m + 2]];
    if (!this.matrix && dot(cross(tangent, radial), n) < 0) {
      const start = this.indices.length - segments * 3;
      for (let i = start; i < this.indices.length; i += 3) {
        const v = this.indices[i + 1]; this.indices[i + 1] = this.indices[i + 2]; this.indices[i + 2] = v;
      }
    }
    if (rim) {
      for (let i = 0; i < segments; i++) {
        const t0 = i / segments * Math.PI * 2, t1 = (i + 1) / segments * Math.PI * 2;
        this.quad(at(radius, t0), at(radius, t1), at(radius * 1.16, t1), at(radius * 1.16, t0), rim, { normal: n, facing: n });
      }
    }
  }

  /** Elipsoide de pocos triángulos con color por altura: cabezas y cuerpos sin aristas de caja. */
  ellipsoid(center, radii, colorAt, { rows = 5, cols = 7 } = {}) {
    const color = typeof colorAt === 'function' ? colorAt : () => colorAt;
    const base = this.vertexCount;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows, phi = v * Math.PI - Math.PI / 2, cy = Math.cos(phi), sy = Math.sin(phi);
      for (let i = 0; i <= cols; i++) {
        const t = i / cols * Math.PI * 2, nx = cy * Math.cos(t), nz = cy * Math.sin(t);
        const p = [center[0] + nx * radii[0], center[1] + sy * radii[1], center[2] + nz * radii[2]], n = unit([nx / radii[0], sy / radii[1], nz / radii[2]]);
        this.vertex(p, n, color(v), this.uvOf?.(p, n));
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = base + j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      this.indices.push(a, c, b, b, c, d);
    }
  }

  /**
   * Superficie de revolución alrededor de X. Cada tramo del perfil tiene sus propios vértices para
   * que las aristas (hombro de la llanta, borde del rin) sigan marcadas.
   */
  revolve(profile, segments) {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, x0, c0] = profile[i], [r1, x1, c1 = c0] = profile[i + 1];
      let nr = x1 - x0, nx = -(r1 - r0);
      const scale = Math.hypot(nr, nx) || 1; nr /= scale; nx /= scale;
      for (let k = 0; k < segments; k++) {
        const t0 = k / segments * Math.PI * 2, t1 = (k + 1) / segments * Math.PI * 2;
        const at = (r, x, t) => [x, r * Math.cos(t), r * Math.sin(t)];
        const nAt = t => [nx, nr * Math.cos(t), nr * Math.sin(t)];
        const a = at(r0, x0, t0), b = at(r0, x0, t1), c = at(r1, x1, t1), d = at(r1, x1, t0);
        this.quad(a, b, c, d, [c0, c0, c1, c1], { normal: [nAt(t0), nAt(t1), nAt(t1), nAt(t0)], facing: nAt((t0 + t1) / 2) });
      }
    }
  }

  geometry() {
    if (!this.indices.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.alphas) {
      const rgba = new Float32Array(this.vertexCount * 4);
      for (let i = 0; i < this.vertexCount; i++) {
        rgba[i * 4] = this.colors[i * 3]; rgba[i * 4 + 1] = this.colors[i * 3 + 1];
        rgba[i * 4 + 2] = this.colors[i * 3 + 2]; rgba[i * 4 + 3] = this.alphas[i];
      }
      g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
    } else {
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    }
    if (this.slides) g.setAttribute('aSlide', new THREE.Float32BufferAttribute(this.slides, 1));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

/** Fuente de puntos 5×7 para los letreros LED: no depende de que el navegador tenga una tipografía cargada. */
const GLYPHS = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,10001,11110,10001,10001,11110', C: '01110,10001,10000,10000,10000,10001,01110',
  D: '11110,10001,10001,10001,10001,10001,11110', E: '11111,10000,10000,11110,10000,10000,11111', F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01111', H: '10001,10001,10001,11111,10001,10001,10001', I: '01110,00100,00100,00100,00100,00100,01110',
  J: '00111,00010,00010,00010,00010,10010,01100', K: '10001,10010,10100,11000,10100,10010,10001', L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001', N: '10001,11001,10101,10011,10001,10001,10001', O: '01110,10001,10001,10001,10001,10001,01110',
  P: '11110,10001,10001,11110,10000,10000,10000', Q: '01110,10001,10001,10001,10101,10010,01101', R: '11110,10001,10001,11110,10100,10010,10001',
  S: '01111,10000,10000,01110,00001,00001,11110', T: '11111,00100,00100,00100,00100,00100,00100', U: '10001,10001,10001,10001,10001,10001,01110',
  V: '10001,10001,10001,10001,10001,01010,00100', W: '10001,10001,10001,10101,10101,10101,01010', X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100', Z: '11111,00001,00010,00100,01000,10000,11111', 0: '01110,10001,10011,10101,11001,10001,01110',
  1: '00100,01100,00100,00100,00100,00100,01110', 2: '01110,10001,00001,00010,00100,01000,11111', 3: '11111,00010,00100,00010,00001,10001,01110',
  4: '00010,00110,01010,10010,11111,00010,00010', 5: '11111,10000,11110,00001,00001,10001,01110', 6: '00110,01000,10000,11110,10001,10001,01110',
  7: '11111,00001,00010,00100,01000,01000,01000', 8: '01110,10001,10001,01110,10001,10001,01110', 9: '01110,10001,10001,01111,00001,00010,01100',
  '.': '00000,00000,00000,00000,00000,01100,01100', '-': '00000,00000,00000,11111,00000,00000,00000', '>': '01000,00100,00010,00001,00010,00100,01000',
  ':': '00000,01100,01100,00000,01100,01100,00000', ' ': '00000,00000,00000,00000,00000,00000,00000'
};

/** Dibuja texto como matriz de puntos encendidos; (x, y) en celdas, cada letra mide 5×7 por la escala. */
export function drawLedText(ctx, text, x, y, { cellW = 4, cellH = 4, scale = 1, color = '#ffb020' } = {}) {
  ctx.fillStyle = color;
  let column = x;
  for (const ch of text.toUpperCase()) {
    const rows = (GLYPHS[ch] ?? GLYPHS[' ']).split(',');
    rows.forEach((row, r) => {
      for (let c = 0; c < 5; c++) {
        if (row[c] !== '1') continue;
        for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
          const px = (column + c * scale + a) * cellW, py = (y + r * scale + b) * cellH;
          ctx.beginPath();
          ctx.ellipse(px + cellW / 2, py + cellH / 2, cellW * .42, cellH * .42, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    column += 6 * scale;
  }
  return column;
}

export const ledTextColumns = (text, scale = 1) => text.length * 6 * scale - scale;

/** Lienzo seguro: en las pruebas de Node no hay DOM, y una textura vacía basta porque nunca se dibuja. */
export function canvasTexture(width, height, draw, { color = true, repeat = false, anisotropy = 4 } = {}) {
  let texture;
  if (typeof document === 'undefined') texture = new THREE.Texture();
  else {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) draw(ctx, width, height);
    texture = new THREE.CanvasTexture(canvas);
  }
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}
