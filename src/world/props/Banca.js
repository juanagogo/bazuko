// src/world/props/Banca.js
import * as THREE from 'three';
import { createNoise, mix } from '../bogota/SignalModel.js';

// Vetas gastadas sin canvas: la misma textura para todas las bancas y también en Node.
let woodGrain = null;
function sharedWoodGrain() {
  if (woodGrain) return woodGrain;
  const size = 64, data = new Uint8Array(size * size * 4), noise = createNoise(0x4d1f);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const stretched = noise(x / 22, y / 2.2 + 4, 3), fine = noise(x / 6 + 9, y / .9, 11), worn = noise(x / 9 + 2, y / 7 + 31, 7);
    const v = (118 + stretched * 96 + fine * 34) * mix(.84, 1.08, worn);
    const i = (y * size + x) * 4;
    data[i] = Math.min(255, v * 1.02); data[i + 1] = Math.min(255, v * .95); data[i + 2] = Math.min(255, v * .84); data[i + 3] = 255;
  }
  woodGrain = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  woodGrain.colorSpace = THREE.SRGBColorSpace;
  woodGrain.wrapS = woodGrain.wrapT = THREE.RepeatWrapping;
  woodGrain.magFilter = THREE.LinearFilter;
  woodGrain.minFilter = THREE.LinearMipmapLinearFilter;
  woodGrain.generateMipmaps = true;
  woodGrain.needsUpdate = true;
  return woodGrain;
}

const SEAT_Y = 0.45, SLAT_LENGTH = 1.66;
export const BENCH_SUPPORT = Object.freeze({ x: .68, z: -.015, width: .06, length: .47 });

// Cada cara mira como en una caja corriente: [eje, lado, eje de u, eje de v, sentido de u, sentido de v].
const CARAS = [[0, 1, 2, 1, -1, -1], [0, -1, 2, 1, 1, -1], [1, 1, 0, 2, 1, 1], [1, -1, 0, 2, 1, -1], [2, 1, 0, 1, 1, -1], [2, -1, 0, 1, -1, -1]];

/**
 * Caja con las doce aristas matadas. Las caras conservan su normal y el chaflán une las de dos caras vecinas, así que
 * el canto se ve redondeado por el uso sin gastar más puntos que una caja.
 */
export function cajaBiselada(sx, sy, sz, bisel) {
  const medio = [sx / 2, sy / 2, sz / 2], b = Math.min(bisel, Math.min(...medio) * .45);
  const position = [], normal = [], uv = [], index = [], punto = new Map();
  for (const [eje, lado, ejeU, ejeV, haciaU, haciaV] of CARAS) for (const u of [-1, 1]) for (const v of [-1, 1]) {
    const p = [0, 0, 0], n = [0, 0, 0], signos = [0, 0, 0];
    p[eje] = lado * medio[eje]; p[ejeU] = u * (medio[ejeU] - b); p[ejeV] = v * (medio[ejeV] - b);
    n[eje] = lado; signos[eje] = lado; signos[ejeU] = u; signos[ejeV] = v;
    punto.set(`${eje}:${signos.join()}`, position.length / 3);
    position.push(...p); normal.push(...n); uv.push((u * haciaU + 1) / 2, 1 - (v * haciaV + 1) / 2);
  }
  const de = (eje, x, y, z) => punto.get(`${eje}:${[x, y, z].join()}`);
  const hacia = (a, k) => position[a * 3 + k];
  // Toda cara mira hacia afuera: la caja es convexa y su centro es el origen.
  const cara = (...puntos) => {
    const [a, c, d] = puntos, e1 = [0, 1, 2].map((k) => hacia(c, k) - hacia(a, k)), e2 = [0, 1, 2].map((k) => hacia(d, k) - hacia(a, k));
    const fuera = [0, 1, 2].reduce((suma, k) => suma + (e1[(k + 1) % 3] * e2[(k + 2) % 3] - e1[(k + 2) % 3] * e2[(k + 1) % 3]) * hacia(a, k), 0);
    const orden = fuera >= 0 ? puntos : [...puntos].reverse();
    for (let i = 1; i < orden.length - 1; i++) index.push(orden[0], orden[i], orden[i + 1]);
  };
  const signosDe = (eje, lado, a, b2) => { const s = [0, 0, 0]; s[eje] = lado; s[(eje + 1) % 3] = a; s[(eje + 2) % 3] = b2; return s; };
  for (let eje = 0; eje < 3; eje++) for (const lado of [-1, 1]) {
    cara(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b2]) => de(eje, ...signosDe(eje, lado, a, b2))));
  }
  for (let eje = 0; eje < 3; eje++) {
    const otro = (eje + 1) % 3, largo = (eje + 2) % 3;
    for (const a of [-1, 1]) for (const c of [-1, 1]) {
      const s = (l) => { const signos = [0, 0, 0]; signos[eje] = a; signos[otro] = c; signos[largo] = l; return signos; };
      cara(de(eje, ...s(-1)), de(eje, ...s(1)), de(otro, ...s(1)), de(otro, ...s(-1)));
    }
  }
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cara(de(0, x, y, z), de(1, x, y, z), de(2, x, y, z));
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

export class Banca {
  constructor(position, rotation = 0) {
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = rotation;

    const woodMat = new THREE.MeshLambertMaterial({
      color: 0x8f7f69, // barniz viejo: el sol le quita el naranja y la lluvia lo deja gris
      map: sharedWoodGrain()
    });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x393d3a });
    woodMat.userData.staticMergeKey = 'banca:madera';
    metalMat.userData.staticMergeKey = 'banca:metal';

    const part = (material, x, y, z, sx, sy, sz, tilt = 0) => {
      const mesh = new THREE.Mesh(cajaBiselada(sx, sy, sz, material === woodMat ? .008 : .005), material);
      mesh.position.set(x, y, z);
      mesh.rotation.x = tilt;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    // Cada listón toma otra franja de las vetas: no se ven cortados de la misma tabla.
    const slat = (index, y, z, depth, thick, tilt = 0) => {
      const mesh = part(woodMat, 0, y, z, SLAT_LENGTH, thick, depth, tilt);
      const uv = mesh.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * .85 + index * .31, uv.getY(i) * .2 + index * .23);
      // Ninguna tabla queda a escuadra después de años de sol y de gente: cada una cede un par de milímetros.
      mesh.rotation.z = Math.sin(index * 2.4 + .7) * .0022;
      mesh.rotation.x += Math.sin(index * 1.7 + 2.1) * .012;
    };

    // Asiento: listones con luz entre ellos, el de adelante un poco más bajo.
    [-.185, -.06, .065, .19].forEach((z, i) => slat(i, SEAT_Y - (i === 3 ? .006 : 0), z, .108, .038));
    // Respaldo reclinado.
    const BACK_TILT = -.2;
    const backZ = y => -.248 - (y - .62) * Math.tan(-BACK_TILT);
    [.625, .75, .875].forEach((y, i) => slat(i + 4, y, backZ(y), .11, .03, Math.PI / 2 + BACK_TILT));

    // Patas: dos marcos de platina con un apoyo central bajo los listones.
    for (const x of [-BENCH_SUPPORT.x, BENCH_SUPPORT.x]) {
      part(metalMat, x, .225, .17, .045, .41, .045);                 // pata delantera
      part(metalMat, x, .205, -.205, .045, .37, .045);               // pata trasera
      part(metalMat, x, SEAT_Y - .04, -.015, .045, .04, .47);        // larguero del asiento
      part(metalMat, x, .019, BENCH_SUPPORT.z, BENCH_SUPPORT.width, .038, BENCH_SUPPORT.length);
    }
    for (const x of [-.68, 0, .68]) {
      const height = .56, y = SEAT_Y + height / 2 - .07;
      part(metalMat, x, y, backZ(y) - .032, .04, height, .035, BACK_TILT); // costilla detrás de los listones
    }
    part(metalMat, 0, SEAT_Y - .04, -.015, .04, .035, .47);
  }
}
