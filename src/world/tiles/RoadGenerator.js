// src/world/tiles/RoadGenerator.js

/**
 * Generador de distrito urbano con sentido urbanístico.
 *
 * Patrón repetido por eje (período = 8 tiles), empezando en el tile 1
 * (el tile 0 y el último son el muro perimetral):
 *
 *   p=0  andén
 *   p=1..4  edificio (4 tiles)
 *   p=5  andén
 *   p=6..7  calle (2 tiles)
 *
 * Con size = 32 (o 40, 48... = 8k + 8) queda exacto: 4x4 manzanas, 3 calles
 * por eje y andén en los bordes. Cada edificio está SIEMPRE rodeado de
 * andén, y los andenes SIEMPRE tocan una calle -> todo es transitable
 * y los edificios nunca invaden la calle.
 *
 * Avenida TransMilenio: la 3ª calle horizontal (índice AVENUE_AFTER_ROAD) se reemplaza por una
 * avenida de AVENUE_WIDTH (12) tiles que cruza el mundo de muro a muro (y otra perpendicular que sustituye
 * la 2ª calle vertical; se cruzan en una plaza 'avP'), con andén a ambos lados
 * (los de las manzanas contiguas). Por eso el mapa tiene (size + AVENUE_WIDTH - 2) filas y columnas.
 *   a0-a1 'avN' carril normal (4 u) | a2-a3 'avTM' exclusivo (4 u) | a4-a7 'avG' zona verde central (8 u) |
 *   a8-a9 'avTM' exclusivo (4 u) | a10-a11 'avN' carril normal (4 u)  => 12 tiles = 24 u
 * Las calles verticales terminan contra la avenida (la avenida es continua; se cruza a pie).
 *
 * Convención de tiles:
 *   'road'  = calle horizontal (corre a lo largo de X) e intersecciones
 *   'roadV' = calle vertical (corre a lo largo de Y)
 *   map[y][x]  (y = fila = eje Z del mundo)
 */
import {
  DISTRICT_SIZE, AVENUE_WIDTH, AVENUE_N_TILES, AVENUE_TM_TILES, AVENUE_G_TILES
} from '../../utils/constants.js';

const PERIOD = 8;
const AVENUE_AFTER_ROAD = 2;   // la avenida horizontal (a lo largo de X) ocupa el lugar de la calle horizontal nº 3
const AVENUE_AFTER_ROAD_V = 1; // la avenida vertical (a lo largo de Z) ocupa el lugar de la calle vertical nº 2
const BUILDING_TYPES = ['building', 'buildingBrick', 'buildingLit'];
const WALKABLE = new Set(['sidewalk', 'dirt', 'floor', 'road', 'roadV', 'avN', 'avTM', 'avG', 'avP']);
// Tipo de tile por fila de la avenida (a0..a11): 2 normal | 2 TM | 4 verde | 2 TM | 2 normal
const AV_TYPES = [
  ...Array(AVENUE_N_TILES).fill('avN'), ...Array(AVENUE_TM_TILES).fill('avTM'),
  ...Array(AVENUE_G_TILES).fill('avG'),
  ...Array(AVENUE_TM_TILES).fill('avTM'), ...Array(AVENUE_N_TILES).fill('avN')
];

// Manzanas que se convierten en plazas libres: esquinas del mundo (índices de manzana; -1 = última)
const PLAZAS = {
  player: { bx: 0,  by: 0 },  // spawn (izq-arriba)
  stall:  { bx: -1, by: 0 },  // puesto de venta (der-arriba)
  bed:    { bx: 0,  by: -1 }, // cama / refugio (izq-abajo)
  dealer: { bx: -1, by: -1 }  // rincón del dealer (der-abajo)
};

let _layout = null;

/** Eje con una calle sustituida por la avenida: tipos por tile + fila/columna donde empieza la avenida */
function buildAxis(size, avenueAfterRoad) {
  const kinds = [];
  let roads = 0;
  let avenueStart = -1;
  for (let i = 0; i < size; i++) {
    const k = axisKind(i, size);
    if (k === 'road' && axisKind(i - 1, size) !== 'road') {
      if (roads === avenueAfterRoad) {
        avenueStart = kinds.length;
        for (let a = 0; a < AVENUE_WIDTH; a++) kinds.push('av' + a);
        roads++;
        i++; // salta el 2º tile de la calle reemplazada
        continue;
      }
      roads++;
    }
    kinds.push(k);
  }
  return { kinds, avenueStart };
}

/**
 * Trama del mundo: tipo de cada columna/fila ('wall'|'walk'|'bldg'|'road'|'av0'..'av11'),
 * orígenes de manzana por eje y posición de las dos avenidas. Fuente única para ZonaCero y el generador.
 * `size` = tamaño del patrón cuadrado (DISTRICT_SIZE); el mundo real mide cols x rows (size + 10 por eje).
 */
export function getLayout(size = DISTRICT_SIZE) {
  if (_layout && _layout.size === size) return _layout;
  const ax = buildAxis(size, AVENUE_AFTER_ROAD_V); // columnas (eje X): avenida vertical
  const ay = buildAxis(size, AVENUE_AFTER_ROAD);   // filas (eje Z): avenida horizontal
  const xKinds = ax.kinds, yKinds = ay.kinds;
  const origins = (kinds) => {
    const o = [];
    for (let i = 0; i < kinds.length; i++) if (kinds[i] === 'bldg' && kinds[i - 1] !== 'bldg') o.push(i);
    return o;
  };
  _layout = {
    size, cols: xKinds.length, rows: yKinds.length, xKinds, yKinds,
    blockX: origins(xKinds), blockY: origins(yKinds),
    avenueRow0: ay.avenueStart, avenueRows: AVENUE_WIDTH, // avenida a lo largo de X
    avenueCol0: ax.avenueStart, avenueCols: AVENUE_WIDTH  // avenida a lo largo de Z
  };
  return _layout;
}

/** Clasifica un índice 1D según el patrón: 'wall' | 'walk' | 'bldg' | 'road' */
function axisKind(i, size) {
  if (i <= 0 || i >= size - 1) return 'wall';
  const p = (i - 1) % PERIOD;
  if (p === 0 || p === 5) return 'walk';
  if (p >= 1 && p <= 4) return 'bldg';
  return 'road';
}

/** Esquina superior-izquierda (tiles) del núcleo 4x4 de la manzana (bx, by); índices negativos cuentan desde el final */
export function blockOrigin(bx, by) {
  const L = getLayout();
  const ix = bx < 0 ? L.blockX.length + bx : bx;
  const iy = by < 0 ? L.blockY.length + by : by;
  return { x: L.blockX[ix], y: L.blockY[iy] };
}

/** Tile transitable central de una plaza (dentro de la manzana) */
function plazaCenter(bx, by) {
  const o = blockOrigin(bx, by);
  return { x: o.x + 1, z: o.y + 1 };
}

/**
 * Posiciones (en índices de tile) donde colocar jugador, puesto, cama y dealer.
 * Si tu mundo usa el centro del tile, suma +0.5 a x y z.
 */
export function getSpawnPoints() {
  return {
    player: plazaCenter(PLAZAS.player.bx, PLAZAS.player.by),
    stall:  plazaCenter(PLAZAS.stall.bx,  PLAZAS.stall.by),
    bed:    plazaCenter(PLAZAS.bed.bx,    PLAZAS.bed.by),
    dealer: plazaCenter(PLAZAS.dealer.bx, PLAZAS.dealer.by)
  };
}

export function generateDistrict(size = DISTRICT_SIZE, rng = Math.random) {
  if ((size - 8) % PERIOD !== 0 || size < 24) {
    console.warn(`[RoadGenerator] size=${size} no encaja en el patrón (usa 32, 40, 48...).`);
  }

  const L = getLayout(size);
  const cols = L.cols, rows = L.rows;
  const map = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 'sidewalk')
  );

  // ===== 1. Trama base: calles, avenida, andenes y manzanas =====
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const kx = L.xKinds[x];
      const ky = L.yKinds[y];

      if (kx === 'wall' || ky === 'wall') {
        map[y][x] = 'building';            // muro perimetral
      } else if (kx.startsWith('av') && ky.startsWith('av')) {
        map[y][x] = 'avP';                 // plaza donde se cruzan las dos avenidas (sin zona verde)
      } else if (ky.startsWith('av')) {
        map[y][x] = AV_TYPES[+ky.slice(2)];      // avenida horizontal (continua de muro a muro)
      } else if (kx.startsWith('av')) {
        map[y][x] = AV_TYPES[+kx.slice(2)];      // avenida vertical (continua de muro a muro)
      } else if (kx === 'road' && ky === 'road') {
        map[y][x] = 'road';                // intersección
      } else if (kx === 'road') {
        map[y][x] = 'roadV';               // calle que corre en Y
      } else if (ky === 'road') {
        map[y][x] = 'road';                // calle que corre en X
      } else if (kx === 'bldg' && ky === 'bldg') {
        map[y][x] = 'building';            // se estiliza en el paso 2
      } else {
        map[y][x] = 'sidewalk';            // andén alrededor de la manzana
      }
    }
  }

  // ===== 2. Estilo por edificio (cada manzana = 2 edificios de 4x2) =====
  for (let by = 0; by < L.blockY.length; by++) {
    for (let bx = 0; bx < L.blockX.length; bx++) {
      const o = blockOrigin(bx, by);
      for (let half = 0; half < 2; half++) {
        const r = rng();
        const style = r < 0.55 ? BUILDING_TYPES[0]
                    : r < 0.85 ? BUILDING_TYPES[1]
                    : BUILDING_TYPES[2];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            map[o.y + half * 2 + dy][o.x + dx] = style;
          }
        }
      }
    }
  }

  // ===== 3. Plazas: spawn, puesto de venta, cama, dealer =====
  for (const [key, { bx, by }] of Object.entries(PLAZAS)) {
    const o = blockOrigin(bx, by);
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const x = o.x + dx, y = o.y + dy;
        if (key === 'dealer') {
          map[y][x] = (dx + dy) % 2 === 0 ? 'dirt' : 'floor';
        } else {
          map[y][x] = (x + y) % 5 === 0 ? 'dirt' : 'sidewalk';
        }
      }
    }
  }

  // ===== 4. Validación: todo lo transitable debe ser alcanzable =====
  validateConnectivity(map, cols, rows);

  return map;
}

/** Flood fill desde el spawn; verifica que puesto, cama y dealer sean alcanzables. */
function validateConnectivity(map, cols, rows) {
  const sp = getSpawnPoints();
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [[sp.player.x, sp.player.z]];
  seen[sp.player.z][sp.player.x] = true;

  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (seen[ny][nx] || !WALKABLE.has(map[ny][nx])) continue;
      seen[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  const ok = (p) => seen[p.z][p.x];
  if (!ok(sp.stall) || !ok(sp.bed) || !ok(sp.dealer)) {
    console.error('[RoadGenerator] ¡Puesto, cama o dealer NO alcanzables desde el spawn!');
  }

  let unreachable = 0;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (WALKABLE.has(map[y][x]) && !seen[y][x]) unreachable++;
  if (unreachable > 0) {
    console.error(`[RoadGenerator] ${unreachable} tiles transitables aislados.`);
  }
}

/**
 * Props: solo en tiles transitables (andenes/tierra), nunca en calles,
 * edificios ni sobre los puntos de spawn.
 */
export function getPropSpawnPoints(map, size) {
  const points = [];
  const L = getLayout(size);
  const rows = L.rows;
  const sp = getSpawnPoints();
  const keep = Object.values(sp);
  const isSpecial = (x, z) =>
    keep.some(p => Math.abs(p.x - x) <= 1 && Math.abs(p.z - z) <= 1);
  const st = blockOrigin(PLAZAS.stall.bx, PLAZAS.stall.by);
  const isFree = (x, z) => {
    if (x >= 1 && x <= 4 && z >= rows - 5 && z <= rows - 2) return false; // huella del cambuche
    if (x >= st.x && x <= st.x + 3 && z >= st.y && z <= st.y + 3) return false; // plaza de la Tienda (edificio + zona de entrada)
    const t = map[z]?.[x];
    return t === 'sidewalk' || t === 'dirt' || t === 'floor';
  };

  // Faroles en las esquinas de andén de cada manzana: 2 por manzana (diagonal alterna según paridad)
  // para mantener la densidad de antes (~1 farol por 1000 u2) sin disparar draw calls.
  for (let by = 0; by < L.blockY.length; by++) {
    for (let bx = 0; bx < L.blockX.length; bx++) {
      const o = blockOrigin(bx, by);
      const corners = [
        [o.x - 1, o.y - 1], [o.x + 4, o.y - 1],
        [o.x - 1, o.y + 4], [o.x + 4, o.y + 4]
      ];
      const pick = (bx + by) % 2 === 0 ? [0, 3] : [1, 2];
      for (const ci of pick) {
        const [x, z] = corners[ci];
        if (isFree(x, z) && !isSpecial(x, z)) points.push({ x, z, type: 'farol' });
      }
    }
  }

  // Props aleatorios (basura, cajas, etc.) solo en andén/tierra
  for (let z = 1; z < rows - 1; z++) {
    for (let x = 1; x < L.cols - 1; x++) {
      if (!isFree(x, z) || isSpecial(x, z)) continue;
      if (Math.random() < 0.02) points.push({ x, z, type: null });
    }
  }

  return points;
}
