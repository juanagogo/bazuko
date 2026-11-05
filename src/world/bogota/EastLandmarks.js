// src/world/bogota/EastLandmarks.js
// Lugares que dan nombre a los barrios del oriente: iglesia y plaza de la Candelaria, torres curvas de
// ladrillo, plaza de mercado y arbolado grande de Chapinero. Solo decoración sólida, sin interiores.
import * as THREE from 'three';
import { rng } from './textures.js';
import { createBuildingShell } from './BuildingVisibility.js';
import { Batch, ALL_FACES, NO_BACK, SKIN, FACES, shellBox, wallStripUV } from './ZoneGeometry.js';
import { CHURCH, CHURCH_STEPS, FOUNTAIN, MARKET, TOWERS } from './EastZones.js';
import { WALL_SHEET, TOWER_TILE, detailRect } from './ZoneTextures.js';

const T = 2;

const lathe = (batch, material, rect, x, y, z, radii, segments = 16) => {
  // Revolución de pocos lados: base de la fuente y cúpulas, sin un objeto Three por pieza.
  const [u0, v0, u1, v1] = typeof rect === 'string' ? detailRect(rect) : rect;
  for (let r = 0; r < radii.length - 1; r++) {
    const [ra, ya] = radii[r], [rb, yb] = radii[r + 1];
    for (let s = 0; s < segments; s++) {
      const a0 = s / segments * Math.PI * 2, a1 = (s + 1) / segments * Math.PI * 2;
      const point = (radius, angle, height) => [x + Math.sin(angle) * radius, y + height, z + Math.cos(angle) * radius];
      batch.quadUV(material, point(ra, a0, ya), point(ra, a1, ya), point(rb, a1, yb), point(rb, a0, yb),
        [u0, v0, u1, v0, u1, v1, u0, v1]);
    }
  }
};

/** Iglesia colonial en el costado oriental de la plaza: dos torres, nave y portada de piedra. */
export function buildChurch(m) {
  const x0 = CHURCH.x0 * T - T / 2, x1 = CHURCH.x1 * T + T / 2, z0 = CHURCH.z0 * T - T / 2, z1 = CHURCH.z1 * T + T / 2;
  const sx = x1 - x0, sz = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const navH = 12.6;
  // El muro blanco repite su franja: la iglesia es más alta que los siete metros de la hoja.
  const stripUV = (w, h) => wallStripUV(0, .1, w, Math.min(h, WALL_SHEET.stripMeters));
  const shell = createBuildingShell(shellBox(sx, navH, sz, (face, w, h) => (face === 2 || face === 3 ? [0, 0, w / 2, h / 2] : stripUV(w, h))),
    [m.wall, m.wall, m.clay, m.clay, m.wall, m.wall], { x: cx, z: cz, height: navH, interiorMaterial: m.interior });

  // Portada hacia la plaza (cara −x): el marco f tiene u = +z y n = −x.
  const front = new Batch(), f = front.frame(1, sx / 2);
  const towerW = 6.2, towerH = 24, towerU = sz / 2 - towerW / 2;
  // Solo el primer tramo lleva zócalo: los de arriba toman el pañete de la franja.
  const addWall = (b, l, r, y0, y1, n) => {
    b.quadUV(m.wall, [l, y0, n], [r, y0, n], [r, y1, n], [l, y1, n], wallFace(r - l, y1 - y0, y0));
  };
  for (const side of [-1, 1]) {
    // Cada torre es un cuerpo propio que sobresale de la nave.
    const u = side * towerU, n = .9, half = towerW / 2;
    for (const [low, high] of [[0, 7], [7, 14], [14, towerH - 7.5]]) addWall(f, u - half, u + half, low, high, n);
    for (const [low, high] of [[0, 7], [7, 14], [14, towerH - 7.5]]) {
      f.quadUV(m.wall, [u + half, low, n], [u + half, low, -5], [u + half, high, -5], [u + half, high, n], wallFace(5.9, high - low, low));
      f.quadUV(m.wall, [u - half, low, -5], [u - half, low, n], [u - half, high, n], [u - half, high, -5], wallFace(5.9, high - low, low));
    }
    // Campanario abierto: cuatro pilares de piedra y arco en cada cara.
    const belfry = towerH - 7.5, up = 4.6;
    for (const [du, dn] of [[-half, n], [half, n], [-half, -5], [half, -5]]) {
      f.box(m.detail, u + du + (du < 0 ? .5 : -.5), belfry, dn + (dn < 0 ? .5 : -.5), 1, up, 1, 'stoneLight', ALL_FACES & ~FACES.bottom);
    }
    f.box(m.detail, u, belfry - .24, (n - 5) / 2, towerW + .4, .3, n + 5 + .4, 'stoneGray', ALL_FACES);
    f.box(m.detail, u, belfry + up, (n - 5) / 2, towerW + .3, .5, n + 5 + .3, 'stoneLight', ALL_FACES);
    // Vano abierto: se ve el cielo a través del campanario, con la campana a contraluz.
    const bellP = f.P(u, belfry + 1, (n - 5) / 2);
    lathe(front, m.detail, 'iron', bellP[0], bellP[1], bellP[2], [[.62, .02], [.5, .22], [.3, .9], [.2, 1.5], [.06, 1.75], [.02, 2.6]], 8);
    // Remate piramidal de teja y cruz.
    const top = belfry + up + .5, apex = top + 4.2;
    const cn = (n - 5) / 2, hw = towerW / 2 + .15, hd = (n + 5) / 2 + .15;
    const roofUV = [0, 0, 1.6, 0, .8, 1.6];
    f.tri(m.clay, [u - hw, top, cn + hd], [u + hw, top, cn + hd], [u, apex, cn], roofUV);
    f.tri(m.clay, [u + hw, top, cn + hd], [u + hw, top, cn - hd], [u, apex, cn], roofUV);
    f.tri(m.clay, [u + hw, top, cn - hd], [u - hw, top, cn - hd], [u, apex, cn], roofUV);
    f.tri(m.clay, [u - hw, top, cn - hd], [u - hw, top, cn + hd], [u, apex, cn], roofUV);
    f.box(m.detail, u, apex - .1, cn, .12, 1.5, .12, 'iron', SKIN | FACES.top);
    f.box(m.detail, u, apex + .85, cn, .8, .1, .1, 'iron', SKIN | FACES.top);
    // Tres ventanas por torre: la luz del interior no llega a la plaza, pero de noche se notan.
    for (const y of [7.4, 11.2]) {
      f.panel(m.detail, u, y, n + .02, 1.2, 2.2, y < 8 ? 'glassCurtain' : 'glassDark');
      f.box(m.detail, u, y - .1, n + .04, 1.6, .12, .08, 'stoneLight', NO_BACK);
      f.box(m.detail, u, y + 2.2, n + .04, 1.6, .22, .08, 'stoneLight', NO_BACK);
    }
    // Cornisas que cortan la torre en cuerpos.
    for (const y of [7, 14]) f.box(m.detail, u, y - .12, n + .08, towerW + .2, .24, .18, 'stoneLight', NO_BACK);
    f.box(m.detail, u, 0, n + .05, towerW + .1, .95, .1, 'stoneGray', NO_BACK);
  }
  // Portada central de piedra, con el arco insinuado por dovelas.
  const centerW = sz - towerW * 2;
  f.box(m.detail, 0, .12, .25, centerW * .6, 9.2, .5, 'stoneLight', NO_BACK);
  f.box(m.detail, 0, .12, .62, 3.6, 5.6, .24, 'stoneGray', NO_BACK);
  f.panel(m.detail, 0, .12, .76, 2.6, 3.9, 'doorBrown');
  // Dovelas alrededor del arco de entrada.
  const arch = 1.55;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * i / 8, u = Math.cos(a) * arch, y = 4.05 + Math.sin(a) * arch;
    f.box(m.detail, u, y - .22, .8, .46, .44, .16, 'stoneLight', NO_BACK);
  }
  // Arco oscuro encima de las hojas (tímpano).
  f.panel(m.detail, 0, 4.02, .75, 2.62, 1.1, 'woodDark');
  for (const side of [-1, 1]) {
    // Pilastras a lado y lado de la puerta.
    f.box(m.detail, side * 2.5, .12, .7, .5, 6.5, .34, 'stoneLight', NO_BACK);
    f.box(m.detail, side * 3.3, .12, .55, .3, 8.6, .3, 'stoneGray', NO_BACK);
  }
  f.box(m.detail, 0, 6.6, .72, 6.4, .34, .42, 'stoneLight', NO_BACK);
  // Rosetón y frontón.
  f.panel(m.detail, 0, 7.15, .52, 2.1, 1.7, 'glassCurtain');
  f.box(m.detail, 0, 7, .54, 2.5, .15, .1, 'stoneGray', NO_BACK);
  f.box(m.detail, 0, 8.85, .54, 2.5, .15, .1, 'stoneGray', NO_BACK);
  f.box(m.detail, 0, 9.3, .4, centerW + .4, .3, .6, 'stoneLight', NO_BACK);
  const pedimentY = 9.6, peak = 13.4, halfCenter = centerW / 2;
  const [p0, p1, p2, p3] = wallStripUV(0, .3, centerW, 5);
  f.tri(m.wall, [-halfCenter, pedimentY, .05], [halfCenter, pedimentY, .05], [0, peak, .05], [p0, p1, p2, p1, (p0 + p2) / 2, p3]);
  f.box(m.detail, 0, peak - .1, .05, .16, 1.5, .16, 'iron', SKIN | FACES.top);
  f.box(m.detail, 0, peak + .85, .05, .9, .12, .12, 'iron', SKIN | FACES.top);
  // Atrio: dos gradas de piedra, con la huella y la cota que pisa el jugador.
  CHURCH_STEPS.forEach(({ depth, inset, top }, i) => {
    const y = i ? CHURCH_STEPS[i - 1].top : .12;
    f.box(m.detail, 0, y, .1 + (depth - .1) / 2, sz - inset * 2, top - y, depth - .1, i ? 'stoneLight' : 'stoneGray', ALL_FACES & ~FACES.bottom);
  });
  front.finish(shell.walls.get(1), { name: 'Portada de iglesia' });

  // Contrafuertes y ventanas altas en las caras largas; apenas se ven desde la calle.
  for (const face of [4, 5]) {
    const side = new Batch(), sf = side.frame(face, sz / 2);
    for (let i = 0; i < 4; i++) {
      const u = -sx / 2 + sx * (i + .5) / 4;
      sf.panel(m.detail, u, 6.5, .04, 1.3, 3.2, 'glassCurtain');
      sf.box(m.detail, u - sx / 8, 0, .35, .8, 8.6, .7, 'stoneGray', NO_BACK);
    }
    side.finish(shell.walls.get(face), { name: 'Costado de iglesia' });
  }
  const roof = new Batch(), r = roof.frame(1, sx / 2);
  const roofRise = 5;
  const ridgeY = navH + roofRise;
  // Tejado de la nave con la cumbrera perpendicular a la plaza.
  const roofLength = Math.hypot(sz / 2 + .4, roofRise + .3) / 2, along = sx / 2;
  r.quadUV(m.clay, [-sz / 2 - .4, navH - .3, -sx - .3], [-sz / 2 - .4, navH - .3, -3], [0, ridgeY, -3], [0, ridgeY, -sx - .3], [0, 0, along, 0, along, roofLength, 0, roofLength]);
  r.quadUV(m.clay, [sz / 2 + .4, navH - .3, -3], [sz / 2 + .4, navH - .3, -sx - .3], [0, ridgeY, -sx - .3], [0, ridgeY, -3], [0, 0, along, 0, along, roofLength, 0, roofLength]);
  // Hastial de la nave detrás del frontón: sin él se vería el tejado por debajo.
  const [g0, g1, g2, g3] = wallStripUV(0, .3, sz, 5, 1.2);
  r.tri(m.wall, [-sz / 2 - .4, navH - .3, -3], [sz / 2 + .4, navH - .3, -3], [0, ridgeY, -3], [g0, g1, g2, g1, (g0 + g2) / 2, g3]);
  roof.finish(shell.roof, { name: 'Tejado de iglesia' });
  return { shell, height: navH };
}
const wallFace = (w, h, y0 = 0) => {
  const floor = y0 > 0 ? 1.2 : 0;
  const [a, c, e, g] = wallStripUV(0, .4, w, Math.min(h, 6.8 - floor), floor);
  return [a, c, e, c, e, g, a, g];
};

const TOWER_SEGMENTS_PER_SHELL = 3;

/** Pisos de cada tramo: la torre sube hacia el centro de la curva en escalones de varios pisos. */
function towerLevels({ radius, a0, a1, floors }) {
  const segments = Math.round((a1 - a0) * radius / 4);
  return Array.from({ length: segments }, (_, i) => {
    const k = (i + .5) / segments, shape = Math.min(1, Math.sin(k * Math.PI) * 1.55);
    return Math.max(5, Math.round((floors * shape) / 2) * 2);
  });
}

/** La misma torre en cajas, para la ciudad de fondo: se ve cuando la real ya salió del alcance de la cámara. */
export function towerSilhouette(tower) {
  const { cx, cz, radius, thickness, a0, a1 } = tower;
  const levels = towerLevels(tower), step = (a1 - a0) / levels.length, middle = radius - thickness / 2;
  return levels.map((floors, i) => {
    const angle = a0 + step * (i + .5);
    return { x: cx + Math.cos(angle) * middle, z: cz + Math.sin(angle) * middle, rotation: -angle,
      w: thickness * .86, d: step * middle * .96, h: floors * TOWER_TILE.floorMeters - .4, color: [.52, .31, .24], closedOnly: true };
  });
}

/**
 * Torres curvas de ladrillo, escalonadas hacia las puntas; altas pero menores que Colpatria.
 * Devuelve un edificio por cada tramo de arco: la caja de la torre entera abarca la plaza de su
 * lado cóncavo, y con la cámara y el jugador dentro de esa caja el recorte isométrico no la abriría.
 */
export function buildCurvedTower(tower, m) {
  const { radius, thickness, a0, a1 } = tower;
  const inner = radius - thickness;
  const levels = towerLevels(tower), segments = levels.length;
  const floorH = TOWER_TILE.floorMeters;
  const tileU = TOWER_TILE.bays * TOWER_TILE.bayMeters, tileV = TOWER_TILE.floors * floorH;
  const point = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  const shells = [];
  for (let start = 0; start < segments; start += TOWER_SEGMENTS_PER_SHELL) {
    const root = new THREE.Group();
    root.position.set(tower.cx, 0, tower.cz);
    const base = new THREE.Group(), roof = new THREE.Group(), wall = new THREE.Group();
    wall.userData.noMerge = true;
    roof.userData.noMerge = true;
    root.add(base, wall, roof);
    const shellBatch = new Batch(), capsBatch = new Batch(), baseBatch = new Batch();
    const stop = Math.min(segments, start + TOWER_SEGMENTS_PER_SHELL);
    let top = 0;
    for (let i = start; i < stop; i++) {
      const t0 = a0 + (a1 - a0) * i / segments, t1 = a0 + (a1 - a0) * (i + 1) / segments;
      const height = levels[i] * floorH;
      top = Math.max(top, height);
      const uStart = t0 * radius / tileU, uEnd = t1 * radius / tileU;
      const vEnd = height / tileV;
      // Exterior (mira hacia afuera de la curva) e interior.
      shellBatch.quadUV(m.tower, point(radius, t1, 0), point(radius, t0, 0), point(radius, t0, height), point(radius, t1, height),
        [uEnd, 0, uStart, 0, uStart, vEnd, uEnd, vEnd]);
      const uIn0 = t0 * inner / tileU, uIn1 = t1 * inner / tileU;
      shellBatch.quadUV(m.tower, point(inner, t0, 0), point(inner, t1, 0), point(inner, t1, height), point(inner, t0, height),
        [uIn0, 0, uIn1, 0, uIn1, vEnd, uIn0, vEnd]);
      // Azotea de cada tramo, con el mismo ladrillo que el remate.
      const [c0, c1, c2, c3] = detailRect('concrete');
      capsBatch.quad(m.detail, point(inner, t0, height), point(inner, t1, height), point(radius, t1, height), point(radius, t0, height), [c0, c1, c2, c3]);
      // Pretil de ladrillo en el borde exterior.
      shellBatch.quadUV(m.detail, point(radius + .02, t1, height - .4), point(radius + .02, t0, height - .4), point(radius + .02, t0, height + .5), point(radius + .02, t1, height + .5), brickCell());
      // Muro de cierre donde el escalón cambia de altura.
      const next = i + 1 < segments ? levels[i + 1] * floorH : 0;
      const previous = i > 0 ? levels[i - 1] * floorH : 0;
      if (next < height) {
        shellBatch.quadUV(m.tower, point(radius, t1, next), point(inner, t1, next), point(inner, t1, height), point(radius, t1, height),
          [0, next / tileV, thickness / tileU, next / tileV, thickness / tileU, vEnd, 0, vEnd]);
      }
      if (previous < height) {
        shellBatch.quadUV(m.tower, point(inner, t0, previous), point(radius, t0, previous), point(radius, t0, height), point(inner, t0, height),
          [0, previous / tileV, thickness / tileU, previous / tileV, thickness / tileU, vEnd, 0, vEnd]);
      }
      // Primer piso: basamento de ladrillo liso con los accesos, base del recorte isométrico.
      baseBatch.quad(m.detail, point(radius + .05, t1, 0), point(radius + .05, t0, 0), point(radius + .05, t0, .65), point(radius + .05, t1, .65), 'brick');
      baseBatch.quad(m.detail, point(inner - .05, t0, 0), point(inner - .05, t1, 0), point(inner - .05, t1, .65), point(inner - .05, t0, .65), 'brick');
      // Piso del corte: al abrirse el tramo no queda un hueco sin geometría.
      baseBatch.quad(m.detail, point(inner, t0, .65), point(inner, t1, .65), point(radius, t1, .65), point(radius, t0, .65), 'concrete');
    }
    shellBatch.finish(wall, { name: 'Torre curva' });
    capsBatch.finish(roof, { name: 'Azoteas de torre' });
    baseBatch.finish(base, { name: 'Basamento de torre' });
    shells.push({ root, base, walls: new Map([[0, wall]]), roof, height: top });
  }
  return shells;
}
const brickCell = () => {
  const [u0, v0, u1, v1] = detailRect('brick');
  return [u0, v0, u1, v0, u1, v1, u0, v1];
};

/** Fuente de piedra de la plaza: taza ancha, columna y un plato alto. */
export function buildFountain(m) {
  const batch = new Batch();
  const { x, z, radius } = FOUNTAIN, y = .12;
  lathe(batch, m.detail, 'stoneLight', x, y, z, [[radius + .55, .02], [radius + .55, .16], [radius + .28, .2], [radius + .25, .62], [radius + .36, .66], [radius + .36, .78], [radius - .05, .8], [radius - .08, .32]], 20);
  // Agua: disco casi a ras de la taza.
  lathe(batch, m.detail, 'water', x, y, z, [[radius - .05, .36], [.2, .36]], 20);
  // La taza alta también guarda agua: desde arriba se notaría seca.
  lathe(batch, m.detail, 'water', x, y, z, [[1.34, 3.04], [.3, 3.04]], 12);
  lathe(batch, m.detail, 'stoneGray', x, y, z,[[.92, .36], [.72, .9], [.56, 1.15], [.42, 2.2], [.58, 2.45], [1.45, 2.8], [1.55, 2.96], [1.3, 3.02], [.34, 3.1], [.26, 3.8], [.42, 3.96], [.7, 4.12], [.7, 4.2], [.2, 4.3], [.14, 4.86], [.03, 4.96]], 12);
  const group = new THREE.Group();
  group.name = 'Fuente de la plaza';
  batch.finish(group, { name: 'Fuente de la plaza', castShadow: true });
  return group;
}

/** Puestos de la plaza de mercado: toldos, mesas, canastas y costales. Devuelve sus colisiones. */
export function buildMarket(m) {
  const group = new THREE.Group();
  group.name = 'Plaza de mercado';
  const random = rng(5151);
  const batch = new Batch(), f = batch.frame(4, 0);
  const x0 = MARKET.x0 * T, x1 = MARKET.x1 * T, z0 = MARKET.z0 * T, z1 = MARKET.z1 * T;
  const colliders = [], blockedTiles = [];
  const tarps = ['redStripe', 'greenTarp', 'blueStripe', 'blueTarp', 'orangeTarp', 'redStripe'];
  const goods = ['fruit', 'produce'];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const cx = x0 + (x1 - x0) * (col + .5) / 3 + (random() - .5) * .3, cz = z0 + (z1 - z0) * (row === 0 ? .24 : .76);
    const w = 3.9, d = 2.6, tarp = tarps[(row * 3 + col) % tarps.length];
    // Mesa con canastas: la fruta se ve en bandejas pequeñas, no como una sola lámina.
    f.box(m.detail, cx, .92, cz, w - .5, .09, d - 1, 'woodLight', ALL_FACES);
    const crates = 3 + Math.floor(random() * 2), crateW = (w - .7) / crates;
    for (let c = 0; c < crates; c++) for (const side of [-1, 1]) {
      const crateX = cx - (w - .7) / 2 + crateW * (c + .5), crateZ = cz + side * (d - 1.1) / 4;
      f.box(m.detail, crateX, 1.01, crateZ, crateW - .08, .17, (d - 1.2) / 2 - .06, 'woodLight', FACES.front | FACES.back | FACES.left | FACES.right);
      f.box(m.detail, crateX, 1.01, crateZ, crateW - .08, .17, (d - 1.2) / 2 - .06, goods[Math.floor(random() * goods.length)], FACES.top);
    }
    for (const [du, dn] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      f.box(m.detail, cx + du * (w / 2 - .32), .12, cz + dn * (d / 2 - .58), .09, .8, .09, 'woodDark', SKIN);
    }
    // Armazón y toldo a dos caídas.
    for (const [du, dn] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      f.box(m.detail, cx + du * (w / 2 - .1), .12, cz + dn * (d / 2 - .1), .07, 2.32, .07, 'iron', SKIN);
    }
    const ridge = 2.95, eave = 2.32;
    f.quad(m.detail, [cx - w / 2 - .15, eave, cz + d / 2 + .15], [cx + w / 2 + .15, eave, cz + d / 2 + .15], [cx + w / 2 + .15, ridge, cz], [cx - w / 2 - .15, ridge, cz], tarp);
    f.quad(m.detail, [cx + w / 2 + .15, eave, cz - d / 2 - .15], [cx - w / 2 - .15, eave, cz - d / 2 - .15], [cx - w / 2 - .15, ridge, cz], [cx + w / 2 + .15, ridge, cz], tarp);
    // Faldón que cuelga del alero: es lo que hace que la lona parezca lona y no una tabla.
    for (const side of [-1, 1]) {
      const zv = cz + side * (d / 2 + .15), a = side > 0 ? -1 : 1;
      f.quad(m.detail, [cx + a * (w / 2 + .15), eave - .22, zv], [cx - a * (w / 2 + .15), eave - .22, zv], [cx - a * (w / 2 + .15), eave, zv], [cx + a * (w / 2 + .15), eave, zv], tarp);
    }
    // Costales arrugados en el suelo: un cuerpo ancho y un cuello amarrado.
    for (let i = 0; i < 4; i++) {
      const bx = cx + (random() - .5) * (w - .7), bz = cz + (random() < .5 ? -1 : 1) * (d / 2 - .1);
      const size = .42 + random() * .16, tall = .5 + random() * .2;
      f.box(m.detail, bx, .12, bz, size, tall, size * .78, 'burlap', ALL_FACES & ~FACES.bottom);
      f.box(m.detail, bx, .12 + tall, bz, size * .46, .12, size * .36, 'burlap', ALL_FACES & ~FACES.bottom);
    }
    colliders.push({ x: cx, z: cz, w: w - .4, d: d - .9, h: 1.3 });
    for (let tx = Math.floor((cx - w / 2) / T + .5); tx <= Math.floor((cx + w / 2) / T + .5); tx++) {
      for (let tz = Math.floor((cz - d / 2 + .5) / T + .5); tz <= Math.floor((cz + d / 2 - .5) / T + .5); tz++) blockedTiles.push(`${tx},${tz}`);
    }
  }
  batch.finish(group, { name: 'Puestos de mercado', castShadow: true });
  return { group, colliders, blockedTiles };
}
