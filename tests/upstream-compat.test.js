import test from 'node:test';
import assert from 'node:assert/strict';
import { RadioSystem } from '../src/systems/RadioSystem.js';
import { ITEMS, isUsable } from '../src/data/items.js';
import { Game } from '../src/core/game.js';
import { SHOP_OFFERS, SHOP_PRICES } from '../src/ui/mapServices.js';

test('radio combina volumen propio, volumen general, silencio y pausa', () => {
  const radio = new RadioSystem();
  radio._masterGain = { gain: { value: 0 } };
  radio.setVolume(.8);
  radio.setMasterVolume(.5);
  assert.equal(radio._masterGain.gain.value, .4);
  radio.setMasterVolume(.5, true);
  radio.setVolume(.6);
  assert.equal(radio._masterGain.gain.value, 0);
  radio.setMasterVolume(.5, false);
  radio.setPaused(true);
  assert.equal(radio._masterGain.gain.value, 0);
  radio.setPaused(false);
  assert.equal(radio._masterGain.gain.value, .3);
});

test('inventario permite usar los nuevos objetos y conserva sus iconos', () => {
  for (const id of ['radioTransistor', 'pilas', 'popo']) {
    assert.equal(isUsable(ITEMS[id]), true);
    assert.notEqual(ITEMS[id].emoji, '📦');
  }
  assert.equal(isUsable(ITEMS.carton), false);
});

test('radar reutiliza el caché sin congelar la posición del perro ni duplicar el cambuche', () => {
  const game = Object.assign(Object.create(Game.prototype), {
    cambuche: { position: { x: 112.98, z: 94.64 } },
    world: { active: { reserved: { bed: { x: 1, z: 1 } } } },
    dog: { isFriend: false, position: { x: 4, z: 5 } }
  });
  assert.equal(game._getPOIs(1000).length, 1);
  game.dog.isFriend = true;
  const points = game._getPOIs(1010);
  assert.equal(points.length, 2);
  game.dog.position.x = 8;
  assert.equal(game._getPOIs(1020), points);
  assert.equal(points[1].x, 8);
  assert.equal(points[0].x, 112.98);
});

test('radar: puestos y fogatas van antes que los lugares fijos, con precios, kilos y necesidad del jugador', () => {
  const position = { x: 0, z: 0 };
  const vendor = { stall: 'fritanga', title: 'Fritanga', items: ['empanada'], position: { x: 1, z: 1 } };
  const game = Object.assign(Object.create(Game.prototype), {
    world: { active: { vendors: [vendor], fireBarrels: [{ title: 'Fogata de caneca', position: { x: 2, z: 2 } }] } },
    sellPoint: { position }, shop: { position }, dealer: { position },
    stats: { isFreezing: true, sed: 80, hambre: 80, dinero: 700 },
    inventory: { items: [], maxWeight: 40, totalWeight: 39 },
  });
  const pois = game._getPOIs(1000);
  assert.deepEqual(pois.map(poi => poi.name), ['Fritanga', 'Fogata de caneca', 'Recicladora El Progreso', 'Tienda La Esquinita', 'Dealer']);
  assert.equal(pois[0].offers.comida[0].weight, ITEMS.empanada.weight);
  assert.equal(pois[3].prices.comida, SHOP_PRICES.comida);
  assert.deepEqual(pois[3].offers, SHOP_OFFERS, 'sin esto, la Tienda parecería tener espacio siempre');
  assert.equal(pois[4].dealer, true);
  assert.equal(game._needs.need, 'calor');
  assert.equal(game._needs.money, 700);
  assert.deepEqual([game._needs.kg, game._needs.maxKg], [39, 40]);
});

test('radar: el contexto de necesidades recibe carga, hora y lo que pagan por vender', () => {
  const position = { x: 0, z: 0 };
  const game = Object.assign(Object.create(Game.prototype), {
    world: { active: { vendors: [], fireBarrels: [] } },
    sellPoint: { position }, shop: { position }, dealer: { position },
    player: { load: .95 }, clock: { isNight: true },
    look: { origen: 'endeudado' }, talents: { getEffect: (key, base) => (key === 'substancePriceMult' ? 2 : base) },
    stats: { isFreezing: false, sed: 80, hambre: 80, dinero: 0 },
    inventory: { items: [{ id: 'lata', qty: 4 }, { id: 'pegante', qty: 1 }] },
  });
  const pois = game._getPOIs(1000);
  assert.equal(game._needs.need, 'vender', 'sin la carga, el costal lleno nunca sería una necesidad');
  assert.equal(game._needs.night, true, 'sin la hora, el Dealer no se ofrecería de noche');
  assert.equal(game._needs.recycleValue, 1150, 'este origen vende 15 % más caro');
  assert.equal(game._needs.substanceValue, 3000 * 1.8 * 2, 'de noche paga 1,8 veces, y este talento lo dobla');
  assert.equal(pois[0].prices.vender, 0, 'sin este precio, la recicladora desaparece de «Vender» y de «vende primero»');
});

test('un destino guardado con el nombre anterior recupera el del letrero', () => {
  const stub = { deserialize() {} };
  const load = (gps) => {
    const marked = [];
    const game = Object.assign(Object.create(Game.prototype), {
      stats: stub, clock: stub, inventory: stub, talents: stub, diseases: stub, player: {}, gps: {},
      save: { load: () => ({ stats: {}, clock: {}, gps }) },
      setGpsWaypoint: (waypoint, options) => marked.push([waypoint, options]),
    });
    game._loadIfSave();
    return marked;
  };
  assert.deepEqual(load({ name: 'Recicladora', icon: '♻️', x: 1, z: 2 }), [[{ name: 'Recicladora El Progreso', icon: '♻️', x: 1, z: 2 }, { silent: true }]]);
  assert.equal(load({ name: 'Tienda', x: 1, z: 2 })[0][0].name, 'Tienda La Esquinita');
  assert.equal(load({ name: 'Punto marcado', x: 1, z: 2 })[0][0].name, 'Punto marcado');
  assert.deepEqual(load(undefined), []);
});
