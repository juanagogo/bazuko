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
    // Viaducto elevado de la Primera Línea del Metro sobre la Av. Caracas (x: 75)
    const puntosMetro = [];
    for (let z = 10; z <= 310; z += 2) puntosMetro.push([75, z]);
    return {
      ancho: width, desdeZ: zMin, hastaZ: zMax, T: tileSize, tipo: typeAt,
      originX: plan.originX, originZ: plan.originZ,
      viaducto: { ancho: VIADUCT.width, puntos },
      metro: { ancho: 7, puntos: puntosMetro },
    };
  };
  return plan;
}

/** Nombres de vías para el mapa grande, en metros, fieles a la nomenclatura real de Bogotá. */
export function streetLabels(tileSize = 2) {
  const mid = ([a, b]) => (a + b) / 2 * tileSize;
  return [
    { name: 'Carrera 15', x: 19, vertical: true },
    { name: 'Av. Caracas · Metro L1', x: mid([CARACAS.lanes[0][0], CARACAS.lanes[1][1]]), vertical: true },
    { name: 'Carrera 10', x: 127, vertical: true },
    { name: 'Carrera 8', x: 173, vertical: true },
    { name: 'Carrera 7 (Av. Séptima)', x: 217, vertical: true },
    { name: 'Carrera 5', x: 261, vertical: true },
    { name: 'Carrera 4', x: 311, vertical: true },
    { name: 'Carrera 3', x: 351, vertical: true },
    // Calles reales de Bogotá de Norte a Sur
    { name: 'Calle 93', z: 31, vertical: false, maxX: 150 },
    { name: 'Calle 82', z: 79, vertical: false, maxX: 150 },
    { name: 'Calle 72', z: 115, vertical: false, minX: 180 },
    { name: 'Calle 8A', z: 115, vertical: false, minX: 261 },
    { name: 'Av. Calle 26', z: 193, vertical: false },
    { name: 'Calle 10', z: 241, vertical: false, minX: 180 },
    { name: 'Calle 6', z: 285, vertical: false },
    { name: 'Calle 5', z: 285, vertical: false, minX: 261 }
  ];
}

/** Lugares fijos de la ciudad con sus coordenadas reales. */
export function cityLandmarks(tileSize = 2) {
  const center = (o) => ({ x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 });
  return [
    // 1. ZONAS EXCLUSIVAS DEL NORTE DE BOGOTÁ
    { name: 'Parque de la 93 (Chicó)', icon: '🌳', color: '#2a9d8f', x: 38, z: 25, fijo: true },
    { name: 'Zona T (Calle 82 / Zona Rosa)', icon: '🍸', color: '#ff007f', x: 22, z: 75, fijo: true },
    { name: 'Zona G (Rosales / Gourmet)', icon: '🍽️', color: '#e76f51', x: 295, z: 115, fijo: true },
    { name: 'Mansión Reyes (Rosales / Zona G)', icon: '🏰', color: '#ffd166', x: 295, z: 115, fijo: true },
    { name: 'Tarima Zona T (Show de Hilda)', icon: '🎤', color: '#f72585', x: 22, z: 75, fijo: true },

    // 2. METRO DE BOGOTÁ (PRIMERA LÍNEA ELEVADA - PLMB)
    { name: 'Metro de Bogotá · Estación Calle 72', icon: '🚇', color: '#2e7d32', x: 75, z: 115, fijo: true },
    { name: 'Metro de Bogotá · Estación Central (Calle 26)', icon: '🚇', color: '#2e7d32', x: 75, z: 193, fijo: true },
    { name: 'Metro de Bogotá · Viaducto Caracas', icon: '🚇', color: '#2e7d32', x: 75, z: 155, fijo: true },

    // 3. HITOS URBANOS Y TRADICIONALES DE BOGOTÁ
    { name: 'Torre Colpatria (Av. Calle 26)', icon: '🏙️', color: '#ffcb45', x: COLPATRIA.x, z: COLPATRIA.z, fijo: true },
    { name: 'Sede Grupo GER (Torre Colpatria)', icon: '🏢', color: '#ffb703', x: COLPATRIA.x, z: COLPATRIA.z, fijo: true },
    { name: 'Portal del Centro (TransMilenio)', icon: '🚏', color: '#e45960', x: TERMINAL.x, z: TERMINAL.z, fijo: true },
    { name: PLAZA.name, icon: '🏛️', color: '#d9c49a', x: (PLAZA.x0 + PLAZA.x1) / 2 * tileSize, z: (PLAZA.z0 + PLAZA.z1) / 2 * tileSize, fijo: true },
    { name: TEUSAQUILLO_PARK.name, icon: '🌳', color: '#6fcf6a', x: (TEUSAQUILLO_PARK.x0 + TEUSAQUILLO_PARK.x1) / 2 * tileSize, z: (TEUSAQUILLO_PARK.z0 + TEUSAQUILLO_PARK.z1) / 2 * tileSize, fijo: true },
    { name: TOWERS_LOT.name, icon: '🏢', color: '#c46a4c', x: (TOWERS_LOT.x0 + TOWERS_LOT.x1) / 2 * tileSize, z: (TOWERS_LOT.z0 + TOWERS_LOT.z1) / 2 * tileSize, fijo: true },
    { name: 'Gasolinera', icon: '⛽', color: '#f25b5b', decor: true, ...center(GAS_STATION) },
    { name: 'Parque del Lago', icon: '🌊', color: '#5ed4dc', x: LAKE_PARK.lakeX, z: LAKE_PARK.z0 + 6, fijo: true },
    { name: 'Mercado Doña Inés', icon: '🏬', color: '#3cc47c', decor: true, ...center(D69_STORE) },
    ...EXTENSION_PARKS.map(p => ({ name: p.name, icon: '🌳', color: '#6fcf6a',
      x: (p.x0 + p.x1) / 2 * tileSize, z: (p.z0 + p.z1) / 2 * tileSize })),
    { name: MARKET.name, icon: '🧺', color: '#e8a33d', x: (MARKET.x0 + MARKET.x1) / 2 * tileSize, z: (MARKET.z0 + MARKET.z1) / 2 * tileSize }
  ];
}
