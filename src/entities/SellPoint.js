// src/entities/SellPoint.js
// Recicladora El Progreso: compra el material al peso. Una bodega de barrio: báscula de plataforma, pacas de cartón,
// lonas de botellas, chatarra, una carreta parqueada y el aviso pintado a mano.
import * as THREE from 'three';
import { COLORS, INTERACT_RANGE } from '../utils/constants.js';
import { Piezas, materialDePuesto } from './puestoPiezas.js';
export const RECYCLER_NAME = 'Recicladora El Progreso';

// Cotas en metros desde el centro. La bodega abre hacia la calle, que queda en -z.
const PISO = 0.12;
const CARTON = '#a17e52', CARTON_OSCURO = '#8b6c45', ZUNCHO = '#2b2824';
const LONA = '#cfcabb', LONA_SOMBRA = '#b4af9f', BOTELLA = '#9fb5a6', BOTELLA_CLARA = '#c9d6d0', BOTELLA_VERDE = '#5f8f6f';
const ACERO = '#70767c', ACERO_OSCURO = '#4a4f55', OXIDO = '#6b4630', ZINC = '#939c9f';
const VERDE = '#1f6b3a', AMARILLO = '#c9a227', MADERA = '#6b5238', MADERA_VIEJA = '#54402c', LLANTA = '#1d1d1f';
const AVISO = { x: 0, y: PISO + 2.25, z: 1.0, ancho: 2.7, alto: 0.84 };

/** Paca de cartón aplastado, amarrada con dos zunchos. */
function paca(k, x, y, z, giro = 0, color = CARTON) {
  k.en([x, PISO + y, z], [0, giro, 0], () => {
    k.caja(0.95, 0.6, 0.7, color, [0, 0.3, 0]);
    for (const h of [0.2, 0.4]) k.caja(0.97, 0.014, 0.72, CARTON_OSCURO, [0, h, 0]);
    for (const dx of [-0.24, 0.24]) k.caja(0.045, 0.61, 0.73, ZUNCHO, [dx, 0.305, 0]);
  });
}

/** Lona grande, de las de escombro, llena de botellas hasta arriba. */
function lona(k, x, z, alto, giro) {
  k.en([x, PISO, z], [0, giro, 0], () => {
    k.tubo(0.56, 0.5, alto, 8, LONA, [0, alto / 2, 0], [0, 0, 0], true);
    k.tubo(0.575, 0.565, 0.07, 8, LONA_SOMBRA, [0, alto - 0.06, 0], [0, 0, 0], true);
    k.pieza(new THREE.SphereGeometry(0.52, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), BOTELLA, [0, alto - 0.1, 0], [0, 0, 0], [1, 0.42, 1]);
    for (const [bx, bz, color, rot] of [[0.2, 0.1, BOTELLA_CLARA, [1.1, 0.3, 0]], [-0.22, -0.12, BOTELLA_VERDE, [1.3, 1.9, 0]], [0.02, -0.26, BOTELLA_VERDE, [0.9, 4, 0]], [-0.1, 0.28, BOTELLA_CLARA, [1.2, 5.2, 0]], [0.3, -0.2, BOTELLA_CLARA, [1.45, 2.6, 0]], [-0.3, 0.14, BOTELLA_VERDE, [1.5, 0.9, 0]]]) {
      k.tubo(0.035, 0.05, 0.24, 6, color, [bx, alto + 0.08, bz], rot);
    }
    for (const [ox, oz] of [[0.4, 0.4], [-0.4, 0.4], [0.4, -0.4], [-0.4, -0.4]]) k.caja(0.06, 0.2, 0.02, LONA_SOMBRA, [ox, alto + 0.02, oz], [0, Math.atan2(ox, oz), 0.5]);
  });
}

/** Báscula de plataforma: lámina con borde amarillo, columna y reloj. Mira a la calle. */
function bascula(k) {
  k.en([0, PISO, 0.15], [0, 0, 0], () => {
    k.caja(1.16, 0.05, 0.96, ACERO_OSCURO, [0, 0.025, 0]);
    k.caja(1.1, 0.07, 0.9, ACERO, [0, 0.085, 0]);
    for (const [w, d, x, z] of [[1.1, 0.05, 0, -0.425], [1.1, 0.05, 0, 0.425], [0.05, 0.8, -0.525, 0], [0.05, 0.8, 0.525, 0]]) k.caja(w, 0.012, d, AMARILLO, [x, 0.126, z]);
    for (const x of [-0.3, -0.1, 0.1, 0.3]) k.caja(0.03, 0.008, 0.7, ACERO_OSCURO, [x, 0.124, 0]);
    k.caja(0.3, 0.02, 0.28, ACERO_OSCURO, [0.36, 0.13, 0.43]);
    k.caja(0.1, 1.2, 0.07, VERDE, [0.36, 0.73, 0.45]);
    k.tubo(0.22, 0.22, 0.1, 10, VERDE, [0.36, 1.45, 0.43], [Math.PI / 2, 0, 0]);
    k.tubo(0.185, 0.185, 0.02, 10, '#e8e3d6', [0.36, 1.45, 0.375], [Math.PI / 2, 0, 0]);
    k.caja(0.018, 0.17, 0.012, '#a3261c', [0.39, 1.5, 0.36], [0, 0, -0.55]);
    k.caja(0.035, 0.035, 0.016, ACERO_OSCURO, [0.36, 1.45, 0.36]);
    k.caja(0.46, 0.03, 0.05, ACERO_OSCURO, [0.36, 1.12, 0.43]);
    k.tubo(0.045, 0.045, 0.1, 6, ACERO_OSCURO, [0.16, 1.12, 0.43], [0, 0, Math.PI / 2]);
  });
  // Marco de pesaje pintado en el piso, ya gastado.
  for (const [w, d, x, z] of [[0.9, 0.07, -0.45, -0.75], [0.55, 0.07, 0.6, -0.75], [0.07, 1.1, -1.0, -0.1], [0.07, 0.6, 1.0, 0.45], [0.07, 0.5, 1.0, -0.45]]) k.caja(w, 0.006, d, AMARILLO, [x, PISO + 0.004, z + 0.15]);
}

/** Carreta de mano parqueada contra el muro, cargada de cartón. */
function carreta(k) {
  k.en([-3.05, PISO, -0.7], [0, Math.PI / 2 - 0.12, 0], () => {
    k.caja(1.5, 0.05, 0.82, MADERA, [0, 0.52, 0]);
    for (const z of [-0.39, 0.39]) {
      k.caja(1.5, 0.22, 0.03, MADERA_VIEJA, [0, 0.65, z]);
      k.tramo([0.7, 0.56, z], [1.75, 0.92, z], 0.045, 0.045, MADERA_VIEJA);
      k.pieza(new THREE.CylinderGeometry(0.3, 0.3, 0.09, 10), LLANTA, [-0.1, 0.3, z * 1.22], [Math.PI / 2, 0, 0]);
      k.pieza(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 6), ACERO, [-0.1, 0.3, z * 1.22], [Math.PI / 2, 0, 0]);
    }
    k.caja(0.03, 0.22, 0.82, MADERA_VIEJA, [-0.74, 0.65, 0]);
    k.caja(0.05, 0.5, 0.05, MADERA_VIEJA, [0.68, 0.25, 0]);
    k.caja(0.04, 0.04, 0.8, MADERA_VIEJA, [1.72, 0.91, 0]);
    for (const [y, giro, color] of [[0.58, 0.05, CARTON], [0.63, -0.08, CARTON_OSCURO], [0.68, 0.12, CARTON], [0.73, -0.03, '#b08b5d']]) k.caja(1.25, 0.05, 0.7, color, [-0.05, y, 0], [0, giro, 0]);
    k.caja(0.5, 0.3, 0.45, CARTON_OSCURO, [-0.3, 0.9, 0.05], [0, 0.4, 0]);
    k.caja(0.52, 0.02, 0.05, ZUNCHO, [-0.3, 0.9, 0.05], [0, 0.4, 0]);
  });
}

/** Montón de chatarra: caneca acostada, tejas de zinc contra el muro, tubos y un rin. */
function chatarra(k) {
  k.tubo(0.29, 0.29, 0.85, 10, OXIDO, [2.75, PISO + 0.29, -1.35], [Math.PI / 2, 0, 0.5]);
  const teja = (x0, giro) => {
    const filas = [];
    for (let i = 0; i <= 1; i++) {
      const fila = [];
      for (let j = 0; j <= 8; j++) fila.push([x0 + (j % 2 ? 0.035 : -0.035) + i * 0.55, PISO + i * 1.5, -1.9 + j * 0.11 + giro * i]);
      filas.push(fila);
    }
    k.lamina(filas, ZINC);
  };
  teja(3.3, 0.1);
  teja(3.15, -0.25);
  for (const [a, b, r, color] of [[[2.2, 0.05, -0.4], [3.6, 0.3, -0.7], 0.035, ACERO], [[2.4, 0.05, -0.75], [3.7, 0.12, -0.3], 0.03, OXIDO], [[2.1, 0.04, -1.0], [3.3, 0.04, -0.2], 0.025, ACERO_OSCURO]]) {
    k.tramo([a[0], PISO + a[1], a[2]], [b[0], PISO + b[1], b[2]], r * 2, r * 2, color);
  }
  k.pieza(new THREE.TorusGeometry(0.3, 0.035, 4, 10), ACERO, [2.25, PISO + 0.33, -1.75], [0, 0.5, 0.12]);
  k.caja(0.5, 0.32, 0.36, VERDE, [1.75, PISO + 0.16, -1.2], [0, 0.3, 0]);
  for (const [x, z] of [[-0.12, -0.08], [0.1, 0.05], [0.0, -0.02], [-0.1, 0.1], [0.14, -0.1]]) k.tubo(0.02, 0.04, 0.2, 5, '#3e5a46', [1.75 + x, PISO + 0.38, -1.2 + z]);
}

/** Aviso de tabla pintado a brocha. Sin lienzo (en las pruebas) queda la tabla verde. */
function pintarAviso() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 320;
  const x = c.getContext('2d');
  if (!x) return null;
  let s = 7;
  const azar = () => ((s = Math.imul(s, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  x.fillStyle = VERDE; x.fillRect(0, 0, 1024, 320);
  // Brochazos y tablas.
  for (let i = 0; i < 70; i++) {
    x.fillStyle = `rgba(${azar() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + azar() * 0.05})`;
    x.fillRect(azar() * 1024 - 100, azar() * 320, 120 + azar() * 380, 4 + azar() * 12);
  }
  x.fillStyle = 'rgba(0,0,0,.28)';
  for (const y of [104, 212]) x.fillRect(0, y, 1024, 3);
  x.strokeStyle = '#efe6cc'; x.lineWidth = 9; x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(22, 26); x.lineTo(1000, 20); x.lineTo(1004, 298); x.lineTo(18, 302); x.closePath(); x.stroke();
  const letras = (texto, y, alto, color, ancho) => {
    x.font = `900 ${alto}px "Arial Narrow", "Helvetica Neue", system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = color;
    const paso = Math.min(ancho / texto.length, alto * 0.72);
    let px = 512 - paso * (texto.length - 1) / 2;
    for (const letra of texto) {
      x.save();
      x.translate(px, y + (azar() - 0.5) * alto * 0.14);
      x.rotate((azar() - 0.5) * 0.13);
      x.scale(0.9 + azar() * 0.2, 0.9 + azar() * 0.2);
      x.fillText(letra, 0, 0);
      x.restore();
      px += paso;
    }
  };
  letras('RECICLADORA', 72, 64, '#efe6cc', 800);
  letras('EL PROGRESO', 156, 108, '#f2c230', 900);
  letras('CARTÓN · CHATARRA · BOTELLA · PAGAMOS AL PESO', 266, 36, '#efe6cc', 930);
  // Subrayado a pulso y chorreadas de pintura.
  x.strokeStyle = '#f2c230'; x.lineWidth = 7; x.lineCap = 'round';
  x.beginPath(); x.moveTo(250, 222); x.quadraticCurveTo(500, 212, 790, 224); x.stroke();
  x.fillStyle = '#f2c230';
  for (const [px, largo] of [[322, 16], [540, 26], [731, 12]]) x.fillRect(px, 222, 5, largo);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class SellPoint {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'recycler';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    const k = new Piezas();
    bascula(k);
    // Pacas de cartón al fondo, a la izquierda: dos pisos y una suelta.
    paca(k, -3.35, 0, 2.45, 0.03);
    paca(k, -2.3, 0, 2.4, -0.05, CARTON_OSCURO);
    paca(k, -1.25, 0, 2.5, 0.06);
    paca(k, -2.85, 0.61, 2.45, 0.08, CARTON_OSCURO);
    paca(k, -1.8, 0.61, 2.45, -0.04);
    paca(k, -3.3, 0, 1.45, 1.45);
    // Lonas de botellas al fondo, a la derecha.
    lona(k, 1.95, 2.3, 1.05, 0.2);
    lona(k, 3.15, 2.15, 1.15, 0.9);
    lona(k, 3.2, 0.95, 0.95, 0.5);
    carreta(k);
    chatarra(k);
    // Postes y tabla del aviso; la bombilla cuelga de la tabla.
    for (const px of [-1.22, 1.22]) k.caja(0.08, AVISO.y + 0.3 - PISO, 0.08, MADERA_VIEJA, [px, (AVISO.y + 0.3 + PISO) / 2, AVISO.z + 0.07]);
    k.caja(AVISO.ancho + 0.06, AVISO.alto + 0.06, 0.035, MADERA_VIEJA, [AVISO.x, AVISO.y, AVISO.z + 0.012]);
    k.tramo([0.9, AVISO.y - AVISO.alto / 2, AVISO.z - 0.02], [0.9, AVISO.y - 0.5, AVISO.z - 0.02], 0.014, 0.014, ZUNCHO);
    k.tubo(0.03, 0.04, 0.07, 6, ZUNCHO, [0.9, AVISO.y - 0.52, AVISO.z - 0.02]);
    // Piso: cartones pisados, manchas de aceite y latas.
    const y = PISO + 0.004;
    k.caja(1.1, 0.012, 0.8, CARTON_OSCURO, [-1.7, PISO + 0.008, 0.9], [0, 0.4, 0]);
    k.caja(0.7, 0.012, 0.5, CARTON, [1.4, PISO + 0.008, 1.3], [0, -0.3, 0]);
    k.caja(0.6, 0.012, 0.45, CARTON, [-1.3, PISO + 0.014, 1.05], [0, 1.0, 0]);
    k.disco(0.5, 11, '#74726c', [2.5, y, -0.7], [1.5, 0.8], 0.4);
    k.disco(0.3, 9, '#66645f', [2.6, y + 0.002, -0.9], [1.2, 0.8], 1.0);
    k.disco(0.35, 10, '#77756f', [-2.3, y, -1.2], [1.3, 0.8], 1.0);
    for (const [lx, lz, giro] of [[0.9, -1.2, 0.4], [-0.8, 1.6, 1.9], [2.0, 0.4, 2.6]]) k.tubo(0.033, 0.033, 0.11, 6, '#9aa0a5', [lx, PISO + 0.035, lz], [Math.PI / 2, 0, giro]);

    this.bodega = k.malla(materialDePuesto());
    this.bodega.name = 'Recicladora';
    this.group.add(this.bodega);

    // Aviso: mira a la calle y de noche se alcanza a leer.
    const pintura = pintarAviso();
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(AVISO.ancho, AVISO.alto),
      new THREE.MeshLambertMaterial(pintura
        ? { map: pintura, emissive: 0xffffff, emissiveMap: pintura, emissiveIntensity: 0.22 }
        : { color: VERDE })
    );
    sign.name = 'Aviso de la recicladora';
    sign.rotation.y = Math.PI;
    sign.position.set(AVISO.x, AVISO.y, AVISO.z - 0.008);
    this.group.add(sign);

    // Luz ámbar (nivel 0)
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 4), new THREE.MeshBasicMaterial({ color: COLORS.ACCENT_AMBER, toneMapped: false }));
    light.name = 'Bombilla de la recicladora';
    light.position.set(0.9, AVISO.y - 0.59, AVISO.z - 0.02);
    this.group.add(light);
  }

  get position() { return this.group.position; }

  /** La llegada se anuncia cuando ya se alcanza la báscula. */
  get gpsWaypoint() {
    const { x, z } = this.position;
    return { x, z, arrivalDistance: INTERACT_RANGE - .15 };
  }

  sell(inventory, mult = 1) {
    return inventory.sellAll(mult);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
