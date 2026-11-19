import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let wool;
/** Una textura de lana para todos los colores y los dos niveles de detalle. */
export function scarfTexture() {
  if (wool) return wool;
  const size = 64;
  const texels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const warp = Math.cos(x * Math.PI / 4);
    const weft = Math.sin(y * Math.PI / 4);
    const fleck = ((x * 11 + y * 17 + (x ^ y) * 13) % 19) / 19;
    const value = 220 + 13 * warp * weft + 10 * fleck - 9 * Math.cos(y * Math.PI / 8);
    texels.set([value, value, value, 255], i);
  }
  wool = new THREE.DataTexture(texels, size, size, THREE.RGBAFormat);
  wool.wrapS = wool.wrapT = THREE.RepeatWrapping;
  wool.magFilter = THREE.LinearFilter;
  wool.minFilter = THREE.LinearMipmapLinearFilter;
  wool.generateMipmaps = true;
  wool.needsUpdate = true;
  return wool;
}

function shape(geometry, deform) {
  const position = geometry.attributes.position;
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    deform(point);
    position.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function collarWrap() {
  // Dos vueltas de una pieza de lana. Entre las dos crestas la tela se mete unos milímetros.
  const profile = [
    [.018, .052, .048], [.027, .070, .059], [.017, .080, .069], [.004, .090, .080],
    [-.006, .087, .082], [-.014, .097, .091], [-.030, .109, .099], [-.047, .103, .103],
    [-.051, .092, .084], [-.038, .070, .059]
  ];
  const sides = 24, rows = profile.length;
  const position = [], uv = [], index = [];
  for (let i = 0; i <= sides; i++) {
    const a = (2 * i / sides - 1) * Math.PI, sx = Math.sin(a), sz = Math.cos(a);
    for (let j = 0; j <= rows; j++) {
      const [y, rx, rz] = profile[j % rows];
      const ruffle = 1 + .03 * Math.sin(a * 3 + j * .27) + .024 * Math.sin(a * 7);
      position.push(sx * rx * ruffle, y + .009 * sx - .004 * sz + .002 * Math.sin(4 * a), .017 + sz * rz * ruffle);
      uv.push(i / sides, j / rows);
      if (i < sides && j < rows) {
        const p = i * (rows + 1) + j, next = p + rows + 1;
        index.push(p, p + 1, next, next, p + 1, next + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Centrada en el cuello en reposo, con las puntas cortas recogidas sobre el pecho. */
export function scarfGeometry() {
  const end = (x, length, w, offset) => shape(new THREE.SphereGeometry(1, 12, 7), p => {
    const across = Math.sign(p.x) * Math.abs(p.x) ** .7;
    const t = (1 - Math.sign(p.y) * Math.abs(p.y) ** .73) * .5;
    const fold = .005 * Math.cos(across * 7.3 + t * 2.5);
    p.set(x * (.5 + t * .5) + across * w, -.025 - length * t + across * .009,
      .104 + t * length * .32 + offset + p.z * .010 + fold);
  });
  const parts = [
    collarWrap(),
    end(.029, .096, .044, -.004),
    end(-.033, .147, .047, .006)
  ];
  const scarf = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return scarf;
}
