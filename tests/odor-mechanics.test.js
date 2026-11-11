// tests/odor-mechanics.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('StatsSystem calcula el medidor de olor inversamente a la higiene', () => {
  const stats = new StatsSystem();
  stats.higiene = 100;
  assert.equal(stats.olor, 0);
  assert.equal(stats.tieneMalOlor(), false);
  assert.equal(stats.olorNivel, 'limpio');

  stats.higiene = 50;
  assert.equal(stats.olor, 50);
  assert.equal(stats.tieneMalOlor(), false);
  assert.equal(stats.olorNivel, 'normal');

  stats.higiene = 25;
  assert.equal(stats.olor, 75);
  assert.equal(stats.tieneMalOlor(), true, 'Con higiene < 30 u olor >= 70 tiene mal olor');
  assert.equal(stats.olorNivel, 'fuerte');

  stats.higiene = 10;
  assert.equal(stats.olor, 90);
  assert.equal(stats.tieneMalOlor(), true);
  assert.equal(stats.olorNivel, 'critico');
});

test('Con mal olor, los NPCs no dan limosna y huyen del jugador', () => {
  const player = { position: new THREE.Vector3(0, 0, 0) };
  const stats = new StatsSystem();
  stats.higiene = 15; // ¡Mal olor!
  stats.energia = 50;
  stats.dinero = 0;

  const npc1 = {
    position: new THREE.Vector3(1.5, 0, 1.5),
    fleeTimer: 0,
    _fleeFrom(pos) {
      this.fleeTimer = 4.0;
      this.fledFrom = pos;
    },
    say() {}
  };
  const npc2 = {
    position: new THREE.Vector3(-1.0, 0, 0.5),
    fleeTimer: 0,
    _fleeFrom(pos) {
      this.fleeTimer = 4.0;
      this.fledFrom = pos;
    },
    say() {}
  };

  const interaction = new InteractionSystem(
    player,
    { add: () => true },
    stats,
    { play: () => {} },
    null,
    { getEffect: (_k, b) => b },
    null
  );
  interaction.setPedestrians([npc1, npc2]);

  let begResult = null;
  window.addEventListener('beg-result', (e) => {
    begResult = e.detail;
  });

  // Intentar pedir limosna
  interaction._beg();

  assert.equal(begResult?.success, false);
  assert.equal(begResult?.reason, 'higiene');
  assert.match(begResult?.message, /olor/);
  assert.equal(stats.dinero, 0, 'No recibió ni un peso');
  assert.ok(npc1.fleeTimer > 0, 'El NPC 1 corrió por el mal olor');
  assert.ok(npc2.fleeTimer > 0, 'El NPC 2 corrió por el mal olor');
});
