import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Scene, Vector3 } from 'three';
import { Cart } from '../src/entities/Cart.js';
import { CART_AXLE } from '../src/entities/cartVisual.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

const user = (x = 0, y = 0, z = 0) => ({ position: new Vector3(x, y, z), root: new Group() });
const spin = (cart, wheel) => wheel.rotation.x + cart.group.rotation.x;
const wheelBottom = (cart, wheel) => {
  cart.group.updateMatrixWorld(true);
  return new Box3().setFromObject(wheel, true).min.y;
};

function surfaceGap(mesh, floor) {
  const attr = mesh.geometry.attributes.position, point = new Vector3();
  mesh.updateWorldMatrix(true, false);
  let gap = Infinity;
  for (let i = 0; i < attr.count; i++) {
    point.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
    gap = Math.min(gap, point.y - floor(point.x, point.z));
  }
  return gap;
}

test('la carcasa conserva un eje, con un neumático encima del bordillo y el otro en la calle', () => {
  const cart = new Cart(new Scene(), new Vector3(), { groundHeight: x => x < 0 ? .12 : 0 });
  assert.ok(Math.abs(wheelBottom(cart, cart.leftWheel) - .12) < .01);
  assert.ok(Math.abs(wheelBottom(cart, cart.rightWheel)) < .01);
  assert.ok(cart.group.rotation.z < -.08);
  const left = cart.leftWheel.getWorldPosition(new Vector3());
  const right = cart.rightWheel.getWorldPosition(new Vector3());
  assert.ok(Math.abs(left.distanceTo(right) - 2 * CART_AXLE.halfTrack) < 1e-6);
});

test('al subir la cuesta, cada banda toca el piso y gira según la distancia en el plano inclinado', () => {
  const floor = (_x, z) => z * .346;
  const cart = new Cart(new Scene(), new Vector3(0, 0, 1.4), { groundHeight: floor });
  const player = user();
  cart.toggleGrab(player, { maxWeight: 20 });
  cart.placeWithCarrier(player);
  for (let i = 0; i < 10; i++) {
    player.position.z += .05;
    player.position.y = floor(0, player.position.z);
    cart.update(.02, player, null);
  }
  assert.ok(Math.abs(spin(cart, cart.leftWheel) - Math.hypot(.5, .5 * .346) / CART_AXLE.radius) < .012);
  for (const wheel of [cart.leftWheel, cart.rightWheel]) assert.ok(Math.abs(surfaceGap(wheel.children[0], floor)) < .012);
  assert.ok(cart.kickstand.rotation.x > 1.3);
});

test('un giro da arcos de rueda distintos y en reposo no gira, aunque se conserve la velocidad anterior', () => {
  const cart = new Cart(new Scene(), new Vector3(0, 0, 1.4));
  const player = user();
  const inventory = { maxWeight: 20 };
  cart.toggleGrab(player, inventory);
  cart.placeWithCarrier(player);
  player.root.rotation.y = .63;
  cart.update(.04, player, null);
  const left = spin(cart, cart.leftWheel), right = spin(cart, cart.rightWheel);
  assert.ok(Math.abs(left - .63 * CART_AXLE.halfTrack / CART_AXLE.radius) < 1e-6);
  assert.ok(Math.abs(right + left) < 1e-6);
  player.speed = 10;
  cart.update(.05, player, null);
  assert.equal(spin(cart, cart.leftWheel), left);
  assert.equal(spin(cart, cart.rightWheel), right);
  cart.toggleGrab(player, inventory);
  for (let i = 0; i < 40; i++) cart.update(.02, player, null);
  assert.ok(cart.kickstand.rotation.x < .002);
});

test('la caja puede parar frente a la pared y retirarse antes de completar el viraje', () => {
  const collisions = new CollisionSystem();
  const wall = new Box3(new Vector3(-2, 0, 3), new Vector3(2, 5, 4));
  collisions.colliders.push({ box: wall });
  const player = user();
  const cart = new Cart(new Scene(), new Vector3(0, 0, 1.4), { collisions });
  cart.toggleGrab(player, { maxWeight: 20 });
  cart.placeWithCarrier(player);
  const dest = new Vector3(0, 0, 2);
  cart.limitPlayerMove(player.position, dest, 0, 0);
  assert.ok(dest.z > .69 && dest.z < .72);
  player.position.copy(dest);
  cart.update(.05, player, null);
  assert.ok(!new Box3().setFromObject(cart.group, true).intersectsBox(wall));
  const retreat = new Vector3(-.4, 0, -.75);
  const turn = cart.limitPlayerMove(player.position, retreat, 0, Math.PI / 2);
  assert.equal(retreat.z, -.75);
  assert.ok(turn > 0);
});

test('jalar hacia atrás mantiene el rumbo y virar desde el tirador evita barrer el eje de lado', () => {
  const cart = new Cart(new Scene(), new Vector3(0, 0, 1.4));
  const player = user();
  cart.toggleGrab(player, { maxWeight: 20 });
  cart.placeWithCarrier(player);
  const next = new Vector3(0, 0, -.06);
  player.root.rotation.y = cart.limitPlayerMove(player.position, next, 0, Math.PI);
  player.position.copy(next);
  cart.update(.02, player, null);
  assert.equal(player.root.rotation.y, 0);
  assert.ok(Math.abs(spin(cart, cart.leftWheel) + .06 / CART_AXLE.radius) < 1e-6);
  let lateral = 0;
  for (let i = 0; i < 50; i++) {
    const yaw = player.root.rotation.y, x = cart.position.x, z = cart.position.z;
    next.copy(player.position).add(new Vector3(-.015, 0, -.038));
    const angle = cart.limitPlayerMove(player.position, next, yaw, Math.PI / 2);
    player.position.copy(next);
    player.root.rotation.y = angle;
    cart.update(.02, player, null);
    const middle = (yaw + angle) / 2;
    lateral += Math.abs((cart.position.x - x) * Math.cos(middle) - (cart.position.z - z) * Math.sin(middle));
  }
  assert.ok(player.root.rotation.y > .15 && lateral < .02, `avance lateral ${lateral} m`);
});

test('la pata baja sobre la misma capa que las ruedas al soltar en una rampa', () => {
  const floor = (_x, z) => z * .346;
  const heightAt = (x, z, y) => Math.abs(floor(x, z) - y) < .6 ? floor(x, z) : 0;
  const cart = new Cart(new Scene(), new Vector3(0, 5, 15.85), { groundHeight: heightAt });
  const player = user(0, floor(0, 14.45), 14.45), inventory = { maxWeight: 20 };
  cart.toggleGrab(player, inventory);
  cart.placeWithCarrier(player);
  cart.toggleGrab(player, inventory);
  for (let i = 0; i < 50; i++) {
    cart.update(.02, player, null);
    assert.ok(surfaceGap(cart.kickstand, floor) > -.004);
  }
  assert.ok(Math.abs(surfaceGap(cart.kickstand, floor)) < .003);
});

test('el acople evita el salto y una carreta guardada enganchada ya está colocada al arrancar', () => {
  const scene = new Scene(), player = user(1, 0, 0), inventory = { maxWeight: 20 };
  player.root.rotation.y = Math.PI / 2;
  const cart = new Cart(scene, new Vector3(0, 0, 0));
  cart.toggleGrab(player, inventory);
  cart.update(.016, player, null);
  assert.ok(cart.position.length() < .03);
  for (let i = 0; i < 35; i++) cart.update(.02, player, null);
  assert.ok(Math.abs(cart.position.x - 2.4) < 1e-6);
  const state = cart.saveState(), loaded = new Cart(scene), after = user(112.98, .12, 97.84);
  const backpack = { maxWeight: 20 };
  loaded.loadState(state, after, backpack);
  assert.equal(backpack.maxWeight, 140);
  assert.equal(loaded.position.x, state.x);
  loaded.placeWithCarrier(after);
  const first = loaded.position.clone();
  loaded.update(.016, after, null);
  assert.deepEqual(first.toArray(), loaded.position.toArray());
});
