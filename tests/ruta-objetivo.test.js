// La ruta automática de un objetivo se reconoce como suya aunque el GPS la ajuste a la acera (la tienda) y después de
// guardar y cargar; un destino del jugador nunca se reemplaza.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';

const { Bogota } = await import('../src/world/districts/Bogota.js');
const { Game } = await import('../src/core/game.js');

const city = new Bogota();
city.map = city._layout();
city.reserved = {
  shop: { x: STREET_X.world(34), z: STREET_Z.world(29) },
  sell: { x: STREET_X.world(14.5), z: STREET_Z.world(34) }
};
const START = { x: 112.98, z: 97.84 };

function juego(meta, gps = city.createGpsNavigation()) {
  globalThis.window ??= new EventTarget();
  const game = Object.assign(Object.create(Game.prototype), {
    gps, world: { active: city }, player: { position: { ...START } }, showGpsBeacon: false, gpsBeacon: null,
    _objectiveRoute: null, objectives: { finished: false, current: meta },
  });
  return game;
}

test('la ruta a la tienda, que el GPS corre a la acera, sigue siendo del objetivo', () => {
  const game = juego({ id: 'comprar', target: 'shop' });
  assert.equal(game.gps.isRoutable(city.reserved.shop.x, city.reserved.shop.z), false, 'la tienda se ajusta a la acera');
  game.routeToObjective({ silent: true });
  assert.notEqual(game.gps.waypoint.z, city.reserved.shop.z);
  assert.equal(game._isObjectiveRoute(), true);
  // Se cumple en otro lado: el siguiente objetivo va a la recicladora y su ruta reemplaza la de la tienda.
  game.objectives.current = { id: 'vender', target: 'sell' };
  game._activateObjective();
  assert.equal(game.gps.waypoint.x, city.reserved.sell.x);
  assert.equal(game.gps.waypoint.z, city.reserved.sell.z);
  // Un objetivo sin destino borra la ruta vieja.
  game.objectives.current = { id: 'sin-destino' };
  game._activateObjective();
  assert.equal(game.gps.waypoint, null);
});

test('guardar y cargar conserva de quién es la ruta; la del jugador no se toca', () => {
  const game = juego({ id: 'comprar', target: 'shop' });
  game.routeToObjective({ silent: true });
  const guardado = JSON.parse(JSON.stringify(game.gps.serialize()));
  assert.equal(guardado.objetivo, true);
  const cargado = juego({ id: 'comprar', target: 'shop' });
  cargado.setGpsWaypoint(guardado, { silent: true });
  assert.equal(cargado._objectiveRoute, null, 'tras cargar no queda la marca en memoria');
  assert.equal(cargado._isObjectiveRoute(), true);
  cargado.objectives.current = { id: 'vender', target: 'sell' };
  cargado._activateObjective();
  assert.equal(cargado.gps.waypoint.x, city.reserved.sell.x);

  const propio = juego({ id: 'vender', target: 'sell' });
  propio.setGpsWaypoint({ x: 75, z: 225, name: 'Mi punto' }, { silent: true });
  assert.equal(propio.gps.serialize().objetivo, undefined, 'el destino del jugador no lleva la marca');
  propio._activateObjective();
  assert.equal(propio.gps.waypoint.name, 'Mi punto');
});
