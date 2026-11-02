import * as THREE from 'three';
import { MeshKit, rgb, shade, canvasTexture, drawLedText, ledTextColumns } from './MeshKit.js';

/**
 * Carrocería del articulado, armada por código sobre las medidas de bus.json. Coordenadas del modelo:
 * frente +Z, izquierda del sentido de marcha +X (el lado de las puertas) y arriba +Y. Cada sección es
 * un puñado de mallas por material; el color por vértice lleva pintura, franjas y sombra horneada.
 */

const HALF = 1.36, BOTTOM = .42, FLOOR = .90, SILL = .88, BELT = 1.5, WINDOW_TOP = 2.96, EAVE = 3.2, TOP = 3.5;
// Donde empieza cada extremo: bien atrás, para que la esquina dé la vuelta en un radio amplio y no en una arista.
const FRONT_EDGE = 10.05, REAR_EDGE = -10.2;
const ARCH_RADIUS = .74, WHEEL_Y = .62815;

/** Centro de cada puerta en Z del modelo: la estación pone las suyas enfrente. */
export const BUS_DOOR_Z = Object.freeze([6.3, 3.7, -2.55, -5.1]);
export const BUS_DOOR_WIDTH = 1.3;

const LAYOUT = [
  { z0: .565, z1: FRONT_EDGE, arches: [1.736, 7.875],
    left: { doors: [6.3, 3.7], windows: [[9.06, 9.96], [7.02, 9], [4.42, 5.58], [.98, 2.98]] },
    right: { doors: [], windows: [[9.06, 9.96], [7.46, 9], [5.72, 7.4], [3.98, 5.66], [2.24, 3.92], [.98, 2.18]] } },
  { z0: REAR_EDGE, z1: -1.413, arches: [-7.976],
    left: { doors: [-2.55, -5.1], windows: [[-4.38, -3.27], [-7.4, -5.82], [-9.06, -7.46], [-10.06, -9.12]] },
    right: { doors: [], windows: [[-3.56, -1.9], [-5.28, -3.62], [-7, -5.34], [-8.72, -7.06], [-10.06, -8.78]] } }
];

const C = {
  red: rgb('#ad0f18'), redLow: rgb('#7c0b13'), black: rgb('#0a0b0d'), gloss: rgb('#08090b'), rubber: rgb('#101114'),
  yellow: rgb('#efb414'), white: rgb('#ecece6'), roof: rgb('#c6c8c4'), seam: rgb('#3c060a'), bumper: rgb('#3a3c40'),
  steel: rgb('#5a5e62'), steelDark: rgb('#26282b'), grey: rgb('#8b8e90'), chrome: rgb('#b6babd'),
  floor: rgb('#34373a'), wall: rgb('#5b5f62'), pillar: rgb('#3a3d40'), ceiling: rgb('#c9c7bb'), pole: rgb('#e6b410'),
  seatBlue: rgb('#24405f'), seatRed: rgb('#70242a'), frameSeat: rgb('#3c3f42'),
  lens: rgb('#fff2d0'), drl: rgb('#f2f5ff'), amber: rgb('#ff9a1c'), tail: rgb('#ff1a12'), reverse: rgb('#f2f2ea'), strip: rgb('#ffe9c2'),
  tire: rgb('#141416'), side: rgb('#1d1d20'), rim: rgb('#3b3f44'), rimDark: rgb('#1f2124'), hub: rgb('#54585c'), lug: rgb('#9a9da0')
};

/** Brillo de cada lámpara de día y de noche; va en la UV y lo mezcla el material sin luces reales. */
const TONE = { lens: [.5, 1.3], cove: [.1, 1.25], tail: [.5, 1.05], amber: [.55, .8], reverse: [.55, .6], marker: [.45, 1.1], daylight: [.95, 1.2] };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const table = (rows, y) => {
  if (y <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) if (y <= rows[i][0]) {
    return lerp(rows[i - 1][1], rows[i][1], (y - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]));
  }
  return rows[rows.length - 1][1];
};

/** Perfil transversal: el costado entra un poco hacia arriba, como las carrocerías reales. */
const widthAt = y => table([[BOTTOM, HALF - .03], [.5, HALF], [BELT, HALF], [WINDOW_TOP, HALF - .022], [EAVE, HALF - .06]], y);
const ROOF = [[1.3, EAVE], [1.27, 3.29], [1.16, 3.38], [.95, 3.445], [.6, 3.485], [.2, TOP], [-.2, TOP], [-.6, 3.485], [-.95, 3.445], [-1.16, 3.38], [-1.27, 3.29], [-1.3, EAVE]];

// Perfil lateral: parachoques adelante, panel casi vertical y un parabrisas de unos 13 grados que baja casi hasta el parachoques.
const FRONT_Z = [[BOTTOM, 10.99], [.6, 11.05], [.7, 11.05], [.8, 11.02], [1.14, 10.98], [2.86, 10.59], [EAVE, 10.5]];
const REAR_Z = [[BOTTOM, -10.98], [.6, -11.055], [.7, -11.055], [.8, -11.02], [1.8, -10.96], [WINDOW_TOP, -10.84], [EAVE, -10.76]];

const U_LIST = [0, .15, .3, .45, .6, .72, .82, .89, .94, .97, .985, .995, 1].flatMap(u => u ? [u, -u] : [0]).sort((a, b) => a - b);

/** Superficie de un extremo del bus: u recorre el ancho (-1…1) y la esquina empalma tangente con el costado. */
function capSurface(rows, edge, sign, n) {
  const point = (u, y) => {
    // El promedio con sus vecinos redondea los quiebres de la tabla: la lámina no muestra aristas.
    const z = (table(rows, y - .05) + table(rows, y) + table(rows, y + .05)) / 3, w = widthAt(y), a = Math.abs(u);
    const c = 1 - Math.pow(Math.max(0, 1 - Math.pow(a, n)), 1 / n);
    return [u * w, y, z + (edge - z) * c];
  };
  const normal = (u, y) => {
    const d = .0015, v = clamp(u, -.9985, .9985);
    const a = point(v - d, y), b = point(v + d, y), p = point(v, y - .004), q = point(v, y + .004);
    const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dy = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const x = du[1] * dy[2] - du[2] * dy[1], yy = du[2] * dy[0] - du[0] * dy[2], z = du[0] * dy[1] - du[1] * dy[0];
    const l = Math.hypot(x, yy, z) * sign || 1;
    return [x / l, yy / l, z / l];
  };
  return { point, normal };
}
const FRONT = capSurface(FRONT_Z, FRONT_EDGE, 1, 3);
/** La misma lámina del parabrisas para el vértice: la plumilla la sigue al barrer. */
export const WINDSHIELD_GLSL = `float windshieldZ(vec2 p) {
  float z = mix(10.98, 10.59, clamp((p.y - 1.14) / 1.72, 0., 1.));
  float c = 1. - pow(max(0., 1. - pow(abs(p.x) / ${HALF.toFixed(2)}, 3.)), 1. / 3.);
  return z + (${FRONT_EDGE.toFixed(2)} - z) * c;
}`;
/** Con lluvia barren todos los buses; cada uno lleva su fase en su propio material, sin geometría ni material extra. */
export const busWipers = { running: false };
const REAR = capSurface(REAR_Z, REAR_EDGE, -1, 3.4);

/** Columnas de una lámina: los extremos, las de la superficie y las que pida su contorno. */
const capColumns = (u0, u1, extra = []) => {
  const list = [u0, u1, ...U_LIST, ...extra].filter(u => u >= u0 - 1e-6 && u <= u1 + 1e-6).sort((a, b) => a - b);
  return list.filter((u, i) => !i || u - list[i - 1] > 1e-4);
};

/**
 * Lámina sobre la superficie curva de un extremo, con el borde de abajo y el de arriba como funciones de u: así salen las
 * esquinas redondas y las líneas que barren la esquina. `off` la saca o la hunde a lo largo de la normal; `inward` la voltea.
 */
function shape(kit, cap, u0, u1, low, high, color, { off = 0, rows = 1, extra = [], inward = false } = {}) {
  const col = typeof color === 'function' ? color : () => color;
  const grid = capColumns(u0, u1, extra).map(u => {
    const a = low(u), b = high(u);
    return Array.from({ length: rows + 1 }, (_, j) => {
      const y = lerp(a, b, j / rows), p = cap.point(u, y), n = cap.normal(u, y);
      return { p: [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off], n: inward ? [-n[0], -n[1], -n[2]] : n, c: col(u, y) };
    });
  });
  for (let i = 0; i + 1 < grid.length; i++) for (let j = 0; j < rows; j++) {
    const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
    const facing = [a.n[0] + c.n[0], a.n[1] + c.n[1], a.n[2] + c.n[2]];
    kit.quad(a.p, b.p, c.p, d.p, [a.c, b.c, c.c, d.c], { normal: [a.n, b.n, c.n, d.n], facing });
  }
}

/** Rectángulo sobre la superficie de un extremo. */
function patch(kit, cap, u0, u1, y0, y1, color, options = {}) {
  shape(kit, cap, u0, u1, () => y0, () => y1, color, options);
}

/** Contorno de esquinas redondas en (u, y); el radio abajo y arriba puede ser distinto, como en un parabrisas de verdad. */
function rounded(u0, u1, y0, y1, rx, ryLow, ryHigh = ryLow) {
  const corner = u => {
    const d = clamp(Math.max(u0 + rx - u, u - u1 + rx) / rx, 0, 1);
    return 1 - Math.sqrt(1 - d * d);
  };
  const samples = [];
  for (let k = 0; k <= 7; k++) { const t = 1 - Math.cos(k / 7 * Math.PI / 2); samples.push(u0 + rx * t, u1 - rx * t); }
  return { u0, u1, low: u => y0 + ryLow * corner(u), high: u => y1 - ryHigh * corner(u), midLow: y0 + ryLow, midHigh: y1 - ryHigh, samples };
}

/** Lo que rodea a un contorno redondeado: abajo, arriba y a los lados. Deja el hueco exacto para el vidrio. */
function around(kit, cap, u0, u1, low, high, hole, color, options = {}) {
  const extra = [...(options.extra ?? []), ...hole.samples], settings = { ...options, extra };
  const inside = u => u >= hole.u0 && u <= hole.u1;
  shape(kit, cap, u0, u1, low, u => Math.max(low(u), inside(u) ? hole.low(u) : hole.midLow), color, settings);
  shape(kit, cap, u0, u1, u => Math.min(high(u), inside(u) ? hole.high(u) : hole.midHigh), high, color, settings);
  const sideLow = u => Math.max(low(u), hole.midLow), sideHigh = u => Math.min(high(u), hole.midHigh);
  shape(kit, cap, u0, hole.u0, sideLow, sideHigh, color, settings);
  shape(kit, cap, hole.u1, u1, sideLow, sideHigh, color, settings);
}

/** Visera saliente: lámina inferior oscura, labio y una tapa que muere contra la superficie; se afina hacia las puntas. */
function visor(kit, cap, u0, u1, y, depth, thick, color) {
  const cols = capColumns(u0, u1);
  const reach = u => depth * smooth(Math.min(u - u0, u1 - u), 0, .38);
  const at = (u, yy, k) => {
    const p = cap.point(u, yy), n = cap.normal(u, yy), h = Math.hypot(n[0], n[2]) || 1;
    return [p[0] + n[0] / h * k, yy, p[2] + n[2] / h * k];
  };
  for (let i = 0; i + 1 < cols.length; i++) {
    const a = cols[i], b = cols[i + 1], ra = reach(a), rb = reach(b), n = cap.normal((a + b) / 2, y);
    const out = [n[0], 0, n[2]], top = y + thick, dark = shade(C.black, .5), low = shade(color, .72);
    kit.quad(at(a, y, 0), at(b, y, 0), at(b, y, rb), at(a, y, ra), dark, { facing: [0, -1, 0] });
    kit.quad(at(a, y, ra), at(b, y, rb), at(b, top, rb), at(a, top, ra), [low, low, color, color], { normal: out, facing: out });
    kit.quad(at(a, top, ra), at(b, top, rb), at(b, top + .05, 0), at(a, top + .05, 0), color, { normal: [n[0] * .4, 1, n[2] * .4], facing: [0, 1, 0] });
  }
}

function createKits() {
  return {
    paint: new MeshKit(), matte: new MeshKit({ slide: true }), interior: new MeshKit(), lamps: new MeshKit(),
    glass: new MeshKit({ slide: true, alpha: true }), decals: new MeshKit(), sign: new MeshKit(), stops: new MeshKit(), flares: new MeshKit()
  };
}

/** Atlas de calcomanías y letras: un solo mapa con recorte alfa, sin ordenar transparencias. */
const ATLAS = { width: 1024, height: 512 };
const rect = (x, y, w, h) => {
  const u0 = x / ATLAS.width, u1 = (x + w) / ATLAS.width, v1 = 1 - y / ATLAS.height, v0 = 1 - (y + h) / ATLAS.height;
  return { u0, u1, v0, v1 };
};
const DECAL = {
  name: rect(0, 0, 768, 128), number: rect(768, 0, 256, 64), numberDark: rect(768, 64, 256, 64), plate: rect(0, 128, 256, 128),
  access: rect(256, 128, 128, 128), caution: rect(384, 128, 128, 128), lean: rect(512, 128, 256, 64), emergency: rect(512, 192, 256, 64),
  vent: rect(768, 128, 256, 128)
};

/** Calcomanía sobre el costado; en el lado derecho el texto corre al revés del eje Z. */
function sideDecal(kit, r, s, zCenter, y, w, h, off = .004) {
  const x = s * (widthAt(y) + off), z0 = zCenter - w / 2, z1 = zCenter + w / 2;
  // Mirando desde +X el frente (+Z) queda a la izquierda.
  const left = s > 0 ? z1 : z0, right = s > 0 ? z0 : z1;
  kit.quad([x, y - h / 2, left], [x, y - h / 2, right], [x, y + h / 2, right], [x, y + h / 2, left], rgb('#ffffff'),
    { normal: [s, 0, 0], facing: [s, 0, 0], uv: [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]] });
}

function capDecal(kit, r, cap, u0, u1, y0, y1, off = .006, mirrored = false) {
  const col = rgb('#ffffff');
  const [ul, ur] = mirrored ? [r.u1, r.u0] : [r.u0, r.u1];
  // Por columnas: una lámina recta se hunde en la curva y del letrero solo quedan las puntas.
  const steps = Math.max(1, Math.ceil((u1 - u0) / .06));
  const at = (u, y) => {
    const p = cap.point(u, y), n = cap.normal(u, y);
    return [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off];
  };
  for (let i = 0; i < steps; i++) {
    const a = u0 + (u1 - u0) * i / steps, b = u0 + (u1 - u0) * (i + 1) / steps;
    const ua = ul + (ur - ul) * i / steps, ub = ul + (ur - ul) * (i + 1) / steps;
    const n = cap.normal((a + b) / 2, (y0 + y1) / 2);
    kit.quad(at(a, y0), at(b, y0), at(b, y1), at(a, y1), col, { normal: n, facing: n, uv: [[ua, r.v0], [ub, r.v0], [ub, r.v1], [ua, r.v1]] });
  }
}

/** Un costado completo: panel bajo con pasos de rueda, banda de ventanas, puertas y su interior. */
function buildSide(kits, layout, s) {
  const { paint, matte, glass, interior, lamps, decals, sign } = kits;
  const plan = s > 0 ? layout.left : layout.right;
  const doors = plan.doors.map(c => [c - BUS_DOOR_WIDTH / 2, c + BUS_DOOR_WIDTH / 2]);
  const windows = plan.windows.map(w => [Math.min(...w), Math.max(...w)]);
  const inDoor = z => doors.some(([a, b]) => z > a - 1e-4 && z < b + 1e-4);
  const facing = [s, 0, 0];
  const X = y => s * widthAt(y);

  // Columnas: bordes de puertas, muestras del arco de rueda y juntas de panel, que son tiras finas de la misma malla (sin z-fighting).
  const cuts = new Set([layout.z0, layout.z1]);
  for (const [a, b] of doors) { cuts.add(a); cuts.add(b); }
  for (const center of layout.arches) for (let k = -12; k <= 12; k++) cuts.add(center + ARCH_RADIUS * Math.sin(k / 12 * Math.PI / 2));
  const seamColumns = [];
  for (let z = layout.z0 + 1.42; z < layout.z1 - .4; z += 1.42) {
    if (inDoor(z) || inDoor(z + .012)) continue;
    if (layout.arches.some(c => Math.abs(z - c) < ARCH_RADIUS + .05)) continue;
    cuts.add(z); cuts.add(z + .012); seamColumns.push(z);
  }
  const columns = [...cuts].sort((a, b) => a - b);
  const archAt = z => {
    let top = -Infinity;
    for (const c of layout.arches) if (Math.abs(z - c) < ARCH_RADIUS) top = Math.max(top, WHEEL_Y + Math.sqrt(ARCH_RADIUS ** 2 - (z - c) ** 2));
    return top;
  };
  const archShade = (y, z) => {
    let k = lerp(.68, 1, smooth(y, BOTTOM, .82));
    for (const c of layout.arches) k *= lerp(.62, 1, smooth(Math.hypot(z - c, y - WHEEL_Y) - ARCH_RADIUS, 0, .24));
    return k;
  };
  const rows = [
    [BOTTOM, .5, C.redLow], [.5, .7, C.redLow], [.7, .712, C.seam], [.712, .772, C.yellow], [.772, .798, C.red], [.798, .826, C.white],
    [.826, SILL, C.red], [SILL, 1.1, C.red], [1.1, 1.112, C.seam], [1.112, 1.48, C.red]
  ];
  paint.uvOf = p => [(p[2] + p[0] * .3) / 8, clamp((p[1] - .4) / 3.1, 0, 1)];
  for (const [y0, y1, color] of rows) for (let i = 0; i + 1 < columns.length; i++) {
    const zA = columns[i], zB = columns[i + 1], mid = (zA + zB) / 2;
    if (y0 >= SILL - 1e-4 && inDoor(mid)) continue;
    const seam = seamColumns.some(z => z === zA);
    const paintColor = seam ? shade(color, .42) : color;
    const bA = Math.max(y0, archAt(zA)), bB = Math.max(y0, archAt(zB));
    if (bA >= y1 - 1e-4 && bB >= y1 - 1e-4) continue;
    const yA = Math.min(bA, y1), yB = Math.min(bB, y1);
    const corners = [[X(yA), yA, zA], [X(yB), yB, zB], [X(y1), y1, zB], [X(y1), y1, zA]];
    paint.quad(corners[0], corners[1], corners[2], corners[3], corners.map(p => shade(paintColor, archShade(p[1], p[2]))), { facing });
  }
  // Moldura del cinturón: un filete de caucho que da una línea de sombra limpia bajo las ventanas.
  matte.slideValue = 0;
  // Se afina en los últimos 30 cm del lado del extremo: así entra a la máscara sin dejar un escalón.
  const capEnd = layout.z1 === FRONT_EDGE ? FRONT_EDGE : layout.z0 === REAR_EDGE ? REAR_EDGE : null;
  const beltX = z => HALF + .012 * (capEnd === null ? 1 : smooth(Math.abs(capEnd - z), .02, .3));
  const beltStops = [...new Set([...columns, ...(capEnd === null ? [] : [.1, .2, .3].map(d => capEnd - Math.sign(capEnd) * d))])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < beltStops.length; i++) {
    const zA = beltStops[i], zB = beltStops[i + 1], xA = beltX(zA), xB = beltX(zB);
    if (inDoor((zA + zB) / 2)) continue;
    matte.quad([s * xA, 1.485, zA], [s * xB, 1.485, zB], [s * xB, 1.53, zB], [s * xA, 1.53, zA], C.rubber, { facing });
    matte.quad([s * HALF, 1.48, zA], [s * HALF, 1.48, zB], [s * xB, 1.485, zB], [s * xA, 1.485, zA], shade(C.rubber, .5), { facing: [0, -1, 0] });
    matte.quad([s * xA, 1.53, zA], [s * xB, 1.53, zB], [s * widthAt(1.54), 1.54, zB], [s * widthAt(1.54), 1.54, zA], C.rubber, { facing: [0, 1, 0] });
  }

  // Banda de vidrio: pilares negros brillantes que continúan el negro de los marcos.
  const bandCuts = new Set([layout.z0, layout.z1]);
  for (const [a, b] of [...doors, ...windows]) { bandCuts.add(a); bandCuts.add(b); }
  const band = [...bandCuts].sort((a, b) => a - b);
  for (let i = 0; i + 1 < band.length; i++) {
    const a = band[i], b = band[i + 1], mid = (a + b) / 2;
    if (inDoor(mid)) continue;
    const isWindow = windows.some(([w0, w1]) => mid > w0 && mid < w1);
    if (isWindow) continue;
    paint.quad([X(1.53), 1.53, a], [X(1.53), 1.53, b], [X(WINDOW_TOP), WINDOW_TOP, b], [X(WINDOW_TOP), WINDOW_TOP, a], C.gloss, { facing });
    // Solo arriba del cinturón: abajo está la pared interior y las dos en el mismo plano parpadearían.
    interior.quad([s * 1.33, 1.56, a], [s * 1.33, 1.56, b], [s * 1.33, 3.12, b], [s * 1.33, 3.12, a], C.pillar, { facing: [-s, 0, 0] });
  }
  // Friso rojo sobre las ventanas y canal de lluvia.
  for (const [a, b] of [[layout.z0, layout.z1]]) {
    paint.quad([X(WINDOW_TOP), WINDOW_TOP, a], [X(WINDOW_TOP), WINDOW_TOP, b], [X(EAVE), EAVE, b], [X(EAVE), EAVE, a], C.red, { facing });
    matte.quad([s * (widthAt(3.02) + .018), 3.02, a], [s * (widthAt(3.02) + .018), 3.02, b], [s * (widthAt(3.05) + .018), 3.05, b], [s * (widthAt(3.05) + .018), 3.05, a], C.rubber, { facing });
    matte.quad([s * (widthAt(3.05) + .018), 3.05, a], [s * (widthAt(3.05) + .018), 3.05, b], [X(3.06), 3.06, b], [X(3.06), 3.06, a], C.rubber, { facing: [0, 1, 0] });
  }

  // Ventanas: bisel de caucho hundido, vidrio con la normal un poco abombada y ventila superior inclinada.
  windows.forEach(([a, b], index) => {
    const bottom = 1.56, top = 2.93, frame = .036, depth = .03;
    const inner = [a + frame, b - frame, bottom + frame, top - frame];
    const X0 = y => X(y) - s * depth;
    const bevel = (p0, p1, p2, p3, face, color) => matte.quad(p0, p1, p2, p3, color, { facing: face });
    bevel([X(bottom), bottom, a], [X(bottom), bottom, b], [X0(inner[2]), inner[2], inner[1]], [X0(inner[2]), inner[2], inner[0]], [s * .5, 1, 0], shade(C.rubber, 1.5));
    bevel([X(top), top, a], [X(top), top, b], [X0(inner[3]), inner[3], inner[1]], [X0(inner[3]), inner[3], inner[0]], [s * .5, -1, 0], shade(C.rubber, .55));
    bevel([X(bottom), bottom, a], [X(top), top, a], [X0(inner[3]), inner[3], inner[0]], [X0(inner[2]), inner[2], inner[0]], [s * .5, 0, 1], C.rubber);
    bevel([X(bottom), bottom, b], [X(top), top, b], [X0(inner[3]), inner[3], inner[1]], [X0(inner[2]), inner[2], inner[1]], [s * .5, 0, -1], C.rubber);
    const split = lerp(inner[2], inner[3], .64);
    const tiltA = ((index * 37) % 7 - 3) * .0035, tiltB = .035 + ((index * 53) % 5) * .004;
    const bow = (z, center, half) => (z - center) / half * .018;
    const mid = (inner[0] + inner[1]) / 2, half = (inner[1] - inner[0]) / 2;
    const n = (z, tilt) => { const v = [s, tilt, bow(z, mid, half) + tiltA]; const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
    const tint = [...rgb('#141d21'), .74];
    glass.slideValue = 0;
    glass.quad([X0(inner[2]), inner[2], inner[0]], [X0(inner[2]), inner[2], inner[1]], [X0(split), split, inner[1]], [X0(split), split, inner[0]], tint,
      { normal: [n(inner[0], tiltA), n(inner[1], tiltA), n(inner[1], tiltA), n(inner[0], tiltA)], facing });
    glass.quad([X0(split) + s * .006, split + .018, inner[0]], [X0(split) + s * .006, split + .018, inner[1]], [X0(inner[3]), inner[3], inner[1]], [X0(inner[3]), inner[3], inner[0]], tint,
      { normal: [n(inner[0], tiltB), n(inner[1], tiltB), n(inner[1], tiltB), n(inner[0], tiltB)], facing });
    // Junta de la ventila, un poco por fuera del vidrio para que se lea desde lejos.
    matte.quad([X0(split) + s * .012, split, inner[0]], [X0(split) + s * .012, split, inner[1]], [X0(split) + s * .012, split + .022, inner[1]], [X0(split) + s * .012, split + .022, inner[0]], C.rubber, { facing });
    interior.quad([s * 1.33, 2.93, a], [s * 1.33, 2.93, b], [s * 1.33, 3.12, b], [s * 1.33, 3.12, a], C.wall, { facing: [-s, 0, 0] });
    // Luz cálida en la cornisa interior: de noche es lo que se ve desde la calle.
    lamps.uvOf = () => TONE.cove;
    lamps.quad([s * 1.31, 2.965, a + .1], [s * 1.31, 2.965, b - .1], [s * 1.27, 3.02, b - .1], [s * 1.27, 3.02, a + .1], C.strip, { facing: [-s, -1, 0] });
  });

  // Pared interior bajo el cinturón, que tapa la cara trasera de la pintura.
  const wallCuts = new Set([layout.z0, layout.z1]);
  for (const [a, b] of doors) { wallCuts.add(a); wallCuts.add(b); }
  const walls = [...wallCuts].sort((a, b) => a - b);
  for (let i = 0; i + 1 < walls.length; i++) {
    const a = walls[i], b = walls[i + 1];
    if (inDoor((a + b) / 2)) continue;
    interior.quad([s * 1.33, FLOOR, a], [s * 1.33, FLOOR, b], [s * 1.33, 1.56, b], [s * 1.33, 1.56, a],
      [shade(C.wall, .55), shade(C.wall, .55), C.wall, C.wall], { facing: [-s, 0, 0] });
  }

  // Puertas: dos hojas de vidrio con marco negro que corren por dentro de la carrocería (atributo aSlide).
  doors.forEach(([a, b]) => buildDoor(kits, a, b, s));

  // Pasos de rueda: labio de caucho, cuenco oscuro y pared interior.
  for (const center of layout.arches) buildWheelArch(kits, center, s);

  // Marcadores laterales ámbar sobre el faldón.
  for (let z = layout.z0 + .9; z < layout.z1 - .4; z += 2.75) {
    if (layout.arches.some(c => Math.abs(z - c) < ARCH_RADIUS + .12)) continue;
    const x = s * (HALF + .006);
    lamps.uvOf = () => TONE.marker;
    lamps.quad([x, .6, z - .055], [x, .6, z + .055], [x, .635, z + .055], [x, .635, z - .055], C.amber, { facing });
  }
  // Pestillos de las tapas de servicio.
  for (const z of seamColumns) {
    matte.box(s * (HALF + .002), .6, z + .35, .008, .05, .09, C.steelDark);
    matte.box(s * (HALF + .002), .6, z - .35, .008, .05, .09, C.steelDark);
  }

  return { windows, doors };
}

function buildDoor(kits, a, b, s) {
  const { paint, matte, glass, lamps, decals } = kits;
  const width = b - a, center = (a + b) / 2, top = WINDOW_TOP, x = s * (widthAt(1.9) - .05);
  const outer = s * HALF;
  // Vano negro: jambas y dintel, con la profundidad justa para que la hoja se vea hundida.
  matte.slideValue = 0;
  matte.quad([outer, SILL, a], [outer, top, a], [x, top, a], [x, SILL, a], C.black, { facing: [0, 0, 1] });
  matte.quad([outer, SILL, b], [outer, top, b], [x, top, b], [x, SILL, b], C.black, { facing: [0, 0, -1] });
  matte.quad([outer, top, a], [outer, top, b], [x, top, b], [x, top, a], shade(C.black, .6), { facing: [0, -1, 0] });
  // Marco exterior con pestaña, que separa la puerta de la pintura roja.
  matte.quad([s * (HALF + .008), SILL, a - .035], [s * (HALF + .008), SILL, a + .012], [s * (HALF + .008), top + .03, a + .012], [s * (HALF + .008), top + .03, a - .035], C.rubber, { facing: [s, 0, 0] });
  matte.quad([s * (HALF + .008), SILL, b - .012], [s * (HALF + .008), SILL, b + .035], [s * (HALF + .008), top + .03, b + .035], [s * (HALF + .008), top + .03, b - .012], C.rubber, { facing: [s, 0, 0] });
  matte.quad([s * (widthAt(top) + .008), top - .012, a], [s * (widthAt(top) + .008), top - .012, b], [s * (widthAt(top) + .008), top + .03, b], [s * (widthAt(top) + .008), top + .03, a], C.rubber, { facing: [s, 0, 0] });
  // Umbral amarillo a la altura del piso, el mismo de la plataforma.
  paint.quad([outer, FLOOR, a], [outer, FLOOR, b], [x, FLOOR, b], [x, FLOOR, a], C.yellow, { facing: [0, 1, 0] });
  paint.quad([outer, SILL, a], [outer, SILL, b], [outer, FLOOR, b], [outer, FLOOR, a], shade(C.yellow, .7), { facing: [s, 0, 0] });
  // Piloto de puerta sobre el dintel.
  lamps.uvOf = () => TONE.marker;
  lamps.box(s * (HALF + .012), top + .075, center, .012, .03, .16, C.amber);

  for (const [from, to, travel] of [[a, center, -(width / 2 - .05)], [center, b, width / 2 - .05]]) {
    matte.slideValue = travel; glass.slideValue = travel;
    const bar = .05, depth = .028;
    const y0 = FLOOR + .01, y1 = top - .012;
    // Cuatro largueros de la hoja. Abajo lleva una patada más alta, como las reales.
    matte.box(x, (y0 + y0 + .14) / 2, (from + to) / 2, depth, .14, to - from - .004, C.black);
    matte.box(x, y1 - bar / 2, (from + to) / 2, depth, bar, to - from - .004, C.black);
    matte.box(x, (y0 + y1) / 2, from + bar / 2 + .002, depth, y1 - y0, bar, C.black);
    matte.box(x, (y0 + y1) / 2, to - bar / 2 - .002, depth, y1 - y0, bar, C.black);
    // Pasamanos amarillo por dentro de la hoja.
    const railZ = travel > 0 ? from + .17 : to - .17;
    matte.tube([[x - s * .05, 1.2, railZ], [x - s * .05, 2.3, railZ]], .016, 6, C.pole, { flat: false });
    const glassColor = [...rgb('#172024'), .6];
    const n = [s, .002, (travel > 0 ? 1 : -1) * .006];
    glass.quad([x, y0 + .14, from + bar], [x, y0 + .14, to - bar], [x, y1 - bar, to - bar], [x, y1 - bar, from + bar], glassColor, { normal: n, facing: [s, 0, 0] });
  }
  matte.slideValue = 0; glass.slideValue = 0;
  // Calcomanías de seguridad en la hoja.
  sideDecal(decals, DECAL.caution, s, center + .3, 1.62, .1, .1, -.03);
  sideDecal(decals, DECAL.caution, s, center - .3, 1.62, .1, .1, -.03);
}

function buildWheelArch(kits, center, s) {
  const { matte, interior } = kits;
  const segments = 14, x1 = s * .62, well = shade(C.black, .12);
  const start = -Math.asin((WHEEL_Y - BOTTOM) / ARCH_RADIUS);
  const at = (t, r) => [center - Math.cos(t) * r, WHEEL_Y + Math.sin(t) * r];
  matte.slideValue = 0;
  for (let i = 0; i < segments; i++) {
    const t0 = lerp(start, Math.PI - start, i / segments), t1 = lerp(start, Math.PI - start, (i + 1) / segments);
    const [z0, y0] = at(t0, ARCH_RADIUS), [z1, y1] = at(t1, ARCH_RADIUS);
    const [z0o, y0o] = at(t0, ARCH_RADIUS + .045), [z1o, y1o] = at(t1, ARCH_RADIUS + .045);
    const lip = s * (HALF + .014);
    matte.quad([lip, y0, z0], [lip, y1, z1], [lip, y1o, z1o], [lip, y0o, z0o], C.rubber, { facing: [s, 0, 0] });
    // El cuenco va sin luz ni reflejo: visto de lado, un material iluminado brilla justo donde debería estar negro.
    interior.quad([lip, y0, z0], [lip, y1, z1], [x1, y1, z1], [x1, y0, z0], well,
      { facing: [0, WHEEL_Y - (y0 + y1) / 2, center - (z0 + z1) / 2] });
  }
  interior.quad([x1, BOTTOM - .02, center - ARCH_RADIUS], [x1, BOTTOM - .02, center + ARCH_RADIUS], [x1, WHEEL_Y + ARCH_RADIUS, center + ARCH_RADIUS], [x1, WHEEL_Y + ARCH_RADIUS, center - ARCH_RADIUS], well, { facing: [s, 0, 0] });
}

/** Asientos, tubos amarillos, cielo raso y pasajeros: lo que se ve a través del vidrio. */
function buildInterior(kits, layout, index) {
  const { interior, lamps } = kits;
  const { z0, z1 } = layout;
  const zA = index === 0 ? z0 + .02 : z0 - .15, zB = index === 0 ? z1 + .15 : z1 - .02;
  // Piso: el centro corre entero y los lados se cortan en los pasos de rueda, que suben por encima de él.
  interior.quad([-.62, FLOOR, zA], [.62, FLOOR, zA], [.62, FLOOR, zB], [-.62, FLOOR, zB], C.floor, { facing: [0, 1, 0] });
  const gaps = [...layout.arches].sort((a, b) => a - b).map(c => [c - ARCH_RADIUS, c + ARCH_RADIUS]);
  for (const s of [-1, 1]) {
    let start = zA;
    for (const [a, b] of [...gaps, [zB, zB]]) {
      if (a > start) interior.quad([s * .62, FLOOR, start], [s * 1.33, FLOOR, start], [s * 1.33, FLOOR, a], [s * .62, FLOOR, a], C.floor, { facing: [0, 1, 0] });
      start = b;
    }
  }
  for (const c of layout.left.doors) interior.box(1.1, FLOOR + .004, c, .34, .004, BUS_DOOR_WIDTH, C.yellow, { skip: 'ny' });
  // Cielo raso con ligera bóveda: refleja luz de las regletas.
  const ceiling = [[-1.33, 3.02], [-1.0, 3.12], [1.0, 3.12], [1.33, 3.02]];
  for (let i = 0; i + 1 < ceiling.length; i++) {
    const [xa, ya] = ceiling[i], [xb, yb] = ceiling[i + 1];
    // Los tramos de los bordes paran donde empieza el extremo: más allá se saldrían por la esquina redondeada.
    const near = i === 1 ? zA : Math.max(zA, z0), far = i === 1 ? zB : Math.min(zB, z1);
    interior.quad([xa, ya, near], [xb, yb, near], [xb, yb, far], [xa, ya, far], i === 1 ? C.ceiling : shade(C.ceiling, .72), { facing: [0, -1, 0] });
  }
  lamps.uvOf = () => TONE.cove;
  for (const x of [-.62, .62]) lamps.quad([x - .07, 3.112, zA + .3], [x + .07, 3.112, zA + .3], [x + .07, 3.112, zB - .3], [x - .07, 3.112, zB - .3], C.strip, { facing: [0, -1, 0] });

  // Cajones de rueda: solo las caras que quedan por fuera del cuenco; las de adentro se verían desde la calle.
  for (const c of layout.arches) for (const s of [-1, 1]) {
    interior.box(s * .975, FLOOR + .25, c, .71, .5, 2 * ARCH_RADIUS, shade(C.wall, .62), { bottom: .55, skip: s > 0 ? 'nypx' : 'nynx' });
  }

  const seat = (x, z, color) => {
    interior.box(x, FLOOR + .46, z, .43, .07, .42, color, { bottom: .55, skip: 'ny' });
    interior.box(x, FLOOR + .78, z - .2, .43, .62, .06, color, { bottom: .75, top: 1.15, rotation: [-.1, 0, 0], skip: 'ny' });
    interior.box(x, FLOOR + .22, z, .05, .42, .05, C.frameSeat, { skip: 'nypy' });
  };
  const person = (x, z, seed, standing = false) => {
    const shirts = ['#2a333c', '#3b2c26', '#31423a', '#4b4b52', '#59302f', '#232d44', '#6b6f75', '#2f4a63', '#7a3b2e'], skins = ['#a57a59', '#855e44', '#bd9677', '#6d4c36'];
    const hairs = ['#17120f', '#2a1c12', '#0e0c0b', '#4a4744'], legsList = ['#1b1e25', '#23304a', '#2a2622', '#3a3a3e'];
    const body = rgb(shirts[seed % shirts.length]), skin = rgb(skins[seed % skins.length]), hair = rgb(hairs[(seed >> 1) % hairs.length]), legs = rgb(legsList[(seed >> 2) % legsList.length]);
    // Nadie va igual: altura, ancho y hacia dónde se inclina la cabeza salen de la misma semilla, siempre iguales entre partidas.
    const tall = 1 + ((seed * 7) % 5 - 2) * .025, wide = 1 + ((seed * 11) % 3 - 1) * .08, tilt = ((seed * 13) % 3 - 1) * .018;
    const hip = (standing ? FLOOR + .86 : FLOOR + .52) * tall + (standing ? 0 : FLOOR * (1 - tall));
    if (standing) {
      // Piernas rectas con zapato: un huevo alargado terminaba en punta y parecía flotar.
      for (const dx of [-.085, .085]) {
        interior.tube([[x + dx, hip + .02, z], [x + dx, FLOOR + .05, z]], .072, 6, legs, { caps: false });
        interior.box(x + dx, FLOOR + .035, z + .03, .1, .07, .24, rgb('#121214'));
      }
      // De pie se agarra del tubo: un brazo levantado es lo que se reconoce desde afuera.
      const side = seed % 2 ? 1 : -1;
      interior.tube([[x + side * .19, hip + .52, z], [x + side * .25, hip + .78, z + .02], [x + side * .16, hip + 1.02, z]], .036, 4, body, { caps: false });
    } else {
      // Sentado: las piernas salen hacia adelante, sobre el asiento.
      interior.box(x, FLOOR + .54, z + .2, .34, .1, .34, legs, { bottom: .6, skip: 'ny' });
    }
    interior.ellipsoid([x, hip + .27, z], [.19 * wide, .33, .125], v => shade(body, lerp(.55, 1.15, v)), { rows: 4, cols: 7 });
    // Hombros y cuello: sin ellos el cuerpo es un huevo con una bola encima.
    interior.ellipsoid([x, hip + .52, z], [.21 * wide, .075, .115], shade(body, 1.12), { rows: 2, cols: 6 });
    interior.tube([[x, hip + .56, z], [x + tilt, hip + .64, z + .01]], .046, 4, skin, { caps: false });
    interior.ellipsoid([x + tilt, hip + .73, z + .012], [.092, .118, .102], v => v > .6 ? hair : shade(skin, lerp(.7, 1.05, v)), { rows: 5, cols: 7 });
  };

  const left = layout.left, seats = [];
  const blocked = (s, z) => {
    if (layout.arches.some(c => Math.abs(z - c) < ARCH_RADIUS + .24)) return true;
    return s > 0 && left.doors.some(c => Math.abs(z - c) < BUS_DOOR_WIDTH / 2 + .22);
  };
  const first = index === 0 ? 1.2 : -9.8, last = index === 0 ? 8.6 : -2.2;
  for (let z = first; z <= last; z += .82) {
    for (const [x, s] of [[-1.05, -1], [-.6, -1], [1.05, 1]]) {
      if (blocked(s, z)) continue;
      const preferential = Math.abs(z) > 3 && Math.abs(z) < 4.6 && s < 0;
      seat(x, z, preferential ? C.seatRed : C.seatBlue);
      seats.push([x, z]);
    }
  }
  seats.forEach(([x, z], i) => { if ((i * 7 + index * 3) % 5 < 2) person(x, z, i + index * 2); });

  // Tubos del pasillo y barra del techo.
  for (let z = first - .1; z <= last + .4; z += 1.64) for (const x of [-.34, .34]) interior.tube([[x, FLOOR, z], [x, 2.78, z]], .018, 5, C.pole, { caps: false });
  for (const x of [-.34, .34]) interior.tube([[x, 2.78, first - .3], [x, 2.78, last + .5]], .016, 5, C.pole, { caps: false });
  for (const c of left.doors) for (const dz of [-.72, .72]) interior.tube([[1.18, FLOOR, c + dz], [1.18, 2.8, c + dz]], .018, 5, C.pole, { caps: false });
  // Gente de pie cerca de las puertas.
  [[-.05, left.doors[0] + .4], [.15, left.doors[1] - .6], [.1, (left.doors[0] + left.doors[1]) / 2]].forEach(([x, z], i) => person(x, z, i + 3 + index, true));
}

function buildRoof(kits, layout, index) {
  const { paint, matte } = kits;
  const zA = layout.z0, zB = layout.z1;
  const cuts = [zA];
  for (let z = zA + 1.18; z < zB - .1; z += 1.18) cuts.push(z, z + .018);
  cuts.push(zB);
  paint.uvOf = p => [p[2] / 8, .3 + p[0] * .04];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1], rib = i % 2 === 1;
    for (let k = 0; k + 1 < ROOF.length; k++) {
      const [x0, y0] = ROOF[k], [x1, y1] = ROOF[k + 1];
      const n0 = roofNormal(k), n1 = roofNormal(k + 1);
      const col0 = shade(C.roof, (rib ? .72 : 1) * lerp(.82, 1, smooth(Math.abs(1.3 - Math.abs(x0)), 0, .35)));
      const col1 = shade(C.roof, (rib ? .72 : 1) * lerp(.82, 1, smooth(Math.abs(1.3 - Math.abs(x1)), 0, .35)));
      paint.quad([x0, y0, a], [x1, y1, a], [x1, y1, b], [x0, y0, b], [col0, col1, col1, col0], { normal: [n0, n1, n1, n0], facing: [0, 1, 0] });
    }
  }

  // Equipo de aire: carcasa baja con dos rejillas largas y ventiladores discretos, no fogones.
  const ac = index === 0 ? 6 : -5.2;
  const base = 3.4, top = 3.72, shell = shade(C.roof, .92);
  paint.frustum(0, ac, base, top - .07, 2.08, 2.8, 2.04, 2.76, shell, { bottom: .62, skipTop: true });
  paint.frustum(0, ac, top - .07, top, 2.04, 2.76, 1.9, 2.62, shade(C.roof, 1.02), {});
  matte.slideValue = 0;
  for (const x of [-.52, .52]) {
    matte.box(x, top + .003, ac, .74, .006, 2.2, shade(C.steelDark, 1.1), { skip: 'ny' });
    for (let k = -10; k <= 10; k++) matte.box(x, top + .009, ac + k * .1, .7, .004, .022, shade(C.grey, .55), { skip: 'ny' });
    for (const dz of [-.62, .62]) matte.disc([x, top + .013, ac + dz], [0, 1, 0], .27, 12, shade(C.steelDark, .6), { rim: shade(C.grey, .62) });
  }
  // Toma lateral: una sola banda oscura con lamas finas, en vez de ventanitas sueltas.
  for (const s of [-1, 1]) {
    matte.box(s * 1.045, base + .17, ac, .012, .13, 2.3, shade(C.steelDark, .7));
    for (let k = -11; k <= 11; k++) matte.box(s * 1.052, base + .17, ac + k * .1, .006, .12, .022, shade(C.grey, .5));
  }
  // Escotillas de emergencia, con bisagras y bordes bajos.
  for (const z of index === 0 ? [2.3, 9.3] : [-2.3, -8.9]) {
    paint.frustum(0, z, 3.46, 3.53, .88, .88, .8, .8, shade(C.roof, .84), { bottom: .62 });
    for (const x of [-.26, .26]) matte.box(x, 3.535, z - .36, .08, .012, .05, C.steelDark, { skip: 'ny' });
  }
  if (index === 0) matte.tube([[.3, 3.48, 8.2], [.3, 3.74, 8.12]], .008, 5, C.black, { caps: false });
}

function roofNormal(k) {
  const a = ROOF[Math.max(0, k - 1)], b = ROOF[Math.min(ROOF.length - 1, k + 1)];
  let nx = b[1] - a[1], ny = -(b[0] - a[0]);
  if (ny < 0) { nx = -nx; ny = -ny; }
  const l = Math.hypot(nx, ny) || 1;
  return [nx / l, ny / l, 0];
}

/** Cierra el techo contra la tapa del extremo: la lámina roja sube y remata contra el techo claro con una junta oscura. */
function buildBrow(kit, cap, edge, sign) {
  const us = [-1, ...U_LIST.filter(u => u > -1 && u < 1), 1];
  const stops = [0, .3, .58, .76, .79, 1];
  kit.uvOf = p => [p[0] / 8, .34];
  const point = (u, t) => {
    const low = cap.point(u, EAVE), x = low[0];
    // La altura del techo en esa X: interpolada del mismo perfil.
    let roofY = EAVE;
    for (let k = 0; k + 1 < ROOF.length; k++) {
      const [x0, y0] = ROOF[k], [x1, y1] = ROOF[k + 1];
      if (x <= x0 && x >= x1) { roofY = lerp(y0, y1, (x0 - x) / (x0 - x1 || 1)); break; }
    }
    const ease = Math.sin(t * Math.PI / 2);
    return [x, lerp(EAVE, roofY, ease), lerp(low[2], edge, 1 - Math.cos(t * Math.PI / 2))];
  };
  const normal = (u, t) => {
    const a = point(clamp(u - .012, -1, 1), t), b = point(clamp(u + .012, -1, 1), t);
    const c = point(u, clamp(t - .03, 0, 1)), d = point(u, clamp(t + .03, 0, 1));
    const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dt = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
    const n = [du[1] * dt[2] - du[2] * dt[1], du[2] * dt[0] - du[0] * dt[2], du[0] * dt[1] - du[1] * dt[0]];
    const l = Math.hypot(...n) || 1, flip = n[1] + n[2] * sign < 0 ? -1 : 1;
    return [n[0] / l * flip, n[1] / l * flip, n[2] / l * flip];
  };
  for (let j = 0; j + 1 < stops.length; j++) for (let i = 0; i + 1 < us.length; i++) {
    const t0 = stops[j], t1 = stops[j + 1], ua = us[i], ub = us[i + 1];
    const color = j < 3 ? C.red : j === 3 ? shade(C.black, 1) : C.roof;
    const facing = [0, 1, sign];
    kit.quad(point(ua, t0), point(ub, t0), point(ub, t1), point(ua, t1), color, { normal: [normal(ua, t0), normal(ub, t0), normal(ub, t1), normal(ua, t1)], facing });
  }
  return point;
}

/** Parachoques liso de dos tonos y las franjas de la flota, que siguen de largo desde el costado sin escalón. */
function buildLowerCap({ paint, matte }, cap, extra) {
  const edge = .985, fade = y => lerp(.68, 1, smooth(y, BOTTOM, .82));
  shape(paint, cap, -edge, edge, () => BOTTOM, () => .572, (u, y) => shade(C.bumper, lerp(.5, 1.1, smooth(y, BOTTOM, .56))), { rows: 2, extra });
  // Una línea de sombra hundida separa los dos tonos.
  shape(matte, cap, -edge, edge, () => .572, () => .588, shade(C.black, .5), { off: -.004, extra });
  shape(paint, cap, -edge, edge, () => .588, () => .7, (u, y) => shade(C.redLow, lerp(1, 1.22, smooth(y, .59, .7))), { extra });
  // Donde acaba el parachoques sigue el faldón rojo del costado, con su misma sombra.
  for (const [a, b] of [[-1, -edge], [edge, 1]]) shape(paint, cap, a, b, () => BOTTOM, () => .7, (u, y) => shade(C.redLow, fade(y)), { rows: 2 });
  for (const [a, b] of [[-edge, -edge + .004], [edge - .004, edge]]) shape(matte, cap, a, b, () => BOTTOM, () => .7, C.black, { off: .002 });
  for (const [y0, y1, color] of [[.7, .712, C.seam], [.712, .772, C.yellow], [.772, .798, C.red], [.798, .826, C.white]]) {
    shape(paint, cap, -1, 1, () => y0, () => y1, (u, y) => shade(color, fade(y)), { extra });
  }
}

/** Grupo de faros alargado y delgado, metido en la máscara: lentes, luz diurna, posición, direccional y su cubierta. */
function buildHeadlamp({ matte, lamps, glass, flares }, cap, s) {
  const [u0, u1] = s > 0 ? [.585, .925] : [-.925, -.585], y0 = .9, y1 = 1.05;
  const outline = rounded(u0, u1, y0, y1, .022, .026), extra = outline.samples;
  shape(matte, cap, u0, u1, outline.low, outline.high, (u, y) => shade(C.steelDark, lerp(.55, 1.5, smooth(y, y0, y1))), { off: .005, rows: 2, extra });
  const yLens = .972;
  for (const [a, r] of [[.655, .05], [.755, .05]]) {
    const u = s * a, p = cap.point(u, yLens), n = cap.normal(u, yLens);
    const push = k => [p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k];
    // Bisel cromado, cuenco oscuro y lente con el centro encendido: un disco de un solo color se ve como una calcomanía.
    matte.disc(push(.009), n, r * 1.2, 16, C.chrome, { edge: shade(C.chrome, .55) });
    matte.disc(push(.012), n, r * .98, 16, shade(C.steelDark, .5));
    lamps.uvOf = () => TONE.lens;
    lamps.disc(push(.016), n, r * .8, 16, shade(C.lens, 1.25), { edge: shade(C.lens, .42) });
    flares.quad(...flareQuad(push(.05), n, .5), rgb('#ffe2b0', .5), { normal: n, facing: n, uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  }
  // Tira de luz diurna a lo largo del borde alto y luz de posición entre las lentes y la direccional.
  lamps.uvOf = () => TONE.daylight;
  patch(lamps, cap, s > 0 ? .61 : -.895, s > 0 ? .895 : -.61, 1.031, 1.043, C.drl, { off: .012 });
  const position = cap.point(s * .822, yLens), nPosition = cap.normal(s * .822, yLens);
  lamps.uvOf = () => TONE.marker;
  lamps.disc([position[0] + nPosition[0] * .012, position[1] + nPosition[1] * .012, position[2] + nPosition[2] * .012], nPosition, .022, 10, C.strip);
  lamps.uvOf = () => TONE.amber;
  patch(lamps, cap, s > 0 ? .862 : -.905, s > 0 ? .905 : -.862, .93, 1.012, (u, y) => shade(C.amber, lerp(.72, 1, smooth(y, .93, 1.01))), { off: .012 });
  // Cubierta del grupo: casi invisible, pero recoge el brillo y junta las lentes en una sola pieza.
  shape(glass, cap, u0, u1, outline.low, outline.high, [...rgb('#9fb2ba'), .16], { off: .021, extra });
}

/** Prisma de canto redondeado en el plano XY: la cabeza de un espejo no es una caja. */
function roundedPrism(kit, x, y, z, width, height, depth, radius, color, faceColor = null) {
  const outline = [];
  for (const [cx, cy, start] of [[1, 1, 0], [-1, 1, .5], [-1, -1, 1], [1, -1, 1.5]]) for (let k = 0; k <= 3; k++) {
    const a = (start + k / 6) * Math.PI;
    outline.push([x + cx * (width / 2 - radius) + Math.cos(a) * radius, y + cy * (height / 2 - radius) + Math.sin(a) * radius]);
  }
  const back = z - depth / 2, front = z + depth / 2;
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length], out = [(p[0] + q[0]) / 2 - x, (p[1] + q[1]) / 2 - y, 0];
    kit.quad([p[0], p[1], back], [q[0], q[1], back], [q[0], q[1], front], [p[0], p[1], front], color, { facing: out });
  });
  // La cara de adelante es la lámina negra; la de atrás, el espejo.
  const fan = (zz, normal, c, inset) => {
    const center = [x, y, zz];
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length];
      const pull = v => [x + (v[0] - x) * inset, y + (v[1] - y) * inset, zz];
      const a = pull(p), b = pull(q);
      kit.quad(center, a, b, center, c, { normal, facing: normal });
    });
  };
  fan(front, [0, 0, 1], color, 1);
  fan(back, [0, 0, -1], color, 1);
  if (faceColor) fan(back - .002, [0, 0, -1], faceColor, .88);
}

/** Espejo largo de antena: el brazo sale de la frente, avanza por fuera de la esquina y el espejo cuelga delante del pilar. */
function buildMirror({ matte }, s) {
  // Abierto lo justo para no rozar las columnas de la estación al pasar: el carril queda a 1,46 m del muro.
  const x = s * 1.455, z = 10.93;
  matte.tube([[s * 1.0, 3.37, 10.3], [s * 1.27, 3.385, 10.62], [s * 1.45, 3.3, 10.86], [x, 3.08, z]], .017, 6, C.black);
  roundedPrism(matte, x, 2.74, z, .15, .66, .05, .05, C.black, C.chrome);
  // El gran angular de abajo, separado por un cuello corto.
  matte.box(x, 2.385, z, .05, .05, .03, C.black);
  roundedPrism(matte, x, 2.26, z, .14, .22, .045, .05, C.black, shade(C.chrome, .85));
}

/** Bajo la máscara del frente: se hunde a los lados para abrazar los faros y barre la esquina hasta la línea del cinturón. */
const frontMaskLow = u => {
  const a = Math.abs(u);
  return a >= .93 ? lerp(.875, 1.485, smooth(a, .93, .998)) : lerp(1.1, .875, smooth(a, .45, .565));
};
const frontMaskHigh = u => lerp(3.14, WINDOW_TOP, smooth(Math.abs(u), .84, .998));
const FRONT_CUTS = [.45, .48, .51, .54, .565, .84, .86, .9, .93, .955].flatMap(u => [u, -u]);

function buildFront(kits) {
  const { paint, matte, glass, lamps, decals, sign, flares, interior } = kits;
  const cap = FRONT, extra = FRONT_CUTS;
  paint.uvOf = p => [(p[0] + p[2]) / 8, clamp((p[1] - .4) / 3.1, 0, 1)];
  matte.slideValue = 0; glass.slideValue = 0;

  buildLowerCap(kits, cap, extra);
  shape(paint, cap, -1, 1, () => .826, frontMaskLow, (u, y) => shade(C.red, lerp(.9, 1, smooth(y, .826, 1.1))), { extra });

  // Parabrisas de una sola pieza con esquinas muy redondeadas, envuelto por la máscara negra que sigue en los costados.
  const screen = rounded(-.905, .905, 1.16, 2.82, .13, .27, .2);
  around(paint, cap, -1, 1, frontMaskLow, frontMaskHigh, screen, C.gloss, { extra });
  shape(paint, cap, -1, 1, frontMaskHigh, () => EAVE, C.red, { extra });
  // Más oscuro arriba, como la franja tintada de fábrica: abajo se alcanza a ver al conductor.
  const tint = rgb('#16222a');
  shape(glass, cap, screen.u0, screen.u1, screen.low, screen.high, (u, y) => [...tint, lerp(.44, .78, smooth(y, 2.25, 2.82))], { off: -.012, rows: 4, extra: screen.samples });
  // Junta de caucho: el filete que separa vidrio y máscara cuando les da el sol.
  const gasket = rounded(-.915, .915, 1.148, 2.832, .135, .275, .205);
  around(matte, cap, gasket.u0, gasket.u1, gasket.low, gasket.high, screen, C.rubber, { off: .003 });

  // Letrero LED en la máscara, debajo de la visera.
  const signU = .8, signLow = 2.875, signHigh = 3.1;
  patch(matte, cap, -signU - .03, signU + .03, signLow - .022, signHigh + .02, shade(C.black, .7), { off: .003 });
  const ux = [-signU, ...U_LIST.filter(u => Math.abs(u) < signU), signU];
  for (let i = 0; i + 1 < ux.length; i++) {
    const a = cap.point(ux[i], signLow), b = cap.point(ux[i + 1], signLow), c = cap.point(ux[i + 1], signHigh), d = cap.point(ux[i], signHigh);
    const n = cap.normal((ux[i] + ux[i + 1]) / 2, (signLow + signHigh) / 2);
    const lift = p => [p[0] + n[0] * .006, p[1] + n[1] * .006, p[2] + n[2] * .006];
    const s0 = (ux[i] + signU) / (2 * signU), s1 = (ux[i + 1] + signU) / (2 * signU);
    sign.quad(lift(a), lift(b), lift(c), lift(d), [1, 1, 1], { normal: n, facing: n, uv: [[s0, .5], [s1, .5], [s1, 1], [s0, 1]] });
  }
  visor(paint, cap, -.97, .97, 3.125, .15, .028, C.red);

  for (const s of [-1, 1]) {
    buildHeadlamp(kits, cap, s);
    // Exploradora redonda en el tono bajo del parachoques.
    const fog = cap.point(s * .8, .5), nf = cap.normal(s * .8, .5);
    matte.disc([fog[0] + nf[0] * .004, fog[1] + nf[1] * .004, fog[2] + nf[2] * .004], nf, .054, 12, shade(C.steelDark, .7));
    lamps.uvOf = () => TONE.marker;
    lamps.disc([fog[0] + nf[0] * .008, fog[1] + nf[1] * .008, fog[2] + nf[2] * .008], nf, .04, 12, C.lens, { edge: shade(C.lens, .6) });
    buildMirror(kits, s);
  }
  // Placa colombiana de servicio público, nombre del sistema y numeración de flota, sin emblemas.
  capDecal(decals, DECAL.plate, cap, -.17, .17, .425, .57);
  capDecal(decals, DECAL.number, cap, -.13, .13, .6, .69);
  capDecal(decals, DECAL.name, cap, -.3, .3, .92, 1.08);

  // Limpiabrisas parqueados sobre la base del vidrio: el brazo sale de la máscara y la plumilla descansa casi horizontal.
  // La UV libre del caucho guarda el pivote: el material lo gira con la lluvia.
  for (const s of [-1, 1]) {
    const off = (p, n, k) => [p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k];
    const n = cap.normal(s * .3, 1.4);
    const pivot = off(cap.point(s * .7, 1.13), n, .012), bladeMid = off(cap.point(s * .38, 1.27), n, .022);
    const bladeA = off(cap.point(s * .06, 1.25), n, .022), bladeB = off(cap.point(s * .7, 1.3), n, .022);
    matte.uvOf = () => [pivot[0], pivot[1]];
    matte.tube([pivot, bladeMid], .011, 4, C.black, { flat: true });
    matte.tube([bladeA, bladeB], .009, 4, C.black, { flat: true });
    matte.box(pivot[0], pivot[1], pivot[2], .055, .055, .02, C.steelDark);
    matte.uvOf = null;
  }

  const brow = buildBrow(paint, cap, FRONT_EDGE, 1);
  // Luces de gálibo en la frente, ámbar y delgadas.
  lamps.uvOf = () => TONE.marker;
  for (const u of [-.78, -.12, 0, .12, .78]) {
    const p = brow(u, .42);
    lamps.box(p[0], p[1] + .006, p[2], .07, .022, .05, C.amber, { skip: 'ny' });
  }

  // Forro interior: por dentro de la lámina no se ve la calle a través de la máscara.
  around(interior, cap, -1, 1, () => .92, () => EAVE, screen, C.pillar, { off: -.05, extra, inward: true });
  // Tablero que sigue la curva del vidrio, con el cielo raso de la cabina enfrente.
  const dash = capColumns(-.93, .93);
  for (let i = 0; i + 1 < dash.length; i++) {
    const front = (u, y, k = -.07) => { const p = cap.point(u, y), n = cap.normal(u, y); return [p[0] + n[0] * k, y, p[2] + n[2] * k]; };
    const a = front(dash[i], 1.28), b = front(dash[i + 1], 1.28);
    interior.quad(a, b, [b[0] * .96, 1.34, FRONT_EDGE], [a[0] * .96, 1.34, FRONT_EDGE], [shade(C.pillar, .5), shade(C.pillar, .5), C.pillar, C.pillar], { facing: [0, 1, 0] });
    const ca = front(dash[i], 2.86), cb = front(dash[i + 1], 2.86);
    interior.quad(ca, cb, [cb[0] * .96, 3.12, FRONT_EDGE], [ca[0] * .96, 3.12, FRONT_EDGE], shade(C.ceiling, .5), { facing: [0, -1, 0] });
  }
  // Cabina: volante chico e inclinado, conductor con los brazos al timón y una mampara baja detrás de él.
  interior.box(.78, 1.26, 10.42, .34, .14, .26, shade(C.pillar, .7));
  const wheelRing = [];
  for (let i = 0; i <= 14; i++) {
    const a = i / 14 * Math.PI * 2;
    wheelRing.push([.78 + Math.cos(a) * .19, 1.56 + Math.sin(a) * .1, 10.2 + Math.sin(a) * .15]);
  }
  interior.tube(wheelRing, .014, 4, C.black, { caps: false });
  interior.box(.78, 1.42, 9.5, .5, .1, .5, C.frameSeat);
  interior.box(.78, 1.9, 9.26, .5, .9, .1, C.frameSeat);
  const uniform = rgb('#27364e'), skin = rgb('#a57a59');
  interior.ellipsoid([.78, 1.84, 9.6], [.21, .36, .14], v => shade(uniform, lerp(.55, 1.15, v)), { rows: 4, cols: 6 });
  interior.ellipsoid([.78, 2.14, 9.6], [.23, .07, .12], shade(uniform, 1.1), { rows: 3, cols: 6 });
  interior.ellipsoid([.78, 2.34, 9.64], [.095, .12, .105], v => v > .62 ? rgb('#17120f') : shade(skin, lerp(.7, 1.05, v)), { rows: 5, cols: 8 });
  for (const s of [-1, 1]) {
    interior.tube([[.78 + s * .2, 2.12, 9.62], [.78 + s * .22, 1.82, 9.82], [.78 + s * .13, 1.6, 10.12]], .04, 4, uniform, { caps: false });
    interior.ellipsoid([.78 + s * .13, 1.58, 10.16], [.04, .035, .05], skin, { rows: 2, cols: 4 });
  }
  interior.box(.98, 1.4, 9.08, .7, 1, .05, C.pillar);
  interior.tube([[.63, 1.9, 9.08], [1.33, 1.9, 9.08]], .018, 4, C.pole, { caps: false });
  flares.quad([-1.05, .05, 11.0], [1.05, .05, 11.0], [1.6, .05, 15.5], [-1.6, .05, 15.5], rgb('#ffdfae', .16), { normal: [0, 1, 0], facing: [0, 1, 0], uv: [[.18, .64], [.82, .64], [.98, 1], [.02, 1]] });
}

function flareQuad(center, n, size) {
  const up = [0, 1, 0];
  const right = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const l = Math.hypot(...right) || 1;
  const r = right.map(v => v / l * size / 2), u = [0, size / 2, 0];
  const at = (a, b) => [center[0] + r[0] * a + u[0] * b, center[1] + r[1] * a + u[1] * b, center[2] + r[2] * a + u[2] * b];
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/** La máscara de la cola repite la del frente: baja en las puntas para abrazar los grupos de luces y barre la esquina. */
const rearMaskLow = u => {
  const a = Math.abs(u);
  return a >= .95 ? lerp(.965, 1.485, smooth(a, .95, .998)) : lerp(1.96, .965, smooth(a, .62, .71));
};
const rearMaskHigh = u => lerp(2.95, WINDOW_TOP, smooth(Math.abs(u), .9, .998));
const REAR_CUTS = [.62, .65, .68, .71, .9, .95].flatMap(u => [u, -u]);

function buildRear(kits) {
  const { paint, matte, glass, lamps, decals, sign, stops, flares, interior } = kits;
  const cap = REAR, extra = REAR_CUTS;
  paint.uvOf = p => [(p[0] + p[2]) / 8, clamp((p[1] - .4) / 3.1, 0, 1)];
  matte.slideValue = 0; glass.slideValue = 0;

  buildLowerCap(kits, cap, extra);
  shape(paint, cap, -1, 1, () => .826, rearMaskLow, (u, y) => shade(C.red, lerp(.9, 1, smooth(y, .826, 1.2))), { extra });
  const rearWindow = rounded(-.6, .6, 2.04, 2.86, .07, .12);
  around(paint, cap, -1, 1, rearMaskLow, rearMaskHigh, rearWindow, C.gloss, { extra });
  shape(paint, cap, -1, 1, rearMaskHigh, () => EAVE, C.red, { extra });
  // Ventana trasera entintada, con el pasillo al fondo.
  shape(glass, cap, rearWindow.u0, rearWindow.u1, rearWindow.low, rearWindow.high, [...rgb('#1a2529'), .62], { off: -.01, extra: rearWindow.samples });

  // Rejilla del motor: un rebaje de esquinas redondas con lamas delgadas, sin el marco de un bus de otra época.
  const grille = rounded(-.5, .5, .9, 1.34, .03, .04);
  shape(matte, cap, grille.u0, grille.u1, grille.low, grille.high, shade(C.black, .7), { off: .003, extra: grille.samples });
  for (let k = 0; k < 7; k++) patch(matte, cap, -.475, .475, .925 + k * .056, .944 + k * .056, shade(C.steelDark, 1.25), { off: .008 });
  // Placa, nombre y numeración.
  capDecal(decals, DECAL.plate, cap, -.17, .17, .425, .57, .006, true);
  capDecal(decals, DECAL.name, cap, -.3, .3, 1.46, 1.62, .006, true);
  capDecal(decals, DECAL.number, cap, -.16, .16, 1.36, 1.44, .006, true);

  // Grupos traseros altos y delgados en la máscara: direccional, cuarto y stop, reversa y antiniebla, cada uno en su celda.
  for (const s of [-1, 1]) {
    const [u0, u1] = s > 0 ? [.725, .925] : [-.925, -.725];
    const housing = rounded(u0, u1, 1.0, 1.92, .012, .04);
    shape(matte, cap, u0, u1, housing.low, housing.high, shade(C.steelDark, .8), { off: .005, extra: housing.samples });
    const a = u0 + .008, b = u1 - .008;
    const cell = (y0, y1, kit, color, tone) => { kit.uvOf = () => tone; patch(kit, cap, a, b, y0, y1, u => color, { off: .012 }); };
    cell(1.68, 1.88, lamps, C.amber, TONE.amber);
    cell(1.28, 1.65, lamps, shade(C.tail, .85), TONE.tail);
    cell(1.15, 1.25, lamps, C.reverse, TONE.reverse);
    cell(1.03, 1.12, lamps, shade(C.tail, .7), TONE.tail);
    // Lente acanalado: líneas oscuras finas para que no parezca un rectángulo de color.
    for (const yl of [1.37, 1.46, 1.55, 1.78]) patch(matte, cap, a, b, yl, yl + .008, C.black, { off: .016 });
    stops.uvOf = () => [1, 1];
    patch(stops, cap, a, b, 1.28, 1.65, C.tail, { off: .014 });
    const center = cap.point((u0 + u1) / 2, 1.46), n = cap.normal((u0 + u1) / 2, 1.46);
    flares.quad(...flareQuad([center[0] + n[0] * .05, center[1], center[2] + n[2] * .05], n, .5), rgb('#ff3020', .4), { normal: n, facing: n, uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  }
  // Tercer stop sobre el letrero.
  patch(stops, cap, -.22, .22, 2.888, 2.918, C.tail, { off: .006 });
  lamps.uvOf = () => TONE.tail;
  patch(lamps, cap, -.22, .22, 2.888, 2.918, shade(C.tail, .45), { off: .004 });
  // Letrero trasero, por delante del vidrio.
  const leftU = -.54, rightU = .54, y0 = 2.58, y1 = 2.82;
  const ux = [leftU, ...U_LIST.filter(u => u > leftU && u < rightU), rightU];
  for (let i = 0; i + 1 < ux.length; i++) {
    const a = cap.point(ux[i], y0), b = cap.point(ux[i + 1], y0), c = cap.point(ux[i + 1], y1), d = cap.point(ux[i], y1);
    const n = cap.normal((ux[i] + ux[i + 1]) / 2, (y0 + y1) / 2);
    const lift = p => [p[0] + n[0] * .002, p[1] + n[1] * .002, p[2] + n[2] * .002];
    // Visto desde atrás +X queda a la izquierda: el texto corre al revés de u.
    const s0 = (rightU - ux[i]) / (rightU - leftU), s1 = (rightU - ux[i + 1]) / (rightU - leftU);
    sign.quad(lift(a), lift(b), lift(c), lift(d), [1, 1, 1], { normal: n, facing: n, uv: [[s0, .5], [s1, .5], [s1, 1], [s0, 1]] });
  }
  const brow = buildBrow(paint, cap, REAR_EDGE, -1);
  lamps.uvOf = () => TONE.marker;
  for (const u of [-.78, .78]) {
    const p = brow(u, .42);
    lamps.box(p[0], p[1] + .006, p[2], .07, .022, .05, shade(C.tail, .9), { skip: 'ny' });
  }
  // Forro interior: desde los costados no se ve la calle a través de la lámina.
  patch(interior, cap, -1, 1, .92, EAVE, C.pillar, { off: -.05, rows: 2, inward: true });
}

/** Anillo de acero donde termina cada sección, sobre el que se ancla el fuelle. */
function buildEndFrame(kits, z, sign) {
  const { matte, paint } = kits;
  matte.slideValue = 0;
  const outline = [[-1.34, .5], [-1.34, EAVE - .04], [-1.26, 3.3], [-1.1, 3.4], [-.7, 3.455], [0, 3.47], [.7, 3.455], [1.1, 3.4], [1.26, 3.3], [1.34, EAVE - .04], [1.34, .5]];
  const depth = .085, zIn = z, zOut = z + sign * depth;
  for (let i = 0; i + 1 < outline.length; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[i + 1];
    const k = 1.03;
    const col = shade(C.steel, lerp(.75, 1, (y0 + y1) / 2 / 3.5));
    matte.quad([x0 * k, y0 + (y0 > 1 ? .03 : 0), zIn], [x1 * k, y1 + (y1 > 1 ? .03 : 0), zIn], [x1 * k, y1 + (y1 > 1 ? .03 : 0), zOut], [x0 * k, y0 + (y0 > 1 ? .03 : 0), zOut], col,
      { facing: [(x0 + x1) / 2, (y0 + y1) / 2 - 1.9, 0] });
    matte.quad([x0 * k, y0 + (y0 > 1 ? .03 : 0), zOut], [x1 * k, y1 + (y1 > 1 ? .03 : 0), zOut], [x1 * .94, y1 - (y1 > 1 ? .05 : 0), zOut], [x0 * .94, y0 - (y0 > 1 ? .05 : 0), zOut], shade(col, .7),
      { facing: [0, 0, sign] });
  }
  // Cierra el hueco por dentro: el fuelle no deja ver la calle a través del bus.
  paint.quad([-1.34, .46, z], [1.34, .46, z], [1.34, 3.44, z], [-1.34, 3.44, z], C.black, { facing: [0, 0, sign] });
}

function buildBelly(kits, layout) {
  const { matte } = kits;
  matte.slideValue = 0;
  const zA = layout.z0 - (layout.z0 < 0 ? .2 : 0), zB = layout.z1 + (layout.z1 > 0 ? .2 : 0);
  matte.quad([-.62, BOTTOM + .02, zA], [.62, BOTTOM + .02, zA], [.62, BOTTOM + .02, zB], [-.62, BOTTOM + .02, zB], shade(C.black, .5), { facing: [0, -1, 0] });
  const gaps = [...layout.arches].sort((a, b) => a - b).map(c => [c - ARCH_RADIUS, c + ARCH_RADIUS]);
  for (const s of [-1, 1]) {
    let start = zA;
    for (const [a, b] of [...gaps, [zB, zB]]) {
      if (a > start) matte.quad([s * .62, BOTTOM + .02, start], [s * 1.33, BOTTOM + .02, start], [s * 1.33, BOTTOM + .02, a], [s * .62, BOTTOM + .02, a], shade(C.black, .4), { facing: [0, -1, 0] });
      start = b;
    }
  }
  // Largueros, puente y tanque: desde abajo del viaducto la panza se ve.
  for (const x of [-.48, .48]) matte.box(x, BOTTOM - .05, (zA + zB) / 2, .12, .1, zB - zA - .3, C.steelDark);
  for (const c of layout.arches) {
    matte.tube([[-1.05, WHEEL_Y, c], [1.05, WHEEL_Y, c]], .07, 6, C.steelDark);
    matte.box(0, WHEEL_Y - .18, c, .5, .34, .42, shade(C.steelDark, .8));
  }
}

/** Letras de la calcomanía del nombre existente, numeración y placa colombiana de servicio público. */
function drawDecals(ctx) {
  const box = (r, fn) => { const x = r.u0 * ATLAS.width, y = (1 - r.v1) * ATLAS.height, w = (r.u1 - r.u0) * ATLAS.width, h = (r.v1 - r.v0) * ATLAS.height; ctx.save(); ctx.translate(x, y); fn(w, h); ctx.restore(); };
  ctx.clearRect(0, 0, ATLAS.width, ATLAS.height);
  box(DECAL.name, (w, h) => {
    ctx.font = 'italic 600 104px "Arial Narrow", Arial, sans-serif';
    ctx.fillStyle = '#f4f4ee'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TransMilenio', w / 2, h / 2 + 4, w - 20);
  });
  box(DECAL.number, (w, h) => {
    ctx.font = '700 54px "Arial Narrow", Arial, sans-serif'; ctx.fillStyle = '#f0efe6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('4 8 2 1', w / 2, h / 2 + 2);
  });
  box(DECAL.numberDark, (w, h) => {
    ctx.font = '700 54px "Arial Narrow", Arial, sans-serif'; ctx.fillStyle = '#17181a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('4 8 2 1', w / 2, h / 2 + 2);
  });
  box(DECAL.plate, (w, h) => {
    ctx.fillStyle = '#f3f3ee'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#191a1c'; ctx.lineWidth = 7; ctx.strokeRect(7, 7, w - 14, h - 14);
    ctx.fillStyle = '#191a1c'; ctx.font = '800 72px "Arial Narrow", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SBT 482', w / 2, h / 2 - 8);
    ctx.font = '600 22px Arial, sans-serif'; ctx.fillText('BOGOTA D.C.', w / 2, h - 24);
  });
  box(DECAL.access, (w, h) => {
    ctx.fillStyle = '#1b5fae'; ctx.fillRect(4, 4, w - 8, h - 8);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(w * .46, h * .62, 22, .4, Math.PI * 1.8); ctx.stroke();
    ctx.beginPath(); ctx.arc(w * .47, h * .26, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * .47, h * .34); ctx.lineTo(w * .49, h * .55); ctx.lineTo(w * .66, h * .57); ctx.lineTo(w * .74, h * .78); ctx.stroke();
  });
  box(DECAL.caution, (w, h) => {
    ctx.fillStyle = '#f0c018'; ctx.beginPath(); ctx.moveTo(w / 2, 8); ctx.lineTo(w - 8, h - 12); ctx.lineTo(8, h - 12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#151515'; ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = '#151515'; ctx.fillRect(w / 2 - 6, h * .38, 12, h * .3); ctx.beginPath(); ctx.arc(w / 2, h * .76, 7, 0, Math.PI * 2); ctx.fill();
  });
  box(DECAL.lean, (w, h) => {
    ctx.font = '700 30px Arial, sans-serif'; ctx.fillStyle = '#f0c018'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('NO SE APOYE', w / 2, h / 2);
  });
  box(DECAL.emergency, (w, h) => {
    ctx.font = '800 28px Arial, sans-serif'; ctx.fillStyle = '#d9301f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SALIDA DE EMERGENCIA', w / 2, h / 2, w - 10);
  });
  box(DECAL.vent, (w, h) => {
    ctx.fillStyle = '#121315';
    for (let y = 8; y < h - 8; y += 16) ctx.fillRect(6, y, w - 12, 9);
  });
}

/** Mapa de suciedad: multiplica la pintura, así que el blanco deja el color intacto. Barro abajo y chorreones que bajan del techo. */
function drawGrime(ctx, w, h) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  let seed = 1234;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Las franjas empiezan a un 10 % de la altura: el barro se queda abajo para no ensuciarles el color.
  const mud = ctx.createLinearGradient(0, h, 0, h * .78);
  mud.addColorStop(0, 'rgba(92,72,54,.62)'); mud.addColorStop(.32, 'rgba(100,84,68,.2)'); mud.addColorStop(.6, 'rgba(110,95,80,.07)'); mud.addColorStop(1, 'rgba(120,105,90,0)');
  ctx.fillStyle = mud; ctx.fillRect(0, h * .78, w, h * .22);
  for (let i = 0; i < 700; i++) {
    const x = random() * w, y = h - Math.pow(random(), 2.6) * h * .2;
    ctx.fillStyle = `rgba(70,56,44,${.05 + random() * .12})`;
    ctx.fillRect(x, y, 1 + random() * 3, 1 + random() * 2);
  }
  for (let i = 0; i < 70; i++) {
    const x = random() * w, length = 20 + random() * h * .4;
    const g = ctx.createLinearGradient(0, 0, 0, length);
    g.addColorStop(0, `rgba(40,36,34,${.05 + random() * .1})`); g.addColorStop(1, 'rgba(40,36,34,0)');
    ctx.fillStyle = g; ctx.save(); ctx.translate(x, random() * h * .12); ctx.fillRect(0, 0, 1 + random() * 2, length); ctx.restore();
  }
  // Polvo muy suave en parches: rompe la igualdad del color a media altura.
  for (let i = 0; i < 40; i++) {
    const x = random() * w, y = random() * h, r = 14 + random() * 42;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(96,88,80,${.03 + random() * .05})`); g.addColorStop(1, 'rgba(96,88,80,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function drawFlare(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.18, 'rgba(255,255,255,.55)'); g.addColorStop(.5, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

export const LED_ROUTES = {
  north: ['B12 PORTAL CENTRO', 'EXPRESO CARACAS'],
  south: ['B12 PARQUE DEL LAGO', 'EXPRESO CARACAS']
};

/** Dos páginas de matriz de puntos; el bus alterna entre ellas despacio, sin parpadeo. */
function ledTexture(pages) {
  const cellW = 4, cellH = 5, columns = 240, rows = 16;
  const texture = canvasTexture(columns * cellW, rows * cellH * 2, ctx => {
    ctx.fillStyle = '#0a0806'; ctx.fillRect(0, 0, columns * cellW, rows * cellH * 2);
    pages.forEach((text, page) => {
      const offset = page * rows;
      const left = Math.max(0, Math.floor((columns - ledTextColumns(text, 2)) / 2));
      ctx.save();
      drawLedText(ctx, text, left, offset + 1, { cellW, cellH, scale: 2, color: '#ffae18' });
      ctx.restore();
    });
  }, { anisotropy: 8 });
  return texture;
}

let shared = null;
/** Texturas compartidas por todos los buses: una sola copia en la GPU. */
export function busTextures() {
  shared ??= {
    grime: canvasTexture(512, 256, drawGrime),
    decals: canvasTexture(ATLAS.width, ATLAS.height, drawDecals, { anisotropy: 8 }),
    flare: canvasTexture(64, 64, drawFlare, { anisotropy: 1 }),
    ledNorth: ledTexture(LED_ROUTES.north),
    ledSouth: ledTexture(LED_ROUTES.south)
  };
  if (shared.grime.wrapS !== THREE.RepeatWrapping) shared.grime.wrapS = THREE.RepeatWrapping;
  return shared;
}

function buildWheel() {
  const kit = new MeshKit();
  const r = .628;
  // El perfil va del hombro interior a la tapa: las normales salen hacia afuera por orden de recorrido.
  kit.revolve([
    [.54, -.21, C.side], [.6, -.2, C.tire], [r, -.165, C.tire], [r, -.118, C.tire], [r - .012, -.112, shade(C.tire, .35)], [r - .012, -.09, shade(C.tire, .35)], [r, -.084, C.tire],
    [r, .084, C.tire], [r - .012, .09, shade(C.tire, .35)], [r - .012, .112, shade(C.tire, .35)], [r, .118, C.tire], [r, .165, C.tire],
    [.6, .2, C.tire], [.54, .222, C.side], [.44, .232, C.side], [.395, .218, shade(C.side, 1.2)]
  ], 24);
  kit.revolve([
    [.395, .218, C.rim], [.372, .23, shade(C.rim, 1.25)], [.355, .205, shade(C.rim, .7)], [.335, .13, shade(C.rimDark, .8)],
    [.3, .118, C.rimDark], [.215, .118, C.rim], [.2, .13, shade(C.rim, 1.15)], [.135, .15, C.rim], [.12, .185, C.hub], [.07, .2, shade(C.hub, 1.1)], [.0, .2, C.hub]
  ], 18);
  // Perforaciones del disco y pernos.
  for (let i = 0; i < 10; i++) {
    const t = i / 10 * Math.PI * 2;
    kit.disc([.122, Math.cos(t) * .265, Math.sin(t) * .265], [1, 0, 0], .034, 8, shade(C.black, .2));
    const lug = [Math.cos(t + .31) * .168, Math.sin(t + .31) * .168];
    kit.tube([[.13, lug[0], lug[1]], [.175, lug[0], lug[1]]], .021, 6, C.lug, { flat: true, twist: .4 });
  }
  return kit.geometry();
}

/** Fuelle de caucho con pliegues reales: cada pliegue tiene caras planas para que la luz marque el acordeón. */
function buildBellows(accordion) {
  const zFront = accordion.min, zRear = accordion.max;
  const outline = [[-1.3, .55], [-1.32, .9], [-1.33, 1.6], [-1.32, 2.4], [-1.3, 3.0], [-1.25, 3.2], [-1.12, 3.32], [-.86, 3.4], [-.45, 3.44], [0, 3.45],
    [.45, 3.44], [.86, 3.4], [1.12, 3.32], [1.25, 3.2], [1.3, 3], [1.32, 2.4], [1.33, 1.6], [1.32, .9], [1.3, .55]];
  const positions = [], normals = [], colors = [], skinIndex = [], skinWeight = [], indices = [];
  const folds = 15, midZ = (zFront + zRear) / 2;
  const center = [0, 1.92];
  const direction = i => {
    const a = outline[Math.max(0, i - 1)], b = outline[Math.min(outline.length - 1, i + 1)];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const p = outline[i];
    if (nx * (p[0] - center[0]) + ny * (p[1] - center[1]) < 0) { nx = -nx; ny = -ny; }
    const l = Math.hypot(nx, ny) || 1;
    return [nx / l, ny / l];
  };
  const ring = t => {
    const z = lerp(zFront, zRear, t);
    const phase = t * folds * 2;
    const ridge = Math.round(phase) % 2 === 0;
    return { z, offset: ridge ? .04 : -.03, ridge };
  };
  const weights = z => {
    if (z >= midZ) { const k = (zFront - z) / (zFront - midZ); return [0, 1, 1 - k, k]; }
    const k = (midZ - z) / (midZ - zRear); return [1, 2, 1 - k, k];
  };
  const rubber = rgb('#2b2d30'), rubberLow = rgb('#08080a');
  const pushVertex = (p, n, c, z) => {
    positions.push(...p); normals.push(...n); colors.push(...c);
    const [a, b, wa, wb] = weights(z);
    skinIndex.push(a, b, 0, 0); skinWeight.push(wa, wb, 0, 0);
  };
  const steps = folds * 2;
  for (let s = 0; s < steps; s++) {
    const A = ring(s / steps), B = ring((s + 1) / steps);
    for (let i = 0; i + 1 < outline.length; i++) {
      const dI = direction(i), dJ = direction(i + 1);
      const pA = (idx, d, r) => [outline[idx][0] + d[0] * r.offset, outline[idx][1] + d[1] * r.offset, r.z];
      const a = pA(i, dI, A), b = pA(i + 1, dJ, A), c = pA(i + 1, dJ, B), d = pA(i, dI, B);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const midX = (a[0] + b[0]) / 2, midY = (a[1] + b[1]) / 2;
      if (n[0] * midX + n[1] * (midY - center[1]) < 0) n = n.map(x => -x);
      const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
      const base = positions.length / 3;
      const colorOf = r => r.ridge ? rubber : rubberLow;
      pushVertex(a, n, colorOf(A), A.z); pushVertex(b, n, colorOf(A), A.z); pushVertex(c, n, colorOf(B), B.z); pushVertex(d, n, colorOf(B), B.z);
      const flat = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      if (flat[0] * n[0] + flat[1] * n[1] + flat[2] * n[2] < 0) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // Marco de acero central: amarra el pliegue del medio al hueso central.
  const steel = rgb('#44484c');
  for (let i = 0; i + 1 < outline.length; i++) {
    const dI = direction(i), dJ = direction(i + 1);
    const z0 = midZ + .035, z1 = midZ - .035, k = .052;
    const a = [outline[i][0] + dI[0] * k, outline[i][1] + dI[1] * k], b = [outline[i + 1][0] + dJ[0] * k, outline[i + 1][1] + dJ[1] * k];
    const nx = (dI[0] + dJ[0]) / 2, ny = (dI[1] + dJ[1]) / 2;
    const base = positions.length / 3;
    pushVertex([a[0], a[1], z0], [nx, ny, 0], steel, midZ); pushVertex([b[0], b[1], z0], [nx, ny, 0], steel, midZ);
    pushVertex([b[0], b[1], z1], [nx, ny, 0], steel, midZ); pushVertex([a[0], a[1], z1], [nx, ny, 0], steel, midZ);
    const flat = (b[0] - a[0]) * ny * (z1 - z0) * 0;
    const u = [b[0] - a[0], b[1] - a[1], 0], v = [0, 0, z1 - z0];
    const cz = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], 0];
    if (cz[0] * nx + cz[1] * ny + flat >= 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(indices);
  return { geometry, zFront, midZ, zRear };
}

let built = null;
/** Geometría compartida entre buses: lo que cambia por bus son los materiales. */
export function busGeometry(spec) {
  if (built) return built;
  const sections = LAYOUT.map((layout, index) => {
    const kits = createKits();
    buildSide(kits, layout, 1);
    buildSide(kits, layout, -1);
    buildInterior(kits, layout, index);
    buildRoof(kits, layout, index);
    buildBelly(kits, layout);
    if (index === 0) {
      buildFront(kits);
      buildEndFrame(kits, layout.z0, -1);
      // Nombre del sistema en el costado libre, y más corto en el lado de las puertas.
      sideDecal(kits.decals, DECAL.name, -1, 4.9, 1.24, 2.6, .43);
      sideDecal(kits.decals, DECAL.name, 1, 9.2, 1.26, 1.5, .25);
      for (const s of [-1, 1]) sideDecal(kits.decals, DECAL.number, s, 9.3, .98, .55, .14);
      // Letrero lateral en la ventana entre puertas.
      const y0 = 2.68, y1 = 2.88, x = widthAt(2.78) - .002, z0 = 4.46, z1 = 5.54;
      kits.sign.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], [1, 1, 1], { normal: [1, 0, 0], facing: [1, 0, 0], uv: [[.04, .5], [.96, .5], [.96, 1], [.04, 1]] });
    } else {
      buildRear(kits);
      buildEndFrame(kits, layout.z1, 1);
      sideDecal(kits.decals, DECAL.name, -1, -4.3, 1.24, 2.6, .43);
      sideDecal(kits.decals, DECAL.name, 1, -9.35, 1.26, 1.5, .25);
    }
    return Object.fromEntries(Object.entries(kits).map(([name, kit]) => [name, kit.geometry()]));
  });
  built = { sections, wheel: buildWheel(), bellows: buildBellows(spec.accordions?.[0] ?? { min: .665, max: -1.513 }) };
  return built;
}

/** Triángulos de un bus completo, para vigilar el presupuesto desde las pruebas. */
export function busTriangleCount(spec) {
  const { sections, wheel, bellows } = busGeometry(spec);
  const tris = g => g ? g.index.count / 3 : 0;
  let total = tris(wheel) * spec.wheels.length + tris(bellows.geometry);
  for (const section of sections) for (const geometry of Object.values(section)) total += tris(geometry);
  return total;
}
