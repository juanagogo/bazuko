// Atlas de ventanas: marco, vidrio con reflejo de cielo, reja, cortina o persiana, y su luz de noche.
// Ocho columnas por cuatro filas. La columna da la reja (columna % 4) y la variante; la fila, lo que hay detrás del vidrio.
import * as THREE from 'three';
import { rng } from './textures.js';

export const COLUMNAS = 8, FILAS = 4;
export const FILA = { vidrio: 0, velo: 1, cortina: 2, luz: 3 };
const CELDA = 128, ANCHO = COLUMNAS * CELDA, ALTO = FILAS * CELDA, MARGEN = 1.5;
const REJAS = ['barrotes', 'rombos', 'arco', null];
const MARCOS = ['#d3cebf', '#2b2c2b', '#8a8f8d', '#c9c3b2', '#39342f', '#d0ccc1', '#6c675e', '#2f3030'];
const TELAS = ['#d6cdb6', '#b7a59e', '#a7b3a4', '#c5af82', '#cdc6b8', '#9da5ac', '#733c3a', '#536177'];
const CALIDA = '#ffb45f', FRIA = '#cfe8dc', TELE = '#7fa6e6';
const FONDOS = [
  ['vidrio', 'vidrio', 'vidrio', 'vidrio', 'media', 'media', 'media', 'media'],
  ['velo', 'velo', 'velo', 'velo', 'carton', 'carton', 'recogida', 'recogida'],
  ['cortina', 'cortina', 'cortina', 'cortina', 'persiana', 'persiana', 'cobija', 'cobija'],
  ['cortina', 'velo', 'cortina', 'cortina', 'velo', 'persiana', 'recogida', 'cortina']
];
// Color y fuerza de la luz de cada celda; las que no figuran quedan apagadas.
const LUCES = [
  { 6: [TELE, .5] },
  { 1: [CALIDA, .5], 7: [FRIA, .42] },
  { 0: [CALIDA, .5], 5: [FRIA, .4] },
  [[CALIDA, 1], [FRIA, .7], [CALIDA, .85], [TELE, .8], [CALIDA, 1], [FRIA, .65], [TELE, .75], [CALIDA, .95]]
];

/** Rectángulo UV [u0, v0, u1, v1] de una celda; `desde` y `hasta` la recortan a lo ancho (0 a 1). */
export function celdaVentana(columna, fila, desde = 0, hasta = 1) {
  const x0 = columna * CELDA + MARGEN, ancho = CELDA - MARGEN * 2;
  const y0 = fila * CELDA + MARGEN, y1 = (fila + 1) * CELDA - MARGEN;
  return [(x0 + ancho * desde) / ANCHO, 1 - y1 / ALTO, (x0 + ancho * hasta) / ANCHO, 1 - y0 / ALTO];
}

const mezcla = h => {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ h >>> 16) >>> 0;
};

/**
 * Celda de un vano según lo que es ('vidrio', 'cortina' o 'luz') y su semilla. Con `casa`, la columna (reja y marco)
 * sale de la semilla de la casa: todos sus vanos llevan la misma reja y la vecina lleva otra. No gasta azar.
 */
export function celdaDelVano(tipo, semilla, casa) {
  const columna = (casa === undefined ? semilla >>> 16 : mezcla(casa >>> 0)) % COLUMNAS;
  return [columna, tipo === 'luz' ? FILA.luz : tipo === 'cortina' ? FILA.cortina : (semilla >>> 20) & 1];
}

/** Columna sin reja de la misma variante: para la cortina que cae sobre un vidrio liso. */
export const columnaSinReja = columna => (columna & 4) | 3;

/** Trozo de tela encendida y lisa (sin reja ni marco) para piezas pequeñas que solo necesitan brillar. */
export const LUZ_LISA = (() => {
  const [u0, v0, u1, v1] = celdaVentana(7, FILA.luz);
  const u = u0 + (u1 - u0) * .5, v = v0 + (v1 - v0) * .5, d = 1 / ANCHO;
  return [u - d, v - d, u + d, v + d];
})();

/** Trozo del marco oscuro de una ventana sin reja: color parejo y apagado de noche, para una puerta o un tablero. */
export const MARCO_OSCURO = (() => {
  const [u0, , u1, v1] = celdaVentana(7, FILA.vidrio);
  const u = u0 + (u1 - u0) * .5, v = v1 - 2 / ALTO, d = .5 / ANCHO;
  return [u - d, v - d, u + d, v + d];
})();

function lienzo(ancho, alto) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = ancho; canvas.height = alto;
  const ctx = canvas.getContext?.('2d');
  return ctx ? { canvas, ctx } : null;
}

const S = CELDA;
function linea(ctx, x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }

/** Pliegues verticales: sombra y luz alternadas sobre lo ya pintado. */
function pliegues(ctx, x0, x1, y0, y1, r, fuerza) {
  for (let x = x0; x < x1;) {
    const ancho = 5 + r() * 7;
    const g = ctx.createLinearGradient(x, 0, Math.min(x1, x + ancho), 0);
    g.addColorStop(0, `rgba(0,0,0,${fuerza})`); g.addColorStop(.45, 'rgba(0,0,0,0)');
    g.addColorStop(.7, `rgba(255,255,255,${fuerza * .5})`); g.addColorStop(1, `rgba(0,0,0,${fuerza * .8})`);
    ctx.fillStyle = g; ctx.fillRect(x, y0, Math.min(ancho, x1 - x), y1 - y0);
    x += ancho;
  }
}

function lamas(ctx, y0, y1, color, luz) {
  ctx.fillStyle = color; ctx.fillRect(0, y0, S, y1 - y0);
  for (let y = y0; y < y1; y += 6) {
    ctx.fillStyle = luz ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.2)'; ctx.fillRect(0, y, S, luz ? 4 : 2);
    ctx.fillStyle = luz ? 'rgba(0,0,0,.2)' : 'rgba(0,0,0,.34)'; ctx.fillRect(0, y + 4.6, S, 1.4);
  }
  if (!luz) { ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(S * .3, y0, 1.2, y1 - y0); ctx.fillRect(S * .7, y0, 1.2, y1 - y0); }
}

/** Lo que hay detrás del vidrio. En el mapa de luz (`luz`) la tela tiñe y los pliegues atenúan. */
function interior(ctx, fondo, tela, r, luz) {
  const velo = luz ? .22 : 1;
  if (fondo === 'velo') {
    ctx.fillStyle = luz ? 'rgba(60,52,40,.22)' : 'rgba(216,211,197,.62)'; ctx.fillRect(0, 0, S, S);
    pliegues(ctx, 0, S, 0, S, r, luz ? .16 : .1);
    if (!luz) for (let y = 14; y < S; y += 9) { ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(0, y, S, 1); }
  } else if (fondo === 'cortina') {
    ctx.globalAlpha = velo; ctx.fillStyle = tela; ctx.fillRect(0, 0, S, S); ctx.globalAlpha = 1;
    pliegues(ctx, 0, S, 0, S, r, luz ? .3 : .2);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, 0, S, 9);
    if (!luz) { ctx.fillStyle = 'rgba(70,56,40,.16)'; ctx.fillRect(0, S - 22, S, 22); }
  } else if (fondo === 'recogida') {
    for (const lado of [0, 1]) {
      ctx.save();
      if (lado) { ctx.translate(S, 0); ctx.scale(-1, 1); }
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(S * .46, 0);
      ctx.quadraticCurveTo(S * .34, S * .34, S * .13, S * .58); ctx.lineTo(S * .25, S); ctx.lineTo(0, S); ctx.closePath();
      ctx.save(); ctx.clip();
      ctx.globalAlpha = luz ? .55 : 1; ctx.fillStyle = luz ? '#000' : tela; ctx.fillRect(0, 0, S * .5, S); ctx.globalAlpha = 1;
      pliegues(ctx, 0, S * .5, 0, S, r, .2);
      ctx.restore(); ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(S * .08, S * .56, S * .1, 4); ctx.fillRect(S * .82, S * .56, S * .1, 4);
  } else if (fondo === 'persiana') {
    lamas(ctx, 0, S, luz ? 'rgba(0,0,0,.25)' : tela, luz);
  } else if (fondo === 'media') {
    lamas(ctx, 0, S * (.38 + r() * .16), luz ? 'rgba(0,0,0,.45)' : '#c9c4b4', luz);
  } else if (fondo === 'carton') {
    const alto = S * (.5 + r() * .25), x = r() < .5 ? 0 : S * .3;
    ctx.fillStyle = luz ? '#000' : '#a3875f'; ctx.fillRect(x, S - alto, S * .7, alto);
    if (!luz) {
      ctx.fillStyle = 'rgba(60,44,26,.3)'; ctx.fillRect(x, S - alto, S * .7, 3); ctx.fillRect(x + S * .34, S - alto, 2, alto);
      ctx.fillStyle = 'rgba(205,196,170,.75)'; ctx.fillRect(x + 6, S - alto - 4, 16, 9); ctx.fillRect(x + S * .7 - 22, S - alto - 4, 16, 9);
      for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(70,52,30,${.08 + r() * .12})`; ctx.fillRect(x + r() * S * .68, S - r() * alto, 3 + r() * 9, 1.4); }
    }
  } else if (fondo === 'cobija') {
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.quadraticCurveTo(S * .5, 22 + r() * 10, S, 3); ctx.lineTo(S, S); ctx.lineTo(0, S); ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.fillStyle = luz ? '#000' : tela; ctx.fillRect(0, 0, S, S);
    if (!luz) {
      ctx.fillStyle = 'rgba(214,202,170,.3)'; ctx.fillRect(0, S * .42, S, 7); ctx.fillRect(0, S * .52, S, 3); ctx.fillRect(0, S * .82, S, 7);
      pliegues(ctx, 0, S, 0, S, r, .12);
    }
    ctx.restore();
  }
}

function marco(ctx, color, luz) {
  ctx.fillStyle = luz ? '#000' : color;
  ctx.fillRect(0, 0, S, 6); ctx.fillRect(0, S - 6, S, 6); ctx.fillRect(0, 0, 6, S); ctx.fillRect(S - 6, 0, 6, S);
  ctx.fillRect(0, S * .29, S, 4);
  if (luz) return;
  ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(6, 6, S - 12, 2.5); ctx.fillRect(6, 6, 2.5, S - 12); ctx.fillRect(6, S * .29 + 4, S - 12, 2);
  ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(0, 0, S, 1.2); ctx.fillRect(0, S * .29, S, 1);
  ctx.fillStyle = 'rgba(92,58,34,.3)'; ctx.fillRect(0, S - 6, S, 2.4);
}

function trazoReja(ctx, tipo) {
  const a = 9, b = S - 9;
  if (tipo === 'barrotes') {
    for (let i = 0; i < 8; i++) { const x = a + 4 + i * (b - a - 8) / 7; linea(ctx, x, a, x, b); }
    ctx.lineWidth *= 1.5; linea(ctx, a, S * .2, b, S * .2); linea(ctx, a, S * .82, b, S * .82);
  } else if (tipo === 'rombos') {
    ctx.save(); ctx.beginPath(); ctx.rect(a, a, b - a, b - a); ctx.clip();
    for (let k = -S; k < S * 2; k += 21) { linea(ctx, k, a, k + S, a + S); linea(ctx, k, a, k - S, a + S); }
    ctx.restore();
    ctx.strokeRect(a, a, b - a, b - a);
  } else if (tipo === 'arco') {
    const paso = (b - a) / 5, riel = S * .34;
    for (let i = 0; i <= 5; i++) { const x = a + i * paso; linea(ctx, x, i % 5 ? riel : a, x, b); }
    linea(ctx, a, riel, b, riel); linea(ctx, a, b, b, b); linea(ctx, a, riel + 15, b, riel + 15);
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(a + (i + .5) * paso, riel + 7.5, 5.6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(S / 2, riel, (b - a) / 2, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(S / 2, riel, (b - a) / 2 - 13, Math.PI, 0); ctx.stroke();
    for (let i = 1; i < 6; i++) { const t = Math.PI * (1 + i / 6); linea(ctx, S / 2 + Math.cos(t) * ((b - a) / 2 - 13), riel + Math.sin(t) * ((b - a) / 2 - 13), S / 2 + Math.cos(t) * (b - a) / 2, riel + Math.sin(t) * (b - a) / 2); }
  }
}

function reja(ctx, tipo, clara, luz) {
  if (!tipo) return;
  ctx.lineCap = 'butt';
  if (!luz) {
    ctx.save(); ctx.translate(2.2, 3); ctx.strokeStyle = 'rgba(0,0,0,.34)'; ctx.lineWidth = 2.2; trazoReja(ctx, tipo); ctx.restore();
  }
  ctx.strokeStyle = luz ? 'rgba(0,0,0,.92)' : clara ? '#a29e92' : '#1c1c1b'; ctx.lineWidth = luz ? 2.4 : 2; trazoReja(ctx, tipo);
  if (!luz) {
    ctx.save(); ctx.translate(-.7, -.7); ctx.strokeStyle = clara ? 'rgba(255,255,255,.15)' : 'rgba(170,176,172,.3)'; ctx.lineWidth = .8; trazoReja(ctx, tipo); ctx.restore();
  }
}

function celda(ctx, columna, fila, luz) {
  // Misma semilla en el color y en la luz: los pliegues, la persiana y el cartón caen en el mismo sitio en los dos mapas.
  const fondo = FONDOS[fila][columna], encendida = LUCES[fila][columna], r = rng(0x7e17a4 + fila * COLUMNAS + columna);
  ctx.save();
  ctx.translate(columna * CELDA, fila * CELDA);
  ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
  if (luz) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    if (!encendida) { ctx.restore(); return; }
    ctx.globalAlpha = encendida[1]; ctx.fillStyle = encendida[0]; ctx.fillRect(0, 0, S, S); ctx.globalAlpha = 1;
    // La luz no llena el vano parejo: cae desde el bombillo o sube desde el televisor.
    const tele = encendida[0] === TELE;
    const g = ctx.createRadialGradient(S * (tele ? .34 : .5), S * (tele ? .78 : .3), 6, S * .5, S * .5, S * .82);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${tele ? .72 : .5})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#26373a'); g.addColorStop(1, '#141d1f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }
  interior(ctx, fondo, TELAS[(columna + fila * 3) % TELAS.length], r, luz);
  if (!luz) {
    // Reflejo falso del cielo nublado: más claro arriba, con un brillo en diagonal.
    const cielo = ctx.createLinearGradient(0, 0, 0, S);
    cielo.addColorStop(0, 'rgba(178,194,202,.46)'); cielo.addColorStop(.5, 'rgba(150,170,180,.1)'); cielo.addColorStop(1, 'rgba(150,170,180,0)');
    ctx.fillStyle = cielo; ctx.fillRect(0, 0, S, S);
    const x = S * (.15 + r() * .5);
    ctx.fillStyle = 'rgba(255,255,255,.075)';
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 26, 0); ctx.lineTo(x - 30, S); ctx.lineTo(x - 56, S); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 36, 0); ctx.lineTo(x + 44, 0); ctx.lineTo(x - 12, S); ctx.lineTo(x - 20, S); ctx.closePath(); ctx.fill();
    // Polvo que sube desde el alféizar y chorreones de lluvia.
    const polvo = ctx.createLinearGradient(0, S * .62, 0, S);
    polvo.addColorStop(0, 'rgba(126,110,86,0)'); polvo.addColorStop(1, 'rgba(126,110,86,.34)');
    ctx.fillStyle = polvo; ctx.fillRect(0, S * .62, S, S * .38);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(190,186,170,${.05 + r() * .07})`; ctx.fillRect(8 + r() * (S - 16), 8, 1 + r() * 1.6, 20 + r() * 70); }
  }
  marco(ctx, MARCOS[columna], luz);
  reja(ctx, REJAS[columna % 4], columna === 1 || columna === 6, luz);
  ctx.restore();
}

function pintar(ctx, escala, luz) {
  ctx.scale(escala, escala);
  for (let fila = 0; fila < FILAS; fila++) for (let columna = 0; columna < COLUMNAS; columna++) celda(ctx, columna, fila, luz);
}

function textura(surface, nombre) {
  const t = new THREE.CanvasTexture(surface.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.name = nombre;
  return t;
}

let atlas;
/**
 * Devuelve { color, luz } o null si no hay lienzo. Se pinta una sola vez y con azar propio: crear sus texturas
 * no gasta el azar sembrado con el que se arma la ciudad.
 */
export function atlasDeVentanas() {
  if (atlas !== undefined) return atlas;
  const delJuego = Math.random;
  Math.random = rng(0x7e17a3);
  try {
    const color = lienzo(ANCHO, ALTO), luz = lienzo(ANCHO / 2, ALTO / 2);
    if (color && luz) {
      pintar(color.ctx, 1, false); pintar(luz.ctx, .5, true);
      atlas = { color: textura(color, 'Atlas de ventanas'), luz: textura(luz, 'Atlas de ventanas: luz de noche') };
    } else atlas = null;
  } catch { atlas = null; } finally { Math.random = delJuego; }
  return atlas;
}
