// tests/steal-player-speed.test.js
// Con la mano en un bolsillo ajeno el jugador anda a ×0,6: se mide en Player.update de verdad, con la misma entrada.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { ROBO_ODDS } from '../src/features/stealOdds.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { className: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, remove() {} }; },
    body: { appendChild() {}, classList: { toggle() {} } }
  };
});

function andar(stealPose, { running = false } = {}) {
  const input = { axis: { x: 1, z: 0 }, isRunning: running, consumePress() { return false; }, isDown() { return false; } };
  const player = new Player(new THREE.Scene(), input);
  player.stealPose = stealPose;
  const start = player.position.clone();
  for (let i = 0; i < 120; i++) player.update(1 / 60, null, null);
  return player.position.distanceTo(start);
}

test('con la mano en el bolsillo ajeno el jugador anda a ×0,6', () => {
  const libre = andar(null);
  const conLaMano = andar({ fase: 'meter', t: .5, lado: 1, velocidad: ROBO_ODDS.velocidadConLaMano });
  assert.ok(libre > .5, `anda: ${libre}`);
  const ratio = conLaMano / libre;
  assert.ok(Math.abs(ratio - .6) < .05, `×${ratio.toFixed(3)}`);
  // Cualquier otra fase (sacar, disimular) ya no frena.
  assert.ok(Math.abs(andar({ fase: 'sacar', t: .1, lado: 1, velocidad: 1 }) / libre - 1) < .01);
});
