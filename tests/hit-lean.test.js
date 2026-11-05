import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { HitLean, HIT_LEAN } from '../src/character/HitLean.js';
import { Player } from '../src/entities/Player.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function peak(lean, key, frames = 30) {
  let extreme = 0;
  for (let i = 0; i < frames; i++) { lean.update(1 / 60); if (Math.abs(lean[key]) > Math.abs(extreme)) extreme = lean[key]; }
  return extreme;
}

test('un empujón desde atrás dobla el cuerpo hacia adelante y uno de frente hacia atrás', () => {
  const back = new HitLean(); back.kick({ x: 0, z: 1 }, 0, 1);
  assert.ok(peak(back, 'pitch') > .05);
  const front = new HitLean(); front.kick({ x: 0, z: -1 }, 0, 1);
  assert.ok(peak(front, 'pitch') < -.05);
});

test('un empujón de lado lo inclina hacia ese lado según hacia dónde mira', () => {
  // Mirando a +Z, el empujón a +X va hacia su +X local: rotation.z negativa.
  const a = new HitLean(); a.kick({ x: 1, z: 0 }, 0, 1);
  assert.ok(peak(a, 'roll') < -.05);
  // Mirando a +X (yaw π/2), el mismo empujón le llega por la espalda.
  const b = new HitLean(); b.kick({ x: 1, z: 0 }, Math.PI / 2, 1);
  assert.ok(peak(b, 'pitch') > .05);
});

test('se inclina sin pasar del tope y vuelve al reposo en menos de un segundo', () => {
  const lean = new HitLean();
  lean.kick({ x: 0, z: 1 }, 0, 5);
  const top = peak(lean, 'pitch', 60);
  assert.ok(top <= HIT_LEAN.max + 1e-9);
  for (let i = 0; i < 60; i++) lean.update(1 / 60);
  assert.equal(lean.active, false);
});

test('quitar y volver a sumar cada cuadro no acumula la inclinación', () => {
  const lean = new HitLean(), body = new THREE.Object3D();
  lean.kick({ x: 0, z: 1 }, 0, 1);
  for (let i = 0; i < 120; i++) { lean.remove(body); lean.update(1 / 60); lean.apply(body); }
  assert.ok(Math.abs(body.rotation.x) < 1e-9 && Math.abs(body.rotation.z) < 1e-9);
});

function player() {
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false, isDown: () => false };
  const p = new Player(new THREE.Scene(), input, { dinero: 0, energia: 100, salud: 100 }, {});
  p.position.set(0, 0, 0); p.root.rotation.y = 0;
  return p;
}

test('un golpe leve ya no ladea el cuerpo de golpe: cede poco a poco hacia donde lo empujan', () => {
  const p = player();
  p.receiveHit(new THREE.Vector3(1, 0, 0), 2.2, { salud: 90 });
  assert.equal(p.root.rotation.z, 0, 'sin salto en el mismo cuadro');
  assert.equal(p.action, 'reaccion_cabeza');
  let extreme = 0;
  for (let i = 0; i < 12; i++) { p.update(1 / 60, null, null, () => 0); extreme = Math.min(extreme, p.root.rotation.z); }
  assert.ok(extreme < -.05, `se inclinó ${extreme.toFixed(3)} hacia el empujón`);
  for (let i = 0; i < 90; i++) p.update(1 / 60, null, null, () => 0);
  assert.ok(Math.abs(p.root.rotation.z) < .01 && Math.abs(p.root.rotation.x) < .03, 'se endereza');
});

test('el golpe que tumba sigue acostándolo de lado', () => {
  const p = player();
  p.receiveVehicleImpact(new THREE.Vector3(1, 0, 0), 2);
  if (p.ragdoll?.active) return; // sin colisiones la caída articulada decide
  assert.equal(p._impactHeavy, true);
  p.update(1 / 60, null, null, () => 0);
  assert.ok(p.root.rotation.z > .5);
});
