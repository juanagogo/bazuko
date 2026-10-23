// src/world/bogota/textures.js — texturas procedurales portadas de rebusque.
// Añade a facade() los estilos de Bogotá: 'ladrillo' (ladrillo a la vista) y 'ruina' (El Cartucho).
import * as THREE from 'three';

/** Generador pseudoaleatorio determinista (mulberry32). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function canvas(w, h) {
  const dummy = () => [
    { width: w, height: h, getContext: () => null },
    {
      fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
      fillRect() {}, strokeRect() {}, clearRect() {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      arc() {}, save() {}, restore() {}, translate() {}, rotate() {},
      scale() {}, fillText() {}, strokeText() {}, measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}
    }
  ];
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return dummy();
  }
  try {
    const c = document.createElement('canvas');
    if (!c || typeof c.getContext !== 'function') return dummy();
    const ctx = c.getContext('2d');
    if (!ctx) return dummy();
    c.width = w;
    c.height = h;
    return [c, ctx];
  } catch {
    return dummy();
  }
}

function toTexture(c, { srgb = true, repeat } = {}) {
  if (typeof document === 'undefined' || !c || typeof c.getContext !== 'function') return new THREE.Texture();
  try {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    return t;
  } catch {
    return new THREE.Texture();
  }
}

function speckle(ctx, w, h, r, count, colors, maxSize = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = pick(r, colors);
    const s = 0.5 + r() * maxSize;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

/** Asfalto mojado: color, rugosidad (charcos brillantes) y relieve. */
export function asphalt(seed = 7, size = 1024) {
  const r = rng(seed);
  const [c, x] = canvas(size, size);
  const [cr, xr] = canvas(size, size);

  x.fillStyle = '#17191c';
  x.fillRect(0, 0, size, size);
  speckle(x, size, size, r, size * 60, ['#202328', '#121316', '#2a2d31', '#1b1d20', '#0d0e10'], 2.2);

  // parches de brea y reparaciones
  for (let i = 0; i < 14; i++) {
    const px = r() * size, py = r() * size, pr = 30 + r() * 120;
    const g = x.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, r() > 0.5 ? 'rgba(8,8,10,0.55)' : 'rgba(40,42,46,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  // grietas
  x.strokeStyle = 'rgba(5,5,6,0.8)';
  for (let i = 0; i < 22; i++) {
    let px = r() * size, py = r() * size;
    x.lineWidth = 0.6 + r() * 1.6;
    x.beginPath();
    x.moveTo(px, py);
    for (let k = 0; k < 18; k++) {
      px += (r() - 0.5) * 22;
      py += (r() - 0.5) * 22;
      x.lineTo(px, py);
    }
    x.stroke();
  }

  // rugosidad: base mate, charcos espejo
  xr.fillStyle = 'rgb(150,150,150)';
  xr.fillRect(0, 0, size, size);
  speckle(xr, size, size, r, size * 30, ['rgb(170,170,170)', 'rgb(120,120,120)', 'rgb(190,190,190)'], 2);
  for (let i = 0; i < 26; i++) {
    const px = r() * size, py = r() * size;
    const rx = 30 + r() * 110, ry = 18 + r() * 70, rot = r() * Math.PI;
    for (const [ctx, inner, outer] of [
      [xr, 'rgba(14,14,14,1)', 'rgba(150,150,150,0)'],
      [x, 'rgba(6,7,9,0.16)', 'rgba(6,7,9,0)'], // charco apenas oscuro: sin reflejo se vería como hueco
    ]) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, rx * 0.35, 0, 0, rx);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  return {
    map: toTexture(c),
    roughnessMap: toTexture(cr, { srgb: false }),
    bumpMap: toTexture(c, { srgb: false }),
  };
}

/** Andén de baldosa gris con mugre. */
export function sidewalk(seed = 11) {
  const r = rng(seed);
  const s = 512;
  const [c, x] = canvas(s, s);
  x.fillStyle = '#5b5d5f';
  x.fillRect(0, 0, s, s);
  const tile = 64;
  for (let ty = 0; ty < s; ty += tile) {
    for (let tx = 0; tx < s; tx += tile) {
      const v = 80 + Math.floor(r() * 26);
      x.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
      x.fillRect(tx + 2, ty + 2, tile - 4, tile - 4);
      if (r() < 0.12) {
        x.fillStyle = 'rgba(30,30,28,0.5)';
        x.fillRect(tx + 2, ty + 2, tile - 4, tile - 4);
      }
    }
  }
  speckle(x, s, s, r, 9000, ['rgba(20,20,20,0.35)', 'rgba(200,200,200,0.12)'], 2);
  for (let i = 0; i < 10; i++) {
    const px = r() * s, py = r() * s, pr = 20 + r() * 60;
    const g = x.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, 'rgba(25,22,18,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  return { map: toTexture(c), bumpMap: toTexture(c, { srgb: false }) };
}

/** Ladrillo a la vista, como las culatas de las casas de barrio. */
/** Ladrillo para muros laterales. La textura cubre BRICK_TILE metros (8 × 21,3 ladrillos). */
export const BRICK_TILE = { w: 8 * 0.36, h: (512 / 24) * 0.12 };

export function brick(seed = 3) {
  const r = rng(seed);
  const w = 512, h = 512;
  const [c, x] = canvas(w, h);
  x.fillStyle = '#5a4436';
  x.fillRect(0, 0, w, h);
  const bw = 64, bh = 24;
  for (let row = 0, y = 0; y < h; row++, y += bh) {
    const off = row % 2 ? bw / 2 : 0;
    for (let bx = -bw; bx < w + bw; bx += bw) {
      const tone = pick(r, ['#8a4b32', '#7d4430', '#94553a', '#6e3b2a', '#a05f40']);
      x.fillStyle = tone;
      x.fillRect(bx + off + 2, y + 2, bw - 4, bh - 4);
    }
  }
  speckle(x, w, h, r, 12000, ['rgba(0,0,0,0.25)', 'rgba(255,220,190,0.08)'], 2);
  const g = x.createLinearGradient(0, h, 0, h * 0.4);
  g.addColorStop(0, 'rgba(15,12,10,0.65)');
  g.addColorStop(1, 'rgba(15,12,10,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  return { map: toTexture(c), bumpMap: toTexture(c, { srgb: false }) };
}

const WALLS = ['#c9a46a', '#b8695a', '#7f9aa8', '#d8c9a3', '#8fa37a', '#c27f4a', '#a7a29a', '#b58fa8', '#d2b48c', '#6d8c9e'];
const SMALL_SIGNS = ['SE ARRIENDA', 'SE VENDE', 'MINUTOS', 'RECARGAS', 'CERRAJERÍA', 'MODISTERÍA', 'SE HACEN UÑAS', 'FOTOCOPIAS'];
const TAGS = ['KLAN', 'LUZ', 'ZONA 7', 'RBQ', 'LA 33', 'PARCE', 'ÑERO', 'CALLE'];

/**
 * Fachada de casa o edificio de barrio, dibujada a la medida.
 * Devuelve color y emisivo (ventanas encendidas).
 */
// Medidas reales del ladrillo tolete con pega: 36 × 12 cm (mismas en fachadas y muros laterales)
export const BRICK_M = { w: 0.36, h: 0.12 };

/** Dibuja ladrillo tolete a la vista en un rectángulo del canvas (pxPerM = píxeles por metro). */
function brickWall(x, r, x0, y0, w, h, pxPerM = 36, xb = null) {
  x.fillStyle = '#5a4436';
  x.fillRect(x0, y0, w, h);
  if (xb) {
    xb.fillStyle = '#3a3a3a'; // Juntas de cemento hendidas en relieve
    xb.fillRect(x0, y0, w, h);
  }
  const bw = BRICK_M.w * pxPerM, bh = BRICK_M.h * pxPerM;
  for (let row = 0, y = y0; y < y0 + h; row++, y += bh) {
    const off = row % 2 ? bw / 2 : 0;
    for (let bx = x0 - bw; bx < x0 + w + bw; bx += bw) {
      x.fillStyle = pick(r, ['#8a4b32', '#7d4430', '#94553a', '#6e3b2a', '#a05f40', '#85482f']);
      x.fillRect(bx + off + 1, y + 1, bw - 2, bh - 2);
      if (xb) {
        xb.fillStyle = '#9c9c9c'; // Ladrillo sobresale de la junta
        xb.fillRect(bx + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
  }
}

export function facade({ seed, width, floors, pxPerM = 36, shopFront = true, style = 'pintada' }) {
  const r = rng(seed);
  const w = Math.max(64, Math.round(width * pxPerM));
  const fh = 3 * pxPerM;
  const h = Math.round(floors * fh);
  const [c, x] = canvas(w, h);
  const [ce, xe] = canvas(w, h);
  const [cr, xr] = canvas(w, h);
  const [cb, xb] = canvas(w, h);
  xe.fillStyle = '#000';
  xe.fillRect(0, 0, w, h);
  xr.fillStyle = '#dedede'; // Base pared mate (rugosidad ~0.87)
  xr.fillRect(0, 0, w, h);
  xb.fillStyle = '#808080'; // Relieve neutro
  xb.fillRect(0, 0, w, h);

  const wall = pick(r, WALLS);
  const ruin = style === 'ruina';
  if (style === 'ladrillo') {
    brickWall(x, r, 0, 0, w, h, pxPerM, xb);
  } else {
    x.fillStyle = ruin ? pick(r, ['#8c8070', '#7a6e62', '#9a8a6a', '#6f6a60']) : wall;
    x.fillRect(0, 0, w, h);
    if (ruin) {
      // pañete caído: se ve el ladrillo
      for (let i = 0; i < 4 + r() * 6; i++) {
        const pw = w * (0.08 + r() * 0.25), ph = h * (0.06 + r() * 0.2);
        const px = r() * (w - pw), py = r() * (h - ph);
        brickWall(x, r, px, py, pw, ph, pxPerM, xb);
      }
    }
  }
  speckle(x, w, h, r, w * h * 0.04, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.06)'], 2);

  // pintura vieja por pisos (cada piso lo pintó otro dueño)
  for (let f = 1; f < floors; f++) {
    if (style === 'pintada' && r() < 0.45) {
      x.fillStyle = pick(r, WALLS);
      x.globalAlpha = 0.85;
      x.fillRect(0, h - (f + 1) * fh, w, fh);
      x.globalAlpha = 1;
    }
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(0, h - f * fh - 4, w, 6);
  }

  const cols = Math.max(1, Math.round(width / 3.2));
  const cw = w / cols;
  for (let f = shopFront ? 1 : 0; f < floors; f++) {
    const y0 = h - (f + 1) * fh;
    for (let k = 0; k < cols; k++) {
      if (r() < 0.12) continue;
      const ww = cw * (0.42 + r() * 0.2);
      const wh = fh * (0.42 + r() * 0.12);
      const wx = k * cw + (cw - ww) / 2;
      const wy = y0 + fh * 0.22;
      const lit = ruin ? r() * 4 : r();
      let glass = '#0d1218';
      let emis = null;
      if (ruin && r() < 0.55) {
        // ventana tapiada con tablas
        x.fillStyle = '#1a1612';
        x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        for (let t = 0; t < 4; t++) {
          x.fillStyle = pick(r, ['#6b5a40', '#5a4a33', '#7a684a']);
          x.save();
          x.translate(wx + ww / 2, wy + (t + 0.5) * (wh / 4));
          x.rotate((r() - 0.5) * 0.25);
          x.fillRect(-ww * 0.6, -wh / 10, ww * 1.2, wh / 5);
          x.restore();
        }
        continue;
      }
      if (lit < 0.22) { glass = '#ffb766'; emis = '#ff9e45'; }
      else if (lit < 0.3) { glass = '#a9c8ff'; emis = '#6f9dff'; }
      else if (lit < 0.36) { glass = '#e9fbff'; emis = '#c9ecff'; }
      x.fillStyle = style === 'ladrillo' ? '#e8e3d6' : '#2a2a2a';
      x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      x.fillStyle = glass;
      x.fillRect(wx, wy, ww, wh);

      // PBR: ventana altamente reflectante y marco en relieve
      xr.fillStyle = '#101010'; // Cristal reflectante (~0.06 rugosidad)
      xr.fillRect(wx, wy, ww, wh);
      xb.fillStyle = '#b8b8b8'; // Marco sobresale
      xb.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
      xb.fillStyle = '#606060'; // Cristal empotrado
      xb.fillRect(wx, wy, ww, wh);

      if (emis) {
        // cortina a medio cerrar
        xe.fillStyle = emis;
        xe.fillRect(wx, wy, ww, wh);
        if (r() < 0.6) {
          const cur = pick(r, ['#7a2c2c', '#2c4d7a', '#6b6b2a', '#3b2a55']);
          x.fillStyle = cur;
          x.globalAlpha = 0.75;
          x.fillRect(wx, wy, ww * (0.3 + r() * 0.3), wh);
          x.globalAlpha = 1;
          xe.fillStyle = 'rgba(0,0,0,0.7)';
          xe.fillRect(wx, wy, ww * 0.35, wh);
        }
      }
      // rejas
      x.strokeStyle = 'rgba(20,20,20,0.9)';
      x.lineWidth = 2;
      const bars = Math.max(3, Math.round(ww / 9));
      for (let b = 1; b < bars; b++) {
        const bx = wx + (ww / bars) * b;
        x.beginPath();
        x.moveTo(bx, wy);
        x.lineTo(bx, wy + wh);
        x.stroke();
      }
      x.beginPath();
      x.moveTo(wx, wy + wh / 2);
      x.lineTo(wx + ww, wy + wh / 2);
      x.stroke();
      // chorreado bajo el alféizar
      const g = x.createLinearGradient(0, wy + wh, 0, wy + wh + fh * 0.6);
      g.addColorStop(0, 'rgba(25,20,15,0.35)');
      g.addColorStop(1, 'rgba(25,20,15,0)');
      x.fillStyle = g;
      x.fillRect(wx, wy + wh + 3, ww, fh * 0.6);
    }
  }

  if (shopFront) {
    // primer piso: persianas metálicas con grafiti
    const y0 = h - fh;
    const doors = Math.max(1, Math.round(width / 4.2));
    const dw = w / doors;
    for (let d = 0; d < doors; d++) {
      const dx = d * dw + dw * 0.08;
      const ddw = dw * 0.84;
      const dy = y0 + fh * 0.18;
      const dh = fh * 0.82;
      x.fillStyle = pick(r, ['#6d7276', '#5a5f63', '#7b6f5f', '#4b5a52']);
      x.fillRect(dx, dy, ddw, dh);
      x.fillStyle = 'rgba(0,0,0,0.3)';
      for (let l = dy; l < dy + dh; l += 5) x.fillRect(dx, l, ddw, 1.5);

      // Persianas metálicas comerciales: satinadas con relieve horizontal
      xr.fillStyle = '#555555';
      xr.fillRect(dx, dy, ddw, dh);
      xb.fillStyle = '#888888';
      xb.fillRect(dx, dy, ddw, dh);
      for (let l = dy; l < dy + dh; l += 5) {
        xb.fillStyle = '#505050';
        xb.fillRect(dx, l, ddw, 2);
      }

      if (r() < (ruin ? 1 : 0.75)) {
        x.save();
        x.font = `900 ${Math.round(fh * 0.24)}px Overpass, sans-serif`;
        x.fillStyle = pick(r, ['#ff3b6b', '#2ee6a6', '#ffe14d', '#59b4ff', '#ffffff', '#ff8a1f']);
        x.strokeStyle = '#111';
        x.lineWidth = 4;
        x.translate(dx + ddw * 0.5, dy + dh * 0.55);
        x.rotate((r() - 0.5) * 0.3);
        x.textAlign = 'center';
        const tag = pick(r, TAGS);
        x.strokeText(tag, 0, 0);
        x.fillText(tag, 0, 0);
        x.restore();
      }
    }
    // avisito de cartulina
    if (r() < 0.7) {
      const txt = pick(r, SMALL_SIGNS);
      const sw = Math.min(w * 0.4, 140), sh = fh * 0.16;
      const sx = r() * (w - sw), sy = h - fh * 1.15;
      x.fillStyle = pick(r, ['#ffffff', '#ffe600', '#ff7a1a', '#7dff5a']);
      x.fillRect(sx, sy, sw, sh);
      x.fillStyle = '#c4161c';
      x.font = `900 ${Math.round(sh * 0.62)}px Overpass, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(txt, sx + sw / 2, sy + sh / 2 + 1, sw * 0.92);
    }
  }

  // mugre de la base y manchas de humedad
  const g = x.createLinearGradient(0, h, 0, h - fh * (ruin ? 2.2 : 1.2));
  g.addColorStop(0, ruin ? 'rgba(15,12,9,0.85)' : 'rgba(20,16,12,0.7)');
  g.addColorStop(1, 'rgba(20,16,12,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const sx = r() * w;
    const sg = x.createLinearGradient(0, 0, 0, h * 0.5);
    sg.addColorStop(0, 'rgba(30,30,25,0.35)');
    sg.addColorStop(1, 'rgba(30,30,25,0)');
    x.fillStyle = sg;
    x.fillRect(sx, 0, 6 + r() * 18, h * 0.5);
  }

  return {
    map: toTexture(c),
    emissiveMap: toTexture(ce),
    bumpMap: toTexture(cb, { srgb: false }),
    roughnessMap: toTexture(cr, { srgb: false })
  };
}

/** Teja de barro (casas viejas del centro): filas de tejas curvas con musgo y hollín. Cubre 2 × 2 m. */
export function roofTiles(seed = 9) {
  const r = rng(seed);
  const s = 256;
  const [c, x] = canvas(s, s);
  x.fillStyle = '#5b2a1a';
  x.fillRect(0, 0, s, s);
  const tw = 16, th = 24; // 12,5 cm × 18 cm por teja
  for (let row = 0, y = 0; y < s; row++, y += th) {
    const off = row % 2 ? tw / 2 : 0;
    for (let tx = -tw; tx < s + tw; tx += tw) {
      const g = x.createLinearGradient(tx + off, 0, tx + off + tw, 0);
      const base = pick(r, ['#9a4a2c', '#8a3f26', '#a85a36', '#7d3a22', '#93502f']);
      g.addColorStop(0, 'rgba(40,15,8,0.9)');
      g.addColorStop(0.3, base);
      g.addColorStop(0.7, base);
      g.addColorStop(1, 'rgba(40,15,8,0.9)');
      x.fillStyle = g;
      x.fillRect(tx + off, y, tw - 1, th - 2);
    }
  }
  speckle(x, s, s, r, 2500, ['rgba(60,80,40,0.35)', 'rgba(0,0,0,0.3)', 'rgba(255,220,180,0.08)'], 2.5);
  return { map: toTexture(c) };
}

/** Placa de concreto de terraza con manchas de agua. Cubre 4 × 4 m. */
export function slab(seed = 13) {
  const r = rng(seed);
  const s = 256;
  const [c, x] = canvas(s, s);
  x.fillStyle = '#6e6a64';
  x.fillRect(0, 0, s, s);
  speckle(x, s, s, r, 9000, ['#7a766f', '#5f5b55', '#837e76', '#55524d'], 2);
  for (let i = 0; i < 7; i++) {
    const px = r() * s, py = r() * s, pr = 20 + r() * 60;
    const g = x.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, 'rgba(30,28,25,0.45)');
    g.addColorStop(1, 'rgba(30,28,25,0)');
    x.fillStyle = g;
    x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  return { map: toTexture(c) };
}

/** Cartón corrugado húmedo. */
export function cardboard(seed = 21) {
  const r = rng(seed);
  const s = 256;
  const [c, x] = canvas(s, s);
  x.fillStyle = '#9a7449';
  x.fillRect(0, 0, s, s);
  for (let i = 0; i < s; i += 4) {
    x.fillStyle = i % 8 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    x.fillRect(0, i, s, 2);
  }
  speckle(x, s, s, r, 3000, ['rgba(60,40,20,0.3)', 'rgba(255,230,190,0.1)'], 2);
  for (let i = 0; i < 6; i++) {
    const px = r() * s, py = r() * s, pr = 20 + r() * 50;
    const g = x.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, 'rgba(50,32,15,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  x.fillStyle = 'rgba(20,20,20,0.75)';
  x.font = '900 26px Overpass, sans-serif';
  x.fillText('FRÁGIL ↑', 20, 210);
  return { map: toTexture(c) };
}

/** Plástico negro de bolsa de basura (rugosidad baja, brillo húmedo). */
export function trashBag(seed = 5) {
  const r = rng(seed);
  const s = 128;
  const [c, x] = canvas(s, s);
  x.fillStyle = '#121315';
  x.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    x.strokeStyle = `rgba(255,255,255,${0.03 + r() * 0.06})`;
    x.lineWidth = 1 + r() * 2;
    x.beginPath();
    const y = r() * s;
    x.moveTo(0, y);
    x.bezierCurveTo(s * 0.3, y + (r() - 0.5) * 30, s * 0.6, y + (r() - 0.5) * 30, s, y + (r() - 0.5) * 20);
    x.stroke();
  }
  return { map: toTexture(c) };
}

/** Letrero luminoso (caja de luz) con texto. Devuelve textura para map y emissive. */
export function lightbox({ title, sub = '', bg = '#0b4fa3', fg = '#ffffff', accent = '#f6c400', w = 1024, h = 256 }) {
  const [c, x] = canvas(w, h);
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.strokeStyle = fg;
  x.lineWidth = 10;
  x.strokeRect(18, 18, w - 36, h - 36);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `900 ${Math.round(h * (sub ? 0.36 : 0.5))}px Overpass, sans-serif`;
  x.fillText(title, w / 2, sub ? h * 0.42 : h * 0.54, w * 0.9);
  if (sub) {
    x.fillStyle = accent;
    x.font = `800 ${Math.round(h * 0.15)}px Overpass, sans-serif`;
    x.fillText(sub, w / 2, h * 0.76, w * 0.88);
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Texto de neón (solo trazo brillante sobre negro). */
export function neon({ text, color = '#ff3b6b', w = 512, h = 160, font = 900 }) {
  const [c, x] = canvas(w, h);
  x.fillStyle = '#000';
  x.fillRect(0, 0, w, h);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `${font} ${Math.round(h * 0.55)}px Overpass, sans-serif`;
  x.shadowColor = color;
  x.shadowBlur = 18;
  x.strokeStyle = color;
  x.lineWidth = 6;
  x.strokeText(text, w / 2, h / 2 + 4, w * 0.92);
  x.shadowBlur = 0;
  x.strokeStyle = '#fff';
  x.lineWidth = 2;
  x.strokeText(text, w / 2, h / 2 + 4, w * 0.92);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Degradado radial suave (charcos de luz de faros, halos). */
export function radialSprite(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, x] = canvas(size, size);
  if (!c || typeof c.getContext !== 'function' || !x || typeof x.createRadialGradient !== 'function') {
    return new THREE.Texture();
  }
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  try {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch {
    return new THREE.Texture();
  }
}

/** Tierra/barro para el lote bajo el viaducto. */
export function dirt(seed = 31) {
  const r = rng(seed);
  const s = 512;
  const [c, x] = canvas(s, s);
  x.fillStyle = '#3a3027';
  x.fillRect(0, 0, s, s);
  speckle(x, s, s, r, 30000, ['#2c241d', '#463a2f', '#51443a', '#231d18', '#5a5045'], 2.5);
  for (let i = 0; i < 18; i++) {
    const px = r() * s, py = r() * s, pr = 20 + r() * 70;
    const g = x.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, 'rgba(12,10,8,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  return { map: toTexture(c), bumpMap: toTexture(c, { srgb: false }) };
}

/** Concreto manchado (viaducto, columnas). */
export function concrete(seed = 41) {
  const r = rng(seed);
  const s = 512;
  const [c, x] = canvas(s, s);
  x.fillStyle = '#6f6e6a';
  x.fillRect(0, 0, s, s);
  speckle(x, s, s, r, 26000, ['#62615d', '#7b7a76', '#565551', '#858480'], 2);
  for (let i = 0; i < 10; i++) {
    const sx = r() * s;
    const g = x.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(25,25,22,0.5)');
    g.addColorStop(1, 'rgba(25,25,22,0)');
    x.fillStyle = g;
    x.fillRect(sx, 0, 8 + r() * 30, s);
  }
  // grafiti grande en las columnas
  x.save();
  x.font = '900 120px Overpass, sans-serif';
  x.textAlign = 'center';
  x.translate(s / 2, s * 0.62);
  x.rotate(-0.08);
  x.lineWidth = 10;
  x.strokeStyle = '#121212';
  x.fillStyle = '#2ee6a6';
  x.strokeText('RBQ', 0, 0);
  x.fillText('RBQ', 0, 0);
  x.restore();
  return { map: toTexture(c), bumpMap: toTexture(c, { srgb: false }) };
}
