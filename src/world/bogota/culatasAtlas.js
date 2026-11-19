import * as THREE from 'three';

/**
 * Carta de pintura de las culatas: murales, avisos a brocha, firmas de aerosol y carteles pegados.
 * Todo es inventado: ni marcas, ni obras, ni firmas de nadie.
 */
export const ANCHO = 2048, ALTO = 1664;

/** Celdas de la carta en pixeles: [x, y, ancho, alto]. */
export const PIEZAS = Object.freeze({
  colibri: { celda: [0, 0, 512, 512], tipo: 'mural' },
  frailejon: { celda: [512, 0, 512, 512], tipo: 'mural' },
  cerros: { celda: [1024, 0, 512, 512], tipo: 'mural' },
  copeton: { celda: [1536, 0, 512, 512], tipo: 'mural' },
  montallantas: { celda: [0, 512, 1024, 256], tipo: 'aviso' },
  lote: { celda: [0, 768, 1024, 256], tipo: 'aviso' },
  basura: { celda: [1024, 512, 768, 256], tipo: 'aviso' },
  firmas: { celda: [1024, 768, 768, 256], tipo: 'firmas' },
  carteles: { celda: [1792, 512, 256, 512], tipo: 'carteles' },
  parquear: { celda: [0, 1024, 1024, 256], tipo: 'aviso' },
  casa: { celda: [1024, 1024, 1024, 256], tipo: 'aviso' },
  soldadura: { celda: [0, 1280, 512, 256], tipo: 'aviso', maximo: 4.4 },
  modista: { celda: [512, 1280, 512, 256], tipo: 'aviso', maximo: 4.2 },
  bazar: { celda: [1024, 1280, 512, 256], tipo: 'aviso', maximo: 4.6 },
  encalada: { celda: [1536, 1280, 512, 256], tipo: 'tapada', maximo: 5.2 },
  rayonLavado: { celda: [0, 1536, 256, 128], tipo: 'rayon' },
  rayonFirma: { celda: [256, 1536, 256, 128], tipo: 'rayon' },
  rayonCorona: { celda: [512, 1536, 256, 128], tipo: 'rayon' },
  rayonTapado: { celda: [768, 1536, 256, 128], tipo: 'rayon' }
});

/** Lo que queda escrito en los muros (las pruebas lo cotejan). */
export const TEXTOS = Object.freeze({
  montallantas: ['MONTALLANTAS EL DESVARE', 'DESPINCHE · BALANCEO · DÍA Y NOCHE'],
  lote: ['SE VENDE ESTE LOTE', 'RAZÓN EN LA TIENDA DE LA ESQUINA'],
  basura: ['PROHIBIDO BOTAR', 'BASURA Y ESCOMBROS'],
  firmas: ['MIRLA', 'tunjo', 'niebla', 'ZOKA'],
  carteles: [['GRAN', 'BAILE'], ['CIRCO', 'HOY'], ['ARRIENDO', 'PIEZA'], ['CLASES', 'GUITARRA'],
    ['SE BUSCA', 'GATO'], ['REMATE', 'TOTAL'], ['BINGO', 'BAZAR'], ['SERENATAS', 'DE BARRIO']],
  parquear: ['NO PARQUEAR', 'GARAJE EN USO DE DÍA Y DE NOCHE'],
  casa: ['SE VENDE CASA', 'INFORMES EN LA PANADERÍA'],
  soldadura: ['SOLDADURA', 'REJAS · PUERTAS · ARREGLOS'],
  modista: ['MODISTERÍA', 'ARREGLOS DE ROPA · SEGUNDO PISO'],
  bazar: ['GRAN BAZAR', 'SALÓN COMUNAL · DOMINGO'],
  encalada: ['SE ARRIENDA', 'PIEZA AMOBLADA'],
  rayones: ['ZURO', 'sapo']
});

/** Esquinas de una pieza en la carta: [u0, v0, u1, v1], con v0 abajo. Deja un pixel de margen. */
export function uvDe(nombre) {
  const [x, y, w, h] = PIEZAS[nombre].celda;
  return [(x + 1) / ANCHO, 1 - (y + h - 1) / ALTO, (x + w - 1) / ANCHO, 1 - (y + 1) / ALTO];
}

/** Ancho entre alto de una pieza. */
export const proporcion = (nombre) => PIEZAS[nombre].celda[2] / PIEZAS[nombre].celda[3];

const T = { ocre: '#c79a45', teja: '#a8523a', menta: '#7fa593', anil: '#32456b', crema: '#e4dac2', musgo: '#66784b',
  salmon: '#cf957a', noche: '#27262b', hueso: '#ece5d4', vino: '#8d3f55', cielo: '#a3b8be', rojo: '#9a3029' };
const LETRA = '"Arial Black", Impact, "Arial Narrow", "Helvetica Neue", sans-serif';
const MANO = '"Marker Felt", "Comic Sans MS", "Brush Script MT", cursive';

function azarDe(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const elipse = (c, x, y, rx, ry, giro, color) => {
  c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, giro, 0, Math.PI * 2); c.fill();
};
const forma = (c, color, puntos) => {
  c.fillStyle = color; c.beginPath(); c.moveTo(puntos[0], puntos[1]);
  for (let i = 2; i < puntos.length; i += 2) c.lineTo(puntos[i], puntos[i + 1]);
  c.closePath(); c.fill();
};
const linea = (c, color, grueso, puntos) => {
  c.strokeStyle = color; c.lineWidth = grueso; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(puntos[0], puntos[1]);
  for (let i = 2; i < puntos.length; i += 2) c.lineTo(puntos[i], puntos[i + 1]);
  c.stroke();
};
const fondo = (c, w, h, color, opacidad = .93) => { c.globalAlpha = opacidad; c.fillStyle = color; c.fillRect(0, 0, w, h); c.globalAlpha = 1; };

/** Brochazos, hiladas del ladrillo que asoman, desconchones, borde comido, chorreones y polvo. */
function gastar(c, w, h, azar, { hiladas = .15, desconchones = 150 } = {}, orilla = null) {
  c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 70; i++) {
    c.fillStyle = azar() < .5 ? 'rgba(255,250,235,.05)' : 'rgba(30,24,18,.05)';
    c.fillRect(azar() * w - 40, azar() * h, 60 + azar() * 220, 4 + azar() * 16);
  }
  for (let i = 0; i < 16; i++) {
    const x = azar() * w, largo = h * (.15 + azar() * .6), g = c.createLinearGradient(0, 0, 0, largo);
    g.addColorStop(0, 'rgba(44,36,28,.3)'); g.addColorStop(1, 'rgba(44,36,28,0)');
    c.fillStyle = g; c.fillRect(x, 0, 3 + azar() * 16, largo);
  }
  const polvo = c.createLinearGradient(0, h * .62, 0, h);
  polvo.addColorStop(0, 'rgba(84,70,52,0)'); polvo.addColorStop(1, 'rgba(84,70,52,.34)');
  c.fillStyle = polvo; c.fillRect(0, h * .62, w, h * .38);
  c.globalCompositeOperation = 'destination-out';
  if (hiladas) {
    c.fillStyle = `rgba(0,0,0,${hiladas})`;
    for (let y = 0, fila = 0; y < h; y += 12, fila++) {
      c.fillRect(0, y, w, 1.6);
      for (let x = (fila % 2) * 18; x < w; x += 36) c.fillRect(x, y, 1.6, 12);
    }
  }
  for (let i = 0; i < desconchones; i++) {
    const lado = 2 + azar() * azar() * 26;
    c.fillStyle = `rgba(0,0,0,${.3 + azar() * .7})`;
    c.fillRect(azar() * w, azar() * h, lado * (1 + azar() * 1.5), lado * .5);
  }
  if (orilla) {
    c.fillStyle = '#000'; c.beginPath(); c.rect(0, 0, w, h); c.moveTo(orilla[0], orilla[1]);
    for (let i = 2; i < orilla.length; i += 2) c.lineTo(orilla[i], orilla[i + 1]);
    c.closePath(); c.fill('evenodd');
  }
  c.globalCompositeOperation = 'source-over';
}

/**
 * Lo que queda de la pintura dentro del borde comido: el contorno, en pixeles de la celda, se come de 6 a 20 px
 * hacia adentro con un ruido suave de 25 a 70 px de periodo, no a dientes.
 */
export function bordeComido(w, h, azar, borde) {
  const poco = Math.min(6, borde), mucho = Math.min(20, borde * 1.7), puntos = [];
  const lado = (largo, punto) => {
    const periodo = 25 + azar() * 45, nudos = Array.from({ length: Math.ceil(largo / periodo) + 2 }, () => azar());
    for (let s = 0; s < largo; s += 4) {
      const k = s / periodo, i = Math.floor(k), f = k - i, suave = f * f * (3 - 2 * f);
      const hondo = poco + (mucho - poco) * (nudos[i] + (nudos[i + 1] - nudos[i]) * suave) + (azar() - .5) * 1.5;
      punto(s, Math.max(poco, Math.min(mucho, hondo)));
    }
  };
  lado(w, (s, d) => puntos.push(s, d));
  lado(h, (s, d) => puntos.push(w - d, s));
  lado(w, (s, d) => puntos.push(w - s, h - d));
  lado(h, (s, d) => puntos.push(d, h - s));
  return puntos;
}

function colibri(c, w, h) {
  fondo(c, w, h, T.crema);
  elipse(c, 330, 205, 158, 158, 0, T.ocre);
  elipse(c, 330, 205, 120, 120, 0, '#d2ab5a');
  // flor y hojas
  linea(c, T.musgo, 9, [120, 405, 104, 460, 86, 512]);
  elipse(c, 62, 470, 44, 15, -.5, T.musgo); elipse(c, 140, 482, 40, 13, .5, '#55683f');
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + .2;
    elipse(c, 120 + Math.cos(a) * 36, 398 + Math.sin(a) * 36, 40, 17, a, i % 2 ? T.salmon : '#c27f68');
  }
  elipse(c, 120, 398, 17, 17, 0, T.vino);
  // colibrí: cola, alas, cuerpo, cabeza y pico hacia la flor
  forma(c, '#1f4f52', [372, 196, 404, 158, 474, 116, 458, 168, 486, 164, 438, 212]);
  elipse(c, 332, 148, 116, 30, -1.15, '#3f8f86');
  elipse(c, 376, 164, 98, 24, -.75, '#63a89b');
  linea(c, 'rgba(20,50,52,.5)', 3, [300, 214, 356, 96]); linea(c, 'rgba(20,50,52,.45)', 3, [320, 214, 426, 104]);
  elipse(c, 310, 232, 102, 46, -.6, '#2f6f68');
  elipse(c, 296, 254, 74, 24, -.6, '#93b9a6');
  elipse(c, 254, 296, 30, 16, -.6, T.vino);
  elipse(c, 228, 286, 35, 33, 0, '#2a625d');
  forma(c, T.noche, [203, 298, 216, 312, 138, 384]);
  elipse(c, 219, 279, 7, 7, 0, T.hueso); elipse(c, 218, 280, 3.5, 3.5, 0, T.noche);
  // franja de abajo
  for (let x = 196; x < w; x += 44) forma(c, (x / 44 | 0) % 2 ? T.teja : T.anil, [x, h, x + 22, h - 34, x + 44, h]);
}

function frailejon(c, w, h) {
  const cielo = c.createLinearGradient(0, 0, 0, h * .6);
  cielo.addColorStop(0, T.cielo); cielo.addColorStop(1, T.hueso);
  c.globalAlpha = .93; c.fillStyle = cielo; c.fillRect(0, 0, w, h); c.globalAlpha = 1;
  elipse(c, 120, 110, 46, 46, 0, '#e9dfc0');
  forma(c, '#8c9c88', [0, 250, 90, 200, 180, 232, 290, 176, 400, 226, 512, 190, 512, 512, 0, 512]);
  forma(c, '#72855f', [0, 330, 110, 284, 230, 320, 350, 276, 512, 316, 512, 512, 0, 512]);
  forma(c, '#586b41', [0, 410, 140, 372, 300, 404, 512, 380, 512, 512, 0, 512]);
  const fraile = (x, base, alto, r) => {
    const copa = base - alto;
    c.fillStyle = '#5c4835'; c.fillRect(x - r * .2, copa, r * .4, alto);
    for (let y = copa + r * .5; y < base; y += r * .16) linea(c, 'rgba(40,30,22,.5)', 2.5, [x - r * .2, y, x + r * .2, y + r * .06]);
    for (let i = 0; i < 22; i++) {
      const a = -Math.PI * 1.12 + i * (Math.PI * 1.24 / 21);
      elipse(c, x + Math.cos(a) * r * .56, copa + Math.sin(a) * r * .56, r * .6, r * .13, a, i % 2 ? '#bcc5a1' : '#a2ad84');
    }
    elipse(c, x, copa, r * .24, r * .2, 0, '#dcdcb8');
    for (const d of [-.5, .1, .55]) {
      linea(c, '#8a8f62', 3, [x + d * r * .3, copa, x + d * r * .9, copa - r * 1.05]);
      elipse(c, x + d * r * .9, copa - r * 1.05, r * .11, r * .11, 0, T.ocre);
    }
  };
  fraile(444, 430, 96, 44); fraile(146, 476, 190, 82); fraile(336, 512, 262, 108);
}

function cerros(c, w, h) {
  const cielo = c.createLinearGradient(0, 0, 0, 330);
  cielo.addColorStop(0, T.salmon); cielo.addColorStop(1, T.crema);
  c.globalAlpha = .93; c.fillStyle = cielo; c.fillRect(0, 0, w, h); c.globalAlpha = 1;
  elipse(c, 384, 140, 62, 62, 0, T.hueso);
  forma(c, '#56684f', [0, 300, 60, 250, 130, 272, 200, 200, 262, 236, 330, 178, 404, 232, 470, 206, 512, 240, 512, 512, 0, 512]);
  c.fillStyle = T.hueso; c.fillRect(194, 187, 13, 13); c.fillRect(327, 160, 8, 18);
  forma(c, '#3e5040', [0, 344, 80, 300, 170, 330, 260, 286, 350, 326, 440, 296, 512, 332, 512, 512, 0, 512]);
  // casas en la falda
  const azar = azarDe(0xca5a5);
  const muros = [T.teja, '#b86a48', T.ocre, T.salmon, T.crema, T.menta, '#a85f43'];
  for (let fila = 0; fila < 2; fila++) {
    for (let x = -10 + fila * 22; x < w; ) {
      const ancho = 36 + azar() * 30, alto = 46 + azar() * 56, y = 470 - fila * -6 - alto - (1 - fila) * 34;
      c.fillStyle = muros[azar() * muros.length | 0]; c.fillRect(x, y, ancho, alto + 60);
      c.fillStyle = 'rgba(30,26,30,.8)';
      for (let vy = y + 10; vy < y + alto - 8; vy += 22) for (let vx = x + 7; vx < x + ancho - 10; vx += 17) c.fillRect(vx, vy, 8, 11);
      if (azar() < .4) { c.fillStyle = T.noche; c.fillRect(x + ancho * .3, y - 9, 12, 9); }
      x += ancho + 2;
    }
  }
  c.fillStyle = T.anil; c.fillRect(0, 468, w, 44);
  for (let x = 0; x < w; x += 40) forma(c, (x / 40 | 0) % 2 ? T.ocre : T.hueso, [x, 512, x + 20, 476, x + 40, 512]);
}

function copeton(c, w, h) {
  fondo(c, w, h, '#557f78');
  elipse(c, 262, 232, 176, 176, 0, T.crema);
  for (const y of [300, 336, 356]) {
    c.strokeStyle = T.noche; c.lineWidth = 4; c.beginPath(); c.moveTo(0, y); c.quadraticCurveTo(256, y + 26, w, y - 6); c.stroke();
  }
  linea(c, T.noche, 4, [246, 318, 240, 346]); linea(c, T.noche, 4, [286, 320, 292, 346]);
  forma(c, '#4a382a', [338, 268, 436, 300, 430, 326, 332, 304]);
  elipse(c, 266, 262, 94, 66, -.25, '#8a6a4a');
  elipse(c, 250, 286, 66, 40, -.2, '#cfc4ad');
  elipse(c, 302, 260, 64, 33, .25, '#5e4634');
  linea(c, 'rgba(220,205,170,.6)', 3, [262, 250, 340, 274]); linea(c, 'rgba(220,205,170,.5)', 3, [258, 264, 334, 290]);
  forma(c, '#77777a', [172, 166, 204, 122, 226, 170]);
  elipse(c, 190, 202, 50, 46, 0, '#9c9c9a');
  linea(c, T.noche, 6, [150, 186, 226, 172]); linea(c, T.noche, 5, [156, 208, 232, 204]);
  elipse(c, 206, 242, 46, 17, -.3, '#a8552f');
  elipse(c, 178, 228, 24, 13, 0, T.hueso);
  forma(c, '#3a3a3c', [144, 198, 116, 210, 146, 218]);
  elipse(c, 172, 197, 6.5, 6.5, 0, T.noche); elipse(c, 170, 195, 2, 2, 0, T.hueso);
  for (let x = 0; x < w; x += 64) {
    forma(c, (x / 64 | 0) % 2 ? T.ocre : T.teja, [x, h, x + 32, h - 62, x + 64, h]);
    forma(c, T.anil, [x + 20, h, x + 32, h - 24, x + 44, h]);
  }
}

function rotulo(c, w, h, azar, colorFondo, lineas, adorno) {
  c.globalAlpha = .94; c.fillStyle = colorFondo; c.fillRect(4, 6, w - 8, h - 12); c.globalAlpha = 1;
  adorno?.();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const { texto, color, sombra, px, y, x = w / 2, ancho = w * .9 } of lineas) {
    c.font = `900 ${px}px ${LETRA}`;
    const medida = c.measureText(texto).width || 1;
    c.save(); c.translate(x, y); c.rotate((azar() - .5) * .014); c.scale(Math.min(1, ancho / medida), 1);
    if (sombra) { c.fillStyle = sombra; c.fillText(texto, 5, 5); }
    c.fillStyle = color; c.fillText(texto, 0, 0);
    c.restore();
  }
}

function firmas(c, w, h, azar) {
  const firma = (texto, x, y, px, giro, color, borde) => {
    c.save(); c.translate(x, y); c.rotate(giro); c.font = `italic 900 ${px}px ${MANO}`;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
    if (borde) { c.lineWidth = px * .16; c.strokeStyle = borde; c.strokeText(texto, 0, 0); }
    c.fillStyle = color; c.fillText(texto, 0, 0);
    c.restore();
  };
  const [bomba, uno, dos, tres] = TEXTOS.firmas;
  c.globalAlpha = .92;
  firma(bomba, 34, 182, 150, -.05, '#bfc2c6', T.noche);
  firma(uno, 470, 104, 82, .06, '#5c4a86');
  firma(dos, 500, 206, 70, -.08, T.noche);
  firma(tres, 640, 84, 54, -.2, '#356f73');
  // garabatos y goteos
  for (let i = 0; i < 5; i++) {
    const x = 40 + azar() * (w - 140), y = 30 + azar() * (h - 80), puntos = [x, y];
    for (let k = 0; k < 7; k++) puntos.push(x + k * 14 + azar() * 20, y + (azar() - .5) * 46);
    linea(c, [T.noche, '#5c4a86', '#8f3a36'][i % 3], 4 + azar() * 3, puntos);
  }
  for (let i = 0; i < 9; i++) {
    const x = 50 + azar() * 380;
    linea(c, i % 2 ? T.noche : '#a9acb0', 3, [x, 150 + azar() * 30, x + 1, 196 + azar() * 56]);
  }
  c.globalAlpha = 1;
}

function carteles(c, w, h, azar) {
  const papeles = ['#e6dec6', '#d6bf68', '#cc8d9c', '#a2bf9c', '#e2d8be', '#d5a06a', '#b9c7cf', '#e8e0c8'];
  c.globalAlpha = .9; c.fillStyle = '#b9b2a2'; c.fillRect(6, 4, w - 12, h - 8); c.globalAlpha = 1;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  TEXTOS.carteles.forEach((renglones, i) => {
    const ancho = w / 2 - 8, alto = h / 4 - 6;
    const x = (i % 2) * (w / 2) + w / 4 + (azar() - .5) * 10, y = (i / 2 | 0) * (h / 4) + h / 8 + (azar() - .5) * 10;
    c.save(); c.translate(x, y); c.rotate((azar() - .5) * .1);
    c.fillStyle = 'rgba(30,26,22,.35)'; c.fillRect(-ancho / 2 + 3, -alto / 2 + 3, ancho, alto);
    c.fillStyle = papeles[i]; c.fillRect(-ancho / 2, -alto / 2, ancho, alto);
    c.fillStyle = i % 3 === 0 ? T.rojo : T.noche; c.fillRect(-ancho / 2, -alto / 2, ancho, 16);
    renglones.forEach((texto, k) => {
      const px = k === 0 ? 30 : 24;
      c.font = `900 ${px}px ${LETRA}`;
      const medida = c.measureText(texto).width || 1;
      c.save(); c.translate(0, -alto * .12 + k * 34); c.scale(Math.min(1, (ancho - 14) / medida), 1);
      c.fillStyle = k === 0 && i % 2 ? T.rojo : T.noche; c.fillText(texto, 0, 0);
      c.restore();
    });
    c.fillStyle = 'rgba(40,34,28,.55)';
    for (let k = 0; k < 4; k++) c.fillRect(-ancho / 2 + 10, alto * .28 + k * 6, (ancho - 20) * (.5 + azar() * .5), 2.5);
    // esquina arrancada
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
    const rasga = 14 + azar() * 26, lado = azar() < .5 ? -1 : 1;
    c.beginPath(); c.moveTo(lado * ancho / 2, alto / 2); c.lineTo(lado * (ancho / 2 - rasga), alto / 2);
    c.lineTo(lado * (ancho / 2 - rasga * .3), alto / 2 - rasga * .5); c.lineTo(lado * ancho / 2, alto / 2 - rasga * 1.2); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.restore();
  });
}

export const CAL = '#b8b09c';

/** Brochazos de cal que se montan, huecos donde la pintura se cayó hasta el ladrillo y el chorreón del remate. */
export function planEncalada(w, h) {
  const azar = azarDe(semillaDe('encalada') ^ 0x2c1b3c6d), n = 3 + Math.floor(azar() * 3);
  const brochazos = Array.from({ length: n }, (_, i) => {
    const alto = h / n * (1.35 + azar() * .4);
    return {
      y: (i + .5) * h / n + (azar() - .5) * 10, alto, giro: (azar() - .5) * .05, fase: azar() * 6.28,
      desde: -14 + azar() * 44, hasta: w - 44 + azar() * 56, alfa: .55 + azar() * .25, sentido: azar() < .5 ? 1 : -1,
      cerdas: Array.from({ length: 4 + Math.floor(azar() * 3) }, () => ({ y: (azar() - .5) * alto * .8, largo: 12 + azar() * 34, grueso: 1 + azar() })),
      pelos: Array.from({ length: 6 }, () => ({ y: (azar() - .5) * alto * .9, claro: azar() < .5 }))
    };
  });
  const huecos = Array.from({ length: 5 }, (_, i) => {
    const cx = 70 + i * 93 + (azar() - .5) * 16, cy = 40 + azar() * (h - 80), r = 11 + azar() * 10, puntos = [];
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2, rr = r * (.4 + azar() * .85);
      puntos.push(cx + Math.cos(a) * rr * 1.6, cy + Math.sin(a) * rr * .7);
    }
    return puntos;
  });
  const chorreon = { x: w * (.2 + azar() * .6), ancho: 12 + azar() * 12, largo: h * (.45 + azar() * .3), deriva: (azar() - .5) * 8 };
  return { brochazos, huecos, chorreon };
}

/** Un aviso viejo tapado con cal a brochazos: las letras de antes se alcanzan a leer debajo. */
function encalada(c, w, h, azar) {
  rotulo(c, w, h, azar, '#b59a63', [
    { texto: TEXTOS.encalada[0], color: T.rojo, px: 74, y: 86 },
    { texto: TEXTOS.encalada[1], color: T.anil, px: 50, y: 170, ancho: w * .8 }
  ]);
  const { brochazos, huecos, chorreon } = planEncalada(w, h);
  for (const b of brochazos) {
    c.save(); c.translate(0, b.y); c.rotate(b.giro); c.globalAlpha = b.alfa;
    c.fillStyle = CAL; c.beginPath();
    for (let x = b.desde; x <= b.hasta; x += 16) c.lineTo(x, -b.alto / 2 + Math.sin(x * .05 + b.fase) * 2.5);
    for (let x = b.hasta; x >= b.desde; x -= 16) c.lineTo(x, b.alto / 2 + Math.sin(x * .04 + b.fase * 2) * 2.5);
    c.closePath(); c.fill();
    const punta = b.sentido > 0 ? b.hasta : b.desde;
    for (const cerda of b.cerdas) linea(c, CAL, cerda.grueso, [punta - b.sentido * 6, cerda.y, punta + b.sentido * cerda.largo, cerda.y + cerda.grueso]);
    c.globalAlpha = 1;
    for (const pelo of b.pelos) linea(c, pelo.claro ? 'rgba(232,226,208,.14)' : 'rgba(70,60,46,.1)', 1.5, [b.desde + 10, pelo.y, b.hasta - 10, pelo.y + 1]);
    c.restore();
  }
  const g = c.createLinearGradient(0, 0, 0, chorreon.largo);
  g.addColorStop(0, 'rgba(62,52,38,.45)'); g.addColorStop(1, 'rgba(62,52,38,0)');
  forma(c, g, [chorreon.x - chorreon.ancho / 2, 0, chorreon.x + chorreon.ancho / 2, 0,
    chorreon.x + chorreon.deriva + chorreon.ancho * .2, chorreon.largo, chorreon.x + chorreon.deriva - chorreon.ancho * .15, chorreon.largo]);
  for (const hueco of huecos) {
    const cx = hueco.filter((_, i) => i % 2 === 0).reduce((a, v) => a + v, 0) / (hueco.length / 2);
    const cy = hueco.filter((_, i) => i % 2).reduce((a, v) => a + v, 0) / (hueco.length / 2);
    forma(c, 'rgba(212,204,184,.55)', hueco.map((v, i) => (i % 2 ? cy : cx) + (v - (i % 2 ? cy : cx)) * 1.2));
  }
  c.globalCompositeOperation = 'destination-out';
  for (const hueco of huecos) forma(c, '#000', hueco);
  c.globalCompositeOperation = 'source-over';
}

/** Rayones de aerosol para los pilares: cada uno a su manera, sin fondo, directo sobre el concreto. */
function rayonLavado(c, w, h, azar) {
  c.globalAlpha = .62;
  const puntos = [14, h * .62];
  for (let k = 1; k < 12; k++) puntos.push(14 + k * (w - 28) / 11, h * (.38 + azar() * .42));
  linea(c, '#2a3046', 7, puntos);
  linea(c, '#2a3046', 4, [w * .2, h * .8, w * .34, h * .3, w * .46, h * .78]);
  c.globalAlpha = 1;
}
function rayonFirma(c, w, h, azar) {
  c.save(); c.translate(18, h * .78); c.rotate(-.12); c.font = `italic 900 76px ${MANO}`;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
  c.lineWidth = 10; c.strokeStyle = 'rgba(180,182,184,.8)'; c.strokeText(TEXTOS.rayones[0], 0, 0);
  c.fillStyle = '#1d1c20'; c.fillText(TEXTOS.rayones[0], 0, 0);
  c.restore();
  for (let i = 0; i < 6; i++) {
    const x = 30 + azar() * (w - 60);
    linea(c, 'rgba(29,28,32,.8)', 3, [x, h * .7, x + 1, h * .7 + 12 + azar() * 30]);
  }
}
function rayonCorona(c, w, h, azar) {
  c.globalAlpha = .78;
  linea(c, '#7a2f24', 6, [w * .3, h * .82, w * .26, h * .3, w * .38, h * .52, w * .5, h * .18, w * .62, h * .52, w * .74, h * .3, w * .7, h * .82, w * .3, h * .82]);
  for (const x of [.2, .5, .8]) elipse(c, w * x, h * .12 + azar() * 6, 6, 6, 0, '#7a2f24');
  c.font = `italic 900 30px ${MANO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#7a2f24'; c.fillText(TEXTOS.rayones[1], w * .5, h * .6);
  c.globalAlpha = 1;
}
function rayonTapado(c, w, h, azar) {
  c.globalAlpha = .55;
  linea(c, '#24242a', 9, [20, h * .7, 70, h * .25, 110, h * .7, 150, h * .3, 200, h * .66, 236, h * .35]);
  c.globalAlpha = .86;
  c.fillStyle = '#9a988d';
  for (let y = 10; y < h - 10; y += 12) c.fillRect(10 + azar() * 14, y, w - 30 - azar() * 30, 13);
  c.globalAlpha = 1;
}

const PINTORES = {
  colibri, frailejon, cerros, copeton,
  montallantas: (c, w, h, azar) => rotulo(c, w, h, azar, '#d6b25e', [
    { texto: TEXTOS.montallantas[0], color: T.anil, sombra: T.teja, px: 104, y: 104, x: w / 2 + 80, ancho: w * .74 },
    { texto: TEXTOS.montallantas[1], color: T.noche, px: 46, y: 204, x: w / 2 + 80, ancho: w * .74 }
  ], () => {
    c.fillStyle = T.teja; c.fillRect(4, 6, w - 8, 12); c.fillRect(4, h - 18, w - 8, 12);
    elipse(c, 104, 128, 76, 76, 0, T.noche); elipse(c, 104, 128, 44, 44, 0, '#8d8a84'); elipse(c, 104, 128, 14, 14, 0, T.noche);
  }),
  lote: (c, w, h, azar) => rotulo(c, w, h, azar, T.hueso, [
    { texto: TEXTOS.lote[0], color: T.rojo, px: 118, y: 106 },
    { texto: TEXTOS.lote[1], color: T.noche, px: 46, y: 208, ancho: w * .8 }
  ]),
  basura: (c, w, h, azar) => rotulo(c, w, h, azar, T.hueso, [
    { texto: TEXTOS.basura[0], color: T.noche, px: 92, y: 88 },
    { texto: TEXTOS.basura[1], color: T.rojo, px: 74, y: 186 }
  ]),
  firmas, carteles, encalada, rayonLavado, rayonFirma, rayonCorona, rayonTapado,
  parquear: (c, w, h, azar) => rotulo(c, w, h, azar, '#c4bba5', [
    { texto: TEXTOS.parquear[0], color: '#7c2a25', px: 112, y: 100 },
    { texto: TEXTOS.parquear[1], color: T.noche, px: 42, y: 204, ancho: w * .78 }
  ], () => { c.fillStyle = 'rgba(39,38,43,.85)'; c.fillRect(4, 6, 22, h - 12); c.fillRect(w - 26, 6, 22, h - 12); }),
  casa: (c, w, h, azar) => rotulo(c, w, h, azar, '#bfb7a2', [
    { texto: TEXTOS.casa[0], color: '#2c3d5e', px: 112, y: 102 },
    { texto: TEXTOS.casa[1], color: '#6a2b26', px: 44, y: 206, ancho: w * .72 }
  ]),
  soldadura: (c, w, h, azar) => rotulo(c, w, h, azar, '#a9a08a', [
    { texto: TEXTOS.soldadura[0], color: T.noche, sombra: '#7f8a86', px: 78, y: 92 },
    { texto: TEXTOS.soldadura[1], color: '#5a2420', px: 34, y: 180, ancho: w * .86 }
  ], () => { linea(c, 'rgba(39,38,43,.7)', 5, [24, 226, w - 24, 226]); }),
  modista: (c, w, h, azar) => rotulo(c, w, h, azar, '#b9a7a0', [
    { texto: TEXTOS.modista[0], color: '#5b2a3e', px: 70, y: 90 },
    { texto: TEXTOS.modista[1], color: T.noche, px: 32, y: 176, ancho: w * .86 }
  ], () => { linea(c, 'rgba(91,42,62,.55)', 4, [40, 132, w * .3, 140, w * .55, 128, w - 40, 138]); }),
  bazar: (c, w, h, azar) => rotulo(c, w, h, azar, '#9fae9c', [
    { texto: TEXTOS.bazar[0], color: '#3f2a20', sombra: 'rgba(230,220,190,.35)', px: 78, y: 90 },
    { texto: TEXTOS.bazar[1], color: T.noche, px: 32, y: 178, ancho: w * .86 }
  ], () => { for (let x = 18; x < w; x += 46) elipse(c, x, 26, 12, 8, 0, x % 92 < 46 ? '#8f4a3a' : '#c7a24f'); })
};
const DESGASTE = {
  aviso: { hiladas: .2, desconchones: 260, borde: 10 }, firmas: { hiladas: .22, desconchones: 120, borde: 0 },
  carteles: { hiladas: 0, desconchones: 40, borde: 5 }, mural: { hiladas: .15, desconchones: 170, borde: 12 },
  tapada: { hiladas: .18, desconchones: 90, borde: 16 },
  rayon: { hiladas: 0, desconchones: 60, borde: 0 }
};
const NOMBRES = Object.keys(PIEZAS);
const semillaDe = (nombre) => 0xc01a7a5 + (NOMBRES.indexOf(nombre) + 1) * 0x9e3779b9;

/** El contorno que deja el borde comido de una pieza, o null si no se le come. */
export function orillaDe(nombre) {
  const { celda: [, , w, h], tipo } = PIEZAS[nombre], { borde } = DESGASTE[tipo];
  return borde ? bordeComido(w, h, azarDe(semillaDe(nombre) ^ 0x5bd1e995), borde) : null;
}
const PINCEL = ['fillRect', 'fillText', 'strokeText', 'measureText', 'save', 'restore', 'translate', 'rotate', 'scale', 'clip',
  'beginPath', 'moveTo', 'lineTo', 'closePath', 'ellipse', 'quadraticCurveTo', 'fill', 'stroke', 'rect', 'createLinearGradient'];

/** Pinta la carta en un lienzo. Sin lienzo (las pruebas en Node) devuelve null y las piezas salen sin pintura. */
export function texturaDeCulatas() {
  if (typeof document === 'undefined') return null;
  const lienzo = document.createElement?.('canvas'), c = lienzo?.getContext?.('2d');
  if (!PINCEL.every((orden) => typeof c?.[orden] === 'function')) return null;
  lienzo.width = ANCHO; lienzo.height = ALTO;
  for (const [nombre, { celda: [x, y, w, h], tipo }] of Object.entries(PIEZAS)) {
    const azar = azarDe(semillaDe(nombre));
    c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, w, h); c.clip();
    PINTORES[nombre](c, w, h, azar);
    gastar(c, w, h, azar, DESGASTE[tipo], orillaDe(nombre));
    c.restore();
  }
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  return textura;
}
