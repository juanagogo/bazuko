// Geometría de calle por sectores: una malla por material y sector, sin un objeto por tapa o por caneca.
import * as THREE from 'three';
import { STATIC_CHUNK_SIZE } from './StaticGeometry.js';

const color = new THREE.Color();

/** Tinte en espacio lineal a partir de un color CSS, para escribirlo directo en los vértices. */
export function tint(hex, scale = 1) {
  color.set(hex);
  return [color.r * scale, color.g * scale, color.b * scale];
}

/** Hash estable por coordenadas: la ciudad no cambia entre partidas ni consume Math.random. */
export function hash2(x, z, salt = 0) {
  let value = Math.imul(x + 17, 73856093) ^ Math.imul(z + 31, 19349663) ^ Math.imul(salt + 7, 83492791);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 13), 0x4cf5ad43);
  return (value ^ (value >>> 16)) >>> 0;
}
export const unit = (x, z, salt = 0) => hash2(x, z, salt) / 4294967296;

export class StreetBatch {
  /**
   * `alpha` guarda un cuarto canal por vértice: permite gastar la pintura tramo por tramo.
   * `chunkSize` más grande gasta menos llamadas en lo que casi no pesa, como la luz de los faroles.
   */
  constructor({ material, name = 'Calle', alpha = false, castShadow = false, receiveShadow = true, renderOrder = 0, chunkSize = STATIC_CHUNK_SIZE }) {
    Object.assign(this, { material, name, alpha, castShadow, receiveShadow, renderOrder, chunkSize });
    this.chunks = new Map();
    this.colorSize = alpha ? 4 : 3;
  }

  _chunk(x, z) {
    const key = `${Math.floor(x / this.chunkSize)},${Math.floor(z / this.chunkSize)}`;
    let chunk = this.chunks.get(key);
    if (!chunk) this.chunks.set(key, chunk = { p: [], n: [], u: [], c: [], i: [] });
    return chunk;
  }

  /** Cuadrilátero a-b-c-d en sentido antihorario visto desde su normal. */
  quad(a, b, c, d, normal, uv, colors) {
    const chunk = this._chunk((a[0] + c[0]) / 2, (a[2] + c[2]) / 2);
    const base = chunk.p.length / 3, size = this.colorSize;
    chunk.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let k = 0; k < 4; k++) chunk.n.push(normal[0], normal[1], normal[2]);
    chunk.u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
    const many = Array.isArray(colors[0]);
    for (let k = 0; k < 4; k++) {
      const value = many ? colors[k] : colors;
      for (let j = 0; j < size; j++) chunk.c.push(value[j] ?? 1);
    }
    chunk.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Un solo triángulo, para lo que termina en punta: una hoja cuesta la mitad que un cuadrilátero. */
  triangle(a, b, c, normal, uv, colors) {
    const chunk = this._chunk((a[0] + c[0]) / 2, (a[2] + c[2]) / 2);
    const base = chunk.p.length / 3, size = this.colorSize;
    chunk.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) chunk.n.push(normal[0], normal[1], normal[2]);
    chunk.u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3]);
    for (let k = 0; k < 3; k++) for (let j = 0; j < size; j++) chunk.c.push(colors[k][j] ?? 1);
    chunk.i.push(base, base + 1, base + 2);
  }

  /** Cuadrado sobre el suelo, girado alrededor de Y; `lift` lo separa de la superficie. */
  decal(x, y, z, width, depth, angle, uv, value, heightAt = null) {
    const c = Math.cos(angle), s = Math.sin(angle), hw = width / 2, hd = depth / 2;
    const at = (a, b) => {
      const px = x + a * c + b * s, pz = z - a * s + b * c;
      return [px, heightAt ? heightAt(px, pz) : y, pz];
    };
    // uv: u crece con `width`, v crece con −`depth` para que el glifo se lea hacia −Z local.
    this.quad(at(-hw, hd), at(hw, hd), at(hw, -hd), at(-hw, -hd), [0, 1, 0], uv, value);
  }

  /** Caja girada en Y. `shade` oscurece la base: un poco de oclusión gratis en todos los objetos. */
  box(x, y, z, w, h, d, angle, uv, value, shade = .72) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const at = (a, up, b) => [x + a * c + b * s, y + up, z - a * s + b * c];
    const hw = w / 2, hd = d / 2;
    const top = value, low = [value[0] * shade, value[1] * shade, value[2] * shade];
    const side = (a, b, e, f, nx, nz) => this.quad(at(a, 0, b), at(e, 0, f), at(e, h, f), at(a, h, b),
      [nx * c + nz * s, 0, -nx * s + nz * c], uv, [low, low, top, top]);
    side(-hw, hd, hw, hd, 0, 1);
    side(hw, -hd, -hw, -hd, 0, -1);
    side(hw, hd, hw, -hd, 1, 0);
    side(-hw, -hd, -hw, hd, -1, 0);
    this.quad(at(-hw, h, hd), at(hw, h, hd), at(hw, h, -hd), at(-hw, h, -hd), [0, 1, 0], uv, top);
  }

  /** Cilindro o cono truncado con tapa superior; normales suaves y pocos lados. */
  cylinder(x, y, z, r0, r1, h, sides, uv, value, shade = .72) {
    const chunk = this._chunk(x, z);
    const base = chunk.p.length / 3, size = this.colorSize;
    const slope = (r0 - r1) / Math.max(h, 1e-3), len = Math.hypot(1, slope);
    const low = [value[0] * shade, value[1] * shade, value[2] * shade, value[3] ?? 1];
    for (let i = 0; i <= sides; i++) {
      const a = i / sides * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      chunk.p.push(x + cs * r0, y, z + sn * r0, x + cs * r1, y + h, z + sn * r1);
      for (let k = 0; k < 2; k++) chunk.n.push(cs / len, slope / len, sn / len);
      const u = uv[0] + (uv[2] - uv[0]) * i / sides;
      chunk.u.push(u, uv[1], u, uv[3]);
      for (let j = 0; j < size; j++) chunk.c.push(low[j] ?? 1);
      for (let j = 0; j < size; j++) chunk.c.push(value[j] ?? 1);
    }
    for (let i = 0; i < sides; i++) {
      const v = base + i * 2;
      chunk.i.push(v, v + 1, v + 3, v, v + 3, v + 2);
    }
    if (r1 > .001) {
      const center = chunk.p.length / 3;
      chunk.p.push(x, y + h, z); chunk.n.push(0, 1, 0);
      chunk.u.push((uv[0] + uv[2]) / 2, (uv[1] + uv[3]) / 2);
      for (let j = 0; j < size; j++) chunk.c.push(value[j] ?? 1);
      for (let i = 0; i < sides; i++) {
        const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2;
        const start = chunk.p.length / 3;
        chunk.p.push(x + Math.cos(a) * r1, y + h, z + Math.sin(a) * r1, x + Math.cos(b) * r1, y + h, z + Math.sin(b) * r1);
        chunk.n.push(0, 1, 0, 0, 1, 0);
        chunk.u.push(uv[0], uv[1], uv[2], uv[1]);
        for (let k = 0; k < 2; k++) for (let j = 0; j < size; j++) chunk.c.push(value[j] ?? 1);
        chunk.i.push(center, start + 1, start);
      }
    }
  }

  /** Cierra los sectores en mallas hijas de `parent`; no pasan por _mergeStatic. */
  finish(parent) {
    const meshes = [];
    for (const chunk of this.chunks.values()) {
      if (!chunk.i.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.p, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(chunk.n, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(chunk.u, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(chunk.c, this.colorSize));
      const vertices = chunk.p.length / 3;
      geometry.setIndex(vertices > 65535 ? new THREE.Uint32BufferAttribute(chunk.i, 1) : new THREE.Uint16BufferAttribute(chunk.i, 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = this.name;
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = this.receiveShadow;
      mesh.renderOrder = this.renderOrder;
      mesh.userData.noMerge = true;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.chunks.clear();
    return meshes;
  }
}

/** Cables por sector: una línea cuesta una llamada por sector y no necesita normales. */
export class WireBatch {
  constructor(material, name = 'Cables', chunkSize = STATIC_CHUNK_SIZE * 2) {
    this.material = material; this.name = name; this.chunkSize = chunkSize;
    this.chunks = new Map();
  }

  /** Tramo colgado entre dos puntos, con `sag` metros de caída en el centro. */
  span(a, b, sag, segments = 8, color = [.03, .03, .035]) {
    const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
    const key = `${Math.floor(mx / this.chunkSize)},${Math.floor(mz / this.chunkSize)}`;
    let chunk = this.chunks.get(key);
    if (!chunk) this.chunks.set(key, chunk = { p: [], c: [] });
    let px = a[0], py = a[1], pz = a[2];
    for (let i = 1; i <= segments; i++) {
      const t = i / segments, drop = 4 * sag * t * (1 - t);
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t - drop, z = a[2] + (b[2] - a[2]) * t;
      chunk.p.push(px, py, pz, x, y, z);
      chunk.c.push(color[0], color[1], color[2], color[0], color[1], color[2]);
      px = x; py = y; pz = z;
    }
  }

  finish(parent) {
    const meshes = [];
    for (const chunk of this.chunks.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.p, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(chunk.c, 3));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const lines = new THREE.LineSegments(geometry, this.material);
      lines.name = this.name;
      lines.userData.noMerge = true;
      parent.add(lines);
      meshes.push(lines);
    }
    this.chunks.clear();
    return meshes;
  }
}
