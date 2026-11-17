// Reacciones de los conductores y balance del semáforo: reparto, modificadores, la tirada, la paga por show y el techo
// por minuto.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { pesosReaccion, elegirReaccion, montoDe } from '../src/systems/rebusque/reacciones.js';
import { PESOS_REACCION, PROPINA } from '../src/data/rebusqueReacciones.js';
import { REBUSQUE } from '../src/data/rebusque.js';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.CustomEvent ??= class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } };
  globalThis.window = { dispatchEvent: e => eventos.push(e) };
});
const suma = w => Object.values(w).reduce((a, b) => a + b, 0);

test('las probabilidades suman 1 con cualquier contexto y, sin modificadores, son exactamente la tabla', () => {
  for (const c of [{}, { sucio: true }, { lluvia: true }, { sucio: true, lluvia: true, tipoCarro: 'taxi' }]) {
    const w = pesosReaccion({ ...c, id: 'malabares' });
    assert.ok(Math.abs(suma(w) - 1) < 1e-9, `${JSON.stringify(c)}: ${suma(w)}`);
    assert.ok(Object.values(w).every(p => p >= 0 && Number.isFinite(p)));
  }
  assert.equal(pesosReaccion({ id: 'cuidar' }), null);
  for (const [tipo, p] of Object.entries(PESOS_REACCION.malabares)) {
    assert.ok(Math.abs(pesosReaccion({ id: 'malabares' })[tipo] - p) < 1e-9, tipo);
  }
});

test('los modificadores mueven lo que deben', () => {
  const base = pesosReaccion({ id: 'malabares' });
  const sucio = pesosReaccion({ id: 'malabares', sucio: true });
  assert.ok(sucio.paga < base.paga * .55, 'el olor espanta');
  assert.ok(sucio.ventana > base.ventana, 'y suben el vidrio');
  assert.ok(pesosReaccion({ id: 'malabares', lluvia: true }).paga < base.paga * .65, 'con lluvia nadie mira el show');
  assert.ok(pesosReaccion({ id: 'malabares', tipoCarro: 'taxi' }).paga < base.paga, 'el taxista da menos');
  assert.equal(pesosReaccion({ id: 'malabares', sucio: true }).insulto, base.insulto, 'lo hostil no cambia');
});

test('la tirada: paga primero, y con la misma semilla la misma reacción', () => {
  const def = REBUSQUE.malabares;
  assert.deepEqual(elegirReaccion({}, def, () => 0), { tipo: 'paga', pesos: def.paga[0], item: null });
  assert.equal(elegirReaccion({}, def, () => .999).tipo, 'insulto');
  const vistos = new Set();
  for (let i = 0; i < 1000; i++) vistos.add(elegirReaccion({}, def, Math.random).tipo);
  for (const tipo of Object.keys(PESOS_REACCION.malabares)) assert.ok(vistos.has(tipo), tipo);
  assert.equal(montoDe('propina', def, { r2: 0 }), PROPINA.billete);
  assert.equal(elegirReaccion({}, def, (() => { const s = [.36, .9]; return () => s.shift() ?? 0; })()).item, 'refresco');
  for (let i = 0; i < 200; i++) assert.equal(elegirReaccion({}, def, Math.random).pesos % 100, 0);
});

/** Valor esperado de un carro en pesos: la paga media y la propina media (con el billete) por su probabilidad. */
function valorEsperado(def) {
  const w = pesosReaccion({ id: def.id });
  const propina = PROPINA.probBillete * PROPINA.billete + (1 - PROPINA.probBillete) * (PROPINA.min + PROPINA.max) / 2;
  return w.paga * montoDe('paga', def, { r: .5 }) + w.propina * propina;
}

test('balance: un show de malabares a cuatro carros deja unos $1.000 a $1.200', () => {
  const show = valorEsperado(REBUSQUE.malabares) * REBUSQUE.malabares.carros;
  assert.ok(show >= 900 && show <= 1200, `show a cuatro carros: ${show}`);
  assert.ok(show * 1.15 <= 1200, `frente al primero: ${show * 1.15}`);
});

test('techo: ni el mejor caso pasa de $3.000 en un minuto real (salvo el billete del primero)', () => {
  const carros = [];
  for (let i = 0; i < 4; i++) carros.push({ position: { x: -6.5 * (i % 2), y: 0, z: 3.5 * Math.floor(i / 2) }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, kind: 'carro' });
  const vehicles = carros.map(car => ({ car, speed: 0, stopped: true }));
  const g = {
    player: { position: { x: 3.2, y: 0, z: 0 } },
    stats: { dinero: 0, energia: 1e9, animo: 50, higiene: 100, addXP() {} },
    inventory: { count: () => 1, add: () => true },
    traffic: { vehicles, signals: { time: 20, nodes: [] },
      stoppedAtRed: p => vehicles.map(v => ({ vehicle: v, car: v.car, distance: Math.hypot(v.car.position.x - p.x, v.car.position.z - p.z) })).sort((a, b) => a.distance - b.distance) }
  };
  // Siempre paga y siempre hay un rojo largo: un show cada vez que se puede, sin esperas por carro ni por esquina.
  const r = new RebusqueSystem(g, { random: () => .3 });
  r._sitio = (def, lugares) => ({ cars: lugares.slice(0, def.carros), nariz: true });
  r._impedimento = () => null;
  r._libre = () => true;
  const cobros = [];
  for (let t = 0; t < 600; t += .1) {
    if (!r.activo) r.intentar();
    const antes = g.stats.dinero;
    r.update(.1);
    if (g.stats.dinero > antes) cobros.push([t, g.stats.dinero - antes]);
  }
  let peor = 0;
  for (const [t] of cobros) peor = Math.max(peor, cobros.filter(([s]) => s > t - 60 && s <= t).reduce((n, [, p]) => n + p, 0));
  assert.ok(cobros.length >= 10, `${cobros.length}`);
  assert.ok(peor <= 3000, `peor minuto: ${peor}`);
  assert.ok(peor >= 2000, `el techo se toca: ${peor}`);
  assert.ok(eventos.some(e => e.type === 'toast' && /Nadie me dio nada|carros me dieron|Me dieron/.test(e.detail.text)));
});
