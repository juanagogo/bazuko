import { ALL_FACES } from './ZoneGeometry.js';
import { detailRect } from './ZoneTextures.js';
import { marketRect } from './MarketFinish.js';

const TAU = Math.PI * 2;
const ENAMEL = ['doorGreen', 'doorRed', 'doorBlue'];

function enamelSwatch(name) {
  const [u0, v0, u1, v1] = marketRect(name);
  const u = u1 - u0, v = v1 - v0;
  return [u0 + u * .28, v0 + v * .23, u0 + u * .42, v0 + v * .32];
}

/** Báscula mecánica apoyada en la punta de la mesa, frente al pasillo. */
export function addMarketScale(batch, material, dialMaterial, { x, z, front, stall }) {
  const f = batch.frame(4, 0), top = 1.01, depth = .9;
  const castIron = marketRect('iron'), steel = marketRect('sheetMetal');
  for (const dx of [-.108, .108]) for (const dz of [-.084, .084]) {
    f.box(material, x + dx, top, z + dz * depth, .057, .014, .056 * depth, castIron, ALL_FACES);
  }

  const point = (u, y, n) => [x + u * front, top + y, z + n * front * depth];
  const enclosure = enamelSwatch(ENAMEL[stall % ENAMEL.length]);
  const outline = (hx, hz, y, bevel) => [
    [-hx + bevel, hz], [hx - bevel, hz], [hx, hz - bevel], [hx, -hz + bevel],
    [hx - bevel, -hz], [-hx + bevel, -hz], [-hx, -hz + bevel], [-hx, hz - bevel],
  ].map(([u, n]) => point(u, y, n));
  const housing = [
    [.142, .118, .014, .022], [.147, .122, .031, .022], [.141, .115, .06, .024],
    [.115, .099, .143, .023], [.112, .094, .308, .032], [.092, .079, .376, .027],
    [.067, .063, .401, .021],
  ].map(profile => outline(...profile));
  for (let row = 0; row < housing.length - 1; row++) {
    const a = housing[row], b = housing[row + 1];
    for (let i = 0; i < a.length; i++) {
      const next = (i + 1) % a.length;
      batch.quad(material, a[i], a[next], b[next], b[i], row === 0 ? castIron : enclosure);
    }
  }
  const lid = housing.at(-1), [u0, v0, u1, v1] = enclosure;
  const trimUV = [u0, v0, u1, v0, (u0 + u1) / 2, v1];
  for (let i = 0; i < lid.length; i++) {
    batch.tri(material, lid[i], lid[(i + 1) % lid.length], point(0, .401, 0), trimUV);
  }

  // La carátula apunta al pasillo y mira ligeramente hacia arriba.
  const tilt = .14, cosTilt = Math.cos(tilt), sinTilt = Math.sin(tilt);
  const dial = (u, y, raise = 0) => point(u, .235 + y * cosTilt + raise * sinTilt,
    .103 - y * sinTilt + raise * cosTilt);
  const dialEdge = (q, k, raise) => dial(Math.sin(k) * q, Math.cos(k) * q, raise);
  const [du0, dv0, du1, dv1] = detailRect('whiteTrim');
  for (let i = 0; i < 20; i++) {
    const a = i * TAU / 20, b = (i + 1) * TAU / 20;
    batch.quad(material, dialEdge(.126, a, -.016), dialEdge(.126, a, .018),
      dialEdge(.126, b, .018), dialEdge(.126, b, -.016), castIron);
    batch.quad(material, dialEdge(.112, a, .025), dialEdge(.112, b, .025),
      dialEdge(.126, b, .018), dialEdge(.126, a, .018), steel);
    batch.tri(dialMaterial, dial(0, 0, .025), dialEdge(.112, b, .025), dialEdge(.112, a, .025),
      [(du0 + du1) / 2, (dv0 + dv1) / 2, du1, dv0, du0, dv1]);
  }
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * (-.66 + i * 1.32 / 12), major = i % 3 === 0;
    const spread = major ? .05 : .032, inner = major ? .082 : .09;
    batch.quad(material, dialEdge(inner, a - spread, .026), dialEdge(inner, a + spread, .026),
      dialEdge(.103, a + spread, .026), dialEdge(.103, a - spread, .026), 'iron');
  }
  const needle = -.47 + (stall % 3) * .11, sx = Math.sin(needle), sy = Math.cos(needle);
  const [nu0, nv0, nu1, nv1] = detailRect('terracotta');
  batch.tri(dialMaterial, dial(-sx * .02 - sy * .008, -sy * .02 + sx * .008, .028),
    dial(-sx * .02 + sy * .008, -sy * .02 - sx * .008, .028),
    dial(sx * .087, sy * .087, .028), [nu0, nv0, nu1, nv0, (nu0 + nu1) / 2, nv1]);
  batch.quad(material, dial(-.009, -.009, .029), dial(.009, -.009, .029),
    dial(.009, .009, .029), dial(-.009, .009, .029), 'iron');

  // La varilla central carga el platillo. Se modela el fondo interior por debajo del borde.
  const pan = [[.041, .398, depth], [.041, .435, .66], [.078, .442, .81], [.125, .454, .89],
    [.168, .494, .96], [.168, .507, .96], [.158, .509, .96], [.144, .485, .96], [.106, .461, .9], [.059, .453, .89], [0, .453, .89]];
  const ring = ([r, y, d], k) => [x + Math.sin(k) * r * front, top + y, z + Math.cos(k) * r * d * front];
  const [pu0, pv0, pu1, pv1] = steel;
  for (let row = 0; row < pan.length - 1; row++) {
    const lower = pan[row], upper = pan[row + 1], surface = row === 0 ? castIron : steel;
    for (let i = 0; i < 20; i++) {
      const a = i * TAU / 20, b = (i + 1) * TAU / 20;
      if (upper[0] > 0) batch.quad(material, ring(lower, a), ring(lower, b), ring(upper, b), ring(upper, a), surface);
      else batch.tri(material, ring(lower, a), ring(lower, b), point(0, upper[1], 0),
        [pu0, pv0, pu1, pv0, (pu0 + pu1) / 2, pv1]);
    }
  }
}
