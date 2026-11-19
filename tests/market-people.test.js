import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Clock } from '../src/core/Clock.js';
import { PLAYER_RADIUS, PLAYER_SPEED_WALK } from '../src/utils/constants.js';
import { buildCity, loadTree } from '../tools/peatones/montaje.mjs';

test('los vecinos llegan al mercado desde sus rutas y la visita vuelve después de que llegue el jugador', async t => {
  const { random } = Math, { now } = performance, browser = globalThis.window;
  const dt = 1 / 30;
  let elapsed = 0;
  globalThis.window = new EventTarget();
  performance.now = () => elapsed * 1000;
  t.after(() => {
    Math.random = random;
    performance.now = now;
    if (browser === undefined) delete globalThis.window;
    else globalThis.window = browser;
  });

  const tree = await loadTree(fileURLToPath(new URL('../', import.meta.url)));
  const { THREE } = tree;
  const { city, collisions, scene, traffic } = await buildCity(tree, 89123);
  t.after(() => city.dispose(scene));
  const clock = new Clock();
  const people = [...city.npcs];
  const homes = people.map(npc => npc.home.clone());
  const previous = people.map(npc => npc.position.clone());
  const visits = new Map();
  const { x, z } = city.reserved.respawn;
  const player = new THREE.Vector3(x, city.getMovementGroundHeight(x, z, 0), z);

  function update() {
    if (visits.size < 2) people.forEach((npc, index) => previous[index].copy(npc.position));
    elapsed += dt;
    clock.update(dt);
    city.update(dt, player, null, traffic.vehicles);
    traffic.update(dt, { player, pedestrians: city.trafficPedestrians, hour: clock.hour });
    people.forEach((npc, index) => {
      const visit = npc.walkVisit;
      if (!visit) return;
      if (!visits.has(npc)) {
        assert.ok(!npc.fijo && !npc.isVendor);
        assert.ok(npc.home.equals(homes[index]), 'conserva su domicilio de barrio');
        assert.ok(previous[index].distanceTo(visit.spot) > 1, 'el ensayo tiene recorrido desde otro andén');
        assert.ok(previous[index].distanceTo(npc.position) < .16, 'empieza en su posición del cuadro anterior');
        visits.set(npc, { stays: [], atSpot: false });
      }
      const observed = visits.get(npc), distance = npc.position.distanceTo(visit.spot);
      if (!observed.atSpot && distance < .14 && !npc.moving && npc.stance === visit.stance) {
        observed.stays.push(elapsed);
        observed.atSpot = true;
      } else if (distance > .6) observed.atSpot = false;
    });
  }

  // La partida ya lleva andando un rato antes de salir de Cambuche.
  for (let frame = 0; frame < 90 / dt; frame++) update();
  assert.equal(visits.size, 0, 'lejos de la plaza aún no hay visitas del mercado');
  const north = city._eastMarket.colliders[1], south = city._eastMarket.colliders[4];
  const aisle = { x: (north.x + south.x) / 2 + 1, z: (north.z + south.z) / 2 };
  const path = city.createGpsNavigation().findPath(player, aisle);
  assert.ok(path?.length, 'el pasillo tiene ruta desde Cambuche');
  const delta = new THREE.Vector3(), result = delta.clone();
  const walkingFrom = elapsed;
  for (const point of [...path, aisle]) {
    while (Math.hypot(point.x - player.x, point.z - player.z) > .03) {
      assert.ok(elapsed - walkingFrom < 150, 'la ruta GPS se puede recorrer a pie');
      delta.set(point.x - player.x, 0, point.z - player.z).clampLength(0, PLAYER_SPEED_WALK * dt);
      collisions.resolveMove(player, delta, PLAYER_RADIUS, result);
      player.copy(result);
      player.y = city.getMovementGroundHeight(player.x, player.z, player.y);
      update();
    }
  }

  assert.equal(visits.size, 2, 'ambas idas empiezan antes de llegar al pasillo');
  const arrival = elapsed;
  for (let frame = 0; frame < 65 / dt; frame++) update();
  const customer = [...visits].find(([npc]) => npc.walkVisit?.stance === 'mirar-surtido')?.[1];
  assert.ok(customer?.stays.length >= 2 && customer.stays.at(-1) > arrival,
    'la visita mira el surtido, se aleja y vuelve durante la estancia del jugador');
});
