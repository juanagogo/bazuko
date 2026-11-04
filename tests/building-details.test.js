import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { addBuildingDetails } from '../src/world/bogota/BuildingDetails.js';
import { createBuildingShell, BuildingVisibility } from '../src/world/bogota/BuildingVisibility.js';
import { buildUrbanBuilding, URBAN_DESIGNS } from '../src/world/bogota/UrbanBuildings.js';
import { Bogota } from '../src/world/districts/Bogota.js';

function house(width = 8, depth = 6, height = 12) {
  const material = new THREE.MeshStandardMaterial();
  return createBuildingShell(new THREE.BoxGeometry(width, height, depth), Array(6).fill(material), {
    x: 10, z: 20, height, interiorMaterial: material
  });
}
function detailGeometry(shell) {
  const values = [];
  shell.root.traverse(mesh => {
    if (mesh.userData.buildingDetails) values.push([Array.from(mesh.geometry.attributes.position.array), Array.from(mesh.geometry.index.array)]);
  });
  return values;
}

test('los detalles son deterministas, agrupados y caben dentro de la planta y altura originales', () => {
  for (const face of [0, 1, 4, 5]) {
    const shell = house(), copy = house();
    const opts = { width: 8, depth: 6, height: 12, floors: 4, face, seed: 318, neighborhood: 'comercio', balconies: true };
    const stats = addBuildingDetails({ shell, ...opts });
    addBuildingDetails({ shell: copy, ...opts });
    assert.deepEqual(detailGeometry(shell), detailGeometry(copy));
    assert.ok(stats.windows >= 4 && stats.balconies > 0);
    assert.ok(stats.meshes <= 8, 'seis materiales de fachada y dos del techo');
    // El volumen sigue en su planta y altura; los tanques, las varillas y el toldo son vida aparte (abajo).
    const bounds = new THREE.Box3(), life = new THREE.Box3();
    shell.root.updateWorldMatrix(true, true);
    shell.root.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      (o.userData.streetLife ? life : bounds).union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    assert.ok(bounds.min.x >= 6 - 1e-6 && bounds.max.x <= 14 + 1e-6);
    assert.ok(bounds.min.z >= 17 - 1e-6 && bounds.max.z <= 23 + 1e-6);
    assert.ok(Math.abs(bounds.max.y - 12) < 1e-6);
    assert.equal(shell.height, 12);
    // Lo que sobresale solo puede ser un toldo por encima de la cabeza y lo que asoma del pretil.
    assert.ok(stats.lifeMeshes <= 3, 'una malla de vida y otra de humedad por pared, y una de azotea');
    assert.ok(life.max.y <= 12 + 3.6, 'la azotea no crece más que una antena');
    shell.root.traverse(o => {
      if (!o.userData.streetLife) return;
      const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (box.min.x < 6 - 1e-6 || box.max.x > 14 + 1e-6 || box.min.z < 17 - 1e-6 || box.max.z > 23 + 1e-6) {
        assert.ok(box.max.x <= 14 + 1.2 && box.min.x >= 6 - 1.2 && box.max.z <= 23 + 1.2 && box.min.z >= 17 - 1.2, 'el toldo sale poco del frente');
      }
    });
    const before = detailGeometry(shell);
    assert.equal(addBuildingDetails({ shell, ...opts }).meshes, 0, 'no duplica una fachada');
    assert.deepEqual(detailGeometry(shell), before);
  }
});

test('una torre usa ventanas de la grilla existente con un presupuesto constante de lotes', () => {
  const shell = house(12, 12, 96);
  const stats = addBuildingDetails({ shell, width: 12, depth: 12, height: 96, floors: 30,
    face: 4, seed: 44, windowBayWidth: 3, balconies: true });
  assert.equal(stats.windows, 20, 'solo cinco pisos cercanos reciben volumen; los demás mantienen su textura');
  assert.ok(stats.meshes <= 8);
  const glass = shell.walls.get(4).children.filter(o => o.userData.buildingDetails
    && (o.material.roughness === .3 || o.material.userData.windowGlow));
  const centers = new Set();
  for (const mesh of glass) {
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 4) centers.add(Math.round((p.getX(i) + p.getX(i + 1)) / 2 * 100) / 100);
    assert.ok(mesh.geometry.boundingBox.max.z < 6 - .04, 'vidrio retranqueado detrás del marco');
  }
  assert.deepEqual([...centers].sort((a, b) => a - b), [-4.5, -1.5, 1.5, 4.5]);
});

test('detallar una casa no afecta las otras fachadas ni crea recursos por ventana', () => {
  const shell = house(), second = house(), original = shell.walls.get(1).children[0].geometry.attributes.position.array.slice();
  const opts = { width: 8, depth: 6, height: 12, floors: 4, face: 4, seed: 3, neighborhood: 'cambuche', balconies: false };
  const stats = addBuildingDetails({ shell, ...opts });
  addBuildingDetails({ shell: second, ...opts });
  assert.equal(stats.balconies, 0);
  assert.deepEqual(shell.walls.get(1).children[0].geometry.attributes.position.array, original);
  assert.equal(shell.walls.get(1).children.length, 1);
  const materials = new Set();
  shell.root.traverse(o => { assert.ok(!o.isLight); if (o.userData.buildingDetails) materials.add(o.material); });
  assert.ok(materials.size <= 6);
  second.root.traverse(o => { if (o.userData.buildingDetails) { assert.ok(materials.has(o.material)); assert.equal(o.material.map, null); } });
});

test('cortinas e interiores varían sin azar global y solo brillan de noche en ambas vistas', () => {
  const shell = house(12, 12, 30), copy = house(12, 12, 30);
  const opts = { width: 12, depth: 12, height: 30, floors: 10, face: 4, seed: 44, neighborhood: 'comercio' };
  addBuildingDetails({ shell, ...opts }); addBuildingDetails({ shell: copy, ...opts });
  assert.deepEqual(detailGeometry(shell), detailGeometry(copy));
  const panes = shell.walls.get(4).children.filter(m => m.userData.buildingDetails
    && (m.material.roughness === .3 || m.material.roughness === .94 || m.material.userData.windowGlow));
  const warm = panes.find(m => m.material.userData.windowGlow);
  const dark = panes.find(m => m.material.roughness === .3);
  assert.ok(warm && dark && panes.some(m => m.material.roughness === .94));
  assert.equal(warm.material.emissiveIntensity, 0);
  const warmWindows = warm.geometry.attributes.position.count / 4;
  assert.ok(warmWindows >= 2 && warmWindows <= 10, `${warmWindows} ventanas de veinte con luz`);
  const visibility = new BuildingVisibility();
  const building = visibility.register(shell);
  visibility.buildClosedView();
  const facadeMats = building.parts.flatMap(p => p.materials).filter(m => m.userData.windowGlow);
  const closed = [...visibility.closedMaterials.values()].filter(m => m.userData.windowGlow);
  assert.ok(facadeMats.length > 0 && closed.length > 0);
  const district = { props: [], facadeMats, buildingVisibility: visibility };
  Bogota.prototype.setNightMode.call(district, true);
  for (const material of [...facadeMats, ...closed]) assert.equal(material.emissiveIntensity, .42);
  Bogota.prototype.setNightMode.call(district, false);
  for (const material of [...facadeMats, ...closed]) assert.equal(material.emissiveIntensity, 0);
  assert.equal(dark.material.emissiveIntensity, 1, 'el material oscuro conserva su valor base con emissive negro');
  assert.equal(dark.material.emissive.getHex(), 0);
});

test('BuildingVisibility incorpora y oculta los lotes con su pared sin perder triángulos', () => {
  const shell = house();
  addBuildingDetails({ shell, width: 8, depth: 6, height: 12, floors: 4, face: 4, seed: 22, balconies: true });
  const visibility = new BuildingVisibility(), building = visibility.register(shell);
  let before = 0;
  for (const part of building.parts) part.object.traverse(o => { if (o.isMesh) before += o.geometry.index.count; });
  const closed = visibility.buildClosedView();
  assert.equal(closed.children.reduce((sum, o) => sum + o.geometry.index.count, 0), before);
  const front = building.wallParts.find(p => p.object === shell.walls.get(4));
  visibility._fade(front, true, 1);
  assert.equal(front.object.visible, false);
  assert.ok(front.materials.every(m => m.opacity === 0));
  assert.ok(closed.children.every(o => o.material.opacity === 1), 'la versión agrupada no hereda el fundido');
});

test('al volver a aparecer, una pared recupera cómo se mezclaba cada material de fábrica', () => {
  const shell = house(), wall = shell.walls.get(4);
  // Como las manchas de humedad: si quedara opaco, sin alfa se vería un rectángulo oscuro.
  const stain = new THREE.MeshStandardMaterial({ name: 'Mancha', transparent: true, depthWrite: false, opacity: .8 });
  wall.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), stain));
  const visibility = new BuildingVisibility(), building = visibility.register(shell);
  const part = building.wallParts.find(p => p.object === wall);
  const copy = part.materials.find(m => m.name === 'Mancha'), solid = part.materials.find(m => m.name !== 'Mancha');
  assert.ok(copy && solid);
  visibility._fade(part, true, .1);
  assert.ok(part.opacity > 0 && part.opacity < 1);
  assert.ok(Math.abs(copy.opacity - .8 * part.opacity) < 1e-6, 'el fundido parte de su opacidad propia');
  assert.equal(solid.transparent, true);
  assert.equal(solid.depthWrite, false);
  visibility._fade(part, true, 60);
  visibility._fade(part, false, 60);
  assert.equal(part.opacity, 1);
  assert.deepEqual([copy.transparent, copy.depthWrite, copy.opacity], [true, false, .8]);
  assert.deepEqual([solid.transparent, solid.depthWrite, solid.opacity], [false, true, 1]);
});

test('el tanque y pretil de una torre retranqueada permanecen dentro de su coronación', () => {
  const material = () => new THREE.MeshStandardMaterial();
  const palette = { facades: URBAN_DESIGNS.map(material), ...Object.fromEntries(['roof','interior','concrete','trim','rail','glass'].map(k => [k, material()])) };
  const plan = { x: 30, z: 160, width: 12, depth: 12, height: 38.4, floors: 12, design: 'torre-retranqueada', seed: 12 };
  const shell = buildUrbanBuilding(plan, palette);
  assert.equal(shell.root.userData.detailedRoof, true);
  const roof = shell.roof.children.filter(o => o.userData.buildingDetails);
  assert.equal(roof.length, 2);
  for (const mesh of roof) {
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox;
    assert.ok(b.min.y >= plan.height - .8 - 1e-5 && b.max.y <= plan.height + 1e-5);
    assert.ok(b.min.x >= -12 * .76 / 2 - 1e-5 && b.max.x <= 12 * .76 / 2 + 1e-5);
    assert.ok(b.min.z >= -12 * .76 / 2 - 1e-5 && b.max.z <= 12 * .76 / 2 + 1e-5);
  }
});
