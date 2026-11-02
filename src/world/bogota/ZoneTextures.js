// src/world/bogota/ZoneTextures.js
// Texturas de los barrios del oriente, generadas una sola vez y compartidas por todas las casas.
// El muro, el adoquín y los detalles viven en hojas únicas: una sola textura y un solo material
// por sector, en vez de una fachada por casa. Sin DOM (pruebas en Node) devuelven texturas vacías.
import * as THREE from 'three';
import { rng } from './textures.js';

const hasCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';
const cache = new Map();

function makeCanvas(w, h) {
  if (!hasCanvas()) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext?.('2d');
  return ctx ? { c, ctx, w, h } : null;
}

function asTexture(canvas, { srgb = true } = {}) {
  const texture = canvas ? new THREE.CanvasTexture(canvas.c) : new THREE.Texture();
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

const once = (key, build) => {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
};
/** Al cerrar el distrito sus mapas se liberan: una partida nueva debe volver a crearlos. */
export function forgetZoneTextures() { cache.clear(); }

const gray = value => `rgb(${value},${value},${value})`;
const lerp = (a, b, t) => a + (b - a) * t;
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round((n >> 16 & 255) * f)), g = Math.min(255, Math.round((n >> 8 & 255) * f)), b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

// Mancha blanda que da la vuelta en U para que la franja repita sin costuras.
function blot(ctx, w, cx, cy, rx, ry, color, x0 = 0) {
  for (const dx of [-w, 0, w]) {
    const px = cx + dx;
    if (px + rx < x0 || px - rx > x0 + w) continue;
    ctx.save(); ctx.translate(px, cy); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * .1, 0, 0, rx);
    g.addColorStop(0, color); g.addColorStop(1, color.replace(/,[^,]+\)$/, ',0)'));
    ctx.fillStyle = g; ctx.fillRect(-rx, -rx, rx * 2, rx * 2); ctx.restore();
  }
}

// Canto irregular: polígono ruidoso que da la vuelta en ambos ejes.
function stonePath(ctx, r, x, y, w, h, wobble) {
  const points = [], n = 12;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    // Superelipse: esquinas redondeadas pero sin llegar a círculo.
    const px = Math.sign(c) * Math.pow(Math.abs(c), .55) * w / 2, py = Math.sign(s) * Math.pow(Math.abs(s), .55) * h / 2;
    points.push([x + px + (r() - .5) * wobble, y + py + (r() - .5) * wobble]);
  }
  ctx.beginPath();
  points.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
  ctx.closePath();
}

/** Adoquín de piedra: la textura cubre 4 × 4 m y repite sin costuras. */
export function cobblestones() {
  return once('adoquin', () => {
    const s = 1024, a = makeCanvas(s, s), b = makeCanvas(s, s), c = makeCanvas(s, s);
    if (!a) return { map: asTexture(null), bumpMap: asTexture(null, { srgb: false }), roughnessMap: asTexture(null, { srgb: false }), metersPerTile: 4 };
    const r = rng(7741);
    a.ctx.fillStyle = '#2a2622'; a.ctx.fillRect(0, 0, s, s);
    b.ctx.fillStyle = '#3c3c3c'; b.ctx.fillRect(0, 0, s, s);
    c.ctx.fillStyle = '#f0f0f0'; c.ctx.fillRect(0, 0, s, s);
    const rowH = 41, colors = ['#7d7468', '#6d665c', '#8b8071', '#5f5a52', '#74685a', '#857a6c', '#6a6157', '#92887a', '#5a5249'];
    const rows = Math.round(s / rowH);
    for (let row = 0; row < rows; row++) {
      const y = (row + .5) * s / rows;
      let x = row % 2 ? -20 : 0;
      while (x < s) {
        const w = 54 + r() * 34, h = s / rows - 4 - r() * 5;
        const color = colors[Math.floor(r() * colors.length)];
        const f = .9 + r() * .18, dry = 130 + Math.floor(r() * 50);
        const cx = x + w / 2, cy = y + (r() - .5) * 3;
        for (const dx of cx + w > s ? [0, -s] : cx - w < 0 ? [0, s] : [0]) {
          for (const dy of cy + h > s ? [0, -s] : cy - h < 0 ? [0, s] : [0]) {
            const seed = r() * 1e9 >>> 0;
            const rr = rng(seed);
            stonePath(a.ctx, rr, cx + dx, cy + dy, w - 4, h, 4);
            a.ctx.fillStyle = shade(color, f); a.ctx.fill();
            const rb = rng(seed);
            stonePath(b.ctx, rb, cx + dx, cy + dy, w - 4, h, 4);
            const dome = b.ctx.createRadialGradient(cx + dx, cy + dy, 2, cx + dx, cy + dy, Math.max(w, h) * .55);
            dome.addColorStop(0, '#c8c8c8'); dome.addColorStop(.6, '#a2a2a2'); dome.addColorStop(1, '#646464');
            b.ctx.fillStyle = dome; b.ctx.fill();
            const rc = rng(seed);
            stonePath(c.ctx, rc, cx + dx, cy + dy, w - 4, h, 4);
            c.ctx.fillStyle = gray(dry); c.ctx.fill();
            // Canto más claro arriba: desgastado por los zapatos y la lluvia.
            a.ctx.save();
            const rl = rng(seed);
            stonePath(a.ctx, rl, cx + dx, cy + dy - 1.5, w - 12, h - 8, 3);
            a.ctx.fillStyle = 'rgba(214,202,180,.06)'; a.ctx.fill();
            a.ctx.restore();
          }
        }
        x += w;
      }
    }
    // Grano mineral, huellas de grasa y tierra entre juntas, sin formar líneas rectas.
    for (let i = 0; i < 26000; i++) {
      const t = r();
      a.ctx.fillStyle = t < .5 ? 'rgba(25,22,18,.13)' : 'rgba(225,215,195,.09)';
      const d = .6 + r() * 1.6;
      a.ctx.fillRect(r() * s, r() * s, d, d);
    }
    for (let i = 0; i < 16; i++) {
      const x = r() * s, y = r() * s, rad = 50 + r() * 170;
      blot(a.ctx, s, x, y, rad, rad * (.5 + r() * .6), r() < .55 ? 'rgba(28,25,20,.2)' : 'rgba(120,108,88,.14)');
    }
    return { map: asTexture(a), bumpMap: asTexture(b, { srgb: false }), roughnessMap: asTexture(c, { srgb: false }), metersPerTile: 4 };
  });
}

/** Losas de piedra para la plaza y los andenes angostos; cubre seis metros por lado. */
export function flagstones(seed = 3381, { tint = '#8f8878', slabW = 170, slabH = 108 } = {}) {
  return once(`losas:${seed}:${tint}`, () => {
    const s = 1024, a = makeCanvas(s, s), b = makeCanvas(s, s), c = makeCanvas(s, s);
    if (!a) return { map: asTexture(null), bumpMap: asTexture(null, { srgb: false }), roughnessMap: asTexture(null, { srgb: false }), metersPerTile: 6 };
    const r = rng(seed);
    a.ctx.fillStyle = shade(tint, .6); a.ctx.fillRect(0, 0, s, s);
    b.ctx.fillStyle = '#585858'; b.ctx.fillRect(0, 0, s, s);
    c.ctx.fillStyle = '#e8e8e8'; c.ctx.fillRect(0, 0, s, s);
    const rows = Math.round(s / slabH);
    const rowHeight = s / rows;
    for (let row = 0; row < rows; row++) {
      const count = Math.round(s / slabW), width = s / count, off = row % 2 ? width / 2 : 0;
      for (let i = -1; i <= count; i++) {
        const x = i * width + off, y = row * rowHeight;
        const f = .93 + r() * .15, warm = r();
        a.ctx.fillStyle = shade(tint, f);
        a.ctx.fillRect(x + 2.5, y + 2.5, width - 5, rowHeight - 5);
        if (warm < .25) { a.ctx.fillStyle = 'rgba(110,84,58,.08)'; a.ctx.fillRect(x + 2.5, y + 2.5, width - 5, rowHeight - 5); }
        b.ctx.fillStyle = gray(150 + Math.floor(r() * 26));
        b.ctx.fillRect(x + 2.5, y + 2.5, width - 5, rowHeight - 5);
        b.ctx.fillStyle = 'rgba(255,255,255,.14)'; b.ctx.fillRect(x + 3, y + 3, width - 6, 2);
        c.ctx.fillStyle = gray(165 + Math.floor(r() * 45));
        c.ctx.fillRect(x + 2.5, y + 2.5, width - 5, rowHeight - 5);
      }
    }
    for (let i = 0; i < 30000; i++) {
      const t = r();
      a.ctx.fillStyle = t < .5 ? 'rgba(35,32,26,.11)' : 'rgba(235,228,210,.08)';
      const d = .6 + r() * 1.4;
      a.ctx.fillRect(r() * s, r() * s, d, d);
    }
    for (let i = 0; i < 12; i++) blot(a.ctx, s, r() * s, r() * s, 60 + r() * 150, 40 + r() * 100, r() < .6 ? 'rgba(46,42,34,.2)' : 'rgba(150,140,118,.12)');
    return { map: asTexture(a), bumpMap: asTexture(b, { srgb: false }), roughnessMap: asTexture(c, { srgb: false }), metersPerTile: 6 };
  });
}

/** Medidas del muro colonial: ocho franjas de 7 m de alto y 28 m de largo cada una. */
export const WALL_SHEET = Object.freeze({ strips: 8, stripMeters: 7, uMeters: 28 });
const WALL_COLORS = Object.freeze([
  // [pared, zócalo]
  ['#e8e0cd', '#3f4a42'], // blanco manchado, zócalo verde botella
  ['#e2cfa2', '#5a3b2a'], // crema, zócalo café
  ['#d09a4f', '#3b342c'], // ocre
  ['#a84f38', '#2e2a26'], // almagre
  ['#4d6f99', '#2b2f36'], // añil
  ['#d9d5c6', '#7a3a2a'], // blanco con zócalo almagre
  ['#7f9671', '#39402f'], // verde viejo
  ['#c78d79', '#42332d']  // rosa viejo
]);
export const WALL_STRIP_COUNT = WALL_COLORS.length;

/** Muro encalado con franjas de color: zócalo pintado, humedad, chorreados y pañete caído. */
export function colonialWallSheet() {
  return once('muro-colonial', () => {
    const W = 1024, H = 2048, sh = H / WALL_SHEET.strips;
    const a = makeCanvas(W, H), b = makeCanvas(W, H);
    if (!a) return { map: asTexture(null), bumpMap: asTexture(null, { srgb: false }) };
    const r = rng(9101), pm = sh / WALL_SHEET.stripMeters;
    WALL_COLORS.forEach(([wall, plinth], strip) => {
      const y1 = H - strip * sh, y0 = y1 - sh;
      const X = a.ctx, B = b.ctx;
      X.save(); X.beginPath(); X.rect(0, y0, W, sh); X.clip();
      B.save(); B.beginPath(); B.rect(0, y0, W, sh); B.clip();
      X.fillStyle = wall; X.fillRect(0, y0, W, sh);
      B.fillStyle = '#868686'; B.fillRect(0, y0, W, sh);
      // Capas de cal: parches grandes de tono distinto, muy tenues.
      for (let i = 0; i < 34; i++) {
        const x = r() * W, y = y0 + r() * sh, rad = 30 + r() * 120;
        X.globalAlpha = 1;
        blot(X, W, x, y, rad, rad * (.35 + r() * .6), r() < .5 ? 'rgba(255,250,235,.1)' : 'rgba(74,62,44,.09)');
      }
      // Grano del pañete, en color y en relieve.
      for (let i = 0; i < 16000; i++) {
        const x = r() * W, y = y0 + r() * sh, d = .6 + r() * 1.5;
        X.fillStyle = r() < .5 ? 'rgba(50,42,30,.07)' : 'rgba(255,250,235,.07)'; X.fillRect(x, y, d, d);
        B.fillStyle = r() < .5 ? '#7a7a7a' : '#949494'; B.fillRect(x, y, d, d);
      }
      // Chorreados bajo el alero y bajo la línea del entrepiso.
      for (const top of [3.25, 6.35]) {
        const yt = y1 - top * pm;
        const band = X.createLinearGradient(0, yt, 0, yt + .55 * pm);
        band.addColorStop(0, 'rgba(36,30,24,.42)'); band.addColorStop(1, 'rgba(36,30,24,0)');
        X.fillStyle = band; X.fillRect(0, yt, W, .55 * pm);
        for (let i = 0; i < 26; i++) {
          const x = r() * W, len = (.5 + r() * 1.6) * pm, width = 2 + r() * 7;
          const g = X.createLinearGradient(0, yt, 0, yt + len);
          g.addColorStop(0, 'rgba(46,40,30,.2)'); g.addColorStop(1, 'rgba(46,40,30,0)');
          X.fillStyle = g; X.fillRect(x, yt, width, len);
        }
      }
      // Pañete caído, casi siempre cerca del andén: desportillado, sin formas redondas ni borde parejo.
      for (let i = 0; i < 6; i++) {
        const low = r() < .8;
        const x = r() * W, y = low ? y1 - (.95 + r() * 1.1) * pm : y0 + r() * sh * .6;
        const w = (.1 + r() * .34) * pm, h = (.05 + r() * .16) * pm;
        const pr = rng(r() * 1e9 >>> 0), points = [];
        const sides = 16 + Math.floor(pr() * 8);
        for (let k = 0; k < sides; k++) {
          const t = k / sides * Math.PI * 2, jag = .28 + pr() * pr() * 1.05;
          points.push([x + Math.cos(t) * w * jag, y + Math.sin(t) * h * jag]);
        }
        const path = ctx => { ctx.beginPath(); points.forEach(([px, py], k) => k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); };
        path(X); X.fillStyle = 'rgba(137,112,86,.62)'; X.fill();
        X.strokeStyle = 'rgba(46,38,28,.22)'; X.lineWidth = 1; X.stroke();
        path(B); B.fillStyle = '#747474'; B.fill();
      }
      // Humedad que sube del andén.
      const damp = X.createLinearGradient(0, y1 - 1.9 * pm, 0, y1 - .75 * pm);
      damp.addColorStop(0, 'rgba(52,44,30,0)'); damp.addColorStop(1, 'rgba(52,44,30,.34)');
      X.fillStyle = damp; X.fillRect(0, y1 - 1.9 * pm, W, 1.15 * pm);
      // Zócalo pintado con el borde desigual de la brocha, y hollín de los carros abajo.
      X.fillStyle = plinth;
      X.beginPath(); X.moveTo(0, y1);
      for (let x = 0; x <= W; x += 16) X.lineTo(x, y1 - (.86 + Math.sin(x * .02) * .012 + r() * .012) * pm);
      X.lineTo(W, y1); X.closePath(); X.fill();
      for (let i = 0; i < 700; i++) {
        X.fillStyle = r() < .5 ? 'rgba(235,230,215,.08)' : 'rgba(10,10,10,.1)';
        X.fillRect(r() * W, y1 - r() * .86 * pm, 1 + r() * 3, 1 + r() * 2);
      }
      const soot = X.createLinearGradient(0, y1 - .5 * pm, 0, y1);
      soot.addColorStop(0, 'rgba(18,16,12,0)'); soot.addColorStop(1, 'rgba(18,16,12,.5)');
      X.fillStyle = soot; X.fillRect(0, y1 - .5 * pm, W, .5 * pm);
      B.fillStyle = '#9a9a9a'; B.fillRect(0, y1 - .86 * pm, W, .86 * pm);
      X.restore(); B.restore();
    });
    return { map: asTexture(a), bumpMap: asTexture(b, { srgb: false }) };
  });
}

/** Ladrillo rojo bogotano: 2,88 m por lado, misma medida del ladrillo de la ciudad. */
export const RED_BRICK_METERS = 2.88;
export function redBrick() {
  return once('ladrillo-rojo', () => {
    const s = 512, a = makeCanvas(s, s), b = makeCanvas(s, s), c = makeCanvas(s, s);
    if (!a) return { map: asTexture(null), bumpMap: asTexture(null, { srgb: false }), roughnessMap: asTexture(null, { srgb: false }) };
    const r = rng(7123);
    const pm = s / RED_BRICK_METERS, bw = .36 * pm, bh = .12 * pm, joint = 1.4;
    a.ctx.fillStyle = '#857a6b'; a.ctx.fillRect(0, 0, s, s);
    b.ctx.fillStyle = '#6c6c6c'; b.ctx.fillRect(0, 0, s, s);
    c.ctx.fillStyle = '#e4e4e4'; c.ctx.fillRect(0, 0, s, s);
    const colors = ['#8f4c36', '#98573e', '#854632', '#9e5e43', '#8d4e39', '#783d2c', '#945138', '#a26444'];
    let row = 0;
    for (let y = 0; y < s - .5; y += bh, row++) {
      for (let x = (row % 2 ? -bw / 2 : 0); x < s; x += bw) {
        const color = colors[Math.floor(r() * colors.length)];
        a.ctx.fillStyle = color; a.ctx.fillRect(x + joint, y + joint, bw - joint, bh - joint);
        a.ctx.fillStyle = 'rgba(255,214,170,.1)'; a.ctx.fillRect(x + joint, y + joint, bw - joint, 1);
        a.ctx.fillStyle = 'rgba(40,18,10,.16)'; a.ctx.fillRect(x + joint, y + bh - 1.5, bw - joint, 1.5);
        b.ctx.fillStyle = gray(132 + Math.floor(r() * 14)); b.ctx.fillRect(x + joint, y + joint, bw - joint, bh - joint);
        c.ctx.fillStyle = gray(190 + Math.floor(r() * 34)); c.ctx.fillRect(x + joint, y + joint, bw - joint, bh - joint);
      }
    }
    for (let i = 0; i < 9000; i++) {
      a.ctx.fillStyle = r() < .5 ? 'rgba(30,14,8,.1)' : 'rgba(255,220,180,.07)';
      a.ctx.fillRect(r() * s, r() * s, .8 + r() * 1.4, .8 + r());
    }
    for (let i = 0; i < 8; i++) blot(a.ctx, s, r() * s, r() * s, 40 + r() * 80, 30 + r() * 80, 'rgba(36,26,20,.14)');
    return { map: asTexture(a), bumpMap: asTexture(b, { srgb: false }), roughnessMap: asTexture(c, { srgb: false }) };
  });
}

/** Teja de barro del oriente: la textura cubre 2 × 2 m, con hiladas a lo largo del alero. */
export function clayTiles() {
  return once('teja-barro', () => {
    const s = 512, a = makeCanvas(s, s), b = makeCanvas(s, s);
    if (!a) return { map: asTexture(null), bumpMap: asTexture(null, { srgb: false }) };
    const r = rng(4411), tw = 32, th = 42;
    a.ctx.fillStyle = '#4a3226'; a.ctx.fillRect(0, 0, s, s);
    b.ctx.fillStyle = '#505050'; b.ctx.fillRect(0, 0, s, s);
    const colors = ['#a2613f', '#96573a', '#ad6c47', '#8b4f35', '#b5764f', '#7d4731', '#a0683f'];
    for (let row = -1; row * th < s + th; row++) {
      const off = row % 2 ? tw / 2 : 0;
      for (let x = -tw; x < s + tw; x += tw) {
        const base = colors[Math.floor(r() * colors.length)];
        const y = row * th, px = x + off;
        const g = a.ctx.createLinearGradient(px, 0, px + tw, 0);
        g.addColorStop(0, shade(base, .55)); g.addColorStop(.28, base); g.addColorStop(.62, shade(base, 1.08)); g.addColorStop(1, shade(base, .5));
        a.ctx.fillStyle = g; a.ctx.fillRect(px, y, tw - 1, th + 7);
        const shadow = a.ctx.createLinearGradient(0, y, 0, y + 9);
        shadow.addColorStop(0, 'rgba(16,8,4,.55)'); shadow.addColorStop(1, 'rgba(16,8,4,0)');
        a.ctx.fillStyle = shadow; a.ctx.fillRect(px, y, tw - 1, 9);
        const h = b.ctx.createLinearGradient(px, 0, px + tw, 0);
        h.addColorStop(0, '#606060'); h.addColorStop(.5, '#bcbcbc'); h.addColorStop(1, '#606060');
        b.ctx.fillStyle = h; b.ctx.fillRect(px, y, tw - 1, th + 7);
      }
    }
    // Musgo y hollín: los techos de Bogotá nunca son color ladrillo limpio.
    for (let i = 0; i < 24; i++) blot(a.ctx, s, r() * s, r() * s, 25 + r() * 90, 15 + r() * 70, r() < .5 ? 'rgba(66,74,42,.3)' : 'rgba(24,18,14,.3)');
    for (let i = 0; i < 5000; i++) {
      a.ctx.fillStyle = r() < .4 ? 'rgba(92,104,60,.2)' : 'rgba(20,14,10,.14)';
      a.ctx.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
    }
    return { map: asTexture(a), bumpMap: asTexture(b, { srgb: false }) };
  });
}

/** Rectángulos de la hoja de detalles, en celdas de 128 px dentro de una hoja de 1024. */
const CELL = 128, SHEET = 1024;
const cell = (col, row, cols = 1, rows = 1) => Object.freeze({ col, row, cols, rows });
export const DETAIL_CELLS = Object.freeze({
  woodDark: cell(0, 0), woodRed: cell(1, 0), woodLight: cell(2, 0),
  doorGreen: cell(3, 0), doorBlue: cell(4, 0), doorRed: cell(5, 0), doorBrown: cell(6, 0), whiteTrim: cell(7, 0),
  iron: cell(0, 1), plasterCream: cell(1, 1), plasterWhite: cell(2, 1), stoneGray: cell(3, 1),
  stoneLight: cell(4, 1), concrete: cell(5, 1), terracotta: cell(6, 1), hedge: cell(7, 1),
  glassDark: cell(0, 2), glassSky: cell(1, 2), glassLit: cell(2, 2), glassCurtain: cell(3, 2),
  glassCold: cell(4, 2), shutterGreen: cell(5, 2), shutterBlue: cell(6, 2), shutterBrown: cell(7, 2),
  halfTimber: cell(0, 3), redStripe: cell(1, 3), blueStripe: cell(2, 3), greenTarp: cell(3, 3),
  orangeTarp: cell(4, 3), blueTarp: cell(5, 3), burlap: cell(6, 3), shopDark: cell(7, 3),
  barrier: cell(0, 7), plywood: cell(1, 7), mesh: cell(2, 7), sheetMetal: cell(3, 7),
  lampGlass: cell(4, 7), fruit: cell(5, 7), produce: cell(6, 7), rollerDoor: cell(7, 7),
  brick: cell(2, 6), water: cell(3, 6), grass: cell(4, 6), asphalt: cell(5, 6), signObra: cell(6, 6, 2),
  signTinto: cell(0, 4, 2), signLibros: cell(2, 4, 2), signArtes: cell(4, 4, 2), signChicha: cell(6, 4, 2),
  signBarber: cell(0, 5, 2), signFlor: cell(2, 5, 2), signPan: cell(4, 5, 2), signPapel: cell(6, 5, 2),
  signRopa: cell(0, 6, 2)
});

/** Coordenadas UV de una celda, con un margen para que el filtrado no se contagie de la vecina. */
export function detailRect(name) {
  const { col, row, cols, rows } = DETAIL_CELLS[name];
  const pad = 3 / SHEET;
  // La hoja se voltea en Y al subir a la GPU.
  const u0 = col * CELL / SHEET + pad, u1 = (col + cols) * CELL / SHEET - pad;
  const v1 = 1 - row * CELL / SHEET - pad, v0 = 1 - (row + rows) * CELL / SHEET + pad;
  return [u0, v0, u1, v1];
}

/** Toda la carpintería, herrajes, avisos y toldos en una sola hoja y un solo material. */
export function detailSheet() {
  return once('detalles', () => {
    const a = makeCanvas(SHEET, SHEET), e = makeCanvas(SHEET, SHEET);
    if (!a) return { map: asTexture(null), emissiveMap: asTexture(null) };
    const r = rng(1571), X = a.ctx, E = e.ctx;
    E.fillStyle = '#000'; E.fillRect(0, 0, SHEET, SHEET);
    X.fillStyle = '#444'; X.fillRect(0, 0, SHEET, SHEET);
    const at = name => {
      const { col, row, cols, rows } = DETAIL_CELLS[name];
      return { x: col * CELL, y: row * CELL, w: cols * CELL, h: rows * CELL };
    };
    const noise = (cx, cy, w, h, count, light = .06, dark = .1, size = 1.6) => {
      for (let i = 0; i < count; i++) {
        X.fillStyle = r() < .5 ? `rgba(255,248,230,${light})` : `rgba(12,10,8,${dark})`;
        X.fillRect(cx + r() * w, cy + r() * h, .6 + r() * size, .6 + r() * size);
      }
    };
    const wood = (name, base) => {
      const c = at(name);
      X.fillStyle = base; X.fillRect(c.x, c.y, c.w, c.h);
      for (let i = 0; i < 70; i++) {
        X.fillStyle = r() < .5 ? 'rgba(20,10,4,.17)' : 'rgba(255,220,170,.06)';
        const y = c.y + r() * c.h;
        X.fillRect(c.x, y, c.w, .6 + r() * 1.7);
      }
      noise(c.x, c.y, c.w, c.h, 140);
    };
    wood('woodDark', '#3c2616'); wood('woodRed', '#5b2c1b'); wood('woodLight', '#7a5533');
    const door = (name, base) => {
      const c = at(name);
      X.fillStyle = base; X.fillRect(c.x, c.y, c.w, c.h);
      for (let i = 0; i < 60; i++) {
        X.fillStyle = r() < .5 ? 'rgba(16,12,8,.12)' : 'rgba(255,240,220,.05)';
        X.fillRect(c.x + r() * c.w, c.y, .6 + r() * 1.5, c.h);
      }
      // Dos hojas con tableros en relieve pintado; el rectángulo de luz y sombra hace la moldura.
      const panel = (px, py, pw, ph) => {
        X.fillStyle = 'rgba(0,0,0,.34)'; X.fillRect(px, py, pw, ph);
        X.fillStyle = base; X.fillRect(px + 2, py + 2, pw - 3, ph - 3);
        X.fillStyle = 'rgba(255,240,220,.09)'; X.fillRect(px + 2, py + 2, pw - 3, 1.5);
        X.fillStyle = 'rgba(0,0,0,.18)'; X.fillRect(px + 2, py + ph - 3, pw - 3, 2);
      };
      for (const side of [0, 1]) {
        const lx = c.x + 6 + side * (c.w / 2 - 2), lw = c.w / 2 - 12;
        panel(lx, c.y + 8, lw, c.h * .32);
        panel(lx, c.y + c.h * .42, lw, c.h * .22);
        panel(lx, c.y + c.h * .7, lw, c.h * .24);
      }
      X.fillStyle = 'rgba(0,0,0,.55)'; X.fillRect(c.x + c.w / 2 - 1, c.y, 2, c.h);
      X.fillStyle = '#b09660'; X.fillRect(c.x + c.w / 2 + 4, c.y + c.h * .52, 3, 8);
      noise(c.x, c.y, c.w, c.h, 90);
    };
    door('doorGreen', '#2f4c3a'); door('doorBlue', '#2d4a6b'); door('doorRed', '#6e2a20'); door('doorBrown', '#4b2f1c');
    const solid = (name, base, count = 120, light = .05, dark = .08) => {
      const c = at(name);
      X.fillStyle = base; X.fillRect(c.x, c.y, c.w, c.h);
      noise(c.x, c.y, c.w, c.h, count, light, dark);
    };
    solid('whiteTrim', '#e4dfd2', 60, .05, .04); solid('iron', '#1c1b1a', 60, .05, .06);
    solid('plasterCream', '#ded2b4'); solid('plasterWhite', '#e6e1d3'); solid('stoneGray', '#7c776c', 400, .08, .12);
    solid('stoneLight', '#aaa394', 400, .08, .1); solid('concrete', '#8d8c85', 500, .05, .09);
    solid('terracotta', '#99593a', 200); solid('hedge', '#33512c', 800, .1, .24);
    solid('brick', '#8f472f', 200); solid('water', '#587f88', 120, .12, .05); solid('grass', '#49612f', 700, .1, .18);
    solid('asphalt', '#37393b', 400, .06, .1);
    // Vidrios: el oscuro refleja un poco de cielo, los encendidos también pintan su emisivo.
    const glass = (name, top, bottom) => {
      const c = at(name), g = X.createLinearGradient(0, c.y, 0, c.y + c.h);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      X.fillStyle = g; X.fillRect(c.x, c.y, c.w, c.h);
    };
    glass('glassDark', '#27343a', '#141b1f');
    glass('glassSky', '#566e7c', '#2a3a42');
    const lit = (name, top, bottom, glow, shade) => {
      glass(name, top, bottom);
      const c = at(name);
      // La luz cae desde el techo de la habitación: una lámina pareja se lee como pintura.
      const g = E.createLinearGradient(0, c.y, 0, c.y + c.h);
      g.addColorStop(0, glow); g.addColorStop(1, shade);
      E.fillStyle = g; E.fillRect(c.x, c.y, c.w, c.h);
    };
    // De día una ventana encendida sigue siendo vidrio: el color de la luz solo vive en el emisivo.
    lit('glassLit', '#4a4a44', '#2d2c28', '#cf9f62', '#8d6538');
    lit('glassCurtain', '#5a544a', '#37332d', '#a07444', '#6a4827');
    lit('glassCold', '#54646c', '#354248', '#86a0ae', '#4f6672');
    {
      // Cortina recogida en la ventana encendida: la luz no llena todo el vidrio.
      const c = at('glassCurtain');
      X.fillStyle = 'rgba(176,152,120,.86)'; X.fillRect(c.x, c.y, c.w * .34, c.h);
      E.fillStyle = 'rgba(0,0,0,.72)'; E.fillRect(c.x, c.y, c.w * .34, c.h);
    }
    const shutter = (name, base) => {
      const c = at(name);
      X.fillStyle = base; X.fillRect(c.x, c.y, c.w, c.h);
      for (let y = c.y + 3; y < c.y + c.h - 3; y += 7) {
        X.fillStyle = 'rgba(0,0,0,.34)'; X.fillRect(c.x + 8, y + 4, c.w - 16, 2);
        X.fillStyle = 'rgba(255,240,220,.1)'; X.fillRect(c.x + 8, y, c.w - 16, 2);
      }
      X.fillStyle = 'rgba(0,0,0,.42)'; X.fillRect(c.x + c.w / 2 - 1, c.y, 2, c.h);
      X.strokeStyle = 'rgba(0,0,0,.4)'; X.lineWidth = 2; X.strokeRect(c.x + 2, c.y + 2, c.w - 4, c.h - 4);
      noise(c.x, c.y, c.w, c.h, 60);
    };
    shutter('shutterGreen', '#3b5a45'); shutter('shutterBlue', '#3b5b7d'); shutter('shutterBrown', '#59391f');
    {
      // Hastial estilo inglés: entramado de vigas oscuras sobre pañete claro.
      const c = at('halfTimber');
      X.fillStyle = '#ded6c2'; X.fillRect(c.x, c.y, c.w, c.h);
      noise(c.x, c.y, c.w, c.h, 200, .05, .06);
      X.strokeStyle = '#2f2118'; X.lineWidth = 7; X.beginPath();
      for (const x of [.04, .5, .96]) { X.moveTo(c.x + c.w * x, c.y); X.lineTo(c.x + c.w * x, c.y + c.h); }
      X.moveTo(c.x, c.y + c.h * .98); X.lineTo(c.x + c.w, c.y + c.h * .98);
      X.moveTo(c.x + c.w * .04, c.y + c.h * .9); X.lineTo(c.x + c.w * .5, c.y + c.h * .15);
      X.moveTo(c.x + c.w * .96, c.y + c.h * .9); X.lineTo(c.x + c.w * .5, c.y + c.h * .15);
      X.stroke();
    }
    const stripes = (name, colorA, colorB, width) => {
      const c = at(name);
      for (let x = c.x, i = 0; x < c.x + c.w; x += width, i++) {
        X.fillStyle = i % 2 ? colorB : colorA; X.fillRect(x, c.y, width + 1, c.h);
      }
      const g = X.createLinearGradient(0, c.y, 0, c.y + c.h);
      g.addColorStop(0, 'rgba(0,0,0,.14)'); g.addColorStop(.5, 'rgba(255,255,255,.05)'); g.addColorStop(1, 'rgba(0,0,0,.26)');
      X.fillStyle = g; X.fillRect(c.x, c.y, c.w, c.h);
      noise(c.x, c.y, c.w, c.h, 70);
    };
    stripes('redStripe', '#a72f2a', '#e2dbc8', 20); stripes('blueStripe', '#2a5a8e', '#e2dbc8', 20);
    // Lona gastada: pliegues y manchas de sol y de lluvia, nunca una lámina de un solo color.
    const tarp = (name, base, seedOffset) => {
      solid(name, base, 160, .1, .14);
      const c = at(name), wear = rng(4100 + seedOffset);
      for (let i = 0; i < 7; i++) {
        const y = c.y + c.h * wear();
        X.fillStyle = `rgba(0,0,0,${(.08 + wear() * .14).toFixed(3)})`; X.fillRect(c.x, y, c.w, 1 + wear() * 2);
        X.fillStyle = `rgba(255,255,255,${(.05 + wear() * .08).toFixed(3)})`; X.fillRect(c.x, y + 2, c.w, 1);
      }
      for (let i = 0; i < 5; i++) {
        X.fillStyle = wear() < .5 ? 'rgba(245,235,205,.13)' : 'rgba(30,24,16,.15)';
        X.beginPath(); X.ellipse(c.x + c.w * wear(), c.y + c.h * wear(), c.w * (.08 + wear() * .18), c.h * (.06 + wear() * .12), 0, 0, Math.PI * 2); X.fill();
      }
    };
    tarp('greenTarp', '#3e6a4a', 1); tarp('orangeTarp', '#b5602e', 2); tarp('blueTarp', '#2c5f97', 3);
    solid('burlap', '#a48e62', 900, .12, .18);
    solid('shopDark', '#2b2d2c', 120);
    {
      // Barrera de obra: franjas diagonales naranja y blanco sobre plástico gastado.
      const c = at('barrier');
      X.save(); X.beginPath(); X.rect(c.x, c.y, c.w, c.h); X.clip();
      X.fillStyle = '#e6e2d6'; X.fillRect(c.x, c.y, c.w, c.h);
      X.fillStyle = '#d7621f';
      for (let x = c.x - c.h; x < c.x + c.w; x += 44) {
        X.beginPath(); X.moveTo(x, c.y + c.h); X.lineTo(x + c.h, c.y); X.lineTo(x + c.h + 22, c.y); X.lineTo(x + 22, c.y + c.h); X.closePath(); X.fill();
      }
      X.restore();
      noise(c.x, c.y, c.w, c.h, 160, .05, .14);
    }
    {
      const c = at('plywood');
      X.fillStyle = '#a58a5f'; X.fillRect(c.x, c.y, c.w, c.h);
      for (let i = 0; i < 40; i++) { X.fillStyle = r() < .5 ? 'rgba(60,40,20,.14)' : 'rgba(255,230,190,.07)'; X.fillRect(c.x, c.y + r() * c.h, c.w, .7 + r() * 2.2); }
      noise(c.x, c.y, c.w, c.h, 90);
    }
    {
      // Polisombra verde de obra, tejido fino que se lee a distancia como lona.
      const c = at('mesh');
      X.fillStyle = '#2f5a3e'; X.fillRect(c.x, c.y, c.w, c.h);
      for (let x = c.x; x < c.x + c.w; x += 4) { X.fillStyle = 'rgba(10,24,16,.28)'; X.fillRect(x, c.y, 1, c.h); }
      for (let y = c.y; y < c.y + c.h; y += 4) { X.fillStyle = 'rgba(160,200,170,.08)'; X.fillRect(c.x, y, c.w, 1); }
    }
    {
      // Lámina galvanizada ondulada de los cierres.
      const c = at('sheetMetal');
      for (let x = c.x; x < c.x + c.w; x += 8) {
        const g = X.createLinearGradient(x, 0, x + 8, 0);
        g.addColorStop(0, '#6c7272'); g.addColorStop(.5, '#a4a8a4'); g.addColorStop(1, '#5e6464');
        X.fillStyle = g; X.fillRect(x, c.y, 8, c.h);
      }
      for (let i = 0; i < 7; i++) {
        const px = c.x + r() * c.w, py = c.y + r() * c.h;
        const g = X.createRadialGradient(px, py, 2, px, py, 34);
        g.addColorStop(0, 'rgba(116,62,30,.42)'); g.addColorStop(1, 'rgba(116,62,30,0)');
        X.fillStyle = g; X.fillRect(px - 34, py - 34, 68, 68);
      }
    }
    {
      const c = at('lampGlass');
      const g = X.createRadialGradient(c.x + c.w / 2, c.y + c.h / 2, 4, c.x + c.w / 2, c.y + c.h / 2, c.w * .6);
      g.addColorStop(0, '#f3e0b2'); g.addColorStop(1, '#a58d55');
      X.fillStyle = g; X.fillRect(c.x, c.y, c.w, c.h);
      E.fillStyle = '#ffdf9e'; E.fillRect(c.x, c.y, c.w, c.h);
    }
    {
      // Puesto de mercado: canastas de fruta y verdura vistas desde arriba.
      for (const [name, palette] of [['fruit', ['#d0752a', '#c9a62c', '#b53a25', '#a8b53a']], ['produce', ['#6d8c35', '#8a9e3f', '#c8c0a0', '#a05a2c', '#d9d2b7']]]) {
        const c = at(name);
        X.fillStyle = '#3a2a1a'; X.fillRect(c.x, c.y, c.w, c.h);
        for (let i = 0; i < 170; i++) {
          X.fillStyle = palette[Math.floor(r() * palette.length)];
          const rad = 5 + r() * 5, px = c.x + r() * c.w, py = c.y + r() * c.h;
          X.beginPath(); X.arc(px, py, rad, 0, Math.PI * 2); X.fill();
          X.fillStyle = 'rgba(255,255,255,.2)'; X.beginPath(); X.arc(px - rad * .3, py - rad * .3, rad * .3, 0, Math.PI * 2); X.fill();
        }
      }
    }
    {
      const c = at('rollerDoor');
      X.fillStyle = '#7f827e'; X.fillRect(c.x, c.y, c.w, c.h);
      for (let y = c.y; y < c.y + c.h; y += 6) {
        X.fillStyle = 'rgba(30,30,28,.35)'; X.fillRect(c.x, y, c.w, 1.5);
        X.fillStyle = 'rgba(235,235,225,.14)'; X.fillRect(c.x, y + 2, c.w, 1.2);
      }
      noise(c.x, c.y, c.w, c.h, 90, .05, .14);
    }
    // Avisos pintados a mano: nombres de oficio inventados, sin ninguna marca.
    const sign = (name, title, sub, bg, fg, font = 'bold 44px Georgia, serif') => {
      const c = at(name);
      X.fillStyle = bg; X.fillRect(c.x, c.y, c.w, c.h);
      X.strokeStyle = fg; X.lineWidth = 3; X.strokeRect(c.x + 8, c.y + 8, c.w - 16, c.h - 16);
      X.fillStyle = fg; X.textAlign = 'center'; X.textBaseline = 'middle';
      X.font = font; X.fillText(title, c.x + c.w / 2, c.y + c.h * (sub ? .4 : .5), c.w - 28);
      if (sub) { X.font = 'bold 20px Georgia, serif'; X.fillText(sub, c.x + c.w / 2, c.y + c.h * .74, c.w - 34); }
      noise(c.x, c.y, c.w, c.h, 240, .07, .12);
    };
    sign('signTinto', 'TINTO', 'Y AGUAPANELA', '#6e3a24', '#f0e2c0');
    sign('signLibros', 'LIBROS', 'VIEJOS Y USADOS', '#2d4a6b', '#efe6cf');
    sign('signArtes', 'ARTESANÍAS', 'HECHO A MANO', '#7a5d24', '#f4ebd2');
    sign('signChicha', 'CHICHERÍA', 'LA DEL ROSARIO', '#7c2d24', '#f3e3bd');
    sign('signBarber', 'BARBERÍA', 'CORTE Y AFEITADA', '#21493f', '#f0e7d0', 'bold 40px Arial, sans-serif');
    sign('signFlor', 'FLORISTERÍA', 'RAMOS Y CORONAS', '#7a2f4f', '#fbeee0', 'bold 36px Arial, sans-serif');
    sign('signPan', 'PANADERÍA', 'PAN DE BONO', '#c58b2c', '#30210f', 'bold 40px Arial, sans-serif');
    sign('signPapel', 'PAPELERÍA', 'COPIAS Y MINUTOS', '#e4dcc4', '#1e3a5a', 'bold 40px Arial, sans-serif');
    sign('signRopa', 'REMATE', 'ROPA Y TELAS', '#c9352b', '#fff4dd', 'bold 48px Arial, sans-serif');
    sign('signObra', 'VÍA CERRADA', 'OBRAS DE LA CIUDAD', '#d7621f', '#15130f', 'bold 34px Arial, sans-serif');
    const emissiveMap = asTexture(e);
    return { map: asTexture(a), emissiveMap };
  });
}

/** Murales y grafitis inventados: formas abstractas sobre transparente, para culatas. */
export function muralSheet() {
  return once('murales', () => {
    const s = 1024, a = makeCanvas(s, s);
    if (!a) return { map: asTexture(null), cols: 2, rows: 2 };
    const X = a.ctx, r = rng(2231);
    X.clearRect(0, 0, s, s);
    const cellSize = s / 2;
    const roughEdge = (x, y, w, h, color) => {
      X.fillStyle = color;
      X.beginPath(); X.moveTo(x, y);
      for (let t = 0; t <= w; t += 18) X.lineTo(x + t, y + (r() - .5) * 10);
      for (let t = 0; t <= h; t += 18) X.lineTo(x + w + (r() - .5) * 10, y + t);
      for (let t = w; t >= 0; t -= 18) X.lineTo(x + t, y + h + (r() - .5) * 10);
      for (let t = h; t >= 0; t -= 18) X.lineTo(x + (r() - .5) * 10, y + t);
      X.closePath(); X.fill();
    };
    const palettes = [
      ['#1f3a5f', '#e0b23c', '#c8452f', '#2fa39a', '#f1e9d6'],
      ['#3c1d4e', '#e8527a', '#f5c447', '#37b0c9', '#efe7da'],
      ['#17412f', '#d9703a', '#e9d36b', '#7bb661', '#efe7da'],
      ['#55261c', '#2f7fa8', '#efb23f', '#cf3f3a', '#f2ead9']
    ];
    palettes.forEach((p, i) => {
      const cx = (i % 2) * cellSize, cy = Math.floor(i / 2) * cellSize, m = 20;
      roughEdge(cx + m, cy + m, cellSize - m * 2, cellSize - m * 2, p[0]);
      X.save(); X.beginPath(); X.rect(cx + m, cy + m, cellSize - m * 2, cellSize - m * 2); X.clip();
      // Grandes ondas de color, al estilo de los murales de barrio.
      for (let k = 0; k < 7; k++) {
        X.strokeStyle = p[1 + k % 4]; X.lineWidth = 18 + r() * 46; X.lineCap = 'round'; X.beginPath();
        const y0 = cy + r() * cellSize, phase = r() * 6, amp = 30 + r() * 90, freq = .006 + r() * .014;
        for (let t = 0; t <= cellSize; t += 12) {
          const py = y0 + Math.sin(t * freq + phase) * amp;
          t ? X.lineTo(cx + t, py) : X.moveTo(cx + t, py);
        }
        X.stroke();
      }
      // Círculos y ojos abstractos: la figura central no representa a nadie.
      const big = cellSize * (.16 + r() * .12), bx = cx + cellSize * (.3 + r() * .4), by = cy + cellSize * (.3 + r() * .4);
      X.fillStyle = p[4]; X.beginPath(); X.arc(bx, by, big, 0, Math.PI * 2); X.fill();
      X.fillStyle = p[1]; X.beginPath(); X.arc(bx, by, big * .62, 0, Math.PI * 2); X.fill();
      X.fillStyle = p[0]; X.beginPath(); X.arc(bx, by, big * .3, 0, Math.PI * 2); X.fill();
      for (let k = 0; k < 40; k++) {
        X.fillStyle = p[1 + Math.floor(r() * 4)];
        const size = 4 + r() * 16;
        X.fillRect(cx + r() * cellSize, cy + r() * cellSize, size, size);
      }
      // Letras inventadas, sin relación con nada real.
      X.save(); X.translate(cx + cellSize / 2, cy + cellSize * .82); X.rotate((r() - .5) * .18);
      X.font = '900 92px Impact, Arial Black, sans-serif'; X.textAlign = 'center'; X.textBaseline = 'middle';
      X.lineWidth = 12; X.strokeStyle = '#141414';
      const word = ['RUMBO', 'TINTA', 'ZONA 7', 'PÁRAMO'][i];
      X.strokeText(word, 0, 0); X.fillStyle = p[4]; X.fillText(word, 0, 0);
      X.restore();
      // Pintura vieja: desgaste en manchas, sin tapar del todo.
      for (let k = 0; k < 900; k++) {
        X.fillStyle = `rgba(190,180,160,${.05 + r() * .12})`;
        X.fillRect(cx + r() * cellSize, cy + r() * cellSize, 1 + r() * 4, 1 + r() * 3);
      }
      X.restore();
    });
    const map = asTexture(a);
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    return { map, cols: 2, rows: 2 };
  });
}

/** Fachada repetible de las torres de ladrillo: cuatro pisos por cuatro vanos, con ventanas encendidas. */
export const TOWER_TILE = Object.freeze({ bays: 8, floors: 8, bayMeters: 3.2, floorMeters: 3.1 });
export function towerFacade() {
  return once('torres', () => {
    const s = 1024, a = makeCanvas(s, s), e = makeCanvas(s, s);
    if (!a) return { map: asTexture(null), emissiveMap: asTexture(null) };
    const r = rng(5519), X = a.ctx, E = e.ctx, bay = s / TOWER_TILE.bays, floor = s / TOWER_TILE.floors;
    E.fillStyle = '#000'; E.fillRect(0, 0, s, s);
    // Ladrillo a la vista en hiladas finas: a 90 m de altura se lee como textura, no como bloque.
    X.fillStyle = '#7d4a38'; X.fillRect(0, 0, s, s);
    const rowH = 5;
    for (let y = 0, row = 0; y < s; y += rowH, row++) {
      for (let x = row % 2 ? -7 : 0; x < s; x += 14) {
        X.fillStyle = ['#84503c', '#7a4834', '#8c5942', '#744330', '#936149'][Math.floor(r() * 5)];
        X.fillRect(x + .5, y + .5, 13.5, rowH - .8);
      }
    }
    for (let f = 0; f < TOWER_TILE.floors; f++) {
      // Losa de cada piso a la vista: la fachada se lee como pisos, no como paño de ventanas.
      X.fillStyle = 'rgba(214,202,180,.26)'; X.fillRect(0, f * floor - 1.5, s, 3);
      X.fillStyle = 'rgba(22,10,6,.3)'; X.fillRect(0, f * floor + 1.5, s, 2.5);
      for (let b = 0; b < TOWER_TILE.bays; b++) {
        const x = b * bay + bay * .24, w = bay * .52, y = f * floor + floor * .26, h = floor * .54;
        X.fillStyle = 'rgba(26,12,8,.55)'; X.fillRect(x - 2, y - 2, w + 4, h + 4);
        const lit = r(), level = .45 + r() * .55;
        const g = X.createLinearGradient(0, y, 0, y + h);
        // El vidrio es oscuro de día; los encendidos solo se notan en el emisivo, de noche.
        g.addColorStop(0, '#3b4c54'); g.addColorStop(1, '#161d21');
        X.fillStyle = g; X.fillRect(x, y, w, h);
        // De noche solo una ventana de cada cinco, cada una con su propia lámpara y su cortina.
        if (lit < .2) {
          const glow = E.createLinearGradient(0, y, 0, y + h);
          const tone = lit < .15 ? [190, 140, 82] : [118, 150, 170];
          const color = k => `rgb(${tone.map(v => Math.round(v * level * k)).join(',')})`;
          glow.addColorStop(0, color(1)); glow.addColorStop(1, color(.6));
          E.fillStyle = glow; E.fillRect(x, y, w, h);
          E.fillStyle = 'rgba(0,0,0,.62)';
          if (r() < .6) E.fillRect(x, y, w * (.2 + r() * .3), h);
        }
        X.fillStyle = '#b9b09c'; X.fillRect(x + w / 2 - .75, y, 1.5, h);
        X.fillStyle = '#a7967e'; X.fillRect(x - 3, y + h + 1.5, w + 6, 3);
      }
    }
    return { map: asTexture(a), emissiveMap: asTexture(e) };
  });
}
