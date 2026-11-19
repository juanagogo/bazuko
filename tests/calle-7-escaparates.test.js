import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildShopHouse, planEastLots } from '../src/world/bogota/EastBuildings.js';
import { BuildingVisibility } from '../src/world/bogota/BuildingVisibility.js';
import { CITY_HEIGHT } from '../src/world/bogota/CityLayout.js';
import { BASE_CITY_WIDTH, paintEastCity } from '../src/world/bogota/EastZones.js';
import { detailRect } from '../src/world/bogota/ZoneTextures.js';

const map = paintEastCity(Array.from({ length: CITY_HEIGHT }, () => Array(BASE_CITY_WIDTH).fill('building')));
const lots = planEastLots(map).lots.filter(lot => lot.commercial && lot.z0 === 103 && lot.face === 5);
const fromLot = (x, materials) => {
  const lot = lots.find(lot => lot.x0 === x);
  const { shell } = buildShopHouse(lot, materials);
  shell.root.updateMatrixWorld(true);
  return shell;
};
const zoneMaterials = () => Object.fromEntries(['brick', 'clayDark', 'interior', 'detail']
  .map(key => [key, new THREE.MeshStandardMaterial()]));

test('los dos vanos recortan el zócalo y el ladrillo, con vidrio y muebles detrás de la fachada', () => {
  const materials = zoneMaterials();
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
  for (const [lot, x] of [[161, 330], [167, 337]]) {
    const shell = fromLot(lot, materials), front = shell.walls.get(5);
    const brick = [front, shell.base].map(group => group.getObjectByName('Ladrillo alrededor del vano'));
    for (const y of [.44, 1.38]) {
      ray.ray.origin.set(x, y, 202);
      assert.equal(ray.intersectObjects(brick).length, 0);
    }
    const glass = front.getObjectByName('Paños de vidrio de Calle 7');
    const [pane] = ray.intersectObject(glass);
    assert.ok(pane.point.z > 205.15 && pane.point.z < 205.3);
    assert.equal(glass.material.transparent, true);
    assert.equal(glass.material.depthWrite, false);
    ray.ray.origin.y = 3.3;
    assert.equal(ray.intersectObjects(brick).length, 1);
    const furnishing = new THREE.Box3().setFromObject(front.getObjectByName('Interiores de Calle 7'));
    assert.ok(furnishing.min.z > 205 && furnishing.max.z < 209);
    assert.equal(map[103][Math.round(x / 2)], 'building');
  }
});

test('la persiana de la barbería sigue por delante de su pared', () => {
  const front = fromLot(161, zoneMaterials()).walls.get(5);
  const ray = new THREE.Raycaster(new THREE.Vector3(324, 1.65, 202), new THREE.Vector3(0, 0, 1));
  const [roller] = ray.intersectObject(front.getObjectByName('Local comercial'));
  const [u0, v0, u1, v1] = detailRect('rollerDoor');
  assert.ok(roller.uv.x > u0 && roller.uv.x < u1 && roller.uv.y > v0 && roller.uv.y < v1);
  assert.equal(ray.intersectObject(front.getObjectByName('Paños de vidrio de Calle 7')).length, 0);
});

test('la iluminación interior conserva su gradiente y registro nocturno al agrupar los edificios', () => {
  const materials = zoneMaterials(), visibility = new BuildingVisibility();
  visibility.register(fromLot(161, materials));
  visibility.register(fromLot(167, materials));
  const closed = visibility.buildClosedView();
  const rooms = closed.children.filter(mesh => mesh.material.name === 'Luz interior de Calle 7');
  assert.ok(rooms.length > 0);
  for (const room of rooms) {
    const { shopLight, color, position } = room.geometry.attributes;
    assert.equal(shopLight.count, position.count);
    assert.equal(color.count, position.count);
    assert.ok(Math.min(...shopLight.array) < .37 && Math.max(...shopLight.array) > 1.5);
    assert.equal(room.material.emissiveIntensity, 0);
    assert.ok(room.material.userData.windowGlow > 0);
  }
});
