// La jornada del rebusque: cansancio después de diez shows, repetición por esquina, esquinas quemadas por robar,
// la furia de una vez al día, y que todo eso sobreviva a guardar y cargar.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { JornadaRebusque, CANSANCIO_SHOWS, ENERGIA_CANSADO, HORAS_FRESCA } from '../src/systems/rebusque/jornadaRebusque.js';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { REBUSQUE } from '../src/data/rebusque.js';
import { sanearPartida } from '../src/systems/SaveSystem.js';

let eventos, oyentes;
beforeEach(() => {
  eventos = []; oyentes = {};
  globalThis.CustomEvent ??= class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } };
  globalThis.window = {
    dispatchEvent: e => { eventos.push(e); for (const f of oyentes[e.type] ?? []) f(e); },
    addEventListener: (t, f) => (oyentes[t] ??= []).push(f),
    removeEventListener: (t, f) => { oyentes[t] = (oyentes[t] ?? []).filter(g => g !== f); }
  };
});

test('cansancio: desde el show once cuesta 1,5 de energía, y el día siguiente vuelve a cero', () => {
  const j = new JornadaRebusque(1);
  for (let i = 0; i < CANSANCIO_SHOWS; i++) {
    assert.ok(!j.cansado('malabares'));
    assert.equal(j.energia(REBUSQUE.malabares), REBUSQUE.malabares.energia);
    j.registrar(i % 2 ? 'malabares' : 'vidrios', -1, 10);
  }
  assert.ok(j.cansado('malabares') && j.cansado('vidrios'));
  assert.ok(!j.cansado('dulces'), 'vender dulces no cansa los brazos');
  assert.equal(j.energia(REBUSQUE.malabares), REBUSQUE.malabares.energia * ENERGIA_CANSADO);
  j.sincronizar(1);
  assert.ok(j.cansado('vidrios'));
  j.sincronizar(2);
  assert.ok(!j.cansado('vidrios'));
});

test('la misma esquina: cuenta los trabajos de la última hora de juego', () => {
  const j = new JornadaRebusque(1);
  j.registrar('malabares', 4, 34);
  j.registrar('malabares', 4, 34.5);
  assert.equal(j.repeticion(4, 34.6), 2);
  assert.equal(j.repeticion(5, 34.6), 0, 'otra esquina está fresca');
  assert.equal(j.repeticion(4, 34.5 + HORAS_FRESCA + .01), 0, 'una hora después, fresca');
  j.registrar('malabares', 4, 40);
  assert.equal(j.repeticion(4, 40), 1);
});

test('guardar y cargar: sobrevive a la partida y no se cree nada raro', () => {
  const j = new JornadaRebusque(3);
  j.registrar('vidrios', 7, 80); j.quemar(7); j.furiaHoy = true; j.avisoCansancio = true;
  const guardado = JSON.parse(JSON.stringify({ rebusque: j.serialize(), stats: {}, clock: { day: 3, hour: 8 } }));
  const saneado = sanearPartida(guardado);
  assert.deepEqual(saneado.rebusque, guardado.rebusque, 'SaveSystem conserva la clave');
  const k = new JornadaRebusque(1);
  assert.ok(k.deserialize(saneado.rebusque));
  assert.deepEqual(k.serialize(), j.serialize());
  assert.ok(k.quemado(7) && k.furiaHoy && k.shows.vidrios === 1);
  // Basura: no rompe y deja valores seguros.
  for (const malo of [null, 7, 'x', [], { dia: 'hoy', shows: { malabares: -5, vidrios: 1e12, dulces: NaN }, cruces: { abc: {}, 3: { n: 'x', quemado: 'si' }, '-1': {} }, furiaHoy: 'true' }]) {
    const m = new JornadaRebusque(2);
    m.deserialize(malo);
    const s = m.serialize();
    assert.ok(Object.values(s.shows).every(n => Number.isInteger(n) && n >= 0 && n <= 10000), JSON.stringify(s));
    assert.ok(Object.keys(s.cruces).every(c => /^\d+$/.test(c)));
    assert.equal(s.furiaHoy, false);
  }
  // Partida vieja sin la clave: empieza el día en cero.
  const sistema = new RebusqueSystem({ clock: { day: 5 } });
  sistema.deserialize(undefined);
  assert.equal(sistema.jornada.dia, 5);
  assert.equal(sistema.jornada.brazos, 0);
});

test('robar cerca de un cruce lo quema por el día: avisa al empezar y nadie da', () => {
  const car = { position: { x: 0, y: 0, z: 0 }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, mirrors: [{}], kind: 'carro' };
  const vehicles = [{ car, speed: 0, stopped: true, state: 'patrol' }];
  const g = {
    player: { position: { x: 3.2, y: 0, z: 0 } },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 80, addXP() {} },
    inventory: { count: id => (id === 'malabares' ? 1 : 0), remove() {} },
    clock: { day: 1, hour: 10 },
    traffic: { vehicles, signals: { time: 20, nodes: [{ x0: 8, x1: 18, z0: -5, z1: 5 }] }, hold() {},
      stoppedAtRed: p => vehicles.map(v => ({ vehicle: v, car: v.car, distance: Math.hypot(v.car.position.x - p.x, v.car.position.z - p.z) })) }
  };
  const r = new RebusqueSystem(g, { random: () => .2 });
  window.dispatchEvent(new CustomEvent('mirror-stolen', { detail: {} }));
  assert.ok(r.jornada.quemado(0));
  r.update(.1);
  assert.ok(r.intentar());
  assert.ok(eventos.some(e => e.type === 'toast' && /ya me vieron robando/.test(e.detail.text)));
  for (let i = 0; i < 80 && r.activo; i++) r.update(.1);
  // random .2 cobra en una esquina limpia (paga .32); quemada, lo bueno cae al 30 % y con .2 ya no alcanza.
  assert.equal(g.stats.dinero, 0);
  r.dispose();
  assert.equal(oyentes['mirror-stolen'].length, 0, 'dispose quita los oyentes');
});

test('el cansancio avisa una vez y cuesta más energía en el juego', () => {
  const car = { position: { x: 0, y: 0, z: 0 }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, mirrors: [{}], kind: 'carro' };
  const vehicles = [{ car, speed: 0, stopped: true, state: 'patrol' }];
  const g = {
    player: { position: { x: 3.2, y: 0, z: 0 } },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 80, addXP() {} },
    inventory: { count: id => (id === 'malabares' ? 1 : 0), remove() {} },
    clock: { day: 1, hour: 10 },
    traffic: { vehicles, signals: { time: 20, nodes: [] }, hold() {},
      stoppedAtRed: p => vehicles.map(v => ({ vehicle: v, car: v.car, distance: Math.hypot(v.car.position.x - p.x, v.car.position.z - p.z) })) }
  };
  const r = new RebusqueSystem(g);
  r.jornada.shows.malabares = CANSANCIO_SHOWS;
  r.update(.1);
  r.intentar();
  assert.equal(g.stats.energia, 100 - REBUSQUE.malabares.energia * ENERGIA_CANSADO);
  assert.equal(eventos.filter(e => e.type === 'toast' && /brazos molidos/.test(e.detail.text)).length, 1);
});
