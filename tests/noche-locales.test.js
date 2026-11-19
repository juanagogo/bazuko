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
const { StreetBatch } = await import('../src/world/bogota/StreetBatch.js');
const { detailAtlas } = await import('../src/world/bogota/textures-calle.js');
const { LUCES, LUZ_LOCALES, addShopPools, celdaDeLuz, colgarBombillos, encenderVitrinas, mascaraDeVitrinas, puestosDelMercado } = await import('../src/world/bogota/vitrinas.js');

const warn = console.warn;
console.warn = () => {};
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

test('sin lienzo no hay máscara y ninguna fachada cambia', () => {
  const ciudad = ciudadDePrueba();
  assert.equal(mascaraDeVitrinas(), null);
  assert.equal(encenderVitrinas(ciudad), 0);
  assert.equal(ciudad.vida.emissiveMap, null);
  assert.equal(ciudad.vida.userData.windowGlow, undefined);
  assert.deepEqual(ciudad.facadeMats, []);
});

test('cada interior de local tiene su luz y no todas son iguales', () => {
  for (const { id, interior } of OFICIOS) assert.ok(LUCES[interior], `${id} alumbra su ${interior}`);
  const luces = Object.values(LUCES);
  assert.ok(new Set(luces.map(luz => luz.tono[0])).size >= 4, 'hay bombillo, tubo, pantallas y más');
  assert.ok(luces.some(luz => luz.forma === 'medias') && luces.some(luz => luz.forma === 'bombillo'), 'algunas alumbran a medias');
  assert.ok(Math.min(...luces.map(luz => luz.fuerza)) <= .6 && Math.max(...luces.map(luz => luz.fuerza)) === 1);
  for (const luz of luces) for (const tono of luz.tono) assert.notEqual(tono.toLowerCase(), '#ffffff', 'ninguna luz es blanca limpia');
});

test('pintar la máscara no gasta el azar de la ciudad y solo deja luz tras las vitrinas', () => {
  conLienzo(pintado => {
    const atlas = detailAtlas();
    assert.deepEqual([atlas.texture.image.width, atlas.texture.image.height], [2048, 1024]);
    pintado.length = 0;
    const delJuego = Math.random;
    let gastados = 0, mascara;
    Math.random = () => { gastados++; return delJuego(); };
    try { mascara = mascaraDeVitrinas(); } finally { Math.random = delJuego; }
    assert.ok(mascara.isTexture);
    assert.equal(gastados, 0);
    assert.equal(mascaraDeVitrinas(), mascara, 'se pinta una sola vez');
    assert.deepEqual([mascara.image.width, mascara.image.height], [1024, 512], 'la mitad del atlas');
    assert.deepEqual(pintado.shift(), [0, 0, 1024, 512], 'primero todo queda negro');
    const celdas = Object.keys(LUCES).map(nombre => celdaDeLuz(nombre, 1024, 512));
    assert.deepEqual(celdaDeLuz('abarrotes', 1024, 512), [0, 256, 64, 64]);
    assert.deepEqual(celdaDeLuz('reja', 1024, 512), [512 + 448, 96, 64, 80]);
    for (const trazo of pintado) assert.ok(celdas.some(celda => celda.every((v, i) => v === trazo[i])), `trazo fuera de una vitrina: ${trazo}`);
    for (const celda of celdas) assert.ok(pintado.filter(trazo => trazo.every((v, i) => v === celda[i])).length >= 4, 'copia, lámpara, caída y sombra');
    const dentro = ([u0, v0, u1, v1]) => {
      const x = (u0 + u1) / 2 * 1024, y = (1 - (v0 + v1) / 2) * 512;
      return celdas.some(([cx, cy, w, h]) => x >= cx && x < cx + w && y >= cy && y < cy + h);
    };
    const apagadas = [...MUROS, ...PERSIANAS, ...OFICIOS.map(oficio => `rot_${oficio.id}`), 'nevera', 'afiches', 'arrienda', 'vende',
      'toldoVerde', 'toldoLona', 'zinc', 'awning', 'awning2', 'meter', 'tank', 'concrete', 'canvas', 'door', 'door2', 'cruz', 'barbero'];
    for (const nombre of apagadas) assert.ok(!dentro(atlas.uv[nombre]), `${nombre} no alumbra`);
    for (const nombre of Object.keys(LUCES)) assert.ok(dentro(atlas.uv[nombre]), `${nombre} alumbra`);
  });
});

test('la ciudad prende y apaga las vitrinas, casa por casa y en la vista agrupada', () => {
  conLienzo(() => {
    const ciudad = ciudadDePrueba();
    assert.equal(encenderVitrinas(ciudad), 3);
    const mascara = mascaraDeVitrinas();
    for (const material of [ciudad.vida, ciudad.cerrada, ciudad.humedad]) {
      assert.equal(material.emissiveMap, mascara);
      assert.equal(material.emissiveIntensity, 0, 'nace apagada');
      assert.equal(material.emissive.getHexString(), 'ffffff');
      assert.ok(ciudad.facadeMats.includes(material));
    }
    assert.equal(ciudad.pared.emissiveMap, null);
    assert.equal(ciudad.facadeMats.length, 3);
    encenderVitrinas(ciudad);
    assert.equal(ciudad.facadeMats.length, 3, 'no se anotan dos veces');
    Bogota.prototype.setNightMode.call(ciudad, true);
    assert.deepEqual([ciudad.vida.emissiveIntensity, ciudad.cerrada.emissiveIntensity, ciudad.humedad.emissiveIntensity], [LUZ_LOCALES.vitrina, LUZ_LOCALES.vitrina, LUZ_LOCALES.vitrina]);
    assert.ok(ciudad.humedad.transparent, 'la humedad sigue siendo translúcida');
    Bogota.prototype.setNightMode.call(ciudad, false);
    assert.deepEqual([ciudad.vida.emissiveIntensity, ciudad.cerrada.emissiveIntensity, ciudad.pared.emissiveIntensity], [0, 0, 1]);
  });
});

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

test('cada local abierto deja media mancha de luz que sale de la fachada y sigue la altura del andén', () => {
  const frente = { x: 5 * T, z: 1.5 * T, dx: 0, dz: 1, ancho: 3 };
  const pintar = vitrinas => {
    const batch = new StreetBatch({ material: new THREE.MeshBasicMaterial(), name: 'Luz de faroles' });
    addShopPools(batch, { ...cuadra(), vitrinas });
    return cuadros(batch);
  };
  assert.deepEqual(pintar([]), []);
  const abierta = pintar([{ ...frente, estado: 'abierta', interior: 'abarrotes' }]);
  assert.ok(abierta.length >= 4);
  const hondo = LUZ_LOCALES.fondoAnden, medio = 1.5 + LUZ_LOCALES.margenAnden;
  for (const q of abierta) {
    assert.ok(q.z0 >= frente.z - 1e-9 && q.z1 <= frente.z + hondo + 1e-9, 'nunca se mete en la casa');
    assert.ok(q.x0 >= frente.x - medio - 1e-9 && q.x1 <= frente.x + medio + 1e-9);
    assert.equal(q.y, q.z0 < 3.5 * T ? .15 : .03, 'sobre el andén o sobre la calzada');
    for (const v of q.uv) assert.ok(v >= 0 && v <= 1);
  }
  // En la fachada cae el centro de la mancha, lo más claro; hacia el sardinel, el borde.
  const pegado = abierta.find(q => q.z0 === frente.z && q.x0 < frente.x && q.x1 >= frente.x);
  assert.ok(Math.abs(pegado.uv[7] - .5) < 1e-9, 'la fachada cae en la mitad de la textura');
  const lejos = Math.max(...abierta.map(q => q.z1));
  assert.ok(Math.abs(lejos - (frente.z + hondo)) < 1e-9);

  const media = pintar([{ ...frente, estado: 'media', interior: 'abarrotes' }]);
  assert.equal(media.length, abierta.length);
  assert.ok(Math.abs(media[0].color[0] / abierta[0].color[0] - LUZ_LOCALES.mediaPersiana) < 1e-6, 'la persiana a medio bajar deja pasar la mitad');

  const fria = pintar([{ ...frente, estado: 'abierta', interior: 'farmacia' }])[0].color, calida = abierta[0].color;
  assert.ok(fria[2] / fria[0] > calida[2] / calida[0] * 1.3, 'la droguería alumbra más frío que la tienda');
  const floja = pintar([{ ...frente, estado: 'abierta', interior: 'chatarra' }])[0].color;
  assert.ok(floja[0] < calida[0] * .85, 'un bombillo solo alumbra menos el andén');
  for (const q of abierta) assert.ok(Math.max(...q.color) <= .35, 'la mancha no quema el andén');
});

test('cada puesto de calle deja una mancha redonda bajo su bombillo, más ancha y más floja la de la fritanga', () => {
  const pintar = puestos => {
    const batch = new StreetBatch({ material: new THREE.MeshBasicMaterial(), name: 'Luz de faroles' });
    addShopPools(batch, { ...cuadra(), puestos });
    return cuadros(batch);
  };
  const chaza = pintar([{ x: 5 * T, z: 3 * T, kind: 'chaza' }]), fritanga = pintar([{ x: 5 * T, z: 3 * T, kind: 'fritanga' }]);
  const ancho = lista => Math.max(...lista.map(q => q.x1)) - Math.min(...lista.map(q => q.x0));
  assert.ok(Math.abs(ancho(chaza) - LUZ_LOCALES.radioChaza * 2) < 1e-9 && Math.abs(ancho(fritanga) - LUZ_LOCALES.radioFritanga * 2) < 1e-9);
  assert.ok(fritanga[0].color[0] < chaza[0].color[0]);
  for (const q of [...chaza, ...fritanga]) {
    assert.ok(q.z0 >= 1.5 * T - 1e-9, 'no se mete bajo las casas');
    assert.ok(Math.max(...q.color) <= .2);
  }
});


