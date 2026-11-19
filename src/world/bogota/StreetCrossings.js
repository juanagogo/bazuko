import { TILE_SIZE as T } from '../../utils/constants.js';
import { CITY_CALLES, CITY_CARRERAS } from './CityLayout.js';
import { CARACAS, SIDEWALK_TILES } from './StreetLayout.js';
import { CANDELARIA_END_Z, CARRERA_5, EAST_LABELLED_CALLES, EAST_LABELLED_CARRERAS, NARROW_CALLES } from './EastZones.js';
import { inLakeTerrain, onLakeBridge } from './LakePark.js';

const ROAD = new Set(['road', 'busway']);
const LANDING = new Set(['sidewalk', 'plaza', 'floor']);
const AVENUE = [CARACAS.lanes[0][0], CARACAS.lanes[1][1], 'Av. Caracas'];
const tileAt = (map, x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];

// En el oriente la misma calle cambia de sección al atravesar la Carrera 5.
// El parque, las torres y la plaza también suprimen algunos brazos de la cuadrícula.
export function streetIntersections(map) {
  const intersections = [];
  for (const [xa, xb, carrera] of [...CITY_CARRERAS, AVENUE, ...EAST_LABELLED_CARRERAS]) {
    const east = xa > CARRERA_5[1];
    const calles = xa >= CARRERA_5[0] ? [...CITY_CALLES, ...EAST_LABELLED_CALLES] : CITY_CALLES;
    for (const street of calles) {
      const [a, b, calle] = street;
      const narrow = east && NARROW_CALLES.some(([first]) => first === a);
      const za = narrow ? a + 1 : a, zb = narrow ? b - 1 : b;
      const x0 = (xa - .5) * T, x1 = (xb + .5) * T, z0 = (za - .5) * T, z1 = (zb + .5) * T;
      if (map) {
        // Probar toda la sección: el eje de la Caracas puede ser un jardín bajo el viaducto.
        let horizontal = false, vertical = false;
        for (let z = za; z <= zb; z++) horizontal ||= ROAD.has(map[z]?.[xa - 1]) || ROAD.has(map[z]?.[xb + 1]);
        for (let x = xa; x <= xb; x++) vertical ||= ROAD.has(map[za - 1]?.[x]) || ROAD.has(map[zb + 1]?.[x]);
        if (!horizontal || !vertical) continue;
      }
      const band = (east ? (za < CANDELARIA_END_Z ? 1 : 3) : SIDEWALK_TILES) * T;
      intersections.push({ xa, xb, za, zb, x0, x1, z0, z1, calle, carrera, band,
        wide: xa === AVENUE[0], signal: !east && CITY_CALLES.includes(street) });
    }
  }
  return intersections;
}

/** Pasos de andén a andén, con origen, vector unitario, largo y ancho en metros. */
export function pedestrianCrossings(map, intersections = streetIntersections(map)) {
  const paths = [];
  function add(x, z, dx, dz, length, width, laneWidth) {
    const surface = step => tileAt(map, x + dx * step, z + dz * step);
    // El separador verde divide la avenida y el andén oriental llega un tile más lejos en la Candelaria.
    const landing = step => {
      const type = surface(step);
      return LANDING.has(type) || type === 'grass' || type === 'dirt';
    };
    let start = -1;
    for (let d = 0; d <= length; d += T) {
      const step = d + T / 2, px = x + dx * step, pz = z + dz * step;
      if (d < length && ROAD.has(surface(step)) && !inLakeTerrain(px, pz) && !onLakeBridge(px, pz)) {
        if (start < 0) start = d;
      } else if (start >= 0) {
        if (landing(start - T / 2) && landing(d + T / 2)) {
          paths.push({ x: x + dx * start, z: z + dz * start, dx, dz, length: d - start, width, laneWidth });
        }
        start = -1;
      }
    }
  }
  for (const { x0, x1, z0, z1, band, wide } of intersections) {
    const width = Math.min(3.6, band - .4);
    for (const z of [z0 - band / 2, z1 + band / 2]) add(x0, z, 1, 0, x1 - x0, width, wide ? 3.5 : (x1 - x0) / 2);
    for (const x of [x0 - band / 2, x1 + band / 2]) add(x, z0, 0, 1, z1 - z0, width, (z1 - z0) / 2);
  }
  // Los pasos a mitad de cuadra de la Caracas conectan con las filas 79 y 89 de la red peatonal.
  const left = (AVENUE[0] - .5) * T, length = (AVENUE[1] - AVENUE[0] + 1) * T;
  for (const row of [79, 89]) add(left, row * T, 1, 0, length, 1.6, 3.5);
  return paths;
}

const grids = new WeakMap();

/** El trazado de baldosas se completa antes de construir los peatones y el GPS. Ambos leen la misma rejilla. */
export function crossingTiles(map) {
  if (grids.has(map)) return grids.get(map);
  const cols = map[0].length, tiles = new Uint8Array(cols * map.length);
  for (const { x, z, dx, dz, length, width } of pedestrianCrossings(map)) {
    for (let step = T / 2; step < length; step += T) {
      const side = dx ? z : x, along = Math.round(((dx ? x : z) + step) / T);
      for (let tile = Math.ceil((side - width / 2) / T); tile <= Math.floor((side + width / 2) / T); tile++) {
        const tx = dx ? along : tile, tz = dz ? along : tile;
        if (ROAD.has(map[tz]?.[tx])) tiles[tz * cols + tx] = 1;
      }
    }
  }
  grids.set(map, tiles);
  return tiles;
}
