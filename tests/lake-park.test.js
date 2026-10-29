import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LAKE_PARK, LAKE_BRIDGE, bridgeHeight, buildLakeWater } from '../src/world/bogota/LakePark.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { buildColpatriaViaduct } from '../src/world/bogota/ColpatriaViaduct.js';
import { BusService } from '../src/world/bogota/BusService.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

test('el lago permite entrar al jugador y conserva agua bloqueada para peatones y GPS', () => {
  const city = new Bogota(); city.map = city._layout();
  assert.equal(city.height * 2, 322);
  assert.ok(city.map.flat().filter(type => type === 'water').length > 700);
  const water = buildLakeWater(new THREE.MeshStandardMaterial());
  const waterBounds = new THREE.Box3().setFromObject(water);
  assert.ok(waterBounds.containsPoint(new THREE.Vector3(75, -.18, 262)));
  assert.ok(waterBounds.max.x - waterBounds.min.x >= 100);
  water.geometry.dispose(); water.material.dispose();
  assert.equal(city.map[131][20], 'water');
  assert.equal(city.map[131][33], 'water');
  assert.equal(city.map[131][39], 'busway');
  const collisions = new CollisionSystem();
  city._buildCollisions(city.map, collisions);
  const point = new THREE.Vector3(40, -.1, LAKE_PARK.lakeZ);
  assert.equal(collisions.colliders.some(({ box }) => box.containsPoint(point)), false);
  assert.equal(collisions.resolveMove(new THREE.Vector3(20, .06, 262), new THREE.Vector3(20, 0, 0)).x, 40);
  assert.equal(city.getGroundHeight(78.5, 262), bridgeHeight(262));
  city.reserved = { shop: { x: 104, z: 69 } };
  const nav = city._createPedestrianNavigation();
  assert.equal(nav.isWalkableAt(40, 262), false);
  assert.equal(nav.isWalkableAt(66, 262), false);
  assert.equal(nav.isWalkableAt(70, 262), true);
  assert.equal(nav.isWalkableAt(78, 270), true);
  assert.equal(city.createGpsNavigation().isRoutable(40, 262), false);
});

test('el perfil del puente tiene rampas suaves, centro elevado y barandas reales', () => {
  const b = LAKE_BRIDGE;
  assert.ok(Math.abs(bridgeHeight(b.z0) - 7.82) < 1e-8);
  assert.equal(bridgeHeight(b.z1), .02);
  assert.ok(bridgeHeight(LAKE_PARK.lakeZ) > 4.8);
  for (let z = b.z0; z < b.z1; z += .1) assert.ok(Math.abs(bridgeHeight(z + .1) - bridgeHeight(z)) < .033);
  const bridge = buildColpatriaViaduct();
  const bounds = new THREE.Box3().setFromObject(bridge);
  assert.ok(bounds.max.y > 5.8);
  assert.ok(bounds.min.y < 0);
  assert.ok(bounds.min.z <= b.z0);
  bridge.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
});

test('el bus sube y cruza el lago hasta la conexión elevada sin cambiar de carril ni saltar', () => {
  const bus = new BusService(new Bogota().getBusRoute());
  const lane = bus.position.x;
  let climbing = false, high = false, descending = false;
  for (let i = 0; i < 2500 && bus.position.z > 265.5; i++) {
    const before = bus.position.clone();
    bus.update(.05);
    assert.equal(bus.position.x, lane);
    assert.equal(bus.group.rotation.y, 0);
    assert.ok(Math.abs(bus.position.y - before.y) < .085);
    assert.ok(bus.position.y >= bridgeHeight(bus.position.z));
    for (const fraction of [-.5, -.25, 0, .25, .5]) {
      const offset = fraction * bus.length;
      const chassis = bus.position.y - offset * Math.tan(bus.group.rotation.x);
      assert.ok(chassis >= bridgeHeight(bus.position.z + offset) - 1e-8);
    }
    climbing ||= bus.group.rotation.x > .03;
    high ||= bus.position.y > 4.8;
    descending ||= bus.group.rotation.x < -.03;
  }
  assert.ok(climbing && high);
  assert.ok(bus.position.z <= 265.5);
});
