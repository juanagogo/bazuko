import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as THREE from 'three';
import { NEIGHBORHOODS, neighborhoodAt } from '../src/world/bogota/NeighborhoodIdentity.js';
import { URBAN_DESIGNS, buildUrbanBuilding, planUrbanBuildings } from '../src/world/bogota/UrbanBuildings.js';
import { Bogota } from '../src/world/districts/Bogota.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const makePalette = () => ({
  facades: URBAN_DESIGNS.map(() => new THREE.MeshStandardMaterial({
    map: new THREE.Texture(), roughnessMap: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture()
  })),
  ...Object.fromEntries(['roof', 'interior', 'concrete', 'trim', 'rail', 'glass'].map(k => [k, new THREE.MeshStandardMaterial()]))
});
const planAt = (x, z) => ({ x, z, width: 12, depth: 12, height: 16, floors: 5,
  design: 'ladrillo-balcones', seed: 42, tileX: 0, tileZ: 0, tiles: 6 });

test('el recorrido usa perfiles visuales estables y el exterior mantiene el centro neutro', () => {
  assert.equal(neighborhoodAt(112.98, 97.84), NEIGHBORHOODS.cambuche);
  assert.equal(neighborhoodAt(112.98, 128), NEIGHBORHOODS.comercio);
  assert.equal(neighborhoodAt(48, 166), NEIGHBORHOODS.comercio);
  assert.equal(neighborhoodAt(112.98, 221.99), NEIGHBORHOODS.comercio);
  assert.equal(neighborhoodAt(112.98, 222), NEIGHBORHOODS.lago);
  assert.equal(neighborhoodAt(30, 100), NEIGHBORHOODS.centro);
  assert.equal(neighborhoodAt(75, -30), NEIGHBORHOODS.centro);
  assert.equal(neighborhoodAt(NaN, 222), NEIGHBORHOODS.centro);
  for (const profile of Object.values(NEIGHBORHOODS)) {
    assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.palette) && Object.isFrozen(profile.signage));
    for (const color of Object.values(profile.palette)) assert.match(color, /^#[0-9a-f]{6}$/);
  }
});

test('los edificios comparten variantes por barrio y todas las texturas de la paleta original', () => {
  const palette = makePalette();
  const before = palette.facades.map(material => material.color.getHex());
  const first = buildUrbanBuilding(planAt(112, 98), palette);
  const same = buildUrbanBuilding(planAt(114, 100), palette);
  const commercial = buildUrbanBuilding(planAt(112, 168), palette);
  const material = first.walls.get(0).children[0].material;
  assert.equal(material, same.walls.get(0).children[0].material);
  assert.notEqual(material, commercial.walls.get(0).children[0].material);
  for (const key of ['map', 'roughnessMap', 'bumpMap', 'emissiveMap']) assert.equal(material[key], palette.facades[0][key]);
  assert.deepEqual(palette.facades.map(material => material.color.getHex()), before, 'no recolorea materiales de otros barrios');
  assert.equal(first.root.userData.neighborhood, 'cambuche');
  assert.equal(commercial.root.userData.neighborhood, 'comercio');
  assert.notEqual(first.root.getObjectByName('Dintel').material.color.getHex(), commercial.root.getObjectByName('Dintel').material.color.getHex());
  assert.deepEqual(first.root.userData.urbanBuilding, planAt(112, 98), 'la identidad no altera el plan físico');
});

test('la integración puede suministrar texturas y materiales de barrio sin retintarlos', () => {
  const palette = makePalette();
  const facade = new THREE.MeshStandardMaterial({ color: '#bc9b79', map: new THREE.Texture() });
  const accent = new THREE.MeshStandardMaterial({ color: '#487266' });
  palette.neighborhoods = { comercio: { facades: [facade], accent } };
  const shell = buildUrbanBuilding(planAt(112, 168), palette);
  assert.equal(shell.walls.get(0).children[0].material, facade);
  assert.equal(facade.color.getHex(), 0xbc9b79);
  assert.equal(shell.root.getObjectByName('Dintel').material, accent);
});

test('los detalles conservan exactamente el plan físico de los veinte solares anteriores', () => {
  const city = new Bogota(), map = city._layout(), before = JSON.stringify(map);
  const plans = planUrbanBuildings(map);
  // Huellas, posiciones, alturas, diseños y semillas de la ciudad anterior.
  assert.equal(digest(plans), 'e6b140f023aecccc93ac7f996b5cd235bd08446cba2dd378be42437fc873a0e3');
  const palette = makePalette();
  for (const plan of plans) {
    const shell = buildUrbanBuilding(plan, palette);
    shell.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(shell.root);
    assert.ok(Math.abs(bounds.max.y - plan.height) < 1e-5);
    assert.ok(bounds.min.x >= plan.x - plan.width / 2 - .1 && bounds.max.x <= plan.x + plan.width / 2 + .1);
    assert.ok(bounds.min.z >= plan.z - plan.depth / 2 - .1 && bounds.max.z <= plan.z + plan.depth / 2 + .1);
    assert.deepEqual(shell.root.userData.urbanBuilding, plan);
    shell.root.traverse(object => {
      assert.ok(!object.isLight);
      if (object.isMesh) assert.ok(object.geometry.index, 'todos los lotes son compatibles con la fusión estática');
    });
    for (const wall of shell.walls.values()) assert.ok(wall.children.filter(o => o.userData.buildingDetails).length <= 6);
  }
  assert.equal(JSON.stringify(map), before, 'sin cambios de tiles para colisiones y GPS');
});
