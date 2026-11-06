// tests/radio-held.test.js
// La radio de mano: una sola malla que sale con la radio prendida y se guarda al apagarla.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Player } from '../src/entities/Player.js';
import { createCharacter } from '../src/character/character.js';
import { attachHeldRadio, createHeldRadio } from '../src/character/props.js';

const buscar = (root) => { let mesh; root.traverse((o) => { if (o.name === 'prop-radio') mesh = o; }); return mesh; };

test('La radio de mano es una sola malla con material y geometría compartidos', () => {
  const radio = createHeldRadio();
  assert.ok(radio.isMesh);
  assert.equal(radio.name, 'prop-radio');
  assert.equal(radio.material.userData.shared, true, 'el material es de todos');
  assert.equal(radio.frustumCulled, false, 'no se descarta con el jugador en cámara');
  assert.equal(createHeldRadio().geometry, radio.geometry, 'la geometría se comparte');
});

test('El modelo liviano saca la radio con la energía y la guarda al apagarla', () => {
  const character = createCharacter();
  assert.equal(buscar(character.group), undefined, 'apagada no hay malla');
  character.setHeldRadio(true);
  assert.equal(buscar(character.group).visible, true, 'prendida aparece en la mano');
  character.update(.1, { speed: 2, movement: { grounded: true } });
  assert.equal(buscar(character.group).visible, true, 'sigue en la mano caminando');
  character.setHeldRadio(false);
  assert.equal(buscar(character.group).visible, false, 'apagada se guarda');
  character.dispose();
});

test('El jugador saca la radio cuando está prendida y la guarda al apagarla', () => {
  const player = new Player(new THREE.Scene(), { axis: { x: 0, z: 1 }, isRunning: false });
  player.game = { radio: { isOn: false } };
  player._syncHeldRadio();
  assert.equal(buscar(player.procedural.group), undefined);

  player.game.radio.isOn = true;
  player._syncHeldRadio();
  assert.equal(buscar(player.procedural.group).visible, true);

  player.game.radio.isOn = false;
  player._syncHeldRadio();
  assert.equal(buscar(player.procedural.group).visible, false);
});

test('La radio cuelga de la mano izquierda del esqueleto', () => {
  const root = new THREE.Group();
  const hand = new THREE.Group();
  hand.name = 'mixamorigLeftHand';
  root.add(hand);
  const mesh = attachHeldRadio(root, new Map([['mixamorigLeftHand', hand]]));
  assert.ok(mesh);
  assert.equal(mesh.parent, hand, 'sigue la animación del hueso');
});

test('Sin el hueso de la mano izquierda no hay radio', () => {
  assert.equal(attachHeldRadio(new THREE.Group(), new Map()), null);
});
