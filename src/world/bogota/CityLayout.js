import { paintSmallBuilding } from './SmallBuilding.js';
import { CARRERAS, CALLES, CARACAS, STREET_X, STREET_Z, SIDEWALK_TILES } from './StreetLayout.js';
import { paintLakePark } from './LakePark.js';
import { paintGasStation } from './GasStation.js';
import { paintD69Store } from './D69Store.js';
import { paintColpatria } from './Colpatria.js';
import { paintViaductClearance, paintViaductGardens } from './ColpatriaViaduct.js';
import { paintTerminalEntrance } from './TransitTerminal.js';
import { BASE_CITY_WIDTH, CARRERA_5, EAST_CITY_WIDTH, paintEastCity } from './EastZones.js';

export const ORIGINAL_CITY_WIDTH = STREET_X.size;
export const ORIGINAL_CITY_HEIGHT = STREET_Z.size;
export const CITY_WIDTH = EAST_CITY_WIDTH;
export const CITY_HEIGHT = 161;
export const CITY_AREA_MULTIPLIER = CITY_WIDTH * CITY_HEIGHT / (ORIGINAL_CITY_WIDTH * ORIGINAL_CITY_HEIGHT);
const BASE_CARRERAS = [...CARRERAS, [84, 89, 'Carrera 8'], [106, 111, 'Carrera 6']];
// La Carrera 5 es la única nueva con semáforos: las angostas de EastZones no los necesitan.
export const CITY_CARRERAS = [...BASE_CARRERAS, CARRERA_5];
export const CITY_CALLES = [...CALLES, [72, 77, 'Calle 8'], [94, 99, 'Calle 7']];
export const EXTENSION_PARKS = [
  { x0: 92, x1: 103, z0: 21, z1: 34, name: 'Parque de la Estación' },
  { x0: 69, x1: 81, z0: 80, z1: 91, name: 'Parque del Sur' }
];

/** Añade barrios al oriente y al sur sin desplazar el centro existente. */
export function expandCity(center) {
  return paintEastCity(expandBaseCity(center));
}

// El mapa de antes de la Candelaria se calcula igual que siempre: así cada tile con X menor
// que la vieja columna del muro conserva su valor, sin importar cuánto crezca el oriente.
function expandBaseCity(center) {
  const map = Array.from({ length: CITY_HEIGHT }, () => Array(BASE_CITY_WIDTH).fill('building'));
  const original = (x, z) => x < ORIGINAL_CITY_WIDTH - 1 && z < ORIGINAL_CITY_HEIGHT - 1;
  for (let z = 0; z < ORIGINAL_CITY_HEIGHT - 1; z++) {
    for (let x = 0; x < ORIGINAL_CITY_WIDTH - 1; x++) map[z][x] = center[z][x];
  }
  for (let z = 1; z < CITY_HEIGHT - 1; z++) {
    for (const [a,b] of [...BASE_CARRERAS, ...CARACAS.lanes]) {
      for (let x=a;x<=b;x++) if (!original(x,z)) map[z][x]='road';
    }
    for (let x=CARACAS.busway[0];x<=CARACAS.busway[1];x++) if (!original(x,z)) map[z][x]='busway';
  }
  for (const [a,b] of CITY_CALLES) for (let z=a;z<=b;z++) {
    for (let x=1;x<BASE_CITY_WIDTH-1;x++) if (!original(x,z)) map[z][x]='road';
  }
  const street = value => value === 'road' || value === 'busway';
  for (let z=1;z<CITY_HEIGHT-1;z++) for (let x=1;x<BASE_CITY_WIDTH-1;x++) {
    if (original(x,z) || map[z][x] !== 'building') continue;
    let near=false;
    for (let dz=-SIDEWALK_TILES;dz<=SIDEWALK_TILES && !near;dz++) {
      for (let dx=-SIDEWALK_TILES;dx<=SIDEWALK_TILES;dx++) {
        if (street(map[z+dz]?.[x+dx])) { near=true; break; }
      }
    }
    if (near) map[z][x]='sidewalk';
  }
  for (const park of EXTENSION_PARKS) {
    const pathX=Math.floor((park.x0+park.x1)/2), pathZ=Math.floor((park.z0+park.z1)/2);
    for(let z=park.z0;z<=park.z1;z++) for(let x=park.x0;x<=park.x1;x++) {
      if (map[z][x] !== 'building') continue;
      map[z][x]=x === pathX || z === pathZ ? 'plaza' : 'grass';
    }
  }
  paintLakePark(map);
  paintGasStation(map);
  paintD69Store(map);
  paintColpatria(map);
  paintViaductClearance(map);
  paintSmallBuilding(map);
  paintViaductGardens(map);
  for(let x=0;x<BASE_CITY_WIDTH;x++) map[0][x]=map[CITY_HEIGHT-1][x]='wall';
  for(let z=0;z<CITY_HEIGHT;z++) map[z][0]=map[z][BASE_CITY_WIDTH-1]='wall';
  paintTerminalEntrance(map);
  return map;
}
