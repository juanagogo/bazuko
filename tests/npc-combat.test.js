import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { NpcCombat } from '../src/systems/NpcCombat.js';

function setup() {
  const phrases = [];
  const npc = { hp: 100, position: new Vector3(), root: { rotation: {} }, _direction: new Vector3(), _nextPosition: new Vector3(), isWalkable: () => true, groundHeight: () => 0, say: text => phrases.push(text) };
  const player = { position: new Vector3(0, 0, 1), stats: { salud: 100 } };
  return { npc, player, phrases, ai: new NpcCombat(npc) };
}
test('dos provocaciones no hacen daño y un segundo golpe activa jabs y pivot', () => {
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
  assert.equal(npc.assaultAction, 'pivotar');
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

test('durante el pivot no se inicia un ataque ni se aplica daño', () => {
  const { npc, player, ai } = setup();
  ai.entrarEnCombate(player, true);
  ai.state = 'pivotar'; ai.timer = .97; npc.assaultAction = 'pivotar';
  ai.update(.3);
  assert.equal(npc.assaultAction, 'pivotar');
  assert.equal(player.stats.salud, 100);
  assert.equal(ai.intentarEsquiva(), false);
  ai.dispose();
});

test('bloquear reduce el daño del jab y pivotar mueve al NPC', () => {
  const { npc, player, ai } = setup();
  ai.entrarEnCombate(player, true);
  ai.state = 'golpear'; ai.timer = 0; player.isBlocking = true;
  ai.update(.01);
  assert.equal(player.stats.salud, 98);
  ai.update(.41);
  const before = npc.position.clone();
  ai.update(.1);
  assert.ok(npc.position.distanceTo(before) > 0);
  ai.dispose();
});
