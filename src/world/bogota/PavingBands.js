// Franjas del andén sin una textura por barrio: una máscara de un texel por metro con la distancia a la
// calzada, sacada del mapa de tiles, y con las zonas de andén viejo. El programa del andén la lee para pintar
// el adoquín de arcilla contra el sardinel y la guía táctil, y para dejar placa vieja donde no hubo obra.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { boxBlur } from './SunField.js';
import { SIDEWALK_TILES, STREET_X, STREET_Z } from './StreetLayout.js';
import { crossings } from './StreetMarkings.js';

const ROADWAY = new Set(['road', 'busway']);
const RAISED = new Set(['sidewalk', 'plaza', 'floor']);

/** Metros que guarda la máscara: de medio metro dentro de la calzada (0) a `BAND_REACH` andén adentro (255). */
export const BAND_REACH = 4, BAND_INSIDE = .5;

/** Acabado de cada material de andén: 0 queda como estaba (la Candelaria), 1 placa vieja, 2 renovado, 3 plaza o sendero con su propia losa. */
export const PAVING_KINDS = Object.freeze({
  sidewalk: 2, sidewalk_comercio: 2, sidewalk_lago: 2, sidewalk_chapinero: 2,
  sidewalk_cambuche: 1, plaza: 3, sidewalk_candelaria: 0, plaza_candelaria: 0,
});

/**
 * Donde el andén del centro sigue siendo placa vieja, en metros: El Cartucho (tiles 8–21 por 14–29 del trazado viejo).
 * Sale tres metros más allá de la manzana por cada lado: el borde difuminado cae en la calzada, que no lo dibuja,
 * y el andén de su contorno queda viejo hasta el sardinel, sin media franja de arcilla.
 */
export const OLD_PAVING_ZONES = Object.freeze([Object.freeze({
  x0: STREET_X.world(8) - 4, x1: STREET_X.world(21) + 4, z0: STREET_Z.world(14) - 4, z1: STREET_Z.world(29) + 4,
})]);

// Three sortea un identificador por cada textura. Esta nace mientras se arma la ciudad: con el azar del juego
// correría todo lo que se sortea después (basura, peatones y sus decisiones). El suyo sigue de una textura a otra.
let estado = 0x41de5a;
function sinGastarAzar(crear) {
  const delJuego = Math.random;
  Math.random = () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return crear(); } finally { Math.random = delJuego; }
}

function bandTexture(data, width, depth, name = 'Franjas del andén') {
  return sinGastarAzar(() => {
    const texture = new THREE.DataTexture(data, width, depth, THREE.RGFormat);
    texture.name = name;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    texture.userData = { width, depth };
    return texture;
  });
}

/**
 * Máscara RG8 de un texel por metro. R: distancia de cada punto a la calzada más cercana; el filtro lineal deja
 * rectas limpias a lo largo del sardinel y redondea las esquinas. G: cuánto hay de andén viejo, con el borde de
 * `oldZones` ({x0, x1, z0, z1} en metros) difuminado unos metros para que el programa lo rompa con ruido.
 */
export function buildPavingBands(map, { oldZones = OLD_PAVING_ZONES } = {}) {
  const T = TILE_SIZE, cols = map[0].length, rows = map.length, w = cols * T, d = rows * T;
  const roadway = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) roadway[j * cols + i] = ROADWAY.has(map[j][i]) ? 1 : 0;
  const data = new Uint8Array(w * d * 2), reach = Math.ceil(BAND_REACH / T) + 1, span = BAND_REACH + BAND_INSIDE;
  for (let z = 0; z < d; z++) {
    // Un texel `i` cubre desde i − T/2: los tiles se centran en múltiplos de T.
    const pz = z - T / 2 + .5, tz = Math.floor(z / T);
    const j0 = Math.max(0, tz - reach), j1 = Math.min(rows - 1, tz + reach);
    for (let x = 0; x < w; x++) {
      const px = x - T / 2 + .5, tx = Math.floor(x / T);
      let distance = BAND_REACH;
      if (roadway[tz * cols + tx]) distance = -BAND_INSIDE;
      else {
        const i0 = Math.max(0, tx - reach), i1 = Math.min(cols - 1, tx + reach);
        for (let j = j0; j <= j1; j++) {
          const dz = Math.max(Math.abs(pz - j * T) - T / 2, 0);
          if (dz >= distance) continue;
          for (let i = i0; i <= i1; i++) {
            if (!roadway[j * cols + i]) continue;
            const dx = Math.max(Math.abs(px - i * T) - T / 2, 0);
            // La mayor de las dos y no la diagonal: la guía dobla en ángulo recto en las esquinas, sin curva.
            if (dx < distance) distance = Math.min(distance, Math.max(dx, dz));
          }
        }
      }
      data[(z * w + x) * 2] = Math.round((distance + BAND_INSIDE) / span * 255);
    }
  }
  const old = new Float32Array(w * d);
  for (const { x0, x1, z0, z1 } of oldZones) {
    for (let z = Math.max(0, Math.ceil(z0 + T / 2 - .5)); z <= Math.min(d - 1, Math.floor(z1 + T / 2 - .5)); z++) {
      for (let x = Math.max(0, Math.ceil(x0 + T / 2 - .5)); x <= Math.min(w - 1, Math.floor(x1 + T / 2 - .5)); x++) old[z * w + x] = 1;
    }
  }
  const aged = boxBlur(old, w, d, 2);
  for (let i = 0; i < aged.length; i++) data[i * 2 + 1] = Math.round(Math.min(1, aged[i]) * 255);
  return bandTexture(data, w, d);
}

/** Texeles por metro de las marcas del andén: la rampa y el alcorque piden bordes más finos que las franjas. */
export const MARKS_PER_METER = 2;
/** Ancho de la loseta de botones detrás de la rampa y hasta dónde llega: de 30 cm a 1,55 m del sardinel. */
export const RAMP_FIELD = Object.freeze({ half: .9, from: .35, to: 1.55 });
export const GUIDE_DETOUR = .4;

/** Rampas al final de cada cebra, con la misma regla que las dibuja la calle: {x, z, dx, dz} hacia la calzada. */
export function curbRamps(map, list = crossings()) {
  const T = TILE_SIZE, band = SIDEWALK_TILES * T, tile = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)], out = [];
  const ramp = (x, z, dx, dz) => { if (RAISED.has(tile(x - dx, z - dz)) && ROADWAY.has(tile(x + dx, z + dz))) out.push({ x, z, dx, dz }); };
  for (const { x0, x1, z0, z1 } of list) {
    for (const z of [z0 - band / 2, z1 + band / 2]) { ramp(x0, z, 1, 0); ramp(x1, z, -1, 0); }
    for (const x of [x0 - band / 2, x1 + band / 2]) { ramp(x, z0, 0, 1); ramp(x, z1, 0, -1); }
  }
  return out;
}

/**
 * Marcas RG8 de `MARKS_PER_METER` texeles por metro. R: detrás de cada rampa, donde la arcilla se corta y va la
 * loseta de botones. G: cuánto se corre la guía junto a un alcorque (128 es nada; de −0,5 a 0,5 m).
 */
export function buildPavingMarks(map, { ramps = curbRamps(map) } = {}) {
  const T = TILE_SIZE, k = MARKS_PER_METER, w = map[0].length * T * k, d = map.length * T * k;
  const data = new Uint8Array(w * d * 2);
  for (let i = 1; i < data.length; i += 2) data[i] = 128;
  for (const { x, z, dx, dz } of ramps) {
    const reach = RAMP_FIELD.to + .5;
    for (let j = Math.max(0, Math.floor((z - reach + T / 2) * k)); j < Math.min(d, Math.ceil((z + reach + T / 2) * k)); j++) {
      for (let i = Math.max(0, Math.floor((x - reach + T / 2) * k)); i < Math.min(w, Math.ceil((x + reach + T / 2) * k)); i++) {
        const px = (i + .5) / k - T / 2, pz = (j + .5) / k - T / 2;
        const along = (px - x) * dz + (pz - z) * dx, into = (px - x) * dx + (pz - z) * dz;
        if (Math.abs(along) < RAMP_FIELD.half && into > -RAMP_FIELD.to && into < .3) data[(j * w + i) * 2] = 255;
      }
    }
  }
  return bandTexture(data, w, d, 'Marcas del andén');
}

const built = new WeakMap(), marked = new WeakMap();
let blank = null, blankMarks = null;

/** Las marcas de un mapa, una vez para todos sus andenes; sin mapa, ninguna. */
export function pavingMarksOf(map) {
  if (!map) return blankMarks ??= bandTexture(new Uint8Array([0, 128]), 1, 1, 'Marcas del andén');
  if (!marked.has(map)) marked.set(map, buildPavingMarks(map));
  return marked.get(map);
}

/**
 * La guía se corre 40 cm junto a cada alcorque que le queda a menos de 50 cm: hacia adentro si el árbol está del
 * lado de la calle, hacia la calle si está del lado de la fachada. `trees` son {x, z, half} en metros.
 */
export function markTreePits(map, trees) {
  const marks = pavingMarksOf(map), bands = pavingBandsOf(map);
  if (!map || !trees.length) return 0;
  const T = TILE_SIZE, k = MARKS_PER_METER, { width: w, height: d, data } = marks.image;
  const bw = bands.image.width, bh = bands.image.height, span = BAND_REACH + BAND_INSIDE;
  const value = (i, j) => bands.image.data[(Math.min(bh - 1, Math.max(0, j)) * bw + Math.min(bw - 1, Math.max(0, i))) * 2] / 255 * span - BAND_INSIDE;
  const distance = (x, z) => {
    const u = x + T / 2 - .5, v = z + T / 2 - .5, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    return (value(i, j) * (1 - a) + value(i + 1, j) * a) * (1 - b) + (value(i, j + 1) * (1 - a) + value(i + 1, j + 1) * a) * b;
  };
  let moved = 0;
  for (const { x, z, half } of trees) {
    const at = distance(x, z), near = at - half, far = at + half;
    const gap = Math.max(1.5 - far, near - 1.9);
    if (gap >= .5) continue;
    const shift = at < 1.7 ? Math.min(.5, Math.max(GUIDE_DETOUR, far + .1 - 1.5)) : -Math.min(.5, Math.max(GUIDE_DETOUR, 1.9 - near + .1));
    const reach = half + .5;
    for (let j = Math.max(0, Math.floor((z - reach + T / 2) * k)); j < Math.min(d, Math.ceil((z + reach + T / 2) * k)); j++) {
      for (let i = Math.max(0, Math.floor((x - reach + T / 2) * k)); i < Math.min(w, Math.ceil((x + reach + T / 2) * k)); i++) {
        data[(j * w + i) * 2 + 1] = Math.round(128 + shift * 254);
      }
    }
    moved++;
  }
  marks.needsUpdate = true;
  return moved;
}

/** La máscara de un mapa se calcula una vez y la comparten todos sus andenes; sin mapa, una sin calzada cerca. */
export function pavingBandsOf(map) {
  if (!map) return blank ??= bandTexture(new Uint8Array([255, 0]), 1, 1);
  if (!built.has(map)) built.set(map, buildPavingBands(map));
  return built.get(map);
}

/** Suelta la máscara de un mapa, una sola vez aunque la pidan todos sus andenes; si hace falta otra vez, se vuelve a calcular. */
export function releasePavingBands(map) {
  built.get(map)?.dispose();
  built.delete(map);
  marked.get(map)?.dispose();
  marked.delete(map);
}
