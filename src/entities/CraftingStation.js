// src/entities/CraftingStation.js
import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';
import { Piezas, banquito, guacal, materialDePuesto } from './puestoPiezas.js';

// Cotas en metros desde el centro del círculo. Se trabaja desde -z; el tablero de herramientas queda al fondo, en +z.
const SUELO = 0.04, MESA = SUELO + 0.87, FONDO = 0.56;
const TABLA = '#7b5c3c', TABLA_CLARA = '#8f6d48', TABLA_VIEJA = '#5d4630';
const ACERO = '#8d9399', ACERO_OSCURO = '#555a60', MANGO = '#a8552b', LONA = '#586648', LONA_CLARA = '#66755a', CABUYA = '#b39b6b', CAUCHO = '#1e1e20';

/** Tablero de palos y listones con la herramienta colgada: serrucho, martillo, alicate, llave y rollos. */
function tablero(k) {
  for (const x of [-1.0, 1.0]) k.caja(0.07, 2.2, 0.07, TABLA_VIEJA, [x, SUELO + 1.1, FONDO]);
  // Una puerta vieja de fondo y tres listones de donde cuelga todo.
  k.caja(1.94, 0.98, 0.02, '#4e4133', [0, SUELO + 1.53, FONDO - 0.02]);
  for (const [y, color] of [[1.22, TABLA], [1.55, TABLA_VIEJA], [1.88, TABLA]]) k.caja(2.0, 0.13, 0.025, color, [0, SUELO + y, FONDO - 0.045]);
  const z = FONDO - 0.075;
  // Serrucho.
  k.en([-0.62, SUELO + 1.62, z], [0, 0, -0.5], () => {
    k.caja(0.5, 0.1, 0.008, ACERO, [0.2, 0, 0]);
    k.caja(0.3, 0.04, 0.008, ACERO, [0.28, -0.065, 0]);
    k.caja(0.13, 0.15, 0.03, MANGO, [-0.09, -0.01, 0]);
  });
  // Martillo.
  k.caja(0.035, 0.32, 0.03, TABLA_CLARA, [-0.12, SUELO + 1.5, z]);
  k.caja(0.14, 0.05, 0.045, ACERO_OSCURO, [-0.12, SUELO + 1.68, z]);
  // Alicate.
  k.tramo([0.12, SUELO + 1.36, z], [0.2, SUELO + 1.62, z], 0.022, 0.014, MANGO);
  k.tramo([0.22, SUELO + 1.36, z], [0.14, SUELO + 1.62, z], 0.022, 0.014, MANGO);
  k.caja(0.05, 0.1, 0.016, ACERO_OSCURO, [0.17, SUELO + 1.66, z]);
  // Llave.
  k.caja(0.03, 0.28, 0.012, ACERO, [0.42, SUELO + 1.5, z], [0, 0, 0.12]);
  k.caja(0.07, 0.06, 0.014, ACERO, [0.4, SUELO + 1.66, z], [0, 0, 0.12]);
  // Rollo de alambre y rollo de cabuya.
  k.pieza(new THREE.TorusGeometry(0.11, 0.018, 4, 9), ACERO_OSCURO, [0.68, SUELO + 1.44, z - 0.01]);
  k.pieza(new THREE.TorusGeometry(0.13, 0.03, 4, 9), CABUYA, [-0.42, SUELO + 1.18, z - 0.02]);
  for (const x of [-0.62, -0.12, 0.17, 0.42, 0.68, -0.42]) k.caja(0.015, 0.015, 0.06, ACERO_OSCURO, [x, SUELO + (x === -0.42 ? 1.3 : 1.72), z + 0.01]);
}

/** Lona amarrada del tablero a dos palos de adelante, con su comba y los vientos a dos piedras. */
function lona(k) {
  const atras = SUELO + 2.24, frente = SUELO + 2.02, z0 = FONDO + 0.12, z1 = -0.62;
  for (const x of [-1.18, 1.18]) {
    k.tramo([x, SUELO, z1], [x * 0.98, frente + 0.04, z1 + 0.04], 0.05, 0.05, TABLA_VIEJA);
    k.tramo([x * 0.98, frente, z1], [x * 1.45, SUELO + 0.1, z1 - 0.75], 0.012, 0.012, CABUYA);
    k.caja(0.2, 0.12, 0.16, '#6f6a62', [x * 1.45, SUELO + 0.06, z1 - 0.78], [0, x, 0]);
  }
  const fila = (z, y, comba) => [[-1.24, y, z], [-0.4, y - comba, z], [0.4, y - comba * 0.8, z], [1.24, y + 0.02, z]];
  const zm = (z0 + z1) / 2;
  k.lamina([fila(z0 + 0.25, atras - 0.2, 0.02), fila(z0, atras, 0.03), fila(zm, (atras + frente) / 2 - 0.03, 0.12)], LONA);
  k.lamina([fila(zm, (atras + frente) / 2 - 0.03, 0.12), fila(z1, frente, 0.06), fila(z1 - 0.1, frente - 0.12, 0.05)], LONA_CLARA);
  // Un remiendo cosido.
  k.caja(0.42, 0.012, 0.34, '#7d7a5c', [0.62, (atras + frente) / 2 + 0.01, zm + 0.28], [0.17, 0.2, 0]);
}

/** Lo que hay sobre las tablas: un pedazo de riel de yunque, martillo, tarro con puntillas y retazos. */
function sobreLaMesa(k) {
  const y = MESA + 0.045;
  // Riel de yunque.
  k.en([-0.52, y, 0.02], [0, 0.25, 0], () => {
    k.caja(0.34, 0.03, 0.14, ACERO_OSCURO, [0, 0.015, 0]);
    k.caja(0.3, 0.09, 0.035, ACERO_OSCURO, [0, 0.07, 0]);
    k.caja(0.36, 0.045, 0.09, ACERO, [0, 0.135, 0]);
  });
  // Martillo acostado.
  k.caja(0.32, 0.03, 0.035, TABLA_CLARA, [-0.02, y + 0.02, -0.12], [0, 0.6, 0]);
  k.caja(0.05, 0.05, 0.14, ACERO_OSCURO, [0.1, y + 0.03, -0.21], [0, 0.6, 0]);
  // Tarro con puntillas.
  k.tubo(0.055, 0.055, 0.12, 8, '#a3a9ae', [0.28, y + 0.06, 0.16], [0, 0, 0], true);
  k.disco(0.05, 8, '#3b3d40', [0.28, y + 0.1, 0.16]);
  for (const [dx, dz, rx, rz] of [[0.02, 0.01, 0.2, 0.1], [-0.02, 0.02, -0.15, 0.25], [0.0, -0.025, 0.3, -0.2], [0.025, -0.01, -0.1, -0.3], [-0.025, -0.015, 0.1, 0.3]]) {
    k.caja(0.008, 0.11, 0.008, ACERO_OSCURO, [0.28 + dx, y + 0.13, 0.16 + dz], [rx, 0, rz]);
  }
  // Frasco de pegante y carrete.
  k.tubo(0.04, 0.045, 0.13, 7, '#c9a23a', [0.05, y + 0.065, 0.22]);
  k.tubo(0.02, 0.03, 0.035, 6, '#7a2a22', [0.05, y + 0.147, 0.22]);
  k.tubo(0.035, 0.035, 0.07, 7, CABUYA, [-0.2, y + 0.035, 0.24]);
  // Retazos de tela, cuero y lata; una tira de neumático cuelga del borde.
  for (const [x, z, w, d, color, giro, h] of [[0.62, 0.05, 0.34, 0.26, '#6d2f2c', 0.2, 0.012], [0.7, -0.08, 0.26, 0.2, '#39476a', -0.4, 0.024], [0.55, -0.16, 0.2, 0.14, '#b7a67c', 0.9, 0.034], [0.8, 0.16, 0.16, 0.2, ACERO, 0.3, 0.012], [-0.25, -0.2, 0.2, 0.12, '#b7a67c', -0.2, 0.012]]) {
    k.caja(w, 0.012, d, color, [x, y + h, z], [0, giro, 0]);
  }
  k.caja(0.07, 0.012, 0.3, CAUCHO, [0.38, y + 0.008, -0.34]);
  k.caja(0.07, 0.3, 0.012, CAUCHO, [0.38, y - 0.14, -0.49]);
}

/** Alrededor: balde, llanta, palos y recortes, el banquito y el cartón donde se pisa. */
function alrededor(k) {
  k.tubo(0.17, 0.13, 0.3, 8, MANGO, [-1.25, SUELO + 0.15, 0.1], [0, 0, 0], true);
  k.disco(0.13, 8, '#3b3d40', [-1.25, SUELO + 0.02, 0.1]);
  k.pieza(new THREE.TorusGeometry(0.17, 0.012, 3, 8, Math.PI), ACERO_OSCURO, [-1.25, SUELO + 0.3, 0.1], [0, 0.6, 0]);
  k.pieza(new THREE.TorusGeometry(0.27, 0.1, 5, 10), CAUCHO, [1.32, SUELO + 0.37, 0.42], [0.12, Math.PI / 2 - 0.3, 0]);
  for (const [a, b, color] of [[[1.05, 0.02, -0.1], [1.2, 1.5, 0.5], TABLA], [[1.5, 0.02, -0.25], [1.38, 1.25, 0.5], TABLA_VIEJA], [[0.9, 0.05, -0.75], [1.75, 0.05, -0.55], TABLA_CLARA], [[1.0, 0.05, -0.95], [1.7, 0.11, -0.6], TABLA]]) {
    k.tramo([a[0], SUELO + a[1], a[2]], [b[0], SUELO + b[1], b[2]], 0.09, 0.03, color);
  }
  banquito(k, [-0.45, SUELO, -0.85], -0.3);
  k.caja(1.7, 0.012, 0.9, '#86694a', [0.05, SUELO + 0.012, -0.9], [0, 0.06, 0]);
  const y = SUELO + 0.022;
  k.disco(0.5, 8, '#8a744f', [0.5, y + 0.004, -0.75], [1.4, 0.6], 0.2);
  k.disco(0.4, 11, '#5a4d3c', [-1.1, y, -0.45], [1.2, 0.8], 0.8);
  for (const [x, z, giro] of [[0.75, -1.05, 0.3], [0.2, -0.6, 1.2], [1.2, -1.2, 2.0], [-0.9, -1.15, 0.7]]) k.caja(0.16, 0.014, 0.05, TABLA_CLARA, [x, SUELO + 0.03, z], [0, giro, 0]);
}

/**
 * La mesa. Junto a ella, E abre lo mismo que C abre desde cualquier parte.
 */
export class CraftingStation {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'mesa';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    // Banco de trabajo: cuatro tablas sobre dos pilas de guacales.
    const k = new Piezas();
    for (const x of [-0.62, 0.62]) {
      guacal(k, [x, SUELO, 0], x * 0.08, { ancho: 0.5, alto: 0.44, fondo: 0.66 });
      guacal(k, [x * 1.02, SUELO + 0.44, 0.01], -x * 0.1, { ancho: 0.5, alto: 0.43, fondo: 0.66 });
    }
    for (const [i, largo, corre, color] of [[0, 1.86, 0.02, TABLA], [1, 1.96, -0.05, TABLA_CLARA], [2, 1.82, 0.04, TABLA_VIEJA], [3, 1.92, -0.01, TABLA]]) {
      k.caja(largo, 0.045, 0.2, color, [corre, MESA + 0.0225, -0.33 + i * 0.215], [0, (i - 1.5) * 0.012, 0]);
    }
    tablero(k);
    lona(k);
    sobreLaMesa(k);
    alrededor(k);
    this.banco = k.malla(materialDePuesto());
    this.banco.name = 'Banco de trabajo';
    this.group.add(this.banco);

    // Marcador
    const markerGeo = new THREE.RingGeometry(1.2, 1.5, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_GREEN,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.group.add(this.marker);
  }

  get position() { return this.group.position; }

  update(dt) {
    if (this.marker) this.marker.rotation.z += dt * 0.6;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
