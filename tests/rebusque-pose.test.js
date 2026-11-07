// Poses del rebusque sobre el esqueleto real: las manos de los malabares siguen la cascada, el rodillo barre, el
// dulce se ofrece y el paso atrás levanta las palmas. Sin mover los pies ni la raíz, y sin dejar rastro al terminar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ActionPose } from '../src/character/ActionPose.js';
import { POSES_REBUSQUE, barrido, faseMano, manoEnCascada, FASE_AGARRE } from '../src/character/rebusquePose.js';
import { BEAT } from '../src/systems/rebusque/ritmo.js';

function bodyRig() {
  const json = JSON.parse(readFileSync(new URL('../public/models/personaje/hombre-adulto/cuerpo.gltf', import.meta.url)));
  const nodes = json.nodes.map(node => {
    const bone = new THREE.Bone(); bone.name = node.name ?? '';
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    if (node.scale) bone.scale.fromArray(node.scale);
    return bone;
  });
  json.nodes.forEach((node, i) => { for (const child of node.children ?? []) nodes[i].add(nodes[child]); });
  const root = new THREE.Group();
  for (const i of json.scenes[json.scene ?? 0].nodes) root.add(nodes[i]);
  return { root, bones: new Map(nodes.map(bone => [bone.name, bone])) };
}
const snapshot = root => { const t = []; root.traverse(b => t.push([b.name, ...b.position.toArray(), ...b.quaternion.toArray()])); return t; };
const mundo = (pose, key) => pose.joints[key].getWorldPosition(new THREE.Vector3());
const lowest = pose => Math.min(...['leftFoot', 'rightFoot'].map(k => mundo(pose, k).y));
const correr = (pose, action, segundos, extra = {}) => { for (let t = 0; t < segundos; t += 1 / 60) pose.apply(1 / 60, { action, speed: 0, ...extra }); };

test('el calendario de las manos: cada mano lanza en su tiempo y agarra antes de volver a lanzar', () => {
  assert.equal(faseMano(0, 0), 0);
  assert.equal(faseMano(BEAT, 1), 0);
  assert.ok(FASE_AGARRE > .5 && FASE_AGARRE < 1);
  // Lanza subiendo: la mano está más alta un poco después de lanzar que justo al agarrar.
  assert.ok(manoEnCascada(.3).alto > manoEnCascada(FASE_AGARRE).alto);
  assert.equal(barrido(0), -1);
  assert.ok(Math.abs(barrido(1.25) - 1) < 1e-9);
  assert.equal(POSES_REBUSQUE.size, 4);
});

test('malabares: las dos manos suben y bajan alternadas delante del pecho, sin tocar pies ni raíz', () => {
  const { root, bones } = bodyRig(); const pose = new ActionPose(bones);
  const original = snapshot(root), pies = lowest(pose);
  const quieto = { r: mundo(pose, 'rightHand').clone(), l: mundo(pose, 'leftHand').clone() };
  correr(pose, 'malabares', 1);
  assert.ok(pose.rebusqueWeight > .99);
  const alturas = { r: [], l: [] };
  for (let i = 0; i < 40; i++) {
    pose.apply(1 / 60, { action: 'malabares', speed: 0 });
    alturas.r.push(mundo(pose, 'rightHand').y); alturas.l.push(mundo(pose, 'leftHand').y);
  }
  const rango = a => Math.max(...a) - Math.min(...a);
  assert.ok(rango(alturas.r) > .03 && rango(alturas.l) > .03, `${rango(alturas.r)} ${rango(alturas.l)}`);
  const r = mundo(pose, 'rightHand'), l = mundo(pose, 'leftHand');
  const hombro = mundo(pose, 'rightArm').y, cadera = mundo(pose, 'hips').y;
  assert.ok(r.y > quieto.r.y + .1 && l.y > quieto.l.y + .1, 'las manos suben');
  assert.ok(r.y < hombro && l.y < hombro && r.y > cadera + .15 && l.y > cadera + .15, 'entre la cintura y los hombros');
  assert.ok(r.z > .3 && l.z > .3, 'delante del cuerpo');
  assert.ok(Math.abs(r.x - l.x) > .2 && Math.abs(r.x - l.x) < .8, 'separadas como para pasarse las pelotas');
  assert.equal(lowest(pose), pies);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  // Al terminar, la capa se va sola.
  correr(pose, null, 1.5);
  assert.equal(pose.rebusqueWeight, 0);
  pose.restore();
  assert.deepEqual(snapshot(root), original);
});

test('limpiar barre de lado a lado con la derecha; ofrecer estira el dulce; apartarse sube las palmas', () => {
  const { bones } = bodyRig(); const pose = new ActionPose(bones);
  correr(pose, 'limpiar', .8);
  const xs = [];
  for (let i = 0; i < 150; i++) { pose.apply(1 / 60, { action: 'limpiar', speed: 0 }); xs.push(mundo(pose, 'rightHand').x); }
  assert.ok(Math.max(...xs) - Math.min(...xs) > .35, `barrido ${Math.max(...xs) - Math.min(...xs)}`);
  const ofrecer = bodyRig(), p2 = new ActionPose(ofrecer.bones);
  const antes = mundo(p2, 'rightHand').clone();
  correr(p2, 'ofrecer', 1);
  assert.ok(mundo(p2, 'rightHand').z > antes.z + .25, 'el dulce va hacia la ventana');
  const apartar = bodyRig(), p3 = new ActionPose(apartar.bones);
  correr(p3, 'apartarse', .8);
  assert.ok(mundo(p3, 'leftHand').y > mundo(p3, 'leftArm').y && mundo(p3, 'rightHand').y > mundo(p3, 'rightArm').y, 'manos en alto');
  assert.ok(mundo(p3, 'leftHand').z > .2, 'las palmas al frente, hacia el carro');
});

test('andar, saltar o nadar bajan la pose; otra acción la corta', () => {
  const { bones } = bodyRig(); const pose = new ActionPose(bones);
  correr(pose, 'malabares', 1);
  pose.apply(1 / 60, { action: 'malabares', movement: { grounded: false, verticalVelocity: 3, airTime: .1 } });
  assert.equal(pose.rebusqueWeight, 0);
  correr(pose, 'malabares', 1);
  pose.apply(1 / 60, { action: 'golpear', actionProgress: .3 });
  assert.equal(pose.rebusqueWeight, 0);
  correr(pose, 'malabares', 1);
  correr(pose, 'malabares', 1, { speed: 2 });
  assert.ok(pose.rebusqueWeight < .01, 'caminando, las manos bajan');
});
