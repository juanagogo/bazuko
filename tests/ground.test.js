import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';
import { TILE_SIZE } from '../src/utils/constants.js';
import { materialSignature } from '../src/world/bogota/StaticGeometry.js';

// Se comprueba la geometría real sin necesitar Canvas para las texturas.
const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture() });
mock.module('../src/world/bogota/textures.js', {
  namedExports: { ...textures, asphalt: textureSet, sidewalk: textureSet,
    dirt: textureSet, concrete: textureSet, cardboard: textureSet, trashBag: textureSet }
});
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { shack } = await import('../src/world/bogota/props.js');
const { Cambuche } = await import('../src/entities/Cambuche.js');

function district() {
  const city = new Bogota();
  city.map = city._layout();
  city._buildGround(city.map);
  return city;
}

test('las bases de los refugios quedan sobre la superficie dibujada en todos los terrenos', () => {
  const city = district();
  const ground = [...city.group.children];
  const down = new THREE.Vector3(0, -1, 0);
  const ray = new THREE.Raycaster();
  city.group.updateMatrixWorld(true);
  for (const type of ['road', 'busway', 'sidewalk', 'floor', 'dirt', 'grass', 'plaza']) {
    const z = city.map.findIndex(row => row.includes(type));
    const x = city.map[z].indexOf(type);
    const wx = x * TILE_SIZE, wz = z * TILE_SIZE;
    ray.set(new THREE.Vector3(wx, 1, wz), down);
    const surface = ray.intersectObjects(ground, true)[0].point.y;
    const shelter = city._add(shack(), wx, wz, 0.3);
    city.group.updateMatrixWorld(true);
    const card = shelter.children.find(o => o.geometry?.parameters?.width === 1.9);
    const bounds = new THREE.Box3().setFromObject(card);
    assert.ok(bounds.min.y >= surface - 1e-7, `${type}: cartón enterrado`);
    assert.ok(bounds.max.y > surface + 0.03, `${type}: cartón coplanar con el suelo`);
  }
});

test('el cartón y la tierra conservan separación antes y después de unir las mallas estáticas', () => {
  const city = district();
  city._add(shack(), STREET_X.world(12.5), STREET_Z.world(18.3));
  const ray = new THREE.Raycaster(new THREE.Vector3(STREET_X.world(12.5) + 0.63, 0.2, STREET_Z.world(18.3) + 0.27), new THREE.Vector3(0, -1, 0));
  const check = () => {
    city.group.updateMatrixWorld(true);
    const hits = ray.intersectObject(city.group, true);
    assert.ok(hits.length >= 2);
    assert.ok(hits[1].distance - hits[0].distance > 0.03, 'el suelo y el cartón compiten por la misma profundidad');
  };
  check();
  city._mergeStatic();
  check();
});

test('todos los refugios de El Cartucho quedan separados del terreno, incluso al cruzar límites de tiles', () => {
  const city = district();
  const groundMaterials = new Set();
  city.group.traverse(o => { if (o.isMesh) groundMaterials.add(o.material); });
  const shelters = [];
  const add = city._add.bind(city);
  city._add = (obj, ...args) => {
    const card = obj.children.find(o => o.geometry?.parameters?.width === 1.9 && o.geometry?.parameters?.height === 0.04);
    add(obj, ...args);
    if (card) shelters.push(card);
    return obj;
  };
  city._vendor = () => {}; // No hace falta cargar personajes ni Canvas para revisar los suelos.
  city._buildCartucho();
  city.group.updateMatrixWorld(true);
  assert.equal(shelters.length, 5);
  const samples = shelters.flatMap(card => [-0.85, 0, 0.85].flatMap(x => [-0.65, 0, 0.65].map(z => ({
    point: new THREE.Vector3(x, 0, z).applyMatrix4(card.matrixWorld), material: card.material
  }))));
  const ray = new THREE.Raycaster();
  const check = () => {
    city.group.updateMatrixWorld(true);
    let checked = 0;
    for (const { point, material } of samples) {
      ray.set(new THREE.Vector3(point.x, 0.5, point.z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(city.group, true);
      const ground = hits.find(hit => groundMaterials.has(hit.object.material));
      if (!ground) continue; // Hay partes de la base sobre tiles de edificios sin suelo dibujado.
      // Tras la fusión estática el cartón usa el material canónico idéntico, no la misma instancia.
      const card = hits.find(hit => hit.object.material === material || materialSignature(hit.object.material) === materialSignature(material) ||
        (material.userData.staticMergeKey && hit.object.material.userData.staticMergeKey === material.userData.staticMergeKey));
      assert.ok(card, `base no visible en ${point.x},${point.z}`);
      assert.ok(card.point.y - ground.point.y > 0.03, `cartón y suelo superpuestos en ${point.x},${point.z}`);
      checked++;
    }
    assert.ok(checked >= 20);
  };
  check();
  city._mergeStatic();
  check();
});

test('un alero sobre el andén no levanta una base que permanece enteramente en la calzada', () => {
  const city = new Bogota();
  city.map = Array.from({ length: 48 }, () => Array(48).fill('road'));
  city.map[5][5] = 'sidewalk'; // El andén comienza en x = 9.
  const shelter = city._add(shack(), 7.9, 10);
  // El techo llega a x = 9.05, mientras los apoyos llegan como máximo a x = 8.93.
  assert.equal(shelter.position.y, 0);
});

test('las hojas solapadas de la base del jugador no comparten el mismo plano', () => {
  const random = Math.random;
  let shelter;
  try {
    Math.random = () => 0.5;
    shelter = new Cambuche(new THREE.Scene(), new THREE.Vector3(89, 0.04, 80));
  } finally {
    Math.random = random;
  }
  try {
    shelter.setBuilt({ base: true });
    shelter.group.updateMatrixWorld(true);
    const root = shelter.group.children[0];
    // El punto cae en la zona donde se montan la primera y segunda hoja.
    const origin = new THREE.Vector3(-0.46, 0.3, 0).applyMatrix4(root.matrixWorld);
    const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(shelter.pieces.base, true);
    assert.equal(hits.length, 2);
    assert.ok(hits[1].distance - hits[0].distance > 0.005);
  } finally {
    shelter.dispose();
  }
});
