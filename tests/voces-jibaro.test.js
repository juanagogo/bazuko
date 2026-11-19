// El susurro del jíbaro (voces/VocesDelMundo.js): solo de noche, con el jugador cerca, cada tanto, sin hablar encima
// de nadie y con su burbuja; y que el juego le dice a las voces quién es el jíbaro.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { frasesDe } from '../src/data/vocesCalle.js';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { SUSURRO_JIBARO, VocesDelMundo } from '../src/systems/voces/VocesDelMundo.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
});

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; this.listeners = new Map(); }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: this.loaded }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  pause(id) { this.stop(id); }
  volume(value, id) { if (value === undefined) return this.voices.get(id)?.volume; if (this.voices.has(id)) this.voices.get(id).volume = value; }
  once(event, handler) { this.listeners.set(event, handler); }
  off(event, handler) { if (this.listeners.get(event) === handler) this.listeners.delete(event); }
  finishLoading() {
    this.loaded = true;
    const handler = this.listeners.get('load');
    this.listeners.delete('load');
    handler?.();
  }
  on() {} rate() {} stereo() {} fade() {} loop() {} pos() {}
  seek() { return 0; }
  duration() { return 2; }
  unload() {}
}

function montar({ cargado = true, azar = .5 } = {}) {
  const burbujas = [];
  const voces = new VoiceDirector({
    load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; return h; },
    burbuja: (quien, text, s) => burbujas.push([quien, text, s]), random: () => .5, now: () => 0,
  });
  const mundo = new VocesDelMundo({ voces, eventTarget: window, random: () => azar });
  const oyente = new THREE.Vector3();
  const jibaro = { position: new THREE.Vector3(5, 0, 0), isNight: true };
  mundo.jibaro = jibaro;
  voces.update(oyente, []);
  const pasar = (segundos, paso = .1) => { for (let t = 0; t < segundos - 1e-9; t += paso) { voces.update(oyente, []); mundo.update(paso, oyente, []); } };
  return { voces, mundo, burbujas, jibaro, oyente, pasar, callar: () => voces.cancel(), archivos: () => [...voces._sounds.keys()].map(f => f.replace(/^voces\//, '')).sort() };
}

test('la lista trae las cuatro frases del jíbaro y pesa poco: solo le gana a la gente al pasar', () => {
  assert.equal(frasesDe('ofrece', 'jibaro').length, 4);
  assert.equal(PRIORIDAD_VOZ.dealerWhisper, 30);
  assert.ok(PRIORIDAD_VOZ.dealerWhisper > PRIORIDAD_VOZ.ambient && PRIORIDAD_VOZ.dealerWhisper < PRIORIDAD_VOZ.smell);
  assert.deepEqual(SUSURRO_JIBARO, { rango: 7, nivel: .9, min: 11, extra: 9, primero: 3.3, precarga: 14 });
});

test('de noche y a menos de 7 m susurra: el primero a los 3,3 s y luego cada 11 a 20 s, con su burbuja', () => {
  const m = montar({ azar: .5 });
  m.pasar(3.2);
  assert.equal(m.voces.ultima, null, 'todavía no');
  m.pasar(.2);
  assert.match(m.voces.ultima.id, /^jibaro_ofrece_\d$/);
  assert.deepEqual(m.burbujas, [[m.jibaro, m.voces.ultima.text, 2.4]], 'la burbuja sale donde está él');
  assert.equal(m.voces._voz.prioridad, 30);
  assert.equal(m.voces._voz.rango, 7);
  assert.equal(m.voces._voz.nivel, .9);
  // El siguiente, a los 11 + 9 × 0,5 = 15,5 s.
  m.callar();
  m.pasar(15.3);
  assert.equal(m.burbujas.length, 1);
  m.pasar(.4);
  assert.equal(m.burbujas.length, 2);
  assert.notEqual(m.burbujas[1][1], m.burbujas[0][1], 'no repite la misma seguida');
});

test('de día, lejos o sin jíbaro no susurra; su audio se pide a menos de 14 m', () => {
  const dia = montar();
  dia.jibaro.isNight = false;
  dia.pasar(30);
  assert.equal(dia.voces.ultima, null);
  assert.deepEqual(dia.archivos(), [], 'de día ni se pide');
  const lejos = montar();
  lejos.jibaro.position.x = 15;
  lejos.pasar(5);
  assert.deepEqual(lejos.archivos(), []);
  lejos.jibaro.position.x = 13;
  lejos.pasar(5);
  assert.equal(lejos.archivos().length, 4, 'ya cerca, sus cuatro audios');
  assert.equal(lejos.voces.ultima, null, 'pero a más de 7 m no dice nada');
  // Al llegar, como ya pasó su espera, susurra enseguida.
  lejos.jibaro.position.x = 6;
  lejos.pasar(.2);
  assert.match(lejos.voces.ultima.id, /^jibaro_ofrece_\d$/);
  const sin = montar();
  sin.mundo.jibaro = null;
  sin.pasar(10);
  assert.equal(sin.voces.ultima, null);
  const ido = montar();
  ido.jibaro._destruido = true;
  ido.pasar(10);
  assert.equal(ido.voces.ultima, null);
});

test('no habla encima de nadie: espera a que el canal quede libre, y cualquiera que pese más lo corta', () => {
  const m = montar();
  const pasa = { _voz: 'abuelo', position: new THREE.Vector3(1, 0, 0), say() {} };
  m.voces.precargar(pasa);
  assert.equal(m.voces.decir(pasa), true);
  m.pasar(6);
  assert.equal(m.voces.ultima.voz, 'abuelo', 'mientras alguien habla, calla');
  m.voces.otraVoz = () => true;
  m.callar();
  m.pasar(1);
  assert.equal(m.voces.ultima.voz, 'abuelo', 'también con otra voz del juego');
  m.voces.otraVoz = () => false;
  m.pasar(.2);
  assert.equal(m.voces.ultima.voz, 'jibaro');
  assert.equal(m.voces.decirOlor({ _voz: 'senora', position: new THREE.Vector3(1, 0, 0), say() {} }), true, 'quien huele al jugador lo corta');
  // Sin audio cargado no suena ni gasta su turno: lo dice en cuanto cargue.
  const sinCargar = montar({ cargado: false });
  sinCargar.pasar(5);
  assert.equal(sinCargar.burbujas.length, 0);
  for (const h of sinCargar.voces._sounds.values()) h.loaded = true;
  sinCargar.pasar(.2);
  assert.equal(sinCargar.burbujas.length, 1);
});

test('el juego de verdad: el audio general le pasa el tiempo a la pieza y el juego le dice quién es el jíbaro', () => {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  audio.voces.burbuja = () => {};
  audio.vocesMundo.jibaro = { position: new THREE.Vector3(4, 0, 0), isNight: true };
  const oyente = new THREE.Vector3();
  for (let t = 0; t < 4; t += .1) audio.updateWorld(.1, oyente, null, [], null, []);
  assert.equal(audio.voces.ultima?.voz, 'jibaro');
  audio.dispose();
  const juego = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(juego, /this\.audio\.vocesMundo\.jibaro = this\.dealer;/);
});

test('la patrulla cercana cambia lo que comenta el jíbaro de noche', () => {
  const m = montar();
  const patrulla = { police: true, car: { position: new THREE.Vector3(50, 0, 0) } };
  m.mundo.update(4, m.oyente, [patrulla]);
  assert.match(m.voces.ultima.id, /^jibaro_ofrece_[12]$/);

  m.callar();
  patrulla.car.position.x = 12;
  m.mundo.update(20, m.oyente, [patrulla]);
  assert.equal(m.voces.ultima.id, 'jibaro_ofrece_3');
});

test('al abrir el panel saluda con subtítulo y voz aunque el mundo esté en pausa', () => {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  const oyente = new THREE.Vector3();
  const jibaro = { position: new THREE.Vector3(1, 0, 0), isNight: true };
  audio.vocesMundo.jibaro = jibaro;
  audio.updateWorld(.1, oyente, null, [], null, []);

  const saludo = audio.saludarJibaro(jibaro, true, oyente);
  assert.equal(saludo, audio.voces.ultima.text);
  assert.equal(audio.voces.ultima.id, 'jibaro_ofrece_1');
  assert.equal(audio.voces.active, true);
  audio.updateWorld(.1, oyente, null, [], null, []);
  assert.equal(audio.voces.paused, true);
  audio.setMix('voices', 0);
  const { sound, id } = audio.voces._voz;
  assert.equal(sound.volume(undefined, id), 0);

  audio.cerrarJibaro();
  assert.equal(audio.voces.active, false);
  const respuesta = audio.saludarJibaro(jibaro, true, oyente);
  assert.equal(audio.voces.ultima.id, 'jibaro_ofrece_4');
  assert.equal(respuesta, audio.voces.ultima.text);
  assert.notEqual(respuesta, saludo);

  audio.cerrarJibaro();
  const saludoDiurno = audio.saludarJibaro(jibaro, false, oyente);
  assert.equal(saludoDiurno, saludo);
  audio.dispose();
});

test('si el audio llega tarde saluda solo mientras el panel sigue abierto', () => {
  const m = montar({ cargado: false });
  const saludo = m.mundo.saludarJibaro(m.jibaro, false);
  assert.equal(saludo, frasesDe('ofrece', 'jibaro')[0].text);
  const clip = m.voces._sounds.get('voces/jibaro_ofrece_1.mp3');
  assert.equal(m.voces.active, false);

  m.mundo.cerrarJibaro();
  clip.finishLoading();
  assert.equal(m.voces.active, false);

  assert.equal(m.mundo.saludarJibaro(m.jibaro, false), saludo);
  assert.equal(m.voces.active, true);
  m.mundo.cerrarJibaro();
});
