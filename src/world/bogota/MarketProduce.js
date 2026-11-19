import * as THREE from 'three';
import { rng } from './textures.js';
import { withVisualRandom } from './VisualRandom.js';

const TAU = 2 * Math.PI;
const SKIN = { orange: 0, tomato: 1, potato: 2, cabbage: 3, onion: 4, plantain: 5, stem: 6, papaya: 7, pulp: 7 };
const ROUGHNESS = [.64, .43, .92, .83, .66, .69, .86, .74];
const colors = (...values) => values.map(color => new THREE.Color(color));
const PEEL = {
  orange: colors('#c97d32', '#de943b', '#b66e30', '#e6a653', '#c1873d', '#9c9a4b', '#859247'),
  tomato: colors('#b8483d', '#be5136', '#a43f35', '#cc6950', '#b55739'),
  potato: colors('#a58b62', '#b89561', '#8d7156', '#c1a079', '#9a754f', '#a98478'),
  cabbage: colors('#778d65', '#95a878', '#70845b', '#89986d', '#a9b892'),
  onion: colors('#e5dfc3', '#bccc9a', '#8eac70', '#658858', '#466b49'),
  plantain: colors('#dbb453', '#c6aa4e', '#9fa956', '#879d4e', '#d8be69'),
  papaya: colors('#a9a04b', '#c59b46', '#b2ab55', '#778849', '#ddab54')
};
const STEM = { green: new THREE.Color('#57613e'), dry: new THREE.Color('#786443'), tip: new THREE.Color('#4c4230') };
const SHOULDERS = { orange: new THREE.Color('#8b9251'), tomato: new THREE.Color('#a8794b'), potato: new THREE.Color('#8a683f') };
const PAPAYA_FLESH = colors('#b9a05b', '#e89852', '#ec824a', '#cf6736', '#a04429', '#603622', '#342620');
const CITRUS_STEM = new THREE.Color('#8f7a43');

// Los tres puestos de cada fila quedan en orden de occidente a oriente. Cada uno exhibe distintos productos al pasillo.
const STALL_TRAYS = [
  { front: [['orange', 'full'], ['papaya', 'low'], ['orange', 'full'], ['tomato', 'open']],
    back: [['tomato', 'full'], ['onion', 'open'], ['cabbage', 'open'], ['orange', 'low']] },
  { front: [['potato', 'full'], ['onion', 'full'], ['cabbage', 'low'], ['potato', 'low']],
    back: [['cabbage', 'open'], ['potato', 'full'], ['tomato', 'low'], ['onion', 'open']] },
  { front: [['tomato', 'full'], ['cabbage', 'open'], ['onion', 'low'], ['orange', 'full']],
    back: [['orange', 'low'], ['potato', 'open'], ['tomato', 'full'], ['cabbage', 'open']] },
  { front: [['papaya', 'low'], ['orange', 'full'], ['papaya', 'open'], ['tomato', 'low']],
    back: [['orange', 'open'], ['potato', 'low'], ['tomato', 'full'], ['cabbage', 'low']] },
  { front: [['onion', 'low'], ['cabbage', 'low'], ['potato', 'full'], ['cabbage', 'open']],
    back: [['potato', 'full'], ['tomato', 'full'], ['orange', 'low'], ['cabbage', 'open']] },
  { front: [['tomato', 'full'], ['orange', 'open'], ['potato', 'full'], ['onion', 'low']],
    back: [['potato', 'full'], ['cabbage', 'open'], ['onion', 'open'], ['tomato', 'low']] }
];

const grain = (x, y, band) => {
  const key = Math.imul(x + 43, 0x85ebca6b) ^ Math.imul(y + 13, 0xc2b2ae35) ^ Math.imul(band + 7, 0x27d4eb2d);
  const mixed = Math.imul(key ^ key >>> 15, 0x85ebca6b);
  return ((mixed ^ mixed >>> 13) >>> 0) / 4294967296;
};

/** Pieles neutras para modular el color del fruto, con poros, vetas y manchas de tamaños distintos. */
function skins() {
  const width = 128, rows = 32, height = rows * 8;
  const pixels = new Uint8Array(width * height * 4);
  for (let band = 0; band < 8; band++) for (let row = 0; row < rows; row++) for (let x = 0; x < width; x++) {
    const value = grain(x, row, band), u = x / width, v = row / rows;
    const fleck = grain(x >> 2, row >> 1, band);
    const wave = .5 + .25 * Math.cos(TAU * (3 * u + .6 * v)) + .25 * Math.sin(TAU * (4 * u - .75 * v));
    let shade = 234 + (value - .5) * 10 + (wave - .5) * 12;
    if (band === SKIN.orange) shade += (value > .87 ? -14 : 2) + (fleck - .5) * 8;
    if (band === SKIN.tomato) shade += 4 + (wave - .5) * 11;
    if (band === SKIN.potato) shade -= (fleck > .88 ? 42 : 6) + (value > .83 ? 7 : 0);
    if (band === SKIN.cabbage) {
      const rib = Math.abs(u - .5) < (.023 + (1 - v) * .035);
      const veins = Math.cos(TAU * (5 * v + 7 * Math.abs(u - .5)));
      shade += rib ? 16 : veins > .86 ? 7 : -4;
    }
    if (band === SKIN.onion) shade += Math.cos(TAU * 10 * u) * 7;
    if (band === SKIN.plantain) shade -= fleck > .94 && value > .38 ? 36 : 3;
    if (band === SKIN.papaya) shade += (wave - .5) * 21 - (fleck > .92 ? 19 : 2);
    const i = ((band * rows + row) * width + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.max(174, Math.min(255, Math.round(shade)));
    pixels[i + 3] = 255;
  }
  return { map: skinMap(pixels, width, height, THREE.SRGBColorSpace), roughnessMap: roughnessMap(rows) };
}

function roughnessMap(rows) {
  const width = 16, height = rows * 8, pixels = new Uint8Array(width * height * 4);
  for (let band = 0; band < 8; band++) for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
    const base = band === SKIN.papaya && y > rows * .54 ? .49 : ROUGHNESS[band];
    const roughness = Math.round((base + (grain(x * 3, y, band) - .5) * .064) * 255);
    const i = ((band * rows + y) * width + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = roughness;
    pixels[i + 3] = 255;
  }
  return skinMap(pixels, width, height, THREE.NoColorSpace);
}

function skinMap(pixels, width, height, colorSpace) {
  const map = new THREE.DataTexture(pixels, width, height);
  map.colorSpace = colorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

const circle = (i, count) => TAU * i / count;
const varied = (kind, random) => PEEL[kind][Math.floor(random() * PEEL[kind].length)];
const rotate = (x, y, z, cosine, sine) => [x * cosine + z * sine, y, z * cosine - x * sine];
const fruitProfile = (kind, size) => {
  const rx = size * (kind === 'potato' ? 1.22 : 1);
  const rz = size * (kind === 'potato' ? .82 : kind === 'orange' ? .955 : .91);
  const ry = size * (kind === 'tomato' ? .78 : kind === 'potato' ? .68 : kind === 'orange' ? .86 : .9);
  return { rx, ry, rz, radius: Math.sqrt(rx * rz) };
};

// La cámara conserva el espacio de los racimos originales, incluida su holgura para anticipar el giro.
function hangingBounds(x, y, z, length, lean, cosine, sine) {
  const box = new THREE.Box3(), point = new THREE.Vector3();
  for (const finger of [-1, 0, 1]) for (const [t, radius] of [[.02, 0], [.30, .076], [.72, .058], [1, 0]]) {
    for (let i = 0; i < (radius ? 3 : 1); i++) {
      const angle = i * Math.PI * 2 / 3 + finger * .35;
      const u = (finger * .155 + lean) * t + Math.sin(angle) * radius;
      const v = Math.sin(Math.PI * t * .89) * .14 + Math.cos(angle) * radius;
      box.expandByPoint(point.set(x + u * cosine + v * sine, y - length * (.74 - Math.abs(finger) * .09) * t,
        z + v * cosine - u * sine));
    }
  }
  return box;
}

export class MarketProduce {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.colors = [];
    this.indices = [];
  }

  vertex(point, normal, color, kind, u, v, light = 1) {
    const index = this.positions.length / 3;
    this.positions.push(...point);
    this.normals.push(...normal);
    this.colors.push(color.r * light, color.g * light, color.b * light);
    // La papaya comparte una banda de color. Piel y pulpa quedan en mitades separadas en el mapa de rugosidad.
    const row = kind === 'papaya' ? .075 + .4 * v : kind === 'pulp' ? .62 + .305 * v : .075 + .85 * v;
    this.uvs.push(.022 + .956 * u, (SKIN[kind] + row) / 8);
    return index;
  }

  quad(a, b, c, d) { this.indices.push(a, b, c, a, c, d); }

  /** Frutos individuales. Los de la parte alta varían en tamaño, madurez, giro y tono de la piel. */
  fruit(kind, x, surface, z, size, random, lift = 0) {
    const potato = kind === 'potato', tomato = kind === 'tomato', orange = kind === 'orange';
    const { rx, ry, rz, radius } = fruitProfile(kind, size), cy = surface + ry * .61 + lift;
    const turn = random() * TAU, ct = Math.cos(turn), st = Math.sin(turn);
    // Se omite la tapa inferior que queda bajo el guacal o entre los frutos de apoyo.
    const sideCount = orange ? 12 : tomato ? 8 : potato ? 6 : 7;
    const end = lift > 0 ? .92 : .82;
    const bands = orange ? [0, .075, .23, .39, .53, .695, end] : tomato ? [0, .16, .38, .61, end] : [0, .22, .49, end];
    const tone = varied(kind, random), shoulder = SHOULDERS[kind] ?? tone, phase = random() * TAU;
    const strength = .14 + random() * .35;
    const color = new THREE.Color();
    const rings = bands.map(t => {
      const polar = Math.PI * t, ny = Math.cos(polar), ringRadius = Math.sin(polar);
      const top = t === 0 ? (tomato ? .82 : orange ? .956 : ny) : ny;
      return Array.from({ length: sideCount + 1 }, (_, i) => {
        const angle = circle(i, sideCount), sx = Math.sin(angle), sz = Math.cos(angle);
        const lobes = tomato ? 3 : 2;
        const uneven = 1 + (tomato ? .09 : orange ? .027 : .055) * Math.cos(angle * lobes + phase) * ringRadius;
        const [px, , pz] = rotate(rx * sx * ringRadius * uneven, 0, rz * sz * ringRadius * uneven, ct, st);
        const normal = new THREE.Vector3(...rotate(sx * ringRadius / rx, ny / ry, sz * ringRadius / rz, ct, st)).normalize();
        color.copy(tone).lerp(shoulder, (1 - t) * (.23 + .26 * Math.cos(angle + phase)) * strength);
        return this.vertex([x + px, cy + top * ry, z + pz], normal.toArray(), color, kind, i / sideCount, 1 - t,
          .9 + .12 * Math.max(0, ny) + .065 * Math.cos(angle + phase) * ringRadius);
      });
    });
    for (let j = 1; j < rings.length; j++) for (let i = 0; i < sideCount; i++) {
      const [a, b, c, d] = [rings[j][i], rings[j][i + 1], rings[j - 1][i + 1], rings[j - 1][i]];
      if (j === 1) this.indices.push(a, b, d);
      else this.quad(a, b, c, d);
    }
    if (tomato) this.calyx(x, cy + ry * .82, z, size, turn);
    if (orange && random() < .36) this.citrusScar(x, cy + ry * .956 + .0015, z, size * .087, turn);
    return { x, z, cy, ry, radius };
  }

  citrusScar(x, y, z, size, turn) {
    const up = [0, 1, 0], center = this.vertex([x, y, z], up, CITRUS_STEM, 'stem', .5, .5, .74);
    const ring = Array.from({ length: 6 }, (_, i) => {
      const angle = turn + circle(i, 6);
      return this.vertex([x + size * Math.sin(angle), y + .001, z + size * Math.cos(angle)], up, CITRUS_STEM, 'stem', .5, .5, 1);
    });
    for (let i = 0; i < 6; i++) this.indices.push(center, ring[i], ring[(i + 1) % 6]);
  }

  calyx(x, y, z, size, turn) {
    const normal = [0, 1, 0];
    const center = this.vertex([x, y + .007, z], normal, STEM.green, 'stem', .5, .5);
    for (let i = 0; i < 5; i++) {
      const angle = turn + circle(i, 5), stem = .48 * size;
      const at = (angleOffset, stretch, lift, tone) => this.vertex(
        [x + Math.sin(angle + angleOffset) * stem * stretch, y + lift, z + Math.cos(angle + angleOffset) * stem * stretch],
        normal, STEM.green, 'stem', .4 + tone * .15, .5, tone);
      this.indices.push(center, at(-.42, .50, .006, .85), at(0, 1, -.004, 1.16));
      this.indices.push(center, this.positions.length / 3 - 1, at(.42, .50, .006, 1));
    }
  }

  /** Hojas que envuelven un cogollo compacto, con nervio central y cantos curvados. */
  cabbage(x, y, z, size, random) {
    this.fruit('cabbage', x, y + size * .29, z, size * .74, random);
    const turn = random() * TAU;
    const origin = new THREE.Vector3(), edge = new THREE.Vector3(), up = new THREE.Vector3();
    const outward = new THREE.Vector3(), nextNormal = new THREE.Vector3();
    const leafFace = (a, b, c) => {
      origin.fromArray(this.positions, 3 * a);
      edge.fromArray(this.positions, 3 * b).sub(origin);
      up.fromArray(this.positions, 3 * c).sub(origin);
      outward.fromArray(this.normals, 3 * a).add(nextNormal.fromArray(this.normals, 3 * b));
      outward.add(nextNormal.fromArray(this.normals, 3 * c));
      if (edge.cross(up).dot(outward) < 0) this.indices.push(a, c, b);
      else this.indices.push(a, b, c);
    };
    for (let leaf = 0; leaf < 6; leaf++) {
      const angle = turn + circle(leaf, 6) + (random() - .5) * .38, tone = varied('cabbage', random);
      const high = .23 + random() * .52, twist = (random() < .6 ? 1 : -1) * (.38 + random() * .43);
      const pleat = .026 + random() * .09, edgeTint = .16 + random() * .3;
      const rings = [0, .25, .57, .82, 1].map(t => [-1, 0, 1].map(side => {
        const spread = (.83 + side * .12) * Math.sin(Math.PI * (.14 + .64 * t));
        const azimuth = angle + side * spread + t * twist;
        const polar = THREE.MathUtils.lerp(1.93, high, t) + Math.abs(side) * .23 * t + side * .23 * t;
        const fold = side ? pleat * t * t * Math.sin(3.9 * t + leaf * 2.3 + side) : 0;
        const r = size * (1 + fold + .075 * Math.sin(Math.PI * t) + .028 * leaf / 5);
        const sx = Math.sin(azimuth) * Math.sin(polar), sz = Math.cos(azimuth) * Math.sin(polar), sy = Math.cos(polar);
        const color = tone.clone().lerp(PEEL.onion[1], side === 0 ? .12 * t : edgeTint * t ** 3);
        return this.vertex([x + sx * r, y + size * .53 + sy * r * .89, z + sz * r], [sx, sy, sz], color, 'cabbage',
          (side + 1) / 2, t, .88 + .13 * t + (side === 1 ? .06 : 0));
      }));
      for (let j = 1; j < rings.length; j++) for (let i = 0; i < 2; i++) {
        const a = rings[j - 1][i], b = rings[j - 1][i + 1], c = rings[j][i + 1], d = rings[j][i];
        leafFace(a, b, c);
        leafFace(a, c, d);
      }
    }
  }

  /** Papaya larga, con variación de madurez. Una mitad inclinada deja a la vista pulpa, hueco y semillas. */
  papaya(x, y, z, length, turn, random, cut = false) {
    const rx = length * .5, rz = length * .26, ry = length * .243;
    const ct = Math.cos(turn), st = Math.sin(turn), tilt = cut ? .36 : .05;
    const lean = Math.sin(tilt), upright = Math.cos(tilt), cy = y + Math.hypot(ry * upright, rz * lean) - .009;
    const tone = varied('papaya', random), sun = PEEL.papaya[4], phase = random() * TAU;
    const n = 14, peel = new THREE.Color();
    const point = (px, py, pz) => {
      const [xx, yy, zz] = rotate(px, py * upright - pz * lean, pz * upright + py * lean, ct, st);
      return [x + xx, cy + yy, z + zz];
    };
    const normal = (nx, ny, nz) => new THREE.Vector3(...rotate(nx, ny * upright - nz * lean, nz * upright + ny * lean, ct, st)).normalize().toArray();
    const rings = [];
    const shell = cut ? [0, .24, .52, .78, 1] : [0, .14, .32, .5, .68, .86, 1];
    for (const t of shell) {
      const angle = t * Math.PI * (cut ? .5 : 1);
      const radius = Math.sin(angle), lift = -Math.cos(angle);
      rings.push(Array.from({ length: n + 1 }, (_, i) => {
        const phi = circle(i, n), dx = Math.cos(phi), dz = Math.sin(phi), taper = 1 + .175 * dx;
        peel.copy(tone).lerp(sun, .16 + .25 * Math.sin(phi * 2 + phase) * radius + .21 * t);
        return this.vertex(point(dx * rx * radius, ry * lift, dz * rz * radius * taper),
          normal(dx * radius / rx, lift / ry, dz * radius / (rz * taper)), peel, 'papaya', i / n, t,
          .9 + .12 * t + .09 * Math.sin(phi + phase) * radius);
      }));
    }
    this.papayaRings(rings, n, true, !cut);
    if (!cut) return;
    const flesh = [
      [1, 0, 0, .1], [.94, .001, 1, .06], [.86, .007, 2, 0], [.57, .008, 2, .04],
      [.50, -.005, 3, .38], [.41, -.024, 4, .91], [.26, -.038, 5, 1.4], [0, -.047, 5, 0]
    ].map(([radius, rise, toneIndex, slope]) => Array.from({ length: n + 1 }, (_, i) => {
      const phi = circle(i, n), dx = Math.cos(phi), dz = Math.sin(phi), taper = 1 + .175 * dx;
      return this.vertex(point(dx * rx * radius, rise, dz * rz * radius * taper), normal(-dx * slope, 1, -dz * slope),
        PAPAYA_FLESH[toneIndex], 'pulp', i / n, .26 + .5 * radius,
        .94 + .06 * Math.sin(phi + phase) * radius);
    }));
    this.papayaRings(flesh, n, false, true);
    for (let i = 0; i < 20; i++) {
      const angle = i * 2.399963, r = Math.sqrt((i + .22) / 20) * .38;
      const px = Math.cos(angle) * rx * r, pz = Math.sin(angle) * rz * r;
      const py = -.046 + .055 * r, size = .0055 + random() * .0028;
      const top = this.vertex(point(px, py + size, pz), normal(0, 1, 0), PAPAYA_FLESH[6], 'stem', .5, .5, 1.13);
      const base = Array.from({ length: 6 }, (_, s) => {
        const theta = circle(s, 6), dx = Math.cos(theta), dz = Math.sin(theta);
        return this.vertex(point(px + dx * size, py, pz + dz * size), normal(dx, .57, dz), PAPAYA_FLESH[6],
          'stem', s / 6, .3, .88 + .12 * Math.sin(theta));
      });
      for (let s = 0; s < 6; s++) this.indices.push(base[s], top, base[(s + 1) % 6]);
    }
  }

  papayaRings(rings, sides, bottomPole, topPole) {
    for (let j = 1; j < rings.length; j++) for (let i = 0; i < sides; i++) {
      const [a, b, c, d] = [rings[j - 1][i], rings[j - 1][i + 1], rings[j][i + 1], rings[j][i]];
      if (j === 1 && bottomPole) this.indices.push(a, d, c);
      else if (j === rings.length - 1 && topPole) this.indices.push(a, c, b);
      else this.quad(a, d, c, b);
    }
  }

  tube(points, radii, colorsAt, kind, sides, ridge = 0) {
    const rings = [];
    const along = new THREE.Vector3(), cross = new THREE.Vector3(), up = new THREE.Vector3();
    const before = new THREE.Vector3(), normal = new THREE.Vector3();
    const axis = new THREE.Vector3(...points.at(-1)).sub(before.fromArray(points[0])).normalize();
    const reference = Math.abs(axis.y) > .6 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    for (let j = 0; j < points.length; j++) {
      along.fromArray(points[Math.min(points.length - 1, j + 1)]);
      along.sub(before.fromArray(points[Math.max(0, j - 1)])).normalize();
      cross.crossVectors(reference, along).normalize();
      up.crossVectors(along, cross).normalize();
      const [x, y, z] = points[j], radius = radii[j];
      const ring = [];
      for (let i = 0; i <= sides; i++) {
        const angle = circle(i, sides);
        normal.copy(cross).multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
        const rib = 1 + ridge * Math.cos(angle * 3), r = radius * rib;
        ring.push(this.vertex([x + r * normal.x, y + r * normal.y, z + r * normal.z], normal.toArray(),
          colorsAt[j], kind, i / sides, j / (points.length - 1), 1 - ridge * .6 + .08 * Math.sin(angle + j * .5)));
      }
      rings.push(ring);
    }
    for (let j = 1; j < rings.length; j++) for (let i = 0; i < sides; i++) {
      this.quad(rings[j - 1][i], rings[j - 1][i + 1], rings[j][i + 1], rings[j][i]);
    }
  }

  /** Cebolla larga en manojos. Bulbo claro y hojas que se abren hacia las puntas. */
  onions(x, y, z, width, depth, turn, random, fill) {
    const ct = Math.cos(turn), st = Math.sin(turn);
    const bundles = fill === 'full' ? [-.30, .28, .02] : fill === 'open' ? [-.23] : [-.24, .23];
    for (const [bundle, offset] of bundles.entries()) for (let shoot = 0; shoot < 5; shoot++) {
      const length = depth * (.62 + random() * .24), center = offset * width;
      const gap = (shoot - 2) * .03, tilt = (bundle ? .30 : -.26) * depth;
      const points = [0, .13, .34, .62, .9, 1].map(t => {
        const [xx, , zz] = rotate(center + gap * (.47 + t * 1.45) + tilt * (t - .5), 0, (t - .5) * length, ct, st);
        return [x + xx, y + .034 + Math.sin(t * Math.PI) * (.045 + shoot * .009 + bundle * .007), z + zz];
      });
      const shades = [PEEL.onion[0], PEEL.onion[0], PEEL.onion[1], PEEL.onion[2], PEEL.onion[3 + shoot % 2], PEEL.onion[4]];
      this.tube(points, [.007, .026, .023, .016, .011, .002], shades, 'onion', 5);
    }
  }

  stallTray({ stall, column, front, side, x, y, z, width, depth, seed }) {
    const [kind, fill] = STALL_TRAYS[stall][front ? 'front' : 'back'][column];
    this.tray(kind, x, y, z, width, depth, seed, side > 0 ? 0 : Math.PI, fill);
  }

  tray(kind, x, y, z, width, depth, seed, turn = 0, fill = 'low') {
    const random = rng(seed), ct = Math.cos(turn), st = Math.sin(turn);
    if (kind === 'onion') {
      this.onions(x, y, z, width, depth, turn, random, fill);
      return;
    }
    if (kind === 'cabbage') {
      const size = Math.min(width * .18, depth * .24);
      const heads = fill === 'open' ? [[-.24, -.11], [.12, .21]] : [[-.24, -.16], [.24, -.11], [.02, .23]];
      for (const [dx, dz] of heads) {
        const [xx, , zz] = rotate(dx * width, 0, dz * depth, ct, st);
        this.cabbage(x + xx, y, z + zz, size * (.83 + random() * .21), random);
      }
      return;
    }
    if (kind === 'papaya') {
      const length = Math.min(width * .48, depth * .67);
      const displays = [[-.18, .23, 1.04, -.16, true], [.20, -.20, 1.08, .35, false], [-.25, -.22, .94, -.16, false]];
      if (fill === 'open') displays.pop();
      for (const [dx, dz, size, slant, cut] of displays) {
        const [xx, , zz] = rotate(dx * width, 0, dz * depth, ct, st);
        this.papaya(x + xx, y, z + zz, size * length, turn + slant + (random() - .5) * .14, random, cut);
      }
      return;
    }
    this.pile(kind, x, y, z, width, depth, random, ct, st, fill);
  }

  pile(kind, x, y, z, width, depth, random, ct, st, fill) {
    const spacing = kind === 'potato' ? .118 : kind === 'tomato' ? .155 : .18;
    const columns = Math.max(2, Math.round(width / spacing)), rows = Math.max(2, Math.round(depth / spacing));
    const stepX = width / columns, stepZ = depth / rows;
    const size = Math.min(stepX, stepZ) * (kind === 'potato' ? .49 : .51);
    const peak = (random() - .5) * width * .43, back = (random() - .47) * depth * .31;
    const partial = fill === 'open' ? 1 : 0;
    const put = (px, pz, s, supports = []) => {
      const [xx, , zz] = rotate(px, 0, pz, ct, st);
      const pieceX = x + xx, pieceZ = z + zz;
      const next = supports.length ? this.stackedFruit(kind, pieceX, y, pieceZ, s, random, supports)
        : this.fruit(kind, pieceX, y, pieceZ, s, random);
      return next && { ...next, px, pz };
    };
    let tier = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, col) => {
      const px = (col + .5 - columns / 2 + (random() - .5) * .23) * stepX;
      const pz = (row + .5 - rows / 2 + (random() - .5) * .22) * stepZ;
      if (partial && (px - peak) / width * Math.sign(peak) - pz * .45 / depth < -.19 + random() * .13) return null;
      return put(px, pz, size * (.83 + random() * .28));
    }));
    // Se apoya la capa siguiente entre las piezas de abajo. El centro de la pila queda desviado hacia un lado.
    const layers = fill === 'full' ? (kind === 'potato' ? [1.08, .81, .44] : [1.04, .59]) : fill === 'open' ? [.46] : [.77];
    for (const layer of layers) {
      tier = tier.slice(0, -1).map((row, j) => row.slice(0, -1).map((piece, i) => {
        const supports = [piece, row[i + 1], tier[j + 1][i], tier[j + 1][i + 1]].filter(Boolean);
        if (supports.length < 3) return null;
        const px = supports.reduce((sum, foot) => sum + foot.px, 0) / supports.length + (random() - .5) * stepX * .12;
        const pz = supports.reduce((sum, foot) => sum + foot.pz, 0) / supports.length + (random() - .5) * stepZ * .11;
        if (Math.hypot((px - peak) / (width * .5), (pz - back) / (depth * .49)) > layer * (.89 + random() * .23)) return null;
        return put(px, pz, size * (.90 + random() * .22), supports);
      }));
    }
  }

  stackedFruit(kind, x, y, z, size, random, supports) {
    const { ry, radius } = fruitProfile(kind, size);
    const contact = [];
    for (const below of supports) {
      const distance = Math.hypot(x - below.x, z - below.z) / (radius + below.radius);
      if (distance < .99) contact.push(below.cy + (ry + below.ry) * Math.sqrt(1 - distance * distance));
    }
    contact.sort((a, b) => b - a);
    const lift = (contact[1] ?? 0) - y - ry * .61 - .003;
    return lift > .018 ? this.fruit(kind, x, y, z, size, random, lift) : null;
  }

  basket(kind, x, y, z, seed) {
    const random = rng(seed), turn = random() * TAU;
    const potato = kind === 'potato', count = potato ? 11 : 8;
    const pieces = [];
    for (let i = 0; i < count; i++) {
      const angle = turn + circle(i, count), radius = .157 + random() * .013;
      pieces.push(this.fruit(kind, x + Math.sin(angle) * radius, y, z + Math.cos(angle) * radius,
        (potato ? .048 : .066) + random() * .016, random));
    }
    for (let i = 0; i < 3; i++) {
      const angle = turn + circle(i, 3);
      pieces.push(this.fruit(kind, x + Math.sin(angle) * .066, y, z + Math.cos(angle) * .066,
        (potato ? .053 : .067) + random() * .012, random));
    }
    for (let i = 0; i < 3; i++) {
      const angle = turn + circle(i + .43, 3);
      this.stackedFruit(kind, x + Math.sin(angle) * .092, y, z + Math.cos(angle) * .092,
        (potato ? .049 : .065) + random() * .012, random, pieces);
    }
  }

  /** Dos manos de plátano en una corona común, con dedos curvos y piel de distinta madurez. */
  plantains(x, top, z, length, unripe, lean, turn) {
    const first = this.positions.length;
    const ct = Math.cos(turn), st = Math.sin(turn);
    for (let hand = 0; hand < 2; hand++) {
      const num = hand ? 4 : 5, shiftY = hand * .081;
      for (let i = 0; i < num; i++) {
        const across = i * 2 / (num - 1) - 1;
        const peel = PEEL.plantain[(unripe ? [2, 3, 2, 1, 4] : [0, 4, 1, 0, 2])[(i + hand) % 5]];
        const middle = peel.clone().lerp(PEEL.plantain[4], hand ? .22 : .12);
        const points = [0, .13, .32, .59, .84, 1].map(t => {
          const u = (across * (.17 - .025 * hand) + lean) * t + across * .021;
          const v = (hand ? .057 : -.014) + Math.sin(Math.PI * t * .89) * (.113 + .022 * (1 - Math.abs(across)));
          const [xx, , zz] = rotate(u, 0, v, ct, st);
          const hanging = length * (.72 - hand * .137 - Math.abs(across) * .12) + (i % 2) * .018;
          return [x + xx, top - shiftY - hanging * t, z + zz];
        });
        const shading = [STEM.green, peel, middle, middle, peel, STEM.tip];
        this.tube(points, [.011, .031, .045, .047, .033, .009], shading, 'plantain', 6, .07);
      }
    }
    const [xx, , zz] = rotate(0, 0, .031, ct, st);
    this.tube([[x + xx, top - .108, z + zz], [x, top - .024, z], [x, top + .02, z]], [.026, .035, .017],
      [STEM.green, STEM.dry, STEM.green], 'stem', 6);
    const box = hangingBounds(x, top, z, length, lean, ct, st);
    const geometry = new THREE.Box3(), point = new THREE.Vector3();
    for (let i = first; i < this.positions.length; i += 3) geometry.expandByPoint(point.fromArray(this.positions, i));
    const originalCenter = geometry.getCenter(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const scale = box.getSize(new THREE.Vector3()).divide(geometry.getSize(new THREE.Vector3())).min(point.set(1, 1, 1));
    for (let i = first; i < this.positions.length; i += 3) {
      point.fromArray(this.positions, i).sub(originalCenter).multiply(scale).add(center).toArray(this.positions, i);
      point.fromArray(this.normals, i).divide(scale).normalize().toArray(this.normals, i);
    }
    return box;
  }

  finish(parent) {
    // Un solo lote de productos y una sola piel para los seis puestos. El azar de la ciudad conserva su secuencia.
    return withVisualRandom(() => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
      geometry.setIndex(this.indices);
      geometry.computeBoundingBox();
      const material = new THREE.MeshStandardMaterial({ ...skins(), vertexColors: true, roughness: 1, envMapIntensity: .28 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'Surtido del mercado';
      mesh.userData.visualOnly = true;
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    });
  }
}
