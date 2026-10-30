import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { Npc } from '../src/entities/Npc.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { className: '', textContent: '', style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
});

function arena(stats) {
  const scene = new THREE.Scene();
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress() { return false; }, isDown() { return false; } };
  const audio = { playWhoosh() {}, playPunchHit() {} };
  const player = new Player(scene, input, stats, audio);
  player.position.set(10, 0, 10);
  player.root.rotation.y = 0; // mira a +Z
  const tick = (n, dt, npcs) => { for (let i = 0; i < n; i++) player.update(dt, null, null, null, npcs); };
  return { scene, player, tick };
}

test('cada golpe cuesta 8 de energía, también los del combo', () => {
  const stats = { dinero: 0, energia: 50, salud: 100 };
  const { player } = arena(stats);
  player.punch();
  assert.ok(player.attack, 'arranca el golpe');
  assert.equal(stats.energia, 42);
  player.punch();
  assert.equal(stats.energia, 34, 'el golpe encadenado también cuesta');
  player.punch();
  assert.equal(stats.energia, 34, 'solo se encola un golpe a la vez');
});

test('exhausto no se puede pelear y avisa', () => {
  const stats = { dinero: 0, energia: 4, salud: 100 };
  const { player } = arena(stats);
  let toast = null;
  window.addEventListener('toast', (e) => { toast = e.detail; });
  player.punch();
  assert.equal(player.attack, null);
  assert.equal(stats.energia, 4);
  assert.match(toast?.text ?? '', /exhausto/);
});

test('golpear a un peatón sube el nivel de búsqueda y avisa de la pelea', () => {
  const stats = { dinero: 0, energia: 100, salud: 100 };
  const { scene, player, tick } = arena(stats);
  player.game = { steal: { buscado: 0 } };
  const npc = new Npc(scene, new THREE.Vector3(10, 0, 11), { look: {} });
  let fights = 0;
  window.addEventListener('street-fight', () => fights++);
  player.punch();
  tick(30, 1 / 60, [npc]);
  assert.equal(fights, 1);
  assert.equal(player.game.steal.buscado, 1);
});

test('un adulto se defiende la primera vez que lo golpean, y solo esa vez', () => {
  const scene = new THREE.Scene();
  const npc = new Npc(scene, new THREE.Vector3(0, 0, 1), { look: { real: { edad: 'adulto' } } });
  const attacker = { position: new THREE.Vector3(), stats: { salud: 100 }, audio: {} };
  npc.takeHit({ damage: 1, attacker });
  assert.ok(attacker.stats.salud <= 90 && attacker.stats.salud >= 84, 'contraataque de 10 a 16');
  const after = attacker.stats.salud;
  npc.takeHit({ damage: 1, attacker });
  assert.equal(attacker.stats.salud, after, 'ya soltó el botín: no vuelve a contraatacar');
});
