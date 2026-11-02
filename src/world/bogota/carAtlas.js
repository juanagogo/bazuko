// src/world/bogota/carAtlas.js
// Un solo atlas para toda la flota: lentes, parrillas, rines, placas, calcomanías y tableros de ruta.
// Comparte memoria entre todos los carros; lo único por carro es a qué celda de placa apunta su material.
// Ninguna celda lleva logos ni emblemas: las placas colombianas son inventadas y las rutas también.
import * as THREE from 'three';
import { drawOptics } from './carLamps.js';

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
];

// Celdas de placa: 8 columnas × 3 filas de 128×64. Públicas primero: la calcomanía de puerta y la placa del
// techo de los taxis son rejillas paralelas, así el mismo desplazamiento sirve para las tres.
const CELL_W = 128, CELL_H = 64;
const DOOR_Y = 192, ROOF_Y = 256 + 64; // dos filas por rejilla paralela
export const plateCell = (kind, index) => {
  const n = kind === 'carro' ? PUBLIC_PLATES.length + index % PRIVATE_PLATES.length : index % PUBLIC_PLATES.length;
  return [(n % 8) * CELL_W, Math.floor(n / 8) * CELL_H];
};

// Rectángulos del atlas en píxeles, desde arriba a la izquierda. Son datos puros: la geometría los usa también en Node.
export const RECT = Object.freeze({
  plate: [0, 0, CELL_W, CELL_H],
  door: [0, DOOR_Y, CELL_W, CELL_H],
  roof: [0, ROOF_Y, CELL_W, CELL_H],
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
  taxiStripe: [64, 896, 256, 8],
  busName: [64, 904, 256, 56],
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
  ctx.fillStyle = isPublic ? '#f2f2ef' : '#f3b915';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3;
  ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 29px "Arial Black", Impact, sans-serif';
  // Tope de ancho: con siete caracteres la letra gruesa se salía del marco.
  ctx.fillText(plate.code.replace(' ', '·'), x + w / 2, y + 27, w - 18);
  ctx.font = '800 10px "Arial Black", sans-serif';
  ctx.fillText(plate.city, x + w / 2, y + 52);
}

function drawDoorDecal(ctx, x, y, plate) {
  ctx.fillStyle = '#f4f4f0'; ctx.fillRect(x, y, CELL_W, CELL_H);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4);
  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 10px sans-serif'; ctx.fillText(plate.city, x + 64, y + 12);
  ctx.font = '900 25px "Arial Black", sans-serif'; ctx.fillText(plate.code, x + 64, y + 32, CELL_W - 14);
  ctx.font = '700 9px sans-serif'; ctx.fillText('SERVICIO PÚBLICO', x + 64, y + 53);
}

function drawRoofPlate(ctx, x, y, plate) {
  ctx.fillStyle = '#e4ad12'; ctx.fillRect(x, y, CELL_W, CELL_H);
  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 30px "Arial Black", sans-serif'; ctx.fillText(plate.code, x + 64, y + 33, CELL_W - 10);
}

function drawHead(ctx, [x, y, w, h], style) {
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
  } else if (style === 'rect') {
    // Todo el rectángulo es faro: el ámbar va en su propia pieza (direccional de la esquina), que sí parpadea y no brilla con los faros.
    ctx.fillStyle = '#d8dce0'; ctx.fillRect(w * .03, h * .08, w * .94, h * .84);
    for (let i = 0; i < 19; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.55)' : 'rgba(95,105,115,.45)'; ctx.fillRect(w * (.04 + i * .048), h * .08, w * .026, h * .84); }
    for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(70,78,88,.35)'; ctx.fillRect(w * .03, h * (.2 + i * .15), w * .94, h * .025); }
    const g = ctx.createRadialGradient(w * .42, h * .5, 2, w * .42, h * .5, w * .3);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  } else if (style === 'redondo') {
    // Faro redondo sobre la lámina oscura de la parrilla, no sobre un cuadro claro.
    ctx.fillStyle = '#202326'; ctx.fillRect(0, 0, w, h);
    const r = w * .46;
    const ring = ctx.createLinearGradient(0, 0, w, h);
    ring.addColorStop(0, '#f2f4f6'); ring.addColorStop(.5, '#8b9198'); ring.addColorStop(1, '#e6e8ea');
    ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, r * .88);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.35, '#f6f1df'); g.addColorStop(.8, '#b9b6a8'); g.addColorStop(1, '#7c7b72');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, h / 2, r * .88, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(70,70,62,.28)'; ctx.lineWidth = 1.5;
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * r * .25, h * .12); ctx.lineTo(w / 2 + i * r * .25, h * .88); ctx.stroke(); }
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(w * .12, h / 2 + i * r * .3); ctx.lineTo(w * .88, h / 2 + i * r * .3); ctx.stroke(); }
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
  ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  const back = ctx.createLinearGradient(0, 0, 0, h);
  back.addColorStop(0, '#0d0f11'); back.addColorStop(.45, '#24282c'); back.addColorStop(.85, '#3d4248'); back.addColorStop(1, '#17191c');
  ctx.fillStyle = back; ctx.fillRect(0, 0, w, h);
  const carve = (x0, y0, x1, y1, columns, rows) => {
    ctx.strokeStyle = 'rgba(214,224,234,.09)'; ctx.lineWidth = 1;
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
    bulb(w * .42, h * .55, w * .3);
    carve(w * .03, h * .08, w * .97, h * .92, 12, 4);
    glint(w * .12, h * .26, w * .34, h * .2, 3.5);
  } else if (style === 'redondo') {
    ctx.fillStyle = '#17191c'; ctx.fillRect(0, 0, w, h);
    const r = w * .46, ring = ctx.createLinearGradient(0, 0, w, h);
    ring.addColorStop(0, '#c8ccd1'); ring.addColorStop(.5, '#585e65'); ring.addColorStop(1, '#a4a9af');
    ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
    const glass = ctx.createRadialGradient(w / 2, h * .54, 1, w / 2, h / 2, r * .88);
    glass.addColorStop(0, '#6f767d'); glass.addColorStop(.4, '#343a40'); glass.addColorStop(1, '#0f1113');
    ctx.save(); ctx.fillStyle = glass; ctx.beginPath(); ctx.arc(w / 2, h / 2, r * .88, 0, Math.PI * 2); ctx.fill(); ctx.clip();
    carve(w * .1, h * .1, w * .9, h * .9, 6, 5);
    ctx.restore();
    glint(w * .3, h * .3, w * .46, h * .22, 4);
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
    // Tapacubos plástico: anillo plateado con ventanas radiales, centro liso sin emblema.
    ctx.fillStyle = metal(R * .3, R); ctx.beginPath(); ctx.arc(cx, cy, R * .98, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#17191c';
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(R * .44, -R * .055); ctx.lineTo(R * .82, -R * .09); ctx.lineTo(R * .82, R * .09); ctx.lineTo(R * .44, R * .055); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(70,74,80,.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, R * .35, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * .9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#c4c8cc'; ctx.beginPath(); ctx.arc(cx, cy, R * .24, 0, Math.PI * 2); ctx.fill();
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
  const publics = PUBLIC_PLATES.length;
  for (let i = 0; i < publics + PRIVATE_PLATES.length; i++) {
    const x = (i % 8) * CELL_W, y = Math.floor(i / 8) * CELL_H;
    const plate = i < publics ? PUBLIC_PLATES[i] : PRIVATE_PLATES[i - publics];
    drawPlate(ctx, x, y, plate, i < publics);
    if (i < publics) {
      drawDoorDecal(ctx, x, y + DOOR_Y, plate);
      drawRoofPlate(ctx, x, y + ROOF_Y, plate);
    }
  }
  // Capacete de taxi.
  const [sx, sy, sw, sh] = RECT.sign;
  const sign = ctx.createLinearGradient(0, sy, 0, sy + sh);
  sign.addColorStop(0, '#fff17a'); sign.addColorStop(1, '#ffd21f');
  ctx.fillStyle = sign; ctx.fillRect(sx, sy, sw, sh);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 4; ctx.strokeRect(sx + 3, sy + 3, sw - 6, sh - 6);
  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 36px "Arial Black", sans-serif'; ctx.fillText('TAXI', sx + sw / 2, sy + sh / 2 + 2);
  // Franja de patrulla.
  const [px, py, pw, ph] = RECT.police;
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
  drawRibbed(ctx, RECT.amber, '#e0872a', 'rgba(140,70,10,.55)');
  drawRibbed(ctx, RECT.white2, '#e3e6e8', 'rgba(120,125,132,.5)');
  drawTail(ctx, RECT.tailRojo, 'rojo'); drawTail(ctx, RECT.tailBarras, 'barras'); drawTail(ctx, RECT.tailAro, 'aro');
  // Antiniebla: faro pequeño dentro de su hueco oscuro, nunca un cuadro blanco.
  const [fgx, fgy, fgw, fgh] = RECT.fog;
  ctx.fillStyle = '#0f1012'; ctx.fillRect(fgx, fgy, fgw, fgh);
  const fogLens = ctx.createRadialGradient(fgx + fgw / 2, fgy + fgh / 2, 1, fgx + fgw / 2, fgy + fgh / 2, fgw * .27);
  fogLens.addColorStop(0, '#c9ccce'); fogLens.addColorStop(.45, '#6d7175'); fogLens.addColorStop(1, '#232527');
  ctx.fillStyle = fogLens; ctx.beginPath(); ctx.arc(fgx + fgw / 2, fgy + fgh / 2, fgw * .27, 0, Math.PI * 2); ctx.fill();
  drawGrille(ctx, RECT.grilleLamas, 'lamas'); drawGrille(ctx, RECT.grilleMalla, 'malla');
  drawRim(ctx, RECT.rimAleacion, 'aleacion'); drawRim(ctx, RECT.rimRadios, 'radios');
  drawRim(ctx, RECT.rimTapa, 'tapa'); drawRim(ctx, RECT.rimAcero, 'acero'); drawRim(ctx, RECT.rimBuseta, 'buseta');
  drawRoute(ctx, RECT.route0, ROUTES[0]); drawRoute(ctx, RECT.route1, ROUTES[1]);
  drawRoute(ctx, RECT.route2, ROUTES[2]); drawRoute(ctx, RECT.route3, ROUTES[3]);
  // Calcomanía de taxi en el vidrio trasero y tela de asientos.
  const [kx, ky, kw, kh] = RECT.sticker;
  ctx.fillStyle = '#f2c417'; ctx.fillRect(kx, ky, kw, kh);
  ctx.fillStyle = '#111';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2) ctx.fillRect(kx + i * kw / 6, ky + j * kh / 6, kw / 6, kh / 6);
  const [tx, ty, tw, th] = RECT.seat;
  ctx.fillStyle = '#9a9a9a'; ctx.fillRect(tx, ty, tw, th);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  for (let i = 0; i < tw; i += 4) ctx.fillRect(tx + i, ty, 1, th);
  for (let i = 0; i < th; i += 4) ctx.fillRect(tx, ty + i, tw, 1);
  // Franja damero de los taxis.
  const [fx, fy, fw, fh] = RECT.taxiStripe;
  for (let i = 0; i < fw; i += 4) for (let j = 0; j < fh; j += 4) {
    ctx.fillStyle = ((i + j) / 4) % 2 ? '#111' : '#f4f4f0';
    ctx.fillRect(fx + i, fy + j, 4, 4);
  }
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
