import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrugDealer } from '../src/entities/DrugDealer.js';
import {
  FILTERS, NEED_COPY, SHOP_OFFERS, SHOP_PRICES, hasTag, isUsable, needContext, needFor, noOptionText, offersFor, placeMeta,
  pricesFor, rankPlaces, sellFirstPlaces, servicePlaces, suggestPlace, suggestionText,
} from '../src/ui/mapServices.js';

const LA_MONA = ['empanada', 'morcilla', 'papaCriolla', 'aguapanela', 'refresco'];
const CALLEJON = ['cigarrillo', 'pan', 'agua'];
const DULCES = ['cigarrillo', 'refresco', 'agua', 'empanada'];

const HERE = { x: 0, z: 0 };
const fogata = (x, z = 0) => ({ name: 'Fogata de caneca', icon: '🔥', x, z, service: 'fogata', prices: { calor: 0 } });
const dulces = { name: 'Dulces y minutos', icon: '🍬', x: 6, z: 0, service: 'chaza', prices: pricesFor(DULCES) };
const mona = { name: 'Fritanga La Mona', icon: '🥟', x: 30, z: 0, service: 'fritanga', prices: pricesFor(LA_MONA) };
const callejon = { name: 'Chaza del callejón', icon: '🍬', x: 40, z: 0, service: 'chaza', prices: pricesFor(CALLEJON) };
const tienda = { name: 'Tienda La Esquinita', icon: '🏪', x: 27, z: 0, prices: SHOP_PRICES };
const recicladora = { name: 'Recicladora El Progreso', icon: '♻️', x: 72, z: 0, prices: { vender: 0 } };
const dealer = { name: 'Dealer', icon: '💀', x: 90, z: 0, dealer: true };
const gasolinera = { name: 'Gasolinera', icon: '⛽', x: 2, z: 0, decor: true };
const colpatria = { name: 'Torre Colpatria', icon: '🏙️', x: 3, z: 0 };
const chato = { name: 'El Chato', icon: '🐕', x: 1, z: 0 };
const straight = (poi) => Math.hypot(poi.x, poi.z);
// Los mismos puestos con sus kilos, como los arma servicePlaces.
const dulcesKg = { ...dulces, offers: offersFor(DULCES) };
const monaKg = { ...mona, offers: offersFor(LA_MONA) };
const tiendaKg = { ...tienda, offers: SHOP_OFFERS };
const room = (free) => ({ kg: 20 - free, maxKg: 20 });

test('pricesFor da el precio mínimo de cada catálogo, con el mismo filtro de la tienda', () => {
  assert.deepEqual(pricesFor(LA_MONA), { comida: 1000, agua: 1200, calor: 1000 });
  assert.deepEqual(pricesFor(CALLEJON), { comida: 1500, agua: 2000 });
  assert.deepEqual(pricesFor(DULCES), { comida: 1200, agua: 2000, calor: 1200 });
  // Sin lista es la Tienda La Esquinita: la fila del costal, que no es un objeto, no estorba.
  assert.deepEqual(pricesFor(), { comida: 1000, agua: 1200, calor: 1000 });
  assert.deepEqual(SHOP_PRICES, pricesFor());
});

test('offersFor da precio y kilos de cada compra, con el mismo filtro de la tienda', () => {
  assert.deepEqual(offersFor(CALLEJON), { comida: [{ price: 1500, weight: .3 }], agua: [{ price: 2000, weight: .5 }] });
  assert.deepEqual(offersFor(['cigarrillo']), {}, 'lo que no resuelve una necesidad no cuenta');
  assert.deepEqual(SHOP_OFFERS, offersFor());
  assert.ok(Object.values(SHOP_OFFERS).flat().every(({ price, weight }) => price > 0 && weight > 0), 'la fila del costal no es un objeto');
});

test('servicePlaces convierte puestos y fogatas en lugares; sin datos no devuelve nada', () => {
  const district = {
    vendors: [
      { kind: 'shop', stall: 'fritanga', title: 'Fritanga La Mona', items: LA_MONA, position: { x: 1, z: 2 } },
      { kind: 'shop', stall: 'chaza', title: 'Chaza del callejón', items: CALLEJON, position: { x: 3, z: 4 } },
    ],
    fireBarrels: [{ kind: 'fireBarrel', title: 'Fogata de caneca', position: { x: 5, z: 6 } }],
  };
  const [frit, chaza, fire] = servicePlaces(district);
  assert.deepEqual(frit, { name: 'Fritanga La Mona', icon: '🥟', color: '#ff9f43', x: 1, z: 2, service: 'fritanga', prices: pricesFor(LA_MONA), offers: offersFor(LA_MONA) });
  assert.equal(chaza.icon, '🍬');
  assert.equal(chaza.service, 'chaza');
  assert.equal(chaza.prices.calor, undefined);
  assert.deepEqual(fire, { name: 'Fogata de caneca', icon: '🔥', color: '#ff6b35', x: 5, z: 6, service: 'fogata', prices: { calor: 0 } });
  assert.deepEqual(servicePlaces(null), []);
  assert.deepEqual(servicePlaces({}), []);
});

test('needFor prioriza lo que ya hace daño, luego el frío, y usa los umbrales del HUD', () => {
  assert.equal(needFor(), null);
  assert.equal(needFor({ sed: 0, isFreezing: true }), 'agua');
  assert.equal(needFor({ hambre: 0, isFreezing: true }), 'comida');
  assert.equal(needFor({ sed: 0, hambre: 0 }), 'agua');
  assert.equal(needFor({ isFreezing: true, sed: 10, hambre: 10 }), 'calor');
  assert.equal(needFor({ sed: 20, hambre: 20 }), 'agua');
  assert.equal(needFor({ sed: 21, hambre: 20 }), 'comida');
  assert.equal(needFor({ sed: 21, hambre: 21 }), null);
  assert.equal(needFor({ load: .95 }), null, 'con el costal lleno de otra cosa no hay nada que vender');
  assert.equal(needFor({ load: .95, carriesRecyclables: true }), 'vender');
  assert.equal(needFor({ load: .89, carriesRecyclables: true }), null);
});

test('needContext resume el inventario y no falla si faltan datos', () => {
  const carrying = (...ids) => needContext({ inventory: { items: ids.map(id => ({ id })) } });
  assert.equal(carrying('lata').carriesRecyclables, true);
  assert.equal(carrying('madera').carriesRecyclables, false);
  assert.equal(carrying('pegante').carriesSubstances, true);
  assert.equal(carrying('pegante').carriesRecyclables, false);
  assert.equal(carrying('cigarrillo').carriesSubstances, false, 'el dealer no compra cigarrillos');
  assert.deepEqual(carrying('pan', 'agua').carried, { comida: 'Pan duro', agua: 'Botella de agua' });
  assert.deepEqual(carrying('empanada').carried, { comida: 'Empanada con ají', calor: 'Empanada con ají' });
  assert.deepEqual(needContext({}), {
    need: null, money: 0, kg: 0, maxKg: Infinity, carriesRecyclables: false, recycleValue: 0, recycleKg: 0,
    carriesSubstances: false, substanceValue: 0, night: false, carried: {},
  });
  assert.deepEqual(needContext(), needContext({}));
  const bag = needContext({ inventory: { items: [], maxWeight: 40, totalWeight: 39.5 } });
  assert.deepEqual([bag.kg, bag.maxKg], [39.5, 40]);

  const stats = { isFreezing: false, sed: 80, hambre: 80, dinero: 2500 };
  const inventory = { items: [{ id: 'lata' }] };
  assert.equal(needContext({ stats, inventory, load: .95, night: true }).need, 'vender');
  assert.equal(needContext({ stats, inventory, load: .95, night: true }).money, 2500);
  assert.equal(needContext({ stats, inventory, load: .95, night: true }).night, true);
  assert.equal(needContext({ stats: { ...stats, isFreezing: true }, inventory }).need, 'calor');
});

test('needContext calcula lo que dejaría vender, con las cuentas de la recicladora y del Dealer', () => {
  const inventory = { items: [{ id: 'lata', qty: 4 }, { id: 'carton', qty: 1 }, { id: 'pegante', qty: 2 }, { id: 'madera', qty: 3 }], remove() {} };
  const bag = needContext({ inventory });
  assert.equal(bag.recycleValue, 1200, 'el material de construcción no se vende');
  assert.ok(Math.abs(bag.recycleKg - 1.3) < 1e-9, `${bag.recycleKg}`);
  assert.equal(needContext({ inventory, sellMult: 1.15 }).recycleValue, 1380, 'el origen cambia lo que paga la recicladora');
  // Si el Dealer cambia lo que paga, el radar prometería plata que no existe.
  const { earned } = DrugDealer.prototype.sellSubstances.call(null, inventory, true, 1.5);
  assert.equal(needContext({ inventory, substanceMult: 1.5 }).substanceValue, earned);
});

test('needContext no promete plata por el arma que el jugador lleva en la mano', () => {
  const bag = (items, equippedWeapon) => needContext({ inventory: { items }, equippedWeapon });
  const both = [{ id: 'cuchillo', qty: 1 }, { id: 'lata', qty: 1 }];
  assert.equal(bag(both, 'cuchillo').recycleValue, bag([{ id: 'lata', qty: 1 }]).recycleValue);
  assert.ok(bag(both).recycleValue > bag(both, 'cuchillo').recycleValue, 'guardada sí se vende');
  assert.equal(bag([{ id: 'cuchillo', qty: 1 }], 'cuchillo').carriesRecyclables, false);
  assert.equal(bag([{ id: 'cuchillo', qty: 1 }], 'puños').carriesRecyclables, true);
});

test('hasTag: el Dealer aparece en «Vender» aunque no tenga precio; lo decorativo en ningún filtro', () => {
  assert.equal(hasTag(fogata(1), 'calor'), true, 'un precio de 0 es gratis, no ausente');
  assert.equal(hasTag(fogata(1), 'agua'), false);
  assert.equal(hasTag(dealer, 'vender'), true);
  assert.equal(hasTag(dealer, 'calor'), false);
  assert.equal(hasTag(recicladora, 'vender'), true);
  for (const [id] of FILTERS.slice(1)) assert.equal(hasTag(gasolinera, id), false);
});

test('el radar sugiere lo más cercano que se puede pagar', () => {
  const pois = [fogata(75), fogata(90), dulces, mona, callejon, tienda, recicladora, dealer, gasolinera, colpatria];
  const place = (needs) => suggestPlace(pois, HERE, needs);
  assert.equal(place({ need: null }), null);
  assert.equal(place({}), null);

  const freezingBroke = place({ need: 'calor', money: 0 });
  assert.equal(freezingBroke.poi.name, 'Fogata de caneca', 'sin plata, la fogata gana aunque la chaza quede al lado');
  assert.equal(freezingBroke.poi.x, 75);
  assert.equal(freezingBroke.dist, 75);
  assert.equal(freezingBroke.price, 0);
  assert.equal(suggestionText(freezingBroke, '← Izquierda', '75m'), '🔥 Fogata de caneca\nCalor gratis, 75m, ← Izquierda');

  const freezing = place({ need: 'calor', money: 1200 });
  assert.equal(freezing.poi, dulces);
  assert.equal(suggestionText(freezing, '→ Derecha', '6m'), '🍬 Dulces y minutos\nCalor $ 1.200, 6m, → Derecha');
  assert.equal(place({ need: 'calor', money: 1000 }).poi, tienda, 'con $ 1.000 alcanza la papa criolla de la Tienda');

  assert.equal(suggestionText(place({ need: 'agua', money: 2000 }), '→ Derecha', '6m'), '🍬 Dulces y minutos\nAgua $ 2.000, 6m, → Derecha');
  assert.equal(suggestionText(place({ need: 'comida', money: 1200 }), '→ Derecha', '6m'), '🍬 Dulces y minutos\nComida $ 1.200, 6m, → Derecha');
});

test('el radar sabe qué decir sin plata, con el costal lleno y si ya llevas con qué', () => {
  const pois = [fogata(75), dulces, mona, tienda, recicladora, dealer];
  const broke = suggestPlace(pois, HERE, { need: 'agua', money: 0 });
  assert.deepEqual(broke, { tag: 'agua', broke: true, price: 1200 });
  assert.equal(suggestionText(broke), '💸 Sin plata para agua\nDesde $ 1.200, pida limosna (B)');

  const sell = suggestPlace(pois, HERE, { need: 'agua', money: 0, carriesRecyclables: true, recycleValue: 1200, recycleKg: 1 });
  assert.equal(sell.poi, recicladora);
  assert.equal(sell.sellFirst, true);
  assert.equal(suggestionText(sell, '← Izquierda', '72m'), '♻️ Recicladora El Progreso\nSin plata: venda, 72m, ← Izquierda');

  const full = suggestPlace(pois, HERE, { need: 'vender', money: 0, carriesRecyclables: true });
  assert.equal(full.poi, recicladora, 'el Dealer no compra reciclaje');
  assert.equal(suggestionText(full, '← Izquierda', '72m'), '♻️ Recicladora El Progreso\nCostal lleno, 72m, ← Izquierda');

  const carried = suggestPlace(pois, HERE, { need: 'agua', money: 50000, carried: { agua: 'Botella de agua' } });
  assert.deepEqual(carried, { tag: 'agua', carried: 'Botella de agua' });
  assert.equal(suggestionText(carried), '🎒 Llevo: Botella de agua\nUsar desde el costal (I)');

  assert.equal(suggestPlace([dealer, gasolinera], HERE, { need: 'vender', carriesRecyclables: true }), null);
  assert.equal(suggestPlace([gasolinera, colpatria], HERE, { need: 'comida', money: 99999 }), null, 'nunca sugiere lo decorativo');
});

test('el radar no manda a comprar lo que no cabe en el costal', () => {
  const pois = [fogata(75), dulcesKg, monaKg, tiendaKg, recicladora];
  const place = (needs) => suggestPlace(pois, HERE, needs);

  const sell = place({ need: 'agua', money: 5000, ...room(.1), carriesRecyclables: true, recycleValue: 1000, recycleKg: 2 });
  assert.equal(sell.poi, recicladora);
  assert.equal(sell.sellFirst, true);
  assert.equal(sell.full, true);
  assert.equal(suggestionText(sell, '← Izquierda', '72m'), '♻️ Recicladora El Progreso\nCostal lleno: venda, 72m, ← Izquierda');

  const full = place({ need: 'agua', money: 5000, ...room(.1) });
  assert.deepEqual(full, { tag: 'agua', full: true, price: 1200 });
  assert.equal(suggestionText(full), '🎒 Sin espacio para agua\nTire algo del costal (I)');

  assert.deepEqual(place({ need: 'agua', money: 0, ...room(.1) }), { tag: 'agua', broke: true, price: 1200 }, 'sin plata, lo primero es la plata');
  assert.equal(place({ need: 'calor', money: 0, ...room(0) }).poi.name, 'Fogata de caneca', 'calentarse no ocupa espacio');
  assert.equal(place({ need: 'vender', money: 0, ...room(0), carriesRecyclables: true }).poi, recicladora, 'vender tampoco');

  // La más cercana donde quepa algo, y su precio es el de lo que cabe.
  const fits = place({ need: 'comida', money: 5000, ...room(.2) });
  assert.equal(fits.poi, dulcesKg);
  assert.equal(fits.price, 1200);
  const fried = suggestPlace([monaKg], HERE, { need: 'comida', money: 5000, ...room(.2) });
  assert.equal(fried.price, 1200, 'la papa de $ 1.000 pesa más que la empanada');
  assert.deepEqual(suggestPlace([monaKg], HERE, { need: 'comida', money: 1000, ...room(.2) }), { tag: 'comida', full: true, price: 1000 },
    'lo que alcanza no cabe y lo que cabe no alcanza: hay que hacer espacio');

  // Con plata de sobra el precio es el de lo más barato, aunque otra oferta salga después en el catálogo.
  assert.equal(suggestPlace([tiendaKg], HERE, { need: 'comida', money: 10000 }).price, 1000);
  // Basta que un puesto tenga lo que alcanza: el otro, sin nada al alcance, no borra el motivo.
  assert.deepEqual(suggestPlace([monaKg, dulcesKg], HERE, { need: 'agua', money: 1500, ...room(.1) }), { tag: 'agua', full: true, price: 1200 });
});

test('el radar usa la misma cuenta del costal que la tienda, aunque la resta dé 0,1999…', () => {
  assert.ok(20 - 19.8 < .2 && 19.8 + .2 <= 20, 'el caso que esta prueba necesita');
  const exact = { need: 'comida', money: 5000, kg: 19.8, maxKg: 20 };
  assert.equal(suggestPlace([dulcesKg, recicladora], HERE, { ...exact, carriesRecyclables: true, recycleValue: 5000, recycleKg: 2 }).poi, dulcesKg);
  assert.equal(isUsable(monaKg, 'comida', exact), true);
  // Al soltar la carreta se puede llevar más de lo permitido: lo que no pesa sigue sirviendo.
  const over = { money: 5000, kg: 30, maxKg: 20 };
  assert.equal(isUsable(fogata(1), 'calor', over), true);
  assert.equal(isUsable(recicladora, 'vender', { ...over, carriesRecyclables: true }), true);
  assert.equal(isUsable(monaKg, 'comida', over), false);
});

test('el radar solo manda a vender si con lo que cobras te alcanza y te cabe', () => {
  const pois = [fogata(75), dulcesKg, monaKg, tiendaKg, recicladora, dealer];
  const place = (needs) => suggestPlace(pois, HERE, { need: 'agua', carriesRecyclables: true, ...needs });

  const little = { money: 0, recycleValue: 600, recycleKg: 1 };
  assert.deepEqual(place(little), { tag: 'agua', broke: true, price: 1200 }, '$ 600 no pagan el agua: el viaje no sirve');
  assert.equal(place({ ...little, recycleValue: 1200 }).poi, recicladora);
  assert.equal(place({ ...little, money: 600 }).poi, recicladora, 'lo que traes y lo que cobras se suman');

  const coin = { money: 5000, ...room(.18), recycleValue: 12000, recycleKg: .02 };
  assert.deepEqual(place(coin), { tag: 'agua', full: true, price: 1200 }, 'vender una moneda no hace sitio');
  assert.equal(place({ ...coin, recycleKg: 1 }).sellFirst, true);
  assert.deepEqual(place({ money: 0, ...room(.1), recycleValue: 5000, recycleKg: .1 }), { tag: 'agua', broke: true, price: 1200 }, 'alcanza, pero sigue sin caber');
});

test('sin plata, de noche y con sustancias, manda al Dealer si paga lo suficiente', () => {
  const pois = [dulcesKg, monaKg, recicladora, dealer];
  const broke = { tag: 'comida', broke: true, price: 1000 };
  const night = { need: 'comida', money: 0, carriesSubstances: true, substanceValue: 5400, night: true };
  const sell = suggestPlace(pois, HERE, night);
  assert.equal(sell.poi, dealer);
  assert.equal(sell.sellFirst, true);
  assert.equal(suggestionText(sell, '', '90m'), '💀 Dealer\nSin plata: venda, 90m');
  assert.deepEqual(suggestPlace(pois, HERE, { ...night, night: false }), broke, 'de día no compra');
  assert.deepEqual(suggestPlace(pois, HERE, { ...night, substanceValue: 450 }), broke, 'una hierba no paga la comida');
  assert.deepEqual(suggestPlace(pois, HERE, { ...night, money: 5000, ...room(.1) }), { tag: 'comida', full: true, price: 1000 }, 'apenas libera peso');
  const both = { ...night, carriesRecyclables: true, recycleValue: 5000, recycleKg: 1 };
  assert.deepEqual(sellFirstPlaces(pois, 'comida', both), [recicladora, dealer]);
  assert.deepEqual(sellFirstPlaces(pois, 'comida', { money: 5000, night: true }), [], 'sin nada que vender no hay a dónde ir');
  assert.equal(suggestPlace(pois, HERE, both).poi, recicladora, 'de los dos, el más cercano');
  assert.equal(suggestPlace([dulcesKg, recicladora, { ...dealer, x: 50 }], HERE, both).poi.name, 'Dealer');
});

test('isUsable: dinero para lo que se compra, material o noche para lo que se vende', () => {
  assert.equal(isUsable(dulces, null, {}), true);
  assert.equal(isUsable(dulces, 'calor', { money: 1199 }), false);
  assert.equal(isUsable(dulces, 'calor', { money: 1200 }), true);
  assert.equal(isUsable(fogata(1), 'calor', { money: 0 }), true);
  assert.equal(isUsable(colpatria, 'calor', { money: 99999 }), false);
  assert.equal(isUsable(recicladora, 'vender', { carriesRecyclables: true }), true);
  assert.equal(isUsable(recicladora, 'vender', {}), false);
  assert.equal(isUsable(dealer, 'vender', { carriesRecyclables: true, night: true }), false, 'el Dealer no compra reciclaje');
  assert.equal(isUsable(dealer, 'vender', { carriesSubstances: true, night: false }), false);
  assert.equal(isUsable(dealer, 'vender', { carriesSubstances: true, night: true }), true);
  // El costal cuenta como en la tienda: hace falta algo que se pueda pagar y que quepa.
  assert.equal(isUsable(monaKg, 'comida', { money: 1000, ...room(.25) }), true);
  assert.equal(isUsable(monaKg, 'comida', { money: 1000, ...room(.2) }), false);
  assert.equal(isUsable(monaKg, 'comida', { money: 1200, ...room(.2) }), true);
  assert.equal(isUsable(fogata(1), 'calor', { money: 0, ...room(0) }), true);
  assert.equal(isUsable(recicladora, 'vender', { carriesRecyclables: true, ...room(0) }), true);
});

test('rankPlaces ordena a pie, une las fogatas en una fila y pone primero lo que se puede usar', () => {
  // La fogata (10) está más cerca en recta, pero a pie gana la de x 40.
  const near = fogata(10), far = fogata(40);
  const meters = new Map([[near, 90], [far, 45], [dulces, 8], [mona, 33], [tienda, 36], [recicladora, 73], [dealer, 80], [gasolinera, 55], [colpatria, null], [chato, 1]]);
  const walk = (poi) => meters.get(poi);
  const pois = [near, far, dulces, mona, tienda, recicladora, dealer, gasolinera, colpatria, chato];

  const all = rankPlaces(pois, { walk, from: HERE });
  assert.deepEqual(all.map(row => row.poi.name), ['Dulces y minutos', 'Fritanga La Mona', 'Tienda La Esquinita', 'Fogata de caneca', 'Gasolinera', 'Recicladora El Progreso', 'Dealer', 'Torre Colpatria']);
  assert.equal(all.find(row => row.poi.name === 'Fogata de caneca').poi, far);
  assert.equal(all.at(-1).meters, null, 'lo que no tiene camino va al final');
  assert.ok(all.every(row => row.usable), 'sin filtro todo se puede elegir');

  const heat = rankPlaces(pois, { tag: 'calor', walk, needs: { money: 0 }, from: HERE });
  assert.deepEqual(heat.map(row => [row.poi.name, row.usable]),
    [['Fogata de caneca', true], ['Dulces y minutos', false], ['Fritanga La Mona', false], ['Tienda La Esquinita', false]]);

  const sell = rankPlaces(pois, { tag: 'vender', walk, needs: { carriesSubstances: true, night: true }, from: HERE });
  assert.deepEqual(sell.map(row => [row.poi.name, row.usable]), [['Dealer', true], ['Recicladora El Progreso', false]]);
  assert.deepEqual(rankPlaces(pois, { tag: 'vender', walk, needs: {}, from: HERE }).map(row => row.usable), [false, false]);
});

test('rankPlaces sin camino ordena en recta y no pierde la fogata más cercana', () => {
  const near = fogata(10), far = fogata(40);
  const rows = rankPlaces([far, near, dulces, mona], { walk: () => null, from: HERE });
  assert.deepEqual(rows.map(row => row.poi.name), ['Dulces y minutos', 'Fogata de caneca', 'Fritanga La Mona']);
  assert.equal(rows[1].poi, near);
  assert.ok(rows.every(row => row.meters === null));
  // Una fogata con camino gana a otra sin camino, aunque esta quede más cerca en recta.
  assert.equal(rankPlaces([near, far], { walk: poi => (poi === far ? 200 : null), from: HERE })[0].poi, far);
  assert.deepEqual(rankPlaces([], { walk: straight }), []);
});

test('placeMeta dice qué ofrece cada lugar y desde qué precio', () => {
  assert.equal(placeMeta(fogata(1)), 'Calor gratis, El Cartucho');
  assert.equal(placeMeta(fogata(1), 'calor', { money: 0 }), 'Calor gratis, El Cartucho');
  assert.equal(placeMeta(mona), 'Comida, agua, calor, desde $ 1.000');
  assert.equal(placeMeta(callejon), 'Comida, agua, desde $ 1.500');
  assert.equal(placeMeta(tienda), 'Comida, agua, calor, desde $ 1.000');
  assert.equal(placeMeta(dulces, 'calor', { money: 1200 }), 'Calor desde $ 1.200');
  assert.equal(placeMeta(dulces, 'calor', { money: 1199 }), 'Calor desde $ 1.200, sin plata');
  assert.equal(placeMeta(recicladora), 'Compra reciclaje');
  assert.equal(placeMeta(recicladora, 'vender'), 'Compra reciclaje');
  assert.equal(placeMeta(dealer, null, { night: true }), 'Vende siempre. Compra hasta las 6:00');
  assert.equal(placeMeta(dealer, null, { night: false }), 'Vende siempre. Compra desde las 20:00');
  assert.equal(placeMeta(monaKg, 'comida', { money: 5000, ...room(.1) }), 'Comida desde $ 1.000, no cabe');
  assert.equal(placeMeta(monaKg, 'comida', { money: 1000, ...room(.2) }), 'Comida desde $ 1.000, no cabe');
  assert.equal(placeMeta(monaKg, 'comida', { money: 999, ...room(.1) }), 'Comida desde $ 1.000, sin plata');
  assert.equal(placeMeta(gasolinera), 'Solo referencia, no vende');
  assert.equal(placeMeta({ name: 'Crafteo', icon: '🔨', x: 1, z: 0 }), 'Se abre con C, desde cualquier sitio');
  assert.equal(placeMeta(colpatria), null);
  assert.equal(placeMeta(chato), null);
});

test('con el Dealer como destino, radar y texto hablan de plata: él no compra material ni libera el costal', () => {
  // Lo que alcanza no cabe y lo que cabe no alcanza: con lo del Dealer sí se puede comprar lo liviano.
  const stall = { name: 'Fritanga', icon: '🥟', x: 6, z: 0, prices: { comida: 1000 }, offers: { comida: [{ price: 1000, weight: .25 }, { price: 1200, weight: .2 }] } };
  const needs = { need: 'comida', money: 1000, kg: 19.79, maxKg: 20, carriesRecyclables: true, carriesSubstances: true, substanceValue: 5400, night: true };

  const sell = suggestPlace([stall, dealer], HERE, needs);
  assert.equal(sell.poi, dealer);
  assert.equal(sell.full, false);
  assert.equal(suggestionText(sell, '', '90m'), '💀 Dealer\nSin plata: venda, 90m');

  const rows = [{ poi: stall }];
  assert.equal(noOptionText('comida', rows, needs, dealer), 'Lo que alcanza no cabe: venda sustancias o tire algo.');
  assert.equal(noOptionText('comida', rows, { ...needs, carriesRecyclables: false }, dealer), 'Lo que alcanza no cabe: venda sustancias o tire algo.');
  assert.equal(noOptionText('comida', rows, needs, recicladora), 'No cabe en el costal: venda material o tire algo.');
  assert.equal(noOptionText('comida', rows, needs), 'No cabe en el costal: venda material o tire algo.', 'sin destino no cambia');
});

test('noOptionText explica por qué no hay botón', () => {
  const rows = [{ poi: dulces }, { poi: mona }];
  assert.equal(noOptionText('agua', rows, {}), 'No alcanza: agua desde $ 1.200. Pida limosna (B).', 'sin nada que vender no lo aconseja');
  assert.equal(noOptionText('agua', rows, { carriesRecyclables: true }), 'No alcanza: agua desde $ 1.200. Venda material o pida limosna (B).');
  assert.equal(noOptionText('agua', rows, { carriesSubstances: true, night: true }), 'No alcanza: agua desde $ 1.200. Venda sustancias o pida limosna (B).');
  assert.equal(noOptionText('agua', rows, { carriesSubstances: true, night: false }), 'No alcanza: agua desde $ 1.200. Pida limosna (B).');
  const carriesBoth = { carriesRecyclables: true, carriesSubstances: true, night: true };
  assert.equal(noOptionText('agua', rows, carriesBoth, dealer), 'No alcanza: agua desde $ 1.200. Venda sustancias o pida limosna (B).', 'el botón lleva al Dealer');
  assert.equal(noOptionText('agua', rows, carriesBoth, recicladora), 'No alcanza: agua desde $ 1.200. Venda material o pida limosna (B).', 'el botón lleva a la recicladora');
  assert.equal(noOptionText('agua', rows, { money: 1200 }), 'No cabe en el costal: tire algo.');
  assert.equal(noOptionText('agua', rows, { money: 1200, carriesRecyclables: true }), 'No cabe en el costal: venda material o tire algo.');
  assert.equal(noOptionText('vender', [{ poi: recicladora }], {}), 'No llevo nada que me compren.');
  assert.equal(noOptionText('vender', [{ poi: dealer }], { carriesSubstances: true, night: false }), 'El jíbaro solo compra de noche, desde las 20:00.');
  assert.equal(noOptionText('agua', [], {}), null);
});

test('ningún texto usa «·» y ninguna fila repite los nombres que buscan las pruebas de navegador', () => {
  const needs = { money: 0, night: true };
  const texts = [
    ...Object.values(NEED_COPY).flatMap(copy => [copy.label, copy.alert, copy.cta]),
    ...FILTERS.map(([, label]) => label),
    ...[fogata(1), dulces, mona, callejon, tienda, recicladora, dealer, gasolinera].flatMap(poi => [placeMeta(poi), placeMeta(poi, null, needs)]),
    placeMeta(dulces, 'calor', needs),
    placeMeta(monaKg, 'comida', { money: 5000, ...room(0) }),
    placeMeta({ name: 'Crafteo', icon: '🔨', x: 1, z: 0 }),
    suggestionText({ tag: 'agua', broke: true, price: 1200 }),
    suggestionText({ tag: 'agua', full: true, price: 1200 }),
    suggestionText({ tag: 'agua', carried: 'Botella de agua' }),
    suggestionText({ tag: 'calor', poi: fogata(1), price: 0 }, '← Izquierda', '75m'),
    suggestionText({ tag: 'agua', poi: recicladora, sellFirst: true, price: 1200 }, '← Izquierda', '72m'),
    suggestionText({ tag: 'agua', poi: recicladora, sellFirst: true, full: true, price: 1200 }, '← Izquierda', '72m'),
    noOptionText('agua', [{ poi: dulces }], {}),
    noOptionText('agua', [{ poi: dulces }], { money: 5000 }),
    noOptionText('agua', [{ poi: dulces }], { money: 5000, carriesRecyclables: true }),
    noOptionText('agua', [{ poi: dulces }], { money: 5000 }, dealer),
    noOptionText('agua', [{ poi: dulces }], { carriesSubstances: true, night: true }),
    noOptionText('vender', [{ poi: recicladora }], {}),
    noOptionText('vender', [{ poi: dealer }], { carriesSubstances: true }),
  ];
  for (const text of texts) assert.ok(!text.includes('·'), text);
  for (const poi of [fogata(1), dulces, mona, callejon, tienda, recicladora, dealer, gasolinera]) {
    assert.doesNotMatch(placeMeta(poi), /recicladora|torre colpatria/i);
  }
});
