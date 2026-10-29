import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ContactShadows } from '../src/core/ContactShadows.js';

const person = (x = 0, y = 0, z = 0) => ({ position: new THREE.Vector3(x, y, z), root: new THREE.Group() });
const camera = { position: new THREE.Vector3(0, 3, 4) };
const groundHeight = () => 0;
function matrix(mesh, index = 0) { const result = new THREE.Matrix4(); mesh.getMatrixAt(index, result); return result; }
const alpha = (mesh, index = 0) => mesh.geometry.attributes.contactAlpha.getX(index);

test('en calidad baja ancla al suelo con dos lotes sin mapas, luces ni escritura de profundidad', () => {
  const scene = new THREE.Scene(), shadows = new ContactShadows(scene);
  const player = person(), dog = { ...person(2), group: new THREE.Group() };
  const car = { position: new THREE.Vector3(4, 0, 0), group: new THREE.Group(), length: 4.4, width: 1.8 };
  shadows.update({ player, dog, vehicles: [car], groundHeight, camera });
  assert.equal(shadows.count, 3);
  assert.equal(shadows.group.parent, scene);
  assert.equal(shadows.group.children.length, 2);
  for (const mesh of shadows.group.children) {
    assert.ok(mesh.isInstancedMesh);
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.depthTest, true);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.material.map, undefined);
    assert.ok(mesh.frustumCulled);
  }
  assert.ok(Math.abs(matrix(shadows.actors).elements[13] - .02) < 1e-7);
  const low = alpha(shadows.actors);
  shadows.update({ player, quality: 'media', groundHeight, camera });
  const medium = alpha(shadows.actors);
  shadows.update({ player, quality: 'alta', groundHeight, camera });
  assert.ok(low > medium && medium > alpha(shadows.actors), 'complementa con discreción las sombras de calidad alta');
  shadows.dispose();
});

test('saltos conservan la planta del puente, atenúan el apoyo y no proyectan en un techo ajeno', () => {
  const shadows = new ContactShadows(new THREE.Scene());
  const player = person(0, 7.82), view = { position: new THREE.Vector3(0, 10, 4) };
  const layered = (_x, _z, currentY) => currentY > 7 ? 7.82 : 0;
  shadows.update({ player, groundHeight: layered, camera: view });
  const groundedAlpha = alpha(shadows.actors);
  player.position.y = 8.6; player.isGrounded = false;
  player.groundSurface = { height: 7.82, layer: 'viaduct' };
  shadows.update({ player, groundHeight: layered, camera: view });
  assert.equal(shadows.count, 1);
  assert.ok(Math.abs(matrix(shadows.actors).elements[13] - 7.84) < 1e-6);
  assert.ok(alpha(shadows.actors) < groundedAlpha);
  player.position.y = 10;
  shadows.update({ player, groundHeight: layered, camera: view });
  assert.equal(shadows.count, 0, 'a gran altura la sombra de contacto desaparece');
  player.position.y = 0; player.isGrounded = true;
  shadows.update({ player, groundHeight: () => 7.82, camera });
  assert.equal(shadows.count, 0, 'un actor bajo el puente nunca mancha el tablero por encima');
  shadows.update({ player, groundHeight: layered, camera });
  assert.equal(shadows.count, 1);
  assert.ok(Math.abs(matrix(shadows.actors).elements[13] - .02) < 1e-7);
  shadows.dispose();
});

test('el agua profunda y actores inactivos no dejan manchas, pero el puente sobre agua sí', () => {
  const shadows = new ContactShadows(new THREE.Scene());
  const water = () => ({ surfaceY: 0, depth: 2 });
  const wet = person(0, -2), hidden = person(1), inactive = { ...person(2), active: false };
  hidden.root.visible = false;
  shadows.update({ player: wet, npcs: [hidden, inactive], groundHeight: () => -2, getWaterInfo: water, camera });
  assert.equal(shadows.count, 0);
  wet.position.y = 7.82;
  shadows.update({ player: wet, groundHeight: () => 7.82, getWaterInfo: water, camera: { position: new THREE.Vector3(0, 9, 4) } });
  assert.equal(shadows.count, 1, 'la presencia de agua bajo el viaducto no apaga la sombra del tablero');
  wet.isSwimming = true;
  shadows.update({ player: wet, groundHeight: () => 7.82, camera });
  assert.equal(shadows.count, 0);
  shadows.dispose();
});

test('el presupuesto global elige vecinos cercanos y mantiene al jugador y perro', () => {
  const shadows = new ContactShadows(new THREE.Scene(), { capacity: 4 });
  const player = person(), dog = person(1);
  const npcs = [person(40), person(30), person(2), person(4), person(20)];
  const car = { position: new THREE.Vector3(3, 0, 0), group: new THREE.Group(), length: 4, width: 2 };
  let groundQueries = 0;
  shadows.update({ player, dog, npcs, vehicles: [car], camera, groundHeight: () => { groundQueries++; return 0; } });
  assert.equal(shadows.count, 4);
  assert.equal(shadows.actors.count, 3); assert.equal(shadows.vehicles.count, 1);
  const positions = Array.from({ length: shadows.actors.count }, (_, i) => matrix(shadows.actors, i).elements[12]);
  assert.deepEqual(positions, [0, 1, 2]);
  assert.equal(matrix(shadows.vehicles).elements[12], 3);
  assert.ok(groundQueries <= 3 * shadows.capacity);
  const buffers = [shadows.actors.instanceMatrix.array, shadows.vehicles.instanceMatrix.array, shadows.actors.geometry.attributes.contactAlpha.array];
  for (let i = 0; i < 100; i++) shadows.update({ player, npcs, vehicles: [car], camera, groundHeight });
  assert.equal(shadows.actors.instanceMatrix.array, buffers[0]);
  assert.equal(shadows.vehicles.instanceMatrix.array, buffers[1]);
  assert.equal(shadows.actors.geometry.attributes.contactAlpha.array, buffers[2]);
  shadows.dispose();
});

test('la huella sigue la orientación de carros, buses y la pendiente de una rampa', () => {
  const shadows = new ContactShadows(new THREE.Scene());
  const bus = { position: new THREE.Vector3(0, 0, 0), group: new THREE.Group(), length: 18, width: 2.5 };
  shadows.update({ vehicles: [{ vehicle: bus, forwardAxis: 'z' }], groundHeight, camera });
  const footprint = matrix(shadows.vehicles).elements;
  assert.ok(Math.abs(footprint[0]) < 1e-6);
  assert.ok(Math.abs(footprint[2]) > 8.9, 'el largo del bus va por Z');
  const car = { position: new THREE.Vector3(0, 0, 0), group: new THREE.Group(), length: 4, width: 2 };
  car.group.rotation.y = Math.PI / 2;
  shadows.update({ vehicles: [car], camera, groundHeight: (x, z) => .1 * x + .05 * z });
  const transform = matrix(shadows.vehicles);
  const normal = new THREE.Vector3().setFromMatrixColumn(transform, 1).normalize();
  assert.ok(normal.distanceTo(new THREE.Vector3(-.1, 1, -.05).normalize()) < 1e-6);
  assert.ok(Math.abs(transform.elements[13] - .02) < 1e-7);
  shadows.dispose();
});

test('el modelo interno de Car no sustituye al actor y El Chato no se duplica como peatón', () => {
  const shadows = new ContactShadows(new THREE.Scene());
  const car = { position: new THREE.Vector3(4, 0, 1), group: new THREE.Group(), length: 4.4, width: 1.8,
    vehicle: { group: new THREE.Group(), length: 2, width: 1, visible: false } };
  const dog = person(2);
  shadows.update({ dog, npcs: [dog], vehicles: [car], groundHeight, camera });
  assert.equal(shadows.actors.count, 1);
  assert.equal(shadows.vehicles.count, 1);
  const transform = matrix(shadows.vehicles);
  assert.equal(transform.elements[12], 4);
  assert.equal(transform.elements[14], 1);
  assert.ok(Math.abs(new THREE.Vector3().setFromMatrixColumn(transform, 0).length() - 2.2) < 1e-6);
  shadows.dispose();
});

test('el descarte y los bounds se actualizan al mover la cámara también en pausa', () => {
  const shadows = new ContactShadows(new THREE.Scene());
  const view = new THREE.PerspectiveCamera(55, 1, .1, 200);
  view.position.set(0, 3, 5); view.lookAt(0, 0, 0);
  const player = person();
  shadows.update({ player, npcs: [person(0, 0, 12), person(30)], camera: view, groundHeight });
  assert.equal(shadows.count, 1);
  player.position.x = 100;
  view.position.x = 100; view.lookAt(100, 0, 0);
  shadows.update({ player, camera: view, groundHeight });
  assert.equal(shadows.count, 1);
  assert.ok(shadows.actors.boundingSphere.center.x > 99);
  assert.ok(shadows.actors.boundingBox.containsPoint(new THREE.Vector3(100, .02, 0)));
  player.position.x = 160;
  shadows.update({ player, camera: view, groundHeight });
  assert.equal(shadows.group.visible, false);
  shadows.dispose();
});

test('libera cada recurso una vez y nunca modifica actores o geometría ajena', () => {
  const scene = new THREE.Scene(), shadows = new ContactShadows(scene, { capacity: 500 });
  assert.equal(shadows.capacity, 128);
  const player = person(), before = player.root.toJSON();
  shadows.update({ player, camera, groundHeight });
  assert.deepEqual(player.root.toJSON(), before);
  let released = 0;
  for (const mesh of [shadows.actors, shadows.vehicles]) {
    for (const resource of [mesh, mesh.geometry, mesh.material]) resource.addEventListener('dispose', () => released++);
  }
  shadows.dispose(); shadows.dispose(); shadows.update({ player });
  assert.equal(released, 6);
  assert.equal(scene.children.length, 0);
});
