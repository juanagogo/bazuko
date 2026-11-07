import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { ShuffleBag, sameSex, takeVariation, voicePan } from '../src/systems/voiceVariety.js';

test('la bolsa barajada no repite hasta agotar y no abre la ronda con la última', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bag = new ShuffleBag(random), items = ['a', 'b', 'c', 'd'];
  let last = null;
  for (let round = 0; round < 50; round++) {
    const seen = new Set();
    for (let i = 0; i < items.length; i++) {
      const item = bag.draw(items);
      assert.notEqual(item, last, 'nunca la misma dos veces seguidas');
      seen.add(item); last = item;
    }
    assert.equal(seen.size, items.length, 'cada ronda dice todas una vez');
  }
  assert.equal(bag.draw([]), null);
  assert.equal(new ShuffleBag().draw(['sola']), 'sola');
});

test('la bolsa aguanta que la lista cambie entre una frase y otra', () => {
  const bag = new ShuffleBag(() => 0);
  assert.equal(bag.draw(['a', 'b', 'c']), 'a');
  assert.equal(bag.draw(['a', 'b']), 'b');
  assert.equal(bag.draw(['a', 'b']), 'a', 'agotadas las de ahora, empieza otra ronda sin la última');
});

test('cada toma varía poco: tono ±4 % y volumen ±1 dB, y con azar 0,5 sale tal cual', () => {
  assert.deepEqual(takeVariation(() => .5), { rate: 1, gain: 1 });
  for (const r of [0, 1]) {
    const { rate, gain } = takeVariation(() => r);
    assert.ok(rate >= .96 - 1e-9 && rate <= 1.04 + 1e-9);
    assert.ok(Math.abs(20 * Math.log10(gain)) <= 1 + 1e-9);
  }
});

test('el sexo se respeta y lo no marcado es voz de hombre', () => {
  assert.equal(sameSex({}, 'hombre'), true);
  assert.equal(sameSex({}, 'mujer'), false);
  assert.equal(sameSex({ gender: 'mujer' }, 'mujer'), true);
  assert.equal(sameSex({ gender: 'mujer' }, 'hombre'), false);
  assert.equal(sameSex({ gender: 'mujer' }, undefined), true, 'sin sexo conocido no se filtra');
});

test('el paneo es leve y sigue a la cámara: a la derecha positivo, de frente centrado', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const listener = new THREE.Vector3();
  assert.ok(Math.abs(voicePan(listener, camera, new THREE.Vector3(0, 0, -8))) < 1e-6);
  const right = voicePan(listener, camera, new THREE.Vector3(8, 0, 0));
  assert.ok(right > .3 && right <= .35, `derecha: ${right}`);
  assert.ok(voicePan(listener, camera, new THREE.Vector3(-8, 0, 0)) < -.3);
  assert.ok(Math.abs(voicePan(listener, camera, new THREE.Vector3(.2, 0, 0))) < 1e-6, 'pegado, en el centro');
  assert.equal(voicePan(listener, null, new THREE.Vector3(8, 0, 0)), 0);
  // Al girar la cámara media vuelta, la misma persona queda al otro lado.
  camera.position.set(0, 2, -5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  assert.ok(voicePan(listener, camera, new THREE.Vector3(8, 0, 0)) < -.3);
});
