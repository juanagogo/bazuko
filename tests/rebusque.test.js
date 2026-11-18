// Rebusque en el semáforo: malabares solo a carros quietos en rojo, con las pelotas en el costal; se cobra al terminar,
// en múltiplos de $100, y no si el carro arranca o el jugador se va. Usa los semáforos y stoppedAtRed de verdad.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { REBUSQUE } from '../src/data/rebusque.js';
import { montoDe } from '../src/systems/rebusque/reacciones.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.CustomEvent ??= class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } };
  globalThis.window = { dispatchEvent: e => eventos.push(e) };
});
const avisos = () => eventos.filter(e => e.type === 'toast').map(e => e.detail.text);

/** Primer instante en que el eje X lleva `rojo` segundos para el verde, o está en verde. */
function instante({ rojo = null, verde = false } = {}) {
  for (let t = 0; t < 72; t += .25) {
    if (verde) { if (signalState(t, 0) === 0) return t; continue; }
    if (signalState(t, 0) !== 0 && Math.abs((36 - t % 36) - rojo) < 1e-9) return t;
  }
  throw new Error('sin instante');
}

/**
 * Juego mínimo con los semáforos de la ciudad: una cola de carros hacia +X detenida antes del primer cruce, y el
 * jugador a 3,2 m delante de la trompa del primero. `rojo`: segundos que le quedan al rojo.
 */
function juego({ items = { malabares: 1 }, rojo = 16, verde = false, cola = 2, higiene = 80 } = {}) {
  const signals = new TrafficSignals();
  signals.update(instante({ rojo, verde }));
  const node = signals.nodes[0];
  const z = node.z0 + 4.3, x0 = node.x0 - 8;
  const vehicles = [];
  for (let i = 0; i < cola; i++) {
    const car = { position: { x: x0 - 5.5 * i, y: 0, z }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, kind: 'carro' };
    vehicles.push({ car, speed: 0, stopped: true });
  }
  const traffic = Object.assign(Object.create(TrafficSystem.prototype), { signals, vehicles });
  const inv = { ...items };
  const stats = { dinero: 0, energia: 100, animo: 50, higiene, xp: 0, addXP(n) { this.xp += n; } };
  return {
    traffic, stats, signals, node,
    player: { position: { x: x0 + 3.2, y: 0, z }, faceTowards(p) { this.mira = p; } },
    inventory: { count: id => inv[id] ?? 0, add: () => true, inv }
  };
}
const correr = (r, s = 8) => { for (let i = 0; i < s * 10 && r.activo; i++) r.update(.1); };

test('sin pelotas la B sigue siendo limosna, y la pista de la tienda sale una sola vez', () => {
  const g = juego({ items: {} });
  const r = new RebusqueSystem(g);
  r.update(.1);
  assert.equal(r.prompt, null);
  assert.equal(r.intentar(), false);
  r.update(.1); r.update(.1);
  assert.equal(avisos().filter(t => /pelotas de malabares de la tienda/.test(t)).length, 1);
});

test('con el carro en verde, o lejos de la cola, no hay show aunque haya pelotas: B es limosna', () => {
  const verde = new RebusqueSystem(juego({ verde: true }));
  verde.update(.1);
  assert.equal(verde.prompt, null);
  assert.equal(verde.intentar(), false);
  const g = juego();
  g.player.position.x += 12;
  const lejos = new RebusqueSystem(g);
  lejos.update(.1);
  assert.equal(lejos.prompt, null);
  assert.equal(lejos.intentar(), false);
});

test('malabares en rojo: B es del show, dura sus segundos, cada conductor da o no y las pelotas no se gastan', () => {
  const g = juego();
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.match(r.prompt, /^\[B\] Hacer malabares/);
  assert.equal(r.intentar(), true);
  assert.ok(r.activo);
  assert.equal(r.intentar(), true, 'a mitad del show B no pide limosna');
  assert.equal(g.stats.energia, 100 - REBUSQUE.malabares.energia);
  assert.ok(g.player.mira, 'mira hacia los carros');
  r.update(.1);
  assert.match(r.prompt, /^Haciendo malabares, \d s · rojo \d+ s$/);
  correr(r);
  assert.ok(!r.activo);
  assert.equal(r.prompt, null);
  // random 0: cada uno paga el mínimo ($200; frente al primero, $230, que se redondea a $200).
  assert.equal(g.stats.dinero, 2 * 200);
  assert.ok(avisos().includes('2 carros me dieron $ 400.'));
  assert.equal(g.inventory.count('malabares'), 1, 'las pelotas no se gastan');
  assert.ok(g.stats.xp > 0);
  // A los mismos carros no se les vuelve a trabajar enseguida.
  r.update(.1);
  assert.equal(r.prompt, null);
  assert.equal(r.intentar(), false);
});

test('con el rojo a punto de acabar B dice por qué no (no pide limosna); con poco rojo, el show se acorta', () => {
  const g = juego({ rojo: 3.5 });
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.equal(r.prompt, 'Ya va a cambiar la luz: espero el próximo rojo.');
  assert.equal(r.intentar(), true);
  assert.ok(!r.activo);
  assert.ok(avisos().includes('Ya va a cambiar la luz: espero el próximo rojo.'));
  const corto = juego({ rojo: 6 });
  const r2 = new RebusqueSystem(corto, { random: () => 0 });
  r2.update(.1);
  assert.ok(r2.intentar());
  assert.ok(Math.abs(r2.trabajo.dur - (6 - 1.5)) < 1e-6, `${r2.trabajo.dur}`);
  correr(r2);
  assert.ok(corto.stats.dinero > 0, 'termina antes del verde y cobra');
});

test('alejarse a mitad corta el show sin paga y sin dejar el aviso pegado', () => {
  const g = juego();
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1); r.intentar(); r.update(.5);
  assert.ok(r.prompt);
  g.player.position.x -= 3;
  r.update(.1);
  assert.ok(!r.activo);
  assert.equal(r.prompt, null);
  assert.equal(g.stats.dinero, 0);
  assert.ok(avisos().includes('Me fui antes de terminar y no me dieron nada.'));
});

test('si el carro arranca no paga; el que se queda quieto sí', () => {
  const g = juego();
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1); r.intentar(); r.update(1);
  g.traffic.vehicles[1].speed = 4; // el de atrás arranca
  correr(r);
  assert.equal(g.stats.dinero, 200, 'solo paga el que se quedó');
  const todos = juego();
  const r2 = new RebusqueSystem(todos, { random: () => 0 });
  r2.update(.1); r2.intentar(); r2.update(1);
  for (const v of todos.traffic.vehicles) v.speed = 4;
  r2.update(.1);
  assert.ok(!r2.activo);
  assert.equal(todos.stats.dinero, 0);
  assert.ok(avisos().includes('Cambió la luz y arrancaron sin pagarme.'));
});

test('la plata del show siempre va en múltiplos de $100', () => {
  let semilla = 7;
  const random = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
  const montos = new Set();
  for (let i = 0; i < 300; i++) {
    const g = juego({ cola: 4, rojo: 4 + (i % 13) });
    const r = new RebusqueSystem(g, { random });
    r.update(.1);
    if (!r.intentar() || !r.activo) continue;
    correr(r, 20);
    assert.equal(g.stats.dinero % 100, 0, `${g.stats.dinero}`);
    montos.add(g.stats.dinero);
  }
  assert.ok(montos.size > 5, `${[...montos]}`);
});

test('morir, dormir, caer preso o viajar a mitad del show: nada queda colgado ni con el aviso pegado', () => {
  const g = juego();
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1); r.intentar(); r.update(.5);
  r.cancelar();
  assert.ok(!r.activo);
  assert.equal(r.prompt, null, 'sin aviso pegado');
  assert.equal(g.stats.dinero, 0);
  r.dispose();
  // Viajar en bus: el jugador aparece lejos y el show se corta solo en el siguiente cuadro.
  const v = juego();
  const r2 = new RebusqueSystem(v, { random: () => 0 });
  r2.update(.1); r2.intentar(); r2.update(.5);
  v.player.position.x += 400;
  r2.update(.1);
  assert.ok(!r2.activo);
  assert.equal(r2.prompt, null);
  // Con la mano en un bolsillo ajeno tampoco se sigue.
  const m = juego();
  const r3 = new RebusqueSystem(m, { random: () => 0 });
  r3.update(.1); r3.intentar();
  m.steal = { minigameActive: true };
  r3.update(.1);
  assert.ok(!r3.activo);
  assert.equal(r3.intentar(), false, 'robando, B vuelve a lo de siempre');
});

/** Cada conductor paga lo más alto de la paga: la tirada elige «paga» (0) y el monto sale casi al tope (.999). */
const pagaAlta = () => { let i = 0; return () => (i++ % 2 ? .999 : 0); };
/** Lo que paga un conductor: la paga alta por la fracción, en múltiplos de $100. */
const paga = fraccion => Math.max(100, Math.round(montoDe('paga', REBUSQUE.malabares, { r: .999 }) * fraccion / 100) * 100);

test('frente al primero de la cola cada conductor paga un 15 % más; si delante hay otro carro, no', () => {
  const g = juego();
  const r = new RebusqueSystem(g, { random: pagaAlta() });
  r.update(.1);
  assert.ok(r.intentar());
  correr(r);
  assert.equal(g.stats.dinero, 2 * paga(1.15));
  // Un carro más adelante, ya en el cruce: el de enfrente del jugador no es el primero de la cola.
  const h = juego();
  const primero = h.traffic.vehicles[0].car;
  h.traffic.vehicles.unshift({ car: { ...primero, position: { ...primero.position, x: primero.position.x + 8.5 } }, speed: 0, stopped: true });
  const s = new RebusqueSystem(h, { random: pagaAlta() });
  s.update(.1);
  assert.ok(s.intentar());
  const atendidos = s.trabajo.cars.length;
  correr(s);
  assert.equal(h.stats.dinero, atendidos * paga(1));
  assert.ok(paga(1.15) > paga(1));
});

test('un show recortado por el rojo paga en proporción a lo que duró', () => {
  const g = juego({ rojo: 5.5 });
  const r = new RebusqueSystem(g, { random: pagaAlta() });
  r.update(.1);
  assert.ok(r.intentar());
  assert.equal(r.trabajo.dur, 4);
  correr(r);
  assert.equal(g.stats.dinero, 2 * paga(4 / 5 * 1.15));
  assert.ok(paga(4 / 5 * 1.15) < paga(1.15));
});

test('pegado al costado de un carro no hay show, aunque esté lejos de su centro y frente a otro', () => {
  const g = juego();
  const { x, z } = g.traffic.vehicles[0].car.position;
  // Junto a la cola del primero (a 2,6 m de su centro) y delante de la trompa del segundo.
  g.player.position = { x: x - 2.3, y: 0, z: z + 1.3 };
  const r = new RebusqueSystem(g);
  r.update(.1);
  assert.equal(r.prompt, null);
  assert.equal(r.intentar(), false);
});
