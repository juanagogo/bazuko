import { EXTENSION_PARKS } from './CityLayout.js';
import { STREET_X, STREET_Z } from './StreetLayout.js';
import { LAKE_PARK, onLakeBridge } from './LakePark.js';
import { viaductSurface } from './ColpatriaViaduct.js';

export const URBAN_TREE_SPECIES = Object.freeze(['urapan', 'eucalipto', 'arrayan']);
export const URBAN_TREE_LIMITS = Object.freeze({ max: 90, spacing: 5.5, grassMargin: .8, canopyClearance: 3.1 });

function hash(x, z, salt = 0) {
  let value = Math.imul(x + 17, 73856093) ^ Math.imul(z + 31, 19349663) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}
const unit = seed => seed / 4294967296;

// Los jardines de la troncal no son parques: limitar el plan a los parques
// existentes impide convertir la franja bajo el viaducto en un bosque.
function regions(tileSize, width) {
  return [
    { x0: STREET_X.world(29), x1: STREET_X.world(38), z0: STREET_Z.world(33), z1: STREET_Z.world(45), limit: 10 },
    ...EXTENSION_PARKS.map(park => ({ x0: park.x0 * tileSize, x1: park.x1 * tileSize,
      z0: park.z0 * tileSize, z1: park.z1 * tileSize, limit: 9 })),
    { x0: tileSize, x1: (width - 2) * tileSize, z0: LAKE_PARK.z0, z1: LAKE_PARK.z1, limit: 62, lake: true }
  ];
}

function grassFootprint(map, tileSize, x, z) {
  const margin = URBAN_TREE_LIMITS.grassMargin;
  const x0 = Math.floor((x - margin) / tileSize + .5), x1 = Math.floor((x + margin) / tileSize + .5);
  const z0 = Math.floor((z - margin) / tileSize + .5), z1 = Math.floor((z + margin) / tileSize + .5);
  for (let row = z0; row <= z1; row++) for (let col = x0; col <= x1; col++) {
    if (map[row]?.[col] !== 'grass') return false;
  }
  return true;
}

function belowBridge(x, z) {
  const r = URBAN_TREE_LIMITS.canopyClearance;
  // Probar también alrededor de la copa evita que el tronco quede junto al
  // tablero pero las ramas atraviesen su borde, incluso en curvas.
  for (const dx of [-r, 0, r]) for (const dz of [-r, 0, r]) {
    if (onLakeBridge(x + dx, z + dz) || viaductSurface(x + dx, z + dz) !== null) return true;
  }
  return false;
}

/** Plan visual puro. isReserved(x,z,padding) recibe el margen del tronco; no añade colisiones. */
export function planUrbanTrees({ map, tileSize = 2, groundHeight = () => .06,
  getWaterInfo = () => null, isReserved = () => false } = {}) {
  if (!Array.isArray(map) || !map.length || !(tileSize > 0) || !Number.isFinite(tileSize)) return [];
  const result = [], spacing = URBAN_TREE_LIMITS.spacing, cells = new Map();
  const key = (x, z) => `${x},${z}`;
  const nearby = (x, z, distance) => {
    const reach = Math.ceil(distance / spacing), cx = Math.floor(x / spacing), cz = Math.floor(z / spacing);
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      for (const tree of cells.get(key(cx + dx, cz + dz)) ?? []) {
        if (Math.hypot(tree.x - x, tree.z - z) < distance) return true;
      }
    }
    return false;
  };

  for (const region of regions(tileSize, Math.max(...map.map(row => row.length)))) {
    const candidates = [];
    const x0 = Math.max(0, Math.ceil(region.x0 / tileSize)), x1 = Math.floor(region.x1 / tileSize);
    const z0 = Math.max(0, Math.ceil(region.z0 / tileSize)), z1 = Math.min(map.length - 1, Math.floor(region.z1 / tileSize));
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      if (map[tz]?.[tx] !== 'grass') continue;
      const seed = hash(tx, tz, 0x424f474f);
      const jitter = Math.min(.55, tileSize * .275);
      const x = tx * tileSize + (unit(hash(tx, tz, 101)) * 2 - 1) * jitter;
      const z = tz * tileSize + (unit(hash(tx, tz, 211)) * 2 - 1) * jitter;
      if (!grassFootprint(map, tileSize, x, z) || isReserved(x, z, URBAN_TREE_LIMITS.grassMargin) || belowBridge(x, z) || getWaterInfo(x, z)) continue;
      const y = groundHeight(x, z);
      if (!Number.isFinite(y) || y < -.1 || y > .6) continue;
      // Favorecer paseos sin plantarse sobre ellos; el resto mantiene claros
      // abiertos y una distribución irregular en vez de filas de vivero.
      let byPath = false;
      for (let dz = -3; dz <= 3 && !byPath; dz++) for (let dx = -3; dx <= 3; dx++) {
        if (map[tz + dz]?.[tx + dx] === 'plaza') { byPath = true; break; }
      }
      candidates.push({ x, y, z, seed, score: unit(seed) - (byPath ? .2 : 0) });
    }
    candidates.sort((a, b) => a.score - b.score || a.seed - b.seed);
    let count = 0;
    for (const candidate of candidates) {
      if (count >= region.limit || result.length >= URBAN_TREE_LIMITS.max) break;
      if (nearby(candidate.x, candidate.z, region.lake ? 10 : spacing)) continue;
      const { x, y, z, seed } = candidate;
      const tree = { x, y, z, seed, species: URBAN_TREE_SPECIES[seed % URBAN_TREE_SPECIES.length],
        scale: .88 + unit(hash(seed, 0, 307)) * .32, rotation: unit(hash(seed, 0, 419)) * Math.PI * 2 };
      result.push(tree); count++;
      const cell = key(Math.floor(x / spacing), Math.floor(z / spacing));
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push(tree);
    }
  }
  return result;
}
