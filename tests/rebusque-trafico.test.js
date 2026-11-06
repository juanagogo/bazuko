// El rebusque con el tráfico de verdad: nadie atropella al artista, el carro de enfrente espera con cortesía, pita,
// el artista se quita al andén y todo lo sostenido se suelta (cancelar, salir, robo del carro, conductor bravo, tope).
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

const textures = await import('../src/world/bogota/textures.js');
const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture(), signMesh: () => new THREE.Group() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }], randomReal: () => ({})
} });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { TrafficSignals } = await import('../src/world/bogota/TrafficSignals.js');
const { RebusqueSystem } = await import('../src/systems/RebusqueSystem.js');
const { Despeje, DESPEJE, desdeVerde } = await import('../src/systems/rebusque/despeje.js');
const { segundosParaVerde, puntoLocal, zonaDeCarro, localDe } = await import('../src/systems/rebusque/semaforo.js');

let eventos;
beforeEach(() => {
  globalThis.window = new EventTarget();
  eventos = [];
  for (const tipo of ['toast', 'car-honk', 'rebusque']) window.addEventListener(tipo, e => eventos.push({ type: tipo, detail: e.detail }));
});

const DT = .1;
const sembrado = semilla => () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 4294967296; };

/** La ciudad con su tráfico y sus semáforos, hasta que haya un primero de la cola quieto en rojo con rojo de sobra. */
function montar(semilla = 7) {
  const city = new Bogota();
  city.map = city._layout();
  const traffic = new TrafficSystem(new THREE.Scene(), city.getTrafficRoutes(), { random: sembrado(semilla), policeCount: 0 });
  const signals = traffic.signals = new TrafficSignals();
  const player = { position: new THREE.Vector3(0, 0, -500), faceTowards() {}, playAction() {}, radius: .4, anim: [],
    animateScripted(dt, o) { this.anim.push({ dt, ...o }); } };
  const game = {
    traffic, player, world: { active: city }, clock: { day: 1, hour: 10 },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 80, addXP() {} },
    inventory: { count: id => (id === 'malabares' ? 1 : 0), remove() {}, add: () => true }
  };
  const mundo = { city, traffic, signals, player, game, time: 0, golpes: [] };
  mundo.paso = (segundos, rebusque = null) => {
    for (let t = 0; t < segundos - 1e-9; t += DT) {
      mundo.time += DT;
      signals.update(mundo.time);
      rebusque?.update(DT);
      traffic.update(DT, { player: player.position, onPlayerHit: hit => mundo.golpes.push(hit) });
    }
  };
  const primero = v => !traffic.vehicles.some(o => {
    if (o === v) return false;
    const l = localDe(v.car, o.car.position);
    return l.a > 0 && l.a < 9 && Math.abs(l.s) < 1.6;
  });
  for (let i = 0; i < 1200 && !mundo.vehicle; i++) {
    mundo.paso(DT);
    mundo.vehicle = traffic.vehicles.find(v => !v.police && v.stopped && !v.car.isMoto && v.car.kind !== 'moto'
      && traffic.stoppedAtRed(v.car.position, .1).length && segundosParaVerde(signals, v.car) > 12 && primero(v)
      && city.getGroundTypeAt(...xz(puntoLocal(v.car, v.car.length / 2 + 1.1, 0))) === 'road') ?? null;
  }
  assert.ok(mundo.vehicle, 'hay un carro quieto en rojo');
  return mundo;
}
const xz = p => [p.x, p.z];

/** Se para frente a la trompa y empieza los malabares. */
function empezar(mundo) {
  const { game, vehicle, player } = mundo;
  const p = puntoLocal(vehicle.car, vehicle.car.length / 2 + 1.1, 0);
  player.position.set(p.x, 0, p.z);
  const rebusque = new RebusqueSystem(game, { random: () => .5 });
  rebusque.update(DT);
  assert.match(rebusque.prompt ?? '', /^\[B\] Hacer malabares/, rebusque.prompt);
  assert.ok(rebusque.intentar());
  assert.equal(rebusque.trabajo.def.id, 'malabares');
  return rebusque;
}

/** Corre hasta `s` segundos después del verde del carro trabajado. */
const hastaVerde = (mundo, s, rebusque) => {
  for (let i = 0; i < 2000 && desdeVerde(mundo.signals.time, mundo.vehicle.car) < s; i++) mundo.paso(DT, rebusque);
};

test('el que se queda frente al carro: espera, pito a los 12 s, al andén a los 20 s y el carro se va; nadie lo atropella', () => {
  const mundo = montar();
  const { vehicle, traffic, player, city } = mundo;
  const rebusque = empezar(mundo);
  hastaVerde(mundo, -1, rebusque);
  assert.ok(eventos.some(e => e.type === 'rebusque' && e.detail.id === 'malabares'), 'el show terminó antes del verde');
  assert.equal(vehicle.hold, undefined, 'en rojo no se sostiene nada');
  hastaVerde(mundo, 1, rebusque);
  assert.equal(vehicle.hold, true, 'al verde el carro de enfrente espera');
  assert.ok(rebusque.despeje.sostenidos.has(vehicle));
  assert.equal(rebusque.prompt, 'Estoy estorbando: me quito de adelante del carro');
  assert.equal(rebusque.intentar(), false, 'sosteniendo, B no empieza otro trabajo (pide limosna)');
  // El tráfico pita por su cuenta en otras partes: aquí cuenta el pito del carro sostenido.
  const pitoSuyo = () => eventos.some(e => e.type === 'car-honk' && Math.hypot(e.detail.x - vehicle.car.position.x, e.detail.z - vehicle.car.position.z) < .1);
  hastaVerde(mundo, 11.8, rebusque);
  assert.ok(!pitoSuyo());
  hastaVerde(mundo, 12.3, rebusque);
  assert.ok(pitoSuyo(), 'pita a los 12 s');
  assert.equal(rebusque.despeje.apartados, 0);
  // desdeVerde vuelve a negativo cuando el verde se acaba: se cuenta con el reloj desde el pito.
  const pitoEn = mundo.time;
  for (let i = 0; i < 120 && !rebusque.despeje.apartados; i++) mundo.paso(DT, rebusque);
  assert.equal(rebusque.despeje.apartados, 1, 'a los 20 s se quita');
  assert.ok(Math.abs(mundo.time - pitoEn - (DESPEJE.APARTAR_S - DESPEJE.PITO_S)) < .35, `${mundo.time - pitoEn}`);
  assert.ok(rebusque.controlaJugador, 'mientras se quita, Game no corre Player.update');
  player.anim.length = 0;
  const pasos = [];
  for (let i = 0; i < 60 && rebusque.controlaJugador; i++) {
    const x0 = player.position.x, z0 = player.position.z;
    mundo.paso(DT, rebusque);
    pasos.push(Math.hypot(player.position.x - x0, player.position.z - z0) / DT);
  }
  assert.ok(!rebusque.controlaJugador, 'el paso termina solo');
  // Primero las manos en alto mirando al carro, quieto; después camina de verdad: las piernas con la velocidad que lleva.
  const gesto = player.anim.filter(a => a.action === 'apartarse'), camino = player.anim.filter(a => !a.action);
  assert.ok(gesto.length >= 4 && gesto.every(a => a.speed === 0), 'manos en alto sin deslizarse');
  assert.ok(player.anim.indexOf(gesto.at(-1)) < player.anim.indexOf(camino[0]), 'el gesto va primero');
  assert.ok(camino.length >= 5 && camino.every(a => a.speed <= 3.05), 'a paso de caminar');
  // Si un carro andando le tapa el camino, espera quieto (velocidad 0) y sigue: la pausa es corta.
  const andando = camino.filter(a => a.speed > 0);
  assert.ok(andando.filter(a => a.speed > 1).length >= andando.length - 2, 'se mueven las piernas');
  assert.ok(camino.length - andando.length <= 15, 'la espera por un carro andando es corta');
  assert.ok(player.anim.length <= pasos.length, 'una sola animación por cuadro');
  assert.ok(Math.max(...pasos) <= 3.05, `${Math.max(...pasos)}`);
  assert.equal(city.getGroundTypeAt(player.position.x, player.position.z), 'sidewalk', 'quedó en el andén');
  assert.equal(zonaDeCarro(vehicle.car, player.position), 'fuera');
  assert.notEqual(vehicle.hold, true, 'y soltó el carro');
  assert.ok(!rebusque.despeje.sostiene);
  assert.ok(eventos.some(e => e.type === 'toast' && /Me hice para atrás hasta el andén/.test(e.detail.text)));
  // El carro sigue en circulación y arranca en su siguiente verde.
  let arranco = false;
  for (let i = 0; i < 450 && !arranco; i++) { mundo.paso(DT, rebusque); arranco = vehicle.speed > 1; }
  assert.ok(arranco, 'el carro arrancó');
  assert.ok(traffic.vehicles.includes(vehicle), 'nunca se retiró');
  assert.deepEqual(mundo.golpes, [], 'nadie atropelló al artista');
});

test('si se va a tiempo, el carro arranca enseguida y nada queda sostenido', () => {
  const mundo = montar(11);
  const { vehicle, player } = mundo;
  const rebusque = empezar(mundo);
  hastaVerde(mundo, 2, rebusque);
  assert.equal(vehicle.hold, true);
  // Camina hacia atrás de la trompa, por el costado, fuera de las zonas.
  const fuera = puntoLocal(vehicle.car, 0, -(vehicle.car.width / 2 + 2.5));
  player.position.set(fuera.x, 0, fuera.z);
  mundo.paso(.5, rebusque);
  assert.notEqual(vehicle.hold, true);
  let arranco = false;
  for (let i = 0; i < 80 && !arranco; i++) { mundo.paso(DT, rebusque); arranco = vehicle.speed > 1; }
  assert.ok(arranco);
  assert.equal(rebusque.despeje.apartados, 0);
  assert.deepEqual(mundo.golpes, []);
});

test('cancelar (dormir, morir, manejar) suelta lo sostenido', () => {
  const mundo = montar(7);
  const rebusque = empezar(mundo);
  hastaVerde(mundo, 1, rebusque);
  assert.equal(mundo.vehicle.hold, true);
  rebusque.cancelar();
  assert.equal(mundo.vehicle.hold, false);
  assert.ok(!rebusque.despeje.activo);
  assert.equal(mundo.vehicle.rebusqueTolera, false);
  // Y aturdido también.
  const otro = montar(7);
  const r2 = empezar(otro);
  hastaVerde(otro, 1, r2);
  otro.player.isStunned = true;
  r2.update(DT);
  assert.equal(otro.vehicle.hold, false);
  r2.dispose();
});

test('robarse el carro sostenido o que lo tome el conductor bravo: el despeje lo olvida sin soltarlo', () => {
  const mundo = montar(7);
  const rebusque = empezar(mundo);
  hastaVerde(mundo, 1, rebusque);
  const { vehicle, traffic, game } = mundo;
  // El conductor bravo lo toma: RoadRage lo sigue sosteniendo.
  game.roadRage = { vehicle, state: 'out' };
  rebusque.update(DT);
  assert.ok(!rebusque.despeje.sostenidos.has(vehicle));
  assert.equal(vehicle.hold, true, 'sigue siendo de RoadRage');
  rebusque.cancelar();
  assert.equal(vehicle.hold, true, 'cancelar no suelta lo ajeno');
  // Un carro retirado de la circulación (robado): se olvida sin errores.
  const otro = montar(7);
  const r2 = empezar(otro);
  hastaVerde(otro, 1, r2);
  assert.ok(r2.despeje.sostenidos.has(otro.vehicle));
  otro.traffic.release(otro.vehicle);
  r2.update(DT);
  assert.ok(!r2.despeje.sostenidos.has(otro.vehicle));
  assert.equal(otro.traffic.vehicles.includes(otro.vehicle), false);
});

test('el despeje solo frena a los que el jugador tiene encima, y nunca más que el tope', () => {
  // Dobles: una fila de tres carros quietos y un jugador que no se puede mover (sin andén a la vista no hay paso atrás).
  const car = (x, z) => ({ position: { x, y: 0, z }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8 });
  const vehicles = [car(0, 0), car(-6.5, 0), car(-13, 0)].map(c => ({ car: c, speed: 0, stopped: true, state: 'patrol' }));
  const holds = [];
  const signals = { time: 34 }; // eje 0: verde a los 36
  const game = {
    player: { position: { x: 3.2, y: 0, z: 0 } },
    traffic: { vehicles, signals, hold(c, h) { const v = vehicles.find(o => o.car === c); v.hold = h; holds.push([vehicles.indexOf(v), h]); } }
  };
  // Hay andén, pero algo no lo deja moverse: el paso atrás no lo saca de la nariz y manda el tope.
  game.world = { active: { getGroundTypeAt: () => 'sidewalk' } };
  game.collisions = { resolveMove: (pos, delta, radio, out) => out };
  const d = new Despeje(game);
  d.armar(36);
  let maximo = 0, desde = null;
  for (let i = 0; i < 600; i++) {
    signals.time += DT;
    d.update(DT);
    if (vehicles[0].hold) { desde ??= signals.time; maximo = Math.max(maximo, signals.time - desde); }
  }
  assert.deepEqual(holds.map(([i]) => i).filter((v, k, a) => a.indexOf(v) === k), [0], 'solo el de enfrente');
  assert.ok(maximo <= DESPEJE.TOPE_S + DT, `${maximo}`);
  assert.equal(vehicles[0].hold, false, 'el tope lo soltó');
  assert.ok(!d.activo, 'la ventana se cerró');
  assert.equal(d.apartados, 1);
});

test('sin andén a la vista no se arrastra a nadie: a los 20 s se suelta el carro y se avisa', () => {
  const vehicles = [{ car: { position: { x: 0, y: 0, z: 0 }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8 }, speed: 0, state: 'patrol' }];
  const signals = { time: 35 };
  const game = { player: { position: { x: 3.2, y: 0, z: 0 } }, traffic: { vehicles, signals, hold(c, h) { vehicles[0].hold = h; } } };
  const d = new Despeje(game);
  d.armar(36);
  let soltado = null;
  for (let i = 0; i < 300 && soltado === null; i++) {
    signals.time += DT;
    d.update(DT);
    if (vehicles[0].hold === false) soltado = signals.time - 36;
  }
  assert.ok(soltado >= DESPEJE.APARTAR_S - DT && soltado < DESPEJE.APARTAR_S + DT, `${soltado}`);
  assert.deepEqual(game.player.position, { x: 3.2, y: 0, z: 0 }, 'no se movió al jugador');
  // No se movió: el aviso no dice que se quitó.
  assert.ok(eventos.some(e => e.type === 'toast' && /me toca quitarme de la vía/.test(e.detail.text)));
  assert.ok(!eventos.some(e => e.type === 'toast' && /Me quité de adelante|Me hice para atrás/.test(e.detail.text)));
});

test('sin rebusque nada cambia: el despeje no arma nada solo', () => {
  const vehicles = [{ car: { position: { x: 0, y: 0, z: 0 }, group: { rotation: { y: 0 } } }, speed: 0, state: 'patrol' }];
  const game = { player: { position: { x: 3, y: 0, z: 0 } }, traffic: { vehicles, signals: { time: 35.8 }, hold() { throw new Error('no debería'); } } };
  const d = new Despeje(game);
  for (let i = 0; i < 100; i++) { game.traffic.signals.time += DT; d.update(DT); }
  assert.ok(!d.activo);
});
