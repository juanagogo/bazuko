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

const T = 2;
const WALKABLE = new Set(['road', 'busway', 'sidewalk', 'dirt', 'grass', 'plaza', 'floor']);
const SIDEWALK_Y = .12;
const seedOf = (a, b, c = 0) => (Math.imul(a + 17, 73856093) ^ Math.imul(b + 31, 19349663) ^ Math.imul(c + 7, 83492791)) >>> 0;
const sidesOf = face => (face === 4 || face === 5 ? [0, 1] : [4, 5]);

/** Lotes de cada manzana: las esquinas quedan con su frente a la carrera cuando la manzana es ancha. */
export function planEastLots(map) {
  const lots = [], patios = [];
  for (const block of eastBlocks(map)) {
    if (inChurch(block.x0, block.z0) || inTowerLot(block.x0, block.z0)) continue;
    const width = block.x1 - block.x0 + 1, rows = block.z1 - block.z0 + 1;
    if (width < 2 || rows < 2) { patios.push({ ...block }); continue; }
    const zone = block.z0 < CANDELARIA_END_Z ? 'colonial' : 'ladrillo';
    const openAt = (side) => {
      let open = 0, total = 0;
      if (side === 'n' || side === 's') for (let x = block.x0; x <= block.x1; x++) { total++; if (WALKABLE.has(map[side === 'n' ? block.z0 - 1 : block.z1 + 1]?.[x])) open++; }
      else for (let z = block.z0; z <= block.z1; z++) { total++; if (WALKABLE.has(map[z]?.[side === 'w' ? block.x0 - 1 : block.x1 + 1])) open++; }
      return open / total > .5;
    };
    const open = { n: openAt('n'), s: openAt('s'), w: openAt('w'), e: openAt('e') };
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
        lots.push({ x0, x1, z0, z1, face, zone, commercial, strip,
          first: a === a0, last: a + span - 1 === a1, seed: seedOf(x0, z0, face), depthTiles: depth, spanTiles: span });
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
function gableRoof(batch, f, m, { width, depth, height, pitch, overhang, backOverhang = .2, roof, rafters = true, fascia = 'woodDark', sideL = 0, sideR = 0 }) {
  const slope = Math.tan(pitch);
  const ridgeN = -depth / 2, ridgeY = height + depth / 2 * slope;
  const eaveY = height - overhang * slope, backY = height - backOverhang * slope;
  const left = -width / 2 - sideL, right = width / 2 + sideR;
  const frontLen = Math.hypot(depth / 2 + overhang, ridgeY - eaveY) / 2, backLen = Math.hypot(depth / 2 + backOverhang, ridgeY - backY) / 2;
  f.quadUV(roof, [left, eaveY, overhang], [right, eaveY, overhang], [right, ridgeY, ridgeN], [left, ridgeY, ridgeN],
    [left / 2, 0, right / 2, 0, right / 2, frontLen, left / 2, frontLen]);
  f.quadUV(roof, [right, backY, -depth - backOverhang], [left, backY, -depth - backOverhang], [left, ridgeY, ridgeN], [right, ridgeY, ridgeN],
    [right / 2, 0, left / 2, 0, left / 2, backLen, right / 2, backLen]);
  // Teja de cumbrera: oculta la unión de las dos aguas.
  f.box(m.detail, (left + right) / 2, ridgeY - .03, ridgeN, right - left, .11, .3, 'terracotta', ALL_FACES & ~FACES.bottom);
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

function barredWindow(f, m, u, y, w, h, { glass, frame = 'woodDark', trim = null, bars = true, shutter = null, sill = 'stoneLight', flowers = false }) {
  if (trim) f.box(m.detail, u, y - .12, .018, w + .36, h + .28, .03, trim, FACES.front);
  f.panel(m.detail, u, y, .025, w, h, glass);
  // Marco de madera que sobresale del pañete y arroja sombra sobre el vidrio.
  f.box(m.detail, u - w / 2 + .03, y, .05, .06, h, .07, frame, NO_BACK);
  f.box(m.detail, u + w / 2 - .03, y, .05, .06, h, .07, frame, NO_BACK);
  f.box(m.detail, u, y + h - .03, .05, w, .06, .07, frame, NO_BACK);
  // Parteluz en cruz.
  f.panel(m.detail, u, y + .03, .04, .035, h - .06, frame);
  f.panel(m.detail, u, y + h * .58, .04, w - .08, .035, frame);
  if (sill) f.box(m.detail, u, y - .07, .08, w + .18, .07, .16, sill, NO_BACK);
  if (flowers) flowerBox(f, m, u, y - .02, .16, w);
  if (bars) {
    const spacing = .15, count = Math.floor(w / spacing);
    for (let i = 1; i < count; i++) f.box(m.detail, u - w / 2 + i * w / count, y + .01, .12, .022, h - .02, .022, 'iron', SKIN);
    for (const k of [.25, .75]) f.box(m.detail, u, y + h * k, .12, w, .03, .03, 'iron', SKIN);
  }
  if (shutter) for (const side of [-1, 1]) {
    f.box(m.detail, u + side * (w / 2 + .3), y, .03, .52, h, .04, shutter, FACES.front | FACES.left | FACES.right);
  }
}

function colonialDoor(f, m, u, width, height, leaf, surround) {
  const y = SIDEWALK_Y;
  f.panel(m.detail, u, y, .025, width, height, leaf);
  f.box(m.detail, u - width / 2 - .07, y, .06, .15, height + .1, .1, surround, NO_BACK);
  f.box(m.detail, u + width / 2 + .07, y, .06, .15, height + .1, .1, surround, NO_BACK);
  f.box(m.detail, u, y + height + .02, .08, width + .4, .18, .14, surround, NO_BACK);
  f.box(m.detail, u, y, .14, width + .36, .07, .3, 'stoneGray', NO_BACK);
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
  const glassFor = () => {
    const x = random();
    return x < .2 ? 'glassLit' : x < .36 ? 'glassCurtain' : x < .68 ? 'glassDark' : 'glassSky';
  };
  const lantern = random() < .34;
  for (let bay = 0; bay < bays; bay++) {
    const u = -width / 2 + bayWidth * (bay + .5);
    if (bay === doorBay) {
      const wide = bayWidth > 2.8 && random() < .55;
      colonialDoor(f, m, u, wide ? 1.75 : 1.14, floors === 1 ? 2.3 : 2.42, wide ? 'doorBrown' : leaf, surround);
    } else {
      barredWindow(f, m, u, 1.02, Math.min(1.05, bayWidth - .75), 1.34, { glass: glassFor(), frame: 'woodDark', trim, bars: true, shutter: bayWidth > 2.3 ? shutter : null });
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
        barredWindow(f, m, u, 3.84, Math.min(1.05, bayWidth - .7), 1.46, { glass: glassFor(), frame: 'woodDark', trim, bars, shutter: bayWidth > 2.3 ? shutter : null, flowers: !bars && random() < .45 });
      }
    }
    if (hasBalcony) {
      const u = -width / 2 + bayWidth * (start + span / 2);
      woodBalcony(f, m, u, bayWidth * span - .22, 3.36, random() < .6 ? 'woodRed' : 'woodDark', random() < .55);
    }
  }
  const lanternAt = lantern ? -width / 2 + bayWidth * (doorBay + .5) + (doorBay < bays - 1 || bays === 1 ? bayWidth * .5 : -bayWidth * .5) : null;
  if (lantern) wallLantern(f, m, Math.max(-width / 2 + .3, Math.min(width / 2 - .3, lanternAt)), Math.min(height - .95, 2.9));
  facade.finish(wallGroup, { name: 'Fachada colonial' });

  const roofBatch = new Batch(), rf = roofBatch.frame(lot.face, depth / 2);
  const pitch = THREE.MathUtils.degToRad(25 + random() * 6), overhang = .74;
  const exposedLeft = lot.first ? .18 : 0, exposedRight = lot.last ? .18 : 0;
  const { ridgeY } = gableRoof(roofBatch, rf, m, { width, depth, height, pitch, overhang, roof: m.clay, sideL: exposedLeft, sideR: exposedRight });
  if (random() < .22) {
    // Chimenea de cocina vieja, sobre el agua trasera.
    rf.box(m.detail, (random() - .5) * width * .6, ridgeY - .9, -depth * .72, .55, 1.5, .55, 'plasterCream', ALL_FACES & ~FACES.bottom);
  }
  roofBatch.finish(shell.roof, { name: 'Tejado colonial' });

  const rise = depth / 2 * Math.tan(pitch);
  const stripHeight = 1 / WALL_SHEET.strips, vStart = (strip + 1.2 / WALL_SHEET.stripMeters) * stripHeight;
  const sides = sidesOf(lot.face).map(face => [face, shell.walls.get(face)]);
  gableEnds(sides, m.wall, { width, depth, height, rise, uvOf: (d, r) => [
    [uShift, vStart], [uShift + d / WALL_SHEET.uMeters, vStart], [uShift + d / 2 / WALL_SHEET.uMeters, vStart + r / WALL_SHEET.stripMeters * stripHeight]
  ] });
  if ((lot.first || lot.last) && random() < .55 && muralRects?.length) {
    // Mural en la culata de la esquina; abstracto o inventado, nunca una marca.
    const face = sidesOf(lot.face)[random() < .5 ? 0 : 1];
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

function sashWindow(f, m, u, y, w, h, glass) {
  // Ventana inglesa de guillotina, con marco blanco y dintel de piedra.
  f.panel(m.detail, u, y, .03, w, h, glass);
  f.box(m.detail, u - w / 2, y - .02, .05, .08, h + .04, .08, 'whiteTrim', NO_BACK);
  f.box(m.detail, u + w / 2, y - .02, .05, .08, h + .04, .08, 'whiteTrim', NO_BACK);
  f.box(m.detail, u, y + h, .05, w + .08, .08, .08, 'whiteTrim', NO_BACK);
  f.box(m.detail, u, y - .09, .08, w + .26, .08, .15, 'stoneLight', NO_BACK);
  f.box(m.detail, u, y + h + .08, .05, w + .28, .16, .08, 'stoneLight', NO_BACK);
  f.panel(m.detail, u, y + h * .5, .05, w, .05, 'whiteTrim');
  f.panel(m.detail, u, y, .05, .035, h, 'whiteTrim');
  for (const k of [.25, .75]) f.panel(m.detail, u, y + h * k, .046, w, .025, 'whiteTrim');
}

function bayWindow(f, m, u, y, w, h, glass, top) {
  // Ventana en saliente: tres paños con zócalo y cubierta propia.
  const n = .68, side = .42;
  f.box(m.detail, u, SIDEWALK_Y, n / 2, w, y - SIDEWALK_Y, n, 'brick', ALL_FACES & ~FACES.back);
  const inner = w / 2 - side;
  const P = (pu, py, pn) => [u + pu, py, pn];
  const bottom = y, ceiling = y + h;
  f.quad(m.detail, P(-inner, bottom, n), P(inner, bottom, n), P(inner, ceiling, n), P(-inner, ceiling, n), glass);
  f.quad(m.detail, P(inner, bottom, n), P(w / 2, bottom, .03), P(w / 2, ceiling, .03), P(inner, ceiling, n), glass);
  f.quad(m.detail, P(-w / 2, bottom, .03), P(-inner, bottom, n), P(-inner, ceiling, n), P(-w / 2, ceiling, .03), glass);
  const mullion = (a, an) => f.box(m.detail, u + a, bottom, an, .07, h, .07, 'whiteTrim', ALL_FACES & ~FACES.bottom);
  mullion(-inner, n); mullion(inner, n); mullion(0, n); mullion(-w / 2 + .02, .06); mullion(w / 2 - .02, .06);
  f.box(m.detail, u, bottom - .06, n * .55, w + .12, .07, n + .14, 'stoneLight', ALL_FACES & ~FACES.bottom);
  f.box(m.detail, u, ceiling, n * .55, w + .16, .1, n + .18, 'whiteTrim', ALL_FACES);
  f.quad(m.detail, P(-w / 2 - .08, ceiling + .1, n + .1), P(w / 2 + .08, ceiling + .1, n + .1), P(w / 2, ceiling + .5, .02), P(-w / 2, ceiling + .5, .02), top);
  f.panel(m.detail, u, bottom + h * .72, n + .01, w - side * 2, .05, 'whiteTrim');
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
  const floors = 2;
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
  const brickQuad = (a, b, c, d) => {
    const w = Math.hypot(b[0] - a[0], b[2] - a[2]), h = Math.hypot(d[1] - a[1], d[0] - a[0], d[2] - a[2]);
    f.quadUV(m.brick, a, b, c, d, [0, 0, w / RED_BRICK_METERS, 0, w / RED_BRICK_METERS, h / RED_BRICK_METERS, 0, h / RED_BRICK_METERS]);
  };
  brickQuad([wl, 0, project], [wr, 0, project], [wr, height, project], [wl, height, project]);
  brickQuad([wr, 0, project], [wr, 0, 0], [wr, height, 0], [wr, height, project]);
  brickQuad([wl, 0, 0], [wl, 0, project], [wl, height, project], [wl, height, 0]);
  // Banda de piedra entre pisos y zócalo oscuro: rompen el paño de ladrillo.
  f.box(m.detail, wingU, 3.0, project + .015, wingWidth + .03, .12, .05, 'stoneLight', NO_BACK);
  f.box(m.detail, 0, 0, .015, width, .46, .03, 'stoneGray', FACES.front | FACES.top);
  f.box(m.detail, wingU, 0, project + .015, wingWidth + .03, .46, .03, 'stoneGray', FACES.front | FACES.top);
  // Hastial de entramado sobre el ala.
  const apexY = height + riseWing - .28 * Math.tan(pitchWing);
  const [t0, t1, t2, t3] = detailRect('halfTimber');
  f.tri(m.detail, [wl, height, project + .012], [wr, height, project + .012], [wingU, apexY, project + .012], [t0, t1, t2, t1, (t0 + t2) / 2, t3]);
  // Bay window bajo el hastial y dos ventanas arriba.
  const glassChoices = () => { const x = random(); return x < .24 ? 'glassLit' : x < .4 ? 'glassCurtain' : x < .7 ? 'glassDark' : 'glassSky'; };
  const bayW = Math.min(wingWidth - .7, 2.9);
  // Ventana en saliente: desde el ala hacia afuera sin salirse del antejardín.
  const bayFrame = facade.frame(lot.face, depth / 2 + project);
  bayWindow(bayFrame, m, wingU, .92, bayW, 1.82, glassChoices(), 'brick');
  const upperCount = wingWidth > 3.6 ? 2 : 1;
  for (let i = 0; i < upperCount; i++) {
    const u = wingU + (upperCount === 1 ? 0 : (i - .5) * 1.7);
    sashWindow(bayFrame, m, u, 3.42, 1.05, 1.66, glassChoices());
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
  f.quad(m.detail, [doorU - .95, 2.76, .95], [doorU + .95, 2.76, .95], [doorU + .95, 3.28, 0], [doorU - .95, 3.28, 0], 'terracotta');
  for (const side of [-1, 1]) f.box(m.detail, doorU + side * .78, SIDEWALK_Y, .84, .09, 2.56, .09, 'whiteTrim', NO_BACK);
  if (restWidth > 3.6) sashWindow(f, m, doorU + wingSide * 1.9, 1.04, 1.1, 1.62, glassChoices());
  const upper = Math.max(1, Math.floor(restWidth / 2.1));
  for (let i = 0; i < upper; i++) {
    sashWindow(f, m, restLeft + restWidth * (i + .5) / upper, 3.42, 1.05, 1.62, glassChoices());
  }
  // Banda entre pisos en el cuerpo principal.
  f.box(m.detail, restCenter, 3.0, .03, restWidth, .12, .06, 'stoneLight', NO_BACK);
  facade.finish(shell.walls.get(lot.face), { name: 'Fachada inglesa' });

  // Ventanas laterales si la casa queda en esquina; lo demás es medianera.
  for (const [end, face] of [[lot.first, sidesOf(lot.face)[0]], [lot.last, sidesOf(lot.face)[1]]]) {
    if (!end) continue;
    const side = new Batch(), sf = side.frame(face, width / 2);
    const count = Math.max(1, Math.floor(depth / 3.6));
    for (let i = 0; i < count; i++) {
      const u = -depth / 2 + depth * (i + .5) / count;
      sashWindow(sf, m, u, 1.04, 1, 1.5, glassChoices());
      sashWindow(sf, m, u, 3.42, 1, 1.5, glassChoices());
    }
    side.finish(shell.walls.get(face), { name: 'Lateral inglés' });
  }

  const roof = new Batch(), rf = roof.frame(lot.face, depth / 2);
  const pitch = THREE.MathUtils.degToRad(38 + random() * 6);
  const { ridgeY } = gableRoof(roof, rf, m, { width, depth, height, pitch, overhang: .42, roof: m.clayDark,
    rafters: false, fascia: 'whiteTrim', sideL: lot.first ? .25 : 0, sideR: lot.last ? .25 : 0 });
  // Aguas del ala: cruzan el tejado principal hasta enterrarse en él.
  const wingRidge = apexY;
  const backN = -Math.max(1.2, (wingRidge - height) / Math.tan(pitch) + .2);
  const eaveW = wingWidth / 2 + .28, eaveY = height - .28 * Math.tan(pitchWing), frontN = project + .3;
  const clayUV = (a, b) => { const w = Math.abs(a) / 2, s = b / 2; return [0, 0, s, 0, s, w, 0, w]; };
  const slopeLength = Math.hypot(eaveW, wingRidge - eaveY);
  rf.quadUV(m.clayDark, [wingU + eaveW, eaveY, frontN], [wingU, wingRidge, frontN], [wingU, wingRidge, backN], [wingU + eaveW, eaveY, backN], clayUV(frontN - backN, slopeLength));
  rf.quadUV(m.clayDark, [wingU, wingRidge, frontN], [wingU - eaveW, eaveY, frontN], [wingU - eaveW, eaveY, backN], [wingU, wingRidge, backN], clayUV(frontN - backN, slopeLength));
  // Tablas de borde del hastial, blancas como en las casas de esa época.
  const bargeLength = Math.hypot(eaveW, wingRidge - eaveY);
  for (const s of [-1, 1]) {
    const a = [wingU + s * eaveW, eaveY - .02, frontN + .02], b = [wingU, wingRidge - .02, frontN + .02];
    const up = .22 / bargeLength;
    rf.quad(m.detail, s > 0 ? b : a, s > 0 ? a : b, [(s > 0 ? a : b)[0], (s > 0 ? a : b)[1] - .24 - up, frontN + .02], [(s > 0 ? b : a)[0], (s > 0 ? b : a)[1] - .24 - up, frontN + .02], 'whiteTrim');
  }
  rf.box(m.detail, wingU, wingRidge - .03, (frontN + backN) / 2, .24, .09, frontN - backN, 'terracotta', ALL_FACES & ~FACES.bottom);
  // Chimenea de ladrillo a un costado.
  const chimneyU = -wingSide * (width / 2 - 1.1), chimneyTop = ridgeY + 1.1;
  rf.box(m.detail, chimneyU, height - .3, -depth * .42, .95, chimneyTop - height + .3, .62, 'brick', ALL_FACES & ~FACES.bottom);
  rf.box(m.detail, chimneyU, chimneyTop, -depth * .42, 1.08, .12, .75, 'stoneLight', ALL_FACES);
  for (const k of [-.2, .2]) rf.box(m.detail, chimneyU + k, chimneyTop + .12, -depth * .42, .16, .34, .16, 'terracotta', ALL_FACES & ~FACES.bottom);
  roof.finish(shell.roof, { name: 'Tejado inglés' });

  const rise = depth / 2 * Math.tan(pitch);
  gableEnds(sidesOf(lot.face).map(face => [face, shell.walls.get(face)]), m.brick, { width, depth, height, rise, uvOf: (d, r) => [
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
    y.box(m.detail, mid, .12, -.1, len, .52, .24, 'brick', ALL_FACES & ~FACES.bottom);
    y.box(m.detail, mid, .64, -.1, len + .02, .07, .3, 'stoneLight', ALL_FACES & ~FACES.bottom);
    y.box(m.detail, mid, 1.56, -.1, len, .04, .04, 'iron', SKIN | FACES.top);
    y.box(m.detail, mid, .86, -.1, len, .03, .03, 'iron', SKIN);
    for (let u = a + .14; u < b - .05; u += .22) y.panel(m.detail, u, .7, -.09, .024, .96, 'iron');
    for (const u of [a + .12, b - .12]) {
      y.box(m.detail, u, .12, -.1, .36, 1.56, .36, 'brick', ALL_FACES & ~FACES.bottom);
      y.box(m.detail, u, 1.68, -.1, .42, .08, .42, 'stoneLight', ALL_FACES & ~FACES.bottom);
    }
  }
  // Reja de la entrada, entreabierta.
  for (let k = .1; k < .9; k += .14) y.panel(m.detail, pathU - .75 + k * 1.5, .16, -.08, .024, 1.4, 'iron');
  y.box(m.detail, pathU, 1.5, -.08, 1.5, .04, .04, 'iron', SKIN | FACES.top);
  yard.finish(shell.base, { name: 'Antejardín', castShadow: false });
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
  gableRoof(roof, rf, m, { width, depth, height, pitch, overhang: .36, roof: m.clayDark, rafters: false, fascia: 'woodDark' });
  roof.finish(shell.roof, { name: 'Tejado comercial' });
  const rise = depth / 2 * Math.tan(pitch);
  gableEnds(sidesOf(lot.face).map(face => [face, shell.walls.get(face)]), m.brick, { width, depth, height, rise, uvOf: (d, r) => [
    [0, 0], [d / RED_BRICK_METERS, 0], [d / 2 / RED_BRICK_METERS, r / RED_BRICK_METERS]
  ] });
  return { shell, height };
}
