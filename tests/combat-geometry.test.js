import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { canReachCombatTarget, hasClearCombatLine, resolveCombatWalk } from '../src/systems/CombatGeometry.js';

const point = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function wall() {
  const collisions = new CollisionSystem();
  collisions.colliders.push({ box: new THREE.Box3(point(.45, 0, -2), point(.55, 4, 2)), layered: true });
  return collisions;
}

test('el alcance distingue calle, puente, inmersión y el límite vertical de .85 m', () => {
  const from = point();
  assert.equal(canReachCombatTarget({ from, to: point(1, .85), maxDistance: 1.5 }), true);
  for (const y of [.8501, 7.82, -2]) assert.equal(canReachCombatTarget({ from, to: point(1, y), maxDistance: 1.5 }), false);
  assert.equal(canReachCombatTarget({ from, to: point(2), maxDistance: 1.5 }), false);
  assert.equal(canReachCombatTarget({ from, to: point(NaN) }), false);
});

test('agua bajo el puente no bloquea combate arriba; inmersión de cualquiera sí', () => {
  const getWaterInfo = () => ({ surfaceY: -.18, bottomY: -6.18, depth: 6 });
  assert.equal(canReachCombatTarget({ from: point(0, 7.82), to: point(1, 7.82), getWaterInfo }), true);
  assert.equal(canReachCombatTarget({ from: point(0, -.4), to: point(1, -.4), getWaterInfo }), false);
  assert.equal(canReachCombatTarget({ from: point(), to: point(1), fromInWater: true }), false);
  assert.equal(canReachCombatTarget({ from: point(), to: point(1), toInWater: true }), false);
});

test('la línea al pecho respeta muros y usa el segmento finito en la altura correcta', () => {
  const collisions = wall();
  assert.equal(hasClearCombatLine({ from: point(), to: point(1), collisions }), false);
  assert.equal(hasClearCombatLine({ from: point(), to: point(.4), collisions }), true);
  assert.equal(hasClearCombatLine({ from: point(0, 7.82), to: point(1, 7.82), collisions }), true);
  assert.equal(hasClearCombatLine({ from: point(.5), to: point(1), collisions }), false, 'no escapa una línea que empieza dentro');
});

test('un bus diagonal bloquea por su OBB real y no por las esquinas de su envolvente', () => {
  const collisions = new CollisionSystem();
  const bus = { width: 2, length: 6, position: point(), group: new THREE.Group() };
  bus.group.rotation.y = Math.PI / 4;
  collisions.setVehicles([], bus);
  assert.equal(hasClearCombatLine({ from: point(-4), to: point(4), collisions }), false);
  assert.equal(hasClearCombatLine({ from: point(2.5, 0, -2), to: point(2.7, 0, -2), collisions }), true);
  assert.equal(hasClearCombatLine({ from: point(-4), to: point(4), collisions, ignoreVehicle: bus }), true);
  bus.position.y = 7.82;
  collisions.setVehicles([], bus);
  assert.equal(hasClearCombatLine({ from: point(-4), to: point(4), collisions }), true);
});

test('el avance a pie barre paredes estrechas y conserva la altura inferior', () => {
  const collisions = wall();
  const blocked = resolveCombatWalk({ from: point(), to: point(3), groundHeight: () => 0, collisions });
  assert.ok(blocked.x <= .13 + 1e-6, `${blocked.x}`);
  const below = resolveCombatWalk({ from: point(), to: point(3), groundHeight: () => 7.82 });
  assert.deepEqual(below, point());
});

test('el avance muestrea toda una franja de agua y permite el tablero sobre ella', () => {
  const getWaterInfo = (x) => x >= 1 && x <= 2 ? { surfaceY: -.18, depth: 2, bottomY: -2.18 } : null;
  const groundHeight = (x, z, y) => y > 7 ? 7.82 : x >= 1 && x <= 2 ? -.2 : 0;
  const ground = resolveCombatWalk({ from: point(), to: point(4), groundHeight, getWaterInfo });
  assert.ok(ground.x < 1);
  const deck = resolveCombatWalk({ from: point(0, 7.82), to: point(4, 7.82), groundHeight, getWaterInfo });
  assert.ok(Math.abs(deck.x - 4) < 1e-6);
  assert.equal(deck.y, 7.82);
});
