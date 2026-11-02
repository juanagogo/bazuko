import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ActionPose } from '../src/character/ActionPose.js';
import { createMeleeOverlay } from '../src/character/melee.js';

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
function snapshot(root) {
  const transforms = [];
  root.traverse(bone => transforms.push([bone.name, ...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]));
  return transforms;
}
function direction(pose, key) {
  const slot = pose.slots.get(key);
  return slot.axis.clone().applyQuaternion(slot.bone.getWorldQuaternion(new THREE.Quaternion())).normalize();
}
function lowest(pose) {
  return Math.min(...['leftFoot', 'rightFoot'].map(key => pose.joints[key].getWorldPosition(new THREE.Vector3()).y));
}

test('el golpe extiende puño al impacto frontal y vuelve sin alterar los pies ni la raíz', () => {
  const { root, bones } = bodyRig(); const pose = new ActionPose(bones);
  const original = snapshot(root), footY = lowest(pose);
  pose.apply(.1, { action: 'golpear', actionProgress: .24 });
  const windup = direction(pose, 'rightArm');
  pose.apply(.1, { action: 'golpear', actionProgress: .22 / .58 });
  const upper = direction(pose, 'rightArm'), fore = direction(pose, 'rightForeArm');
  assert.ok(upper.z > .95 && fore.z > .95, 'puño apunta hacia delante, no arriba como un lanzamiento');
  assert.ok(upper.dot(fore) > .97, 'codo se extiende durante el impacto');
  assert.ok(windup.distanceTo(upper) > .5, 'anticipación diferente a extensión');
  assert.equal(lowest(pose), footY);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  pose.apply(.1, { action: 'golpear', actionProgress: 1 });
  assert.deepEqual(snapshot(root), original, 'al completar el golpe vuelve al clip subyacente');
});

test('los objetivos anatómicos siguen la orientación del personaje', () => {
  const { root, bones } = bodyRig(); root.rotation.y = Math.PI / 2;
  const pose = new ActionPose(bones);
  pose.apply(.1, { action: 'golpear', actionProgress: .22 / .58 });
  assert.ok(direction(pose, 'rightArm').x > .95);
  assert.ok(direction(pose, 'rightForeArm').x > .95);
});

test('despegue, caída y aterrizaje cambian postura sin mover la raíz física', () => {
  const { root, bones } = bodyRig(); const pose = new ActionPose(bones);
  const original = snapshot(root), footY = lowest(pose);
  pose.apply(.1, { action: 'saltar', movement: { grounded: false, verticalVelocity: 5, airTime: .15 } });
  const rising = direction(pose, 'leftUpLeg');
  pose.apply(.1, { movement: { grounded: false, verticalVelocity: -5, airTime: .6 } });
  const falling = direction(pose, 'leftUpLeg');
  assert.ok(rising.z > falling.z + .3, 'despegue recoge las rodillas, caída prepara apoyo');
  pose.apply(.1, { movement: { grounded: true, landing: 1 } });
  assert.ok(Math.abs(lowest(pose) - footY) < 1e-6, 'la compresión conserva la altura de apoyo');
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  pose.apply(.1, { movement: { grounded: true } });
  assert.equal(pose.active, false);
  assert.deepEqual(snapshot(root), original);
});

test('nadar alterna brazadas y flotar sigue moviendo manos sin trasladar la raíz', () => {
  const { root, bones } = bodyRig(); const pose = new ActionPose(bones);
  const original = snapshot(root);
  for (let i = 0; i < 20; i++) pose.apply(1 / 60, { speed: 2, movement: { swimming: true, grounded: false, waterDepth: 2 } });
  const strokeA = direction(pose, 'leftArm');
  assert.ok(direction(pose, 'leftUpLeg').z < -.7, 'piernas quedan detrás durante nado');
  pose.apply(.3, { speed: 2, movement: { swimming: true } });
  assert.ok(strokeA.distanceTo(direction(pose, 'leftArm')) > .3);
  for (let i = 0; i < 30; i++) pose.apply(1 / 60, { speed: 0, movement: { swimming: true } });
  const floatA = direction(pose, 'leftForeArm');
  pose.apply(.3, { speed: 0, movement: { swimming: true } });
  assert.ok(floatA.distanceTo(direction(pose, 'leftForeArm')) > .03, 'reposo remando en el agua');
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  pose.restore(); assert.deepEqual(snapshot(root), original);
});

test('restaurar elimina toda la capa y no contamina otro esqueleto ni acciones existentes', () => {
  const rig = bodyRig(), other = bodyRig(); const pose = new ActionPose(rig.bones);
  const before = snapshot(rig.root), untouched = snapshot(other.root);
  for (let frame = 0; frame < 200; frame++) pose.apply(1 / 60, { action: 'recibirGolpe', actionProgress: (frame % 29) / 29 });
  assert.notDeepEqual(snapshot(rig.root), before);
  assert.deepEqual(snapshot(other.root), untouched);
  pose.restore(); pose.restore(); assert.deepEqual(snapshot(rig.root), before);
  pose.apply(.1, { action: 'buscar', movement: { grounded: false, airTime: .3 } });
  assert.deepEqual(snapshot(rig.root), before, 'gestos existentes tienen prioridad');
});

test('reposo es gratis en LOD pero el NPC conserva la reacción al golpe', () => {
  const rig = bodyRig(); const pose = new ActionPose(rig.bones, { lod: true });
  const original = snapshot(rig.root);
  pose.apply(.1, { movement: { swimming: true } });
  assert.equal(pose.active, false); assert.deepEqual(snapshot(rig.root), original);
  pose.apply(.1, { action: 'recibirGolpe', actionProgress: .18 });
  assert.equal(pose.active, true); assert.notDeepEqual(snapshot(rig.root), original);
  pose.restore(); assert.deepEqual(snapshot(rig.root), original);
});

test('el rig procedural y los esqueletos incompletos usan sus ejes sin NaN', () => {
  const root = new THREE.Group(), hips = new THREE.Group(), spine = new THREE.Group();
  root.add(hips); hips.add(spine);
  const rightArm = new THREE.Group(), rightForeArm = new THREE.Group();
  rightArm.position.set(-.2, .4, 0); rightForeArm.position.y = -.2;
  spine.add(rightArm); rightArm.add(rightForeArm);
  const pose = new ActionPose({ hips, spine, rightArm, rightForeArm }, { procedural: true });
  pose.apply(.1, { action: 'golpear', actionProgress: .22 / .58 });
  assert.ok(direction(pose, 'rightArm').z > .95);
  assert.ok(direction(pose, 'rightForeArm').z > .95);
  pose.apply(NaN, { speed: Infinity, movement: { swimming: true, landing: NaN } });
  for (const values of snapshot(root)) assert.ok(values.slice(1).every(Number.isFinite));
  pose.restore(); assert.deepEqual(root.position.toArray(), [0, 0, 0]);
});

test('la fase de natación depende del tiempo, no de los cuadros por segundo', () => {
  const samples = [30, 60, 144].map(fps => {
    const rig = bodyRig(), pose = new ActionPose(rig.bones);
    for (let i = 0; i < fps; i++) pose.apply(1 / fps, { speed: 2, movement: { swimming: true } });
    return direction(pose, 'leftArm');
  });
  assert.ok(samples[0].distanceTo(samples[1]) < 1e-10);
  assert.ok(samples[1].distanceTo(samples[2]) < 1e-10);
});

test('el nado mezcla entrada y salida sin saltar a una pose fija ni dejar altura residual', () => {
  const { root, bones } = bodyRig(); const pose = new ActionPose(bones);
  root.scale.setScalar(.7);
  const original = snapshot(root);
  pose.apply(1 / 60, { speed: 2, movement: { swimming: true, surfaceY: 1.05 } });
  assert.ok(pose.swimWeight > 0 && pose.swimWeight < .3);
  assert.ok(pose.swimSpeed > 0 && pose.swimSpeed < 1);
  assert.ok(pose.joints.head.getWorldPosition(new THREE.Vector3()).y >= 1.1499);
  for (let i = 0; i < 20; i++) pose.apply(1 / 60, { speed: 2, movement: { swimming: true, surfaceY: 1.05 } });
  const inWater = pose.swimWeight;
  pose.apply(1 / 60, { movement: { grounded: true } });
  assert.ok(pose.swimWeight > 0 && pose.swimWeight < inWater);
  for (let i = 0; i < 60; i++) pose.apply(1 / 60, { movement: { grounded: true } });
  assert.equal(pose.active, false);
  assert.deepEqual(snapshot(root), original);
});

test('el combo por fases tiene una sola capa aunque también llegue la acción legacy', () => {
  const a = bodyRig(), b = bodyRig();
  const pose = new ActionPose(a.bones, { frame: a.root });
  const overlay = createMeleeOverlay(b.bones, b.root);
  const attack = { weapon: 'cuchillo', step: 1, phase: 'active', progress: .1 };
  pose.apply(1 / 60, { action: 'golpear', actionProgress: .22 / .58, attack });
  overlay.apply(1 / 60, attack);
  assert.deepEqual(snapshot(a.root), snapshot(b.root), 'ActionPose no añade otro puñetazo sobre el combo');
});

test('todas las superposiciones se restauran aun cuando el mixer no anima sus huesos', () => {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones, { frame: root });
  const original = snapshot(root);
  const inputs = [
    { attack: { weapon: 'punos', step: 0, phase: 'active', progress: .5 } },
    { smoke: { puff: 1.2 } }, { basuco: 2, action: 'basuco' }, { point: 1 }, { look: .8 }
  ];
  for (const input of inputs) {
    for (let frame = 0; frame < 100; frame++) pose.apply(1 / 60, input);
    assert.notDeepEqual(snapshot(root), original);
    pose.restore();
    assert.deepEqual(snapshot(root), original, JSON.stringify(input));
  }
});

test('agua, vuelo e impacto anulan combos y gestos incluso durante su desvanecimiento', () => {
  for (const state of [
    { speed: 2, movement: { swimming: true, surfaceY: 1 } },
    { action: 'saltar', movement: { grounded: false, verticalVelocity: 4, airTime: .3 } },
    { action: 'recibirGolpe', actionProgress: .2 }
  ]) {
    const a = bodyRig(), b = bodyRig();
    const pose = new ActionPose(a.bones, { frame: a.root }), clean = new ActionPose(b.bones, { frame: b.root });
    pose.apply(.1, { attack: { weapon: 'botella_picada', step: 0, phase: 'active', progress: .3 } });
    pose.apply(.1, { ...state, attack: { weapon: 'cuchillo', phase: 'active' }, smoke: { puff: 1 }, basuco: 2, point: 1, look: .6 });
    clean.apply(.1, state);
    // Ambas capas tienen el mismo tiempo de nado desde que empieza el estado.
    if (!state.movement?.swimming) assert.deepEqual(snapshot(a.root), snapshot(b.root));
    assert.equal(pose.melee.active, false);
    assert.equal(pose.smoke?.active ?? false, false);
    assert.equal(pose.pipe?.active ?? false, false);
  }
});


test('saludar articula mano y antebrazo y vuelve al clip sin arrastrar los pies', () => {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones, { frame: root });
  const base = snapshot(root), support = lowest(pose);
  for (let i = 0; i < 60; i++) pose.apply(1 / 60, { action: 'saludo' });
  assert.ok(direction(pose, 'rightForeArm').y > .9, 'mano elevada al lado de la cabeza');
  const wrist = pose.joints.rightHand.quaternion.clone();
  pose.apply(.3, { action: 'saludo' });
  assert.ok(wrist.angleTo(pose.joints.rightHand.quaternion) > .03, 'la muñeca acompaña el saludo');
  assert.equal(lowest(pose), support);
  for (let i = 0; i < 100; i++) pose.apply(1 / 60);
  assert.deepEqual(snapshot(root), base);
});

test('calentarse lleva las dos manos al frente, no mueve los pies y andar las baja de a poco', () => {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones, { frame: root });
  const base = snapshot(root), support = lowest(pose);
  for (let i = 0; i < 60; i++) pose.apply(1 / 60, { action: 'calentarse' });
  for (const name of ['left', 'right']) {
    const forearm = direction(pose, `${name}ForeArm`);
    assert.ok(forearm.z > .85, `${name}: antebrazo hacia la fogata`);
    assert.ok(Math.abs(forearm.y) < .3, `${name}: a la altura del pecho, no sobre la cabeza`);
  }
  assert.equal(lowest(pose), support);
  const step = pose.warmWeight;
  pose.apply(1 / 60, { action: 'calentarse', speed: 2 });
  assert.ok(pose.warmWeight > step * .8 && pose.warmWeight < step, 'echar a andar no corta el gesto de un golpe');
  for (let i = 0; i < 120; i++) pose.apply(1 / 60, { speed: 2 });
  assert.equal(pose.warmWeight, 0);
  pose.restore();
  assert.deepEqual(snapshot(root), base);
});

test('calentarse se ve aunque esté fumando y le cede las manos a un golpe', () => {
  const { bones } = bodyRig(), pose = new ActionPose(bones);
  for (let i = 0; i < 40; i++) pose.apply(1 / 60, { action: 'calentarse', smoke: { puff: 1.2 } });
  assert.ok(pose.warmWeight > .9, 'las manos van al fuego con el cigarrillo encima');
  pose.apply(1 / 60, { action: 'golpear', actionProgress: .1 });
  assert.equal(pose.warmWeight, 0);
  pose.restore();
});

test('un golpe nuevo cancela el saludo anterior y la reacción absorbe sin perder suelo', () => {
  const a = bodyRig(), b = bodyRig();
  const pose = new ActionPose(a.bones), clean = new ActionPose(b.bones);
  const support = lowest(pose);
  pose.apply(.3, { action: 'saludo' });
  const attack = { weapon: 'punos', step: 0, phase: 'active', progress: .5 };
  pose.apply(.1, { attack }); clean.apply(.1, { attack });
  assert.deepEqual(snapshot(a.root), snapshot(b.root));
  pose.apply(.1, { action: 'recibirGolpe', actionProgress: .25 });
  assert.ok(Math.abs(lowest(pose) - support) < 1e-7);
  assert.notEqual(direction(pose, 'leftUpLeg').z, 0, 'las piernas participan en la absorción');
  pose.restore();
  assert.deepEqual(a.root.position.toArray(), [0, 0, 0]);
});

test('tobillos de salto y nado se restauran junto con la pose de cuerpo entero', () => {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones);
  const base = snapshot(root), ankle = pose.joints.leftFoot.quaternion.clone();
  pose.apply(.2, { movement: { grounded: false, verticalVelocity: 5, airTime: .2 } });
  assert.ok(ankle.angleTo(pose.joints.leftFoot.quaternion) > .01);
  pose.restore(); assert.deepEqual(snapshot(root), base);
  pose.apply(.3, { speed: 2, movement: { swimming: true } });
  pose.restore(); assert.deepEqual(snapshot(root), base);
});

test('despertar andando baja la pose de dormir de a poco, sin cortarla', () => {
  const { bones, root } = bodyRig();
  const pose = new ActionPose(bones, { frame: root });
  for (let i = 0; i < 90; i++) { pose.restore(); pose.apply(1 / 60, { action: 'dormir', movement: { grounded: true } }); }
  const walking = { speed: 3, movement: { grounded: true } };
  pose.restore(); pose.apply(1 / 60, walking);
  assert.ok(pose.sleep.weight > .9, `sigue acostado en el primer cuadro: ${pose.sleep.weight}`);
  for (let i = 0; i < 120; i++) { pose.restore(); pose.apply(1 / 60, walking); }
  assert.equal(pose.sleep.weight, 0);
});

test('dormir realista se restaura antes del mezclador y se cancela al saltar', () => {
  const a = bodyRig(), b = bodyRig();
  const pose = new ActionPose(a.bones, { frame: a.root }), clean = new ActionPose(b.bones, { frame: b.root });
  const before = snapshot(a.root);
  for (let i = 0; i < 90; i++) pose.apply(1 / 60, { action: 'dormir', movement: { grounded: true } });
  assert.ok(pose.sleep.weight > .99);
  assert.notDeepEqual(snapshot(a.root), before);
  pose.restore(); assert.deepEqual(snapshot(a.root), before);
  const airborne = { action: 'saltar', movement: { grounded: false, verticalVelocity: 4, airTime: .3 } };
  pose.apply(.1, airborne); clean.apply(.1, airborne);
  assert.equal(pose.sleep.weight, 0);
  assert.deepEqual(snapshot(a.root), snapshot(b.root));
});
