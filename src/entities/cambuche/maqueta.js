// src/entities/cambuche/maqueta.js
// Arma una pieza del cambuche como una sola malla: cada parte se pinta por vértice y todas se unen,
// así una pieza entera cuesta una llamada de dibujo y comparte material con las demás.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Paleta corta: negro del plástico, azul de la lona y cartón, con la cobija y el guacal de acento cálido. La tela, el
 * plástico y la lata van en tonos apagados, cerca de los tonos medios del modelo escaneado al que acompañan.
 */
export const PALETA = Object.freeze({
  plastico: '#1b1e24', plasticoClaro: '#2c3038', lona: '#284675', lonaClara: '#3b5d88', cinta: '#767e84', polisombra: '#1e3a2a',
  zinc: '#6c7375', zincOscuro: '#585f61', oxido: '#6a4732', carton: '#a9814f', cartonViejo: '#8b6a41', tabla: '#73553a', tablaVieja: '#5b4632', tablaClara: '#8a6c4b',
  palo: '#4a3a28', piedra: '#716d67', llanta: '#1c1c1e', polvo: '#6b5f50', cuerda: '#a39369', cobija: '#5e3a30', raya: '#a89a7c',
  colchon: '#b8b29f', sabana: '#c4bdaa', olla: '#262524', tizne: '#141312', balde: '#d6d2c6', guacal: '#a8502f',
  lata: '#9aa0a6', hoja: '#3f7d3a', cera: '#f2eee0', tierra: '#5a4a3a', ceniza: '#6f6a64',
  mezclilla: '#45566c', camisa: '#c9c2b0',
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
const _polvo = new THREE.Color(), _du = new THREE.Vector3(), _dv = new THREE.Vector3();

export class Maqueta {
  constructor(seed = 1) {
    this.partes = [];
    this.r = azar(seed);
  }

  /** Suma una geometría pintada de un color; `tono` es cuánto cambia la luz de una cara a otra. */
  pon(geometry, color, { en = [0, 0, 0], giro = [0, 0, 0], escala = 1, tono = .07, polvo = null } = {}) {
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    _scale.set(...(Array.isArray(escala) ? escala : [escala, escala, escala]));
    _matrix.compose(_position.set(...en), _quaternion.setFromEuler(_euler.set(...giro)), _scale);
    part.applyMatrix4(_matrix);
    for (const name of Object.keys(part.attributes)) if (name !== 'position') part.deleteAttribute(name);
    part.computeVertexNormals();
    const count = part.attributes.position.count, colors = new Float32Array(count * 3), normals = part.attributes.normal;
    for (let i = 0; i < count; i += 3) {
      const k = 1 + (this.r() - .5) * 2 * tono;
      // El polvo se asienta en las caras que miran hacia arriba.
      _color.set(color);
      if (polvo && normals.getY(i) > .25) _color.lerp(_polvo.set(polvo), Math.min(.6, normals.getY(i) * .6));
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
    return this.pon(new THREE.TorusGeometry(radio, radio * .36, 5, 10), PALETA.llanta, { en, giro, tono: .2, polvo: PALETA.polvo });
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
   * Tela, plástico o lámina: una rejilla cuyos puntos da `punto(u, v)` con u y v de 0 a 1, de superficie continua
   * (sin caras marcadas). `color` puede ser una función (u, v) → color para pintar parches o rayas; con `suave` se
   * pinta por punto y no por cuadro, para degradados. `sombra(u, v, y)` oscurece por punto: la mugre de la orilla y
   * la sombra de lo que toca el piso.
   */
  tela(nu, nv, punto, color, { tono = .09, suave = false, sombra = null } = {}) {
    const positions = [], normals = [], colors = [], grid = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, p = punto(u, v);
      grid.push({ p, u, v, k: (1 + (this.r() - .5) * 2 * tono) * (sombra ? sombra(u, v, p[1]) : 1), n: [0, 1, 0] });
    }
    const at = (i, j) => grid[Math.min(nv, Math.max(0, j)) * (nu + 1) + Math.min(nu, Math.max(0, i))];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      _du.fromArray(at(i + 1, j).p).sub(_a.fromArray(at(i - 1, j).p));
      _dv.fromArray(at(i, j + 1).p).sub(_a.fromArray(at(i, j - 1).p)).cross(_du);
      if (_dv.lengthSq() > 1e-12) at(i, j).n = _dv.normalize().toArray();
    }
    const pinta = (u, v) => _color.set(typeof color === 'function' ? color(u, v) : color);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (!suave) pinta((i + .5) / nu, (j + .5) / nv);
      const flip = (i + j) % 2 === 0;
      const quad = flip ? [at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)]
        : [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j)];
      for (const g of quad) {
        if (suave) pinta(g.u, g.v);
        positions.push(...g.p); normals.push(...g.n); colors.push(_color.r * g.k, _color.g * g.k, _color.b * g.k);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
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

/**
 * El material de lo que se arma a mano, con color por vértice. Las cajas, palos y piedras llevan sus caras marcadas
 * en la propia geometría; con `liso`, la tela, el plástico y la lata se ven continuos, y va de dos caras.
 */
export function materialDeMaqueta(side = THREE.FrontSide, liso = false) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: !liso, roughness: liso ? .8 : .88, metalness: 0, side });
}
