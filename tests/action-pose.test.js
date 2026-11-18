import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ActionPose } from '../src/character/ActionPose.js';
import { createMeleeOverlay } from '../src/character/melee.js';
import { HARD_LANDING, hardLanding, hardSlide, landingDrop, landingDuration, landingGive, landingImpact, timeToGround, JUMP } from '../src/character/jumpMotion.js';
import { Player } from '../src/entities/Player.js';
import { REALISTIC_SCALE } from '../src/character/RealisticCharacter.js';

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
const at = (pose, key) => pose.joints[key].getWorldPosition(new THREE.Vector3());
/** Huesos del cuerpo (sin dedos) para medir giros por cuadro. */
const bodyBone = name => /(Hips|Spine\d?|Neck|Head|Arm|ForeArm|Hand|UpLeg|Leg|Foot)$/.test(name);
/** Mayor giro (grados) de un hueso en el mundo desde la llamada anterior. */
function turnMeter(root, keep = bodyBone) {
  const bones = [];
  root.traverse(bone => { if (bone.isBone && keep(bone.name)) bones.push(bone); });
  const last = bones.map(bone => bone.getWorldQuaternion(new THREE.Quaternion())), q = new THREE.Quaternion();
  return () => {
    let most = 0;
    bones.forEach((bone, i) => {
      bone.getWorldQuaternion(q);
      most = Math.max(most, 2 * Math.acos(Math.min(1, Math.abs(q.dot(last[i])))) * 180 / Math.PI);
      last[i].copy(q);
    });
    return most;
  };
}
/**
 * Clip de reposo con los brazos colgando (sin clip quedan en la pose de enlace, en cruz). Devuelve la función
 * que lo pone antes de cada cuadro, como el mezclador.
 */
function hangingArms(pose, root) {
  root.updateMatrixWorld(true);
  const down = [['leftArm', 1], ['rightArm', -1]].map(([key, side]) => {
    const { bone, axis } = pose.slots.get(key), world = bone.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromUnitVectors(axis.clone().applyQuaternion(world).normalize(), new THREE.Vector3(side * .12, -1, .05).normalize());
    return [bone, bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(turn.multiply(world))];
  });
  return () => {
    pose.restore();
    for (const [bone, quaternion] of down) bone.quaternion.copy(quaternion);
    root.updateMatrixWorld(true);
  };
}
/** Jugador real con el esqueleto de la pose encima, como en el juego (sin mezclador; `hang`: brazos colgando). */
function playerRig({ hang = false } = {}) {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones);
  const clip = hang ? hangingArms(pose, root) : () => {};
  const input = {
    axis: { x: 0, z: 0 }, isRunning: false, held: false, presses: new Set(),
    consumePress(key) { return this.presses.delete(key); },
    isDown(key) { return (key === 'Space' || key === 'KeySpace') && this.held; }
  };
  const p = new Player(new THREE.Scene(), input);
  const step = (dt, ground, water = null) => {
    clip();
    p.update(dt, null, null, ground, [], water);
    root.position.copy(p.position); root.quaternion.copy(p.root.quaternion); root.updateMatrixWorld(true);
    pose.apply(dt, { speed: p.speed, movement: p.movement, action: p.isSwimming || p.isGrounded ? null : 'saltar' });
  };
  clip();
  pose.apply(1 / 60, { movement: { grounded: true } });
  return { root, pose, p, input, step };
}
const DEG = 180 / Math.PI;
/**
 * Brazo `side` (1 izquierdo, -1 derecho) en el marco del personaje (rumbo de `root`), en grados: flexión (de
 * perfil, adelante), apertura (de frente, al costado), hombro (con la vertical), codo (entre brazo y
 * antebrazo) y cuánto sube el antebrazo sobre la horizontal; cuánto pasan del mentón el centro de la mano y la
 * punta de los dedos, y a qué distancia del plano medio (por el medio de los hombros) queda el centro de la
 * mano, positiva de su lado (m).
 */
function armAngles(pose, root, side) {
  const name = side > 0 ? 'left' : 'right';
  const yaw = new THREE.Euler().setFromQuaternion(root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), out = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(side);
  const shoulder = at(pose, `${name}Arm`), elbow = at(pose, `${name}ForeArm`), wrist = at(pose, `${name}Hand`);
  const upper = elbow.clone().sub(shoulder).normalize(), fore = wrist.clone().sub(elbow).normalize();
  const chin = at(pose, 'head').y - .025;
  const middle = at(pose, 'leftArm').add(at(pose, 'rightArm')).multiplyScalar(.5);
  return {
    flex: Math.atan2(upper.dot(forward), -upper.y) * DEG, open: Math.atan2(upper.dot(out), -upper.y) * DEG,
    shoulder: Math.acos(Math.min(1, Math.max(-1, -upper.y))) * DEG, elbow: upper.angleTo(fore) * DEG,
    forearmUp: Math.asin(Math.min(1, Math.max(-1, fore.y))) * DEG,
    hand: wrist.y + .09 * fore.y - chin, fingers: wrist.y + .18 * fore.y - chin,
    lateral: wrist.clone().addScaledVector(fore, .09).sub(middle).dot(out), upper, fore
  };
}
/**
 * Mayor cambio (grados) de la dirección de un brazo o un antebrazo respecto al tronco (cadera a cuello, con el
 * rumbo de `root`) desde la llamada anterior: lo que se ve moverse, sin el giro del hueso sobre su eje.
 */
function armMeter(pose, root) {
  const keys = [['leftArm', 'leftForeArm'], ['leftForeArm', 'leftHand'], ['rightArm', 'rightForeArm'], ['rightForeArm', 'rightHand']];
  let last = null;
  return () => {
    const yaw = new THREE.Euler().setFromQuaternion(root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    const up = at(pose, 'neck').sub(at(pose, 'hips')).normalize();
    const ahead = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).projectOnPlane(up).normalize(), side = up.clone().cross(ahead);
    const now = keys.map(([from, to]) => {
      const d = at(pose, to).sub(at(pose, from)).normalize();
      return new THREE.Vector3(d.dot(ahead), d.dot(side), d.dot(up));
    });
    const most = last ? Math.max(...now.map((d, i) => d.angleTo(last[i]) * DEG)) : 0;
    last = now;
    return most;
  };
}
/** Rodilla `name` doblada, en grados (0 estirada). */
function kneeBend(pose, name) {
  const hip = at(pose, `${name}UpLeg`), knee = at(pose, `${name}Leg`), ankle = at(pose, `${name}Foot`);
  return knee.clone().sub(hip).angleTo(ankle.clone().sub(knee)) * DEG;
}
/** Racha más larga de cuadros en que los dos brazos cambian menos de `still` grados (flexión, apertura y codo). */
function frozenRun(frames, still = 1) {
  let run = 0, longest = 0;
  for (let i = 1; i < frames.length; i++) {
    const quiet = [0, 1].every(s => ['flex', 'open', 'elbow'].every(k => Math.abs(frames[i][s][k] - frames[i - 1][s][k]) < still));
    run = quiet ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
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

test('empuje, ápice, caída y aterrizaje salen del estado físico sin mover la raíz', () => {
  const { root, bones } = bodyRig(); const pose = new ActionPose(bones);
  const original = snapshot(root), footY = lowest(pose);
  // La raíz va a la altura del hueco: el suelo de debajo es siempre el mismo (y = 0).
  const air = (vy, airTime, gap, ttg) => {
    root.position.y = gap; root.updateMatrixWorld(true);
    return { grounded: false, verticalVelocity: vy, airTime, launchSpeed: 5.45, groundGap: gap, timeToGround: ttg };
  };
  // Empuje: la raíz ya subió 15 cm, la cadera se queda abajo y los pies siguen en el piso.
  pose.apply(1 / 60, { action: 'saltar', movement: air(4.9, .03, .15, .6) });
  assert.ok(pose.jumpHipDrop > .08, `la cadera no sube de golpe con la raíz: ${pose.jumpHipDrop}`);
  assert.ok(lowest(pose) < footY + root.position.y - .08, 'los pies siguen abajo mientras la raíz sube');
  pose.apply(1 / 60, { action: 'saltar', movement: air(0, .28, .78, .3) });
  const apex = direction(pose, 'leftUpLeg');
  assert.ok(apex.z > .6, `en el ápice las rodillas suben: ${apex.z}`);
  assert.equal(pose.jumpHipDrop, 0, 'pasado el empuje la cadera va con la raíz');
  pose.apply(1 / 60, { movement: air(-5.4, .58, .02, .004) });
  const reaching = direction(pose, 'leftUpLeg');
  assert.ok(reaching.z < apex.z - .5, 'al llegar al suelo las piernas lo buscan');
  const landing = impact => {
    root.position.y = 0; root.updateMatrixWorld(true);
    pose.apply(1 / 60, { movement: { grounded: true, landing: 1, landingTime: .06, landingImpact: impact } });
    assert.ok(Math.abs(lowest(pose) - footY) < 1e-6, 'la compresión conserva la altura de apoyo');
    return pose.jumpHipDrop;
  };
  const soft = landing(0), hard = landing(1);
  assert.ok(soft > .02 && hard > soft * 2, `el aterrizaje se dobla según el golpe: ${soft} / ${hard}`);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  // De pie, los pies anclados vuelven al clip en ~0,25 s y después no queda nada.
  for (let i = 0; i < 3; i++) pose.apply(.1, { movement: { grounded: true } });
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

test('golpe fuerte: piernas juntas antes de tocar, pies clavados donde tocaron, cadera abajo, tronco adelante y mirada al frente', () => {
  const { root, bones } = bodyRig(); const pose = new ActionPose(bones);
  const footY = lowest(pose), spine0 = direction(pose, 'spine'), head0 = direction(pose, 'head');
  pose.apply(1 / 60, { movement: { grounded: true } }); // de pie: mide el tobillo en reposo
  const ankles = () => ['leftFoot', 'rightFoot'].map(key => pose.joints[key].getWorldPosition(new THREE.Vector3()));
  // Cayendo de 5 m, a 7 ms del suelo: se prepara con las dos piernas juntas bajo la cadera.
  pose.apply(1 / 60, { movement: { grounded: false, verticalVelocity: -15, airTime: .65, launchSpeed: 0, groundGap: .1, timeToGround: .007, fallHeight: 5 } });
  const [l0, r0] = ankles();
  assert.ok(Math.abs(l0.x - r0.x) < .3 && Math.abs(l0.z - r0.z) < .1, `piernas juntas: ${l0.toArray()} / ${r0.toArray()}`);
  const ground = t => ({ grounded: true, landing: 1, landingTime: t, landingImpact: 1, landingSpeed: 15.2 });
  pose.apply(1 / 60, { movement: ground(.005) });
  const pinned = ankles();
  let deepest = 0;
  for (const t of [.05, .12, .2]) {
    pose.apply(1 / 60, { movement: ground(t) });
    deepest = Math.max(deepest, pose.jumpHipDrop);
    ankles().forEach((ankle, i) => assert.ok(ankle.distanceTo(pinned[i]) < .01, `${t} s: el pie ${i} no se mueve del punto en que tocó`));
    assert.ok(Math.abs(lowest(pose) - footY) < .02, `${t} s: los pies siguen en el piso (${lowest(pose).toFixed(3)} vs ${footY.toFixed(3)})`);
  }
  assert.ok(deepest >= .25 && deepest <= .35, `la cadera baja 25-35 cm: ${deepest}`);
  const spine = direction(pose, 'spine'), head = direction(pose, 'head');
  const lean = spine.angleTo(spine0) * 180 / Math.PI, gaze = head.angleTo(head0) * 180 / Math.PI;
  assert.ok(lean > 30 && lean < 50, `tronco adelante ~40°: ${lean.toFixed(1)}`);
  assert.ok(gaze < lean - 15, `el cuello compensa y la cabeza mira adelante: cabeza ${gaze.toFixed(1)}° vs tronco ${lean.toFixed(1)}°`);
  const hands = ['leftHand', 'rightHand'].map(key => pose.joints[key].getWorldPosition(new THREE.Vector3()));
  for (const hand of hands) assert.ok(hand.z > pinned[0].z + .1 && hand.y < .6, `las manos van al piso por delante de los pies: ${hand.toArray().map(v => v.toFixed(2))}`);
  // Al levantarse los pies vuelven al clip (en ~0,25 s) y al final no queda nada.
  for (let i = 0; i < 20; i++) pose.apply(1 / 60, { movement: { grounded: true } });
  assert.equal(pose.active, false);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
});

test('golpe fuerte con piernas cortas: la cadera baja en proporción al largo de la pierna y los pies siguen en el piso', () => {
  const { root, bones } = bodyRig(); root.scale.setScalar(.6); root.updateMatrixWorld(true);
  const pose = new ActionPose(bones);
  const footY = lowest(pose);
  pose.apply(1 / 60, { movement: { grounded: true } });
  pose.apply(1 / 60, { movement: { grounded: false, verticalVelocity: -15, airTime: .65, launchSpeed: 0, groundGap: .1, timeToGround: .007, fallHeight: 5 } });
  let deepest = 0;
  for (const t of [.005, .05, .12, .2]) {
    pose.apply(1 / 60, { movement: { grounded: true, landing: 1, landingTime: t, landingImpact: 1, landingSpeed: 15.2 } });
    deepest = Math.max(deepest, pose.jumpHipDrop);
    assert.ok(Math.abs(lowest(pose) - footY) < .02, `${t} s: los pies siguen en el piso (${lowest(pose).toFixed(3)} vs ${footY.toFixed(3)})`);
  }
  assert.ok(deepest >= .15 && deepest <= .21, `con el cuerpo al 60 % baja ~60 % de 25-35 cm: ${deepest}`);
});

/** Salto parado completo con el jugador real: brazos por cuadro desde el despegue hasta 0,5 s después de tocar. */
function standingJump(rig, { held = true } = {}) {
  const { root, pose, p, input, step } = rig, ground = () => 0;
  for (let i = 0; i < 30; i++) step(1 / 60, ground);
  input.presses.add('Space'); input.held = held;
  const frames = [], turn = armMeter(pose, root);
  turn();
  for (let i = 0, landed = -1; i < 120 && (landed < 0 || i < landed + 30); i++) {
    step(1 / 60, ground);
    if (landed < 0 && frames.length && p.isGrounded) landed = i;
    const arms = [armAngles(pose, root, 1), armAngles(pose, root, -1)];
    Object.assign(arms, { air: !p.isGrounded, t: p.movement.airTime, vy: p.jumpVelocity, hips: at(pose, 'hips').y, chin: at(pose, 'head').y - .025, turn: turn() });
    frames.push(arms);
  }
  input.held = false;
  for (let i = 0; i < 60; i++) step(1 / 60, ground);
  return frames;
}

test('salto parado: brazos atrás al agacharse, impulso adelante con las manos separadas y los codos afuera, flotan, se abren antes del ápice y bajan abiertos; las manos nunca pasan del mentón', () => {
  const rig = playerRig({ hang: true }), frames = standingJump(rig);
  const air = frames.filter(f => f.air), contact = frames.findIndex((f, i) => i > 0 && !f.air && frames[i - 1].air);
  const fmt = v => v.toFixed(1);
  // Manos por debajo del mentón en todo el salto, con margen: el centro 3 cm y la punta de los dedos 1 cm.
  const hand = Math.max(...frames.flatMap(f => f.map(a => a.hand))), fingers = Math.max(...frames.flatMap(f => f.map(a => a.fingers)));
  assert.ok(hand < -.03 && fingers < -.01, `manos ${fmt(100 * hand)} cm y dedos ${fmt(100 * fingers)} cm sobre el mentón`);
  // Al fondo de la agachada (los primeros ~70 ms) el hombro va 15-28° atrás.
  for (const s of [0, 1]) {
    const back = Math.min(...air.filter(f => f.t <= .07).map(f => f[s].flex));
    assert.ok(back <= -15 && back >= -28, `brazo ${s}: atrás ${fmt(back)}° al agacharse`);
  }
  // Tope del impulso 8-10 cuadros después del despegue: codos afuera (brazo abierto 25-35°), codo doblado 70° como
  // mucho con el antebrazo adelante y un poco arriba, la mano entre el pecho y el mentón, y las manos separadas al
  // menos el ancho de los hombros (35 cm entre centros, ninguna a menos de 12 cm del plano medio).
  const top = air.reduce((best, f) => Math.max(f[0].flex, f[1].flex) > Math.max(best[0].flex, best[1].flex) ? f : best);
  const lead = top[0].flex > top[1].flex ? 0 : 1, peak = top[lead], topAt = air.indexOf(top);
  assert.ok(topAt >= 8 && topAt <= 10, `el tope llega ${topAt} cuadros después del despegue`);
  for (const a of top) {
    assert.ok(a.open >= 25 && a.open <= 35 && a.elbow <= 70 && a.forearmUp >= 0 && a.forearmUp <= 40,
      `tope: apertura ${fmt(a.open)}°, codo ${fmt(a.elbow)}°, antebrazo ${fmt(a.forearmUp)}° sobre la horizontal`);
    assert.ok(a.hand > -.25 && a.lateral >= .12, `tope: mano ${fmt(100 * a.hand)} cm bajo el mentón y a ${fmt(100 * a.lateral)} cm del plano medio`);
  }
  assert.ok(top[0].lateral + top[1].lateral >= .35, `tope: manos a ${fmt(100 * (top[0].lateral + top[1].lateral))} cm`);
  // Desde el despegue + 6 cuadros hasta el ápice las manos no se juntan delante del pecho.
  const apexAt = air.findIndex(f => f.vy <= 0);
  for (const f of air.slice(6, apexAt + 1)) {
    assert.ok(f[0].lateral >= .12 && f[1].lateral >= .12, `a ${fmt(f.t)} s una mano queda a ${fmt(100 * Math.min(f[0].lateral, f[1].lateral))} cm del plano medio`);
  }
  // No se sostiene: flota 2-3 cuadros con un poco de pasada y empieza a abrirse y bajar al menos 2 cuadros antes del
  // ápice (los brazos van adelantados al cuerpo).
  const float = air.slice(topAt + 1, topAt + 3).map(f => f[lead].flex);
  assert.ok(float.every(v => v > peak.flex - 4), `después del tope flota: ${float.map(fmt).join(', ')}° (tope ${fmt(peak.flex)}°)`);
  const before = air[apexAt - 2], apex = air[apexAt];
  for (const s of [0, 1]) {
    assert.ok(before[s].shoulder < Math.max(...air.slice(0, apexAt).map(f => f[s].shoulder)) - 3 && apex[s].shoulder < before[s].shoulder,
      `brazo ${s}: 2 cuadros antes del ápice ya baja (${fmt(before[s].shoulder)}° → ${fmt(apex[s].shoulder)}°)`);
  }
  // Ningún brazo gira más de 30° en un cuadro en todo el salto.
  const most = Math.max(...frames.map(f => f.turn));
  assert.ok(most < 30, `un brazo gira ${fmt(most)}° en un cuadro`);
  // Bajando: abiertos 25-35°, adelante 15-25°, codo 60-80° (±1° de medida); un brazo 8-12° más adelante que el
  // otro, ya desde la primera parte de la bajada (a 3 m/s) y no solo al final.
  const last = air.at(-1);
  for (const a of last) assert.ok(a.open >= 24 && a.open <= 36 && a.flex >= 14 && a.flex <= 26 && a.elbow >= 59 && a.elbow <= 81,
    `bajada: apertura ${fmt(a.open)}°, flexión ${fmt(a.flex)}°, codo ${fmt(a.elbow)}°`);
  for (const f of [air.find(f => f.vy <= -3), last]) {
    const spread = Math.abs(f[0].flex - f[1].flex);
    assert.ok(spread >= 7.5 && spread <= 12.5, `los brazos no van iguales a ${fmt(-f.vy)} m/s: ${fmt(spread)}°`);
  }
  // Vivos: se abren más cuanto más rápido cae y no se quedan quietos más de 4 cuadros.
  const slow = air.find(f => f.vy <= -2);
  assert.ok(last[0].open - slow[0].open >= 3 && last[1].open - slow[1].open >= 3, `suben con la caída: ${fmt(slow[0].open)}° → ${fmt(last[0].open)}°`);
  const descent = frames.slice(frames.indexOf(apex), contact + 10);
  assert.ok(frozenRun(descent) <= 4, `de la bajada al aterrizaje quietos ${frozenRun(descent)} cuadros`);
  // Y en todo el salto, flotando en el tope incluido, nunca más de 4 cuadros seguidos en que ningún brazo ni antebrazo
  // cambia de dirección 1° (lo que miden las tiras).
  let still = 0, stillest = 0;
  for (const f of frames.slice(1, contact + 10)) { still = f.turn < 1 ? still + 1 : 0; stillest = Math.max(stillest, still); }
  assert.ok(stillest <= 4, `del despegue al aterrizaje quietos ${stillest} cuadros`);
  // Al tocar siguen bajando desde el primer cuadro y a los 0,25 s ya están casi colgando.
  const touch = frames[contact][lead], soon = frames[contact + 3][lead], later = frames[contact + 15][lead];
  assert.ok(soon.shoulder < touch.shoulder - 3, `al tocar siguen bajando: ${fmt(touch.shoulder)}° → ${fmt(soon.shoulder)}°`);
  assert.ok(later.shoulder < 22, `a los 0,25 s bajaron: ${fmt(later.shoulder)}°`);
  // Con los pies parejos el brazo que va delante cambia de un salto al siguiente.
  const again = standingJump(rig).filter(f => f.air).at(-1);
  assert.notEqual(again[0].flex > again[1].flex, last[0].flex > last[1].flex, 'el mismo brazo va delante en dos saltos seguidos');
});

/**
 * Clip de carrera congelado en la zancada del vuelo (el peor caso: en el aire el clip casi no se mueve): muslo
 * izquierdo 40° adelante con la rodilla a 50°, el derecho 25° atrás con la rodilla a 20°, brazo derecho adelante y
 * el izquierdo atrás, y el pecho girado 20° hacia el brazo de delante. Lo único que se mueve es la rodilla de atrás,
 * que se dobla 20° más con `fold` (de 0 a 1), como la del clip de correr del juego al caer. Devuelve la función que lo
 * pone antes de cada cuadro, como el mezclador.
 */
function frozenStride(pose, root) {
  root.updateMatrixWorld(true);
  const turnTo = (key, x, y, z) => {
    const { bone, axis } = pose.slots.get(key), world = bone.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromUnitVectors(axis.clone().applyQuaternion(world).normalize(), new THREE.Vector3(x, y, z).normalize());
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(turn.multiply(world)));
    root.updateMatrixWorld(true);
  };
  const chest = pose.slots.get('spine').bone, world = chest.getWorldQuaternion(new THREE.Quaternion());
  const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 20 / DEG);
  chest.quaternion.copy(chest.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(twist.multiply(world)));
  root.updateMatrixWorld(true);
  const r = a => a / DEG;
  turnTo('leftUpLeg', .09, -Math.cos(r(40)), Math.sin(r(40))); turnTo('leftLeg', .03, -Math.cos(r(-10)), Math.sin(r(-10)));
  turnTo('rightUpLeg', -.09, -Math.cos(r(25)), -Math.sin(r(25))); turnTo('rightLeg', -.03, -Math.cos(r(45)), -Math.sin(r(45)));
  turnTo('rightArm', -Math.tan(r(15)), -1, Math.tan(r(10))); turnTo('rightForeArm', -.1, Math.cos(r(85)) * .2, 1);
  turnTo('leftArm', Math.tan(r(10)), -1, -Math.tan(r(60))); turnTo('leftForeArm', .05, -1, .08);
  const keys = ['spine', 'leftUpLeg', 'leftLeg', 'rightUpLeg', 'rightLeg', 'rightArm', 'rightForeArm', 'leftArm', 'leftForeArm'];
  const held = keys.map(key => [pose.slots.get(key).bone, pose.slots.get(key).bone.quaternion.clone()]);
  const shin = pose.slots.get('rightLeg').bone, straight = shin.quaternion.clone();
  turnTo('rightLeg', -.03, -Math.cos(r(65)), -Math.sin(r(65)));
  const folded = shin.quaternion.clone();
  return (fold = 0) => {
    pose.restore();
    for (const [bone, quaternion] of held) bone.quaternion.copy(quaternion);
    shin.quaternion.slerpQuaternions(straight, folded, fold);
    root.updateMatrixWorld(true);
  };
}
/** Muslo (grados adelante de la vertical, de perfil) y rodilla de la pierna `name`. */
function legAngles(pose, root, name) {
  const yaw = new THREE.Euler().setFromQuaternion(root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const thigh = at(pose, `${name}Leg`).sub(at(pose, `${name}UpLeg`));
  return { thigh: Math.atan2(thigh.dot(forward), -thigh.y) * DEG, knee: kneeBend(pose, name) };
}
/**
 * Salto corriendo (~5 m/s) sobre `frozenStride`, con la pisada del aire en el pie izquierdo (`step` como la fase
 * del juego). Por cuadro desde el despegue hasta 10 cuadros después de tocar: brazos, piernas, inclinación del
 * tronco (cadera a cuello, grados adelante) y giro del pecho (línea de las clavículas, grados con la derecha
 * adelante), más los mismos dos números en reposo.
 */
function runningJump() {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones);
  const input = {
    axis: { x: 1, z: 0 }, isRunning: true, held: false, presses: new Set(),
    consumePress(key) { return this.presses.delete(key); },
    isDown(key) { return (key === 'Space' || key === 'KeySpace') && this.held; }
  };
  const p = new Player(new THREE.Scene(), input), ground = () => 0;
  const yaw = () => new THREE.Euler().setFromQuaternion(root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
  const clavicle = name => bones.get(`mixamorig:${name}Shoulder`).getWorldPosition(new THREE.Vector3());
  const trunk = () => {
    const y = yaw(), forward = new THREE.Vector3(Math.sin(y), 0, Math.cos(y)), left = new THREE.Vector3(Math.cos(y), 0, -Math.sin(y));
    const t = at(pose, 'neck').sub(at(pose, 'hips')), line = clavicle('Left').sub(clavicle('Right'));
    return { lean: Math.atan2(t.dot(forward), t.y) * DEG, twist: -Math.atan2(line.dot(forward), line.dot(left)) * DEG };
  };
  pose.apply(1 / 60, { movement: { grounded: true } });
  const rest = trunk();
  const clip = frozenStride(pose, root);
  const step = () => {
    clip(p.isGrounded ? 0 : Math.min(1, Math.max(0, -p.jumpVelocity / JUMP.launchSpeed)));
    p.update(1 / 60, null, null, ground, []);
    root.position.copy(p.position); root.quaternion.copy(p.root.quaternion); root.updateMatrixWorld(true);
    pose.apply(1 / 60, { speed: p.speed, movement: p.movement, action: p.isGrounded ? null : 'saltar', step: p.isGrounded ? 0 : 1 });
  };
  for (let i = 0; i < 90; i++) step();
  input.presses.add('Space'); input.held = true;
  const frames = [], turn = armMeter(pose, root);
  turn();
  for (let i = 0, landed = -1; i < 120 && (landed < 0 || i < landed + 10); i++) {
    step();
    if (landed < 0 && frames.length && p.isGrounded) landed = i;
    const arms = [armAngles(pose, root, 1), armAngles(pose, root, -1)];
    Object.assign(arms, { air: !p.isGrounded, vy: p.jumpVelocity, speed: p.speed, turn: turn(), left: legAngles(pose, root, 'left'), right: legAngles(pose, root, 'right'), ...trunk() });
    frames.push(arms);
  }
  return { frames, rest };
}

test('salto en carrera: los brazos siguen la oposición despacio en el vuelo (no se congelan), se abren 10-15° y tocan con el brazo contrario al pie de apoyo adelante; la zancada respira y el tronco se endereza', () => {
  const { frames, rest } = runningJump(), fmt = v => v.toFixed(1);
  const air = frames.filter(f => f.air), apexAt = air.findIndex(f => f.vy <= 0), last = air.at(-1), first = air[0];
  assert.ok(Math.min(...air.map(f => f.speed)) > 4, 'corre');
  // Pie de apoyo, el izquierdo (`step`): el brazo derecho (1) va adelante y el izquierdo (0) atrás.
  const fwd = 1, back = 0;
  // Al despegar el brazo de delante sube adelante con la mano a la altura del pecho, nunca sobre el mentón, y el
  // otro va atrás.
  const push = air.slice(0, 12), top = push.reduce((best, f) => f[fwd].flex > best[fwd].flex ? f : best);
  assert.ok(top[fwd].flex >= 30 && top[fwd].hand >= -.3, `al despegar el brazo de delante sube a ${fmt(top[fwd].flex)}° (mano ${fmt(100 * top[fwd].hand)} cm bajo el mentón)`);
  assert.ok(top[back].flex <= -45, `y el otro va atrás: ${fmt(top[back].flex)}°`);
  const hand = Math.max(...frames.flatMap(f => f.map(a => a.hand)));
  assert.ok(hand < -.03, `una mano llega a ${fmt(100 * hand)} cm del mentón`);
  // En el vuelo siguen moviéndose: nunca más de 4 cuadros con los dos quietos (menos de 1° por cuadro), y ninguno gira
  // más de 30° en un cuadro.
  assert.ok(frozenRun(frames) <= 4, `brazos quietos ${frozenRun(frames)} cuadros`);
  assert.ok(Math.max(...frames.map(f => f.turn)) < 30, `un brazo gira ${fmt(Math.max(...frames.map(f => f.turn)))}° en un cuadro`);
  // Hasta el ápice se abren 10-15° más que al despegar (±1° de medida); después van a la pose con que se toca el suelo.
  for (const s of [fwd, back]) {
    const open = Math.max(...air.slice(0, apexAt + 1).map(f => f[s].open)) - first[s].open;
    assert.ok(open >= 9 && open <= 16, `brazo ${s}: se abre ${fmt(open)}° en el vuelo`);
  }
  // Al tocar, el brazo contrario al pie de apoyo sigue adelante.
  assert.ok(last[fwd].flex > last[back].flex + 30, `al tocar: ${fmt(last[fwd].flex)}° y ${fmt(last[back].flex)}°`);
  // Piernas: la zancada se abre del todo en el ápice (no antes); después la rodilla de atrás se dobla 15-25° más y el
  // muslo de delante baja buscando el suelo.
  const opening = air.map(f => f.left.thigh - f.right.thigh), widest = opening.indexOf(Math.max(...opening));
  assert.ok(Math.abs(widest - apexAt) <= 2, `la zancada se abre del todo ${widest - apexAt} cuadros del ápice`);
  assert.ok(opening[Math.max(0, apexAt - 6)] < opening[apexAt] - 1, `la zancada entra de a poco: ${fmt(opening[apexAt - 6])}° → ${fmt(opening[apexAt])}°`);
  const knee = last.right.knee - air[apexAt].right.knee;
  assert.ok(knee >= 15 && knee <= 25, `la rodilla de atrás se dobla ${fmt(knee)}° desde el ápice`);
  assert.ok(last.left.thigh < air[apexAt].left.thigh - 10, `el muslo de delante baja: ${fmt(air[apexAt].left.thigh)}° → ${fmt(last.left.thigh)}°`);
  // Tronco: el clip de correr ya va 6-8° adelante al despegar; en el ápice se endereza 3-5,5° y para recibir vuelve
  // adelante (3-5° sobre el reposo con ese clip, que al caer se echa atrás ~2°; este no).
  const lean = f => f.lean - first.lean;
  assert.ok(lean(air[apexAt]) <= -3 && lean(air[apexAt]) >= -5.5, `en el ápice el tronco se endereza ${fmt(lean(air[apexAt]))}°`);
  assert.ok(lean(last) - lean(air[apexAt]) >= 1.5 && lean(last) - lean(air[apexAt]) <= 6, `para recibir vuelve ${fmt(lean(last) - lean(air[apexAt]))}° adelante`);
  // Pecho: con el clip girado 20°, en el vuelo el giro queda en 5-8° hacia el brazo de delante.
  for (const f of air.slice(10, -10)) {
    const twist = f.twist - rest.twist;
    assert.ok(twist >= 5 && twist <= 8, `a ${air.indexOf(f)} cuadros del despegue el pecho gira ${fmt(twist)}°`);
  }
});

test('cruzar en el aire el borde de un desnivel alto no cambia la pose de golpe: menos de 15° por cuadro al cruzarlo y en los 0,2 s siguientes', () => {
  for (const lead of [.3, .9]) {
    const { root, p, input, step } = playerRig();
    const ground = x => (x < 0 ? 7.8 : 0);
    p.position.set(-8, 7.8, 0); p.root.position.copy(p.position);
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    for (let k = 0; k < 2000 && p.position.x < -lead; k++) step(1 / 60, ground);
    input.presses.add('Space'); input.held = true;
    const turn = turnMeter(root);
    let crossing = null, since = 0, soon = 0, after = 0, wasOver = true;
    for (let i = 0; i < 40; i++) {
      step(1 / 60, ground);
      const most = turn(), over = p.position.x < 0;
      if (wasOver && !over) crossing = most;
      else if (crossing !== null && ++since <= 12) soon = Math.max(soon, most);
      else if (crossing !== null) after = Math.max(after, most);
      wasOver = over;
    }
    assert.ok(crossing !== null && crossing < 15, `saltando ${lead} m antes del borde, en el cuadro en que lo cruza gira ${crossing?.toFixed(1)}°`);
    assert.ok(soon < 15, `los 0,2 s siguientes el cambio se reparte: hasta ${soon.toFixed(1)}° por cuadro`);
    assert.ok(after < 20, `y después, ya braceando, hasta ${after.toFixed(1)}° por cuadro`);
  }
});

/** Mayor giro (grados) en el mundo de cualquiera de `objects` desde la llamada anterior. */
function objectsMeter(objects) {
  const last = objects.map(o => o.getWorldQuaternion(new THREE.Quaternion())), q = new THREE.Quaternion();
  return () => objects.reduce((most, o, i) => {
    o.getWorldQuaternion(q);
    const turn = 2 * Math.acos(Math.min(1, Math.abs(q.dot(last[i])))) * DEG;
    last[i].copy(q);
    return Math.max(most, turn);
  }, 0);
}
/**
 * El jugador real con los dos cuerpos, como en el juego: el completo (el esqueleto glTF con los brazos colgando como
 * clip y la velocidad dividida por su escala) y el liviano, que anima el propio jugador. `world` es el suelo, las
 * colisiones y el agua; `run(frames, before, after)` da por cuadro el estado del jugador y el mayor giro de un hueso
 * de cada cuerpo (`full`, `light`).
 */
function bothBodies({ x = -6, y = 0, gait = 'corre' } = {}) {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones), clip = hangingArms(pose, root);
  const input = {
    axis: { x: gait === 'parado' ? 0 : 1, z: 0 }, isRunning: gait === 'corre', held: false, presses: new Set(),
    consumePress(key) { return this.presses.delete(key); },
    isDown(key) { return (key === 'Space' || key === 'KeySpace') && this.held; }
  };
  const p = new Player(new THREE.Scene(), input);
  p.position.set(x, y, 0); p.root.position.copy(p.position);
  const full = [], light = Object.values(p.character.ragdollRig).filter(o => o?.isObject3D);
  root.traverse(bone => { if (bone.isBone && bodyBone(bone.name)) full.push(bone); });
  clip(); pose.apply(1 / 60, { movement: { grounded: true } });
  const world = { ground: () => 0, collisions: null, water: null };
  const step = () => {
    clip();
    p.update(1 / 60, null, world.collisions, world.ground, [], world.water);
    root.position.copy(p.position); root.quaternion.copy(p.root.quaternion); root.updateMatrixWorld(true);
    pose.apply(1 / 60, { speed: p.speed / REALISTIC_SCALE, movement: p.movement, action: p.isSwimming || p.isGrounded ? null : 'saltar' });
  };
  const jump = () => { input.presses.add('Space'); input.held = true; };
  const run = (frames, before, after) => {
    const turnFull = objectsMeter(full), turnLight = objectsMeter(light), rows = [];
    for (let i = 0; i < frames; i++) {
      before?.(i);
      const wasAir = !p.isGrounded && !p.isSwimming;
      step();
      const row = { i, wasAir, air: !p.isGrounded && !p.isSwimming, swim: p.isSwimming, launch: p.movement.launchSpeed, speed: p.speed, x: p.position.x, full: turnFull(), light: turnLight() };
      after?.(row);
      rows.push(row);
    }
    return rows;
  };
  const knees = { full: full.filter(bone => /(Left|Right)Leg$/.test(bone.name)), light: [p.character.ragdollRig.leftLeg, p.character.ragdollRig.rightLeg] };
  return { root, pose, p, input, world, step, jump, run, knees };
}
/** Mayor giro (grados) respecto a su padre de cualquiera de `objects` desde la llamada anterior. */
function localMeter(objects) {
  const last = objects.map(o => o.quaternion.clone());
  return () => objects.reduce((most, o, i) => {
    const turn = 2 * Math.acos(Math.min(1, Math.abs(o.quaternion.dot(last[i])))) * DEG;
    last[i].copy(o.quaternion);
    return Math.max(most, turn);
  }, 0);
}
/**
 * Ocho puntos de partida (m antes de x = -6) que reparten el ciclo completo del paso, 2,40 m andando y 3,50 m
 * corriendo: el mismo salto con el pie en cada fase.
 */
const PHASES = { anda: [0, .3, .6, .9, 1.2, 1.5, 1.8, 2.1], corre: [0, .4375, .875, 1.3125, 1.75, 2.1875, 2.625, 3.0625] };
/** Mayor giro de cada cuerpo en los cuadros `from` a `to`. */
function turnWindow(rows, from, to) {
  const near = rows.filter(r => r.i >= from && r.i <= to);
  return { full: Math.max(...near.map(r => r.full)), light: Math.max(...near.map(r => r.light)) };
}
/** Mayor giro de cada cuerpo en el cuadro `from` y los cinco siguientes. */
function eventTurn(rows, from) {
  const near = rows.filter(r => r.i >= from && r.i <= from + 5);
  return { full: Math.max(...near.map(r => r.full)), light: Math.max(...near.map(r => r.light)) };
}
/** Cuadro en que sale de un borde de `height` m andando o corriendo desde x = `start`, sin saltar. */
function edgeFrame(height, gait, start = -6) {
  const rig = bothBodies({ x: start, y: height, gait });
  rig.world.ground = x => (x < 0 ? height : 0);
  return rig.run(300).findIndex(r => r.air);
}
/**
 * Hacia un borde de `height` m, pulsa Espacio `k` cuadros respecto al primero en el aire de la caída sin saltar (`off`):
 * k < 0 todavía en el piso, k >= 0 ya fuera del borde (el coyote). El evento es el despegue (o la caída, si ya no salta).
 * Sin `edge` es el mismo salto en el plano, a la misma altura.
 * `hands` es, en los 0,35 s desde el evento, lo más alto que llegan las manos del cuerpo completo respecto al mentón, y
 * `heavy`, el mayor cambio en un cuadro del peso del golpe fuerte previsto (en el piso no hay) hasta tocar.
 */
function edgeJump(height, gait, k, off, start = -6, edge = true) {
  const rig = bothBodies({ x: start, y: height, gait });
  rig.world.ground = edge ? x => (x < 0 ? height : 0) : () => height;
  for (let i = 0; i < off - 20; i++) rig.step();
  const hand = [], kneeFull = localMeter(rig.knees.full), kneeLight = localMeter(rig.knees.light);
  const rows = rig.run(120, i => { if (i === 20 + k) rig.jump(); }, row => {
    row.hand = Math.max(armAngles(rig.pose, rig.root, 1).hand, armAngles(rig.pose, rig.root, -1).hand);
    row.heavy = row.air ? rig.pose._airOut.heavy : 0;
    row.kneeFull = kneeFull(); row.kneeLight = kneeLight();
  });
  const takeoff = rows.findIndex(r => r.launch > 0), event = takeoff >= 0 ? takeoff : rows.findIndex(r => r.air);
  for (const r of rows) if (r.i >= event && r.i <= event + 21) hand.push(r.hand);
  const landed = rows.findIndex(r => r.wasAir && !r.air), heavy = rows.slice(1, landed).map((r, i) => Math.abs(r.heavy - rows[i].heavy));
  return { rows, event, jumped: takeoff >= 0, coyote: takeoff >= 0 && rows[takeoff].wasAir, hands: Math.max(...hand), heavy: Math.max(...heavy), ...eventTurn(rows, event) };
}

// Mayor giro de un hueso en un cuadro (grados) que se acepta en cada barrido: lo medido más ~1°.
const EDGE_TURN = { anda: { full: 15, light: 21.5 }, corre: { full: 14, light: 22.5 } };
const EDGE_TOUCH = { full: 31, light: 41 };

test('barrido en el borde: saltar en cada cuadro alrededor de un desnivel de 1,5, 2, 2,6 y 7,8 m, con el pie en ocho fases del paso y también en toda la ventana del coyote, empieza como cualquier salto: ningún hueso gira más de 15° (completo) o 22,5° (liviano) en el despegue ni en los cinco cuadros siguientes, las manos no pasan del mentón, ningún peso salta y al tocar tampoco hay tirón', () => {
  for (const height of [1.5, 2, 2.6, 7.8]) {
    for (const gait of ['corre', 'anda']) {
      for (const lead of PHASES[gait]) {
        const start = -6 - lead, off = edgeFrame(height, gait, start), cap = EDGE_TURN[gait];
        let coyotes = 0;
        for (let k = -8; k <= 7; k++) {
          const c = edgeJump(height, gait, k, off, start), name = `${height} m ${gait} desde ${start} m, Espacio ${k} cuadros desde el borde`;
          if (k <= 5) assert.ok(c.jumped, `${name}: salta`);
          if (c.coyote) coyotes++;
          assert.ok(c.full <= cap.full && c.light <= cap.light, `${name}: gira ${c.full.toFixed(1)}° (completo) y ${c.light.toFixed(1)}° (liviano) en un cuadro`);
          if (c.jumped) assert.ok(c.hands < 0, `${name}: una mano pasa ${(100 * c.hands).toFixed(1)} cm del mentón`);
          // El golpe fuerte previsto entra de a poco al salir del borde (en el piso no hay) y, en el coyote, sigue desde
          // donde iba: nunca cambia más de 0,2 en un cuadro.
          assert.ok(c.heavy <= .2, `${name}: el peso del golpe fuerte cambia ${c.heavy.toFixed(2)} en un cuadro`);
          const landed = c.rows.findIndex(r => r.wasAir && !r.air);
          if (landed < 0) continue;
          // Lo que queda alto: corriendo, un salto de coyote sobre 2,0 m toca a ~11 m/s, un golpe fuerte a medias, y
          // las rodillas del cuerpo liviano se doblan de una vez (hasta ~44° en el cuadro del contacto).
          const touch = turnWindow(c.rows, landed, landed + 10), light = height === 2 && gait === 'corre' ? 46 : EDGE_TOUCH.light;
          assert.ok(touch.full <= EDGE_TOUCH.full && touch.light <= light, `${name}: al tocar gira ${touch.full.toFixed(1)}° (completo) y ${touch.light.toFixed(1)}° (liviano) en un cuadro`);
        }
        assert.ok(coyotes >= 5, `${height} m ${gait} desde ${start} m: ${coyotes} saltos de coyote`);
      }
    }
  }
});

test('al soltar el empuje la rodilla no entra de golpe en la recogida: andando, de 0,1 a 0,2 s después de despegar, en ocho fases del paso, gira menos de 5° (completo) y 7° (liviano) por cuadro en el plano y menos de 18° y 22° saltando en un borde alto', () => {
  const knees = c => {
    const after = c.rows.filter(r => r.i >= c.event + 6 && r.i <= c.event + 12);
    return { full: Math.max(...after.map(r => r.kneeFull)), light: Math.max(...after.map(r => r.kneeLight)) };
  };
  for (const height of [7.8]) {
    for (const lead of PHASES.anda) {
      const start = -6 - lead, off = edgeFrame(height, 'anda', start);
      for (let k = -8; k <= 7; k++) {
        const name = `andando desde ${start} m, Espacio ${k} cuadros desde el borde`;
        const flat = edgeJump(height, 'anda', k, off, start, false), turn = knees(flat);
        assert.ok(flat.jumped && turn.full <= 5 && turn.light <= 7, `en el plano, ${name}: la rodilla gira ${turn.full.toFixed(1)}° (completo) y ${turn.light.toFixed(1)}° (liviano) en un cuadro`);
        const edge = edgeJump(height, 'anda', k, off, start);
        if (!edge.jumped) continue;
        const over = knees(edge);
        assert.ok(over.full <= 18 && over.light <= 22, `borde de ${height} m, ${name}: la rodilla gira ${over.full.toFixed(1)}° (completo) y ${over.light.toFixed(1)}° (liviano) en un cuadro`);
      }
    }
  }
});

test('en el aire no se empieza a correr: un salto parado con una dirección pulsada después de despegar sigue con la pose del salto parado los primeros 0,3 s y después la zancada entra a no más de 2 por segundo', () => {
  for (const gait of ['anda', 'corre']) {
    for (const press of [1, 3, 6, 10, 14, 18]) {
      const make = () => { const rig = bothBodies({ x: -20, gait: 'parado' }); for (let i = 0; i < 30; i++) rig.step(); rig.jump(); return rig; };
      const still = make(), moved = make(), name = `${gait}, dirección en el cuadro ${press} del salto`;
      let last = 0, frames = 0;
      for (let i = 0; i < 60; i++) {
        if (i === press) { moved.input.axis = { x: 1, z: 0 }; moved.input.isRunning = gait === 'corre'; }
        still.step(); moved.step();
        if (i > 5 && moved.p.isGrounded) break;
        const t = moved.p.movement.airTime, stride = moved.pose._stride;
        if (t < .3) {
          assert.ok(stride <= .01, `${name}: a los ${t.toFixed(2)} s la zancada ya va en ${stride.toFixed(2)}`);
          // Los brazos son los del mismo salto sin dirección (el cuerpo se inclina un poco al avanzar).
          for (const side of [1, -1]) {
            const a = armAngles(still.pose, still.root, side), b = armAngles(moved.pose, moved.root, side);
            const apart = Math.max(...['flex', 'open', 'elbow'].map(key => Math.abs(a[key] - b[key])));
            assert.ok(apart < 6, `${name}: a los ${t.toFixed(2)} s un brazo va a ${apart.toFixed(1)}° del salto parado`);
          }
        } else assert.ok(stride - last <= 2 / 60 + 1e-6, `${name}: la zancada sube ${(stride - last).toFixed(3)} en un cuadro`);
        last = stride; frames++;
      }
      assert.ok(frames > 25, `${name}: vuela ${frames} cuadros`);
    }
  }
});

test('un salto parado después de correr, saltar, aterrizar y pararse no hereda la zancada de la carrera: las piernas son las de cualquier salto parado', () => {
  const rig = bothBodies({ x: -30, gait: 'corre' });
  for (let i = 0; i < 80; i++) rig.step();
  rig.jump(); rig.step(); rig.step(); rig.input.held = false;
  // Vuela, toca y sigue corriendo hasta que termina el aterrizaje; después se para 1,5 s.
  for (let i = 0; i < 70; i++) rig.step();
  rig.input.axis = { x: 0, z: 0 };
  for (let i = 0; i < 90; i++) rig.step();
  assert.ok(rig.p.isGrounded && rig.p.speed < .01, 'está parado en el piso');
  const fresh = bothBodies({ x: -30, gait: 'parado' });
  for (let i = 0; i < 30; i++) fresh.step();
  rig.jump(); fresh.jump();
  for (let i = 0; i < 12; i++) {
    rig.step(); fresh.step();
    assert.ok(rig.pose._stride <= 1e-6, `cuadro ${i}: la zancada va en ${rig.pose._stride.toFixed(2)}`);
    for (const name of ['left', 'right']) {
      const apart = Math.abs(kneeBend(rig.pose, name) - kneeBend(fresh.pose, name));
      assert.ok(apart < .5, `cuadro ${i}: la rodilla va a ${apart.toFixed(1)}° de la de un salto parado`);
    }
  }
});

/**
 * Salta sobre una rampa de `angle` grados (positiva cuesta arriba) andando o corriendo, en la fase `phase` de ocho del
 * paso. Da los giros al despegar, en el vuelo y al tocar, lo que dura el vuelo, la velocidad vertical del último
 * cuadro en el aire, el golpe que midió el jugador y lo que baja la cadera visible en cada cuadro del aterrizaje (m).
 */
function rampJump(angle, gait, phase) {
  const tan = Math.tan(angle / DEG), rig = bothBodies({ x: -20, gait });
  rig.world.ground = x => tan * (x + 20);
  // Cuesta abajo arranca cayendo sobre la rampa: 200 cuadros le dan tiempo a asentarse y llegar a toda marcha.
  for (let i = 0; i < 200 + Math.round(phase * (gait === 'corre' ? 35 : 48) / 8); i++) rig.step();
  rig.jump();
  const rows = rig.run(90, null, row => { row.drop = rig.pose.jumpHipDrop; row.hit = rig.p.movement.landingSpeed; row.vy = rig.p.jumpVelocity; });
  const takeoff = rows.findIndex(r => r.air), contact = rows.findIndex((r, i) => i > takeoff && r.wasAir && !r.air);
  return {
    takeoff: eventTurn(rows, takeoff), flight: turnWindow(rows, takeoff + 6, contact - 1), touch: turnWindow(rows, contact, contact + 10),
    seconds: (contact - takeoff) / 60, fall: -rows[contact - 1].vy, hit: rows[contact].hit, drop: rows.slice(contact, contact + 12).map(r => r.drop)
  };
}

test('barrido de rampas: saltar andando o corriendo cuesta arriba y cuesta abajo (15° y 30°), con el pie en ocho fases del paso, no salta de pose al despegar, en el vuelo ni al tocar', () => {
  // Al tocar, cuesta abajo se cae de más alto (el piso se aleja) y la rodilla que recibe gira más.
  const touch = { '-30': { full: 23.5, light: 34.5 }, '-15': { full: 17.5, light: 32.5 }, 15: { full: 10, light: 19.5 }, 30: { full: 10, light: 20 } };
  for (const angle of [-30, -15, 15, 30]) {
    for (const gait of ['anda', 'corre']) {
      for (let phase = 0; phase < 8; phase++) {
        // Corriendo cuesta arriba 30° casi no despega: sale con menos giro que en el plano.
        const c = rampJump(angle, gait, phase), name = `rampa de ${angle}° ${gait}, fase ${phase}`, cap = angle === 30 && gait === 'corre' ? { full: 9, light: 16 } : EDGE_TURN[gait];
        assert.ok(c.takeoff.full <= cap.full && c.takeoff.light <= cap.light, `${name}: al despegar gira ${c.takeoff.full.toFixed(1)}° (completo) y ${c.takeoff.light.toFixed(1)}° (liviano) en un cuadro`);
        assert.ok(c.flight.full <= 11 && c.flight.light <= 14, `${name}: en el vuelo gira ${c.flight.full.toFixed(1)}° (completo) y ${c.flight.light.toFixed(1)}° (liviano) en un cuadro`);
        assert.ok(c.touch.full <= touch[angle].full && c.touch.light <= touch[angle].light, `${name}: al tocar gira ${c.touch.full.toFixed(1)}° (completo) y ${c.touch.light.toFixed(1)}° (liviano) en un cuadro`);
      }
    }
  }
});

test('en una rampa el golpe es la velocidad contra el piso: corriendo cuesta arriba 30° toca todavía subiendo y casi no dobla, y lo poco que dobla entra en tres cuadros; cuesta abajo cae a más de 13 m/s y no es un golpe fuerte', () => {
  for (let phase = 0; phase < 8; phase++) {
    const up = rampJump(30, 'corre', phase), name = `fase ${phase}`;
    assert.ok(up.seconds > .16 && up.seconds < .25, `${name}: cuesta arriba vuela ${up.seconds.toFixed(2)} s`);
    assert.ok(up.fall < 0, `${name}: toca todavía subiendo (${(-up.fall).toFixed(1)} m/s)`);
    assert.ok(up.hit > 1 && up.hit < 2.5, `${name}: golpea el piso a ${up.hit.toFixed(2)} m/s`);
    const peak = up.drop.indexOf(Math.max(...up.drop));
    assert.ok(up.drop[0] < .004 && Math.max(...up.drop) < .012, `${name}: la cadera baja ${(100 * up.drop[0]).toFixed(2)} cm en el cuadro del contacto y ${(100 * Math.max(...up.drop)).toFixed(2)} cm en total`);
    assert.ok(peak >= 2 && peak <= 4, `${name}: llega al fondo en el cuadro ${peak}`);
    for (let i = 1; i < up.drop.length; i++) assert.ok(Math.abs(up.drop[i] - up.drop[i - 1]) < .005, `${name}: la cadera se mueve ${(100 * Math.abs(up.drop[i] - up.drop[i - 1])).toFixed(2)} cm en un cuadro`);
    const down = rampJump(-30, 'corre', phase);
    assert.ok(down.fall > 13, `${name}: cuesta abajo cae a ${down.fall.toFixed(1)} m/s`);
    assert.ok(down.hit > 8 && down.hit < 9.5, `${name}: y golpea el piso a ${down.hit.toFixed(2)} m/s`);
    assert.equal(hardLanding(down.hit), 0, `${name}: no es un golpe fuerte`);
  }
});

test('un saltito que casi no despega (corriendo cuesta arriba 38°, menos de 0,1 s de vuelo) no dobla las piernas al tocar: sigue el paso', () => {
  for (let phase = 0; phase < 8; phase++) {
    const c = rampJump(38, 'corre', phase), name = `fase ${phase}`;
    assert.ok(c.seconds < .1, `${name}: vuela ${c.seconds.toFixed(2)} s`);
    assert.ok(Math.max(...c.drop.map(Math.abs)) < .002, `${name}: la cadera baja ${(100 * Math.max(...c.drop.map(Math.abs))).toFixed(2)} cm`);
    assert.ok(c.touch.full <= 6 && c.touch.light <= 12.5, `${name}: al tocar gira ${c.touch.full.toFixed(1)}° (completo) y ${c.touch.light.toFixed(1)}° (liviano) en un cuadro`);
  }
});

test('entre un saltito y un salto no hay escalón: corriendo cuesta arriba de 30° a 38° el vuelo va de 0,2 a 0,07 s y lo que dobla al tocar crece de a poco con el vuelo', () => {
  // Lo que baja la cadera por cada parte del golpe (el golpe cambia con la pendiente), según los cuadros de vuelo.
  const bend = new Map();
  for (let angle = 30; angle <= 38; angle++) {
    const c = rampJump(angle, 'corre', 0);
    assert.ok(c.hit > .5 && c.hit < 2.5, `rampa de ${angle}°: golpea el piso a ${c.hit.toFixed(2)} m/s`);
    bend.set(Math.round(c.seconds * 60), Math.max(...c.drop) / landingGive(c.hit));
  }
  const whole = bend.get(12);
  assert.ok(whole > .01, `con 0,2 s de vuelo dobla ${whole}`);
  // Nada hasta 0,08 s, entero desde 0,16 s y en el medio sube sin saltar de un cuadro de vuelo al siguiente.
  for (const [frames, from, to] of [[4, 0, .02], [5, 0, .05], [6, .08, .3], [7, .3, .55], [8, .6, .85], [9, .9, 1.05], [10, .95, 1.05], [11, .95, 1.05]]) {
    assert.ok(bend.has(frames), `ninguna rampa da ${frames} cuadros de vuelo: ${[...bend.keys()]}`);
    const part = bend.get(frames) / whole;
    assert.ok(part >= from && part <= to, `con ${frames} cuadros de vuelo dobla ${part.toFixed(2)} de lo que dobla un salto (entre ${from} y ${to})`);
  }
});

test('en el plano un toque suave dobla en proporción al golpe: saltando a un escalón más alto (35 a 65 cm) toca a menos de 4,5 m/s y la cadera baja esa parte de un aterrizaje sin impacto', () => {
  const peaks = [];
  for (const height of [.35, .5, .65]) {
    const rig = bothBodies({ gait: 'corre' }), name = `escalón de ${Math.round(100 * height)} cm`;
    rig.world.ground = x => (x < 0 ? 0 : height);
    let jumped = false, hit = 0, peak = 0;
    rig.run(200, () => { if (!jumped && rig.p.position.x > -1.1) { jumped = true; rig.jump(); } }, row => {
      const m = rig.p.movement;
      if (row.air || rig.p.position.y < height || m.landingTime > .3) return;
      hit ||= m.landingSpeed;
      // Corriendo se absorbe sobre el pie de apoyo y se dobla menos (la zancada).
      const drop = rig.pose.jumpHipDrop, part = landingGive(hit) * landingDrop(m.landingTime, 0) * (1 - .45 * rig.pose._stride);
      peak = Math.max(peak, drop);
      assert.ok(drop <= part + 5e-4, `${name}, a los ${m.landingTime.toFixed(3)} s: baja ${(1000 * drop).toFixed(1)} mm y su parte son ${(1000 * part).toFixed(1)}`);
      // Lo poco que dobla entra en los primeros cuadros; después es su parte justa.
      if (m.landingTime > .08) assert.ok(drop >= part - 5e-4, `${name}, a los ${m.landingTime.toFixed(3)} s: baja ${(1000 * drop).toFixed(1)} mm y su parte son ${(1000 * part).toFixed(1)}`);
    });
    assert.ok(hit > 2 && hit < 4.5 && rig.p.movement.groundSlope === 0, `${name}: toca a ${hit.toFixed(2)} m/s`);
    peaks.push(peak);
  }
  assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2] && peaks[2] < .55 * peaks[0] && peaks[2] > .005, `cuanto más suave, menos dobla: ${peaks.map(v => (1000 * v).toFixed(1))} mm`);
});

test('saltar en cualquier cuadro de los 0,2 s siguientes a un golpe fuerte (cayendo de 5 m parado, andando o corriendo) sale de la pose en que está, sin tirón', () => {
  // `local` es el giro de un hueso del liviano respecto a su padre: el pie de empuje no se suelta de un cuadro al
  // siguiente cuando el clip lo levanta (corriendo, uno o seis cuadros después de tocar).
  const caps = { parado: { full: 16.5, light: 26, local: 31.5 }, anda: { full: 16.5, light: 26, local: 37.5 }, corre: { full: 21, light: 25, local: 25.5 } };
  for (const gait of ['parado', 'anda', 'corre']) {
    for (let k = 0; k <= 12; k++) {
      const rig = bothBodies({ x: gait === 'parado' ? .3 : -3, y: 5, gait });
      rig.world.ground = gait === 'parado' ? () => 0 : x => (x < 0 ? 5 : 0);
      const turnLocal = localMeter(Object.values(rig.p.character.ragdollRig).filter(o => o?.isObject3D));
      let land = -1;
      const rows = rig.run(160, i => { if (land >= 0 && i === land + k + 1) rig.jump(); if (land >= 0 && i > land + k + 1) rig.input.held = false; }, row => {
        row.local = turnLocal();
        if (land < 0 && row.wasAir && !row.air) { land = row.i; assert.ok(rig.p.landingSpeed > HARD_LANDING.to, `${gait}: toca a ${rig.p.landingSpeed.toFixed(1)} m/s`); }
      });
      const takeoff = rows.findIndex((r, i) => i > land && r.launch > 0), name = `${gait}, Espacio ${k + 1} cuadros después de tocar`;
      assert.ok(land > 0 && takeoff > land, `${name}: salta`);
      const { full, light } = eventTurn(rows, takeoff), local = Math.max(...rows.slice(takeoff, takeoff + 6).map(r => r.local));
      assert.ok(full <= caps[gait].full && light <= caps[gait].light, `${name}: gira ${full.toFixed(1)}° (completo) y ${light.toFixed(1)}° (liviano) en un cuadro`);
      assert.ok(local <= caps[gait].local, `${name}: un hueso del liviano gira ${local.toFixed(1)}° respecto a su padre en un cuadro`);
    }
  }
});

/**
 * Brazos del cuerpo completo (`armAngles`) por cuadro de un salto con Espacio `k` cuadros respecto a la salida de un
 * borde de 7,8 m (`off`), con ese desnivel o sin él (el mismo salto en el plano, a la misma altura).
 */
function edgeArms(gait, k, off, edge) {
  const rig = bothBodies({ y: 7.8, gait }), frames = [];
  rig.world.ground = edge ? x => (x < 0 ? 7.8 : 0) : () => 7.8;
  rig.run(off + 45, i => { if (i === off + k) rig.jump(); }, () => {
    if (rig.p.movement.launchSpeed > 0) frames.push({ t: rig.p.movement.airTime, arms: [armAngles(rig.pose, rig.root, 1), armAngles(rig.pose, rig.root, -1)] });
  });
  return frames;
}

test('saltar en el borde de un desnivel alto empieza como en el plano y pasa a la caída a medida que cae: los primeros 0,1 s los brazos van como sin desnivel y después se abren de a poco, en no menos de 0,25 s', () => {
  for (const gait of ['corre', 'anda']) {
    const off = edgeFrame(7.8, gait), edge = edgeArms(gait, -1, off, true), flat = edgeArms(gait, -1, off, false);
    const keys = ['flex', 'open', 'elbow'], fmt = v => v.toFixed(1);
    // Mientras impulsa, lo mismo que en el plano.
    for (let i = 0; edge[i].t <= .1 + 1e-6; i++) {
      for (const s of [0, 1]) for (const key of keys) {
        const gap = Math.abs(edge[i].arms[s][key] - flat[i].arms[s][key]);
        assert.ok(gap < 2, `${gait}, a ${fmt(1000 * edge[i].t)} ms del despegue, brazo ${s}: ${key} ${fmt(edge[i].arms[s][key])}° con el desnivel y ${fmt(flat[i].arms[s][key])}° sin él`);
      }
    }
    // Después pasa a la caída: a los 0,45 s los dos brazos van 15° más abiertos que en el plano, y el cambio se reparte
    // (ningún ángulo cambia más de 7° en un cuadro mientras tanto: soltarlo en menos de 0,25 s llega a 10°).
    const late = edge.findIndex(f => f.t >= .45);
    for (const s of [0, 1]) assert.ok(edge[late].arms[s].open > flat[late].arms[s].open + 15, `${gait}, brazo ${s}: a los 0,45 s abierto ${fmt(edge[late].arms[s].open)}° (sin desnivel ${fmt(flat[late].arms[s].open)}°)`);
    for (let i = 1; i <= late; i++) {
      if (edge[i].t < .1) continue;
      for (const s of [0, 1]) for (const key of keys) {
        const change = Math.abs(edge[i].arms[s][key] - edge[i - 1].arms[s][key]);
        assert.ok(change <= 7, `${gait}, a ${fmt(1000 * edge[i].t)} ms del despegue el brazo ${s} cambia ${fmt(change)}° de ${key} en un cuadro`);
      }
    }
  }
});

test('un salto de coyote sobre un desnivel alto es un despegue: el brazo contrario al pie de delante sube adelante como en el piso, sin saltar ni pasar del mentón', () => {
  for (const gait of ['corre', 'anda']) {
    const off = edgeFrame(7.8, gait);
    for (const k of [2, 4]) {
      const coyote = edgeArms(gait, k, off, true), ground = edgeArms(gait, k, off, false);
      const peak = frames => Math.max(...frames.filter(f => f.t <= .15).map(f => Math.max(f.arms[0].flex, f.arms[1].flex)));
      const start = Math.max(coyote[0].arms[0].flex, coyote[0].arms[1].flex);
      assert.ok(peak(coyote) > start + 15 && peak(coyote) > peak(ground) - 15, `${gait}, ${k} cuadros fuera del borde: el brazo de delante sube de ${start.toFixed(1)}° a ${peak(coyote).toFixed(1)}° en 0,15 s (en el piso, a ${peak(ground).toFixed(1)}°)`);
    }
  }
});

test('chocar cerca del ápice no corta la zancada en un cuadro: las piernas se cierran hacia la pose de caída en ~0,3 s', () => {
  for (const gait of ['corre', 'anda']) {
    const rig = bothBodies({ x: -20, gait });
    for (let i = 0; i < 90; i++) rig.step();
    const wall = rig.p.position.x + (gait === 'corre' ? 1.2 : .6);
    rig.world.collisions = { resolveMove: (pos, delta) => pos.clone().set(Math.min(pos.x + delta.x, Math.max(pos.x, wall)), pos.y + delta.y, pos.z + delta.z) };
    rig.jump();
    const frames = [];
    rig.run(40, null, row => frames.push({ ...row, opening: legAngles(rig.pose, rig.root, 'left').thigh - legAngles(rig.pose, rig.root, 'right').thigh }));
    const hit = frames.findIndex((f, i) => i > 0 && f.air && f.speed < frames[i - 1].speed - .5);
    assert.ok(hit > 0 && frames[hit + 18].air, `${gait}: choca en el cuadro ${hit} del vuelo y sigue en el aire`);
    const before = Math.abs(frames[hit - 1].opening), steps = frames.slice(hit, hit + 18).map((f, i) => Math.abs(f.opening - frames[hit + i - 1].opening));
    const left = k => Math.abs(frames[hit + k].opening) / before;
    assert.ok(before > 20, `${gait}: zancada de ${before.toFixed(1)}° al chocar`);
    assert.ok(Math.max(...steps) < .15 * before, `${gait}: la zancada cambia hasta ${Math.max(...steps).toFixed(1)}° en un cuadro (de ${before.toFixed(1)}°)`);
    assert.ok(left(6) > .5 && left(18) < .25, `${gait}: a los 0,1 s queda ${(100 * left(6)).toFixed(0)} % de la zancada y a los 0,3 s, ${(100 * left(18)).toFixed(0)} %`);
  }
});

test('golpe fuerte a medias (cayendo de 2,45 a 2,85 m): en el cuadro del contacto los brazos no saltan hacia el clip', () => {
  for (const height of [2.45, 2.55, 2.65, 2.75, 2.85]) {
    const rig = bothBodies({ x: -7, y: height, gait: 'anda' });
    rig.world.ground = x => (x < 0 ? height : 0);
    for (let i = 0; i < 30; i++) rig.step();
    const arms = armMeter(rig.pose, rig.root);
    arms();
    let contact = null, before = 0;
    for (let i = 0; i < 200 && contact === null; i++) {
      const wasAir = !rig.p.isGrounded;
      rig.step();
      const turn = arms();
      if (wasAir && rig.p.isGrounded) contact = { turn, speed: rig.p.landingSpeed };
      else if (wasAir) before = turn;
    }
    assert.ok(contact.speed > 10.4 && contact.speed < 11.7, `${height} m: toca a ${contact.speed.toFixed(2)} m/s, un golpe fuerte a medias`);
    assert.ok(contact.turn < 5, `${height} m: en el contacto los brazos giran ${contact.turn.toFixed(1)}° (el cuadro anterior, ${before.toFixed(1)}°)`);
  }
});

test('barrido de choques: una pared que lo para en cualquier cuadro del vuelo, saltando andando o corriendo, no hace saltar la pose: ningún hueso gira más de 20° en el cuadro del golpe ni en los cinco siguientes', () => {
  for (const gait of ['corre', 'anda']) {
    const make = () => { const rig = bothBodies({ x: -20, gait }); for (let i = 0; i < 90; i++) rig.step(); return rig; };
    const free = make();
    free.jump();
    const flight = free.run(80).filter(r => r.air).map(r => r.x);
    assert.ok(flight.length > 25, `${gait}: vuela ${flight.length} cuadros`);
    for (let j = 0; j < flight.length; j++) {
      const rig = make(), wall = flight[j] - .02;
      rig.world.collisions = { resolveMove: (pos, delta) => pos.clone().set(Math.min(pos.x + delta.x, Math.max(pos.x, wall)), pos.y + delta.y, pos.z + delta.z) };
      rig.jump();
      const rows = rig.run(90), hit = rows.findIndex((r, i) => i > 0 && r.speed < rows[i - 1].speed - .5);
      assert.ok(hit >= 0, `${gait}, cuadro ${j}: choca`);
      const { full, light } = eventTurn(rows, hit);
      assert.ok(full <= 20 && light <= 20, `${gait}, pared en el cuadro ${j} del vuelo: gira ${full.toFixed(1)}° (completo) y ${light.toFixed(1)}° (liviano) en un cuadro`);
    }
  }
});

test('barrido de caídas: andando o corriendo desde 0,2 hasta 8 m (cada 10 cm hasta 3 m y cada 25 cm después), tocar el suelo no salta: la rodilla que recibe y, en el cuerpo liviano, la cabeza de la sentadilla de un golpe fuerte son lo que más gira', () => {
  for (const gait of ['corre', 'anda']) {
    for (let height = .2; height <= 8.001; height += height < 3 - 1e-6 ? .1 : .25) {
      const rig = bothBodies({ x: -7, y: height, gait });
      rig.world.ground = x => (x < 0 ? height : 0);
      for (let i = 0; i < 30; i++) rig.step();
      const rows = rig.run(220), contact = rows.findIndex(r => r.wasAir && !r.air);
      const name = `${height.toFixed(2)} m ${gait}`;
      // Menos de ~0,6 m es un escalón: baja sin despegarse del suelo.
      if (height >= .7) assert.ok(contact > 0, `${name}: cae y toca`);
      if (contact < 0) continue;
      const { full, light } = eventTurn(rows, contact);
      assert.ok(full <= 25 && light <= 40, `${name}: al tocar gira ${full.toFixed(1)}° (completo) y ${light.toFixed(1)}° (liviano) en un cuadro`);
    }
  }
});

test('barrido del agua: entrar al lago desde 2, 4 y 8 m andando, corriendo o saltando no salta de pose: ningún hueso gira más de 20° al entrar ni en los cinco cuadros siguientes', () => {
  for (const height of [2, 4, 8]) {
    for (const mode of ['anda', 'corre', 'salta']) {
      const rig = bothBodies({ y: height, gait: mode === 'anda' ? 'anda' : 'corre' });
      rig.world.ground = x => (x < 0 ? height : -1.8);
      rig.world.water = x => (x >= 0 ? { surfaceY: 0, bottomY: -1.8, depth: 1.8 } : null);
      for (let i = 0; i < 20; i++) rig.step();
      const rows = rig.run(240, () => { if (mode === 'salta' && rig.p.position.x > -.3 && !rig.input.held) rig.jump(); });
      const entry = rows.findIndex(r => r.swim);
      assert.ok(entry > 0, `${height} m ${mode}: entra al agua`);
      const { full, light } = eventTurn(rows, entry);
      assert.ok(full <= 20 && light <= 20, `${height} m ${mode}: al entrar gira ${full.toFixed(1)}° (completo) y ${light.toFixed(1)}° (liviano) en un cuadro`);
    }
  }
});

test('caída alta: cada brazo da vueltas de 35-45° alrededor de una apertura de 60-80°, a 2,5-3 Hz y desfasados; las rodillas pedalean entre 15 y 35°', () => {
  for (const overWater of [true, false]) {
    const { root, bones } = bodyRig(), pose = new ActionPose(bones), hang = hangingArms(pose, root), dt = 1 / 60;
    hang(); pose.apply(dt, { movement: { grounded: true } });
    const turn = armMeter(pose, root);
    turn();
    const h = 15, g = JUMP.fallGravity, frames = [];
    let most = 0, prev = null, kick = 0;
    for (let t = dt; ; t += dt) {
      const vy = -g * t, y = h - .5 * g * t * t;
      if (y <= 0) break;
      hang();
      const ttg = timeToGround(y, vy, false);
      pose.apply(dt, { action: 'saltar', movement: { grounded: false, verticalVelocity: vy, airTime: t, launchSpeed: 0, groundGap: y, timeToGround: ttg, fallHeight: h, overWater } });
      // Sin saltos: lo que gira por cuadro cambia de a poco (un peso que salta lo dispara en un cuadro).
      const now = turn();
      if (prev !== null) kick = Math.max(kick, Math.abs(now - prev));
      most = Math.max(most, now); prev = now;
      frames.push({ t, vy, ttg, arms: [1, -1].map(side => direction(pose, side > 0 ? 'leftArm' : 'rightArm')), knees: ['left', 'right'].map(name => kneeBend(pose, name)) });
    }
    const label = overWater ? 'sobre agua' : 'sobre suelo';
    assert.ok(most < 20 && kick < 5, `${label}: ningún cuadro salta (hasta ${most.toFixed(1)}° por cuadro, braceo y recogida incluidos, y ${kick.toFixed(1)}° de un cuadro al siguiente)`);
    // Braceo de lleno: de 10,6 m/s en adelante y, sobre suelo, hasta 0,25 s antes de tocar.
    const full = frames.filter(f => -f.vy >= 10.6 && f.ttg > .25);
    assert.ok(full.length * dt > .35, `${label}: braceo de lleno durante ${(full.length * dt).toFixed(2)} s`);
    const phases = [];
    for (const [i, side] of [[0, 1], [1, -1]]) {
      const center = full.reduce((sum, f) => sum.add(f.arms[i]), new THREE.Vector3()).normalize();
      const open = Math.atan2(center.x * side, -center.y) * DEG;
      const radius = full.reduce((sum, f) => sum + f.arms[i].angleTo(center), 0) / full.length * DEG;
      assert.ok(open >= 60 && open <= 80, `${label}, brazo ${i}: centro abierto ${open.toFixed(1)}°`);
      assert.ok(radius >= 35 && radius <= 45, `${label}, brazo ${i}: vueltas de ${radius.toFixed(1)}° de radio`);
      // Fase en la vuelta: 0 arriba-afuera, 90° adelante.
      const ahead = new THREE.Vector3(0, 0, 1).projectOnPlane(center).normalize(), up = new THREE.Vector3(0, 1, 0).projectOnPlane(center).normalize();
      let last = null, unwrapped = 0;
      phases.push(full.map(f => {
        const phase = Math.atan2(f.arms[i].dot(ahead), f.arms[i].dot(up));
        unwrapped = last === null ? phase : unwrapped + Math.atan2(Math.sin(phase - last), Math.cos(phase - last));
        last = phase;
        return unwrapped;
      }));
      const hz = (phases[i].at(-1) - phases[i][0]) / (2 * Math.PI * (full.length - 1) * dt);
      assert.ok(hz >= 2.5 && hz <= 3, `${label}, brazo ${i}: ${hz.toFixed(2)} vueltas por segundo`);
    }
    const lag = Math.atan2(Math.sin(phases[0][0] - phases[1][0]), Math.cos(phases[0][0] - phases[1][0])) * DEG;
    assert.ok(Math.abs(lag) >= 120 && Math.abs(lag) <= 180, `${label}: los brazos van desfasados ${lag.toFixed(0)}°`);
    for (const k of [0, 1]) {
      const bends = full.map(f => f.knees[k]);
      assert.ok(Math.min(...bends) >= 13 && Math.max(...bends) <= 37 && Math.max(...bends) - Math.min(...bends) >= 12,
        `${label}, rodilla ${k}: de ${Math.min(...bends).toFixed(0)}° a ${Math.max(...bends).toFixed(0)}°`);
    }
    const mean = k => full.reduce((sum, f) => sum + f.knees[k], 0) / full.length;
    const [m0, m1] = [mean(0), mean(1)];
    assert.ok(full.reduce((sum, f) => sum + (f.knees[0] - m0) * (f.knees[1] - m1), 0) < 0, `${label}: una rodilla sube mientras la otra baja`);
    // Entra pasados los 6 m/s; sobre suelo se recoge los últimos 0,2 s (manos adelante y abajo), sobre agua sigue.
    const at6 = frames.find(f => -f.vy >= 6);
    assert.ok(at6.arms[0].angleTo(frames[frames.indexOf(at6) - 1].arms[0]) * DEG < 5, `${label}: a 6 m/s todavía no bracea`);
    const end = frames.at(-1).arms[0];
    if (overWater) assert.ok(end.x > .4, `sobre agua sigue braceando hasta entrar: ${end.toArray().map(v => v.toFixed(2))}`);
    else assert.ok(end.y < -.5 && end.z > .5, `sobre suelo se recoge para el golpe: ${end.toArray().map(v => v.toFixed(2))}`);
  }
});

test('entrar al agua desde 8 m no salta de pose: braceo hasta la entrada y la pose del aire cede al nado en ~0,2 s, a 30 y 60 FPS', () => {
  for (const fps of [30, 60]) {
    const { root, pose, p, input, step } = playerRig({ hang: true }), dt = 1 / fps;
    // Tablero a 8 m; el lago (1,8 m de hondo) empieza en x = 0.
    const ground = x => (x < 0 ? 8 : -1.8), water = x => (x >= 0 ? { surfaceY: 0, bottomY: -1.8, depth: 1.8 } : null);
    p.position.set(-.6, 8, 0); p.root.position.copy(p.position);
    for (let i = 0; i < 30; i++) step(dt, ground, water);
    input.axis = { x: 1, z: 0 };
    const turn = armMeter(pose, root);
    turn();
    let entry = -1, before = null, worst = 0;
    for (let i = 0; i < 3 * fps && (entry < 0 || i < entry + .5 * fps); i++) {
      if (!p.isGrounded) input.axis = { x: 0, z: 0 };
      const wasAir = !p.isGrounded && !p.isSwimming;
      if (wasAir) before = direction(pose, 'leftArm');
      step(dt, ground, water);
      const most = turn();
      if (entry < 0 && p.isSwimming) entry = i;
      // De 0,2 s antes de entrar a 0,5 s después, por cada 1/60 s (a 30 FPS un cuadro es el doble de tiempo).
      if (entry >= 0 || (!p.isGrounded && p.position.y < 4)) worst = Math.max(worst, most * fps / 60);
    }
    assert.ok(entry > 0, `${fps} FPS: entra al agua`);
    assert.ok(before.x > .4, `${fps} FPS: hasta la entrada los brazos van abiertos braceando, no buscando el suelo: ${before.toArray().map(v => v.toFixed(2))}`);
    assert.ok(worst < 15, `${fps} FPS: al entrar los brazos giran ${worst.toFixed(1)}° por cada 1/60 s como mucho`);
  }
});

test('golpe fuerte: los pies acompañan al cuerpo mientras patina o lo empujan, se anclan con la raíz casi quieta y un golpe los suelta', () => {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones), dt = 1 / 60;
  pose.apply(dt, { movement: { grounded: true } });
  const footY = lowest(pose);
  pose.apply(dt, { movement: { grounded: false, verticalVelocity: -15, airTime: .65, launchSpeed: 0, groundGap: .1, timeToGround: .007, fallHeight: 5 } });
  const dur = landingDuration(15.2), ankles = () => ['leftFoot', 'rightFoot'].map(key => at(pose, key));
  // Toca a 6 m/s y patina con la curva del golpe fuerte; a los 0,3 s un agresor lo empuja a 2 m/s (e^{-4t}).
  let x = 0, push = 0, worst = 0, quiet = null, quietMove = 0, touch = null, sliding = 0;
  for (let t = .005; t < dur; t += dt) {
    x += 6 * (hardSlide(t) - hardSlide(Math.max(0, t - dt)));
    if (t >= .3 && t < .3 + dt) push = 2;
    x += push * (1 - Math.exp(-4 * dt)) / 4; push *= Math.exp(-4 * dt);
    root.position.x = x; root.updateMatrixWorld(true);
    pose.apply(dt, { movement: { grounded: true, landing: Math.max(.001, 1 - t / dur), landingTime: t, landingImpact: 1, landingSpeed: 15.2 } });
    const now = ankles();
    for (const ankle of now) worst = Math.max(worst, Math.hypot(ankle.x - x, ankle.z));
    // Mientras patina y hasta el empujón, cada pie sigue donde tocó respecto a la raíz (va con el cuerpo, sin quedarse atrás).
    touch ??= now.map(ankle => ankle.clone().setX(ankle.x - x));
    if (t < .3) now.forEach((ankle, i) => { sliding = Math.max(sliding, Math.hypot(ankle.x - x - touch[i].x, ankle.z - touch[i].z)); });
    assert.ok(Math.abs(lowest(pose) - footY) < .02, `${t.toFixed(2)} s: los pies siguen en el piso`);
    // Quieto en el fondo (de 0,1 a 0,3 s) los tobillos no se mueven.
    if (t >= .1 && t < .3) { quiet ??= now; now.forEach((ankle, i) => { quietMove = Math.max(quietMove, ankle.distanceTo(quiet[i])); }); }
  }
  assert.ok(worst < .25, `ningún tobillo queda atrás estirando la pierna: ${(100 * worst).toFixed(0)} cm de la raíz`);
  assert.ok(sliding < .01, `patinando los pies van con el cuerpo: se corren ${(100 * sliding).toFixed(1)} cm respecto a la raíz`);
  assert.ok(quietMove < .01, `con la raíz quieta los pies quedan anclados: ${(100 * quietMove).toFixed(1)} cm`);
  // Un golpe que lo aturde suelta el anclaje en ~0,1 s aunque la raíz se mueva despacio (0,3 m/s).
  const drift = stunned => {
    const rig = bodyRig(), other = new ActionPose(rig.bones);
    other.apply(dt, { movement: { grounded: true } });
    other.apply(dt, { movement: { grounded: false, verticalVelocity: -15, airTime: .65, launchSpeed: 0, groundGap: .1, timeToGround: .007, fallHeight: 5 } });
    let start = null;
    for (let t = .2, k = 0; k < 12; t += dt, k++) {
      rig.root.position.x = .3 * k * dt; rig.root.updateMatrixWorld(true);
      other.apply(dt, { movement: { grounded: true, landing: .7, landingTime: t, landingImpact: 1, landingSpeed: 15.2, stunned: stunned && k > 0 } });
      start ??= at(other, 'leftFoot');
    }
    return at(other, 'leftFoot').distanceTo(start);
  };
  assert.ok(drift(false) < .005 && drift(true) > .025, `aturdido los pies van con el cuerpo: ${drift(true).toFixed(3)} vs ${drift(false).toFixed(3)}`);
});

test('saltar desde el fondo de la sentadilla de un golpe fuerte arranca desde abajo: la cadera visible no salta y los brazos salen de la pose del aterrizaje', () => {
  for (const after of [.12, .2]) {
    const { root, pose, p, input, step } = playerRig();
    const ground = x => (x < 0 ? 5 : 0);
    p.position.set(-3, 5, 0); p.root.position.copy(p.position);
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    for (let i = 0; i < 600 && !(p.isGrounded && p.landing > 0 && p.landingSpeed > 10); i++) step(1 / 60, ground);
    for (let i = 0; i < 600 && p.landingTime < after; i++) step(1 / 60, ground);
    assert.ok(pose.jumpHipDrop > .2, `está en el fondo: ${pose.jumpHipDrop}`);
    const arms = armMeter(pose, root);
    arms();
    input.presses.add('Space'); input.held = true;
    let prev = at(pose, 'hips').y, first = null, most = 0, swing = 0;
    for (let i = 0; i < 20; i++) {
      step(1 / 60, ground);
      if (i < 6) swing = Math.max(swing, arms());
      const hip = at(pose, 'hips').y, change = hip - prev;
      first ??= change;
      most = Math.max(most, Math.abs(change));
      prev = hip;
    }
    assert.ok(Math.abs(first) < .05, `${after} s: al despegar la cadera visible se mueve ${(100 * first).toFixed(1)} cm`);
    assert.ok(most < .1, `${after} s: se estira desde abajo sin saltos: ${(100 * most).toFixed(1)} cm por cuadro`);
    assert.ok(swing < 15, `${after} s: los brazos salen de la sentadilla sin saltar: ${swing.toFixed(1)}° en un cuadro`);
  }
});

test('golpe fuerte corriendo desde 3, 5 y 7,8 m: al tocar ninguna rodilla se estira (el cuerpo va un poco ladeado y la cadera baja lo que falta)', () => {
  for (const height of [3, 5, 7.8]) {
    const { pose, p, input, step } = playerRig();
    const ground = x => (x < 0 ? height : 0);
    p.position.set(-3, height, 0); p.root.position.copy(p.position);
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    let last = null, contact = null;
    for (let i = 0; i < 600 && !contact; i++) {
      const wasAir = !p.isGrounded && p.position.x > 0;
      step(1 / 60, ground);
      const knees = ['left', 'right'].map(name => kneeBend(pose, name));
      if (wasAir && p.isGrounded) contact = knees;
      else last = knees;
    }
    for (const k of [0, 1]) assert.ok(contact[k] > last[k] - 3, `${height} m, rodilla ${k}: ${last[k].toFixed(1)}° en el aire y ${contact[k].toFixed(1)}° al tocar`);
  }
});

test('saltar mientras se levanta de un golpe fuerte: la cadera visible sale con la velocidad que traía y acelera desde el primer cuadro', () => {
  for (const after of [.24, .28, .32]) {
    const { pose, p, input, step } = playerRig();
    const ground = x => (x < 0 ? 5 : 0);
    p.position.set(-3, 5, 0); p.root.position.copy(p.position);
    input.axis = { x: 1, z: 0 }; input.isRunning = true;
    for (let i = 0; i < 600 && !(p.isGrounded && p.landing > 0 && p.landingSpeed > 10); i++) step(1 / 60, ground);
    for (let i = 0; i < 600 && p.landingTime < after; i++) step(1 / 60, ground);
    const hips = [];
    for (let i = 0; i < 2; i++) { step(1 / 60, ground); hips.push(at(pose, 'hips').y); }
    input.presses.add('Space'); input.held = true;
    for (let i = 0; i < 2; i++) { step(1 / 60, ground); hips.push(at(pose, 'hips').y); }
    // Velocidad (m/s) del último cuadro en el suelo y de los dos primeros en el aire.
    const [before, first, second] = [1, 2, 3].map(i => 60 * (hips[i] - hips[i - 1]));
    assert.ok(before > .5, `${after} s: se estaba levantando (${before.toFixed(2)} m/s)`);
    assert.ok(first - before >= .5 * (second - first), `${after} s: sube a ${before.toFixed(2)}, ${first.toFixed(2)} y ${second.toFixed(2)} m/s: no arranca tarde`);
  }
});

test('un golpe fuerte a medias (10,6-10,9 m/s) termina sin tirón de brazos: todo llega a cero con la duración real', () => {
  for (const speed of [10.6, 10.9]) {
    const { root, bones } = bodyRig(), pose = new ActionPose(bones), dt = 1 / 60;
    pose.apply(dt, { movement: { grounded: true } });
    const h = speed * speed / (2 * JUMP.fallGravity);
    for (let t = dt; ; t += dt) {
      const y = h - .5 * JUMP.fallGravity * t * t;
      if (y <= 0) break;
      pose.apply(dt, { movement: { grounded: false, verticalVelocity: -JUMP.fallGravity * t, airTime: t, launchSpeed: 0, groundGap: y, timeToGround: timeToGround(y, -JUMP.fallGravity * t, false), fallHeight: h } });
    }
    const dur = landingDuration(speed), turn = turnMeter(root);
    let end = null;
    for (let t = 0, k = 0; end === null && k < 120; t += dt, k++) {
      const landing = Math.max(0, 1 - t / dur);
      pose.apply(dt, { movement: { grounded: true, landing: k === 0 ? 1 : landing, landingTime: t, landingImpact: landingImpact(speed), landingSpeed: speed } });
      const most = turn();
      if (k > 0 && landing === 0) end = most;
    }
    assert.ok(end < 3, `${speed} m/s: al terminar el aterrizaje gira ${end.toFixed(1)}°`);
  }
});

test('sentadilla del golpe fuerte: cadera atrás y abajo, rodillas dobladas, tronco a no más de 45°, cabeza al frente, una mano en la rodilla y la otra hacia el piso', () => {
  const { bones } = bodyRig(), pose = new ActionPose(bones), dt = 1 / 60;
  pose.apply(dt, { movement: { grounded: true } });
  const hip0 = at(pose, 'hips').y;
  pose.apply(dt, { movement: { grounded: false, verticalVelocity: -15, airTime: .65, launchSpeed: 0, groundGap: .1, timeToGround: .007, fallHeight: 5 } });
  for (const t of [.005, .06, .12, .18]) pose.apply(dt, { movement: { grounded: true, landing: 1 - t / .84, landingTime: t, landingImpact: 1, landingSpeed: 15.2 } });
  const up = new THREE.Vector3(0, 1, 0), deg = 180 / Math.PI;
  const hips = at(pose, 'hips'), neck = at(pose, 'neck'), knee = at(pose, 'leftLeg'), ankle = at(pose, 'leftFoot'), thigh = at(pose, 'leftUpLeg');
  const torso = neck.clone().sub(hips).angleTo(up) * deg;
  const bend = 180 - thigh.clone().sub(knee).angleTo(ankle.clone().sub(knee)) * deg;
  assert.ok(hip0 - hips.y > .25, `la cadera baja ${(100 * (hip0 - hips.y)).toFixed(0)} cm`);
  assert.ok(hips.z < ankle.z - .04, `la cadera va detrás de los tobillos: ${(100 * (ankle.z - hips.z)).toFixed(1)} cm`);
  assert.ok(bend > 80, `rodillas bien dobladas: ${bend.toFixed(0)}°`);
  assert.ok(torso > 25 && torso <= 45, `tronco a ${torso.toFixed(0)}° de la vertical`);
  const head = direction(pose, 'head');
  assert.ok(head.angleTo(up) * deg < 25, `la cabeza mira al frente: ${(head.angleTo(up) * deg).toFixed(0)}°`);
  const left = at(pose, 'leftHand'), right = at(pose, 'rightHand');
  const onThigh = knee.clone().lerp(thigh, .25);
  assert.ok(left.distanceTo(onThigh) < .12, `la izquierda se apoya en el muslo, encima de la rodilla: a ${(100 * left.distanceTo(onThigh)).toFixed(0)} cm`);
  assert.ok(right.y < left.y && right.z > ankle.z, `la derecha baja hacia el piso por delante: ${right.toArray().map(v => v.toFixed(2))}`);
  assert.ok(direction(pose, 'rightForeArm').y < -.5, 'el antebrazo derecho apunta abajo');
});

test('salto parado: al aterrizar los pies no resbalan aunque el clip los mueva, y después vuelven al clip de a poco', () => {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones), dt = 1 / 60;
  pose.apply(dt, { movement: { grounded: true } });
  pose.apply(dt, { movement: { grounded: false, verticalVelocity: -4.5, airTime: .55, launchSpeed: 5.45, groundGap: .04, timeToGround: .009, fallHeight: .77 } });
  const thigh = pose.joints.leftUpLeg, base = thigh.quaternion.clone(), turn = new THREE.Quaternion();
  const speed = 5.45, dur = landingDuration(speed);
  let first = null, held = 0, jump = 0, prev = null, last = null;
  for (let t = .005, k = 0; t < dur + .5; t += dt, k++) {
    // El clip corre el pie izquierdo ~9 cm en los primeros 50 ms del aterrizaje (como al pasar de saltar a estar de pie).
    pose.restore();
    thigh.quaternion.copy(base).multiply(turn.setFromAxisAngle(new THREE.Vector3(0, 0, 1), .11 * Math.min(1, t / .05)));
    root.updateMatrixWorld(true);
    const landing = Math.max(0, 1 - t / dur);
    pose.apply(dt, { movement: landing > 0 || k === 0
      ? { grounded: true, landing: k === 0 ? 1 : landing, landingTime: t, landingImpact: landingImpact(speed), landingSpeed: speed }
      : { grounded: true } });
    const foot = at(pose, 'leftFoot');
    first ??= foot.clone();
    if (landing > 0) held = Math.max(held, Math.hypot(foot.x - first.x, foot.z - first.z));
    if (prev) jump = Math.max(jump, Math.hypot(foot.x - prev.x, foot.z - prev.z));
    prev = last = foot;
  }
  pose.restore();
  const clip = at(pose, 'leftFoot');
  assert.ok(clip.distanceTo(first) > .07, `el clip sí movió el pie: ${(100 * clip.distanceTo(first)).toFixed(1)} cm`);
  assert.ok(held < .01, `mientras se recupera el pie no resbala: ${(100 * held).toFixed(1)} cm`);
  assert.ok(jump < .012, `después vuelve al clip de a poco: ${(100 * jump).toFixed(1)} cm por cuadro`);
  assert.ok(Math.hypot(last.x - clip.x, last.z - clip.z) < 1e-3, 'y al final queda en el clip');
});

test('andando o corriendo un aterrizaje normal no ancla los pies: el de apoyo ya va plantado en el clip y no se arrastra con el cuerpo', () => {
  for (const speed of [1.5, 3.6]) {
    const { root, bones } = bodyRig(), pose = new ActionPose(bones), dt = 1 / 60;
    pose.apply(dt, { movement: { grounded: true } });
    const thigh = pose.joints.leftUpLeg, base = thigh.quaternion.clone(), parent = new THREE.Quaternion();
    const swing = new THREE.Quaternion(), side = new THREE.Vector3(1, 0, 0);
    // Clip de apoyo: el muslo izquierdo gira hacia atrás (alrededor del eje lateral del mundo) para que el pie
    // se quede quieto mientras la raíz avanza (+Z es adelante).
    const plant = (z, footZ) => {
      root.position.z = z; root.updateMatrixWorld(true);
      thigh.parent.getWorldQuaternion(parent);
      const footAt = a => {
        swing.setFromAxisAngle(side, a);
        thigh.quaternion.copy(parent).invert().multiply(swing).multiply(parent).multiply(base);
        root.updateMatrixWorld(true);
        return at(pose, 'leftFoot').z;
      };
      let lo = -.8, hi = .8;
      const rising = footAt(.1) > footAt(-.1);
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if ((footAt(mid) < footZ) === rising) lo = mid; else hi = mid; }
      footAt((lo + hi) / 2);
    };
    let x = 0;
    for (let k = 0; k < 3; k++) {
      x += speed * dt; root.position.z = x; root.updateMatrixWorld(true);
      pose.apply(dt, { movement: { grounded: false, verticalVelocity: -4.5, airTime: .5 + k * dt, launchSpeed: 5.45, groundGap: .05, timeToGround: .01, fallHeight: .78 } });
    }
    pose.restore(); root.updateMatrixWorld(true);
    const footZ = at(pose, 'leftFoot').z, footY = at(pose, 'leftFoot').y, dur = landingDuration(5.45);
    let worst = 0;
    for (let t = .005, k = 0; t < dur + .1; t += dt, k++) {
      x += speed * dt;
      pose.restore();
      plant(x, footZ);
      const clip = at(pose, 'leftFoot');
      const landing = Math.max(0, 1 - t / dur);
      pose.apply(dt, { speed, movement: landing > 0 || k === 0
        ? { grounded: true, landing: k === 0 ? 1 : landing, landingTime: t, landingImpact: landingImpact(5.45), landingSpeed: 5.45 }
        : { grounded: true } });
      const foot = at(pose, 'leftFoot');
      // Solo mientras el clip lo tiene en el piso (este clip, que solo gira el muslo, lo levanta al alejarse).
      if (clip.y - footY < .015) worst = Math.max(worst, Math.hypot(foot.x - clip.x, foot.z - clip.z));
    }
    // Arrastrado con el cuerpo se separaría ~2,5-6 cm por cuadro; inclinado por el aterrizaje, hasta 13 cm.
    assert.ok(worst < .01, `${speed} m/s: el pie de apoyo sigue al clip (se separa ${(100 * worst).toFixed(1)} cm)`);
  }
});

test('si en pleno empuje el suelo de debajo sube (un escalón de 35 cm), la cadera visible deja de bajar respecto a la raíz y sube con él', () => {
  const { root, bones } = bodyRig(), pose = new ActionPose(bones);
  pose.apply(1 / 60, { movement: { grounded: true } });
  const drops = [];
  for (let t = 1 / 60, k = 0; k < 6; t += 1 / 60, k++) {
    const y = JUMP.launchSpeed * t - .5 * JUMP.riseGravity * t * t, floor = k >= 3 ? .35 : 0;
    root.position.y = y; root.updateMatrixWorld(true);
    pose.apply(1 / 60, { action: 'saltar', movement: { grounded: false, verticalVelocity: JUMP.launchSpeed - JUMP.riseGravity * t, airTime: t, launchSpeed: JUMP.launchSpeed, groundGap: Math.max(0, y - floor), timeToGround: .5 } });
    drops.push(pose.jumpHipDrop);
  }
  const before = drops[2], after = drops.slice(3);
  assert.ok(Math.max(...after) - before < .04, `con el escalón la cadera baja ${(100 * (Math.max(...after) - before)).toFixed(1)} cm más respecto a la raíz`);
  assert.ok(after[2] < after[0], `y a los dos cuadros ya sube con el suelo: ${after.map(d => (100 * d).toFixed(1)).join(', ')} cm`);
});

test('despegue: el desfase entre cuerpo y raíz es completo parado, menor andando y nada corriendo; contra un escalón alto la cadera no salta', () => {
  const drop = speed => {
    const { root, bones } = bodyRig(), pose = new ActionPose(bones);
    pose.apply(1 / 60, { speed, movement: { grounded: true } });
    let most = 0;
    for (let t = 1 / 60; t < .25; t += 1 / 60) {
      const y = JUMP.launchSpeed * t - .5 * JUMP.riseGravity * t * t;
      root.position.y = y; root.updateMatrixWorld(true);
      pose.apply(1 / 60, { speed, action: 'saltar', movement: { grounded: false, verticalVelocity: JUMP.launchSpeed - JUMP.riseGravity * t, airTime: t, launchSpeed: JUMP.launchSpeed, groundGap: y, timeToGround: .5 } });
      most = Math.max(most, pose.jumpHipDrop);
    }
    return most;
  };
  const standing = drop(0), walking = drop(2.7), running = drop(5.5);
  assert.ok(standing > .25, `parado: ${standing}`);
  assert.ok(walking < .7 * standing && walking > .05, `andando: ${walking} vs ${standing}`);
  assert.equal(running, 0, 'corriendo la cadera va con la raíz');
  // Salto parado hacia un escalón de 0,6 m a 15 cm: sube al escalón en pleno empuje.
  const { pose, p, input, step } = playerRig();
  const ground = x => (x >= 0 ? .6 : 0);
  p.position.set(-1.2, 0, 0); p.root.position.copy(p.position);
  input.axis = { x: .45, z: 0 };
  for (let k = 0; k < 600 && p.position.x < -.15; k++) step(1 / 60, ground);
  input.presses.add('Space'); input.held = true;
  let prev = at(pose, 'hips').y, most = 0;
  for (let i = 0; i < 40; i++) {
    step(1 / 60, ground);
    const hip = at(pose, 'hips').y;
    most = Math.max(most, Math.abs(hip - prev)); prev = hip;
  }
  assert.ok(most < .12, `la cadera visible no salta al subir al escalón: ${(100 * most).toFixed(1)} cm por cuadro`);
});
