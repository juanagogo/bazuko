import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { animationDamping, SecondaryMotion } from '../src/character/SecondaryMotion.js';

// Jerarquía y pose de reposo del cuerpo real, sin cargar sus texturas ni buffers.
function bodyRig() {
  const json = JSON.parse(readFileSync(new URL('../public/models/personaje/hombre-adulto/cuerpo.gltf', import.meta.url)));
  const nodes = json.nodes.map(node => {
    const bone = new THREE.Bone();
    bone.name = node.name ?? '';
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    if (node.scale) bone.scale.fromArray(node.scale);
    return bone;
  });
  json.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) nodes[index].add(nodes[child]);
  });
  const root = new THREE.Group();
  for (const index of json.scenes[json.scene ?? 0].nodes) root.add(nodes[index]);
  return { root, bones: new Map(nodes.map(bone => [bone.name, bone])) };
}

function transforms(root) {
  root.updateMatrixWorld(true);
  const result = {};
  root.traverse(bone => {
    result[bone.name] = {
      position: bone.position.toArray(), quaternion: bone.quaternion.toArray(),
      scale: bone.scale.toArray(), world: bone.matrixWorld.toArray()
    };
  });
  return result;
}

test('la mezcla llega al mismo peso sin saltos con 30, 60, 144 FPS o NPC a 5 Hz', () => {
  const values = [5, 30, 60, 144].map(fps => {
    let weight = 0;
    for (let frame = 0; frame < fps; frame++) weight += (1 - weight) * animationDamping(1 / fps, 8);
    return weight;
  });
  for (const weight of values) assert.ok(Math.abs(weight - (1 - Math.exp(-8))) < 1e-12);
  assert.ok(animationDamping(.2, 8) < 1, 'un NPC de baja frecuencia todavía mezcla sus poses');
  assert.equal(animationDamping(0, 8), 0);
  assert.equal(animationDamping(-.1, 8), 0);
});

test('la respiración mueve torso y mirada sin desplazar raíz, pelvis, pies ni otro personaje', () => {
  const { root, bones } = bodyRig();
  const other = bodyRig();
  const original = transforms(root), untouched = transforms(other.root);
  const motion = new SecondaryMotion(bones, 1.2);
  motion.apply(1 / 60);
  const animated = transforms(root);
  assert.notDeepEqual(animated[motion.chest.name].quaternion, original[motion.chest.name].quaternion);
  assert.notDeepEqual(animated[motion.head.name].quaternion, original[motion.head.name].quaternion);
  for (const name of Object.keys(original).filter(name => /Hips|UpLeg|Leg|Foot|ToeBase/.test(name) || name === '')) {
    assert.deepEqual(animated[name], original[name], name);
  }
  assert.deepEqual(transforms(other.root), untouched);
  motion.restore();
  assert.deepEqual(transforms(root), original);
});

test('la capa visual no se acumula y restaura también huesos sin pistas de animación', () => {
  const { root, bones } = bodyRig();
  const original = transforms(root);
  const motion = new SecondaryMotion(bones, 2);
  for (let frame = 0; frame < 1000; frame++) motion.apply(1 / 60, { speed: frame % 7, load: .8 });
  motion.restore();
  assert.deepEqual(transforms(root), original);
  motion.restore();
  assert.deepEqual(transforms(root), original, 'restaurar es idempotente');
});

test('las acciones conservan exactamente su pose y la siguiente mezcla usa sus keyframes nuevos', () => {
  const { root, bones } = bodyRig();
  const motion = new SecondaryMotion(bones);
  motion.apply(.2);
  motion.restore();
  // Simula el siguiente AnimationMixer.update, con un gesto propio de cabeza/torso.
  motion.head.quaternion.setFromEuler(new THREE.Euler(.3, -.2, .1));
  motion.chest.quaternion.setFromEuler(new THREE.Euler(.4, .1, -.2));
  const gesture = transforms(root);
  motion.apply(.2, { action: 'saludo', load: 1 });
  assert.deepEqual(transforms(root), gesture);
  motion.apply(.2, { speed: 3 });
  assert.notDeepEqual(transforms(root), gesture);
  motion.restore();
  assert.deepEqual(transforms(root), gesture);
});

test('un esqueleto incompleto permite actualizar y restaurar sin cambios de posición', () => {
  const head = new THREE.Bone();
  head.name = 'mixamorigHead';
  const motion = new SecondaryMotion(new Map([[head.name, head]]));
  motion.apply(.2);
  motion.restore();
  assert.deepEqual(head.quaternion.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(head.position.toArray(), [0, 0, 0]);
});

test('el peso de carrera y carga se conserva al cambiar de frecuencia de animación', () => {
  const poses = [30, 60, 144].map(fps => {
    const { bones } = bodyRig();
    const motion = new SecondaryMotion(bones, .4);
    for (let frame = 0; frame < fps; frame++) motion.apply(1 / fps, { speed: 4, load: .8, phase: .25 });
    return [motion.chest.quaternion.clone().normalize(), motion.head.quaternion.clone().normalize()];
  });
  for (const pose of poses) pose.forEach((rotation, index) => assert.ok(rotation.angleTo(poses[0][index]) < 1e-7));
});
