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

test('StealSystem da prioridad a InteractionSystem si currentTarget o isHoldingQ estan activos', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: 0.3 };
  let consumedKey = null;
  const game = {
    player: { position: new THREE.Vector3(0, 0, 0) },
    world: { active: { npcs: [npc] } },
    input: {
      consumePress: (code) => {
        consumedKey = code;
        return true;
      }
    },
    interaction: { currentTarget: { type: 'trash' }, isHoldingQ: false },
    paused: false
  };

  const steal = new StealSystem(game);
  steal.update(0.1);

  assert.equal(steal.targetNpc, null);
  assert.equal(steal.minigameActive, false);
  assert.equal(consumedKey, null);

  // Probar cuando isHoldingQ esta activo clasificando basura
  game.interaction.currentTarget = null;
  game.interaction.isHoldingQ = true;
  steal.update(0.1);

  assert.equal(steal.targetNpc, null);
  assert.equal(steal.minigameActive, false);
  assert.equal(consumedKey, null);
});

test('Cosquilleo congela al jugador y lo descongela al finalizar', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: 0.2 };
  const game = {
    player: { position: new THREE.Vector3(0, 0, 0), frozen: false },
    stats: { dinero: 1000 },
    inventory: { add: () => true },
    world: { active: { npcs: [npc] } },
    input: { consumePress: () => false },
    interaction: {}
  };

  const steal = new StealSystem(game);
  steal.startCosquilleo(npc);

  assert.equal(steal.minigameActive, true);
  assert.equal(game.player.frozen, true);

  steal.markerPos = steal.zoneStart + (steal.zoneSize / 2);
  steal._endMinigame(true, 'play');

  assert.equal(steal.minigameActive, false);
  assert.equal(game.player.frozen, false);
});

test('Escape cancela el minijuego de cosquilleo sin penalizaciones ni alerta al peaton', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: 0.2 };
  let hitCalled = false;
  npc.hitByPoop = () => { hitCalled = true; };

  const game = {
    player: { position: new THREE.Vector3(0, 0, 0), frozen: false },
    stats: { dinero: 1000 },
    inventory: { add: () => true },
    world: { active: { npcs: [npc] } },
    input: { consumePress: (code) => code === 'Escape' },
    interaction: {}
  };

  const steal = new StealSystem(game);
  steal.startCosquilleo(npc);
  assert.equal(game.player.frozen, true);

  steal._updateMinigame(0.016);

  assert.equal(steal.minigameActive, false);
  assert.equal(game.player.frozen, false);
  assert.equal(hitCalled, false);
  assert.equal(steal.cooldown, 0);
});

test('Cosquilleo exitoso dentro de la zona verde otorga botín y activa cooldown', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: 0.2 };
  const game = {
    player: { position: new THREE.Vector3(0, 0, 0), frozen: false },
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
    player: { position: new THREE.Vector3(0, 0, 0), frozen: false },
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
