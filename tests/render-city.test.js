// Lo que la ciudad entera debe cumplir al dibujarse: quién recibe el campo de sol y en qué orden va el suelo.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { CLOSED_CHUNK_SIZE } from '../src/world/bogota/BuildingVisibility.js';
import { scanCityEdge } from '../src/world/bogota/CityEdge.js';
import { makeVehicle } from '../src/world/bogota/vehicles.js';
import { makeParkedMotos } from '../src/world/bogota/motos.js';
import { buildTransitTerminal } from '../src/world/bogota/TransitTerminal.js';

const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
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

const warn = console.warn;
console.warn = () => {};
const city = new Bogota(), scene = new THREE.Scene();
city.build(scene, new CollisionSystem());
await city.preloadDetails();
console.warn = warn;
const field = city.sunField, T = 2;

const meshesOf = root => {
  const meshes = [];
  root.traverse(object => { if (object.isMesh) meshes.push(object); });
  return meshes;
};
const named = name => meshesOf(scene).filter(mesh => [mesh.material].flat().some(material => material.name === name));
const orderOf = name => {
  const orders = new Set(named(name).map(mesh => mesh.renderOrder));
  assert.equal(orders.size, 1, `${name}: ${[...orders]}`);
  return [...orders][0];
};
const LIT = material => material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial;
const compile = material => {
  const base = THREE.ShaderLib[material.isMeshLambertMaterial ? 'lambert' : material.isMeshPhongMaterial ? 'phong'
    : material.isMeshBasicMaterial ? 'basic' : 'standard'];
  const shader = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader };
  material.onBeforeCompile(shader, null);
  return shader;
};
const withoutField = root => {
  const names = new Set(), seen = new Set();
  for (const mesh of meshesOf(root)) for (const material of [mesh.material].flat()) {
    if (seen.has(material) || !LIT(material)) continue;
    seen.add(material);
    if (!compile(material).fragmentShader.includes('sunFieldLit')) names.add(material.name || material.type);
  }
  assert.ok(seen.size > 0);
  return [...names];
};
const heightAt = (x, z) => field.heights[Math.floor(z - field.z0) * field.w + Math.floor(x - field.x0)];

test('postes, semáforos, copas, torres y estación reciben el campo de sol: solo el agua queda fuera', () => {
  assert.deepEqual(withoutField(scene).filter(name => !name.startsWith('Agua del lago')), []);
  for (const name of ['Hojas urbanas', 'Vegetación baja · verdes de altura', 'Poste de alumbrado', 'Semáforo']) assert.ok(named(name).length, name);
  const towers = meshesOf(scene).filter(mesh => mesh.material.customProgramCacheKey?.() === 'torres-con-bruma');
  assert.ok(towers.length, 'torres del oriente');
  assert.ok(compile(towers[0].material).fragmentShader.includes('sunFieldLit'));
});

test('carros, taxis, busetas, motos y buses reciben el campo con cada una de sus piezas', () => {
  for (const kind of ['carro', 'taxi', 'policia', 'buseta']) {
    assert.deepEqual(withoutField(makeVehicle(kind, 3).group), [], kind);
  }
  const motos = makeParkedMotos([{ x: 0, z: 0, angle: 0, y: 0, rotation: 0 }]);
  assert.deepEqual(withoutField(motos.group ?? motos), [], 'motos');
  assert.ok(city.busServices.length);
  for (const bus of city.busServices) assert.deepEqual(withoutField(bus.group), [], 'bus');
});

test('una copa se alumbra según lo que hay más allá de sus propias hojas', () => {
  const [leaves] = named('Hojas urbanas');
  assert.ok(compile(leaves.material).fragmentShader.includes('#define SUN_FIELD_REACH'));
  assert.ok(leaves.material.customProgramCacheKey().includes('campo-sol'));
});

test('los árboles del oriente dan sombra como los demás y el mobiliario los esquiva', () => {
  const W = value => value * T;
  assert.ok(city.eastTrees.length > 50);
  for (const [x, z] of city.eastTrees) {
    assert.ok(city.treePlan.some(tree => tree.x === W(x) && tree.z === W(z)), `árbol ${x},${z} fuera del plan`);
    assert.ok(heightAt(W(x), W(z)) > 2, `árbol ${x},${z} sin altura en el campo`);
  }
  for (const pole of city.streetPoles ?? []) for (const [x, z] of city.eastTrees) {
    assert.ok(Math.hypot(pole.x - W(x), pole.z - W(z)) >= .8, `poste dentro del árbol ${x},${z}`);
  }
});

test('el borde de la ciudad da sombra con la altura de lo que se dibuja, no con la del muro que ya no está', () => {
  const heights = { closure: [], fence: [], facade: [] };
  const center = (x, z) => heightAt(x * T, z * T);
  const edge = new Map();
  for (const { side, kind, a, b } of scanCityEdge(city.map)) for (let t = a; t <= b; t++) {
    const [x, z] = side.edge(city.map, t), key = `${x},${z}`;
    // Una esquina puede ser de dos tramos: manda el más alto, como en el campo.
    const rank = { fence: 0, closure: 1, facade: 2 };
    if (!edge.has(key) || rank[kind] > rank[edge.get(key).kind]) edge.set(key, { kind, x, z });
  }
  for (const { kind, x, z } of edge.values()) heights[kind].push(center(x, z));
  const share = (list, wanted) => list.filter(height => Math.abs(height - wanted) < .01).length / list.length;
  assert.ok(heights.closure.length > 50 && heights.fence.length > 50);
  assert.ok(share(heights.closure, 3.9) > .9, `cierres de 3,9 m: ${share(heights.closure, 3.9)}`);
  assert.ok(share(heights.fence, 1.72) > .9, `rejas de 1,72 m: ${share(heights.fence, 1.72)}`);
  assert.ok(share(heights.closure, 9) < .05 && share(heights.fence, 9) < .05);
});

test('el suelo se dibuja antes que las sombras de contacto y que todo lo transparente', () => {
  const paint = orderOf('Pintura y remiendos'), puddles = orderOf('Calle: charcos'), glow = orderOf('Calle: luz de faroles');
  assert.ok(paint < puddles && puddles < glow && glow < 0, `${paint} ${puddles} ${glow}`);
  const contact = meshesOf(scene).find(mesh => mesh.name.startsWith('Contacto'));
  if (contact) assert.ok(contact.renderOrder >= 0);
});

test('el halo de un farol se dibuja después de los cerros que tiene detrás', () => {
  assert.ok(orderOf('Resplandor de farol') > orderOf('Cerros de fondo'));
});

test('la luz de los faroles se apaga con la distancia en vez de sumar el color del cielo', () => {
  const [glow] = named('Calle: luz de faroles');
  assert.ok(glow.material.fog, 'sigue siendo sensible a la niebla, pero hacia negro');
  const { fragmentShader } = compile(glow.material);
  assert.ok(!fragmentShader.includes('#include <fog_fragment>'));
  assert.ok(fragmentShader.includes('gl_FragColor.rgb *= 1. - smoothstep( fogNear, fogFar, vFogDepth )'));
  const pools = meshesOf(buildTransitTerminal({ createSign: () => new THREE.Texture(), asphalt: new THREE.MeshStandardMaterial() }))
    .filter(mesh => mesh.material.blending === THREE.AdditiveBlending && mesh.material.fog);
  assert.ok(pools.length, 'charcos de luz de la estación');
  for (const pool of pools) assert.ok(!compile(pool.material).fragmentShader.includes('#include <fog_fragment>'), pool.name);
  const beams = meshesOf(makeVehicle('carro', 3).group).filter(mesh => mesh.material.blending === THREE.AdditiveBlending && mesh.material.fog);
  assert.ok(beams.length, 'haces de luz del carro');
  for (const beam of beams) assert.ok(!compile(beam.material).fragmentShader.includes('#include <fog_fragment>'), beam.name);
});

test('lo transparente que más se repite va en una pasada y la ciudad se reparte en sectores de 64 m', () => {
  for (const name of ['Calle: luz de faroles', 'Humedad de fachadas']) {
    const meshes = named(name);
    assert.ok(meshes.length > 0, name);
    for (const mesh of meshes) assert.equal(mesh.material.forceSinglePass, true, name);
  }
  const sectors = [], box = new THREE.Box3(), center = new THREE.Vector3();
  for (const root of [city.group, city.buildingVisibility.closedView]) sectors.push(...root.children.filter(object => object.name.startsWith('Sector ')));
  assert.ok(sectors.length > 20);
  for (const sector of sectors) {
    const [x, z] = sector.name.slice('Sector '.length).split(',').map(Number);
    box.setFromObject(sector.children[0]).getCenter(center);
    assert.equal(`${Math.floor(center.x / CLOSED_CHUNK_SIZE)},${Math.floor(center.z / CLOSED_CHUNK_SIZE)}`, `${x},${z}`, sector.name);
  }
});
