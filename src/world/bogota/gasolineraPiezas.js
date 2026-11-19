// Lo que viste la gasolinera: texturas pintadas, piezas menudas fundidas en una malla y la placa del piso.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { azarPropio, lienzo } from './concretoViaducto.js';

const ATLAS = 512;
const ZONAS = {
  metal: [0, 0, 128, 128], concreto: [128, 0, 128, 128], ocre: [256, 0, 128, 128], negro: [384, 0, 64, 64],
  luminaria: [384, 64, 128, 64], cara: [0, 128, 192, 160], puerta: [192, 128, 112, 224], precios: [304, 128, 208, 224],
  zocalo: [0, 288, 192, 64]
};
const UV = Object.fromEntries(Object.entries(ZONAS).map(([nombre, [x, y, w, h]]) =>
  [nombre, [(x + 1.5) / ATLAS, 1 - (y + h - 1.5) / ATLAS, (x + w - 1.5) / ATLAS, 1 - (y + 1.5) / ATLAS]]));
const CARAS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export const PRECIOS = [['CORRIENTE', '15.870'], ['EXTRA', '21.340'], ['DIÉSEL', '10.960']];
export const LOTE = { x0: 145, x1: 163, z0: 89, z1: 117 };
export const ISLAS = [149, 159], SURTIDORES = [97, 103];
export const LUMINARIAS = [149, 154, 159].flatMap(x => [95.5, 100, 104.5].map(z => [x, z]));
export const COLUMNAS = { x: [147, 161], z: [94, 106] };
export const PUERTA = { x: 156, z: 111.965 };
/** Colgado del poste del tótem, que ya tiene choque: por debajo del aviso de siempre y por encima de las cabezas. */
export const AVISO_DE_PRECIOS = { x: 146, y: 4.6, z: 91, w: 1.9, h: 2.1, d: .34 };
const PISO = .12;

/** Three sortea un identificador por cada geometría, material y textura: lo de aquí no toca el azar de la ciudad. */
export function conAzarPropio(semilla, crear) {
  const delJuego = Math.random;
  Math.random = azarPropio(semilla);
  try { return crear(); } finally { Math.random = delJuego; }
}

const entre = (azar, a, b) => a + azar() * (b - a);

function manchas(ctx, azar, [x, y, w, h], cuantas, rgb, alfa, radio) {
  for (let i = 0; i < cuantas; i++) {
    const cx = x + azar() * w, cy = y + azar() * h, r = entre(azar, radio[0], radio[1]);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb},${entre(azar, alfa * .4, alfa)})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(Math.max(x, cx - r), Math.max(y, cy - r), Math.min(x + w, cx + r) - Math.max(x, cx - r), Math.min(y + h, cy + r) - Math.max(y, cy - r));
  }
}

function chorreones(ctx, azar, [x, y, w, h], cuantos, rgb, alfa, ancho, largo) {
  for (let i = 0; i < cuantos; i++) {
    const cx = x + azar() * w, a = entre(azar, ancho[0], ancho[1]), l = Math.min(h, h * entre(azar, largo[0], largo[1]));
    const g = ctx.createLinearGradient(0, y, 0, y + l);
    g.addColorStop(0, `rgba(${rgb},${entre(azar, alfa * .5, alfa)})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(Math.min(cx, x + w - a), y, a, l);
  }
}

function granos(ctx, azar, [x, y, w, h], cuantos, alfa) {
  for (let i = 0; i < cuantos; i++) {
    const claro = azar() < .3;
    ctx.fillStyle = `rgba(${claro ? '235,230,215' : '25,22,18'},${entre(azar, alfa * .3, alfa)})`;
    ctx.fillRect(x + azar() * (w - 2), y + azar() * (h - 2), 1 + azar() * 1.6, 1 + azar() * 1.6);
  }
}

function desconchados(ctx, azar, [x, y, w, h], cuantos, color, medida) {
  ctx.fillStyle = color;
  for (let i = 0; i < cuantos; i++) {
    const cx = x + azar() * w, cy = y + azar() * h, r = entre(azar, medida[0], medida[1]);
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2, d = r * entre(azar, .45, 1);
      ctx[k ? 'lineTo' : 'moveTo'](Math.min(x + w, Math.max(x, cx + Math.cos(a) * d * 1.5)), Math.min(y + h, Math.max(y, cy + Math.sin(a) * d)));
    }
    ctx.fill();
  }
}

function mugreAbajo(ctx, [x, y, w, h], desde, alfa) {
  const g = ctx.createLinearGradient(0, y + h * desde, 0, y + h);
  g.addColorStop(0, 'rgba(38,33,27,0)'); g.addColorStop(1, `rgba(38,33,27,${alfa})`);
  ctx.fillStyle = g; ctx.fillRect(x, y + h * desde, w, h * (1 - desde));
}

function textura(canvas, repetida = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repetida) t.wrapS = THREE.RepeatWrapping;
  return t;
}

function pintarLamina(azar) {
  const { canvas, ctx } = lienzo(256, 256), todo = [0, 0, 256, 256];
  ctx.fillStyle = '#b3b1a8'; ctx.fillRect(0, 0, 256, 256);
  manchas(ctx, azar, todo, 18, '70,64,52', .16, [20, 70]);
  manchas(ctx, azar, todo, 8, '214,210,198', .14, [18, 50]);
  chorreones(ctx, azar, todo, 30, '52,46,38', .26, [2, 7], [.2, .85]);
  mugreAbajo(ctx, todo, .76, .62);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(30,27,24,${entre(azar, .1, .3)})`;
    ctx.fillRect(azar() * 240, entre(azar, 214, 250), entre(azar, 6, 30), entre(azar, 1, 2.5));
  }
  granos(ctx, azar, todo, 900, .12);
  ctx.fillStyle = 'rgba(20,18,16,.3)'; ctx.fillRect(0, 0, 1.5, 256);
  ctx.fillStyle = 'rgba(240,238,230,.1)'; ctx.fillRect(1.5, 0, 1, 256);
  return textura(canvas, true);
}

function pintarRojo(azar) {
  const { canvas, ctx } = lienzo(256, 128), todo = [0, 0, 256, 128];
  ctx.fillStyle = '#7b2f2b'; ctx.fillRect(0, 0, 256, 128);
  manchas(ctx, azar, todo, 14, '176,132,120', .18, [14, 46]);
  manchas(ctx, azar, todo, 10, '40,20,18', .2, [10, 40]);
  chorreones(ctx, azar, todo, 46, '28,18,15', .42, [1, 4], [.25, 1]);
  chorreones(ctx, azar, todo, 12, '86,58,34', .34, [2, 5], [.3, .9]);
  const arriba = ctx.createLinearGradient(0, 0, 0, 16);
  arriba.addColorStop(0, 'rgba(24,18,16,.5)'); arriba.addColorStop(1, 'rgba(24,18,16,0)');
  ctx.fillStyle = arriba; ctx.fillRect(0, 0, 256, 16);
  ctx.fillStyle = 'rgba(20,14,12,.5)'; ctx.fillRect(0, 118, 256, 10);
  granos(ctx, azar, todo, 500, .14);
  return textura(canvas, true);
}

function pintarAmarillo(azar) {
  const { canvas, ctx } = lienzo(256, 64), todo = [0, 0, 256, 64];
  ctx.fillStyle = '#978239'; ctx.fillRect(0, 0, 256, 64);
  manchas(ctx, azar, todo, 12, '70,58,30', .25, [10, 34]);
  desconchados(ctx, azar, todo, 70, '#8b877d', [2, 8]);
  desconchados(ctx, azar, [0, 0, 256, 10], 26, '#84807a', [2, 6]);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = `rgba(18,18,18,${entre(azar, .2, .5)})`;
    ctx.fillRect(azar() * 230, entre(azar, 8, 50), entre(azar, 10, 44), entre(azar, 1.5, 4));
  }
  mugreAbajo(ctx, todo, .45, .6);
  granos(ctx, azar, todo, 400, .16);
  return textura(canvas, true);
}

function pintarVidrio(azar) {
  const { canvas, ctx } = lienzo(256, 192);
  const fondo = ctx.createLinearGradient(0, 0, 0, 192);
  fondo.addColorStop(0, '#2c3a3f'); fondo.addColorStop(1, '#1b2327');
  ctx.fillStyle = fondo; ctx.fillRect(0, 0, 256, 192);
  const tonos = ['#6c5a45', '#55606a', '#74684a', '#5d4a44', '#4f6253', '#77705f'];
  for (const y of [58, 100, 142]) {
    ctx.fillStyle = '#3c4447'; ctx.fillRect(10, y, 236, 4);
    for (let x = 14; x < 238;) {
      const w = entre(azar, 7, 16), h = entre(azar, 14, 30);
      ctx.fillStyle = tonos[Math.floor(azar() * tonos.length)]; ctx.fillRect(x, y - h, w, h);
      x += w + entre(azar, 1, 6);
    }
  }
  const luz = lienzo(256, 192);
  luz.ctx.drawImage(canvas, 0, 0);
  luz.ctx.fillStyle = 'rgba(255,214,150,.2)'; luz.ctx.fillRect(0, 0, 256, 192);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  for (const x of [30, 70, 168]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 34, 0); ctx.lineTo(x - 40, 192); ctx.lineTo(x - 74, 192); ctx.fill(); }
  const polvo = ctx.createLinearGradient(0, 120, 0, 192);
  polvo.addColorStop(0, 'rgba(150,138,112,0)'); polvo.addColorStop(1, 'rgba(150,138,112,.42)');
  ctx.fillStyle = polvo; ctx.fillRect(0, 120, 256, 72);
  for (const c of [ctx, luz.ctx]) {
    c.fillStyle = c === ctx ? '#7b7f7d' : '#0b0b0b';
    c.fillRect(0, 0, 256, 9); c.fillRect(0, 183, 256, 9); c.fillRect(0, 0, 8, 192); c.fillRect(248, 0, 8, 192); c.fillRect(124, 0, 8, 192);
  }
  ctx.fillStyle = 'rgba(20,20,20,.35)'; ctx.fillRect(8, 9, 240, 1.5); ctx.fillRect(8, 181.5, 240, 1.5);
  granos(ctx, azar, [0, 0, 256, 192], 300, .1);
  return [textura(canvas), textura(luz.canvas)];
}

function letras(ctx, texto, x, y, px, color, alinear = 'left', grueso = 'bold') {
  ctx.font = `${grueso} ${px}px Arial, Helvetica, sans-serif`; ctx.textAlign = alinear; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(texto, x, y);
}

function pintarAtlas(azar) {
  const { canvas, ctx } = lienzo(ATLAS, ATLAS), brillo = lienzo(ATLAS, ATLAS), luz = brillo.ctx;
  luz.fillStyle = '#000000'; luz.fillRect(0, 0, ATLAS, ATLAS);
  ctx.fillStyle = '#6f7272'; ctx.fillRect(0, 0, ATLAS, ATLAS);

  ctx.fillStyle = '#7c7f7e'; ctx.fillRect(...ZONAS.metal);
  manchas(ctx, azar, ZONAS.metal, 12, '50,46,40', .22, [10, 40]);
  chorreones(ctx, azar, ZONAS.metal, 16, '40,34,28', .28, [1, 4], [.2, .9]);
  manchas(ctx, azar, ZONAS.metal, 6, '112,72,40', .2, [5, 16]);
  granos(ctx, azar, ZONAS.metal, 400, .14);

  ctx.fillStyle = '#8a857b'; ctx.fillRect(...ZONAS.concreto);
  manchas(ctx, azar, ZONAS.concreto, 14, '48,44,38', .26, [8, 36]);
  manchas(ctx, azar, ZONAS.concreto, 6, '190,184,170', .16, [8, 26]);
  granos(ctx, azar, ZONAS.concreto, 700, .22);

  ctx.fillStyle = '#8f7c3a'; ctx.fillRect(...ZONAS.ocre);
  manchas(ctx, azar, ZONAS.ocre, 10, '60,48,24', .28, [8, 30]);
  desconchados(ctx, azar, ZONAS.ocre, 44, '#6c6a66', [2, 7]);
  desconchados(ctx, azar, ZONAS.ocre, 14, '#6e4a2c', [1.5, 4]);
  granos(ctx, azar, ZONAS.ocre, 300, .16);

  ctx.fillStyle = '#1e2022'; ctx.fillRect(...ZONAS.negro);
  granos(ctx, azar, ZONAS.negro, 120, .12);

  {
    const [x, y, w, h] = ZONAS.luminaria;
    ctx.fillStyle = '#74787a'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#cfccc0'; ctx.fillRect(x + 7, y + 7, w - 14, h - 14);
    manchas(ctx, azar, [x + 7, y + 7, w - 14, h - 14], 8, '120,104,70', .22, [6, 22]);
    granos(ctx, azar, [x + 7, y + 7, w - 14, h - 14], 60, .4);
    const g = luz.createRadialGradient(x + w / 2, y + h / 2, 4, x + w / 2, y + h / 2, w * .6);
    g.addColorStop(0, '#fff3dc'); g.addColorStop(1, '#d9b98a');
    luz.fillStyle = g; luz.fillRect(x + 7, y + 7, w - 14, h - 14);
  }
  {
    const [x, y, w, h] = ZONAS.cara;
    ctx.fillStyle = '#8f918c'; ctx.fillRect(x, y, w, h);
    manchas(ctx, azar, ZONAS.cara, 10, '54,48,40', .2, [10, 40]);
    ctx.fillStyle = '#2a2d2e'; ctx.fillRect(x + 10, y + 9, 118, 70);
    ctx.fillStyle = '#161b17'; ctx.fillRect(x + 14, y + 13, 110, 62);
    luz.fillStyle = '#10160f'; luz.fillRect(x + 14, y + 13, 110, 62);
    [['$', '62.480'], ['GAL', '3.937'], ['$/GAL', '15.870']].forEach(([rotulo, cifra], i) => {
      const cy = y + 25 + i * 19;
      letras(ctx, rotulo, x + 18, cy, 7, '#6d7a66'); letras(ctx, cifra, x + 120, cy, 15, '#93a77c', 'right');
      letras(luz, cifra, x + 120, cy, 15, '#cfe6a4', 'right');
    });
    for (let f = 0; f < 4; f++) for (let c = 0; c < 3; c++) {
      ctx.fillStyle = '#3b3e40'; ctx.fillRect(x + 138 + c * 15, y + 12 + f * 16, 12, 12);
      ctx.fillStyle = 'rgba(210,208,198,.5)'; ctx.fillRect(x + 142 + c * 15, y + 16 + f * 16, 4, 4);
    }
    PRECIOS.forEach(([nombre], i) => {
      const bx = x + 10 + i * 59;
      ctx.fillStyle = ['#7a3a34', '#3f5466', '#6a6a3c'][i]; ctx.fillRect(bx, y + 90, 54, 26);
      ctx.fillStyle = 'rgba(15,15,15,.35)'; ctx.fillRect(bx, y + 112, 54, 4);
      letras(ctx, nombre, bx + 27, y + 102, 8, '#d9d5c8', 'center');
    });
    ctx.fillStyle = '#c4c0b2'; ctx.fillRect(x + 10, y + 124, 172, 20);
    letras(ctx, 'NO FUME · APAGUE EL MOTOR', x + 96, y + 134.5, 9, '#5a2c28', 'center');
    desconchados(ctx, azar, [x + 10, y + 124, 172, 20], 9, '#8f918c', [2, 5]);
    chorreones(ctx, azar, ZONAS.cara, 14, '40,34,28', .3, [1, 4], [.3, .9]);
    mugreAbajo(ctx, ZONAS.cara, .7, .5);
    granos(ctx, azar, ZONAS.cara, 500, .12);
    ctx.strokeStyle = 'rgba(25,24,22,.6)'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }
  {
    const [x, y, w, h] = ZONAS.puerta;
    ctx.fillStyle = '#7d8180'; ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + 150);
    g.addColorStop(0, '#2b383d'); g.addColorStop(1, '#1d2529');
    ctx.fillStyle = g; ctx.fillRect(x + 10, y + 10, w - 20, 138);
    luz.fillStyle = '#6a563a'; luz.fillRect(x + 10, y + 10, w - 20, 138);
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.beginPath();
    ctx.moveTo(x + 40, y + 10); ctx.lineTo(x + 66, y + 10); ctx.lineTo(x + 30, y + 148); ctx.lineTo(x + 10, y + 148); ctx.lineTo(x + 10, y + 120); ctx.fill();
    ctx.fillStyle = '#a3a6a2'; ctx.fillRect(x + 14, y + 112, w - 28, 6);
    ctx.fillStyle = '#c9c4b4'; ctx.fillRect(x + 34, y + 40, 44, 22);
    letras(ctx, 'ABIERTO', x + 56, y + 51.5, 10, '#5a2c28', 'center');
    luz.fillStyle = '#8a7f66'; luz.fillRect(x + 34, y + 40, 44, 22);
    ctx.fillStyle = '#696d6c'; ctx.fillRect(x + 10, y + 158, w - 20, h - 168);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(28,26,24,${entre(azar, .15, .4)})`;
      ctx.fillRect(x + 12 + azar() * (w - 44), y + entre(azar, 168, h - 14), entre(azar, 8, 26), entre(azar, 1, 2.5));
    }
    mugreAbajo(ctx, ZONAS.puerta, .72, .6);
    granos(ctx, azar, ZONAS.puerta, 260, .12);
  }
  {
    const [x, y, w, h] = ZONAS.precios;
    ctx.fillStyle = '#676b6b'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#20262a'; ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
    ctx.fillStyle = '#343c41'; ctx.fillRect(x + 6, y + 6, w - 12, 30);
    letras(ctx, 'PRECIO POR GALÓN', x + w / 2, y + 22, 15, '#c9c6b8', 'center');
    PRECIOS.forEach(([nombre, precio], i) => {
      const fy = y + 42 + i * 59;
      ctx.fillStyle = '#12161a'; ctx.fillRect(x + 12, fy + 18, w - 24, 36);
      letras(ctx, nombre, x + 14, fy + 9, 14, '#b9b6a8');
      letras(ctx, `$ ${precio}`, x + w - 18, fy + 37, 30, '#a8762c', 'right');
      letras(luz, `$ ${precio}`, x + w - 18, fy + 37, 30, '#ffb648', 'right');
    });
    chorreones(ctx, azar, ZONAS.precios, 22, '120,112,96', .16, [1, 4], [.3, 1]);
    manchas(ctx, azar, ZONAS.precios, 8, '130,120,100', .12, [10, 40]);
    mugreAbajo(ctx, ZONAS.precios, .8, .4);
    granos(ctx, azar, ZONAS.precios, 500, .1);
  }
  {
    const [x, y, w, h] = ZONAS.zocalo;
    ctx.fillStyle = '#3c3d3c'; ctx.fillRect(x, y, w, h);
    manchas(ctx, azar, ZONAS.zocalo, 14, '16,15,14', .45, [8, 30]);
    manchas(ctx, azar, ZONAS.zocalo, 10, '118,104,84', .22, [5, 20]);
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = `rgba(${azar() < .5 ? '150,146,136' : '14,13,12'},${entre(azar, .25, .6)})`;
      ctx.fillRect(x + azar() * (w - 30), y + azar() * (h - 4), entre(azar, 6, 28), entre(azar, 1, 3));
    }
    desconchados(ctx, azar, ZONAS.zocalo, 12, '#6b4a30', [2, 5]);
    granos(ctx, azar, ZONAS.zocalo, 400, .2);
  }
  // Lo que queda bajo las luminarias devuelve de noche un poco de su propio color, como la placa.
  luz.globalCompositeOperation = 'lighter';
  for (const [zona, alfa] of [['cara', .09], ['metal', .09], ['zocalo', .09], ['puerta', .07], ['ocre', .15], ['concreto', .22]]) {
    const [x, y, w, h] = ZONAS[zona];
    luz.globalAlpha = alfa; luz.drawImage(canvas, x, y, w, h, x, y, w, h);
  }
  luz.globalAlpha = 1; luz.globalCompositeOperation = 'source-over';
  return [textura(canvas), textura(brillo.canvas)];
}

const PLACA = [768, 1152];

function pintarPlaca(azar) {
  const [W, H] = PLACA, { canvas, ctx } = lienzo(W, H), todo = [0, 0, W, H];
  const px = x => (x - LOTE.x0) / (LOTE.x1 - LOTE.x0) * W, pz = z => (z - LOTE.z0) / (LOTE.z1 - LOTE.z0) * H, m = W / (LOTE.x1 - LOTE.x0);
  ctx.fillStyle = '#928f87'; ctx.fillRect(0, 0, W, H);
  const xs = [145, 148, 151, 154, 157, 160, 163], zs = [89, 92.5, 96, 99.5, 103, 106.5, 110, 113.5, 117];
  for (let i = 0; i < xs.length - 1; i++) for (let k = 0; k < zs.length - 1; k++) {
    const tono = Math.round(entre(azar, -9, 9));
    ctx.fillStyle = tono < 0 ? `rgba(0,0,0,${-tono / 100})` : `rgba(255,250,235,${tono / 130})`;
    ctx.fillRect(px(xs[i]), pz(zs[k]), px(xs[i + 1]) - px(xs[i]), pz(zs[k + 1]) - pz(zs[k]));
  }
  manchas(ctx, azar, todo, 90, '52,48,42', .12, [20, 110]);
  manchas(ctx, azar, todo, 40, '178,172,158', .1, [20, 80]);
  granos(ctx, azar, todo, 9000, .16);

  const carriles = [146.2, 151.9, 156.1, 161.8];
  for (const cx of carriles) for (const lado of [-.72, .72]) {
    const x = px(cx + lado), ancho = .22 * m;
    for (let k = 0; k < 2; k++) {
      const g = ctx.createLinearGradient(0, pz(89.5), 0, pz(110.5));
      const a = entre(azar, .05, .11);
      g.addColorStop(0, 'rgba(18,18,18,0)'); g.addColorStop(.15, `rgba(18,18,18,${a})`); g.addColorStop(.85, `rgba(18,18,18,${a})`); g.addColorStop(1, 'rgba(18,18,18,0)');
      ctx.fillStyle = g; ctx.fillRect(x - ancho / 2 + entre(azar, -5, 5), pz(89.5), ancho * entre(azar, .6, 1), pz(110.5) - pz(89.5));
    }
  }
  ctx.strokeStyle = 'rgba(16,16,16,.09)'; ctx.lineWidth = .2 * m; ctx.lineCap = 'round';
  for (const cx of [151.9, 156.1]) for (const lado of [-.72, .72]) {
    ctx.beginPath(); ctx.arc(px(cx + 5), pz(95), (5 + lado) * m, Math.PI, Math.PI * 1.5); ctx.stroke();
  }

  for (const x of ISLAS) for (const z of SURTIDORES) for (const lado of [-1, 1]) {
    const zona = [px(x + (lado < 0 ? -2.35 : 1.05)), pz(z - 1.6), 1.3 * m, 3.2 * m];
    manchas(ctx, azar, zona, 7, '14,13,12', .62, [8, 34]);
    manchas(ctx, azar, zona, 5, '40,34,48', .3, [16, 52]);
    manchas(ctx, azar, zona, 9, '10,10,10', .7, [2, 7]);
    const cx = px(x + lado * entre(azar, 1.3, 1.9)), cz = pz(z + entre(azar, -.8, .8)), r = entre(azar, 20, 38);
    const g = ctx.createRadialGradient(cx, cz, r * .5, cx, cz, r);
    g.addColorStop(0, 'rgba(150,146,132,.16)'); g.addColorStop(.8, 'rgba(34,30,36,.34)'); g.addColorStop(1, 'rgba(34,30,36,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - r, cz - r, r * 2, r * 2);
  }
  for (const cx of carriles) manchas(ctx, azar, [px(cx - .4), pz(91), .8 * m, pz(110) - pz(91)], 30, '16,15,14', .5, [2, 8]);
  for (const x of ISLAS) {
    const g = ctx.createLinearGradient(px(x - 1.45), 0, px(x + 1.45), 0);
    g.addColorStop(0, 'rgba(30,27,24,0)'); g.addColorStop(.2, 'rgba(30,27,24,.3)'); g.addColorStop(.8, 'rgba(30,27,24,.3)'); g.addColorStop(1, 'rgba(30,27,24,0)');
    ctx.fillStyle = g; ctx.fillRect(px(x - 1.45), pz(94.3), px(x + 1.45) - px(x - 1.45), pz(105.7) - pz(94.3));
  }

  ctx.fillStyle = 'rgba(204,200,186,.5)';
  for (let x = 147.6; x <= 160.5; x += 2.58) {
    ctx.fillRect(px(x) - 2, pz(108.6), 4.5, pz(111.9) - pz(108.6));
    desconchados(ctx, azar, [px(x) - 3, pz(108.6), 7, pz(111.9) - pz(108.6)], 16, '#77756f', [2, 5]);
  }
  const pared = ctx.createLinearGradient(0, pz(110.6), 0, pz(112));
  pared.addColorStop(0, 'rgba(30,27,23,0)'); pared.addColorStop(1, 'rgba(30,27,23,.42)');
  ctx.fillStyle = pared; ctx.fillRect(0, pz(110.6), W, pz(112) - pz(110.6));
  for (const [x0, z0, x1, z1] of [[145, 89, 163, 89.5], [145, 116.4, 163, 117], [145, 89, 145.4, 117], [162.6, 89, 163, 117]]) {
    ctx.fillStyle = 'rgba(34,31,27,.3)'; ctx.fillRect(px(x0), pz(z0), px(x1) - px(x0), pz(z1) - pz(z0));
  }

  ctx.fillStyle = 'rgba(26,24,22,.6)';
  for (const x of xs.slice(1, -1)) ctx.fillRect(px(x) - 1.2, 0, 2.4, H);
  for (const z of zs.slice(1, -1)) ctx.fillRect(0, pz(z) - 1.2, W, 2.4);
  ctx.fillStyle = 'rgba(228,222,206,.1)';
  for (const x of xs.slice(1, -1)) ctx.fillRect(px(x) + 1.2, 0, 1, H);
  for (const z of zs.slice(1, -1)) ctx.fillRect(0, pz(z) + 1.2, W, 1);
  ctx.strokeStyle = 'rgba(24,22,20,.38)'; ctx.lineWidth = 1; ctx.lineCap = 'butt';
  for (let i = 0; i < 9; i++) {
    let x = azar() * W, y = azar() * H; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 9; k++) { x += entre(azar, -22, 22); y += entre(azar, 6, 30); ctx.lineTo(x, y); }
    ctx.stroke();
  }

  const noche = lienzo(W / 2, H / 2), luz = noche.ctx, e = .5;
  luz.fillStyle = '#000000'; luz.fillRect(0, 0, W * e, H * e);
  luz.globalCompositeOperation = 'lighter';
  for (const [x, z] of LUMINARIAS) {
    const cx = px(x) * e, cz = pz(z) * e, r = 4.6 * m * e;
    const g = luz.createRadialGradient(cx, cz, 0, cx, cz, r);
    g.addColorStop(0, 'rgba(255,222,170,.8)'); g.addColorStop(.35, 'rgba(255,214,158,.45)'); g.addColorStop(1, 'rgba(255,206,150,0)');
    luz.fillStyle = g; luz.fillRect(cx - r, cz - r, r * 2, r * 2);
  }
  for (const x of [150, 154, 156, 158]) {
    const cx = px(x) * e, cz = pz(111.7) * e, r = 2.6 * m * e;
    const g = luz.createRadialGradient(cx, cz, 0, cx, cz, r);
    g.addColorStop(0, 'rgba(255,214,160,.5)'); g.addColorStop(1, 'rgba(255,206,150,0)');
    luz.fillStyle = g; luz.fillRect(cx - r, cz - r, r * 2, Math.max(0, pz(112) * e - (cz - r)));
  }
  luz.globalCompositeOperation = 'multiply';
  luz.drawImage(canvas, 0, 0, W * e, H * e);
  return [textura(canvas), textura(noche.canvas)];
}

const SIN_TEXTURAS = Object.freeze({ lamina: null, rojo: null, amarillo: null, vidrio: null, vidrioLuz: null, atlas: null, atlasLuz: null, placa: null, placaLuz: null });

/** Pinta las nueve texturas; sin lienzo donde pintar (pruebas sin navegador) queda cada una en `null`. */
export function pintarTexturasDeGasolinera() {
  return conAzarPropio(0x6a501e7a, () => {
    if (!lienzo(2, 2)) return SIN_TEXTURAS;
    const azar = azarPropio(0x6a50c0de);
    const [vidrio, vidrioLuz] = pintarVidrio(azar), [atlas, atlasLuz] = pintarAtlas(azar), [placa, placaLuz] = pintarPlaca(azar);
    return { lamina: pintarLamina(azar), rojo: pintarRojo(azar), amarillo: pintarAmarillo(azar), vidrio, vidrioLuz, atlas, atlasLuz, placa, placaLuz };
  });
}

let texturas;
export const texturasDeGasolinera = () => texturas ??= pintarTexturasDeGasolinera();

/** Sigue la hora que publica la escena (`environmentDay`: 1 de día, 0 de noche); sin ella queda de día. */
export function encenderDeNoche(material, noche, dia = 0) {
  material.emissiveIntensity = dia;
  material.onBeforeRender = (_renderer, scene) => {
    const claridad = Math.min(1, Math.max(0, scene?.userData?.environmentDay ?? 1));
    material.emissiveIntensity = noche + (dia - noche) * claridad;
  };
  return material;
}

/** Luz pintada: de noche la pieza brilla con su propia textura, como si la alumbraran las luminarias. */
export function luzPintada(material, mapa, color, noche) {
  material.emissive.set(color); material.emissiveMap = mapa;
  return encenderDeNoche(material, noche);
}

/** Estira la textura a lo largo: `veces` repeticiones en cada cara de la caja. */
export function repetir(malla, veces) {
  const uv = malla.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * veces);
  return malla;
}

/** La tapa de la caja toma la franja más sucia de la textura: arriba nadie limpia ni repinta. */
export function ensuciarTapa(malla) {
  const uv = malla.geometry.attributes.uv;
  for (let i = 8; i < 12; i++) uv.setY(i, .03);
  return malla;
}

/** Deja en la caja solo la franja de la textura entre `v0` y `v1` (sin el zócalo sucio, por ejemplo). */
export function recortar(malla, v0, v1) {
  const uv = malla.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  return malla;
}

function caja(w, h, d, x, y, z, zona, otras = {}) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  CARAS.forEach((cara, i) => {
    const [u0, v0, u1, v1] = UV[otras[cara] ?? zona];
    for (let k = i * 4; k < i * 4 + 4; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
  });
  return g.translate(x, y, z);
}

function tubo(puntos, radio, tramos, zona) {
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntos.map(p => new THREE.Vector3(...p))), tramos, radio, 5, false), uv = g.attributes.uv;
  const [u0, v0, u1, v1] = UV[zona];
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

/** Por dónde cae cada manguera: baja por la punta del surtidor, hace la panza y sube a la pistola colgada. */
export function caidaDeManguera(x, z, lado) {
  return [[x + lado * .2, 1.9, z + .43], [x + lado * .22, 1.5, z + .455], [x + lado * .25, .95, z + .45], [x + lado * .33, .6, z + .3],
    [x + lado * .36, .5, z + .04], [x + lado * .345, .68, z - .16], [x + lado * .315, .9, z - .2]]
    .map(p => new THREE.Vector3(...p));
}

function surtidor(x, z) {
  const piezas = [
    caja(.58, .12, .9, x, .36, z, 'zocalo', { py: 'metal' }),
    caja(.5, .64, .8, x, 1.62, z, 'metal', { px: 'cara', nx: 'cara' })
  ];
  for (const lado of [-1, 1]) {
    piezas.push(caja(.05, .2, .08, x + lado * .315, .98, z - .2, 'negro'), caja(.05, .05, .2, x + lado * .315, 1.1, z - .22, 'metal'));
    const zz = z + lado * .5;
    piezas.push(tubo([[x - .24, .29, zz], [x - .24, .64, zz], [x - .17, .75, zz], [x + .17, .75, zz], [x + .24, .64, zz], [x + .24, .29, zz]], .03, 12, 'ocre'));
  }
  return piezas;
}

const fundir = (geometrias) => {
  const fundida = mergeGeometries(geometrias);
  for (const g of geometrias) g.dispose();
  return fundida;
};

/**
 * Todo lo menudo de la estación en una malla (surtidores, defensas, luminarias, puerta, aviso de precios) y la placa
 * del piso en otra, a ras del suelo y con sus charcos de luz pintados. La ciudad no las vuelve a fundir, y ninguna lleva choque.
 */
export function piezasDeGasolinera(tx = texturasDeGasolinera()) {
  return conAzarPropio(0x6a50b1e2, () => {
    const grupo = new THREE.Group(); grupo.name = 'Gasolinera: detalle'; grupo.userData.noMerge = true;
    const geometrias = [];
    for (const x of ISLAS) {
      for (let i = 0; i < 5; i++) geometrias.push(caja(1.86, .03, 2.072, x, .285, 95.856 + i * 2.072, 'concreto'));
      for (const z of SURTIDORES) geometrias.push(...surtidor(x, z));
    }
    for (const x of COLUMNAS.x) for (const z of COLUMNAS.z) geometrias.push(caja(.44, .42, .44, x, PISO + .21, z, 'concreto'));
    for (const [x, z] of LUMINARIAS) geometrias.push(caja(.95, .06, .95, x, 4.695, z, 'metal', { ny: 'luminaria' }));
    geometrias.push(caja(.98, 2.14, .05, PUERTA.x, PISO + 1.07, PUERTA.z, 'metal', { nz: 'puerta' }));
    geometrias.push(caja(AVISO_DE_PRECIOS.w, AVISO_DE_PRECIOS.h, AVISO_DE_PRECIOS.d, AVISO_DE_PRECIOS.x, AVISO_DE_PRECIOS.y, AVISO_DE_PRECIOS.z, 'metal', { nz: 'precios', pz: 'precios' }));
    const material = encenderDeNoche(new THREE.MeshStandardMaterial({ color: tx.atlas ? '#ffffff' : '#7c7f7e', map: tx.atlas,
      emissive: '#ffffff', emissiveMap: tx.atlasLuz, roughness: .8, metalness: .05 }), 1.3, .08);
    if (!tx.atlasLuz) material.emissive.set('#000000');
    material.name = 'Gasolinera: piezas';
    const malla = new THREE.Mesh(fundir(geometrias), material);
    malla.name = 'Gasolinera: piezas'; malla.castShadow = malla.receiveShadow = true;
    malla.matrixAutoUpdate = false;
    grupo.add(malla);

    const concreto = encenderDeNoche(new THREE.MeshStandardMaterial({ color: tx.placa ? '#ffffff' : '#928f87', map: tx.placa,
      emissive: tx.placaLuz ? '#ffffff' : '#000000', emissiveMap: tx.placaLuz, roughness: .94,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), .5);
    concreto.name = 'Gasolinera: placa';
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(LOTE.x1 - LOTE.x0 - .04, LOTE.z1 - LOTE.z0 - .04)
      .rotateX(-Math.PI / 2).translate((LOTE.x0 + LOTE.x1) / 2, PISO + .004, (LOTE.z0 + LOTE.z1) / 2), concreto);
    placa.name = 'Gasolinera: placa'; placa.receiveShadow = true; placa.matrixAutoUpdate = false;
    grupo.add(placa);
    return grupo;
  });
}
