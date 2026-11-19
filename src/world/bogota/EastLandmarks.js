// src/world/bogota/EastLandmarks.js
// Lugares que dan nombre a los barrios del oriente: iglesia y plaza de la Candelaria, torres curvas de
// ladrillo, plaza de mercado y arbolado grande de Chapinero. Solo decoración sólida, sin interiores.
import * as THREE from 'three';
import { rng } from './textures.js';
import { createBuildingShell } from './BuildingVisibility.js';
import { Batch, ALL_FACES, NO_BACK, SKIN, FACES, shellBox, wallStripUV } from './ZoneGeometry.js';
import { CHURCH, CHURCH_STEPS, FOUNTAIN, MARKET, TOWERS } from './EastZones.js';
import { WALL_SHEET, TOWER_TILE, detailRect } from './ZoneTextures.js';
import { MarketProduce } from './MarketProduce.js';
import { MARKET_FINISHES, createMarketFinish, marketCrate, marketRect, marketSack, marketSackOnSide, marketTable } from './MarketFinish.js';
import { addMarketScale } from './MarketScale.js';

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

/**
 * Puestos de la plaza de mercado: toldos colgados y remendados, montones de fruta y verdura, racimos de plátano,
 * básculas, canastos, costales, bultos recostados y guacales apilados. Devuelve sus colisiones.
 */
export function buildMarket(m) {
  const group = new THREE.Group();
  group.name = 'Plaza de mercado';
  const random = rng(5151);
  // El surtido nuevo lleva su propio azar: el de siempre sigue fijando sitio y tamaño de mesas, canastas y costales.
  const extra = rng(5152);
  const batch = new Batch(), f = batch.frame(4, 0);
  const finishes = createMarketFinish();
  const produce = new MarketProduce();
  /**
   * Lona por paños entre cuatro esquinas, con la tela caída hacia el medio y las rayas seguidas. `rectAt(i, j)` dice de
   * qué tela es cada paño (remiendos), `fall(s)` cuánto se descuelga el borde de abajo a lo largo y `fold(s)` el pliegue
   * que baja de la cumbrera, donde va templada, y se abre hacia el alero.
   */
  const cloth = (a, b, c, d, rectAt, sag, cols = 6, rows = 4, fall = null, fold = null) => {
    const at = (s, t) => [0, 1, 2].map(k => (a[k] * (1 - s) + b[k] * s) * (1 - t) + (d[k] * (1 - s) + c[k] * s) * t
      - (k === 1 ? sag * Math.sin(Math.PI * t) * (.55 + .45 * Math.sin(Math.PI * s)) + (fall ? fall(s) * (1 - t) * (1 - t) : 0) + (fold ? fold(s) * (1 - t) : 0) : 0));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const s0 = i / cols, s1 = (i + 1) / cols, t0 = j / rows, t1 = (j + 1) / rows;
      const [u0, v0, u1, v1] = rectAt(i, j);
      f.quadUV(finishes, at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1),
        [u0 + (u1 - u0) * s0, v0 + (v1 - v0) * t0, u0 + (u1 - u0) * s1, v0 + (v1 - v0) * t0, u0 + (u1 - u0) * s1, v0 + (v1 - v0) * t1, u0 + (u1 - u0) * s0, v0 + (v1 - v0) * t1]);
    }
  };
  const pick = list => list[Math.floor(extra() * list.length)];
  const x0 = MARKET.x0 * T, x1 = MARKET.x1 * T, z0 = MARKET.z0 * T, z1 = MARKET.z1 * T;
  const colliders = [], blockedTiles = [], cameraCovers = [], cameraDisplays = [];
  // Se remienda con lo que hay: retazos de otra lona lisa o de costal, nunca del mismo paño. Un retazo de rayas en
  // medio de una lona lisa se lee como una bandera.
  const patches = ['burlap', 'blueTarp', 'orangeTarp', 'greenTarp', 'burlap', 'greenTarp'];
  const goods = ['fruit', 'produce'];
  const fruits = ['orange', 'tomato'];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const stall = row * 3 + col;
    const cx = x0 + (x1 - x0) * (col + .5) / 3 + (random() - .5) * .3, cz = z0 + (z1 - z0) * (row === 0 ? .24 : .76);
    const w = 3.9, d = 2.6, finish = MARKET_FINISHES[stall], tarp = finish.cloth;
    const mended = patches.filter(name => name !== tarp);
    // La fruta queda en guacales separados de las hortalizas, con volumen por encima del borde de madera.
    marketTable(f, finishes, cx, cz, w, d, finish);
    const crates = 3 + Math.floor(random() * 2), crateW = (w - .7) / crates;
    const trayPlan = [];
    for (let c = 0; c < crates; c++) for (const side of [-1, 1]) {
      random(); // La tirada que antes escogía el producto sigue separando las posiciones de las mesas y los costales.
      // Las tiradas de cada guacal alimentan la semilla del surtido; la secuencia de las lonas sigue en su lugar.
      let seed = Math.floor((extra() + extra() * 2 + extra() * 4) * 0x10000000);
      if (extra() < .4) seed ^= Math.floor((extra() + extra() * 2) * 0x10000000);
      trayPlan.push({ column: c, side, seed });
    }
    const scaleSide = extra() < .5 ? -1 : 1, front = row === 0 ? 1 : -1;
    // En la mesa nororiental el primer guacal de tomates queda a la vista del pasillo.
    const scaleColumn = scaleSide > 0 || (row === 0 && col === 2) ? crates - 1 : 0;
    for (const { column, side, seed } of trayPlan) {
      const crateX = cx - (w - .7) / 2 + crateW * (column + .5), crateZ = cz + side * (d - 1.1) / 4;
      if (column === scaleColumn && side === front) {
        // El último espacio de la mesa queda para la báscula. Sus patas apoyan sobre las dos tablas exteriores.
        addMarketScale(batch, finishes, m.detail, { x: crateX, z: crateZ + front * .15, front, stall });
        continue;
      }
      const plastic = (stall + column + (side > 0 ? 1 : 0)) % 3 === 0 ? null : finish.crate;
      marketCrate(f, finishes, crateX, 1.01, crateZ, crateW - .08, .17, (d - 1.2) / 2 - .06, 0, null, plastic);
      const halfW = (crateW - .08) / 2, halfD = ((d - 1.2) / 2 - .06) / 2;
      f.quad(m.detail, [crateX - halfW, 1.157, crateZ + halfD], [crateX + halfW, 1.157, crateZ + halfD],
        [crateX + halfW, 1.157, crateZ - halfD], [crateX - halfW, 1.157, crateZ - halfD], 'woodDark');
      produce.stallTray({ stall, column, front: side === front, side,
        x: crateX, y: 1.157, z: crateZ, width: halfW * 2 - .04, depth: halfD * 2 - .04, seed });
    }
    // Armazón y toldo a dos caídas.
    const post = marketRect(finish.leg === 'sheetMetal' ? 'sheetMetal' : 'iron');
    for (const [du, dn] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + du * (w / 2 - .1), z = cz + dn * (d / 2 - .1);
      f.box(finishes, x, .12, z, .07, 2.32, .07, post, SKIN);
      const box = new THREE.Box3(new THREE.Vector3(x - .035, 1.38, z - .035), new THREE.Vector3(x + .035, 2.44, z + .035));
      // Entre el cuerpo y un poste delgado queda espacio para mantener una vista corta de la plaza.
      cameraDisplays.push({ box, approach: .40, minimumArm: .81 });
    }
    const ridge = 2.95, eave = 2.32;
    let skirtMin = eave;
    for (const side of [1, -1]) {
      // Cada caída con su comba, su remiendo de otra tela, a veces un paño entero cambiado y una punta descolgada.
      const sag = .14 + extra() * .14, patchCol = Math.floor(extra() * 5), patchRow = 1 + Math.floor(extra() * 2), patch = pick(mended);
      const spare = extra() < .5 ? (extra() < .5 ? 0 : 5) : -1, other = pick(mended);
      const loose = extra() < .6 ? .14 + extra() * .2 : 0, corner = extra() < .5;
      const fall = s => loose * Math.pow(corner ? s : 1 - s, 3);
      // Ocho paños a lo ancho para que quepan los pliegues; las telas se siguen repartiendo en seis tramos.
      const cols = 8, main = marketRect(tarp, tarp === 'redStripe' ? row : null);
      const replacement = marketRect(patch), spareCloth = marketRect(other);
      const rectAt = (i, j) => {
        const k = Math.floor(i * 6 / cols);
        return k === spare ? spareCloth : (j === patchRow && (k === patchCol || k === patchCol + 1) ? replacement : main);
      };
      // Pliegues disparejos de hasta 4 cm: la lona va amarrada en las puntas y entre amarre y amarre hace bolsa o lomo.
      const fold = s => { const i = Math.round(s * cols); return i % cols ? .04 * Math.sin(i * 2.4 + sag * 40) : 0; };
      const zv = cz + side * (d / 2 + .15), xa = cx - side * (w / 2 + .15), xb = cx + side * (w / 2 + .15);
      cloth([xa, eave, zv], [xb, eave, zv], [xb, ridge, cz], [xa, ridge, cz], rectAt, sag, cols, 4, fall, fold);
      // Faldón que cuelga del alero, más largo en unos tramos que en otros.
      const drops = Array.from({ length: 7 }, () => .1 + extra() * .24);
      const drop = s => { const k = Math.min(5, Math.floor(s * 6)); return drops[k] + (drops[k + 1] - drops[k]) * (s * 6 - k); };
      for (let i = 0; i < cols; i++) {
        const s0 = i / cols, s1 = (i + 1) / cols, [u0, v0, u1, v1] = rectAt(i, 0);
        const px = s => xa + (xb - xa) * s, top = s => eave - fall(s) - fold(s);
        skirtMin = Math.min(skirtMin, top(s0) - drop(s0), top(s1) - drop(s1));
        f.quadUV(finishes, [px(s0), top(s0) - drop(s0), zv], [px(s1), top(s1) - drop(s1), zv], [px(s1), top(s1), zv], [px(s0), top(s0), zv],
          [u0 + (u1 - u0) * s0, v0, u0 + (u1 - u0) * s1, v0, u0 + (u1 - u0) * s1, v0 + (v1 - v0) * .3, u0 + (u1 - u0) * s0, v0 + (v1 - v0) * .3]);
      }
    }
    // El faldón puede bajar hasta la altura de los ojos. La envolvente de cámara empieza por encima
    // del punto de mira de pie para que quien pase debajo conserve espacio para mirar y seguir andando.
    const lower = Math.max(1.86, skirtMin), hx = w / 2 + .15, hz = d / 2 + .15;
    const occluder = new THREE.Box3(new THREE.Vector3(cx - hx, lower, cz - hz), new THREE.Vector3(cx + hx, ridge, cz + hz));
    const ceiling = occluder.clone();
    ceiling.min.y = .12;
    ceiling.max.y = lower;
    cameraCovers.push({ ceiling, occluder });
    // Plástico o costal amarrado a un travesaño del costado: angosto, con dobleces a lo largo y la punta de abajo recogida.
    const shadeSide = extra() < .5 ? -1 : 1, shadeX = cx + shadeSide * (w / 2 - .08), shade = pick(['blueTarp', 'burlap', 'burlap', 'greenTarp'].filter(name => name !== tarp));
    f.box(finishes, shadeX, eave - .06, cz, .04, .04, d - .2, marketRect(finish.leg), ALL_FACES);
    {
      const [u0, v0, u1, v1] = marketRect(shade), from = extra() < .5 ? -1 : 1, wide = 1.15 + extra() * .35, long = 1.05 + extra() * .4;
      const gather = .3 + extra() * .3, skew = (extra() - .5) * .5, tuck = .15 + extra() * .3, folds = 2 + Math.floor(extra() * 2), deep = .05 + extra() * .04;
      const zTie = cz + from * (d / 2 - .14), cols = 6, rows = 4;
      const at = (i, j) => {
        const s = i / cols, t = j / rows, across = (s - .5) * (1 - gather * t * t) + .5 + skew * t * t;
        return [shadeX + shadeSide * (.05 + deep * (.35 + .65 * t) * Math.sin(s * Math.PI * folds + from)), eave - .05 - .05 * Math.sin(Math.PI * s) * (1 - t) - long * t * (1 - tuck * s * t), zTie - from * wide * across];
      };
      const uv = (i, j) => [u0 + (u1 - u0) * i / cols, v1 - (v1 - v0) * j / rows];
      const bounds = new THREE.Box3(), point = new THREE.Vector3();
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const a = at(i, j + 1), b = at(i + 1, j + 1), c = at(i + 1, j), e = at(i, j);
        for (const corner of [a, b, c, e]) bounds.expandByPoint(point.fromArray(corner));
        f.quadUV(finishes, a, b, c, e, [...uv(i, j + 1), ...uv(i + 1, j + 1), ...uv(i + 1, j), ...uv(i, j)]);
        f.quadUV(finishes, b, a, e, c, [...uv(i + 1, j + 1), ...uv(i, j + 1), ...uv(i, j), ...uv(i + 1, j)]);
      }
      cameraDisplays.push({ box: bounds, approach: .52 });
    }
    // Racimos de plátano colgados de un palo bajo la cumbrera, a la altura de los ojos.
    f.box(m.detail, cx, ridge - .34, cz, w - .3, .05, .05, 'woodDark', ALL_FACES);
    for (let i = 0; i < 3; i++) {
      const bx = cx + (i - 1) * (w / 3.4) + (extra() - .5) * .3, long = .5 + extra() * .22, top = 2.3 - extra() * .16, green = extra() < .7;
      f.box(m.detail, bx, top - .04, cz, .03, ridge - .34 - top + .04, .03, 'woodDark', SKIN | FACES.back);
      const box = produce.plantains(bx, top, cz, long, green, (extra() - .5) * .16, extra() * 3);
      // El giro rápido necesita margen para recoger el brazo antes de rozar el racimo.
      cameraDisplays.push({ box, approach: 1 });
    }
    // Costales parados en el suelo, panzones y cada uno recostado para su lado, con el cuello amarrado.
    for (let i = 0; i < 4; i++) {
      const bx = cx + (random() - .5) * (w - .7), bz = cz + (random() < .5 ? -1 : 1) * (d / 2 - .1);
      const size = .42 + random() * .16, tall = .5 + random() * .2;
      const lean = (extra() - .5) * .44, turn = extra() * 3;
      marketSack(batch, finishes, bx, bz, size, tall, lean, turn, i === 1 ? 'burlap' : finish.bag, (stall + i) % 2);
    }
    // Bultos de papa en una punta: dos acostados y uno recostado contra ellos.
    const end = cx - scaleSide * (w / 2 - .5);
    marketSackOnSide(batch, finishes, end + (extra() - .5) * .1, .12, cz + front * .95,
      .8, .37, .48, 0, (extra() - .5) * .5, 'burlap');
    const topSack = end + (extra() - .5) * .16, topTurn = (extra() - .5) * .7, topLean = (extra() - .5) * .2;
    marketSackOnSide(batch, finishes, topSack, .44, cz + front * .97, .74, .33, .46, topLean, topTurn, finish.bag, (stall + 1) % 2);
    const sideLean = -(scaleSide * .29 + (extra() - .5) * .14);
    marketSack(batch, finishes, end + scaleSide * .53, cz + front, .42, .66, sideLean, scaleSide * .14, finish.bag, stall % 2);
    // Canastos redondos al frente, colmados.
    for (let i = 0; i < 2; i++) {
      const bx = cx + (i ? .55 : -.45) + (extra() - .5) * .3, bz = cz + front * 1.02, good = goods[Math.floor(extra() * goods.length)];
      lathe(batch, finishes, marketRect('halfTimber'), bx, .12, bz,
        [[.19, 0], [.196, .02], [.258, .262], [.269, .275], [.27, .292], [.261, .3], [.251, .284]], 12);
      const seed = Math.floor(extra() * 0x100000000);
      produce.basket(good === 'produce' ? 'potato' : fruits[(stall + i) % fruits.length], bx, .4, bz, seed);
    }
    // Guacales vacíos apilados torcidos, del lado de la báscula.
    const pile = cx + scaleSide * (w / 2 - .42);
    for (let i = 0; i < 3; i++) {
      const px = pile + (extra() - .5) * .14, y = .12 + i * .25, pz = cz + front * (1.02 + (extra() - .5) * .1), turn = (extra() - .5) * .7;
      const crop = i === 2 ? pick(goods) : null;
      marketCrate(f, finishes, px, y, pz, .5, .24, .36, turn, 'woodDark', i === 1 ? finish.crate : null);
      if (crop) produce.tray(crop === 'produce' ? 'potato' : fruits[stall % fruits.length], px, y + .21, pz, .45, .31,
        37103 + stall * 18211, turn);
    }
    colliders.push({ x: cx, z: cz, w: w - .4, d: d - .9, h: 1.3 });
    for (let tx = Math.floor((cx - w / 2) / T + .5); tx <= Math.floor((cx + w / 2) / T + .5); tx++) {
      for (let tz = Math.floor((cz - d / 2 + .5) / T + .5); tz <= Math.floor((cz + d / 2 - .5) / T + .5); tz++) blockedTiles.push(`${tx},${tz}`);
    }
  }
  batch.finish(group, { name: 'Puestos de mercado', castShadow: true, visualOnly: [finishes] });
  group.children.find(mesh => mesh.material === m.detail).name = 'Soportes del surtido';
  produce.finish(group);
  return { group, colliders, blockedTiles, cameraCovers, cameraDisplays };
}
