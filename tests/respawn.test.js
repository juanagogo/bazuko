import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { StatsSystem, NEEDS } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { Menu } from '../src/ui/Menu.js';
import { Player } from '../src/entities/Player.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fixture() {
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), deathCount: 0, _deathPending: false, _arrestPending: false,
    talents: { getEffect: (key, fallback) => fallback }, clock: { isNight: false },
    player: { position: new THREE.Vector3(40, 0, 26), root: new THREE.Group(),
      receiveVehicleImpact(direction, speed) { this.lastImpact = { direction, speed }; },
      clearVehicleImpact() { this.lastImpact = null; } },
    world: { active: { reserved: { bed: { x: 89, z: 80 }, spawn: { x: 32, z: 32 } } } },
    input: { keys: { KeyW: true }, endFrame() {} },
    audio: { updateSteps() {} },
    interaction: { currentTarget: {}, currentTargetType: 'shop', boostActive: false },
    menu: { isOpen: false, open(options) { this.options = options; this.isOpen = true; }, close() { this.isOpen = false; } },
    creator: { isOpen: false },
    diseases: { hasAny: false, cureAll() { this.hasAny = false; } },
    inventory: new InventorySystem(),
    cameraRig: { follow(position) { this.target = position.clone(); } },
    collisions: null,
  });
  game.inventory.items = [{ id: 'papel', qty: 2 }, { id: 'carton', qty: 3 }];
  return game;
}

test('un atropello aplica daño proporcional a la velocidad y protege de golpes repetidos por cuadro', () => {
  const game = fixture(), direction = new THREE.Vector3(1, 0, 0);
  let messages = 0; window.addEventListener('toast', () => messages++);
  game._onVehicleImpact({ speed: 6, direction });
  assert.equal(game.stats.salud, 69);
  assert.equal(game.player.lastImpact.speed, 6);
  assert.equal(game.player.lastImpact.direction, direction);
  game._onVehicleImpact({ speed: 12, direction });
  assert.equal(game.stats.salud, 69);
  assert.equal(messages, 1);
  const slower = fixture(); slower._onVehicleImpact({ speed: 3, direction });
  assert.ok(slower.stats.salud > game.stats.salud);
});

test('un atropello grave pausa la muerte y limpia el golpe solo al recuperar en el cambuche', () => {
  const game = fixture(), position = game.player.position.clone();
  game._onVehicleImpact({ speed: 12, direction: new THREE.Vector3(1, 0, 0) });
  assert.equal(game.stats.salud, 0);
  assert.equal(game._handleDeath(), true);
  assert.equal(game.menu.options.title, 'Me atropellaron');
  assert.ok(game.player.position.equals(position));
  assert.equal(game.deathCount, 1);
  game._handleDeath(); assert.equal(game.deathCount, 1);
  game._respawn();
  assert.equal(game.player.lastImpact, null);
  assert.equal(game._deathCause, null);
  assert.ok(game.stats.salud >= 60);
});

test('la recuperación fatal espera a que termine el vuelo del ragdoll', () => {
  const game = fixture(); game.stats.salud = 0;
  game.player.isRagdollActive = true;
  assert.equal(game._handleDeath(), false);
  assert.equal(game.menu.isOpen, false);
  assert.equal(game.deathCount, 0);
  game.player.isRagdollActive = false;
  assert.equal(game._handleDeath(), true);
  assert.equal(game.deathCount, 1);
});

test('al agotarse la sed, la muerte se pausa sin trasladar al jugador', () => {
  const game = fixture();
  game.stats.sed = 1;
  game.stats.salud = 10;
  const start = game.player.position.clone();
  let deaths = 0;
  window.addEventListener('death', () => deaths++);
  for (let frame = 0; frame < 360 * 60; frame++) {
    if (!game.paused) {
      game.stats.update(1 / 60);
      game._handleDeath();
    }
  }
  assert.equal(game.stats.salud, 0);
  assert.equal(game.stats.sed, 0);
  assert.equal(game.paused, true);
  assert.equal(game.menu.options.dismissible, false);
  assert.deepEqual(game.player.position, start);
  assert.equal(game.inventory.items.length, 2);
  assert.equal(deaths, 1);
  for (let i = 0; i < 100; i++) game._handleDeath();
  assert.equal(deaths, 1);
  assert.equal(game.deathCount, 1);
});

test('solo la recuperación explícita traslada al cambuche una vez y sincroniza cámara y modelo', () => {
  const game = fixture();
  game._respawn();
  assert.deepEqual(game.player.position.toArray(), [40, 0, 26]);
  game.world.active.reserved.respawn = { x: 112.98, z: 97.84 };
  game.world.active.getGroundHeight = () => .08;
  for (const need of NEEDS) game.stats[need] = 0;
  game.diseases.hasAny = true;
  game._handleDeath();
  game._respawn();
  assert.equal(game.paused, false);
  assert.deepEqual(game.player.position.toArray(), [112.98, .08, 97.84]);
  assert.deepEqual(game.player.root.position, game.player.position);
  assert.deepEqual(game.cameraRig.target, game.player.position);
  assert.equal(game.cameraRig._snap, true);
  assert.equal(game.diseases.hasAny, false);
  assert.equal(game.interaction.currentTarget, null);
  assert.deepEqual(game.input.keys, {});
  for (const need of NEEDS) assert.equal(game.stats[need], 60);
  assert.equal(game.inventory.items.length, 1);
  game._respawn();
  assert.equal(game.inventory.items.length, 1);
  // Antes, sed/hambre a 20 y salud a 30 producían otra muerte en 55 s.
  for (let frame = 0; frame < 90 * 60; frame++) {
    game.stats.update(1 / 60);
    assert.equal(game._handleDeath(), false);
  }
  assert.ok(game.stats.salud >= 60);
});

test('Escape y el fondo no pueden omitir la pantalla de muerte; otros menús siguen cerrando', () => {
  const menu = Object.assign(Object.create(Menu.prototype), {
    root: { hidden: false }, _dismissible: false
  });
  menu.dismiss();
  assert.equal(menu.isOpen, true);
  menu._dismissible = true;
  menu.dismiss();
  assert.equal(menu.isOpen, false);
});

test('la captura policial confisca todo y reaparece en otro punto', () => {
  const game = fixture();
  game.stats.dinero = 12000;
  const start = game.player.position.clone();
  game.world.active.isWalkableAt = () => true;
  game.world.active.width = 40;
  game.world.active.height = 40;
  let rolls = 0;
  const originalRandom = Math.random;
  Math.random = () => {
    rolls += 1;
    return rolls === 1 ? 0.9 : 0.1;
  };
  try {
    game._policeArrest();
    assert.equal(game.paused, true);
    assert.equal(game.menu.options.dismissible, false);
    assert.equal(game.inventory.items.length, 2);
    assert.equal(game.stats.dinero, 12000);
    game._finishArrest();
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(game.paused, false);
  assert.equal(game.inventory.items.length, 0);
  assert.equal(game.stats.dinero, 0);
  assert.ok(game.player.position.distanceTo(start) > 1);
  assert.deepEqual(game.player.root.position, game.player.position);
  assert.equal(game.interaction.currentTarget, null);
  game._finishArrest();
  assert.equal(game.inventory.items.length, 0);
});

test('arresto desde el agua restaura el Player real en la calle y termina amenazas y acciones', () => {
  const game = fixture();
  game.player = new Player(new THREE.Scene(), { axis: {}, consumePress: () => false }, game.stats, game.audio);
  game.player.position.set(40, -1.2, 262);
  game.player.isSwimming = game.player.inWater = true;
  game.player.waterMovement.state = 'swimming';
  game.player.waterDepth = 5;
  game.player.jumpVelocity = -3;
  game.player.isGrounded = false;
  game.player.groundSurface = { layer: 'bridge', height: 7.82 };
  game.player.action = 'saltar'; game.player.actionTimer = .3;
  game.player.velocity.set(2, -3, 1);
  game.world.active.getSpawnGrid = () => [{ x: 80, z: 260 }];
  game.world.active.getGroundHeight = () => 7.82;
  game.world.active.getMovementGroundHeight = (_x, _z, y) => { assert.equal(y, 0); return .08; };
  const finished = [];
  game.waterEffects = { reset: () => finished.push('agua') };
  game.traffic = { endPursuit: () => finished.push('policia') };
  game.roadRage = { reset: () => finished.push('conductor') };
  game.limpieza = { reset: () => finished.push('agresores') };
  game.substanceEffects = { end: () => finished.push('efectos') };
  game.psychosis = { clearInduced: () => finished.push('paranoia') };
  game.steal = { buscado: 3, targetNpc: {}, _endMinigame: (_success, reason) => assert.equal(reason, 'cancel') };
  game._arrestPending = true;
  game._finishArrest();
  assert.deepEqual(game.player.position.toArray(), [80, .08, 260]);
  assert.equal(game.player.isSwimming, false); assert.equal(game.player.inWater, false);
  assert.equal(game.player.waterMovement.state, 'dry'); assert.equal(game.player.waterDepth, 0);
  assert.equal(game.player.jumpVelocity, 0); assert.equal(game.player.isGrounded, true);
  assert.equal(game.player.groundSurface, null); assert.equal(game.player.action, null);
  assert.equal(game.player.actionTimer, 0); assert.equal(game.player.velocity.length(), 0);
  assert.equal(game.steal.buscado, 0); assert.equal(game.steal.targetNpc, null);
  assert.deepEqual(finished, ['agua', 'policia', 'conductor', 'agresores', 'efectos', 'paranoia']);
  game.player.dispose();
});

test('una muerte pendiente tiene prioridad sobre un aviso policial', () => {
  const game = fixture(); game.stats.salud = 0;
  game._policeArrest();
  assert.equal(game._arrestPending, false);
  assert.equal(game._handleDeath(), true);
  assert.equal(game._deathPending, true);
});
