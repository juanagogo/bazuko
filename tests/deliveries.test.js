import assert from 'node:assert/strict';
import test from 'node:test';
import { DailyMissionSystem, MISSION_TEMPLATES } from '../src/systems/DailyMissionSystem.js';
import { DELIVERY_FINE, DELIVERY_GEAR, DELIVERY_ITEMS, DELIVERY_TIP, DeliverySystem } from '../src/systems/DeliverySystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';

function fixture() {
  const stats = { dinero: DELIVERY_GEAR.price + 1000, xp: 0, addXP(xp) { this.xp += xp; } };
  const player = { position: { x: 0, y: 0, z: 0 }, setDeliveryGear(gear) { this.gear = gear; } };
  const game = {
    stats, player, gps: {}, inventory: new InventorySystem(),
    setGpsWaypoint(poi) { this.gps.waypoint = { ...poi }; return true; },
    clearGpsWaypoint() { this.gps.waypoint = null; },
    _save() { this.saved = { cash: stats.dinero, deliveries: this.deliveries.serialize() }; }
  };
  game.dailyMissions = new DailyMissionSystem(game);
  const deliveries = game.deliveries = new DeliverySystem(game);
  game.dailyMissions.completedTypes = new Set(MISSION_TEMPLATES.slice(0, deliveries.requiredMissions).map(({ type }) => type));
  const shop = { id: 'tienda', name: 'Tienda', position: { x: 0, y: 0, z: 0 } };
  const npc = { position: { x: 30, y: 0, z: 0 } };
  const client = { id: 'vecino', name: 'Vecino', type: 'person', npc, position: npc.position };
  const building = { id: 'edificio', name: 'Edificio', type: 'building', position: { x: 50, y: 0, z: 0 } };
  deliveries.setPlaces({ shops: [shop], clients: [client, building] });
  return { game, deliveries, player, shop, client, building };
}

test('el maletín exige seis tipos de misiones de Calle y cobra $50.000 una vez', () => {
  const { deliveries, game, player } = fixture();
  game.stats.dinero = 49999;
  assert.equal(deliveries.purchase(), false);
  game.stats.dinero = 50000;
  const type = MISSION_TEMPLATES[5].type;
  game.dailyMissions.completedTypes.delete(type);
  assert.equal(deliveries.missionCount, 5);
  assert.equal(deliveries.purchase(), false);
  assert.equal(game.stats.dinero, 50000);
  game.dailyMissions.completedTypes.add(type);
  assert.ok(deliveries.purchase());
  assert.equal(game.stats.dinero, 0);
  assert.equal(deliveries.purchase(), false);
  assert.deepEqual(player.gear, ['bag', 'jacket', 'cap']);
  for (const item of DELIVERY_ITEMS) assert.equal(game.inventory.count(item.id), 1);
  assert.equal(game.saved.deliveries.owned, true);
});

test('recoger y entregar exige cercanía y permite la bicicleta detenida al lado del cliente', () => {
  const { deliveries, game, player, shop, client, building } = fixture();
  assert.equal(deliveries.accept(), false);
  assert.ok(deliveries.purchase());
  assert.ok(deliveries.accept());
  assert.equal(deliveries.accept(), false);
  assert.equal(deliveries.interact(client), false);
  assert.ok(deliveries.interact(shop));
  assert.equal(game.saved.deliveries.order.pickedUp, true);
  assert.equal(game.gps.waypoint.x, client.position.x);
  client.position.x += 10;
  deliveries.updateRoute(2000);
  assert.equal(game.gps.waypoint.x, client.position.x);
  player.position = { ...client.position, y: 8 };
  assert.equal(deliveries.interact(client), false);
  player.position.y = 0;
  player.bicycle = { speed: 4 };
  assert.equal(deliveries.interact(client), false);
  player.bicycle.speed = 0;
  client.npc.koState = 'down';
  assert.equal(deliveries.interact(client), false);
  client.npc.koState = null;
  assert.ok(deliveries.interact(client));
  assert.equal(deliveries.interact(client), false);
  assert.equal(game.stats.dinero, 4000 + DELIVERY_TIP);
  assert.equal(game.stats.xp, 25);
  assert.equal(game.gps.waypoint, null);
  assert.equal(deliveries.offer.client, building);
});

test('al recargar se conserva el maletín, el paquete recogido y la cuenta de entregas', () => {
  const { deliveries, game, shop } = fixture();
  deliveries.purchase();
  deliveries.accept();
  deliveries.interact(shop);
  deliveries.update(13.5);
  game._save();
  const restored = fixture();
  restored.deliveries.deserialize(JSON.parse(JSON.stringify(game.saved.deliveries)));
  assert.equal(restored.deliveries.secondsLeft, deliveries.secondsLeft);
  assert.ok(restored.player.gear.includes('bag'));
  assert.equal(restored.deliveries.destination, restored.client);
  assert.ok(restored.deliveries.cancel());
  assert.equal(restored.deliveries.completed, 0);
  assert.equal(restored.deliveries.order, null);
  restored.deliveries.deserialize(undefined);
  assert.deepEqual(restored.player.gear, []);
});

test('el plazo empieza al recoger, usa la distancia de la ruta y conserva la tarifa base al vencer', () => {
  const { deliveries, game, player, client, shop } = fixture();
  game.gps.routeLengthTo = () => 130;
  deliveries.purchase();
  deliveries.accept();
  deliveries.update(500);
  assert.equal(deliveries.secondsLeft, null);
  assert.ok(deliveries.interact(shop));
  assert.equal(deliveries.secondsLeft, 80);
  deliveries.toggleGear('bag');
  deliveries.update(81);
  assert.equal(deliveries.secondsLeft, 0);
  deliveries.toggleGear('bag');
  player.position = client.position;
  assert.ok(deliveries.interact(client));
  assert.equal(game.stats.dinero, 4000);
  assert.equal(deliveries.strikes, 0);
  assert.equal(deliveries.secondsLeft, null);
});

test('solo el maletín activa domicilios y volver a ponérselo recupera un pedido en curso', () => {
  const { deliveries, game, shop, player, client } = fixture();
  deliveries.purchase();
  deliveries.toggleGear('bag');
  assert.deepEqual(player.gear, ['jacket', 'cap']);
  assert.equal(deliveries.accept(), false);
  deliveries.setGear(['bag']);
  assert.ok(deliveries.accept());
  assert.ok(deliveries.interact(shop));
  deliveries.toggleGear('bag');
  player.position = client.position;
  assert.equal(deliveries.interact(client), false);
  assert.equal(deliveries.keepOrder(), false);
  assert.equal(game.gps.waypoint, null);
  assert.equal(game.saved.deliveries.order.pickedUp, true);
  deliveries.toggleGear('bag');
  assert.ok(deliveries.interact(client));
});

test('al cambiar de rol, solo las misiones activas avanzan y se conserva el progreso de Calle', () => {
  const { deliveries, game } = fixture();
  const daily = game.dailyMissions;
  daily.init(1);
  const mission = daily.missions.find(item => item.type === 'bicicleta');
  deliveries.purchase();
  daily.reportProgress(mission.type);
  assert.equal(daily.activeMissionText, null);
  assert.equal(mission.progress, 0);
  deliveries.toggleGear('bag');
  daily.reportProgress(mission.type);
  assert.equal(mission.completed, true);
  deliveries.toggleGear('bag');
  deliveries.toggleGear('bag');
  assert.equal(mission.completed, true);
  assert.ok(daily.activeMissionText);
});

test('tres pedidos robados retiran el equipo y una multa reactiva la cuenta conservando entregas', () => {
  const { deliveries, game, player, shop } = fixture();
  deliveries.purchase();
  deliveries.completed = 4;
  for (let strike = 1; strike <= 3; strike++) {
    assert.ok(deliveries.accept());
    assert.equal(deliveries.keepOrder(), false);
    assert.ok(deliveries.interact(shop));
    assert.ok(deliveries.keepOrder());
    assert.equal(deliveries.keepOrder(), false);
    assert.equal(deliveries.strikes, strike);
  }
  assert.equal(game.inventory.count('empanada'), 3);
  assert.equal(deliveries.accept(), false);
  assert.equal(deliveries.purchase(), false);
  assert.deepEqual(player.gear, []);
  for (const item of DELIVERY_ITEMS) assert.equal(game.inventory.count(item.id), 0);
  const restored = fixture();
  restored.deliveries.deserialize(game.saved.deliveries);
  assert.equal(restored.deliveries.suspended, true);
  restored.game.stats.dinero = DELIVERY_FINE - 1;
  assert.equal(restored.deliveries.payFine(), false);
  restored.game.stats.dinero = DELIVERY_FINE + 1000;
  assert.ok(restored.deliveries.payFine());
  assert.equal(restored.game.stats.dinero, 1000);
  assert.equal(restored.deliveries.payFine(), false);
  assert.equal(restored.deliveries.completed, 4);
  assert.deepEqual(restored.player.gear, ['bag']);
  assert.ok(restored.deliveries.accept());
});

test('los tipos de misión se acumulan entre días y se recuperan del día actual en guardados anteriores', () => {
  const daily = new DailyMissionSystem();
  const at = day => daily.generateMissions(day);
  const completed = at(1).slice(0, 2).map(mission => ({ ...mission, completed: true, claimed: true }));
  daily.deserialize({ currentDay: 1, missions: [...completed, ...at(1).slice(2)] });
  daily.update(0, { day: 2 });
  daily.reportProgress('bicicleta');
  daily.update(0, { day: 3 });
  daily.reportProgress('bicicleta');
  assert.equal(daily.completedTypes.size, 3);
  const restored = new DailyMissionSystem();
  restored.deserialize(daily.serialize());
  assert.deepEqual(restored.completedTypes, new Set([...completed.map(m => m.type), 'bicicleta']));
  assert.equal(MISSION_TEMPLATES.length, 10);
});
