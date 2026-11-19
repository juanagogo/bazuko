import * as THREE from 'three';
import { Batch, brickUV } from './ZoneGeometry.js';
import { StreetBatch, tint, unit } from './StreetBatch.js';
import { detailRect } from './ZoneTextures.js';
import { rng } from './textures.js';
import { withVisualRandom } from './VisualRandom.js';

const TAU = Math.PI * 2;
const PALETTE = {
  fern: ['#658247', '#839a57', '#50734b', '#84934d', '#6c9363'],
  strap: ['#496748', '#658458', '#426449', '#82945c'],
  broad: ['#536d48', '#6e854d', '#7f925e', '#547954'],
  acanthus: ['#3f6549', '#577951', '#648466', '#769367', '#5a744f'],
  agapanthus: ['#b2aacd', '#8d77a9', '#c7b5d5', '#bebfdd', '#8d93b9'],
  salvia: ['#aa5c68', '#b45971', '#99506e', '#ba7485', '#943e58'],
  lily: ['#c27949', '#b46238', '#d4864d', '#cb8a55', '#b95a48']
};
const STEM = tint('#697752');
const LEAF_UV = [0, 0, 1, 1];
const EARTH = .077, CURB = .119;
const APRONS = [{ x0: 325.28, x1: 328.994, z: 264, toward: 1 }, { x0: 333.006, x1: 337.12, z: 264, toward: -1 }];
const APRON_DEPTH = 3.22;

export function onTeusaquilloApron(x, z, margin = 0) {
  return APRONS.some(pad => Math.abs(z - pad.z) <= APRON_DEPTH / 2 + margin && x >= pad.x0 - margin && x <= pad.x1 + margin);
}

// La primera pareja acompaña la entrada norte. Las otras dos jardineras dan fondo a las bancas existentes.
// Las esquinas de las islas dejan libres los puntos de residuos de la cuadrícula, también al reaparecer.
const BEDS = [
  { x: 325.02, z: 255.53, w: 4.55, d: 3.47, bend: -.31, corner: .63, seed: 1072,
    plants: [['fern', -.40, .20, .77], ['fern', -.14, .29, .92], ['fern', .09, .16, .74],
      ['strap', .18, -.42, .68], ['strap', .44, -.30, .86], ['strap', .58, .08, .78], ['strap', .29, .27, .70],
      ['acanthus', -.35, -.26, .67], ['acanthus', -.54, -.39, .58], ['broad', -.03, -.45, .46]] },
  { x: 337, z: 255.44, w: 4.56, d: 3.54, bend: .38, corner: .66, seed: 4113,
    plants: [['salvia', -.48, .23, .80], ['salvia', -.29, .36, .95], ['salvia', -.05, .34, .87],
      ['lily', -.51, -.23, .72], ['lily', -.30, -.39, .74], ['lily', -.12, -.29, .79],
      ['fern', .23, .27, .90], ['fern', .48, .20, .68], ['acanthus', .34, -.29, .75], ['acanthus', .59, -.21, .60]] },
  { x: 323.61, z: 264.85, w: 2.44, d: 4, bend: .12, corner: .67, seed: 2208,
    plants: [['fern', -.15, -.40, .85], ['fern', -.31, -.09, .84], ['fern', .15, .03, .83],
      ['acanthus', -.16, .30, .82], ['acanthus', .26, -.31, .58], ['strap', .24, .54, .71],
      ['strap', -.29, .47, .67], ['broad', .42, -.07, .46]] },
  { x: 338.84, z: 264.7, w: 3.13, d: 3.73, bend: -.12, corner: .71, seed: 3353,
    plants: [['acanthus', -.28, -.20, .78], ['acanthus', .22, .27, .84], ['fern', .08, .03, .86], ['fern', -.16, .42, .81],
      ['salvia', .34, -.33, .86], ['salvia', .13, -.46, .72], ['lily', -.25, -.51, .64], ['lily', .42, .27, .76],
      ['broad', -.44, .39, .44]] }
];

const lerp = THREE.MathUtils.lerp;
const shade = (color, amount) => color.map(channel => channel * amount);
const choose = (kind, random) => tint(PALETTE[kind][Math.floor(random() * PALETTE[kind].length)]);

function bedRing(bed, inside = 0) {
  const hw = bed.w / 2 - inside, hd = bed.d / 2 - inside, round = bed.corner - inside * .70;
  const ring = [];
  for (let corner = 0; corner < 4; corner++) {
    const from = (corner - 1) * Math.PI / 2, signX = Math.cos(from + Math.PI / 4) >= 0 ? 1 : -1;
    const signZ = Math.sin(from + Math.PI / 4) >= 0 ? 1 : -1;
    for (let i = 0; i <= 3; i++) {
      const angle = from + i * Math.PI / 6;
      const localX = (hw - round) * signX + round * Math.cos(angle);
      const localZ = (hd - round) * signZ + round * Math.sin(angle);
      ring.push([bed.x + localX, bed.z + localZ + bed.bend * localX / hw]);
    }
  }
  return ring;
}

/** Sardinel de dos hiladas, con remate de ladrillo de canto. Se mantiene bajo para dejar ver el otro sendero. */
function addBed(batch, materials, bed, floor) {
  const outer = bedRing(bed), inner = bedRing(bed, .175);
  const ground = (point, lift) => [point[0], floor(point[0], point[1]) + lift, point[1]];
  const uvEarth = points => points.flatMap(([x, , z]) => [x / 8, z / 8]);
  const center = ground([bed.x, bed.z], EARTH + .015);
  let distance = bed.seed % 11 * .313;
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length, a = outer[i], b = outer[j], c = inner[i], d = inner[j];
    const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const [u0, v0, u1, v1] = brickUV(distance + .07, length, CURB * 2);
    batch.quadUV(materials.brick, ground(a, -.003), ground(a, CURB), ground(b, CURB), ground(b, -.003),
      [u0, v0, u0, v1, u1, v1, u1, v0]);
    const base = [ground(c, EARTH), ground(d, EARTH), ground(d, CURB), ground(c, CURB)];
    const inset = [ground(a, CURB), ground(c, CURB), ground(d, CURB), ground(b, CURB)];
    batch.quad(materials.brick, ...base, [u0, 0, u1, (CURB - EARTH) / 2.88]);
    batch.quad(materials.brick, ...inset, [u0, .17, u1, .23]);
    const count = Math.max(1, Math.round(length / .119));
    const at = (from, to, t) => [lerp(from[0], to[0], t), lerp(from[1], to[1], t)];
    for (let n = 0; n < count; n++) {
      const s = (n + .044) / count, t = (n + .957) / count;
      const tile = [at(a, b, s), at(c, d, s), at(c, d, t), at(a, b, t)];
      batch.quad(materials.detail, ...tile.map(point => ground(point, CURB + .006)),
        (i + n + bed.seed) % 7 ? 'terracotta' : 'brick');
    }
    const soil = [center, ground(d, EARTH), ground(c, EARTH)];
    batch.tri(materials.soil, ...soil, uvEarth(soil));
    distance += length;
  }
}

function addBenchApron(batch, { x0, x1, z, toward }, groundHeight) {
  // Losetas de reemplazo a ras donde ya están las patas. El sendero conserva su cota y su ancho.
  const width = x1 - x0, depth = APRON_DEPTH, z0 = z - depth / 2, rows = 8;
  const y = groundHeight((x0 + x1) / 2, z) + .006, edge = .16, gap = .006;
  const concrete = detailRect('concrete'), clay = detailRect('terracotta');
  const tone = tint('#b7afa3'), joint = tint('#928878');
  const up = [0, 1, 0];
  const quad = (a, b, c, d, height, uv, color) => batch.quad([a, height, d], [b, height, d], [b, height, c], [a, height, c], up, uv, color);
  quad(x0, x1, z0, z0 + depth, y, concrete, joint);
  const end = toward > 0 ? x0 : x1 - edge, min = toward > 0 ? x0 + edge : x0;
  const max = toward > 0 ? x1 : x1 - edge;
  quad(end + gap, end + edge - gap, z0 + gap, z0 + depth - gap, y + .0025, clay, shade(tone, .88));
  for (let row = 0; row < rows; row++) {
    const start = z0 + row * depth / rows, finish = start + depth / rows;
    const slab = (max - min) / Math.round(width / .40);
    for (let px = min - (row % 2 ? slab * .5 : 0), i = 0; px < max - .01; px += slab, i++) {
      const a = Math.max(px, min) + gap, b = Math.min(px + slab, max) - gap;
      if (b <= a) continue;
      const color = shade(tone, .91 + .17 * unit(i, row, toward > 0 ? 541 : 110));
      quad(a, b, start + gap, finish - gap, y + .0025, concrete, color);
    }
  }
}

/** Caras con normales reales, color por vértice y pequeños cambios de tono entre hojas. */
function face(batch, a, b, c, paint, shades) {
  const ab = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
  const ac = new THREE.Vector3(...c).sub(new THREE.Vector3(...a));
  const n = ab.cross(ac).normalize().toArray();
  batch.triangle(a, b, c, n, LEAF_UV, shades.map(value => shade(paint, value)));
}

function leaf(batch, from, angle, length, height, width, curl, paint) {
  const [x, y, z] = from, dx = Math.cos(angle), dz = Math.sin(angle);
  const point = (t, side) => {
    const bulge = Math.sin(Math.PI * t) ** .75;
    const ramp = t * height + Math.sin(Math.PI * t) * curl;
    return [x + dx * length * t - side * dz * width * bulge, y + ramp - Math.abs(side) * width * bulge * .43,
      z + dz * length * t + side * dx * width * bulge];
  };
  for (const side of [-1, 1]) {
    const root = point(0, 0), mid = point(.46, 0), edge = point(.36, side), lip = point(.71, side), tip = point(1, 0);
    face(batch, root, edge, mid, paint, [.65, .92, 1.09]);
    face(batch, edge, lip, mid, paint, [.92, .99, 1.09]);
    face(batch, mid, lip, tip, paint, [1.09, .99, 1.03]);
  }
}

function stem(batch, a, b, width, paint = STEM) {
  const at = (p, angle, side) => [p[0] + Math.cos(angle) * width * side, p[1], p[2] + Math.sin(angle) * width * side];
  for (const angle of [.4, Math.PI / 2 + .4]) {
    face(batch, at(a, angle, -1), at(a, angle, 1), at(b, angle, 1), paint, [.72, .92, 1]);
    face(batch, at(a, angle, -1), at(b, angle, 1), at(b, angle, -1), paint, [.72, 1, .91]);
  }
}

function fern(batch, x, y, z, size, random) {
  const base = random() * TAU;
  for (let i = 0; i < 10; i++) {
    const angle = base + i * TAU / 10 + (random() - .5) * .45;
    const span = size * (.53 + random() * .34), height = size * (.49 + random() * .54);
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const midrib = t => [x + dx * span * t, y + height * (Math.sin(t * Math.PI * .88) * .77 + t * .32), z + dz * span * t];
    let previous = [x, y, z];
    for (let n = 1; n <= 8; n++) {
      const t = n / 8, p = midrib(t);
      stem(batch, previous, p, .0045 * (1.23 - .6 * t));
      previous = p;
      const spread = Math.sin(t * Math.PI * .89) * span * .46;
      for (const side of [-1, 1]) leaf(batch, p, angle + side * (1.17 - .55 * t), spread * (.85 + random() * .33),
        -.085 * span * t, spread * .27, .024, choose('fern', random));
    }
  }
}

function corolla(batch, center, radius, tilt, paint, random) {
  const [x, y, z] = center, at = angle => [x + Math.cos(angle) * radius, y + radius * (.36 + Math.cos(angle) * tilt), z + Math.sin(angle) * radius];
  const base = random() * TAU;
  for (let i = 0; i < 6; i++) {
    const a = base + i / 6 * TAU;
    face(batch, center, at(a + .48), at(a - .48), paint, [.60, 1.04 + random() * .19, .99]);
  }
}

function agapanthus(batch, x, y, z, size, random) {
  for (let i = 0; i < 17; i++) {
    const angle = i * 2.399 + random() * .53, stretch = .70 + random() * .29;
    leaf(batch, [x, y, z], angle, size * stretch * .75, size * stretch * .39, size * .059, size * .30, choose('strap', random));
  }
  for (const n of [-1, 1]) {
    const angle = random() * TAU, root = [x, y, z];
    const tip = [x + n * size * .18, y + size * (.92 + random() * .24), z + size * .15 * Math.sin(angle)];
    stem(batch, root, tip, .006);
    const family = choose('agapanthus', random);
    for (let i = 0; i < 21; i++) {
      const a = i * 2.399 + angle, r = size * (.035 + .134 * Math.sqrt(i / 21));
      const floret = [tip[0] + r * Math.sin(a), tip[1] + (1 - i / 21) * size * .129, tip[2] + r * Math.cos(a)];
      stem(batch, tip, floret, .003);
      corolla(batch, floret, .022 + random() * .014, Math.sin(a) * .89, shade(family, .86 + random() * .23), random);
    }
  }
}

function salvia(batch, x, y, z, size, random) {
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * TAU + random() * .40, dx = Math.cos(angle), dz = Math.sin(angle);
    const shift = size * (.17 + random() * .20), h = size * (.65 + random() * .49);
    const at = t => [x + shift * t * dx, y + h * t, z + shift * t * dz];
    stem(batch, at(0), at(.98), .0045);
    for (const [t, direction] of [[.14, -1], [.25, 1], [.36, -1], [.48, 1], [.61, -1]])
      leaf(batch, at(t), angle + direction * (1.14 + t), size * (.32 - t * .23), .025, size * .068, .042, choose('broad', random));
    const family = choose('salvia', random);
    for (let n = 0; n < 7; n++) {
      const t = .57 + n * .059, p = at(t), side = n % 2 ? 1 : -1;
      const bloom = [p[0] + Math.sin(angle) * side * .040, p[1], p[2] + Math.cos(angle) * side * .040];
      corolla(batch, bloom, size * (.067 - n * .0044), side * 1.31, family, random);
    }
  }
}

function broadleaf(batch, x, y, z, size, random) {
  const turn = random() * TAU;
  for (let i = 0; i < 8; i++) {
    const angle = turn + i * 2.399, radial = size * (.66 + random() * .34);
    leaf(batch, [x, y, z], angle, radial, radial * .44, radial * .28, radial * .38, choose('broad', random));
  }
}

/** Hojas lobuladas del acanto, más anchas y oscuras que las cintas del agapanto. */
function acanthus(batch, x, y, z, size, random) {
  const lobes = [[.08, .19], [.21, .67], [.29, .47], [.37, .92], [.46, .55], [.56, 1], [.67, .61], [.75, .83], [.87, .48]];
  const turn = random() * TAU;
  for (let i = 0; i < 12; i++) {
    const a = turn + i * 2.399, dx = Math.cos(a), dz = Math.sin(a);
    const reach = size * (.57 + random() * .37), lift = size * (.24 + random() * .38), width = reach * (.165 + random() * .077);
    const at = (t, w) => [x + dx * reach * t - dz * width * w,
      y + lift * t + .18 * size * Math.sin(t * Math.PI) - Math.abs(w) * (.037 + t * .013), z + dz * reach * t + dx * width * w];
    const paint = choose('acanthus', random);
    for (const side of [-1, 1]) {
      let previous = at(0, 0), lastRib = previous;
      for (const [t, w] of lobes) {
        const middle = at(t, 0), edge = at(t + side * .023, w * side);
        face(batch, previous, middle, edge, paint, [.81, 1.12, .86 + t * .17]);
        if (t > .08) face(batch, previous, lastRib, middle, paint, [.81, 1.12, 1.12]);
        previous = edge;
        lastRib = middle;
      }
      face(batch, previous, lastRib, at(1, 0), paint, [.96, 1.05, 1.16]);
    }
  }
}

/** Espigas arqueadas con varios cálices anaranjados, inspiradas en el lirio lucifer de las jardineras del Parkway. */
function lily(batch, x, y, z, size, random) {
  for (let i = 0; i < 11; i++) {
    const a = i * 2.399 + random() * .5;
    leaf(batch, [x, y, z], a, size * (.24 + random() * .44), size * (.43 + random() * .30), size * .044,
      size * .12, choose('strap', random));
  }
  for (let i = 0; i < 4; i++) {
    const a = i * 2.399 + random(), dx = Math.cos(a), dz = Math.sin(a), height = size * (.81 + random() * .28);
    const bend = size * (.22 + random() * .16);
    const at = t => [x + dx * bend * t * t, y + height * (t - .38 * Math.max(0, t - .76)), z + dz * bend * t * t];
    stem(batch, at(0), at(.56), .0045);
    stem(batch, at(.56), at(.84), .0035);
    stem(batch, at(.84), at(1), .0027);
    const color = choose('lily', random);
    for (let n = 0; n < 5; n++) {
      const p = at(.63 + n * .085), side = n % 2 ? 1 : -1;
      const tip = [p[0] - dz * .063 * side, p[1] + .024, p[2] + dx * .063 * side];
      stem(batch, p, tip, .0036);
      corolla(batch, tip, size * (.061 - n * .004), 1.21 * side, color, random);
    }
  }
}

const plant = { fern, strap: agapanthus, salvia, broad: broadleaf, acanthus, lily };

function insideBed(bed, x, z, margin) {
  const hx = bed.w / 2, hz = bed.d / 2;
  const dx = Math.max(0, Math.abs(x) - hx + bed.corner), dz = Math.max(0, Math.abs(z) - hz + bed.corner);
  return Math.hypot(dx, dz) <= bed.corner - margin;
}

function addPlanting(batch, bed, groundHeight) {
  const random = rng(bed.seed);
  for (const [kind, u, v, size] of bed.plants) {
    const x = bed.x + u * bed.w / 2, z = bed.z + v * bed.d / 2 + u * bed.bend;
    const y = groundHeight(x, z) + EARTH + .009;
    plant[kind](batch, x, y, z, size, random);
    if (kind === 'broad') continue;
    for (let i = 0; i < 2; i++) {
      const a = random() * TAU, r = .38 + random() * .13;
      const ux = x + r * Math.cos(a), uz = z + r * Math.sin(a);
      if (insideBed(bed, ux - bed.x, uz - bed.z - bed.bend * (ux - bed.x) / (bed.w / 2), .34))
        broadleaf(batch, ux, y - .008, uz, .29 + random() * .14, random);
    }
  }
  // Una cobertura corta une algunos grupos de altura. Las aperturas dejan leer el borde y los tallos.
  const hw = bed.w / 2, hd = bed.d / 2, margin = .54;
  for (let row = 0, z = -hd + margin; z < hd - margin; row++, z += .48) {
    for (let x = -hw + margin + (row % 2) * .245; x < hw - margin; x += .49) {
      const px = x + (random() - .5) * .18, pz = z + (random() - .5) * .14;
      if (!insideBed(bed, px, pz, .39) || random() < .21 + .16 * Math.sin(px * .9 + pz + bed.seed)) continue;
      const u = bed.x + px, v = bed.z + pz + bed.bend * px / hw;
      broadleaf(batch, u, groundHeight(u, v) + EARTH + .007, v, .31 + random() * .146, random);
    }
  }
}

/** Composición de jardín de acceso. Comparte los atlas de barrio y la tierra del distrito. */
export function buildTeusaquilloGarden(materials, groundHeight) {
  return withVisualRandom(() => {
    const group = new THREE.Group(), paving = new Batch();
    group.name = 'Jardines del acceso de Teusaquillo';
    for (const bed of BEDS) addBed(paving, materials, bed, groundHeight);
    const slabs = materials.detail.clone();
    slabs.name = 'Loseta mate de las bancas';
    slabs.roughness = .97;
    slabs.envMapIntensity = .24;
    slabs.vertexColors = true;
    paving.finish(group, { name: 'Sardineles y ensanches de Teusaquillo', visualOnly: true });
    const pads = new StreetBatch({ material: slabs, name: slabs.name, chunkSize: 512, castShadow: true });
    for (const apron of APRONS) addBenchApron(pads, apron, groundHeight);
    for (const mesh of pads.finish(group)) {
      // Permite que el distrito ordene estas losetas con el resto de superficies estáticas.
      mesh.userData.noMerge = false;
      mesh.userData.visualOnly = true;
    }
    const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .87, side: THREE.DoubleSide,
      envMapIntensity: .37 });
    foliage.name = 'Herbáceas de los jardines de Teusaquillo';
    const plantings = new StreetBatch({ material: foliage, name: foliage.name, chunkSize: 512, castShadow: true });
    for (const bed of BEDS) addPlanting(plantings, bed, groundHeight);
    for (const mesh of plantings.finish(group)) mesh.userData.visualOnly = true;
    return group;
  });
}
