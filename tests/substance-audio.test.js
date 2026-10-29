import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SubstanceAudio } from '../src/systems/SubstanceAudio.js';
import { createFakeAudioContext } from './helpers/fake-audio-context.js';

function fixture() {
  const fake = createFakeAudioContext();
  const sound = new SubstanceAudio({ howler: { ctx: fake.ctx, masterGain: fake.master } });
  return { ...fake, sound };
}

test('sin AudioContext no falla y no hace nada', () => {
  for (const audioSystem of [null, { howler: {} }]) {
    const s = new SubstanceAudio(audioSystem);
    s.playOnset('pegante');
    s.startSustain('pegante');
    s.update(1, { paused: false });
    s.stopSustain();
    s.dispose();
    assert.equal(s.out, null);
    assert.equal(s.bus, null);
  }
});

test('el pegante pone la ciudad bajo el agua y stopSustain lo restaura', () => {
  const { master, destination, sound } = fixture();
  sound.startSustain('pegante');
  assert.deepEqual(master.connections, [sound.muffle]);
  assert.deepEqual(sound.muffle.connections, [destination]);
  sound.update(1, { paused: false });
  assert.ok(Math.abs(sound.muffle.frequency.value - 700) < 1);
  sound.update(0, { paused: false });
  assert.ok(Math.abs(sound.muffle.frequency.value - 20000) < 1);
  sound.stopSustain();
  assert.deepEqual(master.connections, [destination]);
  assert.equal(sound.muffle, null);
});

test('la capa sostenida sigue la intensidad y calla en pausa; el volumen general manda', () => {
  const { master, sound } = fixture();
  sound.startSustain('hierba');
  assert.equal(sound.muffle, null);
  sound.update(0.5, { paused: false });
  assert.equal(sound.bus.gain.value, 0.5);
  assert.equal(sound.out.gain.value, 1);
  sound.update(0.5, { paused: true });
  assert.equal(sound.bus.gain.value, 0);
  master.gain.value = 0;
  sound.update(0.5, { paused: false });
  assert.equal(sound.out.gain.value, 0);
  assert.equal(sound.bus.gain.value, 0.5);
});

test('el sonido de consumir suena en pausa y no se apila al repetirlo', () => {
  const { ctx, destination, created, sound } = fixture();
  sound.playOnset('hierba');
  const afterFirst = created.length;
  assert.ok(afterFirst > 1);
  assert.deepEqual(sound.out.connections, [destination]);
  const sources = created.filter((n) => n.kind === 'bufferSource');
  assert.ok(sources.length > 0 && sources.every((n) => n.started && n.stopAt > 0));
  sound.update(0, { paused: true });
  assert.equal(sound.out.gain.value, 1);
  sound.playOnset('hierba');
  assert.equal(created.length, afterFirst);
  ctx.currentTime = 0.3;
  sound.playOnset('hierba');
  assert.ok(created.length > afterFirst);
});

test('si el audio arranca tarde, la capa sostenida empieza al reanudarse', () => {
  const { ctx, sound } = fixture();
  ctx.state = 'suspended';
  sound.startSustain('hierba');
  assert.equal(sound.bus, null);
  sound.update(0.5, { paused: false });
  assert.equal(sound.bus, null);
  ctx.state = 'running';
  sound.update(0.5, { paused: false });
  assert.equal(sound.bus.gain.value, 0.5);
});

test('una capa sostenida nueva reemplaza a la anterior', () => {
  const { master, destination, created, sound } = fixture();
  sound.startSustain('pegante');
  const first = created.filter((n) => n.kind === 'oscillator');
  sound.startSustain('hierba');
  assert.ok(first.every((n) => n.stopAt !== null));
  assert.deepEqual(master.connections, [destination]);
  assert.equal(sound.muffle, null);
});

test('tintico no crea sonido y dispose restaura el audio general', () => {
  const { master, destination, created, sound } = fixture();
  sound.playOnset('tintico');
  sound.startSustain('tintico');
  assert.equal(created.length, 0);
  sound.startSustain('pegante');
  sound.dispose();
  assert.deepEqual(master.connections, [destination]);
  assert.equal(sound.bus, null);
});

test('los barridos de los sonidos de consumir parten del instante en que suenan', () => {
  // Sin un valor inicial, una rampa se cuenta desde el inicio del contexto y, minutos después, ya llegó a su destino.
  for (const id of ['pastilla', 'pegante', 'hierba', 'basuco']) {
    const { ctx, created, sound } = fixture();
    ctx.currentTime = 300;
    sound.playOnset(id);
    for (const node of created) {
      for (const key of ['frequency', 'gain', 'detune', 'Q']) {
        const first = node[key]?.events[0];
        if (first) assert.notEqual(first.type, 'ramp', `${id}: ${node.kind}.${key} empieza con una rampa`);
      }
    }
  }
});

test('el volumen de la categoría Efectos del menú también manda', () => {
  const { ctx, master } = createFakeAudioContext();
  let effects = 0.5;
  const sound = new SubstanceAudio({ howler: { ctx, masterGain: master }, getMix: (c) => (c === 'effects' ? effects : 1) });
  master.gain.value = 0.8;
  sound.startSustain('hierba');
  assert.ok(Math.abs(sound.out.gain.value - 0.4) < 1e-9);
  effects = 0;
  sound.update(0.5, { paused: false });
  assert.equal(sound.out.gain.value, 0);
});
