// tests/hurto.test.js
// Las poses de robar: la mano llega al bolsillo de verdad, los dos lados se reflejan y todo vuelve al clip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ActionPose } from '../src/character/ActionPose.js';
import { HURTO, CONTACTO_RAPONAZO, FASES_DE_HURTO, POSES_DE_HURTO, muestraDeHurto, terminada, nuevaMuestra } from '../src/character/hurto.js';

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
  root.updateMatrixWorld(true);
  return { root, bones: new Map(nodes.map(bone => [bone.name, bone])) };
}
function snapshot(root) {
  const transforms = [];
  root.traverse(bone => transforms.push([bone.name, ...bone.position.toArray(), ...bone.quaternion.toArray()]));
  return transforms;
}
const at = (pose, key) => pose.joints[key].getWorldPosition(new THREE.Vector3());
const lowest = pose => Math.min(at(pose, 'leftFoot').y, at(pose, 'rightFoot').y);
function play(pose, hurto, frames = 40, extra = {}) {
  for (let i = 0; i < frames; i++) pose.apply(1 / 60, { hurto, ...extra });
}
function rig() {
  const r = bodyRig();
  return { ...r, pose: new ActionPose(r.bones, { frame: r.root }) };
}

test('cada fase entra desde el clip y las que terminan vuelven a él', () => {
  for (const fase of FASES_DE_HURTO) {
    const m = muestraDeHurto({ fase, t: 0 }, nuevaMuestra());
    if (['meter', 'raponazo', 'palparse', 'sobresalto', 'helado'].includes(fase)) assert.ok(m.peso < .01, `${fase} empieza en 0`);
    if (Number.isFinite(HURTO[fase])) {
      assert.equal(muestraDeHurto({ fase, t: HURTO[fase] }, nuevaMuestra()).peso, 0, `${fase} termina en 0`);
      assert.equal(terminada({ fase, t: HURTO[fase] }), true);
      assert.equal(terminada({ fase, t: HURTO[fase] - .05 }), false);
    }
  }
  assert.equal(terminada({ fase: 'meter', t: 99 }), false, 'meter dura lo que dure la barra');
  assert.equal(muestraDeHurto({ fase: 'meter', t: 2 }, nuevaMuestra()).peso, 1);
});

test('el raponazo llega al bolso justo en el contacto', () => {
  const m = muestraDeHurto({ fase: 'raponazo', t: CONTACTO_RAPONAZO }, nuevaMuestra());
  const want = new THREE.Vector3(...POSES_DE_HURTO.arrancar.brazo).normalize();
  assert.ok(new THREE.Vector3(...m.brazo).dot(want) > .999);
  assert.equal(m.alcance, 1);
});

test('meter la mano: la muñeca baja al frente, a la altura de una cadera ajena', () => {
  const { pose } = rig();
  const hips = at(pose, 'hips').y, shoulder = at(pose, 'rightArm');
  play(pose, { fase: 'meter', t: .5, lado: 1 });
  const wrist = at(pose, 'rightHand');
  assert.ok(wrist.z - shoulder.z > .25, `al frente: ${wrist.z - shoulder.z}`);
  assert.ok(wrist.y > hips - .1 && wrist.y < hips + .25, `a la cadera: ${wrist.y} (cadera ${hips})`);
});

test('con la barra en la zona los dedos se hunden: la mano baja', () => {
  const a = rig(), b = rig();
  play(a.pose, { fase: 'meter', t: .5, lado: 1, hondura: 0 });
  play(b.pose, { fase: 'meter', t: .5, lado: 1, hondura: 1 });
  assert.ok(at(a.pose, 'rightHand').y - at(b.pose, 'rightHand').y > .03);
});

test('con objetivo la palma llega al bolsillo: el antebrazo apunta a él y la muñeca queda a un palmo', () => {
  const { pose } = rig();
  const target = new THREE.Vector3(-.12, 1.0, .5);
  play(pose, { fase: 'meter', t: .5, lado: 1, objetivo: target });
  const elbow = at(pose, 'rightForeArm'), wrist = at(pose, 'rightHand');
  const fore = wrist.clone().sub(elbow).normalize(), toTarget = target.clone().sub(elbow).normalize();
  assert.ok(fore.dot(toTarget) > .99, `apunta: ${fore.dot(toTarget)}`);
  const palmo = wrist.distanceTo(target);
  assert.ok(palmo < .12, `la muñeca a ${palmo.toFixed(3)} m del bolsillo`);
  // Más lejos de lo que alcanza: se estira hacia él, sin doblar el codo al revés.
  const lejos = rig();
  play(lejos.pose, { fase: 'meter', t: .5, lado: 1, objetivo: new THREE.Vector3(-.15, 1.0, 1.4) });
  const w2 = at(lejos.pose, 'rightHand');
  assert.ok(w2.z > wrist.z, 'se estira hacia lo que no alcanza');
});

test('la mano izquierda refleja a la derecha y deja quieta la otra', () => {
  const left = rig(), ref = rig();
  const before = at(left.pose, 'rightHand');
  play(left.pose, { fase: 'meter', t: .5, lado: -1 });
  play(ref.pose, { fase: 'meter', t: .5, lado: 1 });
  const l = at(left.pose, 'leftHand'), r = at(ref.pose, 'rightHand');
  assert.ok(Math.abs(l.x + r.x) < .03 && Math.abs(l.y - r.y) < .03 && Math.abs(l.z - r.z) < .03, `${l.toArray()} vs ${r.toArray()}`);
  // El pecho gira un poco hacia el lado que roba: la mano derecha casi no se mueve de donde estaba.
  assert.ok(at(left.pose, 'rightHand').distanceTo(before) < .12);
});

test('meter la mano gira el pecho: el hombro que roba va adelante', () => {
  const { pose } = rig();
  const before = at(pose, 'rightArm').z;
  play(pose, { fase: 'meter', t: .5, lado: 1 });
  assert.ok(at(pose, 'rightArm').z > before + .01, `${at(pose, 'rightArm').z} > ${before}`);
});

test('disimular rasca la nuca, la víctima se palpa atrás y el raponazo tira al frente', () => {
  const check = (hurto, test) => { const { pose } = rig(); const ref = { head: at(pose, 'head'), hips: at(pose, 'hips') }; play(pose, hurto); test(pose, ref); };
  check({ fase: 'disimular', t: .6, lado: 1 }, (p, ref) => assert.ok(at(p, 'rightHand').y > ref.head.y - .1, 'a la nuca'));
  check({ fase: 'palparse', t: .6, lado: 1 }, (p, ref) => assert.ok(at(p, 'rightHand').z < ref.hips.z - .15, 'al bolsillo de atrás'));
  check({ fase: 'raponazo', t: CONTACTO_RAPONAZO, lado: 1 }, (p, ref) => {
    const w = at(p, 'rightHand');
    assert.ok(w.z > ref.hips.z + .4 && w.y > ref.hips.y + .15, `al bolso: ${w.toArray()}`);
  });
  check({ fase: 'pillado', t: .5, lado: 1 }, (p, ref) => {
    assert.ok(at(p, 'rightHand').y > ref.hips.y + .4 && at(p, 'leftHand').y > ref.hips.y + .4, 'las dos manos arriba');
  });
});

test('ninguna fase mueve los pies ni la raíz, y restore devuelve el clip', () => {
  for (const fase of FASES_DE_HURTO) {
    const { root, pose } = rig();
    const original = snapshot(root), foot = lowest(pose);
    play(pose, { fase, t: .3, lado: 1, objetivo: new THREE.Vector3(-.1, 1, .5) }, 30);
    assert.notDeepEqual(snapshot(root), original, fase);
    assert.ok(Math.abs(lowest(pose) - foot) < 1e-6, fase);
    assert.deepEqual(root.position.toArray(), [0, 0, 0]);
    pose.restore();
    assert.deepEqual(snapshot(root), original, fase);
  }
});

test('un golpe, el agua, el salto o recibir un golpe le quitan la mano al robo', () => {
  for (const state of [
    { attack: { weapon: 'punos', step: 0, phase: 'active', progress: .5 } },
    { speed: 2, movement: { swimming: true, surfaceY: 1 } },
    { action: 'saltar', movement: { grounded: false, verticalVelocity: 4, airTime: .3 } },
    { action: 'recibirGolpe', actionProgress: .2 }
  ]) {
    const { pose } = rig();
    play(pose, { fase: 'meter', t: .5, lado: 1 }, 20);
    assert.ok(pose.hurtoWeight > .9);
    pose.apply(1 / 60, { hurto: { fase: 'meter', t: .5, lado: 1 }, ...state });
    assert.equal(pose.hurtoWeight, 0, JSON.stringify(state));
  }
});

test('robar le quita el cigarrillo a la mano y al soltar vuelve poco a poco', () => {
  const { pose } = rig();
  for (let i = 0; i < 40; i++) pose.apply(1 / 60, { smoke: { puff: 1 } });
  assert.equal(pose.smoke.active, true);
  pose.apply(1 / 60, { smoke: { puff: 1 }, hurto: { fase: 'meter', t: .2, lado: 1 } });
  assert.equal(pose.smoke.active, false);
  pose.apply(1 / 60, {});
  assert.ok(pose.hurtoWeight > 0, 'la mano no salta: se retira');
  for (let i = 0; i < 120; i++) pose.apply(1 / 60, {});
  assert.equal(pose.hurtoWeight, 0);
  assert.equal(pose._hurto, null);
});

test('el cuerpo procedural, sin manos, roba sin romperse', () => {
  const part = (y, parent) => { const o = new THREE.Object3D(); o.position.y = y; parent?.add(o); return o; };
  const root = new THREE.Group();
  const hips = part(.52, root), spine = part(.1, hips), head = part(.5, spine);
  const rig = { hips, spine, head };
  for (const [side, x] of [['left', .2], ['right', -.2]]) {
    rig[`${side}Arm`] = part(.4, spine); rig[`${side}Arm`].position.x = x;
    rig[`${side}ForeArm`] = part(-.26, rig[`${side}Arm`]);
    rig[`${side}UpLeg`] = part(0, hips); rig[`${side}Leg`] = part(-.24, rig[`${side}UpLeg`]);
    rig[`${side}Foot`] = part(-.24, rig[`${side}Leg`]);
  }
  root.updateMatrixWorld(true);
  const pose = new ActionPose(rig, { procedural: true });
  for (const fase of FASES_DE_HURTO) {
    assert.doesNotThrow(() => play(pose, { fase, t: .3, lado: 1, objetivo: new THREE.Vector3(-.1, .5, .4) }, 10), fase);
  }
});

test('a un bolsillo bajo (sentado, en el piso) se agacha: rodillas y espalda, con los pies donde estaban', () => {
  const de = rig(), agachado = rig();
  const foot = lowest(agachado.pose), pies = at(agachado.pose, 'leftFoot').add(at(agachado.pose, 'rightFoot')).multiplyScalar(.5);
  const hombro = at(agachado.pose, 'rightArm').y;
  const target = new THREE.Vector3(-.1, .35, .5);
  play(de.pose, { fase: 'meter', t: .5, lado: 1, objetivo: target, agachar: 0 });
  play(agachado.pose, { fase: 'meter', t: .5, lado: 1, objetivo: target, agachar: 1 });
  assert.ok(at(agachado.pose, 'rightArm').y < hombro - .35, `el hombro baja: ${at(agachado.pose, 'rightArm').y} (de pie ${hombro})`);
  const lejos = at(de.pose, 'rightHand').distanceTo(target), cerca = at(agachado.pose, 'rightHand').distanceTo(target);
  assert.ok(cerca < lejos - .2 && cerca < .15, `agachado llega: ${cerca.toFixed(3)} (de pie ${lejos.toFixed(3)})`);
  // Los pies no se mueven: la cadera baja y se va atrás.
  assert.ok(Math.abs(lowest(agachado.pose) - foot) < .01, `el pie más bajo: ${lowest(agachado.pose)} vs ${foot}`);
  const luego = at(agachado.pose, 'leftFoot').add(at(agachado.pose, 'rightFoot')).multiplyScalar(.5);
  assert.ok(Math.hypot(luego.x - pies.x, luego.z - pies.z) < .02, 'los pies no se deslizan');
  agachado.pose.restore();
  assert.ok(Math.abs(at(agachado.pose, 'rightArm').y - hombro) < 1e-6, 'restore devuelve el clip');
});

test('con una mano ocupada (el paraguas) la víctima se cubre o se palpa solo con la otra', () => {
  const m = muestraDeHurto({ fase: 'sobresalto', t: .3, lado: -1, unaMano: true }, nuevaMuestra());
  assert.equal(m.otra, 0);
  assert.equal(muestraDeHurto({ fase: 'sobresalto', t: .3, lado: 1 }, nuevaMuestra()).otra, 1);
  const { pose } = rig();
  const derecha = at(pose, 'rightHand');
  play(pose, { fase: 'sobresalto', t: .3, lado: -1, unaMano: true });
  assert.ok(at(pose, 'rightHand').distanceTo(derecha) < .15, 'la del paraguas casi no se mueve');
  assert.ok(at(pose, 'leftHand').y > at(pose, 'hips').y + .3, 'la otra sube');
});
