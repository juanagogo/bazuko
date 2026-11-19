// src/world/bogota/textures.js — texturas procedurales portadas de rebusque.
// Añade a facade() los estilos de Bogotá: 'ladrillo' (ladrillo a la vista) y 'ruina' (El Cartucho).
import * as THREE from 'three';
import { NEIGHBORHOODS } from './NeighborhoodIdentity.js';

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
  let t;
  try {
    t = typeof document !== 'undefined' && c?.getContext ? new THREE.CanvasTexture(c) : new THREE.Texture(c);
  } catch {
    t = new THREE.Texture(c);
  }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

const gray = value => `rgb(${value},${value},${value})`;
const districtPalette = district => (NEIGHBORHOODS[district] ?? NEIGHBORHOODS.centro).palette;

/** Tres imágenes independientes: pintura y humedad no se convierten en agujeros. */
function surface(w, h, color, roughness = 210) {
  const [c, x] = canvas(w, h), [cb, xb] = canvas(w, h), [cr, xr] = canvas(w, h);
  for (const [ctx, fill] of [[x, color], [xb, '#808080'], [xr, gray(roughness)]]) {
    ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h);
  }
  return { c, x, cb, xb, cr, xr, w, h };
}

function surfaceMaps({ c, cb, cr }) {
  return { map: toTexture(c), bumpMap: toTexture(cb, { srgb: false }), roughnessMap: toTexture(cr, { srgb: false }) };
}

/** Manchas periódicas: los bordes de una repetición no cortan una reparación o la humedad. */
function softPatch(ctx, w, h, cx, cy, rx, ry, color) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
    const px = cx + dx, py = cy + dy;
    if (px + rx < 0 || px - rx > w || py + ry < 0 || py - ry > h) continue;
    ctx.save(); ctx.translate(px, py); ctx.scale(1, ry / rx);
    const gradient = ctx.createRadialGradient(0, 0, rx * .15, 0, 0, rx);
    // El extremo conserva RGB: interpolar contra negro transparente forma anillos oscuros.
    gradient.addColorStop(0, color); gradient.addColorStop(1, color.replace(/,[^,]+\)$/, ',0)'));
    ctx.fillStyle = gradient; ctx.fillRect(-rx, -rx, rx * 2, rx * 2); ctx.restore();
  }
}

/** Árido a la misma posición en color y altura, con relieve de pocos niveles de gris. */
function aggregate(s, r, count, colors, size = 2) {
  for (let i = 0; i < count; i++) {
    const px = r() * s.w, py = r() * s.h, diameter = .5 + r() * size;
    s.x.fillStyle = pick(r, colors); s.x.fillRect(px, py, diameter, diameter);
    s.xb.fillStyle = gray(122 + Math.floor(r() * 17)); s.xb.fillRect(px, py, diameter, diameter);
  }
}

function speckle(ctx, w, h, r, count, colors, maxSize = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = pick(r, colors);
    const s = 0.5 + r() * maxSize;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

/** Asfalto mineral: árido, reparaciones y humedad; el acabado mojado lo mezcla el material. */
export function asphalt(seed = 7, size = 1024) {
  const r = rng(seed);
  size = THREE.MathUtils.clamp(Math.round(Number.isFinite(size) ? size : 1024), 64, 1024);
  const s = surface(size, size, '#41474c', 212);
  const { x, xb, xr } = s;
  aggregate(s, r, Math.round(size * size * .065), ['#4b5054', '#3b4146', '#505450', '#464b4e', '#585953'], Math.max(1, size / 512));
  for (let i = 0; i < 12; i++) {
    const px = r() * size, py = r() * size, radius = size * (.035 + r() * .13);
    softPatch(x, size, size, px, py, radius, radius * .7,
      r() > .5 ? 'rgba(31,36,40,.3)' : 'rgba(114,110,99,.17)');
    softPatch(xr, size, size, px, py, radius, radius * .7, 'rgba(175,175,175,.6)');
  }
  // Grietas finas en albedo y altura; la rugosidad queda mate en el interior.
  for (let i = 0; i < 13; i++) {
    let px = r() * size, py = r() * size;
    const points = [[px, py]];
    for (let k = 0; k < 12; k++) {
      px += (r() - .42) * size * .02; py += (r() - .3) * size * .012;
      points.push([px, py]);
    }
    for (const [ctx, color] of [[x, 'rgba(28,32,35,.6)'], [xb, '#727272'], [xr, '#dedede']]) {
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(.7, size / 1024); ctx.beginPath();
      ctx.moveTo(...points[0]); for (const point of points.slice(1)) ctx.lineTo(...point); ctx.stroke();
    }
  }
  // La máscara conserva una rugosidad mínima moderada; nunca genera espejos negros ni relieve de charcos.
  for (let i = 0; i < 15; i++) {
    const px = r() * size, py = r() * size;
    const rx = size * (.025 + r() * .10), ry = size * (.015 + r() * .055);
    softPatch(xr, size, size, px, py, rx, ry, 'rgba(185,185,185,.9)');
    softPatch(x, size, size, px, py, rx, ry, 'rgba(28,35,39,.10)');
  }
  return surfaceMaps(s);
}

/** Losas de andén fundidas una a una: juntas finas, tono propio, reparaciones y manchas grandes sin grano que parpadee. */
export function sidewalk(seed = 11, { district = 'centro' } = {}) {
  const r = rng(seed);
  const palette = districtPalette(district), s = 512;
  const maps = surface(s, s, '#5f5e56', 218), { x, xb, xr } = maps;
  const tile = 64, gap = 1.5;
  for (let ty = 0; ty < s; ty += tile) {
    for (let tx = 0; tx < s; tx += tile) {
      const v = 136 + Math.floor(r() * 26), repaired = r() < .08, size = tile - gap * 2;
      x.fillStyle = repaired ? '#a39e91' : `rgb(${v + 5},${v + 3},${v - 3})`;
      x.fillRect(tx + gap, ty + gap, size, size);
      x.fillStyle = palette.pavingTint; x.globalAlpha = .16;
      x.fillRect(tx + gap, ty + gap, size, size); x.globalAlpha = 1;
      // El polvo se junta contra las juntas; el centro de la losa queda más lavado por los pasos.
      x.strokeStyle = 'rgba(58,54,44,.13)'; x.lineWidth = 5;
      x.strokeRect(tx + gap + 2.5, ty + gap + 2.5, size - 5, size - 5);
      xb.fillStyle = '#6a6a6a'; xb.fillRect(tx, ty, tile, tile);
      xb.fillStyle = gray(repaired ? 129 : 134 + Math.floor(r() * 7)); xb.fillRect(tx + gap, ty + gap, size, size);
      xr.fillStyle = gray(195 + Math.floor(r() * 28)); xr.fillRect(tx + gap, ty + gap, size, size);
      // Una losa de cada tantas se partió o perdió una esquina.
      if (r() < .13) {
        let cx = tx + gap + r() * size, cy = ty + gap;
        const vertical = r() < .5, end = 4 + Math.floor(r() * 3);
        for (const [ctx, color] of [[x, 'rgba(44,41,36,.62)'], [xb, '#6e6e6e']]) {
          ctx.strokeStyle = color; ctx.lineWidth = .9; ctx.beginPath(); ctx.moveTo(cx, cy);
        }
        for (let step = 1; step <= end; step++) {
          cy = ty + gap + size * step / end; cx += (r() - .5) * 11;
          cx = Math.max(tx + gap, Math.min(tx + tile - gap, cx));
          const [px, py] = vertical ? [cx, cy] : [tx + (cy - ty), ty + (cx - tx)];
          x.lineTo(px, py); xb.lineTo(px, py);
        }
        x.stroke(); xb.stroke();
      }
      if (r() < .1) {
        const corner = 3 + r() * 5, ox = tx + gap + (r() < .5 ? 0 : size), oy = ty + gap + (r() < .5 ? 0 : size);
        const sx = ox > tx + tile / 2 ? -1 : 1, sy = oy > ty + tile / 2 ? -1 : 1;
        for (const [ctx, color] of [[x, '#5a574e'], [xb, '#696969']]) {
          ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + sx * corner, oy); ctx.lineTo(ox, oy + sy * corner); ctx.fill();
        }
      }
    }
  }
  // Solo un velo de grano: con más contraste los puntos titilan cuando la losa se aleja.
  speckle(x, s, s, r, 3500, ['rgba(70,67,58,.07)', 'rgba(231,225,206,.08)'], 1.6);
  for (let i = 0; i < 16; i++) {
    const px = r() * s, py = r() * s, pr = 22 + r() * 70;
    softPatch(x, s, s, px, py, pr, pr * .72, pick(r, ['rgba(70,64,48,.2)', 'rgba(52,50,44,.17)', 'rgba(190,184,164,.12)']));
    softPatch(xr, s, s, px, py, pr, pr * .72, 'rgba(172,172,172,.3)');
  }
  // Chicles y goterones viejos: pocos, oscuros y de varios píxeles.
  for (let i = 0; i < 26; i++) {
    const px = r() * s, py = r() * s, pr = 1.6 + r() * 2.6;
    softPatch(x, s, s, px, py, pr, pr * (.7 + r() * .3), 'rgba(38,36,32,.5)');
  }
  return surfaceMaps(maps);
}

/** Ladrillo a la vista, como las culatas de las casas de barrio. */
/** Ladrillo para muros laterales. La textura cubre BRICK_TILE metros (8 × 21,3 ladrillos). */
export const BRICK_TILE = { w: 8 * 0.36, h: 24 * 0.12 };
/** Tinte del ladrillo de costados, culatas y antepechos: vive con el ladrillo para que case con el de las fachadas. */
export const TINTE_COSTADO = '#e3cfc0';

export function brick(seed = 3) {
  const r = rng(seed);
  const w = 512, h = 512;
  const maps = surface(w, h, '#aaa28d', 223);
  brickWall(maps.x, r, 0, 0, w, h, w / BRICK_TILE.w, maps.xb, maps.xr);
  speckle(maps.x, w, h, r, 12000, ['rgba(82,54,37,.12)', 'rgba(241,212,176,.12)'], 1.3);
  for (let i = 0; i < 5; i++) softPatch(maps.x, w, h, r() * w, r() * h, 40 + r() * 70, 22 + r() * 45, 'rgba(208,200,174,.13)');
  // Hollín y toletes requemados, con azar propio para no correr el dibujo de siempre.
  const u = rng((seed ^ 0x51a7e0d) >>> 0);
  for (let i = 0; i < 7; i++) softPatch(maps.x, w, h, u() * w, u() * h, 50 + u() * 90, 40 + u() * 110, 'rgba(52,35,27,.17)');
  return surfaceMaps(maps);
}

// Pañetes de barrio lavados por la lluvia: ocre, salmón, añil, crema, menta, terracota, gris, rosa viejo, amarillo y celeste.
const WALLS = ['#c59d62', '#c88c73', '#6f879c', '#d9caa2', '#9db79a', '#b26d4b', '#a8a297', '#bd959d', '#d1b168', '#8ca9b5'];
// Cada barrio pinta con su mezcla (índices de WALLS); la base y el acento del barrio van aparte.
// El orden está escogido para que las casas pintadas de hoy se repartan entre todos los tonos.
const WALL_MIX = {
  cambuche: [1, 3, 6, 0, 5, 4],
  comercio: [9, 1, 1, 8, 3, 0, 9, 7, 4, 2, 8],
  lago: [4, 4, 9, 2, 3, 8],
  centro: [7, 4, 7, 3, 9, 0, 1, 8, 3, 2, 9, 1, 4, 2, 5],
  candelaria: [3, 8, 0, 2, 1],
  chapinero: [5, 3, 0, 6]
};
const wallMix = district => (WALL_MIX[district] ?? WALL_MIX.centro).map(i => WALLS[i]);
const TAGS = ['LUZ', 'ZONA 7', 'RBQ', 'LA 33', 'PARCE', 'ÑERO', 'CALLE'];

/**
 * Fachada de casa o edificio de barrio, dibujada a la medida.
 * Devuelve color y emisivo (ventanas encendidas).
 */
// Medidas reales del ladrillo tolete con pega: 36 × 12 cm (mismas en fachadas y muros laterales)
export const BRICK_M = { w: 0.36, h: 0.12 };

/** Dibuja ladrillo tolete a la vista en un rectángulo del canvas (pxPerM = píxeles por metro). */
function brickWall(x, r, x0, y0, w, h, pxPerM = 36, xb = null, xr = null) {
  x.fillStyle = '#9a9488';
  x.fillRect(x0, y0, w, h);
  if (xb) {
    xb.fillStyle = '#747474';
    xb.fillRect(x0, y0, w, h);
  }
  if (xr) { xr.fillStyle = '#e2e2e2'; xr.fillRect(x0, y0, w, h); }
  const bw = BRICK_M.w * pxPerM, bh = BRICK_M.h * pxPerM;
  const joint = Math.max(.35, Math.min(1.4, pxPerM * .006));
  for (let row = 0, y = y0; y < y0 + h; row++, y += bh) {
    const off = row % 2 ? bw / 2 : 0;
    for (let bx = x0 - bw; bx < x0 + w + bw; bx += bw) {
      const left = Math.max(x0, bx + off + joint), top = Math.max(y0, y + joint);
      const rw = Math.min(x0 + w, bx + off + bw - joint) - left;
      const rh = Math.min(y0 + h, y + bh - joint) - top;
      if (rw <= 0 || rh <= 0) continue;
      x.fillStyle = pick(r, ['#ad6142', '#b76a47', '#9f573c', '#bb714d', '#8f4f3a', '#b16646']);
      x.fillRect(left, top, rw, rh);
      x.fillStyle = 'rgba(236,186,144,.16)'; x.fillRect(left, top, rw, Math.min(.8, rh * .18));
      if (xb) {
        xb.fillStyle = gray(130 + Math.floor(r() * 8)); xb.fillRect(left, top, rw, rh);
      }
      if (xr) { xr.fillStyle = gray(205 + Math.floor(r() * 20)); xr.fillRect(left, top, rw, rh); }
    }
  }
}

/** Pañete lavado y ladrillo requemado. Las manchas son periódicas: la textura puede repetirse en una torre. */
function weatherWall(x, u, w, h, m, { style, floors, width, shopFront }) {
  if (style === 'ruina') return;
  const brick = style === 'ladrillo';
  for (let i = 0, n = 4 + floors * 2; i < n; i++) {
    const dark = u() < .55;
    softPatch(x, w, h, u() * w, u() * h, (.5 + u() * 1.5) * m, (.6 + u() * 2.2) * m,
      brick ? (dark ? 'rgba(52,35,27,.2)' : 'rgba(232,176,132,.14)') : (dark ? 'rgba(74,62,44,.14)' : 'rgba(255,249,230,.17)'));
  }
  if (brick || !shopFront) return;
  // La lluvia destiñe el color por franjas, más arriba que abajo.
  for (let i = 0, n = 3 + Math.round(width * .8); i < n; i++) {
    const bx = u() * w, bw = (.25 + u() * 1.3) * m, reach = h * (.45 + u() * .55), light = u() < .6;
    const tone = light ? '255,248,228' : '66,56,40', g = x.createLinearGradient(0, 0, 0, reach);
    g.addColorStop(0, `rgba(${tone},${(light ? .12 + u() * .15 : .08 + u() * .13).toFixed(2)})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    x.fillStyle = g; x.fillRect(bx, 0, bw, reach);
  }
  // Parches de repinte que nunca dan con el tono.
  for (let i = 0, n = 1 + Math.floor(u() * 3); i < n; i++) {
    const pw = (.7 + u() * 1.6) * m, ph = (.5 + u() * 1.2) * m;
    x.fillStyle = u() < .5 ? 'rgba(255,250,236,.1)' : 'rgba(58,48,36,.08)';
    x.fillRect(u() * (w - pw), u() * (h - ph), pw, ph);
  }
}

/** Viga de amarre de concreto a la vista en cada entrepiso y en el remate, con su chorreón. */
function concreteBeams(x, xb, xr, u, w, h, fh, floors, m, tiled) {
  const bh = Math.max(2, m * .2);
  for (let f = 1; f <= floors; f++) {
    // En una torre la textura se repite hacia arriba: la viga del remate va al pie para que el paso sea parejo.
    const y = f < floors ? h - f * fh - bh : tiled ? h - bh : 0;
    x.fillStyle = '#a19c91'; x.fillRect(0, y, w, bh);
    x.fillStyle = 'rgba(255,252,240,.14)'; x.fillRect(0, y, w, Math.max(1, bh * .18));
    x.fillStyle = 'rgba(36,30,24,.34)'; x.fillRect(0, y + bh, w, Math.max(1, m * .035));
    xb.fillStyle = '#8c8c8c'; xb.fillRect(0, y, w, bh);
    xr.fillStyle = '#d4d4d4'; xr.fillRect(0, y, w, bh);
    for (let i = 0, n = Math.round(w / m * 1.4); i < n; i++) {
      const sx = u() * w, sl = (.2 + u() * u() * 1.1) * m, g = x.createLinearGradient(0, y, 0, y + bh + sl);
      g.addColorStop(0, 'rgba(60,54,44,0)'); g.addColorStop(.25, `rgba(60,54,44,${(.12 + u() * .16).toFixed(2)})`);
      g.addColorStop(1, 'rgba(60,54,44,0)');
      x.fillStyle = g; x.fillRect(sx, y, Math.max(1, (.03 + u() * .09) * m), bh + sl);
    }
  }
}

/** Sombra bajo el remate y chorreones de hollín que bajan desde arriba. */
function corniceGrime(x, u, w, width, m) {
  const band = x.createLinearGradient(0, 0, 0, m * .7);
  band.addColorStop(0, 'rgba(38,32,25,.44)'); band.addColorStop(1, 'rgba(38,32,25,0)');
  x.fillStyle = band; x.fillRect(0, 0, w, m * .7);
  for (let i = 0, n = Math.round(width * 2.2); i < n; i++) {
    const sx = u() * w, sl = (.4 + u() * u() * 2.8) * m, g = x.createLinearGradient(0, 0, 0, sl);
    g.addColorStop(0, `rgba(46,40,30,${(.18 + u() * .24).toFixed(2)})`); g.addColorStop(1, 'rgba(46,40,30,0)');
    x.fillStyle = g; x.fillRect(sx, 0, Math.max(1, (.04 + u() * .14) * m), sl);
  }
}

/** Hilos de mugre bajo el alféizar: los más largos salen de las dos puntas, por donde escurre el agua. */
function sillStreaks(x, u, wx, y, ww, fh, m, brick) {
  for (let i = 0; i < 7; i++) {
    const end = i < 2, sx = end ? wx - 2 + i * ww : wx + u() * ww;
    const sl = fh * (end ? .24 + u() * .24 : .08 + u() * .22), g = x.createLinearGradient(0, y, 0, y + sl);
    const tone = brick && !end && i % 2 ? '226,214,196' : '48,41,30';
    g.addColorStop(0, `rgba(${tone},${end ? .46 : .32})`); g.addColorStop(1, `rgba(${tone},0)`);
    x.fillStyle = g; x.fillRect(sx, y, Math.max(1, (end ? .06 : .03 + u() * .05) * m), sl);
  }
}

/** Zócalo sucio: lo que salpica la calle de 0 a 0,65 m, más cargado contra el andén; salitre en el ladrillo. */
function plinthSplash(x, u, w, h, width, m, brick) {
  const zh = .65 * m, g = x.createLinearGradient(0, h - zh, 0, h);
  g.addColorStop(0, 'rgba(50,43,33,0)'); g.addColorStop(1, 'rgba(50,43,33,.42)');
  x.fillStyle = g; x.fillRect(0, h - zh, w, zh);
  for (let i = 0, n = Math.round(width * 24); i < n; i++) {
    const k = u() * u();
    x.fillStyle = u() < .7 ? 'rgba(46,39,30,.34)' : brick ? 'rgba(228,222,206,.3)' : 'rgba(150,140,120,.3)';
    x.fillRect(u() * w, h - k * zh - 1, 1 + u() * m * .08, 1 + u() * m * .06);
  }
  x.fillStyle = 'rgba(30,26,20,.36)'; x.fillRect(0, h - Math.max(1, m * .04), w, Math.max(1, m * .04));
}

export function facade({ seed, width = 6, floors = 3, pxPerM = 28, shopFront = true, style = 'pintada', wallColor = null, district = 'centro' }) {
  const r = rng(seed);
  width = Math.max(1, Number.isFinite(width) ? width : 6);
  floors = Math.max(1, Math.round(Number.isFinite(floors) ? floors : 3));
  pxPerM = Math.min(Math.max(8, Number.isFinite(pxPerM) ? pxPerM : 28), 1024 / width, 2048 / (floors * 3));
  const palette = districtPalette(district);
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

  const mix = wallMix(district);
  const wall = wallColor ?? pick(r, [palette.facadeBase, palette.facadeAccent, ...mix]);
  const ruin = style === 'ruina';
  // Azar propio del desgaste: no corre la secuencia de la fachada ni cambia con el barrio.
  const u = rng((seed ^ 0x51a7e0d) >>> 0);
  // Y el del brillo de los vidrios, por lo mismo.
  const v = rng((seed ^ 0x6c1a55) >>> 0);
  if (style === 'ladrillo') {
    brickWall(x, r, 0, 0, w, h, pxPerM, xb, xr);
  } else {
    x.fillStyle = ruin ? pick(r, ['#8c8070', '#7a6e62', '#9a8a6a', '#6f6a60']) : wall;
    x.fillRect(0, 0, w, h);
    if (ruin) {
      // pañete caído: se ve el ladrillo
      for (let i = 0; i < 4 + r() * 6; i++) {
        const pw = w * (0.08 + r() * 0.25), ph = h * (0.06 + r() * 0.2);
        const px = r() * (w - pw), py = r() * (h - ph);
        brickWall(x, r, px, py, pw, ph, pxPerM, xb, xr);
      }
    }
  }
  weatherWall(x, u, w, h, pxPerM, { style, floors, width, shopFront });
  speckle(x, w, h, r, Math.min(50000, w * h * .035), ['rgba(56,47,37,.08)', 'rgba(255,246,218,.08)'], 1.3);
  // El revoque tiene grano propio: la pintura, las manchas y los avisos no afectan el relieve.
  if (style !== 'ladrillo') speckle(xb, w, h, rng(seed + 719), Math.min(24000, w * h * .025), ['#7e7e7e', '#828282'], 1.1);

  // pintura vieja por pisos (cada piso lo pintó otro dueño)
  for (let f = 1; f < floors; f++) {
    if (style === 'pintada' && r() < 0.45) {
      x.fillStyle = pick(r, [palette.facadeAccent, palette.facadeBase, ...mix]);
      x.globalAlpha = 0.6;
      x.fillRect(0, h - (f + 1) * fh, w, fh);
      x.globalAlpha = 1;
    }
    x.fillStyle = 'rgba(60,49,38,.17)'; x.fillRect(0, h - f * fh - 3, w, 3);
    x.fillStyle = palette.trim; x.globalAlpha = .45; x.fillRect(0, h - f * fh, w, 2); x.globalAlpha = 1;
  }

  if (style === 'ladrillo') concreteBeams(x, xb, xr, u, w, h, fh, floors, pxPerM, !shopFront);
  if (shopFront) corniceGrime(x, u, w, width, pxPerM);

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
      let glass = '#34434a';
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
      if (lit < 0.22) { glass = '#d8b47d'; emis = '#e9bd83'; }
      else if (lit < 0.3) { glass = '#9caebc'; emis = '#a4bfd2'; }
      else if (lit < 0.36) { glass = '#dde4d9'; emis = '#d8ddc6'; }
      x.fillStyle = style === 'ladrillo' ? palette.trim : '#585a55';
      x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      if (emis) {
        x.fillStyle = glass;
        x.fillRect(wx, wy, ww, wh);
      } else {
        // Vidrio apagado: devuelve el cielo arriba y oscurece hacia el alféizar; uno de cada tres lleva un brillo en diagonal.
        const sky = x.createLinearGradient(0, wy, 0, wy + wh);
        sky.addColorStop(0, '#4f6168'); sky.addColorStop(1, '#2d3a3f');
        x.fillStyle = sky;
        x.fillRect(wx, wy, ww, wh);
        if (v() < 1 / 3) {
          const bx = wx + ww * (.2 + v() * .4), bw = ww * .22, lean = wh * .45;
          x.fillStyle = 'rgba(255,255,255,.08)';
          x.beginPath(); x.moveTo(bx, wy); x.lineTo(bx + bw, wy);
          x.lineTo(Math.max(wx, bx + bw - lean), wy + wh); x.lineTo(Math.max(wx, bx - lean), wy + wh); x.fill();
        }
      }

      // Vidrio satinado; el marco y el alféizar tienen altura propia.
      xr.fillStyle = '#6a6a6a';
      xr.fillRect(wx, wy, ww, wh);
      xb.fillStyle = '#949494';
      xb.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
      xb.fillStyle = '#787878';
      xb.fillRect(wx, wy, ww, wh);
      x.fillStyle = palette.trim; x.fillRect(wx - 3, wy + wh, ww + 6, Math.max(1, pxPerM * .08));
      xb.fillStyle = '#999999'; xb.fillRect(wx - 3, wy + wh, ww + 6, Math.max(1, pxPerM * .08));

      if (emis) {
        // cortina a medio cerrar
        xe.fillStyle = emis;
        xe.fillRect(wx, wy, ww, wh);
        if (r() < 0.6) {
          const cur = pick(r, ['#8b6b58', '#667773', '#8f886b', '#746961']);
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
      g.addColorStop(0, 'rgba(56,48,35,0.18)');
      g.addColorStop(1, 'rgba(56,48,35,0)');
      x.fillStyle = g;
      x.fillRect(wx, wy + wh + 3, ww, fh * 0.6);
      sillStreaks(x, u, wx, wy + wh + 3, ww, fh, pxPerM, style === 'ladrillo');
    }
  }

  if (shopFront) {
    // Zócalo protector, persianas enrollables y avisos de los oficios del barrio.
    const y0 = h - fh;
    x.fillStyle = palette.plinth; x.fillRect(0, h - fh * .16, w, fh * .16);
    const doors = Math.max(1, Math.round(width / 4.2));
    const dw = w / doors;
    for (let d = 0; d < doors; d++) {
      const dx = d * dw + dw * 0.08;
      const ddw = dw * 0.84;
      const dy = y0 + fh * 0.18;
      const dh = fh * 0.82;
      x.fillStyle = palette.trim; x.fillRect(dx - 2, dy - 2, ddw + 4, dh + 2);
      x.fillStyle = pick(r, [palette.metal, '#858981', '#888073', '#727b72']);
      x.fillRect(dx, dy, ddw, dh);
      const slat = Math.max(3, pxPerM * .16);
      for (let l = dy; l < dy + dh; l += slat) {
        x.fillStyle = 'rgba(44,47,43,.25)'; x.fillRect(dx, l, ddw, 1);
        x.fillStyle = 'rgba(223,218,199,.17)'; x.fillRect(dx, l + 1, ddw, 1);
      }

      // Persianas metálicas comerciales: satinadas con relieve horizontal
      xr.fillStyle = '#a8a8a8';
      xr.fillRect(dx, dy, ddw, dh);
      xb.fillStyle = '#888888';
      xb.fillRect(dx, dy, ddw, dh);
      for (let l = dy; l < dy + dh; l += slat) {
        xb.fillStyle = '#7b7b7b'; xb.fillRect(dx, l, ddw, 1);
      }

      x.fillStyle = palette.signBackground; x.fillRect(dx, y0 + fh * .035, ddw, fh * .115);
      x.fillStyle = palette.signText; x.font = `700 ${Math.max(6, Math.round(fh * .085))}px Arial, sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(pick(r, SMALL_SIGNS), dx + ddw / 2, y0 + fh * .095, ddw * .9);
      // Las letras solo pertenecen al albedo; el soporte del aviso es casi plano.
      xb.fillStyle = '#888888'; xb.fillRect(dx, y0 + fh * .035, ddw, fh * .115);
      xr.fillStyle = '#c4c4c4'; xr.fillRect(dx, y0 + fh * .035, ddw, fh * .115);

      if (r() < (ruin ? .8 : .35)) {
        x.save();
        x.font = `900 ${Math.round(fh * 0.24)}px Arial, sans-serif`;
        x.fillStyle = pick(r, ['#b87c72', '#91a08a', '#c8b575', '#879da5', '#ddd6bd', '#bd8b61']);
        x.strokeStyle = '#4b4a42';
        x.lineWidth = 2;
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
      const txt = pick(r, ['SE ARRIENDA', 'SE VENDE']);
      const sw = Math.min(w * 0.4, 140), sh = fh * 0.16;
      const sx = r() * (w - sw), sy = h - fh * 1.15;
      x.fillStyle = pick(r, ['#e9e2c9', '#d4bd76', '#c9b69b']);
      x.fillRect(sx, sy, sw, sh);
      x.fillStyle = '#784d3d';
      x.font = `900 ${Math.round(sh * 0.62)}px Arial, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(txt, sx + sw / 2, sy + sh / 2 + 1, sw * 0.92);
    }
  }

  // mugre de la base y manchas de humedad
  const g = x.createLinearGradient(0, h, 0, h - fh * (ruin ? 2.2 : 1.2));
  g.addColorStop(0, ruin ? 'rgba(44,37,28,.46)' : 'rgba(57,50,37,.25)');
  g.addColorStop(1, ruin ? 'rgba(44,37,28,0)' : 'rgba(57,50,37,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    const sx = r() * w;
    const sg = x.createLinearGradient(0, 0, 0, h * 0.5);
    sg.addColorStop(0, 'rgba(67,64,49,.09)');
    sg.addColorStop(1, 'rgba(67,64,49,0)');
    x.fillStyle = sg;
    x.fillRect(sx, 0, 2 + r() * 6, h * 0.5);
  }
  if (shopFront) plinthSplash(x, u, w, h, width, pxPerM, style === 'ladrillo');

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
  const maps = surface(s, s, '#785b45', 221), { x, xb, xr } = maps;
  const tw = 16, th = 32;
  for (let row = 0, y = 0; y < s; row++, y += th) {
    const off = row % 2 ? tw / 2 : 0;
    for (let tx = -tw; tx < s + tw; tx += tw) {
      const g = x.createLinearGradient(tx + off, 0, tx + off + tw, 0);
      const base = pick(r, ['#ad7855', '#a46c4c', '#b38360', '#9a694b', '#b17b54']);
      g.addColorStop(0, '#75573f');
      g.addColorStop(0.3, base);
      g.addColorStop(0.7, base);
      g.addColorStop(1, '#75573f');
      x.fillStyle = g;
      x.fillRect(tx + off, y, tw - 1, th - 2);
      const height = xb.createLinearGradient(tx + off, 0, tx + off + tw, 0);
      height.addColorStop(0, '#747474'); height.addColorStop(.5, '#959595'); height.addColorStop(1, '#747474');
      xb.fillStyle = height; xb.fillRect(tx + off, y, tw - 1, th - 2);
      xr.fillStyle = gray(205 + Math.floor(r() * 22)); xr.fillRect(tx + off, y, tw - 1, th - 2);
    }
  }
  speckle(x, s, s, r, 2000, ['rgba(94,105,63,.18)', 'rgba(63,50,35,.14)', 'rgba(237,211,170,.10)'], 1.7);
  return surfaceMaps(maps);
}

/** Placa de concreto de terraza, vieja y sucia: agua estancada, chorreones, verdín y remiendos de manto. Cubre 4 × 4 m. */
export function slab(seed = 13) {
  const r = rng(seed);
  const s = 256;
  const maps = surface(s, s, '#7a756b', 223), { x, xb, xr } = maps;
  aggregate(maps, r, 7000, ['#857f72', '#706c62', '#8f887b', '#67645b'], 1.3);
  for (let i = 0; i < 7; i++) {
    const px = r() * s, py = r() * s, pr = 20 + r() * 60;
    softPatch(x, s, s, px, py, pr, pr * .7, 'rgba(72,70,55,.17)');
    softPatch(xr, s, s, px, py, pr, pr * .7, 'rgba(185,185,185,.38)');
  }
  // Remiendos de manto asfáltico: manchas oscuras y ásperas de borde deshecho, sin forma que se reconozca al repetirse.
  for (let i = 0, n = 1 + Math.floor(r() * 2); i < n; i++) {
    const px = r() * s, py = r() * s, lado = 22 + r() * 18;
    for (let k = 0; k < 9; k++) {
      const giro = r() * Math.PI * 2, lejos = lado * r() * .5, rx = lado * (.18 + r() * .3), ry = rx * (.5 + r() * .5);
      const qx = px + Math.cos(giro) * lejos, qy = py + Math.sin(giro) * lejos;
      softPatch(x, s, s, qx, qy, rx, ry, 'rgba(59,58,55,.2)');
      softPatch(xr, s, s, qx, qy, rx, ry, 'rgba(240,240,240,.3)');
    }
    speckle(xb, s, s, r, 60, ['rgba(150,150,150,.5)', 'rgba(104,104,104,.5)'], 1.6);
  }
  // Agua estancada: el concreto queda más oscuro y más liso donde se empoza.
  for (let i = 0, n = 6 + Math.floor(r() * 4); i < n; i++) {
    const px = r() * s, py = r() * s, pr = 14 + r() * 30, ry = pr * (.45 + r() * .4);
    softPatch(x, s, s, px, py, pr, ry, 'rgba(48,46,40,.3)');
    softPatch(xr, s, s, px, py, pr * .8, ry * .8, 'rgba(150,150,150,.45)');
  }
  // Chorreones que nacen en las juntas y verdín pegado a ellas.
  for (let i = 0, n = 3 + Math.floor(r() * 3); i < n; i++) {
    const junta = r() < .5 ? 0 : 128, ancho = 3 + r() * 5, largo = 40 + r() * 80, a = r() * s, porX = r() < .5;
    for (const d of [-s, 0, s]) {
      const g = porX ? x.createLinearGradient(junta, 0, junta + largo, 0) : x.createLinearGradient(0, junta, 0, junta + largo);
      g.addColorStop(0, 'rgba(30,28,24,.22)'); g.addColorStop(1, 'rgba(30,28,24,0)');
      x.fillStyle = g;
      if (porX) x.fillRect(junta, a + d, largo, ancho); else x.fillRect(a + d, junta, ancho, largo);
    }
  }
  for (let i = 0; i < 46; i++) {
    const junta = r() < .5 ? 0 : 128, a = r() * s, largo = 6 + r() * 22, ancho = 2 + r() * 5, lado = r() < .5 ? -ancho : 1;
    x.fillStyle = 'rgba(78,92,52,.18)';
    if (r() < .5) x.fillRect(a, junta + lado, largo, ancho); else x.fillRect(junta + lado, a, ancho, largo);
  }
  for (const position of [0, 128]) for (const [ctx, color] of [[x, '#5f5d53'], [xb, '#787878']]) {
    ctx.fillStyle = color; ctx.fillRect(position, 0, 1, s); ctx.fillRect(0, position, s, 1);
  }
  return surfaceMaps(maps);
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
  x.font = '900 26px Arial, sans-serif';
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
  x.font = `900 ${Math.round(h * (sub ? 0.36 : 0.5))}px Arial, sans-serif`;
  x.fillText(title, w / 2, sub ? h * 0.42 : h * 0.54, w * 0.9);
  if (sub) {
    x.fillStyle = accent;
    x.font = `800 ${Math.round(h * 0.15)}px Arial, sans-serif`;
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
  x.font = `${font} ${Math.round(h * 0.55)}px Arial, sans-serif`;
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

/** Atlas de llama: cada cuadro es la misma llama un poco más arriba, así el bucle no salta. */
export function flameAtlas(columns, rows, cellW = 128, cellH = 256) {
  const [c, x] = canvas(columns * cellW, rows * cellH);
  const noise = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  const mix = (a, b, t) => a.map((value, i) => Math.round(value + (b[i] - value) * t));
  const hot = [255, 218, 128], warm = [255, 138, 40], cool = [206, 58, 18];
  x.globalCompositeOperation = 'lighter';
  for (let frame = 0; frame < columns * rows; frame++) {
    const left = (frame % columns) * cellW, top = Math.floor(frame / columns) * cellH;
    const phase = frame / (columns * rows);
    const blob = (px, py, radius, [r, g, b], alpha) => {
      const cx = left + cellW / 2 + px * cellW, cy = top + cellH - py * cellH, size = radius * cellW;
      const gradient = x.createRadialGradient(cx, cy, 0, cx, cy, size);
      gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = gradient;
      // Recortar a la celda evita que un cuadro manche al vecino.
      const x0 = Math.max(left, cx - size), y0 = Math.max(top, cy - size);
      x.fillRect(x0, y0, Math.min(left + cellW, cx + size) - x0, Math.min(top + cellH, cy + size) - y0);
    };
    blob(0, .16, .36, warm, .8);
    for (let i = 0; i < 24; i++) {
      // Multiplicar la fase por un entero conserva el bucle y evita que todas suban igual.
      const life = (i / 24 + phase * (1 + i % 2)) % 1;
      const wander = Math.sin((life * 1.5 + noise(i, 2)) * Math.PI * 2) * .07 * life;
      const px = (noise(i, 1) - .5) * .5 * (1 - life * .8) + wander;
      const py = .08 + life * (.64 + noise(i, 3) * .18);
      const color = life < .35 ? mix(hot, warm, life / .35) : mix(warm, cool, (life - .35) / .65);
      blob(px, py, (.27 * (1 - life) ** .8 + .05) * (.8 + noise(i, 4) * .4), color, Math.min(1, life * 8) * (1 - life) ** 1.1);
    }
    for (let i = 0; i < 3; i++) {
      const life = (noise(i, 5) + phase) % 1;
      blob(Math.sin((life + noise(i, 6)) * Math.PI * 2) * .16, .48 + life * .46, .02, warm, 1 - life);
    }
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 1;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.repeat.set(1 / columns, 1 / rows);
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
  const maps = surface(s, s, '#786b54', 230), { x, xr, xb } = maps;
  aggregate(maps, r, 19000, ['#72624c', '#85765d', '#958568', '#645943', '#a1957b'], 2.6);
  for (let i = 0; i < 15; i++) {
    const px = r() * s, py = r() * s, radius = 20 + r() * 70;
    softPatch(x, s, s, px, py, radius, radius * .75, 'rgba(78,65,46,.22)');
    softPatch(xr, s, s, px, py, radius, radius * .75, 'rgba(175,175,175,.42)');
  }
  // Piedritas pequeñas compartiendo contorno en color y relieve.
  for (let i = 0; i < 80; i++) {
    const px = r() * s, py = r() * s, radius = 1 + r() * 2;
    for (const [ctx, color] of [[x, pick(r, ['#aaa18a', '#8b8875', '#625e50'])], [xb, '#919191']]) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
    }
  }
  return surfaceMaps(maps);
}

/** Césped de clima frío, por matas: hojas oscuras, verdes y de paja sobre tierra que asoma entre ellas. */
export function grass(seed = 61) {
  const r = rng(seed), s = 512;
  const maps = surface(s, s, '#4d5a39', 236), { x, xb, xr } = maps;
  // La hoja que cruza el borde se dibuja también al otro lado: la repetición no corta una mata.
  const blade = (px, py, length, lean, width, color, height) => {
    const margin = length + 8;
    for (const ox of px < margin ? [0, s] : px > s - margin ? [0, -s] : [0]) {
      for (const oy of py < margin ? [0, s] : py > s - margin ? [0, -s] : [0]) {
        for (const [ctx, stroke] of [[x, color], [xb, height]]) {
          ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.beginPath();
          ctx.moveTo(px + ox, py + oy); ctx.lineTo(px + ox + lean, py + oy - length); ctx.stroke();
        }
      }
    }
  };
  for (let i = 0; i < 26; i++) {
    const px = r() * s, py = r() * s, radius = 24 + r() * 70;
    softPatch(x, s, s, px, py, radius, radius * .8, pick(r, ['rgba(42,58,31,.34)', 'rgba(108,116,66,.22)', 'rgba(82,75,48,.22)']));
    softPatch(xr, s, s, px, py, radius, radius * .8, 'rgba(204,204,204,.25)');
  }
  // Tierra entre matas: de lejos no se ve cada una, pero el conjunto deja de ser una alfombra.
  for (let i = 0; i < 230; i++) {
    const px = r() * s, py = r() * s, radius = 2.5 + r() * 7;
    softPatch(x, s, s, px, py, radius, radius * .75, 'rgba(50,43,30,.46)');
    softPatch(xb, s, s, px, py, radius, radius * .75, 'rgba(96,96,96,.4)');
  }
  for (let i = 0; i < 5000; i++) {
    blade(r() * s, r() * s, 2 + r() * 4, (r() - .5) * 3, .7, pick(r, ['rgba(74,92,52,.6)', 'rgba(101,118,70,.5)', 'rgba(60,76,44,.6)']), gray(122 + Math.floor(r() * 16)));
  }
  // Matas de tamaños mezclados, cada una con su tono; todas repiten su trazo en el mapa de altura.
  const tones = [['#3e5230', '#4c6238'], ['#4f6438', '#5f7541'], ['#5f7342', '#6f834b'], ['#74794a', '#838653']];
  for (let i = 0; i < 960; i++) {
    const cx = r() * s, cy = r() * s, spread = 2 + r() * 8, blades = 5 + Math.floor(r() * 9);
    const pair = r(), [dark, light] = tones[pair < .3 ? 0 : pair < .68 ? 1 : pair < .94 ? 2 : 3];
    for (let n = 0; n < blades; n++) {
      blade(cx + (r() - .5) * spread, cy + (r() - .5) * spread, 3 + r() * 6, (r() - .5) * 6, .6 + r() * .7, r() < .55 ? dark : light, gray(134 + Math.floor(r() * 36)));
    }
  }
  return surfaceMaps(maps);
}

/** Concreto de formaleta: poro fino, juntas y marcas de tensores, con desgaste moderado. */
export function concrete(seed = 41) {
  const r = rng(seed);
  const s = 512;
  const maps = surface(s, s, '#9a9992', 220), { x, xb, xr } = maps;
  aggregate(maps, r, 20000, ['#93938c', '#a3a198', '#878981', '#b0aba0'], 1.3);
  for (let i = 0; i < 10; i++) {
    const px = r() * s, py = r() * s, radius = 30 + r() * 90;
    softPatch(x, s, s, px, py, radius, radius * 1.4, 'rgba(84,82,69,.13)');
    softPatch(xr, s, s, px, py, radius, radius * 1.4, 'rgba(195,195,195,.28)');
  }
  for (const y of [0, 256]) {
    x.fillStyle = '#817f75'; x.fillRect(0, y, s, 1);
    xb.fillStyle = '#797979'; xb.fillRect(0, y, s, 1);
    for (const px of [72, 256, 440]) {
      for (const [ctx, color] of [[x, '#7c7d73'], [xb, '#777777']]) {
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, y + 68, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  return surfaceMaps(maps);
}
