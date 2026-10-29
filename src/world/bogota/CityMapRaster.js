// src/world/bogota/CityMapRaster.js
// Plano 2D de la ciudad para el radar y el mapa grande; se pinta una vez desde los tiles.
import { bridgeCenter } from './Colpatria.js';
import { VIADUCT } from './ColpatriaViaduct.js';
import { TERMINAL } from './TransitTerminal.js';
import { CITY_CARRERAS, CITY_CALLES, EXTENSION_PARKS } from './CityLayout.js';
import { CARACAS } from './StreetLayout.js';
import { LAKE_PARK } from './LakePark.js';
import { GAS_STATION } from './GasStation.js';
import { D69_STORE } from './D69Store.js';
import { COLPATRIA } from './Colpatria.js';

export const MAP_COLORS = Object.freeze({
  road: '#24272d', busway: '#5b2c31', sidewalk: '#6b6e72', floor: '#585c61', plaza: '#77736a',
  dirt: '#5d4b37', grass: '#2f5b35', water: '#1e5a86', building: '#3b414c', ruin: '#4a4038',
  wall: '#15171b', storeD69: '#2c6b4b', colpatria: '#8a6d22', colpatriaAnnex: '#6f6a5e',
  smallBuilding: '#454b56', background: '#101318'
});

const PX_PER_TILE = 4;

/**
 * @param {{ tileTypeAt: (tx: number, tz: number) => string|null, map: string[][] }} district
 * @param {number} tileSize
 */
export function buildCityMapRaster(district, tileSize = 2) {
  const width = district.map[0].length;
  const zMin = Math.ceil(TERMINAL.z0 / tileSize);
  const zMax = district.map.length - 1;
  const rows = zMax - zMin + 1;
  const canvas = document.createElement('canvas');
  canvas.width = width * PX_PER_TILE;
  canvas.height = rows * PX_PER_TILE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = MAP_COLORS.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const typeAt = (tx, tz) => district.tileTypeAt?.(tx, tz) ?? district.map[tz]?.[tx] ?? null;
  const solid = (type) => type && !['road', 'busway', 'sidewalk', 'floor', 'plaza', 'dirt', 'grass', 'water'].includes(type);
  for (let tz = zMin; tz <= zMax; tz++) for (let tx = 0; tx < width; tx++) {
    const type = typeAt(tx, tz);
    if (!type) continue;
    const px = tx * PX_PER_TILE, py = (tz - zMin) * PX_PER_TILE;
    ctx.fillStyle = MAP_COLORS[type] ?? MAP_COLORS.building;
    ctx.fillRect(px, py, PX_PER_TILE, PX_PER_TILE);
    // Bordes de manzana más claros para leer los bloques a escala pequeña.
    if (solid(type)) {
      ctx.fillStyle = 'rgba(255,255,255,.09)';
      if (!solid(typeAt(tx, tz - 1))) ctx.fillRect(px, py, PX_PER_TILE, 1);
      if (!solid(typeAt(tx - 1, tz))) ctx.fillRect(px, py, 1, PX_PER_TILE);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      if (!solid(typeAt(tx, tz + 1))) ctx.fillRect(px, py + PX_PER_TILE - 1, PX_PER_TILE, 1);
      if (!solid(typeAt(tx + 1, tz))) ctx.fillRect(px + PX_PER_TILE - 1, py, 1, PX_PER_TILE);
    }
  }
  const raster = {
    canvas, width, zMin, tileSize,
    pxPerMeter: PX_PER_TILE / tileSize,
    // Esquina superior izquierda del primer tile en metros (los tiles se centran en tx·T).
    originX: -tileSize / 2,
    originZ: zMin * tileSize - tileSize / 2,
  };
  raster.worldWidth = canvas.width / raster.pxPerMeter;
  raster.worldHeight = canvas.height / raster.pxPerMeter;

  // Tablero del viaducto como franja translúcida sobre la calle inferior.
  const toPx = (x, z) => [(x - raster.originX) * raster.pxPerMeter, (z - raster.originZ) * raster.pxPerMeter];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(205, 210, 220, .32)';
  ctx.lineWidth = VIADUCT.width * raster.pxPerMeter;
  ctx.beginPath();
  for (let z = VIADUCT.start; z <= VIADUCT.end; z += 2) {
    const [px, py] = toPx(bridgeCenter(z), z);
    if (z === VIADUCT.start) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
  return raster;
}

/** Nombres de vías para el mapa grande, en metros. */
export function streetLabels(tileSize = 2) {
  const mid = ([a, b]) => (a + b) / 2 * tileSize;
  return [
    ...CITY_CARRERAS.map(band => ({ name: band[2], x: mid(band), vertical: true })),
    { name: 'Av. Caracas', x: mid([CARACAS.lanes[0][0], CARACAS.lanes[1][1]]), vertical: true },
    ...CITY_CALLES.map(band => ({ name: band[2], z: mid(band), vertical: false })),
  ];
}

/** Lugares fijos de la ciudad con sus coordenadas reales. */
export function cityLandmarks(tileSize = 2) {
  const center = (o) => ({ x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 });
  return [
    { name: 'Gasolinera', icon: '⛽', color: '#f25b5b', ...center(GAS_STATION) },
    { name: 'Portal del Centro', icon: '🚏', color: '#e45960', x: TERMINAL.x, z: TERMINAL.z },
    { name: 'Torre Colpatria', icon: '🏙️', color: '#ffcb45', x: COLPATRIA.x, z: COLPATRIA.z },
    { name: 'Parque del Lago', icon: '🌊', color: '#5ed4dc', x: LAKE_PARK.lakeX, z: LAKE_PARK.z0 + 6 },
    { name: 'Supermercado D69', icon: '🏬', color: '#3cc47c', ...center(D69_STORE) },
    ...EXTENSION_PARKS.map(p => ({ name: p.name, icon: '🌳', color: '#6fcf6a',
      x: (p.x0 + p.x1) / 2 * tileSize, z: (p.z0 + p.z1) / 2 * tileSize })),
  ];
}
