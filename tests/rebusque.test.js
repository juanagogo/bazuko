// Rebusque en el semáforo: solo se trabaja a carros quietos en rojo, se cobra al terminar y no si el carro arranca.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { ITEMS, SHOP_ITEMS, isRecyclable } from '../src/data/items.js';
import { REBUSQUE } from '../src/data/rebusque.js';
import { OBJECTIVES } from '../src/data/objectives.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.CustomEvent ??= class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } };
  globalThis.window = { dispatchEvent: (e) => eventos.push(e) };
});

const pos = (x, y, z) => ({ x, y, z });

function juego({ items = {}, vehicles = [], higiene = 80, cars = [], buses = [] } = {}) {
  const inv = { ...items };
  const stats = { dinero: 0, energia: 100, animo: 50, higiene, xp: 0, addXP(n) { this.xp += n; } };
  return {
    cars,
    player: { position: pos(0, 0, 0), playBeg() { this.gestos = (this.gestos ?? 0) + 1; } },
    stats,
    inventory: { count: (id) => inv[id] ?? 0, remove: (id, n) => { inv[id] -= n; }, inv },
    traffic: {
      vehicles,
      busVehicles: buses.map(car => ({ car })),
      stoppedAtRed: (p, r) => vehicles.filter(v => v.speed <= .3 && v.rojo)
        .map(v => ({ vehicle: v, car: v.car, distance: Math.hypot(v.car.position.x - p.x, v.car.position.z - p.z) }))
        .filter(v => v.distance <= r).sort((a, b) => a.distance - b.distance)
    }
  };
}
const carro = (x, z, extra = {}) => ({ car: { position: pos(x, 0, z) }, speed: 0, rojo: true, ...extra });

test('sin herramientas la B sigue siendo limosna', () => {
  const g = juego({ vehicles: [carro(2, 0)] });
  const r = new RebusqueSystem(g);
  r.update(.1);
  assert.equal(r.prompt, null);
  assert.equal(r.intentar(), false);
  assert.ok(eventos.some(e => e.type === 'toast'), 'da una pista una sola vez');
});

test('con carros en verde no hay rebusque aunque haya pelotas', () => {
  const g = juego({ items: { malabares: 1 }, vehicles: [carro(2, 0, { rojo: false })] });
  const r = new RebusqueSystem(g);
  r.update(.1);
  assert.equal(r.prompt, null);
  assert.equal(r.intentar(), false);
});

test('malabares: dura sus segundos, paga a los que dan y avisa al objetivo', () => {
  const vehicles = [carro(2, 0), carro(-3, 4)];
  const g = juego({ items: { malabares: 1 }, vehicles });
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.match(r.prompt, /^\[B\] Hacer malabares/);
  assert.ok(r.intentar());
  assert.equal(g.stats.energia, 100 - REBUSQUE.malabares.energia);
  for (let i = 0; i < 60 && r.activo; i++) r.update(.1);
  assert.ok(!r.activo);
  assert.equal(g.stats.dinero, 2 * REBUSQUE.malabares.paga[0]);
  const fin = eventos.find(e => e.type === 'rebusque');
  assert.deepEqual(fin.detail, { id: 'malabares', pesos: 400, carros: 2 });
  assert.equal(g.inventory.count('malabares'), 1, 'las pelotas no se gastan');
  // El mismo carro no se vuelve a trabajar enseguida.
  r.update(.1);
  assert.equal(r.prompt, null);
  r.update(61);
  r.update(.1);
  assert.ok(r.prompt);
});

test('los dulces se prefieren, se gastan y se venden a mil', () => {
  const g = juego({ items: { dulces: 2, malabares: 1, limpiavidrios: 1 }, vehicles: [carro(1, 0), carro(2, 2), carro(3, 3)] });
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.match(r.prompt, /Vender dulces/);
  r.intentar();
  for (let i = 0; i < 60 && r.activo; i++) r.update(.1);
  assert.equal(g.stats.dinero, 2000, 'solo alcanzaron dos dulces');
  assert.equal(g.inventory.count('dulces'), 0);
});

test('si cambia la luz y el carro arranca, no paga', () => {
  const v = carro(2, 0);
  const g = juego({ items: { limpiavidrios: 1 }, vehicles: [v] });
  const r = new RebusqueSystem(g, { random: () => .99 });
  r.update(.1);
  r.intentar();
  r.update(1);
  v.speed = 4;
  r.update(.1);
  assert.ok(!r.activo);
  assert.equal(g.stats.dinero, 0);
  assert.ok(!eventos.some(e => e.type === 'rebusque'));
});

test('alejarse corta el trabajo', () => {
  const g = juego({ items: { malabares: 1 }, vehicles: [carro(2, 0)] });
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  r.intentar();
  g.player.position.x = 4;
  r.update(.1);
  assert.ok(!r.activo);
  assert.equal(g.stats.dinero, 0);
});

test('el semáforo en rojo se ve desde la cola, no desde el otro lado del cruce', () => {
  const s = new TrafficSignals();
  const node = s.nodes[0];
  const cz = (node.z0 + node.z1) / 2;
  // Busca un instante en que el eje X esté en rojo.
  let t = 0; while (signalState(t, 0) === 0) t += 1;
  s.update(t);
  assert.ok(s.redAhead({ x: node.x0 - 10, z: cz }, { x: 1, z: 0 }), 'acercándose por la izquierda');
  assert.ok(!s.redAhead({ x: node.x0 - 10, z: cz }, { x: -1, z: 0 }), 'alejándose');
  assert.ok(!s.redAhead({ x: node.x0 - 60, z: cz }, { x: 1, z: 0 }), 'muy lejos');
  let verde = 0; while (signalState(verde, 0) !== 0) verde += 1;
  s.update(verde);
  assert.ok(!s.redAhead({ x: node.x0 - 10, z: cz }, { x: 1, z: 0 }), 'en verde');
});

test('TrafficSystem.stoppedAtRed deja por fuera patrullas, carros andando y conductores afuera', () => {
  const t = Object.create(TrafficSystem.prototype);
  const car = (x, yaw = 0) => ({ position: pos(x, 0, 0), group: { rotation: { y: yaw } } });
  t.signals = { redAhead: () => true };
  t.vehicles = [
    { car: car(2), speed: 0, stopped: true },
    { car: car(3), speed: 0, stopped: true, police: true },
    { car: car(4), speed: 5 },
    { car: car(5), speed: .05, stopped: false },
    { car: car(1), speed: 0, stopped: true, hold: true },
    { car: car(20), speed: 0, stopped: true }
  ];
  assert.deepEqual(t.stoppedAtRed(pos(0, 0, 0), 6).map(v => v.car.position.x), [2]);
});

test('las herramientas se compran en la tienda y no se venden como reciclaje', () => {
  for (const id of ['malabares', 'limpiavidrios', 'dulces']) {
    assert.ok(ITEMS[id], id);
    assert.ok(SHOP_ITEMS.some(s => s.item === id), id);
    assert.ok(!isRecyclable(ITEMS[id]), id);
  }
  const dulces = SHOP_ITEMS.find(s => s.item === 'dulces');
  assert.ok(dulces.price / dulces.qty < REBUSQUE.dulces.paga[0], 'vender dulces deja ganancia');
  const obj = OBJECTIVES.find(o => o.id === 'rebusque-semaforo');
  assert.ok(obj.accept({ id: 'malabares', pesos: 500 }) && !obj.accept({ id: 'malabares', pesos: 0 }));
});

const parqueado = (x, z) => ({ position: pos(x, 0, z) });
const bus = (x, z, speed = 0) => ({ position: pos(x, 0, z), speed, heading: { x: 0, z: -1 }, length: 18, width: 2.6 });

test('cuidar carros: con franela y dos parqueados, los dueños dejan propina mientras dura el turno', () => {
  const g = juego({ items: { franela: 1 }, cars: [parqueado(3, 0), parqueado(-4, 2)] });
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.match(r.prompt, /^\[B\] Cuidar los carros/);
  r.intentar();
  for (let i = 0; i < 500 && r.activo; i++) r.update(.1);
  assert.ok(!r.activo);
  assert.equal(r.escena, null, 'el turno que se acaba solo tampoco deja escena');
  const def = REBUSQUE.cuidar;
  assert.equal(g.stats.dinero, Math.floor(def.segundos / def.propinas) * def.paga[0]);
  const fin = eventos.filter(e => e.type === 'rebusque');
  assert.equal(fin.length, 1);
  assert.equal(fin[0].detail.id, 'cuidar');
  // El mismo par de carros no se vuelve a cuidar enseguida.
  r.update(.1);
  assert.equal(r.prompt, null);
});

test('cuidar carros: sin carros cerca no hay puesto, y B deja el puesto con lo ganado', () => {
  const solo = juego({ items: { franela: 1 }, cars: [parqueado(30, 0)] });
  const r1 = new RebusqueSystem(solo);
  r1.update(.1);
  assert.equal(r1.intentar(), false);
  const g = juego({ items: { franela: 1 }, cars: [parqueado(3, 0), parqueado(5, 0)] });
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  r.intentar();
  for (let i = 0; i < 90; i++) r.update(.1);
  assert.ok(r.activo);
  assert.ok(g.stats.dinero > 0, 'ya llegó una propina');
  assert.ok(r.intentar(), 'B es del puesto');
  assert.ok(!r.activo);
  assert.equal(r.escena, null, 'dejar el puesto borra la escena: RebusqueVisual no sigue buscando manos');
  assert.equal(eventos.filter(e => e.type === 'rebusque').at(-1).detail.pesos, g.stats.dinero);
});

test('cuidar carros: el que se maneja no cuenta, y caminar lejos corta el turno', () => {
  const manejado = parqueado(4, 0); manejado.driven = true;
  const g = juego({ items: { franela: 1 }, cars: [manejado] });
  const r = new RebusqueSystem(g);
  r.update(.1);
  assert.equal(r.prompt, null);
  manejado.driven = false;
  r.update(.1);
  r.intentar();
  g.player.position.x = 5;
  r.update(.1);
  assert.ok(r.activo, 'se puede caminar la cuadra');
  g.player.position.x = 12;
  r.update(.1);
  assert.ok(!r.activo);
  assert.ok(eventos.some(e => e.type === 'toast' && /dejé de cuidar/.test(e.detail.text)));
});

test('bus: con el bus detenido al lado se le venden dulces a los pasajeros', () => {
  const g = juego({ items: { dulces: 5 }, buses: [bus(2.5, 4)] });
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.match(r.prompt, /pasajeros del bus/);
  r.intentar();
  for (let i = 0; i < 80 && r.activo; i++) r.update(.1);
  assert.equal(g.stats.dinero, REBUSQUE.bus.carros * 1000);
  assert.equal(g.inventory.count('dulces'), 5 - REBUSQUE.bus.carros);
  assert.equal(eventos.find(e => e.type === 'rebusque').detail.id, 'bus');
});

test('bus: andando no se le vende, lejos de su costado tampoco, y si arranca no paga', () => {
  const andando = juego({ items: { dulces: 5 }, buses: [bus(2.5, 0, 5)] });
  const r1 = new RebusqueSystem(andando); r1.update(.1);
  assert.equal(r1.prompt, null);
  const lejos = juego({ items: { dulces: 5 }, buses: [bus(9, 0)] });
  const r2 = new RebusqueSystem(lejos); r2.update(.1);
  assert.equal(r2.prompt, null);
  const b = bus(2.5, 0);
  const g = juego({ items: { dulces: 5 }, buses: [b] });
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1); r.intentar(); r.update(1);
  b.speed = 3; r.update(.1);
  assert.ok(!r.activo);
  assert.equal(g.stats.dinero, 0);
  assert.equal(g.inventory.count('dulces'), 5);
});

test('los objetivos nuevos cuentan solo su trabajo', () => {
  const cuidar = OBJECTIVES.find(o => o.id === 'cuidar-carros');
  const enBus = OBJECTIVES.find(o => o.id === 'vender-en-bus');
  assert.ok(cuidar.accept({ id: 'cuidar', pesos: 500 }) && !cuidar.accept({ id: 'malabares', pesos: 500 }));
  assert.ok(enBus.accept({ id: 'bus', pesos: 1000 }) && !enBus.accept({ id: 'dulces', pesos: 1000 }));
  // El del semáforo cuenta solo el semáforo: cuidar carros o venderle al bus no lo adelantan.
  const sem = OBJECTIVES.find(o => o.id === 'rebusque-semaforo');
  for (const id of ['dulces', 'vidrios', 'malabares']) assert.ok(sem.accept({ id, pesos: 500 }), id);
  assert.ok(!sem.accept({ id: 'cuidar', pesos: 500 }) && !sem.accept({ id: 'bus', pesos: 1000 }) && !sem.accept({ id: 'dulces', pesos: 0 }));
  assert.ok(SHOP_ITEMS.some(s => s.item === 'franela') && !isRecyclable(ITEMS.franela));
});
