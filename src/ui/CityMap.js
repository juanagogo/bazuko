// src/ui/CityMap.js
// Imagen del mapa de la ciudad a partir de los mismos tiles con los que se construye el
// distrito: calles, andenes, manzanas, parques, agua y la estación del norte. La comparten
// el radar y el mapa completo; se dibuja una sola vez al cargar la ciudad.
import { CITY_CALLES, CITY_CARRERAS, EXTENSION_PARKS } from '../world/bogota/CityLayout.js';
import { CARACAS, STREET_X, STREET_Z } from '../world/bogota/StreetLayout.js';
import { inTerminal } from '../world/bogota/TransitTerminal.js';
import { LAKE_PARK } from '../world/bogota/LakePark.js';

export const MAP_COLORS = {
  background: '#1b1e22',
  building: '#33373e',
  smallBuilding: '#3a3e46',
  storeD69: '#3a3e46',
  colpatria: '#4b4f5a',
  colpatriaAnnex: '#43474f',
  ruin: '#4a4038',
  wall: '#24272b',
  road: '#7b8087',
  busway: '#8c4a4a',
  sidewalk: '#5b6067',
  floor: '#666a70',
  plaza: '#8a8170',
  dirt: '#6b5a3e',
  grass: '#3f6b3b',
  water: '#3b78b0',
  terminal: '#6d7178',
  marking: 'rgba(235, 235, 220, .55)'
};

/** Qué es cada tipo de suelo, para la leyenda y la información al pasar el ratón. */
export const TILE_LABELS = {
  road: 'Calzada (cuidado con los carros)',
  busway: 'Carril exclusivo del TransMilenio',
  sidewalk: 'Andén',
  floor: 'Piso de concreto',
  plaza: 'Plaza o sendero',
  dirt: 'Tierra',
  grass: 'Zona verde',
  water: 'Agua · no transitable',
  building: 'Manzana con edificios · no transitable',
  smallBuilding: 'Edificio · no transitable',
  storeD69: 'Tienda D69 · no transitable',
  colpatria: 'Torre Colpatria · no transitable',
  colpatriaAnnex: 'Anexo de la Torre Colpatria · no transitable',
  ruin: 'Ruinas · no transitable',
  wall: 'Muro · no transitable',
  terminal: 'Portal del Centro'
};

/** Leyenda del mapa: colores en el mismo orden en que se explican. */
export const MAP_LEGEND = [
  ['road', 'Calle'], ['sidewalk', 'Andén'], ['busway', 'TransMilenio'], ['building', 'Edificios'],
  ['grass', 'Parque'], ['plaza', 'Plaza'], ['water', 'Agua'], ['ruin', 'Ruinas']
];

/** Zonas con nombre propio (metros del mundo). */
export const MAP_ZONES = [
  { name: 'Parque Tercer Milenio', x0: STREET_X.world(29.5), x1: STREET_X.world(37.5), z0: STREET_Z.world(33.5), z1: STREET_Z.world(44.5) },
  { name: 'El Cartucho', x0: STREET_X.world(8), x1: STREET_X.world(21), z0: STREET_Z.world(14), z1: STREET_Z.world(26) },
  ...EXTENSION_PARKS.map(p => ({ name: p.name, x0: p.x0 * 2, x1: p.x1 * 2, z0: p.z0 * 2, z1: p.z1 * 2 })),
  { name: 'Gasolinera', x0: 145, x1: 163, z0: 89, z1: 117 },
  { name: 'Tienda D69', x0: 44, x1: 52, z0: 160, z1: 172 },
  { name: LAKE_PARK.name, x0: -Infinity, x1: Infinity, z0: LAKE_PARK.z0, z1: LAKE_PARK.z1 }
];

/** Píxeles por metro de la imagen base; el radar y el mapa la escalan. */
export const MAP_SCALE = 3;

/**
 * Límites del mapa en metros y tipo de cada tile (incluida la estación, fuera de la grilla).
 * @param {{ map: string[][], isWalkableAt?: (x:number, z:number) => boolean }} district
 */
export function describeCity(district, tile = 2) {
  const map = district.map ?? [];
  const height = map.length, width = map[0]?.length ?? 0;
  const tz0 = Math.min(0, Math.floor(-74 / tile)); // la estación llega a Z −74
  const typeAt = (tx, tz) => {
    const type = map[tz]?.[tx];
    if (type) return type;
    const x = tx * tile, z = tz * tile;
    if (tz < 0 && inTerminal(x, z)) return district.isWalkableAt?.(x, z) === false ? null : 'terminal';
    return null;
  };
  return {
    tile, width, height, tx0: 0, tz0, tx1: width - 1, tz1: height - 1,
    bounds: { x0: -tile / 2, z0: tz0 * tile - tile / 2, x1: width * tile - tile / 2, z1: height * tile - tile / 2 },
    typeAt
  };
}

/** Bandas con nombre para rotular calles y ubicar al jugador. */
export function streetBands(tile = 2) {
  const bands = [];
  for (const [a, b, name] of CITY_CALLES) bands.push({ name, axis: 'z', from: a * tile - tile / 2, to: b * tile + tile / 2 });
  for (const [a, b, name] of CITY_CARRERAS) bands.push({ name, axis: 'x', from: a * tile - tile / 2, to: b * tile + tile / 2 });
  const caracas = [CARACAS.lanes[0][0], CARACAS.lanes[1][1]];
  bands.push({ name: 'Avenida Caracas', axis: 'x', from: caracas[0] * tile - tile / 2, to: caracas[1] * tile + tile / 2 });
  return bands;
}

/** Nombre de la calle bajo el jugador, o null en manzanas y parques. `margin` incluye el andén. */
export function streetNameAt(x, z, bands = streetBands(), margin = 0) {
  const names = bands.filter(b => {
    const v = b.axis === 'z' ? z : x;
    return v >= b.from - margin && v <= b.to + margin;
  }).map(b => b.name);
  return names.length ? names.join(' con ') : null;
}

/**
 * Describe un punto del mapa: zona con nombre, calle y tipo de suelo.
 * @returns {{ zone: string|null, street: string|null, ground: string|null, walkable: boolean }}
 */
export function describePlace(x, z, city, bands = streetBands(city?.tile)) {
  const tile = city?.tile ?? 2;
  const type = city?.typeAt(Math.round(x / tile), Math.round(z / tile)) ?? null;
  const zone = inTerminal(x, z) ? 'Portal del Centro'
    : MAP_ZONES.find(zone => x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1)?.name ?? null;
  const street = ['road', 'busway', 'sidewalk'].includes(type) || type === null
    ? streetNameAt(x, z, bands, type === 'sidewalk' ? 2 * tile + .5 : 0) : null;
  const ground = type ? TILE_LABELS[type] ?? 'Terreno' : null;
  return { zone, street, ground, walkable: !!type && !/no transitable/.test(ground ?? '') };
}

/**
 * Dibuja la ciudad en un canvas (x del mundo → derecha, z del mundo → abajo).
 * @returns {{ canvas: HTMLCanvasElement, bounds: object, scale: number, bands: object[] } | null}
 */
export function buildCityMap(district, { doc = globalThis.document, scale = MAP_SCALE } = {}) {
  const canvas = doc?.createElement?.('canvas');
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || !district?.map) return null;
  const city = describeCity(district);
  const { bounds, tile } = city;
  canvas.width = Math.ceil((bounds.x1 - bounds.x0) * scale);
  canvas.height = Math.ceil((bounds.z1 - bounds.z0) * scale);
  ctx.fillStyle = MAP_COLORS.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Agrupar por color evita miles de cambios de estilo.
  const groups = new Map();
  for (let tz = city.tz0; tz <= city.tz1; tz++) {
    for (let tx = city.tx0; tx <= city.tx1; tx++) {
      const type = city.typeAt(tx, tz);
      const color = type && (MAP_COLORS[type] ?? MAP_COLORS.floor);
      if (!color) continue;
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color).push(tx, tz);
    }
  }
  const px = x => (x - bounds.x0) * scale, pz = z => (z - bounds.z0) * scale;
  const size = tile * scale + .5; // medio píxel evita costuras entre tiles
  for (const [color, cells] of groups) {
    ctx.fillStyle = color;
    for (let i = 0; i < cells.length; i += 2) {
      ctx.fillRect(px(cells[i] * tile - tile / 2), pz(cells[i + 1] * tile - tile / 2), size, size);
    }
  }

  // Portal del Centro: carriles del bus a ambos lados de la isla peatonal (X 75, Z −50 a −10).
  if (bounds.z0 < -10) {
    ctx.fillStyle = MAP_COLORS.busway;
    ctx.fillRect(px(69.5), pz(-74), 3.5 * scale, 74 * scale);
    ctx.fillRect(px(77), pz(-74), 3.5 * scale, 74 * scale);
    ctx.fillStyle = MAP_COLORS.plaza;
    ctx.fillRect(px(73), pz(-50), 4 * scale, 40 * scale);
  }

  // Línea central discontinua en las calles con nombre, solo sobre asfalto.
  ctx.fillStyle = MAP_COLORS.marking;
  for (const band of streetBands(tile)) {
    const center = Math.round((band.from + band.to) / 2 / tile);
    const length = band.axis === 'z' ? city.width : city.tz1 + 1;
    for (let i = band.axis === 'z' ? 0 : city.tz0; i < length; i += 2) {
      const [tx, tz] = band.axis === 'z' ? [i, center] : [center, i];
      if (city.typeAt(tx, tz) !== 'road') continue;
      const x = px(tx * tile), z = pz(tz * tile);
      if (band.axis === 'z') ctx.fillRect(x - tile * scale * .35, z - .5, tile * scale * .7, 1);
      else ctx.fillRect(x - .5, z - tile * scale * .35, 1, tile * scale * .7);
    }
  }
  const bands = streetBands(tile);
  return { canvas, bounds, scale, bands, describe: (x, z) => describePlace(x, z, city, bands) };
}
