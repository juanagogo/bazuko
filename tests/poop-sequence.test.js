// tests/poop-sequence.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  EXPOSED_DROP, PIECE_FALL, PIECE_TIMES, POOP_SEQUENCE_LENGTH, POOP_STEPS,
  PoopSequence, pantsDropAt, poopBlockReason
} from '../src/systems/PoopSequence.js';

const DT = 1 / 60;
const POPO_AT = POOP_STEPS[0].duration + POOP_STEPS[1].duration; // 1,5 s

function makePlayer(extra = {}) {
  return {
    isGrounded: true, isSwimming: false, isStunned: false, isRagdollActive: false,
    basuco: null, sorting: false, hasCart: false, action: null,
    character: {}, look: {}, position: new THREE.Vector3(), stats: { salud: 100 },
    ...extra
  };
}

/** Avanza como lo haría PoopSystem: aplica la acción pedida y la suelta al terminar. */
function run(seq, player, seconds, dt = DT, onFrame = null) {
  const frames = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    onFrame?.(player, i * dt);
    const frame = seq.update(dt, player);
    if (!frame) break;
    if (frame.actionChanged) player.action = frame.action;
    if (frame.finished || frame.interrupted) player.action = null;
    frames.push(frame);
  }
  return frames;
}

const at = (frames, t) => frames.reduce((best, f) => Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best);

test('la secuencia recorre bajarse, agacharse, popó, pararse y subirse en 5,5 s', () => {
  const seq = new PoopSequence();
  const player = makePlayer();
  assert.equal(seq.start(player), true);
  assert.equal(seq.active, true);
  const frames = run(seq, player, POOP_SEQUENCE_LENGTH + .5);
  assert.deepEqual([.1, 1.0, 2.0, 4.3, 5.0].map(t => at(frames, t).step), ['bajarse', 'agacharse', 'popo', 'pararse', 'subirse']);
  assert.deepEqual([.1, 1.0, 2.0, 4.3, 5.0].map(t => at(frames, t).action), ['bajarse', 'cagar', 'cagar', 'cagar', 'subirse']);
  const finished = frames.filter(f => f.finished);
  assert.equal(finished.length, 1);
  assert.ok(Math.abs(finished[0].t - POOP_SEQUENCE_LENGTH) <= DT + 1e-9);
  assert.equal(seq.active, false);
  assert.equal(seq.update(DT, player), null);
});

test('el pantalón baja antes de agacharse y vuelve a la cintura al final', () => {
  assert.equal(pantsDropAt(.2), 0);
  assert.equal(pantsDropAt(.9), 1);
  assert.equal(pantsDropAt(1.2), 1);
  assert.equal(pantsDropAt(3), 1);
  assert.ok(pantsDropAt(4.9) > 0 && pantsDropAt(4.9) < 1);
  assert.equal(pantsDropAt(5.3), 0);
  const seq = new PoopSequence();
  const player = makePlayer();
  seq.start(player);
  for (const f of run(seq, player, POOP_SEQUENCE_LENGTH)) {
    assert.equal(f.censor, f.drop > EXPOSED_DROP, `censurado a destiempo en t=${f.t}`);
  }
});

test('las manos van a la pretina, bajan con el pantalón y vuelven al subirlo', () => {
  const seq = new PoopSequence();
  const player = makePlayer();
  seq.start(player);
  const frames = run(seq, player, POOP_SEQUENCE_LENGTH);
  assert.equal(at(frames, .15).stance, 'pretina');
  assert.equal(at(frames, .6).stance, 'pantalon-rodillas');
  assert.equal(at(frames, 2.5).stance, null);
  assert.equal(at(frames, 4.75).stance, 'pantalon-rodillas');
  assert.equal(at(frames, 5.0).stance, 'pretina');
  assert.equal(at(frames, 5.45).stance, null);
});

test('los cinco trozos caen en orden y la popó se completa al terminar el paso 3', () => {
  const seq = new PoopSequence();
  const player = makePlayer();
  seq.start(player);
  const frames = run(seq, player, POOP_SEQUENCE_LENGTH);
  PIECE_TIMES.forEach((time, i) => {
    const lands = POPO_AT + time + PIECE_FALL;
    assert.equal(at(frames, lands - 2 * DT).pieces, i, `trozo ${i} antes de caer`);
    assert.equal(at(frames, lands + 2 * DT).pieces, i + 1, `trozo ${i} ya en el piso`);
    const mid = at(frames, POPO_AT + time + PIECE_FALL / 2);
    assert.equal(mid.falling?.index, i);
    assert.equal(mid.falling.index, mid.pieces);
    assert.ok(mid.falling.progress > 0 && mid.falling.progress < 1);
  });
  assert.equal(at(frames, 1).falling, null);
  const farts = frames.filter(f => f.fart);
  assert.equal(farts.length, 1);
  assert.ok(Math.abs(farts[0].t - POPO_AT) <= DT + 1e-9);
  const completed = frames.filter(f => f.completed);
  assert.equal(completed.length, 1);
  assert.ok(Math.abs(completed[0].t - 4.1) <= DT + 1e-9);
  assert.equal(completed[0].pieces, 5);
});

test('el chichi crece y el chorrito solo corre mientras orina', () => {
  const seq = new PoopSequence();
  const player = makePlayer();
  seq.start(player);
  const frames = run(seq, player, POOP_SEQUENCE_LENGTH);
  for (const f of frames) {
    if (f.t < 1.75 - 1e-9) assert.equal(f.pee, 0, `chichi antes de tiempo en t=${f.t}`);
    if (f.t > 3.55 + 1e-9) assert.equal(f.pee, 1, `charquito incompleto en t=${f.t}`);
    const pouring = f.t >= 1.7 - 1e-9 && f.t <= 3.4 + 1e-9;
    if (Math.abs(f.t - 1.7) > DT && Math.abs(f.t - 3.4) > DT) assert.equal(f.streaming, pouring, `chorrito en t=${f.t}`);
  }
  assert.ok(at(frames, 2.5).pee > 0 && at(frames, 2.5).pee < 1);
});

test('no empieza en el aire, nadando, aturdido, con basuco, separando basura, con la zorra ni en otra acción', () => {
  const cases = [
    [{ isGrounded: false }, 'aire'],
    [{ isSwimming: true }, 'agua'],
    [{ isStunned: true }, 'aturdido'],
    [{ basuco: { stowed: false } }, 'basuco'],
    [{ sorting: true }, 'basura'],
    [{ hasCart: true }, 'zorra'],
    [{ action: 'comer' }, 'ocupado']
  ];
  for (const [state, reason] of cases) {
    const player = makePlayer(state);
    assert.equal(poopBlockReason(player), reason, JSON.stringify(state));
    const seq = new PoopSequence();
    assert.equal(seq.start(player), false);
    assert.equal(seq.active, false);
  }
  assert.equal(poopBlockReason(makePlayer({ basuco: { stowed: true } })), null);
  assert.equal(poopBlockReason(makePlayer()), null);
  const busy = new PoopSequence();
  const player = makePlayer();
  assert.equal(busy.start(player), true);
  assert.equal(busy.start(player), false, 'no se reinicia mientras dura');
});

test('se interrumpe al aturdirse, morir, cambiar de modelo o de apariencia, teletransportarse u otra acción', () => {
  const cases = {
    aturdido: p => { p.isStunned = true; },
    ragdoll: p => { p.isRagdollActive = true; },
    nadando: p => { p.isSwimming = true; },
    enElAire: p => { p.isGrounded = false; },
    muerto: p => { p.stats.salud = 0; },
    otroModelo: p => { p.character = {}; },
    otraApariencia: p => { p.look = {}; },
    recuperado: p => { p.position.set(40, 0, 3); },
    dormir: p => { p.action = 'dormir'; }
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const seq = new PoopSequence();
    const player = makePlayer();
    seq.start(player);
    const frames = run(seq, player, 3, DT, (p, t) => { if (Math.abs(t - 2) < DT / 2) mutate(p); });
    const last = frames.at(-1);
    assert.equal(last.interrupted, true, name);
    assert.equal(last.drop, 0, name);
    assert.equal(last.censor, false, name);
    assert.equal(frames.some(f => f.completed), false, name);
    assert.equal(seq.active, false, name);
  }
  const seq = new PoopSequence();
  seq.start(makePlayer());
  const frame = seq.interrupt();
  assert.equal(frame.interrupted, true);
  assert.equal(seq.active, false);
  assert.equal(seq.interrupt(), null);
});

test('con dt = 0 la escena no avanza ni pierde el pantalón abajo', () => {
  const seq = new PoopSequence();
  const player = makePlayer();
  seq.start(player);
  const frames = run(seq, player, 2);
  const before = frames.at(-1);
  const paused = seq.update(0, player);
  assert.equal(paused.t, before.t);
  assert.equal(paused.drop, 1);
  assert.equal(paused.censor, true);
  assert.equal(paused.interrupted, false);
  assert.equal(paused.actionChanged, false);
  assert.equal(paused.fart || paused.completed || paused.finished, false);
});
