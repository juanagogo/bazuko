import * as THREE from 'three';
import { ALL_FACES, FACES, SKIN } from './ZoneGeometry.js';
import { DETAIL_CELLS, detailRect } from './ZoneTextures.js';
import { rng } from './textures.js';
import { withVisualRandom } from './VisualRandom.js';

// Reparto fijo de materiales. Cada mesa combina maderas y canastillas de uso corriente en las plazas de Bogotá.
export const MARKET_FINISHES = [
  { top: 'woodLight', leg: 'woodDark', crate: 'doorGreen', cloth: 'redStripe', bag: 'burlap' },
  { top: 'doorBrown', leg: 'sheetMetal', crate: 'doorBlue', cloth: 'greenTarp', bag: 'plywood' },
  { top: 'woodRed', leg: 'iron', crate: 'doorRed', cloth: 'blueStripe', bag: 'burlap' },
  { top: 'sheetMetal', leg: 'doorBrown', crate: 'doorGreen', cloth: 'blueTarp', bag: 'plywood' },
  { top: 'woodLight', leg: 'woodDark', crate: 'doorRed', cloth: 'orangeTarp', bag: 'burlap' },
  { top: 'doorBrown', leg: 'iron', crate: 'doorBlue', cloth: 'redStripe', bag: 'plywood' }
];

const CELL = 128, SIZE = 1024;

/** Rectángulo de la hoja de acabados. Las dos lonas a rayas comparten celda. */
export function marketRect(name, half = null) {
  const [u0, v0, u1, v1] = detailRect(name);
  const center = (u0 + u1) / 2;
  const splitPad = 3 / SIZE;
  return [half === 1 ? center + splitPad : u0, v0, half === 0 ? center - splitPad : u1, v1];
}

function speckles(ctx, w, h, random, count, dark, light) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = random() < .5 ? dark : light;
    ctx.fillRect(random() * w, random() * h, .75 + random() * 2, .65 + random() * 1.4);
  }
}

function cloth(ctx, w, h, seed, edge, fade, stripe = null) {
  const random = rng(seed), gradient = ctx.createLinearGradient(w * .18, 0, w * .76, h);
  gradient.addColorStop(0, edge);
  gradient.addColorStop(.5, fade);
  gradient.addColorStop(1, edge);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  if (stripe) {
    for (const x of [.075, .38, .695]) {
      ctx.fillStyle = stripe;
      ctx.fillRect(x * w, 0, w * .18, h);
      ctx.fillStyle = 'rgba(72,50,43,.20)';
      ctx.fillRect((x + .164) * w, 0, w * .014, h);
    }
  }
  // La cara se decolora de forma desigual entre los amarres. La trama queda por debajo de las manchas anchas.
  for (let i = 0; i < 9; i++) {
    const x = w * random(), y = h * random() * .56, run = h * (.21 + random() * .37);
    const width = w * (.035 + random() * .13), tilt = (random() - .5) * width;
    const dust = ctx.createLinearGradient(0, y, tilt + width * .4, y + run);
    dust.addColorStop(0, 'rgba(56,47,33,0)');
    dust.addColorStop(.46, `rgba(56,47,33,${.04 + random() * .09})`);
    dust.addColorStop(1, 'rgba(56,47,33,0)');
    ctx.fillStyle = dust;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + width, y + run * .32, x + width * .7 + tilt, y + run);
    ctx.quadraticCurveTo(x + width * .12 + tilt, y + run * .73, x, y);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(246,232,201,.037)';
  for (let y = 15; y < h - 10; y += 1.7 + random() * 3.1) ctx.fillRect(random() * 6, y, w * .91, .6);
  const seamY = 7;
  for (const y of [seamY, h - seamY]) {
    ctx.fillStyle = 'rgba(51,40,31,.19)';
    ctx.fillRect(0, y, w, 1.45);
    ctx.fillStyle = 'rgba(242,221,182,.19)';
    for (let x = 0; x < w; x += 3.2 + random() * 1.7) ctx.fillRect(x, y + 1.7, 1.6 + random() * .65, .8);
  }
  speckles(ctx, w, h, random, 220, 'rgba(26,21,16,.055)', 'rgba(231,219,188,.052)');
}

function grain(ctx, w, h, seed, base, edge) {
  const random = rng(seed), g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, edge);
  g.addColorStop(.35, base);
  g.addColorStop(.86, base);
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 55; i++) {
    const y = h * random(), x = w * random() * .4;
    ctx.strokeStyle = random() < .6 ? 'rgba(60,44,26,.22)' : 'rgba(236,212,161,.29)';
    ctx.lineWidth = .6 + random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(w * .36, y + random() * 5, w * .56, y - random() * 9, w, y + 1);
    ctx.stroke();
  }
  for (const px of [.12, .86]) {
    ctx.fillStyle = 'rgba(56,46,38,.57)';
    ctx.fillRect(px * w, h * .16, 2.4, 2.4);
    ctx.fillRect(px * w, h * .81, 2.4, 2.4);
  }
  speckles(ctx, w, h, random, 160, 'rgba(36,24,15,.17)', 'rgba(220,198,154,.21)');
}

function hardSurface(ctx, w, h, seed, paint, rubbed, steel = false) {
  const random = rng(seed), g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rubbed);
  g.addColorStop(.16, paint);
  g.addColorStop(.78, paint);
  g.addColorStop(1, rubbed);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < (steel ? 112 : 26); i++) {
    const x = random() * w, y = random() * h, length = (2 + random() * 22) * (steel ? 2 : 1);
    ctx.fillStyle = random() < .5 ? 'rgba(32,38,37,.20)' : 'rgba(235,234,217,.27)';
    ctx.fillRect(x, y, length, .45 + random() * 1.1);
  }
  speckles(ctx, w, h, random, 285, 'rgba(29,25,20,.14)', 'rgba(242,221,193,.17)');
}

function weave(ctx, w, h, seed, color, crossing, under, basket = false) {
  const random = rng(seed), gap = basket ? 8 : 3.2;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += gap) {
    ctx.fillStyle = under;
    ctx.fillRect(0, y, w, .81);
    for (let x = (Math.round(y / gap) % 2) * gap * .6; x < w; x += gap * 1.35) {
      ctx.fillStyle = crossing;
      ctx.fillRect(x, y + 1, gap, gap * .53);
    }
  }
  if (!basket) {
    ctx.fillStyle = 'rgba(67,50,33,.19)';
    ctx.fillRect(w * .227, 0, 2.8, h);
    ctx.fillStyle = 'rgba(237,219,172,.54)';
    for (let y = 0; y < h; y += 4.3) ctx.fillRect(w * .231, y, 1.5, 2.65);
  }
  speckles(ctx, w, h, random, 320, 'rgba(70,53,28,.20)', 'rgba(235,226,192,.26)');
}

function sackCloth(ctx, w, h, seed, color, stripe = null) {
  const random = rng(seed), dirt = ctx.createLinearGradient(w * .27, h * .14, w * .61, h);
  dirt.addColorStop(0, 'rgba(93,74,52,0)');
  dirt.addColorStop(.66, 'rgba(93,74,52,.09)');
  dirt.addColorStop(1, 'rgba(93,74,52,.21)');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  if (stripe) {
    ctx.fillStyle = stripe;
    ctx.fillRect(w * .61, 0, w * .081, h);
  }
  ctx.fillStyle = dirt;
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += .86 + random() * .51) {
    ctx.fillStyle = random() < .45 ? 'rgba(69,55,36,.069)' : 'rgba(248,236,207,.090)';
    ctx.fillRect(x, 0, .56, h);
  }
  for (let y = 1; y < h; y += 1.4 + random() * .47) {
    ctx.fillStyle = random() < .5 ? 'rgba(69,55,36,.055)' : 'rgba(248,236,207,.075)';
    ctx.fillRect(0, y, w, .54);
  }
  ctx.fillStyle = 'rgba(75,58,39,.22)';
  ctx.fillRect(w * .225, 0, 1.55, h);
  ctx.fillStyle = 'rgba(240,222,185,.32)';
  for (let y = 1; y < h; y += 4.4) ctx.fillRect(w * .229 + .5, y, 1.05, 2.3);
  speckles(ctx, w, h, random, 235, 'rgba(68,48,27,.065)', 'rgba(244,231,205,.082)');
}

function paintMarket(ctx) {
  const paint = (name, recipe, args, half = null) => {
    const { col, row } = DETAIL_CELLS[name], w = half === null ? CELL : CELL / 2, x = col * CELL + (half ?? 0) * w, y = row * CELL;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, CELL);
    ctx.clip();
    ctx.translate(x, y);
    recipe(ctx, w, CELL, ...args);
    ctx.restore();
  };
  paint('redStripe', cloth, [611, '#963e49', '#b45a51', '#ded0aa'], 0);
  paint('redStripe', cloth, [613, '#b6ad94', '#d1c3a7', '#8c5151'], 1);
  paint('greenTarp', cloth, [619, '#38605a', '#597971']);
  paint('blueStripe', cloth, [623, '#344f78', '#567ca1', '#d1cfc0']);
  paint('blueTarp', cloth, [631, '#2d5572', '#527e91']);
  paint('orangeTarp', cloth, [641, '#a05f3c', '#be8452']);
  paint('woodDark', grain, [701, '#634831', '#4a3628']);
  paint('woodLight', grain, [709, '#b19061', '#937144']);
  paint('woodRed', grain, [719, '#97634e', '#784c3b']);
  paint('doorBrown', grain, [727, '#7b8272', '#5e6657']);
  paint('doorGreen', hardSurface, [811, '#4a7755', '#689473']);
  paint('doorBlue', hardSurface, [821, '#405d85', '#6484a7']);
  paint('doorRed', hardSurface, [827, '#975448', '#b77561']);
  paint('iron', hardSurface, [829, '#3f4544', '#6d6860', true]);
  paint('sheetMetal', hardSurface, [839, '#7e8c89', '#a7aba1', true]);
  paint('burlap', weave, [907, '#9b7c54', '#b89b6d', '#775d3a']);
  paint('shopDark', sackCloth, [907, '#a88a5e']);
  paint('plywood', sackCloth, [911, '#c5c4ac', 'rgba(69,105,98,.32)'], 0);
  paint('plywood', sackCloth, [913, '#cac4ae', 'rgba(138,92,76,.32)'], 1);
  paint('halfTimber', weave, [919, '#957b52', '#b59664', '#6f5738', true]);
}

/** Separa las lonas y el mobiliario de avisos y carpinterías luminosos del barrio. */
export function createMarketFinish() {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  let map = null;
  if (canvas) {
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      paintMarket(ctx);
      map = withVisualRandom(() => new THREE.CanvasTexture(canvas));
      map.name = 'Lonas, guacales y muebles del mercado';
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
    }
  }
  return withVisualRandom(() => new THREE.MeshStandardMaterial({ name: 'Acabados de los puestos', map, roughness: .84 }));
}

export function marketTable(f, material, cx, cz, w, d, style) {
  const tableW = w - .5, tableD = d - 1, top = marketRect(style.top), leg = marketRect(style.leg);
  for (let i = 0; i < 4; i++) f.box(material, cx, .945, cz + (i - 1.5) * tableD / 4,
    tableW, .065, tableD / 4 - .005, top, ALL_FACES & ~FACES.bottom);
  for (const side of [-1, 1]) {
    const z = cz + side * (tableD / 2 - .035);
    f.box(material, cx, .853, z, tableW - .08, .094, .044, leg, ALL_FACES & ~FACES.top);
    f.box(material, cx, .438, z - side * .079, tableW - .31, .08, .055, leg, SKIN | FACES.back);
  }
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    const x = cx + dx * (w / 2 - .32), z = cz + dz * (d / 2 - .58);
    f.box(material, x, .12, z, .09, .8, .09, leg, ALL_FACES & ~FACES.bottom & ~FACES.top);
    f.box(material, x, .12, z, .095, .051, .095, marketRect('iron'), ALL_FACES & ~FACES.bottom);
  }
}

/** Guacal de listones o canastilla moldeada. Las cuatro caras conservan su hueco y apoyan el surtido a la misma cota. */
export function marketCrate(f, material, cx, y, cz, w, h, d, turn, top, plastic = null) {
  const c = Math.cos(turn), s = Math.sin(turn), at = (x, yy, z) => [cx + x * c + z * s, y + yy, cz - x * s + z * c];
  const outer = marketRect(plastic ?? 'woodLight'), cut = marketRect(plastic ?? 'woodDark');
  const slab = (x, yy, z, width, height, depth, tile = outer, faces = ALL_FACES & ~FACES.bottom) => {
    const a = x - width / 2, b = x + width / 2, l = z - depth / 2, r = z + depth / 2, topY = yy + height;
    if (faces & FACES.front) f.quad(material, at(a, yy, r), at(b, yy, r), at(b, topY, r), at(a, topY, r), tile);
    if (faces & FACES.back) f.quad(material, at(b, yy, l), at(a, yy, l), at(a, topY, l), at(b, topY, l), tile);
    if (faces & FACES.left) f.quad(material, at(a, yy, l), at(a, yy, r), at(a, topY, r), at(a, topY, l), tile);
    if (faces & FACES.right) f.quad(material, at(b, yy, r), at(b, yy, l), at(b, topY, l), at(b, topY, r), tile);
    if (faces & FACES.top) f.quad(material, at(a, topY, r), at(b, topY, r), at(b, topY, l), at(a, topY, l), tile);
  };
  const rim = plastic ? .018 : .027, lip = plastic ? .035 : h * .31;
  for (const side of [-1, 1]) {
    const x = side * (w - rim) / 2, z = side * (d - rim) / 2;
    for (const height of [0, h - lip]) {
      slab(0, height, z, w, lip, rim);
      slab(x, height, 0, rim, lip, d - rim * 2, cut);
    }
    const ribs = plastic ? [-.5, -.235, 0, .235, .5] : [-.5, .5];
    for (const cell of ribs) slab((w - rim) * cell, lip, z, rim, h - 2 * lip, rim, cut);
    for (const cell of [-.34, .34]) slab(x, lip, d * cell, rim, h - 2 * lip, rim, cut);
    // La canastilla tiene un puente de agarre más ancho en los testeros, sobre una luz libre.
    if (plastic) slab(x, h - lip - .022, 0, rim, .022, d * .53, outer, SKIN | FACES.back);
  }
  if (top) {
    const surface = top === 'woodDark' ? cut : top;
    f.quad(material, at(-w / 2, h - .03, d / 2), at(w / 2, h - .03, d / 2),
      at(w / 2, h - .03, -d / 2), at(-w / 2, h - .03, -d / 2), surface);
  }
}

function sackSurface(batch, material, fabric, stripe, profile, sides, sample, seamAngle = 0) {
  const positions = [], normals = [], uvs = [], indices = [];
  const [u0, v0, u1, v1] = fabric === 'burlap' ? marketRect('shopDark') : marketRect('plywood', stripe);
  const end = profile.length - 1;
  for (let j = 0; j <= end; j++) {
    for (let i = 0; i <= sides; i++) {
      const angle = (i % sides) / sides * Math.PI * 2 + seamAngle;
      positions.push(sample(angle, profile[j], j));
      uvs.push([u0 + (u1 - u0) * i / sides, v0 + (v1 - v0) * j / end]);
      if (j === end || i === sides) continue;
      const k = j * (sides + 1) + i, up = k + sides + 1;
      indices.push(k, k + 1, up + 1, k, up + 1, up);
    }
  }
  const around = (side, level) => positions[level * (sides + 1) + (side + sides) % sides];
  const tangent = new THREE.Vector3(), slope = new THREE.Vector3();
  for (let j = 0; j <= end; j++) for (let i = 0; i <= sides; i++) {
    const a = around(i - 1, j), b = around(i + 1, j), low = around(i, Math.max(0, j - 1)), high = around(i, Math.min(end, j + 1));
    tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    slope.set(high[0] - low[0], high[1] - low[1], high[2] - low[2]);
    normals.push(tangent.cross(slope).normalize().toArray());
  }
  batch.indexed(material, positions, normals, uvs, indices);
  return (ring, side) => positions[ring * (sides + 1) + side];
}

const creaseAt = (angle, center) => Math.pow(Math.max(0, Math.cos(angle - center)), 12);

function cordTail(batch, material, grain, origin, downFold) {
  const [x, y, z] = origin;
  const outward = new THREE.Vector2(downFold[0] - x, downFold[2] - z).normalize();
  const turn = [-outward.y, outward.x];
  const profile = [[0, 0, 0, .006], [.013, .006, .006, .011], [.028, .002, .01, .006],
    [.047, -.012, .006, .004], [.059, -.028, -.003, .0025]];
  const at = ([distance, drop, bend, radius], i) => {
    const angle = i * Math.PI / 3, across = bend - Math.sin(angle) * radius;
    return [x + outward.x * distance + turn[0] * across, y + drop + Math.cos(angle) * radius,
      z + outward.y * distance + turn[1] * across];
  };
  for (let j = 0; j < profile.length - 1; j++) for (let i = 0; i < 6; i++) {
    batch.quad(material, at(profile[j], i), at(profile[j + 1], i), at(profile[j + 1], i + 1), at(profile[j], i + 1), grain);
  }
}

/** Costal apoyado, con panza baja, hombros recogidos y el borde suelto sobre la cuerda. */
export function marketSack(batch, material, x, z, size, height, lean, turn, fabric, stripe = 0) {
  const profile = [
    [.56, 0], [.88, .06], [1, .29], [.93, .56], [.71, .78], [.36, .91],
    [.147, .978], [.151, .996], [.225, 1.055], [.13, 1.069], [.01, 1.036]
  ];
  const sides = 16, cosTurn = Math.cos(turn), sinTurn = Math.sin(turn);
  const corner = sackSurface(batch, material, fabric, stripe, profile, sides, (angle, [radius, rise], ring) => {
    const fold = ring >= 5 ? .19 : .033;
    const wave = 1 + fold * Math.cos(angle * (ring >= 5 ? 6 : 3) + ring * .39);
    const drape = Math.sin(Math.PI * Math.min(rise, 1)) * (.16 * creaseAt(angle, .65 + .34 * rise)
      + .14 * creaseAt(angle, 3.71 - .47 * rise) + .12 * creaseAt(angle, 5.48 + .23 * rise));
    const shape = radius * (wave - drape) * size * .54;
    const px = Math.sin(angle) * shape + lean * height * rise * rise, pz = Math.cos(angle) * shape * .82;
    const fray = ring > 7 && ring < profile.length - 1 ? .006 * Math.sin(angle * 3) : 0;
    return [x + px * cosTurn + pz * sinTurn, .12 + height * rise + fray, z - px * sinTurn + pz * cosTurn];
  });
  const knot = marketRect('woodDark');
  const cord = ([x, y, z], [tx, , tz]) => [x + (tx - x) * .025, y, z + (tz - z) * .025];
  for (let i = 0; i < sides; i++) {
    batch.quad(material, cord(corner(6, i), corner(5, i)), cord(corner(6, i + 1), corner(5, i + 1)),
      cord(corner(7, i + 1), corner(8, i + 1)), cord(corner(7, i), corner(8, i)), knot);
  }
  cordTail(batch, material, knot, corner(6, 1), corner(5, 1));
}

/** Bulto recostado: costado aplastado por el peso y boca doblada hacia abajo. */
export function marketSackOnSide(batch, material, x, y, z, length, height, depth, lean, turn, fabric, stripe = 0) {
  const profile = [
    [-.50, .08, .27, .286], [-.48, .46, .22, .37], [-.43, .73, .09, .62],
    [-.32, .91, .017, .873], [-.16, 1, 0, 1], [.06, .995, 0, .982],
    [.25, .89, .022, .89], [.355, .72, .09, .72], [.416, .47, .168, .43],
    [.467, .45, .135, .308], [.50, .37, .128, .245], [.493, .04, .174, .178]
  ];
  const cosTurn = Math.cos(turn), sinTurn = Math.sin(turn);
  const rounded = v => Math.sign(v) * Math.pow(Math.abs(v), .74);
  sackSurface(batch, material, fabric, stripe, profile, 16, (angle, [dist, breadth, low, high], ring) => {
    const wave = 1 + (ring >= 8 ? .12 : .039) * Math.cos(angle * 3 + ring * .71);
    const px = length * dist, pz = depth * breadth / 2 * rounded(Math.cos(angle)) * wave;
    const sa = Math.sin(angle), drape = .105 * Math.max(0, -sa) * Math.sin(Math.PI * (dist + .5))
      * (creaseAt(angle, 4.04 + dist * .63) + .75 * creaseAt(angle, 5.38 - dist * .48));
    const fill = low + (high - low) * ((1 - rounded(sa)) / 2 - drape);
    return [x + px * cosTurn + pz * sinTurn, y + px * lean + height * fill, z - px * sinTurn + pz * cosTurn];
  }, Math.PI);
}
