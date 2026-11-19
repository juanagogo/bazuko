import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { animationDamping } from './SecondaryMotion.js';
import { streetWetness } from './streetMaterials.js';

const GEOMETRIES = new Map();
const FABRIC_U = 224 / 256;
// Distancia desde la boca y fracción del ancho en cada anillo.
const PROFILE = [
  [-.023, 0], [0, .16], [.055, .23], [.13, .37], [.22, .59], [.33, .81], [.45, .94],
  [.60, 1], [.72, .98], [.82, .91], [.92, .77], [.974, .47], [1, 0]
];
const LOADS = [
  { width: .115, height: .414, depth: .041, back: -.155, squareness: .89 },
  { width: .16, height: .473, depth: .114, back: -.154, squareness: .71 },
  { width: .199, height: .503, depth: .172, back: -.158, squareness: .62 }
];
const CLOSED = .02;
const mix = THREE.MathUtils.lerp;

let cloth;
/** Atlas compartido de fibra, remiendo, costuras y correas, con mipmaps. */
function sackTexture() {
  if (cloth) return cloth;
  const width = 256, height = 160;
  const data = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const u = i / 224, v = j / (height - 1), offset = (j * width + i) * 4;
    const fleck = ((i * 17 + j * 31 + (i ^ j) * 43) % 29) - 14;
    const fiber = Math.sin(i * 2.1) * Math.sin(j * 1.72) * 16 + fleck * .65;
    const seam = Math.abs(u - .28) < .012 || Math.abs(v - .115) < .013;
    const stitch = (Math.abs(u - .29) < .008 && j % 7 < 3) || (Math.abs(v - .13) < .007 && i % 7 < 3);
    const patchU = u - .51 + (v - .45) * .21;
    const patchV = v - .42 - patchU * .38;
    const patchShape = Math.max(Math.abs(patchU + .009 * Math.sin(v * 46)) / .109,
      Math.abs(patchV + .009 * Math.cos(u * 31)) / .105);
    const patch = patchShape < 1;
    const patchFade = patch ? 17 + 11 * Math.sin(u * 21 + v * 6) ** 2 : 0;
    const patchedThread = patchShape > .86 && patchShape < 1 && (i + j * 2) % 9 < 4;
    // La tela se oscurece en el asiento y en el doblez alto. El remiendo rompe el color a distancia.
    const dye = 216 + 19 * Math.sin(u * Math.PI) - 58 * (1 - v) ** 3 - 21 * Number(v > .855)
      - patchFade - 32 * Number(seam) + 21 * Number(stitch || patchedThread);
    const strap = i >= 224, rope = i >= 240;
    const base = strap ? (rope ? 144 : 96) + (i % 4 === 0 ? 14 : 0) : dye;
    const value = Math.round(THREE.MathUtils.clamp(base + fiber, 15, 255));
    data[offset] = value;
    data[offset + 1] = Math.max(0, value - (patch ? 11 : 5));
    data[offset + 2] = Math.max(0, value - (patch ? 24 : 13));
    data[offset + 3] = 255;
  }
  cloth = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  cloth.colorSpace = THREE.SRGBColorSpace;
  cloth.minFilter = THREE.LinearMipmapLinearFilter;
  cloth.magFilter = THREE.LinearFilter;
  cloth.generateMipmaps = true;
  cloth.anisotropy = 4;
  cloth.needsUpdate = true;
  return cloth;
}

function bagShape({ width, height, depth, back, squareness }) {
  const sides = 28, rows = PROFILE.length;
  const position = [], uv = [], index = [];
  const round = value => Math.sign(value) * Math.abs(value) ** squareness;
  for (let i = 0; i <= sides; i++) {
    const u = i / sides, angle = u * Math.PI * 2;
    const x = round(Math.sin(angle)), z = round(Math.cos(angle));
    for (let j = 0; j < rows; j++) {
      const [down, radius] = PROFILE[j];
      const crumple = .11 * Math.sin(angle * 7 + down * 8) * (1 - down) + .05 * Math.sin(angle * 4 - down * 11);
      const uneven = 1 + crumple + .07 * Math.sin(angle * 3 + down * 3) * down;
      const neck = down > -.01 ? .03 * (1 - down) : 0;
      const bias = .012 * Math.sin(down * 3.8);
      position.push(bias + x * (width * radius * uneven + neck), -.076 - down * height,
        back + z * (z < 0 ? depth : .022) * radius * uneven);
      uv.push(.003 + u * (FABRIC_U - .006), .014 + (1 - down) * .972);
      if (i < sides && j < rows - 1) {
        const a = i * rows + j, b = a + rows;
        index.push(a, a + 1, b, b, a + 1, b + 1);
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

/** Curva con sección rectangular para correas estrechas y cuerda con sección redonda. */
function binding(points, radius, rope = false) {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const steps = rope ? 8 : 15;
  const geometry = new THREE.TubeGeometry(curve, steps, radius, rope ? 6 : 4);
  const { position, uv } = geometry.attributes;
  if (!rope) {
    const across = new THREE.Vector3(), normal = new THREE.Vector3(), point = new THREE.Vector3();
    const corners = [[1, -1], [-1, -1], [-1, 1], [1, 1], [1, -1]];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const center = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      across.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
      normal.crossVectors(tangent, across).normalize();
      corners.forEach(([x, y], j) => {
        point.copy(center).addScaledVector(across, x * radius).addScaledVector(normal, y * .005);
        position.setXYZ(i * corners.length + j, point.x, point.y, point.z);
      });
    }
    geometry.computeVertexNormals();
  }
  const atlasStart = rope ? 242 : 226;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (atlasStart + uv.getY(i) * 10) / 256, uv.getX(i));
  return geometry;
}

function sackGeometry(load, fit) {
  const attachZ = load.back - .022;
  // En este cuerpo el anclaje acerca el costal al hombro; la curva del pecho necesita menos avance.
  const chestInset = fit === 'mujer' ? .051 : 0;
  const strap = (side) => {
    const x = .097 * side;
    return binding([[x * .7, -.118, attachZ], [x, -.033, -.094], [x * 1.10, .012, -.006],
      [x * 1.17, -.033, .074 - chestInset * .58], [x * 1.31, -.131, .133 - chestInset], [x * 1.48, -.245, .126 - chestInset],
      [x * 1.65, -.337, .075 - chestInset * .81], [x * 1.66, -.38, -.009 - chestInset * .33],
      [side * load.width * .63, -.425, attachZ]], .016);
  };
  const neck = -.094, z = load.back - .002;
  const tie = binding([[-.041, neck - .008, z], [-.03, neck, z - .04], [0, neck + .001, z - .055],
    [.037, neck, z - .035], [.045, neck - .012, z], [.02, neck - .017, z + .029],
    [-.026, neck - .003, z + .026], [-.041, neck - .008, z]], .006, true);
  const tail = binding([[.014, neck, z - .051], [.045, neck - .018, z - .058],
    [.065, neck - .053, z - .064], [.071, neck - .078, z - .068]], .005, true);
  const parts = [bagShape(load), strap(-1), strap(1), tie, tail];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (fit === 'procedural') geometry.scale(1.14, .93, 1.29).translate(0, .008, -.025);
  if (fit === 'mujer') geometry.scale(.94, .96, 1).translate(0, 0, .035);
  return geometry;
}

function geometryFor(fit) {
  if (GEOMETRIES.has(fit)) return GEOMETRIES.get(fit);
  const [light, middle, full] = LOADS.map(load => sackGeometry(load, fit));
  light.morphAttributes.position = [middle.attributes.position, full.attributes.position];
  light.morphAttributes.normal = [middle.attributes.normal, full.attributes.normal];
  light.computeBoundingBox();
  light.computeBoundingSphere();
  middle.dispose();
  full.dispose();
  GEOMETRIES.set(fit, light);
  return light;
}

/** Carga visual continua, con el nudo a la misma altura al cambiar de peso. */
export function createCarrySack(fit) {
  const mesh = new THREE.Mesh(geometryFor(fit), new THREE.MeshStandardMaterial({ map: sackTexture(), roughness: .96 }));
  mesh.castShadow = mesh.receiveShadow = true;
  const base = new THREE.Color();
  let mochila = false, fill = null;

  const dress = ({ mochila: chosen = false, wear = 2 } = {}) => {
    mochila = chosen;
    mesh.name = mochila ? 'prop-mochila' : 'prop-costal-jugador';
    const worn = Number.isFinite(wear) ? THREE.MathUtils.clamp(wear, 0, 2) : 2;
    base.set(mochila ? '#778679' : '#dec49b').multiplyScalar(1 - worn * .075);
  };
  const update = (dt, load) => {
    const weight = Number.isFinite(load) ? THREE.MathUtils.clamp(load, 0, 1) : 0;
    mesh.visible = mochila || weight > CLOSED;
    const target = mochila ? .24 + weight * .76 : weight;
    if (!mesh.visible || fill === null || dt === 0) fill = target;
    else fill = mix(fill, target, animationDamping(dt, 12));
    const part = fill * 2;
    const morph = mesh.morphTargetInfluences;
    morph[0] = part <= 1 ? part : 2 - part;
    morph[1] = Math.max(0, part - 1);
    mesh.material.color.copy(base).multiplyScalar(1 - streetWetness.value * .38);
    mesh.material.roughness = .96 - streetWetness.value * .17;
  };
  dress();
  mesh.visible = false;
  return { mesh, dress, update };
}
