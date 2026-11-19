import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CAMBUCHE } from '../src/data/cambuche.js';
import { ITEMS, LOOT_COMMON, itemRarityLabel } from '../src/data/items.js';
import { distributeShelterLoot, spreadPickupPositions } from '../src/systems/ShelterLoot.js';
import { Pickup } from '../src/entities/Pickup.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';

test('la reserva cubre todas las recetas sin depender de tiradas aleatorias, incluso tras reponer basura', t => {
  t.mock.method(Math, 'random', () => .99);
  for (const count of [1, 14, 42]) {
    const scene = new THREE.Scene();
    const pickups = Array.from({ length: count }, () => new Pickup(scene, new THREE.Vector3()));
    distributeShelterLoot(pickups, () => .5);
    for (let cycle = 0; cycle < 2; cycle++) {
      const supply = {};
      for (const pickup of pickups) {
        pickup._weightedPick = () => 'botella';
        for (const id of pickup.harvest().items) supply[id] = (supply[id] ?? 0) + 1;
        pickup.update(21);
      }
      // Construye todas las partes consecutivamente: madera compartida por paredes y fogón.
      for (const piece of CAMBUCHE) for (const [id, quantity] of Object.entries(piece.req)) {
        assert.ok(supply[id] >= quantity, `Falta ${id} para ${piece.id}`);
        supply[id] -= quantity;
      }
    }
    pickups.forEach(pickup => pickup.dispose());
  }
});

test('las primeras bolsas cubren las nueve zonas sin duplicar posiciones ni modificar la cuadrícula', () => {
  const grid = [];
  for (let zone = 0; zone < 9; zone++) for (let i = 0; i < 8; i++) {
    grid.push(new THREE.Vector3((zone % 3) * 80 + 5 + i, 0, Math.floor(zone / 3) * 74 + 5));
  }
  const result = spreadPickupPositions(grid, 240, 222);
  const zoneOf = p => Math.floor(p.x / 80) + 3 * Math.floor(p.z / 74);
  assert.equal(new Set(result.slice(0, 9).map(zoneOf)).size, 9);
  assert.equal(new Set(result).size, grid.length);
  assert.equal(result.length, grid.length);
  assert.notDeepEqual(result, grid);
  assert.deepEqual(spreadPickupPositions([], 240, 222), []);
});

test('el botín que no cabe sigue en la bolsa y no se vuelve a sortear ni se multiplica', () => {
  const pickup = new Pickup(new THREE.Scene(), new THREE.Vector3());
  pickup.guaranteedLoot = ['colchon'];
  pickup.harvest();
  pickup.returnUncollected(['colchon'], true);
  let moved = false;
  pickup.onRespawn = () => { moved = true; };
  pickup.update(1000);
  assert.equal(moved, false);
  assert.equal(pickup.used, false);
  assert.equal(pickup.mesh.visible, true);
  pickup._weightedPick = () => { throw new Error('No debe sortear contenido nuevo'); };
  const retry = pickup.harvest(true, false, { extraRolls: 99 });
  assert.deepEqual(retry.items, ['colchon']);
  assert.equal(retry.sorted, true);
  assert.equal(pickup.used, true);
  assert.equal(pickup.harvest(), null);
  pickup.dispose();
});

test('la bolsa y los materiales apoyan en el suelo al recoger y reaparecer', t => {
  t.mock.method(Math, 'random', () => .99);
  const floor = x => x >= 4 ? .3 : .12;
  const pickup = new Pickup(new THREE.Scene(), new THREE.Vector3(2, 0, 4), { groundHeight: floor });
  const minimumY = model => new THREE.Box3().setFromObject(model, true).min.y;
  const assertAt = (model, height) => assert.ok(Math.abs(minimumY(model) - height) < 1e-6);
  assertAt(pickup.mesh, .12);
  assert.ok(Math.abs(pickup.marker.position.y - .14) < 1e-6);
  pickup.guaranteedLoot = ['carton', 'lata'];
  pickup.relocate(new THREE.Vector3(5, 0, 4));
  assertAt(pickup.mesh, .3);
  assertAt(pickup.looseMaterial, .3);
  assert.equal(pickup.looseMaterial.name, 'carton');
  assert.equal(pickup.position.y, 0); // El objetivo y la reserva mantienen sus coordenadas de juego.

  pickup.harvest();
  assert.equal(pickup.looseMaterial.visible, false);
  pickup.returnUncollected(['lata'], true);
  assert.equal(pickup.looseMaterial.name, 'lata');
  assertAt(pickup.looseMaterial, .3);
  assert.deepEqual(pickup.harvest().items, ['lata']);
  pickup.onRespawn = p => p.relocate(new THREE.Vector3(2, 0, 5));
  pickup.update(pickup.refillSeconds + .1);
  assert.equal(pickup.looseMaterial.name, 'carton');
  assert.ok(pickup.mesh.visible && pickup.looseMaterial.visible);
  assertAt(pickup.mesh, .12);
  assertAt(pickup.looseMaterial, .12);
  pickup.returnUncollected(['madera'], true);
  assert.equal(pickup.looseMaterial.name, 'madera');
  assertAt(pickup.looseMaterial, .12);
  pickup.dispose();
});

test('costal lleno conserva el colchón y entrega su recompensa rara solo cuando realmente entra', t => {
  globalThis.window = new EventTarget();
  t.mock.method(Math, 'random', () => .99);
  const pickup = new Pickup(new THREE.Scene(), new THREE.Vector3());
  pickup.guaranteedLoot = ['colchon'];
  pickup._weightedPick = () => 'carton';
  const inventory = new InventorySystem(1);
  let xp = 0, treasures = 0;
  const interaction = Object.assign(Object.create(InteractionSystem.prototype), {
    inventory, player: {}, talents: { getEffect: (key, fallback) => fallback },
    stats: { saludMental: 50, addXP() { xp++; } }, disease: { tryInfect() {} },
    audio: { play(sound) { if (sound === 'treasure') treasures++; } },
    _origin: key => key === 'extraLoot' ? 0 : 1
  });
  interaction._harvestTrash(pickup, false);
  assert.equal(inventory.count('colchon'), 0);
  assert.equal(inventory.count('carton'), 2);
  assert.equal(treasures, 0);
  assert.equal(xp, 1);
  interaction._harvestTrash(pickup, false);
  assert.equal(xp, 1); // sin espacio no se puede repetir XP sobre la misma bolsa
  assert.equal(treasures, 0);
  inventory.maxWeight = 20;
  interaction._harvestTrash(pickup, false);
  assert.equal(inventory.count('colchon'), 1);
  assert.equal(inventory.count('carton'), 2);
  assert.equal(treasures, 1);
  pickup.dispose();
});

test('cada material de construcción tiene rareza y posibilidad de salir en el botín normal', () => {
  for (const piece of CAMBUCHE) for (const id of Object.keys(piece.req)) {
    assert.ok(itemRarityLabel(id));
    assert.ok(LOOT_COMMON.some(entry => entry.item === id && entry.weight > 0));
    assert.ok(ITEMS[id]);
  }
});
