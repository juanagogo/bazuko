// src/world/bogota/EastZones.js
// Trazado del oriente de la ciudad: La Candelaria al norte y Chapinero-Teusaquillo al sur.
// Se pinta después del mapa anterior, sin tocar ningún tile con X menor que la vieja columna
// del muro: las partidas guardadas y las manzanas ya construidas siguen exactamente iguales.

export const BASE_CITY_WIDTH = 120;
export const EAST_CITY_WIDTH = 200;
/** La columna que antes era el muro oriental; ahora es el fondo de la manzana de la Carrera 5. */
export const EAST_SEAM = BASE_CITY_WIDTH - 1;
/** Frontera entre los dos barrios, en tiles de Z (mitad del andén de la Calle 8A). */
export const CANDELARIA_END_Z = 60;

export const CARRERA_5 = Object.freeze([128, 133, 'Carrera 5']);
// Las carreras angostas no entran en CITY_CARRERAS: sin semáforos ni pintura de avenida.
export const CARRERA_4 = Object.freeze([154, 157, 'Carrera 4']);
export const CARRERA_3 = Object.freeze([174, 177, 'Carrera 3']);
export const CALLE_8A = Object.freeze([56, 59, 'Calle 8A']);
export const CALLE_6 = Object.freeze([118, 123, 'Calle 6']);
export const CALLE_5 = Object.freeze([140, 145, 'Calle 5']);
export const EAST_LABELLED_CARRERAS = Object.freeze([CARRERA_4, CARRERA_3]);
export const EAST_LABELLED_CALLES = Object.freeze([CALLE_8A, CALLE_6, CALLE_5]);

// Calle 10 y Calle 9 se angostan al entrar a la Candelaria: la banda de 6 tiles queda
// en andén de un tile a cada lado y cuatro de calzada.
export const NARROW_CALLES = Object.freeze([[13, 18], [37, 42]]);
const WIDE_CALLES = Object.freeze([[72, 77], [94, 99]]);
const WEST_CALLES = Object.freeze([[13, 18], [37, 42], [72, 77], [94, 99]]);
const EAST_START = CARRERA_5[1] + 1;

export const PLAZA = Object.freeze({ x0: 136, x1: 172, z0: 18, z1: 37, name: 'Plaza de la Candelaria' });
export const CHURCH = Object.freeze({ x0: 160, x1: 171, z0: 23, z1: 32 });
export const FOUNTAIN = Object.freeze({ x: 294, z: 55, radius: 3.6 });
export const TEUSAQUILLO_PARK = Object.freeze({ x0: 158, x1: 173, z0: 124, z1: 159, name: 'Parque de Teusaquillo' });
export const TOWERS_LOT = Object.freeze({ x0: 178, x1: 198, z0: 124, z1: 159, name: 'Torres de ladrillo' });
export const MARKET = Object.freeze({ x0: 161, x1: 170, z0: 81, z1: 90, name: 'Plaza de mercado' });
export const COMMERCIAL_STREET = Object.freeze({ name: 'Calle 7 comercial', z0: 94, z1: 99 });
/** Tres torres de planta curva, con la cresta hacia el parque; alturas menores que Colpatria. */
export const TOWERS = Object.freeze([
  Object.freeze({ cx: 391, cz: 268, radius: 22, thickness: 13, a0: 2.2, a1: 4.1, floors: 25 }),
  Object.freeze({ cx: 402, cz: 292, radius: 21, thickness: 12, a0: 2.4, a1: 4.3, floors: 30 }),
  Object.freeze({ cx: 393, cz: 311, radius: 19, thickness: 11, a0: 2.6, a1: 4.6, floors: 20 })
]);

/**
 * Gradas del atrio, de abajo hacia arriba: la misma huella se dibuja y se pisa. `depth` sale del frente de la nave
 * hacia la plaza, `inset` es lo que le falta a cada costado y `top`, la cota de su cara superior.
 */
export const CHURCH_STEPS = Object.freeze([
  Object.freeze({ depth: 4.3, inset: .5, top: .3 }),
  Object.freeze({ depth: 2.3, inset: 1.5, top: .48 })
]);
const CHURCH_FRONT_X = CHURCH.x0 * 2 - 1, CHURCH_CENTER_Z = (CHURCH.z0 + CHURCH.z1), CHURCH_HALF_Z = (CHURCH.z1 - CHURCH.z0 + 1);

/** Cota de las gradas en ese punto, o null fuera del atrio. */
export function churchStepHeight(x, z) {
  if (x >= CHURCH_FRONT_X || x < CHURCH_FRONT_X - CHURCH_STEPS[0].depth) return null;
  const side = Math.abs(z - CHURCH_CENTER_Z);
  let height = null;
  for (const { depth, inset, top } of CHURCH_STEPS) {
    if (x >= CHURCH_FRONT_X - depth && side <= CHURCH_HALF_Z - inset) height = top;
  }
  return height;
}

/** Torres y portada sobresalen de los tiles de la nave: esta franja es sólida de lado a lado, con zócalo incluido. */
export const CHURCH_FRONT_COLLIDER = Object.freeze({ x: CHURCH_FRONT_X - .5, z: CHURCH_CENTER_Z, w: 1, d: CHURCH_HALF_Z * 2, h: 24 });

/**
 * Cajas que siguen la curva de una torre, en franjas de medio metro a lo largo de X. Cubren toda la planta: ningún
 * cuerpo entra en el muro, y lo que sobra por fuera es menos de medio metro, no una esquina de tile.
 */
export function towerColliderBoxes(tower, step = .5) {
  const boxes = [], scan = .1;
  for (let x = Math.floor(tower.cx - tower.radius); x < tower.cx + tower.radius; x += step) {
    let start = null;
    for (let z = tower.cz - tower.radius - scan; z <= tower.cz + tower.radius + scan; z += scan) {
      const inside = [0, .25, .5, .75, 1].some(k => insideTower(tower, x + step * k, z));
      if (inside && start === null) start = z - scan;
      if (!inside && start !== null) {
        boxes.push({ x: x + step / 2, z: (start + z) / 2, w: step, d: z - start });
        start = null;
      }
    }
  }
  return boxes;
}

const fill = (map, x0, x1, z0, z1, type) => {
  for (let z = Math.max(1, z0); z <= Math.min(map.length - 2, z1); z++) {
    for (let x = x0; x <= Math.min(map[z].length - 2, x1); x++) map[z][x] = type;
  }
};

/** Planta curva de una torre, usada igual por el mapa, las colisiones y la geometría. */
export function insideTower(tower, wx, wz) {
  const dx = wx - tower.cx, dz = wz - tower.cz, r = Math.hypot(dx, dz);
  if (r > tower.radius || r < tower.radius - tower.thickness) return false;
  let angle = Math.atan2(dz, dx);
  if (angle < 0) angle += Math.PI * 2;
  return angle >= tower.a0 && angle <= tower.a1;
}

/** Amplía el mapa hacia +X. Las filas llegan con BASE_CITY_WIDTH tiles y salen con EAST_CITY_WIDTH. */
export function paintEastCity(map) {
  const height = map.length;
  for (let z = 0; z < height; z++) {
    while (map[z].length < EAST_CITY_WIDTH) map[z].push('building');
    map[z][EAST_SEAM] = 'building';
  }
  // Empalme con el parque del lago: el pasto sigue hasta el andén de la Carrera 5.
  fill(map, EAST_SEAM, 125, 111, height, 'grass');
  for (const z of [113, 155]) fill(map, EAST_SEAM, 125, z, z, 'plaza');

  // Carrera 5, la avenida que separa el centro de los barrios nuevos.
  fill(map, CARRERA_5[0] - 2, CARRERA_5[1] + 2, 1, height, 'sidewalk');
  fill(map, CARRERA_5[0], CARRERA_5[1], 1, height, 'road');

  // Las cuatro calles anteriores continúan hasta la Carrera 5 con sus andenes.
  for (const [a, b] of WEST_CALLES) {
    fill(map, EAST_SEAM, 125, a - 2, a - 1, 'sidewalk');
    fill(map, EAST_SEAM, 125, b + 1, b + 2, 'sidewalk');
    fill(map, EAST_SEAM, CARRERA_5[0] - 1, a, b, 'road');
  }

  // Chapinero y Teusaquillo: andenes de tres tiles (seis metros) en calles y carreras.
  const southCalles = [...WIDE_CALLES, CALLE_6, CALLE_5];
  for (const [a, b] of southCalles) {
    fill(map, EAST_START, 198, a - 3, a - 1, 'sidewalk');
    fill(map, EAST_START, 198, b + 1, b + 3, 'sidewalk');
  }
  for (const [a, b] of [CARRERA_4, CARRERA_3]) {
    fill(map, a - 3, a - 1, CANDELARIA_END_Z, height, 'sidewalk');
    fill(map, b + 1, b + 3, CANDELARIA_END_Z, height, 'sidewalk');
  }
  // Candelaria: un solo tile de andén, de piedra, pegado a las fachadas.
  for (const [a, b] of [CARRERA_4, CARRERA_3]) {
    fill(map, a - 1, a - 1, 1, CANDELARIA_END_Z, 'sidewalk');
    fill(map, b + 1, b + 1, 1, CANDELARIA_END_Z, 'sidewalk');
  }
  for (const [a, b] of [...NARROW_CALLES, CALLE_8A]) {
    const edgeA = a === CALLE_8A[0] ? a - 1 : a, edgeB = b === CALLE_8A[1] ? b + 1 : b;
    fill(map, EAST_START, 198, edgeA, edgeA, 'sidewalk');
    fill(map, EAST_START, 198, edgeB, edgeB, 'sidewalk');
  }

  // Calzadas: las carreras angostas recorren los dos barrios de norte a sur, y más abajo la plaza corta la Carrera 4.
  for (const [a, b] of [CARRERA_4, CARRERA_3]) fill(map, a, b, 1, height, 'road');
  for (const [a, b] of NARROW_CALLES) fill(map, EAST_START, 198, a + 1, b - 1, 'road');
  fill(map, EAST_START, 198, CALLE_8A[0], CALLE_8A[1], 'road');
  for (const [a, b] of southCalles) fill(map, EAST_START, 198, a, b, 'road');

  // Plaza: rompe la Carrera 4 y deja la iglesia en su costado oriental.
  fill(map, PLAZA.x0, PLAZA.x1, PLAZA.z0, PLAZA.z1, 'plaza');
  fill(map, CHURCH.x0, CHURCH.x1, CHURCH.z0, CHURCH.z1, 'building');

  // Parque de Teusaquillo y lote de las torres: quitan la Calle 5 al oriente de la Carrera 4.
  fill(map, CARRERA_4[1] + 1, CARRERA_3[0] - 1, TEUSAQUILLO_PARK.z0, height, 'sidewalk');
  fill(map, CARRERA_3[1] + 1, 198, TOWERS_LOT.z0, height, 'sidewalk');
  const park = TEUSAQUILLO_PARK;
  fill(map, park.x0 + 3, park.x1 - 3, park.z0 + 3, height, 'grass');
  for (let z = park.z0 + 3; z < height - 1; z++) for (let x = park.x0 + 3; x <= park.x1 - 3; x++) {
    const midX = (park.x0 + park.x1) / 2;
    if (Math.abs(x - midX) < 1 || z === 141 || z === 142) map[z][x] = 'plaza';
  }
  const lot = TOWERS_LOT;
  fill(map, lot.x0 + 3, lot.x1, lot.z0 + 3, height, 'plaza');
  for (let z = lot.z0; z < height - 1; z++) for (let x = lot.x0; x <= lot.x1; x++) {
    if (TOWERS.some(tower => insideTower(tower, x * 2, z * 2))) map[z][x] = 'building';
  }
  // Rincones que las curvas dejan cerrados: nadie llega a ellos, así que tampoco son piso.
  const reachable = new Set([`${lot.x0},${lot.z0}`]), queue = [[lot.x0, lot.z0]];
  while (queue.length) {
    const [x, z] = queue.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
      if (nx < lot.x0 || nx > lot.x1 || nz < lot.z0 || nz >= height - 1 || reachable.has(key) || map[nz][nx] === 'building') continue;
      reachable.add(key);
      queue.push([nx, nz]);
    }
  }
  for (let z = lot.z0; z < height - 1; z++) for (let x = lot.x0; x <= lot.x1; x++) {
    if (map[z][x] !== 'building' && !reachable.has(`${x},${z}`)) map[z][x] = 'building';
  }

  // Plaza de mercado de la zona comercial.
  fill(map, MARKET.x0, MARKET.x1, MARKET.z0, MARKET.z1, 'plaza');

  // El perímetro sigue siendo sólido en sus cuatro lados.
  for (let x = EAST_SEAM; x < EAST_CITY_WIDTH; x++) map[0][x] = map[height - 1][x] = 'wall';
  for (let z = 0; z < height; z++) map[z][EAST_CITY_WIDTH - 1] = 'wall';
  return map;
}

/** Bandas de calzada al oriente: permiten pintar y cruzar sin consultar cada manzana. */
export function eastCrossing(x, z) {
  if (x < EAST_SEAM) return false;
  const narrowStreet = [...NARROW_CALLES, [CALLE_8A[0] - 1, CALLE_8A[1] + 1]];
  if (z <= CANDELARIA_END_Z) {
    // Prolongación del andén de un tile a través de la calzada, en cada esquina.
    if ([CARRERA_4, CARRERA_3].some(([a, b]) => x === a - 1 || x === b + 1)) return true;
    if (narrowStreet.some(([a, b]) => z === a || z === b)) return true;
    return false;
  }
  if ([CARRERA_4, CARRERA_3].some(([a, b]) => (x >= a - 3 && x < a) || (x > b && x <= b + 3))) return true;
  return [...WIDE_CALLES, CALLE_6, CALLE_5].some(([a, b]) => (z >= a - 3 && z < a) || (z > b && z <= b + 3));
}

/** Manzanas construibles al oriente, como rectángulos de tiles sólidos. */
export function eastBlocks(map) {
  const seen = new Set(), blocks = [];
  const key = (x, z) => x + ',' + z;
  for (let z = 1; z < map.length - 1; z++) for (let x = EAST_SEAM; x < EAST_CITY_WIDTH - 1; x++) {
    if (map[z][x] !== 'building' || seen.has(key(x, z))) continue;
    let x1 = x, z1 = z;
    while (x1 + 1 < EAST_CITY_WIDTH - 1 && map[z][x1 + 1] === 'building' && !seen.has(key(x1 + 1, z))) x1++;
    const rowFits = row => {
      for (let tx = x; tx <= x1; tx++) if (map[row]?.[tx] !== 'building' || seen.has(key(tx, row))) return false;
      return true;
    };
    while (z1 + 1 < map.length - 1 && rowFits(z1 + 1)) z1++;
    for (let tz = z; tz <= z1; tz++) for (let tx = x; tx <= x1; tx++) seen.add(key(tx, tz));
    blocks.push({ x0: x, x1, z0: z, z1 });
  }
  return blocks;
}

export const inChurch = (tx, tz) => tx >= CHURCH.x0 && tx <= CHURCH.x1 && tz >= CHURCH.z0 && tz <= CHURCH.z1;
export const inTowerLot = (tx, tz) => tx >= TOWERS_LOT.x0 && tx <= TOWERS_LOT.x1 && tz >= TOWERS_LOT.z0 && tz <= TOWERS_LOT.z1;
