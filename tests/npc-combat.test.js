import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Npc } from '../src/entities/Npc.js';
import { NpcCombat } from '../src/systems/NpcCombat.js';

function setup() {
  const phrases = [];
  const npc = { hp: 100, position: new Vector3(), root: { rotation: {} }, _direction: new Vector3(), _nextPosition: new Vector3(), isWalkable: () => true, groundHeight: () => 0, say: text => phrases.push(text) };
  const player = { position: new Vector3(0, 0, 1), stats: { salud: 100 } };
  return { npc, player, phrases, ai: new NpcCombat(npc) };
}
test('dos provocaciones no hacen daño y un segundo golpe activa jabs', () => {
  const { npc, player, phrases, ai } = setup();
  ai.entrarEnCombate(player, true);
  ai.update(.01);
  assert.equal(npc.assaultAction, 'provocar');
  ai.entrarEnCombate(player, true);
  ai.update(3.24); ai.update(3.24);
  assert.equal(phrases.length, 2);
  assert.equal(player.stats.salud, 100);
  ai.update(.01); ai.update(.31);
  assert.equal(npc.assaultAction, 'golpe_jab');
  ai.update(.31);
  assert.equal(player.stats.salud, 95);
  ai.update(.41);
  assert.notEqual(npc.assaultAction, 'pivotar');
  assert.notEqual(ai.state, 'pivotar');
  ai.dispose();
});
test('un único golpe deja al NPC advirtiendo sin atacar', () => {
  const { ai, player } = setup();
  ai.entrarEnCombate(player, true);
  ai.update(.01); ai.update(3.24); ai.update(3.24); ai.update(1);
  assert.equal(ai.state, 'advertido');
  assert.equal(player.stats.salud, 100);
  ai.dispose();
});

test('tras recuperarse del jab, el NPC vuelve a acercarse sin esquivar lateralmente', () => {
  const { npc, player, ai } = setup();
  ai.entrarEnCombate(player, true);
  ai.state = 'recuperar'; ai.timer = .01;
  const before = npc.position.clone();
  ai.update(.02);
  assert.equal(ai.state, 'acercarse');
  assert.notEqual(npc.assaultAction, 'pivotar');
  assert.ok(npc.position.equals(before));
  ai.dispose();
});

test('bloquear reduce el daño del jab y el NPC no pivota al recuperarse', () => {
  const { npc, player, ai } = setup();
  ai.entrarEnCombate(player, true);
  ai.state = 'golpear'; ai.timer = 0; player.isBlocking = true;
  ai.update(.01);
  assert.equal(player.stats.salud, 98);
  ai.update(.41);
  assert.notEqual(ai.state, 'pivotar');
  assert.notEqual(npc.assaultAction, 'pivotar');
  ai.dispose();
});

test('el NPC fuera de combate anima la caída aunque esté lejos y fuera de cámara', () => {
  const updates = [];
  const npc = Object.assign(Object.create(Npc.prototype), {
    hp: 0,
    maxHp: 100,
    position: new Vector3(),
    root: { visible: true, position: new Vector3() },
    healthBar: { visible: false, scale: { x: 0 } },
    reactionTimer: Infinity,
    assaultAction: 'fueraCombate',
    velocity: new Vector3(),
    splatTimer: 0,
    character: { update: (...args) => updates.push(args) },
    combatAI: { state: 'libre' },
    grabbed: false,
    animAcc: 0,
    frame: 0,
    animationBudget: 3,
    combatSpeed: 0,
    _updateDetail() {},
    _updateSpeech() {},
    _updateUmbrella() {},
    _walk: Npc.prototype._walk
  });
  npc.update(.016, {
    player: new Vector3(100, 0, 0),
    frustum: { intersectsSphere: () => false }
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].action, 'fueraCombate');
  assert.equal(updates[0][1].actionDuration, 0);
});
