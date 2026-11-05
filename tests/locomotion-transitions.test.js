import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function player() {
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false, isDown: () => false };
  const p = new Player(new THREE.Scene(), input, { dinero: 0, energia: 100, salud: 100 }, {});
  p.position.set(0, 0, 0); p.root.rotation.y = 0;
  return { p, input };
}

/** Segundos hasta quedar quieto después de soltar, y la inclinación mínima en ese lapso. */
function stopAfter(running) {
  const { p, input } = player();
  input.axis = { x: 0, z: -1 }; input.isRunning = running;
  for (let i = 0; i < 90; i++) p.update(1 / 60, null, null, () => 0);
  input.axis = { x: 0, z: 0 }; input.isRunning = false;
  let t = 0, lean = 0;
  while (p.velocity.lengthSq() > 0 && t < 3) { p.update(1 / 60, null, null, () => 0); t += 1 / 60; lean = Math.min(lean, p.root.rotation.x); }
  return { t, lean };
}

test('frenar a la carrera tarda más que al caminar y echa el cuerpo atrás', () => {
  const walk = stopAfter(false), run = stopAfter(true);
  assert.ok(walk.t > .15 && walk.t < .6, `caminando frena en ${walk.t.toFixed(2)} s`);
  assert.ok(run.t > walk.t, `corriendo frena en ${run.t.toFixed(2)} s`);
  assert.ok(run.t < 1.1, 'sin patinar de más');
  assert.ok(run.lean < -.02, `se echa atrás ${run.lean.toFixed(3)}`);
  assert.ok(walk.lean > -.01, 'caminando no se echa atrás');
});

test('arrancar desde quieto acelera en menos de medio segundo', () => {
  const { p, input } = player();
  input.axis = { x: 0, z: -1 };
  let t = 0;
  while (p.velocity.length() < p.speedWalk * .9 && t < 2) { p.update(1 / 60, null, null, () => 0); t += 1 / 60; }
  assert.ok(t > .08 && t < .5, `alcanzó el paso en ${t.toFixed(2)} s`);
});
