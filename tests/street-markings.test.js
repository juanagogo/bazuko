import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { buildStreetMarkings, crossings } from '../src/world/bogota/StreetMarkings.js';
import { STATIC_CHUNK_SIZE } from '../src/world/bogota/StaticGeometry.js';

function district() {
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  return city;
}
const SECTOR = STATIC_CHUNK_SIZE * 2;
const positions = meshes => meshes.flatMap(mesh => Array.from(mesh.geometry.attributes.position.array));

test('la pintura se reparte por sectores, con un solo material, sin mallas por franja', () => {
  const city = district(), meshes = buildStreetMarkings(city);
  assert.ok(meshes.length > 10);
  assert.equal(new Set(meshes.map(mesh => mesh.material)).size, 1, 'todo el suelo pintado comparte material');
  assert.equal(meshes[0].material.transparent, true);
  assert.equal(meshes[0].material.depthWrite, false);
  const chunks = new Set();
  for (const mesh of meshes) {
    assert.equal(mesh.userData.noMerge, true);
    assert.equal(mesh.geometry.attributes.color.itemSize, 4, 'cada franja guarda cuánta pintura le queda');
    const box = mesh.geometry.boundingBox;
    assert.ok(box.max.x - box.min.x < SECTOR + 16 && box.max.z - box.min.z < SECTOR + 16);
    chunks.add(`${Math.floor((box.min.x + box.max.x) / 2 / SECTOR)},${Math.floor((box.min.z + box.max.z) / 2 / SECTOR)}`);
  }
  assert.ok(chunks.size >= meshes.length * .8, 'una malla por sector');
});

test('es determinista: las mismas coordenadas dan la misma pintura', () => {
  assert.deepEqual(positions(buildStreetMarkings(district())), positions(buildStreetMarkings(district())));
});

test('la pintura y los remiendos no se montan en un andén: quedan a ras del suelo', () => {
  const city = district(), meshes = buildStreetMarkings(city);
  for (const mesh of meshes) {
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 4) {
      const y = p.getY(i), ground = city.getGroundHeight((p.getX(i) + p.getX(i + 2)) / 2, (p.getZ(i) + p.getZ(i + 2)) / 2);
      assert.ok(y <= Math.max(ground, .12) + .05, `pintura a ${y} sobre suelo de ${ground}`);
    }
  }
});

test('una calle declarada sin pintura se queda sin rayas ni parches', () => {
  const full = buildStreetMarkings(district());
  const bare = buildStreetMarkings(district(), () => false);
  const quads = meshes => meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count / 4, 0);
  assert.ok(quads(bare) < quads(full) * .7, `${quads(bare)} contra ${quads(full)}`);
  // Sigue habiendo tapas y mugre: lo que no es pintura no depende del empedrado.
  assert.ok(quads(bare) > 100);
  // Un barrio sin declarar conserva la pintura.
  const city = district();
  assert.ok(quads(buildStreetMarkings(city, (x, z) => x < 0)) < quads(full), 'la consulta se hace por punto');
});

test('la lluvia también moja la pintura', () => {
  const city = district();
  const [mesh] = buildStreetMarkings(city);
  assert.equal(city.groundMaterials.sidewalk_pintura, mesh.material);
  city.groundMaterials.road = new THREE.MeshStandardMaterial();
  city.setWetness(0);
  const dry = mesh.material.roughness;
  city.setWetness(1);
  assert.ok(mesh.material.roughness < dry);
});

test('cada cruce conserva sus cuatro bandas de cebra y las rectas sus líneas', () => {
  const list = crossings();
  assert.ok(list.length > 10);
  for (const c of list) assert.ok(c.x1 > c.x0 && c.z1 > c.z0);
  assert.ok(list.some(c => c.wide), 'la Caracas cuenta como un solo cruce ancho');
});
