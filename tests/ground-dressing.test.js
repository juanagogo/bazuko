import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { addStreetDetails } from '../src/world/bogota/StreetDetails.js';
import { buildGroundWear, dressGrass, dressPaving } from '../src/world/bogota/GroundDressing.js';
import { sunFieldUniforms } from '../src/world/bogota/SunField.js';
import { GRASS_TILE_METERS } from '../src/world/bogota/textures.js';
import { DETAIL_UV } from '../src/world/bogota/textures-calle.js';
import { BAND_INSIDE, BAND_REACH, OLD_PAVING_ZONES, PAVING_KINDS, buildPavingBands, pavingBandsOf } from '../src/world/bogota/PavingBands.js';
import { MARKS_PER_METER, buildPavingMarks, curbRamps, markTreePits, pavingMarksOf } from '../src/world/bogota/PavingBands.js';

const T = 2;

function lawn(size = 12) {
  return Array.from({ length: size }, (_, z) => Array.from({ length: size }, (_, x) =>
    x === 0 || z === 0 || x === size - 1 || z === size - 1 ? 'sidewalk' : 'grass'));
}

const fakeShader = () => ({
  uniforms: {},
  vertexShader: '#include <project_vertex>',
  fragmentShader: '#include <map_fragment>\n#include <lights_fragment_begin>\n#include <aomap_fragment>',
});

test('el desgaste sale del mapa: pasto intacto en el centro y pisado contra el andén', () => {
  const texture = buildGroundWear(lawn());
  const { width, height } = texture.image, at = (x, z) => texture.image.data[(z + T / 2) * width + (x + T / 2)];
  assert.equal(width, 24);
  assert.equal(height, 24);
  assert.equal(at(11, 11), 0, 'el medio del prado no se gasta');
  assert.ok(at(1, 11) > 60, 'junto al andén sí');
  assert.ok(at(1, 11) > at(4, 11), 'y se desvanece hacia adentro');
});

test('los redondeles y las trochas suman desgaste solo donde se piden', () => {
  const plain = buildGroundWear(lawn()), at = (texture, x, z) => texture.image.data[(z + 1) * texture.image.width + (x + 1)];
  const camp = buildGroundWear(lawn(), { spots: [{ x: 11, z: 11, radius: 3, amount: .4 }] });
  assert.ok(at(camp, 11, 11) > at(plain, 11, 11) + 60);
  assert.equal(at(camp, 11, 4), at(plain, 11, 4));
  const trail = buildGroundWear(lawn(), { trails: [{ from: [6, 11], to: [16, 11], width: 1.5, amount: .4 }] });
  assert.ok(at(trail, 11, 11) > 60);
  assert.equal(at(trail, 11, 16), at(plain, 11, 16));
});

test('pasto y andén comparten el ruido de la cúpula sin una textura propia y conservan el campo de sol', () => {
  const grass = new THREE.MeshStandardMaterial(), wear = buildGroundWear(lawn());
  dressGrass(grass, wear);
  const shader = fakeShader();
  grass.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uGroundWear.value, wear);
  assert.equal(shader.uniforms.uSunCloud, sunFieldUniforms.uSunCloud);
  assert.match(shader.fragmentShader, /groundTrod/);
  assert.match(shader.fragmentShader, /vSunFieldPos/);
  assert.match(grass.customProgramCacheKey(), /campo-sol/);
  const paving = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
  paving.forEach(dressPaving);
  assert.equal(paving[0].customProgramCacheKey(), paving[1].customProgramCacheKey(), 'un solo programa para todos los andenes');
  const walk = fakeShader();
  paving[0].onBeforeCompile(walk);
  assert.match(walk.fragmentShader, /pavingStain/);
});

/** Una calle de dos tiles entre dos andenes anchos: calzada en x 8–11 (los tiles 4 y 5). */
function street(size = 12) {
  return Array.from({ length: size }, () => Array.from({ length: size }, (_, x) => x === 4 || x === 5 ? 'road' : 'sidewalk'));
}

test('la máscara de franjas mide la distancia a la calzada, un texel por metro', () => {
  const texture = buildPavingBands(street()), { width, height, data } = texture.image;
  assert.equal(width, 24);
  assert.equal(height, 24);
  assert.deepEqual(texture.userData, { width: 24, depth: 24 });
  // El texel `i` tiene el centro en i − 1,5 m; la calzada va de x 7 a x 11.
  const meters = x => data[(12 * width + x) * 2] / 255 * (BAND_REACH + BAND_INSIDE) - BAND_INSIDE;
  assert.equal(data.length, width * height * 2, 'dos canales: distancia y andén viejo');
  assert.equal(data[(12 * width + 10) * 2], 0, 'dentro de la calzada vale cero');
  assert.ok(Math.abs(meters(7) - .5) < .02, `medio metro andén adentro: ${meters(7)}`);
  assert.ok(Math.abs(meters(5) - 2.5) < .02, `dos metros y medio: ${meters(5)}`);
  assert.ok(Math.abs(meters(13) - 1.5) < .02, `y del otro lado de la calle: ${meters(13)}`);
  assert.equal(data[(12 * width + 23) * 2], 255, 'lejos de la calzada se queda en el tope');
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.magFilter, THREE.LinearFilter);
});

test('el andén viejo va en el segundo canal: lleno dentro de la zona, nada lejos y difuminado en el borde', () => {
  const texture = buildPavingBands(street(), { oldZones: [{ x0: -1, x1: 9, z0: -1, z1: 23 }] }), { width, data } = texture.image;
  const old = x => data[(12 * width + x) * 2 + 1];
  assert.equal(old(3), 255);
  assert.equal(old(20), 0);
  assert.ok(old(10) > 60 && old(10) < 200, `borde: ${old(10)}`);
  assert.ok(old(9) > old(11), 'y baja hacia afuera');
  const none = buildPavingBands(street(), { oldZones: [] }).image.data;
  assert.ok(none.every((value, i) => i % 2 === 0 || value === 0));
  // El Cartucho, en metros: la manzana (26–56 por 38–72) y tres metros de calzada por cada lado.
  assert.deepEqual({ ...OLD_PAVING_ZONES[0] }, { x0: 23, x1: 59, z0: 35, z1: 75 });
});

test('la máscara de franjas no gasta el azar del juego y se calcula una vez por mapa', () => {
  const original = Math.random;
  let draws = 0;
  Math.random = () => { draws++; return original(); };
  try {
    const map = street(), bands = pavingBandsOf(map);
    assert.equal(pavingBandsOf(map), bands, 'la misma textura para todos los andenes del mapa');
    assert.notEqual(buildPavingBands(map).uuid, bands.uuid);
    pavingBandsOf();
  } finally { Math.random = original; }
  assert.equal(draws, 0);
});

test('cada andén toma su acabado por uniformes, sin partir el programa, y la Candelaria queda como estaba', () => {
  const map = street(), compiled = key => {
    const material = new THREE.MeshStandardMaterial(), shader = fakeShader();
    dressPaving(material, { map, key });
    material.onBeforeCompile(shader);
    return { material, shader };
  };
  const kinds = Object.fromEntries(Object.keys(PAVING_KINDS).map(key => [key, compiled(key)]));
  const keys = new Set(Object.values(kinds).map(({ material }) => material.customProgramCacheKey()));
  assert.equal(keys.size, 1, 'un solo programa para todos los acabados');
  for (const key of ['sidewalk', 'sidewalk_comercio', 'sidewalk_lago', 'sidewalk_chapinero']) assert.equal(kinds[key].shader.uniforms.uPavingKind.value, 2, key);
  assert.equal(kinds.sidewalk_cambuche.shader.uniforms.uPavingKind.value, 1);
  assert.equal(kinds.plaza.shader.uniforms.uPavingKind.value, 3);
  for (const key of ['sidewalk_candelaria', 'plaza_candelaria']) assert.equal(kinds[key].shader.uniforms.uPavingKind.value, 0, key);
  const { shader } = kinds.sidewalk;
  assert.equal(shader.uniforms.uPavingBands.value, pavingBandsOf(map));
  assert.equal(shader.uniforms.uPavingBandsScale.value.x, 1 / 24);
  for (const name of ['uPavingBands', 'uPavingKind', 'pavingClay', 'pavingHash', 'pavingStain', 'pavingAge', 'vSunFieldPos']) assert.match(shader.fragmentShader, new RegExp(name));
  // Lo pintado encima de la losa sale del color del material: es lo que la lluvia oscurece.
  assert.match(shader.fragmentShader, /pavingWet = dot\( diffuse,/);
  // Al soltar los andenes la máscara se libera una sola vez, y un mapa que se vuelve a vestir estrena otra.
  let released = 0;
  const bands = pavingBandsOf(map);
  bands.addEventListener('dispose', () => released++);
  for (const { material } of Object.values(kinds)) material.dispose();
  assert.equal(released, 1);
  assert.notEqual(pavingBandsOf(map), bands);
  // Sin mapa ni clave (un material suelto) no hay acabado ni calzada cerca.
  const loose = new THREE.MeshStandardMaterial(), plain = fakeShader();
  dressPaving(loose);
  loose.onBeforeCompile(plain);
  assert.equal(plain.uniforms.uPavingKind.value, 0);
  assert.equal(plain.uniforms.uPavingBands.value.image.data[0], 255);
});

test('la arcilla es solo del andén: plazas y senderos de parque van con su propia losa', () => {
  const material = new THREE.MeshStandardMaterial(), shader = fakeShader();
  dressPaving(material, { map: street(), key: 'plaza' });
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uPavingKind.value, 3);
  const plaza = shader.fragmentShader.match(/if \( uPavingKind > 2\.5 \) \{([\s\S]*?)\} else \{/)[1];
  assert.doesNotMatch(plaza, /pavingBrick|pavingClay/, 'la plaza no se pinta de arcilla');
  assert.match(plaza, /diffuseColor\.rgb \*= .*pavingSlab/, 'cada losa de la plaza con su tono, sobre su propio color');
});

test('la guía táctil es loseta de barras, de un ocre apagado, y de lejos no titila', () => {
  const material = new THREE.MeshStandardMaterial(), shader = fakeShader();
  dressPaving(material, { map: street(), key: 'sidewalk' });
  material.onBeforeCompile(shader);
  const glsl = shader.fragmentShader;
  const [r, g, b] = glsl.match(/vec3 pavingOchre = vec3\( ([\d.]+), ([\d.]+), ([\d.]+) \)/).slice(1).map(Number);
  const saturacion = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
  assert.ok(saturacion > .35 && saturacion < .52, `ocre apagado: ni amarillo de pintura ni gris de losa (${r}, ${g}, ${b})`);
  // Cuatro barras a lo largo del sardinel en los 40 cm de la guía, con canal oscuro; de lejos se funden en su tono medio.
  assert.match(glsl, /pavingBars = \( pavingRoad - 1\.5 \) \* 10\./);
  assert.match(glsl, /pavingRelief = mix\( [^;]*pavingCrown[^;]*fwidth\( pavingBars \)/);
  assert.match(glsl, /pavingOchre = [^;]*\* pavingRelief;/);
});

test('el andén renovado filtra las juntas de 40 cm y respeta las demás superficies', () => {
  const material = new THREE.MeshStandardMaterial();
  dressPaving(material, { map: street(), key: 'sidewalk_chapinero' });
  const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
  material.onBeforeCompile(shader);
  const glsl = shader.fragmentShader;
  assert.match(glsl, /pavingAt \/ \.4/);
  assert.match(glsl, /pavingPixel = fwidth\( pavingAt \)/);
  assert.match(glsl, /pavingGrainDetail = 1\. - smoothstep\( \.025, \.10, pavingFootprint \)/);
  assert.match(glsl, /pavingPanelHeight = \.0045 \* pavingBevel \* pavingPanelDetail/);
  assert.match(glsl, /pavingPanelBlend = \( 1\. - pavingAge \) \* \( 1\. - max\( max\( pavingGuide, pavingField \), pavingClayStrip \) \)/);
  assert.match(glsl, /perturbNormalArb\( -vViewPosition, nonPerturbedNormal, pavingSlope/);
  assert.match(glsl, /roughnessFactor = mix\( roughnessFactor, roughness \* \.92, pavingPanelBlend \)/);
});

test('las losetas de alerta tienen espacio propio en el atlas, lejos de los interiores de los locales', () => {
  const [u0, v0, u1, v1] = DETAIL_UV.tactile;
  assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1);
  for (const [name, [a0, b0, a1, b1]] of Object.entries(DETAIL_UV)) {
    if (name !== 'tactile') {
      assert.ok(a1 <= u0 || a0 >= u1 || b1 <= v0 || b0 >= v1, `la celda ${name} no pisa la alerta`);
    }
  }
  assert.ok(DETAIL_UV.plain[1] - v1 >= 8 / 512, 'el blanco queda separado del relieve aun con mipmaps');
});

test('la ciudad viste cada andén con el acabado de su barrio', () => {
  const city = new Bogota();
  const map = city._layout();
  city.map = map;
  city._buildGround(map);
  const kindOf = key => {
    const shader = fakeShader();
    city.groundMaterials[key].onBeforeCompile(shader);
    return shader.uniforms.uPavingKind?.value;
  };
  for (const [key, kind] of Object.entries(PAVING_KINDS)) assert.equal(kindOf(key), kind, key);
  assert.equal(kindOf('road'), undefined, 'la calzada no entra');
  const { width, height, data } = pavingBandsOf(map).image;
  assert.deepEqual([width, height], [map[0].length * T, map.length * T]);
  const old = (x, z) => data[((Math.round(z) + 1) * width + Math.round(x) + 1) * 2 + 1];
  assert.equal(old(41, 55), 255, 'la olla de El Cartucho es andén viejo');
  for (const [x, z] of [[26.4, 55], [55.6, 55], [41, 38.4], [41, 71.6]]) assert.equal(old(x, z), 255, `el andén de su contorno, viejo hasta el sardinel: ${x}, ${z}`);
  for (const [x, z] of [[19, 55], [63, 55], [41, 31], [41, 79]]) assert.equal(old(x, z), 0, `y la acera de enfrente no: ${x}, ${z}`);
  assert.equal(old(197, 185), 0, 'la hilera de locales no');
  assert.equal(old(113, 98), 0, 'el barrio del cambuche lo es por su material, no por la máscara');
});

test('el prado y la ribera toman el mismo césped a escala métrica', () => {
  const city = new Bogota();
  const map = city._layout();
  city.map = map;
  city._buildGround(map);
  const { grass } = city.groundMaterials;
  const shore = city.lakeTerrain.material;
  assert.equal(shore.map, grass.map);
  assert.equal(shore.userData.uniforms.lakeGroundBump.value, grass.bumpMap);
  assert.equal(shore.userData.uniforms.lakeSurfaceScale.value.x, GRASS_TILE_METERS);
  assert.equal(grass.map.userData.scale, GRASS_TILE_METERS);
  let grassMeshes = 0;
  city.group.traverse(mesh => {
    if (!mesh.isMesh || mesh.material !== grass) return;
    grassMeshes++;
    const { position, uv } = mesh.geometry.attributes;
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(uv.getX(i) - position.getX(i) / GRASS_TILE_METERS) < 1e-5);
      assert.ok(Math.abs(uv.getY(i) - position.getZ(i) / GRASS_TILE_METERS) < 1e-5);
    }
  });
  assert.ok(grassMeshes > 0);
  const grassShader = fakeShader(), shoreShader = { ...fakeShader(), fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  grass.onBeforeCompile(grassShader);
  shore.onBeforeCompile(shoreShader);
  assert.equal(shoreShader.uniforms.uGroundWear.value, grassShader.uniforms.uGroundWear.value);
  assert.match(shoreShader.fragmentShader, /grassFinish\( diffuseColor\.rgb, vLakeXZ \)/);
  assert.match(shoreShader.fragmentShader, /vLakeLayers\.x > \.6 && lakePavingMix < 1\./);
  assert.equal(grass.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(grass.bumpMap.colorSpace, THREE.NoColorSpace);
  assert.equal(grass.map.minFilter, THREE.LinearMipmapLinearFilter);
});

test('ningún suelo de la ciudad queda con coordenadas de textura rotas', () => {
  const city = new Bogota();
  const map = city._layout();
  city.map = map;
  city._buildGround(map);
  let checked = 0;
  city.group.traverse(mesh => {
    const uv = mesh.geometry?.attributes?.uv;
    if (!uv) return;
    for (let i = 0; i < uv.count; i++) assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)), `UV inválida en ${mesh.name || mesh.material?.name}`);
    checked++;
  });
  assert.ok(checked > 8);
  for (const key of ['sidewalk_cambuche', 'sidewalk_comercio', 'sidewalk_lago']) assert.ok(city.groundMaterials[key]);
});

function district() {
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  Object.assign(city, { props: [], treePlan: [], vegetationPlan: { clusters: [] }, vendors: [], fireBarrels: [],
    signals: { poles: [] }, renderSectors: [], isNearReserved: () => false, buildingVisibility: { buildings: [] } });
  return city;
}

function glowQuads(city) {
  const quads = [];
  city.group.traverse(mesh => {
    if (mesh.material?.name !== 'Calle: luz de faroles') return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 4) {
      quads.push({ x: (p.getX(i) + p.getX(i + 2)) / 2, y: p.getY(i), z: (p.getZ(i) + p.getZ(i + 2)) / 2 });
    }
  });
  return quads;
}

test('el farol de pared deja su charco a la altura del suelo y nunca dentro de un muro', () => {
  const city = district(), { map } = city;
  let wall = null;
  for (let z = 2; z < map.length - 2 && !wall; z++) for (let x = 2; x < map[0].length - 2; x++) {
    if (map[z][x] === 'sidewalk' && map[z][x - 1] === 'building' && map[z][x + 1] === 'road') { wall = { x: x * T, z: z * T }; break; }
  }
  assert.ok(wall, 'hay un andén contra un muro');
  city.lanternSpots = [new THREE.Vector3(wall.x, 3.5, wall.z)];
  addStreetDetails(city);
  const quads = glowQuads(city);
  assert.ok(quads.length > 4, 'el charco se parte por tiles');
  for (const quad of quads) {
    const tile = map[Math.round(quad.z / T)][Math.round(quad.x / T)];
    assert.notEqual(tile, 'building', `charco sobre un muro en ${quad.x},${quad.z}`);
    assert.ok(Math.abs(quad.y - (city.getGroundHeight(quad.x, quad.z) + .03)) < 1e-3, `charco flotando en ${quad.x},${quad.z}`);
  }
  assert.ok(quads.some(q => map[Math.round(q.z / T)][Math.round(q.x / T)] === 'road'), 'y baja del andén a la calzada');
});

test('las matas del borde son del lote de la calle y solo crecen pegadas a lo que no es pasto', () => {
  const city = district(), { map } = city;
  addStreetDetails(city);
  let blades = 0;
  city.group.traverse(mesh => {
    if (mesh.material?.name !== 'Calle: sardineles y mobiliario') return;
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      // Una hoja arranca en el pasto, con la base angosta, y termina en punta hacia arriba.
      if (Math.abs(p.getY(a) - .06) > 1e-4 || Math.abs(p.getY(b) - .06) > 1e-4 || p.getY(c) - .06 < .05 || p.getY(c) > .5) continue;
      if (Math.hypot(p.getX(a) - p.getX(b), p.getZ(a) - p.getZ(b)) > .08) continue;
      blades++;
      assert.equal(map[Math.round(p.getZ(a) / T)][Math.round(p.getX(a) / T)], 'grass');
    }
  });
  assert.ok(blades > 200, `hojas: ${blades}`);
  assert.ok(blades < 40000, `hojas: ${blades}`);
});

test('la guía dobla en ángulo recto: en una esquina de la calzada la distancia no se redondea', () => {
  // Una carrera que se acaba en z = 5: el andén le da la vuelta a su esquina en (11, 11).
  const map = Array.from({ length: 12 }, (_, z) => Array.from({ length: 12 }, (_, x) => (x === 4 || x === 5) && z <= 5 ? 'road' : 'sidewalk'));
  const { width, data } = buildPavingBands(map).image;
  const meters = (x, z) => data[(Math.round(z + T / 2 - .5) * width + Math.round(x + T / 2 - .5)) * 2] / 255 * (BAND_REACH + BAND_INSIDE) - BAND_INSIDE;
  // A 1,5 m en x y 1,5 m en z de esa esquina la guía sigue recta y dobla allí, sin cortar la curva.
  assert.ok(Math.abs(meters(12.5, 12.5) - 1.5) < .1, `${meters(12.5, 12.5).toFixed(2)} m en la diagonal`);
  assert.ok(Math.abs(meters(12.5, 9.5) - 1.5) < .1 && Math.abs(meters(9.5, 12.5) - 1.5) < .1, 'y a cada lado, recta');
});

test('detrás de cada rampa la arcilla se corta y va la loseta de botones, y la guía se aparta del alcorque', () => {
  const city = new Bogota(), map = city._layout(), ramps = curbRamps(map);
  assert.ok(ramps.length > 100, `${ramps.length} rampas`);
  const marks = buildPavingMarks(map), { width, data } = marks.image, k = MARKS_PER_METER;
  const at = (x, z) => data[(Math.floor((z + T / 2) * k) * width + Math.floor((x + T / 2) * k)) * 2];
  for (const { x, z, dx, dz } of ramps.slice(0, 40)) {
    for (const into of [.2, .8, 1.3]) assert.equal(at(x - dx * into, z - dz * into), 255, `sin marca a ${into} m de la rampa`);
    assert.equal(at(x - dx * 2.2, z - dz * 2.2), 0, 'la loseta de botones no pasa de la guía');
    assert.equal(at(x - dx * .8 + dz * 1.4, z - dz * .8 + dx * 1.4), 0, 'a un lado de la rampa sigue la arcilla');
  }
  const material = new THREE.MeshStandardMaterial(), shader = fakeShader();
  dressPaving(material, { map, key: 'sidewalk' });
  material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /pavingClayStrip = \( 1\. - smoothstep\( \.6 [^;]*\* \( 1\. - pavingRamp \)/, 'la arcilla se corta en la rampa');
  assert.match(shader.fragmentShader, /pavingNew = mix\( pavingNew, pavingBrick, pavingClayStrip \)/);
  assert.match(shader.fragmentShader, /pavingButtons/, 'loseta de botones');
  // Un alcorque pegado a la guía la corre 40 cm: hacia la calle si está del lado de la fachada, hacia adentro si
  // está del lado de la calle. También el que le pasa a 34 cm, como el pie de Teusaquillo. Uno lejos no la toca.
  // La calzada de `street` acaba en x = 11.
  const lane = street();
  const pits = [{ x: 13.5, z: 6, half: .7 }, { x: 12, z: 14, half: .5 }, { x: 14, z: 10, half: .76 }, { x: 20, z: 20, half: .5 }];
  assert.equal(markTreePits(lane, pits), 3);
  const lanes = pavingMarksOf(lane).image, shift = (x, z) => (lanes.data[(Math.floor((z + T / 2) * k) * lanes.width + Math.floor((x + T / 2) * k)) * 2 + 1] - 128) / 254;
  assert.ok(shift(13.5, 6) <= -.39 && shift(13.5, 6) >= -.5, `se corre ${shift(13.5, 6).toFixed(2)} m`);
  assert.ok(shift(12, 14) >= .39 && shift(12, 14) <= .5, `se corre ${shift(12, 14).toFixed(2)} m`);
  assert.ok(shift(14, 10) <= -.39 && shift(14, 10) >= -.5, `se corre ${shift(14, 10).toFixed(2)} m`);
  assert.equal(shift(20, 20), 0);
});
