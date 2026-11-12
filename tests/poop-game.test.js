// tests/poop-game.test.js
// La escena de popó dentro del juego: morir, el arresto y el robo a peatones.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { PoopSystem } from '../src/systems/PoopSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { StealSystem } from '../src/features/steal.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function squatting() {
  const player = {
    position: new THREE.Vector3(40, 0, 26), root: new THREE.Group(),
    isGrounded: true, isSwimming: false, isStunned: false, isRagdollActive: false,
    basuco: null, sorting: false, hasCart: false, action: null, character: {}, look: {}, stats: { salud: 100 },
    playAction(action) { this.action = action; },
    setPoopPose(pose) { this.poopPose = pose; },
    receiveVehicleImpact() {}, clearVehicleImpact() {}
  };
  const inventory = new InventorySystem();
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), deathCount: 0, _deathPending: false, _arrestPending: false,
    talents: { getEffect: (key, fallback) => fallback }, clock: { isNight: false },
    player, look: {},
    world: { active: { reserved: { bed: { x: 89, z: 80 }, spawn: { x: 32, z: 32 } }, getGroundHeight: () => 0 } },
    input: { keys: {}, endFrame() {} },
    audio: { updateSteps() {} },
    interaction: { currentTarget: null, currentTargetType: null, boostActive: false },
    menu: { isOpen: false, open(options) { this.options = options; this.isOpen = true; }, close() { this.isOpen = false; } },
    creator: { isOpen: false },
    diseases: { hasAny: false, cureAll() {} },
    inventory,
    cameraRig: { follow() {} },
    collisions: null
  });
  game.poopSystem = new PoopSystem(new THREE.Scene(), null, inventory, game.stats, game.world);
  game.poopSystem.poop(player);
  for (let i = 0; i < 75; i++) game.poopSystem.update(1 / 30);
  assert.equal(player.poopPose?.drop, 1, 'agachado con el pantalón abajo');
  return game;
}

test('una caída mortal a mitad de la escena viste al jugador desde el primer cuadro', () => {
  const game = squatting();
  game.stats.salud = 0;
  game.player.isRagdollActive = true;
  assert.equal(game._handleDeath(), false, 'deja terminar la caída');
  assert.equal(game.player.poopPose, null);
  assert.equal(game.poopSystem.sequence.active, false);
});

test('morir a mitad de la escena viste al jugador antes de la pantalla de muerte', () => {
  const game = squatting();
  game.stats.salud = 0;
  assert.equal(game._handleDeath(), true);
  assert.equal(game.menu.isOpen, true);
  assert.equal(game.player.poopPose, null);
});

test('el arresto a mitad de la escena viste al jugador antes de la foto', () => {
  const game = squatting();
  game._policeArrest();
  assert.equal(game._arrestPending, true);
  assert.equal(game.player.poopPose, null);
});

test('agachado haciendo popó no roba ni ofrece robar', () => {
  const npc = { position: new THREE.Vector3(1, 0, 1), _robadoTimer: 0, alerta: .3 };
  const game = {
    player: { position: new THREE.Vector3(0, 0, 0), busyPoop: true },
    world: { active: { npcs: [npc] } },
    input: { consumePress: code => code === 'KeyE' || code === 'KeyQ' },
    interaction: {},
    paused: false
  };
  const steal = new StealSystem(game);
  steal.update(.1);
  assert.equal(steal.minigameActive, false);
  assert.equal(steal.targetNpc, null);
  assert.equal(game.interaction.stealPrompt, undefined);
});
