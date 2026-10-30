// tests/steal.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { StealSystem, CONFIG } from '../src/features/steal.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('StealSystem detecta al NPC cercano y permite iniciar cosquilleo o robo directo', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: 0.3 };
  const game = {
    player: { position: new THREE.Vector3(0, 0, 0) },
    world: { active: { npcs: [npc] } },
    input: { consumePress: (code) => code === 'KeyE' },
    interaction: {},
    paused: false
  };

  const steal = new StealSystem(game);
  steal.update(0.1);

  assert.equal(steal.minigameActive, true);
  assert.equal(steal.targetNpc, npc);
});

test('Cosquilleo exitoso dentro de la zona verde otorga botín y activa cooldown', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: 0.2 };
  const game = {
    player: { position: new THREE.Vector3(0, 0, 0) },
    stats: { dinero: 1000 },
    inventory: { add: () => true },
    world: { active: { npcs: [npc] } },
    input: { consumePress: () => false },
    interaction: {}
  };

  const steal = new StealSystem(game);
  steal.startCosquilleo(npc);
  steal.markerPos = steal.zoneStart + (steal.zoneSize / 2);
  steal._endMinigame(true, 'play');

  assert.equal(steal.minigameActive, false);
  assert.ok(game.stats.dinero > 1000);
  assert.equal(steal.cooldown, CONFIG.globalCooldown);
  assert.equal(npc._robadoTimer, CONFIG.npcCooldown);
});

test('Robo directo otorga botín mayor, sube buscado y daña al jugador si el NPC es fuerte', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, look: { real: { edad: 'adulto' } } };
  let splatted = false;
  npc.hitByPoop = () => { splatted = true; };

  const game = {
    player: { position: new THREE.Vector3(0, 0, 0) },
    stats: { dinero: 500, salud: 100 },
    inventory: { add: () => true },
    world: { active: { npcs: [npc] } },
    input: { consumePress: () => false },
    interaction: {}
  };

  const steal = new StealSystem(game);
  steal.executeRoboDirecto(npc);

  assert.ok(game.stats.dinero >= 500 + CONFIG.lootMoneyDirect[0]);
  assert.equal(steal.buscado, 1);
  assert.equal(splatted, true);
  assert.ok(game.stats.salud < 100);
  assert.equal(steal.cooldown, CONFIG.globalCooldown);
});

test('Un robo detectado con testigos puede causar agresión colectiva y caída', () => {
  const victim = { position: new THREE.Vector3(1, 0, 0), _robadoTimer: 0 };
  const witness = { position: new THREE.Vector3(2, 0, 0), _robadoTimer: 0 };
  let impact = null;
  const game = {
    player: {
      position: new THREE.Vector3(0, 0, 0),
      receiveVehicleImpact: (direction, speed) => { impact = { direction, speed }; }
    },
    stats: { salud: 100, higiene: 100 },
    world: { active: { npcs: [victim, witness] } }
  };
  const steal = new StealSystem(game);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(steal._triggerCrowdConsequence(victim, 'robo directo'), true);
    steal._updateAssaultScene(6);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(game.stats.salud, 100 - 2 * CONFIG.crowdDamagePerAttacker);
  assert.ok(game.stats.higiene < 100);
  assert.ok(impact?.speed > 0);
});
