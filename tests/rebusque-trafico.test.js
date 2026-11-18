// El tráfico dice quién espera quieto frente a un semáforo en rojo (TrafficSignals.redAhead y
// TrafficSystem.stoppedAtRed), sin cambiar nada del tráfico ni de los semáforos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';

const pos = (x, y, z) => ({ x, y, z });
/** Un instante en que el eje dado está en rojo (o en verde con `verde`). */
function instante(eje, verde = false) {
  let t = 0;
  while ((signalState(t, eje) === 0) !== verde) t += .5;
  return t;
}

test('el semáforo en rojo se ve desde la cola, no desde el otro lado del cruce', () => {
  const s = new TrafficSignals();
  const node = s.nodes[0];
  const cz = (node.z0 + node.z1) / 2;
  s.update(instante(0));
  assert.ok(s.redAhead({ x: node.x0 - 10, z: cz }, { x: 1, z: 0 }), 'acercándose por la izquierda');
  assert.ok(!s.redAhead({ x: node.x0 - 10, z: cz }, { x: -1, z: 0 }), 'alejándose');
  assert.ok(!s.redAhead({ x: node.x0 - 60, z: cz }, { x: 1, z: 0 }), 'muy lejos');
  s.update(instante(0, true));
  assert.ok(!s.redAhead({ x: node.x0 - 10, z: cz }, { x: 1, z: 0 }), 'en verde');
});

test('stoppedAtRed deja por fuera patrullas, carros andando, carros sostenidos y los lejanos', () => {
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
  t.signals = null;
  assert.deepEqual(t.stoppedAtRed(pos(0, 0, 0), 6), [], 'sin semáforos, nadie');
});

test('en un cruce con varios carriles cuenta las dos colas del eje en rojo, y no el eje en verde ni al que ya va cruzando', () => {
  const s = new TrafficSignals();
  const node = s.nodes[0];
  const cz = (node.z0 + node.z1) / 2, cx = (node.x0 + node.x1) / 2;
  let rojoX = 0; while (signalState(rojoX, 0) === 0 || signalState(rojoX, 1) !== 0) rojoX += .5;
  s.update(rojoX); // eje X en rojo y eje Z en verde
  const t = Object.create(TrafficSystem.prototype);
  t.signals = s;
  const carro = (nombre, x, z, yaw) => ({ nombre, car: { position: pos(x, 0, z), group: { rotation: { y: yaw } } }, speed: 0, stopped: true });
  const vehicles = [
    carro('carril 1, primero', node.x0 - 3, cz - 1.7, 0),
    carro('carril 1, segundo', node.x0 - 9, cz - 1.7, 0),
    carro('carril 2, primero', node.x0 - 3, cz + 1.7, 0),
    carro('del otro lado', node.x1 + 3, cz, Math.PI),
    carro('eje en verde', cx, node.z0 - 4, -Math.PI / 2),
    carro('dentro del cruce', cx, cz - 1.7, 0)
  ];
  t.vehicles = vehicles;
  const quienes = t.stoppedAtRed(pos(node.x0 - 3, 0, cz), 40).map(v => vehicles.find(o => o === v.vehicle).nombre);
  assert.deepEqual(quienes.sort(), ['carril 1, primero', 'carril 1, segundo', 'carril 2, primero', 'del otro lado']);
  // Del más cercano al más lejano.
  const d = t.stoppedAtRed(pos(node.x0 - 3, 0, cz), 40).map(v => v.distance);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
});

test('preguntar quién está en rojo no cambia nada del tráfico ni de los semáforos', () => {
  const s = new TrafficSignals();
  const node = s.nodes[0];
  const cz = (node.z0 + node.z1) / 2;
  s.update(instante(0));
  const t = Object.create(TrafficSystem.prototype);
  t.signals = s;
  t.vehicles = [0, 1, 2, 3].map(i => ({
    car: { position: pos(node.x0 - 3 - 6 * i, 0, cz), group: { rotation: { y: 0 } } },
    speed: i === 3 ? 4 : 0, stopped: i !== 3, distance: 10 * i, acceleration: 0, resumeDelay: 0, hold: false
  }));
  const foto = () => JSON.stringify({ vehicles: t.vehicles, time: s.time, reservas: [...s.reservations ?? []].length });
  const antes = foto();
  for (let i = 0; i < 50; i++) {
    t.stoppedAtRed(pos(node.x0 - 3, 0, cz), 30);
    s.redAhead({ x: node.x0 - 3, z: cz }, { x: 1, z: 0 });
  }
  assert.equal(foto(), antes);
  assert.equal(t.stoppedAtRed(pos(node.x0 - 3, 0, cz), 30).length, 3);
});
