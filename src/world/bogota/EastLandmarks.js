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
  /**
   * Lona por paños entre cuatro esquinas, con la tela caída hacia el medio y las rayas seguidas. `rectAt(i, j)` dice de
   * qué tela es cada paño (remiendos) y `fall(s)` cuánto se descuelga el borde de abajo a lo largo.
   */
  const cloth = (a, b, c, d, rectAt, sag, cols = 6, rows = 4, fall = null) => {
    const at = (s, t) => [0, 1, 2].map(k => (a[k] * (1 - s) + b[k] * s) * (1 - t) + (d[k] * (1 - s) + c[k] * s) * t
      - (k === 1 ? sag * Math.sin(Math.PI * t) * (.55 + .45 * Math.sin(Math.PI * s)) + (fall ? fall(s) * (1 - t) * (1 - t) : 0) : 0));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const s0 = i / cols, s1 = (i + 1) / cols, t0 = j / rows, t1 = (j + 1) / rows;
      const [u0, v0, u1, v1] = detailRect(typeof rectAt === 'function' ? rectAt(i, j) : rectAt);
      f.quadUV(m.detail, at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1),
        [u0 + (u1 - u0) * s0, v0 + (v1 - v0) * t0, u0 + (u1 - u0) * s1, v0 + (v1 - v0) * t0, u0 + (u1 - u0) * s1, v0 + (v1 - v0) * t1, u0 + (u1 - u0) * s0, v0 + (v1 - v0) * t1]);
    }
  };
  /**
   * Bulto redondeado de pocas caras: montón de fruta, costal o racimo. `from` recorta por abajo (0,5 es media bola),
   * `lean` lo recuesta, `turn` lo gira sobre el piso y `taper` lo adelgaza hacia abajo.
   */
  const blob = (cx, cy, cz, rx, ry, rz, rect, { from = 1, lean = 0, turn = 0, taper = 0, segs = 6, rings = 4 } = {}) => {
    const [u0, v0, u1, v1] = detailRect(rect), cl = Math.cos(lean), sl = Math.sin(lean), ct = Math.cos(turn), st = Math.sin(turn);
    const at = (i, j) => {
      const angle = i / segs * Math.PI * 2, v = j / rings * Math.PI * from, r = Math.sin(v) * (1 - taper * j / rings);
      const x = Math.sin(angle) * r * rx, y = Math.cos(v) * ry, z = Math.cos(angle) * r * rz;
      const lx = x * cl - y * sl, ly = x * sl + y * cl;
      return [cx + lx * ct + z * st, cy + ly, cz - lx * st + z * ct];
    };
    const uv = (i, j) => [u0 + (u1 - u0) * i / segs, v1 - (v1 - v0) * j / rings];
    for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
      const a = at(i, j + 1), b = at(i + 1, j + 1), c = at(i + 1, j), d = at(i, j);
      if (j === 0) f.tri(m.detail, a, b, d, [...uv(i, 1), ...uv(i + 1, 1), ...uv(i + .5, 0)]);
      else if (j === rings - 1 && from === 1) f.tri(m.detail, a, c, d, [...uv(i + .5, rings), ...uv(i + 1, j), ...uv(i, j)]);
      else f.quadUV(m.detail, a, b, c, d, [...uv(i, j + 1), ...uv(i + 1, j + 1), ...uv(i + 1, j), ...uv(i, j)]);
    }
  };
  /** Guacal girado sobre el piso: cuatro tablas y lo que lleva encima. */
  const crate = (cx, y, cz, w, h, d, turn, top) => {
    const c = Math.cos(turn), s = Math.sin(turn);
    const at = (x, yy, z) => [cx + x * c + z * s, yy, cz - x * s + z * c];
    const corners = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
    for (let k = 0; k < 4; k++) {
      const [xa, za] = corners[k], [xb, zb] = corners[(k + 1) % 4];
      f.quad(m.detail, at(xa, y, za), at(xb, y, zb), at(xb, y + h, zb), at(xa, y + h, za), k % 2 ? 'woodDark' : 'woodLight');
    }
    f.quad(m.detail, at(-w / 2, y + h - .03, d / 2), at(w / 2, y + h - .03, d / 2), at(w / 2, y + h - .03, -d / 2), at(-w / 2, y + h - .03, -d / 2), top);
  };
  const pick = list => list[Math.floor(extra() * list.length)];
  const x0 = MARKET.x0 * T, x1 = MARKET.x1 * T, z0 = MARKET.z0 * T, z1 = MARKET.z1 * T;
  const colliders = [], blockedTiles = [];
  const tarps = ['redStripe', 'greenTarp', 'blueStripe', 'blueTarp', 'orangeTarp', 'redStripe'];
  const patches = ['burlap', 'blueTarp', 'orangeTarp', 'greenTarp', 'stoneGray', 'plasterWhite'];
  const goods = ['fruit', 'produce'];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const cx = x0 + (x1 - x0) * (col + .5) / 3 + (random() - .5) * .3, cz = z0 + (z1 - z0) * (row === 0 ? .24 : .76);
    const w = 3.9, d = 2.6, tarp = tarps[(row * 3 + col) % tarps.length];
    const mended = patches.filter(name => name !== tarp);
    // Mesa con canastas: sobre cada una, un montón redondeado de fruta o de verdura.
    f.box(m.detail, cx, .92, cz, w - .5, .09, d - 1, 'woodLight', ALL_FACES);
    const crates = 3 + Math.floor(random() * 2), crateW = (w - .7) / crates;
    for (let c = 0; c < crates; c++) for (const side of [-1, 1]) {
      const crateX = cx - (w - .7) / 2 + crateW * (c + .5), crateZ = cz + side * (d - 1.1) / 4;
      f.box(m.detail, crateX, 1.01, crateZ, crateW - .08, .17, (d - 1.2) / 2 - .06, 'woodLight', FACES.front | FACES.back | FACES.left | FACES.right);
      const good = goods[Math.floor(random() * goods.length)], crateD = (d - 1.2) / 2 - .06;
      blob(crateX + (extra() - .5) * .05, 1.15, crateZ, (crateW - .08) * .52, .2 + extra() * .16, crateD * .54, good, { from: .5, rings: 2, segs: 7, turn: extra() });
      if (extra() < .4) blob(crateX + (extra() - .5) * .3, 1.2, crateZ + side * .08, .17, .2 + extra() * .1, .16, good, { from: .5, rings: 2, segs: 5 });
    }
    // Báscula de reloj en una punta de la mesa.
    const scaleX = cx + (extra() < .5 ? -1 : 1) * (w / 2 - .42);
    f.box(m.detail, scaleX, 1.01, cz, .3, .05, .3, 'iron', ALL_FACES & ~FACES.bottom);
    f.box(m.detail, scaleX, 1.06, cz, .05, .3, .05, 'iron', ALL_FACES & ~FACES.bottom);
    f.box(m.detail, scaleX, 1.3, cz, .24, .24, .07, 'plasterWhite', ALL_FACES);
    f.box(m.detail, scaleX, 1.56, cz, .34, .03, .3, 'stoneGray', ALL_FACES);
    for (const [du, dn] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      f.box(m.detail, cx + du * (w / 2 - .32), .12, cz + dn * (d / 2 - .58), .09, .8, .09, 'woodDark', SKIN);
    }
    // Armazón y toldo a dos caídas.
    for (const [du, dn] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      f.box(m.detail, cx + du * (w / 2 - .1), .12, cz + dn * (d / 2 - .1), .07, 2.32, .07, 'iron', SKIN);
    }
    const ridge = 2.95, eave = 2.32;
    for (const side of [1, -1]) {
      // Cada caída con su comba, su remiendo de otra tela, a veces un paño entero cambiado y una punta descolgada.
      const sag = .14 + extra() * .14, patchCol = Math.floor(extra() * 5), patchRow = 1 + Math.floor(extra() * 2), patch = pick(mended);
      const spare = extra() < .5 ? (extra() < .5 ? 0 : 5) : -1, other = pick(mended.filter(name => name !== 'stoneGray' && name !== 'plasterWhite'));
      const loose = extra() < .6 ? .14 + extra() * .2 : 0, corner = extra() < .5;
      const fall = s => loose * Math.pow(corner ? s : 1 - s, 3);
      const rectAt = (i, j) => (i === spare ? other : (j === patchRow && (i === patchCol || i === patchCol + 1) ? patch : tarp));
      const zv = cz + side * (d / 2 + .15), xa = cx - side * (w / 2 + .15), xb = cx + side * (w / 2 + .15);
      cloth([xa, eave, zv], [xb, eave, zv], [xb, ridge, cz], [xa, ridge, cz], rectAt, sag, 6, 4, fall);
      // Faldón que cuelga del alero, más largo en unos tramos que en otros.
      const drops = Array.from({ length: 7 }, () => .1 + extra() * .24);
      for (let i = 0; i < 6; i++) {
        const s0 = i / 6, s1 = (i + 1) / 6, [u0, v0, u1, v1] = detailRect(rectAt(i, 0));
        const px = s => xa + (xb - xa) * s;
        f.quadUV(m.detail, [px(s0), eave - fall(s0) - drops[i], zv], [px(s1), eave - fall(s1) - drops[i + 1], zv], [px(s1), eave - fall(s1), zv], [px(s0), eave - fall(s0), zv],
          [u0 + (u1 - u0) * s0, v0, u0 + (u1 - u0) * s1, v0, u0 + (u1 - u0) * s1, v0 + (v1 - v0) * .3, u0 + (u1 - u0) * s0, v0 + (v1 - v0) * .3]);
      }
    }
    // Plástico o costal amarrado a un travesaño del costado: angosto, con dobleces a lo largo y la punta de abajo recogida.
    const shadeSide = extra() < .5 ? -1 : 1, shadeX = cx + shadeSide * (w / 2 - .08), shade = pick(['blueTarp', 'burlap', 'burlap', 'greenTarp'].filter(name => name !== tarp));
    f.box(m.detail, shadeX, eave - .06, cz, .04, .04, d - .2, 'woodDark', ALL_FACES);
    {
      const [u0, v0, u1, v1] = detailRect(shade), from = extra() < .5 ? -1 : 1, wide = 1.15 + extra() * .35, long = 1.05 + extra() * .4;
      const gather = .3 + extra() * .3, skew = (extra() - .5) * .5, tuck = .15 + extra() * .3, folds = 2 + Math.floor(extra() * 2), deep = .05 + extra() * .04;
      const zTie = cz + from * (d / 2 - .14), cols = 6, rows = 4;
      const at = (i, j) => {
        const s = i / cols, t = j / rows, across = (s - .5) * (1 - gather * t * t) + .5 + skew * t * t;
        return [shadeX + shadeSide * (.05 + deep * (.35 + .65 * t) * Math.sin(s * Math.PI * folds + from)), eave - .05 - .05 * Math.sin(Math.PI * s) * (1 - t) - long * t * (1 - tuck * s * t), zTie - from * wide * across];
      };
      const uv = (i, j) => [u0 + (u1 - u0) * i / cols, v1 - (v1 - v0) * j / rows];
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const a = at(i, j + 1), b = at(i + 1, j + 1), c = at(i + 1, j), e = at(i, j);
        f.quadUV(m.detail, a, b, c, e, [...uv(i, j + 1), ...uv(i + 1, j + 1), ...uv(i + 1, j), ...uv(i, j)]);
        f.quadUV(m.detail, b, a, e, c, [...uv(i + 1, j + 1), ...uv(i, j + 1), ...uv(i, j), ...uv(i + 1, j)]);
      }
    }
    // Racimos de plátano colgados de un palo bajo la cumbrera, a la altura de los ojos.
    f.box(m.detail, cx, ridge - .34, cz, w - .3, .05, .05, 'woodDark', ALL_FACES);
    for (let i = 0; i < 3; i++) {
      const bx = cx + (i - 1) * (w / 3.4) + (extra() - .5) * .3, long = .5 + extra() * .22, top = 2.3 - extra() * .16, kind = extra() < .7 ? 'produce' : 'fruit';
      f.box(m.detail, bx, top - .04, cz, .03, ridge - .34 - top + .04, .03, 'woodDark', SKIN | FACES.back);
      blob(bx, top - long / 2, cz, .17, long / 2, .15, kind, { taper: .45, segs: 6, rings: 4, lean: (extra() - .5) * .16, turn: extra() * 3 });
    }
    // Costales parados en el suelo, panzones y cada uno recostado para su lado, con el cuello amarrado.
    for (let i = 0; i < 4; i++) {
      const bx = cx + (random() - .5) * (w - .7), bz = cz + (random() < .5 ? -1 : 1) * (d / 2 - .1);
      const size = .42 + random() * .16, tall = .5 + random() * .2;
      blob(bx, .1 + tall * .5, bz, size * .56, tall * .56, size * .46, 'burlap', { segs: 6, rings: 4, lean: (extra() - .5) * .44, turn: extra() * 3 });
      f.box(m.detail, bx, .1 + tall * .98, bz, size * .3, .1, size * .24, 'burlap', ALL_FACES & ~FACES.bottom);
    }
    // Bultos de papa en una punta: dos acostados y uno recostado contra ellos.
    const end = cx + (scaleX > cx ? -1 : 1) * (w / 2 - .5), front = row === 0 ? 1 : -1;
    blob(end + (extra() - .5) * .1, .3, cz + front * .95, .4, .19, .24, 'burlap', { turn: (extra() - .5) * .5 });
    blob(end + (extra() - .5) * .16, .62, cz + front * .97, .37, .17, .23, 'burlap', { turn: (extra() - .5) * .7, lean: (extra() - .5) * .2 });
    blob(end + (scaleX > cx ? .5 : -.5), .42, cz + front * 1.0, .2, .4, .22, 'burlap', { lean: (scaleX > cx ? .5 : -.5) + (extra() - .5) * .2 });
    // Canastos redondos al frente, colmados.
    for (let i = 0; i < 2; i++) {
      const bx = cx + (i ? .55 : -.45) + (extra() - .5) * .3, bz = cz + front * 1.02, good = goods[Math.floor(extra() * goods.length)];
      lathe(batch, m.detail, 'woodLight', bx, .12, bz, [[.19, 0], [.27, .3]], 8);
      blob(bx, .38, bz, .26, .2 + extra() * .1, .26, good, { from: .5, rings: 2, segs: 8 });
    }
    // Guacales vacíos apilados torcidos, del lado de la báscula.
    const pile = cx + (scaleX > cx ? 1 : -1) * (w / 2 - .42);
    for (let i = 0; i < 3; i++) {
      crate(pile + (extra() - .5) * .14, .12 + i * .25, cz + front * (1.02 + (extra() - .5) * .1), .5, .24, .36, (extra() - .5) * .7, i === 2 ? pick(goods) : 'woodDark');
    }
    colliders.push({ x: cx, z: cz, w: w - .4, d: d - .9, h: 1.3 });
    for (let tx = Math.floor((cx - w / 2) / T + .5); tx <= Math.floor((cx + w / 2) / T + .5); tx++) {
      for (let tz = Math.floor((cz - d / 2 + .5) / T + .5); tz <= Math.floor((cz + d / 2 - .5) / T + .5); tz++) blockedTiles.push(`${tx},${tz}`);
    }
  }
  batch.finish(group, { name: 'Puestos de mercado', castShadow: true });
  return { group, colliders, blockedTiles };
}
