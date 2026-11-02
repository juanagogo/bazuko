// src/world/bogota/CityMapRaster.js
// La ciudad vista desde arriba: tiles, nombres de vías y lugares fijos, para el radar y el mapa grande.
import { bridgeCenter } from './Colpatria.js';
import { VIADUCT } from './ColpatriaViaduct.js';
import { TERMINAL } from './TransitTerminal.js';
import { CITY_CARRERAS, CITY_CALLES, EXTENSION_PARKS } from './CityLayout.js';
import { CARACAS } from './StreetLayout.js';
import { LAKE_PARK } from './LakePark.js';
import { GAS_STATION } from './GasStation.js';
import { D69_STORE } from './D69Store.js';
import { COLPATRIA } from './Colpatria.js';
import { EAST_LABELLED_CARRERAS, EAST_LABELLED_CALLES, PLAZA, TEUSAQUILLO_PARK, TOWERS_LOT, MARKET } from './EastZones.js';

/**
 * Lo que necesitan el radar y el mapa para dibujar la ciudad a marcador (ver ui/planoRadar.js): los tiles y su lugar en metros.
 * @param {{ tileTypeAt: (tx: number, tz: number) => string|null, map: string[][] }} district
 * @param {number} tileSize
 */
export function cityMapPlan(district, tileSize = 2) {
  const width = district.map[0].length;
  const zMin = Math.ceil(TERMINAL.z0 / tileSize);
  const zMax = district.map.length - 1;
  const typeAt = (tx, tz) => district.tileTypeAt?.(tx, tz) ?? district.map[tz]?.[tx] ?? null;
  const plan = {
    // Esquina superior izquierda del primer tile en metros (los tiles se centran en tx·T).
    originX: -tileSize / 2,
    originZ: zMin * tileSize - tileSize / 2,
    worldWidth: width * tileSize,
    worldHeight: (zMax - zMin + 1) * tileSize,
  };
  plan.tiles = () => {
    const puntos = [];
    for (let z = VIADUCT.start; z <= VIADUCT.end; z += 2) puntos.push([bridgeCenter(z), z]);
    return {
      ancho: width, desdeZ: zMin, hastaZ: zMax, T: tileSize, tipo: typeAt,
      originX: plan.originX, originZ: plan.originZ, viaducto: { ancho: VIADUCT.width, puntos },
    };
  };
  return plan;
}

/** Nombres de vías para el mapa grande, en metros. */
export function streetLabels(tileSize = 2) {
  const mid = ([a, b]) => (a + b) / 2 * tileSize;
  return [
    ...CITY_CARRERAS.map(band => ({ name: band[2], x: mid(band), vertical: true })),
    { name: 'Av. Caracas', x: mid([CARACAS.lanes[0][0], CARACAS.lanes[1][1]]), vertical: true },
    ...CITY_CALLES.map(band => ({ name: band[2], z: mid(band), vertical: false })),
    // Calles propias del oriente: solo existen allí, así que su nombre no se pinta en el centro.
    ...EAST_LABELLED_CARRERAS.map(band => ({ name: band[2], x: mid(band), vertical: true })),
    ...EAST_LABELLED_CALLES.map(band => ({ name: band[2], z: mid(band), vertical: false, minX: mid(CITY_CARRERAS.at(-1)) })),
  ];
}

/** Lugares fijos de la ciudad con sus coordenadas reales. */
export function cityLandmarks(tileSize = 2) {
  const center = (o) => ({ x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 });
  return [
    { name: 'Gasolinera', icon: '⛽', color: '#f25b5b', decor: true, ...center(GAS_STATION) },
    { name: 'Portal del Centro', icon: '🚏', color: '#e45960', x: TERMINAL.x, z: TERMINAL.z },
    { name: 'Torre Colpatria', icon: '🏙️', color: '#ffcb45', x: COLPATRIA.x, z: COLPATRIA.z },
    { name: 'Parque del Lago', icon: '🌊', color: '#5ed4dc', x: LAKE_PARK.lakeX, z: LAKE_PARK.z0 + 6 },
    { name: 'Mercado Doña Inés', icon: '🏬', color: '#3cc47c', decor: true, ...center(D69_STORE) },
    ...EXTENSION_PARKS.map(p => ({ name: p.name, icon: '🌳', color: '#6fcf6a',
      x: (p.x0 + p.x1) / 2 * tileSize, z: (p.z0 + p.z1) / 2 * tileSize })),
    ...[[PLAZA, '⛲', '#d9c49a'], [TEUSAQUILLO_PARK, '🌳', '#6fcf6a'], [TOWERS_LOT, '🏢', '#c46a4c'], [MARKET, '🧺', '#e8a33d']].map(([zone, icon, color]) =>
      ({ name: zone.name, icon, color, x: (zone.x0 + zone.x1) / 2 * tileSize, z: (zone.z0 + zone.z1) / 2 * tileSize })),
  ];
}
