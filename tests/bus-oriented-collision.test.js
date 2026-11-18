import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

function fixture(yaw = Math.PI / 4, pitch = 0, height = 0) {
  const group = new THREE.Group(); group.rotation.order = 'YXZ'; group.rotation.set(pitch, yaw, 0);
  const bus = { group, position: new THREE.Vector3(0, height, 0), length: 18.2, width: 2.52 };
  const collisions = new CollisionSystem(); collisions.setVehicles([], bus);
  return { bus, collisions, entry: collisions.dynamicColliders[0] };
}

test('las esquinas vacías de la envolvente del bus girado no bloquean al jugador', () => {
  const { collisions, entry } = fixture();
  const position = new THREE.Vector3(6, 0, -6), delta = new THREE.Vector3(.2, 0, 0);
  assert.ok(entry.box.containsPoint(position));
  assert.deepEqual(collisions.resolveMove(position, delta), position.clone().add(delta));
  assert.deepEqual(collisions.resolveMove(position, new THREE.Vector3()), position);
});

test('un movimiento largo no atraviesa la caja orientada del bus en ningún ángulo', () => {
  for (const yaw of [0, .3, Math.PI / 4, Math.PI / 2, 2.4]) {
    const { collisions, entry } = fixture(yaw);
    const side = entry.obb.axes[0];
    const position = side.clone().multiplyScalar(5); position.y = 0;
    const delta = side.clone().multiplyScalar(-10); delta.y = 0;
    const result = collisions.resolveMove(position, delta);
    assert.ok(result.dot(side) >= 1.65, `${yaw}: ${result.dot(side)}`);
  }
});

test('la caja conserva dimensiones, inclinación y posición al girar y permite pasar por debajo', () => {
  const { bus, collisions, entry } = fixture(.7, .2, 8);
  assert.deepEqual(entry.obb.halfSize.toArray(), [1.26, 1.75, 9.1]);
  assert.ok(entry.obb.quaternion.equals(bus.group.quaternion));
  const position = new THREE.Vector3(-5, 0, 0), delta = new THREE.Vector3(10, 0, 0);
  assert.deepEqual(collisions.resolveMove(position, delta), position.clone().add(delta));
  const shape = entry.obb;
  bus.position.x = 12; bus.group.rotation.y = -.4; collisions.setVehicles([], bus);
  assert.equal(entry.obb, shape);
  assert.ok(entry.obb.quaternion.equals(bus.group.quaternion));
});

test("una buseta del tráfico girada 45 grados no bloquea un punto fuera de su carrocería", () => {
  const group = new THREE.Group(); group.rotation.y = Math.PI / 4;
  const buseta = { group, position: new THREE.Vector3(0, 0, 0), length: 9, width: 2.5, kind: "buseta" };
  const collisions = new CollisionSystem(); collisions.setVehicles([buseta]);
  const entry = collisions.dynamicColliders[0];
  assert.ok(entry.obb, "la buseta girada usa caja orientada");
  const corner = new THREE.Vector3(4, 0, 4), delta = new THREE.Vector3(.2, 0, 0);
  assert.ok(entry.box.containsPoint(corner));
  assert.deepEqual(collisions.resolveMove(corner, delta), corner.clone().add(delta));
  const body = new THREE.Vector3(0, 0, 0);
  assert.notDeepEqual(collisions.resolveMove(body, new THREE.Vector3()), body);
});
