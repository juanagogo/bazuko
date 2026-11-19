// src/world/bogota/carAtlas.js
// Un solo atlas para toda la flota: lentes, parrillas, rines, placas, calcomanías y tableros de ruta.
// Comparte memoria entre todos los carros; lo único por carro es a qué celda de placa apunta su material.
// Ninguna celda lleva logos ni emblemas: las placas colombianas son inventadas y las rutas también.
import * as THREE from 'three';
import { drawOptics } from './carLamps.js';
import { drawUpholstery } from './carUpholstery.js';
import { TAXI_EMPRESAS, drawTaxiCompany, drawTaxiDoor, drawTaxiRoof, drawTaxiSign } from './carLibreas.js';

// Azul de la franja de las busetas: el letrero y la textura de detalle deben dar el mismo tono.
export const BUS_BLUE = '#1b4a8c';
export const ATLAS_SIZE = 1024;
// Tres pisos: arriba lo común a toda la flota, luego las ópticas y parrillas propias de cada modelo (carLamps.js) y abajo
// el dibujo de día de los faros, que por la noche no se usa.
export const ATLAS_HEIGHT = 2416;
const DAY_FLOOR = 2048;

export const PUBLIC_PLATES = [
  { code: 'WDD 512', city: 'BOGOTÁ D.C.' },
  { code: 'VEP 384', city: 'BOGOTÁ D.C.' },
  { code: 'TLX 709', city: 'BOGOTÁ D.C.' },
  { code: 'SPO 192', city: 'SOACHA' },
  { code: 'SKM 463', city: 'BOGOTÁ D.C.' },
  { code: 'WPD 204', city: 'BOGOTÁ D.C.' },
  { code: 'STP 827', city: 'CHÍA' },
  { code: 'TET 351', city: 'BOGOTÁ D.C.' },
  { code: 'WDA 940', city: 'BOGOTÁ D.C.' },
  { code: 'UPB 628', city: 'ENVIGADO' },
  { code: 'VEE 175', city: 'BOGOTÁ D.C.' },
  { code: 'SJX 563', city: 'BOGOTÁ D.C.' },
  { code: 'WFL 837', city: 'BOGOTÁ D.C.' },
  { code: 'TMZ 286', city: 'SOACHA' },
  { code: 'VKD 619', city: 'BOGOTÁ D.C.' },
  { code: 'SXR 470', city: 'CHÍA' },
];

export const PRIVATE_PLATES = [
  { code: 'BGO 418', city: 'BOGOTÁ D.C.' },
  { code: 'CKM 890', city: 'BOGOTÁ D.C.' },
  { code: 'DKS 214', city: 'BOGOTÁ D.C.' },
  { code: 'FKB 719', city: 'BOGOTÁ D.C.' },
  { code: 'RNY 531', city: 'ENVIGADO' },
  { code: 'KLY 672', city: 'BOGOTÁ D.C.' },
  { code: 'ZNT 108', city: 'CHÍA' },
  { code: 'HWK 345', city: 'BOGOTÁ D.C.' },
  { code: 'MHO 962', city: 'MEDELLÍN' },
  { code: 'NCX 803', city: 'BOGOTÁ D.C.' },
  { code: 'JRT 256', city: 'BOGOTÁ D.C.' },
  { code: 'GXV 731', city: 'BOGOTÁ D.C.' },
  { code: 'EZK 149', city: 'BOGOTÁ D.C.' },
  { code: 'LPW 584', city: 'CHÍA' },
  { code: 'QHN 327', city: 'BOGOTÁ D.C.' },
  { code: 'BTF 690', city: 'BOGOTÁ D.C.' },
  { code: 'YKM 412', city: 'BOGOTÁ D.C.' },
  { code: 'DVZ 873', city: 'SOACHA' },
  { code: 'ICR 205', city: 'BOGOTÁ D.C.' },
  { code: 'HNJ 968', city: 'BOGOTÁ D.C.' },
  { code: 'AQL 137', city: 'MEDELLÍN' },
  { code: 'RFD 546', city: 'BOGOTÁ D.C.' },
  { code: 'CWQ 781', city: 'BOGOTÁ D.C.' },
  { code: 'KZB 604', city: 'BOGOTÁ D.C.' },
  { code: 'NGT 352', city: 'ENVIGADO' },
  { code: 'ODX 924', city: 'BOGOTÁ D.C.' },
  { code: 'MJL 163', city: 'BOGOTÁ D.C.' },
  { code: 'FVR 478', city: 'CHÍA' },
  { code: 'PBK 806', city: 'BOGOTÁ D.C.' },
  { code: 'ZRJ 239', city: 'BOGOTÁ D.C.' },
  { code: 'GLD 657', city: 'BOGOTÁ D.C.' },
  { code: 'XNE 391', city: 'SOACHA' },
  { code: 'BJZ 742', city: 'BOGOTÁ D.C.' },
  { code: 'EQT 518', city: 'BOGOTÁ D.C.' },
  { code: 'LDY 284', city: 'BOGOTÁ D.C.' },
  { code: 'RKP 935', city: 'CHÍA' },
  { code: 'CJV 176', city: 'BOGOTÁ D.C.' },
  { code: 'JWD 603', city: 'BOGOTÁ D.C.' },
  { code: 'KFX 836', city: 'BOGOTÁ D.C.' },
  { code: 'YTB 449', city: 'ENVIGADO' },
  { code: 'DMR 571', city: 'BOGOTÁ D.C.' },
  { code: 'NZQ 768', city: 'BOGOTÁ D.C.' },
  { code: 'HBE 125', city: 'BOGOTÁ D.C.' },
  { code: 'ACW 896', city: 'BOGOTÁ D.C.' },
  { code: 'GTN 330', city: 'MEDELLÍN' },
  { code: 'PXF 457', city: 'BOGOTÁ D.C.' },
  { code: 'MRZ 681', city: 'BOGOTÁ D.C.' },
  { code: 'OLG 219', city: 'CHÍA' },
];

// Celdas de placa: 16 columnas × 4 filas de 64×32. Las públicas van en las columnas y filas pares, a 128×64 entre sí:
// la calcomanía de puerta y la placa del techo de los taxis son rejillas paralelas de 128×64, así el mismo
// desplazamiento sirve para las tres. Las particulares llenan las demás celdas.
const CELL_W = 64, CELL_H = 32, STEP_W = 128, STEP_H = 64;
const DOOR_Y = 192, ROOF_Y = 256 + 64; // dos filas por rejilla paralela
const PUBLIC_CELLS = PUBLIC_PLATES.map((_, i) => [(i % 8) * STEP_W, Math.floor(i / 8) * STEP_H]);
const PRIVATE_CELLS = [];
for (let row = 0; row < 4; row++) for (let col = 0; col < 16; col++) if (col % 2 || row % 2) PRIVATE_CELLS.push([col * CELL_W, row * CELL_H]);
export const plateCell = (kind, index) => kind === 'carro' ? PRIVATE_CELLS[index % PRIVATE_CELLS.length] : PUBLIC_CELLS[index % PUBLIC_CELLS.length];

// Rectángulos del atlas en píxeles, desde arriba a la izquierda. Son datos puros: la geometría los usa también en Node.
export const RECT = Object.freeze({
  plate: [0, 0, CELL_W, CELL_H],
  door: [0, DOOR_Y, STEP_W, STEP_H],
  roof: [0, ROOF_Y, STEP_W, STEP_H],
  sign: [0, 448, 128, 64],
  police: [128, 448, 512, 128],
  white: [644, 452, 24, 24],
  headFlecha: [0, 576, 256, 128],
  headAncho: [256, 576, 256, 128],
  headFino: [512, 576, 256, 128],
  headRect: [768, 576, 256, 128],
  headRedondo: [768, 448, 128, 128],
  headCuadrado: [896, 448, 128, 128],
  headBloque: [320, 896, 256, 128],
  headGota: [0, 960, 256, 64],
  headPrisma: [896, 896, 128, 128],
  amber: [0, 704, 64, 64],
  white2: [64, 704, 64, 64],
  tailRojo: [128, 704, 128, 64],
  tailBarras: [256, 704, 128, 64],
  tailAro: [384, 704, 128, 64],
  fog: [512, 704, 64, 64],
  grilleLamas: [576, 704, 224, 64],
  grilleMalla: [800, 704, 224, 64],
  rimAleacion: [0, 768, 128, 128],
  rimRadios: [128, 768, 128, 128],
  rimTapa: [256, 768, 128, 128],
  rimAcero: [384, 768, 128, 128],
  rimBuseta: [512, 768, 128, 128],
  route0: [640, 768, 256, 64],
  route1: [640, 832, 256, 64],
  route2: [640, 896, 256, 64],
  route3: [640, 960, 256, 64],
  sticker: [896, 768, 128, 128],
  seat: [0, 896, 64, 64],
  busName: [64, 904, 256, 56],
  // Entre la rejilla de placas y la de puertas de los taxis.
  taxiEmpresa0: [0, 128, 256, 64],
  taxiEmpresa1: [256, 128, 256, 64],
  grilleClasica: [520, 132, 112, 56],
  seatVinilo: [840, 132, 80, 56],
  seatPopular: [932, 132, 84, 56],
  seatClasico: [676, 454, 84, 116],
});

// Dibujo de día de los faros de carLamps.js que no salen de una óptica: a la misma X que su celda, para que baste bajar la V.
const DAY_HEADS = new Map([
  [RECT.headRect, [768, 2160, 256, 128]], [RECT.headFino, [512, 2272, 256, 128]],
  [RECT.headRedondo, [768, 2288, 128, 128]], [RECT.headCuadrado, [896, 2288, 128, 128]],
]);
export const dayHeadRect = rect => DAY_HEADS.get(rect) ?? null;
/** Cuánto baja la V desde la celda de la luz hasta su dibujo de día. */
export const dayDrop = (rect, day) => day ? (day[1] - rect[1]) / ATLAS_HEIGHT : 0;

/** Convierte una fracción (u, v) dentro de un rectángulo del atlas en UV de textura. */
export function rectUv(rect, u, v) {
  const [x, y, w, h] = rect, inset = .6;
  return [(x + inset + u * (w - inset * 2)) / ATLAS_SIZE, 1 - (y + inset + v * (h - inset * 2)) / ATLAS_HEIGHT];
}

// ===== Dibujo =====

function drawPlate(ctx, x, y, plate, isPublic) {
  const w = CELL_W, h = CELL_H;
  const film = ctx.createLinearGradient(0, y, 0, y + h);
  film.addColorStop(0, isPublic ? '#bec1bc' : '#c9921b');
  film.addColorStop(.24, isPublic ? '#f8f9f1' : '#f8c834');
  film.addColorStop(.74, isPublic ? '#eeeee8' : '#ecc031');
  film.addColorStop(1, isPublic ? '#aaada6' : '#a87c21');
  ctx.fillStyle = film;
  ctx.fillRect(x, y, w, h);
  ctx.beginPath(); ctx.roundRect(x + 2, y + 2, w - 4, h - 4, 2);
  ctx.strokeStyle = '#25231c'; ctx.lineWidth = 1.4; ctx.stroke();
  // Cabezas de los tornillos y un canto metálico de la placa estampada.
  ctx.fillStyle = '#555148';
  for (const u of [w * .23, w * .77]) {
    ctx.fillRect(x + u - 1.25, y + 4, 2.5, 1.5);
    ctx.fillRect(x + u - 1.25, y + h - 5.5, 2.5, 1.5);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 17px "Arial Narrow", "Arial Black", Impact, sans-serif';
  const code = plate.code.replace(' ', '·');
  ctx.fillStyle = 'rgba(255,250,225,.52)'; ctx.fillText(code, x + w / 2 + .45, y + 15.1, w - 8);
  ctx.fillStyle = '#15140f'; ctx.fillText(code, x + w / 2, y + 14.5, w - 8);
  ctx.font = '900 5.5px Arial, sans-serif';
  ctx.fillText(plate.city, x + w / 2, y + 26);
}

/** Farola de vidrio prensado y cerco de acero, compartida por las UV planas y circulares. */
function drawRoundHead(ctx, [x, y, w, h], lit) {
  const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * .46, glass = r * .84;
  const circle = radius => { ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); };
  const gradient = (radius, stops) => {
    const g = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
    for (const [at, color] of stops) g.addColorStop(at, color);
    return g;
  };
  ctx.save();
  ctx.fillStyle = '#1d1f20'; ctx.fillRect(x, y, w, h);
  const steel = gradient(r, [[0, '#62686c'], [.13, '#cdd2d1'], [.45, '#656b6d'], [.64, '#343738'], [1, '#9d9d93']]);
  circle(r); ctx.fillStyle = steel; ctx.fill();
  circle(r * .9); ctx.fillStyle = '#333534'; ctx.fill();
  circle(glass); ctx.clip();
  const bowl = ctx.createRadialGradient(cx - r * .15, cy + r * .11, 0, cx, cy, glass);
  bowl.addColorStop(0, lit ? '#fffcf0' : '#b6b9af');
  bowl.addColorStop(.47, lit ? '#e5e0c8' : '#878b84');
  bowl.addColorStop(.8, lit ? '#a2a093' : '#535957');
  bowl.addColorStop(1, '#363837');
  ctx.fillStyle = bowl; ctx.fillRect(cx - glass, cy - glass, glass * 2, glass * 2);
  // Nervaduras del vidrio y dos bandas más anchas donde cambia el tallado del prisma.
  ctx.strokeStyle = lit ? 'rgba(71,69,54,.24)' : 'rgba(23,27,25,.18)';
  ctx.lineWidth = 1.4; ctx.beginPath();
  for (let k = -4; k <= 4; k++) {
    const u = cx + k * glass * .22;
    ctx.moveTo(u, cy - glass); ctx.lineTo(u, cy + glass);
  }
  for (const v of [-.47, -.12, .15, .55]) {
    ctx.moveTo(cx - glass, cy + v * glass); ctx.lineTo(cx + glass, cy + v * glass);
  }
  ctx.stroke();
  const dust = gradient(glass, [[0, 'rgba(111,93,65,0)'], [.65, 'rgba(111,93,65,0)'], [1, 'rgba(111,93,65,.38)']]);
  ctx.fillStyle = dust; ctx.fillRect(cx - glass, cy - glass, glass * 2, glass * 2);
  ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, r * .055);
  ctx.strokeStyle = 'rgba(255,255,255,.93)'; ctx.beginPath();
  ctx.moveTo(cx - r * .55, cy - r * .39);
  ctx.quadraticCurveTo(cx - r * .34, cy - r * .5, cx + r * .03, cy - r * .52);
  ctx.stroke();
  ctx.restore();
}

/** Salida del reflector rectangular encendido, en sRGB de la celda. El cerco queda a oscuras y el filamento alcanza blanco. */
export function rectHeadLevel(u, v) {
  const rim = Math.max(0, Math.min(1, (u - .035) / .035, (.965 - u) / .035, (v - .075) / .075, (.925 - v) / .075));
  const core = Math.exp(-(((u - .44) / .26) ** 2 + ((v - .53) / .29) ** 2));
  const lower = Math.exp(-(((u - .52) / .42) ** 2 + ((v - .74) / .09) ** 2));
  const bowl = Math.min(1, .25 + .85 * core + .18 * lower);
  return .055 + (bowl - .055) * rim;
}

function drawRectHeadOn(ctx, x, y, w, h) {
  const flutes = 24;
  ctx.save();
  for (let i = 0; i < flutes; i++) {
    const u = (i + .5) / flutes, prism = i % 3 === 0 ? .88 : 1;
    const pane = ctx.createLinearGradient(0, y, 0, y + h);
    for (const v of [0, .075, .15, .3, .44, .53, .64, .74, .85, .925, 1]) {
      const light = rectHeadLevel(u, v) * prism, value = Math.round(light * 255);
      pane.addColorStop(v, `rgb(${value},${Math.round(value * .99)},${Math.round(value * .95)})`);
    }
    const x0 = Math.round(i * w / flutes), x1 = Math.round((i + 1) * w / flutes);
    ctx.fillStyle = pane; ctx.fillRect(x + x0, y, x1 - x0, h);
  }
  // Dos cambios de talla del vidrio en la mitad exterior. El ámbar tiene su propia pieza y su propio canal.
  ctx.strokeStyle = 'rgba(40,43,46,.38)'; ctx.lineWidth = Math.max(1, h * .024);
  for (const v of [.34, .70]) {
    ctx.beginPath(); ctx.moveTo(x + w * .61, y + h * v); ctx.lineTo(x + w * .93, y + h * v); ctx.stroke();
  }
  ctx.restore();
}

function drawHead(ctx, [x, y, w, h], style) {
  if (style === 'redondo') { drawRoundHead(ctx, [x, y, w, h], true); return; }
  if (style === 'rect') { drawRectHeadOn(ctx, x, y, w, h); return; }
  ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  // Carcasa oscura: el vidrio del faro deja ver el fondo, no una pieza pintada de blanco.
  const back = ctx.createLinearGradient(0, 0, 0, h);
  back.addColorStop(0, '#3a3e42'); back.addColorStop(.5, '#1d2023'); back.addColorStop(1, '#2d3134');
  ctx.fillStyle = back; ctx.fillRect(0, 0, w, h);
  const bowl = (cx, cy, rx, ry, bright = 1) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, '#ffffff'); g.addColorStop(.28, `rgb(${232 * bright},${236 * bright},${240 * bright})`);
    g.addColorStop(.62, `rgb(${150 * bright},${158 * bright},${166 * bright})`); g.addColorStop(1, '#2a2d30');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,22,25,.85)'; ctx.lineWidth = Math.max(1, w / 110); ctx.stroke();
  };
  const lens = (cx, cy, r) => {
    const g = ctx.createRadialGradient(cx - r * .3, cy - r * .3, r * .1, cx, cy, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.5, '#dfe9f2'); g.addColorStop(1, '#61707c');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#15171a'; ctx.lineWidth = 2; ctx.stroke();
  };
  if (style === 'flecha') {
    // Faro en flecha: dos cuencos a la izquierda (lado del centro) y cola fina hacia atrás.
    bowl(w * .2, h * .56, w * .17, h * .36); bowl(w * .46, h * .46, w * .13, h * .3, .96);
    lens(w * .2, h * .56, h * .17);
    ctx.fillStyle = '#c8ccd0'; ctx.fillRect(w * .62, h * .34, w * .36, h * .16);
    ctx.fillStyle = '#d6862c'; ctx.fillRect(w * .62, h * .54, w * .36, h * .22);
  } else if (style === 'ancho') {
    bowl(w * .27, h * .5, w * .22, h * .42); bowl(w * .68, h * .5, w * .19, h * .4, .95);
    lens(w * .27, h * .5, h * .18);
    ctx.fillStyle = 'rgba(214,134,44,.95)'; ctx.fillRect(w * .89, h * .14, w * .09, h * .72);
  } else if (style === 'fino') {
    ctx.fillStyle = '#121416'; ctx.fillRect(0, 0, w, h);
    bowl(w * .24, h * .56, w * .16, h * .36); lens(w * .24, h * .56, h * .18);
    bowl(w * .52, h * .56, w * .1, h * .28, .9);
    // Tira diurna que corre por encima de la óptica.
    const led = ctx.createLinearGradient(0, 0, w, 0);
    led.addColorStop(0, '#f6f8ff'); led.addColorStop(1, '#bfc6cf');
    ctx.fillStyle = led; ctx.fillRect(w * .04, h * .1, w * .94, h * .12);
  } else if (style === 'bloque') {
    // Una sola óptica grande y cuadrada, sin adornos: reflector plateado, un cuenco y direccional al final.
    const silver = ctx.createLinearGradient(0, h * .1, 0, h * .9);
    silver.addColorStop(0, '#8f969d'); silver.addColorStop(.45, '#dfe3e6'); silver.addColorStop(1, '#6f757b');
    ctx.fillStyle = silver; ctx.fillRect(w * .03, h * .1, w * .8, h * .8);
    bowl(w * .34, h * .5, w * .25, h * .4); lens(w * .34, h * .5, h * .15);
    ctx.fillStyle = 'rgba(60,66,72,.35)';
    for (let i = 0; i < 3; i++) ctx.fillRect(w * (.64 + i * .06), h * .1, w * .012, h * .8);
    ctx.fillStyle = '#d6862c'; ctx.fillRect(w * .85, h * .16, w * .13, h * .68);
  } else if (style === 'gota') {
    // Un solo ojo redondo cerca de la parrilla; detrás el reflector se afina hacia el guardabarro.
    const silver = ctx.createLinearGradient(0, 0, w, 0);
    silver.addColorStop(0, '#6d7379'); silver.addColorStop(.5, '#cfd4d8'); silver.addColorStop(1, '#858b91');
    ctx.fillStyle = silver;
    ctx.beginPath(); ctx.moveTo(w * .36, h * .1); ctx.lineTo(w * .97, h * .1); ctx.lineTo(w * .97, h * .44); ctx.lineTo(w * .36, h * .6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d6862c';
    ctx.beginPath(); ctx.moveTo(w * .62, h * .62); ctx.lineTo(w * .97, h * .52); ctx.lineTo(w * .97, h * .78); ctx.lineTo(w * .66, h * .86); ctx.closePath(); ctx.fill();
    bowl(w * .2, h * .5, w * .17, h * .46); lens(w * .2, h * .5, h * .27);
  } else if (style === 'prisma') {
    // Faro alto de carga: dos cuencos angostos sobre reflector plateado y una tira de direccional abajo.
    const silver = ctx.createLinearGradient(0, h * .06, 0, h * .66);
    silver.addColorStop(0, '#7f858b'); silver.addColorStop(.5, '#d9dde0'); silver.addColorStop(1, '#73797f');
    ctx.fillStyle = silver; ctx.fillRect(w * .04, h * .06, w * .92, h * .6);
    bowl(w * .29, h * .36, w * .22, h * .27); bowl(w * .72, h * .36, w * .19, h * .24, .94);
    lens(w * .29, h * .36, h * .12);
    ctx.fillStyle = '#d6862c'; ctx.fillRect(w * .04, h * .72, w * .92, h * .2);
  } else if (style === 'cuadrado') {
    ctx.fillStyle = '#d8dce0'; ctx.fillRect(w * .05, h * .08, w * .9, h * .84);
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * .4);
    g.addColorStop(0, '#fff'); g.addColorStop(.6, '#e9ecef'); g.addColorStop(1, '#8e969e');
    ctx.fillStyle = g; ctx.fillRect(w * .05, h * .08, w * .9, h * .84);
    ctx.strokeStyle = 'rgba(70,78,88,.35)'; ctx.lineWidth = 1.5;
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(w * (.05 + i * .11), h * .08); ctx.lineTo(w * (.05 + i * .11), h * .92); ctx.stroke(); }
  }
  // Brillo del vidrio exterior.
  const gloss = ctx.createLinearGradient(0, 0, 0, h * .5);
  gloss.addColorStop(0, 'rgba(255,255,255,.16)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(0, 0, w, h * .5);
  ctx.restore();
}

/**
 * El mismo faro apagado: de día lo que se ve es el vidrio sobre un reflector oscuro, con el tajo de sol encima. El de `drawHead` da
 * solo la luz. Únicamente las lentes viejas, en vidrio tallado (`rect` y `redondo`), dejan adivinar su cuadrícula.
 */
export function drawHeadDay(ctx, [x, y, w, h], style) {
  if (style === 'redondo') { drawRoundHead(ctx, [x, y, w, h], false); return; }
  ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  const back = ctx.createLinearGradient(0, 0, 0, h);
  back.addColorStop(0, '#0d0f11'); back.addColorStop(.45, '#24282c'); back.addColorStop(.85, '#3d4248'); back.addColorStop(1, '#17191c');
  ctx.fillStyle = back; ctx.fillRect(0, 0, w, h);
  const carve = (x0, y0, x1, y1, columns, rows, ink = 'rgba(214,224,234,.09)') => {
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    for (let i = 1; i < columns; i++) { const px = x0 + (x1 - x0) * i / columns; ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke(); }
    for (let i = 1; i < rows; i++) { const py = y0 + (y1 - y0) * i / rows; ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke(); }
  };
  const bulb = (cx, cy, r) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(150,158,166,.6)'); g.addColorStop(.5, 'rgba(92,99,106,.28)'); g.addColorStop(1, 'rgba(20,22,25,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  };
  const glint = (x0, y0, x1, y1, width) => {
    ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  };
  if (style === 'rect') {
    // Reflector plateado en todo el rectángulo, como el del faro en bloque, con el cuenco y el vidrio tallado encima.
    const silver = ctx.createLinearGradient(0, h * .08, 0, h * .92);
    silver.addColorStop(0, '#8f969d'); silver.addColorStop(.45, '#dfe3e6'); silver.addColorStop(1, '#6f757b');
    ctx.fillStyle = silver; ctx.fillRect(w * .03, h * .08, w * .94, h * .84);
    const bowl = ctx.createRadialGradient(w * .42, h * .52, 2, w * .42, h * .52, w * .26);
    bowl.addColorStop(0, '#eef0f1'); bowl.addColorStop(.35, '#aab0b6'); bowl.addColorStop(.8, '#61676e'); bowl.addColorStop(1, 'rgba(97,103,110,0)');
    ctx.fillStyle = bowl; ctx.beginPath(); ctx.ellipse(w * .42, h * .52, w * .26, h * .4, 0, 0, Math.PI * 2); ctx.fill();
    bulb(w * .42, h * .55, w * .08);
    carve(w * .03, h * .08, w * .97, h * .92, 12, 4, 'rgba(52,58,64,.18)');
    const grime = ctx.createLinearGradient(0, h * .55, 0, h * .92);
    grime.addColorStop(0, 'rgba(72,64,52,0)'); grime.addColorStop(1, 'rgba(72,64,52,.3)');
    ctx.fillStyle = grime; ctx.fillRect(w * .03, h * .55, w * .94, h * .37);
    ctx.strokeStyle = '#1d2023'; ctx.lineWidth = 3; ctx.strokeRect(w * .03, h * .08, w * .94, h * .84);
    glint(w * .12, h * .26, w * .34, h * .2, 3.5);
  } else if (style === 'cuadrado') {
    bulb(w / 2, h * .55, w * .42);
    glint(w * .2, h * .22, w * .46, h * .16, 4);
  } else if (style === 'fino') {
    ctx.fillStyle = '#0c0d0f'; ctx.fillRect(0, 0, w, h);
    bulb(w * .24, h * .56, w * .16); bulb(w * .52, h * .56, w * .1);
    ctx.fillStyle = '#6b727a'; ctx.fillRect(w * .04, h * .1, w * .94, h * .12);
    glint(w * .14, h * .4, w * .28, h * .36, 3);
  }
  ctx.restore();
}

function drawTail(ctx, [x, y, w, h], style) {
  ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#a51712'); g.addColorStop(.5, '#7c0e0c'); g.addColorStop(1, '#9c1411');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (style === 'barras') {
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,60,40,.5)' : 'rgba(40,0,0,.35)'; ctx.fillRect(0, h * i / 5, w, h / 5 - 1); }
  } else if (style === 'aro') {
    for (const cx of [w * .28, w * .72]) {
      const r = h * .4, a = ctx.createRadialGradient(cx, h / 2, r * .25, cx, h / 2, r);
      a.addColorStop(0, '#6e0c0a'); a.addColorStop(.55, '#ff3a26'); a.addColorStop(1, '#6e0c0a');
      ctx.fillStyle = a; ctx.beginPath(); ctx.arc(cx, h / 2, r, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.strokeStyle = 'rgba(40,0,0,.4)'; ctx.lineWidth = 1;
    for (let i = 4; i < w; i += 7) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
    for (let i = 4; i < h; i += 7) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    const c = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * .4);
    c.addColorStop(0, 'rgba(255,90,70,.75)'); c.addColorStop(1, 'rgba(255,90,70,0)');
    ctx.fillStyle = c; ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** Direccional en dos tonos dentro de su marco: arriba el ámbar claro del reflector, abajo el del vidrio. */
function drawTurn(ctx, [x, y, w, h]) {
  ctx.fillStyle = '#2b2622'; ctx.fillRect(x, y, w, h);
  const amber = ctx.createLinearGradient(0, y + 4, 0, y + h - 4);
  amber.addColorStop(0, '#f2a64a'); amber.addColorStop(.42, '#f2a64a'); amber.addColorStop(.58, '#d27a1c'); amber.addColorStop(1, '#d27a1c');
  ctx.fillStyle = amber; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  ctx.fillStyle = 'rgba(140,70,10,.4)';
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 4, y + 4 + (h - 8) * (i + .5) / 3 - 1.5, w - 8, 3);
}

function drawRibbed(ctx, [x, y, w, h], light, dark) {
  ctx.fillStyle = light; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = dark;
  // Pocas estrías y anchas: las finas se volvían un tramado de puntos a pocos metros.
  for (let i = 0; i < 3; i++) ctx.fillRect(x, y + h * (i + .5) / 3 - 2, w, 4);
}

function drawGrille(ctx, [x, y, w, h], style) {
  ctx.fillStyle = '#0c0d0f'; ctx.fillRect(x, y, w, h);
  if (style === 'lamas') {
    for (let i = 0; i < 6; i++) {
      const gy = y + 3 + i * (h - 6) / 6;
      const g = ctx.createLinearGradient(0, gy, 0, gy + 7);
      g.addColorStop(0, '#5b6066'); g.addColorStop(1, '#16181b');
      ctx.fillStyle = g; ctx.fillRect(x + 2, gy, w - 4, 6);
    }
  } else {
    ctx.fillStyle = '#2b2e32';
    for (let row = 0; row < 7; row++) for (let col = 0; col < 27; col++) {
      const cx = x + 4 + col * 8.2 + (row % 2) * 4, cy = y + 5 + row * 8.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 3.2); ctx.lineTo(cx + 3.2, cy); ctx.lineTo(cx, cy + 3.2); ctx.lineTo(cx - 3.2, cy); ctx.closePath(); ctx.fill();
    }
  }
}

function drawClassicGrille(ctx, [x, y, w, h]) {
  const metal = ctx.createLinearGradient(0, y, 0, y + h);
  metal.addColorStop(0, '#515453'); metal.addColorStop(.08, '#d3d0bd');
  metal.addColorStop(.43, '#929489'); metal.addColorStop(.67, '#b0af9b'); metal.addColorStop(1, '#4f524e');
  ctx.fillStyle = metal; ctx.fillRect(x, y, w, h);
  // Huecos en la lámina de aluminio. El borde inferior recibe cielo y el fondo queda oscuro.
  for (let row = 0; row < 3; row++) {
    const yy = y + 6 + row * 15;
    const hole = ctx.createLinearGradient(0, yy, 0, yy + 12);
    hole.addColorStop(0, '#141617'); hole.addColorStop(.71, '#252828'); hole.addColorStop(1, '#4b4d49');
    for (let col = 0; col < 7; col++) {
      const xx = x + 4 + col * 15;
      ctx.fillStyle = '#b9b8a7';
      ctx.fillRect(xx + 1, yy + 10, 12, 2);
      ctx.fillStyle = hole;
      ctx.beginPath(); ctx.roundRect(xx, yy, 13, 10.5, 1.7); ctx.fill();
    }
  }
  ctx.strokeStyle = '#444644'; ctx.lineWidth = 1.2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawRim(ctx, [x, y, w, h], style) {
  const cx = x + w / 2, cy = y + h / 2, R = w / 2;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(x, y, w, h);
  const metal = (r0, r1) => {
    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, '#dfe2e5'); g.addColorStop(.5, '#b2b7bc'); g.addColorStop(1, '#868c92');
    return g;
  };
  if (style === 'aleacion' || style === 'radios') {
    // Disco de freno oscuro detrás de los rayos: la profundidad la da el contraste.
    const d = ctx.createRadialGradient(cx, cy, R * .2, cx, cy, R * .78);
    d.addColorStop(0, '#2c2e31'); d.addColorStop(.75, '#34363a'); d.addColorStop(1, '#101114');
    ctx.fillStyle = d; ctx.beginPath(); ctx.arc(cx, cy, R * .92, 0, Math.PI * 2); ctx.fill();
    const n = style === 'aleacion' ? 5 : 7;
    ctx.fillStyle = metal(R * .1, R);
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n - Math.PI / 2;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      const half = style === 'aleacion' ? .13 : .085;
      ctx.beginPath();
      ctx.moveTo(R * .16, -R * half * 1.3); ctx.lineTo(R * .9, -R * half * .8); ctx.lineTo(R * .9, R * half * .8); ctx.lineTo(R * .16, R * half * 1.3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = '#9ca1a7'; ctx.lineWidth = R * .1; ctx.beginPath(); ctx.arc(cx, cy, R * .92, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = metal(0, R * .26); ctx.beginPath(); ctx.arc(cx, cy, R * .25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#26282b'; ctx.beginPath(); ctx.arc(cx, cy, R * .12, 0, Math.PI * 2); ctx.fill();
  } else if (style === 'tapa') {
    // Tapa abombada de plástico plateado, con ocho huecos curvos que dejan entrever el rin de acero.
    const silver = ctx.createRadialGradient(cx, cy, R * .07, cx, cy, R);
    for (const [t, tone] of [[0, '#a9adae'], [.37, '#b9bcbb'], [.44, '#878d8e'], [.52, '#c3c7c7'], [.82, '#a9afb0'], [.88, '#757c7e'], [.95, '#c4c7c6'], [1, '#6e7375']]) silver.addColorStop(t, tone);
    ctx.fillStyle = silver; ctx.beginPath(); ctx.arc(cx, cy, R * .99, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(R * .47, -R * .052);
      ctx.quadraticCurveTo(R * .53, -R * .15, R * .77, -R * .16);
      ctx.quadraticCurveTo(R * .86, -R * .135, R * .835, R * .115);
      ctx.quadraticCurveTo(R * .81, R * .18, R * .73, R * .14);
      ctx.quadraticCurveTo(R * .61, R * .07, R * .49, R * .07); ctx.closePath();
      ctx.strokeStyle = '#777e80'; ctx.lineWidth = R * .056; ctx.stroke();
      ctx.fillStyle = '#26292a'; ctx.fill();
      ctx.strokeStyle = '#54595a'; ctx.lineWidth = R * .026;
      ctx.beginPath(); ctx.moveTo(R * .55, -R * .095); ctx.quadraticCurveTo(R * .64, -R * .12, R * .77, -R * .12); ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < 4; i++) {
      const a = (i + .5) * Math.PI / 2, bx = cx + R * .29 * Math.cos(a), by = cy + R * .29 * Math.sin(a);
      ctx.fillStyle = '#606567'; ctx.beginPath(); ctx.arc(bx, by, R * .08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b6b9b8'; ctx.beginPath();
      for (let k = 0; k < 6; k++) { const face = k * Math.PI / 3, px = bx + R * .052 * Math.cos(face), py = by + R * .052 * Math.sin(face); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#777d7f'; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.arc(cx, cy, R * .17, 0, Math.PI * 2); ctx.stroke();
  } else if (style === 'acero') {
    // Copa de acero pintada, con perforaciones y copita central.
    const g = ctx.createRadialGradient(cx, cy, R * .1, cx, cy, R);
    g.addColorStop(0, '#6d7176'); g.addColorStop(.7, '#55595e'); g.addColorStop(1, '#2f3236');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * .98, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0c0d0f';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI * 2 / 8;
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * R * .66, cy + Math.sin(a) * R * .66, R * .105, R * .085, a, 0, Math.PI * 2); ctx.fill();
    }
    const cap = ctx.createRadialGradient(cx - R * .08, cy - R * .08, 1, cx, cy, R * .36);
    cap.addColorStop(0, '#fbfbfb'); cap.addColorStop(.6, '#c7ccd1'); cap.addColorStop(1, '#6e7378');
    ctx.fillStyle = cap; ctx.beginPath(); ctx.arc(cx, cy, R * .36, 0, Math.PI * 2); ctx.fill();
  } else {
    // Rin de buseta: disco pesado con tuercas.
    ctx.fillStyle = '#7e8387'; ctx.beginPath(); ctx.arc(cx, cy, R * .98, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#16181b';
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * R * .68, cy + Math.sin(a) * R * .68, R * .11, R * .08, a, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#3b3e42'; ctx.beginPath(); ctx.arc(cx, cy, R * .4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c9cdd1';
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * .3, cy + Math.sin(a) * R * .3, R * .035, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

// Rutas inventadas: el tablero se lee como de buseta bogotana sin citar ninguna empresa real.
const ROUTES = [
  { num: '14-2', dest: 'CRA 10 · SOACHA', via: 'SAN MATEO · BOSA', bg: '#1b5e20', numBg: '#fbc02d' },
  { num: '314', dest: 'CL 80 · ENGATIVÁ', via: 'VÍA CORINTO · MINUTO', bg: '#0d47a1', numBg: '#d32f2f' },
  { num: 'E25', dest: 'SUBA · CENTRO', via: 'CALLE 100 · CRA 7MA', bg: '#b71c1c', numBg: '#ffffff' },
  { num: '496', dest: 'FONTIBÓN · CL 26', via: 'SALITRE · GERMANIA', bg: '#e65100', numBg: '#81c784' },
];

function drawRoute(ctx, [x, y, w, h], r) {
  ctx.fillStyle = '#111417'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = r.numBg; ctx.fillRect(x + 3, y + 3, 54, h - 6);
  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 21px sans-serif'; ctx.fillText(r.num, x + 30, y + h / 2);
  ctx.fillStyle = r.bg; ctx.fillRect(x + 60, y + 3, w - 63, 30);
  ctx.fillStyle = '#fff'; ctx.font = '900 16px sans-serif'; ctx.fillText(r.dest, x + 60 + (w - 63) / 2, y + 18);
  ctx.fillStyle = '#f5f5f5'; ctx.fillRect(x + 60, y + 36, w - 63, h - 39);
  ctx.fillStyle = '#1e1e1e'; ctx.font = '800 13px sans-serif'; ctx.fillText(r.via, x + 60 + (w - 63) / 2, y + 36 + (h - 39) / 2);
}

export function drawAtlas(ctx) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_HEIGHT);
  // Faros de día sobre fondo oscuro: un fondo blanco se colaría en los mipmaps y los aclararía de lejos.
  ctx.fillStyle = '#16181b'; ctx.fillRect(0, DAY_FLOOR, ATLAS_SIZE, ATLAS_HEIGHT - DAY_FLOOR);
  PUBLIC_PLATES.forEach((plate, i) => {
    const [x, y] = PUBLIC_CELLS[i];
    drawPlate(ctx, x, y, plate, true);
    drawTaxiDoor(ctx, [x, y + DOOR_Y, STEP_W, STEP_H], plate, i);
    drawTaxiRoof(ctx, [x, y + ROOF_Y, STEP_W, STEP_H], plate, i);
  });
  PRIVATE_PLATES.forEach((plate, i) => drawPlate(ctx, ...PRIVATE_CELLS[i], plate, false));
  // Capacete de taxi y rótulos de empresa de las puertas.
  drawTaxiSign(ctx, RECT.sign);
  drawTaxiCompany(ctx, RECT.taxiEmpresa0, TAXI_EMPRESAS[0], 0); drawTaxiCompany(ctx, RECT.taxiEmpresa1, TAXI_EMPRESAS[1], 1);
  // Franja de patrulla.
  const [px, py, pw, ph] = RECT.police;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0b5c2e'; ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = '#ffd100'; ctx.fillRect(px, py, pw, 6); ctx.fillRect(px, py + ph - 6, pw, 6);
  ctx.fillStyle = '#fff'; ctx.font = '900 46px "Arial Black", Arial, sans-serif';
  ctx.fillText('POLICÍA', px + pw / 2, py + 48);
  ctx.font = '800 19px "Arial Black", Arial, sans-serif';
  ctx.fillText('NACIONAL · DIOS Y PATRIA', px + pw / 2, py + 92);
  ctx.font = '900 26px sans-serif'; ctx.fillText('CAI', px + 60, py + ph / 2);
  ctx.font = '800 22px sans-serif'; ctx.fillText('123', px + pw - 60, py + ph / 2);
  // Ópticas.
  drawHead(ctx, RECT.headFlecha, 'flecha'); drawHead(ctx, RECT.headAncho, 'ancho');
  drawHead(ctx, RECT.headFino, 'fino'); drawHead(ctx, RECT.headRect, 'rect');
  drawHead(ctx, RECT.headRedondo, 'redondo'); drawHead(ctx, RECT.headCuadrado, 'cuadrado');
  drawHead(ctx, RECT.headBloque, 'bloque'); drawHead(ctx, RECT.headGota, 'gota'); drawHead(ctx, RECT.headPrisma, 'prisma');
  drawHeadDay(ctx, dayHeadRect(RECT.headRect), 'rect'); drawHeadDay(ctx, dayHeadRect(RECT.headFino), 'fino');
  drawHeadDay(ctx, dayHeadRect(RECT.headRedondo), 'redondo'); drawHeadDay(ctx, dayHeadRect(RECT.headCuadrado), 'cuadrado');
  drawTurn(ctx, RECT.amber);
  drawRibbed(ctx, RECT.white2, '#e3e6e8', 'rgba(120,125,132,.5)');
  drawTail(ctx, RECT.tailRojo, 'rojo'); drawTail(ctx, RECT.tailBarras, 'barras'); drawTail(ctx, RECT.tailAro, 'aro');
  // Antiniebla: faro pequeño dentro de su hueco oscuro, nunca un cuadro blanco.
  const [fgx, fgy, fgw, fgh] = RECT.fog;
  ctx.fillStyle = '#0f1012'; ctx.fillRect(fgx, fgy, fgw, fgh);
  const fogLens = ctx.createRadialGradient(fgx + fgw / 2, fgy + fgh / 2, 1, fgx + fgw / 2, fgy + fgh / 2, fgw * .27);
  fogLens.addColorStop(0, '#c9ccce'); fogLens.addColorStop(.45, '#6d7175'); fogLens.addColorStop(1, '#232527');
  ctx.fillStyle = fogLens; ctx.beginPath(); ctx.arc(fgx + fgw / 2, fgy + fgh / 2, fgw * .27, 0, Math.PI * 2); ctx.fill();
  drawGrille(ctx, RECT.grilleLamas, 'lamas'); drawGrille(ctx, RECT.grilleMalla, 'malla');
  drawClassicGrille(ctx, RECT.grilleClasica);
  drawRim(ctx, RECT.rimAleacion, 'aleacion'); drawRim(ctx, RECT.rimRadios, 'radios');
  drawRim(ctx, RECT.rimTapa, 'tapa'); drawRim(ctx, RECT.rimAcero, 'acero'); drawRim(ctx, RECT.rimBuseta, 'buseta');
  // Calcomanía de taxi en el vidrio trasero y tapicerías de los particulares.
  const [kx, ky, kw, kh] = RECT.sticker;
  ctx.fillStyle = '#f2c417'; ctx.fillRect(kx, ky, kw, kh);
  ctx.fillStyle = '#111';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2) ctx.fillRect(kx + i * kw / 6, ky + j * kh / 6, kw / 6, kh / 6);
  drawUpholstery(ctx, RECT);
  drawRoute(ctx, RECT.route0, ROUTES[0]); drawRoute(ctx, RECT.route1, ROUTES[1]);
  drawRoute(ctx, RECT.route2, ROUTES[2]); drawRoute(ctx, RECT.route3, ROUTES[3]);
  // Rótulo genérico de la buseta: nombre inventado, se lee como el de una cooperativa cualquiera.
  const [nx, ny, nw, nh] = RECT.busName;
  // Sobre la franja de la buseta: del mismo azul, para que solo se lea el letrero.
  ctx.fillStyle = BUS_BLUE; ctx.fillRect(nx, ny, nw, nh);
  ctx.fillStyle = '#f4f2ea'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 21px sans-serif'; ctx.fillText('RUTAS DE LA CAPITAL', nx + nw / 2, ny + 19);
  ctx.font = '800 13px sans-serif'; ctx.fillText('SERVICIO URBANO · 19 PASAJEROS', nx + nw / 2, ny + 42);
  drawOptics(ctx);
}

let atlas = null;
/** Textura única; en Node (pruebas) queda vacía pero conserva tipo y espacio de color. */
export function getCarAtlas() {
  if (atlas) return atlas;
  if (typeof document === 'undefined') {
    atlas = new THREE.Texture();
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_SIZE; canvas.height = ATLAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (ctx) drawAtlas(ctx);
    atlas = new THREE.CanvasTexture(canvas);
    atlas.anisotropy = 4;
    atlas.generateMipmaps = true;
  }
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.name = 'Atlas de vehículos';
  return atlas;
}
