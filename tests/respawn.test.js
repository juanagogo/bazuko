import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { StatsSystem, NEEDS } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { Menu } from '../src/ui/Menu.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fixture() {
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), deathCount: 0, _deathPending: false,
    talents: { getEffect: (key, fallback) => fallback }, clock: { isNight: false },
    player: { position: new THREE.Vector3(40, 0, 26), root: new THREE.Group() },
    world: { active: { reserved: { bed: { x: 89, z: 80 } } } },
    input: { keys: { KeyW: true }, endFrame() {} },
    audio: { updateSteps() {} },
    interaction: { currentTarget: {}, currentTargetType: 'shop' },
    menu: { isOpen: false, open(options) { this.options = options; this.isOpen = true; }, close() { this.isOpen = false; } },
    creator: { isOpen: false },
    diseases: { hasAny: false, cureAll() { this.hasAny = false; } },
    inventory: new InventorySystem(),
    cameraRig: { follow(position) { this.target = position.clone(); } }
  });
  game.inventory.items = [{ id: 'papel', qty: 2 }, { id: 'carton', qty: 3 }];
  return game;
}

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
  for (const need of NEEDS) game.stats[need] = 0;
  game.diseases.hasAny = true;
  game._handleDeath();
  game._respawn();
  assert.equal(game.paused, false);
  assert.deepEqual(game.player.position.toArray(), [89, 0, 82]);
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

test('al reaparecer, la zorra se desocupa después de la pérdida habitual', () => {
  const game = fixture();
  game._deathPending = true;
  let objetosAlLlamar = null;
  game.zorraCtl = { alMorir: () => { objetosAlLlamar = game.inventory.items.length; } };
  game._respawn();
  assert.equal(objetosAlLlamar, 1);
});
