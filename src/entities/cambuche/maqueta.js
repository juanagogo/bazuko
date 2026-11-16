// src/entities/cambuche/maqueta.js
// Arma una pieza del cambuche como una sola malla de caras planas: cada parte se pinta por vértice y todas se unen,
// así una pieza entera cuesta una llamada de dibujo y comparte material con las demás.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Paleta corta: negro del plástico, azul de la lona y cartón, con la cobija y el guacal de acento cálido. */
export const PALETA = Object.freeze({
  plastico: '#16171a', lona: '#2459ad', lonaClara: '#3b6cb6', cinta: '#8f989f', polisombra: '#2a553b',
  zinc: '#8d9698', zincOscuro: '#737c7f', oxido: '#7a5238', carton: '#a9814f', cartonViejo: '#8b6a41', tabla: '#73553a', tablaVieja: '#5b4632',
  palo: '#4a3a28', piedra: '#7d7973', llanta: '#1c1c1e', cuerda: '#b3a276', cobija: '#8f3f2b', raya: '#d9c9a0',
  colchon: '#b8b29f', sabana: '#d8d1bf', olla: '#262524', tizne: '#141312', balde: '#d6d2c6', guacal: '#b4552f',
  costal: '#b5ad98', lata: '#9aa0a6', hoja: '#3f7d3a', cera: '#f2eee0', tierra: '#5a4a3a', ceniza: '#6f6a64',
  mezclilla: '#4f637d', camisa: '#e2dccb',
});

/** Azar con semilla: el cambuche sale igual en cada partida y en cada foto. */
export function azar(seed) {
  let s = seed >>> 0;
  return () => {
    s = s + 0x6d2b79f5 >>> 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const _matrix = new THREE.Matrix4(), _quaternion = new THREE.Quaternion(), _euler = new THREE.Euler();
const _position = new THREE.Vector3(), _scale = new THREE.Vector3(), _color = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Maqueta {
  constructor(seed = 1) {
    this.partes = [];
    this.r = azar(seed);
  }

  /** Suma una geometría pintada de un color; `tono` es cuánto cambia la luz de una cara a otra. */
  pon(geometry, color, { en = [0, 0, 0], giro = [0, 0, 0], escala = 1, tono = .07 } = {}) {
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    _scale.set(...(Array.isArray(escala) ? escala : [escala, escala, escala]));
    _matrix.compose(_position.set(...en), _quaternion.setFromEuler(_euler.set(...giro)), _scale);
    part.applyMatrix4(_matrix);
    for (const name of Object.keys(part.attributes)) if (name !== 'position') part.deleteAttribute(name);
    part.computeVertexNormals();
    const count = part.attributes.position.count, colors = new Float32Array(count * 3);
    _color.set(color);
    for (let i = 0; i < count; i += 3) {
      const k = 1 + (this.r() - .5) * 2 * tono;
      for (let j = i; j < i + 3 && j < count; j++) colors.set([_color.r * k, _color.g * k, _color.b * k], j * 3);
    }
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.partes.push(part);
    return this;
  }

  caja(w, h, d, color, options) { return this.pon(new THREE.BoxGeometry(w, h, d), color, options); }

  /** Tabla o cartón parado en el piso: `en` es el centro de su base. */
  tabla(w, h, d, color, { en = [0, 0, 0], ...rest } = {}) {
    return this.pon(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, { en, ...rest });
  }

  cilindro(radio, alto, color, { lados = 7, radioArriba = radio, ...rest } = {}) {
    return this.pon(new THREE.CylinderGeometry(radioArriba, radio, alto, lados).translate(0, alto / 2, 0), color, rest);
  }

  piedra(radio, en, color = PALETA.piedra) {
    const r = this.r;
    return this.pon(new THREE.IcosahedronGeometry(radio, 0), color, {
      en: [en[0], en[1] + radio * .45, en[2]], giro: [r() * 3, r() * 3, r() * 3],
      escala: [1 + r() * .35, .62 + r() * .2, .85 + r() * .3], tono: .12,
    });
  }

  llanta(radio, en, giro = [Math.PI / 2, 0, 0]) {
    return this.pon(new THREE.TorusGeometry(radio, radio * .36, 5, 10), PALETA.llanta, { en, giro, tono: .25 });
  }

  /** Palo o cuerda de un punto a otro. */
  palo(desde, hasta, radio, color = PALETA.palo, lados = 5) {
    _a.set(...desde); _b.set(...hasta);
    const largo = _a.distanceTo(_b);
    const geometry = new THREE.CylinderGeometry(radio, radio, largo, lados, 1, lados < 5);
    _quaternion.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
    geometry.applyQuaternion(_quaternion).translate((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2);
    return this.pon(geometry, color, { tono: .1 });
  }

  /**
   * Tela, plástico o lámina: una rejilla cuyos puntos da `punto(u, v)` con u y v de 0 a 1.
   * `color` puede ser una función (u, v) → color para pintar parches, rayas o manchas; con `suave` se pinta por
   * punto y no por cuadro, para degradados.
   */
  tela(nu, nv, punto, color, { tono = .09, suave = false } = {}) {
    const positions = [], colors = [], grid = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) grid.push([...punto(i / nu, j / nv), i / nu, j / nv]);
    const at = (i, j) => grid[j * (nu + 1) + i];
    const pinta = (u, v) => _color.set(typeof color === 'function' ? color(u, v) : color);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (!suave) pinta((i + .5) / nu, (j + .5) / nv);
      const flip = (i + j) % 2 === 0;
      const quad = flip ? [at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)]
        : [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j)];
      for (let t = 0; t < 2; t++) {
        const k = 1 + (this.r() - .5) * 2 * tono;
        for (let v = 0; v < 3; v++) {
          const [x, y, z, pu, pv] = quad[t * 3 + v];
          if (suave) pinta(pu, pv);
          positions.push(x, y, z); colors.push(_color.r * k, _color.g * k, _color.b * k);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.partes.push(geometry);
    return this;
  }

  /** Suma lo armado en otra maqueta, movido y girado (sobre Y). */
  suma(otra, en = [0, 0, 0], giroY = 0, escala = 1) {
    _matrix.compose(_position.set(...en), _quaternion.setFromEuler(_euler.set(0, giroY, 0)), _scale.setScalar(escala));
    for (const part of otra.partes) { part.applyMatrix4(_matrix); this.partes.push(part); }
    otra.partes = [];
    return this;
  }

  get vacia() { return !this.partes.length; }

  /** Une todo en una geometría y suelta las partes. */
  geometria() {
    const merged = mergeGeometries(this.partes, false);
    for (const part of this.partes) part.dispose();
    this.partes = [];
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

/** El material de lo que se arma a mano: color por vértice y caras planas. La tela y el plástico van de dos caras. */
export function materialDeMaqueta(side = THREE.FrontSide) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .88, metalness: 0, side });
}
