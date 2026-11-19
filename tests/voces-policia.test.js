// Las voces de la Policía (voces/VocesDelMundo.js): los gritos y el megáfono de la patrulla que persigue, la radio con
// la operadora, el agente que pide apoyo al bajarse y el arresto. Qué frase sale, de qué patrulla, cuándo, con qué
// peso y a qué distancia; y que nada de esto cambia lo que hace la Policía.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { FRASES, frasesDe } from '../src/data/vocesCalle.js';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { ARRESTO, GRITO_POLICIA, RADIO_LLAMADA, RADIO_POLICIA, VocesDelMundo } from '../src/systems/voces/VocesDelMundo.js';
import { WitnessSystem } from '../src/systems/WitnessSystem.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
});

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; this.listeners = {}; }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: this.loaded }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  pause(id) { this.stop(id); }
  volume(value, id) { if (value === undefined) return this.voices.get(id)?.volume; if (this.voices.has(id)) this.voices.get(id).volume = value; }
  once(event, fn) { (this.listeners[event] ??= []).push(fn); }
  rate() {} stereo() {}
  duration() { return 2; }
  seek() { return 0; } fade() {} loop() {}
  unload() {} on() {} off() {}
}

const texto = id => FRASES.find(f => f.id === id).text;
const patrulla = (x, { persigue = true, crew = null } = {}) => ({
  police: true, state: persigue ? 'chase' : 'patrol', crew, car: { position: new THREE.Vector3(x, 0, 0), pursuit: persigue },
});

/** El director de verdad con audios falsos, la pieza de las voces del mundo y el jugador en el origen. */
function montar({ cargado = true, azar = [.5] } = {}) {
  const burbujas = [], pendientes = [];
  let i = 0;
  const voces = new VoiceDirector({
    load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; return h; },
    burbuja: (quien, text, s) => burbujas.push([quien, text, s]), random: () => .5, now: () => 0,
  });
  const mundo = new VocesDelMundo({ voces, eventTarget: window, random: () => azar[i++ % azar.length], esperar: fn => pendientes.push(fn) });
  const oyente = new THREE.Vector3();
  voces.update(oyente, []);
  const pasar = (segundos, vehiculos, paso = .1) => { for (let t = 0; t < segundos - 1e-9; t += paso) { voces.update(oyente, []); mundo.update(paso, oyente, vehiculos); } };
  const callar = () => voces.cancel();
  const avisar = (tipo, detail = {}) => window.dispatchEvent(new CustomEvent(tipo, { detail }));
  return { voces, mundo, burbujas, pendientes, oyente, pasar, callar, avisar, cargar: () => { for (const h of voces._sounds.values()) h.loaded = true; } };
}

test('la tabla de pesos pone el arresto encima de todo, el grito de la patrulla sobre los testigos y la radio debajo', () => {
  assert.equal(PRIORIDAD_VOZ.arrest, 100);
  assert.equal(PRIORIDAD_VOZ.policeShout, 75);
  assert.equal(PRIORIDAD_VOZ.radio, 60);
  assert.ok(PRIORIDAD_VOZ.arrest > PRIORIDAD_VOZ.robbed && PRIORIDAD_VOZ.robbed > PRIORIDAD_VOZ.policeShout);
  assert.ok(PRIORIDAD_VOZ.policeShout > PRIORIDAD_VOZ.witnessCall && PRIORIDAD_VOZ.witnessFight > PRIORIDAD_VOZ.radio);
  assert.ok(PRIORIDAD_VOZ.radio > PRIORIDAD_VOZ.semaforo);
});

test('la lista trae las 24 frases de la Policía: 10 por agente y 4 de la operadora', () => {
  for (const voz of ['policia_a', 'policia_b']) {
    assert.deepEqual(['grito', 'megafono', 'arresto', 'escape', 'radio'].map(s => frasesDe(s, voz).length), [5, 1, 1, 1, 2], voz);
  }
  assert.equal(frasesDe('radio', 'operadora').length, 4);
});

test('la patrulla que persigue grita al segundo y medio y luego cada 5 a 9 s, con su voz y la burbuja encima', () => {
  const m = montar({ azar: [.5] });
  const p = patrulla(8);
  m.pasar(GRITO_POLICIA.primero - .2, [p]);
  assert.equal(m.voces.active, false, 'todavía no');
  m.pasar(.4, [p]);
  assert.equal(m.voces.active, true);
  const voz = m.voces._voz;
  assert.equal(voz.entry.voz, 'policia_a');
  assert.equal(voz.entry.situacion, 'grito');
  assert.equal(voz.prioridad, PRIORIDAD_VOZ.policeShout);
  assert.equal(voz.rango, 26);
  assert.equal(voz.source.position, p.car.position, 'sale de la patrulla');
  assert.deepEqual(m.burbujas.at(-1).slice(0, 2), [p.car, voz.entry.text], 'la burbuja va encima de la patrulla');
  // Baja en línea recta con la distancia: a 8 de 26 m, un 69 % del volumen de cerca.
  const cerca = voz.sound.volume(undefined, voz.id);
  p.car.position.x = 16; m.voces.update(m.oyente, []);
  assert.ok(Math.abs(voz.sound.volume(undefined, voz.id) / cerca - (1 - 16 / 26) / (1 - 8 / 26)) < 1e-6);
  p.car.position.x = 8;
  // El siguiente, a los 5 + 0,5 × 4 = 7 s de este, y no repite frase hasta agotar las cinco.
  m.callar();
  m.pasar(6.8, [p]);
  assert.equal(m.voces.active, false);
  m.pasar(.4, [p]);
  assert.equal(m.voces.active, true);
  assert.notEqual(m.voces._voz.entry.id, voz.entry.id);
});

test('de lejos, la patrulla a veces usa el megáfono; de cerca, nunca', () => {
  const lejos = montar({ azar: [.5, .1] }); // [pausa, tirada del megáfono]
  lejos.pasar(2, [patrulla(20)]);
  assert.equal(lejos.voces._voz.entry.situacion, 'megafono');
  assert.equal(lejos.voces._voz.entry.text, texto('policia_a_megafono_1'));
  const sinSuerte = montar({ azar: [.5, .9] });
  sinSuerte.pasar(2, [patrulla(20)]);
  assert.equal(sinSuerte.voces._voz.entry.situacion, 'grito');
  const cerca = montar({ azar: [.5, .1] });
  cerca.pasar(2, [patrulla(GRITO_POLICIA.megafonoDesde - 1)]);
  assert.equal(cerca.voces._voz.entry.situacion, 'grito');
});

test('no grita la patrulla que no persigue, la que está a más de 26 m, ni mientras otra voz tiene el canal', () => {
  const quieta = montar();
  quieta.pasar(12, [patrulla(8, { persigue: false })]);
  assert.equal(quieta.voces.ultima, null);
  assert.equal(quieta.voces._sounds.size, 0, 'ni siquiera pide sus audios');
  const lejos = montar();
  lejos.pasar(12, [patrulla(27)]);
  assert.equal(lejos.voces.ultima, null);
  const ocupado = montar();
  const p = patrulla(8);
  ocupado.voces.otraVoz = () => true;
  ocupado.pasar(12, [p]);
  assert.equal(ocupado.voces.ultima, null, 'espera su turno: no corta a nadie');
  ocupado.voces.otraVoz = () => false;
  ocupado.pasar(.2, [p]);
  assert.equal(ocupado.voces.ultima.voz, 'policia_a');
});

test('cada patrulla conserva su voz, y dos patrullas no comparten la misma', () => {
  const m = montar();
  const a = patrulla(8), b = patrulla(9);
  assert.equal(m.mundo.vozDePatrulla(a.car), 'policia_a');
  assert.equal(m.mundo.vozDePatrulla(b.car), 'policia_b');
  assert.equal(m.mundo.vozDePatrulla(a.car), 'policia_a');
});

test('el agente conserva su toma al apearse y una patrulla sin agentes vivos deja la radio en silencio', () => {
  const m = montar();
  const conductor = { _voz: 'policia_b', out: false, position: new THREE.Vector3(-2, 0, 0), say(texto) { this.subtitulo = texto; } };
  const pareja = { _voz: 'policia_a', out: false, position: new THREE.Vector3(-4, 0, 0), isDead: true };
  const p = patrulla(8, { crew: { officers: [pareja, conductor], driver: conductor } });
  m.pasar(1.7, [p]);
  const grito = m.voces._voz;
  assert.equal(grito.entry.voz, conductor._voz);
  assert.equal(grito.source.position, p.car.position);
  conductor.out = true;
  m.pasar(.1, [p]);
  assert.equal(m.voces._voz.id, grito.id);
  assert.equal(grito.source, conductor);
  assert.equal(conductor.subtitulo, grito.entry.text);
  m.avisar('police-radio', { reason: 'llamada', motivo: 'muerte' });
  conductor.isDead = true;
  conductor.out = false;
  m.mundo.retirar(conductor);
  m.pasar(8, [p]);
  assert.equal(m.voces.active, false);
  assert.equal(m.mundo._radioCola.length, 0);
});

test('al empezar una persecución la operadora la anuncia por la radio de la patrulla más cercana', () => {
  const m = montar();
  const p = patrulla(30);
  m.pasar(.1, [p]);
  m.avisar('police-chase');
  m.pasar(RADIO_POLICIA.pausa - .2, [p]);
  assert.equal(m.voces.active, false, 'la radio deja una pausa antes de hablar');
  m.pasar(.4, [p]);
  assert.equal(m.voces.ultima.id, 'operadora_radio_1');
  assert.equal(m.voces._voz.prioridad, PRIORIDAD_VOZ.radio);
  assert.equal(m.voces._voz.rango, 35);
  assert.equal(m.voces._voz.source.position, p.car.position);
  assert.equal(m.burbujas.at(-1)[0], p.car);
});

test('cuando un testigo termina de llamar, la operadora manda la patrulla; otro aviso no dice nada', () => {
  const m = montar();
  const p = patrulla(10, { persigue: false });
  m.pasar(.1, [p]);
  m.avisar('police-radio', { reason: 'otro' });
  m.pasar(2, [p]);
  assert.equal(m.voces.ultima, null);
  m.avisar('police-radio', { reason: 'llamada', motivo: 'robo' });
  m.pasar(1, [p]);
  assert.equal(m.voces.ultima.id, 'operadora_radio_2');
});

test('la operadora solo anuncia un robo si llamaron por un robo: por una pelea manda la patrulla sin nombrarlo', () => {
  assert.deepEqual(RADIO_LLAMADA, { robo: 'operadora_radio_2', muerte: 'operadora_radio_3', otro: 'operadora_radio_1' });
  assert.match(texto(RADIO_LLAMADA.robo), /robo/);
  assert.doesNotMatch(texto(RADIO_LLAMADA.otro), /rob|hurt|atrac/i);
  for (const [motivo, id] of [['pelea', 'operadora_radio_1'], [null, 'operadora_radio_1'], [undefined, 'operadora_radio_1'], ['robo', 'operadora_radio_2'], ['muerte', 'operadora_radio_3']]) {
    const m = montar();
    const p = patrulla(10, { persigue: false });
    m.pasar(.1, [p]);
    m.avisar('police-radio', { reason: 'llamada', motivo });
    m.pasar(1, [p]);
    assert.equal(m.voces.ultima?.id, id, String(motivo));
    assert.equal(m.burbujas.at(-1)[1], texto(id));
    m.mundo.dispose();
  }
});

test('el motivo de la llamada llega de los testigos a la radio: una pelea no suena a robo, y la patrulla sale igual', () => {
  const pedidas = [];
  const npc = { position: new THREE.Vector3(5, 0, 0), witness(tipo) { this.witnessing = tipo; return true; }, say() {} };
  const game = {
    player: { position: new THREE.Vector3() }, world: { active: { npcs: [npc] } }, steal: { buscado: 0, _calma: 9 },
    traffic: { wantedLevel: 0, dispatchTo: (...a) => { pedidas.push(a); return true; } },
  };
  const llamar = motivo => {
    const testigos = new WitnessSystem(game, { random: () => 0 });
    npc.witnessing = null; npc._witnessFinished = false;
    assert.equal(testigos.report(motivo, motivo === 'pelea' ? [] : null), 1);
    assert.equal(testigos.calls.length, 1);
    npc.witnessing = null; npc._witnessFinished = true; // terminó de contar dónde y qué
    testigos.update(.1);
    testigos.dispose();
  };
  llamar('pelea'); llamar('robo');
  assert.deepEqual(pedidas.map(a => a[2]), ['pelea', 'robo']);
  assert.ok(pedidas.every(a => a[0].equals(new THREE.Vector3()) && a[1] === game.player.position), 'el sitio y el jugador, como siempre');
  assert.equal(game.steal.buscado, 2, 'el fichado sube igual por las dos');
});

test('si se les vuela, el agente lo dice por la radio y la operadora avisa a todas las unidades', () => {
  for (const [tirada, primera] of [[.2, 'policia_a_escape_1'], [.8, 'policia_a_radio_2']]) {
    const m = montar({ azar: [tirada] });
    const p = patrulla(12, { persigue: false }); // ya dejó de perseguir
    m.pasar(.1, [p]);
    m.avisar('police-escaped');
    m.pasar(1, [p]);
    assert.equal(m.voces.ultima.id, primera);
    m.callar();
    m.pasar(1, [p]);
    assert.equal(m.voces.ultima.id, 'operadora_radio_4');
    m.callar();
    m.pasar(3, [p]);
    assert.equal(m.voces.active, false, 'no queda nada en la radio');
  }
});

test('la radio no corta a nadie: espera su turno y, si en 6 s no lo tuvo, esa frase se pierde', () => {
  const m = montar();
  const p = patrulla(12, { persigue: false });
  m.pasar(.1, [p]);
  m.voces.otraVoz = () => true;
  m.avisar('police-chase');
  m.pasar(RADIO_POLICIA.caduca - 2, [p]);
  assert.equal(m.voces.ultima, null);
  m.voces.otraVoz = () => false;
  m.pasar(RADIO_POLICIA.pausa + .2, [p]);
  assert.equal(m.voces.ultima.id, 'operadora_radio_1', 'en cuanto el canal queda libre, tras su pausa');
  const tarde = montar();
  tarde.pasar(.1, [p]);
  tarde.voces.otraVoz = () => true;
  tarde.avisar('police-chase');
  tarde.pasar(RADIO_POLICIA.caduca + .2, [p]);
  tarde.voces.otraVoz = () => false;
  tarde.pasar(2, [p]);
  assert.equal(tarde.voces.ultima, null);
});

test('sin una patrulla a menos de 35 m nadie oye la radio, y con el audio sin cargar espera a que cargue', () => {
  const lejos = montar();
  lejos.pasar(.1, [patrulla(36, { persigue: false })]);
  lejos.avisar('police-chase');
  lejos.pasar(3, [patrulla(36, { persigue: false })]);
  assert.equal(lejos.voces.ultima, null);
  assert.equal(lejos.voces._sounds.size, 0);
  const m = montar({ cargado: false });
  const p = patrulla(12, { persigue: false });
  m.pasar(.1, [p]);
  m.avisar('police-chase');
  m.pasar(2, [p]);
  assert.equal(m.voces.ultima, null);
  assert.deepEqual([...m.voces._sounds.keys()], ['voces/operadora_radio_1.mp3'], 'el audio se pidió con el aviso');
  m.cargar();
  m.pasar(.2, [p]);
  assert.equal(m.voces.ultima.id, 'operadora_radio_1');
});

test('cuando los agentes se bajan a seguirlo a pie, uno pide apoyo por la radio y la operadora le contesta, una vez', () => {
  const m = montar();
  const crew = { pursuitOnFoot: false };
  const p = patrulla(10, { crew });
  m.mundo._gritoEn = 99; // sin gritos en esta prueba
  m.pasar(1, [p]);
  assert.equal(m.voces.ultima, null);
  crew.pursuitOnFoot = true;
  m.pasar(1, [p]);
  assert.equal(m.voces.ultima.id, 'policia_a_radio_1');
  assert.equal(m.voces._voz.source.position, p.car.position, 'por la radio de esa patrulla');
  m.callar();
  m.pasar(1, [p]);
  assert.equal(m.voces.ultima.id, 'operadora_radio_3');
  m.callar();
  m.mundo._gritoEn = 99;
  m.pasar(5, [p]);
  assert.equal(m.voces.ultima.id, 'operadora_radio_3', 'no lo repite mientras siguen a pie');
  crew.pursuitOnFoot = false; m.pasar(.2, [p]);
  crew.pursuitOnFoot = true; m.pasar(1, [p]);
  assert.equal(m.voces.ultima.id, 'policia_a_radio_1', 'otra bajada, otro pedido');
});

test('el arresto lo dice la patrulla aunque otra voz esté sonando, vale en pausa y la pausa no lo corta', () => {
  const m = montar();
  const p = patrulla(6);
  m.pasar(.1, [p]);
  const victima = { _voz: 'senora', position: new THREE.Vector3(1, 0, 0), look: { real: { accesorios: [] } }, say() {} };
  m.voces.prepararRobo(victima);
  assert.equal(m.voces.decirRobo(victima, 'pillado'), true);
  const todas = [];
  m.voces.callarOtras = t => todas.push(t);
  m.voces.setPaused(true); // el juego se pausa con el mismo aviso; aquí, incluso antes
  assert.equal(m.voces.active, false);
  m.avisar('police-arrest', { reason: 'chase' });
  assert.equal(m.voces.ultima.id, 'policia_a_arresto_1');
  assert.equal(m.voces._voz.prioridad, PRIORIDAD_VOZ.arrest);
  assert.deepEqual(todas, [true], 'calla también el reclamo por el espejo');
  assert.equal(m.burbujas.at(-1)[0], p.car);
  m.voces.setPaused(true);
  assert.equal(m.voces.active, true, 'la pausa no lo corta');
  // Sin pausa, sí corta a la víctima de un robo, que pesa más que cualquier otra cosa de la calle.
  const n = montar();
  n.pasar(.1, [p]);
  n.voces.prepararRobo(victima);
  n.voces.decirRobo(victima, 'pillado');
  n.avisar('police-arrest');
  assert.equal(n.voces.ultima.id, 'policia_a_arresto_1');
});

test('si el audio del arresto aún no cargó, sale en cuanto carga; y sin patrulla cerca no lo dice nadie', () => {
  const m = montar({ cargado: false });
  const p = patrulla(6);
  m.mundo._oyente = m.oyente; m.mundo._vehiculos = [p];
  m.avisar('police-arrest');
  assert.equal(m.voces.ultima, null);
  assert.equal(m.pendientes.length, 1, 'queda un reintento');
  m.pendientes.shift()();
  assert.equal(m.pendientes.length, 1);
  m.cargar();
  m.pendientes.shift()();
  assert.equal(m.voces.ultima.id, 'policia_a_arresto_1');
  assert.equal(m.pendientes.length, 0);
  const nunca = montar({ cargado: false });
  nunca.mundo._oyente = nunca.oyente; nunca.mundo._vehiculos = [p];
  nunca.avisar('police-arrest');
  for (let i = 0; i < 40 && nunca.pendientes.length; i++) nunca.pendientes.shift()();
  assert.equal(nunca.voces.ultima, null, `se rinde tras ${ARRESTO.veces} reintentos`);
  const sola = montar();
  sola.mundo._oyente = sola.oyente; sola.mundo._vehiculos = [patrulla(40)];
  sola.avisar('police-arrest');
  assert.equal(sola.voces.ultima, null);
  assert.equal(sola.pendientes.length, 0);
});

test('al soltar la pieza deja de oír los avisos', () => {
  const m = montar();
  const p = patrulla(6, { persigue: false });
  m.pasar(.1, [p]);
  m.mundo.dispose();
  m.avisar('police-chase'); m.avisar('police-arrest');
  m.pasar(2, [p]);
  assert.equal(m.voces.ultima, null);
});

test('el juego de verdad: el audio general arma la pieza, le pasa los vehículos y el arresto calla el reclamo por el espejo', () => {
  const eventos = new EventTarget();
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: eventos });
  assert.ok(audio.vocesMundo instanceof VocesDelMundo);
  const p = patrulla(8);
  const oyente = new THREE.Vector3();
  for (let t = 0; t < 2; t += .1) audio.updateWorld(.1, oyente, null, [p], null, []);
  assert.equal(audio.voces.ultima?.voz, 'policia_a', 'la patrulla que persigue grita');
  audio.voces.cancel();
  assert.equal(audio.playMovingTheft({ traffic: true, driverId: 'conductor:11', position: new THREE.Vector3() }), true);
  assert.equal(audio._theftVoiceActive(), true);
  eventos.dispatchEvent(new CustomEvent('police-arrest', { detail: {} }));
  assert.equal(audio.voces.ultima.id, 'policia_a_arresto_1');
  assert.equal(audio._theftVoiceActive(), false);
  audio.dispose();
  eventos.dispatchEvent(new CustomEvent('police-chase', { detail: {} }));
  assert.equal(audio.vocesMundo._radioCola.length, 0, 'al salir de la partida ya no oye los avisos');
});

test('la llamada de un testigo avisa por radio solo cuando sale una patrulla, y no cambia la persecución', () => {
  const montarTrafico = () => {
    const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40)], { carsPerRoute: 0, policeCount: 1, random: () => .2 });
    traffic.setEnvironment({ collisions: new CollisionSystem(), getGroundHeight: (_x, _z, y) => y });
    traffic.vehicles[0].car.position.set(0, 0, 0);
    traffic.vehicles[0].car.group.rotation.y = 0;
    return traffic;
  };
  const avisos = [];
  window.addEventListener('police-radio', e => avisos.push(e.detail));
  const traffic = montarTrafico();
  assert.equal(traffic.dispatchTo(new THREE.Vector3(500, 0, 500)), false);
  assert.deepEqual(avisos, [], 'sin patrulla que vaya, no hay radio');
  assert.equal(traffic.dispatchTo(new THREE.Vector3(15, 0, 0)), true);
  assert.deepEqual(avisos, [{ x: 0, z: 0, reason: 'llamada', motivo: null }]);
  assert.equal(traffic.dispatchTo(new THREE.Vector3(15, 0, 0)), false);
  assert.equal(avisos.length, 1, 'con la persecución en curso no vuelve a avisar');
  // Con alguien oyendo el aviso y sin nadie, la patrulla hace exactamente lo mismo.
  const sordo = montarTrafico();
  globalThis.window = undefined;
  sordo.dispatchTo(new THREE.Vector3(15, 0, 0));
  globalThis.window = new EventTarget();
  for (let i = 0; i < 50; i++) { traffic.update(.1); sordo.update(.1); }
  assert.equal(traffic.vehicles[0].distance, sordo.vehicles[0].distance);
  assert.equal(traffic.vehicles[0].state, sordo.vehicles[0].state);
  assert.ok(traffic.vehicles[0].car.position.equals(sordo.vehicles[0].car.position));
  traffic.dispose(); sordo.dispose();
});
