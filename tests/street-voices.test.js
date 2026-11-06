import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STREET_VOICES, StreetVoices } from '../src/systems/StreetVoices.js';

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

const person = (x, z = 0, sexo = 'mujer') => ({ position: { x, y: 0, z }, look: { real: { sexo } }, say(text, duration) { this.dicho = { text, duration }; } });
const listener = { x: 0, y: 0, z: 0 };
const finishAll = (bank) => { for (const sound of Object.values(bank)) sound.finish(); };
const totalStarts = (bank) => Object.values(bank).reduce((sum, sound) => sum + sound.starts, 0);

function fixture() {
  const bank = Object.fromEntries(STREET_VOICES.map(clip => [clip.key, new FakeSound()]));
  return { bank, voices: new StreetVoices({ bank, random: () => 0 }) };
}

test('cada frase de la calle trae su texto para la burbuja', () => {
  assert.equal(STREET_VOICES.length, 9);
  for (const clip of STREET_VOICES) {
    assert.ok(clip.text.trim().length > 0, clip.key);
    assert.ok(['mujer', 'hombre'].includes(clip.sexo), clip.key);
  }
});

test('cada frase sale de alguien de su mismo sexo', () => {
  for (const sexo of ['mujer', 'hombre']) {
    const dichas = new Set();
    for (let i = 0; i < 40; i++) {
      const bank = Object.fromEntries(STREET_VOICES.map(clip => [clip.key, new FakeSound()]));
      const voices = new StreetVoices({ bank, random: () => (i % 8) / 8 });
      const quien = person(2, 0, sexo);
      voices.update(listener, [quien], 0);
      if (quien.dicho) dichas.add(quien.dicho.text);
    }
    assert.ok(dichas.size > 1, `${sexo} dice varias frases`);
    for (const text of dichas) assert.equal(STREET_VOICES.find(clip => clip.text === text).sexo, sexo, text);
  }
  const bank = Object.fromEntries(STREET_VOICES.map(clip => [clip.key, new FakeSound()]));
  const voices = new StreetVoices({ bank, random: () => 0 });
  const nadie = { position: { x: 2, y: 0, z: 0 }, say() { this.dicho = true; } };
  voices.update(listener, [nadie], 0);
  assert.equal(nadie.dicho, undefined, 'sin sexo conocido no le pone una voz ajena');
});

test('solo habla quien está cerca y la frase sale de esa persona', () => {
  const { voices, bank } = fixture();
  const lejos = person(40), medio = person(11.5);
  voices.update(listener, [lejos, medio], 0);
  assert.equal(medio.dicho?.text, STREET_VOICES[0].text);
  assert.equal(lejos.dicho, undefined);
  const volume = bank.carechimba.lastVolume();
  assert.ok(volume > 0 && volume < 1, `a media distancia se oye bajito (${volume})`);
  assert.equal(voices.active, true);
  finishAll(bank);
  voices.update(listener, [medio], 7000);
  assert.equal(voices.active, false);
  // Quien se aleja a más de 18 m calla antes de terminar el audio.
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
  assert.equal(bank.carechimba.lastVolume(), 1);
  voices.update(listener, [a, b], 1000);
  assert.equal(totalStarts(bank), 1, 'mientras suena no empieza otra');
  finishAll(bank);
  voices.update(listener, [a, b], 7000);
  assert.equal(totalStarts(bank), 2);
  assert.equal(b.dicho?.text, STREET_VOICES.filter(clip => clip.sexo === 'mujer')[1].text, 'la burbuja la pone la otra persona');
});

test('la misma persona y la misma grabación esperan su enfriamiento', () => {
  const { voices, bank } = fixture();
  const a = person(2), b = person(-2);
  voices.update(listener, [a, b], 0);
  assert.equal(bank.carechimba.starts, 1);
  assert.ok(a.dicho);
  finishAll(bank);
  voices.update(listener, [a, b], 6000);
  assert.equal(bank.enano.starts, 1);
  assert.ok(b.dicho, 'la que ya habló no repite tan pronto');
  finishAll(bank);
  voices.update(listener, [a, b], 12000);
  assert.equal(totalStarts(bank), 2, 'sin nadie elegible la calle calla');
  finishAll(bank);
  a.dicho = null;
  voices.update(listener, [a, b], 25000);
  assert.equal(bank.enano.starts, 1, 'la grabación anterior no se repite antes de su enfriamiento');
  assert.equal(a.dicho?.text, STREET_VOICES.filter(clip => clip.sexo === 'mujer')[2].text);
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
