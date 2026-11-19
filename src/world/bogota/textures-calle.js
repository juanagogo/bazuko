// Dos atlas pequeños y compartidos: uno para lo pintado sobre el suelo y otro para el mobiliario.
// Todo se dibuja por código. Sin DOM (pruebas en Node) devuelven una textura vacía con los mismos UV.
import * as THREE from 'three';
import { rng } from './textures.js';
import { LOCAL_W, localRects, drawLocales } from './textures-locales.js';

function newCanvas(w, h) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext?.('2d');
    return ctx ? { canvas, ctx } : null;
  } catch { return null; }
}

function finishTexture(surface, { srgb = true } = {}) {
  const texture = surface ? new THREE.CanvasTexture(surface.canvas) : new THREE.Texture();
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = !!surface;
  if (!surface) texture.minFilter = THREE.LinearFilter;
  return texture;
}

const rectUv = (W, H) => ([x, y, w, h]) => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];

// ---------- pintura y suelo ----------

const PAINT_W = 1024, PAINT_H = 512;
export const PAINT_PPM = 100;
const PAINT_RECTS = {
  worn: [0, 0, 1024, 256],
  arrow: [4, 260, 56, 120], arrowRight: [68, 260, 88, 120], arrowLeft: [164, 260, 88, 120],
  pare: [256, 258, 256, 60], soloBus: [256, 322, 256, 60],
  uno: [516, 262, 56, 116], dos: [580, 262, 56, 116],
  manhole: [640, 256, 128, 128], manhole2: [768, 256, 128, 128],
  grate: [896, 256, 128, 64], cover: [896, 320, 64, 64],
  patch: [0, 384, 128, 128], patch2: [128, 384, 128, 128],
  oil: [256, 384, 128, 128], oil2: [384, 384, 128, 128],
  pothole: [512, 384, 128, 128],
  crack: [640, 384, 256, 64], crack2: [640, 448, 256, 64],
  tyre: [896, 384, 128, 128],
};
export const PAINT_UV = Object.fromEntries(Object.entries(PAINT_RECTS).map(([k, v]) => [k, rectUv(PAINT_W, PAINT_H)(v)]));

/** Sub-rectángulo de la banda gastada para una franja de L × W metros; nunca se repite igual. */
export function wornUv(length, width, a, b) {
  const [x, y, w, h] = PAINT_RECTS.worn;
  const pw = Math.min(w, length * PAINT_PPM), ph = Math.min(h, Math.max(4, width * PAINT_PPM));
  const px = x + a * (w - pw), py = y + b * (h - ph);
  return rectUv(PAINT_W, PAINT_H)([px, py, pw, ph]);
}

/**
 * Gasta la pintura ya dibujada como la gasta una llanta: tramos lavados y rayones a lo largo del eje u,
 * agrupados en rodadas, y pocas escamas alargadas. Un punteado parejo se lee como estática.
 */
function wear(ctx, x, y, w, h, r, amount = 1) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalCompositeOperation = 'destination-out';
  const area = w * h;
  const streak = (cx, cy, rx, ry, alpha) => {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * .1, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${alpha.toFixed(2)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(-rx, -rx, rx * 2, rx * 2); ctx.restore();
  };
  // Tramos donde la pintura se lavó, mucho más largos que anchos.
  for (let i = 0; i < area * .00022 * amount; i++) {
    streak(x + r() * w, y + r() * h, 40 + r() * 190, 7 + r() * 26, .2 + r() * .42);
  }
  // Cada rodada es un haz de rayones casi paralelos, de unos 20 cm de ancho.
  for (let i = 0; i < area * .00005 * amount; i++) {
    const cy = y + r() * h, spread = 10 + r() * 26, sx = x + r() * w - 200, length = 180 + r() * 620;
    const lines = 10 + Math.floor(r() * 26);
    for (let k = 0; k < lines; k++) {
      const from = sx + r() * 150, ly = cy + (r() - .5) * spread;
      ctx.strokeStyle = `rgba(0,0,0,${(.06 + r() * .2).toFixed(2)})`;
      ctx.lineWidth = .8 + r() * 2.2;
      ctx.beginPath(); ctx.moveTo(from, ly); ctx.lineTo(from + length * (.4 + r() * .6), ly + (r() - .5) * 3); ctx.stroke();
    }
  }
  // Escamas donde saltó la pintura: alargadas y sin borde duro; el árido solo se insinúa.
  for (let i = 0; i < area * .0011 * amount; i++) {
    streak(x + r() * w, y + r() * h, 4 + r() * 22, 1 + r() * 2.2, .35 + r() * .55);
  }
  for (let i = 0; i < area * .0026 * amount; i++) {
    const s = .8 + r() * 1.4;
    ctx.fillStyle = `rgba(0,0,0,${(.05 + r() * .1).toFixed(2)})`;
    ctx.fillRect(x + r() * w, y + r() * h, s * 2.4, s);
  }
  ctx.restore();
}

function arrowShape(ctx, [x, y, w, h], turn = 0) {
  const cx = x + (turn ? w / 2 - turn * 16 : w / 2), shaft = 9;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx, y + 2);
  ctx.lineTo(cx + 24, y + 42); ctx.lineTo(cx + shaft, y + 40);
  ctx.lineTo(cx + shaft, y + h - 2); ctx.lineTo(cx - shaft, y + h - 2);
  ctx.lineTo(cx - shaft, y + 40); ctx.lineTo(cx - 24, y + 42);
  ctx.closePath(); ctx.fill();
  if (turn) {
    const by = y + 74;
    ctx.beginPath();
    ctx.moveTo(cx + turn * shaft, by + 16);
    ctx.lineTo(cx + turn * 26, by + 8); ctx.lineTo(cx + turn * 22, by - 10);
    ctx.lineTo(cx + turn * 48, by + 14); ctx.lineTo(cx + turn * 28, by + 40);
    ctx.lineTo(cx + turn * 27, by + 24); ctx.lineTo(cx + turn * shaft, by + 34);
    ctx.closePath(); ctx.fill();
  }
}

function paintedText(ctx, [x, y, w, h], text, size) {
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${size}px "Arial Narrow", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 2, w - 8);
}

function manhole(ctx, [x, y, w, h], r, square = false) {
  const cx = x + w / 2, cy = y + h / 2, radius = w / 2 - 8;
  // Cuello de concreto alrededor de la tapa, con el asfalto remendado.
  const halo = ctx.createRadialGradient(cx, cy, radius * .9, cx, cy, w / 2);
  halo.addColorStop(0, 'rgba(56,57,56,.95)'); halo.addColorStop(1, 'rgba(40,42,44,0)');
  ctx.fillStyle = halo; ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#34363a'; ctx.fillRect(x, y, w, h);
  if (square) {
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      ctx.fillStyle = (i + j) & 1 ? '#3f4246' : '#2b2d30';
      ctx.fillRect(cx + i * 9 - 4, cy + j * 9 - 4, 8, 8);
    }
  } else {
    ctx.strokeStyle = 'rgba(70,73,76,.9)'; ctx.lineWidth = 2;
    for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(cx, cy, radius * i / 5.4, 0, Math.PI * 2); ctx.stroke(); }
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * radius * .2, cy + Math.sin(a) * radius * .2);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius); ctx.stroke();
    }
  }
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = r() < .5 ? `rgba(120,76,44,${(.1 + r() * .25).toFixed(2)})` : `rgba(10,10,10,${(.1 + r() * .3).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(x + r() * w, y + r() * h, .8 + r() * 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // Aro metálico: claro hacia el sol y oscuro al otro lado, lee como relieve desde lejos.
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#191a1c'; ctx.beginPath(); ctx.arc(cx, cy + 1, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(150,150,145,.75)'; ctx.beginPath(); ctx.arc(cx, cy - 1, radius - 1, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
}

function blob(ctx, cx, cy, radius, color, r, spikes = 14) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i <= spikes; i++) {
    const a = i / spikes * Math.PI * 2, d = radius * (.72 + r() * .34);
    const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d * (.72 + r() * .2);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath(); ctx.fill();
}

function softStain(ctx, cx, cy, radius, rgb, alpha) {
  const g = ctx.createRadialGradient(cx, cy, radius * .1, cx, cy, radius);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(.6, `rgba(${rgb},${alpha * .55})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
}

function crack(ctx, [x, y, w, h], r, width) {
  let px = x + 4, py = y + h / 2 + (r() - .5) * h * .3;
  const points = [[px, py]], branches = [];
  while (px < x + w - 8) {
    // Tramos cortos y quebrados: una línea suave se lee como un cable tirado en el piso.
    px += 2 + r() * 7; py = Math.max(y + 5, Math.min(y + h - 5, py + (r() - .5) * 11));
    points.push([px, py]);
    if (r() < .12) branches.push([px, py, (r() < .5 ? -1 : 1)]);
  }
  ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
  for (const [stroke, lineWidth] of [['rgba(16,16,18,.42)', width + 3.4], ['rgba(6,6,8,.9)', width]]) {
    ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth;
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(8,8,10,.7)'; ctx.lineWidth = Math.max(1, width * .6);
  for (const [bx, by, dir] of branches) {
    let ex = bx, ey = by;
    ctx.beginPath(); ctx.moveTo(bx, by);
    for (let i = 0; i < 3; i++) { ex += 2 + r() * 6; ey += dir * (1.5 + r() * 4); ctx.lineTo(ex, Math.max(y + 2, Math.min(y + h - 2, ey))); }
    ctx.stroke();
  }
}

let paintCache = null;
/** Atlas de pintura y detalles del asfalto: un solo material y una llamada por sector. */
export function paintAtlas() {
  if (paintCache) return paintCache;
  const surface = newCanvas(PAINT_W, PAINT_H);
  if (surface) {
    const { ctx } = surface, r = rng(4177);
    // Banda de franjas: blanco y agujereado; el color lo ponen los vértices.
    ctx.fillStyle = '#fff'; ctx.fillRect(...PAINT_RECTS.worn);
    wear(ctx, ...PAINT_RECTS.worn, r);
    arrowShape(ctx, PAINT_RECTS.arrow);
    arrowShape(ctx, PAINT_RECTS.arrowRight, 1);
    arrowShape(ctx, PAINT_RECTS.arrowLeft, -1);
    paintedText(ctx, PAINT_RECTS.pare, 'PARE', 62);
    paintedText(ctx, PAINT_RECTS.soloBus, 'SOLO BUS', 58);
    paintedText(ctx, PAINT_RECTS.uno, '1', 110);
    paintedText(ctx, PAINT_RECTS.dos, '2', 110);
    wear(ctx, 0, 256, 640, 128, r, .85);
    manhole(ctx, PAINT_RECTS.manhole, r);
    manhole(ctx, PAINT_RECTS.manhole2, r, true);
    {
      const [x, y, w, h] = PAINT_RECTS.grate;
      ctx.fillStyle = '#6b6a63'; ctx.fillRect(x, y + 4, w, h - 8);
      ctx.fillStyle = '#0d0e10'; ctx.fillRect(x + 8, y + 12, w - 16, h - 24);
      ctx.fillStyle = '#3a3b3d';
      for (let i = 0; i < 12; i++) ctx.fillRect(x + 12 + i * 9, y + 12, 4, h - 24);
    }
    {
      const [x, y, w, h] = PAINT_RECTS.cover;
      ctx.fillStyle = '#7d7b73'; ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.strokeStyle = '#2f2f2c'; ctx.lineWidth = 2; ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
      ctx.fillStyle = '#26262a'; ctx.fillRect(x + 28, y + 12, 8, 3); ctx.fillRect(x + 28, y + 48, 8, 3);
      for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(30,30,28,${(.08 + r() * .2).toFixed(2)})`; ctx.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1 + r() * 3); }
    }
    // Translúcidos: el remiendo modula el asfalto de debajo y no parece un rectángulo pegado encima.
    for (const [key, color, seam] of [['patch', 'rgba(30,32,35,.24)', 'rgba(8,8,10,.36)'], ['patch2', 'rgba(58,58,55,.2)', 'rgba(14,14,14,.32)']]) {
      const [x, y, w, h] = PAINT_RECTS[key], cx = x + w / 2, cy = y + h / 2;
      ctx.save();
      ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
      // Las cuadrillas cortan el asfalto en recto: el remiendo es un polígono de bordes rectos.
      const cut = inset => {
        ctx.beginPath();
        const m = 8 + inset;
        ctx.moveTo(x + m + r() * 7, y + m + r() * 5);
        ctx.lineTo(x + w - m - r() * 5, y + m + r() * 9);
        ctx.lineTo(x + w - m - r() * 9, y + h - m - r() * 5);
        ctx.lineTo(x + m + r() * 6, y + h - m - r() * 8);
        ctx.closePath(); ctx.fill();
      };
      ctx.fillStyle = seam; cut(0);
      ctx.fillStyle = color; cut(2.5);
      for (let i = 0; i < 700; i++) {
        const a = r() * Math.PI * 2, d = r() * w * .38;
        ctx.fillStyle = r() < .5 ? `rgba(90,92,92,${(r() * .16).toFixed(2)})` : `rgba(12,12,14,${(r() * .2).toFixed(2)})`;
        ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + r() * 2, 1 + r() * 2);
      }
      ctx.restore();
    }
    for (const key of ['oil', 'oil2']) {
      const [x, y, w, h] = PAINT_RECTS[key];
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      for (let i = 0; i < (key === 'oil' ? 5 : 9); i++) {
        softStain(ctx, x + w * (.22 + r() * .56), y + h * (.22 + r() * .56), 10 + r() * 34, '10,10,12', .22 + r() * .28);
      }
      ctx.restore();
    }
    {
      // Hueco que los vecinos marcaron con pintura: se ve en cualquier calle del centro.
      const [x, y, w, h] = PAINT_RECTS.pothole, cx = x + w / 2, cy = y + h / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(232,186,44,.85)'; ctx.lineWidth = 7; ctx.setLineDash([12, 3, 5, 2]);
      ctx.beginPath(); ctx.ellipse(cx, cy, w * .44, h * .34, .1, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      blob(ctx, cx, cy, w * .3, 'rgba(10,10,11,.97)', r, 16);
      blob(ctx, cx + 1, cy + 3, w * .23, 'rgba(36,32,28,.95)', r, 12);
      for (let i = 0; i < 80; i++) {
        const a = r() * Math.PI * 2, d = w * (.14 + r() * .15);
        ctx.fillStyle = `rgba(${90 + r() * 40 | 0},${84 + r() * 30 | 0},${70 + r() * 20 | 0},.9)`;
        ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d * .8, 1 + r() * 3, 1 + r() * 3);
      }
      ctx.restore();
    }
    crack(ctx, PAINT_RECTS.crack, r, 2.4);
    crack(ctx, PAINT_RECTS.crack2, r, 1.6);
    {
      const [x, y, w, h] = PAINT_RECTS.tyre;
      for (const tx of [x + w * .28, x + w * .72]) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, 'rgba(8,8,10,0)'); g.addColorStop(.25, 'rgba(8,8,10,.3)');
        g.addColorStop(.8, 'rgba(8,8,10,.18)'); g.addColorStop(1, 'rgba(8,8,10,0)');
        ctx.fillStyle = g; ctx.fillRect(tx - 10, y, 20, h);
      }
    }
  }
  paintCache = { texture: finishTexture(surface), uv: PAINT_UV };
  paintCache.texture.name = 'Atlas de pintura y suelo';
  // Cerrar la ciudad libera el atlas: la siguiente lo dibuja igual, sin arrastrar uno ya liberado.
  paintCache.texture.addEventListener('dispose', () => { paintCache = null; });
  return paintCache;
}

// ---------- mobiliario, fachadas y azoteas ----------

// El lienzo es el doble del diseño: letreros y portales se leen de cerca sin cambiar coordenadas.
// La mitad derecha es de los locales de barrio: 2048 × 1024 píxeles en total.
const DETAIL_BASE_W = 512, DETAIL_W = DETAIL_BASE_W + LOCAL_W, DETAIL_H = 512, DETAIL_SCALE = 2;
const CELL = 64;
const DETAIL_NAMES = ['plain', 'concrete', 'rust', 'crate', 'tire', 'cardboard', 'sack', 'canvas',
  'tank', 'rebar', 'awning', 'awning2', 'meter', 'cloth', 'cloth2', 'cloth3',
  'adA', 'adB', 'adC', 'adD', 'paintA', 'paintB', 'paintC', 'paintD',
  'damp', 'damp2', 'bin', 'cone', 'chair', 'trans', 'box', 'wood'];
const DETAIL_RECTS = {};
DETAIL_NAMES.forEach((name, i) => {
  // Avisos y letreros ocupan dos celdas de ancho: necesitan leerse.
  DETAIL_RECTS[name] = [(i % 8) * CELL, Math.floor(i / 8) * CELL, CELL, CELL];
});
// `plain` solo necesita blanco. Comparte la primera celda con la alerta, con 8 px de margen para el filtrado.
DETAIL_RECTS.plain = [8, 8, 48, 16];
DETAIL_RECTS.tactile = [8, 32, 48, 24];
// Los portales ocupan cuatro celdas: son lo que el jugador tiene más cerca en cada cuadra.
['door', 'door2', 'door3', 'door4'].forEach((name, i) => { DETAIL_RECTS[name] = [i * CELL * 2, CELL * 6, CELL * 2, CELL * 2]; });
Object.assign(DETAIL_RECTS, localRects(DETAIL_BASE_W));
// Lata de zinc de las azoteas, en el hueco que queda a la derecha de los rótulos: es larga, como una lata.
DETAIL_RECTS.lata = [896, 368, 128, 32];
export const DETAIL_UV = Object.fromEntries(Object.entries(DETAIL_RECTS).map(([k, v]) => {
  // Un texel de margen: el mipmap no trae el color de la celda vecina.
  const [x, y, w, h] = v;
  return [k, rectUv(DETAIL_W, DETAIL_H)([x + 1, y + 1, w - 2, h - 2])];
}));

function grain(ctx, [x, y, w, h], r, count, colors, size = 2, stretch = 1) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = .5 + r() * size;
    ctx.fillRect(x + r() * w, y + r() * h, s, s * stretch);
  }
}

/** Marco, sombra del hueco y placa de nomenclatura: lo común a todos los portales. */
function doorSurround(ctx, [x, y, w, h], plate) {
  const shade = ctx.createLinearGradient?.(0, y, 0, y + 18);
  if (shade) {
    shade.addColorStop(0, 'rgba(0,0,0,.55)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade; ctx.fillRect(x, y, w, 18);
  }
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fillRect(x, y, 3, h); ctx.fillRect(x + w - 3, y, 3, h);
  if (plate) {
    ctx.fillStyle = '#e9e4d6'; ctx.fillRect(x + w / 2 - 15, y + 7, 30, 11);
    ctx.fillStyle = '#23262a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 9px sans-serif'; ctx.fillText(plate, x + w / 2, y + 13);
  }
}

/** Vidrio oscuro con el reflejo diagonal del cielo: sin él parece un panel pintado. */
function darkGlass(ctx, x, y, w, h, r) {
  ctx.fillStyle = '#1b252b'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(150,178,196,.14)';
  ctx.beginPath(); ctx.moveTo(x, y + h * .55); ctx.lineTo(x + w * .7, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h * .12); ctx.lineTo(x, y + h * .85); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x, y + h * .78, w, h * .22);
  grain(ctx, [x, y, w, h], r, 30, ['rgba(255,255,255,.05)', 'rgba(0,0,0,.14)'], 2);
}

function drawDoors(ctx, R, r) {
  { // Aluminio y vidrio: los edificios de oficinas de los años ochenta.
    const [x, y, w, h] = R.door;
    ctx.fillStyle = '#868a88'; ctx.fillRect(x, y, w, h);
    darkGlass(ctx, x + 6, y + 22, w - 12, 12, r);
    for (const left of [x + 6, x + w / 2 + 2]) {
      darkGlass(ctx, left, y + 38, w / 2 - 8, h - 54, r);
      ctx.fillStyle = '#c4c8c6'; ctx.fillRect(left + 3, y + 80, w / 2 - 14, 3);
      ctx.fillStyle = '#6a6e6c'; ctx.fillRect(left, y + h - 14, w / 2 - 8, 12);
    }
    doorSurround(ctx, R.door, '12-45');
    grain(ctx, R.door, r, 90, ['rgba(40,40,36,.12)'], 1.2);
  }
  { // Reja negra sobre vidrio, con citófono al lado: la entrada típica de un edificio de vivienda.
    const [x, y, w, h] = R.door2;
    ctx.fillStyle = '#34363a'; ctx.fillRect(x, y, w, h);
    darkGlass(ctx, x + 6, y + 22, w - 38, h - 26, r);
    ctx.fillStyle = '#101216';
    for (let i = 0; i <= 8; i++) ctx.fillRect(x + 6 + i * (w - 42) / 8, y + 22, 3, h - 26);
    for (const v of [.42, .72]) ctx.fillRect(x + 6, y + h * v, w - 38, 4);
    ctx.fillStyle = '#b9b4a4'; ctx.fillRect(x + w - 26, y + 54, 16, 28);
    ctx.fillStyle = '#2a2c2e';
    for (let i = 0; i < 4; i++) ctx.fillRect(x + w - 23, y + 58 + i * 6, 10, 3);
    ctx.fillStyle = '#6c5a44'; ctx.fillRect(x + w - 28, y + h - 12, 22, 12);
    doorSurround(ctx, R.door2, '9-22');
  }
  { // Madera y vidrio: los edificios viejos del centro.
    const [x, y, w, h] = R.door3;
    ctx.fillStyle = '#5d3f2b'; ctx.fillRect(x, y, w, h);
    // Vetas: a un paso de la puerta, un grano cuadrado se lee como píxeles.
    grain(ctx, R.door3, r, 460, ['rgba(30,18,10,.2)', 'rgba(150,108,72,.12)'], .9, 16);
    for (const left of [x + 7, x + w / 2 + 2]) {
      for (let row = 0; row < 3; row++) darkGlass(ctx, left + 3, y + 24 + row * 21, w / 2 - 15, 18, r);
      ctx.fillStyle = '#4a3121'; ctx.fillRect(left + 3, y + 92, w / 2 - 15, 26);
      ctx.fillStyle = '#6f4e36'; ctx.fillRect(left + 7, y + 96, w / 2 - 23, 18);
    }
    ctx.fillStyle = '#c6a24e'; ctx.fillRect(x + w / 2 - 7, y + 82, 3, 9); ctx.fillRect(x + w / 2 + 4, y + 82, 3, 9);
    doorSurround(ctx, R.door3, '7-08');
  }
  { // Lámina pintada: pintura vieja con óxido abajo, donde salpica la calle.
    const [x, y, w, h] = R.door4;
    ctx.fillStyle = '#2f5a4b'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(x + w / 2 - 1, y + 20, 2, h - 20);
    for (const left of [x + 8, x + w / 2 + 6]) {
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(left, y + 24, w / 2 - 14, 44); ctx.strokeRect(left, y + 74, w / 2 - 14, 44);
    }
    grain(ctx, R.door4, r, 260, ['rgba(120,80,48,.42)', 'rgba(190,200,184,.12)', 'rgba(16,28,24,.26)'], 1.6);
    const rust = ctx.createLinearGradient?.(0, y + h - 26, 0, y + h);
    if (rust) {
      rust.addColorStop(0, 'rgba(96,60,36,0)'); rust.addColorStop(1, 'rgba(96,60,36,.8)');
      ctx.fillStyle = rust; ctx.fillRect(x, y + h - 26, w, 26);
    }
    ctx.fillStyle = '#20241f'; ctx.fillRect(x + w / 2 - 4, y + 78, 8, 7);
    doorSurround(ctx, R.door4, '15-60');
  }
}

function writeSign(ctx, [x, y, w, h], lines, fg, bg, r) {
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.font = `700 ${i ? 11 : 15}px "Arial Narrow", Arial, sans-serif`;
    ctx.fillText(line, x + w / 2, y + h * (i + .75) / (lines.length + .5), w - 6);
  });
  grain(ctx, [x, y, w, h], r, 60, ['rgba(255,255,255,.1)', 'rgba(0,0,0,.14)'], 2.5);
}

let detailCache = null;
/** Atlas de objetos: el color fino lo ponen los vértices, así un mismo mapa sirve para toda la calle. */
export function detailAtlas() {
  if (detailCache) return detailCache;
  const surface = newCanvas(DETAIL_W * DETAIL_SCALE, DETAIL_H * DETAIL_SCALE);
  if (surface) {
    const { ctx } = surface, r = rng(9391), R = DETAIL_RECTS;
    ctx.scale?.(DETAIL_SCALE, DETAIL_SCALE);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, DETAIL_W, DETAIL_H);
    const fill = (name, color) => { ctx.fillStyle = color; ctx.fillRect(...R[name]); };
    // Casi blanca: el color lo ponen los vértices y no se multiplica dos veces.
    fill('concrete', '#ecebe5');
    grain(ctx, R.concrete, r, 900, ['rgba(70,70,66,.12)', 'rgba(255,255,250,.16)', 'rgba(50,46,40,.09)'], 1.2);
    // Una losa de alerta con dieciséis botones, con relieve legible desde el andén.
    // Se tiñe con el color local como el concreto y se repite tres veces al pie del paso.
    {
      const [x, y, w, h] = R.tactile;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(w / CELL, h / CELL);
      ctx.fillStyle = '#918b7c'; ctx.fillRect(0, 0, CELL, CELL);
      ctx.fillStyle = '#e4dfcc'; ctx.fillRect(2, 2, CELL - 4, CELL - 4);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const cx = 9.5 + 15 * i, cy = 9.5 + 15 * j;
        ctx.fillStyle = '#99917b'; ctx.beginPath(); ctx.arc(cx, cy + 1, 3.3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = '#f3efdc'; ctx.beginPath(); ctx.arc(cx - .6, cy - .7, 2.7, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.restore();
    }
    fill('rust', '#6e5a4a');
    grain(ctx, R.rust, r, 400, ['rgba(130,72,38,.6)', 'rgba(50,40,34,.6)', 'rgba(150,110,80,.35)'], 4);
    fill('crate', '#fff');
    { // Canasta plástica: rejilla oscura sobre el color del vértice.
      const [x, y] = R.crate; ctx.fillStyle = 'rgba(0,0,0,.72)';
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) ctx.fillRect(x + 5 + i * 9, y + 12 + j * 11, 6, 8);
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(x, y + 2, 64, 5);
    }
    fill('tire', '#242426');
    { const [x, y] = R.tire; ctx.fillStyle = '#121213'; for (let i = 0; i < 9; i++) ctx.fillRect(x, y + i * 7 + 2, 64, 3); }
    fill('cardboard', '#b58f62');
    grain(ctx, R.cardboard, r, 200, ['rgba(90,62,34,.3)', 'rgba(210,180,140,.3)'], 3);
    { const [x, y] = R.cardboard; ctx.fillStyle = 'rgba(214,198,158,.7)'; ctx.fillRect(x + 27, y, 10, 64); }
    fill('sack', '#c9bc9a');
    { const [x, y] = R.sack; ctx.strokeStyle = 'rgba(90,76,50,.4)'; ctx.lineWidth = 1;
      for (let i = 0; i < 22; i++) { ctx.beginPath(); ctx.moveTo(x, y + i * 3); ctx.lineTo(x + 64, y + i * 3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + i * 3, y); ctx.lineTo(x + i * 3, y + 64); ctx.stroke(); } }
    fill('canvas', '#847f74');
    grain(ctx, R.canvas, r, 240, ['rgba(40,40,36,.13)', 'rgba(210,206,194,.1)'], 1.8);
    fill('tank', '#262522');
    fill('rebar', '#5a4336');
    grain(ctx, R.rebar, r, 240, ['rgba(120,64,30,.7)', 'rgba(36,26,20,.7)'], 3);
    // Lonas de fachada, viejas. Sobre un tejadillo la celda se estira catorce veces a lo ancho: las manchas van
    // angostas y altas para verse redondas desde la calle. El desgaste sale de un azar propio de cada lona; el grano
    // de siempre se sortea igual y queda debajo de la tela.
    [['awning', '#a5503f', '#d8ceb4', .36], ['awning2', '#406382', '#d5cebb', .24]].forEach(([name, a, b, velo], n) => {
      const [x, y, w, h] = R[name], q = rng(9857 + n * 7919), fin = y + h;
      const borron = (cx, cy, rx, ry, tinta) => {
        ctx.save(); ctx.translate(cx, cy); ctx.scale(rx, ry);
        const g = ctx.createRadialGradient(0, 0, .1, 0, 0, 1);
        g.addColorStop(0, tinta); g.addColorStop(1, tinta.replace(/,[^,]+\)$/, ',0)'));
        ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      };
      grain(ctx, R[name], r, 120, ['rgba(30,26,20,.14)'], 4);
      // Dieciséis rayas angostas: con ocho, el faldón de un tejadillo de cuatro metros eran bloques de medio metro.
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i & 1 ? a : b; ctx.fillRect(x + i * 4, y, 4, h);
        ctx.fillStyle = q() < .5 ? `rgba(228,218,192,${(.03 + q() * .13).toFixed(2)})` : `rgba(44,38,28,${(.02 + q() * .09).toFixed(2)})`;
        ctx.fillRect(x + i * 4, y, 4, h);
      }
      const sol = ctx.createLinearGradient(0, y, 0, fin);
      sol.addColorStop(0, `rgba(214,204,176,${velo})`); sol.addColorStop(1, `rgba(196,186,158,${(velo * .4).toFixed(2)})`);
      ctx.fillStyle = sol; ctx.fillRect(x, y, w, h);
      for (let i = 0; i < 7; i++) { const rx = 1 + q() * 2.4, ry = 7 + q() * 13; borron(x + rx + q() * (w - rx * 2), y + ry + q() * (h - 8 - ry * 2), rx, ry, 'rgba(236,228,206,.24)'); }
      for (let i = 0; i < 5; i++) {
        const px = x + (i + .25 + q() * .5) * w / 5, ancho = 2 + q() * 2.5, desde = Math.max(x, px - ancho), hasta = Math.min(x + w, px + ancho);
        const onda = ctx.createLinearGradient(px - ancho, 0, px + ancho, 0);
        onda.addColorStop(0, 'rgba(30,26,18,0)'); onda.addColorStop(.42, 'rgba(30,26,18,.17)'); onda.addColorStop(.5, 'rgba(30,26,18,.03)');
        onda.addColorStop(.62, 'rgba(240,232,212,.14)'); onda.addColorStop(1, 'rgba(240,232,212,0)');
        ctx.fillStyle = onda; ctx.fillRect(desde, y, hasta - desde, h);
      }
      for (let i = 0; i < 9; i++) {
        const rx = .5 + q() * .9, ry = 3.5 + q() * 7, mx = x + rx + q() * (w - rx * 2), my = y + ry + q() * h * .55;
        borron(mx, my, rx, ry, `rgba(62,56,40,${(.2 + q() * .22).toFixed(2)})`);
        const chorro = ctx.createLinearGradient(0, my, 0, fin);
        chorro.addColorStop(0, 'rgba(52,46,34,0)'); chorro.addColorStop(.12, 'rgba(52,46,34,.17)'); chorro.addColorStop(1, 'rgba(52,46,34,.03)');
        const ancho = rx * (.5 + q() * .5);
        ctx.fillStyle = chorro; ctx.fillRect(mx - ancho / 2, my, ancho, fin - my);
      }
      const pared = ctx.createLinearGradient(0, y, 0, y + 7);
      pared.addColorStop(0, 'rgba(46,40,30,.3)'); pared.addColorStop(1, 'rgba(46,40,30,0)');
      ctx.fillStyle = pared; ctx.fillRect(x, y, w, 7);
      for (let i = 0; i < 220; i++) {
        const alto = 3 + q() * 5;
        ctx.fillStyle = q() < .55 ? 'rgba(36,30,22,.08)' : 'rgba(244,236,214,.08)';
        ctx.fillRect(x + q() * (w - .5), y + q() * (h - alto), .5, alto);
      }
      const dobladillo = ctx.createLinearGradient(0, fin - 11, 0, fin);
      dobladillo.addColorStop(0, 'rgba(30,26,20,0)'); dobladillo.addColorStop(.25, 'rgba(30,26,20,.13)'); dobladillo.addColorStop(1, 'rgba(30,26,20,.24)');
      ctx.fillStyle = dobladillo; ctx.fillRect(x, fin - 11, w, 11);
      ctx.fillStyle = 'rgba(34,28,20,.2)'; ctx.fillRect(x, fin - 8.6, w, .6);
      ctx.fillStyle = 'rgba(232,224,204,.26)';
      for (let bx = x + .4; bx < x + w - .5; bx += 1.1) ctx.fillRect(bx, fin - 7.6, .5, .7);
      for (let bx = x; bx < x + w - .3;) {
        const paso = .4 + q() * 1.2, arriba = fin - .6 - q() * 2.4;
        ctx.fillStyle = q() < .5 ? 'rgba(28,24,18,.32)' : 'rgba(214,206,184,.24)'; ctx.fillRect(bx, arriba, Math.min(paso * .7, x + w - bx), fin - arriba);
        bx += paso;
      }
    });
    fill('meter', '#8c8f8a');
    { const [x, y] = R.meter; ctx.fillStyle = '#1b1d1e'; ctx.fillRect(x + 14, y + 8, 36, 22); ctx.fillStyle = '#e8e7dc'; ctx.beginPath(); ctx.arc(x + 32, y + 19, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#505350'; ctx.fillRect(x + 8, y + 40, 48, 3); ctx.fillRect(x + 8, y + 50, 48, 3); }
    // Ropa tendida: solo color y arrugas, sin estampados reconocibles.
    for (const [name, base] of [['cloth', '#c74a4a'], ['cloth2', '#3e6fa8'], ['cloth3', '#e6dfc9']]) {
      fill(name, base);
      const [x, y] = R[name]; ctx.fillStyle = 'rgba(0,0,0,.14)';
      for (let i = 0; i < 6; i++) ctx.fillRect(x + 4 + i * 11, y, 2.5, 64);
    }
    // Avisos a mano, sin ninguna marca: lo que de verdad se ve pegado en los postes.
    writeSign(ctx, R.adA, ['SE ARRIENDA', 'PIEZA', '3-14'], '#1b1b1b', '#f1e04f', r);
    writeSign(ctx, R.adB, ['COMPRO', 'CHATARRA'], '#ffffff', '#b12a22', r);
    writeSign(ctx, R.adC, ['CLASES', 'GUITARRA'], '#10335c', '#e7e3d4', r);
    writeSign(ctx, R.adD, ['MINUTOS', 'A $100'], '#f6e24a', '#1f4d7a', r);
    writeSign(ctx, R.paintA, ['TIENDA', 'DOÑA ROSA'], '#7a1f1a', '#e9e0c6', r);
    writeSign(ctx, R.paintB, ['CERRAJERÍA', 'LLAVES'], '#f4efe0', '#245b3a', r);
    writeSign(ctx, R.paintC, ['ARREGLOS', 'ROPA'], '#14335c', '#ecd24a', r);
    writeSign(ctx, R.paintD, ['SE VENDE', 'HIELO'], '#ffffff', '#2e7fb5', r);
    // Manchas de humedad: con alfa, las reparte el cubrimiento de MSAA sin ordenar transparencias.
    for (const name of ['damp', 'damp2']) {
      const [x, y] = R[name];
      ctx.clearRect(x, y, CELL, CELL);
      // Velo ancho y encima chorreones finos de distinto largo: nunca una fila pareja de barras.
      const veil = ctx.createLinearGradient(0, y, 0, y + CELL);
      veil.addColorStop(0, 'rgba(30,27,22,.34)'); veil.addColorStop(.55, 'rgba(30,27,22,.12)'); veil.addColorStop(1, 'rgba(30,27,22,0)');
      ctx.fillStyle = veil; ctx.fillRect(x + 1, y, CELL - 2, CELL);
      for (let i = 0; i < 26; i++) {
        const dx = x + 3 + r() * 58, width = .7 + r() * r() * 5, length = 10 + r() * r() * 52;
        const g = ctx.createLinearGradient(0, y, 0, y + length);
        const a = (.14 + r() * .3).toFixed(2);
        g.addColorStop(0, `rgba(22,20,16,${a})`); g.addColorStop(1, 'rgba(22,20,16,0)');
        ctx.fillStyle = g; ctx.fillRect(dx, y, width, length);
      }
    }
    fill('bin', '#3c5a48');
    { const [x, y] = R.bin; ctx.fillStyle = 'rgba(0,0,0,.36)'; for (let i = 0; i < 5; i++) ctx.fillRect(x + 6 + i * 12, y + 6, 4, 52); ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x, y + 4, 64, 4); }
    fill('cone', '#e8602a');
    { const [x, y] = R.cone; ctx.fillStyle = '#f0ece0'; ctx.fillRect(x, y + 18, 64, 14); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x, y + 54, 64, 10); }
    fill('chair', '#fff');
    { const [x, y] = R.chair; ctx.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 0; i < 6; i++) ctx.fillRect(x + 6 + i * 9, y + 6, 4, 26); }
    fill('trans', '#7d8784');
    { const [x, y] = R.trans; ctx.fillStyle = 'rgba(0,0,0,.28)'; for (let i = 0; i < 7; i++) ctx.fillRect(x, y + 10 + i * 7, 64, 3); ctx.fillStyle = 'rgba(160,80,40,.4)'; ctx.fillRect(x, y + 58, 64, 6); }
    fill('box', '#9d7a52');
    { const [x, y] = R.box; ctx.fillStyle = 'rgba(220,206,170,.7)'; ctx.fillRect(x + 28, y, 8, 64); ctx.strokeStyle = 'rgba(70,50,28,.5)'; ctx.strokeRect(x + 2, y + 2, 60, 60); }
    drawDoors(ctx, R, r);
    fill('wood', '#6d4f33');
    { const [x, y] = R.wood; ctx.fillStyle = 'rgba(30,20,10,.3)'; for (let i = 0; i < 6; i++) ctx.fillRect(x, y + 4 + i * 11, 64, 2); }
    drawLocales(ctx, R, r);
    // Lo de las azoteas se ensucia al final y con azar propio: las celdas de antes gastan el de siempre.
    const q = rng(0x5a207ea);
    { // Concreto viejo: manchas, chorreones que bajan y la sombra de contacto abajo.
      const [x, y, w, h] = R.canvas;
      const mancha = (cx, cy, radio, tinta) => {
        const g = ctx.createRadialGradient(cx, cy, radio * .15, cx, cy, radio);
        g.addColorStop(0, tinta); g.addColorStop(1, tinta.replace(/,[^,]+\)$/, ',0)'));
        const x0 = Math.max(x, cx - radio), y0 = Math.max(y, cy - radio);
        ctx.fillStyle = g; ctx.fillRect(x0, y0, Math.min(x + w, cx + radio) - x0, Math.min(y + h, cy + radio) - y0);
      };
      for (let i = 0; i < 8; i++) mancha(x + q() * w, y + q() * h, 7 + q() * 13, i % 3 ? 'rgba(50,46,38,.24)' : 'rgba(176,170,156,.2)');
      for (let i = 0; i < 7; i++) {
        const sx = x + 2 + q() * (w - 8), largo = 14 + q() * 34, g = ctx.createLinearGradient(0, y, 0, y + largo);
        g.addColorStop(0, 'rgba(40,36,30,.26)'); g.addColorStop(1, 'rgba(40,36,30,0)');
        ctx.fillStyle = g; ctx.fillRect(sx, y, 1.2 + q() * 3.5, largo);
      }
      const pie = ctx.createLinearGradient(0, y + h - 9, 0, y + h);
      pie.addColorStop(0, 'rgba(34,31,27,0)'); pie.addColorStop(1, 'rgba(34,31,27,.5)');
      ctx.fillStyle = pie; ctx.fillRect(x, y + h - 9, w, 9);
    }
    { // Tanque negro mate: polvo que aclara arriba, costillas apenas marcadas y barro salpicado al pie.
      const [x, y, w, h] = R.tank;
      const polvo = ctx.createLinearGradient(0, y, 0, y + 20);
      polvo.addColorStop(0, 'rgba(74,70,63,.95)'); polvo.addColorStop(.5, 'rgba(74,70,63,.6)'); polvo.addColorStop(1, 'rgba(74,70,63,0)');
      ctx.fillStyle = polvo; ctx.fillRect(x, y, w, 20);
      for (const fila of [24, 35, 46, 55]) {
        ctx.fillStyle = 'rgba(255,255,255,.02)'; ctx.fillRect(x, y + fila, w, 1.5);
        ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(x, y + fila + 1.5, w, 1.5);
      }
      for (let i = 0; i < 10; i++) {
        const sx = x + 1 + q() * (w - 6), largo = 16 + q() * 30, g = ctx.createLinearGradient(0, y + 6, 0, y + 6 + largo);
        g.addColorStop(0, 'rgba(96,90,79,.26)'); g.addColorStop(1, 'rgba(96,90,79,0)');
        ctx.fillStyle = g; ctx.fillRect(sx, y + 6, 1 + q() * 3, largo);
      }
      grain(ctx, [x, y, w - 2, h - 2], q, 260, ['rgba(120,112,98,.09)', 'rgba(10,10,9,.14)'], 1.6);
      const pie = ctx.createLinearGradient(0, y + h - 10, 0, y + h);
      pie.addColorStop(0, 'rgba(84,76,63,0)'); pie.addColorStop(1, 'rgba(84,76,63,.5)');
      ctx.fillStyle = pie; ctx.fillRect(x, y + h - 10, w, 10);
    }
    { // Lata de zinc: galvanizado apagado, la onda a lo largo y el óxido que baja desde el traslapo.
      const [x, y, w, h] = R.lata;
      ctx.fillStyle = '#7b7c74'; ctx.fillRect(x, y, w, h);
      for (let i = 0; i < 12; i++) {
        const px = x + q() * w, ancho = 10 + q() * 30, x0 = Math.max(x, px - ancho / 2);
        ctx.fillStyle = i % 2 ? 'rgba(98,99,92,.3)' : 'rgba(146,146,136,.24)';
        ctx.fillRect(x0, y, Math.min(x + w, px + ancho / 2) - x0, h);
      }
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = 'rgba(176,176,166,.2)'; ctx.fillRect(x, y + i * 3.2 + .3, w, 1);
        ctx.fillStyle = 'rgba(30,30,27,.34)'; ctx.fillRect(x, y + i * 3.2 + 1.9, w, 1.1);
      }
      const oxido = ctx.createLinearGradient(x, 0, x + 34, 0);
      oxido.addColorStop(0, 'rgba(104,82,68,.85)'); oxido.addColorStop(.45, 'rgba(104,82,68,.5)'); oxido.addColorStop(1, 'rgba(104,82,68,0)');
      ctx.fillStyle = oxido; ctx.fillRect(x, y, 34, h);
      for (let i = 0; i < 9; i++) {
        const sy = y + q() * (h - 3), largo = 30 + q() * 70, g = ctx.createLinearGradient(x, 0, x + largo, 0);
        g.addColorStop(0, 'rgba(112,88,74,.7)'); g.addColorStop(1, 'rgba(112,88,74,0)');
        ctx.fillStyle = g; ctx.fillRect(x, sy, largo, 1.4 + q() * 2.8);
      }
      grain(ctx, [x, y, w - 3, h - 3], q, 220, ['rgba(60,58,52,.16)', 'rgba(168,168,158,.1)', 'rgba(104,84,70,.2)'], 2.4);
      const borde = ctx.createLinearGradient(x + w - 7, 0, x + w, 0);
      borde.addColorStop(0, 'rgba(46,42,38,0)'); borde.addColorStop(1, 'rgba(46,42,38,.5)');
      ctx.fillStyle = borde; ctx.fillRect(x + w - 7, y, 7, h);
    }
  }
  detailCache = { texture: finishTexture(surface), uv: DETAIL_UV };
  detailCache.texture.name = 'Atlas de mobiliario urbano';
  detailCache.texture.addEventListener('dispose', () => { detailCache = null; });
  return detailCache;
}

let glowCache = null;
/** Mancha radial sin canvas: sirve para el charco de luz del farol y su halo, también en Node. */
export function glowTexture() {
  if (glowCache) return glowCache;
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dz = (z + .5) / size * 2 - 1;
    const d = Math.min(1, Math.hypot(dx, dz)), fall = (1 - d) * (1 - d) * (1 + d * .6);
    const i = (z * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(fall * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  texture.name = 'Resplandor de farol';
  texture.addEventListener('dispose', () => { glowCache = null; });
  return glowCache = texture;
}
