import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../src/character/character.js';

test('agacharse y levantarse mezclan la altura sin desplazar la raíz física', () => {
  const character = createCharacter();
  for (let i = 0; i < 120; i++) character.update(1 / 60, {});
  const standing = character.ragdollRig.hips.position.y;
  character.update(1 / 60, { action: 'cagar' });
  const first = character.ragdollRig.hips.position.y;
  assert.ok(standing - first > 0 && standing - first < .08, 'no salta a la altura agachada');
  for (let i = 0; i < 120; i++) character.update(1 / 60, { action: 'cagar' });
  assert.ok(standing - character.ragdollRig.hips.position.y > .17);
  character.update(1 / 60, {});
  assert.ok(character.ragdollRig.hips.position.y < standing - .1, 'tampoco salta al levantarse');
  for (let i = 0; i < 120; i++) character.update(1 / 60, {});
  assert.ok(Math.abs(character.ragdollRig.hips.position.y - standing) < .01);
  assert.deepEqual(character.group.position.toArray(), [0, 0, 0]);
  character.dispose();
});

test('al caminar alternan piernas y brazos, y al detenerse vuelven a reposo', () => {
  const character = createCharacter();
  let leftAhead = false, rightAhead = false;
  for (let i = 0; i < 120; i++) {
    character.update(1 / 60, { speed: 3 });
    const rig = character.ragdollRig;
    leftAhead ||= rig.leftUpLeg.rotation.x - rig.rightUpLeg.rotation.x > .3;
    rightAhead ||= rig.rightUpLeg.rotation.x - rig.leftUpLeg.rotation.x > .3;
    assert.ok(rig.leftArm.rotation.x * rig.leftUpLeg.rotation.x <= 1e-8);
  }
  assert.ok(leftAhead && rightAhead);
  for (let i = 0; i < 120; i++) character.update(1 / 60, { speed: 0 });
  assert.ok(Math.abs(character.ragdollRig.leftUpLeg.rotation.x) < .01);
  assert.ok(Math.abs(character.ragdollRig.rightUpLeg.rotation.x) < .01);
  character.dispose();
});

test('la flexión para agacharse conserva suelas horizontales sin hundir el calzado', () => {
  const character = createCharacter();
  for (const zapatos of ['tenis', 'chanclas', 'botas']) {
    character.setLook({ ...character.look, zapatos });
    for (let i = 0; i < 120; i++) character.update(1 / 60, { action: 'cagar' });
    for (const side of ['left', 'right']) {
      const rig = character.ragdollRig;
      const foot = rig[`${side}Foot`];
      const rotation = rig[`${side}UpLeg`].rotation.x + rig[`${side}Leg`].rotation.x + foot.rotation.x;
      assert.ok(Math.abs(rotation) < 1e-9, 'el tobillo compensa rodilla y cadera');
      character.group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(foot);
      assert.ok(bounds.min.y > -.025, `${zapatos}: no atraviesa el suelo (${bounds.min.y})`);
      assert.ok(bounds.min.y < .035, `${zapatos}: no queda flotando (${bounds.min.y})`);
    }
  }
  character.dispose();
});

test('comer y beber acercan la mano y la bajan dentro de la acción, con poses distintas', () => {
  const sample = action => {
    const character = createCharacter();
    for (let i = 0; i < 90; i++) character.update(1 / 60, { action, actionProgress: .45 });
    const held = character.ragdollRig.rightArm.rotation.x;
    const head = character.ragdollRig.head.rotation.x;
    for (let i = 0; i < 90; i++) character.update(1 / 60, { action, actionProgress: 1 });
    const released = character.ragdollRig.rightArm.rotation.x;
    assert.ok(held < -1.3, 'la mano sube durante el gesto');
    assert.ok(Math.abs(released) < .03, 'la mano regresa antes de terminar');
    assert.deepEqual(character.group.position.toArray(), [0, 0, 0]);
    character.dispose();
    return head;
  };
  assert.ok(sample('comer') > sample('beber') + .15, 'beber levanta el mentón');
});

test('lanzar prepara el brazo, extiende y recupera una sola vez según el progreso', () => {
  const character = createCharacter();
  const angles = [];
  for (const actionProgress of [.3, .52, 1]) {
    for (let i = 0; i < 90; i++) character.update(1 / 60, { action: 'lanzar', actionProgress });
    angles.push(character.ragdollRig.rightArm.rotation.x);
  }
  assert.ok(angles[0] < -2.4, 'preparación sobre el hombro');
  assert.ok(angles[1] > angles[0] + 1, 'extensión después de preparar');
  assert.ok(Math.abs(angles[2]) < .02, 'reposo sin repetir el lanzamiento');
  character.dispose();
});

test('la postura de descanso dobla articulaciones y deja libres las acciones al salir', () => {
  const character = createCharacter();
  for (let i = 0; i < 120; i++) character.update(1 / 60, { action: 'dormir' });
  assert.ok(character.ragdollRig.rightLeg.rotation.x > .4);
  assert.ok(character.ragdollRig.leftForeArm.rotation.x < -.9);
  assert.deepEqual(character.group.position.toArray(), [0, 0, 0]);
  for (let i = 0; i < 120; i++) character.update(1 / 60, {});
  assert.ok(Math.abs(character.ragdollRig.hips.parent.rotation.x) < .001);
  character.dispose();
});
