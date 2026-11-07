import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { DIRECTOR, VoiceDirector } from '../src/systems/voces/VoiceDirector.js';

// El director con un juego y un audio de mentira: qué dice quién, cuándo, y que al irse no deja nada colgado.

function persona(x, extra = {}) {
  const npc = {
    position: new THREE.Vector3(x, 0, 0), hp: 100, look: { real: { sexo: 'mujer' } }, dicho: [],
    speakScenario(category, force) { this.dicho.push([category, force]); return true; },
    _castVoice: () => 'senora',
    ...extra,
  };
  npc._playerDist = Math.abs(x);
  return npc;
}

function montar() {
  const eventos = new EventTarget();
  const pedidos = [], precargas = [];
  const audio = {
    vehicles: { recastDriver: (car, sexo) => (car.oido ? car.voz : (car.voz = sexo === 'mujer' ? 'valentina' : 'roberto')) },
    recastMovingTheft(car, sexo) { (this.recasts ??= []).push([car, sexo]); return true; },
    worldVoices: {},
    _npcSounds: new Map(),
    lastRefusal: null,
    playNpcVoice(path, owner, opts) { pedidos.push({ path, opts }); opts.onStart?.(2); return true; },
    prefetchVoice(path) { precargas.push(path); },
    howler: {},
  };
  const gente = [];
  const game = {
    player: { position: new THREE.Vector3() },
    world: { active: { npcs: gente } },
    stats: { higiene: 80 },
    traffic: { vehicles: [], giveUpRange: 140 },
    roadRage: { driver: null },
    dealer: { position: new THREE.Vector3(3, 0, 0), isNight: true },
    sellPoint: { position: new THREE.Vector3(2, 0, 0) },
  };
  const director = new VoiceDirector({ game, audio, eventTarget: eventos, random: () => .5, doc: null });
  const correr = (segundos, paso = .05) => { for (let t = 0; t < segundos - 1e-9; t += paso) director.update(paso); };
  const lanzar = (tipo, detail) => eventos.dispatchEvent(Object.assign(new Event(tipo), { detail }));
  return { director, audio, game, gente, pedidos, precargas, correr, lanzar, eventos };
}

test('limosna: la persona de al lado contesta según lo que pasó, y no cada vez', () => {
  const { gente, lanzar, correr } = montar();
  const vendedor = persona(1, { isVendor: true }), cerca = persona(2), lejos = persona(9);
  gente.push(vendedor, cerca, lejos);
  lanzar('beg-result', { success: true, money: 500 });
  assert.deepEqual(cerca.dicho, [['begYes', true]], 'quien está al lado (y no el vendedor) agradece');
  lanzar('beg-result', { success: false, reason: 'ignored' });
  assert.equal(cerca.dicho.length, 1, 'cuatro segundos de espera entre limosna y limosna');
  correr(DIRECTOR.limosna.espera + .1);
  lanzar('beg-result', { success: false, reason: 'ignored' });
  correr(DIRECTOR.limosna.espera + .1);
  lanzar('beg-result', { success: true, item: 'pan' });
  correr(DIRECTOR.limosna.espera + .1);
  lanzar('beg-result', { success: false, reason: 'higiene' });
  assert.deepEqual(cerca.dicho.map(([c]) => c), ['begYes', 'begNo', 'begFood', 'smell']);
  assert.equal(lejos.dicho.length + vendedor.dicho.length, 0);
});

test('tienda, recicladora y jíbaro hablan con su voz, también con el menú abierto', () => {
  const { lanzar, pedidos, game, correr } = montar();
  lanzar('open-shop', { target: { position: new THREE.Vector3(1, 0, 0) } });
  assert.match(pedidos[0].path, /vendedora_ambiente/);
  assert.equal(pedidos[0].opts.allowPaused, true);
  lanzar('open-shop', { target: { position: new THREE.Vector3(1, 0, 0) } });
  assert.equal(pedidos.length, 1, 'no saluda cada vez que se abre');
  correr(DIRECTOR.tienda.espera + .1);
  game.stats.higiene = 5;
  lanzar('open-shop', { target: { position: new THREE.Vector3(1, 0, 0) } });
  assert.match(pedidos[1].path, /senora_olor_1/, 'oliendo mal, se queja (con la voz de la vendedora)');
  lanzar('open-recycler');
  assert.match(pedidos[2].path, /reciclador/);
  lanzar('dealer-toggle', { dealer: game.dealer });
  assert.match(pedidos[3].path, /jibaro/);
  assert.equal(pedidos[3].opts.priority, 50);
  lanzar('substance-buy-fail', { reason: 'insufficient_money' });
  assert.match(pedidos[4].path, /jibaro/);
  lanzar('substance-buy-fail', { reason: 'otra' });
  assert.equal(pedidos.length, 5);
});

test('la requisa entra a la fuerza con voz de policía', () => {
  const { lanzar, pedidos } = montar();
  lanzar('substance-raid');
  assert.equal(pedidos.length, 1);
  assert.match(pedidos[0].path, /policia_[ab]/);
  assert.equal(pedidos[0].opts.force, true);
});

test('atropello: un momento después, el testigo más cercano grita; la víctima no', () => {
  const { gente, lanzar, correr } = montar();
  const victima = persona(1), testigo = persona(4), lejos = persona(30);
  gente.push(victima, testigo, lejos);
  lanzar('peaton-atropellado', { npc: victima });
  correr(.5);
  assert.equal(testigo.dicho.length, 0);
  correr(.2);
  assert.deepEqual(testigo.dicho, [['witnessRunOver', true]]);
  assert.equal(victima.dicho.length + lejos.dicho.length, 0);
});

test('atropello: si la víctima todavía grita, el testigo espera su turno; si no le llega, hace su «uy»', () => {
  const { gente, lanzar, correr } = montar();
  let ocupado = true;
  const gestos = [];
  const audio = { _voiceActive: () => ocupado, _voicePriority: () => 80, vocalizador: { decir: (n, g) => (gestos.push(g), true) } };
  const victima = persona(1), testigo = persona(4, { audio });
  gente.push(victima, testigo);
  lanzar('peaton-atropellado', { npc: victima });
  correr(1.5);
  assert.equal(testigo.dicho.length, 0, 'no habla encima de la víctima');
  ocupado = false;
  correr(.4);
  assert.deepEqual(testigo.dicho, [['witnessRunOver', true]], 'cuando la víctima calla, dice su frase');
  assert.deepEqual(gestos, []);
  // Si el canal sigue tomado pasado el rato de espera, no hay frase: solo el gesto.
  ocupado = true;
  testigo.dicho.length = 0;
  lanzar('peaton-atropellado', { npc: victima });
  correr(DIRECTOR.atropello.demora + DIRECTOR.atropello.espera + .5);
  assert.deepEqual(testigo.dicho, []);
  assert.deepEqual(gestos, ['uy']);
});

test('el conductor bravo toma la voz de su cuerpo, grita persiguiendo y pide auxilio al huir', () => {
  const { game, correr, director } = montar();
  const car = { position: new THREE.Vector3(5, 0, 0) };
  const driver = persona(3, { state: 'idle', car, look: { real: { sexo: 'mujer' } } });
  game.roadRage.driver = driver;
  correr(.3);
  driver.state = 'chase';
  correr(.3);
  assert.equal(car.voz, 'valentina', 'el carro queda con conductora');
  assert.equal(driver._voz, 'conductora', 'y ella grita con la voz de la conductora');
  assert.equal(driver.dicho.length, 0, 'la primera frase sale un momento después');
  correr(DIRECTOR.bravo.primera + .3);
  assert.deepEqual(driver.dicho, [['roadRage', true]]);
  correr(DIRECTOR.bravo.min + DIRECTOR.bravo.extra + .3);
  assert.equal(driver.dicho.length, 2, 'repite cada pocos segundos');
  driver.state = 'flee';
  correr(.3);
  assert.deepEqual(driver.dicho.at(-1), ['carjacked', true]);
  director.dispose();
});

test('el reclamo por el espejo cambia de sexo solo si de verdad se baja alguien de ese carro', () => {
  const { game, audio, lanzar, director } = montar();
  const car = { position: new THREE.Vector3(5, 0, 0) };
  game.roadRage.driver = persona(3, { state: 'idle', look: { real: { sexo: 'hombre' } } });
  game.roadRage.vehicle = null;           // el azar dijo que no: nadie se baja
  lanzar('mirror-stolen', { car });
  assert.equal(audio.recasts, undefined, 'sin conductor bravo, el carro conserva su voz');
  game.roadRage.vehicle = { car: { position: new THREE.Vector3() } }; // se baja, pero de otro carro
  lanzar('mirror-stolen', { car });
  assert.equal(audio.recasts, undefined);
  game.roadRage.vehicle = { car };
  lanzar('mirror-stolen', { car });
  assert.deepEqual(audio.recasts, [[car, 'hombre']]);
  director.dispose();
  lanzar('mirror-stolen', { car });
  assert.equal(audio.recasts.length, 1, 'al irse deja de escuchar');
});

test('si al carro ya se le oyó una voz del otro sexo, la conserva y quien se baja habla con la pareja de esa voz', () => {
  const { game, correr, director } = montar();
  const car = { position: new THREE.Vector3(5, 0, 0), voz: 'valentina', oido: true };
  const driver = persona(3, { state: 'idle', car, look: { real: { sexo: 'hombre' } } });
  game.roadRage.driver = driver;
  correr(.3);
  driver.state = 'chase';
  correr(.3);
  assert.equal(car.voz, 'valentina', 'el carro no cambia de voz');
  assert.equal(driver._voz, 'roberto', 'el hombre que se baja grita con voz de hombre');
  director.dispose();
});

test('la precarga es de la persona de al lado y de a dos por segundo', () => {
  const { gente, correr, precargas } = montar();
  gente.push(persona(2));
  correr(1);
  assert.ok(precargas.length >= 1 && precargas.length <= 2, `${precargas.length} en un segundo`);
  correr(1);
  assert.ok(precargas.length <= 4);
  assert.ok(precargas.every(path => /senora_/.test(path)), 'solo frases de su voz');
});

test('la patrulla cerca hace que el pelado avise, y no a cada rato', () => {
  const { gente, game, correr } = montar();
  const pelado = persona(3, { _voz: 'nero_pelado' }), otra = persona(2);
  gente.push(pelado, otra);
  game.traffic.vehicles.push({ police: true, car: { position: new THREE.Vector3(20, 0, 0) } });
  correr(.3);
  assert.deepEqual(pelado.dicho, [['tomba', true]]);
  correr(30);
  assert.equal(pelado.dicho.length, 1);
  assert.equal(otra.dicho.length, 0);
});

test('al irse suelta los eventos, los ganchos del audio y el vocalizador', () => {
  const { director, audio, lanzar, pedidos, game } = montar();
  assert.equal(typeof audio.onVoiceLine, 'function');
  assert.equal(audio.policeRange(), 140);
  assert.ok(audio.vocalizador);
  director.dispose();
  lanzar('open-shop', { target: game.dealer });
  assert.equal(pedidos.length, 0);
  assert.equal(audio.onVoiceLine, null);
  assert.equal(audio.policeRange, null);
  assert.equal(audio.vocalizador, null);
  assert.equal(audio.worldVoices.onLine, null);
});
