import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { chainSunField } from '../world/bogota/SunFieldShader.js';
import { streetWetness } from './streetMaterials.js';

// Talleres y comercio de calle: tonos apagados, también por fuera con el paño mojado.
export const UMBRELLA_COLORS = ['#181a20', '#27364d', '#5a2430', '#2f3f36', '#4a4a50'];
const RIBS = 8, RADIUS = .62, RISE = .21, BASE = .5;
const OUTSIDE = [.035, .43], INSIDE = [.485, .755];
const METAL = .8125, RUBBER = .876, RIB = .938, TIP = .981;
const GRIP = -.006;
const rings = [0, .42, .76, 1];
const dip = [0, 0, .004, .012];
const height = fraction => BASE + RISE * (1 - fraction ** 1.7);

/** El borde bajo mantiene la misma huella. Exterior e interior tienen normales y paños propios. */
function canopy(inside) {
  const sides = 2 * RIBS, stride = sides + 1;
  const [vStart, vEnd] = inside ? INSIDE : OUTSIDE;
  const position = [], uv = [], index = [];
  const triangle = (a, b, c) => inside ? index.push(a, b, c) : index.push(a, c, b);
  for (let row = 0; row < rings.length; row++) {
    const fraction = rings[row];
    for (let i = 0; i <= sides; i++) {
      const angle = (i % sides) / sides * Math.PI * 2;
      const between = i % 2;
      const radius = RADIUS * fraction * (1 - between * .09 * fraction);
      position.push(Math.sin(angle) * radius, height(fraction) - between * dip[row], Math.cos(angle) * radius);
      uv.push(i / sides, THREE.MathUtils.lerp(vStart, vEnd, fraction));
      if (i === sides || row === rings.length - 1) continue;
      const a = row * stride + i, b = a + stride;
      triangle(a, b, b + 1);
      if (row > 0) triangle(a, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal, n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let row = 1; row < rings.length; row++) {
    const a = row * stride, b = a + sides;
    n.fromBufferAttribute(normals, a).add(m.fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, n.x, n.y, n.z);
    normals.setXYZ(b, n.x, n.y, n.z);
  }
  for (let i = 0; i <= sides; i++) normals.setXYZ(i, 0, inside ? -1 : 1, 0);
  return geometry;
}

function swatch(geometry, v) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), v);
  return geometry;
}

function collar(radius, length, y, v) {
  return swatch(new THREE.CylinderGeometry(radius, radius, length, 8).translate(0, y, 0), v);
}

function brace(from, to) {
  const direction = to.clone().sub(from);
  const geometry = new THREE.CylinderGeometry(.0038, .0038, direction.length(), 4);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  const center = from.clone().lerp(to, .5);
  return swatch(geometry.translate(center.x, center.y, center.z), RIB);
}

export function umbrellaGeometry() {
  const grip = new THREE.LatheGeometry([
    [0, -.138], [.0135, -.138], [.0155, -.128], [.013, -.082], [.012, -.045],
    [.0138, -.030], [.0138, .023], [.010, .032], [0, .032]
  ].map(([r, y]) => new THREE.Vector2(r, y)), 10);
  const parts = [canopy(false), canopy(true), swatch(grip, RUBBER), collar(.007, .69, .369, METAL),
    collar(.015, .035, .323, TIP), collar(.010, .024, .718, TIP)];
  for (let i = 0; i < RIBS; i++) {
    const angle = i * Math.PI * 2 / RIBS;
    const under = fraction => new THREE.Vector3(Math.sin(angle) * RADIUS * fraction, height(fraction) - .009, Math.cos(angle) * RADIUS * fraction);
    const profile = new THREE.CatmullRomCurve3(rings.map(fraction => under(fraction * .991)));
    parts.push(swatch(new THREE.TubeGeometry(profile, 5, .0052, 4), RIB), brace(new THREE.Vector3(0, .335, 0), under(.63)));
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  // En la postura existente el tubo ya cruza el puño. Su goma envuelve ese mismo tramo.
  geometry.rotateX(-.17).rotateZ(-.09).translate(.06, 0, .055);
  geometry.userData.gripY = GRIP;
  return geometry;
}

const WIDTH = 256, HEIGHT = 128;
const finish = new Uint8Array(WIDTH * HEIGHT * 4);
const dyes = new Map();
let materialMap;
const smooth = (x, lo, hi) => THREE.MathUtils.smoothstep(x, lo, hi);
const byte = value => Math.round(THREE.MathUtils.clamp(value, 0, 255));

function atlas(data, pigment) {
  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat);
  if (pigment) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function fabricAtlas(dye) {
  const red = parseInt(dye.slice(1, 3), 16), green = parseInt(dye.slice(3, 5), 16), blue = parseInt(dye.slice(5), 16);
  const color = new Uint8Array(finish.length);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const u = x / WIDTH, v = y / (HEIGHT - 1), i = (y * WIDTH + x) * 4;
    let rgb, rough, metal = 0;
    if (v < .779) {
      const outer = v < .461;
      const [start, end] = outer ? OUTSIDE : INSIDE;
      const r = THREE.MathUtils.clamp((v - start) / (end - start), 0, 1);
      const panel = u * RIBS, edge = Math.abs(panel - Math.round(panel));
      const stitched = 1 - smooth(edge, .016, .043);
      const hem = smooth(r, .952, .981);
      const weave = Math.sin(x * 1.77 + y * 2.23) * 2.3 + Math.cos(y * 1.9) * 1.8;
      const runs = Math.cos(u * Math.PI * 60) * Math.sin(r * 10 + u * 17) * 2.8;
      const variation = (Math.floor(panel) % 2 ? .95 : 1.09) + .045 * Math.sin(panel * 3.14);
      const layer = (outer ? 1.22 : 1.02) * variation;
      const stitch = (outer ? 27 : 22) * stitched * smooth(r, .18, .48);
      rgb = [red, green, blue].map(c => (c * layer + 6 + weave + runs + stitch) * (1 - hem * .21));
      rough = (outer ? .66 : .83) + hem * .065 - .09 * stitched;
    } else if (v < .846) {
      rgb = [113, 123, 131]; rough = .36; metal = .48;
    } else if (v < .905) {
      rgb = [36, 41, 43].map(c => c + (x % 4 === 0 ? 8 : 0)); rough = .91;
    } else if (v < .966) {
      rgb = [91, 101, 108]; rough = .54; metal = .27;
    } else {
      rgb = [73, 77, 81]; rough = .65; metal = .10;
    }
    color.set([...rgb.map(byte), 255], i);
    if (!materialMap) finish.set([255, byte(rough * 255), byte(metal * 255), 255], i);
  }
  materialMap ??= atlas(finish, false);
  return atlas(color, true);
}

export function umbrellaMaterial(pigment) {
  if (dyes.has(pigment)) return dyes.get(pigment);
  const map = fabricAtlas(pigment);
  const material = new THREE.MeshStandardMaterial({ map, roughness: 1, roughnessMap: materialMap, metalness: 1, metalnessMap: materialMap });
  material.name = 'paraguas-de-calle';
  material.userData.shared = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uUmbrellaWet = streetWetness;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uUmbrellaWet;')
      .replace('#include <map_fragment>', /* glsl */ `
        #include <map_fragment>
        float nylon = 1. - step(.779, vMapUv.y);
        float exterior = 1. - step(.461, vMapUv.y);
        diffuseColor.rgb *= 1. - uUmbrellaWet * nylon * mix(.08, .21, exterior);
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor *= 1. - uUmbrellaWet * exterior * .25;
      `);
  };
  material.customProgramCacheKey = () => 'paraguas-nailon';
  chainSunField(material);
  dyes.set(pigment, material);
  return material;
}
