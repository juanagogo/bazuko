// La letra de imprenta: solo sale cuando la ciudad habla de ti, en la primera plana y en el recorte de periódico.
// Dos cortes de un mismo esqueleto, dibujados por coordenadas y sin dependencias:
//   Titular : gótica pesada y angosta, para el titular.
//   Tira    : el mismo esqueleto con más aire, para leer a 16-24 px.
// Dos ideas la hacen reconocible:
//   1. Trampas de tinta: cada unión lleva una mordida en V, como las letras hechas para papel malo.
//   2. Curvas cortadas a bisturí: cada redondo son tres cortes rectos, sin curvas de Bézier.
// Uso: npm run imprenta. Escribe los .woff en src/ui/imprenta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFont } from './ttf.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = process.argv[2] ?? path.join(AQUI, '..', '..', 'src', 'ui', 'imprenta');

// ---------------------------------------------------------------- primitivas

const D2R = Math.PI / 180;
/** Arco de corte recto: superelipse muestreada en `f` tramos. Va de d0 a d1 en grados, en cualquier sentido. */
function A(cx, cy, rx, ry, d0, d1, f = 3, n = 2.6) {
  const pts = [];
  for (let i = 0; i <= f; i++) {
    const t = (d0 + (d1 - d0) * i / f) * D2R, c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + rx * Math.sign(c) * Math.abs(c) ** (2 / n), cy + ry * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return pts;
}
/** Marca un vértice para que lleve trampa de tinta. */
const t = (x, y) => [x, y, 'T'];
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** Caja de esquinas cortadas, sentido antihorario. */
const rr = (x0, y0, x1, y1, rx, ry, f = 3) => [
  ...A(x1 - rx, y0 + ry, rx, ry, -90, 0, f),
  ...A(x1 - rx, y1 - ry, rx, ry, 0, 90, f),
  ...A(x0 + rx, y1 - ry, rx, ry, 90, 180, f),
  ...A(x0 + rx, y0 + ry, rx, ry, 180, 270, f),
];
const hole = (c) => { c.hole = true; return c; };
const map = (c, fn) => { const out = c.map((p) => { const [x, y] = fn(p[0], p[1]); return p[2] ? [x, y, p[2]] : [x, y]; }); if (c.hole !== undefined) out.hole = c.hole; return out; };
const rot180 = (cs, W, H) => cs.map((c) => map(c, (x, y) => [W - x, H - y]));
const flipX = (cs, W) => cs.map((c) => map(c, (x, y) => [W - x, y]));
const flipY = (cs, Y) => cs.map((c) => map(c, (x, y) => [x, Y - y]));
const shift = (cs, dx, dy = 0) => cs.map((c) => map(c, (x, y) => [x + dx, y + dy]));
const scale = (cs, sx, sy = sx) => cs.map((c) => map(c, (x, y) => [x * sx, y * sy]));

/** Convierte cada vértice marcado en una mordida en V hacia lo negro. Vale en cualquier sentido de recorrido. */
function trampas(c, tt, dd) {
  const out = [];
  const n = c.length;
  for (let i = 0; i < n; i++) {
    const p = c[i];
    if (p[2] !== 'T') { out.push([p[0], p[1]]); continue; }
    const q = c[(i - 1 + n) % n], r = c[(i + 1) % n];
    const la = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, lb = Math.hypot(r[0] - p[0], r[1] - p[1]) || 1;
    const ax = (p[0] - q[0]) / la, ay = (p[1] - q[1]) / la, bx = (r[0] - p[0]) / lb, by = (r[1] - p[1]) / lb;
    const ta = Math.min(tt, la * .45), tb = Math.min(tt, lb * .45);
    out.push([p[0] - ax * ta, p[1] - ay * ta], [p[0] + (ax - bx) * dd, p[1] + (ay - by) * dd], [p[0] + bx * tb, p[1] + by * tb]);
  }
  if (c.hole !== undefined) out.hole = c.hole;
  return out;
}

// ---------------------------------------------------------------- medidas

const TITULAR = { nombre: 'Titular', H: 740, X: 566, S: 186, B: 134, M: 118, W: 452, sb: 17, rx: 158, ry: 178, crx: 42, cry: 52, tt: 10, dd: 19, ov: 8 };
const TIRA = { nombre: 'Tira', H: 720, X: 548, S: 124, B: 100, M: 92, W: 418, sb: 30, rx: 138, ry: 158, crx: 74, cry: 76, tt: 6, dd: 9, ov: 7 };

// ---------------------------------------------------------------- dibujo

function dibujar(m) {
  const { H, X, S, B, M, W, rx, ry, crx, cry, ov, sb } = m;
  const G = {};
  const pon = (ch, w, c, o = {}) => { G[ch] = { w, c, l: o.l ?? sb, r: o.r ?? sb }; };

  const midB = (H - M) / 2 + 14, midT = midB + M;

  // ------------ redondas
  const anilloO = (w, h = H, s = S, b = B) => [rr(0, -ov, w, h + ov, rx, ry), hole(rr(s, b, w - s, h - b, Math.min(crx, (w - 2 * s) * .47), cry))];
  pon('O', W, anilloO(W));
  pon('Q', W, [...anilloO(W), [[W * .44, B + 62], [W * .44 + S * .62, B + 62], [W + 14, -86], [W + 14 - S * .86, -86]]], { r: sb - 6 });

  // C: abierta a la derecha, remates rectos con un corte leve.
  const C = (w, h = H, s = S, b = B, ap = .335) => {
    const T1 = h * (1 - ap), T2 = h * ap, c = Math.min(crx, (w - 2 * s) * .47);
    return [[
      [w, T1 + 12], ...A(w - rx, h - ry, rx, ry, 0, 90).map(p => [p[0], p[1] + ov * Math.sin(Math.max(0, (p[1] - (h - ry)) / ry))]),
      ...A(rx, h - ry, rx, ry, 90, 180).map(p => [p[0], p[1]]),
      ...A(rx, ry, rx, ry, 180, 270), ...A(w - rx, ry, rx, ry, 270, 360),
      [w, T2 - 12], [w - s, T2 + 12],
      ...A(w - s - c, b + cry, c, cry, 0, -90), ...A(s + c, b + cry, c, cry, -90, -180),
      ...A(s + c, h - b - cry, c, cry, 180, 90), ...A(w - s - c, h - b - cry, c, cry, 90, 0),
      [w - s, T1 - 12],
    ]];
  };
  pon('C', W - 8, C(W - 8));

  // G: la C con barra que entra.
  const wG = W + 6, cG = Math.min(crx, (wG - 2 * S) * .47), yG = H * .475, xG = wG * .5;
  pon('G', wG, [[
    [wG, H * .665 + 12], ...A(wG - rx, H - ry, rx, ry, 0, 90), ...A(rx, H - ry, rx, ry, 90, 180),
    ...A(rx, ry, rx, ry, 180, 270), ...A(wG - rx, ry, rx, ry, 270, 360),
    [wG, yG], [xG, yG], [xG, yG - M], t(wG - S, yG - M),
    ...A(wG - S - cG, B + cry, cG, cry, 0, -90), ...A(S + cG, B + cry, cG, cry, -90, -180),
    ...A(S + cG, H - B - cry, cG, cry, 180, 90), ...A(wG - S - cG, H - B - cry, cG, cry, 90, 0),
    [wG - S, H * .665 - 12],
  ]]);

  // D
  const wD = W;
  pon('D', wD, [[[0, 0], ...A(wD - rx, ry, rx, ry, -90, 0), ...A(wD - rx, H - ry, rx, ry, 0, 90), [0, H]],
    hole([t(S, B), ...A(wD - S - crx, B + cry, crx, cry, -90, 0), ...A(wD - S - crx, H - B - cry, crx, cry, 0, 90), t(S, H - B)])]);

  // B: dos panzas con cintura mordida.
  const wB = W, my = H * .515, r2 = ry * .78, x2 = rx * .86;
  pon('B', wB, [[[0, 0], ...A(wB - x2, r2, x2, r2, -90, 0), [wB, my - 46], t(wB - 22, my), [wB - 10, my + 46], ...A(wB - 10 - x2, H - r2, x2, r2, 0, 90), [0, H]],
    hole([t(S, B), ...A(wB - S - crx, B + cry * .8, crx, cry * .8, -90, 0), ...A(wB - S - crx, my - M / 2 - cry * .8, crx, cry * .8, 0, 90), t(S, my - M / 2)]),
    hole([t(S, my + M / 2), ...A(wB - 10 - S - crx, my + M / 2 + cry * .8, crx, cry * .8, -90, 0), ...A(wB - 10 - S - crx, H - B - cry * .8, crx, cry * .8, 0, 90), t(S, H - B)])]);

  // P y R: la panza empieza en pb.
  const wP = W - 8, pb = H * .36, cP = Math.min(crx, (wP - 2 * S) * .47);
  const panza = (w, bajo) => hole([t(S, bajo + M), ...A(w - S - cP, bajo + M + cry * .8, cP, cry * .8, -90, 0), ...A(w - S - cP, H - B - cry * .8, cP, cry * .8, 0, 90), t(S, H - B)]);
  pon('P', wP, [[[0, 0], [S, 0], t(S, pb), ...A(wP - x2, pb + r2, x2, r2, -90, 0), ...A(wP - x2, H - r2, x2, r2, 0, 90), [0, H]], panza(wP, pb)]);
  const wR = W + 22, wRb = wR - 22, kR = .2, Sd = S * 1.03, pR = pb;
  const xl = wR - Sd - kR * pR;
  pon('R', wR, [[[0, 0], [S, 0], t(S, pR), t(xl, pR), [wR - Sd, 0], [wR, 0], t(wR - kR * (pR + 40), pR + 40), [wRb, pR + 82], ...A(wRb - x2, H - r2, x2, r2, 0, 90), [0, H]], panza(wRb, pR)], { r: sb - 4 });

  // S y s: la misma ruta con otras medidas.
  const ese = (w, h, s, b, f = 1) => {
    const c = Math.min(crx, (w - 2 * s) * .47) * f, cy = cry * f, R = rx * f, Y = ry * f;
    const T1 = h * .655, T2 = h * .345;
    const ly = h * .535, ry1 = h * .465;
    return [[
      [w, T1 + 12], ...A(w - R, h - Y, R, Y, 0, 90), ...A(R, h - Y, R, Y, 90, 180),
      [0, ly + h * .07], [s * .16, ly - h * .035], [s * .62, ly - h * .13], [w - s - c * .3, h * .335 + h * .02],
      [w - s, h * .285], ...A(w - s - c, b + cy, c, cy, 0, -90), ...A(s + c, b + cy, c, cy, -90, -180), [s, T2 - 12], [0, T2 + 12],
      ...A(R, Y, R, Y, 180, 270), ...A(w - R, Y, R, Y, 270, 360),
      [w, ry1 - h * .07], [w - s * .16, ry1 + h * .035], [w - s * .62, ry1 + h * .13], [s + c * .3, h * .665 - h * .02],
      [s, h * .715], ...A(s + c, h - b - cy, c, cy, 180, 90), ...A(w - s - c, h - b - cy, c, cy, 90, 0), [w - s, T1 - 12],
    ]];
  };
  pon('S', W - 4, ese(W - 4, H, S, B));

  // ------------ rectas
  const wE = W * .9;
  const E = (w) => [[[0, 0], [w, 0], [w - 12, B], t(S, B), t(S, midB), [w - 46, midB], [w - 38, midT], t(S, midT), t(S, H - B), [w - 20, H - B], [w - 8, H], [0, H]]];
  pon('E', wE, E(wE));
  pon('F', wE - 12, [[[0, 0], [S, 0], t(S, midB - 12), [wE - 58, midB - 12], [wE - 50, midT - 12], t(S, midT - 12), t(S, H - B), [wE - 32, H - B], [wE - 20, H], [0, H]]]);
  const wH = W + 18;
  pon('H', wH, [[[0, 0], [S, 0], t(S, midB), t(wH - S, midB), [wH - S, 0], [wH, 0], [wH, H], [wH - S, H], [wH - S, midT], [S, midT], [S, H], [0, H]]]);
  pon('I', S + 6, [box(0, 0, S + 6, H)]);
  const wJ = W - 34, cJ = Math.min(crx, (wJ - 2 * S) * .47);
  pon('J', wJ, [[[wJ, H], [wJ - S, H], ...A(wJ - S - cJ, B + cry, cJ, cry, 0, -90), [S, B], [S, H * .3], [0, H * .3 + 14], ...A(rx, ry, rx, ry, 180, 270), ...A(wJ - rx, ry, rx, ry, 270, 360)]]);
  pon('L', wE - 22, [[[0, 0], [wE - 22, 0], [wE - 34, B], t(S, B), [S, H], [0, H]]]);
  const wT = W - 6, cT = wT / 2;
  pon('T', wT, [[[cT - S / 2, 0], [cT + S / 2, 0], t(cT + S / 2, H - B), [wT - 12, H - B], [wT, H], [0, H], [12, H - B], t(cT - S / 2, H - B)]], { l: sb - 6, r: sb - 6 });
  const cU = Math.min(crx, (W - 2 * S) * .47);
  pon('U', W, [[[S, H], ...A(S + cU, B + cry, cU, cry, 180, 270), ...A(W - S - cU, B + cry, cU, cry, 270, 360), [W - S, H], [W, H], ...A(W - rx, ry, rx, ry, 0, -90), ...A(rx, ry, rx, ry, -90, -180), [0, H]]]);

  // ------------ diagonales
  const dg = S * 1.02;
  const wA = W + 62, dA = S * .95, cA = wA / 2, ta = S * .6, kA = (cA - ta) / H, yA = H * .185, mA = M * .9;
  const xA = (y) => dA + y * kA;
  const apexA = Math.min((cA - dA) / kA, H - B * .7);
  pon('A', wA, [[[0, 0], [dA, 0], t(xA(yA), yA), t(wA - xA(yA), yA), [wA - dA, 0], [wA, 0], [cA + ta, H], [cA - ta, H]],
    hole([[xA(yA + mA), yA + mA], [wA - xA(yA + mA), yA + mA], t(cA, apexA)])], { l: sb - 12, r: sb - 12 });

  const wV = W + 40, cV = wV / 2, tv = S * .6, kV = (cV - tv) / H, nV = (cV - dg) / kV;
  pon('V', wV, [[[cV - tv, 0], [cV + tv, 0], [wV, H], [wV - dg, H], t(cV, H - nV), [dg, H], [0, H]]], { l: sb - 12, r: sb - 12 });

  const wY = W + 22, cY = wY / 2, jY = H * .4, nY = H * .56;
  pon('Y', wY, [[[cY - S / 2, 0], [cY + S / 2, 0], [cY + S / 2, jY], [wY, H], [wY - dg, H], t(cY, nY), [dg, H], [0, H], [cY - S / 2, jY]]], { l: sb - 12, r: sb - 12 });

  const wX = W + 34, cX = wX / 2, nX = H * .29, kX = .5;
  pon('X', wX, [[[0, 0], [dg, 0], t(cX, nX), [wX - dg, 0], [wX, 0], t(cX + dg * .42, H * .5 + 10), [wX - 8, H], [wX - 8 - dg, H], t(cX, H - nX + 10), [8 + dg, H], [8, H], t(cX - dg * .42, H * .5 + 10)]], { l: sb - 8, r: sb - 8 });

  const wZ = W - 12;
  pon('Z', wZ, [[[0, 0], [wZ, 0], [wZ - 12, B], t(dg * 1.02, B), [wZ - 4, H - B * .9], [wZ - 4, H], [14, H], [24, H - B], t(wZ - dg * 1.06, H - B), [0, B * .9]]]);

  const wK = W + 44, nT = H * .64, kK = .46, tL = S + (H - nT) * kK, tR = tL + dg, jY2 = H * .53, jX = tR - (H - jY2) * kK, fR = wK, lk = (fR - jX) / jY2, fL = fR - dg, nB = (fL - S) / lk;
  pon('K', wK, [[[0, 0], [S, 0], t(S, nB), [fL, 0], [fR, 0], t(jX, jY2), [tR, H], [tL, H], t(S, nT), [S, H], [0, H]]], { r: sb - 8 });

  const wM = W + 168, cM = wM / 2, Sm = S * .9, Smt = S * 1.08, wf = S * .44, sM = 2.5, yAM = (cM - wf - Sm) * sM, yNM = H - (cM - Smt) * sM;
  pon('M', wM, [[[0, 0], [Sm, 0], t(Sm, yAM), [cM - wf, 0], [cM + wf, 0], t(wM - Sm, yAM), [wM - Sm, 0], [wM, 0], [wM, H], [wM - Smt, H], t(cM, yNM), [Smt, H], [0, H]]]);

  const wN = W + 16, Sn = S * .92, dn = S * 1.1, yn = H * .52;
  pon('N', wN, [[[0, 0], [Sn, 0], t(Sn, yn), [wN - dn, 0], [wN, 0], [wN, H], [wN - Sn, H], t(wN - Sn, H - yn), [dn, H], [0, H]]]);

  const wW = W + 246, Sw = S * .98, tw = S * .5, cW = wW / 2, xb1 = wW * .27, nCentro = H * .62, nLado = H * .34;
  // W: dos uves pegadas, con el vértice central recortado en alto.
  pon('W', wW, [[
    [xb1 - tw, 0], [xb1 + tw, 0], t(cW, nLado), [wW - xb1 - tw, 0], [wW - xb1 + tw, 0], [wW, H], [wW - Sw, H], t(wW - xb1, H * .36),
    [cW + tw * .9, H * .84], [cW + tw * .9, H], [cW - tw * .9, H], [cW - tw * .9, H * .84], t(xb1, H * .36), [Sw, H], [0, H],
  ]], { l: sb - 12, r: sb - 12 });

  // ------------ minúsculas
  const wl = W - 16, bl = B * .94, Rl = rx * .9, Yl = ry * .82, cl = Math.min(crx, (wl - 2 * S) * .47), cyl = cry * .9, mu = 34;
  const anillo = (w, h, s = S, b = bl) => [rr(0, -ov, w, h + ov, Rl, Yl), hole(rr(s, b, w - s, h - b, Math.min(cl, (w - 2 * s) * .47), cyl))];
  pon('o', wl, anillo(wl, X));

  const arcoN = (w, x0 = 0, topeTallo = X) => {
    const s = x0 + S, c = Math.min(cl, (w - x0 - 2 * S) * .47);
    return [
      [s, 0], ...A(s + c, X - bl - cyl, c, cyl, 180, 90), ...A(w - S - c, X - bl - cyl, c, cyl, 90, 0),
      [w - S, 0], [w, 0], ...A(w - Rl, X - Yl, Rl, Yl, 0, 90), [s + 54, X + ov], [s, X - mu],
    ];
  };
  pon('n', wl, [[[0, 0], ...arcoN(wl), [S - 8, X], [0, X]]]);
  pon('ñ', wl, [[[0, 0], ...arcoN(wl), [S - 8, X], [0, X]]]);
  pon('h', wl, [[[0, 0], ...arcoN(wl), [S, H], [0, H]]]);
  pon('u', wl, rot180([[[0, 0], ...arcoN(wl), [S - 8, X], [0, X]]], wl, X));
  pon('ü', wl, rot180([[[0, 0], ...arcoN(wl), [S - 8, X], [0, X]]], wl, X));
  pon('ú', wl, rot180([[[0, 0], ...arcoN(wl), [S - 8, X], [0, X]]], wl, X));

  // m: dos arcos sobre tres tallos un poco más finos.
  const Sf = S * .84, wm = wl + (wl - S * .9) * .9, am = (wm - Sf) / 2, cm = Math.min(cl, (am - Sf) * .47);
  pon('m', wm, [[[0, 0], [Sf, 0], ...A(Sf + cm, X - bl - cyl, cm, cyl, 180, 90), ...A(am - cm, X - bl - cyl, cm, cyl, 90, 0),
    [am, 0], [am + Sf, 0], ...A(am + Sf + cm, X - bl - cyl, cm, cyl, 180, 90), ...A(wm - Sf - cm, X - bl - cyl, cm, cyl, 90, 0),
    [wm - Sf, 0], [wm, 0], ...A(wm - Rl * .8, X - Yl, Rl * .8, Yl, 0, 90), [wm - Sf - 34, X + ov], [am + Sf * .5, X - mu],
    [am + Sf * .5 - 60, X + ov], [Sf + 46, X + ov], [Sf, X - mu], [Sf - 8, X], [0, X]]]);

  const bola = (w, altoTallo) => [[[0, 0], [S - 8, 0], [S, mu], [S + 54, -ov], ...A(w - Rl, Yl, Rl, Yl, -90, 0), ...A(w - Rl, X - Yl, Rl, Yl, 0, 90), [S + 54, X + ov], [S, X - mu], [S, altoTallo], [0, altoTallo]],
    hole(rr(S, bl, w - S, X - bl, Math.min(cl, (w - 2 * S) * .47), cyl))];
  const bBase = bola(wl, H);
  pon('b', wl, bBase);
  pon('d', wl, flipX(bBase, wl));
  pon('p', wl, flipY(bBase, X));
  pon('q', wl, rot180(bBase, wl, X));

  pon('c', wl - 8, C(wl - 8, X, S, bl, .36));

  // e: el ojo cerrado arriba y la abertura abajo.
  const wee = wl, yb = X * .4, cE = Math.min(cl, (wee - 2 * S) * .47), Te = X * .29;
  pon('e', wee, [[[wee, yb], ...A(wee - Rl, X - Yl, Rl, Yl, 0, 90), ...A(Rl, X - Yl, Rl, Yl, 90, 180), ...A(Rl, Yl, Rl, Yl, 180, 270), ...A(wee - Rl, Yl, Rl, Yl, 270, 360),
    [wee, Te - 10], [wee - S, Te + 10], ...A(wee - S - cE, bl + cyl * .7, cE, cyl * .7, 0, -90), ...A(S + cE, bl + cyl * .7, cE, cyl * .7, -90, -180), t(S, yb), [wee - 2, yb]],
    hole(rr(S, yb + M * .86, wee - S, X - bl, cE, cyl * .7))]);

  // a: dos pisos.
  const wa = wl, ba = X * .58, Ta = X * .67, cA2 = Math.min(cl, (wa - 2 * S) * .47);
  pon('a', wa, [[[0, Ta + 12], ...A(Rl, X - Yl, Rl, Yl, 180, 90), ...A(wa - Rl, X - Yl, Rl, Yl, 90, 0), [wa, 0], [wa - S + 8, 0], [wa - S, mu], [wa - S - 54, -ov], ...A(Rl * .86, Yl * .8, Rl * .86, Yl * .8, 270, 180), ...A(Rl * .86, ba - Yl * .7, Rl * .86, Yl * .7, 180, 90), t(wa - S, ba),
    ...A(wa - S - cA2, X - bl - cyl * .7, cA2, cyl * .7, 0, 90), ...A(S + cA2, X - bl - cyl * .7, cA2, cyl * .7, 90, 180), [S, Ta - 12]],
    hole([t(wa - S, bl * .96), t(wa - S, ba - M * .84), ...A(S + cA2, ba - M * .84 - cyl * .6, cA2, cyl * .6, 90, 180), ...A(S + cA2, bl * .96 + cyl * .6, cA2, cyl * .6, 180, 270)])]);

  // g: de un piso, con gancho.
  const Dg = -Math.round(H * .235), wg = wl;
  pon('g', wg, [[[wg, X], ...A(wg - Rl, Dg + Yl * .8, Rl, Yl * .8, 0, -90), ...A(Rl, Dg + Yl * .8, Rl, Yl * .8, -90, -180), [0, Dg + bl * 1.25 + 6], [S, Dg + bl * 1.25 - 6], [S, Dg + bl], [wg - S, Dg + bl], [wg - S, mu], [wg - S - 54, -ov], ...A(Rl, Yl, Rl, Yl, 270, 180), ...A(Rl, X - Yl, Rl, Yl, 180, 90), [wg - S - 54, X + ov], [wg - S, X - mu], [wg - S + 8, X]],
    hole(rr(S, bl, wg - S, X - bl, Math.min(cl, (wg - 2 * S) * .47), cyl))]);

  pon('s', wl - 10, ese(wl - 10, X, S * .97, bl * .93, .84));

  // f y t
  const Mf = M * .92, xf = S * .22, wf2 = S + xf + S * .66;
  pon('f', wf2, [[[xf, 0], [xf + S, 0], [xf + S, X - Mf], [wf2 - 12, X - Mf], [wf2 - 6, X], t(xf + S, X), [xf + S, H - bl], [wf2, H - bl + 4], [wf2, H + ov], ...A(xf + Rl * .66, H - Yl * .66, Rl * .66, Yl * .66, 90, 180), [xf, X], [0, X], [0, X - Mf], [xf, X - Mf]]], { r: sb - 8 });
  const wt2 = S + xf + S * .7, topT = X + (H - X) * .62;
  pon('t', wt2, [[[xf, X - Mf], [0, X - Mf], [0, X], [xf, X], [xf, topT - 26], [xf + S, topT + 18], [xf + S, X], [wt2 - 8, X], [wt2 - 14, X - Mf], [xf + S, X - Mf], [xf + S, bl], [wt2, bl + 4], [wt2, -ov], ...A(xf + Rl * .66, Yl * .66, Rl * .66, Yl * .66, 270, 180)]], { r: sb - 8 });

  // r
  const wr = S + S * .86;
  pon('r', wr, [[[0, 0], [S, 0], [S, X - bl * 1.5], [S + 44, X - bl * 1.08], [wr, X - bl * 1.1 - 10], [wr, X + ov], [S + 60, X + ov], [S, X - mu], [S - 8, X], [0, X]]], { r: sb - 8 });

  pon('l', S, [box(0, 0, S, H)]);
  const dot = (w = S, y = X + (H - X) * .24) => box(0, y, w, y + Math.min(S * .96, 165));
  pon('i', S, [box(0, 0, S, X), dot()]);
  pon('ı', S, [box(0, 0, S, X)]);
  pon('í', S + 28, [box(14, 0, S + 14, X)], { l: sb - 10, r: sb - 10 });
  const Dj = -Math.round(H * .235), wj = S + S * .6;
  pon('j', wj, [[[wj, X], [wj - S, X], [wj - S, Dj + bl], [0, Dj + bl], [0, Dj], [wj - Rl * .6, Dj], ...A(wj - Rl * .6, Dj + Yl * .6, Rl * .6, Yl * .6, -90, 0)], map(dot(), (x, y) => [x + wj - S, y])], { l: sb - (wj - S) });

  // k
  const wk = wl + 30, nTk = X * .7, kk = .46, tLk = S + (X - nTk) * kk, tRk = tLk + dg * .96, jYk = X * .54, jXk = tRk - (X - jYk) * kk, fRk = wk, lkk = (fRk - jXk) / jYk, fLk = fRk - dg * .98, nBk = (fLk - S) / lkk;
  pon('k', wk, [[[0, 0], [S, 0], t(S, nBk), [fLk, 0], [fRk, 0], t(jXk, jYk), [tRk, X], [tLk, X], t(S, nTk), [S, H], [0, H]]], { r: sb - 8 });

  // v w x y z
  const wv = wl + 34, cv = wv / 2, tvv = S * .58, kv = (cv - tvv) / X, nv = (cv - dg * .96) / kv;
  pon('v', wv, [[[cv - tvv, 0], [cv + tvv, 0], [wv, X], [wv - dg * .96, X], t(cv, X - nv), [dg * .96, X], [0, X]]], { l: sb - 12, r: sb - 12 });
  const ww = wl + 216, cw = ww / 2, tw2 = S * .48, xb2 = ww * .27, Sw2 = S * .94;
  pon('w', ww, [[[xb2 - tw2, 0], [xb2 + tw2, 0], t(cw, X * .36), [ww - xb2 - tw2, 0], [ww - xb2 + tw2, 0], [ww, X], [ww - Sw2, X], t(ww - xb2, X * .38), [cw + tw2 * .9, X * .82], [cw + tw2 * .9, X], [cw - tw2 * .9, X], [cw - tw2 * .9, X * .82], t(xb2, X * .38), [Sw2, X], [0, X]]], { l: sb - 12, r: sb - 12 });
  const wx = wl + 30, cx = wx / 2, nxx = X * .26;
  pon('x', wx, [[[0, 0], [dg, 0], t(cx, nxx), [wx - dg, 0], [wx, 0], t(cx + dg * .4, X * .5 + 8), [wx - 8, X], [wx - 8 - dg * .96, X], t(cx, X - nxx + 8), [8 + dg * .96, X], [8, X], t(cx - dg * .4, X * .5 + 8)]], { l: sb - 8, r: sb - 8 });
  const wy = wl + 34, Dy = Dg, xTail = wy * .08, ky = ((wy - xTail) - dg * .96) / (X - Dy);
  const yR = (y) => wy - (X - y) * ky, cyy = wy / 2 - dg * .08, nyy = X - (wy - dg * .96 - cyy) / ky;
  pon('y', wy, [[[0, X], [dg * .96, X], t(cyy, nyy), [wy - dg * .96, X], [wy, X], [xTail + dg * .96, Dy], [xTail, Dy], [cyy - dg * .42, 18]]], { l: sb - 12, r: sb - 12 });
  const wz = wl - 22;
  pon('z', wz, [[[0, 0], [wz, 0], [wz - 10, bl], t(dg, bl), [wz - 4, X - bl * .9], [wz - 4, X], [12, X], [20, X - bl], t(wz - dg * 1.04, X - bl), [0, bl * .9]]]);

  // ------------ cifras: todas del mismo ancho, para que la plata no baile.
  const wn = W - 6, Tn = wn;
  const cN = Math.min(crx, (wn - 2 * S) * .47);
  pon('0', wn, anilloO(wn));
  const x1 = (wn - S) / 2 + 22;
  pon('1', wn, [[[x1, 0], [x1 + S, 0], [x1 + S, H], [x1 + 8, H], [x1 - S * .66, H * .74], [x1 - S * .66, H * .54], t(x1, H * .68)]]);
  const y2 = H * .54;
  pon('2', wn, [[[0, H * .665 - 12], ...A(rx, H - ry, rx, ry, 180, 90), ...A(wn - rx, H - ry, rx, ry, 90, 0), [wn, y2 + 22], [wn - 10, y2 - 14], t(S * 1.06, B), [wn, B], [wn, 0], [0, 0], [0, B * 1.02], [wn - S - 6, y2 + 28], ...A(wn - S - cN, H - B - cry, cN, cry, 0, 90), ...A(S + cN, H - B - cry, cN, cry, 90, 180), [S, H * .665 + 12]]]);
  const my3 = H * .52, xm3 = S * .9;
  pon('3', wn, [[[0, H * .68 - 12], ...A(rx, H - ry, rx, ry, 180, 90), ...A(wn - rx, H - r2, rx, r2, 90, 0), [wn - 4, my3 + 50], t(wn - 28, my3), [wn, my3 - 50], ...A(wn - rx, r2, rx, r2, 0, -90), ...A(rx, ry, rx, ry, -90, -180), [0, H * .32 - 12], [S, H * .32 + 12], ...A(S + cN, B + cry * .8, cN, cry * .8, 180, 270), ...A(wn - S - cN, B + cry * .8, cN, cry * .8, 270, 360), ...A(wn - S - cN, my3 - M / 2 - cry * .7, cN, cry * .7, 0, 90), [xm3, my3 - M / 2], [xm3, my3 + M / 2], ...A(wn - S - cN, my3 + M / 2 + cry * .7, cN, cry * .7, -90, 0), ...A(wn - S - cN, H - B - cry * .8, cN, cry * .8, 0, 90), ...A(S + cN, H - B - cry * .8, cN, cry * .8, 90, 180), [S, H * .68 + 12]]]);
  const x4 = wn - S - S * .1, y4 = H * .19, M4 = M * .96, k4 = (x4 - S * .24) / (H * .68);
  pon('4', wn, [[[x4, 0], [x4 + S, 0], [x4 + S, y4], [wn, y4 + 2], [wn, y4 + M4], [x4 + S, y4 + M4], [x4 + S, H], [x4 - S * .34, H], [0, y4 + M4], [0, y4], [x4, y4]],
    hole([[x4, y4 + M4], t(x4, y4 + M4 + (x4 - S * .86) / k4 * .9), t(S * .78, y4 + M4)])]);
  const yb5 = H * .6, ml5 = yb5 - M * .96;
  pon('5', wn, [[[wn - 8, H], [8, H], [0, ml5], ...A(wn - S - cN, ml5 - cry * .8, cN, cry * .8, 90, 0), ...A(wn - S - cN, B + cry * .8, cN, cry * .8, 0, -90), ...A(S + cN, B + cry * .8, cN, cry * .8, -90, -180), [S, H * .32 + 12], [0, H * .32 - 12], ...A(rx, ry, rx, ry, 180, 270), ...A(wn - rx, ry, rx, ry, 270, 360), ...A(wn - rx, yb5 - r2, rx, r2, 0, 90), t(S, yb5), t(S, H - B), [wn - 20, H - B]]]);
  const yb6 = H * .575, seis = [[[wn, H * .68 + 12], ...A(wn - rx, H - ry, rx, ry, 0, 90), ...A(rx, H - ry, rx, ry, 90, 180), ...A(rx, ry, rx, ry, 180, 270), ...A(wn - rx, ry, rx, ry, 270, 360), ...A(wn - rx, yb6 - r2, rx, r2, 0, 90), t(S, yb6), ...A(S + cN, H - B - cry * .8, cN, cry * .8, 180, 90), ...A(wn - S - cN, H - B - cry * .8, cN, cry * .8, 90, 0), [wn - S, H * .68 - 12]],
    hole(rr(S, B, wn - S, yb6 - M * .92, cN, cry * .8))];
  pon('6', wn, seis);
  pon('9', wn, rot180(seis, wn, H));
  pon('7', wn, [[[0, H], [wn, H], [wn, H - B * .92], [S * 1.32, 0], [S * .14, 0], t(wn - S * 1.1, H - B), [0, H - B]]]);
  const my8 = H * .525;
  pon('8', wn, [[...A(wn - rx, r2 + 4, rx, r2 + 4, -90, 0), [wn, my8 - 50], t(wn - 24, my8), [wn - 10, my8 + 50], ...A(wn - 10 - rx, H - r2, rx, r2, 0, 90), ...A(10 + rx, H - r2, rx, r2, 90, 180), [10, my8 + 50], t(24, my8), [0, my8 - 50], ...A(rx, r2 + 4, rx, r2 + 4, 180, 270)],
    hole(rr(S, B, wn - S, my8 - M / 2, cN, cry * .7)), hole(rr(S + 6, my8 + M / 2, wn - S - 6, H - B, cN, cry * .7))]);

  // ------------ signos
  const pt = Math.min(S * .96, 170);
  const cuña = (x0, w, y0, y1, an0, an1) => [[x0 + (w - an0) / 2, y0], [x0 + (w + an0) / 2, y0], [x0 + (w + an1) / 2, y1], [x0 + (w - an1) / 2, y1]];
  const wE2 = S * 1.28;
  pon('!', wE2, [cuña(0, wE2, pt + 56, H, S * .66, wE2), box((wE2 - pt) / 2, 0, (wE2 + pt) / 2, pt)]);
  pon('¡', wE2, shift(rot180([cuña(0, wE2, pt + 56, H, S * .66, wE2), box((wE2 - pt) / 2, 0, (wE2 + pt) / 2, pt)], wE2, H), 0, -24), {});
  const wQ = W - 40, cQ = Math.min(crx, (wQ - 2 * S) * .47);
  const preg = [[[0, H * .67 - 12], ...A(rx, H - ry, rx, ry, 180, 90), ...A(wQ - rx, H - ry, rx, ry, 90, 0), [wQ, H * .52], [wQ - 18, H * .47], [wQ / 2 + S * .46, H * .38], [wQ / 2 + S * .46, pt + 50], [wQ / 2 - S * .46, pt + 50], [wQ / 2 - S * .46, H * .44], [wQ - S - 14, H * .55], [wQ - S, H * .58], ...A(wQ - S - cQ, H - B - cry, cQ, cry, 0, 90), ...A(S + cQ, H - B - cry, cQ, cry, 90, 180), [S, H * .67 + 12]], box(wQ / 2 - pt / 2, 0, wQ / 2 + pt / 2, pt)];
  pon('?', wQ, preg);
  pon('¿', wQ, shift(rot180(preg, wQ, H), 0, -24));
  pon('.', pt, [box(0, 0, pt, pt)]);
  const coma = (x = 0, y = 0) => [[x, y], [x + pt, y], [x + pt, y + pt * .1], [x + pt, y + pt * .96], [x, y + pt * .96]];
  pon(',', pt, [[[0, 0], [pt * .3, 0], [pt * .02, -pt * .62], [pt * .54, -pt * .62], [pt, -pt * .02], [pt, pt], [0, pt]]]);
  pon(':', pt, [box(0, 0, pt, pt), box(0, X - pt, pt, X)]);
  pon(';', pt, [[[0, 0], [pt * .3, 0], [pt * .02, -pt * .62], [pt * .54, -pt * .62], [pt, -pt * .02], [pt, pt], [0, pt]], box(0, X - pt, pt, X)]);
  pon('-', S * 1.2, [box(0, H * .3, S * 1.2, H * .3 + M * .86)]);
  pon('–', W * .9, [box(0, H * .3, W * .9, H * .3 + M * .8)]);
  pon('—', W * 1.5, [box(0, H * .3, W * 1.5, H * .3 + M * .8)]);
  const comilla = (x, a = 0) => [[x + a, H + 8], [x + pt * .78 + a, H + 8], [x + pt * .6, H - pt * 1.28], [x + pt * .14, H - pt * 1.28]];
  pon("'", pt * .78, [comilla(0)]);
  pon('"', pt * 1.74, [comilla(0), comilla(pt * .96)]);
  const wPar = S * 1.06, p0 = -96, p1 = H + 76, sp = S * .62, rPar = Math.min(wPar - 8, 150);
  const paren = [[[wPar, p0], [wPar, p0 + B * .78], ...A(wPar + 0, H / 2 - 0, 0, 0, 0, 0, 1).slice(0, 0), [sp + 24, p0 + B * .78 + 40], [sp, p0 + 220], [sp, p1 - 220], [sp + 24, p1 - B * .78 - 40], [wPar, p1 - B * .78], [wPar, p1], [rPar * .5, p1 - 34], [0, p1 - 220], [0, p0 + 220], [rPar * .5, p0 + 34]]];
  pon('(', wPar, paren);
  pon(')', wPar, flipX(paren, wPar));
  const wSl = W * .78, dS = S * .96;
  pon('/', wSl, [[[0, -36], [dS, -36], [wSl, H + 36], [wSl - dS, H + 36]]], { l: sb - 14, r: sb - 14 });
  const wMas = W * .92, ma = S * .74, cyM = H * .39, lm = wMas / 2;
  pon('+', wMas, [[[lm - ma / 2, cyM - lm], [lm + ma / 2, cyM - lm], t(lm + ma / 2, cyM - ma / 2), [wMas, cyM - ma / 2], [wMas, cyM + ma / 2], t(lm + ma / 2, cyM + ma / 2), [lm + ma / 2, cyM + lm], [lm - ma / 2, cyM + lm], t(lm - ma / 2, cyM + ma / 2), [0, cyM + ma / 2], [0, cyM - ma / 2], t(lm - ma / 2, cyM - ma / 2)]]);
  const wMul = W * .86, cMul = wMul / 2, qm = S * .42, cyMu = H * .39, rm = wMul / 2;
  pon('×', wMul, [[[cMul, cyMu - qm], [cMul + rm - qm, cyMu - rm], [cMul + rm, cyMu - rm + qm], [cMul + qm, cyMu], [cMul + rm, cyMu + rm - qm], [cMul + rm - qm, cyMu + rm], [cMul, cyMu + qm], [cMul - rm + qm, cyMu + rm], [cMul - rm, cyMu + rm - qm], [cMul - qm, cyMu], [cMul - rm, cyMu - rm + qm], [cMul - rm + qm, cyMu - rm]]]);
  // $: la S con dos muñones arriba y abajo.
  const wPe = W - 4, cP2 = (wPe - S * .4) / 2;
  pon('$', wPe, [...ese(wPe, H - 28, S, B * .96).map(c => map(c, (x, y) => [x, y + 14])), box(cP2, H - 28, cP2 + S * .4, H + 62), box(cP2, -62, cP2 + S * .4, 28)]);
  // %: dos ceros pequeños y la raya.
  const wPc = W + 182, oP = wPc * .36, hP = H * .46, sP = oP * .34, bP = B * .66;
  const ceroP = (x, y) => [rr(x, y, x + oP, y + hP, 62, 72), hole(rr(x + sP, y + bP, x + oP - sP, y + hP - bP, (oP - 2 * sP) * .46, 22))];
  pon('%', wPc, [...ceroP(0, H - hP), ...ceroP(wPc - oP, 0), [[wPc * .24, -14], [wPc * .24 + dS * .72, -14], [wPc * .76, H + 14], [wPc * .76 - dS * .72, H + 14]]]);
  // °
  const dG = S * 1.2;
  pon('°', dG, [rr(0, H - dG + 20, dG, H + 20, 60, 60), hole(rr(S * .36, H - dG + 20 + S * .36, dG - S * .36, H + 20 - S * .36, 12, 12))]);
  // « »
  const chev = (x, w, h) => [[x, h / 2], [x + w * .54, h], [x + w, h], [x + w * .5, h / 2], [x + w, 0], [x + w * .54, 0]];
  const hCh = X * .62, wCh = S * 1.16, yCh = X * .14;
  pon('«', wCh * 1.74, [shift([chev(0, wCh, hCh)], 0, yCh)[0], shift([chev(wCh * .74, wCh, hCh)], 0, yCh)[0]]);
  pon('»', wCh * 1.74, flipX([shift([chev(0, wCh, hCh)], 0, yCh)[0], shift([chev(wCh * .74, wCh, hCh)], 0, yCh)[0]], wCh * 1.74));
  pon('…', pt * 3 + 70, [box(0, 0, pt, pt), box(pt + 35, 0, 2 * pt + 35, pt), box(2 * pt + 70, 0, 3 * pt + 70, pt)]);
  pon('∙', pt, [box(0, H * .3, pt, H * .3 + pt)]);
  // ✓ ✗ ★
  const wOk = W + 30, ok = S * .86;
  pon('✓', wOk, [[[wOk * .28, 0], [wOk * .28 + ok * .92, 0], [wOk + 26, H * .94], [wOk + 26 - ok, H * .94], t(wOk * .47, H * .3), [wOk * .3, H * .46], [0, H * .3]]]);
  pon('✗', wMul, scale(G['×'].c, 1, 1));
  const star = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? W * .24 : W * .56, a = (90 + i * 36) * D2R; star.push([W * .56 + r * Math.cos(a), H * .42 + r * Math.sin(a)]); }
  pon('★', W * 1.12, [star]);
  // Flechas: asta y punta, una sola silueta girada de a 45 grados.
  const wFl = W + 30, ca = wFl / 2, ha = wFl * .5, ast = S * .72, pa = H * .36;
  const flecha = [[ca, H * .39 + ha], [ca + ha, H * .39 + ha - pa], [ca + ast / 2 + 8, H * .39 + ha - pa], [ca + ast / 2, H * .39 - ha], [ca - ast / 2, H * .39 - ha], [ca - ast / 2 - 8, H * .39 + ha - pa], [ca - ha, H * .39 + ha - pa]];
  const girar = (deg) => { const a = deg * D2R, c = Math.cos(a), s = Math.sin(a), cy0 = H * .39; return flecha.map(([x, y]) => [ca + (x - ca) * c - (y - cy0) * s, cy0 + (x - ca) * s + (y - cy0) * c]); };
  const flechas = { '↑': 0, '↗': -45, '→': -90, '↘': -135, '↓': 180, '↙': 135, '←': 90, '↖': 45 };
  for (const [ch, deg] of Object.entries(flechas)) pon(ch, wFl, [girar(deg)], { l: sb + 6, r: sb + 6 });

  // ------------ tildes
  const altoTilde = Math.round(B * .96);
  const agudo = (cx, y) => [[cx - S * .46, y], [cx + S * .02, y], [cx + S * .56, y + altoTilde], [cx + S * .02, y + altoTilde]];
  const tilde = (cx, y, w) => { const x0 = cx - w / 2, h = altoTilde * 1.22; return [[x0, y], [x0, y + h * .7], [x0 + w * .28, y + h], [x0 + w * .68, y + h * .56], [x0 + w, y + h], [x0 + w, y + h * .3], [x0 + w * .72, y], [x0 + w * .32, y + h * .44]]; };
  const puntos = (cx, y, sep, lado) => [box(cx - sep / 2 - lado, y, cx - sep / 2, y + lado), box(cx + sep / 2, y, cx + sep / 2 + lado, y + lado)];
  const copia = (b, ch, extra) => pon(ch, G[b].w, [...G[b].c, ...extra], { l: G[b].l, r: G[b].r });
  const yCap = H + 30, yLow = X + 44;
  copia('A', 'Á', [agudo(G.A.w / 2, yCap)]);
  copia('E', 'É', [agudo(G.E.w / 2, yCap)]);
  copia('I', 'Í', [agudo(G.I.w / 2, yCap)]);
  copia('O', 'Ó', [agudo(G.O.w / 2, yCap)]);
  copia('U', 'Ú', [agudo(G.U.w / 2, yCap)]);
  copia('N', 'Ñ', [tilde(G.N.w / 2, yCap, G.N.w * .86)]);
  copia('U', 'Ü', puntos(G.U.w / 2, yCap, S * .28, S * .6));
  copia('a', 'á', [agudo(G.a.w / 2, yLow)]);
  copia('e', 'é', [agudo(G.e.w / 2, yLow)]);
  G['í'].c = [box(14, 0, S + 14, X), agudo((S + 28) / 2, yLow)];
  copia('o', 'ó', [agudo(G.o.w / 2, yLow)]);
  G['ú'].c = [...G['ú'].c, agudo(G.u.w / 2, yLow)];
  G['ñ'].c = [...G['ñ'].c, tilde(G.n.w / 2, yLow, G.n.w * .84)];
  G['ü'].c = [...G['ü'].c, ...puntos(G.u.w / 2, yLow, S * .28, S * .56)];
  pon(' ', Math.round(W * .46), [], { l: 0, r: 0 });
  pon(' ', Math.round(W * .46), [], { l: 0, r: 0 });
  // Espacio de cifra, para alinear la plata a mano.
  pon(' ', wn, [], {});
  return G;
}

const KERN_T = { AV: -64, AT: -46, AY: -64, AW: -44, AO: -12, LT: -60, LV: -54, LY: -64, LO: -8, TA: -58, TO: -18, 'T.': -70, 'T,': -70, VA: -64, VO: -14, 'V.': -60, YA: -64, YO: -18, 'Y.': -60, PA: -44, 'P.': -70, RT: -18, RV: -14, RY: -22, FA: -36, 'F.': -60, KO: -22, KA: -8, OA: -10, DA: -10, UA: -8, 'A"': -30, 'L"': -44, CA: -6, Ta: -40, To: -40, Te: -40, Ya: -30, Yo: -30, Va: -30, Vo: -30, ry: 6, 'r.': -40, 'r,': -40, 'v.': -40, 'y.': -40, 'w.': -30, 'f.': -24, '1.': -16, '7.': -50, '¡L': -6, 'A¡': -6 };

// Lo que hay que imprimir: letras, cifras y los signos de un titular. Nada de flechas ni de dibujos.
const SE_QUEDAN = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 \u00A0.,:;¡!¿?'"()\-–—$%«»…]$/u;

function ensamblar(m, G, nombre, archivo, peso) {
  const glyphs = {};
  for (const [ch, g] of Object.entries(G)) {
    if (!SE_QUEDAN.test(ch)) continue;
    const c = g.c.map((cont) => {
      const crudo = trampas(cont, m.tt, m.dd).map(([x, y]) => [Math.round(x + (g.l ?? 0)), Math.round(y)]);
      const limpio = crudo.filter((p, i) => { const q = crudo[(i - 1 + crudo.length) % crudo.length]; return p[0] !== q[0] || p[1] !== q[1]; });
      limpio.hole = cont.hole === true;
      return limpio;
    });
    glyphs[ch] = { advance: Math.round((g.l ?? 0) + g.w + (g.r ?? 0)), contours: c };
  }
  const { woff } = buildFont({ family: `Imprenta ${nombre}`, style: 'Regular', weight: peso, unitsPerEm: 1000, ascent: 980, descent: -280, capHeight: m.H, xHeight: m.X, glyphs, kerning: KERN_T });
  fs.writeFileSync(path.join(SALIDA, archivo), woff);
  console.log(archivo, 'glifos', Object.keys(glyphs).length, 'woff', woff.length);
}

fs.mkdirSync(SALIDA, { recursive: true });
ensamblar(TITULAR, dibujar(TITULAR), 'Titular', 'titular.woff', 900);
ensamblar(TIRA, dibujar(TIRA), 'Tira', 'tira.woff', 700);
