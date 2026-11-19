// Celdas de los locales de barrio dentro del atlas de mobiliario: muros del primer piso, persianas, rótulos
// pintados a mano, lo que se ve tras la persiana abierta y lo que el local saca al andén.
// Todo lleva polvo abajo, pintura caída y sol encima: nada sale limpio ni de color pleno.
import { NOMBRES_DE_AVISO, OFICIOS } from './Locales.js';

export const MUROS = ['muroCrema', 'muroMenta', 'muroBaldosin', 'muroOcre', 'muroAzul', 'muroRosa'];
export const PERSIANAS = ['persianaGris', 'persianaVerde', 'persianaAzul', 'persianaRoja', 'persianaOcre'];
const INTERIORES = ['abarrotes', 'botellas', 'farmacia', 'pan', 'carne', 'fruta', 'pollos', 'mesas',
  'taller', 'ferre', 'ropa', 'barberia', 'cabinas', 'billar', 'oficina', 'chatarra'];
const PIEZAS = ['canastaRoja', 'canastaAmarilla', 'canastaAzul', 'guacal', 'frutas', 'matera', 'planta', 'cruz',
  'barbero', 'toldoVerde', 'toldoLona', 'zinc', 'sillaRoja', 'pila'];

/** Ancho que los locales añaden a la derecha del atlas, en unidades de diseño. */
export const LOCAL_W = 512;

/** Rectángulos [x, y, ancho, alto] en unidades de diseño; `x0` es donde termina el atlas anterior. */
export function localRects(x0) {
  const rects = {};
  MUROS.forEach((name, i) => { rects[name] = [x0 + i * 64, 0, 64, 96]; });
  [['arrienda', 384, 0], ['vende', 448, 0], ['almuerzo', 384, 48], ['tijera', 448, 48]]
    .forEach(([name, x, y]) => { rects[name] = [x0 + x, y, 64, 48]; });
  PERSIANAS.forEach((name, i) => { rects[name] = [x0 + i * 64, 96, 64, 80]; });
  ['nevera', 'afiches', 'reja'].forEach((name, i) => { rects[name] = [x0 + 320 + i * 64, 96, 64, 80]; });
  OFICIOS.forEach((oficio, i) => { rects[`rot_${oficio.id}`] = [x0 + (i % 4) * 128, 176 + Math.floor(i / 4) * 32, 128, 32]; });
  PIEZAS.forEach((name, i) => { rects[name] = [x0 + (i % 8) * 64, 400 + Math.floor(i / 8) * 56, 64, 56]; });
  // Dos interiores más, en el hueco que dejan las piezas.
  ['recepcion', 'papeleria'].forEach((name, i) => { rects[name] = [x0 + 384 + i * 64, 456, 64, 56]; });
  // Las dos filas que el atlas anterior dejaba libres encima de los portales.
  INTERIORES.forEach((name, i) => { rects[name] = [(i % 8) * 64, 256 + Math.floor(i / 8) * 64, 64, 64]; });
  return rects;
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

function grano(ctx, [x, y, w, h], r, count, colors, size = 2, stretch = 1) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = .5 + r() * size;
    ctx.fillRect(x + r() * (w - s), y + r() * (h - s * stretch), s, s * stretch);
  }
}

function dentro(ctx, [x, y, w, h], draw) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  draw();
  ctx.restore();
}

/** Polvo que sube del andén, chorreones que bajan y grano: lo que quita el aspecto de recién pintado. */
function mugre(ctx, rect, r, fuerza = 1) {
  const [x, y, w, h] = rect;
  const polvo = ctx.createLinearGradient(0, y + h * .6, 0, y + h);
  polvo.addColorStop(0, 'rgba(60,50,38,0)'); polvo.addColorStop(1, `rgba(60,50,38,${Math.min(.8, .5 * fuerza).toFixed(2)})`);
  ctx.fillStyle = polvo; ctx.fillRect(x, y + h * .6, w, h * .4);
  for (let i = 0; i < 4 * fuerza; i++) {
    const sx = x + r() * (w - 4), largo = h * (.2 + r() * .55);
    const chorro = ctx.createLinearGradient(0, y, 0, y + largo);
    chorro.addColorStop(0, 'rgba(42,36,28,.2)'); chorro.addColorStop(1, 'rgba(42,36,28,0)');
    ctx.fillStyle = chorro; ctx.fillRect(sx, y, 1 + r() * 3, largo);
  }
  grano(ctx, rect, r, w * h / 22 * fuerza, ['rgba(40,34,26,.09)', 'rgba(255,250,235,.05)', 'rgba(70,60,44,.07)'], 1.5);
}

/** Pintura caída: parches pequeños e irregulares del color que hay debajo. */
function desconche(ctx, [x, y, w, h], r, count, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const cx = x + r() * w, cy = y + r() * h;
    for (let k = 0; k < 4; k++) ctx.fillRect(cx + (r() - .5) * 6, cy + (r() - .5) * 4, 1 + r() * 3.5, .8 + r() * 2.5);
  }
}

function letra(ctx, text, cx, cy, size, color, max, { sombra = null, fuente = '"Arial Narrow", Arial, sans-serif', peso = 900 } = {}) {
  ctx.font = `${peso} ${size}px ${fuente}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (sombra) { ctx.fillStyle = sombra; ctx.fillText(text, cx + size * .07, cy + size * .08, max); }
  ctx.fillStyle = color; ctx.fillText(text, cx, cy, max);
}

function muro(ctx, rect, r, arriba, zocalo, { baldosin = null, ladrillo = false } = {}) {
  const [x, y, w, h] = rect, corte = y + h * .64;
  ctx.fillStyle = arriba; ctx.fillRect(x, y, w, h);
  if (ladrillo) {
    ctx.fillStyle = 'rgba(60,40,30,.2)';
    for (let row = 0, by = y; by < corte; row++, by += 4) {
      ctx.fillRect(x, by, w, .6);
      for (let bx = x + (row % 2 ? 6 : 0); bx < x + w; bx += 12) ctx.fillRect(bx, by, .6, 4);
    }
  }
  // Parches de otra mano de pintura: nunca queda parejo.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,248,230,.07)' : 'rgba(60,52,40,.07)';
    ctx.fillRect(x + r() * w * .7, y + r() * h * .55, w * (.2 + r() * .4), h * (.06 + r() * .14));
  }
  ctx.fillStyle = zocalo; ctx.fillRect(x, corte, w, y + h - corte);
  if (baldosin) {
    // Baldosín de 10 cm: un tono base y piezas repuestas de otro lote, con la junta negra de mugre.
    for (let ty = corte, row = 0; ty < y + h; ty += 3.2, row++) for (let tx = x, col = 0; tx < x + w; tx += 3.2, col++) {
      ctx.fillStyle = r() < .12 ? 'rgba(205,200,186,.9)' : (row + col) % 2 ? baldosin : 'rgba(150,170,178,.9)';
      ctx.fillRect(tx + .25, ty + .25, 2.7, 2.7);
      if (r() < .06) { ctx.fillStyle = 'rgba(70,62,50,.5)'; ctx.fillRect(tx + .25, ty + .25, 2.7, 2.7); }
    }
  } else {
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x, corte, w, 1);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x, corte + 1, w, .6);
  }
  desconche(ctx, [x, corte - 4, w, 9], r, 7, 'rgba(168,160,142,.5)');
  desconche(ctx, [x, y + h - 12, w, 12], r, 10, 'rgba(104,96,82,.55)');
  desconche(ctx, [x, y + 5, w, h * .55], r, 4, 'rgba(176,170,154,.32)');
  // Filete del color del zócalo donde termina la pintura, y lo que escurre de él con cada aguacero.
  ctx.fillStyle = zocalo; ctx.fillRect(x, y, w, 3.2);
  ctx.fillStyle = 'rgba(255,250,235,.14)'; ctx.fillRect(x, y, w, .7);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x, y + 3.2, w, .8);
  for (let i = 0; i < 9; i++) {
    const sx = x + r() * (w - 3), largo = h * (.08 + r() * .3), ancho = 1 + r() * 3.5;
    const chorro = ctx.createLinearGradient(0, y + 4, 0, y + 4 + largo);
    chorro.addColorStop(0, 'rgba(38,33,26,.34)'); chorro.addColorStop(1, 'rgba(38,33,26,0)');
    ctx.fillStyle = chorro; ctx.fillRect(sx, y + 4, ancho, largo);
  }
  // Salpicadura del andén: barro seco que sube un palmo.
  grano(ctx, [x, y + h - 9, w, 9], r, 70, ['rgba(74,62,46,.4)', 'rgba(92,80,62,.3)', 'rgba(50,42,32,.3)'], 2.2);
  mugre(ctx, rect, r, 1.5);
}

function persiana(ctx, rect, r, color, oxido = .5) {
  const [x, y, w, h] = rect;
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  for (let ly = y; ly < y + h - 5; ly += 2.5) {
    ctx.fillStyle = 'rgba(20,22,20,.3)'; ctx.fillRect(x, ly, w, .7);
    ctx.fillStyle = 'rgba(240,236,220,.16)'; ctx.fillRect(x, ly + .8, w, .6);
  }
  // Abolladuras y lamas de otro tono, cambiadas tras algún golpe.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,245,.08)' : 'rgba(0,0,0,.1)';
    ctx.fillRect(x, y + Math.floor(r() * (h - 14) / 2.5) * 2.5, w, 2.5 * (1 + Math.floor(r() * 3)));
  }
  ctx.fillStyle = 'rgba(20,20,18,.55)'; ctx.fillRect(x, y, 2, h); ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = 'rgba(30,30,28,.5)'; ctx.fillRect(x + 2, y + h - 5, w - 4, 5);
  ctx.fillStyle = '#b9a45a'; ctx.fillRect(x + w / 2 - 2, y + h - 7, 4, 4);
  ctx.fillStyle = '#3a3a36'; ctx.fillRect(x + w / 2 - 1, y + h - 9, 2, 2);
  const herrumbre = ctx.createLinearGradient(0, y + h * .55, 0, y + h);
  herrumbre.addColorStop(0, 'rgba(110,66,36,0)'); herrumbre.addColorStop(1, `rgba(110,66,36,${oxido})`);
  ctx.fillStyle = herrumbre; ctx.fillRect(x, y + h * .55, w, h * .45);
  grano(ctx, [x, y + h * .5, w, h * .5], r, 90, ['rgba(120,70,36,.4)', 'rgba(60,40,28,.3)'], 1.8);
  // Rayón viejo de aerosol, ya lavado por la lluvia.
  ctx.strokeStyle = pick(r, ['rgba(232,226,206,.2)', 'rgba(30,30,34,.2)', 'rgba(150,60,50,.2)']); ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x + 8 + r() * 10, y + 30 + r() * 14);
  for (let i = 1; i < 6; i++) ctx.lineTo(x + 8 + i * 8 + r() * 5, y + 26 + r() * 22);
  ctx.stroke();
  mugre(ctx, rect, r, .8);
}

function rotulo(ctx, rect, r, oficio) {
  const [x, y, w, h] = rect;
  ctx.fillStyle = oficio.fondo; ctx.fillRect(x, y, w, h);
  // El sol quema más arriba, donde no llega la sombra del alero.
  const sol = ctx.createLinearGradient(0, y, 0, y + h);
  sol.addColorStop(0, 'rgba(255,246,222,.24)'); sol.addColorStop(1, 'rgba(40,30,20,.14)');
  ctx.fillStyle = sol; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = oficio.tinta; ctx.lineWidth = 1.1; ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
  letra(ctx, oficio.titulo, x + w / 2, y + h * .4, oficio.titulo.length > 11 ? 13 : 15.5, oficio.tinta, w - 12, { sombra: 'rgba(0,0,0,.34)' });
  letra(ctx, oficio.nombres[NOMBRES_DE_AVISO], x + w / 2, y + h * .78, 7.5, oficio.acento, w - 16, { fuente: 'Georgia, "Times New Roman", serif', peso: 'italic 700' });
  // Pintura gastada a brochazos, polvo que se asienta arriba y esquinas quemadas por el sol y el óxido. El texto,
  // en el centro, queda casi limpio para que se siga leyendo.
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(206,198,176,${(.06 + r() * .1).toFixed(2)})`;
    ctx.fillRect(x + r() * (w - 20), y + 2 + r() * (h - 5), 8 + r() * 22, .7 + r() * 1.2);
  }
  const polvo = ctx.createLinearGradient(0, y, 0, y + h * .45);
  polvo.addColorStop(0, 'rgba(150,138,112,.34)'); polvo.addColorStop(1, 'rgba(150,138,112,0)');
  ctx.fillStyle = polvo; ctx.fillRect(x, y, w, h * .45);
  dentro(ctx, rect, () => {
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      const radio = 12 + r() * 10, quemado = ctx.createRadialGradient(cx, cy, 1, cx, cy, radio);
      quemado.addColorStop(0, 'rgba(46,32,20,.62)'); quemado.addColorStop(1, 'rgba(46,32,20,0)');
      ctx.fillStyle = quemado; ctx.fillRect(cx - radio, cy - radio, radio * 2, radio * 2);
    }
  });
  desconche(ctx, rect, r, 4, 'rgba(188,180,162,.4)');
  desconche(ctx, [x, y, 14, h], r, 3, 'rgba(104,70,44,.5)');
  desconche(ctx, [x + w - 14, y, 14, h], r, 3, 'rgba(104,70,44,.5)');
  desconche(ctx, [x, y + h - 6, w, 6], r, 5, 'rgba(92,80,64,.4)');
  mugre(ctx, rect, r, .9);
}

/** Fondo de todo interior: la luz de la calle entra por abajo y el fondo se pierde. */
function fondoInterior(ctx, [x, y, w, h], tono = '#2c2823', piso = '#5d564b') {
  const sombra = ctx.createLinearGradient(0, y, 0, y + h);
  sombra.addColorStop(0, '#15130f'); sombra.addColorStop(.75, tono); sombra.addColorStop(1, tono);
  ctx.fillStyle = sombra; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = piso; ctx.fillRect(x, y + h - 7, w, 7);
}

function estantes(ctx, [x, y, w, h], r, colores, { filas = 4, alto = 8, tabla = '#6a5540', botellas = false, hasta = h - 20 } = {}) {
  const paso = hasta / filas;
  for (let f = 0; f < filas; f++) {
    const base = y + 4 + (f + 1) * paso;
    ctx.fillStyle = tabla; ctx.fillRect(x + 3, base, w - 6, 1.4);
    for (let px = x + 4; px < x + w - 6;) {
      const pw = botellas ? 2 + r() * 1.2 : 2.5 + r() * 4, ph = alto * (.55 + r() * .45);
      ctx.fillStyle = pick(r, colores); ctx.fillRect(px, base - ph, pw, ph);
      if (botellas) ctx.fillRect(px + pw * .3, base - ph - 2, pw * .4, 2);
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(px, base - ph, .6, ph);
      px += pw + .8 + (r() < .12 ? 3 : 0);
    }
  }
}

function mostrador(ctx, [x, y, w, h], cuerpo, franja, vitrina = false) {
  ctx.fillStyle = cuerpo; ctx.fillRect(x + 2, y + h - 21, w - 4, 15);
  ctx.fillStyle = franja; ctx.fillRect(x + 2, y + h - 21, w - 4, 2.5);
  if (vitrina) { ctx.fillStyle = 'rgba(170,196,204,.3)'; ctx.fillRect(x + 5, y + h - 17, w - 10, 8); }
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x + 2, y + h - 7, w - 4, 1.2);
}

const INTERIOR = {
  abarrotes(ctx, rect, r) {
    fondoInterior(ctx, rect);
    estantes(ctx, rect, r, ['#b0483a', '#c9a23c', '#4f7f52', '#3f6a94', '#d8d0b8', '#a8652f', '#7a4a70']);
    mostrador(ctx, rect, '#b8ad92', '#8a3b2e', true);
    const [x, y, , h] = rect;
    for (let i = 0; i < 6; i++) { ctx.fillStyle = pick(r, ['#c9a23c', '#b0483a', '#d8d0b8']); ctx.fillRect(x + 8 + i * 8, y + h - 15, 5, 5); }
  },
  botellas(ctx, rect, r) {
    fondoInterior(ctx, rect, '#2a2420');
    estantes(ctx, rect, r, ['#7a4a22', '#3f6a3c', '#b89a4a', '#c8c4b0', '#5a2a22', '#2f4a5a'], { botellas: true, alto: 9 });
    mostrador(ctx, rect, '#5d4634', '#b89a4a');
  },
  farmacia(ctx, rect, r) {
    fondoInterior(ctx, rect, '#4a4c48', '#7b7a72');
    estantes(ctx, rect, r, ['#e2ded0', '#cfd8d0', '#7fa98a', '#8aa6c0', '#e2ded0', '#d9b8b0'], { tabla: '#c9c5b6', alto: 6, filas: 5 });
    mostrador(ctx, rect, '#d6d2c2', '#3d7a52', true);
  },
  pan(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#4a3526', '#6a5a48');
    for (let f = 0; f < 3; f++) {
      const base = y + 14 + f * 11;
      ctx.fillStyle = '#7a5a3c'; ctx.fillRect(x + 4, base, w - 8, 1.4);
      for (let px = x + 6; px < x + w - 8; px += 5 + r() * 3) {
        ctx.fillStyle = pick(r, ['#c8923e', '#b47a34', '#d8a654', '#9a642a']);
        ctx.beginPath(); ctx.ellipse(px, base - 2.4, 2.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    mostrador(ctx, rect, '#c9bda0', '#8a5a2c', true);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = pick(r, ['#c8923e', '#d8a654', '#a86c2c']);
      ctx.beginPath(); ctx.ellipse(x + 8 + i * 6, y + h - 12.5, 2.4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    }
  },
  carne(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#8f928a', '#6f6e66');
    ctx.fillStyle = 'rgba(40,44,42,.22)';
    for (let i = 0; i < 12; i++) { ctx.fillRect(x, y + i * 4, w, .5); ctx.fillRect(x + i * 6, y, .5, h - 21); }
    ctx.fillStyle = '#4a4c4a'; ctx.fillRect(x + 4, y + 9, w - 8, 1.5);
    for (let i = 0; i < 6; i++) {
      const cx = x + 9 + i * 9, largo = 12 + r() * 9;
      ctx.fillStyle = '#3a3c3a'; ctx.fillRect(cx, y + 10, .8, 3);
      ctx.fillStyle = pick(r, ['#8e2f2a', '#a23c33', '#7a2622']);
      ctx.beginPath(); ctx.ellipse(cx, y + 13 + largo / 2, 2.8, largo / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(236,222,200,.6)'; ctx.fillRect(cx - 1.6, y + 14 + r() * 4, 1, largo * .6);
    }
    mostrador(ctx, rect, '#d9d5c8', '#9a3229', true);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = pick(r, ['#9a3229', '#b04a3c', '#c9a59a']); ctx.fillRect(x + 7 + i * 7.5, y + h - 15.5, 5.5, 4.5); }
  },
  fruta(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#2e2a22');
    for (let f = 0; f < 4; f++) {
      const top = y + 12 + f * 12;
      ctx.fillStyle = '#7b6344'; ctx.fillRect(x + 3 + f * 1.5, top + 6, w - 6 - f * 3, 5);
      for (let px = x + 5 + f * 1.5; px < x + w - 6 - f * 1.5; px += 3.2) {
        ctx.fillStyle = pick(r, f % 2 ? ['#c9882a', '#d2a23a', '#b9502c'] : ['#6f9a3a', '#b23a2e', '#d6c14a', '#7a3a6a']);
        ctx.beginPath(); ctx.arc(px, top + 4.4 - r() * 1.6, 1.7, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let i = 0; i < 5; i++) { ctx.fillStyle = '#c9b23c'; ctx.fillRect(x + 8 + i * 11, y + 2, 1.6, 7 + r() * 3); }
  },
  pollos(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#3a2c22');
    ctx.fillStyle = '#4a4c4c'; ctx.fillRect(x + 6, y + 6, w * .55, h - 30);
    const brasa = ctx.createLinearGradient(0, y + 8, 0, y + h - 24);
    brasa.addColorStop(0, '#5a2a14'); brasa.addColorStop(1, '#b3541e');
    ctx.fillStyle = brasa; ctx.fillRect(x + 8, y + 8, w * .55 - 4, h - 34);
    for (let f = 0; f < 3; f++) {
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x + 8, y + 14 + f * 9, w * .55 - 4, .8);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = pick(r, ['#b8762a', '#a8641f', '#c98a34']);
        ctx.beginPath(); ctx.ellipse(x + 12 + i * 6, y + 14 + f * 9, 2.6, 2.9, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    estantes(ctx, [x + w * .62, y, w * .38, h], r, ['#c9a23c', '#d8d0b8', '#b0483a'], { filas: 3 });
    mostrador(ctx, rect, '#b9ab8c', '#a8452f');
  },
  mesas(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#3a3128', '#6a5d4c');
    ctx.fillStyle = '#243a30'; ctx.fillRect(x + 8, y + 7, 20, 13);
    ctx.fillStyle = 'rgba(230,226,210,.6)'; for (let i = 0; i < 4; i++) ctx.fillRect(x + 10, y + 9 + i * 2.6, 9 + r() * 6, .7);
    for (let i = 0; i < 3; i++) {
      const mx = x + 6 + i * 20, my = y + h - 24 - (i % 2) * 6;
      ctx.fillStyle = '#a8452f'; ctx.fillRect(mx - 3, my + 2, 4, 9); ctx.fillRect(mx + 11, my + 2, 4, 9);
      ctx.fillStyle = pick(r, ['#7a5a3a', '#c9c2ac']); ctx.fillRect(mx, my, 12, 2.4);
      ctx.fillStyle = '#4a3a2a'; ctx.fillRect(mx + 5, my + 2.4, 2, 9);
    }
  },
  taller(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#26241f', '#4a463e');
    ctx.fillStyle = '#4f4636'; ctx.fillRect(x + 5, y + 6, w * .5, 18);
    ctx.fillStyle = '#9a9a92';
    for (let i = 0; i < 7; i++) ctx.fillRect(x + 8 + i * 4, y + 8 + r() * 3, 1.2, 6 + r() * 7);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#121212'; ctx.beginPath(); ctx.ellipse(x + w - 13, y + h - 12 - i * 6, 9, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3c3c3a'; ctx.beginPath(); ctx.ellipse(x + w - 13, y + h - 13 - i * 6, 4.5, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#5a4a36'; ctx.fillRect(x + 4, y + h - 22, 26, 3); ctx.fillRect(x + 6, y + h - 19, 2, 12); ctx.fillRect(x + 26, y + h - 19, 2, 12);
    ctx.fillStyle = '#a8452f'; ctx.fillRect(x + 10, y + h - 27, 7, 5);
    ctx.fillStyle = 'rgba(10,10,10,.5)'; ctx.beginPath(); ctx.ellipse(x + 30, y + h - 3, 12, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  },
  ferre(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#2e2b26');
    estantes(ctx, [x, y, w * .62, h], r, ['#8a8c88', '#b0483a', '#c9a23c', '#3f6a94', '#5a5c58'], { alto: 7 });
    ctx.fillStyle = '#d6d2c4'; for (let i = 0; i < 6; i++) ctx.fillRect(x + w * .66 + i * 3, y + 5 + r() * 4, 2, h - 30);
    ctx.strokeStyle = '#3f6a3c'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + w - 9, y + 14, 3 + i * 1.8, 0, Math.PI * 2); ctx.stroke(); }
    mostrador(ctx, rect, '#6a5a44', '#35557a');
  },
  ropa(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#3a342e', '#6a6256');
    ctx.fillStyle = '#8a8a84'; ctx.fillRect(x + 4, y + 9, w - 8, 1.2);
    for (let px = x + 6; px < x + w - 9; px += 5.5) {
      const largo = 14 + r() * 12;
      ctx.fillStyle = pick(r, ['#9a5a6a', '#4f6f8a', '#c9c0a8', '#6a7a4a', '#3a3a44', '#b08a4a']);
      ctx.beginPath(); ctx.moveTo(px + 1.4, y + 10); ctx.lineTo(px + 3.6, y + 10); ctx.lineTo(px + 5, y + 10 + largo); ctx.lineTo(px, y + 10 + largo); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#5a4634'; ctx.fillRect(x + 6, y + h - 20, 24, 2.5); ctx.fillRect(x + 8, y + h - 18, 2, 11); ctx.fillRect(x + 26, y + h - 18, 2, 11);
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(x + 12, y + h - 26, 11, 6); ctx.fillRect(x + 20, y + h - 30, 3, 5);
  },
  barberia(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#4a4640', '#77705f');
    for (let i = 0; i < 2; i++) {
      const mx = x + 7 + i * 28;
      ctx.fillStyle = '#6a5a44'; ctx.fillRect(mx - 1, y + 7, 22, 24);
      const espejo = ctx.createLinearGradient(mx, y + 8, mx + 20, y + 30);
      espejo.addColorStop(0, '#9fb2b6'); espejo.addColorStop(1, '#5f7276');
      ctx.fillStyle = espejo; ctx.fillRect(mx + 1, y + 9, 18, 20);
      ctx.fillStyle = '#c9c2ac'; ctx.fillRect(mx - 1, y + 33, 22, 1.6);
      for (let k = 0; k < 4; k++) { ctx.fillStyle = pick(r, ['#4f7f8a', '#b0483a', '#d8d0b8']); ctx.fillRect(mx + 2 + k * 4.5, y + 29.5, 2.2, 3.5); }
      ctx.fillStyle = '#7a2a26'; ctx.fillRect(mx + 4, y + h - 24, 12, 9); ctx.fillRect(mx + 5, y + h - 33, 10, 9);
      ctx.fillStyle = '#9a9a94'; ctx.fillRect(mx + 9, y + h - 15, 2, 8); ctx.fillRect(mx + 4, y + h - 8, 12, 1.4);
    }
  },
  cabinas(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#34363a', '#5a5a56');
    for (let i = 0; i < 3; i++) {
      const cx = x + 4 + i * 19.5;
      ctx.fillStyle = '#7b6a50'; ctx.fillRect(cx, y + 10, 17, h - 17);
      ctx.fillStyle = '#23262a'; ctx.fillRect(cx + 1.5, y + 12, 14, h - 21);
      ctx.fillStyle = '#8fb0c2'; ctx.fillRect(cx + 4, y + 26, 9, 7);
      ctx.fillStyle = '#c9c2ac'; ctx.fillRect(cx + 3, y + 35, 11, 1.6);
      ctx.fillStyle = '#3a3a3e'; ctx.fillRect(cx + 5, y + 40, 7, 9);
      letra(ctx, String(i + 1), cx + 8.5, y + 17, 6, '#e6d88a', 10);
    }
    grano(ctx, rect, r, 40, ['rgba(255,255,255,.05)'], 1.5);
  },
  billar(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#2a2a24', '#4f4a40');
    ctx.fillStyle = '#d8c98a'; ctx.beginPath(); ctx.moveTo(x + w / 2 - 3, y + 6); ctx.lineTo(x + w / 2 + 3, y + 6); ctx.lineTo(x + w / 2 + 9, y + 13); ctx.lineTo(x + w / 2 - 9, y + 13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(236,220,150,.1)'; ctx.beginPath(); ctx.moveTo(x + w / 2 - 9, y + 13); ctx.lineTo(x + w / 2 + 9, y + 13); ctx.lineTo(x + w - 6, y + h - 14); ctx.lineTo(x + 6, y + h - 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a3f28'; ctx.beginPath(); ctx.moveTo(x + 12, y + h - 30); ctx.lineTo(x + w - 12, y + h - 30); ctx.lineTo(x + w - 4, y + h - 13); ctx.lineTo(x + 4, y + h - 13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3d7250'; ctx.beginPath(); ctx.moveTo(x + 14, y + h - 28.5); ctx.lineTo(x + w - 14, y + h - 28.5); ctx.lineTo(x + w - 7, y + h - 15); ctx.lineTo(x + 7, y + h - 15); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 6; i++) { ctx.fillStyle = pick(r, ['#e6e0cc', '#b0483a', '#c9a23c', '#1e1e1e']); ctx.beginPath(); ctx.arc(x + 18 + r() * (w - 36), y + h - 26 + r() * 8, 1.1, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#4a3828'; ctx.fillRect(x + 8, y + h - 13, 3, 7); ctx.fillRect(x + w - 11, y + h - 13, 3, 7);
    ctx.fillStyle = '#b89a6a'; for (let i = 0; i < 4; i++) ctx.fillRect(x + 5 + i * 2.5, y + 12, .9, 22);
  },
  oficina(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#45423c', '#6f6a5e');
    estantes(ctx, [x, y, w * .5, h], r, ['#8a6a4a', '#5a6a5a', '#c9c2ac', '#6a4a3a', '#3f4f5f'], { filas: 3, alto: 8, hasta: h - 26 });
    ctx.fillStyle = '#8a8c88'; ctx.fillRect(x + w * .56, y + 14, 12, 28);
    ctx.fillStyle = '#5c5e5a'; for (let i = 0; i < 3; i++) ctx.fillRect(x + w * .56 + 1.5, y + 16 + i * 9, 9, 7);
    ctx.fillStyle = '#c9c2ac'; ctx.fillRect(x + w - 14, y + 10, 10, 13);
    ctx.fillStyle = '#5a4634'; ctx.fillRect(x + 6, y + h - 22, w - 12, 3); ctx.fillRect(x + 8, y + h - 19, w - 16, 12);
    ctx.fillStyle = '#d8d2c0'; ctx.fillRect(x + 14, y + h - 25, 9, 3); ctx.fillStyle = '#2a2c30'; ctx.fillRect(x + 34, y + h - 30, 10, 8);
  },
  chatarra(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#2a2622', '#4a443a');
    for (let i = 0; i < 70; i++) {
      const px = x + 3 + r() * (w - 10), alto = (1 - Math.abs((px - x) / w - .45) * 1.5) * (h - 22);
      const py = y + h - 7 - r() * Math.max(6, alto);
      ctx.fillStyle = pick(r, ['#6f5a48', '#8a8a84', '#7a4a2c', '#4a4a48', '#9a7a4a', '#5a6a6a']);
      ctx.save(); ctx.translate(px, py); ctx.rotate((r() - .5) * 1.6); ctx.fillRect(-3, -1, 3 + r() * 7, 1 + r() * 2.6); ctx.restore();
    }
    ctx.fillStyle = '#3f5a6a'; ctx.fillRect(x + w - 15, y + h - 26, 11, 19); ctx.fillStyle = '#d8d2c0'; ctx.fillRect(x + w - 13, y + h - 24, 7, 5);
  },
  /** Residencias: la ventanilla con reja y tablero de llaves, y la escalera que sube a las piezas. */
  recepcion(ctx, rect) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#3a332b', '#665a4a');
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#56493b' : '#6e604e';
      ctx.fillRect(x + w * .54 + i * 2, y + h - 7 - (i + 1) * 4.4, w * .46 - i * 2, 4.4);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + w * .54 + i * 2, y + h - 7 - i * 4.4 - .8, w * .46 - i * 2, .8);
    }
    ctx.fillStyle = '#8a7a5c'; ctx.save(); ctx.translate(x + w * .56, y + h - 22); ctx.rotate(-1.14); ctx.fillRect(0, 0, 34, 1.4); ctx.restore();
    ctx.fillStyle = '#231f1b'; ctx.fillRect(x + w * .5, y + 5, 2, h - 12);
    ctx.fillStyle = '#6b5640'; ctx.fillRect(x + 3, y + h - 27, w * .45, 20);
    ctx.fillStyle = '#8c765a'; ctx.fillRect(x + 2, y + h - 29, w * .47, 2.6);
    ctx.fillStyle = '#16140f'; ctx.fillRect(x + 5, y + 9, w * .4, h - 39);
    ctx.fillStyle = '#4a3a2a'; ctx.fillRect(x + 8, y + 11, 17, 9);
    ctx.fillStyle = '#c9b25a'; for (let i = 0; i < 10; i++) ctx.fillRect(x + 9.5 + (i % 5) * 3.1, y + 12.4 + Math.floor(i / 5) * 4, 1.2, 2.4);
    ctx.fillStyle = '#8f8a7c'; for (let i = 0; i < 6; i++) ctx.fillRect(x + 6.5 + i * 4.6, y + 9, .8, h - 39);
    ctx.fillStyle = '#d8d2c0'; ctx.fillRect(x + 8, y + h - 23, 10, 6);
  },
  /** Papelería: cuadernos y cartulinas en los estantes, resmas y la fotocopiadora. */
  papeleria(ctx, rect, r) {
    const [x, y, w, h] = rect;
    fondoInterior(ctx, rect, '#44403a', '#74705f');
    estantes(ctx, [x, y, w * .64, h], r, ['#b5503f', '#3f6a94', '#cdb75a', '#4f7f52', '#d8d0b8', '#7d5a8c', '#c98444'], { filas: 4, alto: 6, tabla: '#b8b2a0', hasta: h - 22 });
    for (let i = 0; i < 6; i++) { ctx.fillStyle = pick(r, ['#cdb75a', '#b5503f', '#6f9cba', '#7fae7a', '#e4decb']); ctx.fillRect(x + w * .68 + i * 3, y + 6 + r() * 3, 2.2, 15); }
    ctx.fillStyle = '#c2c0b6'; ctx.fillRect(x + w * .68, y + h - 33, 17, 13); ctx.fillStyle = '#8d8b82'; ctx.fillRect(x + w * .68 - 1, y + h - 35, 19, 3);
    ctx.fillStyle = '#34363a'; ctx.fillRect(x + w * .68 + 2, y + h - 30, 8, 3);
    ctx.fillStyle = '#ece8da'; ctx.fillRect(x + w * .68 + 3, y + h - 24, 12, 1.5);
    mostrador(ctx, rect, '#b3a98e', '#273f73', true);
    ctx.fillStyle = '#ece8da'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 8 + i * 9, y + h - 16 - i % 2, 7, 4);
  }
};

function canasta(ctx, rect, r, color) {
  const [x, y, w, h] = rect;
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) ctx.fillRect(x + 5 + i * 9.4, y + 12 + j * 13, 6.4, 9);
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(x, y + 2, w, 4);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x, y + h - 5, w, 5);
  desconche(ctx, rect, r, 8, 'rgba(230,224,208,.35)');
  mugre(ctx, rect, r, .7);
}

function toldo(ctx, rect, r, a, b) {
  const [x, y, w, h] = rect;
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i & 1 ? a : b; ctx.fillRect(x + i * w / 8, y, w / 8, h); }
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x, y + h - 9, w, 9);
  // La lona se destiñe a manchas y guarda el agua sucia en los pliegues.
  for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(236,228,206,.14)'; ctx.fillRect(x + r() * w * .8, y + r() * h * .7, w * (.1 + r() * .25), h * (.1 + r() * .2)); }
  // El sol se come el color: un velo pajizo, más fuerte arriba, deja las rayas a medio borrar.
  const sol = ctx.createLinearGradient(0, y, 0, y + h);
  sol.addColorStop(0, 'rgba(214,204,176,.5)'); sol.addColorStop(1, 'rgba(196,186,158,.26)');
  ctx.fillStyle = sol; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 9; i++) {
    const mx = x + r() * (w - 8), my = y + r() * h * .7, ancho = 3 + r() * 7, alto = 2 + r() * 5;
    ctx.fillStyle = `rgba(62,56,40,${(.1 + r() * .14).toFixed(2)})`; ctx.fillRect(mx, my, ancho, alto);
    // De cada mancha baja su escurrido hasta el borde.
    const chorro = ctx.createLinearGradient(0, my + alto, 0, y + h);
    chorro.addColorStop(0, 'rgba(52,46,34,.24)'); chorro.addColorStop(1, 'rgba(52,46,34,.04)');
    ctx.fillStyle = chorro; ctx.fillRect(mx + r() * ancho * .6, my + alto, .8 + r() * 1.6, y + h - my - alto);
  }
  // El borde de afuera, raído: mordiscos oscuros, hilachas claras y una costura.
  ctx.fillStyle = 'rgba(40,34,26,.3)'; ctx.fillRect(x, y + h - 5.5, w, .7);
  for (let bx = x; bx < x + w - 1;) {
    const paso = 1 + r() * 3.5;
    ctx.fillStyle = r() < .5 ? 'rgba(28,24,18,.55)' : 'rgba(214,206,184,.3)'; ctx.fillRect(bx, y + h - 1 - r() * 3, paso * .7, 1 + r() * 3);
    bx += paso;
  }
  mugre(ctx, rect, r, 1.5);
}

function cartel(ctx, rect, r, fondo, lineas) {
  const [x, y, w, h] = rect;
  ctx.fillStyle = fondo; ctx.fillRect(x, y, w, h);
  lineas.forEach(([text, size, color, fuente], i) => letra(ctx, text, x + w / 2, y + h * (i + .7) / (lineas.length + .4), size, color, w - 6, fuente ? { fuente, peso: 700 } : {}));
  desconche(ctx, rect, r, 6, 'rgba(120,110,92,.5)');
  mugre(ctx, rect, r, .6);
}

/** Pinta todas las celdas de los locales. `R` trae sus rectángulos y `r` el azar del atlas. */
export function drawLocales(ctx, R, r) {
  muro(ctx, R.muroCrema, r, '#c2b79c', '#70453d');
  muro(ctx, R.muroMenta, r, '#a0ad9c', '#51645a');
  muro(ctx, R.muroBaldosin, r, '#b5a67c', '#4a4840', { baldosin: 'rgba(122,140,148,.9)' });
  muro(ctx, R.muroOcre, r, '#aaa598', '#94804e');
  muro(ctx, R.muroAzul, r, '#96a6ad', '#51616d');
  muro(ctx, R.muroRosa, r, '#ad8c80', '#6f5046', { ladrillo: true });
  persiana(ctx, R.persianaGris, r, '#80837c', .62);
  persiana(ctx, R.persianaVerde, r, '#627568', .55);
  persiana(ctx, R.persianaAzul, r, '#5f707e', .55);
  persiana(ctx, R.persianaRoja, r, '#80574d', .58);
  persiana(ctx, R.persianaOcre, r, '#978862', .58);
  for (const oficio of OFICIOS) rotulo(ctx, R[`rot_${oficio.id}`], r, oficio);
  for (const [name, draw] of Object.entries(INTERIOR)) dentro(ctx, R[name], () => {
    const [x, y, w, h] = R[name];
    draw(ctx, R[name], r);
    grano(ctx, R[name], r, 120, ['rgba(0,0,0,.1)', 'rgba(255,244,220,.05)'], 1.6);
    // Marco del vano: la sombra del dintel y las jambas da el fondo que la celda plana no tiene.
    const dintel = ctx.createLinearGradient(0, y, 0, y + 9);
    dintel.addColorStop(0, 'rgba(8,8,6,.85)'); dintel.addColorStop(1, 'rgba(8,8,6,0)');
    ctx.fillStyle = dintel; ctx.fillRect(x, y, w, 9);
    ctx.fillStyle = 'rgba(14,13,11,.8)'; ctx.fillRect(x, y, 1.4, h); ctx.fillRect(x + w - 1.4, y, 1.4, h);
  });

  cartel(ctx, R.arrienda, r, '#1d1d1b', [['SE ARRIENDA', 10, '#e3c63a'], ['LOCAL', 8, '#e8e2d0'], ['INF. 555 0147', 6.5, '#c9503c']]);
  cartel(ctx, R.vende, r, '#a8372d', [['SE VENDE', 11, '#f0e8d2'], ['CASA LOTE', 7, '#f0e8d2'], ['INF. 555 0193', 6.5, '#e3c63a']]);
  cartel(ctx, R.almuerzo, r, '#27322c', [['ALMUERZO', 9, '#ece6d2', '"Comic Sans MS", "Marker Felt", cursive'], ['DEL DÍA $9.000', 6.5, '#e6d27a', '"Comic Sans MS", "Marker Felt", cursive'],
    ['sopa · seco · jugo', 6, '#d8d2c0', '"Comic Sans MS", "Marker Felt", cursive']]);
  { const [x, y, w, h] = R.almuerzo; ctx.strokeStyle = '#7a5a3c'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    grano(ctx, R.almuerzo, r, 60, ['rgba(236,230,210,.14)'], 3, .3); }
  cartel(ctx, R.tijera, r, '#b8a05a', [['PROMOCIÓN', 9.5, '#7a241c'], ['HOY', 12, '#27406a'], ['pregunte adentro', 5.5, '#3a3226', 'Georgia, serif']]);
  mugre(ctx, R.tijera, r, 1);

  { // Nevera de helados: cajón blanco con tapa corrediza; el dibujo es una paleta cualquiera.
    const [x, y, w, h] = R.nevera;
    ctx.fillStyle = '#d6d6cc'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#5f8ea8'; ctx.fillRect(x, y + 14, w, 30);
    ctx.fillStyle = '#93a8b0'; ctx.fillRect(x + 3, y + 2, w - 6, 9);
    letra(ctx, 'HELADOS', x + w / 2, y + 23, 9, '#f0ecd8', w - 10, { sombra: 'rgba(0,0,0,.3)' });
    ctx.fillStyle = '#d98a6a'; ctx.fillRect(x + 27, y + 30, 10, 9); ctx.fillStyle = '#c9b48a'; ctx.fillRect(x + 31, y + 39, 2, 4);
    ctx.fillStyle = '#3a3a38'; ctx.fillRect(x, y + h - 8, w, 8);
    desconche(ctx, R.nevera, r, 10, 'rgba(140,110,80,.5)');
    mugre(ctx, R.nevera, r, 1);
  }
  { // Afiches pegados uno sobre otro y medio arrancados.
    const [x, y, w, h] = R.afiches;
    ctx.fillStyle = '#b9b2a0'; ctx.fillRect(x, y, w, h);
    const papeles = [['#c9a83a', 'GRAN BAILE'], ['#b8584a', 'BINGO'], ['#d8d2bc', 'SE BUSCA'], ['#5f8a9a', 'FERIA'], ['#c98a4a', 'RIFA']];
    papeles.forEach(([color, texto], i) => {
      const px = x + 2 + (i % 2) * 30 + r() * 3, py = y + 2 + Math.floor(i / 2) * 25 + r() * 3;
      ctx.save(); ctx.translate(px + 14, py + 12); ctx.rotate((r() - .5) * .12);
      ctx.fillStyle = color; ctx.fillRect(-14, -12, 28, 24);
      letra(ctx, texto, 0, -4, 5.5, '#26221c', 26);
      ctx.fillStyle = 'rgba(38,34,28,.5)'; for (let k = 0; k < 3; k++) ctx.fillRect(-10, 2 + k * 3, 14 + r() * 6, .8);
      ctx.restore();
    });
    desconche(ctx, R.afiches, r, 26, 'rgba(196,190,174,.9)');
    mugre(ctx, R.afiches, r, .9);
  }
  dentro(ctx, R.reja, () => { // Ventanilla con reja: se atiende sin abrir.
    const [x, y, w, h] = R.reja;
    fondoInterior(ctx, R.reja, '#2e2a24');
    estantes(ctx, [x, y, w, h + 14], r, ['#b0483a', '#c9a23c', '#4f7f52', '#3f6a94', '#d8d0b8'], { filas: 5 });
    ctx.fillStyle = '#6f6a5e'; ctx.fillRect(x, y + h - 24, w, 24);
    ctx.fillStyle = '#17181a'; ctx.fillRect(x + 22, y + h - 40, 20, 14);
    ctx.fillStyle = '#1c1d1f';
    for (let i = 0; i <= 12; i++) ctx.fillRect(x + i * (w - 1.6) / 12, y, 1.6, h - 24);
    for (const v of [.02, .3, .62]) ctx.fillRect(x, y + h * v, w, 1.8);
    mugre(ctx, R.reja, r, .8);
  });

  canasta(ctx, R.canastaRoja, r, '#a83c30');
  canasta(ctx, R.canastaAmarilla, r, '#c39a2e');
  canasta(ctx, R.canastaAzul, r, '#3f5f8a');
  { const [x, y, w, h] = R.guacal;
    ctx.fillStyle = '#3a2e22'; ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = pick(r, ['#a88a5c', '#98794e', '#b3966a']); ctx.fillRect(x, y + 2 + i * 14, w, 10); }
    ctx.fillStyle = '#8a6c44'; ctx.fillRect(x, y, 5, h); ctx.fillRect(x + w - 5, y, 5, h);
    mugre(ctx, R.guacal, r, .9); }
  { const [x, y, w, h] = R.frutas;
    ctx.fillStyle = '#4a3c2a'; ctx.fillRect(x, y, w, h);
    for (let row = 0; row < 7; row++) for (let col = 0; col < 8; col++) {
      const tono = col < 3 ? ['#c98a2a', '#d29a34', '#b97a24'] : col < 5 ? ['#a83a30', '#b84a3a', '#8f2f2a'] : ['#7a9a3c', '#d6c14a', '#6a8a34'];
      ctx.fillStyle = pick(r, tono);
      ctx.beginPath(); ctx.arc(x + 4.5 + col * 7.8 + (row % 2) * 2, y + 4.5 + row * 7.6, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,240,.2)'; ctx.fillRect(x + 3.5 + col * 7.8 + (row % 2) * 2, y + 2.6 + row * 7.6, 1.4, 1.2);
    }
    ctx.fillStyle = '#3a2e22'; ctx.fillRect(x + 23, y, 1.6, h); ctx.fillRect(x + 39.5, y, 1.6, h); }
  { ctx.fillStyle = '#a8603c'; ctx.fillRect(...R.matera);
    const [x, y, w, h] = R.matera; ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x, y + 8, w, 2); ctx.fillStyle = 'rgba(236,224,200,.3)'; ctx.fillRect(x, y + 2, w, 5);
    grano(ctx, R.matera, r, 80, ['rgba(220,214,196,.3)', 'rgba(60,40,28,.3)'], 3);
    mugre(ctx, R.matera, r, .8); }
  { ctx.fillStyle = '#3f6a3a'; ctx.fillRect(...R.planta);
    const [x, y, w, h] = R.planta;
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = pick(r, ['#4a7340', '#345c34', '#5d8246', '#2c4f2e', '#41683a']);
      ctx.save(); ctx.translate(x + r() * w, y + r() * h); ctx.rotate(r() * 3.1); ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 1, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    } }
  { const [x, y, w, h] = R.cruz;
    ctx.fillStyle = '#d9d6c8'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#3d7a52'; ctx.fillRect(x + w / 2 - 7, y + 8, 14, h - 16); ctx.fillRect(x + 12, y + h / 2 - 7, w - 24, 14);
    ctx.strokeStyle = '#3d7a52'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
    desconche(ctx, R.cruz, r, 8, 'rgba(150,146,132,.6)');
    mugre(ctx, R.cruz, r, .6); }
  dentro(ctx, R.barbero, () => {
    const [x, y, w, h] = R.barbero;
    ctx.fillStyle = '#d9d4c4'; ctx.fillRect(x, y, w, h);
    for (let i = -4; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#a83c34' : '#3f5f8a';
      ctx.beginPath(); ctx.moveTo(x + i * 14, y + h); ctx.lineTo(x + i * 14 + 6, y + h); ctx.lineTo(x + i * 14 + 6 + h * .6, y); ctx.lineTo(x + i * 14 + h * .6, y); ctx.closePath(); ctx.fill();
    }
    mugre(ctx, R.barbero, r, .5);
  });
  toldo(ctx, R.toldoVerde, r, '#4f7a58', '#d9d3bc');
  toldo(ctx, R.toldoLona, r, '#bfa55c', '#b89c52');
  { const [x, y, w, h] = R.zinc;
    for (let i = 0; i < 16; i++) { ctx.fillStyle = i & 1 ? '#8f948f' : '#737873'; ctx.fillRect(x + i * 4, y, 4, h); }
    grano(ctx, R.zinc, r, 150, ['rgba(128,72,38,.5)', 'rgba(96,56,30,.4)'], 4, 2);
    ctx.fillStyle = 'rgba(110,66,36,.4)'; ctx.fillRect(x, y + h - 10, w, 10);
    mugre(ctx, R.zinc, r, .8); }
  { const [x, y, w, h] = R.sillaRoja;
    ctx.fillStyle = '#9f3a30'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.2)'; for (let i = 0; i < 6; i++) ctx.fillRect(x + 6 + i * 9, y + 6, 4, 24);
    desconche(ctx, R.sillaRoja, r, 8, 'rgba(226,214,200,.35)');
    mugre(ctx, R.sillaRoja, r, .7); }
  dentro(ctx, R.pila, () => {
    const [x, y, w, h] = R.pila;
    ctx.fillStyle = '#4a4238'; ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = pick(r, ['#6f5a48', '#8a8a84', '#7a4a2c', '#4a4a48', '#9a7a4a', '#5a6a6a', '#8f4a2a']);
      ctx.save(); ctx.translate(x + r() * w, y + r() * h); ctx.rotate((r() - .5) * 2); ctx.fillRect(-4, -1.2, 4 + r() * 9, 1 + r() * 3); ctx.restore();
    }
    mugre(ctx, R.pila, r, .8);
  });
}
