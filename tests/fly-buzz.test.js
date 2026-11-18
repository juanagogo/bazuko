// tests/fly-buzz.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeAudioContext } from './helpers/fake-audio-context.js';
import { BUZZ_FAR, BUZZ_GAIN, BUZZ_STEP, FlyBuzzAudio } from '../src/systems/FlyBuzzAudio.js';

function setup() {
  const fake = createFakeAudioContext();
  const buzz = new FlyBuzzAudio({ fx: () => ({ ctx: fake.ctx, out: fake.master }), random: () => .5 });
  return { ...fake, buzz };
}
const oscillators = created => created.filter(n => n.kind === 'oscillator');
/** Sigue las conexiones hasta ver si el nodo llega al canal de efectos. */
function reaches(node, target, seen = new Set()) {
  if (node === target) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.connections.some(next => reaches(next, target, seen));
}
const peak = gain => Math.max(...gain.gain.events.map(e => e.value));

test('a menos de 4 m suena un zumbido por el canal de efectos', () => {
  const { buzz, created, master } = setup();
  buzz.update(.4, 2);
  const oscs = oscillators(created);
  assert.ok(oscs.length >= 2);
  assert.ok(oscs.every(o => o.started && o.stopAt > 0));
  assert.ok(oscs.every(o => reaches(o, master)));
});

test('a 4 m o más no suena', () => {
  const { buzz, created } = setup();
  buzz.update(1, BUZZ_FAR);
  buzz.update(1, 9);
  buzz.update(1, Infinity);
  assert.equal(oscillators(created).length, 0);
});

test('más cerca suena más fuerte', () => {
  const near = setup(), far = setup();
  near.buzz.update(.4, 1.5);
  far.buzz.update(.4, 3);
  const gainOf = ({ created }) => peak(created.filter(n => n.kind === 'gain').at(-1));
  assert.ok(gainOf(near) > gainOf(far));
  assert.ok(gainOf(near) <= BUZZ_GAIN + 1e-9);
});

test('sin canal de efectos (pausa o silencio) no hace nada', () => {
  const buzz = new FlyBuzzAudio({ fx: () => null });
  assert.doesNotThrow(() => { buzz.update(.4, 1); buzz.update(.4, 1); });
});

test('una sola voz: no apila notas dentro del mismo paso', () => {
  const { buzz, created } = setup();
  buzz.update(.1, 2);
  buzz.update(.1, 2);
  buzz.update(.1, 2);
  assert.equal(oscillators(created).length, 2, 'una nota de dos osciladores');
  buzz.update(BUZZ_STEP, 2);
  assert.equal(oscillators(created).length, 4, 'la siguiente nota llega con el paso');
});
