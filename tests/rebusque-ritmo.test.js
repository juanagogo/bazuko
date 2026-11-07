// Malabares: la cascada de tres pelotas y el mini-juego de ritmo (opcional).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Ritmo, BEAT, VUELO, PERMANENCIA, VENTANA, esAlta, manoDe, agarreDe } from '../src/systems/rebusque/ritmo.js';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';

beforeEach(() => {
  globalThis.CustomEvent ??= class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } };
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
});

test('la cascada cuadra: cada pelota cae en la otra mano justo antes de volver a salir', () => {
  assert.ok(Math.abs(VUELO + PERMANENCIA - 3 * BEAT) < 1e-12);
  for (let k = 0; k < 30; k++) {
    // La pelota del lanzamiento k vuelve a salir en k + 3, desde la mano que la recibió.
    assert.equal(manoDe(k + 3), 1 - manoDe(k));
    assert.ok(agarreDe(k) < (k + 3) * BEAT);
  }
  // Las altas: cada tercera desde el segundo 1,5, siempre la misma pelota.
  const altas = [...Array(30).keys()].filter(esAlta);
  assert.ok(altas.length > 3);
  assert.ok(altas.every(k => k % 3 === 2 && k * BEAT >= 1.5));
});

test('sin tocar nada el show es normal; acertar sube, errar baja y dos errores seguidos tumban una pelota', () => {
  const quieto = new Ritmo(5);
  for (let t = 0; t < 5; t += .1) quieto.avanzar(t);
  assert.equal(quieto.calidad, .5);
  assert.equal(quieto.estrellas, 2);

  const bueno = new Ritmo(5);
  const altas = [...Array(20).keys()].filter(k => esAlta(k) && agarreDe(k) <= 5);
  for (const k of altas) assert.equal(bueno.golpe(agarreDe(k) + VENTANA * .5), 'acierto');
  assert.equal(bueno.aciertos, altas.length);
  assert.ok(bueno.calidad > .85, `${bueno.calidad}`);
  assert.equal(bueno.golpe(agarreDe(altas[0])), 'error', 'la misma alta no cuenta dos veces');

  const malo = new Ritmo(5);
  assert.equal(malo.golpe(.3), 'error');
  assert.equal(malo.golpe(.6), 'caida');
  const k = malo.avanzar(.7);
  assert.ok(k >= 0, 'se cae la próxima que llega a una mano');
  assert.ok(malo.seCae(k));
  assert.ok(!malo.enJuego(k + 3), 'la pelota caída ya no se lanza');
  assert.ok(malo.enJuego(k + 1));
  assert.ok(malo.calidad < .2);
  assert.equal(malo.avanzar(.8), -1, 'una sola caída por par de errores');
});

test('las altas que quedan: no se pide una que no alcanza a bajar', () => {
  const r = new Ritmo(3);
  assert.ok(r.altasRestantes(0) >= 1);
  assert.equal(r.altasRestantes(2.95), 0);
});

test('en el juego, B durante los malabares marca el ritmo y el aviso lo cuenta', () => {
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
  const r = new RebusqueSystem(g, { random: () => .99 });
  r.update(.1);
  assert.ok(r.intentar());
  r.update(.1);
  assert.match(r.prompt, /\[B\] cuando baje la alta · ★★$/);
  assert.equal(r.intentar(), true, 'B es del show');
  r.update(.05);
  assert.match(r.prompt, /Uy, a destiempo/);
  assert.ok(r.activo, 'errar no corta el show');
  // Acertar la primera alta.
  const alta = [...Array(20).keys()].find(esAlta);
  while (r.trabajo.tiempo < agarreDe(alta) - .02) r.update(.05);
  r.intentar();
  r.update(.05);
  assert.match(r.prompt, /¡Eso!/);
  assert.equal(r.trabajo.ritmo.aciertos, 1);
});
