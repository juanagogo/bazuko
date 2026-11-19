import * as THREE from 'three';
import { MeshKit, rgb, shade, canvasTexture, drawLedText } from './MeshKit.js';
import { BUS_DOOR_Z, BUS_DOOR_WIDTH, LED_ROUTES, busWipers } from './BusBody.js';
import { bridgeCenter, COLPATRIA } from './Colpatria.js';
import { LAKE_PARK } from './LakePark.js';
import { CALLES } from './StreetLayout.js';
import { TILE_SIZE } from '../../utils/constants.js';
import { createUrbanTree } from './UrbanTrees.js';
import { chainSunField, fadeGlowInFog } from './SunFieldShader.js';
import { sinGastarAzar } from './concretoViaducto.js';

export const TERMINAL = Object.freeze({ x: 75, z: -30, width: 4, length: 40,
  x0: 54, x1: 96, z0: -74, z1: 0, platformY: .92, northLane: 78.5, southLane: 71.5 });
export const inTerminal = (x, z) => x >= 54 && x <= 96 && z >= -74 && z <= 0;

// Separadores que apartan los carriles exclusivos de la calzada: se abren en los dos pasos peatonales.
const SEPARATORS = [[68.95, 69.8], [80.2, 81.05]];
const SEPARATOR_Z = [-55.6, -4.4];
const SEPARATOR_Y = .14;

export function terminalGroundHeight(x, z) {
  if (x >= 73 && x <= 77 && z >= -58 && z <= -2) {
    if (z < -50) return .02 + .9 * (z + 58) / 8;
    if (z > -10) return .02 + .9 * (-2 - z) / 8;
    return TERMINAL.platformY;
  }
  if (z >= SEPARATOR_Z[0] && z <= SEPARATOR_Z[1] && SEPARATORS.some(([a, b]) => x >= a && x <= b)) return SEPARATOR_Y;
  return x <= 59 || x >= 91 ? .12 : .02;
}

// Por dónde cabe a pie una persona de 40 cm de radio entre la calzada y la isla: del fin de la baranda al bolardo.
const ISLAND_GATES = [[-2.6, -1.88], [-58.12, -57.4]];
const ISLAND_BOLLARD_Z = [-1.4, -58.6];

const POLE_X = [69.38, 80.62], POLE_Z = [-14, -30, -46];

const POLE_CLEARANCE = .85;

/** El punto queda tan cerca de un poste del separador que ningún tramo del GPS puede salir de él. */
export const crowdsIslandPole = (x, z) => POLE_X.some(px => POLE_Z.some(pz => Math.hypot(x - px, z - pz) < POLE_CLEARANCE));

/** Una grilla de 2 m no ve muros, barandas ni postes delgados: el GPS pregunta aquí si un tramo los atraviesa. */
export function crossesIslandEdge(ax, az, bx, bz) {
  if (Math.max(ax, bx) < 68 || Math.min(ax, bx) > 82 || Math.min(az, bz) > 0) return false;
  const vx = bx - ax, vz = bz - az, length2 = vx * vx + vz * vz || 1;
  for (const x of POLE_X) for (const z of POLE_Z) {
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / length2));
    if (Math.hypot(ax + vx * t - x, az + vz * t - z) < POLE_CLEARANCE) return true;
  }
  for (const edge of [73, 77]) {
    if ((ax < edge) === (bx < edge)) continue;
    const z = az + (bz - az) * (edge - ax) / (bx - ax);
    if (z > -59.08 && z < -.92 && !ISLAND_GATES.some(([a, b]) => z >= a && z <= b)) return true;
  }
  for (const line of ISLAND_BOLLARD_Z) {
    if ((az < line) === (bz < line)) continue;
    const x = ax + (bx - ax) * (line - az) / (bz - az);
    if (x > 72.97 && x < 77.03 && Math.abs(x - TERMINAL.x) > .32) return true;
  }
  return false;
}

/** Sobre la isla el único paso sin estorbos es el eje: molinetes, bancas y taquillas ocupan los costados. */
export const islandAisleX = (x, z) => x >= 73 && x <= 77 && z >= -60 && z <= 0 ? TERMINAL.x : x;

const platformDoors = { east: { value: 0 }, west: { value: 0 } };
/** El bus que para abre las puertas de su lado: hacia el norte el carril oriental (X mayor), hacia el sur el occidental. */
export function setPlatformDoors(direction, amount) {
  (direction < 0 ? platformDoors.east : platformDoors.west).value = amount;
}

export function paintTerminalEntrance(map) {
  for (let z = 0; z <= 7; z++) for (let x = 27; x <= 48; x++) {
    map[z][x] = x <= 28 || x >= 47 ? 'sidewalk' : x >= 35 && x <= 40 ? 'busway' : 'road';
  }
}

const X_WEST = 73, X_EAST = 77, Z_NORTH = -50, Z_SOUTH = -10, FLOOR = TERMINAL.platformY, FLOOR_REPEAT = 3.6;
const WALL_WEST = 73.12, WALL_EAST = 76.88, DOOR_HEAD = 3.02, FRIEZE_TOP = 3.4, CEILING = 3.42;
const ROOF_HALF = 2.92, ROOF_EAVE = 3.95, ROOF_RISE = .74;
const roofY = x => ROOF_EAVE + ROOF_RISE * (1 - ((x - TERMINAL.x) / ROOF_HALF) ** 2);
/** ¿Queda bajo la cubierta del andén? */
export const underTerminalRoof = (x, z) => Math.abs(x - TERMINAL.x) <= ROOF_HALF && z >= Z_NORTH - .7 && z <= Z_SOUTH + .7;
// Cerchas cada 4 m; las columnas solo donde no estorban a una puerta: las de en medio cuelgan de la viga larga.
const TRUSS_Z = [-50, -46, -42, -38, -34, -30, -26, -22, -18, -14, -10];
const COLUMN_Z = [-50, -46, -42, -38, -30, -22, -18, -14, -10];

/** Puertas de andén: cada carril las tiene donde paran las del bus de ese sentido. */
export const platformDoorZ = {
  east: BUS_DOOR_Z.map(z => TERMINAL.z - z).sort((a, b) => a - b),
  west: BUS_DOOR_Z.map(z => TERMINAL.z + z).sort((a, b) => a - b)
};

const C = {
  steel: rgb('#4b5155'), steelDark: rgb('#2a2e31'), steelLight: rgb('#7b8186'), red: rgb('#8a2a26'), yellow: rgb('#e9b714'),
  concrete: rgb('#a9a89f'), concreteDark: rgb('#7f7e76'), curb: rgb('#c4c3b9'), kerbPaint: rgb('#d8b62c'), white: rgb('#e8e8e2'), black: rgb('#121315'),
  ceiling: rgb('#d6d6cf'), ceilingSeam: rgb('#8a8b86'), glass: rgb('#1d2c30'), wood: rgb('#5b4530'), green: rgb('#3f5a2a'), paint: rgb('#e8e7dc')
};

// ---------- texturas ----------

let shared = null;
function terminalTextures() {
  shared ??= {
    floor: canvasTexture(1024, 512, drawFloor, { repeat: true, anisotropy: 8 }),
    slab: canvasTexture(512, 512, drawBusway, { repeat: true, anisotropy: 8 }),
    grit: canvasTexture(256, 256, drawGrit, { repeat: true }),
    roof: canvasTexture(256, 128, drawRoof, { repeat: true }),
    roofNormal: roofNormalMap(),
    signs: canvasTexture(1024, 1024, drawSigns, { anisotropy: 8 }),
    legends: canvasTexture(512, 512, drawLegends, { anisotropy: 8 }),
    pool: canvasTexture(64, 64, drawPool, { anisotropy: 1 }),
    finishes: sinGastarAzar(2611, () => canvasTexture(FIN, FIN, drawFinishes, { anisotropy: 8 }))
  };
  return shared;
}

// Hoja de acabados: cielo raso, rojo gastado y columnas. Lo que no la usa cae en el blanco de la esquina (UV 0,0).
const FIN = 1024;
const FINISH = {
  ceiling: k => [(k % 4) * 256, Math.floor(k / 4) * 176, 256, 176],
  frieze: [[0, 352, 1024, 128], [0, 480, 1024, 128]],
  white: [0, 608, 192, 416], jamb: [192, 608, 256, 416], column: [448, 608, 256, 416]
};
/** UV dentro de un rectángulo de la hoja: s de izquierda a derecha, t de abajo arriba, con margen contra el filtrado. */
const finishUv = ([x, y, w, h], s, t, pad = 3) => [(x + pad + s * (w - 2 * pad)) / FIN, 1 - (y + pad + (1 - t) * (h - 2 * pad)) / FIN];
const RED_PAINT = '#8a2a26';

function blot(ctx, x, y, rx, ry, rgbText, alpha) {
  const r = Math.max(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, `rgba(${rgbText},${alpha})`); g.addColorStop(.6, `rgba(${rgbText},${alpha * .5})`); g.addColorStop(1, `rgba(${rgbText},0)`);
  ctx.save(); ctx.translate(x, y); ctx.scale(rx / r, ry / r);
  ctx.fillStyle = g; ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

function speckle(ctx, [x, y, w, h], random, count, light, dark, size = 1.6, darkShare = .5) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = random() >= darkShare ? `rgba(255,250,240,${light * random()})` : `rgba(20,16,14,${dark * random()})`;
    ctx.fillRect(x + random() * w, y + random() * h, .6 + random() * size, .6 + random() * size);
  }
}

function drawCeilingPanel(ctx, area, k, random) {
  const [x, y, w, h] = area;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#f2f0e8'; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    ctx.fillStyle = random() < .5 ? `rgba(120,110,92,${.03 + random() * .07})` : `rgba(255,255,248,${random() * .05})`;
    ctx.fillRect(x + i * w / 3, y + j * h / 2, w / 3, h / 2);
  }
  speckle(ctx, area, random, 1400, .16, .07, .9, .3);
  for (const [a, b] of [[x, x + w * .26], [x + w, x + w * .74]]) {
    const g = ctx.createLinearGradient(a, 0, b, 0);
    g.addColorStop(0, `rgba(74,68,58,${.2 + random() * .12})`); g.addColorStop(1, 'rgba(74,68,58,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  for (let i = 0; i < 5; i++) blot(ctx, x + random() * w, y + random() * h, 20 + random() * 40, 14 + random() * 26, '96,90,78', .05 + random() * .07);
  const stains = [1, 0, 2, 0, 1, 3, 0, 1][k];
  for (let s = 0; s < stains; s++) {
    const cx = x + (.12 + random() * .76) * w, cy = y + (.15 + random() * .7) * h, r = 16 + random() * 30;
    for (let i = 0; i < 4; i++) {
      const ox = cx + (random() - .5) * r * .7, oy = cy + (random() - .5) * r * .5, rr = r * (.5 + random() * .5), squash = .65 + random() * .35;
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(random() * Math.PI); ctx.scale(1, squash);
      const g = ctx.createRadialGradient(0, 0, rr * .15, 0, 0, rr);
      g.addColorStop(0, 'rgba(150,116,66,.1)'); g.addColorStop(.78, 'rgba(146,108,60,.17)'); g.addColorStop(.9, 'rgba(104,74,40,.32)'); g.addColorStop(1, 'rgba(104,74,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = 'rgba(58,54,48,.42)';
  for (let i = 1; i < 3; i++) ctx.fillRect(x + i * w / 3 - 2, y, 3, h);
  ctx.fillRect(x, y + h / 2 - 2, w, 3);
  ctx.fillStyle = 'rgba(255,255,250,.4)';
  for (let i = 1; i < 3; i++) ctx.fillRect(x + i * w / 3 + 1, y, 1, h);
  ctx.fillRect(x, y + h / 2 + 1, w, 1);
  ctx.strokeStyle = 'rgba(64,58,50,.32)'; ctx.lineWidth = 4; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  ctx.restore();
}

function drawRedPaint(ctx, area, random, { streaks = 40, chips = 14, chipBand = [0, 1], streakAlpha = .22 } = {}) {
  const [x, y, w, h] = area;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = RED_PAINT; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 30; i++) {
    const light = random() < .55;
    blot(ctx, x + random() * w, y + random() * h, 30 + random() * 90, 20 + random() * 60, light ? '170,92,78' : '52,16,14', (light ? .1 : .14) + random() * .14);
  }
  speckle(ctx, area, random, Math.round(w * h / 60), .08, .14, 1.8);
  for (let i = 0; i < streaks; i++) {
    const sx = x + random() * w, length = h * (.2 + random() * .8), width = 2 + random() * 7;
    const g = ctx.createLinearGradient(0, y, 0, y + length);
    g.addColorStop(0, `rgba(34,18,14,${streakAlpha + random() * streakAlpha})`); g.addColorStop(1, 'rgba(34,18,14,0)');
    ctx.fillStyle = g; ctx.fillRect(sx, y, width, length);
  }
  const dust = ctx.createLinearGradient(0, y, 0, y + h * .18);
  dust.addColorStop(0, 'rgba(70,60,52,.4)'); dust.addColorStop(1, 'rgba(70,60,52,0)');
  ctx.fillStyle = dust; ctx.fillRect(x, y, w, h * .18);
  for (let i = 0; i < chips; i++) {
    const cx = x + random() * w, cy = y + h * (1 - chipBand[0] - random() * (chipBand[1] - chipBand[0]));
    const rx = 2 + random() * 7, ry = 1.5 + random() * 4;
    ctx.fillStyle = 'rgba(30,14,12,.5)'; ctx.beginPath(); ctx.ellipse(cx + .8, cy + .8, rx + 1.2, ry + 1.2, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = random() < .6 ? '#8f8a82' : '#6e6a64'; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(150,120,110,${.25 + random() * .25})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (random() - .5) * 60, cy + (random() - .5) * 12); ctx.stroke();
  }
  ctx.restore();
}

function drawColumn(ctx, area, random) {
  const [x, y, w, h] = area, at = t => y + h * (1 - t);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#f1f0ec'; ctx.fillRect(x, y, w, h);
  speckle(ctx, area, random, 900, .1, .12);
  const plinth = ctx.createLinearGradient(0, at(0), 0, at(.16));
  plinth.addColorStop(0, 'rgba(58,50,40,.62)'); plinth.addColorStop(.45, 'rgba(70,62,50,.38)'); plinth.addColorStop(1, 'rgba(70,62,50,0)');
  ctx.fillStyle = plinth; ctx.fillRect(x, at(.16), w, at(0) - at(.16));
  for (let i = 0; i < 40; i++) blot(ctx, x + random() * w, at(random() * .1), 4 + random() * 12, 3 + random() * 8, '44,38,30', .12 + random() * .25);
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(24,22,20,${.25 + random() * .3})`; ctx.lineWidth = 1 + random() * 2;
    const sx = x + random() * w, sy = at(.02 + random() * .12);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 8 + random() * 26, sy + (random() - .5) * 6); ctx.stroke();
  }
  for (let i = 0; i < 9; i++) blot(ctx, x + random() * w, at(.38 + random() * .26), 8 + random() * 14, 10 + random() * 18, '92,84,72', .08 + random() * .1);
  const top = ctx.createLinearGradient(0, y, 0, at(.85));
  top.addColorStop(0, 'rgba(90,84,74,.22)'); top.addColorStop(1, 'rgba(90,84,74,0)');
  ctx.fillStyle = top; ctx.fillRect(x, y, w, at(.85) - y);
  ctx.restore();
}

function drawFinishes(ctx) {
  const random = seeded(4417);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, FIN, FIN);
  for (let k = 0; k < 8; k++) drawCeilingPanel(ctx, FINISH.ceiling(k), k, random);
  for (const area of FINISH.frieze) drawRedPaint(ctx, area, random, { streaks: 16, chips: 0, streakAlpha: .16 });
  drawRedPaint(ctx, FINISH.jamb, random, { streaks: 26, chips: 34, chipBand: [.38, .8] });
  {
    const [x, y, w, h] = FINISH.jamb, kick = ctx.createLinearGradient(0, y + h, 0, y + h * .9);
    kick.addColorStop(0, 'rgba(26,20,16,.6)'); kick.addColorStop(1, 'rgba(26,20,16,0)');
    ctx.fillStyle = kick; ctx.fillRect(x, y + h * .9, w, h * .1);
    for (let i = 0; i < 10; i++) blot(ctx, x + random() * w, y + h * (.42 + random() * .2), 8 + random() * 12, 10 + random() * 16, '30,18,14', .1 + random() * .12);
  }
  drawColumn(ctx, FINISH.column, random);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(...FINISH.white);
}

/** UV de una caja vertical (hx, hz: medio ancho) sobre una tira de la hoja que mide `slice` metros de ancho:
 *  cada cara toma su tajada sin partirse y la altura va de y0 a y1. */
function stripUv(area, cx, cz, hx, hz, y0, y1, slice, seed) {
  const frac = v => v - Math.floor(v), clamp = v => Math.min(1, Math.max(0, v));
  return (p, n) => {
    if (Math.abs(n[1]) > .5) return finishUv(area, .5, .99);
    const alongZ = Math.abs(n[0]) > .5, width = alongZ ? 2 * hz : 2 * hx;
    const local = alongZ ? p[2] - cz + hz : p[0] - cx + hx;
    const face = alongZ ? (n[0] > 0 ? 0 : 1) : (n[2] > 0 ? 2 : 3);
    const start = Math.max(0, 1 - width / slice) * frac(seed * .618 + face * .29);
    return finishUv(area, clamp(start + local / slice), clamp((p[1] - y0) / (y1 - y0)));
  };
}

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Sección completa del andén (4 m de ancho, se repite cada 3,6 m): baldosa, guía táctil y borde. */
function drawFloor(ctx, w, h) {
  const random = seeded(77);
  const pxX = w / 4, pxZ = h / FLOOR_REPEAT;
  ctx.fillStyle = '#8d8c85'; ctx.fillRect(0, 0, w, h);
  const tile = .4;
  // Junta oscura y cada baldosa con su tono: una sola tinta plana es lo que hacía parecer pintado el piso.
  ctx.fillStyle = '#5d5c56'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 9; j++) {
    const v = 126 + random() * 26 | 0, warm = random() * 5 | 0;
    ctx.fillStyle = `rgb(${v + warm},${v},${v - 7})`;
    ctx.fillRect(i * tile * pxX + 2, j * tile * pxZ + 2, tile * pxX - 4, tile * pxZ - 4);
  }
  // Pisadas: el centro del andén está más gastado que los bordes.
  const wear = ctx.createLinearGradient(0, 0, w, 0);
  wear.addColorStop(0, 'rgba(40,38,34,.18)'); wear.addColorStop(.3, 'rgba(40,38,34,.03)'); wear.addColorStop(.5, 'rgba(255,255,250,.05)'); wear.addColorStop(.7, 'rgba(40,38,34,.03)'); wear.addColorStop(1, 'rgba(40,38,34,.18)');
  ctx.fillStyle = wear; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(30,28,26,${random() * .08})`;
    ctx.fillRect(random() * w, random() * h, 1 + random() * 3, 1 + random() * 3);
  }
  // Manchas grandes de agua y mugre, y los chicles pegados que tiene todo andén con mucha gente.
  for (let i = 0; i < 16; i++) {
    const x = random() * w, y = random() * h, r = 24 + random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(36,34,30,${.05 + random() * .1})`); g.addColorStop(1, 'rgba(36,34,30,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fillStyle = 'rgba(28,27,26,.5)';
  for (let i = 0; i < 70; i++) { ctx.beginPath(); ctx.arc(random() * w, random() * h, 1 + random() * 2.2, 0, Math.PI * 2); ctx.fill(); }
  // Baldosa táctil amarilla a lo largo de las puertas, con sus botones; las bancas quedan por fuera de ella.
  const strip = .36;
  for (const x0 of [.84, 4 - .84 - strip]) {
    ctx.fillStyle = '#d9ad14'; ctx.fillRect(x0 * pxX, 0, strip * pxX, h);
    ctx.fillStyle = '#f0c52a';
    for (let a = 0; a < 6; a++) for (let b = 0; b < 48; b++) {
      ctx.beginPath(); ctx.arc((x0 + (a + .5) * strip / 6) * pxX, (b + .5) * h / 48, 3.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(70,50,0,.25)';
    for (let k = 0; k < 9; k++) ctx.fillRect(x0 * pxX, k * tile * pxZ, strip * pxX, 2);
    for (let i = 0; i < 26; i++) {
      const sx = (x0 + random() * strip) * pxX, sy = random() * h, r = 8 + random() * 22;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(104,96,78,${.22 + random() * .26})`); g.addColorStop(1, 'rgba(104,96,78,0)');
      ctx.save(); ctx.translate(sx, sy); ctx.scale(1, .6); ctx.translate(-sx, -sy);
      ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      ctx.restore();
    }
    const edge = ctx.createLinearGradient(x0 * pxX, 0, (x0 + strip) * pxX, 0);
    edge.addColorStop(0, 'rgba(60,52,36,.3)'); edge.addColorStop(.18, 'rgba(60,52,36,0)'); edge.addColorStop(.82, 'rgba(60,52,36,0)'); edge.addColorStop(1, 'rgba(60,52,36,.3)');
    ctx.fillStyle = edge; ctx.fillRect(x0 * pxX, 0, strip * pxX, h);
  }
  for (const [a, b, k] of [[.18, .84, .2], [1.35, 2.65, .14], [3.16, 3.82, .2]]) {
    const g = ctx.createLinearGradient(a * pxX, 0, b * pxX, 0);
    g.addColorStop(0, 'rgba(46,42,36,0)'); g.addColorStop(.5, `rgba(46,42,36,${k})`); g.addColorStop(1, 'rgba(46,42,36,0)');
    ctx.fillStyle = g; ctx.fillRect(a * pxX, 0, (b - a) * pxX, h);
    ctx.fillStyle = 'rgba(34,30,26,.32)';
    for (let i = Math.ceil(a / tile); i * tile < b; i++) ctx.fillRect(i * tile * pxX - 2, 0, 4, h);
    for (let j = 0; j < 9; j++) ctx.fillRect(a * pxX, j * tile * pxZ - 2, (b - a) * pxX, 4);
    ctx.strokeStyle = 'rgba(28,26,24,.16)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 30; i++) {
      const sx = (a + random() * (b - a)) * pxX, sy = random() * h;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + (random() - .5) * 30, sy + 10 + random() * 20, sx + (random() - .5) * 40, sy + 24 + random() * 40); ctx.stroke();
    }
  }
  const aspect = pxZ / pxX;
  for (let i = 0; i < 170; i++) {
    const nearDoor = random() < .55, x = nearDoor ? (random() < .5 ? .2 + random() * .9 : 2.9 + random() * .9) : .2 + random() * 3.6;
    const cx = x * pxX, cy = random() * h, r = 2 + random() * 3.6, old = random() < .4;
    ctx.fillStyle = old ? `rgba(128,126,118,${.5 + random() * .3})` : `rgba(22,21,20,${.55 + random() * .3})`;
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * aspect * (.8 + random() * .4), random() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  // Cinta de concreto bajo el muro de vidrio.
  ctx.fillStyle = '#6f6e68';
  ctx.fillRect(0, 0, .13 * pxX, h); ctx.fillRect(w - .13 * pxX, 0, .13 * pxX, h);
}

/** Losa de concreto de la troncal: juntas cada 4,5 m, huella de llantas y manchas de aceite en el centro del carril. */
function drawBusway(ctx, w, h) {
  const random = seeded(4321);
  ctx.fillStyle = '#8c8b84'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    const v = 110 + random() * 60 | 0;
    ctx.fillStyle = `rgba(${v},${v},${v - 6},${.05 + random() * .1})`;
    ctx.fillRect(random() * w, random() * h, 1 + random() * 4, 1 + random() * 4);
  }
  for (const c of [.156, .78]) {
    const g = ctx.createLinearGradient((c - .12) * w, 0, (c + .12) * w, 0);
    g.addColorStop(0, 'rgba(25,25,27,0)'); g.addColorStop(.5, 'rgba(25,25,27,.42)'); g.addColorStop(1, 'rgba(25,25,27,0)');
    ctx.fillStyle = g; ctx.fillRect((c - .12) * w, 0, .24 * w, h);
  }
  for (let i = 0; i < 26; i++) {
    const x = (.39 + random() * .16) * w, y = random() * h, r = 6 + random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(18,16,16,${.07 + random() * .16})`); g.addColorStop(1, 'rgba(18,16,16,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Junta transversal con su sello de brea.
  ctx.fillStyle = '#26262a'; ctx.fillRect(0, h / 2 - 2, w, 4);
  ctx.fillStyle = 'rgba(38,38,42,.5)'; ctx.fillRect(0, h - 2, w, 2); ctx.fillRect(0, 0, w, 2);
  ctx.fillStyle = 'rgba(38,38,42,.3)'; ctx.fillRect(w / 2 - 1, 0, 2, h);
  ctx.strokeStyle = 'rgba(30,30,32,.3)'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = random() * w, y = random() * h;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (random() - .5) * 18; y += 6 + random() * 14; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

/** Grano para concreto, separadores y andenes laterales, con juntas cada 1,5 m. */
function drawGrit(ctx, w, h) {
  const random = seeded(991);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) {
    const v = 130 + random() * 110 | 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${.08 + random() * .16})`;
    ctx.fillRect(random() * w, random() * h, 1 + random() * 3, 1 + random() * 3);
  }
  for (let i = 0; i < 26; i++) {
    const x = random() * w, y = random() * h, r = 10 + random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(70,66,60,${.04 + random() * .1})`); g.addColorStop(1, 'rgba(70,66,60,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fillStyle = 'rgba(40,38,36,.55)';
  ctx.fillRect(0, 0, w, 2); ctx.fillRect(0, h / 2 - 1, w, 2); ctx.fillRect(0, 0, 2, h); ctx.fillRect(w / 2 - 1, 0, 2, h);
}

/** Lámina acanalada: cuatro canales por metro y chorreones de óxido hacia la canal. */
function drawRoof(ctx, w, h) {
  const random = seeded(55);
  ctx.fillStyle = '#b3b7b7'; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const light = .5 + .5 * Math.cos(x / w * Math.PI * 2 * 4);
    ctx.fillStyle = `rgba(30,34,36,${.28 * (1 - light)})`;
    ctx.fillRect(x, 0, 1, h);
  }
  for (let i = 0; i < 40; i++) {
    const x = random() * w, up = random() < .5, length = 12 + random() * 42;
    ctx.fillStyle = `rgba(120,76,44,${.05 + random() * .13})`;
    ctx.fillRect(x, up ? 0 : h - length, 1 + random() * 3, length);
  }
}

/** Relieve de la lámina como datos: con mipmaps se aplana a lo lejos en vez de hacer muaré. */
function roofNormalMap() {
  const width = 64, data = new Uint8Array(width * 4 * 4);
  for (let x = 0; x < width; x++) {
    const slope = Math.sin(x / width * Math.PI * 2 * 4) * .55;
    const l = Math.hypot(slope, 1), nx = slope / l, nz = 1 / l;
    for (let y = 0; y < 4; y++) {
      const i = (y * width + x) * 4;
      data[i] = (nx * .5 + .5) * 255; data[i + 1] = 128; data[i + 2] = (nz * .5 + .5) * 255; data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, 4);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

const SIGN = {
  portal: [0, 0, 1024, 200], rail: [0, 200, 1024, 110], map: [0, 310, 420, 420],
  boardFromSouth: [430, 310, 594, 94], boardFromNorth: [430, 406, 594, 94],
  wagon1: [430, 510, 290, 92], wagon2: [730, 510, 290, 92], wagon3: [430, 610, 290, 92], wagon4: [730, 610, 290, 92],
  ticket: [0, 740, 512, 96], line: [512, 712, 512, 72], ad: [0, 850, 400, 170], ad2: [420, 850, 400, 170]
};
const atlasUv = size => ([x, y, w, h], turned = false) => {
  const u0 = x / size, u1 = (x + w) / size, v1 = 1 - y / size, v0 = 1 - (y + h) / size;
  return turned ? [[u1, v1], [u0, v1], [u0, v0], [u1, v0]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
};
const signUv = atlasUv(1024);

function drawSigns(ctx) {
  const redBox = ([x, y, w, h], title, sub) => {
    ctx.fillStyle = '#ad1620'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x, y + h - 5, w, 5);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(h * (sub ? .4 : .58))}px "Arial Narrow", Arial, sans-serif`;
    ctx.fillText(title, x + w / 2, y + h * (sub ? .36 : .52), w - 24);
    if (sub) {
      ctx.fillStyle = '#ffd84a';
      ctx.font = `600 ${Math.round(h * .2)}px "Arial Narrow", Arial, sans-serif`;
      ctx.fillText(sub, x + w / 2, y + h * .76, w - 24);
    }
  };
  ctx.fillStyle = '#17181a'; ctx.fillRect(0, 0, 1024, 1024);
  redBox(SIGN.portal, 'PORTAL DEL CENTRO', 'TRANSMILENIO · ACCESO PEATONAL');
  redBox(SIGN.rail, 'B12 · TRONCAL CARACAS', 'COSTADO ORIENTAL: NORTE   /   OCCIDENTAL: SUR');

  // Plano del corredor, con el norte arriba y los hitos a la altura que tienen en la ciudad.
  {
    const [x, y, w, h] = SIGN.map;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#f5f0df'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9d252c'; ctx.fillRect(0, 0, w, 52);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = '#f4c854'; ctx.fillRect(12, 10, 66, 32);
    ctx.fillStyle = '#2b2925'; ctx.font = 'bold 25px Arial'; ctx.fillText('B12', 21, 27);
    ctx.fillStyle = '#fff8e8'; ctx.font = 'bold 24px Arial'; ctx.fillText('Troncal Caracas', 92, 27);
    const py = z => 97 + (z - TERMINAL.z) * (h - 149) / (LAKE_PARK.lakeZ - TERMINAL.z);
    const px = wx => 88 + (wx - TERMINAL.x) * 1.45;
    ctx.fillStyle = '#cfddbe'; ctx.fillRect(16, py(LAKE_PARK.z0), w - 32, h - py(LAKE_PARK.z0) - 16);
    ctx.fillStyle = '#91b6b0'; ctx.beginPath(); ctx.ellipse(px(LAKE_PARK.lakeX), py(LAKE_PARK.lakeZ), 43, 14, 0, 0, Math.PI * 2); ctx.fill();
    for (const [a, b, name] of CALLES) {
      const row = py((a + b) * TILE_SIZE / 2);
      ctx.fillStyle = '#d6cbb9'; ctx.fillRect(16, row - 3, w - 32, 6);
      ctx.fillStyle = '#4e4a43'; ctx.font = '18px Arial'; ctx.fillText(name, 208, row - 16);
    }
    ctx.strokeStyle = '#a62b31'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    ctx.moveTo(px(TERMINAL.x), py(TERMINAL.z));
    for (let z = TERMINAL.z; z <= LAKE_PARK.lakeZ; z += 2) ctx.lineTo(px(bridgeCenter(z)), py(z));
    ctx.stroke();
    ctx.beginPath(); ctx.arc(px(TERMINAL.x), py(TERMINAL.z), 9, 0, Math.PI * 2);
    ctx.fillStyle = '#f7f0df'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#884247'; ctx.font = 'bold 14px Arial'; ctx.fillText('USTED ESTÁ AQUÍ', 116, 78);
    ctx.fillStyle = '#232b2b'; ctx.font = 'bold 22px Arial'; ctx.fillText('Portal del Centro', 116, 101);
    ctx.fillRect(px(COLPATRIA.x) - 3, py(COLPATRIA.z) - 9, 6, 15);
    ctx.font = 'bold 18px Arial'; ctx.textAlign = 'right'; ctx.fillText('Colpatria', px(COLPATRIA.x) - 9, py(COLPATRIA.z), 81);
    ctx.textAlign = 'left'; ctx.fillText(LAKE_PARK.name, 155, py(LAKE_PARK.lakeZ));
    ctx.restore();
  }

  // Oriente sirve al norte. Desde el otro acceso su andén queda a la izquierda.
  for (const [[x, y, w, h], east] of [[SIGN.boardFromSouth, 1], [SIGN.boardFromNorth, -1]]) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#070605'; ctx.fillRect(0, 0, w, h);
    drawLedText(ctx, 'DESTINOS B12', 16, 2, { cellW: 3.95, cellH: 2.4, color: '#ff7853' });
    const rowStyle = { cellW: 3.95, cellH: 2.6, color: '#ffc04d' };
    ctx.strokeStyle = rowStyle.color; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [label, row, direction] of [[LED_ROUTES.north[0], 14, east], [LED_ROUTES.south[0], 26, -east]]) {
      drawLedText(ctx, label, 16, row, rowStyle);
      const ax = direction > 0 ? w - 29 : 29, ay = (row + 3.5) * rowStyle.cellH;
      ctx.beginPath();
      ctx.moveTo(ax - direction * 13, ay); ctx.lineTo(ax + direction * 13, ay);
      ctx.moveTo(ax + direction * 5, ay - 6); ctx.lineTo(ax + direction * 13, ay); ctx.lineTo(ax + direction * 5, ay + 6);
      ctx.stroke();
    }
    ctx.restore();
  }
  [[SIGN.wagon1, 'VAGÓN 1'], [SIGN.wagon2, 'VAGÓN 2'], [SIGN.wagon3, 'VAGÓN 3'], [SIGN.wagon4, 'VAGÓN 4']].forEach(([box, label]) => redBox(box, label, LED_ROUTES.north[1]));
  redBox(SIGN.ticket, 'TAQUILLA · RECARGAS');
  {
    const [x, y, w, h] = SIGN.line;
    ctx.fillStyle = '#f0c52a'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#17181a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 32px "Arial Narrow", Arial, sans-serif';
    ctx.fillText('ESPERE DETRÁS DE LA LÍNEA AMARILLA', x + w / 2, y + h / 2, w - 20);
  }
  // Avisos del barrio, sin marcas.
  {
    const [x, y, w, h] = SIGN.ad;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#f6c21d'); g.addColorStop(1, '#e8842a');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#231a12'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 54px "Arial Narrow", Arial, sans-serif'; ctx.fillText('EMPANADAS', x + w / 2, y + 58, w - 20);
    ctx.font = '700 30px "Arial Narrow", Arial, sans-serif'; ctx.fillText('A LA SALIDA DEL PORTAL', x + w / 2, y + 116, w - 20);
    const [a, b, c, d] = SIGN.ad2;
    ctx.fillStyle = '#123a5e'; ctx.fillRect(a, b, c, d);
    ctx.fillStyle = '#fff'; ctx.font = '900 42px "Arial Narrow", Arial, sans-serif'; ctx.fillText('RECARGUE SU TARJETA', a + c / 2, b + 62, c - 16);
    ctx.fillStyle = '#ffd84a'; ctx.font = '700 28px "Arial Narrow", Arial, sans-serif'; ctx.fillText('EN TAQUILLA O EN CAJERO', a + c / 2, b + 116, c - 16);
  }
}

const LEGEND = { bus: [0, 64, 512, 128], arrow: [0, 200, 128, 256], bike: [280, 200, 220, 160], stop: [280, 370, 220, 100] };
const legendUv = atlasUv(512);
function drawLegends(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 96px "Arial Narrow", Arial, sans-serif';
  ctx.fillText('SOLO BUS', 256, 128, 500);
  {
    const [x, y, wd, ht] = LEGEND.arrow;
    ctx.beginPath();
    ctx.moveTo(x + wd * .36, y + ht); ctx.lineTo(x + wd * .36, y + ht * .35); ctx.lineTo(x + wd * .12, y + ht * .35);
    ctx.lineTo(x + wd * .5, y); ctx.lineTo(x + wd * .88, y + ht * .35); ctx.lineTo(x + wd * .64, y + ht * .35); ctx.lineTo(x + wd * .64, y + ht);
    ctx.closePath(); ctx.fill();
  }
  // Bicicleta de la cicloruta.
  {
    const [x, y, wd, ht] = LEGEND.bike;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    const r = ht * .28, ax = x + wd * .24, bx = x + wd * .76, wy = y + ht * .66;
    ctx.beginPath(); ctx.arc(ax, wy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, wy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax, wy); ctx.lineTo(x + wd * .42, y + ht * .34); ctx.lineTo(x + wd * .68, y + ht * .34); ctx.lineTo(bx, wy);
    ctx.moveTo(ax, wy); ctx.lineTo(x + wd * .5, wy); ctx.lineTo(x + wd * .42, y + ht * .34);
    ctx.moveTo(x + wd * .5, wy); ctx.lineTo(x + wd * .68, y + ht * .34); ctx.moveTo(x + wd * .68, y + ht * .34); ctx.lineTo(x + wd * .65, y + ht * .2); ctx.stroke();
  }
  ctx.font = '900 92px "Arial Narrow", Arial, sans-serif';
  ctx.fillText('PARE', LEGEND.stop[0] + LEGEND.stop[2] / 2, LEGEND.stop[1] + LEGEND.stop[3] / 2, LEGEND.stop[2] - 8);
}

function drawPool(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.45, 'rgba(255,255,255,.34)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// ---------- materiales ----------

function reflectivePatch(shader) {
  // Vidrio con reflejo de película: el 4 % de un vidrio común no se nota en la calle.
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.specularColorBlended = vec3(.16);');
}

function doorPatch(material, withReflection) {
  material.onBeforeCompile = shader => {
    shader.uniforms.doorEast = platformDoors.east;
    shader.uniforms.doorWest = platformDoors.west;
    shader.vertexShader = `attribute float aSlide;\nuniform float doorEast;\nuniform float doorWest;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.z += aSlide * (position.x > 75.0 ? doorEast : doorWest);');
    if (withReflection) reflectivePatch(shader);
  };
  material.customProgramCacheKey = () => `andén-puerta:${withReflection}`;
  return chainSunField(material);
}

/** Materiales de la estación; `lampTone` y las intensidades emisivas hacen de luz: nada de luces nuevas. */
function createMaterials(lampTone) {
  const textures = terminalTextures();
  const lamps = new THREE.MeshBasicMaterial({ name: 'luminarias', vertexColors: true, toneMapped: false });
  lamps.onBeforeCompile = shader => {
    shader.uniforms.lampNight = lampTone;
    shader.vertexShader = `uniform float lampNight;\nvarying float vLampGlow;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLampGlow = mix(uv.x, uv.y, lampNight);');
    shader.fragmentShader = `varying float vLampGlow;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vLampGlow;');
  };
  lamps.customProgramCacheKey = () => 'estación-lámpara';
  const glassBase = { vertexColors: true, transparent: true, depthWrite: false, roughness: .05, metalness: 0, side: THREE.DoubleSide, forceSinglePass: true };
  // El emisivo del vidrio es lo que deja leer desde la calle que adentro hay luz.
  const glowing = { emissive: '#ffe6bd', emissiveIntensity: 0 };
  const glass = new THREE.MeshStandardMaterial({ name: 'vidrio estación', ...glassBase, ...glowing });
  glass.onBeforeCompile = reflectivePatch;
  glass.customProgramCacheKey = () => 'estación-vidrio';
  chainSunField(glass);
  // Las juntas no brillan: el emisivo sigue al color de vértice.
  const bounce = material => {
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;');
    };
    material.customProgramCacheKey = () => 'estación-emisivo-vértice';
    return chainSunField(material);
  };
  const finish = { map: textures.finishes, emissiveMap: textures.finishes };
  const ceiling = bounce(new THREE.MeshStandardMaterial({ name: 'cielo raso', vertexColors: true, ...finish, emissive: CEILING_DAY, emissiveIntensity: DAY_CEILING_GLOW, roughness: .75 }));
  return {
    floor: new THREE.MeshStandardMaterial({ name: 'baldosa', map: textures.floor, emissiveMap: textures.floor, emissive: '#fff0d8', emissiveIntensity: .07, roughness: .42 }),
    concrete: new THREE.MeshStandardMaterial({ name: 'concreto', vertexColors: true, map: textures.grit, roughness: .88 }),
    slab: new THREE.MeshStandardMaterial({ name: 'losa troncal', map: textures.slab, roughness: .86 }),
    steel: new THREE.MeshStandardMaterial({ name: 'acero', vertexColors: true, map: textures.finishes, roughness: .46, metalness: .22 }),
    // Lo que está bajo el techo: el rebote del andén no existe en la escena y sin esto molinetes y columnas se ven negros.
    inside: bounce(new THREE.MeshStandardMaterial({ name: 'acero bajo techo', vertexColors: true, ...finish, roughness: .5, metalness: .12, emissive: CEILING_DAY, emissiveIntensity: DAY_INSIDE_GLOW })),
    roof: new THREE.MeshStandardMaterial({ name: 'lámina', vertexColors: true, map: textures.roof, normalMap: textures.roofNormal, roughness: .5, metalness: .25 }),
    ceiling,
    lamps,
    glass,
    doorFrame: doorPatch(new THREE.MeshStandardMaterial({ name: 'marco puerta', vertexColors: true, map: textures.finishes, roughness: .45, metalness: .1 }), false),
    doorGlass: doorPatch(new THREE.MeshStandardMaterial({ name: 'hoja puerta', ...glassBase, ...glowing }), true),
    signs: new THREE.MeshStandardMaterial({ name: 'letreros', map: textures.signs, emissiveMap: textures.signs, emissive: '#ffffff', emissiveIntensity: .12, roughness: .4 }),
    // El tablero brilla igual de día: un LED apagado por el sol es lo primero que delata la pintura.
    board: new THREE.MeshBasicMaterial({ name: 'tablero', map: textures.signs, toneMapped: false }),
    paint: new THREE.MeshStandardMaterial({ name: 'pintura vial', vertexColors: true, roughness: .78, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    legends: new THREE.MeshStandardMaterial({ name: 'leyendas', vertexColors: true, map: textures.legends, transparent: true, depthWrite: false, roughness: .78, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    pools: fadeGlowInFog(new THREE.MeshBasicMaterial({ name: 'charcos de luz', map: textures.pool, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }))
  };
}

// ---------- construcción ----------

const lerp = (a, b, t) => a + (b - a) * t;
const lerpColor = (a, b, t) => a.map((value, i) => lerp(value, b[i], t));
// La luz que rebota del andén no existe en la escena: sin esto el cielo raso se ve café de día.
const DAY_CEILING_GLOW = .4, DAY_INSIDE_GLOW = .22, CEILING_DAY = '#e4e9ee', CEILING_NIGHT = '#fff0d8';
// De noche baldosa y cielo raso brillan poco y parejo; lo que se lee como luz son los charcos bajo cada luminaria.
const NIGHT_FLOOR_GLOW = .2, NIGHT_CEILING_GLOW = .2, NIGHT_POOLS = { floor: .28, halo: .55, lane: .2 };
const TONE = { luminaire: [.34, 1.5], head: [.4, 1.55], green: [.85, 1.1], red: [.7, 1], eave: [.16, 1.25], reader: [.7, 1] };

function createKits() {
  const concrete = new MeshKit();
  concrete.uvOf = (p, n) => {
    if (Math.abs(n[1]) > .7) return [p[0] / 3, p[2] / 3];
    return Math.abs(n[0]) > .7 ? [p[2] / 3, p[1] / 3] : [p[0] / 3, p[1] / 3];
  };
  const road = new MeshKit();
  road.uvOf = p => [p[0] / 14, p[2] / 14];
  return { road, floor: new MeshKit(), concrete, slab: new MeshKit(), steel: new MeshKit(), inside: new MeshKit(), roof: new MeshKit(), ceiling: new MeshKit(), lamps: new MeshKit(), glass: new MeshKit({ alpha: true }),
    doorFrame: new MeshKit({ slide: true }), doorGlass: new MeshKit({ slide: true, alpha: true }), signs: new MeshKit(), board: new MeshKit(), paint: new MeshKit(), legends: new MeshKit(), pools: new MeshKit() };
}

const solidBox = (colliders, x0, x1, y0, y1, z0, z1) => {
  colliders.push({ box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), mesh: new THREE.Object3D(), layered: true });
};

const UP = [0, 1, 0];

/** Calle: calzada de asfalto, losas de la troncal, andenes con cuneta, separadores, cicloruta y pintura. */
function buildStreet(kits, colliders) {
  const { road, concrete, slab, paint, legends, steel, lamps, pools, signs } = kits;
  for (const [a, b] of [[59, 69.8], [80.2, 91]]) road.quad([a, .02, 0], [b, .02, 0], [b, .02, -74], [a, .02, -74], [1, 1, 1], { normal: UP, facing: UP });
  // Frente a las dos puntas de la isla la calle sigue entera: el rectángulo no queda sin piso.
  for (const [a, b] of [[0, -2], [-58, -74]]) road.quad([X_WEST, .02, a], [X_EAST, .02, a], [X_EAST, .02, b], [X_WEST, .02, b], [1, 1, 1], { normal: UP, facing: UP });

  // Losas de los carriles exclusivos: el occidental va en espejo para que la huella caiga bajo las llantas.
  for (const [near, far] of [[X_EAST, 80.2], [X_WEST, 69.8]]) {
    slab.quad([near, .02, 0], [far, .02, 0], [far, .02, -74], [near, .02, -74], [1, 1, 1], { normal: UP, facing: UP, uv: [[0, 0], [1, 0], [1, 74 / 9], [0, 74 / 9]] });
  }

  // Andenes laterales con bordillo, cuneta y cicloruta.
  for (const [x0, x1, s] of [[54, 59, 1], [91, 96, -1]]) {
    const edge = s > 0 ? x1 : x0;
    concrete.quad([x0, .12, 0], [x1, .12, 0], [x1, .12, -74], [x0, .12, -74], C.concrete, { facing: UP });
    concrete.quad([edge, .02, 0], [edge, .12, 0], [edge, .12, -74], [edge, .02, -74], shade(C.curb, .85), { facing: [s, 0, 0] });
    const a = edge - s * .18;
    concrete.quad([a, .121, 0], [edge, .121, 0], [edge, .121, -74], [a, .121, -74], C.curb, { facing: UP });
    // Cuneta oscura con sus sumideros.
    const g0 = edge + s * .02, g1 = edge + s * .42, wet = shade(C.concreteDark, .55), dry = shade(C.concreteDark, .8);
    concrete.quad([g0, .03, 0], [g1, .03, 0], [g1, .03, -74], [g0, .03, -74], [wet, dry, dry, wet], { facing: UP });
    for (let z = -8; z > -74; z -= 13) {
      steel.box(edge + s * .22, .034, z, .34, .012, .8, shade(C.black, 1.4));
      for (let k = -3; k <= 3; k++) steel.box(edge + s * .22, .042, z + k * .1, .3, .006, .022, C.steelDark);
    }
    // Cicloruta rojiza con su línea y el pictograma, muy de Bogotá.
    const c0 = s > 0 ? 56.6 : 91.9, c1 = s > 0 ? 58.2 : 93.5;
    paint.quad([c0, .124, 0], [c1, .124, 0], [c1, .124, -74], [c0, .124, -74], rgb('#7c2f26'), { facing: UP });
    for (const x of [c0 + .03, c1 - .03]) paint.quad([x - .03, .126, 0], [x + .03, .126, 0], [x + .03, .126, -74], [x - .03, .126, -74], rgb('#d4d3c9'), { facing: UP });
    for (let z = -10; z > -72; z -= 16) {
      const cx = (c0 + c1) / 2;
      legends.quad([cx - .55, .128, z + .4], [cx + .55, .128, z + .4], [cx + .55, .128, z - .4], [cx - .55, .128, z - .4], C.paint, { facing: UP, uv: legendUv(LEGEND.bike) });
    }
  }

  // Separadores: bordillo alto con franja verde; rompen el rectángulo de asfalto y encajan con terminalGroundHeight.
  const [sz0, sz1] = SEPARATOR_Z, top = SEPARATOR_Y;
  for (const [x0, x1] of SEPARATORS) {
    concrete.quad([x0, .02, sz0], [x0, top, sz0], [x0, top, sz1], [x0, .02, sz1], shade(C.curb, .78), { facing: [-1, 0, 0] });
    concrete.quad([x1, .02, sz0], [x1, top, sz0], [x1, top, sz1], [x1, .02, sz1], shade(C.curb, .78), { facing: [1, 0, 0] });
    concrete.quad([x0, .02, sz0], [x1, .02, sz0], [x1, top, sz0], [x0, top, sz0], shade(C.curb, .7), { facing: [0, 0, -1] });
    concrete.quad([x0, .02, sz1], [x1, .02, sz1], [x1, top, sz1], [x0, top, sz1], shade(C.curb, .7), { facing: [0, 0, 1] });
    concrete.quad([x0, top, sz0], [x0 + .16, top, sz0], [x0 + .16, top, sz1], [x0, top, sz1], C.curb, { facing: UP });
    concrete.quad([x1 - .16, top, sz0], [x1, top, sz0], [x1, top, sz1], [x1 - .16, top, sz1], C.curb, { facing: UP });
    // Prado corto en el centro: de color, no de geometría, para que el piso siga plano bajo los pies.
    concrete.quad([x0 + .16, top, sz0], [x1 - .16, top, sz0], [x1 - .16, top, sz1], [x0 + .16, top, sz1], C.green, { facing: UP });
    // Amarillo y negro en las puntas, donde el bus puede rozar.
    for (const z of SEPARATOR_Z) for (let k = 0; k < 4; k++) {
      const dir = z < -30 ? 1 : -1, a = z + dir * k * .5, b = a + dir * .5;
      paint.quad([x0, top + .002, a], [x1, top + .002, a], [x1, top + .002, b], [x0, top + .002, b], k % 2 ? C.black : C.kerbPaint, { facing: UP });
    }
  }

  // Pintura vial: líneas continuas con hueco en las dos cebras.
  const line = (x0, x1, z0, z1, color = C.paint) => paint.quad([x0, .03, z0], [x1, .03, z0], [x1, .03, z1], [x0, .03, z1], color, { facing: UP });
  const openStretches = [[0, -.8], [-3.2, -56.6], [-59.2, -74]];
  const legend = (cx, z, halfX, halfZ, rect, turned, color = C.paint) => legends.quad([cx - halfX, .03, z + halfZ], [cx + halfX, .03, z + halfZ], [cx + halfX, .03, z - halfZ], [cx - halfX, .03, z - halfZ], color, { facing: UP, uv: legendUv(rect, turned) });
  for (const x of [70, 72.86, 77.14, 80]) for (const [a, b] of openStretches) line(x - .06, x + .06, a, b, rgb('#e2b71c'));
  for (const x of [59.9, 90.1]) for (const [a, b] of openStretches) line(x - .05, x + .05, a, b);
  // Carriles exclusivos: leyenda y flecha en el sentido de cada uno, con su línea de pare.
  for (const [cx, turned, zList] of [[78.5, false, [-64.5, -7]], [71.5, true, [-11, -64.5]]]) {
    for (const z of zList) {
      // En amarillo, como las leyendas de la troncal que llega hasta aquí.
      legend(cx, z, 1.25, .85, LEGEND.bus, turned, C.kerbPaint);
      legend(cx, z + (turned ? 3.4 : -3.4), .55, 1.6, LEGEND.arrow, turned, C.kerbPaint);
    }
  }
  line(77.2, 79.94, -56.2, -55.75); line(70.06, 72.8, -4.3, -3.85);
  // Calzada mixta de dos carriles por lado: al occidente baja hacia Z mayor, al oriente sube, como la troncal.
  for (const x of [64.4, 85.6]) for (const [a, b] of [[-3.6, -56], [-60, -73]]) {
    for (let z = a; z - 2.6 > b; z -= 5) line(x - .06, x + .06, z, z - 2.6);
  }
  const approach = (x0, x1, stopZ, flow) => {
    line(x0, x1, stopZ - .22, stopZ + .22);
    const cx = (x0 + x1) / 2, turned = flow > 0;
    legend(cx, stopZ - flow * 2.2, 1.1, .5, LEGEND.stop, turned);
    for (const lane of [cx - (x1 - x0) / 4, cx + (x1 - x0) / 4]) legend(lane, stopZ - flow * 6, .5, 1.5, LEGEND.arrow, turned);
  };
  approach(60, 68.8, -4.1, 1); approach(60, 68.8, -60.2, 1); approach(81.2, 90, -56, -1);
  // Pasos peatonales de orilla a orilla: la cebra es lo primero que se reconoce desde lejos.
  for (const [z, zIsland] of [[-58, -59.15], [-2, -.85]]) for (let x = 59.6; x < 90.8; x += .95) {
    // Sobre la rampa no hay cebra: solo el pedazo de calle que queda delante de su arranque.
    const onIsland = x + .5 > X_WEST && x < X_EAST;
    if (onIsland) line(x, x + .5, z, zIsland, rgb('#ececde'));
    else line(x, x + .5, z + 1.15, z - 1.15, rgb('#ececde'));
  }
  // Achurado amarillo en la punta norte, entre los dos carriles exclusivos que se abren.
  for (let z = -61; z > -72; z -= 1.6) {
    paint.quad([X_WEST + .1, .03, z], [X_WEST + .3, .03, z], [X_EAST - .1, .03, z - 1.1], [X_EAST - .3, .03, z - 1.1], rgb('#e2b71c'), { facing: UP });
  }
  for (const x of [X_WEST + .04, X_EAST - .04]) line(x - .04, x + .04, -60, -73, rgb('#e2b71c'));

  // Postes de la calle sobre el separador: el brazo sale hacia la calzada y la cabeza es emisiva.
  const poleTop = 8.2;
  lamps.uvOf = () => TONE.head;
  for (const [x, armDir] of [[POLE_X[0], -1], [POLE_X[1], 1]]) for (const z of POLE_Z) {
    steel.box(x, top + .2, z, .34, .4, .34, C.steelDark, { bottom: .7 });
    steel.tube([[x, top, z], [x, poleTop, z]], .075, 8, shade(C.steelLight, .9), { caps: false });
    steel.tube([[x, poleTop - .25, z], [x + armDir * .9, poleTop + .12, z], [x + armDir * 1.9, poleTop + .2, z]], .038, 6, shade(C.steelLight, .9));
    steel.box(x + armDir * 2.1, poleTop + .2, z, .72, .09, .24, C.steelDark);
    const hx0 = x + armDir * 1.78, hx1 = x + armDir * 2.42;
    lamps.quad([hx0, poleTop + .148, z - .1], [hx1, poleTop + .148, z - .1], [hx1, poleTop + .148, z + .1], [hx0, poleTop + .148, z + .1], rgb('#fff0cc'), { facing: [0, -1, 0] });
    solidBox(colliders, x - .2, x + .2, 0, 3, z - .2, z + .2);
    const cx = x + armDir * 2.1, r = 7;
    pools.quad([cx - r, .04, z + r], [cx + r, .04, z + r], [cx + r, .04, z - r], [cx - r, .04, z - r], rgb('#ffdca8', .34), { facing: UP, uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  }

  // Fin de vía: barrera roja y blanca; el bus se desvanece antes de llegar a ella.
  for (let x = 54.4; x < 95.6; x += 2.2) {
    const white = Math.round((x - 54.4) / 2.2) % 2 === 0;
    concrete.frustum(x + 1, -73.6, .02, .86, 2.1, .56, 2.1, .2, white ? C.white : C.red, { bottom: .62 });
    steel.box(x + 1, .96, -73.6, 1.9, .05, .05, shade(C.steelLight, 1.1));
    for (const dx of [.15, 1.85]) steel.box(x + dx, .78, -73.6, .05, .36, .05, C.steelLight);
  }

  // Vida en la calle: chazas con parasol, conos que cierran un carril y un bloque de obra.
  for (const [x, z] of [[55.6, -24], [94.6, -48]]) {
    buildCart(kits, x, z);
    solidBox(colliders, x - .75, x + .75, .12, 2.2, z - .5, z + .5);
  }
  for (let k = 0; k < 9; k++) cone(kits, 86.6 + k * .1, -60 - k * 1.5);
  concrete.frustum(84, -71.4, .02, .95, 1.9, 1.2, 1.7, .9, shade(C.concreteDark, .8), { bottom: .6 });
  solidBox(colliders, 83, 85, 0, 1, -72, -70.8);
  // Bolardos en las puntas de la isla: separan el arranque de la rampa de la calzada sin cerrar el pasillo.
  for (const z of [-1.4, -58.6]) for (const x of [73.45, 74.2, 75.8, 76.55]) {
    steel.tube([[x, .02, z], [x, .94, z]], .06, 8, shade(C.steelDark, 1.2), { caps: true });
    steel.tube([[x, .7, z], [x, .8, z]], .063, 8, C.yellow, { caps: false });
    solidBox(colliders, x - .08, x + .08, 0, .95, z - .08, z + .08);
  }
  // Cicloparqueadero junto a la cicloruta.
  for (let k = 0; k < 4; k++) {
    const z = -33 - k * .8, x = 56.1, y = .12;
    steel.tube([[x - .35, y, z], [x - .35, y + .62, z], [x - .22, y + .78, z], [x + .22, y + .78, z], [x + .35, y + .62, z], [x + .35, y, z]], .024, 6, shade(C.steelLight, 1.1), { caps: false });
  }
  solidBox(colliders, 55.7, 56.5, .12, 1, -35.6, -32.8);
  // Vallas del barrio sobre los andenes.
  for (const [x, z, rect] of [[55, -40, SIGN.ad], [95, -16, SIGN.ad2]]) {
    for (const dz of [-.9, .9]) steel.box(x, 1.3, z + dz, .08, 2.4, .08, C.steelDark);
    steel.box(x, 2, z, .1, 1.3, 2.1, C.steelDark);
    const s = x < TERMINAL.x ? 1 : -1, face = x + s * .056;
    signs.quad([face, 1.42, z + s * .98], [face, 1.42, z - s * .98], [face, 2.58, z - s * .98], [face, 2.58, z + s * .98], [1, 1, 1], { normal: [s, 0, 0], facing: [s, 0, 0], uv: signUv(rect) });
    solidBox(colliders, x - .1, x + .1, .1, 2.7, z - 1, z + 1);
  }
}

function cone({ steel }, x, z) {
  steel.box(x, .04, z, .36, .04, .36, C.black);
  const rings = [[.15, .07], [.13, .22], [.1, .34], [.075, .46], [.05, .6]];
  for (let i = 0; i + 1 < rings.length; i++) {
    const [r0, y0] = rings[i], [r1, y1] = rings[i + 1];
    steel.frustum(x, z, y0, y1, r0 * 2, r0 * 2, r1 * 2, r1 * 2, i === 2 ? C.white : rgb('#d9561c'));
  }
}

function buildCart({ steel }, x, z) {
  const y = .12, orange = rgb('#c75a1c'), blue = rgb('#2d5f9a'), cream = rgb('#e6e4d8');
  steel.box(x, y + .5, z, 1.3, .8, .7, blue, { bottom: .55 });
  steel.box(x, y + .93, z, 1.36, .05, .76, shade(C.steelLight, 1.1));
  steel.box(x, y + 1.14, z, 1.1, .38, .5, shade(C.white, .95));
  for (const dx of [-.5, .5]) steel.box(x + dx, y + .16, z + .34, .05, .28, .05, C.black);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    steel.box(x + Math.cos(a) * .28, y + 1.38, z + Math.sin(a) * .14, .1, .1, .1, i % 2 ? orange : rgb('#b52f25'));
  }
  // Parasol de gajos rojos y blancos sobre su palo.
  const px = x + .7;
  steel.tube([[px, y, z], [px, y + 2.5, z]], .024, 6, C.steelLight);
  const segments = 8, r = 1.05, apex = [px, y + 2.5, z], low = y + 2.02;
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
    const color = i % 2 ? cream : rgb('#b6242a');
    const p0 = [px + Math.cos(a) * r, low, z + Math.sin(a) * r], p1 = [px + Math.cos(b) * r, low, z + Math.sin(b) * r];
    steel.quad(apex, p0, p1, apex, color, { facing: [Math.cos((a + b) / 2) * .6, 1, Math.sin((a + b) / 2) * .6] });
    steel.quad(apex, p1, p0, apex, shade(color, .55), { facing: [0, -1, 0] });
  }
  // Silla plástica al lado.
  const cx = x - 1.05, chair = shade(C.white, .92);
  steel.box(cx, y + .44, z - .1, .42, .04, .42, chair);
  steel.box(cx, y + .7, z - .3, .42, .5, .04, chair);
  for (const [dx, dz] of [[-.18, -.28], [.18, -.28], [-.18, .08], [.18, .08]]) steel.box(cx + dx, y + .22, z + dz, .035, .44, .035, chair);
}

/** La isla: costados de concreto con bordillo, piso de baldosa y rampas con baranda de dos tubos. */
function buildIsland(kits) {
  const { floor, concrete, paint, steel } = kits;
  const u = x => (x - X_WEST) / 4, v = z => z / FLOOR_REPEAT;
  floor.quad([X_WEST, FLOOR, Z_SOUTH], [X_EAST, FLOOR, Z_SOUTH], [X_EAST, FLOOR, Z_NORTH], [X_WEST, FLOOR, Z_NORTH], [1, 1, 1], {
    normal: UP, facing: UP, uv: [[u(X_WEST), v(Z_SOUTH)], [u(X_EAST), v(Z_SOUTH)], [u(X_EAST), v(Z_NORTH)], [u(X_WEST), v(Z_NORTH)]]
  });
  const low = shade(C.concreteDark, .62), high = C.concrete;
  for (const [x, s] of [[X_WEST, -1], [X_EAST, 1]]) {
    // Vaciados de 4 m con su junta, cada uno de un tono, y el salpicado de las llantas abajo: un solo plano parecía una caja.
    const random = seeded(x * 31);
    for (let z = Z_NORTH; z < Z_SOUTH; z += 4) {
      const tone = .86 + random() * .22, top = shade(high, tone), splash = shade(low, tone * .82), mid = shade(lerpColor(low, high, .55), tone);
      concrete.quad([x, .02, z + 4], [x, .24, z + 4], [x, .24, z], [x, .02, z], [splash, shade(mid, .88), shade(mid, .88), splash], { facing: [s, 0, 0] });
      concrete.quad([x, .24, z + 4], [x, FLOOR - .1, z + 4], [x, FLOOR - .1, z], [x, .24, z], [shade(mid, .88), top, top, shade(mid, .88)], { facing: [s, 0, 0] });
      concrete.quad([x + s * .002, .02, z + .018], [x + s * .002, FLOOR - .1, z + .018], [x + s * .002, FLOOR - .1, z - .018], [x + s * .002, .02, z - .018], shade(C.concreteDark, .42), { facing: [s, 0, 0] });
    }
    // Sombra bajo el bordillo amarillo: separa el piso del andén de la base.
    concrete.quad([x + s * .002, FLOOR - .22, Z_SOUTH], [x + s * .002, FLOOR - .1, Z_SOUTH], [x + s * .002, FLOOR - .1, Z_NORTH], [x + s * .002, FLOOR - .22, Z_NORTH], [shade(high, .62), shade(C.concreteDark, .3), shade(C.concreteDark, .3), shade(high, .62)], { facing: [s, 0, 0] });
    // Bordillo saliente amarillo: la raya que todo pasajero conoce.
    const lip = x + s * .03, worn = rgb('#8f8a72'), tones = [];
    for (let z = Z_NORTH; z <= Z_SOUTH; z += 2) tones.push(lerpColor(C.kerbPaint, worn, .12 + random() * .45));
    for (let k = 0; k + 1 < tones.length; k++) {
      const z = Z_NORTH + k * 2, zb = z + 2, a = tones[k], b = tones[k + 1];
      concrete.quad([x, FLOOR - .1, zb], [lip, FLOOR - .098, zb], [lip, FLOOR - .098, z], [x, FLOOR - .1, z], [shade(b, .4), shade(b, .4), shade(a, .4), shade(a, .4)], { facing: [0, -1, 0] });
      concrete.quad([lip, FLOOR - .098, zb], [lip, FLOOR + .002, zb], [lip, FLOOR + .002, z], [lip, FLOOR - .098, z], [shade(b, .84), b, a, shade(a, .84)], { facing: [s, 0, 0] });
      concrete.quad([lip, FLOOR + .002, zb], [x, FLOOR + .002, zb], [x, FLOOR + .002, z], [lip, FLOOR + .002, z], [shade(b, .9), shade(b, .9), shade(a, .9), shade(a, .9)], { facing: UP });
    }
    // Bajantes que hacen creíble el agua de la cubierta y topes de goma donde roza el bus.
    for (let z = Z_NORTH + 3; z < Z_SOUTH; z += 6) steel.box(x + s * .012, .46, z, .03, .82, .12, C.steelDark);
    // Un riel corrido contra el roce: los topes negros sueltos se leían como ventanitas.
    steel.box(x + s * .03, .66, -30, .05, .1, 40, shade(C.steelLight, .82), { bottom: .6 });
    for (let z = Z_NORTH + 2; z < Z_SOUTH; z += 4) steel.box(x + s * .022, .66, z, .05, .16, .12, C.steelDark);
    // Canaleta de la calzada al pie del andén; tapa el borde de la línea amarilla, y a la misma altura pelearían por la profundidad.
    paint.quad([x + s * .02, .033, Z_SOUTH], [x + s * .13, .033, Z_SOUTH], [x + s * .13, .033, Z_NORTH], [x + s * .02, .033, Z_NORTH], rgb('#26262a'), { facing: UP });
  }

  const ramp = new MeshKit();
  for (const [zHigh, zLow] of [[Z_SOUTH, -2], [Z_NORTH, -58]]) {
    ramp.quad([X_WEST, FLOOR, zHigh], [X_EAST, FLOOR, zHigh], [X_EAST, .02, zLow], [X_WEST, .02, zLow], [1, 1, 1], {
      facing: UP, uv: [[u(X_WEST), v(zHigh)], [u(X_EAST), v(zHigh)], [u(X_EAST), v(zLow)], [u(X_WEST), v(zLow)]]
    });
    for (const [x, s] of [[X_WEST, -1], [X_EAST, 1]]) {
      concrete.quad([x, .02, zHigh], [x, FLOOR, zHigh], [x, .02, zLow], [x, .02, zLow], [low, high, low, low], { facing: [s, 0, 0] });
      const rail = x - s * .06;
      const at = (t, h) => [rail, lerp(FLOOR, .02, t) + h, lerp(zHigh, zLow, t)];
      steel.tube([at(-.02, 1.02), at(1.02, 1.02)], .024, 6, shade(C.steelLight, 1.05));
      steel.tube([at(-.02, .58), at(1.02, .58)], .018, 6, shade(C.steelLight, .95));
      for (let t = 0; t <= 1.001; t += 1 / 6) steel.tube([at(t, -.02), at(t, 1.03)], .022, 6, shade(C.steelLight, .9), { caps: false });
    }
    // Bandas amarillas de arranque arriba y abajo de la rampa.
    for (const [t0, t1] of [[0, .03], [.96, 1]]) {
      const a = lerp(zHigh, zLow, t0), b = lerp(zHigh, zLow, t1), ya = lerp(FLOOR, .02, t0) + .006, yb = lerp(FLOOR, .02, t1) + .006;
      paint.quad([X_WEST + .1, ya, a], [X_EAST - .1, ya, a], [X_EAST - .1, yb, b], [X_WEST + .1, yb, b], C.yellow, { facing: UP });
    }
  }
  return ramp;
}

/** Pórticos y cerchas repetidos, vigas largas, correas y cubierta curva con su canal. */
function buildStructure({ steel, inside, roof, ceiling, lamps }) {
  const x0 = TERMINAL.x - ROOF_HALF, x1 = TERMINAL.x + ROOF_HALF, zStart = Z_NORTH - .7, zEnd = Z_SOUTH + .7;
  const rod = { flat: true, caps: false };

  for (const z of COLUMN_Z) for (const x of [WALL_WEST, WALL_EAST]) {
    inside.uvOf = stripUv(FINISH.column, x, z, .08, .08, FLOOR, CEILING + .04, 1.5, z * 1.3 + x * .7);
    inside.box(x, (FLOOR + CEILING + .04) / 2, z, .16, CEILING + .04 - FLOOR, .16, shade(C.steelLight, 1.12), { bottom: .72 });
    inside.uvOf = null;
    inside.box(x, FLOOR + .08, z, .24, .16, .28, C.steelDark);
    // Cartelas: el refuerzo diagonal que une columna y cercha.
    const s = x < TERMINAL.x ? 1 : -1;
    steel.tube([[x, CEILING - .55, z], [x + s * .55, CEILING + .04, z]], .035, 4, C.steel, { flat: true });
  }
  // Cerchas: cordón inferior recto entre muros, superior siguiendo la curva y diagonales en zigzag.
  // Fuera de los muros solo queda el voladizo con su tornapunta, que pasa por encima del techo del bus.
  const chordY = CEILING + .06;
  for (const z of TRUSS_Z) {
    steel.tube([[WALL_WEST, chordY, z], [WALL_EAST, chordY, z]], .04, 4, C.steel, rod);
    const arc = [];
    for (let i = 0; i <= 12; i++) { const x = lerp(x0 + .02, x1 - .02, i / 12); arc.push([x, roofY(x) - .055, z]); }
    steel.tube(arc, .045, 4, C.steel, rod);
    for (let i = 0; i < 8; i++) {
      const xa = lerp(WALL_WEST, WALL_EAST, i / 8), xb = lerp(WALL_WEST, WALL_EAST, (i + 1) / 8);
      const pa = i % 2 ? [xa, roofY(xa) - .07, z] : [xa, chordY, z], pb = i % 2 ? [xb, chordY, z] : [xb, roofY(xb) - .07, z];
      steel.tube([pa, pb], .017, 4, shade(C.steel, .85), rod);
    }
    for (const [wall, tip] of [[WALL_WEST, x0 + .1], [WALL_EAST, x1 - .1]]) {
      steel.tube([[wall, chordY, z], [tip, roofY(tip) - .08, z]], .03, 4, shade(C.steel, .9), rod);
      steel.tube([[wall, chordY, z], [wall, roofY(wall) - .07, z]], .024, 4, shade(C.steel, .85), rod);
    }
  }
  // Vigas longitudinales y correas bajo la lámina.
  for (const x of [WALL_WEST, WALL_EAST]) steel.box(x, CEILING + .02, -30, .14, .16, 40, C.steel, { bottom: .75 });
  for (let i = 0; i <= 8; i++) {
    const x = lerp(x0 + .1, x1 - .1, i / 8);
    steel.tube([[x, roofY(x) - .1, zStart], [x, roofY(x) - .1, zEnd]], .028, 4, shade(C.steel, .78), rod);
  }
  // Riostras en cruz en las dos crujías de los extremos: el rigidizador que se ve en las estaciones reales.
  for (const [za, zb] of [[-50, -46], [-14, -10]]) for (const x of [WALL_WEST, WALL_EAST]) {
    steel.tube([[x, CEILING, za], [x, FLOOR + .2, zb]], .012, 4, C.steelDark, rod);
    steel.tube([[x, FLOOR + .2, za], [x, CEILING, zb]], .012, 4, C.steelDark, rod);
  }

  // Lámina curva: cara superior con relieve e inferior más oscura, separadas para que no se pisen.
  roof.uvOf = p => [p[2], (p[0] - x0) / (x1 - x0)];
  const rows = 12;
  const slopeNormal = x => { const m = -2 * ROOF_RISE * (x - TERMINAL.x) / ROOF_HALF ** 2, l = Math.hypot(m, 1); return [-m / l, 1 / l, 0]; };
  for (let i = 0; i < rows; i++) {
    const a = lerp(x0, x1, i / rows), b = lerp(x0, x1, (i + 1) / rows);
    const na = slopeNormal(a), nb = slopeNormal(b);
    roof.quad([a, roofY(a), zStart], [b, roofY(b), zStart], [b, roofY(b), zEnd], [a, roofY(a), zEnd], [1, 1, 1], { normal: [na, nb, nb, na], facing: UP });
    roof.quad([a, roofY(a) - .025, zStart], [b, roofY(b) - .025, zStart], [b, roofY(b) - .025, zEnd], [a, roofY(a) - .025, zEnd], rgb('#6d7274'), { normal: [0, -1, 0], facing: [0, -1, 0] });
  }
  // Canal y fascia roja: la franja de color de la estación vista desde el carril.
  const length = zEnd - zStart;
  for (const [x, s] of [[x0, -1], [x1, 1]]) {
    const y = roofY(x);
    steel.box(x + s * .07, y - .1, -30, .16, .2, length + .1, C.red, { bottom: .7 });
    steel.box(x + s * .07, y + .012, -30, .1, .02, length + .02, shade(C.steelDark, .8));
  }
  for (const z of [zStart, zEnd]) for (let i = 0; i < 12; i++) {
    const a = lerp(x0, x1, i / 12), b = lerp(x0, x1, (i + 1) / 12);
    const band = [[a, roofY(a) - .16, z], [b, roofY(b) - .16, z], [b, roofY(b) + .02, z], [a, roofY(a) + .02, z]];
    for (const s of [-1, 1]) steel.quad(...band, C.red, { facing: [0, 0, s], normal: [0, 0, s] });
  }

  // Cielo raso: paneles con juntas; encima, una tapa oscura que se ve desde afuera entre las cerchas.
  // Los paneles de los costados toman la mitad de la hoja que tiene el polvo del lado de la luminaria.
  const cells = [[WALL_WEST + .08, 74.1, .5, 1], [74.1, 75.9, 0, 1], [75.9, WALL_EAST - .08, 0, .5]];
  const random = seeded(2024);
  let row = 0;
  for (let z = Z_NORTH; z < Z_SOUTH - .01; z += 1.2, row++) {
    const zb = Math.min(Z_SOUTH, z + 1.2);
    cells.forEach(([a, b, s0, s1], column) => {
      // Cada panel con su tono, y alguno manchado de goteras: hilera idéntica es lo que delata el cielo raso.
      const stain = random() < .07 ? .78 : 1, panel = shade(C.ceiling, (.88 + random() * .14) * stain);
      const area = FINISH.ceiling((row * 5 + column * 3 + (row >> 2)) % 8), flip = column === 1 && row % 2 === 1;
      const [u0, u1] = flip ? [s1, s0] : [s0, s1], t1 = (zb - z) / 1.2;
      const uv = [finishUv(area, u0, 0), finishUv(area, u1, 0), finishUv(area, u1, t1), finishUv(area, u0, t1)];
      ceiling.quad([a + .012, CEILING, z + .012], [b - .012, CEILING, z + .012], [b - .012, CEILING, zb - .012], [a + .012, CEILING, zb - .012], panel, { normal: [0, -1, 0], facing: [0, -1, 0], uv });
    });
  }
  // Rejillas de ventilación y bandeja de cables: lo que de verdad cuelga de un cielo raso.
  for (const z of [-46.8, -35.4, -24.6, -13.2]) {
    const x = z < -30 ? 73.62 : 76.38;
    steel.box(x, CEILING - .012, z, .56, .024, .56, shade(C.steelLight, 1.2), { skip: 'py' });
    for (let k = -3; k <= 3; k++) steel.box(x, CEILING - .026, z + k * .07, .46, .006, .03, C.steelDark);
  }
  steel.box(TERMINAL.x + .28, CEILING - .03, -30, .1, .04, 39.6, shade(C.steel, 1.25), { skip: 'py' });
  steel.tube([[TERMINAL.x - .3, CEILING - .03, Z_NORTH], [TERMINAL.x - .3, CEILING - .03, Z_SOUTH]], .014, 4, shade(C.steelLight, .9), { flat: true, caps: false });
  for (let z = Z_NORTH + 2.4; z < Z_SOUTH; z += 7.2) steel.box(TERMINAL.x - .3, CEILING - .03, z, .05, .05, .09, C.steelDark);
  ceiling.quad([WALL_WEST, CEILING + .012, Z_NORTH], [WALL_EAST, CEILING + .012, Z_NORTH], [WALL_EAST, CEILING + .012, Z_SOUTH], [WALL_WEST, CEILING + .012, Z_SOUTH], C.ceilingSeam, { normal: [0, -1, 0], facing: [0, -1, 0] });
  ceiling.quad([WALL_WEST, CEILING + .03, Z_NORTH], [WALL_EAST, CEILING + .03, Z_NORTH], [WALL_EAST, CEILING + .03, Z_SOUTH], [WALL_WEST, CEILING + .03, Z_SOUTH], shade(C.steelDark, .7), { normal: UP, facing: UP });
  // Luminarias en dos filas: tubos encerrados en su canaleta.
  lamps.uvOf = () => TONE.luminaire;
  for (const x of [74.1, 75.9]) for (let z = Z_NORTH + .6; z < Z_SOUTH - .4; z += 2.4) {
    steel.box(x, CEILING - .02, z + .6, .22, .04, 1.3, C.steelLight, { skip: 'py' });
    lamps.quad([x - .08, CEILING - .043, z], [x + .08, CEILING - .043, z], [x + .08, CEILING - .043, z + 1.2], [x - .08, CEILING - .043, z + 1.2], rgb('#fff4dc'), { facing: [0, -1, 0] });
  }
}

/** Muros de vidrio con parales, zócalo y friso rojo; se cortan donde van las puertas. */
function buildWalls({ steel: outer, inside: steel, glass, doorFrame, doorGlass, signs, paint, ceiling, lamps }) {
  const jamb = .09, half = BUS_DOOR_WIDTH / 2;
  const random = seeded(808);
  for (const [x, side, doors] of [[WALL_WEST, -1, platformDoorZ.west], [WALL_EAST, 1, platformDoorZ.east]]) {
    const openings = doors.map(z => [z - half, z + half]);
    const inOpening = z => openings.some(([a, b]) => z > a + 1e-3 && z < b - 1e-3);
    const cuts = new Set([Z_NORTH, Z_SOUTH]);
    for (const [a, b] of openings) { cuts.add(a); cuts.add(b); }
    for (const z of COLUMN_Z) if (!inOpening(z)) cuts.add(z);
    const ordered = [...cuts].sort((a, b) => a - b);
    // Paneles de no más de 1,3 m, separados por parales.
    const bays = [];
    for (let i = 0; i + 1 < ordered.length; i++) {
      const a = ordered[i], b = ordered[i + 1];
      if (inOpening((a + b) / 2)) continue;
      const count = Math.max(1, Math.round((b - a) / 1.3));
      for (let k = 0; k < count; k++) bays.push([lerp(a, b, k / count), lerp(a, b, (k + 1) / count)]);
    }
    for (const [a, b] of bays) {
      // Normal un poco abombada por panel: cada vidrio refleja algo distinto, como los reales.
      const n = [side, ((Math.round(a * 7) % 5) - 2) * .004, ((Math.round(a * 11) % 5) - 2) * .004];
      // Cada vidrio con su polvo, más sucio abajo; la banda esmerilada a la altura de los ojos es la de todo vidrio público.
      const clean = .22 + random() * .1, dirty = clean + .1 + random() * .16;
      const low = [...shade(C.glass, 2.1), dirty], high = [...C.glass, clean];
      glass.quad([x, FLOOR + .16, a + .03], [x, FLOOR + .16, b - .03], [x, DOOR_HEAD, b - .03], [x, DOOR_HEAD, a + .03], [low, low, high, high], { normal: n, facing: [side, 0, 0] });
      const frost = [.86, .88, .88, .36];
      glass.quad([x, 2.36, a + .03], [x, 2.36, b - .03], [x, 2.5, b - .03], [x, 2.5, a + .03], frost, { normal: n, facing: [side, 0, 0] });
      steel.box(x, (FLOOR + DOOR_HEAD) / 2, b, .05, DOOR_HEAD - FLOOR, .07, shade(C.steelLight, .95), { bottom: .8 });
      steel.box(x, FLOOR + .08, (a + b) / 2, .07, .16, b - a, C.steel, { bottom: .7 });
      // Riel y pasamanos a media altura: el vidrio deja de ser una lámina vacía.
      steel.box(x, 2.02, (a + b) / 2, .03, .03, b - a, C.steel);
      steel.tube([[x - side * .14, 1.92, a], [x - side * .14, 1.92, b]], .018, 6, shade(C.steelLight, 1.1), { caps: false });
    }
    steel.box(x, (FLOOR + DOOR_HEAD) / 2, Z_NORTH, .05, DOOR_HEAD - FLOOR, .07, shade(C.steelLight, .95), { bottom: .8 });
    // Friso rojo continuo sobre puertas y vidrios, con una moldura de acero abajo.
    // Por dentro va con el cielo raso: su emisivo le da el rebote de luz que el andén no tiene y deja de verse negro.
    {
      // El rojo sale de la hoja de acabados, en tramos de 4 m: el color del vértice solo hace la sombra.
      const offset = side * .03, white = [1, 1, 1], dim = shade(white, .8), bright = shade(white, 1.18), inner = x - offset;
      for (let k = 0; k < 10; k++) {
        const za = Z_NORTH + k * 4, zb = za + 4, strip = FINISH.frieze[(k + (side > 0 ? 1 : 0)) % 2];
        const [s0, s1] = (k * 7 + (side > 0 ? 3 : 0)) % 3 === 0 ? [1, 0] : [0, 1];
        outer.quad([x + offset, DOOR_HEAD, za], [x + offset, DOOR_HEAD, zb], [x + offset, FRIEZE_TOP, zb], [x + offset, FRIEZE_TOP, za], [dim, dim, white, white],
          { facing: [offset, 0, 0], uv: [finishUv(strip, s0, 0), finishUv(strip, s1, 0), finishUv(strip, s1, 1), finishUv(strip, s0, 1)] });
        const other = FINISH.frieze[(k + (side > 0 ? 0 : 1)) % 2];
        ceiling.quad([inner, DOOR_HEAD, zb], [inner, DOOR_HEAD, za], [inner, FRIEZE_TOP, za], [inner, FRIEZE_TOP, zb], [white, white, bright, bright],
          { normal: [-side, 0, 0], facing: [-side, 0, 0], uv: [finishUv(other, s1, 0), finishUv(other, s0, 0), finishUv(other, s0, 1), finishUv(other, s1, 1)] });
      }
      // Línea de luz bajo el friso: desde el carril se lee de noche la forma de la estación.
      const led = x + side * .054, ledLow = DOOR_HEAD - .004, ledHigh = DOOR_HEAD + .026;
      lamps.uvOf = () => TONE.eave;
      lamps.quad([led, ledLow, Z_NORTH], [led, ledLow, Z_SOUTH], [led, ledHigh, Z_SOUTH], [led, ledHigh, Z_NORTH], rgb('#ffe9c8'), { facing: [side, 0, 0] });
    }
    steel.box(x, DOOR_HEAD + .012, -30, .1, .035, 40, C.steelLight);
    steel.box(x, FRIEZE_TOP - .008, -30, .1, .025, 40, C.steelDark);

    // Puertas corredizas: marco fijo rojo, hojas que corren por dentro del vidrio fijo, línea amarilla y letrero de vagón.
    openings.forEach(([a, b], index) => {
      const center = (a + b) / 2;
      for (const z of [a - jamb / 2, b + jamb / 2]) {
        steel.uvOf = stripUv(FINISH.jamb, x, z, .06, jamb / 2, FLOOR, DOOR_HEAD, 1.2, z * 3.7 + x);
        steel.box(x, (FLOOR + DOOR_HEAD) / 2, z, .12, DOOR_HEAD - FLOOR, jamb, [1, 1, 1], { bottom: .78 });
        steel.uvOf = null;
      }
      steel.box(x, DOOR_HEAD - .04, center, .14, .09, b - a + jamb * 2, C.red);
      // Caja del mecanismo, que sobresale hacia adentro.
      steel.box(x - side * .12, DOOR_HEAD - .13, center, .14, .15, b - a + 1.3, shade(C.steel, 1.1), { bottom: .7 });
      for (const [from, to, travel] of [[a, center, -(half - .04)], [center, b, half - .04]]) {
        doorFrame.slideValue = travel; doorGlass.slideValue = travel;
        const leafX = x - side * .08, bar = .055, y0 = FLOOR + .03, y1 = DOOR_HEAD - .085;
        for (const z of [from + bar / 2 + .004, to - bar / 2 - .004]) {
          doorFrame.uvOf = stripUv(FINISH.jamb, leafX, z, .015, bar / 2, y0, y1, 1.2, z * 5.3 - leafX);
          doorFrame.box(leafX, (y0 + y1) / 2, z, .03, y1 - y0, bar, [1, 1, 1], { bottom: .8 });
          doorFrame.uvOf = null;
        }
        doorFrame.box(leafX, y1 - bar / 2, (from + to) / 2, .03, bar, to - from - .01, C.red);
        doorFrame.box(leafX, y0 + .05, (from + to) / 2, .03, .1, to - from - .01, C.steelDark);
        doorFrame.box(leafX, 1.92, (from + to) / 2, .036, .03, to - from - .1, C.steelLight);
        doorGlass.quad([leafX, y0 + .1, from + bar], [leafX, y0 + .1, to - bar], [leafX, y1 - bar, to - bar], [leafX, y1 - bar, from + bar], [...C.glass, .22], { normal: [side, .004, travel > 0 ? .006 : -.006], facing: [side, 0, 0] });
      }
      doorFrame.slideValue = 0; doorGlass.slideValue = 0;
      // Línea amarilla al piso, por dentro de la puerta.
      const zone = .55, y = FLOOR + .004, near = x - side * .1, far = x - side * zone, edge = x - side * (zone + .08);
      paint.quad([near, y, a - .1], [far, y, a - .1], [far, y, a - .04], [near, y, a - .04], C.yellow, { facing: UP });
      paint.quad([near, y, b + .04], [far, y, b + .04], [far, y, b + .1], [near, y, b + .1], C.yellow, { facing: UP });
      paint.quad([far, y, a - .1], [edge, y, a - .1], [edge, y, b + .1], [far, y, b + .1], C.yellow, { facing: UP });
      // Letrero de vagón, colgado perpendicular al muro para leerlo caminando.
      const wagon = [SIGN.wagon1, SIGN.wagon2, SIGN.wagon3, SIGN.wagon4][side > 0 ? index : doors.length - 1 - index];
      const signX = x - side * .62, w = .48, h = .16, sy = 2.96, uv = signUv(wagon);
      signs.quad([signX - w, sy - h, center], [signX + w, sy - h, center], [signX + w, sy + h, center], [signX - w, sy + h, center], [1, 1, 1], { normal: [0, 0, 1], facing: [0, 0, 1], uv });
      signs.quad([signX + w, sy - h, center - .003], [signX - w, sy - h, center - .003], [signX - w, sy + h, center - .003], [signX + w, sy + h, center - .003], [1, 1, 1], { normal: [0, 0, -1], facing: [0, 0, -1], uv });
      for (const dx of [-.3, .3]) steel.tube([[signX + dx, sy + h, center], [signX + dx, CEILING, center]], .008, 4, C.steelDark, { flat: true, caps: false });
    });
  }
}

/** Accesos: letrero del portal, molinetes y taquilla. Dejan libre el pasillo central que usan el jugador y las pruebas. */
function buildAccess({ steel, signs, glass, lamps }, colliders) {
  for (const [zFace, s, line, boothZ, west] of [[Z_SOUTH, 1, -14.9, -12.6, true], [Z_NORTH, -1, -45.1, -47.4, false]]) {
    // Letrero del portal sobre la entrada, por las dos caras.
    const y0 = 3.05, y1 = 3.9, x0 = 73.2, x1 = 76.8, z = zFace + s * .12;
    steel.box(TERMINAL.x, y0 - .05, z, x1 - x0 + .1, .1, .12, C.steelDark);
    steel.box(TERMINAL.x, y1 + .04, z, x1 - x0 + .1, .08, .12, C.steelDark);
    const [left, right] = s > 0 ? [x0, x1] : [x1, x0];
    signs.quad([left, y0, z + s * .065], [right, y0, z + s * .065], [right, y1, z + s * .065], [left, y1, z + s * .065], [1, 1, 1], { normal: [0, 0, s], facing: [0, 0, s], uv: signUv(SIGN.portal) });
    // Por dentro el cielo raso tapa la parte alta: el letrero de sentidos va solo en lo que se alcanza a ver.
    signs.quad([right, y0, z - s * .065], [left, y0, z - s * .065], [left, CEILING, z - s * .065], [right, CEILING, z - s * .065], [1, 1, 1], { normal: [0, 0, -s], facing: [0, 0, -s], uv: signUv(SIGN.rail) });
    steel.quad([right, CEILING, z - s * .065], [left, CEILING, z - s * .065], [left, y1, z - s * .065], [right, y1, z - s * .065], C.steelDark, { facing: [0, 0, -s] });

    // Molinetes: cuatro cuerpos y el carril central libre, con paletas abiertas y luz verde de paso.
    const stainless = shade(C.steelLight, 1.25), lampY = FLOOR + .918;
    for (const x of [73.34, 74.26, 75.74, 76.66]) {
      steel.box(x, FLOOR + .06, line, .18, .12, .76, C.steelDark);
      steel.box(x, FLOOR + .51, line, .2, .78, .75, stainless, { bottom: .72 });
      for (const end of [-.375, .375]) {
        steel.tube([[x, FLOOR, line + end], [x, FLOOR + .9, line + end]], .1, 10, stainless, { caps: false });
        steel.tube([[x, FLOOR + .9, line + end], [x, FLOOR + .92, line + end]], .106, 10, C.black);
      }
      steel.box(x, FLOOR + .91, line, .212, .02, .75, C.black);
      // Lector de tarjeta inclinado hacia quien llega y la raya de paso: verde de entrada, roja de salida.
      steel.box(x, FLOOR + .945, line + .2, .13, .05, .2, shade(C.steelDark, .7));
      lamps.uvOf = () => TONE.reader;
      lamps.quad([x - .04, FLOOR + .972, line + .13], [x + .04, FLOOR + .972, line + .13], [x + .04, FLOOR + .972, line + .22], [x - .04, FLOOR + .972, line + .22], rgb('#7fc4ff'), { facing: UP });
      lamps.uvOf = () => TONE.green;
      lamps.quad([x - .012, lampY + .004, line + .32], [x + .012, lampY + .004, line + .32], [x + .012, lampY + .004, line + .44], [x - .012, lampY + .004, line + .44], rgb('#32e070'), { facing: UP });
      lamps.uvOf = () => TONE.red;
      lamps.quad([x - .012, lampY + .004, line - .44], [x + .012, lampY + .004, line - .44], [x + .012, lampY + .004, line - .32], [x - .012, lampY + .004, line - .32], rgb('#ff4426'), { facing: UP });
      solidBox(colliders, x - .11, x + .11, FLOOR, FLOOR + 1, line - .48, line + .48);
    }
    // Trípodes de los dos carriles laterales.
    for (const [hub, dir] of [[73.44, 1], [76.56, -1]]) {
      const center = [hub, FLOOR + .86, line];
      steel.box(center[0], center[1], center[2], .06, .1, .1, C.black);
      for (let k = 0; k < 3; k++) {
        const t = k / 3 * Math.PI * 2 + .3;
        steel.tube([center, [hub + dir * .54, center[1] + Math.cos(t) * .2 - .06, line + Math.sin(t) * .34]], .016, 6, stainless);
      }
    }
    // Paletas de vidrio del paso central, abiertas contra sus cuerpos.
    for (const x of [74.38, 75.62]) {
      const n = [x < TERMINAL.x ? 1 : -1, 0, 0];
      glass.quad([x, FLOOR + .38, line - .46], [x, FLOOR + .38, line + .02], [x, FLOOR + 1.02, line + .02], [x, FLOOR + 1.02, line - .46], [...rgb('#3c5c64'), .4], { normal: n, facing: n });
    }

    // Taquilla: caseta de acero y vidrio contra un costado, fuera de los molinetes.
    const bx0 = west ? 73.18 : 75.68, bx1 = west ? 74.32 : 76.82, bz0 = boothZ - 1.4, bz1 = boothZ + 1.4;
    const bcx = (bx0 + bx1) / 2, inner = west ? bx1 : bx0, face = west ? 1 : -1, top = 3;
    steel.box(bcx, FLOOR + .5, boothZ, bx1 - bx0, 1, bz1 - bz0, shade(C.steel, 1.1), { bottom: .7 });
    steel.box(bcx, top + .08, boothZ, bx1 - bx0 + .1, .16, bz1 - bz0 + .1, C.red, { bottom: .85 });
    const pane = [...C.glass, .46];
    glass.quad([inner, FLOOR + 1, bz0], [inner, FLOOR + 1, bz1], [inner, top, bz1], [inner, top, bz0], pane, { normal: [face, 0, 0], facing: [face, 0, 0] });
    for (const zEdge of [bz0, bz1]) {
      const n = [0, 0, zEdge < boothZ ? -1 : 1];
      glass.quad([bx0, FLOOR + 1, zEdge], [bx1, FLOOR + 1, zEdge], [bx1, top, zEdge], [bx0, top, zEdge], pane, { normal: n, facing: n });
      for (const x of [bx0 + .03, bx1 - .03]) steel.box(x, (FLOOR + top + 1) / 2, zEdge, .06, top - FLOOR - 1, .06, C.steelDark);
    }
    steel.box(inner + face * .1, FLOOR + 1.02, boothZ, .28, .04, 1.1, shade(C.steelLight, 1.2));
    // Dentro: mesa y taquillero que se adivinan detrás del vidrio.
    steel.box(bcx, FLOOR + 1, boothZ, .5, .04, 1.6, C.wood);
    steel.ellipsoid([bcx - face * .2, FLOOR + 1.28, boothZ], [.2, .34, .14], v => shade(rgb('#26364e'), lerp(.55, 1.1, v)), { rows: 4, cols: 6 });
    steel.ellipsoid([bcx - face * .2, FLOOR + 1.72, boothZ], [.095, .12, .105], v => v > .62 ? rgb('#17120f') : shade(rgb('#a57a59'), lerp(.7, 1.05, v)), { rows: 5, cols: 6 });
    const plate = inner + face * .012, ty0 = top - .34, ty1 = top - .06, tw = 1.25;
    signs.quad([plate, ty0, boothZ + tw * face], [plate, ty0, boothZ - tw * face], [plate, ty1, boothZ - tw * face], [plate, ty1, boothZ + tw * face], [1, 1, 1], { normal: [face, 0, 0], facing: [face, 0, 0], uv: signUv(SIGN.ticket) });
    solidBox(colliders, bx0, bx1, FLOOR, top, bz0, bz1);
  }
}

/** Mobiliario del andén, entre las puertas y sin tocar el pasillo central ni la baldosa táctil. */
function buildFurniture({ steel, signs, board }, colliders) {
  const bench = (x, z, facing) => {
    const length = 2.1, seat = shade(C.steelLight, 1.15), y = FLOOR;
    steel.box(x, y + .46, z, .42, .05, length, seat, { bottom: .55 });
    for (let k = -8; k <= 8; k++) steel.box(x, y + .49, z + k * .125, .4, .006, .05, C.steelDark);
    steel.box(x - facing * .19, y + .72, z, .05, .44, length, seat, { bottom: .7 });
    for (const dz of [-.85, 0, .85]) {
      steel.box(x, y + .22, z + dz, .05, .44, .06, C.steelDark);
      steel.box(x, y + .025, z + dz, .4, .05, .08, C.steelDark);
    }
    solidBox(colliders, x - .24, x + .24, y, y + .95, z - length / 2, z + length / 2);
  };
  const bin = (x, z) => {
    const y = FLOOR;
    steel.frustum(x, z, y, y + .86, .42, .42, .46, .46, rgb('#2f5e3a'), { bottom: .55, skipTop: true });
    steel.frustum(x, z, y + .86, y + .98, .48, .48, .4, .4, shade(C.steelLight, .9));
    steel.box(x, y + .92, z, .5, .05, .12, C.black);
    solidBox(colliders, x - .26, x + .26, y, y + 1, z - .26, z + .26);
  };
  const panel = (x, z, side, rect, w = .7, y0 = 1.28, y1 = 2.42) => {
    steel.box(x, (y0 + y1) / 2, z, .05, y1 - y0 + .08, w * 2 + .08, C.steelDark);
    const s = -side, face = x + s * .03, zA = z + s * w, zB = z - s * w;
    signs.quad([face, y0, zA], [face, y0, zB], [face, y1, zB], [face, y1, zA], [1, 1, 1], { normal: [s, 0, 0], facing: [s, 0, 0], uv: signUv(rect) });
  };
  const east = WALL_EAST - .36, west = WALL_WEST + .36;
  for (const z of [-41.2, -30.2, -19.4]) bench(east, z, -1);
  for (const z of [-41.2, -29.6, -19.4]) bench(west, z, 1);
  // La caneca del norte queda lejos del molinete: pegada a él, cerraba el hueco entre su cuerpo y la taquilla.
  for (const z of [-43, -15.9]) bin(east, z);
  for (const z of [-37.1, -16.6]) bin(west, z);
  for (const [x, side] of [[WALL_EAST - .1, 1], [WALL_WEST + .1, -1]]) for (const z of [-39, -21.7]) panel(x, z, side, SIGN.map);
  panel(WALL_EAST - .1, -17.2, 1, SIGN.ad2, .85, 1.4, 2.3);
  panel(WALL_WEST + .1, -43.6, -1, SIGN.ad, .85, 1.4, 2.3);
  // Aviso de seguridad sobre las bancas del centro.
  {
    const uv = signUv(SIGN.line), z = -30, y0 = 2.5, y1 = 2.68;
    // Pasa por delante de la columna de la mitad: sobre su misma cara parpadearía.
    const west = WALL_WEST + .1, east = WALL_EAST - .1;
    signs.quad([west, y0, z + .9], [west, y0, z - .9], [west, y1, z - .9], [west, y1, z + .9], [1, 1, 1], { normal: [1, 0, 0], facing: [1, 0, 0], uv });
    signs.quad([east, y0, z - .9], [east, y0, z + .9], [east, y1, z + .9], [east, y1, z - .9], [1, 1, 1], { normal: [-1, 0, 0], facing: [-1, 0, 0], uv });
  }
  // Tablero electrónico de próximos buses, colgado sobre el pasillo y legible en ambos sentidos.
  for (const z of [-40, -30.4, -21]) {
    const w = 1.05, y0 = 2.78, y1 = 3.28, cx = TERMINAL.x;
    steel.box(cx, (y0 + y1) / 2, z, w * 2 + .12, y1 - y0 + .1, .1, C.black);
    board.quad([cx - w, y0, z + .056], [cx + w, y0, z + .056], [cx + w, y1, z + .056], [cx - w, y1, z + .056], [1, 1, 1], { normal: [0, 0, 1], facing: [0, 0, 1], uv: signUv(SIGN.boardFromSouth) });
    board.quad([cx + w, y0, z - .056], [cx - w, y0, z - .056], [cx - w, y1, z - .056], [cx + w, y1, z - .056], [1, 1, 1], { normal: [0, 0, -1], facing: [0, 0, -1], uv: signUv(SIGN.boardFromNorth) });
    for (const dx of [-.8, .8]) steel.tube([[cx + dx, y1, z], [cx + dx, CEILING, z]], .012, 4, C.steelDark, { flat: true, caps: false });
  }
  // Parlantes y cámaras: detalles chicos que se notan al caminar por dentro.
  for (const z of [-44, -32, -18]) {
    // Altavoz redondo de techo con su rejilla y cámara de domo: de cubo solo quedaba la silueta.
    steel.ellipsoid([TERMINAL.x + .9, CEILING - .002, z], [.13, .05, .13], v => v < .3 ? shade(C.steelDark, 1.1) : shade(C.white, .92), { rows: 3, cols: 10 });
    steel.ellipsoid([TERMINAL.x - .9, CEILING - .004, z + 3], [.075, .075, .075], v => v < .6 ? rgb('#14171b') : shade(C.white, .9), { rows: 4, cols: 8 });
  }
}

/** Árboles de los andenes: las mismas especies de la ciudad, que se fusionan con los del distrito. */
function buildTrees(group, colliders) {
  for (const [x, z, species, scale] of [[55.3, -64, 'urapan', 1.1], [55.3, -50, 'arrayan', 1], [55.3, -8, 'arrayan', 1.05], [94.7, -62, 'arrayan', 1], [94.7, -32, 'urapan', 1.1], [94.7, -6, 'urapan', 1]]) {
    const tree = createUrbanTree(scale, { seed: Math.round(x * 13 + z * 7), species });
    tree.position.set(x, .12, z);
    group.add(tree);
    solidBox(colliders, x - .18, x + .18, 0, 3, z - .18, z + .18);
  }
}

/** Estación propia con isla accesible, dos accesos en rampa y galerías de vidrio. */
export function buildTransitTerminal({ asphalt }) {
  const group = new THREE.Group();
  group.name = 'Estación Portal del Centro';
  const colliders = [];
  const lampTone = { value: 0 };
  const materials = createMaterials(lampTone);
  const kits = createKits();
  buildStreet(kits, colliders);
  const rampKit = buildIsland(kits);
  buildStructure(kits);
  buildWalls(kits);
  const underRoof = { ...kits, steel: kits.inside };
  buildAccess(underRoof, colliders);
  buildFurniture(underRoof, colliders);
  buildTrees(group, colliders);

  // De noche la luz de las luminarias cae por tramos sobre el andén y se escapa por el vidrio hasta el carril.
  // Se suma a la baldosa y al cielo raso, que ya brillan algo: más fuerte, el centro de cada charco se quema.
  {
    const full = [[0, 0], [1, 0], [1, 1], [0, 1]], { pools } = kits;
    // Uno por cada par de luminarias, centrado bajo ellas: entre un par y el otro el piso y el cielo raso quedan en
    // penumbra. Se cortan donde acaba el cielo raso, con la textura en su sitio, para no flotar sobre las rampas.
    const lit = (x0, x1, y, center, half, color, facing) => {
      const a = Math.max(Z_NORTH, center - half), b = Math.min(Z_SOUTH, center + half), v = z => (z - center + half) / (2 * half);
      pools.quad([x0, y, a], [x1, y, a], [x1, y, b], [x0, y, b], color, { facing, uv: [[0, v(a)], [1, v(a)], [1, v(b)], [0, v(b)]] });
    };
    for (let z = Z_NORTH + 1.2; z < Z_SOUTH; z += 2.4) lit(X_WEST + .1, X_EAST - .1, FLOOR + .012, z, 1.6, rgb('#ffe9c8', NIGHT_POOLS.floor), UP);
    for (const x of [74.1, 75.9]) for (let z = Z_NORTH + 1.2; z < Z_SOUTH; z += 2.4) {
      lit(x - .8, x + .8, CEILING - .006, z, 1.2, rgb('#ffe2b8', NIGHT_POOLS.halo), [0, -1, 0]);
    }
    for (const [near, far] of [[X_EAST + .02, X_EAST + 3.2], [X_WEST - .02, X_WEST - 3.2]]) for (let z = Z_NORTH + 3; z < Z_SOUTH; z += 5.6) {
      const [a, b] = near < far ? [near - 1.6, far] : [far, near + 1.6];
      pools.quad([a, .045, z + 3.4], [b, .045, z + 3.4], [b, .045, z - 3.4], [a, .045, z - 3.4], rgb('#ffdcae', NIGHT_POOLS.lane), { facing: UP, uv: full });
    }
  }

  // Muros y barandas: cajas por capas, para no estorbar a quien va por debajo. El pasillo central queda libre.
  solidBox(colliders, X_WEST - .02, WALL_WEST + .08, FLOOR, FRIEZE_TOP, Z_NORTH, Z_SOUTH);
  solidBox(colliders, WALL_EAST - .08, X_EAST + .02, FLOOR, FRIEZE_TOP, Z_NORTH, Z_SOUTH);
  for (const [a, b] of [[Z_SOUTH, -3], [-57, Z_NORTH]]) {
    solidBox(colliders, X_WEST - .02, X_WEST + .1, .02, FLOOR + 1.05, a, b);
    solidBox(colliders, X_EAST - .1, X_EAST + .02, .02, FLOOR + 1.05, a, b);
  }
  // Límites del recinto: la barrera del fondo y los costados de siempre.
  for (const x of [53.8, 96.2]) solidBox(colliders, x - .2, x + .2, 0, 4, -74, 0);
  solidBox(colliders, 54, 96, 0, 4, -74.4, -73.3);

  // La calzada usa el asfalto de la ciudad y se fusiona con él; lo demás va en una malla por material.
  const roadGeometry = kits.road.geometry();
  roadGeometry.deleteAttribute('color');
  const road = new THREE.Mesh(roadGeometry, asphalt);
  road.name = 'Calle ampliada';
  road.receiveShadow = true;
  group.add(road);

  const owned = [];
  const addMesh = (geometry, material, name, cast, receive) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.userData.noMerge = true;
    group.add(mesh);
    owned.push(mesh);
    return mesh;
  };
  addMesh(rampKit.geometry(), materials.floor, 'Rampa peatonal', false, true);
  const receive = new Set(['floor', 'concrete', 'slab', 'ceiling', 'paint', 'legends']);
  const cast = new Set(['steel', 'inside', 'roof', 'doorFrame']);
  let pools = null;
  for (const [name, kit] of Object.entries(kits)) {
    if (name === 'road') continue;
    const mesh = addMesh(kit.geometry(), materials[name], `Estación: ${name}`, cast.has(name), receive.has(name));
    if (name === 'roof') mesh.userData.rainCover = true;
    // Como la luz de los faroles: bajo las sombras de contacto, que van con orden 1, y apagada por su material,
    // porque la ciudad quita de la estación las mallas ocultas (los límites que son solo choque).
    if (name === 'pools') { pools = mesh; mesh.material.visible = false; mesh.renderOrder = -1; }
  }

  /** De noche se encienden luminarias, letreros y charcos de luz; solo emisivos, sin luces nuevas. */
  group.userData.setNight = isNight => {
    lampTone.value = isNight ? 1 : 0;
    materials.floor.emissiveIntensity = isNight ? NIGHT_FLOOR_GLOW : .07;
    materials.glass.emissiveIntensity = materials.doorGlass.emissiveIntensity = isNight ? .22 : 0;
    materials.inside.emissive.set(isNight ? CEILING_NIGHT : CEILING_DAY);
    materials.inside.emissiveIntensity = isNight ? .28 : DAY_INSIDE_GLOW;
    materials.ceiling.emissive.set(isNight ? CEILING_NIGHT : CEILING_DAY);
    materials.ceiling.emissiveIntensity = isNight ? NIGHT_CEILING_GLOW : DAY_CEILING_GLOW;
    materials.signs.emissiveIntensity = isNight ? .85 : .12;
    pools.material.visible = isNight;
  };
  /** Con lluvia brillan la losa, los andenes y la pintura; el andén cubierto sigue seco. */
  group.userData.setWetness = amount => {
    materials.slab.roughness = .86 - .46 * amount;
    materials.concrete.roughness = .88 - .4 * amount;
    materials.paint.roughness = materials.legends.roughness = .78 - .4 * amount;
    busWipers.running = amount > .2;
  };
  group.userData.dispose = () => {
    busWipers.running = false;
    for (const mesh of owned) mesh.geometry.dispose();
    for (const material of Object.values(materials)) material.dispose();
  };
  group.userData.colliders = colliders;
  group.userData.cameraCeiling = new THREE.Box3(
    new THREE.Vector3(WALL_WEST, FLOOR, Z_NORTH), new THREE.Vector3(WALL_EAST, CEILING, Z_SOUTH)
  );
  return group;
}
