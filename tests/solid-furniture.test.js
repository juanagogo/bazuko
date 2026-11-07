import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionSystem } from "../src/systems/CollisionSystem.js";

for (const [name, radius] of [["un poste", .12], ["un árbol", .25]]) {
  test(`${name} detiene al jugador y lo deja resbalar a un lado`, () => {
    const collisions = new CollisionSystem();
    collisions.addPost(0, 5, radius, 0, 3);
    const start = new THREE.Vector3(0, 0, 0);
    const stopped = collisions.resolveMove(start, new THREE.Vector3(0, 0, 8));
    assert.ok(stopped.z < 5 - radius, `llegó a ${stopped.z}`);
    const slid = collisions.resolveMove(new THREE.Vector3(.3, 0, 4.5), new THREE.Vector3(.6, 0, 3));
    assert.ok(slid.z > 5, "pasa por un costado");
  });
}

test("el mobiliario no estorba a la cámara", () => {
  const collisions = new CollisionSystem();
  collisions.addPost(0, 5, .3, 0, 3);
  assert.equal(collisions.mayOccludePlayer(new THREE.Vector3(0, 1.5, 8), new THREE.Vector3(0, 0, 2)), false);
});
