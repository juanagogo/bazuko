import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { asphaltPatches, buildStreetMarkings, crossings } from '../src/world/bogota/StreetMarkings.js';
import { pedestrianCrossings, streetIntersections } from '../src/world/bogota/StreetCrossings.js';
import { STATIC_CHUNK_SIZE } from '../src/world/bogota/StaticGeometry.js';

function district() {
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  return city;
}
const SECTOR = STATIC_CHUNK_SIZE * 4;
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

test('los nuevos pasos del oriente tienen dos salidas y la red reconoce el trayecto pintado', () => {
  const city = district(), roads = new Set(['road', 'busway']), walkable = new Set(['sidewalk', 'plaza', 'floor', 'grass', 'dirt']);
  const tile = (x, z) => city.map[Math.round(z / 2)]?.[Math.round(x / 2)];
  const paths = pedestrianCrossings(city.map);
  assert.ok(paths.some(p => p.x === 307 && p.z === 184), 'paso en Carrera 4 con Calle 7');
  assert.ok(paths.some(p => p.x === 95 && p.z === 187), 'la franja verde bajo el viaducto deja pasar la cebra de Calle 7');
  assert.ok(paths.some(p => p.x === 119 && p.z === 187), 'un parque también puede recibir el paso sin necesitar sardinel');
  assert.ok(paths.some(p => p.x >= 345 && p.z < 100 && p.width < 2), 'andén angosto de la Candelaria');
  const rules = city._pedestrianRules();
  for (const { x, z, dx, dz, length } of paths) {
    assert.ok(walkable.has(tile(x - dx, z - dz)) && walkable.has(tile(x + dx * (length + 1), z + dz * (length + 1))));
    for (let d = 1; d < length; d += 2) {
      const px = x + dx * d, pz = z + dz * d;
      assert.ok(roads.has(tile(px, pz)) && rules.isCrossing(Math.round(px / 2), Math.round(pz / 2)), `sin paso en ${px},${pz}`);
    }
  }
});

test('los remiendos no son rectángulos: borde roto, giro propio, junta negra y casi el tono del asfalto', () => {
  const list = asphaltPatches(district().map);
  assert.ok(list.length > 100, `${list.length} remiendos`);
  const trenches = list.filter(p => p.trench);
  let straight = 0;
  assert.ok(trenches.length > list.length * .4 && trenches.length < list.length * .6, `${trenches.length} zanjas de ${list.length}`);
  for (const p of list) {
    assert.ok(p.rough >= .15 && p.rough <= .3, `ruido del borde de ${p.rough} m`);
    for (const ancho of p.seam) assert.ok(ancho >= .015 && ancho <= .06, `junta de ${ancho} m`);
    assert.ok(p.seamColor[0] < p.fill[0] || p.fill[0] > .1, 'la junta es más negra que el relleno');
    // Lo que deja el relleno sobre asfaltos de albedo 0,06 a 0,15: nunca más de un 8 % de valor.
    for (const asphalt of [.06, .1, .15]) {
      const a = p.fill[3], mixed = asphalt * (1 - a) + p.fill[0] * a;
      const change = Math.abs((mixed / asphalt) ** (1 / 2.2) - 1);
      assert.ok(change <= .08, `cambia el valor un ${(change * 100).toFixed(1)} %`);
    }
    // Borde roto: en un mismo lado largo el contorno se aparta de la recta.
    const c = Math.cos(p.angle), s = Math.sin(p.angle);
    const local = p.outline.map(([x, z]) => [(x - p.x) * c - (z - p.z) * s, (x - p.x) * s + (z - p.z) * c]);
    const side = local.filter(([a, b]) => Math.abs(a) < p.length * .45 && b > 0).map(([, b]) => b);
    if (side.length < 2 || Math.max(...side) - Math.min(...side) <= .02) straight++;
    if (p.trench) {
      const off = Math.abs(((p.angle - p.lane) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2);
      assert.ok(off < .05 && p.length > p.width * 2.5, 'la zanja corre larga a lo largo del carril');
    } else {
      const quarter = ((p.angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      assert.ok(quarter > .1 && quarter < Math.PI / 2 - .1, `giro de ${p.angle} rad, en la cuadrícula`);
    }
  }
  assert.ok(straight < list.length * .05, `${straight} remiendos con un lado largo recto`);
  // Nunca dos iguales a la vista: dos remiendos a menos de 60 m no comparten forma ni tamaño.
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (Math.hypot(a.x - b.x, a.z - b.z) > 60) continue;
    assert.ok(Math.abs(a.length - b.length) > .005 || Math.abs(a.width - b.width) > .005 || Math.abs(a.angle - b.angle) > .01, 'dos remiendos iguales');
  }
});

test('los remiendos se dibujan con su contorno y de cara al cielo, en los mismos sectores', () => {
  const city = district(), meshes = buildStreetMarkings(city), patches = asphaltPatches(city.map);
  const centers = new Set(patches.map(p => `${Math.fround(p.x)},${Math.fround(p.z)}`));
  for (const mesh of meshes) {
    const p = mesh.geometry.attributes.position.array, index = mesh.geometry.index.array;
    for (let i = 0; i < p.length; i += 3) centers.delete(`${p[i]},${p[i + 2]}`);
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
      const up = (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
      assert.ok(up >= -1e-9, 'triángulo de espaldas al cielo');
    }
  }
  const triangles = meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
  assert.equal(centers.size, 0, 'cada remiendo que admite agua tiene su centro en la geometría visible');
  assert.ok(triangles > 17278 + patches.length * 40, `${triangles} triángulos: el remiendo no es un cuadro`);
});
