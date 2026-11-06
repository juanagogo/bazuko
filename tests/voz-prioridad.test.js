import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { PRIORIDAD_CANAL, PRIORIDAD_VOZ, prioridadDe } from '../src/systems/voces/prioridad.js';

// El canal único de voz grabada: quién corta a quién, la que espera a cargar y el arresto con el juego en pausa.

let nextId = 0;
class FakeHowl {
  constructor(options) { this.options = options; this.voices = new Map(); this.loaded = true; this._once = []; }
  state() { return this.unloaded ? 'unloaded' : this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: true }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(voice => voice.playing) : !!this.voices.get(id)?.playing; }
  pause(id) { this.voices.get(id).playing = false; }
  stop(id) { for (const [key, voice] of this.voices) if (id === undefined || key === id) voice.playing = false; }
  volume(value, id) { if (id !== undefined && this.voices.has(id)) this.voices.get(id).volume = value; }
  pos() {}
  rate() {}
  seek() {}
  duration() { return 2; }
  once(event, fn) { this._once.push([event, fn]); }
  unload() { this.unloaded = true; }
  /** Termina de cargar como lo hace Howler: avisa a quien esperaba. */
  cargar() {
    this.loaded = true;
    const listos = this._once.filter(([event]) => event === 'load');
    this._once = this._once.filter(([event]) => event !== 'load');
    for (const [, fn] of listos) fn();
  }
  falla(error = 'red') { this.options.onloaderror?.(0, error); }
}
const src = sound => sound.options.src[0];
const origin = new THREE.Vector3();
const owner = (x = 1) => ({ position: new THREE.Vector3(x, 0, 0), hp: 100 });

function fixture({ lazyLoaded = true } = {}) {
  const events = new EventTarget();
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: events });
  audio.vehicles.random = () => .5;
  const factory = audio._npcSoundFactory;
  audio._npcSoundFactory = (file, options) => { const howl = factory(file, options); howl.loaded = lazyLoaded; return howl; };
  audio.updateWorld(.1, origin, null, []);
  return { audio, events };
}
const lazy = (audio, file) => audio._npcSounds.get(file);
const AMBIENTE = '/audio/voces/senora_ambiente_1.mp3';
const ROBADO = '/audio/voces/senora_robado_1.mp3';
const PELEA = '/audio/voces/senora_testigo_pelea_1.mp3';

test('una voz solo corta a la que suena si pesa más; a igual peso sigue la que ya estaba', () => {
  const { audio } = fixture();
  assert.equal(audio.playNpcVoice(AMBIENTE, owner(), { priority: prioridadDe('ambient') }), true);
  const ambiente = audio._npcVoice;
  assert.equal(audio.playNpcVoice(AMBIENTE, owner(), { priority: prioridadDe('ambient') }), false);
  assert.equal(audio.lastRefusal, 'ocupado');
  assert.equal(audio.playNpcVoice(ROBADO, owner(), { priority: prioridadDe('robbed') }), true);
  assert.equal(ambiente.sound.playing(ambiente.id), false, 'el robo calla el comentario');
  assert.equal(audio._npcVoice.priority, PRIORIDAD_VOZ.robbed);
  // El golpe (80) no corta el robo (90); sin peso dicho, tampoco.
  assert.equal(audio.playNpcVoice(PELEA, owner(), { priority: prioridadDe('hit') }), false);
  assert.equal(audio.playNpcVoice(PELEA, owner()), false);
  // A la fuerza (el arresto) entra siempre.
  assert.equal(audio.playNpcVoice(PELEA, owner(), { force: true }), true);
  assert.match(src(audio._npcVoice.sound), /senora_testigo_pelea_1/);
  audio.dispose();
});

test('la voz del carro (90) y el reclamo del conductor (30) también cuentan en el canal', () => {
  const { audio } = fixture();
  const car = { position: new THREE.Vector3(2, 0, 0), traffic: true, group: new THREE.Group() };
  audio.vehicles.driverVoice(car, 'roberto');
  assert.equal(audio.playMovingTheft(car), true);
  assert.equal(audio._voicePriority(), PRIORIDAD_CANAL.carro);
  assert.equal(audio.playNpcVoice(PELEA, owner(), { priority: prioridadDe('hit') }), false);
  assert.equal(audio.playNpcVoice(ROBADO, owner(), { priority: prioridadDe('robbed') }), false, 'a igual peso sigue el carro');
  audio.dispose();
});

test('la frase que espera a cargar no la pisa otra de menos peso y calla la calle mientras tanto', () => {
  const { audio } = fixture({ lazyLoaded: false });
  assert.equal(audio.playNpcVoice(ROBADO, owner(), { priority: prioridadDe('robbed') }), false);
  assert.equal(audio.lastRefusal, 'espera');
  const robado = audio._pendingVoice;
  assert.equal(robado.priority, PRIORIDAD_VOZ.robbed);
  // Otra de menos peso no la reemplaza ni suena encima.
  assert.equal(audio.playNpcVoice(AMBIENTE, owner(), { priority: prioridadDe('ambient') }), false);
  assert.equal(audio.lastRefusal, 'ocupado');
  assert.equal(audio._pendingVoice, robado);
  // La calle y los conductores esperan a que hable.
  assert.equal(audio.streetVoices.externalVoiceActive(), true);
  assert.equal(audio.vehicles.externalVoiceActive(), true);
  lazy(audio, 'voces/senora_robado_1.mp3').cargar();
  audio.updateWorld(.1, origin, null, []);
  assert.match(src(audio._npcVoice.sound), /senora_robado_1/);
  assert.equal(audio._npcVoice.priority, PRIORIDAD_VOZ.robbed, 'al reintentar conserva su peso');
  audio.dispose();
});

test('la que espera a la fuerza sale a la fuerza: el reintento conserva force, peso y aviso de inicio', () => {
  const { audio } = fixture();
  assert.equal(audio.playNpcVoice(ROBADO, owner(), { priority: prioridadDe('robbed') }), true);
  const robado = audio._npcVoice;
  const factory = audio._npcSoundFactory;
  audio._npcSoundFactory = (file, options) => { const howl = factory(file, options); howl.loaded = false; return howl; };
  const empezo = [];
  const arresto = '/audio/voces/policia_a_arresto_1.mp3';
  assert.equal(audio.playNpcVoice(arresto, owner(), { force: true, priority: 100, onStart: s => empezo.push(s) }), false);
  assert.equal(audio._pendingVoice.priority, Infinity);
  assert.equal(robado.sound.playing(robado.id), true, 'mientras carga, no calla a nadie');
  lazy(audio, 'voces/policia_a_arresto_1.mp3').cargar();
  audio.updateWorld(.1, origin, null, []);
  assert.match(src(audio._npcVoice.sound), /policia_a_arresto_1/);
  assert.equal(robado.sound.playing(robado.id), false);
  assert.equal(empezo.length, 1);
  audio.dispose();
});

function arrestoEnPausa({ cargada }) {
  const { audio, events } = fixture({ lazyLoaded: cargada });
  // El juego se pausa en el mismo evento, después de WorldVoices (Game._policeArrest): así queda en el juego.
  events.addEventListener('police-arrest', () => audio.setPaused(true));
  const patrulla = { police: true, state: 'chase', car: { position: new THREE.Vector3(6, 0, 0), group: new THREE.Group() } };
  audio.updateWorld(.1, origin, null, [patrulla]);
  return { audio, events, patrulla };
}

test('hallazgo 9/38: el arresto ya cargado suena aunque el juego se pause en el mismo evento', () => {
  const { audio, events } = arrestoEnPausa({ cargada: true });
  const dicho = [];
  audio.worldVoices.onLine = frase => dicho.push(frase.id);
  events.dispatchEvent(new Event('police-arrest'));
  assert.equal(audio._paused, true);
  const voz = audio._npcVoice;
  assert.ok(voz, 'la frase del arresto sigue con el juego en pausa');
  assert.match(src(voz.sound), /policia_[ab]_arresto/);
  assert.equal(voz.sound.playing(voz.id), true);
  assert.equal(dicho.length, 1);
  audio.dispose();
});

test('hallazgo 9/38: el arresto sin cargar sale al cargar, aunque el juego esté en pausa y el reloj no corra', () => {
  const { audio, events } = arrestoEnPausa({ cargada: false });
  events.dispatchEvent(new Event('police-arrest'));
  assert.equal(audio._paused, true);
  assert.equal(audio._npcVoice, null);
  const pendiente = audio._pendingVoice;
  assert.ok(pendiente?.allowPaused, 'la espera del arresto sobrevive a la pausa');
  pendiente.sound.cargar();
  const voz = audio._npcVoice;
  assert.ok(voz);
  assert.match(src(voz.sound), /policia_[ab]_arresto/);
  assert.equal(voz.sound.playing(voz.id), true);
  // Lo que no puede sonar en pausa sí se calla, como antes.
  audio.setPaused(false);
  assert.equal(audio.playNpcVoice(AMBIENTE, owner(), { priority: 20 }), false);
  audio.dispose();
});

test('el arresto que tarda más de dos segundos en cargar ya no sale en medio del menú', () => {
  const { audio, events } = arrestoEnPausa({ cargada: false });
  events.dispatchEvent(new Event('police-arrest'));
  const pendiente = audio._pendingVoice;
  pendiente.untilMs = -1; // pasó el plazo en tiempo real
  pendiente.sound.cargar();
  assert.equal(audio._npcVoice, null);
  audio.dispose();
});

test('una voz de peatón se calla con la pausa y su espera también', () => {
  const { audio } = fixture({ lazyLoaded: false });
  audio.playNpcVoice(AMBIENTE, owner(), { priority: 20 });
  assert.ok(audio._pendingVoice);
  audio.setPaused(true);
  assert.equal(audio._pendingVoice, null);
  audio.dispose();
});

test('hallazgo 18: una voz que no cargó se rehúsa con «error» y se vuelve a pedir pasado un rato', t => {
  t.mock.method(console, 'error', () => {});
  const { audio } = fixture();
  const file = 'voces/senora_robado_1.mp3';
  audio._voiceSound(file).falla();
  assert.equal(audio.playNpcVoice(ROBADO, owner(), { priority: 90 }), false);
  assert.equal(audio.lastRefusal, 'error');
  const vieja = lazy(audio, file);
  for (let i = 0; i < 100; i++) audio.updateWorld(.1, origin, null, []);
  assert.equal(audio.playNpcVoice(ROBADO, owner(), { priority: 90 }), false, 'a los diez segundos todavía no');
  assert.equal(lazy(audio, file), vieja);
  for (let i = 0; i < 110; i++) audio.updateWorld(.1, origin, null, []);
  assert.equal(audio.playNpcVoice(ROBADO, owner(), { priority: 90 }), true);
  assert.notEqual(lazy(audio, file), vieja, 'pide la voz otra vez con un Howl nuevo');
  assert.equal(vieja.unloaded, true);
  assert.equal(audio._baseVolume.has(vieja), false);
  audio.dispose();
});

test('hallazgo 18: las voces que salen del caché no dejan su volumen guardado', () => {
  const { audio } = fixture();
  const antes = audio._baseVolume.size;
  for (let i = 0; i < 120; i++) audio._voiceSound(`voces/prueba_${i}.mp3`);
  assert.ok(audio._baseVolume.size - antes <= 40, `quedan ${audio._baseVolume.size - antes} volúmenes`);
  audio.dispose();
});

test('la frase de un menú que carga antes de que el juego alcance a pausarse sale igual', () => {
  const { audio } = fixture({ lazyLoaded: false });
  // open-shop: la voz pide el canal y el menú pausa el juego en el cuadro siguiente, sin otro updateWorld.
  assert.equal(audio.playNpcVoice('/audio/voces/vendedora_ambiente_1.mp3', owner(), { priority: 50, allowPaused: true }), false);
  assert.equal(audio.lastRefusal, 'espera');
  audio._pendingVoice.sound.cargar();
  assert.match(src(audio._npcVoice.sound), /vendedora_ambiente_1/);
  audio.setPaused(true);
  assert.equal(audio._npcVoice.sound.playing(audio._npcVoice.id), true, 'y sigue con el menú abierto');
  audio.dispose();
});
