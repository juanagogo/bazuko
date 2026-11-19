import { rng } from './textures.js';

const STONE = [116, 116, 110];
const BED = [91, 90, 82];
const COURSE_COUNT = 14;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = value => Math.max(0, Math.min(value, 1));
const smooth = value => value * value * (3 - 2 * value);
const wrap = (value, size) => ((value % size) + size) % size;

// Retícula periódica. Deforma juntas y manchas con los mismos valores al repetir
// la textura en las UV de la calzada.
function field(gridSize, size, random) {
  const grid = Float32Array.from({ length: gridSize * gridSize }, () => random() - .5);
  const scale = gridSize / size;
  return (x, y) => {
    const tx = x * scale, ty = y * scale, ix = Math.floor(tx), iy = Math.floor(ty);
    const u = smooth(tx - ix), v = smooth(ty - iy);
    const right = (ix + 1) % gridSize, bottom = (iy + 1) % gridSize;
    return lerp(lerp(grid[iy * gridSize + ix], grid[iy * gridSize + right], u),
      lerp(grid[bottom * gridSize + ix], grid[bottom * gridSize + right], u), v);
  };
}

function divisions(length, count, random, variance) {
  const weights = Array.from({ length: count }, () => 1 + (random() * 2 - 1) * variance);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const limits = [0];
  for (const weight of weights) limits.push(limits.at(-1) + weight * length / total);
  limits[count] = length;
  return limits;
}

function interval(limits, value) {
  let a = 0, b = limits.length - 1;
  while (b - a > 1) {
    const mid = (a + b) >> 1;
    if (value < limits[mid]) b = mid;
    else a = mid;
  }
  return a;
}

function courses(size, scale, random) {
  return Array.from({ length: COURSE_COUNT }, () => {
    const count = 11 + Math.floor(random() * 7);
    const edges = divisions(size, count, random, .40);
    return {
      edges,
      offset: random() * size,
      stones: Array.from({ length: count }, (_, index) => ({
        // Unos sillares conservan los cortes rectos y otros cantos se han redondeado.
        radius: Math.min((4 + 21 * random() ** 2) * scale, (edges[index + 1] - edges[index]) * .22),
        inset: (1 + random() * .7) * scale,
        tone: (random() - .5) * 20,
        tint: (random() - .5) * 11,
        height: 31 + random() * 18,
        polish: 204 + random() * 35
      }))
    };
  });
}

function rgba(data, index, red, green, blue) {
  data[index] = red;
  data[index + 1] = green;
  data[index + 2] = blue;
  data[index + 3] = 255;
}

/** Tres mapas de la misma piedra, sin iluminación horneada. Los perfiles de canto
 * y los poros se conservan al pasar del sol al reflejo del adoquín mojado. */
export function paintCobblestoneMaps(size, color, height, roughness) {
  const random = rng(7741), scale = size / 1024;
  const rowEdges = divisions(size, COURSE_COUNT, random, .23);
  const rows = courses(size, scale, random);
  const warpX = field(9, size, random), warpY = field(11, size, random);
  const patina = field(5, size, random), minerals = field(72, size, random);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x + .5, v = y + .5;
      const rowV = wrap(v + warpY(u, v) * 25 * scale, size);
      const rowIndex = interval(rowEdges, rowV), row = rows[rowIndex];
      const stoneU = wrap(u + row.offset + warpX(u, v) * 29 * scale, size);
      const stoneIndex = interval(row.edges, stoneU), stone = row.stones[stoneIndex];
      const left = stoneU - row.edges[stoneIndex], right = row.edges[stoneIndex + 1] - stoneU;
      const top = rowV - rowEdges[rowIndex], bottom = rowEdges[rowIndex + 1] - rowV;
      const du = Math.min(left, right) - stone.inset, dv = Math.min(top, bottom) - stone.inset;
      const { radius } = stone;
      const edge = du < radius && dv < radius ? radius - Math.hypot(radius - du, radius - dv) : Math.min(du, dv);
      const coverage = smooth(clamp01(.5 + edge / (1.9 * scale)));
      const bevel = smooth(clamp01(edge / (13 * scale)));

      const dirt = patina(u, v), mineral = minerals(u, v), grit = random() - .5;
      const surface = dirt * 17 + mineral * 21 + grit * 8;
      const brightness = surface + stone.tone - (1 - bevel) * 5;
      const bedGrain = dirt * 16 + mineral * 13 + grit * 9;
      const red = lerp(BED[0] + bedGrain, STONE[0] + brightness + stone.tint, coverage);
      const green = lerp(BED[1] + bedGrain, STONE[1] + brightness, coverage);
      const blue = lerp(BED[2] + bedGrain, STONE[2] + brightness - stone.tint * .7, coverage);
      const crown = 4 * (1 - ((left - right) / (left + right)) ** 2) + 5 * (1 - ((top - bottom) / (top + bottom)) ** 2);
      const rise = 113 + bevel * (stone.height + crown) + mineral * 12 + grit * 4;
      const finish = lerp(247, stone.polish + mineral * 19 - dirt * 13, coverage * (.52 + bevel * .48));
      const i = (y * size + x) * 4;
      rgba(color, i, red, green, blue);
      rgba(height, i, rise, rise, rise);
      rgba(roughness, i, finish, finish, finish);
    }
  }
}
