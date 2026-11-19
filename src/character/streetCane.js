import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { chainSunField } from '../world/bogota/SunFieldShader.js';

export const STREET_CANE_LENGTH = .8;
export const STREET_CANE_GRIP = [0, -.02825, .04675];
const SHAFT_TOP = -.075, RUBBER = .876, COLLAR = .965;

/** Una pieza de madera curvada con una contera de caucho. Las UV llevan la veta a lo largo del palo. */
export function streetCaneGeometry() {
  const bend = new THREE.CatmullRomCurve3([
    [0, -.096, 0], [0, -.06, .002], [0, -.036, .019], STREET_CANE_GRIP,
    [0, -.036, .071], [0, -.056, .087], [0, -.075, .091]
  ].map(point => new THREE.Vector3(...point)));
  const handle = new THREE.TubeGeometry(bend, 12, .013, 8);
  const end = new THREE.SphereGeometry(.013, 8, 4).translate(0, -.075, .091);
  const shaft = new THREE.CylinderGeometry(.012, .009, SHAFT_TOP + .755, 8, 3).translate(0, (SHAFT_TOP - .755) / 2, 0);
  const rubber = new THREE.LatheGeometry([
    [0, -STREET_CANE_LENGTH], [.015, -.8], [.019, -.797], [.019, -.79], [.0175, -.783],
    [.0175, -.777], [.019, -.774], [.018, -.768], [.016, -.765],
    [.018, -.760], [.016, -.753], [.013, -.748]
  ].map(([r, y]) => new THREE.Vector2(r, y)), 10);
  const collar = new THREE.CylinderGeometry(.012, .015, .017, 8).translate(0, -.746, 0);

  for (const piece of [shaft, handle, end]) {
    const uv = piece.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (piece === shaft) uv.setXY(i, u, .035 + .58 * v);
      else if (piece === handle) uv.setXY(i, v, .615 + .165 * u);
      else uv.setXY(i, u, .78);
    }
  }
  for (const [piece, row] of [[rubber, RUBBER], [collar, COLLAR]]) {
    const uv = piece.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, row);
  }
  const parts = [shaft, handle, end, rubber, collar];
  const geometry = mergeGeometries(parts);
  for (const piece of parts) piece.dispose();
  geometry.userData.grip = STREET_CANE_GRIP;
  return geometry;
}

const contact = new THREE.Vector3();

/** Altura mínima para este giro del bastón. El mango y la contera pueden caer a lados distintos del sardinel. */
export function streetCaneContactY(mesh, groundHeight) {
  const points = mesh.geometry.attributes.position;
  const { x, z } = mesh.position;
  let y = -Infinity;
  for (let i = 0; i < points.count; i++) {
    contact.fromBufferAttribute(points, i).multiply(mesh.scale).applyQuaternion(mesh.quaternion);
    const floor = groundHeight(x + contact.x, z + contact.z);
    if (Number.isFinite(floor)) y = Math.max(y, floor - contact.y);
  }
  return y + .0015;
}

const W = 64, H = 128;
const materials = new Map();
let finishMap = null;
const byte = x => Math.min(255, Math.max(0, Math.round(x)));

function texture(data, color = false) {
  const result = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  if (color) result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = THREE.RepeatWrapping;
  result.magFilter = THREE.LinearFilter;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.generateMipmaps = true;
  result.needsUpdate = true;
  return result;
}

/** Veta fina y pulido en el mango, superficie mate y oscura donde toca el piso. */
export function streetCaneMaterial(color) {
  const pigment = new THREE.Color(color).getHex(THREE.SRGBColorSpace);
  if (materials.has(pigment)) return materials.get(pigment);
  const rgb = [pigment >>> 16, (pigment >>> 8) & 255, pigment & 255];
  const albedo = new Uint8Array(W * H * 4), finish = finishMap ? null : new Uint8Array(albedo.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = i / W * Math.PI * 2, v = j / (H - 1), k = (j * W + i) * 4;
    if (v < .825) {
      const grain = Math.sin(u * 5 + .42 * Math.sin(v * 19)) * 6 + Math.cos(u * 11 + .36 * Math.cos(v * 9)) * 3;
      const polish = THREE.MathUtils.smoothstep(v, .57, .74);
      const warm = [13, 9, 6];
      for (let c = 0; c < 3; c++) albedo[k + c] = byte(rgb[c] * (1.13 + polish * .13) + warm[c] + grain);
      if (finish) finish[k + 1] = byte(255 * (.66 - polish * .21));
    } else {
      const metal = v > .932;
      const scuff = 3 * Math.sin(u * 7);
      albedo[k] = byte((metal ? 78 : 28) + scuff);
      albedo[k + 1] = byte((metal ? 72 : 28) + scuff);
      albedo[k + 2] = byte((metal ? 63 : 26) + scuff);
      if (finish) finish[k + 1] = metal ? 148 : 232;
    }
    albedo[k + 3] = 255;
    if (finish) finish[k + 3] = 255;
  }
  finishMap ??= texture(finish);
  const material = new THREE.MeshStandardMaterial({ map: texture(albedo, true), roughness: 1, roughnessMap: finishMap });
  material.name = 'baston-de-madera';
  material.userData.shared = true;
  chainSunField(material);
  materials.set(pigment, material);
  return material;
}
