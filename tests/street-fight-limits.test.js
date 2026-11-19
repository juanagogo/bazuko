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

test('cada puño cuesta 4 y cada golpe con arma cuesta 8, también al fallar y encadenar', () => {
  for (const [weapon, cost] of [['punos', 4], ['cuchillo', 8], ['botella_picada', 8], ['arma', 8]]) {
    const stats = { dinero: 0, energia: 50, salud: 100 };
    const { player, tick } = arena(stats);
    player.equipWeapon(weapon);
    assert.equal(player.punch(), true);
    assert.equal(stats.energia, 50 - cost);
    assert.equal(player.punch(), true);
    assert.equal(stats.energia, 50 - 2 * cost);
    assert.equal(player.punch(), false, 'solo se encola un golpe a la vez');
    tick(120, 1 / 60, []);
    assert.equal(stats.energia, 50 - 2 * cost, 'el fallo paga una sola vez');
  }
});

test('exhausto no se puede pelear y avisa', () => {
  const stats = { dinero: 0, energia: 3, salud: 100 };
  const { player } = arena(stats);
  let toast = null;
  window.addEventListener('toast', (e) => { toast = e.detail; });
  player.punch();
  assert.equal(player.attack, null);
  assert.equal(stats.energia, 3);
  assert.match(toast?.text ?? '', /No doy más/);
  stats.energia = 4;
  assert.equal(player.punch(), true);
  assert.equal(stats.energia, 0);
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

test('el civil decidido a defenderse con los puños contraataca una sola vez', () => {
  const scene = new THREE.Scene();
  const npc = new Npc(scene, new THREE.Vector3(0, 0, 1), { look: { real: { edad: 'adulto' } }, defenseResolve: 1, carriesKnife: false });
  const attacker = { position: new THREE.Vector3(), stats: { salud: 100 }, audio: {} };
  npc.takeHit({ damage: 1, attacker, knockback: 0 });
  assert.equal(attacker.stats.salud, 100, 'hay reacción y anticipación antes de defenderse');
  for (let i = 0; i < 30; i++) npc.update(.05, { player: attacker.position });
  assert.ok(attacker.stats.salud <= 90 && attacker.stats.salud >= 84, 'contraataque de 10 a 16');
  const after = attacker.stats.salud;
  npc.takeHit({ damage: 1, attacker });
  assert.equal(attacker.stats.salud, after, 'ya soltó el botín: no vuelve a contraatacar');
});
