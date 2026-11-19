// Los locales de noche: qué celdas del atlas alumbran, quién las prende, qué luz dejan en el andén y los bombillos del mercado.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { TILE_SIZE as T } from '../src/utils/constants.js';

const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), roughnessMap: null, emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { OFICIOS } = await import('../src/world/bogota/Locales.js');
const { MUROS, PERSIANAS } = await import('../src/world/bogota/textures-locales.js');
const { STATIC_CHUNK_SIZE } = await import('../src/world/bogota/StaticGeometry.js');
const { StreetBatch } = await import('../src/world/bogota/StreetBatch.js');
const { detailAtlas } = await import('../src/world/bogota/textures-calle.js');
const { buildMarket } = await import('../src/world/bogota/EastLandmarks.js');
const { MARKET } = await import('../src/world/bogota/EastZones.js');
const { LUCES, LUZ_LOCALES, addShopPools, celdaDeLuz, colgarBombillos, encenderVitrinas, mascaraDeVitrinas, puestosDelMercado } = await import('../src/world/bogota/vitrinas.js');

const warn = console.warn;
console.warn = () => {};
const city = new Bogota();
city.build(new THREE.Scene(), new CollisionSystem());
await city.preloadDetails();
console.warn = warn;

const VIDA = 'Vida de fachadas y azoteas', HUMEDAD = 'Humedad de fachadas';

function ciudadDePrueba() {
  const vida = new THREE.MeshStandardMaterial({ name: VIDA }), cerrada = vida.clone(), pared = new THREE.MeshStandardMaterial({ name: 'Pared' });
  // Un local sin relieve va pintado en la malla de la humedad.
  const humedad = new THREE.MeshStandardMaterial({ name: HUMEDAD, transparent: true });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), vida), new THREE.Mesh(new THREE.PlaneGeometry(1, 1), [pared, vida]), new THREE.Mesh(new THREE.PlaneGeometry(1, 1), humedad));
  return { vida, cerrada, pared, humedad, group, facadeMats: [], props: [], buildingVisibility: { closedMaterials: new Map([['a', cerrada]]) } };
}

/** Lienzo de mentira que anota dónde se pinta. */
function conLienzo(probar) {
  const pintado = [], nada = () => {}, degradado = { addColorStop: nada };
  const ctx = new Proxy({}, {
    get: (_, clave) => /^create.*Gradient$/.test(String(clave)) ? () => degradado
      : clave === 'fillRect' ? (...r) => pintado.push(r)
        : clave === 'drawImage' ? (_imagen, ...r) => pintado.push(r.slice(4)) : nada,
    set: () => true
  });
  const antes = globalThis.document;
  detailAtlas().texture.dispose();
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try { return probar(pintado); } finally {
    mascaraDeVitrinas()?.dispose();
    detailAtlas().texture.dispose();
    globalThis.document = antes;
  }
}

/** Andén de dos tiles al sur de una fachada que mira hacia +z, con la calzada después. */
function cuadra() {
  const fila = tipo => Array.from({ length: 12 }, () => tipo);
  const map = [fila('building'), fila('building'), fila('sidewalk'), fila('sidewalk'), fila('road'), fila('road')];
  return { map, getGroundHeight: (_x, z) => map[Math.round(z / T)]?.[0] === 'sidewalk' ? .12 : 0 };
}

function cuadros(batch) {
  const lista = [];
  for (const { p, c, u } of batch.chunks.values()) for (let i = 0; i < p.length / 12; i++) {
    lista.push({ x0: p[i * 12], x1: p[i * 12 + 3], y: p[i * 12 + 1], z0: p[i * 12 + 8], z1: p[i * 12 + 2], color: c.slice(i * 12, i * 12 + 3), uv: u.slice(i * 8, i * 8 + 8) });
  }
  return lista;
}

test('cada puesto del mercado cuelga un bombillo que solo brilla de noche, en una malla que no gasta el azar de la ciudad', () => {
  const puestos = puestosDelMercado(), mesas = buildMarket({ detail: new THREE.MeshStandardMaterial() }).colliders;
  assert.equal(puestos.length, mesas.length);
  puestos.forEach((puesto, i) => {
    assert.ok(Math.abs(puesto.x - mesas[i].x) <= .151 && Math.abs(puesto.z - mesas[i].z) < 1e-9, `el puesto ${i} está donde su mesa`);
    assert.equal(puesto.frente, puesto.z < (MARKET.z0 + MARKET.z1) / 2 * T ? 1 : -1, 'las dos filas se miran');
  });
  const padre = new THREE.Group(), delJuego = Math.random;
  let gastados = 0, malla;
  Math.random = () => { gastados++; return delJuego(); };
  try { malla = colgarBombillos(padre); } finally { Math.random = delJuego; }
  assert.equal(gastados, 0);
  assert.deepEqual(padre.children, [malla]);
  assert.ok(malla.userData.noMerge && !malla.castShadow);
  const { position, color } = malla.geometry.attributes, caja = malla.geometry.boundingBox;
  assert.equal(color.itemSize, 4, 'el cuarto canal dice cuánto brilla cada cara');
  assert.ok(position.count / 3 <= 700, `${position.count / 3} triángulos`);
  let brillan = 0;
  for (let i = 0; i < color.count; i++) {
    if (!color.getW(i)) continue;
    brillan++;
    assert.equal(color.getW(i), Math.fround(LUZ_LOCALES.bombillo));
    assert.ok(position.getY(i) > 1.75 && position.getY(i) < 2.05, 'la bombilla cuelga sobre la mercancía, por encima de la cabeza');
    const puesto = puestos.find(cada => Math.abs(cada.x - position.getX(i)) < 1 && Math.abs(cada.z - position.getZ(i)) < 1.1);
    assert.ok(puesto && Math.abs(position.getZ(i) - puesto.z) > .8, 'del lado del pasillo, fuera de la mesa');
  }
  assert.equal(brillan, 6 * 80 * 3, 'seis bombillas; cables y casquillos no brillan');
  assert.ok(caja.max.y <= 2.45 && caja.min.x > MARKET.x0 * T && caja.max.x < MARKET.x1 * T && caja.min.z > MARKET.z0 * T && caja.max.z < MARKET.z1 * T);
  assert.equal(malla.material.emissiveIntensity, .05, 'de día casi no brilla');
  malla.onBeforeRender(null, { userData: { environmentDay: 0 } });
  assert.equal(malla.material.emissiveIntensity, 1);
  malla.onBeforeRender(null, { userData: { environmentDay: 1 } });
  assert.ok(Math.abs(malla.material.emissiveIntensity - .05) < 1e-9);
});

test('en la ciudad entera la luz de los locales va en el lote de los faroles, sin trozos ni materiales de más', () => {
  assert.ok(city.vitrinas.length > 60, `${city.vitrinas.length} locales con luz`);
  assert.ok(city.vitrinas.every(local => local.estado === 'abierta' || local.estado === 'media'), 'una persiana abajo no alumbra');
  assert.ok(city.vitrinas.some(local => local.estado === 'media'));
  assert.ok(new Set(city.vitrinas.map(local => local.interior)).size >= 10, 'hay de todos los oficios');
  for (const local of city.vitrinas) assert.ok(LUCES[local.interior] && Math.abs(local.dx) + Math.abs(local.dz) === 1);
  assert.equal(city.puestos.length, city.vendors.length, 'cada puesto de calle alumbra su piso');
  assert.ok(city.puestos.some(puesto => puesto.kind === 'fritanga') && city.puestos.some(puesto => puesto.kind === 'chaza'));

  const mallas = [];
  city.group.traverse(mesh => { if (mesh.name === 'Luz de faroles' && mesh.material?.name === 'Calle: luz de faroles') mallas.push(mesh); });
  assert.equal(new Set(mallas.map(mesh => mesh.material)).size, 1);
  // Los mismos trozos de antes: un trozo que solo tuviera luz de locales sería una malla más y gastaría el azar de la ciudad.
  const lado = STATIC_CHUNK_SIZE * 4, solos = new StreetBatch({ material: mallas[0].material, chunkSize: lado });
  const pintados = addShopPools(solos, city);
  assert.ok(pintados >= city.vitrinas.length + city.puestos.length + 6);
  const enLaPlaza = [...solos.chunks.values()].flatMap(trozo => trozo.p.filter((_v, i) => i % 12 === 0).map((x, i) => [x, trozo.p[i * 12 + 2]]))
    .filter(([x, z]) => x > MARKET.x0 * T - 2 && x < MARKET.x1 * T + 2 && z > MARKET.z0 * T - 2 && z < MARKET.z1 * T + 2);
  assert.ok(enLaPlaza.length >= 6, 'la plaza de mercado tiene luz en el piso');
  const bombillos = [];
  city.group.traverse(mesh => { if (mesh.name === 'Bombillos del mercado') bombillos.push(mesh); });
  assert.equal(bombillos.length, 1, 'una sola malla para los seis bombillos');
  assert.match(bombillos[0].parent.name, /^Sector /, 'va con la calle: se deja de dibujar de lejos');
  const cuadrosPorTrozo = new Map(mallas.map(mesh => {
    const p = mesh.geometry.attributes.position;
    // Los vértices guardan menos cifras que la cuenta del lote: un farol justo en la raya del trozo se corre un pelo.
    const trozo = (a, b) => Math.floor(((a + b) / 2 + 1e-3) / lado);
    return [`${trozo(p.getX(0), p.getX(2))},${trozo(p.getZ(0), p.getZ(2))}`, p.count / 4];
  }));
  assert.equal(cuadrosPorTrozo.size, mallas.length);
  for (const [clave, trozo] of solos.chunks) {
    assert.ok(cuadrosPorTrozo.get(clave) > trozo.p.length / 12, `el trozo ${clave} ya llevaba luz de farol`);
  }
  assert.ok(pintados <= city.vitrinas.length * 12, `${pintados} cuadros por ${city.vitrinas.length} locales`);
});
