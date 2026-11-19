// src/entities/SellPoint.js
// Recicladora El Progreso: compra el material al peso. Una bodega de barrio: báscula de plataforma, pacas de cartón,
// lonas de botellas, chatarra, una carreta parqueada y el aviso pintado a mano.
import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';
import { withVisualRandom } from '../world/bogota/VisualRandom.js';
import { Piezas, materialDePuesto } from './puestoPiezas.js';
import { buildCartContact, buildRecyclerYard, RECYCLER_CART } from './RecyclerYard.js';

// Cotas en metros desde el centro. La bodega abre hacia la calle, que queda en -z.
const PISO = 0.12;
const ZUNCHO = '#2b2824';
const ACERO = '#70767c', ACERO_OSCURO = '#4a4f55', ZINC = '#939c9f';
const VERDE = '#1f6b3a', AMARILLO = '#c9a227', MADERA = '#6b5238', MADERA_VIEJA = '#54402c', LLANTA = '#1d1d1f';
const AVISO = { x: 0, y: PISO + 2.25, z: -0.46, ancho: 3.86, alto: 0.84 };
const MARCO = '#406257', MARCO_SOMBRA = '#30473f', BORDE_ZINC = '#b3b6a7';
// Las geometrías reemplazadas consumían este azar al generar UUID. El acopio nuevo se arma con azar visual.
const ACOPIO_DRAWS = 752;

/** Cubiertas de acopio contra las medianeras. Entre las dos queda abierta la entrada a la báscula. */
function cubiertaAcopio(k) {
  // La pendiente lleva el agua al muro. El borde interior queda alto para manipular carretas.
  for (const { lado, vuelo, frente } of [{ lado: -1, vuelo: 1.72, frente: -.37 }, { lado: 1, vuelo: 2.42, frente: .44 }]) {
    const xMuro = lado * 3.958, xLibre = lado * vuelo;
    const yMuro = 2.81, yLibre = 3.12, fondo = 2.88;
    const pliegue = Array.from({ length: 13 }, (_, i) => ({
      z: frente + (fondo - frente) * i / 12,
      y: i % 2 ? .027 : 0
    }));
    k.lamina([pliegue.map(p => [xMuro, yMuro + p.y, p.z]), pliegue.map(p => [xLibre, yLibre + p.y, p.z])], BORDE_ZINC);
    k.tramo([xMuro, yMuro - .018, frente], [xLibre, yLibre - .018, frente], .064, .04, '#bdc1b5');
    k.caja(.075, .10, fondo - frente, MARCO, [xLibre, yLibre - .04, (fondo + frente) / 2]);
    k.caja(.062, .065, fondo - frente, ZINC, [xMuro + lado * .011, yMuro - .021, (fondo + frente) / 2]);
    for (const z of [frente + .06, fondo - .12]) {
      k.tramo([xMuro, yMuro - .30, z], [xLibre, yLibre - .06, z], .075, .054, MARCO_SOMBRA);
    }
  }
  for (const x of [-1.64, 1.64]) {
    k.caja(.055, .14, .14, MARCO_SOMBRA, [x, 2.78, AVISO.z + .024]);
  }
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

/** Carreta de mano parqueada contra el muro. */
function carreta(k) {
  const { x, z, yaw, wheelX, track, footX } = RECYCLER_CART;
  k.en([x, PISO, z], [0, yaw, 0], () => {
    k.caja(1.5, 0.05, 0.82, MADERA, [0, 0.52, 0]);
    for (const z of [-0.39, 0.39]) {
      k.caja(1.5, 0.22, 0.03, MADERA_VIEJA, [0, 0.65, z]);
      k.tramo([0.7, 0.56, z], [1.75, 0.92, z], 0.045, 0.045, MADERA_VIEJA);
      const center = [wheelX, .3, Math.sign(z) * track];
      k.pieza(new THREE.CylinderGeometry(0.3, 0.3, 0.09, 10), LLANTA, center, [Math.PI / 2, 0, 0]);
      k.pieza(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 6), ACERO, center, [Math.PI / 2, 0, 0]);
    }
    k.caja(0.03, 0.22, 0.82, MADERA_VIEJA, [-0.74, 0.65, 0]);
    k.caja(0.05, 0.5, 0.05, MADERA_VIEJA, [footX, 0.25, 0]);
    k.caja(0.04, 0.04, 0.8, MADERA_VIEJA, [1.72, 0.91, 0]);
  });
}

/** Aviso de tabla pintado a brocha. Sin lienzo (en las pruebas) queda la tabla verde. */
function pintarAviso() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1472; c.height = 320;
  const x = c.getContext('2d');
  if (!x) return null;
  const medio = c.width / 2;
  let s = 7;
  const azar = () => ((s = Math.imul(s, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  x.fillStyle = VERDE; x.fillRect(0, 0, c.width, c.height);
  // Brochazos y tablas.
  for (let i = 0; i < 70; i++) {
    x.fillStyle = `rgba(${azar() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + azar() * 0.05})`;
    x.fillRect(azar() * c.width - 100, azar() * c.height, 120 + azar() * 380, 4 + azar() * 12);
  }
  x.fillStyle = 'rgba(0,0,0,.28)';
  for (const y of [104, 218]) x.fillRect(0, y, c.width, 3);
  x.strokeStyle = '#efe6cc'; x.lineWidth = 9; x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(22, 26); x.lineTo(c.width - 24, 20); x.lineTo(c.width - 20, 298); x.lineTo(18, 302); x.closePath(); x.stroke();
  const letras = (texto, y, alto, color, ancho) => {
    x.font = `900 ${alto}px "Arial Narrow", "Helvetica Neue", system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = color;
    const paso = Math.min(ancho / texto.length, alto * 0.72);
    let px = medio - paso * (texto.length - 1) / 2;
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
  letras('RECICLADORA', 73, 69, '#efe6cc', 1050);
  letras('EL PROGRESO', 160, 117, '#f2c230', 1260);
  letras('CARTÓN · CHATARRA · BOTELLA · PAGAMOS AL PESO', 267, 42, '#efe6cc', 1340);
  // Subrayado a pulso y chorreadas de pintura.
  x.strokeStyle = '#f2c230'; x.lineWidth = 7; x.lineCap = 'round';
  x.beginPath(); x.moveTo(medio - 303, 225); x.quadraticCurveTo(medio - 12, 216, medio + 287, 227); x.stroke();
  x.fillStyle = '#f2c230';
  for (const [px, largo] of [[medio - 198, 15], [medio + 38, 19], [medio + 226, 12]]) x.fillRect(px, 225, 5, largo);
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
    carreta(k);
    // El tubo y su pletina se anclan entre las medianeras. La tabla y la bombilla cuelgan del frente.
    k.caja(8, .16, .11, MARCO, [0, 2.86, AVISO.z + .045]);
    k.caja(8, .022, .135, MARCO_SOMBRA, [0, 2.942, AVISO.z + .045]);
    k.caja(AVISO.ancho + 0.06, AVISO.alto + 0.06, 0.035, MADERA_VIEJA, [AVISO.x, AVISO.y, AVISO.z + 0.012]);
    k.tramo([0.9, AVISO.y - AVISO.alto / 2, AVISO.z - 0.02], [0.9, AVISO.y - 0.5, AVISO.z - 0.02], 0.014, 0.014, ZUNCHO);
    k.tubo(0.03, 0.04, 0.07, 6, ZUNCHO, [0.9, AVISO.y - 0.52, AVISO.z - 0.02]);
    // Huellas de trabajo bajo el acopio, con el acceso a la báscula limpio.
    const y = PISO + 0.004;
    k.disco(0.5, 11, '#74726c', [2.5, y, -0.7], [1.5, 0.8], 0.4);
    k.disco(0.3, 9, '#66645f', [2.6, y + 0.002, -0.9], [1.2, 0.8], 1.0);

    // Las mallas de zinc son decorativas y sus UUID no consumen azar de la partida.
    withVisualRandom(() => cubiertaAcopio(k));
    this.bodega = k.malla(materialDePuesto());
    this.bodega.name = 'Recicladora';
    for (let i = 0; i < ACOPIO_DRAWS; i++) Math.random();
    this.group.add(this.bodega, buildRecyclerYard(PISO), buildCartContact(PISO));

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

  sell(inventory, mult = 1) {
    return inventory.sellAll(mult);
  }

  dispose() {
    this.scene.remove(this.group);
    const textures = new Set();
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      if (!o.material) return;
      for (const key of ['map', 'roughnessMap', 'metalnessMap', 'bumpMap']) {
        if (o.material[key]) textures.add(o.material[key]);
      }
      o.material.dispose();
    });
    for (const texture of textures) texture.dispose();
  }
}
