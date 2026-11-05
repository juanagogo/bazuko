import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { preparePlayback, blendAnimationWeights, transitionRate, HipBlend } from '../src/character/AnimationPlayback.js';

function fixture() {
  const root = new THREE.Object3D();
  const mixer = new THREE.AnimationMixer(root);
  const clips = ['idle', 'comer', 'beber', 'lanzar', 'pedir', 'buscar'].map(name =>
    new THREE.AnimationClip(name, 3, [new THREE.NumberKeyframeTrack('.rotation[x]', [0, 1.5, 3], [0, 1, 0])]));
  const actions = Object.fromEntries(clips.map(clip => [clip.name, mixer.clipAction(clip).play()]));
  return { root, mixer, actions, state: {} };
}

test('consumo y lanzamiento recorren el clip según el progreso de la acción, no el reloj del mezclador', () => {
  for (const action of ['comer', 'beber', 'lanzar']) {
    const { actions, state, mixer } = fixture();
    const original = actions[action].getClip().toJSON();
    for (const progress of [0, .25, .5, .9, 1]) {
      preparePlayback(actions, state, { target: action, action, progress });
      mixer.update(.05);
      assert.ok(Math.abs(actions[action].time - progress * 3) < 1e-10);
    }
    assert.deepEqual(actions[action].getClip().toJSON(), original);
  }
});

test('repetir una acción terminada vuelve a animar; acciones continuas siguen su ciclo', () => {
  const { actions, state, mixer } = fixture();
  preparePlayback(actions, state, { target: 'comer', action: 'comer', progress: .95 });
  mixer.update(.2);
  preparePlayback(actions, state, { target: 'comer', action: 'comer', progress: .1 });
  mixer.update(.1);
  assert.ok(Math.abs(actions.comer.time - .3) < 1e-10);
  preparePlayback(actions, state, { target: 'buscar', action: 'buscar', progress: 0 });
  mixer.update(4);
  assert.ok(Math.abs(actions.buscar.time - 1) < 1e-10, 'buscar repite sin quedar congelado por el progreso');
  preparePlayback(actions, state, { target: 'beber', action: 'beber' });
  mixer.update(.5);
  assert.equal(actions.beber.time, .5, 'un visor sin progreso conserva reproducción normal');
});

test('interrumpir una acción conserva pesos normalizados y la mezcla converge a distintos FPS', () => {
  const samples = [30, 60, 144].map(fps => {
    const weights = { idle: 1, comer: 0, locomocion: 0 };
    for (let i = 0; i < fps / 2; i++) blendAnimationWeights(weights, 'comer', 1 / fps, 16);
    for (let i = 0; i < fps / 2; i++) {
      blendAnimationWeights(weights, 'locomocion', 1 / fps, 14);
      assert.ok(Math.abs(Object.values(weights).reduce((a, b) => a + b) - 1) < 1e-12);
      assert.ok(Object.values(weights).every(weight => weight >= 0 && weight <= 1));
    }
    return weights;
  });
  for (const weights of samples) for (const key in weights) assert.ok(Math.abs(weights[key] - samples[0][key]) < .0001);
  assert.ok(transitionRate('buscar', 'idle') < transitionRate('idle', 'lanzar'), 'levantarse lleva más tiempo que entrar en un lanzamiento corto');
});

test('interrumpir, retomar y liberar el reloj dirigido no deja acciones pausadas ni afecta al fallback compartido', () => {
  const { actions, state, mixer } = fixture();
  preparePlayback(actions, state, { target: 'comer', action: 'comer', progress: .5 });
  preparePlayback(actions, state, { target: 'locomocion', action: 'comer', progress: .6 });
  mixer.update(.1);
  preparePlayback(actions, state, { target: 'comer', action: 'comer', progress: .7 });
  mixer.update(.1);
  assert.ok(Math.abs(actions.comer.time - 2.1) < 1e-10);
  preparePlayback(actions, state, { target: 'comer', action: 'comer' });
  mixer.update(.2);
  assert.ok(Math.abs(actions.comer.time - 2.3) < 1e-10, 'sin progreso retoma el reloj desde su última fase');
  preparePlayback(actions, state, { target: 'pedir', action: 'lanzar', progress: .8 });
  mixer.update(.1);
  assert.ok(Math.abs(actions.pedir.time - 2.4) < 1e-10);
  preparePlayback(actions, state, { target: 'pedir', action: 'pedir' });
  mixer.update(4);
  assert.equal(actions.pedir.loop, THREE.LoopRepeat);
  assert.equal(actions.pedir.paused, false);
  assert.equal(actions.pedir.time, 1, 'el clip compartido vuelve a su ciclo natural');
});

test('la cadera no baja de más a media mezcla y el mezclador recibe su base intacta', () => {
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.y = 1;
  const clip = (name, y) => new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack(`${hips.name}.position`, [0, 1], [0, y, 0, 0, y, 0])]);
  const action = c => ({ getClip: () => c, time: .5 });
  const blend = new HipBlend({ idle: action(clip('idle', 1)), walk: action(clip('walk', .2)), buscar: action(clip('buscar', .4)), sinCadera: action(new THREE.AnimationClip('sinCadera', 1, [])) }, hips);
  assert.deepEqual(blend.gestures.map(gesture => gesture.name), ['buscar'], 'la locomoción no se toca');

  hips.position.y = .7; // lo que deja el mezclador con la mitad del peso
  blend.apply({ idle: .5, buscar: .5 });
  assert.ok(Math.abs(hips.position.y - .85) < 1e-6, 'a media mezcla baja un cuarto del gesto, no la mitad');
  blend.restore();
  assert.ok(Math.abs(hips.position.y - .7) < 1e-6);
  blend.restore();
  assert.ok(Math.abs(hips.position.y - .7) < 1e-6, 'restaurar dos veces no pisa al mezclador');

  // Quieto en el gesto o de pie, la pose del clip manda.
  for (const weights of [{ idle: 1, buscar: 0 }, { idle: 0, buscar: 1 }]) {
    blend.apply(weights);
    assert.equal(blend.active, false);
  }
});
