import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { InventoryUI } from '../src/ui/InventoryUI.js';
import { HUD } from '../src/ui/HUD.js';
import { ITEMS } from '../src/data/items.js';
import { NEEDS } from '../src/systems/StatsSystem.js';
import { TrashContainer } from '../src/entities/TrashContainer.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { CITY_CARRERAS, CITY_CALLES } from '../src/world/bogota/CityLayout.js';
import { CARACAS } from '../src/world/bogota/StreetLayout.js';

test('las dos vías nunca tienen verde simultáneo y disponen de amarillo y despeje', () => {
  for (let time = 0; time < 144; time += .1) {
    assert.ok(!(signalState(time, 0) === 0 && signalState(time, 1) === 0));
  }
  assert.equal(signalState(13.9, 0), 0);
  assert.equal(signalState(14, 0), 1);
  assert.equal(signalState(16.9, 0), 1);
  assert.equal(signalState(17.5, 0), 2);
  assert.equal(signalState(17.5, 1), 2);
  assert.equal(signalState(18, 1), 0);
  assert.equal(signalState(35.5, 0), 2);
  assert.equal(signalState(35.5, 1), 2);
  assert.equal(signalState(36, 0), 0);
});

test('carros y bus se detienen ante rojo y los vehículos dentro del cruce pueden despejarlo', () => {
  const signals = new TrafficSignals();
  signals.nodes = [{ x0: -4, x1: 4, z0: 20, z1: 32 }];
  const center = new THREE.Vector3(0, 0, 45);
  const direction = new THREE.Vector3(0, 0, -1);
  assert.equal(signals.blocks(new THREE.Vector3(0, 0, 34.9), direction, center, 4.3), true);
  assert.ok(Math.abs(signals.busClearance(center, 18.2) - 3.1) < 1e-8);
  assert.equal(signals.blocks(new THREE.Vector3(0, 0, 24), direction, new THREE.Vector3(0, 0, 30), 4.3), false);
  const fakeTraffic = Object.assign(Object.create(TrafficSystem.prototype), {
    signals, vehicles: [], _nearbyPedestrians: [], _probePosition: new THREE.Vector3(), _probeDirection: new THREE.Vector3()
  });
  const vehicle = {
    car: { position: center, length: 4.3, width: 1.76 }, distance: 0, speed: 10,
    route: { sample(distance, point, heading) { point.set(0, 0, 45 - distance); heading.copy(direction); } }
  };
  assert.ok(fakeTraffic._clearance(vehicle, null, []) < 11);
  signals.update(25);
  assert.equal(signals.busClearance(center, 18.2), Infinity);
  assert.equal(fakeTraffic._clearance(vehicle, null, []), Infinity);
});

test('el inventario por casillas conserva objetos, peso y accesos rápidos al ordenar y guardar', () => {
  const inv = new InventorySystem();
  let changes = 0;
  inv.onChange(() => changes++);
  inv.add(ITEMS.agua, 2); inv.add(ITEMS.carton, 3);
  inv.bindHotbar(0, 'agua');
  inv.sort();
  assert.equal(inv.count('agua'), 2);
  assert.equal(inv.hotbar[0], 'agua');
  assert.equal(inv.totalWeight, 2.5);
  const saved = inv.serialize(), restored = new InventorySystem();
  restored.deserialize(saved);
  assert.equal(restored.hotbar[0], 'agua');
  assert.deepEqual(restored.items, inv.items);
  const at = restored.slots.findIndex(item => item.id === 'carton');
  assert.equal(restored.removeAt(at, 99), 3);
  assert.equal(restored.count('carton'), 0);
  assert.ok(changes >= 4);
  restored.deserialize({ items: saved.items });
  assert.equal(restored.count('agua'), 2);
  assert.deepEqual(restored.hotbar, [null, null, null, null, null]);
});

test('el inventario nuevo conserva los efectos negativos y consume una sola unidad', () => {
  const inventory = new InventorySystem();
  inventory.add(ITEMS.cigarrillo, 2);
  const game = { stats: Object.fromEntries(NEEDS.map(key => [key, 50])) };
  const hud = Object.assign(Object.create(HUD.prototype), { _toast() {}, _renderInventory() {} });
  game.hud = hud;
  globalThis.window = { __game: game };
  const panel = Object.assign(Object.create(InventoryUI.prototype), { game, inv: inventory });
  panel._useItem('cigarrillo');
  assert.equal(game.stats.vicio, 85);
  assert.equal(game.stats.salud, 49);
  assert.equal(inventory.count('cigarrillo'), 1);
});

test('las canecas permanecen visibles y conservan botín que no cabe hasta recogerlo', () => {
  const container = new TrashContainer(new THREE.Scene(), new THREE.Vector3());
  const result = container.harvest();
  assert.ok(result.items.length >= 2);
  assert.equal(container.mesh.visible, true);
  assert.equal(container.used, true);
  assert.equal(container.cooldown, 120);
  container.returnUncollected(['colchon']);
  assert.equal(container.used, false);
  assert.deepEqual(container.harvest().items, ['colchon']);
  assert.equal(container.mesh.visible, true);
  container.dispose();
});

test('los seis circuitos no frenan con verde por consultar el rojo posterior al giro', () => {
  const signals = new TrafficSignals();
  const position = new THREE.Vector3(), heading = new THREE.Vector3();
  const traffic = Object.assign(Object.create(TrafficSystem.prototype), {
    signals, vehicles: [], _nearbyPedestrians: [], _probePosition: new THREE.Vector3(), _probeDirection: new THREE.Vector3()
  });
  for (const time of [0, 25]) {
    signals.update(time);
    for (const route of new Bogota().getTrafficRoutes()) {
      const vehicle = { route, distance: 0, speed: 6, car: { position, length: 4.3, width: 1.76 } };
      for (let distance = 0; distance < route.length; distance += .25) {
        vehicle.distance = distance;
        route.sample(distance, position, heading);
        const axis = Math.abs(heading.x) >= Math.abs(heading.z) ? 0 : 1;
        if (signalState(time, axis) !== 0) continue;
        assert.equal(traffic._clearance(vehicle, null, []), Infinity);
      }
    }
  }
});

test('una señal roja no bloquea al vehículo que acaba de salir del cruce', () => {
  const signals = new TrafficSignals();
  signals.nodes = [{ x0: -4, x1: 4, z0: 20, z1: 32 }];
  const south = new THREE.Vector3(0, 0, 1), north = new THREE.Vector3(0, 0, -1);
  assert.equal(signals.blocks(new THREE.Vector3(0, 0, 32.2), south, new THREE.Vector3(0, 0, 32.1), 4.3), false);
  assert.equal(signals.blocks(new THREE.Vector3(0, 0, 19.8), north, new THREE.Vector3(0, 0, 19.9), 4.3), false);
  assert.equal(signals.blocks(new THREE.Vector3(0, 0, 34.9), north, new THREE.Vector3(0, 0, 36), 4.3), true);
});

test('la red cubre todos los cruces pero solo un cuarto conserva cuatro semaforos', () => {
  const signals = new TrafficSignals();
  const vertical = [...CITY_CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1]]];
  assert.equal(signals.nodes.length, CITY_CALLES.length * vertical.length);
  assert.equal(signals.poles.length, Math.ceil(signals.nodes.length / 4) * 4);
  for (const [za, zb] of CITY_CALLES) for (const [xa, xb] of vertical) {
    assert.ok(signals.nodes.some(node => node.x0 === xa * 2 - 1 && node.x1 === xb * 2 + 1 && node.z0 === za * 2 - 1 && node.z1 === zb * 2 + 1));
  }
});
