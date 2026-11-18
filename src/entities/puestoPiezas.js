// src/entities/puestoPiezas.js
// Piezas de los puestos de la calle (el dealer, la recicladora, la mesa): se arman con cajas, tubos y láminas de un
// solo color cada una y se funden en una malla con color por vértice. Un puesto entero cuesta así una llamada de dibujo.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const EJE_Y = new THREE.Vector3(0, 1, 0);

/** Material común de los puestos: caras planas y el color que trae cada vértice. */
export const materialDePuesto = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

export class Piezas {
  constructor() {
    this.partes = [];
    this.marco = null;
  }

  /** Lo que se agregue dentro de `armar` queda movido y girado como un solo bloque. */
  en(pos, rot, armar) {
    const antes = this.marco;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
    this.marco = antes ? antes.clone().multiply(m) : m;
    armar();
    this.marco = antes;
    return this;
  }

  /** Agrega una geometría ya hecha, pintada de un color, y la libera. */
  pieza(geometry, color, pos = [0, 0, 0], rot = [0, 0, 0], escala = [1, 1, 1]) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...escala));
    if (this.marco) m.premultiply(this.marco);
    g.applyMatrix4(m);
    const c = new THREE.Color(color), n = g.attributes.position.count, colores = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colores.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colores, 3));
    this.partes.push(g);
    return this;
  }

  caja(ancho, alto, fondo, color, pos, rot) {
    return this.pieza(new THREE.BoxGeometry(ancho, alto, fondo), color, pos, rot);
  }

  /** Tubo o tronco de cono de pie; `abierto` lo deja sin tapas. */
  tubo(arriba, abajo, alto, lados, color, pos, rot, abierto = false) {
    return this.pieza(new THREE.CylinderGeometry(arriba, abajo, alto, lados, 1, abierto), color, pos, rot);
  }

  /** Listón recto de `a` a `b` (brazos, piernas, cables, palos). */
  tramo(a, b, ancho, fondo, color) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), largo = va.distanceTo(vb);
    const q = new THREE.Quaternion().setFromUnitVectors(EJE_Y, vb.clone().sub(va).normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    return this.caja(ancho, largo, fondo, color, va.add(vb).multiplyScalar(.5).toArray(), [e.x, e.y, e.z]);
  }

  /** Mancha, charco o tapa: un disco acostado, estirado en x y z. */
  disco(radio, lados, color, pos, estira = [1, 1], giro = 0) {
    return this.pieza(new THREE.CircleGeometry(radio, lados), color, pos, [-Math.PI / 2, 0, giro], [estira[0], estira[1], 1]);
  }

  /** Lona o lámina por filas de puntos; se ve por las dos caras. */
  lamina(filas, color) {
    const p = [];
    const cara = (a, b, c) => p.push(...a, ...b, ...c);
    for (let i = 0; i + 1 < filas.length; i++) {
      for (let j = 0; j + 1 < filas[i].length; j++) {
        const a = filas[i][j], b = filas[i][j + 1], c = filas[i + 1][j + 1], d = filas[i + 1][j];
        cara(a, b, c); cara(a, c, d);
        cara(c, b, a); cara(d, c, a);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
    g.computeVertexNormals();
    return this.pieza(g, color);
  }

  get triangulos() {
    return this.partes.reduce((n, g) => n + g.attributes.position.count / 3, 0);
  }

  /** Funde todo en una malla y suelta las piezas sueltas. */
  malla(material, { sombra = true } = {}) {
    const geometry = mergeGeometries(this.partes);
    for (const g of this.partes) g.dispose();
    this.partes = [];
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = sombra;
    mesh.receiveShadow = true;
    return mesh;
  }
}

const MADERA = '#7a5a3a', MADERA_VIEJA = '#5d4630', MADERA_CLARA = '#8a6a45';

/** Guacal de listones puesto boca abajo: sirve de mesa o de pata. Mide `ancho` × `alto` × `fondo` y se apoya en `pos`. */
export function guacal(k, pos, giro = 0, { ancho = 0.66, alto = 0.52, fondo = 0.48 } = {}) {
  const x = ancho / 2 - 0.03, z = fondo / 2 - 0.03, h = alto - 0.02;
  k.en(pos, [0, giro, 0], () => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.caja(0.05, h, 0.05, MADERA_VIEJA, [sx * x, h / 2, sz * z]);
    for (const t of [0.2, 0.53, 0.86]) {
      k.caja(ancho, 0.1, 0.02, MADERA, [0, h * t, z + 0.02]);
      k.caja(ancho, 0.1, 0.02, MADERA_VIEJA, [0, h * t, -z - 0.02]);
      k.caja(0.02, 0.1, fondo - 0.04, MADERA, [x + 0.02, h * t, 0]);
      k.caja(0.02, 0.1, fondo - 0.04, MADERA_VIEJA, [-x - 0.02, h * t, 0]);
    }
    const tablas = Math.max(3, Math.round(ancho / 0.135)), paso = ancho / tablas;
    for (let i = 0; i < tablas; i++) k.caja(paso - 0.02, 0.02, fondo + 0.02, i % 2 ? MADERA : MADERA_CLARA, [-ancho / 2 + paso * (i + 0.5), h + 0.01, 0]);
  });
  return k;
}

/** Banquito de tabla con cuatro patas abiertas. */
export function banquito(k, pos, giro = 0) {
  k.en(pos, [0, giro, 0], () => {
    k.caja(0.34, 0.035, 0.26, MADERA, [0, 0.43, 0]);
    for (const [x, z] of [[-0.13, -0.09], [0.13, -0.09], [-0.13, 0.09], [0.13, 0.09]]) k.tramo([x * 1.25, 0, z * 1.25], [x, 0.42, z], 0.04, 0.04, MADERA_VIEJA);
    k.caja(0.26, 0.03, 0.03, MADERA_VIEJA, [0, 0.2, 0.1]);
  });
  return k;
}
