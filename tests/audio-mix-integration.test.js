import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { createFakeAudioContext } from './helpers/fake-audio-context.js';

class LoadedHowl {
  state() { return 'loaded'; }
  playing() { return false; }
  stop() {}
  unload() {}
}

test.before(() => { globalThis.window = new EventTarget(); });
test.after(() => { delete globalThis.window; });

function fixture(t) {
  const fake = createFakeAudioContext();
  // Los AudioNodes reales exponen su contexto; el bus se reutiliza en el mismo contexto.
  const gain = fake.ctx.createGain;
  fake.ctx.createGain = () => Object.assign(gain(), { context: fake.ctx });
  const howler = { ctx: fake.ctx, masterGain: fake.master, volume(value) { fake.master.gain.value = value; } };
  const audio = new AudioSystem({ HowlClass: LoadedHowl, howler, eventTarget: new EventTarget() });
  t.after(() => audio.dispose());
  return { audio, ...fake };
}

function thudGraph(created) {
  const source = created.filter(node => node.kind === 'bufferSource').at(-1);
  const filter = source.connections[0], gain = filter.connections[0], effects = gain.connections[0];
  return { source, filter, gain, effects };
}

test('el golpe seco usa el bus Efectos compartido y conserva la atenuación de su categoría', t => {
  const { audio, created, master, destination } = fixture(t);
  audio.setMix('effects', .25);
  audio.playThud();
  const first = thudGraph(created);
  assert.equal(first.source.started, true);
  assert.equal(first.filter.type, 'lowpass');
  assert.equal(first.effects, audio._effectsBus);
  assert.equal(first.effects.gain.value, .25);
  assert.deepEqual(first.effects.connections, [master]);
  assert.deepEqual(master.connections, [destination]);
  assert.ok(created.every(node => !node.connections.includes(destination)), 'ningún efecto evade el maestro');
  audio.playThud();
  assert.equal(thudGraph(created).effects, first.effects, 'reutiliza el bus del contexto activo');
  assert.equal(thudGraph(created).source.buffer, first.source.buffer, 'reutiliza el buffer de ruido');
  first.source.onended();
  assert.equal(first.source.connections.length, 0);
  assert.equal(first.filter.connections.length, 0);
  assert.equal(first.gain.connections.length, 0);
});

test('Efectos en cero silencia un golpe activo y los posteriores sin tocar el volumen maestro', t => {
  const { audio, created, master } = fixture(t);
  audio.playThud();
  const bus = thudGraph(created).effects, initialMaster = master.gain.value;
  audio.setMix('effects', 0);
  assert.equal(bus.gain.value, 0);
  audio.playThud();
  assert.equal(thudGraph(created).effects, bus);
  assert.equal(thudGraph(created).effects.gain.value, 0);
  assert.equal(master.gain.value, initialMaster);
});

test('silenciar el maestro corta el golpe activo y no crea sonidos nuevos hasta reactivarlo', t => {
  const { audio, created, master } = fixture(t);
  audio.playThud();
  const count = created.length;
  audio.setMuted(true);
  assert.equal(master.gain.value, 0);
  audio.playThud();
  assert.equal(created.length, count);
  audio.setMuted(false);
  audio.playThud();
  assert.ok(master.gain.value > 0);
  assert.equal(created.filter(node => node.kind === 'bufferSource').length, 2);
});

test('pausa corta el bus activo y cambiar Efectos no lo reactiva antes de continuar', t => {
  const { audio, created } = fixture(t);
  audio.playThud();
  const bus = audio._effectsBus, count = created.length;
  audio.setPaused(true);
  assert.equal(bus.gain.value, 0);
  audio.playThud();
  assert.equal(created.length, count);
  audio.setMix('effects', .6);
  assert.equal(bus.gain.value, 0, 'ajustar el mezclador durante pausa no deja sonar la cola');
  audio.setPaused(false);
  assert.equal(bus.gain.value, .6);
  audio.playThud();
  assert.equal(thudGraph(created).effects, bus);
  assert.equal(created.filter(node => node.kind === 'bufferSource').length, 2);
});

test('salpicadura y golpe comparten bus y un contexto suspendido no crea fuentes', t => {
  const { audio, created, ctx } = fixture(t);
  audio.playWaterSplash(.5);
  const splashBus = thudGraph(created).effects;
  audio.playThud();
  assert.equal(thudGraph(created).effects, splashBus);
  ctx.state = 'suspended';
  const count = created.length;
  audio.playThud();
  assert.equal(created.length, count);
});
