// src/world/bogota/carLoft.js
// Carrocería como rejilla de secciones transversales a lo largo de X (frente +X, Y arriba, suelo y = 0).
// Cada modelo define curvas (silueta, cintura, hombro, borde inferior, planta) y de ellas sale la media
// rejilla: una estación por sección, una fila por punto de la sección, del centro inferior al centro del techo.
// Vidrio, molduras y esmalte son caras de la misma rejilla: comparten vértices y normales, y por eso el
// reflejo pasa continuo del capó al parabrisas. Nada de cajas pegadas.

/** Interpolación monótona por puntos [x, y]: no sobrepasa el control, así un techo recto sigue recto. */
export function curve(points) {
  const n = points.length, xs = new Float64Array(n), ys = new Float64Array(n), ms = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = points[i][0]; ys[i] = points[i][1]; }
  if (n === 1) return () => ys[0];
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  ms[0] = d[0]; ms[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) ms[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let a = 0, b = n - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (xs[m] > x) b = m; else a = m; }
    const h = xs[b] - xs[a], t = (x - xs[a]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[a] + (t3 - 2 * t2 + t) * h * ms[a] + (-2 * t3 + 3 * t2) * ys[b] + (t3 - t2) * h * ms[b];
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Filas de la sección, de abajo hacia arriba. E y E2 coinciden: ahí cambia la carta de la textura de detalle.
export const ROW = Object.freeze({ UC: 0, UO: 1, LIP: 2, LIPT: 3, ROCK: 4, LOW: 5, MID: 6, MO: 7, CU: 8, C: 9, CO: 10, BU: 11,
  BELT: 12, GL: 13, GM: 14, GH: 15, EL: 16, E: 17, E2: 18, T1: 19, T2: 20, T3: 21, T4: 22, TC: 23 });
const NR = 24;
// Fracción del ancho del techo en las filas superiores (1 en el borde, 0 en el centro).
const TOP_F = [1, .91, .86, .56, 0, 0];

export const CELL = Object.freeze({ SKIP: 0, PAINT: 1, GLASS: 2, TRIM: 3, CHROME: 4, DARK: 5 });

// Estaciones de cierre de nariz y cola: muy juntas donde la planta cierra más rápido.
const CLOSE_T = [0, .015, .06, .14, .26, .42, .62, 1];
const ARCH_STEPS = 6;

export class CarBody {
  constructor(spec) {
    this.spec = spec;
    const { L, W } = spec;
    this.xNose = L / 2; this.xTail = -L / 2;
    this.top = curve(spec.top); this.edge = curve(spec.edge); this.belt = curve(spec.belt);
    this.shoulder = curve(spec.shoulder); this.bottom0 = curve(spec.bottom);
    this.plan = spec.plan ? curve(spec.plan) : () => 1;
    this.edgeZ = curve(spec.edgeZ);
    this.bow = spec.bow ? curve(spec.bow) : () => 0;
    // Pliegue bajo de las puertas, que en los extremos se vuelve la costura del parachoques. Solo si el modelo lo pide.
    this.lowLine = spec.lowLine ? curve(spec.lowLine) : null;
    this.halfW = W / 2;
    this._stations();
    this._grid();
    this._normals();
    this._charts();
    this._planCache = { nose: new Map(), tail: new Map() };
  }

  /** Semiancho en planta con cierre superelíptico en los extremos. */
  hw(x) {
    const s = this.spec;
    let c = 1;
    const dn = this.xNose - x, dt = x - this.xTail;
    if (dn < s.noseLen) c = Math.min(c, Math.pow(1 - Math.pow(1 - clamp01(dn / s.noseLen), s.noseN), 1 / s.noseN));
    if (dt < s.tailLen) c = Math.min(c, Math.pow(1 - Math.pow(1 - clamp01(dt / s.tailLen), s.tailN), 1 / s.tailN));
    return this.halfW * this.plan(x) * c;
  }

  /** Borde inferior: sube siguiendo el arco de cada rueda; el labio es esa misma fila. */
  yBottom(x) {
    const { axleF, axleR, archR, archY } = this.spec;
    let y = this.bottom0(x);
    for (const ax of [axleF, axleR]) {
      const dx = Math.abs(x - ax);
      if (dx < archR) y = Math.max(y, archY + Math.sqrt(archR * archR - dx * dx));
    }
    return y;
  }

  flare(x) {
    const { axleF, axleR, archR, flare = 0 } = this.spec;
    if (!flare) return 0;
    const f = (x - axleF) / (archR * 1.25), r = (x - axleR) / (archR * 1.25);
    return flare * Math.max(Math.exp(-f * f * f * f), Math.exp(-r * r * r * r));
  }

  _stations() {
    const s = this.spec, keys = [];
    for (const t of CLOSE_T) { keys.push(this.xNose - s.noseLen * t, this.xTail + s.tailLen * t); }
    for (const ax of [s.axleF, s.axleR]) {
      keys.push(ax - s.archR - .002, ax + s.archR + .002);
      for (let k = 0; k <= ARCH_STEPS; k++) keys.push(ax + s.archR * Math.cos(Math.PI * k / ARCH_STEPS));
    }
    for (const x of s.keys ?? []) keys.push(x);
    keys.sort((a, b) => a - b);
    const X = [keys[0]];
    for (const x of keys) if (x - X[X.length - 1] > .0015) X.push(x);
    // Ningún tramo largo sin estación: el borde superior y el reflejo se verían facetados.
    const max = s.maxGap ?? .5, filled = [];
    for (let i = 0; i < X.length; i++) {
      filled.push(X[i]);
      const gap = X[i + 1] - X[i];
      if (gap > max) {
        const n = Math.ceil(gap / max);
        for (let k = 1; k < n; k++) filled.push(X[i] + gap * k / n);
      }
    }
    this.X = filled;
    this.ns = filled.length;
  }

  /** Índice de la estación más cercana a x. */
  st(x) {
    const X = this.X;
    let a = 0, b = X.length - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (X[m] > x) b = m; else a = m; }
    return x - X[a] < X[b] - x ? a : b;
  }

  _grid() {
    const { ns, X, spec } = this;
    const P = this.P = new Float32Array(ns * NR * 3);
    const crease = spec.crease ?? .006, p = spec.crown ?? 2.4, tuck = spec.tuck ?? .972, shelf = spec.shelf ?? .958;
    const put = (si, r, x, y, z) => { const i = (si * NR + r) * 3; P[i] = x; P[i + 1] = y; P[i + 2] = z; };
    for (let si = 0; si < ns; si++) {
      const x = X[si], hw = this.hw(x), yB = this.yBottom(x), b0 = this.bottom0(x), fl = this.flare(x) * clamp01(hw / this.halfW * 1.3);
      const bow = this.bow(x), tc = this.top(x + bow);
      const e = Math.max(yB, Math.min(this.edge(x), tc));
      const belt = Math.max(yB, Math.min(this.belt(x), e));
      const s = Math.max(Math.min(yB + .03, belt), Math.min(this.shoulder(x), belt - .001));
      const ze = Math.min(this.edgeZ(x), hw * .985);
      const shelfF = lerp(1, shelf, smooth(0, 1, Math.min((this.xNose - x) / (spec.noseLen * 1.25), (x - this.xTail) / (spec.tailLen * 1.25))));
      const zb = lerp(ze, Math.max(ze, hw * shelfF), smooth(0, .09, e - belt));
      const hf = hw + fl;
      // En nariz y cola la cara mira hacia adelante: ahí cualquier arruga en z saltaría muchos centímetros en x.
      // Las aristas del costado se desvanecen antes del cierre y la sección queda lisa bajo faros, parrilla y placa.
      const endF = smooth(0, 1, Math.min((this.xNose - x) / (spec.noseLen * 1.25), (x - this.xTail) / (spec.tailLen * 1.25)));
      const rowZ = f => hw * lerp(1, f, endF);
      put(si, ROW.UC, x, yB, 0);
      put(si, ROW.UO, x, yB, hw * .78);
      put(si, ROW.LIP, x, yB, rowZ(.968) + fl);
      let y = yB + .014;
      put(si, ROW.LIPT, x, Math.min(y, s), rowZ(.985) + fl);
      y = Math.min(Math.max(yB + .02, b0 + (spec.rocker ?? .085)), s);
      // Sobre un arco la fila deja de ser estribo: queda casi a ras del panel y el labio se lee como un reborde.
      const rockZ = lerp(rowZ(tuck), rowZ(.994), clamp01((yB - b0 - .02) / .05)) + fl * .9;
      put(si, ROW.ROCK, x, y, rockZ);
      let yy;
      if (this.lowLine) {
        // Tres filas muy juntas: abajo la cara mira al piso, arriba el panel queda un poco hundido; así la luz dibuja la línea.
        const ly = this.lowLine(x), yLow = Math.min(Math.max(y, ly - .014), s), yMid = Math.min(Math.max(yLow + .001, ly), s), yMo = Math.min(Math.max(yMid + .001, ly + .012), s);
        const open = clamp01((yMid - y - .008) / .03), depth = (spec.lowDepth ?? .005) * endF;
        put(si, ROW.LOW, x, yLow, lerp(rockZ, hf - .001 * endF, open));
        put(si, ROW.MID, x, yMid, lerp(rockZ, hf, open));
        put(si, ROW.MO, x, yMo, lerp(rockZ, hf - depth, open));
        yy = yMo;
      } else {
        // LOW coincide con el estribo: una fila menos por costado, y el panel plano no la echa de menos.
        put(si, ROW.LOW, x, y, rockZ);
        yy = Math.min(Math.max(y + .001, lerp(b0, s, .62)), s);
        put(si, ROW.MID, x, yy, hf);
        put(si, ROW.MO, x, yy, hf);
      }
      yy = Math.min(Math.max(yy, s - .011), s);
      put(si, ROW.CU, x, yy, rowZ(.999) + fl * .4);
      put(si, ROW.C, x, s, hw + crease * endF * clamp01(hw * 4));
      const co = Math.min(s + .011, belt);
      const zOver = u => lerp(rowZ(.992), zb, u * u);
      const span = Math.max(belt - s, 1e-4);
      put(si, ROW.CO, x, co, Math.max(zOver((co - s) / span), ze));
      const bu = Math.max(co, belt - .011);
      put(si, ROW.BU, x, bu, Math.max(zOver((bu - s) / span) + .002, ze));
      put(si, ROW.BELT, x, belt, zb);
      const gspan = Math.max(e - belt, 1e-4), zg = t => lerp(zb, ze, t);
      const gl = Math.min(belt + .017, e), gh = Math.max(belt, e - .022), el = Math.max(belt, e - .007);
      const lo = Math.min(gl, gh), hi = Math.max(gl, gh);
      put(si, ROW.GL, x, lo, zg((lo - belt) / gspan));
      // El vidrio es plano en la sección: GM coincide con GL.
      put(si, ROW.GM, x, lo, zg((lo - belt) / gspan));
      put(si, ROW.GH, x, hi, zg((hi - belt) / gspan));
      put(si, ROW.EL, x, el, ze + (e - belt > .03 ? .002 : 0));
      put(si, ROW.E, x, e, ze);
      for (let k = 0; k < TOP_F.length; k++) {
        const f = TOP_F[k], xr = x + bow * (1 - f * f), tr = Math.max(this.top(xr), e);
        put(si, ROW.E2 + k, xr, tr - (tr - e) * Math.pow(f, p), ze * f);
      }
    }
    this._rake();
  }

  /**
   * Da inclinación a los extremos: la cara cierra en planta como una pared vertical, y aquí se recuesta hacia
   * atrás por encima de la parte más saliente del parachoques y se recoge por debajo, como una defensa real.
   */
  _rake() {
    const { ns, X, P, spec } = this;
    const [noseUp = 0, noseY = .5, noseTuck = .9] = spec.noseRake ?? [];
    const [tailUp = 0, tailY = .55, tailTuck = .7] = spec.tailRake ?? [];
    const noseSpan = spec.noseRakeLen ?? spec.noseLen * 1.5, tailSpan = spec.tailRakeLen ?? spec.tailLen * 1.5;
    // Escalones de la cara [altura, metros]: lo que queda por encima se retira. Con ellos el parachoques sobresale de verdad.
    const noseSteps = spec.noseSteps ?? [], tailSteps = spec.tailSteps ?? [];
    for (let si = 0; si < ns; si++) {
      const x = X[si], wn = smooth(0, 1, 1 - (this.xNose - x) / noseSpan), wt = smooth(0, 1, 1 - (x - this.xTail) / tailSpan);
      if (wn <= 0 && wt <= 0) continue;
      for (let r = 0; r < NR; r++) {
        const i = (si * NR + r) * 3, y = P[i + 1];
        if (wn > 0) {
          P[i] -= wn * (y > noseY ? noseUp * (y - noseY) : noseTuck * (noseY - y) * (noseY - y));
          for (const [sy, d] of noseSteps) P[i] -= wn * d * smooth(sy - .012, sy + .012, y);
        }
        if (wt > 0) {
          P[i] += wt * (y > tailY ? tailUp * (y - tailY) : tailTuck * (tailY - y) * (tailY - y));
          for (const [sy, d] of tailSteps) P[i] += wt * d * smooth(sy - .012, sy + .012, y);
        }
      }
    }
  }

  /** Normales suaves de la rejilla, ponderadas por área; los vértices que coinciden se sueldan. */
  _normals() {
    const { ns, P } = this, N = this.N = new Float32Array(ns * NR * 3);
    const v = (si, r) => (si * NR + r) * 3;
    for (let si = 0; si < ns - 1; si++) for (let r = 0; r < NR - 1; r++) {
      if (r === ROW.E) continue;
      const a = v(si, r), b = v(si + 1, r), c = v(si + 1, r + 1), d = v(si, r + 1);
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
      const wx = P[d] - P[b], wy = P[d + 1] - P[b + 1], wz = P[d + 2] - P[b + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      for (const i of [a, b, c, d]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
    }
    const same = (a, b) => Math.abs(P[a] - P[b]) + Math.abs(P[a + 1] - P[b + 1]) + Math.abs(P[a + 2] - P[b + 2]) < .0012;
    for (let si = 0; si < ns; si++) {
      let r = 0;
      while (r < NR) {
        let end = r;
        while (end + 1 < NR && same(v(si, end), v(si, end + 1))) end++;
        if (end > r) {
          let x = 0, y = 0, z = 0;
          for (let k = r; k <= end; k++) { const i = v(si, k); x += N[i]; y += N[i + 1]; z += N[i + 2]; }
          for (let k = r; k <= end; k++) { const i = v(si, k); N[i] = x; N[i + 1] = y; N[i + 2] = z; }
        }
        r = end + 1;
      }
    }
    for (let si = 0; si < ns; si++) {
      const closes = this.closes(si);
      for (let r = 0; r < NR; r++) {
        const i = v(si, r);
        // Sobre el eje la carrocería es su propio espejo. Si la normal conserva algo de z, salta de una mitad a la otra y parte
        // capó, techo y cola en dos tonos. Ahí caen las dos últimas filas de cada sección, que coinciden, y las estaciones del cierre.
        if (closes || P[i + 2] < 1e-4) N[i + 2] = 0;
        const l = Math.hypot(N[i], N[i + 1], N[i + 2]);
        if (l > 1e-9) { N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; } else { N[i] = 0; N[i + 1] = 1; N[i + 2] = 0; }
      }
    }
    this._sharpen();
  }

  /**
   * Las filas de un pliegue quedan a un centímetro y las normales suaves las promedian con los paneles grandes: el
   * pliegue se pierde. Aquí se inclina a mano la normal: arriba mira al cielo y abajo al piso, y el reflejo traza la línea.
   */
  _sharpen() {
    const { ns, X, N, spec } = this, k = spec.sharp ?? 1;
    const tilt = (si, r, amount) => {
      const i = (si * NR + r) * 3, ny = N[i + 1] + amount, l = Math.hypot(N[i], ny, N[i + 2]) || 1;
      N[i] /= l; N[i + 1] = ny / l; N[i + 2] /= l;
    };
    for (let si = 0; si < ns; si++) {
      const x = X[si], e = k * smooth(0, 1, Math.min((this.xNose - x) / (spec.noseLen * 1.25), (x - this.xTail) / (spec.tailLen * 1.25)));
      if (e <= 0) continue;
      const open = (a, b) => Math.abs(this.y(si, a) - this.y(si, b)) > .004;
      if (open(ROW.C, ROW.CU) && open(ROW.C, ROW.CO)) { tilt(si, ROW.C, .34 * e); tilt(si, ROW.CO, .12 * e); tilt(si, ROW.CU, -.16 * e); }
      if (this.lowLine && open(ROW.MID, ROW.LOW) && open(ROW.MID, ROW.MO)) { tilt(si, ROW.MID, .3 * e); tilt(si, ROW.LOW, -.18 * e); }
    }
  }

  /** Dos cartas en la textura de detalle: lateral (x, y) y superior (longitud de arco, z). */
  _charts() {
    const { ns, P, spec } = this, UV = this.UV = new Float32Array(ns * NR * 2);
    const S = this.arc = new Float32Array(ns);
    for (let si = 1; si < ns; si++) {
      const a = ((si - 1) * NR + ROW.TC) * 3, b = (si * NR + ROW.TC) * 3;
      S[si] = S[si - 1] + Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1]);
    }
    this.arcLen = S[ns - 1] || 1;
    this.chartH = spec.H * 1.04;
    this.chartZ = this.halfW * 1.04;
    for (let si = 0; si < ns; si++) for (let r = 0; r < NR; r++) {
      const i = (si * NR + r) * 3, k = (si * NR + r) * 2;
      if (r <= ROW.E) {
        UV[k] = (P[i] - this.xTail) / spec.L;
        UV[k + 1] = SIDE_V * P[i + 1] / this.chartH;
      } else {
        UV[k] = S[si] / this.arcLen;
        UV[k + 1] = TOP_V + (1 - TOP_V) * P[i + 2] / this.chartZ;
      }
    }
  }

  /** Coordenadas de la textura de detalle: carta lateral. */
  sideUv(x, y) { return [(x - this.xTail) / this.spec.L, SIDE_V * y / this.chartH]; }
  /** Carta superior; x es el de la estación, z el semiancho. */
  topUv(x, z) {
    const X = this.X, a = this.st(x), n = X[a] > x ? Math.max(0, a - 1) : a, m = Math.min(this.ns - 1, n + 1);
    const t = X[m] > X[n] ? clamp01((x - X[n]) / (X[m] - X[n])) : 0;
    return [lerp(this.arc[n], this.arc[m], t) / this.arcLen, TOP_V + (1 - TOP_V) * z / this.chartZ];
  }

  /**
   * La estación cierra nariz o cola: su semiancho es cero y toda ella cae sobre el eje. La malla la emite en z = 0, sin los 2 mm
   * de relieve de sus filas, que abrirían una rendija entre las dos mitades; la curva en planta de los parches sí los sigue leyendo.
   */
  closes(si) { return this.P[(si * NR + ROW.C) * 3 + 2] < .002; }

  pos(si, r) { const i = (si * NR + r) * 3; return [this.P[i], this.P[i + 1], this.P[i + 2]]; }
  y(si, r) { return this.P[(si * NR + r) * 3 + 1]; }
  z(si, r) { return this.P[(si * NR + r) * 3 + 2]; }

  /** Punto de la sección si a la altura y, recorriendo filas desde el labio; null si no la contiene. */
  _sectionAt(si, y, out) {
    const P = this.P;
    let i = (si * NR + ROW.LIP) * 3;
    if (y < P[i + 1]) return false;
    for (let r = ROW.LIP; r < ROW.TC; r++, i += 3) {
      const y0 = P[i + 1], y1 = P[i + 4];
      if (y <= y1 && y1 > y0 + 1e-6) {
        const t = clamp01((y - y0) / (y1 - y0));
        out.x = lerp(P[i], P[i + 3], t); out.z = lerp(P[i + 2], P[i + 5], t);
        return true;
      }
    }
    i = (si * NR + ROW.TC) * 3;
    if (Math.abs(y - P[i + 1]) < 1e-4) { out.x = P[i]; out.z = 0; return true; }
    return false;
  }

  /** Vista lateral: semiancho de la chapa en (x, y). */
  sideZ(x, y) {
    const X = this.X;
    let a = 0, b = X.length - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (X[m] > x) b = m; else a = m; }
    const t = clamp01((x - X[a]) / Math.max(X[b] - X[a], 1e-5)), p = {}, q = {};
    const hasA = this._sectionAt(a, y, p), hasB = this._sectionAt(b, y, q);
    if (hasA && hasB) return lerp(p.z, q.z, t);
    if (hasA) return p.z;
    if (hasB) return q.z;
    return this.hw(x);
  }

  /** Curva en planta a la altura y, desde el eje central hacia el costado: nariz o cola. */
  _planCurve(end, y) {
    const key = Math.round(y * 500), cache = this._planCache[end];
    let curvePts = cache.get(key);
    if (curvePts) return curvePts;
    const { ns, spec } = this, pts = [], nose = end === 'nose', out = {};
    const limit = nose ? spec.axleR : spec.axleF;
    let prevTop = null, axis = null;
    for (let k = 0; k < ns; k++) {
      const si = nose ? ns - 1 - k : k, x = this.X[si];
      if (nose ? x < limit : x > limit) break;
      const ok = this._sectionAt(si, y, out);
      const topY = this.y(si, ROW.TC), lipY = this.y(si, ROW.LIP);
      if (!ok) { prevTop = { x: this.P[(si * NR + ROW.TC) * 3], y: topY, lip: lipY }; continue; }
      if (!pts.length && out.z > 1e-4) {
        // Antes de esta estación la altura y queda fuera de la sección: el eje central corta entre ambas.
        const here = this.P[(si * NR + ROW.TC) * 3];
        let cx = here;
        if (prevTop && y > prevTop.y && topY > prevTop.y) cx = lerp(prevTop.x, here, clamp01((y - prevTop.y) / (topY - prevTop.y)));
        axis = { x: cx, z: 0, a: 0 };
        pts.push(axis);
      }
      const last = pts[pts.length - 1];
      const a = last ? last.a + Math.hypot(out.x - last.x, out.z - last.z) : 0;
      pts.push({ x: out.x, z: out.z, a });
      // Si la primera sección casi toca el eje, el eje no puede quedar detrás de ella: hundiría las molduras que cruzan el centro. Los `a` no cambian, así no se corre lo ya colocado.
      if (axis && pts.length === 2 && out.z < .05) axis.x = nose ? Math.max(axis.x, out.x) : Math.min(axis.x, out.x);
    }
    if (pts.length < 2) pts.push({ x: pts[0]?.x ?? 0, z: this.hw(0), a: 1 });
    cache.set(key, pts);
    return pts;
  }

  /** Puntos de la curva en planta a la altura y: dan las columnas de los parches. */
  planCurve(end, y) { return this._planCurve(end, y); }

  /**
   * Parche envolvente: a = metros sobre la chapa desde el eje central; y = altura.
   * Devuelve [x, y, z] sobre la superficie (z ≥ 0), desplazado `off` metros hacia afuera en planta.
   */
  around(end, a, y, off = 0) {
    const pts = this._planCurve(end, y), n = pts.length;
    let i = 0;
    while (i < n - 2 && pts[i + 1].a < a) i++;
    const p = pts[i], q = pts[i + 1], len = Math.max(q.a - p.a, 1e-5), t = (a - p.a) / len;
    // La normal sale del tramo real: junto al eje, `a` puede medir más que la distancia entre sus puntos.
    const chord = Math.max(Math.hypot(q.x - p.x, q.z - p.z), 1e-5), tx = (q.x - p.x) / chord, tz = (q.z - p.z) / chord;
    const nx = end === 'nose' ? tz : -tz, nz = end === 'nose' ? -tx : tx;
    return [p.x + (q.x - p.x) * t + nx * off, y, Math.max(0, p.z + (q.z - p.z) * t) + nz * off];
  }

  /** Superficie superior analítica: techo, capó y baúl para piezas proyectadas desde arriba. */
  topY(x, z) {
    const f = clamp01(Math.abs(z) / Math.max(this.edgeZ(x), 1e-3)), t = this.top(x + this.bow(x) * (1 - f * f)), e = Math.min(this.edge(x), t);
    return t - (t - e) * Math.pow(f, this.spec.crown ?? 2.4);
  }

  /** Clasificación de cada celda de la media rejilla en esmalte, vidrio o moldura. */
  classify() {
    const { ns, X, spec } = this, kinds = new Uint8Array(ns * NR), R = ROW;
    const set = (si, r, k) => { kinds[si * NR + r] = k; };
    const nose0 = this.st(this.xNose - spec.noseLen * 1.05), tail0 = this.st(this.xTail + spec.tailLen * 1.05);
    for (let si = 0; si < ns - 1; si++) {
      for (let r = 0; r < NR - 1; r++) set(si, r, CELL.PAINT);
      set(si, R.E, CELL.SKIP);
      // Bajos: solo se cierran bajo la nariz y la cola; en medio hay un piso oscuro aparte.
      const under = si >= nose0 || si < tail0 ? CELL.DARK : CELL.SKIP;
      set(si, R.UC, under); set(si, R.UO, under);
    }
    const trim = spec.frame === 'paint' ? CELL.PAINT : spec.frame === 'chrome' ? CELL.CHROME : CELL.TRIM;
    const beltKind = spec.beltTrim === 'chrome' ? CELL.CHROME : spec.beltTrim === 'paint' ? CELL.PAINT : CELL.TRIM;
    const paintRows = (x0, x1, r0, r1, kind) => {
      const a = this.st(x0), b = this.st(x1);
      for (let si = a; si < b; si++) for (let r = r0; r < r1; r++) set(si, r, kind);
    };
    // Línea de ventanas: moldura de cintura, marco alto y, entre vidrios, parales negros.
    if (spec.windows?.length) {
      const first = spec.windows[0][0], last = spec.windows[spec.windows.length - 1][1];
      const m = spec.frameMargin ?? .02;
      paintRows(first - m, last + m, R.BELT, R.GL, beltKind);
      paintRows(first - m, last + m, R.GH, R.E, trim);
      paintRows(first - m, last + m, R.GL, R.GH, spec.pillar === 'paint' ? CELL.PAINT : CELL.TRIM);
      for (const [x0, x1] of spec.windows) paintRows(x0, x1, R.GL, R.GH, CELL.GLASS);
    }
    const screen = (x0, x1, frit = .03) => {
      paintRows(x0, x1, R.E2, R.T1, spec.pillarTop === 'black' ? CELL.TRIM : CELL.PAINT);
      paintRows(x0, x1, R.T1, R.T2, CELL.TRIM);
      paintRows(x0, x1, R.T2, R.TC, CELL.GLASS);
      paintRows(x0, x0 + frit, R.T2, R.TC, CELL.TRIM);
      paintRows(x1 - frit, x1, R.T2, R.TC, CELL.TRIM);
    };
    if (spec.windshield) screen(spec.windshield[0], spec.windshield[1], spec.windshieldFrit ?? .03);
    if (spec.backlight) screen(spec.backlight[0], spec.backlight[1], spec.backlightFrit ?? .025);
    // Platón: arriba no hay chapa, el hueco lo forman las paredes que se añaden aparte.
    if (spec.bed) paintRows(spec.bed[0], spec.bed[1], R.T1, R.TC, CELL.SKIP);
    if (spec.cells) spec.cells({ set, paintRows, st: x => this.st(x), R, X, CELL, body: this });
    return kinds;
  }
}

export const SIDE_V = .70;
export const TOP_V = .72;
export const ROW_COUNT = NR;
