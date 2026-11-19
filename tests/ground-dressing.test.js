import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { addStreetDetails } from '../src/world/bogota/StreetDetails.js';
import { buildGroundWear, dressGrass, dressPaving } from '../src/world/bogota/GroundDressing.js';
import { sunFieldUniforms } from '../src/world/bogota/SunField.js';

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
