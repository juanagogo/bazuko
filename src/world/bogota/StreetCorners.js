import { TILE_SIZE as T } from '../../utils/constants.js';

const walkableEdge = new Set(['sidewalk', 'plaza']);

/** Una placa por intersección, junto al bordillo y más allá de la bajada de la cebra. */
export function planStreetSigns(map, intersections, hasRoom) {
  const tile = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];
  const signs = [];
  for (const cross of intersections) {
    const { x0, x1, z0, z1, band } = cross;
    for (const [x, z, sx, sz] of [[x0, z0, -1, -1], [x1, z0, 1, -1],
      [x1, z1, 1, 1], [x0, z1, -1, 1]]) {
      const setback = band + 1.5;
      const edges = [[x + sx * setback, z + sz * .7, 0, -sz],
        [x + sx * .7, z + sz * setback, -sx, 0]];
      const edge = edges.find(([px, pz, dx, dz]) =>
        walkableEdge.has(tile(px, pz)) && tile(px + dx * T, pz + dz * T) === 'road' && hasRoom(px, pz));
      if (!edge) continue;
      signs.push({ x: edge[0], z: edge[1], calle: cross.calle, carrera: cross.carrera });
      break;
    }
  }
  return signs;
}

/** Reserva el área que ocuparía un carro entero delante de un cruce o una cebra a mitad de cuadra. */
export function parkingExclusions(map, intersections, crossings) {
  const width = map[0].length, grid = new Uint8Array(width * map.length);
  function reserve(x0, z0, x1, z1) {
    const left = Math.max(0, Math.ceil(x0 / T)), right = Math.min(width - 1, Math.floor(x1 / T));
    for (let z = Math.max(0, Math.ceil(z0 / T)); z <= Math.min(map.length - 1, Math.floor(z1 / T)); z++) {
      grid.fill(1, z * width + left, z * width + right + 1);
    }
  }
  for (const { x0, x1, z0, z1 } of intersections) reserve(x0 - 2*T, z0 - 2*T, x1 + 2*T, z1 + 2*T);
  for (const { x, z, dx, dz, length, width: stripe } of crossings) {
    // La carrocería llega 2,7 m más allá del centro y el puesto se arrima 0,4 m al sardinel.
    const clearance = stripe / 2 + 3.1;
    const marginX = dz ? clearance : 1.6, marginZ = dx ? clearance : 1.6;
    reserve(x - marginX, z - marginZ, x + dx * length + marginX, z + dz * length + marginZ);
  }
  return grid;
}
