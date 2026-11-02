// Simulador de marcador de punta biselada. Un trazo es un esqueleto; la punta, un rectángulo un poco
// redondeado y girado. El contorno es la suma de Minkowski del esqueleto con la punta, así que el grueso
// cambia solo con la dirección y las puntas quedan cortadas en bisel, como pasa con un marcador de verdad.
// De aquí sale todo lo dibujado en la interfaz: letras, dibujos, rayitas, círculos, tachones.

export const rnd = (seed) => {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};

/** Ruido suave en una dimensión: la mano no tiembla, se desvía despacio. */
export function noise1(seed) {
  const r = rnd(seed), table = Array.from({ length: 64 }, () => r() * 2 - 1);
  return (t) => {
    const i = Math.floor(t), f = t - i;
    const a = table[((i % 64) + 64) % 64], b = table[(((i + 1) % 64) + 64) % 64];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };
}

// ---------- esqueletos ----------

/** Línea recta. */
export const l = (x0, y0, x1, y1, opts = {}) => ({ kind: 'poly', pts: [[x0, y0], [x1, y1]], ...opts });
/** Quebrada con esquinas vivas. */
export const p = (...pts) => {
  const opts = !Array.isArray(pts[pts.length - 1]) ? pts.pop() : {};
  return { kind: 'poly', pts, ...opts };
};
/** Curva suave que pasa por todos los puntos. */
export const c = (...pts) => {
  const opts = !Array.isArray(pts[pts.length - 1]) ? pts.pop() : {};
  return { kind: 'curve', pts, ...opts };
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function catmull(pts, step) {
  // Catmull-Rom centrípeta: no hace bucles donde los puntos quedan disparejos.
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const t0 = 0, t1 = t0 + Math.max(1e-3, dist(p0, p1) ** .5), t2 = t1 + Math.max(1e-3, dist(p1, p2) ** .5), t3 = t2 + Math.max(1e-3, dist(p2, p3) ** .5);
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = t1 + (t2 - t1) * (k / n);
      const lerp = (a, b, ta, tb) => [a[0] + (b[0] - a[0]) * ((t - ta) / (tb - ta || 1)), a[1] + (b[1] - a[1]) * ((t - ta) / (tb - ta || 1))];
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function subdivide(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Puntos densos del esqueleto, con la desviación propia de la mano. */
export function sampleStroke(stroke, { seed = 1, step = 12, amp = 4, wave = 190 } = {}) {
  const base = stroke.kind === 'curve' ? catmull(stroke.pts, step) : subdivide(stroke.pts, step);
  const n1 = noise1(seed * 7 + 3), a = stroke.amp ?? amp;
  if (!a) return base;
  const out = [];
  let s = 0;
  for (let i = 0; i < base.length; i++) {
    if (i) s += dist(base[i - 1], base[i]);
    const prev = base[Math.max(0, i - 1)], next = base[Math.min(base.length - 1, i + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1], len = Math.hypot(dx, dy) || 1;
    const d = n1(s / wave) * a;
    out.push([base[i][0] - dy / len * d, base[i][1] + dx / len * d]);
  }
  return out;
}

// ---------- la punta ----------

/** Vértices de la punta en sentido antihorario. angle en grados; w largo; t grueso; r redondeo de esquina. */
export function makeNib({ angle = 32, w = 158, t = 34, r = 9 } = {}) {
  const rad = angle * Math.PI / 180, ca = Math.cos(rad), sa = Math.sin(rad);
  const hw = w / 2, ht = t / 2, rr = Math.min(r, ht * .98, hw * .98);
  const corners = [[hw - rr, ht - rr, 0], [-hw + rr, ht - rr, 90], [-hw + rr, -ht + rr, 180], [hw - rr, -ht + rr, 270]];
  const pts = [];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = (a0 + k * 90 / 4) * Math.PI / 180;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      pts.push([x * ca - y * sa, x * sa + y * ca]);
    }
  }
  return pts;
}

/** Contorno cerrado de la punta barriendo los puntos. Sale en sentido horario. */
export function sweep(points, nib) {
  const pts = [points[0]];
  for (const q of points) if (dist(q, pts[pts.length - 1]) > .5) pts.push(q);
  if (pts.length < 2) pts.push([pts[0][0] + .6, pts[0][1] + .2]);
  const n = nib.length;
  const support = (nx, ny) => {
    let best = 0, bv = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = nib[i][0] * nx + nib[i][1] * ny;
      if (d > bv) { bv = d; best = i; }
    }
    return best;
  };
  const out = [];
  const add = (a, k) => out.push([a[0] + nib[k][0], a[1] + nib[k][1]]);
  const walk = (seq) => {
    // Recorre con la normal izquierda; devuelve el último soporte.
    let lastS = null, lastD = null;
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const d = [dx / len, dy / len];
      const s = support(-d[1], d[0]);
      if (lastS !== null && s !== lastS) {
        const cross = lastD[0] * d[1] - lastD[1] * d[0];
        let k = lastS;
        const stepDir = cross > 0 ? 1 : -1; // la normal gira con la dirección; el índice de la punta va igual
        let guard = 0;
        while (k !== s && guard++ < n) { k = (k + stepDir + n) % n; add(a, k); }
      }
      add(a, s);
      add(b, s);
      lastS = s; lastD = d;
    }
    return { s: lastS, d: lastD };
  };
  const capTo = (at, fromS, fromD) => {
    // Media vuelta en sentido horario por delante del trazo.
    const target = support(fromD[1], -fromD[0]);
    let k = fromS, guard = 0;
    while (k !== target && guard++ < n) { k = (k - 1 + n) % n; add(at, k); }
  };
  const fw = walk(pts);
  capTo(pts[pts.length - 1], fw.s, fw.d);
  const back = [...pts].reverse();
  const bw = walk(back);
  capTo(back[back.length - 1], bw.s, bw.d);
  return out;
}

/** Quita puntos que no aportan (Douglas-Peucker). */
export function simplify(points, tol = .7) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let imax = -1, dmax = tol;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((points[i][0] - ax) * dx + (points[i][1] - ay) * dy) / len2));
      const d = Math.hypot(points[i][0] - (ax + t * dx), points[i][1] - (ay + t * dy));
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (imax >= 0) { keep[imax] = 1; stack.push([a, imax], [imax, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Dibuja un glifo: lista de trazos a contornos en coordenadas de fuente. */
export function inkStrokes(strokes, { nib: nibSpec, seed = 1, amp = 4, wave = 190, transform = null, tol = .7, shake = 0 } = {}) {
  const contours = [];
  strokes.forEach((stroke, i) => {
    const spec = { ...nibSpec, ...(stroke.nib ?? {}) };
    const nib = makeNib(spec);
    let pts = sampleStroke(stroke, { seed: seed * 31 + i * 7 + 1, amp, wave });
    if (shake) {
      const n1 = noise1(seed * 13 + i + 5), n2 = noise1(seed * 17 + i + 9);
      pts = pts.map(([x, y], k) => [x + n1(k * .55) * shake, y + n2(k * .55) * shake]);
    }
    if (transform) pts = pts.map(transform);
    const outline = simplify(sweep(pts, nib), tol);
    outline.hole = false;
    contours.push(outline);
  });
  return contours;
}

export function bbox(contours) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) for (const [x, y] of c) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Contornos a trazado SVG, con Y hacia abajo y sin decimales de más. */
export function contoursToPath(contours, { scale = 1, ox = 0, oy = 0, flipY = false } = {}) {
  const f = (v) => +v.toFixed(1);
  return contours.map((c) => 'M' + c.map(([x, y]) => `${f(ox + x * scale)} ${f(oy + (flipY ? -y : y) * scale)}`).join('L') + 'Z').join('');
}
