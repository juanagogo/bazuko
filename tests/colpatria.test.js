import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildColpatria, COLPATRIA, COLPATRIA_ANNEX, busPathX, BUS_DETOUR } from '../src/world/bogota/Colpatria.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { BusService } from '../src/world/bogota/BusService.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

test('la torre es alta, tiene tres franjas emisivas y bloquea su manzana de Centro Internacional', () => {
  const tower = buildColpatria();
  assert.equal(new THREE.Box3().setFromObject(tower).max.y, COLPATRIA.height);
  assert.equal(tower.userData.lightMaterials.length, 3);
  assert.ok(tower.userData.lightMaterials.every(m => m.emissiveIntensity > 1));
  assert.ok(!tower.children.some(o => o.isLight));
  const city = new Bogota(); city.map = city._layout();
  const tx = Math.round(COLPATRIA.x / 2), tz = Math.round(COLPATRIA.z / 2);
  assert.equal(city.map[tz][tx], 'colpatria');
  assert.equal(city.map[tz][Math.round((COLPATRIA.x - COLPATRIA.width / 2) / 2) - 1], 'sidewalk', 'al occidente queda el andén de la Carrera 7');
  assert.equal(city.map[tz][Math.round((COLPATRIA.x - COLPATRIA.width / 2) / 2) - 3], 'road', 'y luego la calzada de la Carrera 7');
  const collisions = new CollisionSystem(); city._buildCollisions(city.map, collisions);
  assert.ok(collisions.colliders.some(({ box }) => box.containsPoint(new THREE.Vector3(COLPATRIA.x, 100, COLPATRIA.z))));
});

test('el conjunto tiene una torre ancha, acceso acristalado y anexo gris con colisión propia', () => {
  const signs = [];
  const tower = buildColpatria({ createSign: options => { signs.push(options); return new THREE.Texture(); } });
  const body = tower.getObjectByName('Cuerpo de la torre');
  const size = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3());
  assert.equal(size.x, COLPATRIA.width); assert.equal(size.z, COLPATRIA.depth);
  assert.ok(tower.getObjectByName('Marquesina de acceso'));
  assert.ok(tower.getObjectByName('Columna del anexo'));
  const annex = tower.getObjectByName('Edificio anexo gris');
  assert.equal(new THREE.Box3().setFromObject(annex).max.y, COLPATRIA_ANNEX.height);
  assert.ok(signs.some(s => s.sub === 'EDIFICIO ANEXO'));
  const city = new Bogota(); city.map = city._layout();
  assert.equal(city.map[Math.round(COLPATRIA_ANNEX.z / 2)][Math.round(COLPATRIA_ANNEX.x / 2)], 'colpatriaAnnex');
  const collisions = new CollisionSystem(); city._buildCollisions(city.map, collisions);
  assert.ok(collisions.colliders.some(({ box }) => box.containsPoint(new THREE.Vector3(COLPATRIA_ANNEX.x, 20, COLPATRIA_ANNEX.z))));
  assert.ok(!collisions.colliders.some(({ box }) => box.containsPoint(new THREE.Vector3(COLPATRIA_ANNEX.x, 30, COLPATRIA_ANNEX.z))));
});

test('el bus rodea la torre, gira sin saltos y evita los sólidos con toda su carrocería', () => {
  const city = new Bogota(); city.map = city._layout();
  const collisions = new CollisionSystem(); city._buildCollisions(city.map, collisions);
  const bus = new BusService(city.getBusRoute());
  let east = false, turn = false, station = false;
  for (let frame = 0; frame < 2500; frame++) {
    const previous = bus.position.clone(), yaw = bus.group.rotation.y;
    bus.update(.05);
    assert.ok(bus.position.distanceTo(previous) < .27);
    assert.ok(Math.abs(bus.group.rotation.y - yaw) < .06);
    if (bus.position.z < BUS_DETOUR.z1 && bus.position.z > BUS_DETOUR.z0) {
      east ||= bus.position.x > 105; turn ||= Math.abs(bus.group.rotation.y) > .6;
      const h = bus.heading;
      for (const along of [-bus.length / 2, 0, bus.length / 2]) for (const side of [-bus.width / 2, bus.width / 2]) {
        const point = new THREE.Vector3(bus.position.x + h.x * along - h.z * side, bus.position.y + .5,
          bus.position.z + h.z * along + h.x * side);
        assert.ok(!collisions.colliders.some(({ box }) => box.containsPoint(point)), `obstáculo en ${point.toArray()}`);
      }
    }
    station ||= bus.position.z < 100;
    if (station) break;
  }
  assert.ok(east && turn && station);
  assert.equal(busPathX(BUS_DETOUR.z0), 78.5);
  assert.equal(busPathX(BUS_DETOUR.z1), 78.5);
});

test('la caja de colisión del bus gira junto con la carrocería', () => {
  const bus = new BusService(new Bogota().getBusRoute());
  bus.position.z = 140; bus._alignToGround();
  const collisions = new CollisionSystem(); collisions.setVehicles([], bus);
  const { box, obb } = collisions.dynamicColliders[0];
  assert.ok(obb.quaternion.equals(bus.group.quaternion));
  for (const x of [-obb.halfSize.x, obb.halfSize.x]) for (const y of [-obb.halfSize.y, obb.halfSize.y]) for (const z of [-obb.halfSize.z, obb.halfSize.z]) {
    const corner = new THREE.Vector3(x,y,z).applyQuaternion(bus.group.quaternion).add(obb.center);
    assert.ok(box.distanceToPoint(corner) < 1e-6);
  }
});
