// src/world/bogota/streetLifePlaces.js
// Dónde quedan las pilas públicas, el hogar de paso y las entradas al transporte. Todo se calcula sobre el
// mismo plano de la ciudad y siempre da los mismos sitios, para que el jugador los aprenda.
// Solo se usa suelo de peatón (andén, plaza, prado, tierra) sin cajas sólidas encima.

const T = 2;
const SUELO_PEATON = new Set(['sidewalk', 'plaza', 'grass', 'dirt', 'floor']);

/** Paradas: el Portal del Centro y las dos estaciones del Metro, en el separador bajo el viaducto. */
export const TRANSIT_ANCHORS = [
  { id: 'portal', name: 'Portal del Centro', sistema: 'TransMilenio', x: 74, z: -8 },
  { id: 'metro72', name: 'Metro, Estación Calle 72', sistema: 'Metro', x: 75, z: 112 },
  { id: 'metro26', name: 'Metro, Estación Calle 26', sistema: 'Metro', x: 78, z: 205 },
];

/** ¿Cabe aquí una persona parada, con `radius` de holgura, sobre suelo de peatón? */
export function isFreeSpot(district, collisions, x, z, radius = .7, tiles = SUELO_PEATON) {
  const type = district.tileTypeAt?.(Math.round(x / T), Math.round(z / T));
  if (!type || !tiles.has(type)) return false;
  if (district.isWalkableAt && !district.isWalkableAt(x, z)) return false;
  if (district.getWaterInfo?.(x, z)?.depth > .05) return false;
  if (!collisions?.queryStatic) return true;
  const y = district.getGroundHeight?.(x, z) ?? 0;
  return !collisions.queryStatic(x - radius, z - radius, x + radius, z + radius, []).some(({ box, layered }) =>
    !(layered && (y > box.max.y || y + 1.8 < box.min.y))
    && x > box.min.x - radius && x < box.max.x + radius && z > box.min.z - radius && z < box.max.z + radius);
}

/** El punto libre más cercano a (x, z), buscando en anillos de medio metro. null si no hay ninguno. */
export function freeSpotNear(district, collisions, x, z, { maxR = 8, radius = .7, tiles = SUELO_PEATON } = {}) {
  if (isFreeSpot(district, collisions, x, z, radius, tiles)) return { x, z };
  for (let r = .5; r <= maxR; r += .5) {
    const steps = Math.max(8, Math.round(2 * Math.PI * r / .5));
    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      const px = +(x + Math.cos(a) * r).toFixed(2), pz = +(z + Math.sin(a) * r).toFixed(2);
      if (isFreeSpot(district, collisions, px, pz, radius, tiles)) return { x: px, z: pz };
    }
  }
  return null;
}

/**
 * Los sitios de la vida de calle: tres pilas (una por parque, en los primeros que tengan sitio), el hogar
 * de paso (un andén contra una fachada, lejos del cambuche y de lo reservado) y las paradas de transporte.
 */
export function streetLifePlaces(district, collisions, { parks = [], reserved = district.reserved ?? {} } = {}) {
  const lejos = (x, z, d) => Object.values(reserved).every((r) => Math.hypot(x - r.x, z - r.z) >= d);
  const pilas = [];
  for (const b of parks) {
    if (pilas.length >= 3) break;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const spot = freeSpotNear(district, collisions, cx, cz, { maxR: Math.max(4, Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2), radius: 1, tiles: new Set(['grass', 'plaza', 'dirt']) });
    if (spot && lejos(spot.x, spot.z, 5) && pilas.every((p) => Math.hypot(p.x - spot.x, p.z - spot.z) > 40)) pilas.push(spot);
  }

  // Hogar de paso: andén con edificio al lado, entre 45 y 110 m del cambuche, el más cercano al comedor.
  let hogar = null;
  const bed = reserved.bed, comedor = reserved.comedor ?? bed;
  if (bed && district.tileTypeAt) {
    const candidatos = [];
    for (let tz = 1; tz < (district.height ?? 0) - 1; tz++) {
      for (let tx = 1; tx < (district.width ?? 0) - 1; tx++) {
        if (district.tileTypeAt(tx, tz) !== 'sidewalk') continue;
        const x = tx * T, z = tz * T;
        const dBed = Math.hypot(x - bed.x, z - bed.z);
        if (dBed < 45 || dBed > 110 || !lejos(x, z, 10)) continue;
        const frente = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => district.tileTypeAt(tx + dx, tz + dz) === 'building');
        if (!frente) continue;
        candidatos.push({ x, z, frente, d: Math.hypot(x - comedor.x, z - comedor.z) });
      }
    }
    candidatos.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
    for (const c of candidatos) {
      // La puerta queda pegada a la fachada; quien entra se para un metro afuera.
      if (!isFreeSpot(district, collisions, c.x, c.z, .9)) continue;
      hogar = { x: c.x, z: c.z, rot: Math.atan2(c.frente[0], c.frente[1]) };
      break;
    }
  }

  const transit = TRANSIT_ANCHORS.flatMap((a) => {
    const spot = freeSpotNear(district, collisions, a.x, a.z, { maxR: 10 });
    return spot ? [{ ...a, ...spot }] : [];
  });
  return { pilas, hogar, transit };
}
