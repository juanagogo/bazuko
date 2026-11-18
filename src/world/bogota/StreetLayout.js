import { TILE_SIZE } from '../../utils/constants.js';

export const ORIGINAL_SIZE = 48;
export const ORIGINAL_CARRERAS = [[6, 7, 'Carrera 15'], [40, 41, 'Carrera 10']];
export const ORIGINAL_CARACAS = { lanes: [[22, 23], [26, 27]], busway: [24, 25] };
export const ORIGINAL_CALLES = [[12, 13, 'Calle 93'], [30, 31, 'Calle 82']];

export const SIDEWALK_TILES = 2;

// Insertar terreno conserva las manzanas y la escala de los objetos.
function axis(bands, sidewalkWidth = SIDEWALK_TILES) {
  const isRoad = i => bands.some(([a, b]) => i >= a && i <= b);
  const widths = Array.from({ length: ORIGINAL_SIZE }, (_, i) =>
    isRoad(i) ? 3 : isRoad(i - 1) || isRoad(i + 1) ? sidewalkWidth : 1);
  const starts = [];
  let size = 0;
  for (const width of widths) { starts.push(size); size += width; }
  const tile = value => {
    const i = Math.max(0, Math.min(ORIGINAL_SIZE - 1, Math.floor(value + 0.5)));
    return starts[i] - 0.5 + (value - i + 0.5) * widths[i];
  };
  const band = ([a, b, ...rest]) => [starts[a], starts[b] + widths[b] - 1, ...rest];
  const original = value => {
    let i = 0;
    while (i < widths.length - 1 && value >= starts[i] + widths[i] - 0.5) i++;
    return i - 0.5 + (value - starts[i] + 0.5) / widths[i];
  };
  return { widths, size, tile, band, original, world: value => tile(value) * TILE_SIZE };
}

const verticalBands = [...ORIGINAL_CARRERAS, ...ORIGINAL_CARACAS.lanes, ORIGINAL_CARACAS.busway];
export const STREET_X = axis(verticalBands);
export const STREET_Z = axis(ORIGINAL_CALLES);
const previousX = axis(verticalBands, 1), previousZ = axis(ORIGINAL_CALLES, 1);
export const CARRERAS = ORIGINAL_CARRERAS.map(STREET_X.band);
export const CALLES = ORIGINAL_CALLES.map(STREET_Z.band);
export const CARACAS = {
  lanes: ORIGINAL_CARACAS.lanes.map(STREET_X.band),
  busway: STREET_X.band(ORIGINAL_CARACAS.busway)
};
export const WORLD_LAYOUT_VERSION = 3;

export function expandStreets(map) {
  return map.flatMap((row, z) => {
    const expanded = row.flatMap((value, x) => Array(STREET_X.widths[x]).fill(value));
    return Array.from({ length: STREET_Z.widths[z] }, () => [...expanded]);
  });
}

export function migrateStreetPosition(position, version = 0) {
  // La ampliación v3 añade terreno sin desplazar las coordenadas de la v2.
  if (version >= 2) return [...position];
  const [x, y, z] = position;
  const tx = version === 1 ? previousX.original(x / TILE_SIZE) : x / TILE_SIZE;
  const tz = version === 1 ? previousZ.original(z / TILE_SIZE) : z / TILE_SIZE;
  return [STREET_X.world(tx), y, STREET_Z.world(tz)];
}
