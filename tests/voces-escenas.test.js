// Las voces grabadas de la víctima de un robo (cosquilleo pillado o raponazo) y de los conductores a los que se les
// hace un show en el semáforo: qué frase dice cada quien, con qué voz, cuándo se pide su audio, quién corta a quién
// y qué pasa cuando no hay frase que cuadre. También cuenta qué frases de la lista suenan hoy y cuáles esperan.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { FRASES, REPARTO, frasesDe, vozPara } from '../src/data/vocesCalle.js';
import { ORDEN_VOZ, VOZ_REACCION } from '../src/data/rebusqueReacciones.js';
import { BANCO_TESTIGOS } from '../src/systems/voces/testigos.js';
import { NO_CUADRA, frasesDeRobo, tipoDeRaponazo } from '../src/systems/voces/robo.js';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { DIRECTOR, GOLPEADO, SEMAFORO, VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { StealSystem } from '../src/features/steal.js';
import { WitnessSystem } from '../src/systems/WitnessSystem.js';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { Npc } from '../src/entities/Npc.js';
import { fraseSuelta } from '../src/ui/fraseSuelta.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  globalThis.document ??= {
    getElementById() { return null; },
    createElement() { return { className: '', textContent: '', style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
  for (const tipo of ['toast', 'npc-dropped-loot']) window.addEventListener(tipo, e => eventos.push(e));
});
const avisos = () => eventos.filter(e => e.type === 'toast').map(e => e.detail.text);

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; this.listeners = {}; this.plays = 0; }
  state() { return this.unloaded ? 'unloaded' : this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.plays++; this.voices.set(id, { playing: this.loaded }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  pause(id) { this.stop(id); }
  volume(value, id) { if (this.voices.has(id)) this.voices.get(id).volume = value; }
  once(event, fn) { (this.listeners[event] ??= []).push(fn); }
  rate() {} stereo() {}
  duration() { return 2; }
  unload() { this.unloaded = true; }
  on() {} off() {}
}

// Una persona con la voz dada ya decidida, y lo que carga encima.
function persona(voz, { at = [1, 0, 0], carga = [] } = {}) {
  return {
    _voz: voz, position: new THREE.Vector3(...at), look: { real: { edad: 'joven', accesorios: carga.map(id => ({ id })) } },
    dichos: [], alarmas: [],
    say(text, s) { this.dichos.push([text, s]); },
    alarmedByTheft(desde, yaGrito) { this.alarmas.push(yaGrito); },
  };
}

function director({ cargado = true, random = () => .5 } = {}) {
  const cargados = [], burbujas = [];
  const d = new VoiceDirector({
    load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; cargados.push(h); return h; },
    burbuja: (quien, text, s) => burbujas.push([quien, text, s]),
    random, now: () => 0,
  });
  return { d, cargados, burbujas, archivos: () => cargados.map(h => h.options.file.replace(/^voces\//, '')).sort() };
}

const callar = cargados => cargados.forEach(h => h.stop());
const carro = (kind = 'carro', at = [4, 0, 0]) => ({ kind, position: new THREE.Vector3(...at) });

function stubRandom(value, fn) {
  const random = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = random; }
}

// Las voces que puede tener alguien de la calle (el reparto de cada arquetipo, sexo y edad).
function vocesDeLaGente() {
  const voces = new Set();
  for (const arquetipo of ['habitante', 'reciclador', 'senora', 'abuelo', 'oficinista', 'estudiante', 'obrero', 'vendedor', null]) {
    for (const sexo of ['hombre', 'mujer']) for (const edad of ['joven', 'adulto', 'mayor']) for (const r of [.1, .9]) {
      voces.add(vozPara({ arquetipo, sexo, edad }, () => r));
    }
  }
  return voces;
}

test('suenan 161 de las 164 frases del banco de voces', () => {
  const gente = vocesDeLaGente();
  gente.add('vecina_parque');
  const carros = ['conductor', 'conductora', 'busetero'], policias = ['policia_a', 'policia_b'];
  const suenan = new Set(), grupo = {};
  const cuenta = (nombre, frases) => { grupo[nombre] = 0; for (const f of frases) { if (!suenan.has(f.id)) grupo[nombre]++; suenan.add(f.id); } };
  // Lo que dice la gente con su voz: al pasar, cuando la roban, cuando le cae popó y cuando huele al jugador.
  for (const situacion of ['ambiente', 'robado', 'popo', 'olor']) cuenta(situacion, FRASES.filter(f => gente.has(f.voz) && f.situacion === situacion));
  cuenta('jugador', frasesDe('herido', 'protagonista'));
  cuenta('testigos', Object.values(BANCO_TESTIGOS).flat());
  // Quien maneja: el semáforo, el pito y el reclamo por el espejo.
  cuenta('semaforo', SEMAFORO.flatMap(situacion => carros.flatMap(voz => frasesDe(situacion, voz))));
  cuenta('pito', carros.flatMap(voz => frasesDe('pito', voz)));
  cuenta('espejo', carros.flatMap(voz => frasesDe('robo_espejo', voz)));
  // La Policía y la operadora.
  cuenta('policia', [...['grito', 'megafono', 'arresto', 'escape', 'radio'].flatMap(s => policias.flatMap(voz => frasesDe(s, voz))), ...frasesDe('radio', 'operadora')]);
  // El jíbaro, el voceador del bus y a quien el jugador le pega.
  cuenta('jibaro', frasesDe('ofrece', 'jibaro'));
  cuenta('saludo', frasesDe('saludo_cartucho', 'nero_esquina'));
  cuenta('voceador', frasesDe('voceador', 'busetero'));
  cuenta('golpeado', FRASES.filter(f => GOLPEADO.frases.includes(f.id)));
  assert.equal(FRASES.length, 164);
  assert.deepEqual(grupo, {
    ambiente: 39, jugador: 1, robado: 13, popo: 12, olor: 9, // con el reciclador
    testigos: 26,                                // 15 de testigo y 6 de la turba (una más ya contada al pasar)
    semaforo: 8, pito: 12, espejo: 6,
    policia: 24,
    jibaro: 4, saludo: 2, voceador: 4,
    golpeado: 1,                                 // la del ñero viejo; la del reciclador ya está contada con los testigos
  });
  assert.equal(suenan.size, 161);
  assert.ok(gente.has('reciclador'), 'el reciclador habla con su voz');
  assert.equal(FRASES.filter(f => f.voz === 'reciclador').length, 6);
  assert.ok(FRASES.filter(f => f.voz === 'reciclador').every(f => suenan.has(f.id)), 'y sus seis frases suenan');
  // Lo que espera, por situación. Quien enchufe una, la quita de aquí.
  const esperan = {};
  for (const f of FRASES) if (!suenan.has(f.id)) esperan[f.situacion] = (esperan[f.situacion] ?? 0) + 1;
  assert.deepEqual(esperan, {
    reto: 1,            // el ñero que reta al jugador: en el juego nadie lo provoca
    semaforo_bravo: 2,  // el conductor al que le limpian el vidrio sin pedirlo: ese trabajo no está en el juego
  });
  assert.equal(Object.values(esperan).reduce((a, b) => a + b, 0), 3);
});

test('la víctima grita con su voz una frase de «robado» que cuadra con lo que pasó, y su burbuja muestra el texto', () => {
  const ids = (voz, tipo) => frasesDeRobo(voz, tipo).map(f => f.id);
  // [voz, pillado con la mano adentro, raponazo a quien carga bolso, raponazo sin bolso]
  const tabla = [
    ['senora', ['senora_robado_2'], ['senora_robado_1', 'senora_robado_2'], ['senora_robado_2']],
    ['abuelo', ['abuelo_robado_1'], ['abuelo_robado_1'], ['abuelo_robado_1']],
    ['estudiante', [], ['estudiante_robado_1', 'estudiante_robado_2'], ['estudiante_robado_1', 'estudiante_robado_2']],
    ['estudiante_h', [], ['estudiante_h_robado_1'], ['estudiante_h_robado_1']],
    ['conductor', ['conductor_robado_1'], [], []],
    ['conductora', ['conductora_robado_1'], ['conductora_robado_1'], ['conductora_robado_1']],
    ['nero_pelado', ['nero_pelado_robado_1'], ['nero_pelado_robado_1'], ['nero_pelado_robado_1']],
    ['nero_viejo', ['nero_viejo_robado_1'], ['nero_viejo_robado_1'], ['nero_viejo_robado_1']],
    ['nera', ['nera_robado_1'], ['nera_robado_1'], ['nera_robado_1']],
    ['busetero', ['busetero_robado_1'], ['busetero_robado_1'], ['busetero_robado_1']],
    ['reciclador', ['reciclador_robado_1'], ['reciclador_robado_1'], ['reciclador_robado_1']],
    ['vendedor', [], [], []], ['vendedora', [], [], []],
  ];
  const usadas = new Set();
  for (const [voz, pillado, conBolso, sinBolso] of tabla) {
    assert.deepEqual(ids(voz, 'pillado'), pillado, `${voz} pillado`);
    assert.deepEqual(ids(voz, 'raponazo'), conBolso, `${voz} raponazo`);
    assert.deepEqual(ids(voz, 'raponazo-sin-bolso'), sinBolso, `${voz} sin bolso`);
    for (const id of [...pillado, ...conBolso, ...sinBolso]) usadas.add(id);
  }
  assert.equal(usadas.size, 13, 'las trece frases de la víctima tienen su robo');
  assert.deepEqual(ids('senora', 'otra-cosa'), [], 'un robo que no se conoce no tiene frase');
  assert.deepEqual(Object.keys(NO_CUADRA).sort(), ['pillado', 'raponazo', 'raponazo-sin-bolso']);
  // Pillado todavía no se llevó nada; «mi bolso» solo con bolso; en el raponazo nadie le deja la mano encima.
  for (const f of frasesDe('robado')) {
    if (/me robó|devuélvamelo|mi bolso/i.test(f.text)) assert.ok(!ids(f.voz, 'pillado').includes(f.id), f.text);
    if (/bolso/i.test(f.text)) assert.ok(!ids(f.voz, 'raponazo-sin-bolso').includes(f.id), f.text);
    if (/quite la mano/i.test(f.text)) assert.ok(!ids(f.voz, 'raponazo').includes(f.id), f.text);
  }
  assert.equal(tipoDeRaponazo(persona('senora', { carga: ['bolso'] })), 'raponazo');
  assert.equal(tipoDeRaponazo(persona('senora', { carga: ['bolsa', 'maletin'] })), 'raponazo-sin-bolso');
  assert.equal(tipoDeRaponazo({}), 'raponazo-sin-bolso');

  // Suena con su voz, su archivo y su burbuja, y pesa más que todo lo demás de la calle.
  for (const [voz, tipo, id] of [['senora', 'pillado', 'senora_robado_2'], ['abuelo', 'raponazo-sin-bolso', 'abuelo_robado_1'],
    ['nera', 'raponazo', 'nera_robado_1'], ['conductor', 'pillado', 'conductor_robado_1'], ['busetero', 'raponazo', 'busetero_robado_1']]) {
    const { d } = director();
    const npc = persona(voz);
    assert.equal(d.decirRobo(npc, tipo), true, `${voz} ${tipo}`);
    assert.equal(d.ultima.id, id);
    assert.equal(d.ultima.voz, voz, 'con su voz');
    assert.equal(d._voz.sound.options.file, `voces/${id}.mp3`);
    assert.equal(d._voz.sound.plays, 1);
    assert.deepEqual(npc.dichos, [[d.ultima.text, 2.4]], 'burbuja con el texto grabado, del largo de la grabación');
    assert.equal(d._voz.prioridad, 90);
    assert.equal(d._voz.source, npc);
  }
  assert.equal(PRIORIDAD_VOZ.robbed, 90);
  // Sin frase que cuadre no suena nada y no queda burbuja: la víctima pondrá su grito de siempre.
  for (const [voz, tipo] of [['estudiante', 'pillado'], ['conductor', 'raponazo'], ['vendedora', 'raponazo']]) {
    const { d, cargados } = director();
    const npc = persona(voz);
    assert.equal(d.decirRobo(npc, tipo), false, `${voz} ${tipo}`);
    assert.deepEqual(npc.dichos, []);
    assert.equal(cargados.reduce((n, h) => n + h.plays, 0), 0);
  }
  // La voz es la que la persona ya tiene: la misma con la que habla al pasar.
  const { d } = director();
  const senora = { person: { arquetipo: 'senora', sexo: 'mujer', real: { sexo: 'mujer' } }, look: { real: { sexo: 'mujer' } },
    position: new THREE.Vector3(1, 0, 0), say() {} };
  assert.equal(d.decirRobo(senora, 'raponazo'), true);
  assert.equal(d.ultima.voz, 'senora');
});

function juegoDeRobo(npc, voces) {
  const game = {
    player: { position: new THREE.Vector3() }, stats: { dinero: 0, salud: 100 }, inventory: { add: () => true },
    world: { active: { npcs: [npc] } }, input: { consumePress: () => false }, interaction: {},
    audio: voces ? { voces } : undefined,
  };
  // La barra del cosquilleo no hace falta aquí: sin documento, StealSystem no la arma (como en tests/steal.test.js).
  const documento = globalThis.document;
  delete globalThis.document;
  try { return { game, steal: new StealSystem(game) }; } finally { globalThis.document = documento; }
}

test('en el robo de verdad: el raponazo y el cosquilleo pillado suenan con la voz de la víctima; sin frase lista, su grito de siempre', () => {
  // Raponazo (Q) a una señora con bolso: cualquiera de sus dos frases, también «mi bolso».
  const oidas = new Set();
  for (const r of [.1, .9]) {
    const { d } = director({ random: () => r });
    const senora = persona('senora', { carga: ['bolso'] });
    stubRandom(.9, () => juegoDeRobo(senora, d).steal.executeRoboDirecto(senora));
    oidas.add(d.ultima.id);
    assert.deepEqual(senora.alarmas, [true], 'huye sin el grito en texto');
    assert.deepEqual(senora.dichos, [[d.ultima.text, 2.4]]);
  }
  assert.deepEqual([...oidas].sort(), ['senora_robado_1', 'senora_robado_2']);
  // Sin bolso encima nunca grita «mi bolso».
  for (const r of [.1, .9]) {
    const { d } = director({ random: () => r });
    const senora = persona('senora');
    stubRandom(.9, () => juegoDeRobo(senora, d).steal.executeRoboDirecto(senora));
    assert.equal(d.ultima.id, 'senora_robado_2');
  }
  // Al oficinista lo único que grabó es «quite la mano»: en el raponazo no cuadra y grita lo de siempre.
  {
    const { d } = director();
    const oficinista = persona('conductor');
    stubRandom(.9, () => juegoDeRobo(oficinista, d).steal.executeRoboDirecto(oficinista));
    assert.equal(d.ultima, null);
    assert.deepEqual(oficinista.alarmas, [false], 'el grito de siempre');
  }
  // Cosquilleo (E) fallado y pillado: «quite la mano» sí cuadra; «me robó el celular» no.
  const pillar = (npc, voces) => {
    const { steal } = juegoDeRobo(npc, voces);
    npc.alerta = 1;
    stubRandom(.5, () => steal.startCosquilleo(npc));
    stubRandom(0, () => steal._endMinigame(false, 'play'));
  };
  {
    const { d } = director();
    const oficinista = persona('conductor');
    pillar(oficinista, d);
    assert.equal(d.ultima.id, 'conductor_robado_1');
    assert.deepEqual(oficinista.alarmas, [true]);
    assert.ok(avisos().some(t => /Me pillaron/.test(t)), 'el aviso del robo sale igual');
  }
  {
    const { d } = director();
    const estudiante = persona('estudiante');
    pillar(estudiante, d);
    assert.equal(d.ultima, null, 'todavía no le han robado nada');
    assert.deepEqual(estudiante.alarmas, [false]);
  }
  // Con el audio sin cargar todavía, o sin audio en el juego: el grito de siempre, y nada queda en cola.
  {
    const { d, cargados } = director({ cargado: false });
    const senora = persona('senora');
    pillar(senora, d);
    assert.deepEqual(senora.alarmas, [false]);
    assert.deepEqual(senora.dichos, []);
    assert.ok(cargados.length > 0, 'quedó pedido para la próxima');
    assert.equal(cargados.reduce((n, h) => n + h.plays, 0), 0);
    const sola = persona('senora');
    pillar(sola, null);
    assert.deepEqual(sola.alarmas, [false]);
  }
});

test('con un peatón de verdad: si ya gritó con su voz no sale además el grito en el aviso; huye igual y se le caen las mismas monedas', () => {
  const scene = new THREE.Scene();
  const correr = (yaGrito) => {
    eventos.length = 0;
    const npc = new Npc(scene, new THREE.Vector3(2, 0, 0), { look: {} });
    stubRandom(.1, () => npc.alarmedByTheft(new THREE.Vector3(), yaGrito));
    return { huye: npc.fleeTimer, gritos: avisos().length, monedas: eventos.filter(e => e.type === 'npc-dropped-loot').map(e => e.detail.amount) };
  };
  const deSiempre = correr(undefined), conVoz = correr(true);
  assert.equal(deSiempre.gritos, 1);
  assert.equal(conVoz.gritos, 0, 'ya lo dijo con su voz y su burbuja');
  assert.equal(conVoz.huye, deSiempre.huye);
  assert.ok(conVoz.huye > 0);
  assert.deepEqual(conVoz.monedas, deSiempre.monedas, 'la plata que se le cae no cambia');
  assert.equal(conVoz.monedas.length, 1);
});

test('la víctima corta a la gente al pasar, a los testigos y a los conductores, y espera al reclamo por el espejo', () => {
  const { d, cargados } = director();
  d.update(new THREE.Vector3(), []);
  // Corta lo que dice la gente al pasar.
  assert.equal(d.decir(persona('abuelo')), true);
  const ambiente = d._voz;
  assert.equal(d.decirRobo(persona('senora'), 'raponazo'), true);
  assert.equal(ambiente.sound.playing(ambiente.id), false);
  // Mientras grita la víctima nadie la tapa: ni otro robo, ni un conductor, ni la gente al pasar; el testigo espera
  // su turno sin burbuja (tests/voces-turno.test.js).
  assert.equal(d.decirRobo(persona('abuelo'), 'raponazo'), false, 'a igual peso sigue la que ya suena');
  const esperando = persona('conductora');
  assert.equal(d.decirTestigo(esperando, 'llamar'), true, 'queda esperando su turno');
  assert.deepEqual(esperando.dichos, []);
  assert.equal(d.decirConductor(carro(), 'semaforo_si'), false);
  assert.equal(d.decir(persona('nera')), false);
  assert.match(d.ultima.id, /^senora_robado_/);
  // Corta al testigo que ya gritaba (en el raponazo el testigo reacciona antes que la víctima).
  callar(cargados);
  assert.equal(d.decirTestigo(persona('conductora'), 'robo'), true);
  const testigo = d._voz;
  assert.equal(d.decirRobo(persona('nero_viejo'), 'raponazo'), true);
  assert.equal(testigo.sound.playing(testigo.id), false);
  assert.equal(d.ultima.id, 'nero_viejo_robado_1');
  // Corta al conductor del semáforo.
  callar(cargados);
  assert.equal(d.decirConductor(carro(), 'semaforo_no'), true);
  const conductor = d._voz;
  assert.equal(d.decirRobo(persona('nera'), 'pillado'), true);
  assert.equal(conductor.sound.playing(conductor.id), false);
  // Lejos, en pausa o con el audio suspendido no suena.
  callar(cargados);
  assert.equal(d.decirRobo(persona('nera', { at: [DIRECTOR.rango, 0, 0] }), 'pillado'), false, 'a 15 m ya no se oye');
  d.audioListo = () => false;
  assert.equal(d.decirRobo(persona('nera'), 'pillado'), false);
  d.audioListo = () => true;
  d.setPaused(true);
  assert.equal(d.decirRobo(persona('nera'), 'pillado'), false);

  // Con las voces que ya había: corta la calle y espera al reclamo por el espejo, que pesa lo mismo.
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  audio.updateWorld(.016, new THREE.Vector3(), null, [], null, []);
  const calle = audio.streetVoiceSounds.carechimba;
  audio.streetVoices._voice = { sound: calle, id: calle.play(), npc: persona('abuelo'), gain: 1 };
  assert.equal(audio.voces.decirRobo(persona('senora'), 'raponazo'), true);
  assert.equal(audio.streetVoices.active, false, 'la frase de la calle se calla');
  audio.voces.cancel();
  assert.equal(audio.playMovingTheft({ traffic: true, driverId: 'conductor:11', position: new THREE.Vector3() }), true);
  assert.equal(audio.voces.decirRobo(persona('senora'), 'raponazo'), false, 'espera al reclamo por el espejo');
  audio.dispose();
});

test('los audios de la víctima se piden cuando el jugador la tiene a tiro, una vez por persona, y nunca al arrancar', () => {
  const howls = [];
  class Registro extends FakeHowl { constructor(o) { super(o); howls.push(this); } }
  const audio = new AudioSystem({ HowlClass: Registro, howler: { volume() {} }, eventTarget: new EventTarget() });
  const voces = () => howls.filter(h => /audio\/voces\//.test(h.options.src[0])).map(h => h.options.src[0].split('/').pop()).sort();
  const senora = persona('senora', { at: [9, 0, 0] });
  const { game, steal } = juegoDeRobo(senora, audio.voces);
  for (let i = 0; i < 10; i++) steal.update(.1);
  assert.deepEqual(voces(), [], 'nada al arrancar ni con la gente lejos');
  let pedidos = 0;
  const preparar = audio.voces.prepararRobo.bind(audio.voces);
  audio.voces.prepararRobo = npc => { pedidos++; preparar(npc); };
  senora.position.set(1, 0, 0);
  for (let i = 0; i < 10; i++) steal.update(.1);
  assert.deepEqual(voces(), ['senora_robado_1.mp3', 'senora_robado_2.mp3'], 'todas las suyas: todavía no se sabe qué robo será');
  assert.equal(pedidos, 1, 'una vez, no cada cuadro');
  // Se aleja y vuelve: se pide otra vez, pero los audios ya están.
  senora.position.set(9, 0, 0);
  steal.update(.1);
  senora.position.set(1, 0, 0);
  steal.update(.1);
  assert.equal(pedidos, 2);
  assert.equal(voces().length, 2);
  assert.equal(game.audio.voces.active, false, 'pedir no hace sonar nada');
  audio.dispose();
});

test('quien maneja contesta con su voz: el busetero en la buseta y un conductor o una conductora en los demás', () => {
  let r = .2;
  const { d } = director({ random: () => r });
  const uno = carro(), otro = carro(), buseta = carro('buseta'), taxi = carro('taxi');
  assert.equal(d.vozDeCarro(uno), 'conductora');
  r = .8;
  assert.equal(d.vozDeCarro(otro), 'conductor');
  assert.equal(d.vozDeCarro(taxi), 'conductor');
  assert.equal(d.vozDeCarro(uno), 'conductora', 'el carro conserva su voz');
  assert.equal(d.vozDeCarro(buseta), 'busetero');
  assert.equal(d.vozDeCarro(null), null);
  assert.deepEqual([...SEMAFORO], ['semaforo_si', 'semaforo_no', 'semaforo_verde']);
  assert.equal(PRIORIDAD_VOZ.semaforo, 50);

  const casos = [
    ['carro', .8, 'semaforo_si', 'conductor_semaforo_si_1'], ['carro', .8, 'semaforo_no', 'conductor_semaforo_no_1'],
    ['carro', .8, 'semaforo_verde', 'conductor_semaforo_verde_1'], ['taxi', .2, 'semaforo_si', 'conductora_semaforo_si_1'],
    ['carro', .2, 'semaforo_no', 'conductora_semaforo_no_1'], ['carro', .2, 'semaforo_verde', 'conductora_semaforo_verde_1'],
    ['buseta', .2, 'semaforo_si', 'busetero_semaforo_si_1'], ['buseta', .8, 'semaforo_no', 'busetero_semaforo_no_1'],
  ];
  for (const [kind, azar, situacion, id] of casos) {
    const { d, burbujas } = director({ random: () => azar });
    const car = carro(kind);
    assert.equal(d.decirConductor(car, situacion), true, id);
    assert.equal(d.ultima.id, id);
    assert.equal(d._voz.sound.options.file, `voces/${id}.mp3`);
    assert.equal(d._voz.sound.plays, 1);
    assert.equal(d._voz.prioridad, 50);
    assert.equal(d._voz.source.position, car.position, 'la voz sale del carro y va con él');
    assert.deepEqual(burbujas, [[car, d.ultima.text, 2.4]], 'la burbuja sale encima del carro, con el texto grabado');
  }
  assert.equal(new Set(casos.map(c => c[3])).size, 8, 'las ocho frases del semáforo que tienen escena');
  // El busetero no grabó nada para el verde, y la del vidrio no tiene trabajo en el juego: no suenan ni se piden.
  const { d: otroDirector, burbujas, archivos } = director();
  assert.equal(otroDirector.decirConductor(carro('buseta'), 'semaforo_verde'), false);
  assert.equal(otroDirector.decirConductor(carro(), 'semaforo_bravo'), false);
  assert.equal(otroDirector.decirConductor(null, 'semaforo_si'), false);
  assert.deepEqual(burbujas, []);
  assert.ok(archivos().every(a => !/bravo/.test(a)));
  // Se pide lo que contestaría cada quien: tres frases el conductor, dos el busetero.
  const pedir = director({ random: () => .8 });
  pedir.d.prepararConductor(carro());
  assert.deepEqual(pedir.archivos(), ['conductor_semaforo_no_1.mp3', 'conductor_semaforo_si_1.mp3', 'conductor_semaforo_verde_1.mp3']);
  pedir.d.prepararConductor(carro('buseta'));
  assert.equal(pedir.archivos().filter(a => /^busetero_/.test(a)).length, 2);
  assert.equal(pedir.cargados.reduce((n, h) => n + h.plays, 0), 0, 'pedir no hace sonar nada');
});

/** Primer instante en que el eje X lleva `rojo` segundos para el verde. */
function instante(rojo) {
  for (let t = 0; t < 72; t += .25) if (signalState(t, 0) !== 0 && Math.abs((36 - t % 36) - rojo) < 1e-9) return t;
  throw new Error('sin instante');
}

/** Una cola de carros en rojo antes del primer cruce y el jugador delante, con pelotas (como tests/rebusque.test.js). */
function semaforo({ voces = null, cola = 2, kinds = [] } = {}) {
  const signals = new TrafficSignals();
  signals.update(instante(16));
  const node = signals.nodes[0];
  const z = node.z0 + 4.3, x0 = node.x0 - 8;
  const vehicles = [];
  for (let i = 0; i < cola; i++) {
    const car = { position: new THREE.Vector3(x0 - 5.5 * i, 0, z), group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, kind: kinds[i] ?? 'carro' };
    vehicles.push({ car, speed: 0, stopped: true });
  }
  const traffic = Object.assign(Object.create(TrafficSystem.prototype), { signals, vehicles });
  const stats = { dinero: 0, energia: 100, animo: 50, higiene: 80, xp: 0, addXP(n) { this.xp += n; } };
  return {
    traffic, stats, vehicles,
    player: { position: new THREE.Vector3(x0 + 3.2, 0, z), faceTowards() {} },
    inventory: { count: id => (id === 'malabares' ? 1 : 0), add: () => true },
    audio: voces ? { voces } : undefined,
  };
}
const show = (r, s = 8) => { for (let i = 0; i < s * 10 && r.activo; i++) r.update(.1); };

test('en el semáforo de verdad: al terminar el show contesta un conductor, y si cambia la luz, el que arranca', () => {
  // Todos pagan (azar 0): contesta el primero que dio, con «tome…», y el aviso cuenta la plata como siempre.
  {
    const { d, cargados, burbujas, archivos } = director({ random: () => .8 });
    const g = semaforo({ voces: d });
    const r = new RebusqueSystem(g, { random: () => 0 });
    r.update(.1);
    assert.deepEqual(archivos(), [], 'antes de empezar no se pide nada');
    assert.equal(r.intentar(), true);
    assert.deepEqual(archivos(), ['conductor_semaforo_no_1.mp3', 'conductor_semaforo_si_1.mp3', 'conductor_semaforo_verde_1.mp3'], 'al empezar se piden las de quienes miran');
    assert.equal(cargados.reduce((n, h) => n + h.plays, 0), 0, 'durante el show nadie contesta');
    show(r);
    assert.equal(d.ultima.id, 'conductor_semaforo_si_1');
    assert.equal(burbujas.length, 1);
    assert.equal(burbujas[0][0], g.vehicles[0].car, 'contesta el de adelante');
    assert.equal(burbujas[0][1], 'Tome, pa\' la gaseosa.');
    assert.ok(avisos().includes('2 carros me dieron $ 400.'));
    assert.equal(g.stats.dinero, 400);
  }
  // En la buseta contesta el busetero.
  {
    const { d } = director();
    const g = semaforo({ voces: d, cola: 1, kinds: ['buseta'] });
    const r = new RebusqueSystem(g, { random: () => 0 });
    r.intentar(); show(r);
    assert.equal(d.ultima.id, 'busetero_semaforo_si_1');
  }
  // Nadie da y se excusan (azar 0,5): «no tengo…».
  {
    const { d } = director({ random: () => .2 });
    const g = semaforo({ voces: d });
    const r = new RebusqueSystem(g, { random: () => .5 });
    r.intentar(); show(r);
    assert.equal(d.ultima.id, 'conductora_semaforo_no_1');
    assert.equal(g.stats.dinero, 0);
    assert.ok(avisos().some(t => /Nadie me dio nada/.test(t)));
  }
  // Uno da propina y el otro se excusa: se oye al que dio, una sola voz por show.
  {
    const { d, burbujas } = director({ random: () => .8 });
    const g = semaforo({ voces: d });
    const tiradas = [.5, .5, .33, .5, .5]; // el primero se excusa; el segundo da propina de monedas
    const r = new RebusqueSystem(g, { random: () => tiradas.shift() ?? .5 });
    r.intentar(); show(r);
    assert.equal(d.ultima.id, 'conductor_semaforo_si_1');
    assert.equal(burbujas.length, 1);
    assert.equal(burbujas[0][0], g.vehicles[1].car, 'contesta el que dio, no el primero de la cola');
  }
  // El que sube el vidrio, el que no mira, el que pita y el que insulta no tienen frase grabada: solo el aviso.
  for (const azar of [.7, .85, .95, .99]) {
    const { d, cargados } = director();
    const g = semaforo({ voces: d });
    const r = new RebusqueSystem(g, { random: () => azar });
    r.intentar(); show(r);
    assert.equal(d.ultima, null, `azar ${azar}`);
    assert.equal(cargados.reduce((n, h) => n + h.plays, 0), 0);
  }
  assert.deepEqual({ ...VOZ_REACCION }, { propina: 'semaforo_si', paga: 'semaforo_si', comida: 'semaforo_si', excusa: 'semaforo_no' });
  assert.deepEqual([...ORDEN_VOZ], ['propina', 'paga', 'comida', 'excusa']);
  // Cambia la luz a medio show: el primero arranca gritando que se quite, y no hay paga.
  {
    const { d, burbujas } = director({ random: () => .2 });
    const g = semaforo({ voces: d });
    const r = new RebusqueSystem(g, { random: () => 0 });
    r.intentar();
    r.update(.1);
    for (const v of g.vehicles) v.speed = 4;
    r.update(.1);
    assert.equal(r.activo, false);
    assert.equal(d.ultima.id, 'conductora_semaforo_verde_1');
    assert.equal(burbujas[0][1], '¡Está en verde, córrase!');
    assert.ok(avisos().includes('Cambió la luz y arrancaron sin pagarme.'));
    assert.equal(g.stats.dinero, 0);
  }
});

/** Corre `fn` con `Math.random` cambiado por un azar con semilla que cuenta sus tiradas; al final dice cuál seguía. */
function conSemilla(semilla, fn) {
  const real = Math.random;
  let s = semilla, tiradas = 0;
  Math.random = () => { tiradas++; s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  try { const hecho = fn(); return { ...hecho, tiradas, sigue: Math.random() }; } finally { Math.random = real; }
}

// El audio como lo arma el juego: el director sale de AudioSystem, sin que nadie le pase un azar.
const audioDelJuego = () => new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });

test('las voces no gastan el azar del juego: el mismo show, con voces y sin voces, sobre un solo azar con semilla', () => {
  const correr = (conVoces, semilla) => conSemilla(semilla, () => {
    eventos.length = 0;
    // El audio se arma en los dos casos, como en el juego; lo que cambia es si el show tiene a quién pedirle la voz.
    const audio = audioDelJuego();
    const g = semaforo({ voces: conVoces ? audio.voces : null, cola: 3, kinds: ['carro', 'buseta', 'carro'] });
    audio.voces.update(g.player.position, []);
    const r = new RebusqueSystem(g);
    r.intentar(); show(r);
    const hecho = { dinero: g.stats.dinero, animo: g.stats.animo, xp: g.stats.xp, avisos: avisos(), contesto: audio.voces.ultima?.id ?? null };
    audio.dispose();
    return hecho;
  });
  let contestaron = 0;
  for (const semilla of [7, 12345, 99991, 424242]) {
    const { contesto, ...conVoces } = correr(true, semilla);
    const { contesto: nadie, ...sinVoces } = correr(false, semilla);
    assert.equal(nadie, null);
    if (contesto) contestaron++;
    assert.ok(sinVoces.tiradas >= 4, 'el show sí tiró su azar');
    assert.deepEqual(conVoces, sinVoces, `semilla ${semilla}: la misma plata, los mismos avisos, las mismas tiradas y la misma que sigue`);
  }
  assert.ok(contestaron > 0, 'y con voces alguien contestó con su voz');
});

test('las voces no gastan el azar del juego: el mismo raponazo con testigos, con voces y sin voces, sobre un solo azar con semilla', () => {
  const scene = new THREE.Scene();
  const correr = (conVoces, semilla) => conSemilla(semilla, () => {
    eventos.length = 0;
    const audio = audioDelJuego();
    const victima = new Npc(scene, new THREE.Vector3(1, 0, 0), { look: {} });
    const testigos = [3, 5, 7].map(x => new Npc(scene, new THREE.Vector3(x, 0, 1), { look: {} }));
    victima._voz = 'senora';
    testigos.forEach((npc, i) => { npc._voz = ['conductora', 'estudiante', 'conductor'][i]; npc.target = null; npc.route = []; });
    const { game, steal } = juegoDeRobo(victima, conVoces ? audio.voces : null);
    game.player.stats = game.stats;
    game.world.active.npcs = [victima, ...testigos];
    game.steal = steal;
    game.traffic = { wantedLevel: 1, dispatchTo: () => true };
    game.witnesses = new WitnessSystem(game);
    audio.voces.update(game.player.position, []);
    steal.executeRoboDirecto(victima);
    const oidas = [audio.voces.ultima?.id ?? null];
    for (let t = 0; t < 6; t += .1) {
      game.witnesses.update(.1);
      audio.voces.update(game.player.position, []);
      if (audio.voces.ultima && audio.voces.ultima.id !== oidas.at(-1)) oidas.push(audio.voces.ultima.id);
    }
    const hecho = { salud: game.stats.salud, defensa: !!victima._counter, dinero: game.stats.dinero, buscado: steal.buscado, huye: victima.fleeTimer,
      hacen: testigos.map(npc => npc.witnessing), avisos: avisos(), oidas };
    game.witnesses.dispose(); audio.dispose();
    return hecho;
  });
  let conGrito = 0, defensas = new Set();
  for (const semilla of [3, 7, 11, 12345, 99991, 424242, 5150, 8086]) {
    const { oidas, avisos: avisosConVoces, ...conVoces } = correr(true, semilla);
    const { oidas: nadie, avisos: avisosSinVoces, ...sinVoces } = correr(false, semilla);
    assert.deepEqual(nadie, [null]);
    if (oidas.some(id => /^senora_robado_/.test(id ?? ''))) conGrito++;
    defensas.add(sinVoces.defensa);
    assert.deepEqual(conVoces, sinVoces, `semilla ${semilla}: el mismo daño, la misma plata, los mismos testigos, las mismas tiradas y la misma que sigue`);
    // Los avisos son los mismos, menos el grito en texto de la víctima cuando lo dijo con su voz.
    assert.deepEqual(avisosConVoces.filter(t => avisosSinVoces.includes(t)), avisosConVoces);
  }
  assert.equal(conGrito, 8, 'con voces la víctima gritó con su voz en todos');
  assert.equal(defensas.size, 2, 'entre semillas hay quienes anuncian su defensa y quienes huyen');
});

test('el conductor corta a la gente al pasar y a quien graba, y espera a quien grita por un robo', () => {
  const { d, cargados } = director();
  d.update(new THREE.Vector3(), []);
  assert.equal(d.decir(persona('abuelo')), true);
  const ambiente = d._voz;
  assert.equal(d.decirConductor(carro(), 'semaforo_si'), true);
  assert.equal(ambiente.sound.playing(ambiente.id), false, 'la gente al pasar se calla');
  assert.equal(d.decir(persona('nera')), false, 'y espera');
  assert.equal(d.decirConductor(carro(), 'semaforo_no'), false, 'otro conductor espera al que ya habla');
  const graba = persona('estudiante');
  assert.equal(d.decirTestigo(graba, 'grabar'), true, 'quien graba pesa menos: espera su turno');
  assert.deepEqual(graba.dichos, [], 'sin burbuja mientras no suene');
  const conductor = d._voz;
  assert.equal(d.decirTestigo(persona('conductora'), 'robo'), true, 'el grito de un testigo sí lo corta');
  assert.equal(conductor.sound.playing(conductor.id), false);
  assert.equal(d.decirConductor(carro(), 'semaforo_si'), false, 'y el conductor espera al testigo');
  callar(cargados);
  assert.equal(d.decirTestigo(persona('estudiante'), 'grabar'), true);
  assert.equal(d.decirConductor(carro(), 'semaforo_si'), true, 'corta a quien graba');
  // Lejos del jugador no se oye ni sale burbuja.
  callar(cargados);
  assert.equal(d.decirConductor(carro('carro', [DIRECTOR.rango, 0, 0]), 'semaforo_si'), false);
  // Con las voces que ya había: corta la calle y espera al reclamo por el espejo.
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  audio.updateWorld(.016, new THREE.Vector3(), null, [], null, []);
  audio.voces.random = () => .6;
  assert.equal(audio.voces.burbuja, fraseSuelta, 'la burbuja del carro es la de ui/fraseSuelta.js');
  const calle = audio.streetVoiceSounds.carechimba;
  audio.streetVoices._voice = { sound: calle, id: calle.play(), npc: persona('abuelo'), gain: 1 };
  assert.equal(audio.voces.decirConductor(carro(), 'semaforo_si'), true);
  assert.equal(audio.streetVoices.active, false);
  audio.voces.cancel();
  audio.playMovingTheft({ traffic: true, driverId: 'conductor:11', position: new THREE.Vector3() });
  assert.equal(audio.voces.decirConductor(carro(), 'semaforo_si'), false);
  audio.dispose();
});

test('la burbuja del conductor sale encima de su carro, una por carro, y se quita sola', () => {
  const previo = globalThis.document;
  const puestas = [];
  globalThis.document = {
    getElementById: () => null,
    createElement: () => { const el = { className: '', textContent: '', style: {}, offsetWidth: 120, offsetHeight: 30, quitada: false, remove() { this.quitada = true; } }; return el; },
    body: { appendChild: el => puestas.push(el) },
  };
  // Un reloj de mentira: lo que se programa y cuándo le toca.
  const relojes = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let ahora = 0;
  const pendientes = new Set();
  globalThis.setTimeout = (fn, ms) => { const cita = { fn, en: ahora + ms }; pendientes.add(cita); return cita; };
  globalThis.clearTimeout = cita => { pendientes.delete(cita); };
  const pasar = ms => { ahora += ms; for (const cita of [...pendientes]) if (cita.en <= ahora) { pendientes.delete(cita); cita.fn(); } };
  try {
    const car = carro();
    fraseSuelta(car, 'Tome, pa\' la gaseosa.', 2.4);
    assert.equal(puestas.length, 1);
    assert.equal(puestas[0].className, 'npc-bubble', 'la misma burbuja de la gente');
    assert.equal(puestas[0].textContent, 'Tome, pa\' la gaseosa.');
    // Si el mismo carro vuelve a hablar, la anterior se quita.
    fraseSuelta(car, '¡Está en verde, córrase!', 2);
    assert.equal(puestas.length, 2);
    assert.equal(puestas[0].quitada, true);
    assert.equal(puestas[1].quitada, false);
    assert.equal(pendientes.size, 1, 'el reloj de la anterior se soltó');
    pasar(1900);
    assert.equal(puestas[1].quitada, false);
    pasar(200);
    assert.equal(puestas[1].quitada, true, 'se quita al acabar la frase');
    // Sin texto o sin dónde ponerla no hace nada.
    fraseSuelta(car, '', 2);
    fraseSuelta({ position: { x: 0, y: 0, z: 0 } }, 'hola', 2);
    assert.equal(puestas.length, 2);
  } finally {
    Object.assign(globalThis, relojes);
    globalThis.document = previo;
  }
});

test('cada voz del reparto que contesta en el semáforo o grita por un robo existe', () => {
  for (const voz of ['conductor', 'conductora', 'busetero']) assert.ok(REPARTO[voz]);
  for (const f of frasesDe('robado')) assert.ok(REPARTO[f.voz], f.id);
});
