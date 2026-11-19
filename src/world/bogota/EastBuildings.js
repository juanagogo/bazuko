// src/world/bogota/EastBuildings.js
// Casas del oriente: coloniales en la Candelaria, de ladrillo y estilo inglés en Chapinero, con locales
// en la calle comercial. Paredes, tejados y detalles van dentro de BuildingVisibility para que la vista
// isométrica los recorte como al resto de la ciudad; todas comparten materiales.
import * as THREE from 'three';
import { rng } from './textures.js';
import { createBuildingShell } from './BuildingVisibility.js';
import { Batch, ALL_FACES, NO_BACK, SKIN, FACES, shellBox, wallStripUV, brickUV } from './ZoneGeometry.js';
import { CANDELARIA_END_Z, COMMERCIAL_STREET, eastBlocks, inChurch, inTowerLot } from './EastZones.js';
import { WALL_STRIP_COUNT, WALL_SHEET, RED_BRICK_METERS, detailRect } from './ZoneTextures.js';
import { clayRidge, claySlope } from './EastRoofTiles.js';

const T = 2;
const WALKABLE = new Set(['road', 'busway', 'sidewalk', 'dirt', 'grass', 'plaza', 'floor']);
const SIDEWALK_Y = .12;
const seedOf = (a, b, c = 0) => (Math.imul(a + 17, 73856093) ^ Math.imul(b + 31, 19349663) ^ Math.imul(c + 7, 83492791)) >>> 0;
// Caras de Three a izquierda y derecha del frente, en el eje u de Batch.frame.
const SIDE_FACES = { 0: [4, 5], 1: [5, 4], 4: [1, 0], 5: [0, 1] };

function openFraction(map, { x0, x1, z0, z1 }, face) {
  let open = 0;
  if (face === 0 || face === 1) {
    const x = face === 0 ? x1 + 1 : x0 - 1;
    for (let z = z0; z <= z1; z++) if (WALKABLE.has(map[z]?.[x])) open++;
    return open / (z1 - z0 + 1);
  }
  const row = map[face === 4 ? z1 + 1 : z0 - 1];
  for (let x = x0; x <= x1; x++) if (WALKABLE.has(row?.[x])) open++;
  return open / (x1 - x0 + 1);
}

/** Lotes de cada manzana: las esquinas quedan con su frente a la carrera cuando la manzana es ancha. */
export function planEastLots(map) {
  const lots = [], patios = [];
  for (const block of eastBlocks(map)) {
    if (inChurch(block.x0, block.z0) || inTowerLot(block.x0, block.z0)) continue;
    const width = block.x1 - block.x0 + 1, rows = block.z1 - block.z0 + 1;
    if (width < 2 || rows < 2) { patios.push({ ...block }); continue; }
    const zone = block.z0 < CANDELARIA_END_Z ? 'colonial' : 'ladrillo';
    const openAt = face => openFraction(map, block, face) > .5;
    const open = { n: openAt(5), s: openAt(4), w: openAt(1), e: openAt(0) };
    const random = rng(seedOf(block.x0, block.z0, 3));
    const maxDepth = zone === 'colonial' ? 4 : 5;
    const taken = new Set();
    const addRow = (face, a0, a1, fixed, depth) => {
      if (depth < 1) return;
      // Frente de lotes a lo largo de la calle, con anchos propios de cada barrio.
      let a = a0, previous = -1;
      while (a <= a1) {
        const min = zone === 'colonial' ? 3 : 5, spread = zone === 'colonial' ? 3 : 4;
        let span = Math.min(a1 - a + 1, min + Math.floor(random() * spread));
        if (a1 - a + 1 - span > 0 && a1 - a + 1 - span < 2) span = a1 - a + 1;
        const alongX = face === 4 || face === 5;
        const x0 = alongX ? a : face === 1 ? fixed : fixed - depth + 1;
        const x1 = alongX ? a + span - 1 : face === 1 ? fixed + depth - 1 : fixed;
        const z0 = alongX ? (face === 5 ? fixed : fixed - depth + 1) : a;
        const z1 = alongX ? (face === 5 ? fixed + depth - 1 : fixed) : a + span - 1;
        const commercial = alongX && ((face === 4 && z1 === COMMERCIAL_STREET.z0 - 4) || (face === 5 && z0 === COMMERCIAL_STREET.z1 + 4));
        let strip = Math.floor(random() * WALL_STRIP_COUNT);
        if (strip === previous) strip = (strip + 1 + Math.floor(random() * 6)) % WALL_STRIP_COUNT;
        previous = strip;
        const lot = { x0, x1, z0, z1, face, zone, commercial, strip,
          first: a === a0, last: a + span - 1 === a1, seed: seedOf(x0, z0, face), depthTiles: depth, spanTiles: span };
        // El extremo de una fila puede dar contra otra casa perpendicular.
        lot.streetSides = SIDE_FACES[face].filter(side => openFraction(map, lot, side) === 1);
        lots.push(lot);
        for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) taken.add(`${tx},${tz}`);
        a += span;
      }
    };
    const depthEW = Math.min(maxDepth, Math.floor(width / 3));
    const wideEnough = width >= 14 && (open.e || open.w);
    let nsStart = block.x0, nsEnd = block.x1;
    if (wideEnough) {
      if (open.w) { addRow(1, block.z0, block.z1, block.x0, depthEW); nsStart += depthEW; }
      if (open.e) { addRow(0, block.z0, block.z1, block.x1, depthEW); nsEnd -= depthEW; }
    }
    const depthNS = Math.min(maxDepth + (zone === 'ladrillo' ? 1 : 0), Math.max(2, Math.floor(rows / (open.n && open.s ? 2 : 1))));
    if (nsEnd - nsStart + 1 >= 2) {
      if (open.n) addRow(5, nsStart, nsEnd, block.z0, depthNS);
      if (open.s) addRow(4, nsStart, nsEnd, block.z1, Math.min(depthNS, rows - (open.n ? depthNS : 0)));
    }
    // Lados sin frente abiertos a una calle (por ejemplo la espalda de la Carrera 5 en X 119).
    if (!wideEnough && (open.e || open.w) && !open.n && !open.s) {
      const face = open.e ? 0 : 1;
      addRow(face, block.z0, block.z1, face === 0 ? block.x1 : block.x0, Math.min(width, maxDepth));
    }
    // Manzana angosta: el tramo central de cada costado también da a la calle, no a un patio.
    if (!wideEnough && (open.e || open.w) && rows >= 3 && (open.n || open.s)) {
      const north = open.n ? depthNS : 0, south = open.s ? Math.min(depthNS, rows - north) : 0;
      const depth = Math.floor(width / (open.e && open.w ? 2 : 1));
      if (rows - north - south >= 2) {
        if (open.e) addRow(0, block.z0 + north, block.z1 - south, block.x1, Math.min(depth, maxDepth));
        if (open.w) addRow(1, block.z0 + north, block.z1 - south, block.x0, Math.min(depth, maxDepth));
      }
    }
    // Lo que no alcanza un frente queda como patio o cubierta baja.
    for (let tz = block.z0; tz <= block.z1; tz++) {
      let tx = block.x0;
      while (tx <= block.x1) {
        if (taken.has(`${tx},${tz}`)) { tx++; continue; }
        let end = tx;
        while (end < block.x1 && !taken.has(`${end + 1},${tz}`)) end++;
        patios.push({ x0: tx, x1: end, z0: tz, z1: tz });
        tx = end + 1;
      }
    }
  }
  return { lots, patios };
}

const lotCenter = lot => ({
  cx: (lot.x0 + lot.x1) * T / 2, cz: (lot.z0 + lot.z1) * T / 2,
  sx: (lot.x1 - lot.x0 + 1) * T, sz: (lot.z1 - lot.z0 + 1) * T
});

function makeShell(cx, cz, sx, sz, height, wallUV, roofMaterial, wallMaterial, interior) {
  const geometry = shellBox(sx, height, sz, (face, w, h) => face === 2 || face === 3 ? [0, 0, w / 2, h / 2] : wallUV(face, w, h));
  return createBuildingShell(geometry, [wallMaterial, wallMaterial, roofMaterial, roofMaterial, wallMaterial, wallMaterial],
    { x: cx, z: cz, height, interiorMaterial: interior });
}

/** Viga inclinada bajo el alero: la cara de abajo y las laterales dan el sombreado del tejado. */
function slopedBeam(f, material, rect, u, w, n0, y0, n1, y1, thick) {
  const l = u - w / 2, r = u + w / 2;
  f.quad(material, [l, y0 - thick, n0], [r, y0 - thick, n0], [r, y1 - thick, n1], [l, y1 - thick, n1], rect);
  f.quad(material, [r, y0 - thick, n0], [r, y0, n0], [r, y1, n1], [r, y1 - thick, n1], rect);
  f.quad(material, [l, y1 - thick, n1], [l, y1, n1], [l, y0, n0], [l, y0 - thick, n0], rect);
  f.quad(material, [l, y0 - thick, n0], [r, y0 - thick, n0], [r, y0, n0], [l, y0, n0], rect);
}

/** Tejado a dos aguas con la cumbrera paralela a la calle y el alero de madera de verdad. */
function gableRoof(f, m, { width, depth, height, pitch, overhang, backOverhang = .2, roof, rafters = true, fascia = 'woodDark', lot, sideOverhang = 0 }) {
  const slope = Math.tan(pitch);
  const ridgeN = -depth / 2, ridgeY = height + depth / 2 * slope;
  const eaveY = height - overhang * slope, backY = height - backOverhang * slope;
  const [leftFace, rightFace] = SIDE_FACES[lot.face];
  const left = -width / 2 - (lot.streetSides.includes(leftFace) ? sideOverhang : 0);
  const right = width / 2 + (lot.streetSides.includes(rightFace) ? sideOverhang : 0);
  const backN = -depth - backOverhang;
  if (rafters) {
    claySlope(f, roof, { left, right, n: overhang, y: eaveY, ridgeN, ridgeY, phase: lot.seed });
    claySlope(f, roof, { left, right, n: backN, y: backY, ridgeN, ridgeY, phase: lot.seed >>> 8 });
  } else {
    const frontLen = Math.hypot(overhang - ridgeN, ridgeY - eaveY) / 2;
    const backLen = Math.hypot(ridgeN - backN, ridgeY - backY) / 2;
    f.quadUV(roof, [left, eaveY, overhang], [right, eaveY, overhang], [right, ridgeY, ridgeN], [left, ridgeY, ridgeN],
      [left / 2, 0, right / 2, 0, right / 2, frontLen, left / 2, frontLen]);
    f.quadUV(roof, [right, backY, backN], [left, backY, backN], [left, ridgeY, ridgeN], [right, ridgeY, ridgeN],
      [right / 2, 0, left / 2, 0, left / 2, backLen, right / 2, backLen]);
  }
  clayRidge(f, m.detail, left, right, ridgeN, ridgeY - (rafters ? .035 : .09));
  // Plafón del alero y canes de madera: lo que más se ve desde el andén.
  f.quad(m.detail, [left, eaveY - .04, overhang], [left, height - .02, 0], [right, height - .02, 0], [right, eaveY - .04, overhang], 'woodDark');
  if (rafters) {
    const count = Math.max(2, Math.round(width / .62));
    for (let i = 0; i <= count; i++) {
      slopedBeam(f, m.detail, 'woodRed', left + .1 + (right - left - .2) * i / count, .085, overhang - .04, eaveY - .03, -.01, height - .02, .11);
    }
  }
  f.box(m.detail, (left + right) / 2, eaveY - .16, overhang + .02, right - left, .17, .05, fascia, NO_BACK);
  return { ridgeY, eaveY };
}

function gableEnds(walls, material, { width, depth, height, rise, uvOf }) {
  // Hastial lateral: un triángulo por lado, parte de la pared al recortar la isométrica.
  for (const [face, wall] of walls) {
    const batch = new Batch(), f = batch.frame(face, width / 2);
    const [a0, a1, a2] = uvOf(depth, rise);
    f.tri(material, [-depth / 2, height, 0], [depth / 2, height, 0], [0, height + rise, 0], [...a0, ...a1, ...a2]);
    batch.finish(wall, { name: 'Hastial' });
  }
}

const DOORS = ['doorGreen', 'doorBlue', 'doorRed', 'doorBrown'];

/** Jardinera de barro con flores: la única nota de color vivo que no sale de la pintura de la pared. */
function flowerBox(f, m, u, y, n, width) {
  f.box(m.detail, u, y, n, width, .15, .18, 'terracotta', NO_BACK);
  f.box(m.detail, u, y + .15, n, width + .06, .05, .2, 'hedge', ALL_FACES & ~FACES.bottom & ~FACES.back);
  f.box(m.detail, u, y + .2, n, width - .02, .09, .17, 'fruit', ALL_FACES & ~FACES.bottom & ~FACES.back);
}

function windowShutters(f, m, u, y, w, h, { wood, pose, side }) {
  for (const sign of [-1, 1]) {
    if (pose > .91 && sign === side) continue;
    const hinge = u + sign * (w / 2 + .042);
    const partlyFolded = pose > .68 && pose <= .91 && sign === side;
    const end = hinge + sign * (partlyFolded ? .421 : .52);
    const near = .048, far = partlyFolded ? .33 : near;
    const a = sign < 0 ? [end, far] : [hinge, near];
    const b = sign < 0 ? [hinge, near] : [end, far];
    const P = ([x, n], height, thickness = 0) => [x, height, n + thickness];
    f.quad(m.detail, P(a, y), P(b, y), P(b, y + h), P(a, y + h), wood);
    f.quad(m.detail, P(b, y, -.038), P(a, y, -.038), P(a, y + h, -.038), P(b, y + h, -.038), wood);
    f.quad(m.detail, P(b, y), P(b, y, -.038), P(b, y + h, -.038), P(b, y + h), wood);
    f.quad(m.detail, P(a, y, -.038), P(a, y), P(a, y + h), P(a, y + h, -.038), wood);
    f.quad(m.detail, P(a, y + h), P(b, y + h), P(b, y + h, -.038), P(a, y + h, -.038), wood);
  }
}

function barredWindow(f, m, u, y, w, h, { glass, frame = 'woodDark', trim = null, bars = true, shutters = null, sill = 'stoneLight', flowers = false }) {
  if (trim) {
    for (const side of [-1, 1]) f.box(m.detail, u + side * (w / 2 + .055), y - .03, .026, .13, h + .06, .1, trim, NO_BACK);
    f.box(m.detail, u, y + h + .008, .035, w + .29, .13, .12, trim, NO_BACK);
    f.box(m.detail, u, y + h + .133, .049, w + .37, .042, .15, trim, NO_BACK);
  }
  f.panel(m.detail, u, y, .025, w, h, glass);
  // Marco de madera que sobresale del pañete y arroja sombra sobre el vidrio.
  f.box(m.detail, u - w / 2 + .03, y, .061, .078, h, .083, frame, NO_BACK);
  f.box(m.detail, u + w / 2 - .03, y, .061, .078, h, .083, frame, NO_BACK);
  f.box(m.detail, u, y + h - .03, .063, w, .082, .085, frame, NO_BACK);
  f.box(m.detail, u, y - .015, .048, w, .055, .067, frame, NO_BACK);
  // Parteluz en cruz.
  f.box(m.detail, u, y + .03, .046, .045, h - .055, .035, frame, SKIN);
  f.box(m.detail, u, y + h * .58, .047, w - .08, .05, .036, frame, SKIN | FACES.top);
  if (sill) {
    f.box(m.detail, u, y - .078, .063, w + .13, .085, .13, sill, NO_BACK);
    f.box(m.detail, u, y - .028, .079, w + .22, .036, .17, sill, NO_BACK);
  }
  if (flowers) flowerBox(f, m, u, y - .02, .16, w);
  if (bars) {
    const spacing = .15, count = Math.floor(w / spacing);
    for (let i = 1; i < count; i++) f.box(m.detail, u - w / 2 + i * w / count, y + .01, .12, .022, h - .02, .022, 'iron', SKIN);
    for (const k of [.25, .75]) f.box(m.detail, u, y + h * k, .12, w, .033, .03, 'iron', SKIN);
    for (const k of [-.27, 0, .27]) {
      const center = u + w * k, mid = y + h * .76;
      f.quad(m.detail, [center, mid - .066, .14], [center + .031, mid, .14], [center, mid + .066, .14], [center - .031, mid, .14], 'iron');
    }
  }
  if (shutters) windowShutters(f, m, u, y, w, h, shutters);
}

function transom(f, m, u, y, width, glass) {
  const radius = width / 2, rise = .24, stone = 'stoneLight';
  const arch = (angle, outside, n) => [u + (radius + outside) * Math.cos(angle), y + (rise + outside) * Math.sin(angle), n];
  const [s0, t0, s1, t1] = detailRect(glass);
  const centerU = (s0 + s1) / 2;
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI / 9, b = (i + 1) * Math.PI / 9;
    const uv = angle => [centerU + (s1 - s0) / 2 * Math.cos(angle), t0 + (t1 - t0) * Math.sin(angle)];
    f.tri(m.detail, [u, y, .043], arch(a, 0, .043), arch(b, 0, .043), [centerU, t0, ...uv(a), ...uv(b)]);
    const cap = i === 4 ? .16 : .13;
    const left = a + .012, right = b - .012;
    f.quad(m.detail, arch(left, cap, .155), arch(right, cap, .155), arch(right, -.012, .155), arch(left, -.012, .155), stone);
    f.quad(m.detail, arch(right, cap, .047), arch(left, cap, .047), arch(left, cap, .155), arch(right, cap, .155), stone);
    f.quad(m.detail, arch(left, -.012, .043), arch(right, -.012, .043), arch(right, -.012, .155), arch(left, -.012, .155), 'stoneGray');
  }
  f.box(m.detail, u, y - .025, .087, width + .28, .06, .17, 'stoneLight', NO_BACK);
  f.box(m.detail, u, y, .067, .036, rise, .04, 'iron', SKIN);
  for (const side of [-1, 1]) f.box(m.detail, u + side * radius * .54, y, .067, .023, rise * .82, .04, 'iron', SKIN);
}

function colonialDoor(f, m, u, width, height, leaf, surround) {
  const y = SIDEWALK_Y;
  f.panel(m.detail, u, y, .025, width, height, leaf);
  for (const side of [-1, 1]) {
    const jamb = u + side * (width / 2 + .068);
    f.box(m.detail, jamb, y, .064, .16, height + .015, .14, surround, NO_BACK);
    f.box(m.detail, jamb - side * .047, y, .113, .048, height, .065, surround, NO_BACK);
    f.box(m.detail, jamb, y, .09, .235, .28, .21, surround, NO_BACK);
  }
  if (surround === 'stoneLight') transom(f, m, u, y + height, width, 'glassSky');
  else {
    f.box(m.detail, u, y + height - .015, .083, width + .33, .13, .16, surround, NO_BACK);
    f.box(m.detail, u, y + height + .11, .099, width + .44, .053, .19, surround, NO_BACK);
  }
  f.box(m.detail, u, y, .14, width + .36, .07, .3, 'stoneGray', NO_BACK);
}

function colonialPlinth(f, m, left, right, strip, uShift, wallWidth) {
  const w = right - left;
  if (w < .06) return;
  const u = (left + right) / 2, from = uShift + (left + wallWidth / 2) / WALL_SHEET.uMeters;
  const paint = (w, h) => wallStripUV(strip, from, w, h, SIDEWALK_Y);
  f.box(m.wall, u, SIDEWALK_Y, .019, w, .704, .057, paint, NO_BACK);
  f.box(m.detail, u, SIDEWALK_Y, .034, w, .15, .08, 'stoneGray', NO_BACK);
}

function woodBalcony(f, m, u, width, y, wood, flowers = false) {
  // Baranda tallada: dos largueros, balaustres y canes bajo la losa.
  const depth = .78, n = depth / 2, rail = wood;
  f.box(m.detail, u, y - .1, n, width, .11, depth, rail, ALL_FACES & ~FACES.back);
  const corbels = Math.max(2, Math.round(width / .9));
  for (let i = 0; i <= corbels; i++) {
    const cu = u - width / 2 + .08 + (width - .16) * i / corbels;
    f.box(m.detail, cu, y - .34, .3, .12, .22, .6, wood, NO_BACK);
    f.box(m.detail, cu, y - .52, .17, .12, .18, .34, wood, NO_BACK);
  }
  f.box(m.detail, u, y + .94, depth - .04, width, .07, .1, rail, ALL_FACES & ~FACES.back);
  f.box(m.detail, u, y + .08, depth - .04, width, .06, .07, rail, NO_BACK);
  for (const side of [-1, 1]) {
    f.box(m.detail, u + side * (width / 2 - .05), y, n, .09, 1, depth - .02, rail, FACES.top);
    f.box(m.detail, u + side * (width / 2 - .05), y, depth - .05, .1, 1.02, .1, rail, NO_BACK);
    // Baranda lateral del balcón hacia la pared.
    f.box(m.detail, u + side * (width / 2 - .05), y + .94, n, .06, .07, depth - .08, rail, SKIN | FACES.top);
  }
  // Colgada por fuera de la baranda, como se riega desde adentro.
  if (flowers) flowerBox(f, m, u + (width > 2 ? -width / 4 : 0), y + .68, depth + .1, Math.min(1.1, width * .45));
  const count = Math.floor(width / .17);
  for (let i = 1; i < count; i++) {
    const bu = u - width / 2 + i * width / count;
    // Balaustre torneado: dos tramos de sección distinta bastan para leerlo como madera tallada.
    f.box(m.detail, bu, y + .13, depth - .04, .05, .28, .05, wood, SKIN);
    f.box(m.detail, bu, y + .41, depth - .04, .032, .23, .032, wood, SKIN);
    f.box(m.detail, bu, y + .64, depth - .04, .05, .3, .05, wood, SKIN);
  }
}

/** Balcón de gabinete con antepecho de madera y vidrios en tres caras. */
function cabinetBalcony(f, m, u, width, y, wood, flowers) {
  const left = u - width / 2, right = u + width / 2, front = .69;
  const count = Math.max(3, Math.round(width / .62)), pane = width / count;
  const windowY = y + .8, top = y + 2.19, h = top - windowY;
  f.box(m.detail, u, y - .13, front / 2, width + .08, .145, front + .07, wood, NO_BACK);
  f.box(m.detail, u, y + .01, front / 2, width, .78, front, wood, SKIN);
  for (let i = 0; i < count; i++) {
    const center = left + pane * (i + .5), glass = i % 4 === 1 ? 'glassCurtain' : 'glassSky';
    f.panel(m.detail, center, windowY, front, pane, h, glass);
    f.box(m.detail, center, y + .14, front + .005, pane - .14, .51, .038, 'woodDark', NO_BACK);
    f.box(m.detail, center, windowY + h * .66, front + .013, pane, .045, .06, wood, NO_BACK);
    f.box(m.detail, center - pane / 2, y + .02, front + .015, .09, top - y, .1, wood, NO_BACK);
  }
  for (const side of [-1, 1]) {
    const edge = u + side * width / 2, a = side > 0 ? front : .03, b = side > 0 ? .03 : front;
    f.quad(m.detail, [edge, windowY, a], [edge, windowY, b], [edge, top, b], [edge, top, a], 'glassDark');
    f.box(m.detail, edge, windowY + h * .66, front / 2, .052, .047, front, wood, NO_BACK);
    f.box(m.detail, edge, y, front - .01, .092, top - y, .11, wood, NO_BACK);
  }
  f.box(m.detail, u, windowY - .055, front - .016, width + .1, .08, .13, wood, NO_BACK);
  f.box(m.detail, u, top - .06, front / 2, width + .14, .12, front + .14, wood, NO_BACK);
  f.quadUV(m.clay, [left - .12, top + .055, front + .115], [right + .12, top + .055, front + .115],
    [right + .12, top + .26, .02], [left - .12, top + .26, .02], [0, 0, width / 2, 0, width / 2, .42, 0, .42]);
  if (flowers) flowerBox(f, m, u - width * .31, y + .73, front + .12, Math.min(1.15, pane * 1.6));
}

/** Farol colonial en ménsula: se devuelve la posición de su luz, que administra el grupo de luces local. */
function wallLantern(f, m, u, y) {
  f.box(m.detail, u, y + .3, .24, .05, .05, .48, 'iron', NO_BACK);
  f.box(m.detail, u, y + .22, .44, .02, .1, .02, 'iron', SKIN);
  const n = .44;
  f.box(m.detail, u, y - .22, n, .2, .3, .2, 'lampGlass', ALL_FACES & ~FACES.bottom);
  for (const [du, dn] of [[-.1, .1], [.1, .1], [-.1, -.1], [.1, -.1]]) f.box(m.detail, u + du, y - .23, n + dn, .024, .32, .024, 'iron', SKIN);
  f.box(m.detail, u, y + .08, n, .27, .05, .27, 'iron', ALL_FACES);
  f.box(m.detail, u, y + .13, n, .12, .07, .12, 'iron', ALL_FACES & ~FACES.bottom);
  f.box(m.detail, u, y - .27, n, .16, .05, .16, 'iron', ALL_FACES);
}

export function buildColonialHouse(lot, m, muralRects) {
  const random = rng(lot.seed);
  const { cx, cz, sx, sz } = lotCenter(lot);
  const alongX = lot.face === 4 || lot.face === 5;
  const width = alongX ? sx : sz, depth = alongX ? sz : sx;
  const floors = width < 7 && random() < .4 ? 1 : random() < .42 ? 1 : 2;
  const height = floors === 1 ? 3.3 + random() * .55 : 6.25 + random() * .4;
  const strip = lot.strip, uShift = random();
  const shell = makeShell(cx, cz, sx, sz, height, (face, w, h) => wallStripUV(strip, uShift, w, h), m.clay, m.wall, m.interior);
  const wallGroup = shell.walls.get(lot.face);
  const facade = new Batch(), f = facade.frame(lot.face, depth / 2);
  const bays = Math.max(1, Math.floor(width / 2.35));
  const bayWidth = width / bays;
  const doorBay = bays === 1 ? 0 : Math.floor(random() * bays);
  const whitewashed = strip !== 0 && strip !== 5;
  const trim = whitewashed && random() < .6 ? 'plasterWhite' : null;
  const leaf = DOORS[Math.floor(random() * DOORS.length)];
  const surround = random() < .4 ? 'stoneLight' : random() < .5 ? 'woodDark' : 'whiteTrim';
  const shutter = random() < .28 ? ['shutterGreen', 'shutterBlue', 'shutterBrown'][Math.floor(random() * 3)] : null;
  const paintedShutter = shutter ?? (strip % 3 === 1 ? 'shutterBlue' : strip % 3 === 2 ? 'shutterGreen' : null);
  const shutterPose = (bay, floor) => {
    if (bayWidth <= 2.3 || !paintedShutter) return null;
    const pick = rng((lot.seed ^ Math.imul(bay + 4 * floor + 1, 0x21c9b7)) >>> 0);
    return { wood: paintedShutter, pose: pick(), side: pick() < .5 ? -1 : 1 };
  };
  const wood = strip === 3 || strip === 7 || strip === 1 ? 'woodLight' : 'woodDark';
  const glassFor = () => {
    const x = random();
    return x < .2 ? 'glassLit' : x < .36 ? 'glassCurtain' : x < .54 ? 'glassDark' : 'glassSky';
  };
  const lantern = random() < .34;
  for (let bay = 0; bay < bays; bay++) {
    const u = -width / 2 + bayWidth * (bay + .5);
    if (bay === doorBay) {
      const wide = bayWidth > 2.8 && random() < .55;
      const doorWidth = wide ? 1.75 : 1.14, half = doorWidth / 2 + .19;
      colonialDoor(f, m, u, doorWidth, floors === 1 ? 2.3 : 2.42, wide ? 'doorBrown' : leaf, surround);
      colonialPlinth(f, m, -width / 2, u - half, strip, uShift, width);
      colonialPlinth(f, m, u + half, width / 2, strip, uShift, width);
    } else {
      barredWindow(f, m, u, 1.02, Math.min(1.05, bayWidth - .75), 1.34, { glass: glassFor(), frame: wood, trim, bars: true, shutters: shutterPose(bay, 0) });
    }
  }
  if (floors === 2) {
    const hasBalcony = random() < .72 && width >= 4.5;
    const span = hasBalcony ? Math.max(2, Math.min(bays, 1 + Math.floor(random() * (bays + 1)))) : 0;
    const start = hasBalcony ? Math.floor(random() * (bays - span + 1)) : 0;
    for (let bay = 0; bay < bays; bay++) {
      const u = -width / 2 + bayWidth * (bay + .5);
      const inBalcony = hasBalcony && bay >= start && bay < start + span;
      if (inBalcony) {
        // Puertaventana del balcón: dos hojas de madera, abiertas o entornadas.
        const w = Math.min(1.1, bayWidth - .5), y = 3.42, h = 2.1;
        f.panel(m.detail, u, y, .025, w, h, glassFor());
        f.box(m.detail, u - w / 2 + .03, y, .05, .06, h, .07, 'woodDark', NO_BACK);
        f.box(m.detail, u + w / 2 - .03, y, .05, .06, h, .07, 'woodDark', NO_BACK);
        f.box(m.detail, u, y + h - .03, .05, w + .1, .08, .07, 'woodDark', NO_BACK);
        f.panel(m.detail, u, y + .03, .04, .04, h - .06, 'woodDark');
        for (const side of [-1, 1]) if (random() < .7) f.box(m.detail, u + side * (w / 2 + .24), y, .04, .46, h, .04, shutter ?? 'woodRed', FACES.front | FACES.left | FACES.right);
      } else {
        const bars = random() < .5;
        barredWindow(f, m, u, 3.84, Math.min(1.05, bayWidth - .7), 1.46, { glass: glassFor(), frame: wood, trim, bars, shutters: shutterPose(bay, 1), flowers: !bars && random() < .45 });
      }
    }
    if (hasBalcony) {
      const u = -width / 2 + bayWidth * (start + span / 2);
      const rail = random() < .6 ? 'woodRed' : 'woodDark', flowers = random() < .55;
      if (lot.seed % 5 === 0) cabinetBalcony(f, m, u, bayWidth * span - .22, 3.36, rail, flowers);
      else woodBalcony(f, m, u, bayWidth * span - .22, 3.36, rail, flowers);
    }
  }
  const lanternAt = lantern ? -width / 2 + bayWidth * (doorBay + .5) + (doorBay < bays - 1 || bays === 1 ? bayWidth * .5 : -bayWidth * .5) : null;
  if (lantern) wallLantern(f, m, Math.max(-width / 2 + .3, Math.min(width / 2 - .3, lanternAt)), Math.min(height - .95, 2.9));
  facade.finish(wallGroup, { name: 'Fachada colonial', visualOnly: [m.wall, m.clay] });

  const roofBatch = new Batch(), rf = roofBatch.frame(lot.face, depth / 2);
  const pitch = THREE.MathUtils.degToRad(25 + random() * 6), overhang = .74;
  const { ridgeY } = gableRoof(rf, m, { width, depth, height, pitch, overhang, roof: m.clay, lot, sideOverhang: .18 });
  if (random() < .22) {
    // Chimenea de cocina vieja, sobre el agua trasera.
    rf.box(m.detail, (random() - .5) * width * .6, ridgeY - .9, -depth * .72, .55, 1.5, .55, 'plasterCream', ALL_FACES & ~FACES.bottom);
  }
  roofBatch.finish(shell.roof, { name: 'Tejado colonial' });

  const rise = depth / 2 * Math.tan(pitch);
  const stripHeight = 1 / WALL_SHEET.strips, vStart = (strip + 1.2 / WALL_SHEET.stripMeters) * stripHeight;
  const sides = SIDE_FACES[lot.face].map(face => [face, shell.walls.get(face)]);
  gableEnds(sides, m.wall, { width, depth, height, rise, uvOf: (d, r) => [
    [uShift, vStart], [uShift + d / WALL_SHEET.uMeters, vStart], [uShift + d / 2 / WALL_SHEET.uMeters, vStart + r / WALL_SHEET.stripMeters * stripHeight]
  ] });
  for (const face of lot.streetSides) {
    const side = new Batch();
    colonialPlinth(side.frame(face, width / 2), m, -depth / 2, depth / 2, strip, uShift, depth);
    side.finish(shell.walls.get(face), { name: 'Zócalo colonial', visualOnly: true });
  }
  if (lot.streetSides.length && random() < .55 && muralRects?.length) {
    // Mural en la culata de la esquina; abstracto o inventado, nunca una marca.
    const face = lot.streetSides[Math.floor(random() * lot.streetSides.length)];
    const mural = new Batch(), mf = mural.frame(face, width / 2);
    const rect = muralRects[Math.floor(random() * muralRects.length)];
    const w = Math.min(depth - 1, 5.4), h = Math.min(height - 1.15, w * .82);
    mf.panel(m.mural, 0, 1.05, .03, w, h, rect);
    mural.finish(shell.walls.get(face), { name: 'Mural de culata', castShadow: false });
  }
  const lanternWorld = lantern ? lanternPosition(lot, depth, cx, cz, lanternAt, Math.min(height - .95, 2.9)) : null;
  return { shell, height, lantern: lanternWorld };
}

function lanternPosition(lot, depth, cx, cz, u, y) {
  const n = depth / 2 + .44;
  const basis = { 0: [0, -1, 1, 0], 1: [0, 1, -1, 0], 4: [1, 0, 0, 1], 5: [-1, 0, 0, -1] }[lot.face];
  return new THREE.Vector3(cx + basis[0] * u + basis[2] * n, y - .15, cz + basis[1] * u + basis[3] * n);
}

const metricBrick = (w, h) => brickUV(0, w, h);

function brickFace(f, material, a, b, c, d) {
  const width = Math.hypot(b[0] - a[0], b[2] - a[2]), height = d[1] - a[1];
  const [, , u, v] = metricBrick(width, height);
  f.quadUV(material, a, b, c, d, [0, 0, u, 0, u, v, 0, v]);
}

function brickLintel(f, m, u, y, width) {
  const count = Math.max(5, Math.round(width / .116)), pitch = width / count;
  // Sardinel: ladrillos puestos de canto con su propia junta, sobre el borde del vano.
  f.box(m.detail, u, y, .059, width, .17, .112, 'stoneGray', NO_BACK);
  for (let i = 0; i < count; i++) {
    const a = u - width / 2 + pitch * i + .005, b = a + pitch - .01;
    const col = (i * 3) % 8, row = (i * 5) % 24;
    const s = (col + .15 + ((23 - row) % 2) / 2) / 8, t = (row + .13) / 24, ds = .76 / 8, dt = .76 / 24;
    f.quadUV(m.brick, [a, y + .005, .121], [b, y + .005, .121], [b, y + .165, .121], [a, y + .165, .121],
      [s, t + dt, s, t, s + ds, t, s + ds, t + dt]);
  }
}

function sashWindow(f, m, u, y, w, h, glass, brickHeader = false) {
  // Ventana inglesa de guillotina, con marco blanco y dintel de piedra.
  f.panel(m.detail, u, y, .03, w, h, glass);
  f.box(m.detail, u - w / 2, y - .02, .05, .08, h + .04, .08, 'whiteTrim', NO_BACK);
  f.box(m.detail, u + w / 2, y - .02, .05, .08, h + .04, .08, 'whiteTrim', NO_BACK);
  f.box(m.detail, u, y + h, .05, w + .08, .08, .08, 'whiteTrim', NO_BACK);
  f.box(m.detail, u, y - .09, .08, w + .26, .08, .15, 'stoneLight', NO_BACK);
  if (brickHeader) {
    brickLintel(f, m, u, y + h + .078, w + .31);
    f.box(m.detail, u, y - .12, .052, w + .09, .057, .12, 'stoneGray', NO_BACK);
  } else f.box(m.detail, u, y + h + .08, .05, w + .28, .16, .08, 'stoneLight', NO_BACK);
  f.panel(m.detail, u, y + h * .5, .05, w, .05, 'whiteTrim');
  f.panel(m.detail, u, y, .05, .035, h, 'whiteTrim');
  for (const k of [.25, .75]) f.panel(m.detail, u, y + h * k, .046, w, .025, 'whiteTrim');
}

function bayWindow(f, m, u, y, w, h, glass, projection) {
  // Los tres paños de la ventana se apoyan en un basamento con la misma planta achaflanada.
  const inner = w / 2 - Math.min(.48, w * .21), top = y + h;
  const footprint = [[-w / 2, .017], [-inner, projection], [inner, projection], [w / 2, .017]];
  const edge = footprint.map(([x, n], i) => [x + (i < 2 ? -.044 : .044), n + .06]);
  const P = ([x, n], height) => [u + x, height, n];
  for (let i = 0; i < 3; i++) {
    const a = footprint[i], b = footprint[i + 1], l = edge[i], r = edge[i + 1];
    brickFace(f, m.brick, P(a, SIDEWALK_Y), P(b, SIDEWALK_Y), P(b, y), P(a, y));
    f.quad(m.detail, P(a, y), P(b, y), P(b, top), P(a, top), glass);
    for (const [height, thick, material] of [[y - .063, .078, 'stoneLight'], [y + h * .7, .052, 'whiteTrim'], [top, .09, 'whiteTrim']]) {
      f.quad(m.detail, P(l, height), P(r, height), P(r, height + thick), P(l, height + thick), material);
      f.quad(m.detail, P(l, height + thick), P(r, height + thick), P(b, height + thick), P(a, height + thick), material);
    }
  }
  for (const [x, n] of [...footprint, [0, projection]]) {
    f.box(m.detail, u + x, y, n + .015, .077, h + .043, .081, 'whiteTrim', NO_BACK);
  }
  // Un faldón de teja en el centro y otro en cada chaflán, por encima del marco superior.
  const [l, al, ar, r] = edge, crestY = top + .36;
  const c0 = [-inner * .86, .008], c1 = [inner * .86, .008];
  f.quadUV(m.clayDark, P(al, top + .09), P(ar, top + .09), P(c1, crestY), P(c0, crestY), [0, 0, inner, 0, inner, .39, 0, .39]);
  f.tri(m.clayDark, P(l, top + .09), P(al, top + .09), P(c0, crestY), [0, 0, .34, 0, .15, .39]);
  f.tri(m.clayDark, P(ar, top + .09), P(r, top + .09), P(c1, crestY), [0, 0, .34, 0, .15, .39]);
}

function gableBoard(f, m, ax, ay, bx, by, n, width, texture) {
  const length = Math.hypot(bx - ax, by - ay), x = (ay - by) * width / length / 2, y = (bx - ax) * width / length / 2;
  const a = [ax + x, ay + y, n], b = [ax - x, ay - y, n], c = [bx - x, by - y, n], d = [bx + x, by + y, n];
  f.quad(m.detail, a, b, c, d, texture);
  f.quad(m.detail, [a[0], a[1], n - .045], a, d, [d[0], d[1], n - .045], texture);
  f.quad(m.detail, b, [b[0], b[1], n - .045], [c[0], c[1], n - .045], c, texture);
}

function wingGable(f, m, u, y, w, top, n, timber) {
  const l = u - w / 2, r = u + w / 2;
  if (timber) {
    const [s, t, su, tv] = detailRect('plasterCream');
    f.tri(m.detail, [l, y, n], [r, y, n], [u, top, n], [s, t, su, t, (s + su) / 2, tv]);
    gableBoard(f, m, l + .075, y + .08, r - .075, y + .08, n + .055, .13, 'woodDark');
    gableBoard(f, m, u, y + .1, u, top - .12, n + .062, .13, 'woodDark');
    for (const side of [-1, 1]) {
      gableBoard(f, m, u + side * w * .42, y + .1, u, top - .16, n + .051, .106, 'woodDark');
      gableBoard(f, m, u + side * w * .23, y + .11, u + side * w * .23, y + (top - y) * .47 - .07, n + .058, .1, 'woodDark');
    }
  } else {
    const [s, t, su, tv] = brickUV(0, w, top - y);
    f.tri(m.brick, [l, y, n], [r, y, n], [u, top, n], [s, t, su, t, (s + su) / 2, tv]);
    f.box(m.detail, u, y + .035, n + .018, w - .055, .11, .08, 'stoneLight', NO_BACK);
    const ventY = y + (top - y) * .32, ventW = Math.min(.54, w * .3);
    f.box(m.detail, u, ventY, n + .038, ventW, .36, .065, 'whiteTrim', NO_BACK);
    f.panel(m.detail, u, ventY + .05, n + .08, ventW - .095, .26, 'woodDark');
    for (let i = 0; i < 4; i++) f.box(m.detail, u, ventY + .075 + i * .058, n + .08, ventW - .09, .019, .06, 'whiteTrim', NO_BACK);
  }
}

/** Casa de ladrillo de estilo inglés, con hastial saliente, antejardín y reja. */
export function buildEnglishHouse(lot, m) {
  const random = rng(lot.seed);
  const { cx, cz, sx, sz } = lotCenter(lot);
  const alongX = lot.face === 4 || lot.face === 5;
  const fullWidth = alongX ? sx : sz, fullDepth = alongX ? sz : sx;
  // El antejardín está dentro del lote: la reja queda justo en el límite de la colisión.
  const garden = fullDepth >= 8 ? 2 : 1.2;
  const depth = fullDepth - garden;
  const [fx, fz] = { 0: [1, 0], 1: [-1, 0], 4: [0, 1], 5: [0, -1] }[lot.face];
  const houseX = cx - fx * garden / 2, houseZ = cz - fz * garden / 2;
  const houseSX = alongX ? sx : depth, houseSZ = alongX ? depth : sz;
  const height = 5.9 + random() * .5;
  const shell = makeShell(houseX, houseZ, houseSX, houseSZ, height, (face, w, h) => brickUV(random() * .3, w, h), m.clayDark, m.brick, m.interior);
  const facade = new Batch(), f = facade.frame(lot.face, depth / 2);
  const width = fullWidth;
  const wingWidth = Math.min(width * .46, 5);
  const wingSide = random() < .5 ? -1 : 1;
  const wingU = wingSide * (width / 2 - wingWidth / 2 - .25);
  const project = Math.min(garden - .35, 1);
  // Ala saliente: su hastial es lo que hace inglesa a la casa.
  const pitchWing = THREE.MathUtils.degToRad(46), riseWing = (wingWidth / 2 + .28) * Math.tan(pitchWing);
  const wl = wingU - wingWidth / 2, wr = wingU + wingWidth / 2;
  brickFace(f, m.brick, [wl, 0, project], [wr, 0, project], [wr, height, project], [wl, height, project]);
  brickFace(f, m.brick, [wr, 0, project], [wr, 0, 0], [wr, height, 0], [wr, height, project]);
  brickFace(f, m.brick, [wl, 0, 0], [wl, 0, project], [wl, height, project], [wl, height, 0]);
  // Banda de piedra entre pisos y zócalo oscuro: rompen el paño de ladrillo.
  f.box(m.detail, wingU, 3.0, project + .015, wingWidth + .03, .12, .05, 'stoneLight', NO_BACK);
  f.box(m.detail, 0, 0, .019, width, .49, .049, 'stoneGray', FACES.front | FACES.top);
  f.box(m.detail, wingU, 0, project * .5, wingWidth + .046, .49, project + .049, 'stoneGray', NO_BACK);
  f.box(m.detail, wingU, .46, project * .5, wingWidth + .092, .038, project + .095, 'stoneLight', NO_BACK);
  // Hastiales de entramado y de ladrillo visto, según el solar.
  const apexY = height + riseWing - .28 * Math.tan(pitchWing);
  wingGable(f, m, wingU, height, wingWidth, apexY, project + .012, (lot.seed >>> 4) % 4 !== 0);
  // Bay window bajo el hastial y dos ventanas arriba.
  const glassChoices = () => { const x = random(); return x < .24 ? 'glassLit' : x < .4 ? 'glassCurtain' : x < .57 ? 'glassDark' : 'glassSky'; };
  const brickHeader = (lot.seed & 3) !== 0;
  const bayW = Math.min(wingWidth - .7, 2.9);
  // Ventana en saliente: desde el ala hacia afuera sin salirse del antejardín.
  const bayFrame = facade.frame(lot.face, depth / 2 + project);
  bayWindow(bayFrame, m, wingU, .92, bayW, 1.82, glassChoices(), Math.min(.68, garden - project - .09));
  const upperCount = wingWidth > 3.6 ? 2 : 1;
  for (let i = 0; i < upperCount; i++) {
    const u = wingU + (upperCount === 1 ? 0 : (i - .5) * 1.7);
    sashWindow(bayFrame, m, u, 3.42, 1.05, 1.66, glassChoices(), brickHeader);
  }
  // Resto de la fachada: puerta con techito y ventanas de guillotina.
  const restLeft = wingSide > 0 ? -width / 2 : wr, restRight = wingSide > 0 ? wl : width / 2;
  const restWidth = restRight - restLeft, restCenter = (restLeft + restRight) / 2;
  const doorU = restCenter + (restWidth > 3.6 ? -wingSide * .8 : 0);
  const leaf = DOORS[Math.floor(random() * DOORS.length)];
  f.panel(m.detail, doorU, SIDEWALK_Y + .1, .03, 1.08, 2.26, leaf);
  f.box(m.detail, doorU - .62, SIDEWALK_Y, .06, .15, 2.48, .1, 'whiteTrim', NO_BACK);
  f.box(m.detail, doorU + .62, SIDEWALK_Y, .06, .15, 2.48, .1, 'whiteTrim', NO_BACK);
  f.box(m.detail, doorU, SIDEWALK_Y, .3, 1.6, .1, .62, 'stoneLight', ALL_FACES & ~FACES.bottom & ~FACES.back);
  // Tejadillo de la entrada sobre dos pies derechos.
  f.box(m.detail, doorU, 2.66, .44, 1.8, .1, .95, 'whiteTrim', ALL_FACES);
  f.quadUV(m.clayDark, [doorU - .95, 2.76, .95], [doorU + .95, 2.76, .95], [doorU + .95, 3.28, 0], [doorU - .95, 3.28, 0],
    [0, 0, .95, 0, .95, .54, 0, .54]);
  for (const side of [-1, 1]) f.box(m.detail, doorU + side * .78, SIDEWALK_Y, .84, .09, 2.56, .09, 'whiteTrim', NO_BACK);
  if (restWidth > 3.6) sashWindow(f, m, doorU + wingSide * 1.9, 1.04, 1.1, 1.62, glassChoices(), brickHeader);
  const upper = Math.max(1, Math.floor(restWidth / 2.1));
  for (let i = 0; i < upper; i++) {
    sashWindow(f, m, restLeft + restWidth * (i + .5) / upper, 3.42, 1.05, 1.62, glassChoices(), brickHeader);
  }
  // Banda entre pisos en el cuerpo principal.
  f.box(m.detail, restCenter, 3.0, .03, restWidth, .12, .06, 'stoneLight', NO_BACK);
  facade.finish(shell.walls.get(lot.face), { name: 'Fachada inglesa', visualOnly: [m.clayDark] });

  // Ventanas laterales si la casa queda en esquina; lo demás es medianera.
  for (const face of lot.streetSides) {
    const side = new Batch(), sf = side.frame(face, width / 2);
    const count = Math.max(1, Math.floor(depth / 3.6));
    for (let i = 0; i < count; i++) {
      const u = -depth / 2 + depth * (i + .5) / count;
      sashWindow(sf, m, u, 1.04, 1, 1.5, glassChoices(), brickHeader);
      sashWindow(sf, m, u, 3.42, 1, 1.5, glassChoices(), brickHeader);
    }
    side.finish(shell.walls.get(face), { name: 'Lateral inglés', visualOnly: [m.brick] });
  }

  const roof = new Batch(), rf = roof.frame(lot.face, depth / 2);
  const pitch = THREE.MathUtils.degToRad(38 + random() * 6);
  const { ridgeY } = gableRoof(rf, m, { width, depth, height, pitch, overhang: .42, roof: m.clayDark,
    rafters: false, fascia: 'whiteTrim', lot, sideOverhang: .25 });
  // Aguas del ala: cruzan el tejado principal hasta enterrarse en él.
  const wingRidge = apexY;
  const backN = -Math.max(1.2, (wingRidge - height) / Math.tan(pitch) + .2);
  const eaveW = wingWidth / 2 + .28, eaveY = height - .28 * Math.tan(pitchWing), frontN = project + .3;
  const slopeLength = Math.hypot(eaveW, wingRidge - eaveY);
  const run = (frontN - backN) / 2, slopeUV = slopeLength / 2;
  rf.quadUV(m.clayDark, [wingU + eaveW, eaveY, frontN], [wingU, wingRidge, frontN], [wingU, wingRidge, backN], [wingU + eaveW, eaveY, backN],
    [0, 0, 0, slopeUV, run, slopeUV, run, 0]);
  rf.quadUV(m.clayDark, [wingU, wingRidge, frontN], [wingU - eaveW, eaveY, frontN], [wingU - eaveW, eaveY, backN], [wingU, wingRidge, backN],
    [0, slopeUV, 0, 0, run, 0, run, slopeUV]);
  // Tablas de borde del hastial, blancas como en las casas de esa época.
  for (const s of [-1, 1]) {
    const edge = wingU + s * eaveW;
    gableBoard(rf, m, edge, eaveY - .115, wingU, wingRidge - .115, frontN + .024, .17, 'whiteTrim');
  }
  clayRidge(rf, m.detail, -frontN, -backN, wingU, wingRidge - .075, { perpendicular: true, width: .32 });
  // Chimenea de ladrillo a un costado.
  const chimneyU = -wingSide * (width / 2 - 1.1), chimneyTop = ridgeY + 1.1;
  rf.box(m.brick, chimneyU, height - .3, -depth * .42, .95, chimneyTop - height + .3, .62, metricBrick, ALL_FACES & ~FACES.bottom);
  rf.box(m.brick, chimneyU, chimneyTop - .23, -depth * .42, 1.02, .1, .7, metricBrick, ALL_FACES);
  rf.box(m.brick, chimneyU, chimneyTop - .13, -depth * .42, 1.06, .13, .73, metricBrick, ALL_FACES);
  rf.box(m.detail, chimneyU, chimneyTop, -depth * .42, 1.08, .12, .75, 'stoneLight', ALL_FACES);
  for (const k of [-.2, .2]) {
    rf.box(m.detail, chimneyU + k, chimneyTop + .12, -depth * .42, .18, .32, .18, 'terracotta', ALL_FACES & ~FACES.bottom);
    rf.box(m.detail, chimneyU + k, chimneyTop + .4, -depth * .42, .22, .049, .22, 'terracotta', ALL_FACES);
    rf.box(m.detail, chimneyU + k, chimneyTop + .449, -depth * .42, .11, .002, .11, 'woodDark', FACES.top);
  }
  roof.finish(shell.roof, { name: 'Tejado inglés', visualOnly: [m.brick] });

  const rise = depth / 2 * Math.tan(pitch);
  gableEnds(SIDE_FACES[lot.face].map(face => [face, shell.walls.get(face)]), m.brick, { width, depth, height, rise, uvOf: (d, r) => [
    [0, height / RED_BRICK_METERS], [d / RED_BRICK_METERS, height / RED_BRICK_METERS], [d / 2 / RED_BRICK_METERS, (height + r) / RED_BRICK_METERS]
  ] });

  // Antejardín: pasto, camino, seto, muro bajo y reja. Queda en la base: no se recorta.
  // El marco del antejardín sigue centrado en la casa: la reja queda a un antejardín de su pared.
  const yard = new Batch(), y = yard.frame(lot.face, depth / 2 + garden);
  const G = -garden; // Del plano de la reja hacia la casa.
  y.quad(m.detail, [-width / 2, .13, 0], [width / 2, .13, 0], [width / 2, .13, G], [-width / 2, .13, G], 'grass');
  const pathU = doorU;
  y.quad(m.detail, [pathU - .55, .15, 0], [pathU + .55, .15, 0], [pathU + .55, .15, G], [pathU - .55, .15, G], 'stoneLight');
  const hedgeHeight = .72 + random() * .28;
  for (const [a, b] of [[-width / 2, pathU - .75], [pathU + .75, width / 2]]) {
    if (b - a < .3) continue;
    const mid = (a + b) / 2, len = b - a;
    y.box(m.detail, mid, .1, -.5, len, hedgeHeight, .52, 'hedge', ALL_FACES & ~FACES.bottom);
    y.box(m.brick, mid, .12, -.1, len, .52, .24, metricBrick, ALL_FACES & ~FACES.bottom);
    y.box(m.detail, mid, .64, -.1, len + .02, .07, .3, 'stoneLight', ALL_FACES & ~FACES.bottom);
    y.box(m.detail, mid, 1.56, -.1, len, .04, .04, 'iron', SKIN | FACES.top);
    y.box(m.detail, mid, .86, -.1, len, .03, .03, 'iron', SKIN);
    for (let u = a + .14; u < b - .05; u += .22) {
      y.box(m.detail, u, .7, -.1, .021, .94, .021, 'iron', SKIN | FACES.back);
      y.quad(m.detail, [u, 1.616, -.087], [u + .024, 1.645, -.087], [u, 1.71, -.087], [u - .024, 1.645, -.087], 'iron');
    }
    for (const u of [a + .12, b - .12]) {
      y.box(m.brick, u, .12, -.1, .36, 1.56, .36, metricBrick, ALL_FACES & ~FACES.bottom);
      y.box(m.detail, u, .12, -.1, .4, .17, .4, 'stoneGray', NO_BACK);
      y.box(m.detail, u, 1.68, -.1, .42, .08, .42, 'stoneLight', ALL_FACES & ~FACES.bottom);
    }
  }
  // Reja de la entrada, entreabierta.
  for (let k = .1; k < .9; k += .14) y.panel(m.detail, pathU - .75 + k * 1.5, .16, -.08, .024, 1.4, 'iron');
  y.box(m.detail, pathU, 1.5, -.08, 1.5, .04, .04, 'iron', SKIN | FACES.top);
  yard.finish(shell.base, { name: 'Antejardín', castShadow: false, visualOnly: [m.brick] });
  return { shell, height };
}

const SHOP_SIGNS = ['signTinto', 'signLibros', 'signArtes', 'signChicha', 'signBarber', 'signFlor', 'signPan', 'signPapel', 'signRopa'];
const AWNINGS = ['redStripe', 'blueStripe', 'greenTarp', 'orangeTarp'];

/** Locales de la calle comercial: ladrillo arriba, vitrina o cortina metálica y aviso inventado. */
export function buildShopHouse(lot, m) {
  const random = rng(lot.seed);
  const { cx, cz, sx, sz } = lotCenter(lot);
  const alongX = lot.face === 4 || lot.face === 5;
  const width = alongX ? sx : sz, depth = alongX ? sz : sx;
  const floors = 2 + Math.floor(random() * 2);
  const height = floors * 3.05 + .3;
  const shell = makeShell(cx, cz, sx, sz, height, (face, w, h) => brickUV(random() * .4, w, h), m.clayDark, m.brick, m.interior);
  const facade = new Batch(), f = facade.frame(lot.face, depth / 2);
  const shops = Math.max(1, Math.floor(width / 5));
  const shopWidth = width / shops;
  for (let i = 0; i < shops; i++) {
    const u = -width / 2 + shopWidth * (i + .5), w = shopWidth - .3;
    const roller = random() < .3;
    f.box(m.detail, u, SIDEWALK_Y, .012, w + .16, 2.62, .024, 'shopDark', FACES.front);
    if (roller) {
      f.panel(m.detail, u, SIDEWALK_Y, .03, w - .1, 2.5, 'rollerDoor');
    } else {
      const doorW = Math.min(1.2, w * .3), glassW = w - doorW - .1;
      f.panel(m.detail, u + doorW / 2, SIDEWALK_Y + .55, .03, glassW, 1.95, random() < .5 ? 'glassLit' : 'glassCold');
      f.box(m.detail, u + doorW / 2, SIDEWALK_Y, .03, glassW, .55, .04, 'plasterCream', FACES.front | FACES.top);
      f.panel(m.detail, u - w / 2 + doorW / 2, SIDEWALK_Y, .03, doorW, 2.5, 'glassLit');
      f.panel(m.detail, u - w / 2 + doorW + .04, SIDEWALK_Y, .05, .08, 2.5, 'iron');
    }
    // Aviso pintado y toldo de lona, cada local con su propio arreglo.
    const sign = SHOP_SIGNS[Math.floor(random() * SHOP_SIGNS.length)];
    f.box(m.detail, u, 2.72, .08, Math.min(w, 3.8), .88, .1, sign, FACES.front);
    f.box(m.detail, u, 2.72, .05, Math.min(w, 3.8) + .1, .88, .08, 'woodDark', FACES.left | FACES.right | FACES.top | FACES.bottom);
    if (random() < .7) {
      const awning = AWNINGS[Math.floor(random() * AWNINGS.length)];
      const aw = Math.min(w, 4);
      f.quad(m.detail, [u - aw / 2, 2.32, 1.2], [u + aw / 2, 2.32, 1.2], [u + aw / 2, 2.7, .05], [u - aw / 2, 2.7, .05], awning);
      f.panel(m.detail, u, 2.12, 1.2, aw, .2, awning);
    }
  }
  const bays = Math.max(1, Math.floor(width / 2.4));
  for (let floor = 1; floor < floors; floor++) {
    for (let bay = 0; bay < bays; bay++) {
      const u = -width / 2 + width * (bay + .5) / bays;
      const x = random();
      sashWindow(f, m, u, floor * 3.05 + .75, 1.1, 1.56, x < .24 ? 'glassLit' : x < .36 ? 'glassCurtain' : x < .7 ? 'glassDark' : 'glassSky');
    }
    f.box(m.detail, 0, floor * 3.05 + .22, .025, width, .1, .05, 'stoneLight', NO_BACK);
  }
  // Cornisa de remate.
  f.box(m.detail, 0, height - .34, .08, width, .1, .16, 'stoneLight', NO_BACK);
  facade.finish(shell.walls.get(lot.face), { name: 'Local comercial' });
  const roof = new Batch(), rf = roof.frame(lot.face, depth / 2);
  const pitch = THREE.MathUtils.degToRad(21);
  gableRoof(rf, m, { width, depth, height, pitch, overhang: .36, roof: m.clayDark, rafters: false, fascia: 'woodDark', lot });
  roof.finish(shell.roof, { name: 'Tejado comercial' });
  const rise = depth / 2 * Math.tan(pitch);
  gableEnds(SIDE_FACES[lot.face].map(face => [face, shell.walls.get(face)]), m.brick, { width, depth, height, rise, uvOf: (d, r) => [
    [0, 0], [d / RED_BRICK_METERS, 0], [d / 2 / RED_BRICK_METERS, r / RED_BRICK_METERS]
  ] });
  return { shell, height };
}
