import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function jugador(extra = {}) {
  return Object.assign(Object.create(Player.prototype), {
    input: { axis: { x: 0, z: -1 }, isRunning: true },
    position: new THREE.Vector3(),
    root: new THREE.Group(),
    _direction: new THREE.Vector3(),
    _forward: new THREE.Vector3(),
    _right: new THREE.Vector3(),
    _delta: new THREE.Vector3(),
    _before: new THREE.Vector3(),
    speedWalk: 3, speedRun: 6, radius: 0.4, time: 0, actionTimer: 0, modelScale: 1,
    character: { update(_, o) { this.last = o; } },
    zorraMult: 1, canRun: true,
    ...extra
  });
}

function interaccion(targets) {
  const stats = { energia: 100, salud: 100, addXP() {} };
  const disease = { tryInfect() {} };
  const talents = { getEffect: (_k, fallback) => fallback };
  const player = { position: new THREE.Vector3() };
  const sys = new InteractionSystem(player, new InventorySystem(), stats, null, disease, talents, null);
  sys.targets = targets;
  return sys;
}

const entradaE = () => ({ isDown: () => false, consumePress: (c) => c === 'KeyE' });

test('empujando, Shift no hace correr y la velocidad se multiplica por 0,7', () => {
  const p = jugador({ zorraMult: 0.7, canRun: false });
  p.update(1, null, null);
  assert.ok(Math.abs(p.position.length() - 2.1) < 1e-6);
  assert.equal(p.state, 'walk');
  assert.equal(p.character.last.running, false);
});

test('con zorraMult 0 el jugador no se mueve', () => {
  const p = jugador({ zorraMult: 0, canRun: false });
  p.update(1, null, null);
  assert.equal(p.position.length(), 0);
  assert.equal(p.state, 'idle');
});

test('los objetivos no interactuables se ignoran; la zorra es el objetivo más cercano pero no responde a E', () => {
  const lejos = { harvest() {}, position: new THREE.Vector3(1.5, 0, 0) };
  const oculto = { kind: 'reciclador', interactable: false, position: new THREE.Vector3(0.2, 0, 0) };
  let usos = 0;
  const zorra = { kind: 'zorra', interactable: true, prompt: '[G] Agarrar zorra', position: new THREE.Vector3(0.5, 0, 0), interactuar: () => usos++ };
  const sys = interaccion([lejos, oculto, zorra]);
  sys.update(0.016, entradaE(), { isNight: false });
  assert.equal(sys.currentTargetType, 'zorra');
  assert.equal(sys.currentTarget, zorra);
  assert.equal(usos, 0);
});

test('el reciclador sigue respondiendo a E', () => {
  let usos = 0;
  const rec = { kind: 'reciclador', interactable: true, position: new THREE.Vector3(0.5, 0, 0), interactuar: () => usos++ };
  const sys = interaccion([rec]);
  sys.update(0.016, entradaE(), { isNight: false });
  assert.equal(usos, 1);
});

test('empujando no se roban carros; con la zorra en el suelo sí', () => {
  let robos = 0, toast = null;
  window.addEventListener('toast', (e) => { toast = e.detail.text; });
  const carro = { steal: () => { robos++; return null; }, position: new THREE.Vector3(0.5, 0, 0) };
  const sys = interaccion([carro]);
  sys.zorra = { empujando: true };
  sys.update(0.016, entradaE(), { isNight: false });
  assert.equal(robos, 0);
  assert.equal(toast, 'Suelta la zorra primero');
  sys.zorra = { empujando: false };
  sys.update(0.016, entradaE(), { isNight: false });
  assert.equal(robos, 1);
});
