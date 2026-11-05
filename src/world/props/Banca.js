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

export class Banca {
  constructor(position, rotation = 0) {
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = rotation;

    const woodMat = new THREE.MeshLambertMaterial({
      color: 0xa88e6c, // barniz viejo: el sol le quita el naranja
      map: sharedWoodGrain(),
      flatShading: true
    });
    const metalMat = new THREE.MeshLambertMaterial({
      color: 0x3c4744,
      flatShading: true
    });
    woodMat.userData.staticMergeKey = 'banca:madera';
    metalMat.userData.staticMergeKey = 'banca:metal';

    const part = (material, x, y, z, sx, sy, sz, tilt = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
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
    };

    // Asiento: listones con luz entre ellos, el de adelante un poco más bajo.
    [-.185, -.06, .065, .19].forEach((z, i) => slat(i, SEAT_Y - (i === 3 ? .006 : 0), z, .108, .038));
    // Respaldo reclinado.
    const BACK_TILT = -.2;
    const backZ = y => -.248 - (y - .62) * Math.tan(-BACK_TILT);
    [.625, .75, .875].forEach((y, i) => slat(i + 4, y, backZ(y), .11, .03, Math.PI / 2 + BACK_TILT));

    // Patas: dos marcos de platina con un apoyo central bajo los listones.
    for (const x of [-.68, .68]) {
      part(metalMat, x, .225, .17, .045, .41, .045);                 // pata delantera
      part(metalMat, x, .205, -.205, .045, .37, .045);               // pata trasera
      part(metalMat, x, SEAT_Y - .04, -.015, .045, .04, .47);        // larguero del asiento
      part(metalMat, x, .019, -.015, .06, .038, .47);                // pie que se ancla al piso
    }
    for (const x of [-.68, 0, .68]) {
      const height = .56, y = SEAT_Y + height / 2 - .07;
      part(metalMat, x, y, backZ(y) - .032, .04, height, .035, BACK_TILT); // costilla detrás de los listones
    }
    part(metalMat, 0, SEAT_Y - .04, -.015, .04, .035, .47);
  }
}
