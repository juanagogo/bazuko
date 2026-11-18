// src/character/faceParts.js
// Rasgos de la cara que el cuerpo exportado no trae: nariz, ojos, orejas, cejas, boca, mentón, pómulos y patillas. Cada variante es un puñado de elipsoides de color de piel (o de pelo o de labio) pegados a la cabeza del cuerpo, medidos contra su propia malla para que asienten en cualquier cuerpo. Todos los de una persona se funden en una sola malla sin textura que comparte un único material con todo el mundo, así que una cara cuesta un dibujo y la gente de lejos (modelo liviano) no los lleva.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTES, SKIN_ALBEDO } from './look.js';
import { streetFaceTint } from './streetMaterials.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** Material compartido por todas las caras: el color va en los vértices. */
export const faceMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: 0 });

const frames = new Map();

const GRID = { x: 2.2, y0: -2.2, y1: .7, step: .1 };

/** Color de la textura de piel sobre la cara, en una rejilla de (x, y) en unidades de `u`; null si no hay dónde leer píxeles. */
function skinGrid(map, verts, uvs, u) {
  if (!map?.image || !uvs.length || typeof OffscreenCanvas === 'undefined') return null;
  const size = 256;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(map.image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const columns = Math.round(GRID.x * 2 / GRID.step) + 1, rows = Math.round((GRID.y1 - GRID.y0) / GRID.step) + 1;
  const cells = new Float32Array(columns * rows * 3);
  const count = verts.length / 3;
  const color = new THREE.Color();
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = (-GRID.x + column * GRID.step) * u, y = (GRID.y0 + row * GRID.step) * u;
      let best = -Infinity, at = -1;
      for (let i = 0; i < count; i++) {
        if (Math.abs(verts[i * 3] - x) < .06 * u && Math.abs(verts[i * 3 + 1] - y) < .06 * u && verts[i * 3 + 2] > best) { best = verts[i * 3 + 2]; at = i; }
      }
      if (at < 0) {
        let near = Infinity;
        for (let i = 0; i < count; i++) {
          const d = (verts[i * 3] - x) ** 2 + (verts[i * 3 + 1] - y) ** 2;
          if (verts[i * 3 + 2] > -.5 * u && d < near) { near = d; at = i; }
        }
      }
      const px = Math.min(size - 1, Math.max(0, Math.round(uvs[at * 2] * (size - 1))));
      const py = Math.min(size - 1, Math.max(0, Math.round(uvs[at * 2 + 1] * (size - 1))));
      const o = (py * size + px) * 4;
      color.setRGB(pixels[o] / 255, pixels[o + 1] / 255, pixels[o + 2] / 255, THREE.SRGBColorSpace);
      cells.set([color.r, color.g, color.b], (row * columns + column) * 3);
    }
  }
  return { cells, columns, rows };
}

/**
 * Mide la cara de un cuerpo (en metros del modelo, desde el punto entre los ojos): separación de los ojos, y desde ahí el
 * relieve de la malla. Se hace una vez por cuerpo y queda en memoria.
 */
export function measureFace(bodyId, root, bodyMesh, eyeMesh) {
  if (frames.has(bodyId)) return frames.get(bodyId);
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toRoot = mesh => new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
  const eyeLeft = [], eyeRight = [];
  const eyeMatrix = toRoot(eyeMesh);
  for (let i = 0; i < eyeMesh.geometry.attributes.position.count; i++) {
    eyeMesh.getVertexPosition(i, _v).applyMatrix4(eyeMatrix);
    (_v.x > 0 ? eyeLeft : eyeRight).push(_v.toArray());
  }
  const centerOf = list => [0, 1, 2].map(axis => list.reduce((sum, p) => sum + p[axis], 0) / list.length);
  const left = centerOf(eyeLeft), right = centerOf(eyeRight);
  const origin = new THREE.Vector3((left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2);
  const u = Math.abs(left[0] - right[0]);
  const eyeR = (Math.max(...eyeLeft.map(p => p[0])) - Math.min(...eyeLeft.map(p => p[0]))) / 2;
  const eyeFront = Math.max(...eyeLeft.map(p => p[2])) - origin.z;
  const verts = [], uvs = [];
  const uvAttribute = bodyMesh.geometry.attributes.uv;
  const bodyMatrix = toRoot(bodyMesh);
  for (let i = 0; i < bodyMesh.geometry.attributes.position.count; i++) {
    bodyMesh.getVertexPosition(i, _v).applyMatrix4(bodyMatrix);
    if (_v.y > origin.y - 3.2 * u && _v.y < origin.y + 2.6 * u) {
      verts.push(_v.x - origin.x, _v.y - origin.y, _v.z - origin.z);
      if (uvAttribute) uvs.push(uvAttribute.getX(i), uvAttribute.getY(i));
    }
  }
  const count = verts.length / 3;
  // Lo más adelante (z) en una ventana de la cara, o lo más a un lado (x) en una franja de altura y de fondo.
  const depth = (x, y, rx = .3 * u, ry = .22 * u) => {
    let best = -Infinity;
    for (let i = 0; i < count; i++) if (Math.abs(verts[i * 3] - x) < rx && Math.abs(verts[i * 3 + 1] - y) < ry && verts[i * 3 + 2] > best) best = verts[i * 3 + 2];
    return Number.isFinite(best) ? best : 0;
  };
  const side = (y, z, ry = .2 * u, rz = .25 * u) => {
    let best = 0;
    for (let i = 0; i < count; i++) if (Math.abs(verts[i * 3 + 1] - y) < ry && Math.abs(verts[i * 3 + 2] - z) < rz && Math.abs(verts[i * 3]) > best) best = Math.abs(verts[i * 3]);
    return best;
  };
  let noseY = -.7 * u, noseZ = -Infinity;
  for (let y = -1.5 * u; y <= -.3 * u; y += .08 * u) {
    const z = depth(0, y, .12 * u, .08 * u);
    if (z > noseZ) { noseZ = z; noseY = y; }
  }
  // Orejas: lo más ancho de la cabeza a la altura de los ojos, y por detrás de ellos.
  let earX = 0, earZ = 0, earN = 0;
  for (let i = 0; i < count; i++) {
    const y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    if (y > -.9 * u && y < .1 * u && z < -.3 * u && Math.abs(verts[i * 3]) > earX) earX = Math.abs(verts[i * 3]);
  }
  for (let i = 0; i < count; i++) {
    const y = verts[i * 3 + 1];
    if (y > -.9 * u && y < .1 * u && Math.abs(verts[i * 3]) > earX * .9) { earZ += verts[i * 3 + 2]; earN++; }
  }
  const texture = skinGrid(bodyMesh.material.map, verts, uvs, u);
  const frame = { texture, origin, u, eyeR, eyeFront, eyeX: u / 2, noseY, noseZ, mouthY: -1.17 * u, chinY: -1.62 * u, earX, earY: -.4 * u, earZ: earN ? earZ / earN : -u, depth, side, tint: streetFaceTint(bodyId) };
  frames.set(bodyId, frame);
  return frame;
}

const toColor = ([r, g, b]) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

/** Colores de una persona: piel de la cara (lo que de verdad se ve en el cuerpo), labios y pelo. */
export function faceColors(piel, peloColor, frame, bodyColor) {
  const albedo = SKIN_ALBEDO[piel] ?? SKIN_ALBEDO[2];
  const flat = toColor([albedo[0] / frame.tint.x, albedo[1] / frame.tint.y, albedo[2] / frame.tint.z]);
  const { texture, u } = frame;
  const gain = bodyColor ? new THREE.Color(bodyColor.r * frame.tint.x * .94, bodyColor.g * frame.tint.y * .94, bodyColor.b * frame.tint.z * .94) : null;
  const _c = new THREE.Color();
  const skin = texture && gain ? (x, y) => {
    const column = Math.min(texture.columns - 1, Math.max(0, Math.round((x / u + GRID.x) / GRID.step)));
    const row = Math.min(texture.rows - 1, Math.max(0, Math.round((y / u - GRID.y0) / GRID.step)));
    const at = (row * texture.columns + column) * 3;
    return _c.setRGB(texture.cells[at] * gain.r, texture.cells[at + 1] * gain.g, texture.cells[at + 2] * gain.b);
  } : flat;
  const pale = Math.min(1, Math.max(0, (flat.r - .2) / .3));
  const lip = flat.clone().multiply(new THREE.Color().setRGB(.98 + pale * .1, .86 - pale * .12, .84 - pale * .1, THREE.LinearSRGBColorSpace));
  const hair = new THREE.Color(PALETTES.pelo[peloColor] ?? PALETTES.pelo[0]).multiplyScalar(.8);
  return { skin, lip, hair };
}

function blob(parts, color, [cx, cy, cz], [rx, ry, rz], [ex = 0, ey = 0, ez = 0] = []) {
  const colorAt = typeof color === 'function' ? color : () => color;
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  geometry.deleteAttribute('uv');
  _e.set(ex, ey, ez);
  geometry.applyMatrix4(_m.compose(_v.set(cx, cy, cz), _q.setFromEuler(_e), _s.set(rx, ry, rz)));
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const tone = colorAt(position.getX(i), position.getY(i));
    colors[i * 3] = tone.r; colors[i * 3 + 1] = tone.g; colors[i * 3 + 2] = tone.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  parts.push(geometry);
}

// Cada rasgo dibuja sus elipsoides: `mirror` repite en los dos lados, y todo se mide en `u` (la separación de los ojos).
const NARIZ = {
  recta: (add, f) => add(f.skin, [0, f.noseY + .5 * f.u, f.depth(0, f.noseY + .5 * f.u) - .02 * f.u], [.05 * f.u, .3 * f.u, .06 * f.u]),
  ancha: (add, f) => f.mirror(sign => add(f.skin, [sign * .23 * f.u, f.noseY + .1 * f.u, f.depth(0, f.noseY) - .1 * f.u], [.12 * f.u, .1 * f.u, .12 * f.u])),
  bulbosa: (add, f) => {
    add(f.skin, [0, f.noseY + .03 * f.u, f.depth(0, f.noseY) - .07 * f.u], [.2 * f.u, .17 * f.u, .18 * f.u]);
    f.mirror(sign => add(f.skin, [sign * .2 * f.u, f.noseY + .1 * f.u, f.depth(0, f.noseY) - .1 * f.u], [.1 * f.u, .09 * f.u, .11 * f.u]));
  },
  aguilena: (add, f) => add(f.skin, [0, f.noseY + .4 * f.u, f.depth(0, f.noseY + .4 * f.u) - .06 * f.u], [.11 * f.u, .22 * f.u, .1 * f.u], [-.2, 0, 0]),
  respingada: (add, f) => add(f.skin, [0, f.noseY + .08 * f.u, f.depth(0, f.noseY) - .05 * f.u], [.15 * f.u, .13 * f.u, .15 * f.u]),
  chata: (add, f) => f.mirror(sign => add(f.skin, [sign * .27 * f.u, f.noseY + .08 * f.u, f.depth(0, f.noseY) - .08 * f.u], [.15 * f.u, .09 * f.u, .1 * f.u]))
};

// Párpado: una cuña de piel sobre el ojo; `alto` y `grueso` van en radios del ojo y `giro` sube (o baja) la esquina de afuera.
const lid = (alto, grueso, giro) => (add, f) => f.mirror(sign => {
  const r = f.eyeR, x = sign * f.eyeX, y = alto * r;
  add(f.skin, [x, y, f.depth(x, y, .2 * f.u, .1 * f.u) - .35 * grueso * r], [r * 1.25, r * grueso, r * .6 * grueso], [0, 0, sign * giro]);
});
const OJOS = {
  almendrados: lid(.55, .3, .14),
  rasgados: lid(.38, .32, .24),
  caidos: lid(.5, .28, -.2),
  encapuchados: lid(.42, .34, 0)
};

const labios = (arriba, abajo, ancho) => (add, f) => {
  const z = f.depth(0, f.mouthY, .15 * f.u, .1 * f.u);
  add(f.lip, [0, f.mouthY + .06 * f.u, z - .04 * f.u], [ancho * f.u, arriba[0] * f.u, arriba[1] * f.u]);
  add(f.lip, [0, f.mouthY - .1 * f.u, z - .05 * f.u], [ancho * .92 * f.u, abajo[0] * f.u, abajo[1] * f.u]);
};
const BOCA = {
  llena: labios([.07, .1], [.1, .11], .3),
  'muy-llena': labios([.1, .13], [.14, .14], .34),
  ancha: labios([.06, .09], [.08, .09], .42)
};

const MENTON = {
  prominente: (add, f) => add(f.skin, [0, f.chinY, f.depth(0, f.chinY) - .1 * f.u], [.24 * f.u, .13 * f.u, .13 * f.u]),
  cuadrado: (add, f) => add(f.skin, [0, f.chinY + .03 * f.u, f.depth(0, f.chinY) - .1 * f.u], [.36 * f.u, .15 * f.u, .15 * f.u]),
  puntiagudo: (add, f) => add(f.skin, [0, f.chinY - .02 * f.u, f.depth(0, f.chinY) - .1 * f.u], [.13 * f.u, .2 * f.u, .17 * f.u], [.35, 0, 0])
};

const oreja = (largo, ancho, salida) => (add, f) => f.mirror(sign => {
  add(f.skin, [sign * (f.earX + .02 * f.u), f.earY, f.earZ], [ancho * f.u, largo * f.u, .3 * f.u], [0, sign * salida, 0]);
});
const OREJAS = { salidas: oreja(.42, .08, .55), grandes: oreja(.52, .1, .15) };

const patilla = largo => (add, f) => f.mirror(sign => {
  const z = f.earZ + .5 * f.u, y = f.earY + .12 * f.u - largo * f.u;
  add(f.hair, [sign * (f.side(y, z) - .03 * f.u), y, z], [.06 * f.u, largo * f.u, .1 * f.u]);
});
const PATILLAS = { cortas: patilla(.2), largas: patilla(.38) };

const RASGOS = { nariz: NARIZ, ojos: OJOS, boca: BOCA, menton: MENTON, orejas: OREJAS, patillas: PATILLAS };

/** Una sola malla con todos los rasgos de esa cara, o null si lleva solo los del cuerpo. Las coordenadas son relativas al punto entre los ojos. */
export function buildFaceGeometry(frame, rostro, colors, barba = 'ninguna') {
  const parts = [];
  const f = {
    ...frame,
    ...colors,
    mirror: draw => { draw(1); draw(-1); }
  };
  const add = (color, center, radius, rotation) => blob(parts, color, center, radius, rotation);
  for (const [rasgo, table] of Object.entries(RASGOS)) {
    // Quien lleva barba tiene tapados el mentón y las patillas: el pelo va por encima de lo que se le añada.
    if (barba !== 'ninguna' && (rasgo === 'menton' || rasgo === 'patillas')) continue;
    table[rostro[rasgo]]?.(add, f);
  }
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

/**
 * Pone los rasgos en la cabeza: una malla hija del hueso, con la matriz que lleva del espacio de la cara (el del modelo, con el origen entre los ojos) al del hueso.
 * @returns {THREE.Mesh|null}
 */
export function attachFace(root, headBone, frame, rostro, colors, barba) {
  const geometry = buildFaceGeometry(frame, rostro, colors, barba);
  if (!geometry) return null;
  root.updateMatrixWorld(true);
  const mesh = new THREE.Mesh(geometry, faceMaterial);
  mesh.name = 'rasgos';
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(headBone.matrixWorld).invert().multiply(root.matrixWorld).multiply(_m.makeTranslation(frame.origin.x, frame.origin.y, frame.origin.z));
  mesh.frustumCulled = false;
  headBone.add(mesh);
  return mesh;
}

// Cejas: la del cuerpo, más gruesa o más fina, más alta o arqueada. Se reescribe su malla (una vez por cuerpo y variante) en el espacio del modelo.
const CEJAS = {
  finas: { grueso: .8 },
  rectas: {},
  arqueadas: { arco: .1 },
  gruesas: { copias: 2 },
  pobladas: { copias: 3, arco: .03 },
  altas: { alto: .11, arco: .05 }
};
const browCache = new Map();

/** Malla de cejas de ese cuerpo con esa variante; la misma para toda la gente que la comparte. */
export function browGeometry(bodyId, root, mesh, frame, variant) {
  const spec = CEJAS[variant];
  if (!spec || !Object.keys(spec).length) return mesh.geometry;
  const key = bodyId + variant;
  if (browCache.has(key)) return browCache.get(key);
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(root.matrixWorld).invert(), mesh.matrixWorld);
  const toLocal = toRoot.clone().invert();
  const base = mesh.geometry.clone();
  const position = base.attributes.position;
  const points = [];
  for (let i = 0; i < position.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toRoot));
  for (const sign of [1, -1]) {
    const side = points.filter(p => (p.x - frame.origin.x) * sign > 0);
    if (!side.length) continue;
    const center = side.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(side.length);
    const half = Math.max(...side.map(p => Math.abs(p.x - center.x))) || 1;
    for (const p of side) {
      const dx = (p.x - center.x) / half;
      p.y = center.y + (p.y - center.y) * (spec.grueso ?? 1) + (spec.alto ?? 0) * frame.u + (spec.arco ?? 0) * frame.u * (1 - dx * dx);
    }
  }
  // Las copias de más van un poco más arriba y abajo: la ceja se ve más tupida, no solo más ancha.
  const copies = spec.copias ?? 1;
  const layers = [];
  for (let k = 0; k < copies; k++) {
    const layer = base.clone();
    const shift = (k - (copies - 1) / 2) * .035 * frame.u;
    points.forEach((p, i) => layer.attributes.position.setXYZ(i, ...p.clone().add(new THREE.Vector3(0, shift, 0)).applyMatrix4(toLocal).toArray()));
    layers.push(layer);
  }
  const geometry = copies > 1 ? mergeGeometries(layers) : layers[0];
  geometry.computeBoundingSphere();
  browCache.set(key, geometry);
  return geometry;
}
