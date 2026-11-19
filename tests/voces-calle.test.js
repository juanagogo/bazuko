import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { FRASES, REPARTO, VOCES_LUFS, frasesDe, sinEtiquetas, vozPara } from '../src/data/vocesCalle.js';
import { DIRECTOR, VoiceDirector, vozDePersona } from '../src/systems/voces/VoiceDirector.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { loudnessGain } from '../src/systems/StreetVoices.js';
import { audioMetadata } from './helpers/audio-file.js';

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; this.listeners = {}; this.plays = 0; this.rates = []; this.pans = []; }
  state() { return this.unloaded ? 'unloaded' : this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.plays++; this.voices.set(id, { playing: this.loaded }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  pause(id) { this.stop(id); }
  volume(value, id) { if (this.voices.has(id)) this.voices.get(id).volume = value; }
  once(event, fn) { (this.listeners[event] ??= []).push(fn); }
  emit(event) { for (const fn of this.listeners[event] ?? []) fn(); this.listeners[event] = []; }
  rate(r) { this.rates.push(r); }
  stereo(p) { this.pans.push(p); }
  duration() { return 2; }
  unload() { this.unloaded = true; }
  on() {} off() {}
}

function persona({ arquetipo = 'senora', sexo = 'mujer', edad = 'adulto', at = [1, 0, 0] } = {}) {
  return {
    person: { arquetipo, sexo, real: { sexo, edad } }, look: { real: { sexo, edad } },
    position: new THREE.Vector3(...at), dichos: [],
    say(text, s) { this.dichos.push([text, s]); }
  };
}

function director({ random = () => .5 } = {}) {
  const cargados = [];
  let t = 0;
  const d = new VoiceDirector({ load: file => { const h = new FakeHowl({ file }); cargados.push(h); return h; }, random, now: () => t });
  return { d, cargados, avanzar: ms => { t += ms; }, origen: new THREE.Vector3() };
}

const callar = cargados => cargados.forEach(h => h.stop());

test('cada frase tiene su mp3 mono en public/audio/voces y no hay mp3 sin frase', () => {
  assert.equal(frasesDe('ambiente').length, 35);
  assert.equal(new Set(FRASES.map(frase => frase.id)).size, FRASES.length);
  const dir = new URL('../public/audio/voces/', import.meta.url);
  assert.deepEqual(readdirSync(dir).sort(), FRASES.map(frase => `${frase.id}.mp3`).sort());
  for (const frase of FRASES) {
    assert.match(frase.situacion, /^(ambiente|testigo_(llama|graba|cuelga|robo|pelea)|pelea|persecucion)$/);
    assert.equal(frase.audio, `/audio/voces/${frase.id}.mp3`);
    assert.ok(REPARTO[frase.voz], `${frase.id}: voz del reparto`);
    assert.equal(frase.gender, REPARTO[frase.voz].sexo);
    assert.equal(frase.text, sinEtiquetas(frase.dicho));
    assert.doesNotMatch(frase.text, /\[|\]/, 'la burbuja va sin etiquetas de dirección');
    const bytes = readFileSync(new URL(`${frase.id}.mp3`, dir));
    const { duration } = audioMetadata(bytes);
    assert.ok(duration > .5 && duration < 7, `${frase.id}: ${duration} s`);
    // MPEG: el modo de canal está en los bits 6-7 del cuarto byte de la cabecera (3 = mono).
    let offset = bytes.toString('ascii', 0, 3) === 'ID3'
      ? 10 + ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127) : 0;
    while ((bytes.readUInt16BE(offset) & 0xffe0) !== 0xffe0) offset++;
    assert.equal(bytes[offset + 3] >> 6, 3, `${frase.id} es mono`);
  }
  // Cada voz del reparto dice algo; ninguna sobra.
  assert.deepEqual(Object.keys(REPARTO).sort(), [...new Set(FRASES.map(f => f.voz))].sort());
});

test('cada persona habla con la voz de su arquetipo, su sexo y su edad, y siempre tiene qué decir', () => {
  const arquetipos = ['habitante', 'reciclador', 'senora', 'abuelo', 'oficinista', 'estudiante', 'obrero', 'vendedor', null];
  for (const arquetipo of arquetipos) for (const sexo of ['hombre', 'mujer']) for (const edad of ['joven', 'adulto', 'mayor']) {
    for (const r of [.1, .9]) {
      const voz = vozDePersona(persona({ arquetipo, sexo, edad }), () => r);
      assert.ok(REPARTO[voz], `${arquetipo} ${sexo} ${edad}`);
      assert.equal(REPARTO[voz].sexo, sexo, `${arquetipo} ${sexo}: voz de su sexo`);
      assert.ok(frasesDe('ambiente', voz).length >= 2, `${voz} tiene frases`);
    }
  }
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'hombre', edad: 'joven' }, () => .9), 'nero_pelado');
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'hombre', edad: 'mayor' }, () => .1), 'nero_viejo');
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'hombre', edad: 'adulto' }, () => .1), 'nero_pelado');
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'hombre', edad: 'adulto' }, () => .9), 'nero_viejo');
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'mujer' }), 'nera');
  assert.equal(vozPara({ arquetipo: 'reciclador', sexo: 'hombre' }), 'nero_viejo');
  assert.equal(vozPara({ arquetipo: 'senora', sexo: 'hombre' }), 'abuelo');
  assert.equal(vozPara({ arquetipo: 'estudiante', sexo: 'hombre' }), 'estudiante_h');
  assert.equal(vozPara({ arquetipo: 'obrero', sexo: 'hombre' }), 'busetero');
  assert.equal(vozPara({ arquetipo: 'vendedor', sexo: 'mujer' }), 'vendedora');
  assert.equal(vozPara({ arquetipo: 'vendedor' }), null, 'sin sexo todavía no se decide');
  // La voz se decide una vez: el azar no la cambia después.
  let r = .1;
  const { d } = director({ random: () => r });
  const nero = persona({ arquetipo: 'habitante', sexo: 'hombre', edad: 'adulto' });
  assert.equal(d.vozDe(nero), 'nero_pelado');
  r = .9;
  assert.equal(d.vozDe(nero), 'nero_pelado');
  // Sin cuerpo cargado no habla y vuelve a preguntar.
  const sinCuerpo = { position: new THREE.Vector3(1, 0, 0), person: { arquetipo: 'senora' }, say() {} };
  assert.deepEqual(d.frasesPara(sinCuerpo), []);
  sinCuerpo.person.sexo = 'mujer';
  assert.equal(d.vozDe(sinCuerpo), 'senora');
});

test('la primera frase al pasar sale a los 4 s y las siguientes cada 7 a 14 s', () => {
  for (const [r, espera] of [[0, 7000], [.999, 7000 + .999 * 7000]]) {
    const { d, cargados, avanzar, origen } = director({ random: () => r });
    const gente = Array.from({ length: 6 }, (_, i) => persona({ at: [1 + i * .5, 0, 0] }));
    d.update(origen, gente);
    avanzar(3999);
    d.update(origen, gente);
    assert.equal(d.ultima, null, 'antes de 4 s nadie habla');
    avanzar(1);
    d.update(origen, gente);
    assert.ok(d.ultima, 'a los 4 s alguien habla');
    const primera = d.ultima;
    callar(cargados);
    avanzar(espera - 1);
    d.update(origen, gente);
    assert.equal(d.ultima, primera, `antes de ${espera} ms nadie más habla`);
    avanzar(1);
    d.update(origen, gente);
    assert.notEqual(d.ultima, primera, `a los ${espera} ms habla otra persona`);
  }
});

test('solo habla quien está a menos de 6 m, y la misma persona no repite enseguida', () => {
  const { d, cargados, avanzar, origen } = director();
  const lejos = persona({ at: [6.1, 0, 0] });
  d.update(origen, [lejos]);
  avanzar(4000);
  d.update(origen, [lejos]);
  assert.equal(d.ultima, null);
  assert.equal(lejos.dichos.length, 0);
  const cerca = persona({ at: [5.9, 0, 0] });
  avanzar(1000);
  d.update(origen, [lejos, cerca]);
  assert.equal(cerca.dichos.length, 1);
  assert.equal(lejos.dichos.length, 0);
  assert.deepEqual(cerca.dichos[0], [d.ultima.text, 2.4], 'burbuja del largo de la grabación');
  callar(cargados);
  // Se adelanta el turno del ambiente para mirar solo la ventana de la persona.
  avanzar(29999);
  d._nextAmbient = 0;
  d.update(origen, [cerca]);
  assert.equal(cerca.dichos.length, 1, 'antes de 30 s la misma persona no repite');
  avanzar(1);
  d._nextAmbient = 0;
  d.update(origen, [cerca]);
  assert.equal(cerca.dichos.length, 2, 'a los 30 s puede volver a hablar');
});

test('no hablan los dormidos, los noqueados, quien ya tiene burbuja ni quien ya no está', () => {
  for (const marca of [{ stance: 'dormido' }, { koState: 'ko' }, { _bubbleEl: {} }, { _disposed: true }]) {
    // Con azar 0 le tocaría a la más cercana.
    const { d, avanzar, origen } = director({ random: () => 0 });
    const cerca = Object.assign(persona({ at: [1, 0, 0] }), marca);
    const otra = persona({ at: [4, 0, 0] });
    d.update(origen, [cerca, otra]);
    avanzar(4000);
    d.update(origen, [cerca, otra]);
    assert.equal(cerca.dichos.length, 0, JSON.stringify(Object.keys(marca)));
    assert.equal(otra.dichos.length, 1, 'habla la otra');
  }
  const { d } = director();
  assert.equal(d.decir(Object.assign(persona(), { _disposed: true })), false);
});

test('habla una de las cuatro personas más cercanas', () => {
  // Con azar casi 1 le toca la última de las aptas: la cuarta más cercana, venga en el orden que venga.
  const { d, avanzar, origen } = director({ random: () => .999 });
  const gente = [5.5, 1, 4, 2, 5, 3].map(x => persona({ at: [x, 0, 0] }));
  d.update(origen, gente);
  avanzar(4000);
  d.update(origen, gente);
  assert.deepEqual(gente.map(n => n.dichos.length), [0, 0, 1, 0, 0, 0]);
});

test('la precarga solo pide las frases de quien está a menos de 6 m', () => {
  const { d, cargados, origen } = director();
  d.update(origen, [persona({ at: [6.1, 0, 0] })]);
  assert.equal(cargados.length, 0);
  const { d: d2, cargados: c2, origen: o2 } = director();
  d2.update(o2, [persona({ at: [5.9, 0, 0] })]);
  assert.equal(c2.length, frasesDe('ambiente', 'senora').length);
});

test('las frases de una voz no se repiten hasta que hayan salido todas', () => {
  const { d, cargados } = director({ random: (() => { let s = 3; return () => (s = (s * 16807) % 2147483647) / 2147483647; })() });
  const propias = frasesDe('ambiente', 'senora').map(f => f.text);
  const dichas = [];
  for (let i = 0; i < propias.length * 3; i++) {
    const senora = persona();
    assert.equal(d.decir(senora), true);
    dichas.push(d.ultima.text);
    callar(cargados);
  }
  for (let i = 0; i < dichas.length; i += propias.length) {
    assert.deepEqual(dichas.slice(i, i + propias.length).sort(), [...propias].sort(), 'cada vuelta dice todas una vez');
  }
  for (let i = 1; i < dichas.length; i++) assert.notEqual(dichas[i], dichas[i - 1], 'nunca la misma dos veces seguidas');
});

test('al arrancar no se pide ningún mp3 de voz; se piden al hablar y antes solo los de quien está al lado', () => {
  const howls = [];
  class Registro extends FakeHowl { constructor(o) { super(o); howls.push(this); } }
  const audio = new AudioSystem({ HowlClass: Registro, howler: { volume() {} }, eventTarget: new EventTarget() });
  const voces = () => howls.filter(h => /audio\/voces\//.test(h.options.src[0]));
  assert.equal(voces().length, 0, 'nada de voces al arrancar');
  const abuelo = persona({ arquetipo: 'abuelo', sexo: 'hombre', at: [2, 0, 0] });
  const senora = persona({ at: [5, 0, 0] });
  audio.updateWorld(.016, new THREE.Vector3(), null, [], null, [senora, abuelo]);
  const pedidos = voces().map(h => h.options.src[0].split('/').pop()).sort();
  assert.deepEqual(pedidos, frasesDe('ambiente', 'abuelo').map(f => `${f.id}.mp3`).sort(), 'solo las del de al lado');
  audio.dispose();
});

test('comparte el canal: espera a las otras voces, las hace esperar y el reclamo por robo la corta', () => {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  const senora = persona({ at: [1, 0, 0] });
  // Suena una frase de StreetVoices: la gente al pasar espera.
  const calle = audio.streetVoiceSounds.carechimba;
  audio.streetVoices._voice = { sound: calle, id: calle.play(), npc: senora, gain: 1 };
  assert.equal(audio.voces.decir(senora), false);
  audio.streetVoices.cancel();
  // Ahora sí habla, y mientras tanto las demás voces esperan.
  assert.equal(audio.voces.decir(senora), true);
  assert.ok(audio.voces.active);
  assert.match(audio.voces._voz.sound.options.src[0], /audio\/voces\/senora_ambiente_\d\.mp3$/);
  assert.equal(audio.streetVoices.externalVoiceActive(), true, 'StreetVoices espera');
  assert.equal(audio.conversations.externalVoiceActive(), true, 'las conversaciones esperan');
  assert.equal(audio.vehicles.externalVoiceActive(), true, 'los conductores esperan');
  assert.equal(audio._voiceActive(), true, 'tráfico y ambiente bajan');
  // El reclamo por robo de un espejo la corta.
  const sonido = audio.voces._voz.sound, id = audio.voces._voz.id;
  assert.equal(audio.playMovingTheft({ traffic: true, position: new THREE.Vector3() }), true);
  assert.equal(sonido.playing(id), false);
  assert.equal(audio.voces.active, false);
  assert.equal(audio.voces.decir(persona()), false, 'mientras reclaman nadie la tapa');
  audio._theftVoices.clear();
  // Una conversación o un conductor hablando: la gente espera.
  Object.defineProperty(audio.conversations, 'busy', { value: true, configurable: true });
  assert.equal(audio.voces.decir(persona()), false, 'espera a la conversación');
  Object.defineProperty(audio.conversations, 'busy', { value: false, configurable: true });
  audio.vehicles.remarkPlaying = () => true;
  assert.equal(audio.voces.decir(persona()), false, 'espera al conductor');
  audio.vehicles.remarkPlaying = () => false;
  assert.equal(audio.voces.decir(persona()), true);
  audio.dispose();
});

test('respeta la pausa y el volumen de Voces, y suena a la sonoridad de las demás voces', () => {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  audio.voces.random = () => .5;
  const senora = persona({ at: [1, 0, 0] });
  audio.updateWorld(.016, new THREE.Vector3(), null, [], null, []);
  assert.equal(audio.voces.decir(senora), true);
  const { sound, id } = audio.voces._voz;
  assert.ok(Math.abs(sound.voices.get(id).volume - DIRECTOR.volumen * loudnessGain(VOCES_LUFS)) < 1e-9, 'a -18 LUFS como las demás voces');
  audio.setMix('voices', .5);
  audio.updateWorld(.016, new THREE.Vector3(), null, [], null, []);
  assert.ok(Math.abs(sound.voices.get(id).volume - .5 * DIRECTOR.volumen * loudnessGain(VOCES_LUFS)) < 1e-9, 'sigue el volumen de Voces');
  audio.setPaused(true);
  assert.equal(audio.voces.active, false, 'la pausa la corta');
  assert.equal(audio.voces.decir(persona()), false, 'en pausa nadie habla');
  const antes = audio.voces.ultima;
  audio.voces._nextAmbient = 0;
  audio.voces.update(new THREE.Vector3(), [persona()]);
  assert.equal(audio.voces.ultima, antes, 'en pausa el ambiente no avanza');
  audio.dispose();
});

test('una frase solo arranca con su audio cargado: mientras carga no suena, no toma el canal ni deja nada en cola', () => {
  const { d, cargados, avanzar, origen } = director();
  d.load = file => { const h = new FakeHowl({ file }); h.loaded = false; cargados.push(h); return h; };
  const senora = persona();
  assert.equal(d.decir(senora), false, 'nada cargado todavía');
  assert.equal(cargados.length, 3, 'pidió sus tres frases');
  assert.equal(cargados.reduce((n, h) => n + h.plays, 0), 0, 'ningún play en cola');
  assert.equal(d.active, false);
  assert.equal(senora.dichos.length, 0);
  // En el ambiente, mientras carga, no gasta su turno: vuelve a intentar al segundo.
  d.update(origen, [senora]);
  avanzar(4000);
  d.update(origen, [senora]);
  assert.equal(senora.dichos.length, 0);
  cargados[1].loaded = true;
  avanzar(1000);
  d.update(origen, [senora]);
  assert.equal(senora.dichos.length, 1, 'cargada una, la dice');
  assert.equal(d.ultima.audio, `/audio/${cargados[1].options.file}`);
  assert.equal(cargados[1].plays, 1);
  assert.equal(cargados[0].plays + cargados[2].plays, 0);
});

test('si un mp3 no carga, al hablar o en la precarga, no se vuelve a pedir y su frase sale solo en la burbuja', () => {
  const { d, cargados, origen } = director();
  d.load = file => { const h = new FakeHowl({ file }); h.loaded = false; cargados.push(h); return h; };
  const senora = persona();
  // Precarga → fallan → habla.
  d.update(origen, [senora]);
  assert.equal(cargados.length, 3);
  for (const h of cargados) h.emit('loaderror');
  assert.ok(cargados.every(h => h.unloaded), 'los Howl que fallan se sueltan');
  assert.equal(d.decir(senora), true);
  assert.deepEqual(senora.dichos, [[d.ultima.text, DIRECTOR.burbuja.sinAudio]]);
  assert.equal(d.active, false, 'el canal queda libre');
  assert.equal(cargados.length, 3, 'no se vuelven a pedir');
  assert.equal(cargados.reduce((n, h) => n + h.plays, 0), 0);
  // Sin poder crear el audio, no rompe: devuelve false y quien llama sigue.
  const roto = new VoiceDirector({ load: () => null });
  assert.equal(roto.decir(persona()), false);
  roto.update(new THREE.Vector3(), [persona()]);
});

test('al hablar, la toma varía de tono y suena hacia el lado de quien habla', () => {
  const { d, cargados } = director({ random: () => .9 });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  d.camera = camera;
  d.update(new THREE.Vector3(), []);
  assert.equal(d.decir(persona({ at: [4, 0, 0] })), true);
  const h = cargados.find(x => x.plays);
  assert.ok(h.rates.length === 1 && Math.abs(h.rates[0] - 1) > .01, `tono ${h.rates}`);
  assert.ok(h.pans.length === 1 && h.pans[0] > .2, `paneo ${h.pans}`);
});

test('se oye plena hasta 3 m, baja después y a más de 15 m se calla y suelta el canal', () => {
  const { d } = director();
  const senora = persona({ at: [0, 0, 0] });
  const pleno = DIRECTOR.volumen * loudnessGain(VOCES_LUFS);
  d.update(new THREE.Vector3(), []);
  assert.equal(d.decir(senora), true);
  const { sound, id } = d._voz;
  d.update(new THREE.Vector3(3, 0, 0), []);
  assert.ok(Math.abs(sound.voices.get(id).volume - pleno) < 1e-9, 'plena a 3 m');
  d.update(new THREE.Vector3(9, 0, 0), []);
  const a9 = sound.voices.get(id).volume;
  assert.ok(a9 > 0 && a9 < pleno * .5, `a 9 m baja: ${a9}`);
  d.update(new THREE.Vector3(15.1, 0, 0), []);
  assert.equal(sound.playing(id), false, 'a más de 15 m se calla');
  assert.equal(d.active, false, 'y suelta el canal');
  // Si la persona deja de existir mientras habla, también se suelta.
  assert.equal(d.decir(senora), true);
  senora._disposed = true;
  d.update(new THREE.Vector3(1, 0, 0), []);
  assert.equal(d._voz, null);
});

test('con el audio del navegador suspendido nadie habla, y si el navegador no deja arrancar la frase, se suelta', () => {
  const ctx = { state: 'suspended' };
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {}, ctx, state: 'suspended' }, eventTarget: new EventTarget() });
  assert.equal(audio.voces.decir(persona()), false);
  ctx.state = 'running'; audio.howler.state = 'running';
  assert.equal(audio.voces.decir(persona()), true);
  const { sound, id } = audio.voces._voz;
  sound.options.onplayerror.call(sound, id);
  assert.equal(sound.playing(id), false, 'la frase bloqueada se suelta');
  assert.equal(audio.voces.active, false);
  audio.dispose();
});

test('al cerrar la partida se sueltan y descargan las voces', () => {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  assert.equal(audio.voces.decir(persona()), true);
  const howls = [...audio.voces._sounds.values()];
  const { sound, id } = audio.voces._voz;
  audio.dispose();
  assert.equal(sound.playing(id), false);
  assert.ok(howls.length === 3 && howls.every(h => h.unloaded), 'descargados');
  assert.equal(audio.voces._sounds.size, 0);
});
