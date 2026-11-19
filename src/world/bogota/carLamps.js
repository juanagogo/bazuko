// src/world/bogota/carLamps.js
// Ópticas y parrillas de cada modelo. Una sola descripción en metros sobre la chapa (a desde el eje central, y altura):
// el contorno recorta la malla y también el dibujo del atlas, así que nunca se desalinean. Cada parte de una óptica
// lleva su propio canal de lámpara y comparte el dibujo: de noche solo enciende lo que corresponde. Los faros tienen dos
// dibujos a la misma escala: el de siempre da la luz y otro, oscuro, es lo que se ve con el vidrio apagado (`day`).
// Son datos puros: la geometría los usa también en Node, sin canvas. Ninguna celda lleva emblema ni letrero.

/** Recorta un contorno por una línea vertical (a) u horizontal (y) y se queda con el lado pedido. */
function clip(outline, axis, side, t) {
  const k = axis === 'a' ? 0 : 1, inside = p => side === '<' ? p[k] <= t : p[k] >= t, out = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i], q = outline[(i + 1) % outline.length];
    if (inside(p)) out.push(p);
    if (inside(p) !== inside(q)) {
      const u = (t - p[k]) / (q[k] - p[k]);
      out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]);
    }
  }
  return out;
}

const bboxOf = outline => {
  const as = outline.map(p => p[0]), ys = outline.map(p => p[1]);
  return [Math.min(...as), Math.max(...as), Math.min(...ys), Math.max(...ys)];
};

// ===== Herramientas de dibujo en metros =====

function kit(ctx, [x, y, w, h], [a0, a1, y0, y1], day = false) {
  const px = a => x + (a - a0) / (a1 - a0) * w, py = v => y + (y1 - v) / (y1 - y0) * h;
  const sx = w / (a1 - a0), sy = h / (y1 - y0);
  const d = {
    ctx, px, py, sx, sy, x, y, w, h, day,
    path(pts) { ctx.beginPath(); pts.forEach(([a, v], i) => (i ? ctx.lineTo(px(a), py(v)) : ctx.moveTo(px(a), py(v)))); ctx.closePath(); },
    open(pts) { ctx.beginPath(); pts.forEach(([a, v], i) => (i ? ctx.lineTo(px(a), py(v)) : ctx.moveTo(px(a), py(v)))); },
    rect(a, v, a2, v2, r = 0) {
      ctx.beginPath();
      const X = px(a), Y = py(v2), W = (a2 - a) * sx, H = (v2 - v) * sy;
      if (r) ctx.roundRect(X, Y, W, H, r * sx); else ctx.rect(X, Y, W, H);
    },
    ell(a, v, ra, rv = ra) { ctx.beginPath(); ctx.ellipse(px(a), py(v), ra * sx, rv * sy, 0, 0, Math.PI * 2); },
    down(v2, v1, stops) { const g = ctx.createLinearGradient(0, py(v2), 0, py(v1)); for (const [t, c] of stops) g.addColorStop(t, c); return g; },
    across(a1_, a2_, stops) { const g = ctx.createLinearGradient(px(a1_), 0, px(a2_), 0); for (const [t, c] of stops) g.addColorStop(t, c); return g; },
    round(a, v, r, stops) {
      // Radial en metros: el atlas no tiene la misma escala en ambos ejes y un círculo sobre la chapa debe seguir siéndolo.
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); for (const [t, c] of stops) g.addColorStop(t, c);
      return { g, a, v, r };
    },
    fillRound(a, v, ra, rv, stops, r0 = 1) {
      ctx.save(); ctx.translate(px(a), py(v)); ctx.scale(ra * sx, rv * sy);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r0); for (const [t, c] of stops) g.addColorStop(t, c);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    },
    line(pts, width, color, cap = 'round') { d.open(pts); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = cap; ctx.lineJoin = 'round'; ctx.stroke(); },
  };
  return d;
}

// Fondo de una óptica clara: carcasa de plástico transparente sobre lámina cromada. Nunca un círculo blanco sobre negro.
const CLEAR = [[0, '#60666c'], [.16, '#a2a8ae'], [.55, '#c0c5ca'], [1, '#868c93']];
const DARK = [[0, '#0d0e10'], [.3, '#24272b'], [.7, '#1c1e21'], [1, '#0b0c0e']];
// De día, cualquier carcasa es la cavidad oscura detrás del vidrio.
const DAY_HOUSING = [[0, '#0b0d0f'], [.4, '#1e2125'], [.8, '#2b2f33'], [1, '#121416']];
function base(d, box, stops) {
  d.ctx.fillStyle = d.down(box[3], box[2], d.day ? DAY_HOUSING : stops); d.ctx.fillRect(d.x, d.y, d.w, d.h);
}

/**
 * Bahía de reflector: un rectángulo redondeado de facetas cromadas y un capuchón pequeño sobre el bombillo. Da el brillo
 * de un faro real sin dibujar pupila; de día la parte alta queda en sombra de la carcasa.
 */
function bay(d, a0, v0, a1, v1, { r = .022, facets = 13, cap = true, tone = 1 } = {}) {
  if (d.day) { dayBay(d, a0, v0, a1, v1, r, cap); return; }
  const { ctx } = d, ca = (a0 + a1) / 2, cv = (v0 + v1) / 2, ra = (a1 - a0) / 2, rv = (v1 - v0) / 2;
  ctx.save();
  d.rect(a0, v0, a1, v1, r); ctx.clip();
  const c = n => `rgb(${n * tone | 0},${(n + 3) * tone | 0},${(n + 7) * tone | 0})`;
  ctx.fillStyle = d.down(v1, v0, [[0, c(120)], [.38, c(214)], [.62, c(238)], [1, c(150)]]);
  ctx.fillRect(d.px(a0), d.py(v1), (a1 - a0) * d.sx, (v1 - v0) * d.sy);
  // Facetas: tiras alternas; a pocos metros se funden en un brillo con grano.
  const fw = (a1 - a0) / facets;
  for (let i = 0; i < facets; i++) {
    const t = Math.abs((i + .5) / facets - .5) * 2;
    ctx.fillStyle = i % 2 ? `rgba(255,255,255,${.12 - t * .08})` : `rgba(58,64,72,${.05 + t * .11})`;
    ctx.fillRect(d.px(a0 + i * fw), d.py(v1), fw * d.sx, (v1 - v0) * d.sy);
  }
  ctx.strokeStyle = 'rgba(58,64,72,.1)'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const v = v0 + (v1 - v0) * i / 4; ctx.beginPath(); ctx.moveTo(d.px(a0), d.py(v)); ctx.lineTo(d.px(a1), d.py(v)); ctx.stroke(); }
  // El cuenco se oscurece hacia el borde y se abre en el centro.
  d.fillRound(ca, cv, ra * 1.3, rv * 1.3, [[0, 'rgba(255,255,255,.72)'], [.28, 'rgba(255,255,255,.14)'], [.7, 'rgba(30,34,40,.06)'], [1, 'rgba(30,34,40,.42)']]);
  ctx.restore();
  if (cap) {
    const cr = Math.min(ra, rv) * .24;
    d.fillRound(ca, cv, cr, cr, [[0, '#ffffff'], [.5, '#d9dde1'], [.85, '#7c838a'], [1, '#3e4348']]);
  }
  d.rect(a0, v0, a1, v1, r); ctx.strokeStyle = 'rgba(26,28,32,.6)'; ctx.lineWidth = 1.4; ctx.stroke();
}

/**
 * La misma bahía con el faro apagado: un cuenco liso que refleja el pavimento y deja oscura la parte alta, sin facetas que a
 * pocos metros se lean como cuadrícula. El único punto claro es el tajo de sol sobre el vidrio.
 */
function dayBay(d, a0, v0, a1, v1, r, cap) {
  const { ctx } = d, ca = (a0 + a1) / 2, cv = (v0 + v1) / 2, ra = (a1 - a0) / 2, rv = (v1 - v0) / 2;
  ctx.save();
  d.rect(a0, v0, a1, v1, r); ctx.clip();
  ctx.fillStyle = d.down(v1, v0, [[0, '#121416'], [.34, '#343a40'], [.8, '#858d95'], [1, '#454b52']]);
  ctx.fillRect(d.px(a0), d.py(v1), (a1 - a0) * d.sx, (v1 - v0) * d.sy);
  d.fillRound(ca, cv, ra * 1.05, rv * 1.05, [[0, 'rgba(160,168,176,.66)'], [.5, 'rgba(104,111,118,.34)'], [1, 'rgba(20,22,25,0)']]);
  ctx.restore();
  if (cap) {
    const cr = Math.min(ra, rv) * .26;
    d.fillRound(ca, cv, cr, cr, [[0, '#7b828a'], [.55, '#343840'], [1, '#101215']]);
  }
  d.rect(a0, v0, a1, v1, r); ctx.strokeStyle = 'rgba(5,6,7,.85)'; ctx.lineWidth = 1.4; ctx.stroke();
  const x0 = a0 + (a1 - a0) * .14, x1 = a0 + (a1 - a0) * .44, y0 = v1 - (v1 - v0) * .2, y1 = v1 - (v1 - v0) * .13;
  d.line([[x0, y0], [x1, y1]], 3, 'rgba(255,255,255,.95)');
}

/** Proyector: lente pequeña y oscura con un punto de luz, dentro de su aro. */
function projector(d, a, v, r) {
  if (d.day) {
    d.fillRound(a, v, r * 1.32, r * 1.32, [[0, '#101214'], [.72, '#1b1e21'], [.86, '#6d737a'], [1, '#0d0e10']]);
    d.fillRound(a, v, r, r, [[0, '#3c434a'], [.55, '#1c2024'], [1, '#08090b']]);
    d.fillRound(a - r * .28, v + r * .3, r * .26, r * .26, [[0, 'rgba(255,255,255,.98)'], [.6, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]);
    return;
  }
  d.fillRound(a, v, r * 1.32, r * 1.32, [[0, '#2a2d31'], [.72, '#34383c'], [.86, '#8d939a'], [1, '#17191c']]);
  d.fillRound(a, v, r, r, [[0, '#f7fbff'], [.2, '#c6d2dc'], [.55, '#566069'], [1, '#14171a']]);
  d.fillRound(a - r * .28, v + r * .3, r * .26, r * .26, [[0, 'rgba(255,255,255,.95)'], [1, 'rgba(255,255,255,0)']]);
}

function amber(d, pts, { ribs = 6 } = {}) {
  const { ctx } = d, b = bboxOf(pts);
  ctx.save(); d.path(pts); ctx.clip();
  ctx.fillStyle = d.down(b[3], b[2], [[0, '#86562a'], [.26, '#d39a57'], [.55, '#c27e36'], [1, '#754720']]);
  ctx.fillRect(d.px(b[0]), d.py(b[3]), (b[1] - b[0]) * d.sx, (b[3] - b[2]) * d.sy);
  const width = (b[1] - b[0]) / ribs;
  for (let i = 1; i < ribs; i++) {
    const a = b[0] + width * i;
    d.line([[a, b[3]], [a, b[2]]], 1.5, 'rgba(86,43,14,.44)', 'butt');
    d.line([[a + width * .14, b[3]], [a + width * .14, b[2]]], 1, 'rgba(255,197,114,.3)', 'butt');
  }
  ctx.restore();
}

/** Plástico transparente encima de todo y borde oscuro de la junta con la chapa. */
function lensFinish(d, o, { gloss = .24 } = {}) {
  const { ctx } = d, b = o.box;
  const g = ctx.createLinearGradient(0, d.py(b[3]), 0, d.py(b[3] - (b[3] - b[2]) * .55));
  if (d.day) {
    // El cielo en el vidrio: una franja arriba que termina en un borde, no una neblina sobre todo el faro.
    g.addColorStop(0, 'rgba(206,222,238,.3)'); g.addColorStop(.62, 'rgba(206,222,238,.14)'); g.addColorStop(.66, 'rgba(206,222,238,0)');
  } else {
    g.addColorStop(0, `rgba(255,255,255,${gloss})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = g; ctx.fillRect(d.x, d.y, d.w, d.h);
  if (o.end === 'tail') tailGlass(d, o);
}

/**
 * Vidrio de un stop: el plástico se hunde hacia la junta y oscurece abajo, y el cielo queda cortado en una franja
 * arriba. De noche el canal multiplica el dibujo: la franja queda como rojo más vivo, no como blanco.
 */
function tailGlass(d, o) {
  const { ctx } = d, b = o.box, h = b[3] - b[2];
  d.path(o.outline); ctx.strokeStyle = 'rgba(24,2,2,.42)'; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = d.down(b[2] + h * .45, b[2], [[0, 'rgba(20,2,2,0)'], [1, 'rgba(20,2,2,.3)']]);
  ctx.fillRect(d.x, d.py(b[2] + h * .45), d.w, h * .45 * d.sy);
  const g = ctx.createLinearGradient(0, d.py(b[3]), 0, d.py(b[3] - h * .4));
  g.addColorStop(0, 'rgba(232,240,248,.36)'); g.addColorStop(.8, 'rgba(232,240,248,.16)'); g.addColorStop(.86, 'rgba(232,240,248,0)');
  ctx.fillStyle = g; ctx.fillRect(d.x, d.y, d.w, d.h);
}

function clipped(d, o, draw) {
  const { ctx } = d;
  ctx.save(); ctx.beginPath(); ctx.rect(d.x, d.y, d.w, d.h); ctx.clip();
  draw();
  d.path(o.outline); ctx.strokeStyle = '#08090b'; ctx.lineWidth = 3.4; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}

// ----- Colas -----

/** Rojo con profundidad: fondo hondo, estrías y celdas más claras por donde sale la luz. */
function redBase(d, pts, { ribs = 11, horizontal = true, hi = '#a81a15', lo = '#5e0807' } = {}) {
  const { ctx } = d, b = bboxOf(pts);
  // El fondo oscuro evita halos en los bordes del stop al generar los mipmaps.
  ctx.fillStyle = '#231214'; ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.save(); d.path(pts); ctx.clip();
  ctx.fillStyle = d.down(b[3], b[2], [[0, lo], [.42, hi], [.62, hi], [1, lo]]);
  ctx.fillRect(d.px(b[0]), d.py(b[3]), (b[1] - b[0]) * d.sx, (b[3] - b[2]) * d.sy);
  ctx.strokeStyle = 'rgba(30,0,0,.3)'; ctx.lineWidth = 1;
  for (let i = 1; i < ribs; i++) {
    ctx.beginPath();
    if (horizontal) { const v = b[2] + (b[3] - b[2]) * i / ribs; ctx.moveTo(d.px(b[0]), d.py(v)); ctx.lineTo(d.px(b[1]), d.py(v)); } else { const a = b[0] + (b[1] - b[0]) * i / ribs; ctx.moveTo(d.px(a), d.py(b[2])); ctx.lineTo(d.px(a), d.py(b[3])); }
    ctx.stroke();
  }
  ctx.restore();
}
/** Celda de luz roja: lo que brilla de noche. El canal multiplica este color, así que el fondo oscuro no enciende. */
function redCell(d, a0, v0, a1, v1, r = .012) {
  const { ctx } = d;
  d.rect(a0, v0, a1, v1, r);
  ctx.fillStyle = d.down(v1, v0, [[0, '#a01e17'], [.5, '#dc3a2b'], [1, '#941a13']]); ctx.fill();
  ctx.strokeStyle = 'rgba(40,0,0,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
  // El reflector del bombillo detrás de la lente: un punto más claro que le da fondo.
  const rr = Math.min(a1 - a0, v1 - v0) * .42;
  d.fillRound((a0 + a1) / 2, (v0 + v1) / 2, rr, rr, [[0, 'rgba(255,170,140,.5)'], [.45, 'rgba(255,90,60,.18)'], [1, 'rgba(255,90,60,0)']]);
}
function whiteLens(d, pts, { ribs = 6 } = {}) {
  const { ctx } = d, b = bboxOf(pts);
  ctx.save(); d.path(pts); ctx.clip();
  ctx.fillStyle = d.down(b[3], b[2], [[0, '#a4a9ae'], [.5, '#d9dcdf'], [1, '#989da2']]);
  ctx.fillRect(d.px(b[0]), d.py(b[3]), (b[1] - b[0]) * d.sx, (b[3] - b[2]) * d.sy);
  ctx.strokeStyle = 'rgba(70,76,84,.3)'; ctx.lineWidth = 1;
  for (let i = 1; i < ribs; i++) { const a = b[0] + (b[1] - b[0]) * i / ribs; ctx.beginPath(); ctx.moveTo(d.px(a), d.py(b[2])); ctx.lineTo(d.px(a), d.py(b[3])); ctx.stroke(); }
  ctx.restore();
}
const divider = (d, pts, w = 2.6, c = '#0b0606') => d.line(pts, w, c, 'butt');

// ----- Parrillas -----

function honeycomb(d, size, { light = '#2d3033', back = '#08090a', row = .85 } = {}) {
  const { ctx } = d;
  ctx.fillStyle = back; ctx.fillRect(d.x, d.y, d.w, d.h);
  const stepY = size * row;
  const hexagon = (x, y, radius, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const angle = k * Math.PI / 3 + Math.PI / 6, px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  };
  for (let j = 0, y = d.y; y < d.y + d.h + stepY; j++, y += stepY) {
    for (let x = d.x + (j % 2) * size / 2; x < d.x + d.w + size; x += size) {
      hexagon(x, y, size * .54, light);
      hexagon(x, y - size * .06, size * .36, back);
    }
  }
}
function slats(d, box, n, { light = '#55595e', dark = '#121315', back = '#060708' } = {}) {
  const { ctx } = d, [, , y0, y1] = box, h = (y1 - y0) / n;
  ctx.fillStyle = back; ctx.fillRect(d.x, d.y, d.w, d.h);
  for (let i = 0; i < n; i++) {
    const top = y1 - i * h, bot = top - h * .68;
    ctx.fillStyle = d.down(top, bot, [[0, light], [.16, light], [.6, dark], [1, dark]]);
    ctx.fillRect(d.x, d.py(top), d.w, h * .68 * d.sy);
  }
}
/** Marco negro brillante: una franja gruesa siguiendo el contorno, con filo claro arriba. */
function frame(d, o, width, { color = '#0d0e10', edge = 'rgba(150,156,162,.5)' } = {}) {
  // Al espejar una parrilla, el eje del carro queda dentro de ella y no lleva marco.
  const [first, second] = o.outline;
  if (first[0] === 0 && second[0] === 0) d.open([...o.outline.slice(1), first]);
  else d.path(o.outline);
  d.ctx.strokeStyle = color; d.ctx.lineWidth = width; d.ctx.lineJoin = 'round'; d.ctx.stroke();
  d.ctx.strokeStyle = edge; d.ctx.lineWidth = 1.6; d.ctx.stroke();
}
/** Hueco de exploradora: fondo oscuro, faro redondo pequeño y aro de plástico. */
function fogPocket(d, o, a, v, r) {
  const { ctx } = d;
  ctx.fillStyle = '#08090a'; ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.fillStyle = d.down(o.box[3], o.box[2], [[0, '#1b1d20'], [1, '#2a2d30']]); d.path(o.outline); ctx.fill();
  d.fillRound(a, v, r * 1.25, r * 1.25, [[0, '#15171a'], [.78, '#16181b'], [.86, '#6d7278'], [1, '#111214']]);
  d.fillRound(a, v, r, r, [[0, '#f4f7fa'], [.3, '#bfc6cd'], [.7, '#6c747c'], [1, '#2a2e33']]);
}

// ===== Las ópticas =====

const OPTIC_LIST = {
  // Citadino: faro grande en flecha que nace junto a la parrilla y sube por el guardabarro hacia el pilar.
  citadinoHead: {
    end: 'nose', flare: true, bulge: .01,
    outline: [[.26, .665], [.26, .74], [.60, .762], [.90, .812], [1.18, .868], [.96, .745], [.70, .632], [.44, .606]],
    parts: [{ where: [['a', '<', .80]], lamp: 'HEAD' }, { where: [['a', '>', .80]], lamp: 'signal' }],
    art(d, o) {
      base(d, o.box, CLEAR);
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        bay(d, .292, .619, .572, .747, { facets: 13, r: .035 });
        bay(d, .59, .66, .785, .768, { facets: 8, tone: .9, r: .014, cap: false });
        // El bisel separa dos reflectores de distinta forma. Su brillo termina al pasar a la direccional.
        d.line([[.285, .733], [.552, .751], [.785, .781]], 4, d.day ? '#65717c' : '#d9e2e9', 'butt');
        d.line([[.2, .755], [.6, .785], [.9, .838], [1.2, .9]], 9, '#1a1c1f');
        // La punta es lámina gris; la direccional solo ocupa su parte baja, como reflector detrás de la lente clara.
        amber(d, [[.80, .60], [.80, .715], [.98, .775], [1.2, .86], [1.2, .6]]);
        divider(d, [[.80, .6], [.80, .83]], 2.4, '#1d1f22');
        lensFinish(d, o);
        d.ctx.restore();
      });
    },
  },
  // Sedán popular: rectángulo horizontal grande de esquinas suaves, con dos reflectores claros y direccional al final.
  sedanPopularHead: {
    end: 'nose', flare: true, bulge: .008,
    outline: [[.39, .745], [.385, .85], [.42, .868], [1.0, .872], [1.13, .842], [1.0, .785], [.78, .735], [.44, .728]],
    parts: [{ where: [['a', '<', .93]], lamp: 'HEAD' }, { where: [['a', '>', .93]], lamp: 'signal' }],
    art(d, o) {
      base(d, o.box, CLEAR);
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        bay(d, .402, .738, .692, .853, { facets: 12, r: .018 });
        bay(d, .71, .759, .909, .851, { facets: 6, tone: .91, r: .012, cap: false });
        d.line([[.42, .856], [.74, .86], [.914, .851]], 4, d.day ? '#626c75' : '#e4e8ee', 'butt');
        amber(d, [[.93, .7], [.93, .9], [1.2, .9], [1.2, .7]]);
        divider(d, [[.93, .7], [.93, .9]], 2.6, '#26292c');
        lensFinish(d, o);
        d.ctx.restore();
      });
    },
  },
  // Hatch compacto: reflector ancho bajo el capó y direccional ámbar en la esquina.
  hatchPopularHead: {
    end: 'nose', flare: true, bulge: .01,
    outline: [[.287, .652], [.270, .674], [.270, .762], [.290, .786], [.728, .786], [.812, .768], [.843, .732], [.81, .676], [.72, .652]],
    parts: [{ where: [['a', '<', .665]], lamp: 'HEAD' }, { where: [['a', '>', .665]], lamp: 'signal' }],
    art(d, o) {
      base(d, o.box, [[0, '#3d4143'], [.31, '#879098'], [.55, '#aeb4b7'], [1, '#595c5e']]);
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        bay(d, .282, .66, .663, .778, { facets: 14, r: .014, cap: false });
        // El vidrio prismático separa los campos del reflector y deja una nervadura horizontal baja.
        const rib = d.day ? 'rgba(28,34,37,.23)' : 'rgba(72,82,84,.41)';
        for (const a of [.322, .388, .459, .529, .599]) d.line([[a, .668], [a, .773]], 1.6, rib, 'butt');
        d.line([[.29, .692], [.661, .692]], 2.1, rib, 'butt');
        amber(d, [[.665, .64], [.665, .80], [.86, .80], [.86, .64]], { ribs: 8 });
        divider(d, [[.665, .649], [.665, .79]], 3.5, '#191a1c');
        lensFinish(d, o);
        d.ctx.restore();
      });
    },
  },
  // Sedán deportivo: ranura fina y angulosa con punta aguda hacia atrás; fondo negro, proyector y tira de luz.
  sedanDeportivoHead: {
    end: 'nose', flare: true, bulge: .006,
    outline: [[.50, .622], [.45, .66], [.80, .712], [1.10, .775], [1.32, .828], [1.06, .73], [.78, .636]],
    parts: [{ where: [['a', '<', 1.0]], lamp: 'HEAD' }, { where: [['a', '>', 1.0]], lamp: 'signal' }],
    art(d, o) {
      base(d, o.box, DARK);
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        d.fillRound(.66, .668, .2, .05, [[0, 'rgba(120,130,140,.5)'], [1, 'rgba(120,130,140,0)']]);
        projector(d, .615, .664, .036);
        bay(d, .71, .655, .885, .722, { facets: 5, cap: false, tone: .62, r: .012 });
        // Tira diurna a lo largo del filo alto, hasta la punta.
        d.line([[.47, .655], [.80, .704], [1.10, .768], [1.3, .82]], 3.6, d.day ? '#777e86' : '#f2f6ff');
        amber(d, [[1.0, .68], [1.0, .742], [1.34, .84], [1.34, .68]], { ribs: 8 });
        lensFinish(d, o, { gloss: .16 });
        d.ctx.restore();
      });
    },
  },
  // Camioneta compacta: óptica casi cuadrada dentro de un marco oscuro, con tira diurna arriba.
  suvHead: {
    end: 'nose', flare: true, bulge: .008,
    outline: [[.44, .872], [.42, .895], [.42, 1.0], [.45, 1.022], [.98, 1.024], [1.07, 1.0], [1.07, .93], [.96, .872]],
    parts: [{ where: [['a', '<', .93]], lamp: 'HEAD' }, { where: [['a', '>', .93]], lamp: 'signal' }],
    art(d, o) {
      base(d, o.box, DARK);
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        // Tira diurna arriba, de lado a lado, y debajo proyector y reflector.
        d.line([[.45, 1.0], [.91, 1.003]], 5.5, d.day ? '#777e86' : '#f4f7fb', 'butt');
        d.fillRound(.60, .93, .17, .07, [[0, 'rgba(150,158,166,.42)'], [1, 'rgba(150,158,166,0)']]);
        projector(d, .55, .925, .045);
        bay(d, .645, .885, .89, .975, { facets: 7, tone: .86, r: .018 });
        amber(d, [[.93, .85], [.93, 1.04], [1.1, 1.04], [1.1, .85]], { ribs: 4 });
        lensFinish(d, o, { gloss: .18 });
        d.ctx.restore();
      });
    },
  },
  // Pick-up: faro grande y escalonado, más alto junto a la parrilla, con cromo arriba y direccional en el escalón.
  pickupHead: {
    end: 'nose', flare: true, bulge: .01,
    outline: [[.54, .935], [.50, 1.07], [.52, 1.09], [1.02, 1.098], [1.2, 1.066], [1.2, 1.0], [.99, .99], [.90, .935]],
    parts: [{ where: [['a', '<', .97]], lamp: 'HEAD' }, { where: [['a', '>', .97]], lamp: 'signal' }],
    art(d, o) {
      base(d, o.box, CLEAR);
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        d.ctx.fillStyle = d.down(1.11, 1.05, d.day ? [[0, '#a3aab1'], [.5, '#2c3035'], [1, '#6d747b']] : [[0, '#f4f6f8'], [.5, '#8d949b'], [1, '#dfe3e6']]); d.ctx.fillRect(d.x, d.py(1.11), d.w, .06 * d.sy);
        bay(d, .545, .948, .735, 1.05, { facets: 7, r: .018 });
        bay(d, .75, .948, .935, 1.05, { facets: 7, tone: .95, r: .018 });
        amber(d, [[.97, .9], [.97, 1.1], [1.25, 1.1], [1.25, .9]]);
        divider(d, [[.97, .9], [.97, 1.1]], 2.6, '#1d1f22');
        lensFinish(d, o);
        d.ctx.restore();
      });
    },
  },
  // Furgón: faro alto y vertical, con dos reflectores uno sobre otro y la direccional en la columna exterior.
  furgonHead: {
    end: 'nose', flare: true, bulge: .008,
    outline: [[.40, .79], [.38, 1.0], [.44, 1.042], [.78, 1.036], [.86, .99], [.86, .83], [.76, .775], [.46, .775]],
    parts: [{ where: [['a', '<', .76]], lamp: 'HEAD' }, { where: [['a', '>', .76]], lamp: 'signal' }],
    art(d, o) {
      base(d, o.box, CLEAR);
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        bay(d, .43, .905, .735, 1.02, { facets: 8 });
        bay(d, .43, .79, .735, .892, { facets: 8, tone: .94 });
        amber(d, [[.76, .7], [.76, 1.06], [.9, 1.06], [.9, .7]], { ribs: 3 });
        divider(d, [[.76, .7], [.76, 1.06]], 2.4, '#26292c');
        lensFinish(d, o);
        d.ctx.restore();
      });
    },
  },

  // ----- Colas -----

  // Citadino: stop alto y vertical en el pilar; arriba rojo, luego ámbar y la reversa blanca abajo.
  citadinoTail: {
    end: 'tail', flare: true, bulge: .007,
    outline: [[.50, .80], [.48, 1.0], [.54, 1.12], [.68, 1.16], [.84, 1.08], [.86, .80]],
    parts: [{ where: [['y', '>', .945]], lamp: 'TAIL' }, { where: [['y', '<', .945], ['y', '>', .875]], lamp: 'signal' }, { where: [['y', '<', .875]], lamp: 'OFF' }],
    art(d, o) {
      redBase(d, o.outline, { ribs: 14 });
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        redCell(d, .50, .96, .84, 1.055, .012);
        redCell(d, .54, 1.07, .80, 1.13, .022);
        amber(d, [[.4, .875], [.4, .945], [.9, .945], [.9, .875]], { ribs: 7 });
        whiteLens(d, [[.4, .75], [.4, .875], [.9, .875], [.9, .75]]);
        divider(d, [[.4, .945], [.9, .945]]); divider(d, [[.4, .875], [.9, .875]]);
        lensFinish(d, o, { gloss: .14 });
        d.ctx.restore();
      });
    },
  },
  // Sedán popular: bloque horizontal que dobla al costado; rojo por fuera, ámbar y reversa hacia el baúl.
  sedanPopularTail: {
    end: 'tail', flare: true, bulge: .006,
    outline: [[.46, .848], [.455, .968], [.50, .978], [1.06, .978], [1.15, .935], [1.06, .848]],
    parts: [{ where: [['a', '>', .74]], lamp: 'TAIL' }, { where: [['a', '<', .74], ['y', '>', .912]], lamp: 'signal' }, { where: [['a', '<', .74], ['y', '<', .912]], lamp: 'OFF' }],
    art(d, o) {
      redBase(d, o.outline, { ribs: 9 });
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        redCell(d, .76, .868, 1.10, .958, .012);
        d.ctx.strokeStyle = 'rgba(50,0,0,.42)'; d.ctx.lineWidth = 1.1;
        for (let i = 1; i < 6; i++) { const a = .76 + .34 * i / 6; d.open([[a, .868], [a, .958]]); d.ctx.stroke(); }
        amber(d, [[.4, .912], [.4, 1], [.74, 1], [.74, .912]], { ribs: 7 });
        whiteLens(d, [[.4, .82], [.4, .912], [.74, .912], [.74, .82]], { ribs: 7 });
        divider(d, [[.74, .82], [.74, 1]], 3.2); divider(d, [[.4, .912], [.74, .912]]);
        lensFinish(d, o, { gloss: .13 });
        d.ctx.restore();
      });
    },
  },
  // Hatch compacto: stop horizontal en esquina, con ámbar y reversa hacia el portón.
  hatchPopularTail: {
    end: 'tail', flare: true, bulge: .007,
    outline: [[.405, .721], [.382, .744], [.382, .847], [.411, .87], [.705, .87], [.78, .843], [.791, .76], [.755, .722]],
    parts: [{ where: [['a', '>', .54]], lamp: 'TAIL' }, { where: [['a', '<', .54], ['y', '>', .796]], lamp: 'signal' }, { where: [['a', '<', .54], ['y', '<', .796]], lamp: 'OFF' }],
    art(d, o) {
      redBase(d, o.outline, { ribs: 10, hi: '#a71914', lo: '#660d08' });
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        redCell(d, .55, .801, .785, .871, .011);
        redCell(d, .55, .721, .785, .79, .011);
        amber(d, [[.37, .796], [.37, .88], [.54, .88], [.54, .796]]);
        whiteLens(d, [[.37, .71], [.37, .796], [.54, .796], [.54, .71]]);
        divider(d, [[.54, .71], [.54, .88]], 3.8);
        divider(d, [[.37, .796], [.8, .796]], 3);
        lensFinish(d, o, { gloss: .14 });
        d.ctx.restore();
      });
    },
  },
  // Sedán deportivo: ranura fina y angulosa con dos barras de luz; la punta corre hacia el costado.
  sedanDeportivoTail: {
    end: 'tail', flare: true, bulge: .005,
    outline: [[.50, .945], [.46, .985], [.86, 1.014], [1.16, 1.018], [1.32, .985], [1.06, .935], [.76, .925]],
    parts: [{ where: [['a', '>', .74]], lamp: 'TAIL' }, { where: [['a', '<', .74], ['a', '>', .60]], lamp: 'signal' }, { where: [['a', '<', .60]], lamp: 'OFF' }],
    art(d, o) {
      redBase(d, o.outline, { ribs: 4, hi: '#6e0d0b', lo: '#2d0404' });
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        d.line([[.76, .992], [.92, 1.002], [1.16, 1.002], [1.28, .985]], 5.5, '#ff4632', 'butt');
        d.line([[.78, .948], [1.04, .95], [1.2, .972]], 4.5, '#e1281d', 'butt');
        amber(d, [[.60, .9], [.60, 1.03], [.74, 1.03], [.74, .9]], { ribs: 4 });
        whiteLens(d, [[.44, .9], [.44, 1.03], [.60, 1.03], [.60, .9]], { ribs: 4 });
        divider(d, [[.60, .9], [.60, 1.03]]); divider(d, [[.74, .9], [.74, 1.03]]);
        lensFinish(d, o, { gloss: .12 });
        d.ctx.restore();
      });
    },
  },
  // Camioneta: grupo en la esquina, inclinado, con marco; reversa y ámbar en el centro y rojo alrededor.
  suvTail: {
    end: 'tail', flare: true, bulge: .007,
    outline: [[.56, 1.055], [.54, 1.18], [.60, 1.245], [.90, 1.205], [1.03, 1.14], [1.01, 1.045]],
    parts: [{ where: [['a', '>', .79]], lamp: 'TAIL' }, { where: [['a', '<', .79], ['y', '>', 1.15]], lamp: 'signal' }, { where: [['a', '<', .79], ['y', '<', 1.15]], lamp: 'OFF' }],
    art(d, o) {
      redBase(d, o.outline, { ribs: 10 });
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        redCell(d, .81, 1.07, .985, 1.175, .02);
        amber(d, [[.5, 1.15], [.5, 1.26], [.79, 1.26], [.79, 1.15]], { ribs: 6 });
        whiteLens(d, [[.5, 1.03], [.5, 1.15], [.79, 1.15], [.79, 1.03]], { ribs: 6 });
        divider(d, [[.79, 1.03], [.79, 1.26]], 3.2); divider(d, [[.5, 1.15], [.79, 1.15]]);
        lensFinish(d, o, { gloss: .13 });
        d.ctx.restore();
      });
    },
  },
  // Pick-up: columna vertical alta en la esquina de la compuerta: rojo, ámbar, reversa y catadióptrico.
  pickupTail: {
    end: 'tail', flare: true, bulge: .006,
    outline: [[.70, .875], [.70, 1.17], [.74, 1.195], [.90, 1.195], [.935, 1.17], [.935, .875]],
    parts: [{ where: [['y', '>', 1.045]], lamp: 'TAIL' }, { where: [['y', '<', 1.045], ['y', '>', .985]], lamp: 'signal' }, { where: [['y', '<', .985], ['y', '>', .925]], lamp: 'OFF' }, { where: [['y', '<', .925]], lamp: 'TAIL' }],
    art(d, o) {
      redBase(d, o.outline, { ribs: 16 });
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        redCell(d, .715, 1.06, .92, 1.175, .012);
        amber(d, [[.65, .985], [.65, 1.045], [.96, 1.045], [.96, .985]], { ribs: 6 });
        whiteLens(d, [[.65, .925], [.65, .985], [.96, .985], [.96, .925]], { ribs: 6 });
        for (const v of [1.045, .985, .925]) divider(d, [[.65, v], [.96, v]]);
        lensFinish(d, o, { gloss: .12 });
        d.ctx.restore();
      });
    },
  },
  // Furgón: columna alta en la esquina de las puertas de atrás.
  furgonTail: {
    end: 'tail', flare: true, bulge: .004,
    outline: [[.60, .84], [.60, 1.28], [.63, 1.31], [.77, 1.31], [.80, 1.28], [.80, .84]],
    parts: [{ where: [['y', '>', 1.08]], lamp: 'TAIL' }, { where: [['y', '<', 1.08], ['y', '>', .99]], lamp: 'signal' }, { where: [['y', '<', .99], ['y', '>', .90]], lamp: 'OFF' }, { where: [['y', '<', .90]], lamp: 'TAIL' }],
    art(d, o) {
      redBase(d, o.outline, { ribs: 18 });
      clipped(d, o, () => {
        d.ctx.save(); d.path(o.outline); d.ctx.clip();
        redCell(d, .615, 1.10, .785, 1.29, .012);
        amber(d, [[.55, .99], [.55, 1.08], [.85, 1.08], [.85, .99]], { ribs: 5 });
        whiteLens(d, [[.55, .90], [.55, .99], [.85, .99], [.85, .90]], { ribs: 5 });
        for (const v of [1.08, .99, .90]) divider(d, [[.55, v], [.85, v]]);
        lensFinish(d, o, { gloss: .12 });
        d.ctx.restore();
      });
    },
  },

  // ----- Parrillas y tomas de aire (mitad, en espejo desde el eje central) -----

  // Citadino: parrilla alta pequeña y toma baja grande.
  citadinoGrille: { end: 'nose', trim: true, metal: .22,
    outline: [[0, .652], [0, .728], [.235, .722], [.268, .695], [.215, .655]],
    art(d, o) { slats(d, o.box, 3); frame(d, o, 6); },
  },
  citadinoIntake: { end: 'nose', trim: true, metal: .1,
    outline: [[0, .305], [0, .452], [.40, .452], [.50, .385], [.42, .315]],
    art(d, o) { honeycomb(d, 15); frame(d, o, 6, { color: '#111214', edge: 'rgba(90,94,98,.5)' }); },
  },
  citadinoFog: { end: 'nose', trim: true, metal: .1,
    outline: [[.54, .385], [.53, .50], [.60, .525], [.74, .49], [.76, .42], [.66, .365]],
    art(d, o) { fogPocket(d, o, .645, .44, .04); },
  },
  // Sedán popular: parrilla ancha con barra cromada; toma baja sencilla.
  sedanPopularGrille: { end: 'nose', trim: true, metal: .2,
    outline: [[0, .735], [0, .868], [.355, .862], [.375, .80], [.31, .74]],
    art(d, o) { slats(d, o.box, 5, { light: '#4b4f54' }); frame(d, o, 5, { color: '#17191b', edge: 'rgba(120,125,130,.55)' }); },
  },
  sedanPopularIntake: { end: 'nose', trim: true, metal: .1,
    outline: [[0, .365], [0, .49], [.44, .49], [.52, .425], [.45, .37]],
    art(d, o) { slats(d, o.box, 3, { light: '#34373a', dark: '#111214' }); frame(d, o, 5, { color: '#111214', edge: 'rgba(90,94,98,.5)' }); },
  },
  sedanPopularFog: { end: 'nose', trim: true, metal: .1,
    outline: [[.57, .405], [.56, .485], [.74, .485], [.78, .435], [.72, .39]],
    art(d, o) { fogPocket(d, o, .655, .44, .033); },
  },
  // Dos ranuras bajo el travesaño del capó. La defensa tiene su propia toma de plástico.
  hatchPopularGrille: { end: 'nose', trim: true, metal: .2,
    outline: [[0, .655], [0, .741], [.207, .74], [.23, .72], [.215, .659]],
    art(d, o) { slats(d, o.box, 2, { light: '#737778', dark: '#35383a' }); frame(d, o, 8, { color: '#161719' }); },
  },
  hatchPopularIntake: { end: 'nose', trim: true, metal: .1,
    outline: [[0, .396], [0, .468], [.35, .468], [.405, .439], [.381, .403]],
    art(d, o) { slats(d, o.box, 2, { light: '#464a4e', dark: '#141618' }); frame(d, o, 8, { color: '#25282b' }); },
  },
  hatchPopularFog: { end: 'nose', trim: true, metal: .1,
    outline: [[.60, .43], [.60, .50], [.68, .535], [.80, .50], [.80, .43], [.70, .405]],
    art(d, o) { fogPocket(d, o, .70, .465, .036); },
  },
  // Sedán deportivo: parrilla de cinco lados con marco negro brillante; panal fino por dentro.
  sedanDeportivoGrille: { end: 'nose', trim: true, metal: .3,
    outline: [[0, .405], [0, .665], [.40, .652], [.50, .615], [.39, .44]],
    art(d, o) { honeycomb(d, 9.5, { light: '#303337', back: '#050506' }); frame(d, o, 11, { color: '#050506', edge: 'rgba(150,156,162,.42)' }); },
  },
  sedanDeportivoIntake: { end: 'nose', trim: true, metal: .1,
    outline: [[0, .245], [0, .325], [.50, .335], [.62, .30], [.50, .25]],
    art(d, o) { slats(d, o.box, 2, { light: '#2a2c2f', dark: '#0e0f10' }); frame(d, o, 4, { color: '#0d0e0f', edge: 'rgba(90,94,98,.4)' }); },
  },
  sedanDeportivoFog: { end: 'nose', trim: true, metal: .22,
    outline: [[.63, .36], [.60, .44], [.72, .50], [.88, .47], [.88, .40], [.78, .345]],
    art(d, o) { fogPocket(d, o, .745, .425, .032); },
  },
  // Camioneta: parrilla hexagonal alta.
  suvGrille: { end: 'nose', trim: true, metal: .2,
    outline: [[0, .79], [0, 1.0], [.385, .99], [.455, .90], [.385, .80]],
    art(d, o) { slats(d, o.box, 5, { light: '#44484d' }); frame(d, o, 7, { color: '#0e0f11', edge: 'rgba(130,136,142,.5)' }); },
  },
  suvIntake: { end: 'nose', trim: true, metal: .1,
    outline: [[0, .50], [0, .615], [.44, .615], [.50, .565], [.44, .50]],
    art(d, o) { honeycomb(d, 14, { light: '#2c2f32' }); frame(d, o, 5, { color: '#0f1012', edge: 'rgba(80,84,88,.4)' }); },
  },
  suvFog: { end: 'nose', trim: true, metal: .1,
    outline: [[.60, .50], [.58, .585], [.64, .615], [.80, .60], [.83, .54], [.74, .49]],
    art(d, o) { fogPocket(d, o, .70, .55, .038); },
  },
  // Pick-up: gran parrilla; las barras gruesas de cromo van en la geometría.
  pickupGrille: { end: 'nose', trim: true, metal: .2,
    outline: [[0, .85], [0, 1.09], [.50, 1.085], [.545, .99], [.485, .855]],
    art(d, o) { honeycomb(d, 16, { light: '#34373a' }); frame(d, o, 5, { color: '#101113' }); },
  },
  pickupIntake: { end: 'nose', trim: true, metal: .1,
    outline: [[0, .50], [0, .655], [.60, .655], [.70, .585], [.62, .505]],
    art(d, o) { slats(d, o.box, 3, { light: '#303336', dark: '#0f1012' }); frame(d, o, 5, { color: '#101112', edge: 'rgba(80,84,88,.4)' }); },
  },
  pickupFog: { end: 'nose', trim: true, metal: .1,
    outline: [[.72, .60], [.70, .69], [.78, .715], [.90, .70], [.92, .63], [.84, .585]],
    art(d, o) { fogPocket(d, o, .81, .65, .04); },
  },
  // Furgón: parrilla angosta entre los faros y gran parte baja negra.
  furgonGrille: { end: 'nose', trim: true, metal: .15,
    outline: [[0, .815], [0, .945], [.33, .94], [.36, .88], [.31, .82]],
    art(d, o) { slats(d, o.box, 4, { light: '#3e4247' }); frame(d, o, 5, { color: '#121315' }); },
  },
  furgonIntake: { end: 'nose', trim: true, metal: .1,
    outline: [[0, .40], [0, .535], [.40, .535], [.46, .47], [.40, .40]],
    art(d, o) { honeycomb(d, 15, { light: '#2a2d30' }); frame(d, o, 5, { color: '#0f1012', edge: 'rgba(70,74,78,.4)' }); },
  },
};

// Las celdas van después del atlas original: cuatro por fila de 256 × 112 desde la fila 1024.
const CELL = [256, 112], ORIGIN = 1024;
// El dibujo de día de cada faro queda a la misma X y justo esto más abajo, en el último piso del atlas.
const DAY_DROP = 1024;
export const OPTICS = Object.freeze(Object.fromEntries(Object.entries(OPTIC_LIST).map(([name, o], i) => {
  const rect = [(i % 4) * CELL[0], ORIGIN + Math.floor(i / 4) * CELL[1], CELL[0], CELL[1]];
  const box = bboxOf(o.outline);
  const parts = (o.parts ?? [{ lamp: 'OFF' }]).map(({ where = [], lamp }) => ({
    lamp,
    outline: where.reduce((poly, [axis, side, t]) => clip(poly, axis === 'a' ? 'a' : 'y', side, t), o.outline),
  })).filter(p => p.outline.length >= 3);
  const day = o.end === 'nose' && parts.some(p => p.lamp === 'HEAD') ? [rect[0], rect[1] + DAY_DROP, rect[2], rect[3]] : null;
  return [name, { ...o, name, rect, box, parts, day }];
})));

/** Dibuja una celda de una óptica: su dibujo de siempre o, con `day`, el de día en su propia celda. */
export function drawOptic(ctx, o, day = false) {
  const rect = day ? o.day : o.rect;
  ctx.save(); ctx.beginPath(); ctx.rect(rect[0], rect[1], rect[2], rect[3]); ctx.clip();
  o.art(kit(ctx, rect, o.box, day), o);
  ctx.restore();
}

/** Dibuja todas las ópticas en el atlas. */
export function drawOptics(ctx) {
  for (const o of Object.values(OPTICS)) {
    drawOptic(ctx, o);
    if (o.day) drawOptic(ctx, o, true);
  }
}
