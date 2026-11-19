import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { StreetBatch, tint } from '../src/world/bogota/StreetBatch.js';
import { addTreeFeet } from '../src/world/bogota/TreeFeet.js';

const T = 2, UV = { plain: [0, 0, .1, .1], concrete: [.2, 0, .3, .1] };
const PAVED_TREE = { x: 6, z: 4, scale: 1.4 }, PARK_TREE = { x: 14, z: 16, scale: 1 };

/** Patio de 12 × 12 tiles: andén arriba, prado abajo y un muro al oriente. */
function yard() {
  const map = Array.from({ length: 12 }, (_, z) => Array.from({ length: 12 }, (_, x) => x >= 9 ? 'building' : z < 6 ? 'sidewalk' : 'grass'));
  const tile = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];
  // Sitio reservado del juego: aquí no crece maleza de andén y las pruebas ven solo el pie de los árboles.
  return { map, tile, treePlan: [PAVED_TREE, PARK_TREE], isNearReserved: () => true,
    getGroundHeight: (x, z) => tile(x, z) === 'grass' ? .06 : .12,
    getWaterInfo: (x, z) => z > 19 ? { depth: 1 } : null };
}

/** Lote con lo que la calle ya dibuja: un piso que cubre todo el patio. */
function batch() {
  const street = new StreetBatch({ material: null });
  street.quad([0, 0, 22], [22, 0, 22], [22, 0, 0], [0, 0, 0], [0, 1, 0], UV.plain, tint('#888888'));
  return street;
}

function dress(district = yard(), street = batch()) {
  const chunk = [...street.chunks.values()][0], before = chunk ? chunk.p.length : 0, random = Math.random;
  const firstIndex = chunk ? chunk.i.length : 0;
  Math.random = () => { throw new Error('el pie de árbol no puede gastar Math.random'); };
  let dressed;
  try { dressed = addTreeFeet(street, district, UV); } finally { Math.random = random; }
  const points = [];
  for (let i = before; chunk && i < chunk.p.length; i += 3) points.push([chunk.p[i], chunk.p[i + 1], chunk.p[i + 2]]);
  return { dressed, street, chunk, points, district, firstIndex };
}

const span = (values) => [Math.min(...values), Math.max(...values)];

test('el pie de árbol entra al lote que ya existe: ni sectores nuevos ni la caja de ninguno se mueve', () => {
  const { dressed, street, chunk, points } = dress();
  assert.equal(dressed, 2);
  assert.equal(street.chunks.size, 1, 'no abre sectores');
  assert.ok(points.length > 200, `vértices nuevos: ${points.length}`);
  assert.ok(chunk.i.length / 3 < 6 + 2 * 260, `triángulos: ${chunk.i.length / 3}`);
  assert.deepEqual(span(points.map(p => p[0])).map(v => v >= 0 && v <= 22), [true, true]);
  assert.deepEqual(span(points.map(p => p[2])).map(v => v >= 0 && v <= 22), [true, true]);
  assert.equal(chunk.p.length / 3 * 3, chunk.c.length, 'un color por vértice');
  assert.equal(chunk.p.length / 3 * 2, chunk.u.length);
});

test('en el andén hay alcorque de tierra con borde y en el prado, pasto alto pegado al tronco', () => {
  const { points } = dress();
  const near = (tree, radius) => points.filter(p => Math.hypot(p[0] - tree.x, p[2] - tree.z) < radius);
  const soil = near(PAVED_TREE, 1.1).filter(p => Math.abs(p[1] - .134) < 1e-6);
  assert.ok(soil.length >= 4, 'tierra a ras del andén');
  const [x0, x1] = span(soil.map(p => p[0]));
  assert.ok(x1 - x0 > 1.2 && x1 - x0 < 1.9, `ancho del alcorque: ${x1 - x0}`);
  const kerb = near(PAVED_TREE, 1.6).filter(p => p[1] > .16 && p[1] < .2);
  assert.ok(kerb.length >= 16, 'borde de concreto por los cuatro lados');
  assert.ok(kerb.every(p => Math.max(Math.abs(p[0] - PAVED_TREE.x), Math.abs(p[2] - PAVED_TREE.z)) > .6), 'el borde no pisa el tronco');
  const blades = near(PARK_TREE, .9).filter(p => p[1] > .16);
  assert.ok(blades.length >= 12, 'pasto alto al pie');
  assert.ok(points.every(p => p[1] < .12 + .5), 'nada flota');
});

test('la hojarasca queda tendida en el piso y no cae en muros ni en agua', () => {
  const { points, district } = dress();
  const far = points.filter(p => Math.hypot(p[0] - PAVED_TREE.x, p[2] - PAVED_TREE.z) > 1.6 && Math.hypot(p[0] - PARK_TREE.x, p[2] - PARK_TREE.z) > 1.4);
  assert.ok(far.length >= 40, `hojas lejos del tronco: ${far.length / 4}`);
  for (const p of far) {
    assert.ok(Math.abs(p[1] - (district.getGroundHeight(p[0], p[2]) + .022)) < 1e-6, 'pegada al piso');
    assert.notEqual(district.tile(p[0], p[2]), 'building');
    assert.ok(p[2] <= 19.2, 'fuera del agua');
  }
});

test('el mismo árbol siempre deja el mismo pie y sin un lote cerca queda como está', () => {
  assert.deepEqual(dress().points, dress().points);
  const empty = dress(yard(), new StreetBatch({ material: null }));
  assert.equal(empty.dressed, 0);
  assert.equal(empty.street.chunks.size, 0);
  // Un lote se estira hasta el pie solo si su centro sigue en el mismo sector de dibujo.
  const wide = () => {
    const street = new StreetBatch({ material: null });
    street.quad([0, 0, 8], [63.5, 0, 8], [63.5, 0, 0], [0, 0, 0], [0, 1, 0], UV.plain, tint('#888888'));
    return street;
  };
  const row = { map: [0, 1, 2, 3, 4].map(() => Array.from({ length: 36 }, () => 'sidewalk')), getGroundHeight: () => .12 };
  assert.equal(dress({ ...row, treePlan: [{ x: 60, z: 4, scale: 1 }] }, wide()).dressed, 1);
  const edge = dress({ ...row, treePlan: [{ x: 63.6, z: 4, scale: 1 }] }, wide());
  assert.equal(edge.dressed, 0, 'correría el centro del lote al sector vecino');
  assert.equal(edge.points.length, 0);
});

test('las caras miran hacia donde dice su normal: nada queda invisible por estar al revés', () => {
  const { chunk, firstIndex } = dress();
  const at = (list, i) => [list[i * 3], list[i * 3 + 1], list[i * 3 + 2]];
  let flat = 0, walls = 0;
  for (let i = firstIndex; i < chunk.i.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => at(chunk.p, chunk.i[i + k])), n = at(chunk.n, chunk.i[i]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...face);
    assert.ok(length > 1e-7, 'sin triángulos degenerados');
    const facing = (face[0] * n[0] + face[1] * n[1] + face[2] * n[2]) / length;
    // Las hojas de pasto van paradas y por las dos caras: su normal hacia arriba no dice hacia dónde miran.
    if (n[1] > .9 && Math.max(a[1], b[1], c[1]) - Math.min(a[1], b[1], c[1]) > .05) continue;
    assert.ok(facing > .5, `cara al revés en el triángulo ${(i - firstIndex) / 3}`);
    if (n[1] > .9) flat++; else walls++;
  }
  assert.ok(flat > 60, `caras tendidas: ${flat}`);
  assert.ok(walls > 30, `caras del borde: ${walls}`);
});

test('la maleza del andén crece contra la tapia y detrás del sardinel, nunca en los sitios del juego', () => {
  // Cuadra larga: tapia arriba, dos filas de andén y la calzada abajo.
  const map = ['wall', 'sidewalk', 'sidewalk', 'road'].map(kind => Array.from({ length: 120 }, () => kind));
  const lot = () => {
    const street = new StreetBatch({ material: null, chunkSize: 512 });
    street.quad([0, 0, 7], [240, 0, 7], [240, 0, -1], [0, 0, -1], [0, 1, 0], UV.plain, tint('#888888'));
    return street;
  };
  const block = { map, treePlan: [], getGroundHeight: () => .12 };
  const { points, district } = dress(block, lot());
  assert.ok(district.treeFeet.weeds > 10, `mechones: ${district.treeFeet.weeds}`);
  assert.ok(points.length >= district.treeFeet.weeds * 3 * 6, 'cada mechón tiene al menos tres hojas por las dos caras');
  for (const p of points) {
    assert.ok(p[2] > 1 - .1 && p[2] < 5, `fuera del andén: z = ${p[2]}`);
    assert.ok(p[1] >= .12 && p[1] < .12 + .26, `alto ${p[1]}`);
    // La tapia queda en z = 1 y el sardinel en z = 5: la maleza se pega a uno de los dos.
    assert.ok(p[2] - 1 < .4 || 5 - p[2] < .6, `suelta en medio del andén: z = ${p[2]}`);
  }
  // Por tramos: hay trechos de 16 m con mucha más maleza que otros.
  const perStretch = new Map();
  for (const p of points) perStretch.set(Math.floor(p[0] / 16), (perStretch.get(Math.floor(p[0] / 16)) ?? 0) + 1);
  const counts = Array.from({ length: 15 }, (_, k) => perStretch.get(k) ?? 0);
  assert.ok(Math.max(...counts) >= 4 * Math.max(6, Math.min(...counts)), `por tramo: ${counts}`);
  assert.deepEqual(dress(block, lot()).points, points, 'siempre la misma');
  const reserved = dress({ ...block, isNearReserved: () => true }, lot());
  assert.equal(reserved.district.treeFeet.weeds, 0);
  assert.equal(reserved.points.length, 0);
});

/** Color del vértice tal como sale en pantalla: de lineal a sRGB, en tono, saturación y luz. */
function enPantalla(chunk, vertice) {
  const color = new THREE.Color().setRGB(chunk.c[vertice * 3], chunk.c[vertice * 3 + 1], chunk.c[vertice * 3 + 2], THREE.LinearSRGBColorSpace);
  return color.getHSL({}, THREE.SRGBColorSpace);
}

test('la hojarasca es hoja seca apagada y no cae en la calzada', () => {
  // Andén de cuatro filas con la calzada a los dos lados: el árbol queda a un metro del sardinel.
  const map = Array.from({ length: 12 }, (_, z) => Array.from({ length: 12 }, () => z >= 4 && z <= 7 ? 'sidewalk' : 'road'));
  const tile = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];
  const calle = { map, treePlan: [{ x: 10, z: 8.2, scale: 1.4 }], isNearReserved: () => true,
    getGroundHeight: (x, z) => tile(x, z) === 'sidewalk' ? .12 : 0 };
  const { chunk, points, dressed } = dress(calle);
  assert.equal(dressed, 1);
  const hojas = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y, z] = points[i];
    if (Math.hypot(x - 10, z - 8.2) > 1.2 && Math.abs(y - .142) < 1e-6) hojas.push(i);
  }
  assert.ok(hojas.length >= 40, `hojas sobre el andén: ${hojas.length / 4}`);
  for (const p of points) assert.notEqual(tile(p[0], p[2]), 'road', `hoja en la calzada en ${p[0].toFixed(2)}, ${p[2].toFixed(2)}`);
  const primero = chunk.p.length / 3 - points.length;
  for (const i of hojas) {
    const { s, l } = enPantalla(chunk, primero + i);
    assert.ok(s <= .24, `saturación de la hoja: ${s.toFixed(2)}`);
    assert.ok(l <= .5, `luz de la hoja: ${l.toFixed(2)}`);
  }
});

test('el árbol pegado al borde de su sector se queda con el alcorque', () => {
  const street = new StreetBatch({ material: null });
  street.quad([0, 0, 8], [63.5, 0, 8], [63.5, 0, 0], [0, 0, 0], [0, 1, 0], UV.plain, tint('#888888'));
  const row = { map: [0, 1, 2, 3, 4].map(() => Array.from({ length: 36 }, () => 'sidewalk')), getGroundHeight: () => .12 };
  // Con todo su alcance correría el centro del lote al sector vecino; el alcorque solo, no.
  const { dressed, points } = dress({ ...row, treePlan: [{ x: 62.9, z: 4, scale: 1.43 }] }, street);
  assert.equal(dressed, 1);
  const tierra = points.filter(p => Math.abs(p[1] - .134) < 1e-6 && Math.hypot(p[0] - 62.9, p[2] - 4) < 1.1);
  assert.ok(tierra.length >= 4, 'tierra a ras del andén');
  const borde = points.filter(p => p[1] > .16 && p[1] < .2 && Math.hypot(p[0] - 62.9, p[2] - 4) < 1.4);
  assert.ok(borde.length >= 16, `borde de concreto: ${borde.length}`);
  assert.ok(points.every(p => p[0] < 64), 'nada pasa el borde del sector');
});

test('cada hoja seca tiene forma de hoja y tamaño propio, y no queda más clara que el piso donde cae', () => {
  const { chunk, firstIndex } = dress();
  const at = i => [chunk.p[i * 3], chunk.p[i * 3 + 1], chunk.p[i * 3 + 2]];
  const value = i => Math.max(...[0, 1, 2].map(k => new THREE.Color().setRGB(chunk.c[i * 3], chunk.c[i * 3 + 1], chunk.c[i * 3 + 2],
    THREE.LinearSRGBColorSpace).getStyle(THREE.SRGBColorSpace).match(/[\d.]+/g).slice(0, 3)[k] / 255));
  const leafTriangles = [];
  for (let t = firstIndex; t < chunk.i.length; t += 3) {
    const ids = [0, 1, 2].map(k => chunk.i[t + k]), points = ids.map(at);
    const ground = points.map(([x, , z]) => x < 18 && z >= 11 ? .06 : .12);
    const lying = points.every(([, y], k) => Math.abs(y - ground[k] - .022) < 1e-6);
    const off = (tree, reach) => points.every(([x, , z]) => Math.max(Math.abs(x - tree.x), Math.abs(z - tree.z)) > reach);
    if (lying && off(PAVED_TREE, 1.2) && off(PARK_TREE, .9)) leafTriangles.push({ ids, points, grass: ground[0] < .1 });
  }
  assert.ok(leafTriangles.length >= 60, `${leafTriangles.length} triángulos de hoja`);
  // Cada hoja es un grupo de triángulos que comparten esquinas.
  const key = p => p.map(v => v.toFixed(5)).join();
  const leaves = new Map();
  for (const triangle of leafTriangles) {
    const keys = triangle.points.map(key), found = [...leaves.values()].filter(leaf => keys.some(k => leaf.corners.has(k)));
    const leaf = found[0] ?? { corners: new Set(), triangles: [] };
    for (const other of found.slice(1)) { other.corners.forEach(k => leaf.corners.add(k)); leaf.triangles.push(...other.triangles); leaves.delete(other); }
    keys.forEach(k => leaf.corners.add(k)); leaf.triangles.push(triangle);
    leaves.set(leaf, leaf);
  }
  const whole = [...leaves.values()].filter(leaf => leaf.triangles.length === 3);
  assert.ok(whole.length >= 20, `${whole.length} hojas enteras`);
  const sizes = [];
  for (const leaf of whole) {
    assert.equal(leaf.corners.size, 5, 'punta, dos hombros y una base redonda: no es un rombo');
    const pts = leaf.triangles.flatMap(({ points }) => points);
    sizes.push(Math.max(...pts.flatMap(a => pts.map(b => Math.hypot(a[0] - b[0], a[2] - b[2])))));
  }
  assert.ok(Math.max(...sizes) > 2.5 * Math.min(...sizes), `tamaños de ${Math.min(...sizes).toFixed(2)} a ${Math.max(...sizes).toFixed(2)} m`);
  for (const { ids, grass } of leafTriangles) for (const i of ids) {
    // Prado y tierra andan por un valor de 0,3; la losa del andén, por 0,5.
    assert.ok(value(i) <= (grass ? .32 : .42), `hoja de valor ${value(i).toFixed(2)} sobre ${grass ? 'el prado' : 'el andén'}`);
  }
});
