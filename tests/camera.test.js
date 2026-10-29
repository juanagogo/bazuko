import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CameraRig } from '../src/core/Camera.js';
import { Player } from '../src/entities/Player.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

beforeEach(() => {
  globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {} };
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
});
const rig = () => new CameraRig(new THREE.Scene(), { addEventListener() {} });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('el ragdoll de un atropello respeta paredes y recupera el control al terminar', () => {
  const player = new Player(new THREE.Scene(), { axis: { x: 0, z: 1 }, isRunning: false });
  player.position.set(0, 0, 0);
  const collisions = new CollisionSystem();
  collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(.7, -1, -10), new THREE.Vector3(2, 3, 10)) });
  player.receiveVehicleImpact(new THREE.Vector3(1, 0, 0), 6, { collisions });
  assert.ok(player.isStunned && player.isRagdollActive);
  for (let frame = 0; frame < 5; frame++) player.update(.1, null, collisions);
  assert.ok(player.position.x < .7, 'El cuerpo no atraviesa la pared');
  assert.equal(player.state, 'ragdoll');
  for (let frame = 0; frame < 60; frame++) player.update(.1, null, collisions);
  assert.equal(player.isStunned, false);
  assert.equal(player.root.rotation.z, 0);
  const z = player.position.z; player.update(.1, null, collisions);
  assert.ok(player.position.z > z);
  assert.ok(player.root.position.equals(player.position));
  player.receiveVehicleImpact(new THREE.Vector3(1, 0, 0), 6);
  player.clearVehicleImpact();
  assert.equal(player.isStunned, false);
  assert.equal(player._impactVelocity.length(), 0);
  player.dispose();
});

test('alterna, recuerda la vista y coloca la cámara detrás del personaje', () => {
  const camera = rig();
  const position = new THREE.Vector3(40, 0, 22);
  camera.follow(position);
  assert.equal(camera.mode, 'third-person');
  assert.equal(camera.toggle(), 'isometric');
  camera.follow(position, 0);
  assert.deepEqual(camera.camera.position.toArray(), [52, 16, 34]);
  assert.equal(rig().mode, 'isometric');
  camera.toggle(Math.PI / 2);
  camera.follow(position, 0);
  assert.ok(camera.camera.position.x < position.x);
  near(camera.camera.position.z, position.z);
  assert.equal(rig().mode, 'third-person');
});

test('la cámara se detiene delante de paredes y recupera la distancia al salir', () => {
  const camera = rig();
  camera.yaw = 0;
  const position = new THREE.Vector3();
  const box = new THREE.Box3(new THREE.Vector3(-5, 0, 2), new THREE.Vector3(5, 12, 4));
  camera.follow(position, 1 / 60, { colliders: [{ box }] });
  assert.ok(camera.camera.position.z < 1.8);
  assert.ok(!box.containsPoint(camera.camera.position));
  const shortened = camera._armDistance;
  camera.follow(position, 1 / 60);
  assert.ok(camera._armDistance > shortened && camera._armDistance < camera.distance);
  for (let i = 0; i < 180; i++) camera.follow(position, 1 / 60);
  near(camera._armDistance, camera.distance);
  camera.yaw = Math.PI;
  camera.follow(position, 0, { colliders: [{ box }] });
  near(camera._armDistance, camera.distance); // La pared está ahora al otro lado.
});

test('giro y zoom mantienen límites válidos y recuerdan el modo de cámara', () => {
  const camera = rig();
  camera.orbit(100, 100000);
  near(camera.pitch, 0.65);
  camera.orbit(0, -100000);
  near(camera.pitch, 0.05);
  camera.zoom(100000);
  near(camera.distance, 9);
  camera.zoom(-100000);
  near(camera.distance, 2.5);
  camera.follow(new THREE.Vector3());
  assert.equal(camera.camera.userData.cameraMode, 'third-person');
  camera.toggle();
  assert.equal(camera.camera.userData.cameraMode, 'isometric');
});

function move(camera, axis) {
  // Constructor real: incluye los estados de agua/combate sin cargar GLB ni Canvas.
  const player = new Player(new THREE.Scene(), { axis, isRunning: false });
  player.hasInertia = false;
  player.speedWalk = 3;
  player.position.set(0, 0, 0);
  player.update(0.1, camera, null);
  const position = player.position.clone();
  player.dispose();
  return position;
}

test('WASD sigue el rumbo de tercera persona sin acelerar en diagonal; isométrica conserva los ejes', () => {
  const camera = rig();
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    camera.yaw = yaw;
    camera.follow(new THREE.Vector3());
    const forward = move(camera.camera, { x: 0, z: -1 });
    near(forward.x, -Math.sin(yaw) * 0.3);
    near(forward.z, -Math.cos(yaw) * 0.3);
    const right = move(camera.camera, { x: 1, z: 0 });
    near(right.x, Math.cos(yaw) * 0.3);
    near(right.z, -Math.sin(yaw) * 0.3);
    near(move(camera.camera, { x: 1, z: -1 }).length(), 0.3);
  }
  camera.toggle();
  assert.deepEqual(move(camera.camera, { x: 0, z: -1 }).toArray(), [0, 0, -0.30000000000000004]);
});

test('preparar WASD conserva la dirección sin repetir el recorrido de colisiones', () => {
  const camera = rig();
  let colliderReads = 0;
  const collisions = { get colliders() { colliderReads++; return []; } };
  for (const yaw of [0, 1, 3, -2]) {
    camera.yaw = yaw;
    camera.pitch = 0.4;
    camera.prepareMovement();
    const before = camera.camera.getWorldDirection(new THREE.Vector3());
    camera.follow(new THREE.Vector3(), 1 / 60, collisions);
    const after = camera.camera.getWorldDirection(new THREE.Vector3());
    near(before.distanceTo(after), 0);
  }
  assert.equal(colliderReads, 4);
});

test('reutilizar el vector de salida conserva el resultado y el deslizamiento de colisiones', () => {
  const collisions = new CollisionSystem();
  const wall = new THREE.Object3D();
  wall.position.set(2, 0, 2);
  collisions.add(wall, new THREE.Vector3(2, 8, 2));
  for (const [x, z] of [[1, 0], [1, 1], [0, -1], [-1, -1]]) {
    const position = new THREE.Vector3(0.5, 0, 2);
    const delta = new THREE.Vector3(x, 0, z);
    const expected = collisions.resolveMove(position, delta);
    assert.deepEqual(position.toArray(), [0.5, 0, 2]);
    assert.equal(collisions.resolveMove(position, delta, 0.4, position), position);
    assert.deepEqual(position.toArray(), expected.toArray());
  }
});

test('permite arrastrar la cámara con botón izquierdo o derecho del ratón', () => {
  const listeners = {};
  const mockCanvas = {
    addEventListener(event, fn) { listeners[event] = fn; },
    setPointerCapture(id) { mockCanvas.captured = id; },
    releasePointerCapture(id) { mockCanvas.captured = null; },
    requestPointerLock() { mockCanvas.locked = true; }
  };
  const camera = new CameraRig(new THREE.Scene(), mockCanvas);

  const initialYaw = camera.yaw;
  // Clic izquierdo (0)
  listeners.pointerdown({ button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {} });
  assert.equal(mockCanvas.captured, 1);
  assert.equal(mockCanvas.locked, true);

  // Arrastre
  camera.orbit(20, 10);
  assert.notEqual(camera.yaw, initialYaw);

  // Liberación
  listeners.pointerup();
  assert.equal(camera._drag, null);

  // Clic derecho (2)
  listeners.pointerdown({ button: 2, pointerId: 2, clientX: 200, clientY: 200, preventDefault() {} });
  assert.equal(mockCanvas.captured, 2);
  camera.cancelDrag();
  assert.equal(camera._drag, null);
});

test('modo foto permite arrastrar sin bloquear el cursor y restaura el bloqueo al salir', () => {
  const listeners = {}, canvas = {
    addEventListener(event, fn) { listeners[event] = fn; },
    requestPointerLock() { canvas.locks = (canvas.locks ?? 0) + 1; },
    setPointerCapture(id) { canvas.captured = id; }
  };
  const camera = new CameraRig(new THREE.Scene(), canvas);
  let photoActive = true;
  camera.allowPointerLock = () => !photoActive;
  const press = () => listeners.pointerdown({ button: 0, pointerId: 4, clientX: 0, clientY: 0, preventDefault() {} });
  press();
  assert.equal(canvas.locks, undefined);
  assert.equal(canvas.captured, 4);
  assert.equal(camera._drag.id, 4);
  listeners.pointerup();
  photoActive = false;
  press();
  assert.equal(canvas.locks, 1);
});
