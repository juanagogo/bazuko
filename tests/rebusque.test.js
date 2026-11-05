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

function juego({ items = {}, vehicles = [], higiene = 80 } = {}) {
  const inv = { ...items };
  const stats = { dinero: 0, energia: 100, animo: 50, higiene, xp: 0, addXP(n) { this.xp += n; } };
  return {
    player: { position: pos(0, 0, 0), playBeg() { this.gestos = (this.gestos ?? 0) + 1; } },
    stats,
    inventory: { count: (id) => inv[id] ?? 0, remove: (id, n) => { inv[id] -= n; }, inv },
    traffic: {
      vehicles,
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
  assert.ok(obj.accept({ pesos: 500 }) && !obj.accept({ pesos: 0 }));
});
