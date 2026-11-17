// Rebusque y semáforo: el reloj del rojo, el sitio de los malabares, el cruce y la esquina que ya vio el show.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { signalState } from '../src/world/bogota/TrafficSignals.js';
import { segundosParaVerde, segundosParaVerdeEje, ejeDe, rumbo, dentroDeCruce, cruceCercano, zonaDeCarro, localDe } from '../src/systems/rebusque/semaforo.js';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.CustomEvent ??= class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } };
  globalThis.window = { dispatchEvent: e => eventos.push(e) };
});

// Un carro quieto con su rumbo, largo y ancho.
const carroReal = (x, z, yaw = 0) => ({ position: { x, y: 0, z }, group: { rotation: { y: yaw } }, length: 4.2, width: 1.8, kind: 'carro' });
/** Punto a `a` m hacia adelante y `s` m a la derecha del centro del carro. */
function puntoLocal(car, a, s) {
  const h = rumbo(car), p = car.position;
  return { x: p.x + h.x * a - h.z * s, y: 0, z: p.z + h.z * a + h.x * s };
}

/** Juego mínimo con semáforos y tráfico: los carros dados están quietos en rojo. */
function juego({ cars = [], time = 20, nodes = [{ x0: 20, x1: 30, z0: -5, z1: 5 }] } = {}) {
  const vehicles = cars.map(car => ({ car, speed: 0, stopped: true }));
  return {
    player: { position: { x: 0, y: 0, z: 0 }, faceTowards() {} },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 80, addXP() {} },
    inventory: { count: id => (id === 'malabares' ? 1 : 0), add: () => true },
    traffic: {
      vehicles,
      signals: { time, nodes },
      stoppedAtRed: (p, r) => vehicles
        .map(v => ({ vehicle: v, car: v.car, distance: Math.hypot(v.car.position.x - p.x, v.car.position.z - p.z) }))
        .filter(v => v.distance <= r).sort((a, b) => a.distance - b.distance)
    }
  };
}

test('el reloj del rojo es el mismo de TrafficSignals, en los dos ejes', () => {
  for (let t = 0; t < 72; t += .25) {
    for (const eje of [0, 1]) {
      const falta = segundosParaVerdeEje(t, eje);
      if (signalState(t, eje) === 0) assert.equal(falta, 0, `t=${t} eje ${eje}`);
      else {
        assert.ok(falta > 0 && falta <= 22, `t=${t} eje ${eje}: ${falta}`);
        assert.notEqual(signalState(t + falta - .01, eje), 0);
        assert.equal(signalState(t + falta + .01, eje), 0);
      }
    }
  }
  // El eje sale del rumbo del carro, como redAhead: +X local es el frente.
  assert.equal(ejeDe({ group: { rotation: { y: 0 } } }), 0);
  assert.equal(ejeDe({ group: { rotation: { y: Math.PI / 2 } } }), 1);
  const h = rumbo({ group: { rotation: { y: Math.PI / 2 } } });
  assert.ok(Math.abs(h.x) < 1e-9 && Math.abs(h.z + 1) < 1e-9);
  assert.equal(segundosParaVerde(null, {}), Infinity);
  assert.equal(segundosParaVerde({ time: 20 }, carroReal(0, 0)), 16);
});

test('zonas de un carro quieto: nariz, flanco y fuera, también girado', () => {
  const car = carroReal(0, 0);
  const en = (a, s) => zonaDeCarro(car, puntoLocal(car, a, s));
  assert.equal(en(2.1 + 1.1, 0), 'nariz');
  assert.equal(en(2.1 + 5, .5), 'nariz');
  assert.equal(en(0, 1.2), 'flanco');
  assert.equal(en(-2.5, 0), 'flanco', 'detrás, pegado al baúl');
  assert.equal(en(0, 3), 'fuera');
  assert.equal(en(9, 0), 'fuera');
  const l = localDe(car, puntoLocal(car, 1.5, -.7));
  assert.ok(Math.abs(l.a - 1.5) < 1e-9 && Math.abs(l.s + .7) < 1e-9);
  const g = carroReal(10, 5, 1.1);
  assert.equal(zonaDeCarro(g, puntoLocal(g, 3.2, 0)), 'nariz');
  assert.equal(zonaDeCarro(g, puntoLocal(g, 0, 1.2)), 'flanco');
});

test('cruces: dentro con margen, y la esquina más cercana', () => {
  const nodes = [{ x0: 0, x1: 10, z0: 0, z1: 10 }, { x0: 50, x1: 60, z0: 0, z1: 10 }];
  assert.ok(dentroDeCruce(nodes, { x: 5, z: 5 }, 1));
  assert.ok(!dentroDeCruce(nodes, { x: .5, z: 5 }, 1), 'el borde de la cebra es de la cola');
  assert.ok(!dentroDeCruce(nodes, { x: -3, z: 5 }));
  assert.equal(cruceCercano(nodes, { x: 45, z: 5 }), 1);
  assert.equal(cruceCercano(nodes, { x: 30, z: 80 }), -1);
});

test('los malabares van frente a la cola y pegado a un carro no se hacen', () => {
  const car = carroReal(0, 0);
  const caso = pos => {
    const g = juego({ cars: [car] });
    g.player.position = pos;
    return new RebusqueSystem(g).elegir();
  };
  const frente = caso(puntoLocal(car, 2.1 + 1.1, 0));
  assert.equal(frente.eleccion?.def.id, 'malabares');
  assert.equal(frente.eleccion.nariz, true, 'frente al primero de la cola');
  assert.equal(caso(puntoLocal(car, 0, 1.3)).eleccion, null, 'pegado a la puerta no');
  assert.equal(caso(puntoLocal(car, 1.5, 0)).eleccion, null, 'encima de la trompa no');
});

test('dentro del cruce no: me hago antes de la cebra', () => {
  const car = carroReal(18, 0);
  const g = juego({ cars: [car] });
  g.player.position = { x: 22.3, y: 0, z: 0 }; // 4,3 m delante del centro: dentro de la caja del cruce
  const r = new RebusqueSystem(g);
  r.update(.1);
  assert.equal(r.prompt, 'Aquí en el cruce me atropellan: me hago antes de la cebra.');
  assert.equal(r.intentar(), true, 'B dice por qué no, en vez de pedir');
  assert.ok(!r.activo);
});

test('la misma esquina no aguanta un show tras otro', () => {
  const a = carroReal(0, 0), b = carroReal(0, 3.5);
  const g = juego({ cars: [a, b], nodes: [{ x0: 6, x1: 16, z0: -5, z1: 8 }] });
  g.player.position = puntoLocal(a, 2.1 + 1.1, 0);
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.ok(r.intentar());
  for (let i = 0; i < 60 && r.activo; i++) r.update(.1);
  assert.ok(!r.activo);
  // Los mismos carros ya están atendidos; uno nuevo en la cola tampoco, porque la esquina ya lo vio.
  g.traffic.vehicles.push({ car: carroReal(0, -3.5), speed: 0, stopped: true });
  r.update(.1);
  assert.equal(r.prompt, 'Esta esquina ya me vio: espero el próximo rojo.');
  for (let i = 0; i < 400; i++) r.update(.1);
  assert.match(r.prompt ?? '', /^\[B\] Hacer malabares/);
});
