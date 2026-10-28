// tests/steal.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Input } from '../src/core/Input.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { StealSystem, CONFIG } from '../src/features/steal.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

function interactionGame(npcs = []) {
  const player = { position: new THREE.Vector3() };
  const input = new Input();
  const interaction = new InteractionSystem(player);
  const game = { player, input, interaction, world: { active: { npcs } }, paused: false };
  const steal = new StealSystem(game);
  return {
    input, interaction, steal,
    press(code) { window.dispatchEvent(Object.assign(new Event('keydown'), { code })); },
    update() {
      interaction.update(0.1, input, { isNight: false });
      steal.update(0.1);
      input.endFrame();
    }
  };
}

test('E inicia el cosquilleo después de actualizar la interacción general', () => {
  const npc = { position: new THREE.Vector3(1, 0, 0), alerta: 0.3 };
  const game = interactionGame([npc]);
  game.press('KeyE');
  game.update();

  assert.equal(game.steal.minigameActive, true);
  assert.equal(game.steal.targetNpc, npc);
});

test('E abre la tienda sin iniciar también un robo al peatón cercano', () => {
  const npc = { position: new THREE.Vector3(1, 0, 0), alerta: 0.3 };
  const game = interactionGame([npc]);
  const shop = { kind: 'shop', position: new THREE.Vector3(0.5, 0, 0) };
  game.interaction.register(shop);
  let openedShop;
  window.addEventListener('open-shop', event => { openedShop = event.detail.target; });
  game.press('KeyE');
  game.update();

  assert.equal(openedShop, shop);
  assert.equal(game.steal.minigameActive, false);
});

test('E pulsada sin objetivos no inicia un robo al acercarse un peatón después', () => {
  const npcs = [];
  const game = interactionGame(npcs);
  game.press('KeyE');
  game.update();
  assert.equal(game.steal.minigameActive, false);

  npcs.push({ position: new THREE.Vector3(1, 0, 0), alerta: 0.3 });
  game.update();
  assert.equal(game.steal.minigameActive, false);
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
