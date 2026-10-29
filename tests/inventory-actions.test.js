import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { StatsSystem, NEEDS } from '../src/systems/StatsSystem.js';
import { HUD } from '../src/ui/HUD.js';
import { ITEMS } from '../src/data/items.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fixture(t) {
  const stats = new StatsSystem();
  for (const need of NEEDS) stats[need] = 45;
  const audio = { played: [], play(id) { this.played.push(id); } };
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false };
  const player = new Player(new THREE.Scene(), input, stats, audio);
  t.after(() => player.dispose());
  const inventory = new InventorySystem();
  window.__game = { player, stats, audio, inventory };
  const hud = Object.assign(Object.create(HUD.prototype), { _toast() {}, _renderInventory() {} });
  const effects = [];
  window.addEventListener('substance-consumed', event => effects.push(event.detail.id));
  return { player, stats, audio, inventory, hud, effects };
}

test('vaciar el inventario notifica su estado vacío y el suscriptor desequipa y cancela el ataque', t => {
  const { player, inventory } = fixture(t);
  inventory.add(ITEMS.cuchillo);
  inventory.add(ITEMS.pan, 2);
  assert.equal(player.equipWeapon('cuchillo'), true);
  assert.equal(player.punch(), true);
  assert.ok(player.attack, 'hay un ataque del arma confiscada pendiente');
  const snapshots = [];
  const unsubscribe = inventory.onChange(() => {
    snapshots.push({ count: inventory.itemCount, weight: inventory.totalWeight });
    player.syncWeapon(inventory);
  });
  t.after(unsubscribe);

  inventory.clear();

  assert.deepEqual(snapshots, [{ count: 0, weight: 0 }]);
  assert.equal(inventory.count('cuchillo'), 0);
  assert.equal(player.equippedWeapon, 'punos');
  assert.equal(player.attack, null, 'no puede impactar con el arma que ya no tiene');
  assert.equal(player.action, null);
});

const blockedStates = [
  ['nadando', player => { player.isSwimming = true; }],
  ['en el aire', player => { player.isGrounded = false; }],
  ['aturdido', player => { player.receiveHit(new THREE.Vector3(1, 0, 0)); }]
];

for (const id of ['cigarrillo', 'hierba']) {
  for (const [state, block] of blockedStates) {
    test(`rechazar ${id} ${state} conserva el objeto, las necesidades y los efectos`, t => {
      const { player, stats, audio, inventory, hud, effects } = fixture(t);
      inventory.add(ITEMS[id], 2);
      block(player);
      const beforeInventory = structuredClone(inventory.serialize());
      const beforeStats = structuredClone(stats.serialize());
      let changes = 0;
      inventory.onChange(() => changes++);

      hud._useItem(id, inventory);

      assert.deepEqual(inventory.serialize(), beforeInventory);
      assert.deepEqual(stats.serialize(), beforeStats);
      assert.equal(changes, 0, 'no se informa un consumo que fue rechazado');
      assert.equal(player.smoking, null);
      assert.equal(player._smoke, null, 'no crea partículas de un cigarrillo rechazado');
      assert.deepEqual(effects, []);
      assert.deepEqual(audio.played, [], 'no reproduce el sonido de consumir');
    });
  }

  test(`usar ${id} con apoyo conserva el consumo válido y aplica sus necesidades una vez`, t => {
    const { player, stats, audio, inventory, hud, effects } = fixture(t);
    inventory.add(ITEMS[id], 2);

    hud._useItem(id, inventory);

    assert.equal(inventory.count(id), 1);
    assert.equal(player.smoking?.kind, id);
    assert.equal(stats.vicio, 45 + ITEMS[id].amount);
    assert.equal(stats.salud, 44);
    assert.deepEqual(audio.played, ['pickup']);
    assert.deepEqual(effects, [], 'el efecto de lo fumado espera a la calada');

    const afterFirstUse = structuredClone(stats.serialize());
    hud._useItem(id, inventory);
    assert.equal(inventory.count(id), 1, 'tener uno encendido no gasta el segundo');
    assert.deepEqual(stats.serialize(), afterFirstUse);
    assert.deepEqual(audio.played, ['pickup']);
  });
}
