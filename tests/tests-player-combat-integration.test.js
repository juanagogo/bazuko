import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function arena() {
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false };
  const stats = { dinero: 0, energia: 100, salud: 100 };
  const audio = { hits: 0, swings: 0, playWhoosh() { this.swings++; }, playPunchHit() { this.hits++; } };
  const player = new Player(new THREE.Scene(), input, stats, audio);
  player.position.set(0, 0, 0);
  player.root.rotation.y = 0;
  player.game = { steal: { buscado: 0 } };
  return { player, input, stats, audio };
}

function target(x = 0, y = 0, z = 1) {
  return {
    position: new THREE.Vector3(x, y, z), hits: [],
    takeHit(hit) { this.hits.push(hit); return this.hits.length === 1 ? 300 : 0; }
  };
}

test('los tres golpes del combo tienen IDs distintos, consumen energía y cobran una sola recompensa', () => {
  const { player, stats, audio } = arena(), npc = target();
  assert.equal(player.punch(), true);
  assert.equal(player.punch(), true, 'se encola el segundo');
  assert.equal(player.punch(), false, 'no se encolan dos pulsaciones');
  let queuedThird = false, fights = 0;
  window.addEventListener('street-fight', () => fights++);
  for (let i = 0; i < 150; i++) {
    if (player.attack?.step === 1 && !queuedThird) { assert.equal(player.punch(), true); queuedThird = true; }
    player.update(.01, null, null, () => 0, [npc]);
  }
  assert.deepEqual(npc.hits.map(hit => hit.damage), [12, 12, 18]);
  assert.equal(new Set(npc.hits.map(hit => hit.attackId)).size, 3);
  assert.equal(stats.energia, 76);
  assert.equal(stats.dinero, 300);
  assert.equal(audio.hits, 3);
  assert.equal(fights, 3);
  assert.equal(player.game.steal.buscado, 3);
  assert.equal(player.attack, null);
});

test('un arma alcanza varios objetivos una vez, con altura y paredes comprobadas para cada uno', () => {
  const { player, stats, audio } = arena();
  player.equipWeapon('cuchillo');
  const a = target(), b = target(.3, 0, 1.1), upper = target(0, 7.82, 1), hidden = target(-1, 0, 1);
  const ko = target(0, 0, .5); ko.isKnockedOut = true;
  const collisions = new CollisionSystem();
  collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-.7, 0, .4), new THREE.Vector3(-.3, 2, .7)) });
  assert.equal(player.punch(), true);
  player.update(.1, null, collisions, () => 0, [a, a, b, upper, hidden, ko]);
  assert.deepEqual([a, b, upper, hidden, ko].map(npc => npc.hits.length), [1, 1, 0, 0, 0]);
  assert.equal(stats.dinero, 600);
  assert.equal(audio.hits, 1, 'un sonido por golpe aunque alcance a dos');
  assert.equal(player.game.steal.buscado, 1);
});

test('los impactos rechazados no producen botín, audio ni búsqueda', () => {
  const { player, stats, audio } = arena(), npc = target();
  npc.takeHit = () => false;
  let fights = 0;
  window.addEventListener('street-fight', () => fights++);
  player.punch(); player.update(.13, null, null, () => 0, [npc]);
  assert.equal(stats.dinero, 0); assert.equal(audio.hits, 0);
  assert.equal(player.game.steal.buscado, 0); assert.equal(fights, 0);
});

test('un ataque de teclado muestra anticipación aun cuando el frame supera el windup del cuchillo', () => {
  const { player, input } = arena(), npc = target();
  player.equipWeapon('cuchillo');
  let pressed = true;
  input.consumePress = key => {
    if (key !== 'KeyG' || !pressed) return false;
    pressed = false; return true;
  };
  player.update(.1, null, null, () => 0, [npc]);
  assert.equal(player.attack.phase, 'windup');
  assert.equal(player.attack.progress, 0);
  assert.equal(npc.hits.length, 0);
  player.update(.1, null, null, () => 0, [npc]);
  assert.equal(npc.hits.length, 1);
});

test('otra acción cancela el ataque pendiente y no entrega daño al despertar', () => {
  const { player } = arena(), npc = target();
  player.punch(); player.punch();
  player.playAction('dormir', 5);
  player.update(.1, null, null, () => 0, [npc]);
  assert.equal(player.attack, null);
  assert.equal(player._attackQueued, false);
  assert.equal(npc.hits.length, 0);
  assert.equal(player.punch(), false);
});

test('cambiar arma cancela el golpe y la cola sin saltarse la recuperación', () => {
  const { player, stats } = arena(), npc = target();
  player.punch(); player.punch();
  player.update(.05, null, null, () => 0, [npc]);
  player.equipWeapon('cuchillo');
  assert.equal(player.attack, null); assert.equal(player.action, null);
  assert.equal(player.punch(), false);
  assert.equal(stats.energia, 84, 'un intento bloqueado no consume más energía');
  player.update(.8, null, null, () => 0, [npc]);
  assert.equal(npc.hits.length, 0);
  assert.equal(player.punch(), true);
  assert.equal(player.attack.weapon, 'cuchillo');
  assert.equal(player.attack.step, 0);
});

test('entrar al agua antes del contacto cancela ataque, pipa y cigarrillo', () => {
  const { player } = arena(), npc = target(0, -.9, 1);
  assert.equal(player.startSmoking(), true);
  player.punch();
  player.position.y = -.9;
  const water = () => ({ surfaceY: 0, bottomY: -3, depth: 3 });
  player.update(.13, null, null, () => -3, [npc], water);
  assert.equal(player.isSwimming, true);
  assert.equal(player.attack, null); assert.equal(npc.hits.length, 0);
  assert.equal(player.smoking, null);
  assert.equal(player.punch(), false); assert.equal(player.startBasuco(), false);

  const other = arena().player;
  assert.equal(other.startBasuco(), true);
  other.position.y = -.9;
  other.update(.13, null, null, () => -3, [], water);
  assert.equal(other.basuco, null); assert.equal(other.action, null);
});

test('salir de un borde o recibir un golpe cancela antes del contacto', () => {
  const { player } = arena(), npc = target();
  player.punch();
  player.update(.13, null, null, () => -4, [npc]);
  assert.equal(player.isGrounded, false); assert.equal(player.attack, null);
  assert.equal(npc.hits.length, 0);
  const other = arena().player;
  other.punch(); other.receiveHit(new THREE.Vector3(1, 0, 0), 0);
  other.update(.13, null, null, () => 0, [npc]);
  assert.equal(other.attack, null); assert.equal(npc.hits.length, 0);
});

test('el contacto usa la orientación y posición actual después del movimiento', () => {
  const { player, input } = arena(), behind = target(0, 0, 1), ahead = target(1, 0, 0);
  player.hasInertia = false;
  player.punch(); input.axis.x = 1;
  player.update(.13, null, null, () => 0, [behind, ahead]);
  assert.equal(behind.hits.length, 0);
  assert.equal(ahead.hits.length, 1);
});

test('un stick parcial conserva magnitud y el teclado diagonal no aumenta la velocidad', () => {
  const step = (x, z) => {
    const { player, input } = arena(); player.hasInertia = false;
    input.axis = { x, z }; player.update(.1, null, null, () => 0);
    return player.position.length();
  };
  assert.ok(Math.abs(step(.25, 0) / step(1, 0) - .25) < 1e-8);
  assert.ok(Math.abs(step(1, 1) / step(1, 0) - 1) < 1e-8);
});
