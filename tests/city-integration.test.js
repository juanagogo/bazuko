import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';
import { LENS, SIGNAL_POLE, createSignalGeometry, lensLit } from '../src/world/bogota/SignalModel.js';
import { VIADUCT, viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
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

test('los semáforos cubren todos los cruces de la ciudad ampliada con cuatro accesos por cruce', () => {
  const signals = new TrafficSignals();
  const vertical = [...CITY_CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1]]];
  assert.equal(signals.nodes.length, CITY_CALLES.length * vertical.length);
  assert.equal(signals.poles.filter(pole => !pole.laneSignal).length, signals.nodes.length * 4);
  for (const [za, zb] of CITY_CALLES) for (const [xa, xb] of vertical) {
    const detour = xa === CARACAS.lanes[0][0] && xb === CARACAS.lanes[1][1] && (za === 72 || za === 94);
    assert.ok(signals.nodes.some(node => node.x0 === xa * 2 - 1 && node.x1 === xb * 2 + 1 + (detour ? 32 : 0) && node.z0 === za * 2 - 1 && node.z1 === zb * 2 + 1));
  }
});

// Matriz del modelo de un poste y sus lámparas ya en el mundo.
function poleLamps(pole, lamps) {
  const matrix = new THREE.Matrix4().makeTranslation(pole.x, 0, pole.z).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(-pole.hz, pole.hx)));
  const rotation = new THREE.Matrix3().setFromMatrix4(matrix);
  return lamps.map(lamp => ({ ...lamp, world: lamp.center.clone().applyMatrix4(matrix), facing: lamp.normal.clone().applyMatrix3(rotation) }));
}

test('el semáforo por código respeta su presupuesto y funciona sin DOM', async () => {
  const signals = new TrafficSignals();
  await signals.preloadModel();
  const { geometry, lamps } = createSignalGeometry();
  assert.ok(geometry.index.count / 3 <= 2500, `triángulos: ${geometry.index.count / 3}`);
  assert.deepEqual(lamps.map(lamp => lamp.code).filter(code => code <= LENS.GREEN), [LENS.RED, LENS.AMBER, LENS.GREEN, LENS.RED, LENS.AMBER, LENS.GREEN]);
  for (const name of Object.keys(geometry.attributes)) assert.ok(geometry.attributes[name].array.every(Number.isFinite), name);
  assert.ok(geometry.boundingBox.max.y < VIADUCT.connectionHeight - VIADUCT.thickness);
  signals.dispose();
});

test('cada cabeza mira al conductor que se acerca y cuelga sobre su carril', () => {
  const signals = new TrafficSignals(), { lamps } = createSignalGeometry();
  for (const pole of signals.poles.filter(pole => !pole.onRoadway)) {
    const placed = poleLamps(pole, lamps);
    for (const lamp of placed.filter(lamp => lamp.code <= LENS.GREEN)) {
      assert.ok(lamp.facing.x * pole.hx + lamp.facing.z * pole.hz < -.99);
    }
    const main = placed[1].world;
    assert.ok(Math.abs(main.y - SIGNAL_POLE.headY) < .01);
    // El poste propio del carril X 66 no sale de las esquinas del cruce: su cabeza va sobre ese carril.
    if (pole.laneSignal) { assert.ok(Math.abs(main.x - 66) < .01, `cabeza en X ${main.x}`); continue; }
    const node = signals.nodes.find(node => pole.axis === 0
      ? pole.z === (pole.hx > 0 ? node.z1 + .5 : node.z0 - .5) && pole.x === (pole.hx > 0 ? node.x0 - .5 : node.x1 + .5)
      : pole.x === (pole.hz > 0 ? node.x0 - .5 : node.x1 + .5) && pole.z === (pole.hz > 0 ? node.z0 - .5 : node.z1 + .5));
    assert.ok(node, `poste ${pole.x},${pole.z}`);
    // Queda hacia adentro de la vía, al lado derecho del conductor.
    if (pole.axis === 0) {
      const middle = (node.z0 + node.z1) / 2;
      assert.ok(Math.abs(main.z - (middle + pole.hx * 3)) < .01);
    } else {
      assert.ok(pole.hz > 0 ? main.x > node.x0 && main.x < node.x0 + 6 : main.x < node.x1 && main.x > node.x1 - 6);
    }
  }
});

test('la luz encendida coincide con lo que obliga al tráfico y el peatón no cruza contra el verde', () => {
  const signals = new TrafficSignals();
  signals.nodes = [{ x0: -6, x1: 6, z0: -6, z1: 6 }];
  const approaches = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([x, z]) => ({
    direction: new THREE.Vector3(-x, 0, -z), axis: x ? 0 : 1,
    current: new THREE.Vector3(x * 9, 0, z * 9), point: new THREE.Vector3(x * 6.2, 0, z * 6.2)
  }));
  for (let time = 0; time < 72; time += .25) {
    signals.update(time);
    const states = [signalState(time, 0), signalState(time, 1)];
    for (const { direction, axis, current, point } of approaches) {
      const blocked = signals.blocks(point, direction, current, 4.3);
      assert.equal(blocked, !lensLit(LENS.GREEN, axis, states));
      assert.equal(lensLit(LENS.RED, axis, states) || lensLit(LENS.AMBER, axis, states), blocked);
    }
    for (const axis of [0, 1]) {
      // Quien camina paralelo a este eje cruza la vía del otro: esa debe estar sin verde.
      if (lensLit(LENS.WALK_PARALLEL, axis, states)) assert.notEqual(states[1 - axis], 0);
      if (lensLit(LENS.WALK_CROSS, axis, states)) assert.notEqual(states[axis], 0);
      assert.notEqual(lensLit(LENS.WALK_PARALLEL, axis, states), lensLit(LENS.STOP_PARALLEL, axis, states));
      assert.notEqual(lensLit(LENS.WALK_CROSS, axis, states), lensLit(LENS.STOP_CROSS, axis, states));
    }
  }
});

test('ningún poste dibujado pisa la calzada ni su brazo toca el viaducto', () => {
  const signals = new TrafficSignals();
  const hidden = signals.poles.filter(pole => pole.onRoadway);
  // El desvío de la troncal ensancha dos cruces hasta la carrera vecina.
  assert.deepEqual(hidden.map(pole => `${pole.x},${pole.z}`).sort(), ['125.5,142.5', '125.5,155.5', '125.5,186.5', '125.5,199.5']);
  assert.equal(signals.poles.filter(pole => !pole.laneSignal).length, signals.nodes.length * 4);
  for (const pole of signals.poles) {
    if (pole.onRoadway) continue;
    const ax = pole.hz, az = -pole.hx;
    for (let reach = 0; reach <= SIGNAL_POLE.armLength; reach += .25) {
      const deck = viaductSurface(pole.x + ax * reach, pole.z + az * reach);
      if (deck !== null) assert.ok(deck - VIADUCT.thickness > SIGNAL_POLE.top + .1, `${pole.x},${pole.z} a ${reach} m`);
    }
  }
});
