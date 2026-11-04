import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AnimationPreview } from '../src/sala/AnimationPreview.js';
import { preparePlayback } from '../src/character/AnimationPlayback.js';

function player(profile = 'mixamo-preview') {
  const calls = [];
  const p = {
    position: new THREE.Vector3(), root: new THREE.Group(), velocity: new THREE.Vector3(),
    modelScale: 1.08, speedWalk: 1.4, speedRun: 4,
    stopSmoking() {}, stopBasuco() {}, resetGrounding() {}, melee: { cancel() {} },
    character: {
      animationStatus: { profile, durations: { beber: 8, buscar: 6, pedir: 7, dormir: 12 }, loops: { beber: false, buscar: false, pedir: true, dormir: true } },
      update(dt, state) { calls.push({ dt, ...state }); }
    }
  };
  return { p, calls, preview: new AnimationPreview(p) };
}

test('el visor Mixamo conserva los ocho segundos del gesto y deja tiempo para volver al reposo', () => {
  const { preview, calls } = player();
  preview.play('beber'); preview.update(3);
  assert.equal(calls.at(-1).action, 'beber');
  assert.equal(calls.at(-1).actionProgress, 3 / 8);
  preview.update(4.9);
  assert.equal(calls.at(-1).action, 'beber');
  assert.equal(calls.at(-1).actionProgress, 7.9 / 8);
  preview.update(.3);
  assert.equal(calls.at(-1).action, null, 'la salida ocupa la pausa, no una repetición acelerada');
  preview.update(.7);
  assert.equal(calls.at(-1).action, 'beber');
  assert.ok(calls.at(-1).actionProgress < .02);
  assert.equal(calls.at(-1).movement.previewCadence, 'source');
});

test('un loop del banco queda continuo y el banco actual conserva sus tiempos anteriores', () => {
  const imported = player();
  imported.preview.play('pedir'); imported.preview.update(7.3);
  assert.equal(imported.calls.at(-1).action, 'pedir');
  const current = player('default');
  current.preview.play('beber'); current.preview.update(3.3);
  assert.equal(current.calls.at(-1).action, null);
  assert.equal(current.calls.at(-1).movement.previewCadence, undefined);
  current.preview.play('dormir'); current.preview.update(3.3);
  assert.equal(current.calls.at(-1).action, 'dormir');
});

test('cambiar de modelo renueva la duración que consulta el visor', () => {
  const { p, preview, calls } = player('default');
  preview.play('beber'); preview.update(1);
  assert.equal(calls.at(-1).actionProgress, 1 / 3);
  p.character = player().p.character;
  let state;
  p.character.update = (_dt, value) => { state = value; };
  preview.update(1);
  assert.equal(state.actionProgress, 2 / 8);
});

test('un clip Mixamo no cíclico como buscar se clampa al final sin regresar a su primer fotograma', () => {
  const root = new THREE.Object3D();
  const mixer = new THREE.AnimationMixer(root);
  const clip = new THREE.AnimationClip('buscar', 6, [new THREE.NumberKeyframeTrack('.position[y]', [0, 6], [0, 1])]);
  const action = mixer.clipAction(clip).play();
  preparePlayback({ buscar: action }, {}, { target: 'buscar', action: 'buscar', progress: .5, loop: false });
  mixer.update(0);
  assert.equal(action.loop, THREE.LoopOnce);
  assert.equal(root.position.y, .5);
  mixer.update(3);
  assert.equal(root.position.y, .5, 'el reloj del mezclador no adelanta una fase dirigida por el visor');
});
