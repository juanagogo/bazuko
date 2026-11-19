// Pie de los árboles: alcorque en el andén, tierra pisada y pasto alto en el prado, hojarasca alrededor.
// Todo se escribe en el lote de la calle que ya existe: no nace ninguna malla, material ni textura.
import { TILE_SIZE } from '../../utils/constants.js';
import { STATIC_CHUNK_SIZE } from './StaticGeometry.js';
import { hash2, tint, unit } from './StreetBatch.js';
import { inTerminal } from './TransitTerminal.js';
import { inGasStation } from './GasStation.js';
import { crossings } from './StreetMarkings.js';
import { SIDEWALK_TILES } from './StreetLayout.js';
import { markTreePits } from './PavingBands.js';

const T = TILE_SIZE;
const UP = [0, 1, 0];
const PAVED = new Set(['sidewalk', 'plaza', 'floor']);
const LITTER_GROUND = new Set(['sidewalk', 'plaza', 'floor', 'grass', 'dirt']);
const SALT = 0x7ee5;
// Solo tapias y ruinas: las fachadas tienen puertas y vitrinas que la maleza no debe tapar.
const WALLS = new Set(['ruin', 'wall']);
const ROADS = new Set(['road', 'busway']);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Radio del alcorque o del parche de tierra con sus piezas sueltas.
const FOOT_REACH = 1.4;

const EARTH = tint('#4a3d2e'), EARTH_DARK = tint('#33291f'), EARTH_DRY = tint('#6b5a44');
const TURF = tint('#3f4a2a');
const KERB = ['#a39d90', '#8f897c', '#b0aa9c'].map(c => tint(c));
// Hoja seca y pisada: café, gris verdoso y pardo, sin el amarillo de la hoja recién caída.
const LEAVES = ['#6b6250', '#584c3d', '#766b56', '#5a5a48', '#64503f', '#7a705e'].map(c => tint(c));
const WEEDS = ['#465a30', '#5a6d38', '#6d7a42', '#85814f'].map(c => tint(c));

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scaled = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

/** Azar propio de cada árbol: sale de su sitio y nunca toca Math.random. */
function ownRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Caja en planta de lo que un sector ya dibuja. */
function boundsOf(chunk) {
  const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }, p = chunk.p;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < box.x0) box.x0 = p[i];
    if (p[i] > box.x1) box.x1 = p[i];
    if (p[i + 2] < box.z0) box.z0 = p[i + 2];
    if (p[i + 2] > box.z1) box.z1 = p[i + 2];
  }
  return box;
}

const sectorOf = (box, nudge = 0) => `${Math.floor(((box.x0 + box.x1) / 2 + nudge) / STATIC_CHUNK_SIZE)},${Math.floor(((box.z0 + box.z1) / 2 + nudge) / STATIC_CHUNK_SIZE)}`;

/**
 * ¿Cabe esta caja en el sector? Sí, cuando ya la cubre o cuando al crecer su centro sigue en el mismo sector
 * de dibujo. Así cada malla del lote cae en el grupo de siempre y no nace ningún grupo nuevo.
 */
function take(state, x0, x1, z0, z1) {
  const box = state.box;
  if (x0 >= box.x0 && x1 <= box.x1 && z0 >= box.z0 && z1 <= box.z1) return true;
  const grown = { x0: Math.min(box.x0, x0), x1: Math.max(box.x1, x1), z0: Math.min(box.z0, z0), z1: Math.max(box.z1, z1) };
  if (sectorOf(grown, -.02) !== state.sector || sectorOf(grown, .02) !== state.sector) return false;
  state.box = grown;
  return true;
}

/** Sector del lote que ya dibuja algo, el propio o un vecino, donde cabe el pie del árbol. */
function homeChunk(street, states, x, z, reach) {
  const size = street.chunkSize, cx = Math.floor(x / size), cz = Math.floor(z / size);
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const chunk = street.chunks.get(`${cx + dx},${cz + dz}`);
    if (!chunk?.i.length) continue;
    let state = states.get(chunk);
    if (!state) {
      const box = boundsOf(chunk);
      states.set(chunk, state = { chunk, box, sector: sectorOf(box) });
    }
    if (take(state, x - reach, x + reach, z - reach, z + reach)) return state;
  }
  return null;
}

/** Mechón de hojas finas, como las matas del borde del pasto: dos triángulos por hoja, uno por cara. */
function tuft(into, r, x, y, z, height, blades, uv) {
  for (let b = 0; b < blades; b++) {
    const turn = r() * Math.PI * 2, c = Math.cos(turn), s = Math.sin(turn);
    const reach = r() * .07, wide = .014 + reach * .12, lean = .03 + r() * .1, top = height * (.65 + r() * .35);
    const px = x + c * reach, pz = z + s * reach;
    const tip = WEEDS[Math.min(3, Math.floor(r() * 3.35))], root = scaled(tip, .55);
    const left = [px - s * wide, y, pz + c * wide], right = [px + s * wide, y, pz - c * wide];
    const end = [px + c * lean, y + top, pz + s * lean], colors = [root, root, tip];
    into.triangle(left, right, end, UP, uv, colors);
    into.triangle(right, left, end, UP, uv, colors);
  }
}

/** Alcorque: tierra a ras, borde de concreto por piezas (alguna partida, corrida o caída) y maleza adentro. */
function pit(into, r, tree, y, half, UV) {
  const { x, z } = tree, side = half * 2;
  const corner = () => scaled(mix(EARTH, EARTH_DRY, r() * .7), .85 + r() * .25);
  into.decal(x, y + .014, z, side, side, 0, UV.plain, [corner(), corner(), corner(), corner()]);
  // Tierra húmeda y apisonada contra el tronco.
  into.decal(x + (r() - .5) * .1, y + .018, z + (r() - .5) * .1, half * 1.25, half * 1.25, Math.PI / 4 + (r() - .5) * .5,
    UV.plain, [EARTH_DARK, scaled(EARTH, .9), EARTH_DARK, scaled(EARTH, .8)]);
  const width = .11;
  for (let k = 0; k < 4; k++) {
    const angle = k * Math.PI / 2, c = Math.cos(angle), s = Math.sin(angle);
    // Centro del lado k y su eje a lo largo, en el mismo giro que usa `box`.
    const place = (along, out) => [x + along * c + (half + out) * s, z - along * s + (half + out) * c];
    const tone = () => scaled(KERB[Math.floor(r() * KERB.length)], .82 + r() * .22);
    const fate = r(), height = .05 + r() * .02;
    if (fate < .5) {
      const [px, pz] = place(0, 0);
      into.box(px, y, pz, side + width, height, width, angle, UV.concrete, tone());
    } else if (fate < .86) {
      // Partido en dos: una pieza se hunde y se corre unos centímetros.
      const cut = (r() - .5) * half * .7, gap = .03 + r() * .05, full = side + width;
      const first = full / 2 + cut - gap / 2, second = full - first - gap;
      const [ax, az] = place(-full / 2 + first / 2, 0), [bx, bz] = place(full / 2 - second / 2, (r() - .3) * .07);
      into.box(ax, y, az, first, height, width, angle, UV.concrete, tone());
      into.box(bx, y - .015, bz, second, height, width, angle + (r() - .5) * .16, UV.concrete, tone());
    } else {
      // Falta medio tramo: queda un trozo suelto, caído hacia afuera.
      const kept = (side + width) * (.4 + r() * .2), sign = r() < .5 ? -1 : 1;
      const [ax, az] = place(sign * ((side + width) / 2 - kept / 2), 0);
      into.box(ax, y, az, kept, height, width, angle, UV.concrete, tone());
      const [bx, bz] = place(-sign * half * (.3 + r() * .4), .12 + r() * .14);
      into.box(bx, y, bz, .2 + r() * .14, height * .7, width, angle + (r() - .5) * 1.4, UV.concrete, tone(), .6);
    }
  }
  // Maleza en las esquinas y contra el borde, donde nadie pisa.
  const weeds = 3 + Math.floor(r() * 3);
  for (let n = 0; n < weeds; n++) {
    const along = (r() - .5) * side * .86, inset = half - .1 - r() * r() * .3, face = Math.floor(r() * 4);
    const wx = face < 2 ? along : (face === 2 ? inset : -inset), wz = face < 2 ? (face === 0 ? inset : -inset) : along;
    tuft(into, r, x + wx, y + .014, z + wz, .12 + r() * .16, 4 + Math.floor(r() * 3), UV.plain);
  }
}

/** En el prado: un cuello de tierra que se funde con el césped y pasto alto pegado al tronco. */
function turfFoot(into, r, tree, trunk, tileAt, heightAt, UV) {
  const { x, z } = tree, points = 8, center = [x, heightAt(x, z) + .016, z], ring = [];
  for (let k = 0; k < points; k++) {
    // Hacia atrás en el ángulo: es el giro que deja la cara hacia arriba.
    const angle = -k / points * Math.PI * 2 + r() * .3, radius = trunk + .1 + r() * .22;
    const px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
    ring.push({ p: [px, heightAt(px, pz) + .012, pz], color: mix(scaled(EARTH, .9 + r() * .2), TURF, .5 + r() * .4),
      ok: tileAt(px, pz) === 'grass' });
  }
  if (ring.every(point => point.ok)) for (let k = 0; k < points; k++) {
    const a = ring[k], b = ring[(k + 1) % points];
    into.triangle(center, a.p, b.p, UP, UV.plain, [EARTH, a.color, b.color]);
  }
  const tufts = 6 + Math.floor(r() * 4);
  for (let n = 0; n < tufts; n++) {
    const angle = r() * Math.PI * 2, radius = trunk + .04 + r() * r() * .5;
    const px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
    const height = .16 + r() * .2, blades = 4 + Math.floor(r() * 3);
    if (tileAt(px, pz) !== 'grass') { for (let b = 0; b < blades * 5; b++) r(); continue; }
    tuft(into, r, px, heightAt(px, pz), pz, height, blades, UV.plain);
  }
}

/**
 * Hojarasca: hojas secas de punta aguda y base redonda, de 5 a 22 cm, más juntas cerca del tronco. Nunca más
 * claras que el piso donde caen: sobre tierra y prado, más oscuras todavía, para que de noche bajen con él.
 */
function litter(into, r, tree, trunk, scale, tileAt, heightAt, inWater, UV, half = 0) {
  const count = 26 + Math.floor(r() * 12), spread = 1.3 + 1.2 * scale;
  for (let n = 0; n < count; n++) {
    const angle = r() * Math.PI * 2, radius = trunk + .12 + r() ** 1.7 * spread;
    const px = tree.x + Math.cos(angle) * radius, pz = tree.z + Math.sin(angle) * radius;
    const turn = r() * Math.PI * 2, c = Math.cos(turn), s = Math.sin(turn);
    const length = .05 + r() ** 1.6 * .17, width = length * (.38 + r() * .24), lean = .85 + r() * .3;
    const ground = tileAt(px, pz), inPit = Math.max(Math.abs(px - tree.x), Math.abs(pz - tree.z)) < half;
    const soft = inPit || ground === 'grass' || ground === 'dirt';
    const tone = scaled(LEAVES[Math.floor(r() * LEAVES.length)], soft ? .28 + r() * .12 : .4 + r() * .18);
    const shoulder = r() * .15;
    if (!LITTER_GROUND.has(ground) || inWater(px, pz)) continue;
    const at = (a, b) => { const qx = px + a * c + b * s, qz = pz - a * s + b * c; return [qx, heightAt(qx, qz) + .022, qz]; };
    const outline = [at(length / 2, 0), at(length * (.05 + shoulder), width / 2 * lean), at(-length * .38, width * .26),
      at(-length * .42, -width * .22), at(length * (.03 + shoulder), -width / 2 * (2 - lean))];
    const heights = outline.map(p => p[1]);
    // A caballo del sardinel quedaría media hoja en el aire.
    if (Math.max(...heights) - Math.min(...heights) > .04) continue;
    const shade = [scaled(tone, 1.06), tone, scaled(tone, .84), scaled(tone, .8), scaled(tone, .94)];
    for (const [i, j, k] of [[0, 1, 4], [1, 2, 4], [2, 3, 4]]) {
      const [a, b, d] = [outline[i], outline[j], outline[k]];
      const up = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
      if (up >= 0) into.triangle(a, b, d, UP, UV.plain, [shade[i], shade[j], shade[k]]);
      else into.triangle(a, d, b, UP, UV.plain, [shade[i], shade[k], shade[j]]);
    }
  }
}

/** Rampas al final de cada cebra, donde las pone la calle: ahí el andén baja liso y no crece nada. */
function rampSpots() {
  const spots = [], band = SIDEWALK_TILES * T;
  for (const { x0, x1, z0, z1 } of crossings()) {
    for (const z of [z0 - band / 2, z1 + band / 2]) spots.push([x0, z, 1, 0], [x1, z, -1, 0]);
    for (const x of [x0 - band / 2, x1 + band / 2]) spots.push([x, z0, 0, 1], [x, z1, 0, -1]);
  }
  return spots;
}

const onRamp = (ramps, px, pz) => ramps.some(([x, z, dx, dz]) => {
  const along = (px - x) * dz + (pz - z) * dx, into = (px - x) * dx + (pz - z) * dz;
  return Math.abs(along) < 1.3 && into > -1.6 && into < 1;
});

/**
 * Maleza del andén: al pie de tapias y ruinas y detrás del sardinel, por tramos. Hay cuadras barridas y cuadras
 * dejadas; nunca junto a los sitios del juego, los puestos, la terminal ni la bomba.
 */
function addJointWeeds(street, district, UV, states) {
  const map = district.map, vendors = district.vendors ?? [], rooms = district._roomBoxes ?? [], ramps = rampSpots();
  let tufts = 0;
  for (let tz = 0; tz < map.length; tz++) for (let tx = 0; tx < map[0].length; tx++) {
    if (map[tz][tx] !== 'sidewalk') continue;
    const x = tx * T, z = tz * T;
    if (inTerminal(x, z) || inGasStation(x, z) || district.isNearReserved?.(x, z)) continue;
    // Tramos de unos 16 m: uno de cada tres está dejado y allí la maleza se junta.
    const neglect = unit(tx >> 3, tz >> 3, SALT + 1) < .34 ? .3 : .06;
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d], other = map[tz + dz]?.[tx + dx], wall = WALLS.has(other);
      if (!wall && !ROADS.has(other)) continue;
      if (unit(tx, tz, SALT + 10 + d) > neglect * (wall ? 1 : .55)) continue;
      const r = ownRandom(hash2(tx, tz, SALT + 20 + d));
      const inset = wall ? .13 + r() * .08 : .22 + r() * .1, along = (r() - .5) * T * .9;
      const px = x + dx * (T / 2 - inset) + dz * along, pz = z + dz * (T / 2 - inset) + dx * along;
      if (vendors.some(({ position: p }) => Math.hypot(px - p.x, pz - p.z) < 2.6)) continue;
      if (onRamp(ramps, px, pz)) continue;
      if (rooms.some(box => px > box.min.x - .4 && px < box.max.x + .4 && pz > box.min.z - .4 && pz < box.max.z + .4)) continue;
      const home = homeChunk(street, states, px, pz, .22);
      if (!home) continue;
      const into = Object.create(street);
      into._chunk = () => home.chunk;
      tuft(into, r, px, (district.getGroundHeight?.(px, pz) ?? .12) + .002, pz, .09 + r() * .13, 3 + Math.floor(r() * 3), UV.plain);
      tufts++;
    }
  }
  return tufts;
}

/**
 * Viste el pie de cada árbol de `district.treePlan` dentro del lote de la calle.
 * Devuelve cuántos árboles quedaron con pie; los que no caben en un sector que ya dibuje algo se dejan como están.
 */
export function addTreeFeet(street, district, UV) {
  const map = district.map, trees = district.treePlan ?? [];
  if (!map || !UV?.plain) return 0;
  const tileAt = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];
  const heightAt = (x, z) => district.getGroundHeight?.(x, z) ?? 0;
  const inWater = (x, z) => !!district.getWaterInfo?.(x, z);
  let dressed = 0;
  const states = new Map();
  for (const tree of trees) {
    const scale = tree.scale ?? 1, trunk = .24 * scale, ground = tileAt(tree.x, tree.z), half = Math.min(.92, .45 + .22 * scale);
    // Pegado al borde de su sector, el árbol se queda con el alcorque y la hojarasca que quepa en él.
    const home = homeChunk(street, states, tree.x, tree.z, FOOT_REACH) ?? homeChunk(street, states, tree.x, tree.z, half + .12);
    if (!home) continue;
    const fits = (...points) => take(home, Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0])),
      Math.min(...points.map(p => p[2])), Math.max(...points.map(p => p[2])));
    // Todas las piezas de un árbol van al mismo sector; la hoja que lo sacaría de su sitio no se pone.
    const into = Object.create(street);
    into._chunk = () => home.chunk;
    into.quad = (a, b, c, d, ...rest) => { if (fits(a, b, c, d)) street.quad.call(into, a, b, c, d, ...rest); };
    into.triangle = (a, b, c, ...rest) => { if (fits(a, b, c)) street.triangle.call(into, a, b, c, ...rest); };
    const r = ownRandom(hash2(Math.round(tree.x * 10), Math.round(tree.z * 10), SALT));
    if (PAVED.has(ground)) pit(into, r, tree, heightAt(tree.x, tree.z), half, UV);
    else if (ground === 'grass' && !inWater(tree.x, tree.z)) turfFoot(into, r, tree, trunk, tileAt, heightAt, UV);
    litter(into, r, tree, trunk, scale, tileAt, heightAt, inWater, UV, PAVED.has(ground) ? half : 0);
    dressed++;
  }
  // La guía táctil del andén se aparta de los alcorques.
  const pits = trees.filter(tree => PAVED.has(tileAt(tree.x, tree.z))).map(tree => ({ x: tree.x, z: tree.z, half: Math.min(.92, .45 + .22 * (tree.scale ?? 1)) }));
  district.treeFeet = { dressed, weeds: addJointWeeds(street, district, UV, states), guideDetours: markTreePits(map, pits) };
  return dressed;
}
