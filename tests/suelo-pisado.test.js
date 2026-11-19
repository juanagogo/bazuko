// Lo que no se mueve al ensuciar la tierra de El Cartucho y los andenes: el azar del juego, lo que cada
// textura ya pintaba con su semilla, las demás texturas y las mallas del suelo y del sardinel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as TX from '../src/world/bogota/textures.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { addStreetDetails } from '../src/world/bogota/StreetDetails.js';
import { activateSunField } from '../src/world/bogota/SunField.js';

// Lienzo que anota cada orden de dibujo, para comparar lo pintado sin pintar nada.
function recordingDocument() {
  return {
    createElement() {
      const log = [];
      const gradient = () => ({ addColorStop: (...args) => log.push(['stop', ...args]) });
      const context = new Proxy({}, {
        get(_, key) {
          if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => { log.push([key, ...args]); return gradient(); };
          if (key === 'measureText') return text => ({ width: String(text).length * 7 });
          if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
          return (...args) => { log.push([key, ...args.map(a => typeof a === 'function' ? 'fn' : a)]); };
        },
        set(_, key, value) { log.push(['=', key, typeof value === 'object' ? 'gradiente' : value]); return true; }
      });
      return { width: 0, height: 0, getContext: () => context, log };
    }
  };
}

function recorded(build) {
  const previous = globalThis.document, random = Math.random;
  let draws = 0;
  globalThis.document = recordingDocument();
  Math.random = () => { draws++; return random(); };
  try { return { maps: build(), draws }; } finally { globalThis.document = previous; Math.random = random; }
}

const huella = entries => createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
const sinEstilo = log => log.filter(entry => entry[0] !== '=');
const comienzo = (log, length) => {
  assert.ok(log.length >= length, `se pinta al menos lo de antes (${log.length} de ${length})`);
  return huella(log.slice(0, length));
};

test('la tierra solo gasta el azar del juego en sus tres texturas y lo de antes cae en el mismo sitio', () => {
  const { maps, draws } = recorded(() => TX.dirt(31));
  assert.equal(draws, 24, 'tres identificadores de textura');
  // Los granos cambian de tono, no de sitio ni de tamaño: sin contar los colores, lo de antes es idéntico.
  assert.equal(comienzo(sinEstilo(maps.map.image.log), 19449), '1b2d1b2d99ca79ee');
  assert.equal(comienzo(maps.bumpMap.image.log, 38322), '1e46a9e5ca79c11b');
  assert.equal(comienzo(maps.roughnessMap.image.log, 236), '733f274e23e79a2d');
});

test('el andén de cada barrio pinta lo de antes igual y gasta el mismo azar', () => {
  const antes = {
    centro: '7533288516575c13', cambuche: '340bacda75414f7e', comercio: '6f345b9d1aa69cde', lago: '905c4118e5feda62', chapinero: '5de8d8dbe52c5000'
  };
  for (const [district, color] of Object.entries(antes)) {
    const { maps, draws } = recorded(() => district === 'centro' ? TX.sidewalk(11) : TX.sidewalk(11, { district }));
    assert.equal(draws, 24, district);
    assert.equal(comienzo(maps.map.image.log, 8182), color, `${district}: color`);
    assert.equal(comienzo(maps.bumpMap.image.log, 385), '2cf5244684c7a1b7', `${district}: relieve`);
    assert.equal(comienzo(maps.roughnessMap.image.log, 364), 'd0d393ef0993c869', `${district}: rugosidad`);
  }
});

test('las demás texturas del suelo y de la ciudad no cambian', () => {
  const huellas = {
    asphalt: [() => TX.asphalt(7), '09596ff50b9dc9b5'],
    concrete: [() => TX.concrete(41), '3f0e21991c1e919d'], brick: [() => TX.brick(3), 'ec761f9367d7cdf6'],
    slab: [() => TX.slab(13), '57e0806a2ace8325'], cardboard: [() => TX.cardboard(21), '4491e78858d4a581'],
  };
  for (const [name, [create, expected]] of Object.entries(huellas)) {
    const { maps } = recorded(create);
    assert.equal(huella(Object.values(maps).filter(t => t?.isTexture).map(t => t.image.log)), expected, name);
  }
});

test('el dibujo denso del césped se repite con su semilla y gasta los mismos tres mapas', () => {
  const { maps, draws } = recorded(() => TX.grass(61));
  assert.equal(draws, 24, 'tres identificadores de textura');
  assert.equal(huella(Object.values(maps).map(t => t.image.log)), 'c94b5a89a99e610d');
});

test('el suelo de la ciudad conserva sus mallas, sus materiales y el azar que gasta', () => {
  const random = Math.random, seeded = TX.rng(7);
  let draws = 0, city;
  Math.random = () => { draws++; return seeded(); };
  try {
    city = new Bogota();
    city.map = city._layout();
    draws = 0;
    city._buildGround(city.map);
  } finally { Math.random = random; }
  // El paseo de los parques aporta su material, sus sectores y el borde contra el césped.
  assert.equal(draws, 111608);
  const { sidewalk_calle72: landingMaterial, ...previousMaterials } = city.groundMaterials;
  assert.deepEqual(Object.keys(previousMaterials), ['road', 'busway', 'sidewalk', 'floor', 'dirt', 'grass', 'plaza', 'water',
    'sidewalk_cambuche', 'sidewalk_comercio', 'sidewalk_lago', 'plaza_parque', 'road_cobbles', 'sidewalk_candelaria', 'plaza_candelaria',
    'sidewalk_chapinero', 'curb', 'curb_stone']);
  const landing = city.group.getObjectByName('Andén peatonal de Calle 72');
  assert.ok(landing);
  assert.equal(landing.material, landingMaterial);
  assert.equal(landingMaterial.map, previousMaterials.floor.map);
  assert.equal(landingMaterial.bumpMap, previousMaterials.floor.bumpMap);
  assert.equal(landing.geometry.attributes.position.count, 728);
  assert.equal(landing.geometry.index.count, 1092);
  const reeds = city.lakeWater.children.find(object => object.isMesh && object.name === 'Juncos y eneas de la orilla del lago');
  assert.equal(reeds, undefined, 'la superficie original del lago todavía está despejada');
  let meshes = 0, vertices = 0, indices = 0;
  city.group.traverse(object => {
    // La lámina del agua forma parte del suelo. El andén de Calle 72 se contó por separado.
    if (!object.isMesh || object === landing) return;
    meshes++; vertices += object.geometry.attributes.position.count; indices += object.geometry.index?.count ?? 0;
  });
  assert.deepEqual({ meshes, vertices, indices }, { meshes: 473, vertices: 121416, indices: 227538 });
});

test('el sardinel pintado cambia de tono, no de geometría ni de choques', () => {
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  Object.assign(city, { props: [], treePlan: [], vegetationPlan: { clusters: [] }, vendors: [], fireBarrels: [],
    signals: { poles: [] }, renderSectors: [], isNearReserved: () => false, buildingVisibility: { buildings: [] } });
  const collisions = { colliders: [], queryStatic: () => [] };
  addStreetDetails(city, collisions);
  assert.equal(collisions.colliders.length, 0);
  let meshes = 0, vertices = 0, indices = 0;
  city.group.traverse(object => {
    if (!object.isMesh || object.name !== 'Calle') return;
    meshes++; vertices += object.geometry.attributes.position.count; indices += object.geometry.index?.count ?? 0;
  });
  // El lote Calle incluye el borde de césped del parque, con el paseo original alrededor del lago.
  assert.deepEqual({ meshes, vertices, indices }, { meshes: 34, vertices: 339956, indices: 553281 });
  activateSunField(null);
});

test('la tierra entra al programa del andén y lee la máscara de desgaste que ya existe: sin programa ni textura nuevos', () => {
  const city = new Bogota();
  city.map = city._layout();
  city._buildGround(city.map);
  const { dirt, sidewalk, grass } = city.groundMaterials;
  assert.equal(dirt.customProgramCacheKey(), sidewalk.customProgramCacheKey(), 'el mismo programa que los andenes');
  assert.equal(dirt.color.getHexString(), 'b3a690');
  const compiled = material => {
    const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '#include <map_fragment>\n#include <lights_fragment_begin>' };
    material.onBeforeCompile(shader);
    return shader;
  };
  const tierra = compiled(dirt), anden = compiled(sidewalk), prado = compiled(grass);
  assert.equal(tierra.uniforms.uPavingKind.value, 4);
  assert.ok(tierra.uniforms.uGroundWear.value?.isTexture);
  assert.equal(tierra.uniforms.uGroundWear.value, prado.uniforms.uGroundWear.value, 'la máscara del prado, no una nueva');
  assert.equal(anden.uniforms.uGroundWear, tierra.uniforms.uGroundWear, 'un solo uniforme por mapa');
  assert.match(tierra.fragmentShader, /dirtTone/);
});

