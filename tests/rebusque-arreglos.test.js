// Arreglos del rebusque tras la revisión de la noche: las motos en dulces y malabares, la voz del conductor bravo, el
// cobro que no sigue tras cancelar, robo y rebusque que no van juntos, el paso atrás que no se mete en el camino de un
// carro andando, el aviso que cuenta lo que pasó y el billete que es billete.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { Despeje } from '../src/systems/rebusque/despeje.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { Moto } from '../src/entities/Moto.js';
import { MOTO_SIZES } from '../src/world/bogota/motos.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { vozDeConductorSegunSexo, sexoDeConductor } from '../src/systems/VehicleAudio.js';
import { REBUSQUE } from '../src/data/rebusque.js';
import { PROPINA } from '../src/data/rebusqueReacciones.js';

let eventos;
beforeEach(() => {
  globalThis.window = new EventTarget();
  eventos = [];
  for (const tipo of ['toast', 'car-honk', 'rebusque']) window.addEventListener(tipo, e => eventos.push({ type: tipo, detail: e.detail }));
});
const avisos = () => eventos.filter(e => e.type === 'toast').map(e => e.detail.text);

/** Un carro "de verdad" para la geometría del rebusque: frente hacia +X, su derecha hacia +Z. */
const carro = (x, z, extra = {}) => ({ position: { x, y: 0, z }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, mirrors: [{}], kind: 'carro', ...extra });

// --- Hallazgo 3: las motos compran dulces y miran el show; el parabrisas no se les ofrece. ---

function juegoMoto(items) {
  const moto = new Moto(new THREE.Vector3(0, 0, 0), 0, { variant: Object.keys(MOTO_SIZES)[0], occupancy: 1, helmets: 1, color: 0x334455 });
  const traffic = Object.create(TrafficSystem.prototype);
  traffic.vehicles = [{ car: moto, stopped: true, speed: 0, state: 'patrol' }];
  traffic.signals = { redAhead: () => true, time: 20, nodes: [] };
  const game = {
    traffic, clock: { day: 1, hour: 10 },
    player: { position: { x: 1, y: 0, z: .6 }, faceTowards() {}, playAction() {} },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 80, addXP() {} },
    inventory: { count: id => items[id] ?? 0, remove() {}, add: () => true }
  };
  return { game, moto };
}

test('hallazgo 3: a una moto quieta en rojo se le venden dulces, pero no se le limpia el parabrisas', () => {
  const { game, moto } = juegoMoto({ dulces: 3 });
  assert.equal(moto.isMoto, true);
  const r = new RebusqueSystem(game);
  const { eleccion } = r.elegir();
  assert.equal(eleccion?.def.id, 'dulces', 'la moto llega al rebusque y compra dulces');
  assert.equal(eleccion.cars[0].car, moto);
  const vidrios = new RebusqueSystem(juegoMoto({ limpiavidrios: 1 }).game);
  assert.equal(vidrios.elegir().eleccion, null, 'una moto no tiene parabrisas');
});

// --- Hallazgos 4 y 16: la voz del conductor bravo sigue al cuerpo que se baja. ---

class FakeHowl {
  static cargados = true;
  constructor(options) { this.options = options; this.voices = new Map(); this.loaded = FakeHowl.cargados; this.n = 0; this.oyentes = {}; }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++this.n; this.voices.set(id, { playing: true }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  pause(id) { this.voices.get(id).playing = false; }
  stop(id) { for (const [k, v] of this.voices) if (id === undefined || k === id) v.playing = false; }
  volume() {} pos() {} rate() {} seek() {} unload() {} load() {}
  once(tipo, fn) { (this.oyentes[tipo] ??= []).push(fn); } on(tipo, fn) { this.once(tipo, fn); } off() {}
  duration() { return 2; }
}

function furiaConVoz({ voz, sexo, oido = false }) {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  audio.vehicles.random = () => .5;
  audio.updateWorld(.1, new THREE.Vector3(), null, []);
  const pedidos = [];
  const voiceSound = audio._voiceSound.bind(audio);
  audio._voiceSound = file => { pedidos.push(file); return voiceSound(file); };
  const car = carro(0, 0, { traffic: true });
  audio.vehicles.driverVoice(car, voz);
  if (oido) audio.vehicles.markHeard(car);
  const vehicle = { car, speed: 0, stopped: true, state: 'patrol' };
  const game = {
    audio, clock: { day: 1, hour: 10 },
    player: { position: { x: 2.55, y: 0, z: 0 }, faceTowards() {}, playAction() {} },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 100, addXP() {} },
    inventory: { count: id => (id === 'limpiavidrios' ? 1 : 0), remove() {}, add: () => true },
    traffic: { vehicles: [vehicle], signals: { time: 20, nodes: [] }, hold() {},
      stoppedAtRed: () => [{ vehicle, car, distance: 2.55 }] },
    roadRage: { state: 'idle', driver: { state: 'idle', look: { real: { sexo } } }, trigger() { this.state = 'stopping'; return true; } }
  };
  // random fijo en la cola de la tabla de vidrios: siempre sale «furia».
  const r = new RebusqueSystem(game, { random: () => .9999 });
  r._impedimento = () => null;
  assert.ok(r.intentar());
  for (let i = 0; i < 80 && r.activo; i++) r.update(.1);
  assert.equal(r.escena?.reacciones?.[0]?.tipo, 'furia');
  const bravo = pedidos.filter(f => /semaforo_bravo/.test(f));
  audio.dispose();
  return { bravo, car, audio };
}

for (const cargados of [true, false]) {
  test(`hallazgos 4 y 16: el carro grita con la voz del sexo de quien se baja con la varilla (audio ${cargados ? 'cargado' : 'cargando'})`, () => {
    FakeHowl.cargados = cargados;
    try {
      for (const [voz, sexo, esperada] of [['conductor', 'mujer', 'conductora'], ['conductora', 'hombre', 'conductor'], ['roberto', 'mujer', 'conductora']]) {
        const { bravo, car, audio } = furiaConVoz({ voz, sexo });
        assert.equal(bravo.length, 1, `${voz}: una sola frase`);
        assert.match(bravo[0], new RegExp(`/${esperada}_semaforo_bravo`), `${voz} con ${sexo}: ${bravo[0]}`);
        const delCarro = audio.vehicles.driverVoice(car);
        assert.equal(sexoDeConductor(delCarro), sexo, 'el carro quedó con un conductor de ese sexo');
        // VoiceDirector._vozDelConductor, al bajarse: la voz de quien se baja es la misma del carro.
        assert.equal(vozDeConductorSegunSexo(audio.vehicles.recastDriver(car, sexo), sexo), delCarro);
      }
    } finally { FakeHowl.cargados = true; }
  });
}

test('hallazgos 4 y 16: un carro al que ya se le oyó la voz la conserva, como en el robo del espejo', () => {
  const { bravo, car, audio } = furiaConVoz({ voz: 'conductor', sexo: 'mujer', oido: true });
  assert.match(bravo[0], /\/conductor_semaforo_bravo/);
  assert.equal(audio.vehicles.driverVoice(car), 'conductor');
});

// --- Hallazgo 11: cancelar quita también el cobro que se estaba viendo. ---

test('hallazgo 11: morir, caer preso o cargar la partida justo después de cobrar no deja el cobro en el sitio nuevo', () => {
  const vehicles = [{ car: carro(0, 0), speed: 0, stopped: true, state: 'patrol' }];
  const game = {
    clock: { day: 1, hour: 10 },
    player: { position: { x: 8, y: 0, z: 0 }, faceTowards() {}, playAction() {} },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 100, addXP() {} },
    inventory: { count: id => (id === 'malabares' ? 1 : 0), remove() {}, add: () => true },
    traffic: { vehicles, signals: { time: 20, nodes: [] }, hold() {},
      stoppedAtRed: () => vehicles.map(v => ({ vehicle: v, car: v.car, distance: 8 })) }
  };
  const r = new RebusqueSystem(game, { random: () => 0 });
  r._impedimento = () => null;
  assert.ok(r.intentar());
  for (let i = 0; i < 80 && r.activo; i++) r.update(.1);
  assert.equal(r.escena?.tipo, 'cobro', 'acaba de cobrar');
  r.cancelar();
  assert.equal(r.escena, null);
});

// --- Hallazgo 12, lado rebusque: con la mano en un bolsillo no se trabaja. ---

function juegoRobo() {
  const vehicles = [{ car: carro(0, 0), speed: 0, stopped: true, state: 'patrol' }];
  const game = {
    clock: { day: 1, hour: 10 }, steal: { minigameActive: false, raponazo: null, assaultScene: null },
    player: { position: { x: 8, y: 0, z: 0 }, faceTowards() {}, playAction() {}, stealPose: null },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 100, addXP() {} },
    inventory: { count: id => (id === 'malabares' ? 1 : 0), remove() {}, add: () => true },
    traffic: { vehicles, signals: { time: 20, nodes: [] }, hold() {},
      stoppedAtRed: () => vehicles.map(v => ({ vehicle: v, car: v.car, distance: 8 })) }
  };
  const r = new RebusqueSystem(game, { random: () => 0 });
  r._impedimento = () => null;
  return { game, r };
}

test('hallazgo 12: robando (barra, tirón, atraco o la mano en el bolsillo) B no empieza el rebusque ni pide limosna', () => {
  const casos = [
    g => { g.steal.minigameActive = true; }, g => { g.steal.raponazo = { npc: {} }; },
    g => { g.steal.assaultScene = { time: 0 }; }, g => { g.player.stealPose = { fase: 'meter' }; }
  ];
  for (const robar of casos) {
    const { game, r } = juegoRobo();
    robar(game);
    r.update(.1);
    assert.equal(r.prompt, null, 'no ofrece el trabajo');
    assert.equal(r.elegir().eleccion, null);
    // La tecla se consume sin hacer nada: ni rebusque ni limosna encima del hurto.
    assert.equal(r.intentar(), true, 'la B no cae en la limosna');
    assert.ok(!r.activo);
  }
  // Sin robo, el mismo sitio sí se trabaja.
  const { r } = juegoRobo();
  r.update(.1);
  assert.match(r.prompt ?? '', /^\[B\] Hacer malabares/);
});

test('hallazgo 12: si empieza un robo en pleno show, el show se deja sin paga y el despeje sigue armado', () => {
  const { game, r } = juegoRobo();
  assert.ok(r.intentar());
  r.update(.5);
  assert.ok(r.activo);
  game.steal.minigameActive = true;
  game.player.stealPose = { fase: 'meter' };
  r.update(.1);
  assert.ok(!r.activo, 'el trabajo se cortó');
  assert.equal(game.stats.dinero, 0);
  assert.ok(avisos().some(t => /Dejé el trabajo a medias/.test(t)));
  assert.ok(r.despeje.ventana, 'el verde todavía lo puede encontrar delante del carro');
});

// --- Hallazgos 14 y 22: el paso atrás y su aviso. ---

/**
 * Un carro sostenido en el origen (frente +X, derecha +Z), el jugador en su nariz, andenes a los lados y el tráfico que
 * se le pase. `andenes(x, z)` dice dónde hay andén.
 */
function montarPaso({ andenes, otros = [], buses = [], bloqueado = false }) {
  const sostenido = { car: carro(0, 0), speed: 0, stopped: true, state: 'patrol', hold: true };
  const vehicles = [sostenido, ...otros];
  const player = { position: { x: 3.2, y: 0, z: 0 }, anim: [], animateScripted(dt, o) { this.anim.push({ dt, ...o }); } };
  const game = {
    player, traffic: { vehicles, busVehicles: buses.map(car => ({ car, get heading() { return car.heading; } })), hold() {} },
    world: { active: { getGroundTypeAt: (x, z) => (andenes(x, z) ? 'sidewalk' : 'road') } }
  };
  if (bloqueado) game.collisions = { resolveMove: (pos, delta, radio, out) => out };
  const d = new Despeje(game);
  d.sostenidos.set(sostenido, { desde: 0, fuera: 0, verdeEn: 0 });
  return { d, game, player, sostenido, vehicles };
}
const andando = (x, z, speed, extra = {}) => ({ car: carro(x, z), speed, state: 'patrol', ...extra });

test('hallazgo 14: el paso atrás prefiere el andén del lado del carro sostenido al del carril contrario', () => {
  // El andén del otro lado (izquierda, z ≤ −4) queda más cerca que el de su lado (derecha, z ≥ 6).
  const { d, player, sostenido } = montarPaso({ andenes: (x, z) => z >= 6 || z <= -4 });
  const hasta = d.buscarAnden(player.position, sostenido.car);
  assert.ok(hasta && hasta.z >= 6, `${JSON.stringify(hasta)}`);
});

test('hallazgo 14: el paso atrás no cruza el camino de un carro, una moto ni un bus que vienen andando', () => {
  const andenes = (x, z) => z >= 6 || z <= -9;
  // Por la derecha viene un carro a 8 m/s, 15 m atrás: el andén de su lado queda cruzando su camino.
  const conCarro = montarPaso({ andenes, otros: [andando(-15, 3.5, 8)] });
  const hasta = conCarro.d.buscarAnden(conCarro.player.position, conCarro.sostenido.car);
  assert.ok(hasta && hasta.z <= -9, `toma el del otro lado: ${JSON.stringify(hasta)}`);
  // Uno quieto (o sostenido) en ese carril no estorba: es un carro más que no se atraviesa.
  const quieto = montarPaso({ andenes, otros: [andando(-15, 3.5, .2)] });
  assert.ok(quieto.d.buscarAnden(quieto.player.position, quieto.sostenido.car).z >= 6);
  // El bus también cuenta, con su rumbo.
  const bus = { position: { x: -20, y: 0, z: 3.5 }, heading: { x: 1, z: 0 }, length: 18, width: 2.6, speed: 6 };
  const conBus = montarPaso({ andenes, buses: [bus] });
  assert.ok(conBus.d.buscarAnden(conBus.player.position, conBus.sostenido.car).z <= -9, 'el bus andando tapa el de su lado');
  // Con tráfico andando a los dos lados no hay paso: se suelta el carro, el jugador no se mueve y el aviso no miente.
  const encerrado = montarPaso({ andenes, otros: [andando(-15, 3.5, 8), andando(20, -4, 8, { car: carro(20, -4, { group: { rotation: { y: Math.PI } } }) })] });
  assert.equal(encerrado.d.buscarAnden(encerrado.player.position, encerrado.sostenido.car), null);
  encerrado.d._empezarPaso(encerrado.sostenido.car);
  assert.equal(encerrado.d.paso, null);
  assert.deepEqual(encerrado.player.position, { x: 3.2, y: 0, z: 0 });
  assert.ok(avisos().some(t => /me toca quitarme de la vía/.test(t)));
  assert.ok(!avisos().some(t => /Me quité de adelante|Me hice para atrás/.test(t)));
});

test('hallazgo 14: si en el camino se atraviesa uno andando, espera; si se quita, sigue hasta el andén', () => {
  const { d, player, sostenido, vehicles } = montarPaso({ andenes: (x, z) => z >= 6 });
  d._empezarPaso(sostenido.car);
  assert.ok(d.paso);
  for (let i = 0; i < 12; i++) d.update(.1); // el gesto y un trecho
  const z0 = player.position.z;
  assert.ok(z0 > 0 && z0 < 2.5, `${z0}`);
  // Se le atraviesa una moto andando por el carril de la derecha.
  const moto = andando(-6, 3.5, 4);
  vehicles.push(moto);
  for (let i = 0; i < 8; i++) d.update(.1);
  assert.ok(Math.abs(player.position.z - z0) < 1e-9, 'espera quieto');
  assert.ok(d.paso, 'todavía es el paso');
  assert.equal(player.anim.at(-1).speed, 0, 'las piernas quietas mientras espera');
  // La moto frena (cede al jugador): el paso sigue.
  moto.speed = 0;
  for (let i = 0; i < 60 && d.paso; i++) d.update(.1);
  assert.equal(d.paso, null);
  assert.ok(player.position.z >= 6 - 1e-6, `${player.position.z}`);
  assert.ok(avisos().some(t => /Me hice para atrás hasta el andén/.test(t)));
});

test('hallazgo 14: si sigue tapado más de 1,5 s, el paso se acaba y el jugador vuelve a mandar; nada queda congelado', () => {
  const { d, player, sostenido, vehicles } = montarPaso({ andenes: (x, z) => z >= 6 });
  d._empezarPaso(sostenido.car);
  for (let i = 0; i < 12; i++) d.update(.1);
  vehicles.push(andando(-6, 3.5, 4)); // sigue andando y nunca se quita (en la prueba no avanza)
  let cuadros = 0;
  while (d.paso && cuadros < 100) { d.update(.1); cuadros++; }
  assert.equal(d.paso, null, 'el paso no deja al jugador atascado');
  assert.ok(cuadros >= 15 && cuadros <= 17, `${cuadros}`);
  assert.ok(player.position.z < 6);
  // Se movió un trecho: el aviso dice que se quitó de adelante, no que llegó al andén.
  assert.ok(avisos().some(t => /Me quité de adelante/.test(t)));
  assert.ok(!avisos().some(t => /hasta el andén/.test(t)));
  // El sostenido no se queda congelado: el despeje lo suelta como siempre (al salir de su camino o con el tope).
  for (let i = 0; i < 300 && d.sostenidos.has(sostenido); i++) d.update(.1);
  assert.ok(!d.sostenidos.has(sostenido));
});

test('hallazgo 22: si algo no lo deja moverse, el aviso no dice que se quitó', () => {
  const { d, player, sostenido } = montarPaso({ andenes: (x, z) => z >= 6, bloqueado: true });
  d._empezarPaso(sostenido.car);
  assert.ok(!avisos().some(t => /Me quité de adelante|Me hice para atrás/.test(t)), 'el aviso no sale antes de moverse');
  for (let i = 0; i < 80 && d.paso; i++) d.update(.1);
  assert.equal(d.paso, null);
  assert.deepEqual(player.position, { x: 3.2, y: 0, z: 0 });
  assert.ok(avisos().some(t => /me toca quitarme de la vía/.test(t)));
  assert.ok(!avisos().some(t => /Me quité de adelante|Me hice para atrás/.test(t)));
});

// --- Hallazgo 19: el billete de la propina es un billete de verdad. ---

function cobrarShow({ dur, nariz, tiradas }) {
  const vehicles = [{ car: carro(0, 0), speed: 0, stopped: true, state: 'patrol' }];
  const game = {
    clock: { day: 1, hour: 10 },
    player: { position: { x: 8, y: 0, z: 0 }, faceTowards() {}, playAction() {} },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 100, addXP() {} },
    inventory: { count: () => 1, remove() {}, add: () => true },
    traffic: { vehicles, signals: { time: 20, nodes: [] }, hold() {} }
  };
  let i = 0;
  const r = new RebusqueSystem(game, { random: () => tiradas[i++ % tiradas.length] });
  r.trabajo = { def: REBUSQUE.malabares, cars: [{ car: vehicles[0].car, vehicle: vehicles[0] }], desde: { x: 8, z: 0 }, tiempo: dur, dur,
    gesto: 0, pesos: 0, dieron: 0, propina: 0, nodo: -1, nariz, ritmo: null, toleraT: 0, feedback: null };
  r._cobrar();
  return { pesos: game.stats.dinero, texto: avisos().at(-1), reaccion: r.escena.reacciones[0] };
}

test('hallazgo 19: el billete de $5.000 llega entero, frente a la cola o con el show recortado, y el aviso lo dice', () => {
  // [.33, .5, .01]: propina, y la tercera tirada saca el billete.
  for (const [dur, nariz] of [[5, true], [5, false], [4.5, false], [3.5, true], [2.6, false]]) {
    const { pesos, texto, reaccion } = cobrarShow({ dur, nariz, tiradas: [.33, .5, .01] });
    assert.equal(reaccion.tipo, 'propina');
    assert.equal(pesos, PROPINA.billete, `dur ${dur} nariz ${nariz}: ${pesos}`);
    assert.match(texto, /billete de \$\s?5\.000!/, texto);
  }
  // La propina en monedas sí va con el show, y no se anuncia como billete.
  const monedas = cobrarShow({ dur: 5, nariz: true, tiradas: [.33, .5, .5] });
  assert.equal(monedas.reaccion.tipo, 'propina');
  assert.equal(monedas.pesos, Math.round(1500 * 1.15 / 100) * 100);
  assert.doesNotMatch(monedas.texto, /billete/);
});

// --- Revisión: lo que el paso atrás todavía dejaba suelto. ---

test('hallazgo 22: si el paso se corta todavía frente a la trompa, el aviso no dice que se quitó de adelante', () => {
  const { d, player, sostenido, vehicles } = montarPaso({ andenes: (x, z) => z >= 6 });
  d._empezarPaso(sostenido.car);
  for (let i = 0; i < 9; i++) d.update(.1); // el gesto y un trecho corto: sigue en la nariz del carro
  vehicles.push(andando(-6, 3.5, 4));
  for (let i = 0; i < 40 && d.paso; i++) d.update(.1);
  assert.equal(d.paso, null);
  assert.ok(player.position.z >= .5, `se movió un trecho: ${player.position.z}`);
  assert.ok(avisos().some(t => /me toca quitarme de la vía/.test(t)));
  assert.ok(!avisos().some(t => /Me quité de adelante|Me hice para atrás/.test(t)));
});

test('hallazgo 14: un carro que tapa y destapa a ratos no deja al jugador sin mando: las esperas suman y el paso se acaba', () => {
  const { d, sostenido, vehicles } = montarPaso({ andenes: (x, z) => z >= 6 });
  d._empezarPaso(sostenido.car);
  for (let i = 0; i < 12; i++) d.update(.1);
  // Frena y arranca: tapa nueve cuadros de cada diez, así ninguna espera seguida llega a 1,5 s.
  const moto = andando(-6, 3.5, 4);
  vehicles.push(moto);
  let cuadros = 0;
  while (d.paso && cuadros < 400) { moto.speed = cuadros % 10 === 9 ? 0 : 4; d.update(.1); cuadros++; }
  assert.equal(d.paso, null, 'el paso no se estira sin fin');
  assert.ok(cuadros <= 45, `${cuadros} cuadros sin mando`);
});

test('hallazgo 12: mientras el despeje lo lleva al andén, la B no empieza a cuidar carros ni a pedir limosna', () => {
  const parqueado = (x, z) => ({ position: { x, y: 0, z } });
  const game = {
    clock: { day: 1, hour: 10 }, cars: [parqueado(3, 0), parqueado(-4, 2)],
    player: { position: { x: 0, y: 0, z: 0 }, faceTowards() {}, playAction() {}, playBeg() {} },
    stats: { dinero: 0, energia: 100, animo: 50, higiene: 100, addXP() {} },
    inventory: { count: id => (id === 'franela' ? 1 : 0), remove() {}, add: () => true }
  };
  const r = new RebusqueSystem(game, { random: () => 0 });
  r.despeje.paso = { desde: { x: 0, z: 0 }, hasta: { x: 0, z: 6 }, t: 1, dur: 2, k: .2 };
  assert.equal(r.intentar(), true, 'la tecla se la queda el rebusque: tampoco hay limosna');
  assert.ok(!r.activo, 'no empezó a cuidar');
  r.despeje.paso = null;
  assert.equal(r.intentar(), true);
  assert.equal(r.trabajo?.def.id, 'cuidar', 'sin paso, el mismo sitio sí se cuida');
});
