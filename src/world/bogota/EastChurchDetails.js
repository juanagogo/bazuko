import { CHURCH_STEPS } from './EastZones.js';
import { ALL_FACES, FACES, NO_BACK, SKIN, wallStripUV } from './ZoneGeometry.js';
import { detailRect } from './ZoneTextures.js';

const stoneUV = (w, h) => [.07, 0, .07 + w / 6, h / 6];
const STONE = 'stoneLight';

const arc = ({ u, y, span, rise }, angle, n, offset = 0) => [
  u + (span + offset) * Math.cos(angle), y + (rise + offset) * Math.sin(angle), n
];

function vaultPanel(f, m, opening, n, texture) {
  const { u, y, bottom, span } = opening;
  f.panel(m.detail, u, bottom, n, span * 2, y - bottom, texture);
  const [s0, t0, s1, t1] = detailRect(texture), middle = (s0 + s1) / 2;
  const uv = t => [middle + (s1 - s0) / 2 * Math.cos(t), t0 + (t1 - t0) * Math.sin(t)];
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
    f.tri(m.detail, [u, y, n], arc(opening, a, n), arc(opening, b, n), [middle, t0, ...uv(a), ...uv(b)]);
  }
}

/** Dovelas perfiladas, con la cara interior visible cuando se mira el arco de lado. */
function stoneArch(f, m, opening, n, lip, { depth = .09, surround = STONE, fillTo = null } = {}) {
  const count = 13;
  const crown = n + depth;
  for (let i = 0; i < count; i++) {
    const a = i * Math.PI / count, b = (i + 1) * Math.PI / count;
    const p = a + .008, q = b - .008, extra = i === 6 ? lip * .14 : 0;
    const ia = arc(opening, p, crown), ib = arc(opening, q, crown);
    const oa = arc(opening, p, crown, lip + extra), ob = arc(opening, q, crown, lip + extra);
    // Cama continua de mortero detrás de las juntas de las dovelas.
    f.quad(m.detail, arc(opening, a, crown - .015, lip), arc(opening, b, crown - .015, lip),
      arc(opening, b, crown - .015), arc(opening, a, crown - .015), 'stoneGray');
    f.quad(m.detail, oa, ob, ib, ia, surround);
    f.quad(m.detail, ia, ib, arc(opening, q, n), arc(opening, p, n), 'stoneGray');
    f.quad(m.detail, ob, oa, arc(opening, p, n, lip + extra), arc(opening, q, n, lip + extra), surround);
    if (fillTo !== null) {
      const start = arc(opening, a, n, lip - .01), end = arc(opening, b, n, lip - .01);
      f.quad(m.detail, end, start, [start[0], fillTo, n], [end[0], fillTo, n], surround);
    }
  }
}

function stoneJambs(f, m, { u, span, y, bottom }, n, lip) {
  for (const sign of [-1, 1]) {
    f.box(m.detail, u + sign * (span + lip / 2), bottom, n, lip, y - bottom, .15, STONE, NO_BACK);
    f.box(m.detail, u + sign * (span + lip / 2), y - .107, n + .025, lip + .13, .127, .2, STONE, NO_BACK);
  }
}

/** Ventana colonial cerrada, con luz proveniente del atlas nocturno del distrito. */
export function churchWindow(f, m, { u, bottom, width, height, n, texture = 'glassCurtain' }) {
  const opening = { u, bottom, y: bottom + height - width * .56, span: width / 2, rise: width * .56 };
  vaultPanel(f, m, opening, n + .028, texture);
  stoneJambs(f, m, opening, n + .06, .123);
  stoneArch(f, m, opening, n + .048, .123, { depth: .075 });
  f.box(m.detail, u, bottom - .135, n + .072, width + .38, .135, .276, STONE, NO_BACK);
  f.box(m.detail, u, bottom + .015, n + .049, .052, height - .084, .057, 'woodDark', SKIN);
  f.box(m.detail, u, opening.y - .042, n + .045, width, .064, .041, 'woodDark', SKIN);
}

export function churchBelfryArches(batch, f, m, { sx, u, n, w, y, top }) {
  const half = w / 2, back = -5, depth = n - back;
  const cx = -sx / 2 - (n + back) / 2;
  const faces = [
    [f, u, n, w],
    [batch.frame(0, -sx / 2 - back), -u, 0, w],
    [batch.frame(4, u + half), cx, 0, depth],
    [batch.frame(5, half - u), -cx, 0, depth]
  ];
  for (const [wall, center, outside, span] of faces) {
    const opening = { u: center, y: y + 2.53, span: span / 2 - 1.03, rise: 1.57 };
    stoneArch(wall, m, opening, outside - .012, .32, { fillTo: top + .025 });
  }
}

function pilaster(f, m, u, bottom, top, n) {
  f.box(m.detail, u, bottom, n, .72, .3, .25, 'stoneGray', NO_BACK);
  f.box(m.detail, u, bottom + .3, n + .025, .61, .17, .276, STONE, NO_BACK);
  f.box(m.detail, u, bottom + .47, n, .46, top - bottom - .83, .25, STONE, NO_BACK);
  f.box(m.detail, u, top - .365, n + .024, .55, .15, .27, STONE, NO_BACK);
  f.box(m.detail, u, top - .215, n + .037, .67, .215, .289, STONE, NO_BACK);
}

function oculus(f, m, y, radius, n, texture) {
  const [s0, t0, s1, t1] = detailRect(texture);
  const s = (s0 + s1) / 2, t = (t0 + t1) / 2;
  const opening = { u: 0, y, span: radius, rise: radius };
  const uv = a => [s + (s1 - s0) / 2 * Math.cos(a), t + (t1 - t0) / 2 * Math.sin(a)];
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
    f.tri(m.detail, [0, y, n], arc(opening, a, n), arc(opening, b, n), [s, t, ...uv(a), ...uv(b)]);
    f.quad(m.detail, arc(opening, a, n + .11, .19), arc(opening, b, n + .11, .19),
      arc(opening, b, n + .045), arc(opening, a, n + .045), STONE);
  }
  f.box(m.detail, 0, y - radius, n + .028, .064, radius * 2, .076, 'iron', SKIN);
  f.box(m.detail, 0, y - .032, n + .025, radius * 2, .064, .076, 'iron', SKIN);
}

export function churchPortal(f, m, width, peak) {
  const bottom = CHURCH_STEPS.at(-1).top, opening = { u: 0, bottom, y: 4.15, span: 1.38, rise: 1.08 };
  const sillY = bottom + .014;
  f.box(m.ashlar, 0, bottom, .31, 5.72, 6.05 - bottom, .62, stoneUV, NO_BACK);
  f.box(m.detail, 0, bottom, .57, 3.45, 5.1 - bottom, .24, 'stoneGray', NO_BACK);
  const doorH = opening.y - sillY;
  f.panel(m.detail, 0, sillY, .754, opening.span * 2, doorH, 'doorBrown');
  vaultPanel(f, m, { ...opening, bottom: opening.y - .025 }, .744, 'woodDark');
  stoneJambs(f, m, opening, .82, .253);
  stoneArch(f, m, opening, .787, .253, { depth: .132 });
  f.box(m.detail, 0, opening.y - .054, .752, 2.77, .078, .087, 'woodLight', SKIN);
  for (const side of [-1, 1]) {
    const u = side * 2.33;
    pilaster(f, m, u, bottom, 6.16, .703);
    f.box(m.detail, side * 3.16, bottom, .189, .31, 8.49, .37, STONE, NO_BACK);
    for (const x of [.26, .97]) for (let stud = 0; stud < 6; stud++) {
      f.box(m.detail, side * x, sillY + .27 + stud * .59, .766, .049, .049, .034, 'iron', NO_BACK);
    }
  }
  f.box(m.detail, 0, 6.16, .523, 5.62, .21, .64, 'stoneGray', NO_BACK);
  f.box(m.detail, 0, 6.37, .553, 6.7, .24, .69, STONE, NO_BACK);
  f.box(m.detail, 0, 6.61, .531, 6.8, .091, .73, STONE, NO_BACK);
  oculus(f, m, 8.02, .83, .044, 'glassCurtain');

  const base = 9.63, w = width / 2, n = .221;
  f.box(m.detail, 0, 9.29, .275, width + .18, .34, .58, STONE, NO_BACK);
  f.box(m.detail, 0, 9.57, .3, width + .32, .09, .615, 'stoneGray', NO_BACK);
  const [s0, t0, s1, t1] = wallStripUV(0, .3, width, 4.8, 1.2);
  f.tri(m.wall, [-w, base, .015], [w, base, .015], [0, peak, .015], [s0, t0, s1, t0, (s0 + s1) / 2, t1]);
  f.quad(m.detail, [-w, base, n], [0, peak - .27, n], [0, peak, n], [-w, base + .27, n], STONE);
  f.quad(m.detail, [0, peak - .27, n], [w, base, n], [w, base + .27, n], [0, peak, n], STONE);
}

export function churchPlinth(f, m, width, n = 0, u = 0) {
  f.box(m.ashlar, u, 0, n + .011, width, 1.03, .12, stoneUV, NO_BACK);
  f.box(m.detail, u, 1.03, n + .032, width, .101, .134, STONE, NO_BACK);
}

export function churchSide(f, m, width) {
  churchPlinth(f, m, width);
  for (let i = 0; i < 4; i++) {
    const u = -width / 2 + width * (i + .5) / 4;
    churchWindow(f, m, { u: u + .44, bottom: 5.44, width: 1.57, height: 3.7, n: .02 });
    // El contrafuerte se escalona hacia arriba y el remate vierte el agua hacia la calle.
    const pier = u - width / 8 + .53;
    f.box(m.ashlar, pier, 0, .331, .98, 2.34, .662, stoneUV, NO_BACK);
    f.box(m.detail, pier, 2.34, .337, 1.04, .15, .71, STONE, NO_BACK);
    f.box(m.ashlar, pier, 2.49, .238, .79, 4.18, .476, stoneUV, NO_BACK);
    f.box(m.detail, pier, 6.67, .255, .86, .105, .527, STONE, NO_BACK);
    f.box(m.ashlar, pier, 6.775, .169, .68, 1.53, .338, stoneUV, NO_BACK);
    f.quad(m.detail, [pier - .34, 8.305, .351], [pier + .34, 8.305, .351],
      [pier + .34, 8.625, .03], [pier - .34, 8.625, .03], STONE);
  }
  churchCornice(f, m, width);
}

function churchCornice(f, m, width) {
  f.box(m.detail, 0, 11.76, .026, width, .21, .155, 'stoneGray', NO_BACK);
  f.box(m.detail, 0, 11.97, .038, width + .07, .162, .207, STONE, NO_BACK);
}

export function churchRear(f, m, width) {
  churchPlinth(f, m, width);
  churchCornice(f, m, width);
  for (const u of [-4.9, 4.9]) churchWindow(f, m, { u, bottom: 5.36, width: 1.4, height: 3.57, n: .021 });
  // El testero conserva el paño de cal y marca el eje de la nave con una arcada ciega sobre el basamento.
  const niche = { u: 0, bottom: 1.52, y: 7.68, span: 1.84, rise: 1.74 };
  vaultPanel(f, m, niche, .022, 'plasterCream');
  stoneJambs(f, m, niche, .044, .175);
  stoneArch(f, m, niche, .037, .175, { depth: .068 });
  oculus(f, m, 7.13, .72, .044, 'glassSky');
  for (const side of [-1, 1]) {
    const edge = side * (width / 2 - .04);
    for (let i = 0; i < 24; i++) {
      const w = i % 2 ? .51 : .78, u = edge - side * w / 2;
      f.box(m.detail, u, 1.13 + i * .443, .018, w, .425, .064, i % 3 ? STONE : 'stoneGray', NO_BACK);
    }
  }
}

export function churchAtrium(f, m, width) {
  CHURCH_STEPS.forEach(({ depth, inset, top }, i) => {
    const bottom = i ? CHURCH_STEPS[i - 1].top : .12;
    const span = width - inset * 2, run = depth - .112, n = .1 + run / 2;
    f.box(m.ashlar, 0, bottom, n, span, top - bottom, run, stoneUV, ALL_FACES & ~FACES.bottom);
    f.box(m.detail, 0, top - .048, depth - .006, span, .048, .012, STONE, FACES.front | FACES.left | FACES.right | FACES.top);
  });
}
