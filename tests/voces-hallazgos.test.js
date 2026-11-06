import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { PoliceSirenAudio } from '../src/systems/PoliceSirenAudio.js';
import { RadioSystem, STATIONS } from '../src/systems/RadioSystem.js';
import { STREET_VOICES, StreetVoices } from '../src/systems/StreetVoices.js';
import { sexoDeConductor } from '../src/systems/VehicleAudio.js';
import { Npc, getRandomVoice } from '../src/entities/Npc.js';
import { NPC_VOICE_BANK } from '../src/data/npcVoices.js';
import { prioridadDe } from '../src/systems/voces/prioridad.js';

// Una prueba por cada hallazgo de la revisión de voces (10 a 18; el 9/38 y el 14 están en voz-prioridad.test.js).

let nextId = 0;
class FakeHowl {
  constructor(options) { this.options = options; this.voices = new Map(); this.starts = 0; this.loaded = true; }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: true }); this.starts++; return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(voice => voice.playing) : !!this.voices.get(id)?.playing; }
  pause(id) { this.voices.get(id).playing = false; }
  stop(id) { for (const [key, voice] of this.voices) if (id === undefined || key === id) voice.playing = false; }
  volume(value, id) { if (id !== undefined && this.voices.has(id)) this.voices.get(id).volume = value; }
  pos() {}
  rate() {}
  seek() {}
  duration() { return 2; }
  unload() { this.unloaded = true; }
}
const origin = new THREE.Vector3();
function fixture() {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  audio.vehicles.random = () => .5;
  return { audio };
}
const car = (x, extra = {}) => ({ car: { position: new THREE.Vector3(x, 0, 0), group: new THREE.Group() }, speed: 0, ...extra });

test('hallazgo 10: la patrulla no tiene conductor de civil, no reclama y no pita cuando persigue', () => {
  const { audio } = fixture();
  const patrulla = car(2, { police: true, state: 'chase' });
  audio.updateWorld(.1, origin, null, [patrulla]);
  const state = audio.vehicles.instances.get(patrulla.car);
  assert.equal(audio.vehicles._driverOf.has(patrulla.car), false, 'sin voz de conductor');
  patrulla.personBlocked = true; state.patience = .05;
  for (let i = 0; i < 20; i++) audio.updateWorld(.1, origin, null, [patrulla]);
  assert.equal(state.remark, undefined, 'la patrulla no dice frases de pito');
  assert.ok(!state.horn, 'persiguiendo no pita: ya suena la sirena');
  assert.equal(state.blockedFor, 0);
  // Un carro de civil en la misma situación sí reclama (cuando la patrulla ya no está gritando).
  audio._silenceVoices(); audio._pendingVoice = null;
  const civil = car(3);
  audio.updateWorld(.1, origin, null, [civil]);
  const otro = audio.vehicles.instances.get(civil.car);
  civil.personBlocked = true; otro.patience = .05;
  audio.updateWorld(.1, origin, null, [civil]);
  audio.updateWorld(.1, origin, null, [civil]);
  assert.ok(otro.remark, 'el civil sí habla');
  assert.equal(audio.vehicles.heard(civil.car), true, 'y queda oído con esa voz');
  audio.dispose();
});

test('hallazgo 10: la patrulla de ronda que no persigue sí pita, pero sin frase', () => {
  const { audio } = fixture();
  const ronda = car(2, { police: true, state: 'patrol' });
  audio.updateWorld(.1, origin, null, [ronda]);
  const state = audio.vehicles.instances.get(ronda.car);
  ronda.personBlocked = true; state.patience = .05;
  audio.updateWorld(.1, origin, null, [ronda]);
  audio.updateWorld(.1, origin, null, [ronda]);
  assert.ok(state.horn);
  assert.equal(state.remark, undefined);
  audio.dispose();
});

class FakeSound {
  constructor() { this.playingId = null; this.starts = 0; }
  state() { return 'loaded'; }
  play() { const id = ++this.starts; this.playingId = id; return id; }
  playing(id) { return this.playingId === id; }
  stop(id) { if (this.playingId === id) this.playingId = null; }
  volume() {}
  duration() { return 2; }
}
const persona = (x, extra = {}) => ({ position: { x, y: 0, z: 0 }, say(text) { this.dicho = text; }, ...extra });

test('hallazgo 11: la calle no le presta su frase a quien ya habló con su voz del reparto', () => {
  const bank = Object.fromEntries(STREET_VOICES.map(clip => [clip.key, new FakeSound()]));
  const voices = new StreetVoices({ bank, random: () => 0 });
  const nero = persona(2, { _voz: 'nero_pelado', _vozOida: true });
  voices.update({ x: 0, y: 0, z: 0 }, [nero], 0);
  assert.equal(nero.dicho, undefined, 'ya se le oyó su voz: no cambia a la de la calle');
  const nuevo = persona(3, { _voz: 'nero_pelado' }); // tiene voz, pero todavía nadie la oyó
  voices.update({ x: 0, y: 0, z: 0 }, [nero, nuevo], 60000);
  assert.ok(nuevo.dicho);
  assert.equal(nuevo._voz, 'nero_pelado', 'decir una de la calle no le quita su voz del reparto');
  assert.equal(nuevo._vozOida, undefined, 'puede seguir diciendo las de la calle hasta que se le oiga la suya');
});

test('revisión: quien dijo una frase de la calle no se queda mudo cuando lo roban', () => {
  const bank = Object.fromEntries(STREET_VOICES.map(clip => [clip.key, new FakeSound()]));
  const voices = new StreetVoices({ bank, random: () => 0 });
  const hombres = ['abuelo', 'estudiante_h', 'conductor', 'busetero', 'reciclador', 'nero_pelado', 'nero_viejo']
    .map((voz, i) => persona(1 + i * .1, { _voz: voz, look: { real: { sexo: 'hombre' } } }));
  for (let i = 0; i < hombres.length; i++) { voices.update({ x: 0, y: 0, z: 0 }, hombres.filter(h => !h.dicho), 60000 * (i + 1)); voices.cancel(); }
  const dijeron = hombres.filter(h => h.dicho);
  assert.ok(dijeron.length >= 3, 'la calle sigue sonando');
  for (const hombre of dijeron) {
    // Todas las voces de hombre del reparto tienen su frase de robo; el banco no tiene ninguna sin voz.
    const entry = getRandomVoice('robbed', 'hombre', hombre._voz);
    assert.ok(entry, `${hombre._voz} conserva su frase de robo`);
    assert.equal(entry.voz, hombre._voz, 'y sale con su voz, no con la de otro');
  }
});

test('revisión: la burbuja de una frase de la calle cortada no se queda el largo de la grabación', () => {
  const bank = Object.fromEntries(STREET_VOICES.map(clip => [clip.key, new FakeSound()]));
  const voices = new StreetVoices({ bank, random: () => 0 });
  const burbuja = {};
  const hombre = persona(2, { say(text, seconds) { this._bubbleEl = burbuja; this._bubbleTimer = seconds; } });
  voices.update({ x: 0, y: 0, z: 0 }, [hombre], 0);
  assert.ok(hombre._bubbleTimer >= 2);
  voices.cancel();
  assert.ok(hombre._bubbleTimer <= .4, 'cortada, la burbuja se va enseguida');
  // Si para entonces ya tenía otra burbuja (otra frase), esa no se toca.
  const otra = persona(2, { say(text, seconds) { this._bubbleEl = burbuja; this._bubbleTimer = seconds; } });
  voices.update({ x: 0, y: 0, z: 0 }, [otra], 60000);
  otra._bubbleEl = {}; otra._bubbleTimer = 3;
  voices.cancel();
  assert.equal(otra._bubbleTimer, 3);
});

test('hallazgo 12: la sirena se oye hasta donde la patrulla desiste, no solo hasta los 90 m de siempre', () => {
  const notas = [];
  const ctx = {
    currentTime: 0,
    createOscillator: () => ({ type: '', frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }),
    createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }),
    createGain() { const g = { gain: { setValueAtTime() {}, linearRampToValueAtTime: v => notas.push(v), exponentialRampToValueAtTime() {} }, connect() {} }; return g; },
  };
  const siren = new PoliceSirenAudio({ fx: () => ({ ctx, out: {} }), random: () => 0 });
  const lejos = { police: true, car: { pursuit: true, position: { x: 120, y: 0, z: 0 } } };
  const sonar = far => { for (let i = 0; i < 400; i++) siren.update(1 / 60, { x: 0, y: 0, z: 0 }, [lejos], far); };
  sonar(undefined);
  assert.equal(notas.length, 0, 'con el alcance de siempre, a 120 m no suena');
  sonar(160);
  assert.ok(notas.length > 0 && notas.every(v => v > 0), 'con el alcance del fichado, sí');
  // El juego le pasa ese alcance desde el tráfico.
  const { audio } = fixture();
  let pedido = null;
  audio.policeSiren.update = (_dt, _pos, _vehicles, far) => { pedido = far; };
  audio.policeRange = () => 175;
  audio.updateWorld(.1, origin, null, []);
  assert.equal(pedido, 175);
  audio.dispose();
});

test('hallazgos 15 y 16: quien se baja a pelear tiene la voz del sexo del cuerpo y Roberto no presta voz ajena', () => {
  const { audio } = fixture();
  const carro = { position: new THREE.Vector3(2, 0, 0), traffic: true, group: new THREE.Group() };
  audio.vehicles.driverVoice(carro, 'roberto');
  assert.equal(audio.playMovingTheft(carro), true);
  const primero = audio._theftVoices.get(carro);
  assert.equal(audio.recastMovingTheft(carro, 'mujer'), true, 'se baja una mujer: el reclamo empieza de nuevo');
  assert.equal(primero.sound.playing(primero.id), false, 'el de Roberto se corta en el mismo instante');
  assert.equal(sexoDeConductor(audio.vehicles.driverVoice(carro)), 'mujer', 'la conductora que se baja reclama con voz de mujer');
  assert.equal(audio.vehicles.driverVoice(carro), 'valentina', 'la pareja de Roberto es Valentina');
  assert.equal(audio.recastMovingTheft(carro, 'hombre'), false, 'una sola vez por reclamo');
  // El rebusque en el semáforo: Roberto no lo grabó.
  const otro = { position: new THREE.Vector3(2, 0, 0), group: new THREE.Group() };
  audio.vehicles.driverVoice(otro, 'roberto');
  audio._theftVoices.clear();
  audio.updateWorld(.1, origin, null, []);
  assert.equal(audio.playDriverLine(otro, 'semaforo_si'), true);
  assert.equal(audio.vehicles.driverVoice(otro), 'conductor', 'nadie lo había oído: lo maneja el conductor');
  // Si ya se le oyó la voz de Roberto, contesta sin palabras (el vocalizador) en vez de con la de otro.
  const tercero = { position: new THREE.Vector3(2, 0, 0), group: new THREE.Group() };
  audio.vehicles.driverVoice(tercero, 'roberto');
  audio.vehicles.markHeard(tercero);
  const mudos = [];
  audio.onSilentDriver = (c, situacion) => { mudos.push(situacion); return false; };
  assert.equal(audio.playDriverLine(tercero, 'semaforo_si'), false);
  assert.deepEqual(mudos, ['semaforo_si']);
  assert.equal(audio.vehicles.driverVoice(tercero), 'roberto');
  audio.dispose();
});

test('revisión: el robo del espejo sin nadie que se baje deja la voz del carro, y un carro ya oído no cambia de voz', () => {
  const { audio } = fixture();
  // Nadie se baja (el 65 % de las veces): el reclamo es del conductor que ya tenía el carro.
  const solo = { position: new THREE.Vector3(2, 0, 0), traffic: true, group: new THREE.Group() };
  audio.vehicles.driverVoice(solo, 'valentina');
  assert.equal(audio.playMovingTheft(solo), true);
  assert.equal(audio.vehicles.driverVoice(solo), 'valentina');
  // Un carro que ya pitó con voz de Valentina: aunque se baje un hombre, el reclamo sigue con la voz que ya se oyó.
  const oido = { position: new THREE.Vector3(2, 0, 0), traffic: true, group: new THREE.Group() };
  audio.vehicles.driverVoice(oido, 'valentina');
  audio.vehicles.markHeard(oido);
  assert.equal(audio.playMovingTheft(oido), true);
  const reclamo = audio._theftVoices.get(oido);
  assert.equal(audio.recastMovingTheft(oido, 'hombre'), false);
  assert.equal(audio.vehicles.driverVoice(oido), 'valentina');
  assert.equal(reclamo.sound.playing(reclamo.id), true, 'el reclamo sigue sonando');
  // Y recastDriver tampoco le cambia la voz a un carro ya oído (sí con aunqueOido).
  assert.equal(audio.vehicles.recastDriver(oido, 'hombre'), 'valentina');
  assert.equal(audio.vehicles.recastDriver(oido, 'hombre', { aunqueOido: true }), 'roberto');
  audio.dispose();
});

test('hallazgo 13: el subtítulo del conductor sale con su frase y dura lo que dura el audio', () => {
  const { audio } = fixture();
  const dichos = [];
  audio.onVoiceLine = (c, text, seconds) => dichos.push({ text, seconds });
  const carro = { position: new THREE.Vector3(2, 0, 0), group: new THREE.Group() };
  audio.vehicles.driverVoice(carro, 'conductora');
  audio.updateWorld(.1, origin, null, []);
  assert.equal(audio.playDriverLine(carro, 'semaforo_si'), true);
  assert.equal(dichos.length, 1);
  assert.ok(dichos[0].text.length > 0);
  assert.equal(dichos[0].seconds, 2);
  audio.dispose();
});

// La radio con un <audio> de mentira, como en radio-stream.test.js.
function radioEnVivo(t) {
  const creados = [];
  globalThis.document = { createElement: () => {
    const el = { src: null, volume: 1, muted: false, paused: true, ended: false, readyState: 0, oyentes: {},
      canPlayType: () => '', addEventListener(tipo, fn) { (this.oyentes[tipo] ??= []).push(fn); }, removeEventListener() {},
      play() { return Promise.resolve(); }, pause() { this.paused = true; }, removeAttribute() {}, load() {} };
    creados.push(el); return el;
  } };
  globalThis.window = { dispatchEvent: () => true };
  const radio = new RadioSystem();
  t.after(() => { radio.destroy(); delete globalThis.document; delete globalThis.window; });
  radio.turnOn();
  radio.setStation(STATIONS.find(s => s.id === 'javeriana'));
  return { radio, el: creados.at(-1) };
}

test('hallazgo 17: una emisora en vivo que no suena no sube la salud mental ni calma al perro', t => {
  const { radio, el } = radioEnVivo(t);
  const stats = { saludMental: 50 }, dog = { time: 0 };
  radio.update(5, stats, dog);
  assert.equal(stats.saludMental, 50, 'sin datos todavía es pura estática');
  assert.equal(dog.time, 0);
  el.paused = false; el.readyState = 4;
  radio.update(5, stats, dog);
  assert.ok(stats.saludMental > 50, 'cuando de verdad suena, sí');
  assert.ok(dog.time > 0);
});

test('la radio baja mientras alguien habla y vuelve a su volumen al callar', t => {
  const { radio, el } = radioEnVivo(t);
  radio.setVolume(.5); radio.setMasterVolume(1);
  assert.equal(el.volume, .5);
  radio.setDuck(.45);
  assert.equal(el.volume, .225);
  radio.setDuck(.46); // un cambio mínimo no reescribe el volumen
  assert.equal(el.volume, .225);
  radio.setDuck(1);
  assert.equal(el.volume, .5);
  radio.setDuck(NaN);
  assert.equal(el.volume, .5);
});

test('revisión (hallazgo 13): con el canal tomado, la frase que no se va a oír no queda gastada ni cuenta como dicha', () => {
  const pedidas = [];
  let ocupado = true;
  const senora = {
    hp: 100, look: { real: { sexo: 'mujer' } }, _castVoice: () => 'senora', say() {},
    audio: {
      _voiceActive: () => ocupado, _voicePriority: () => 60,
      playNpcVoice(path, _owner, opts) { pedidas.push(path); opts.onStart?.(2); return true; },
    },
  };
  const propias = NPC_VOICE_BANK.ambient.filter(entry => entry.voz === 'senora');
  assert.ok(propias.length > 0);
  for (let i = 0; i < propias.length; i++) assert.equal(Npc.prototype.speakScenario.call(senora, 'ambient', true), false);
  assert.deepEqual(pedidas, [], 'ni siquiera pide el canal');
  assert.equal(senora._lastVoiceTime, undefined, 'no cuenta como dicha');
  // Libre el canal, todas sus frases siguen disponibles (ninguna quedó en los 8 s sin repetir).
  ocupado = false;
  for (let i = 0; i < propias.length; i++) assert.ok(getRandomVoice('ambient', 'mujer', 'senora'), `frase ${i + 1} disponible`);
  // Y una de más peso que la que suena sí sale.
  ocupado = true;
  assert.equal(Npc.prototype.speakScenario.call(senora, 'robbed', true), true);
  assert.equal(pedidas.length, 1);
});

test('revisión: la charla de ambiente no corta una frase de la calle; lo que le pasa al jugador sí', () => {
  const { audio } = fixture();
  audio.updateWorld(.1, origin, null, []);
  const hombre = { position: new THREE.Vector3(2, 0, 0), look: { real: { sexo: 'hombre' } }, say() {} };
  audio.streetVoices.update(origin, [hombre], 100000);
  assert.equal(audio.streetVoices.active, true);
  const quien = { position: new THREE.Vector3(1, 0, 0), hp: 100 };
  for (const category of ['ambient', 'tomba', 'busCaller', 'dealerWhisper']) {
    assert.equal(audio.playNpcVoice('/audio/voces/senora_ambiente_1.mp3', quien, { priority: prioridadDe(category) }), false, category);
    assert.equal(audio.lastRefusal, 'ocupado');
    assert.equal(audio.streetVoices.active, true, `${category} no la corta`);
  }
  assert.equal(audio.playNpcVoice('/audio/voces/senora_olor_1.mp3', quien, { priority: prioridadDe('smell') }), true);
  assert.equal(audio.streetVoices.active, false, 'el asco por el olor del jugador sí');
  audio.dispose();
});

test('revisión: los reclamos de Roberto que dice el conductor bravo no se cargan dos veces', () => {
  const creados = [];
  class Contado extends FakeHowl { constructor(options) { super(options); creados.push(options.src[0]); } }
  const audio = new AudioSystem({ HowlClass: Contado, howler: { volume() {} }, eventTarget: new EventTarget() });
  for (let n = 1; n <= 5; n++) {
    const file = `roberto_robo_espejo_n${n}.mp3`;
    assert.equal(creados.filter(src => src.endsWith(file)).length, 1, `${file}: un solo Howl`);
    assert.equal(audio._npcSounds.get(file), audio.theftSounds[n - 1], 'el del conductor bravo es el del carro');
  }
  // Y el conductor bravo la dice por el canal de siempre.
  audio.updateWorld(.1, origin, null, []);
  assert.equal(audio.playNpcVoice('/audio/roberto_robo_espejo_n2.mp3', { position: new THREE.Vector3(1, 0, 0), hp: 100 }, { priority: 65 }), true);
  assert.equal(audio._npcVoice.sound, audio.theftSounds[1]);
  audio.dispose();
});
