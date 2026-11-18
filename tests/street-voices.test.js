import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STREET_VOICES, StreetVoices, VOICE_LUFS, loudnessGain, voiceGain } from '../src/systems/StreetVoices.js';

class FakeSound {
  constructor() { this.playingId = null; this.starts = 0; this.volumes = new Map(); }
  state() { return 'loaded'; }
  play() { const id = ++this.starts; this.playingId = id; return id; }
  playing(id) { return this.playingId === id; }
  stop(id) { if (this.playingId === id) this.playingId = null; }
  volume(value, id) { this.volumes.set(id, value); }
  duration() { return 2; }
  finish() { this.playingId = null; }
  lastVolume() { return [...this.volumes.values()].at(-1); }
}

const person = (x, z = 0, sexo = 'mujer') => ({ look: { real: { sexo } }, position: { x, y: 0, z }, say(text, duration) { this.dicho = { text, duration }; } });
const listener = { x: 0, y: 0, z: 0 };
const finishAll = (bank) => { for (const sound of Object.values(bank)) sound.finish(); };
const totalStarts = (bank) => Object.values(bank).reduce((sum, sound) => sum + sound.starts, 0);

function fixture() {
  const bank = Object.fromEntries(STREET_VOICES.map(clip => [clip.key, new FakeSound()]));
  return { bank, voices: new StreetVoices({ bank, random: () => 0 }) };
}

test('cada frase de la calle trae su texto para la burbuja', () => {
  assert.equal(STREET_VOICES.length, 5);
  for (const clip of STREET_VOICES) assert.ok(clip.text.trim().length > 0, clip.key);
});

test('solo habla quien está cerca y la frase sale de esa persona', () => {
  const { voices, bank } = fixture();
  const lejos = person(40), apenas = person(11), medio = person(7);
  voices.update(listener, [lejos, apenas], 0);
  assert.equal(totalStarts(bank), 0, 'a 11 m se oiría apenas: no empieza');
  voices.update(listener, [lejos, apenas, medio], 2000);
  assert.equal(medio.dicho?.text, STREET_VOICES[0].text);
  assert.equal(lejos.dicho, undefined);
  const volume = bank.carechimba.lastVolume();
  assert.ok(volume > 0 && volume < 1, `a media distancia se oye bajito (${volume})`);
  assert.equal(voices.active, true);
  finishAll(bank);
  voices.update(listener, [medio], 9000);
  assert.equal(voices.active, false);
  // Quien se aleja a más de 15 m calla antes de terminar el audio.
  voices.update(listener, [person(2)], 100000);
  const sonando = STREET_VOICES.find(clip => bank[clip.key].playingId)?.key;
  assert.ok(sonando);
  voices.update({ x: 0, y: 0, z: 60 }, [person(2)], 100000);
  assert.equal(voices.active, false);
});

test('una sola frase a la vez: la siguiente espera a que termine y al intervalo', () => {
  const { voices, bank } = fixture();
  const a = person(3), b = person(-3);
  voices.update(listener, [a, b], 0);
  assert.equal(bank.carechimba.starts, 1);
  assert.ok(Math.abs(bank.carechimba.lastVolume() - .8 * loudnessGain(-18.4)) < 1e-9, 'de cerca suena plena, al nivel de una voz cercana');
  voices.update(listener, [a, b], 1000);
  assert.equal(totalStarts(bank), 1, 'mientras suena no empieza otra');
  finishAll(bank);
  voices.update(listener, [a, b], 21000);
  assert.equal(totalStarts(bank), 2);
  assert.equal(b.dicho?.text, STREET_VOICES[1].text, 'la burbuja la pone la otra persona');
});

test('la misma persona y la misma grabación esperan su enfriamiento', () => {
  const { voices, bank } = fixture();
  const a = person(2), b = person(-2);
  voices.update(listener, [a, b], 0);
  assert.equal(bank.carechimba.starts, 1);
  assert.ok(a.dicho);
  finishAll(bank);
  voices.update(listener, [a, b], 21000);
  assert.equal(bank.pirobito.starts, 1);
  assert.ok(b.dicho, 'la que ya habló no repite tan pronto');
  finishAll(bank);
  voices.update(listener, [a, b], 42000);
  assert.equal(totalStarts(bank), 2, 'sin nadie elegible la calle calla');
  finishAll(bank);
  a.dicho = null;
  voices.update(listener, [a, b], 130000);
  assert.equal(bank.enano.starts, 1, 'la grabación anterior no se repite antes de su enfriamiento');
  assert.equal(a.dicho?.text, STREET_VOICES[2].text);
});

test('la pausa y otra voz en curso callan la calle, y el robo cede el canal', () => {
  const { voices, bank } = fixture();
  const a = person(3);
  voices.externalVoiceActive = () => true;
  voices.update(listener, [a], 0);
  assert.equal(totalStarts(bank), 0, 'otra voz ocupa el canal');
  voices.externalVoiceActive = () => false;
  voices.update(listener, [a], 0);
  assert.equal(bank.carechimba.starts, 1);
  voices.cancel();
  assert.equal(bank.carechimba.playing(1), false);
  assert.equal(voices.active, false);
  voices.setPaused(true);
  const antes = totalStarts(bank);
  voices.update(listener, [a], 100000);
  assert.equal(totalStarts(bank), antes, 'en pausa no empieza otra');
});

test('cada quien dice solo grabaciones de su sexo y a quien no tiene sexo no se le da voz', () => {
  const { voices, bank } = fixture();
  const sinDato = { position: { x: 1, y: 0, z: 0 }, say() { this.dicho = true; } };
  voices.update(listener, [sinDato], 0);
  assert.equal(totalStarts(bank), 0);
  assert.equal(sinDato.dicho, undefined);
  const hombre = person(2, 0, 'hombre');
  voices.update(listener, [hombre], 2000);
  const dicha = STREET_VOICES.find(clip => bank[clip.key].starts);
  assert.equal(dicha.sexo, 'hombre');
  finishAll(bank);
  const mujer = person(2, 0, 'mujer');
  voices.update(listener, [mujer], 25000);
  const otra = STREET_VOICES.find(clip => bank[clip.key].starts && clip !== dicha);
  assert.equal(otra.sexo, 'mujer');
});

test('la voz suena plena de cerca, cae más rápido que la distancia y calla en el alcance', () => {
  assert.equal(voiceGain(2, 3, 15), 1);
  assert.ok(voiceGain(6, 3, 15) > .3, 'a 6 m todavía se entiende');
  assert.ok(voiceGain(10, 3, 15) < .2, 'a 10 m ya es lejana');
  assert.equal(voiceGain(15, 3, 15), 0);
});

test('las grabaciones, dispares de origen, quedan a la misma sonoridad que las demás voces', () => {
  for (const clip of STREET_VOICES) {
    assert.ok(Number.isFinite(clip.lufs), `${clip.key} trae su sonoridad medida`);
    const resulting = clip.lufs + 20 * Math.log10(loudnessGain(clip.lufs));
    assert.ok(Math.abs(resulting - VOICE_LUFS) < .01, `${clip.key}: ${resulting}`);
    assert.ok(.8 * loudnessGain(clip.lufs) <= 1, `${clip.key} no pasa del volumen máximo`);
  }
  assert.ok(loudnessGain(-7.5) < .35, 'la más fuerte baja a una tercera parte');
  assert.equal(loudnessGain(undefined), 1);
});
