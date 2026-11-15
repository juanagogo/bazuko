// El cuerpo de los malabares: las manos siguen el calendario de la cascada sobre el esqueleto real, sin mover pies ni
// raíz, y andar, saltar u otra acción bajan los brazos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ActionPose } from '../src/character/ActionPose.js';
import { faseMano, manoEnCascada } from '../src/character/rebusquePose.js';
import { BEAT, PERMANENCIA } from '../src/systems/rebusque/ritmo.js';

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

test('el calendario de las manos: cada mano lanza en su tiempo y está más alta al lanzar que al agarrar', () => {
  assert.equal(faseMano(0, 0), 0);
  assert.equal(faseMano(BEAT, 1), 0);
  const agarre = 1 - PERMANENCIA / (2 * BEAT);
  assert.ok(manoEnCascada(.3).alto > manoEnCascada(agarre).alto);
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
  // Sin la acción, la capa se va sola y el esqueleto queda como estaba.
  correr(pose, null, 1.5);
  assert.equal(pose.rebusqueWeight, 0);
  pose.restore();
  assert.deepEqual(snapshot(root), original);
});

test('andar, saltar u otra acción bajan los brazos de los malabares', () => {
  const { bones } = bodyRig(); const pose = new ActionPose(bones);
  correr(pose, 'malabares', 1);
  pose.apply(1 / 60, { action: 'malabares', movement: { grounded: false, verticalVelocity: 3, airTime: .1 } });
  assert.equal(pose.rebusqueWeight, 0, 'saltando');
  correr(pose, 'malabares', 1);
  pose.apply(1 / 60, { action: 'golpear', actionProgress: .3 });
  assert.equal(pose.rebusqueWeight, 0, 'otra acción');
  correr(pose, 'malabares', 1);
  correr(pose, 'malabares', 1, { speed: 2 });
  assert.ok(pose.rebusqueWeight < .01, 'caminando, las manos bajan');
});

test('el muñeco procedural no toma la pose de malabares', () => {
  const { bones } = bodyRig(); const pose = new ActionPose(bones, { procedural: true });
  correr(pose, 'malabares', 1);
  assert.equal(pose.rebusqueWeight, 0);
});
