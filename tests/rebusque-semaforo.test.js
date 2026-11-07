// Rebusque y semáforo: el reloj del rojo, el sitio de cada trabajo, el cruce y el aviso con la cuenta.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { signalState } from '../src/world/bogota/TrafficSignals.js';
import {
  segundosParaVerde, segundosParaVerdeEje, ejeDe, rumbo, dentroDeCruce, cruceCercano, zonaDeCarro, localDe,
  puntoLocal, puntoParabrisas, puntoVentana, puertaDe
} from '../src/systems/rebusque/semaforo.js';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { REBUSQUE } from '../src/data/rebusque.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.CustomEvent ??= class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } };
  globalThis.window = { dispatchEvent: e => eventos.push(e), addEventListener() {}, removeEventListener() {} };
});
const avisos = () => eventos.filter(e => e.type === 'toast').map(e => e.detail.text);

// Un carro "de verdad" para las reglas de sitio: con group.rotation, largo, ancho y puerta.
const carroReal = (x, z, yaw = 0, extra = {}) => ({
  position: { x, y: 0, z }, group: { rotation: { y: yaw } }, length: 4.2, width: 1.8, mirrors: [{}], kind: 'carro',
  vehicle: { driverDoor: { x: .1, side: -1 } }, ...extra
});

/** Juego mínimo con semáforos y tráfico: los carros dados están quietos en rojo. */
function juego({ items = {}, cars = [], time = 20, nodes = [{ x0: 20, x1: 30, z0: -5, z1: 5 }] } = {}) {
  const vehicles = cars.map(car => ({ car, speed: 0, stopped: true, state: 'patrol' }));
  const inv = { ...items };
  return {
    player: { position: { x: 0, y: 0, z: 0 }, faceTowards() {}, playAction() {} },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 80, addXP() {} },
    inventory: { count: id => inv[id] ?? 0, remove: (id, n) => { inv[id] -= n; }, add: () => true },
    clock: { day: 1, hour: 10 },
    traffic: {
      vehicles,
      signals: { time, nodes },
      hold(car, held) { const v = vehicles.find(o => o.car === car); if (v) v.hold = held; return v; },
      stoppedAtRed: (p, r) => vehicles.filter(v => !v.hold)
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

test('zonas de un carro quieto: nariz, flanco, banda y fuera', () => {
  const car = carroReal(0, 0);
  const en = (a, s) => zonaDeCarro(car, puntoLocal(car, a, s));
  assert.equal(en(2.1 + 1.1, 0), 'nariz');
  assert.equal(en(2.1 + 5, .5), 'nariz');
  assert.equal(en(0, 1.2), 'flanco');
  assert.equal(en(-2.5, 0), 'flanco', 'detrás, pegado al baúl');
  assert.equal(en(0, -(.9 + .65)), 'banda', 'junto al costado, donde el golpe alcanza');
  assert.equal(en(0, 3), 'fuera');
  assert.equal(en(9, 0), 'fuera');
  const l = localDe(car, puntoLocal(car, 1.5, -.7));
  assert.ok(Math.abs(l.a - 1.5) < 1e-9 && Math.abs(l.s + .7) < 1e-9);
  // Girado, igual.
  const g = carroReal(10, 5, 1.1);
  assert.equal(zonaDeCarro(g, puntoParabrisas(g)), 'nariz');
  assert.equal(zonaDeCarro(g, puntoVentana(g)), 'fuera', 'la ventana queda fuera de la banda');
  // La buseta se aborda por la derecha pero se maneja por la izquierda: los dulces se ofrecen en la ventana del puesto.
  const buseta = carroReal(0, 0, 0, { vehicle: { driverAnchor: { x: 2.74, z: -.55 }, driverDoor: { x: 3.34, side: 1 } } });
  assert.deepEqual(puertaDe(buseta), { x: 2.74, lado: -1 });
  assert.ok(localDe(buseta, puntoVentana(buseta)).s < 0, 'del lado izquierdo');
  assert.deepEqual(puertaDe(carroReal(0, 0)), { x: .1, lado: -1 }, 'sin puesto conocido, la puerta');
});

test('cruces: dentro con margen, y la esquina más cercana', () => {
  const nodes = [{ x0: 0, x1: 10, z0: 0, z1: 10 }, { x0: 50, x1: 60, z0: 0, z1: 10 }];
  assert.ok(dentroDeCruce(nodes, { x: 5, z: 5 }, 1));
  assert.ok(!dentroDeCruce(nodes, { x: .5, z: 5 }, 1), 'el borde de la cebra es de la cola');
  assert.ok(!dentroDeCruce(nodes, { x: -3, z: 5 }));
  assert.equal(cruceCercano(nodes, { x: 45, z: 5 }), 1);
  assert.equal(cruceCercano(nodes, { x: 30, z: 80 }), -1);
});

test('solo se empieza si al rojo le queda tiempo, y el trabajo se acorta para acabar antes del verde', () => {
  const car = carroReal(0, 0);
  // Eje 0: verde de 0 a 14 (ciclo 36). t=31 → faltan 5 s: no alcanza para los malabares (5 s × .5 + 1,5 = 4).
  const g = juego({ items: { malabares: 1 }, cars: [car], time: 33 });
  g.player.position = puntoLocal(car, 2.1 + 1.1, 0);
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.equal(r.prompt, 'Ya va a cambiar la luz: espero el próximo rojo.');
  assert.equal(r.intentar(), true, 'B dice por qué no');
  assert.ok(!r.activo);
  assert.ok(avisos().includes('Ya va a cambiar la luz: espero el próximo rojo.'));
  // Con 7 s de rojo: empieza, pero dura 7 − 1,5 = 5,5 → los 5 s completos; con 6 s, 4,5.
  g.traffic.signals.time = 30;
  r.update(.1);
  assert.match(r.prompt, /^\[B\] Hacer malabares/);
  assert.ok(r.intentar());
  assert.ok(Math.abs(r.trabajo.dur - 4.5) < 1e-9, `${r.trabajo.dur}`);
  r.update(.1);
  assert.match(r.prompt, /Haciendo malabares, \d s · rojo 6 s/);
});

test('cada trabajo pide su sitio: capó, ventana del conductor y frente a la cola', () => {
  const car = carroReal(0, 0);
  const caso = (items, pos) => {
    const g = juego({ items, cars: [car] });
    g.player.position = pos;
    const r = new RebusqueSystem(g, { random: () => 0 });
    return r.elegir();
  };
  assert.equal(caso({ limpiavidrios: 1 }, puntoParabrisas(car)).eleccion?.def.id, 'vidrios');
  assert.equal(caso({ limpiavidrios: 1 }, puntoVentana(car)).eleccion, null, 'desde la ventana no se alcanza el vidrio');
  assert.equal(caso({ dulces: 3 }, puntoVentana(car)).eleccion?.def.id, 'dulces');
  assert.equal(caso({ dulces: 3 }, puntoLocal(car, -1.5, 2.4)).eleccion, null, 'por la ventana de atrás no');
  const frente = caso({ malabares: 1 }, puntoLocal(car, 2.1 + 1.1, 0));
  assert.equal(frente.eleccion?.def.id, 'malabares');
  assert.equal(frente.eleccion.nariz, true, 'frente al primero de la cola');
  assert.equal(caso({ malabares: 1 }, puntoLocal(car, 0, 1.3)).eleccion, null, 'pegado a la puerta no se hacen malabares');
  // Una moto no tiene parabrisas.
  const moto = carroReal(0, 0, 0, { kind: 'moto', mirrors: [], length: 2, width: .8 });
  const g = juego({ items: { limpiavidrios: 1 }, cars: [moto] });
  g.player.position = puntoParabrisas(moto);
  assert.equal(new RebusqueSystem(g).elegir().eleccion, null);
});

test('dentro del cruce no: me hago antes de la cebra', () => {
  const car = carroReal(18, 0);
  const g = juego({ items: { malabares: 1 }, cars: [car] });
  g.player.position = { x: 22.3, y: 0, z: 0 }; // 4,3 m delante del centro: dentro de la caja del cruce
  const r = new RebusqueSystem(g);
  r.update(.1);
  assert.equal(r.prompt, 'Aquí en el cruce me atropellan: me hago antes de la cebra.');
  assert.ok(!r.activo);
});

test('la misma esquina no aguanta un show tras otro', () => {
  const a = carroReal(0, 0), b = carroReal(0, 3.5);
  const g = juego({ items: { malabares: 1 }, cars: [a, b], nodes: [{ x0: 6, x1: 16, z0: -5, z1: 8 }] });
  g.player.position = puntoLocal(a, 2.1 + 1.1, 0);
  const r = new RebusqueSystem(g, { random: () => 0 });
  r.update(.1);
  assert.ok(r.intentar());
  for (let i = 0; i < 60 && r.activo; i++) r.update(.1);
  assert.ok(!r.activo);
  // Los mismos carros ya están atendidos; uno nuevo en la cola tampoco, porque la esquina ya lo vio.
  g.traffic.vehicles.push({ car: carroReal(0, -3.5), speed: 0, stopped: true, state: 'patrol' });
  r.update(.1);
  assert.equal(r.prompt, 'Esta esquina ya me vio: espero el próximo rojo.');
  for (let i = 0; i < 400; i++) r.update(.1);
  assert.match(r.prompt ?? '', /^\[B\] Hacer malabares|^Estoy estorbando/);
});

test('con dulces pegado al bus detenido, el bus va primero aunque haya carros en rojo', () => {
  const car = carroReal(0, 0);
  const g = juego({ items: { dulces: 5 }, cars: [car] });
  g.player.position = puntoVentana(car);
  const p = g.player.position;
  const bus = { position: { x: p.x, y: 0, z: p.z - 1.3 - 1 }, speed: 0, heading: { x: 1, z: 0 }, length: 18, width: 2.6 };
  g.traffic.busVehicles = [{ car: bus }];
  const r = new RebusqueSystem(g);
  assert.equal(r.elegir().eleccion.def.id, 'bus');
  bus.position.z -= 3; // ya no está pegado: vuelve la ventana del carro
  assert.equal(r.elegir().eleccion.def.id, 'dulces');
  assert.equal(REBUSQUE.bus.item, 'dulces');
});
