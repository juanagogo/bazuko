import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { ConversationGaze } from '../src/character/ConversationGaze.js';
import { readMotion, writeMotion } from '../src/character/RealisticCharacter.js';

const DEG = Math.PI / 180;

function rigAt(x, y, z, size = 1, heading = 0) {
  const body = new Group(), torso = new Bone(), neck = new Bone(), head = new Bone();
  body.position.set(x, y, z);
  body.rotation.y = heading;
  body.scale.set(1, size, 1);
  body.add(torso); torso.add(neck); neck.add(head);
  torso.position.y = 1;
  neck.position.set(0, .39, 0);
  head.position.set(0, .12, .025);
  const eyes = body.localToWorld(new Vector3(0, 1.61, .103));
  return { torso, neck, head, gaze: new ConversationGaze(body, head, neck, eyes) };
}

function angle({ gaze, head }, target) {
  const eyes = gaze.eyePosition(new Vector3());
  const direction = new Vector3(0, 0, 1).transformDirection(head.matrixWorld);
  return direction.angleTo(target.clone().sub(eyes));
}

test('la cara se apoya en el gesto del clip y atiende a los ojos a otra talla y cota', () => {
  const person = rigAt(0, .04, 0, .96, .1), partner = rigAt(.2, .12, 1.32, 1.06, Math.PI);
  person.torso.rotation.x = 15 * DEG;
  person.neck.rotation.x = 9 * DEG;
  person.head.rotation.set(5 * DEG, -8 * DEG, 3 * DEG);
  const eyes = partner.gaze.eyePosition(new Vector3());
  const original = [person.torso, person.neck, person.head].map(bone => bone.quaternion.clone());
  const error = angle(person, eyes);
  assert.ok(error > 35 * DEG);
  for (let frame = 0; frame < 45; frame++) {
    person.gaze.restore();
    person.gaze.update(1 / 60, eyes, true);
  }
  assert.ok(angle(person, eyes) < 14 * DEG, 'la mirada sube y gira hacia el otro');
  assert.ok(person.torso.quaternion.angleTo(original[0]) < 1e-7, 'el torso conserva el gesto');
  person.gaze.restore();
  [person.neck, person.head].forEach((bone, i) => assert.ok(bone.quaternion.angleTo(original[i + 1]) < 1e-7));
});

test('la atención se conserva al cambiar de malla y se suelta de camino o al caer', () => {
  const full = rigAt(0, .12, 0, .985), lod = rigAt(0, .12, 0, .985);
  const target = new Vector3(.58, 1.97, 1.14);
  full.gaze.update(.6, target, true);
  const from = { actions: {}, conversationGaze: full.gaze }, to = { actions: {}, conversationGaze: lod.gaze };
  writeMotion(to, {}, readMotion(from, {}));
  lod.gaze.update(0, target, true);
  assert.ok(full.head.quaternion.angleTo(lod.head.quaternion) < 1e-7);

  const neck = lod.neck.quaternion.clone();
  lod.gaze.restore();
  lod.gaze.update(1 / 60, null, true);
  assert.ok(lod.neck.quaternion.angleTo(neck) < 3 * DEG, 'soltarlo tarda varios cuadros');
  for (let frame = 0; frame < 60; frame++) {
    lod.gaze.restore();
    lod.gaze.update(1 / 60, null, true);
  }
  assert.equal(lod.gaze.active, false);
  assert.equal(lod.head.quaternion.angleTo(new Quaternion()), 0);
  lod.gaze.update(.6, target, true);
  lod.gaze.restore();
  lod.gaze.update(1 / 60, target, false);
  assert.equal(lod.head.quaternion.angleTo(new Quaternion()), 0);
});

test('el asentimiento baja la mirada durante la respuesta y se retira sin cambiar el gesto', () => {
  const { gaze, neck, head } = rigAt(0, 0, 0);
  const eyes = gaze.eyePosition(new Vector3());
  const target = eyes.clone().add(new Vector3(0, 0, 1));
  gaze.update(.25, target, true, .1);
  assert.ok(gaze.pitch > .08 && gaze.pitch < .1);
  gaze.restore();
  assert.equal(neck.quaternion.angleTo(new Quaternion()), 0);
  assert.equal(head.quaternion.angleTo(new Quaternion()), 0);
  gaze.update(.5, target, true);
  assert.equal(gaze.pitch, 0);
});
