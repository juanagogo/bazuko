// src/world/bogota/EastLandmarks.js
// Lugares que dan nombre a los barrios del oriente: iglesia y plaza de la Candelaria, torres curvas de
// ladrillo, plaza de mercado y arbolado grande de Chapinero. Solo decoración sólida, sin interiores.
import * as THREE from 'three';
import { rng } from './textures.js';
import { createBuildingShell } from './BuildingVisibility.js';
import { Batch, ALL_FACES, NO_BACK, SKIN, FACES, shellBox, wallStripUV } from './ZoneGeometry.js';
import { CHURCH, FOUNTAIN, MARKET } from './EastZones.js';
import { WALL_SHEET, TOWER_TILE, detailRect } from './ZoneTextures.js';
import { churchAtrium, churchBelfryArches, churchPlinth, churchPortal, churchRear, churchSide, churchWindow } from './EastChurchDetails.js';
import { clayRidge } from './EastRoofTiles.js';
import { towerBalconies, towerLevels, towerTerraceWall } from './CurvedTowerFacade.js';
import { buildPlazaFountainWater, FOUNTAIN_LIPS, fountainRimNotch } from './PlazaFountainWater.js';
import { addFountainNozzles, plazaFountainStone } from './PlazaFountainStone.js';
import { MarketProduce } from './MarketProduce.js';
import { MARKET_FINISHES, createMarketFinish, marketCrate, marketRect, marketSack, marketSackOnSide, marketTable } from './MarketFinish.js';
import { addMarketScale } from './MarketScale.js';

const T = 2;

const lathe = (batch, material, rect, x, y, z, radii, segments = 16, notch) => {
  // Revolución de pocos lados: base de la fuente y cúpulas, sin un objeto Three por pieza.
  const [u0, v0, u1, v1] = typeof rect === 'string' ? detailRect(rect) : rect;
  const point = ([radius, height, cut = 0], angle) => [
    x + Math.sin(angle) * radius, y + height - (cut ? notch(angle) * cut : 0), z + Math.cos(angle) * radius
  ];
  for (let r = 0; r < radii.length - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a0 = s / segments * Math.PI * 2, a1 = (s + 1) / segments * Math.PI * 2;
      batch.quadUV(material, point(radii[r], a0), point(radii[r], a1), point(radii[r + 1], a1), point(radii[r + 1], a0),
        [u0, v0, u1, v0, u1, v1, u0, v1]);
    }
  }
};

/** Iglesia colonial en el costado oriental de la plaza: dos torres, nave y portada de piedra. */
export function buildChurch(m) {
  const x0 = CHURCH.x0 * T - T / 2, x1 = CHURCH.x1 * T + T / 2, z0 = CHURCH.z0 * T - T / 2, z1 = CHURCH.z1 * T + T / 2;
  const sx = x1 - x0, sz = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const navH = 12.6;
  // Solo el pañete de la franja, por encima del zócalo de piedra que se monta en cada fachada.
  const stripUV = (w, h) => wallStripUV(0, .1, w, Math.min(h, WALL_SHEET.stripMeters - 1.25), 1.25);
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
    churchBelfryArches(front, f, m, { sx, u, n, w: towerW, y: belfry, top: belfry + up });
    // Vano abierto: se ve el cielo a través del campanario, con la campana a contraluz.
    const bellP = f.P(u, belfry + 1, (n - 5) / 2);
    lathe(front, m.detail, 'iron', bellP[0], bellP[1], bellP[2], [[.62, .02], [.5, .22], [.3, .9], [.2, 1.5], [.06, 1.75], [.02, 2.6]], 8);
    f.box(m.detail, u, belfry + 3.54, (n - 5) / 2, .16, .19, n + 5 - .18, 'woodDark', ALL_FACES);
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
    // Dos vanos sobrepuestos bajo cada campanario.
    for (const y of [7.4, 11.2]) {
      churchWindow(f, m, { u, bottom: y, width: 1.18, height: 2.24, n, texture: y < 8 ? 'glassCurtain' : 'glassDark' });
    }
    // Cornisas que cortan la torre en cuerpos.
    for (const y of [7, 14]) {
      f.box(m.detail, u, y - .222, (n - 5) / 2, towerW + .19, .102, n + 5 + .173, 'stoneGray', ALL_FACES);
      f.box(m.detail, u, y - .12, (n - 5) / 2, towerW + .24, .193, n + 5 + .228, 'stoneLight', ALL_FACES);
    }
    churchPlinth(f, m, towerW, n, u);
    for (const corner of [-1, 1]) for (let i = 0; i < 11; i++) {
      const w = i % 2 ? .33 : .54, edge = u + corner * (half - w / 2 - .012);
      f.box(m.detail, edge, 1.131 + i * .513, n + .021, w, .492, .061, 'stoneLight', NO_BACK);
    }
  }
  // Portada central de piedra con óculo y frontón de pañete.
  const centerW = sz - towerW * 2;
  const peak = 13.4;
  churchPortal(f, m, centerW, peak);
  f.box(m.detail, 0, peak - .1, .05, .16, 1.5, .16, 'iron', SKIN | FACES.top);
  f.box(m.detail, 0, peak + .85, .05, .9, .12, .12, 'iron', SKIN | FACES.top);
  front.finish(shell.walls.get(1), { name: 'Portada de iglesia', visualOnly: [m.ashlar] });
  // Las gradas pisables quedan visibles aunque el muro se abra en la cámara isométrica.
  const atrium = new Batch();
  churchAtrium(atrium.frame(1, sx / 2), m, sz);
  atrium.finish(shell.base, { name: 'Gradas del atrio', visualOnly: true });

  for (const face of [4, 5]) {
    const side = new Batch();
    churchSide(side.frame(face, sz / 2), m, sx);
    side.finish(shell.walls.get(face), { name: 'Costado de iglesia', visualOnly: [m.ashlar] });
  }
  const rear = new Batch();
  churchRear(rear.frame(0, sx / 2), m, sz);
  rear.finish(shell.walls.get(0), { name: 'Testero de iglesia', visualOnly: true });
  const roof = new Batch(), r = roof.frame(1, sx / 2);
  const roofRise = 5;
  const ridgeY = navH + roofRise;
  // Tejado de la nave con la cumbrera perpendicular a la plaza.
  const roofLength = Math.hypot(sz / 2 + .4, roofRise + .3) / 2, along = sx / 2;
  r.quadUV(m.clay, [-sz / 2 - .4, navH - .3, -sx - .3], [-sz / 2 - .4, navH - .3, -3], [0, ridgeY, -3], [0, ridgeY, -sx - .3], [0, 0, along, 0, along, roofLength, 0, roofLength]);
  r.quadUV(m.clay, [sz / 2 + .4, navH - .3, -3], [sz / 2 + .4, navH - .3, -sx - .3], [0, ridgeY, -sx - .3], [0, ridgeY, -3], [0, 0, along, 0, along, roofLength, 0, roofLength]);
  clayRidge(r, m.detail, 3, sx + .3, 0, ridgeY - .052, { perpendicular: true, width: .46 });
  // Hastial de la nave detrás del frontón: sin él se vería el tejado por debajo.
  const [g0, g1, g2, g3] = wallStripUV(0, .3, sz, 5, 1.2);
  r.tri(m.wall, [-sz / 2 - .4, navH - .3, -3], [sz / 2 + .4, navH - .3, -3], [0, ridgeY, -3], [g0, g1, g2, g1, (g0 + g2) / 2, g3]);
  r.tri(m.wall, [sz / 2, navH - .3, -sx], [-sz / 2, navH - .3, -sx], [0, ridgeY - .066, -sx], [g0, g1, g2, g1, (g0 + g2) / 2, g3]);
  roof.finish(shell.roof, { name: 'Tejado de iglesia', visualOnly: [m.detail] });
  return { shell, height: navH };
}
const wallFace = (w, h, y0 = 0) => {
  const floor = y0 > 0 ? 1.2 : 0;
  const [a, c, e, g] = wallStripUV(0, .4, w, Math.min(h, 6.8 - floor), floor);
  return [a, c, e, c, e, g, a, g];
};

const TOWER_SEGMENTS_PER_SHELL = 3;

/** Núcleo de respaldo dentro del arco y detrás de la fachada que se dibuja más allá del plano lejano. */
export function towerSilhouette(tower) {
  const { cx, cz, radius, thickness, a0, a1 } = tower;
  const levels = towerLevels(tower), step = (a1 - a0) / levels.length, middle = radius - thickness / 2;
  return levels.map((floors, i) => {
    const angle = a0 + step * (i + .5);
    return { x: cx + Math.cos(angle) * middle, z: cz + Math.sin(angle) * middle, rotation: -angle,
      w: thickness * .72, d: 2 * (radius - thickness * .86) * Math.tan(step / 2) * .94,
      h: floors * TOWER_TILE.floorMeters - .4, color: [.47, .22, .13], closedOnly: true };
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
      towerBalconies(shellBatch, m.tower, { r: radius, t0, t1, side: 1, levels: levels[i], bay: i });
      towerBalconies(shellBatch, m.tower, { r: inner, t0, t1, side: -1, levels: levels[i], bay: i });
      // Azotea de cada tramo, con el mismo ladrillo que el remate.
      const [c0, c1, c2, c3] = detailRect('concrete');
      capsBatch.quad(m.detail, point(inner, t0, height), point(inner, t1, height), point(radius, t1, height), point(radius, t0, height), [c0, c1, c2, c3]);
      // Hilada de arranque por encima del basamento. Se retira con la pared en isométrica.
      shellBatch.quad(m.detail, point(radius + .02, t1, .65), point(radius + .02, t0, .65),
        point(radius + .02, t0, .86), point(radius + .02, t1, .86), 'brick');
      // Muro de cierre donde el escalón cambia de altura.
      const next = levels[i + 1] ?? 0, previous = levels[i - 1] ?? 0;
      towerTerraceWall(shellBatch, m.tower, inner, radius, t1, next, levels[i], true, i);
      towerTerraceWall(shellBatch, m.tower, inner, radius, t0, previous, levels[i], false, i);
      // Primer piso: basamento de ladrillo liso con los accesos, base del recorte isométrico.
      baseBatch.quad(m.detail, point(radius + .05, t1, 0), point(radius + .05, t0, 0), point(radius + .05, t0, .65), point(radius + .05, t1, .65), 'brick');
      baseBatch.quad(m.detail, point(inner - .05, t0, 0), point(inner - .05, t1, 0), point(inner - .05, t1, .65), point(inner - .05, t0, .65), 'brick');
      // Piso del corte: al abrirse el tramo no queda un hueco sin geometría.
      baseBatch.quad(m.detail, point(inner - .05, t0, .65), point(inner - .05, t1, .65),
        point(radius + .05, t1, .65), point(radius + .05, t0, .65), 'concrete');
    }
    shellBatch.finish(wall, { name: 'Torre curva' });
    capsBatch.finish(roof, { name: 'Azoteas de torre' });
    baseBatch.finish(base, { name: 'Basamento de torre' });
    shells.push({ root, base, walls: new Map([[0, wall]]), roof, height: top });
  }
  return shells;
}
/** Fuente de piedra de la plaza: taza ancha, columna y un plato alto. */
export function buildFountain(m) {
  const batch = new Batch();
  const { x, z, radius, plinth } = FOUNTAIN, y = .12;
  const finish = plazaFountainStone(m.detail, { x, y, z, radius });
  const stone = (rect, profile, sides) => lathe(batch, m.detail, rect, x, y, z, profile, sides);
  const wetStone = (rect, profile, sides, lip) => lathe(batch, finish, rect, x, y, z, profile, sides,
    lip && (angle => fountainRimNotch(lip, angle)));
  const point = (r, angle, height) => [x + Math.sin(angle) * r, y + height, z + Math.cos(angle) * r];
  const basinSides = 40, tau = Math.PI * 2;

  // Cimiento, hilada de sillares y solera. Se mantienen el diámetro y los niveles del remate.
  stone('stoneGray', [[radius + .51, 0], [radius + plinth, .032], [radius + plinth, .109],
    [radius + .51, .145], [radius + .33, .16], [radius + .29, .195]], basinSides);
  for (let i = 0; i < basinSides; i++) {
    const a = i / basinSides, b = (i + 1) / basinSides;
    batch.quadUV(m.ashlar, point(radius + .29, a * tau, .195), point(radius + .29, b * tau, .195),
      point(radius + .25, b * tau, .62), point(radius + .25, a * tau, .62),
      [a * 4, .006, b * 4, .006, b * 4, .075, a * 4, .075]);
  }
  wetStone('stoneLight', [[radius + .25, .62], [radius + .36, .668], [radius + .36, .746],
    [radius + .30, .788], [radius - .05, .8], [radius - .075, .738]], basinSides);
  wetStone('stoneGray', [[radius - .075, .738], [radius - .086, .385], [radius - .11, .366],
    [.84, .366]], basinSides);

  stone('stoneGray', [[.92, .344], [.92, .465], [.88, .5], [.8, .54], [.71, .88],
    [.68, .925], [.67, 1.015], [.57, 1.08]], 48);
  const flutes = [[.57, 1.08, 0], [.55, 1.19, .043], [.43, 2.16, .034], [.45, 2.28, 0]];
  for (let row = 0; row < flutes.length - 1; row++) for (let i = 0; i < 48; i++) {
    const carved = ([r, h, cut], s) => point(r - (s % 4 === 1 || s % 4 === 2 ? cut : 0), s * tau / 48, h);
    batch.quad(m.detail, carved(flutes[row], i), carved(flutes[row], i + 1),
      carved(flutes[row + 1], i + 1), carved(flutes[row + 1], i), 'stoneGray');
  }

  // Los reboses salen por cuatro pasos labrados en cada labio.
  const { bowl, crown } = FOUNTAIN_LIPS;
  wetStone('stoneGray', [[.45, 2.28], [.48, 2.32], [.51, 2.385], [.58, 2.45],
    [1.36, 2.77], [1.46, 2.85], [1.53, 2.927], [1.55, 2.967]], bowl.sides);
  wetStone('stoneLight', [[1.55, 2.967], [1.55, 3.013, .009], [1.512, 3.048, .039],
    [1.477, 3.052, .044], [1.435, 3.027, .016]], bowl.sides, bowl);
  wetStone('stoneGray', [[1.435, 3.027, .016], [1.38, 2.991], [.31, 2.963],
    [.3, 3.13], [.28, 3.25], [.257, 3.765], [.28, 3.84], [.42, 3.96], [.7, 4.12]], bowl.sides, bowl);
  wetStone('stoneLight', [[.7, 4.12], [.7, 4.182, .016], [.673, 4.208, .046],
    [.622, 4.214, .054], [.594, 4.17, .01]], crown.sides, crown);
  wetStone('stoneGray', [[.594, 4.17, .01], [.55, 4.144], [.24, 4.138], [.2, 4.3],
    [.14, 4.86], [.03, 4.96], [0, 4.96]], crown.sides, crown);
  stone('iron', [[.167, 4.617], [.175, 4.624], [.173, 4.657], [.162, 4.666]], 24);
  addFountainNozzles(batch, m.detail, x, y, z);
  const group = new THREE.Group();
  group.name = 'Fuente de la plaza';
  batch.finish(group, { name: 'Fuente de la plaza', castShadow: true, visualOnly: [m.ashlar, finish] });
  const water = buildPlazaFountainWater({ x, y, z, radius });
  group.add(water);
  group.userData.water = water;
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
