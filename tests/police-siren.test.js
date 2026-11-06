import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PoliceSirenAudio } from '../src/systems/PoliceSirenAudio.js';

const listener = { x: 0, y: 0, z: 0 };
const patrol = (x) => ({ police: true, car: { pursuit: true, position: { x, y: 0, z: 0 } } });

function fixture({ fxNull = false, random = () => 0 } = {}) {
  const notes = [], gains = [];
  const ctx = {
    currentTime: 0,
    createOscillator() {
      const osc = { type: '', frequency: {
        setValueAtTime: (v) => { osc.frequency.start = v; },
        linearRampToValueAtTime: (v) => { osc.frequency.end = v; }
      }, connect() {}, start() {}, stop() {} };
      notes.push(osc);
      return osc;
    },
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; },
    createGain() {
      const g = { gain: { setValueAtTime() {}, linearRampToValueAtTime: (v) => { g.peak = v; }, exponentialRampToValueAtTime() {} }, connect() {} };
      gains.push(g);
      return g;
    }
  };
  const fx = fxNull ? () => null : () => ({ ctx, out: {} });
  return { siren: new PoliceSirenAudio({ fx, random }), notes, gains };
}

/** Avanza cuadro a cuadro hasta que sale el primer lamento. */
const arrancar = (f, vehicle) => {
  for (let i = 0; i < 120 && f.notes.length === 0; i++) f.siren.update(1 / 60, listener, [vehicle]);
};

test('solo suena la patrulla que persigue', () => {
  const f = fixture();
  const persigue = patrol(3);
  f.siren.update(1 / 60, listener, [persigue]);
  assert.equal(f.notes.length, 0, 'el primer cuadro solo arranca el reloj');
  arrancar(f, persigue);
  assert.equal(f.notes.length, 1);
  const quiet = fixture();
  arrancar(quiet, { police: false, car: { pursuit: true, position: { x: 3, y: 0, z: 0 } } });
  assert.equal(quiet.notes.length, 0, 'un carro normal no trae sirena');
  const parked = fixture();
  arrancar(parked, { police: true, car: { pursuit: false, position: { x: 3, y: 0, z: 0 } } });
  assert.equal(parked.notes.length, 0, 'la patrulla de ronda calla');
});

test('el vaivén barre de grave a agudo y suena una vez por tramo', () => {
  const f = fixture();
  const vehicle = patrol(3);
  arrancar(f, vehicle);
  assert.equal(f.notes.length, 1);
  assert.equal(f.notes[0].frequency.start, 700);
  assert.equal(f.notes[0].frequency.end, 1250);
  f.siren.update(1 / 60, listener, [vehicle]);
  assert.equal(f.notes.length, 1, 'dentro del mismo tramo no repite');
});

test('el primer lamento no se dobla, sea cual sea el desfase', () => {
  for (const seed of [0, .5, .9]) {
    const f = fixture({ random: () => seed });
    const vehicle = patrol(3);
    arrancar(f, vehicle);
    assert.equal(f.notes.length, 1, `desfase ${seed}: arranca con un solo lamento`);
    let previos = 1, frames = 0;
    const huecos = [];
    for (let i = 0; i < 240; i++) {
      f.siren.update(1 / 60, listener, [vehicle]);
      if (f.notes.length > previos) { huecos.push(frames + 1); previos = f.notes.length; frames = 0; }
      else frames++;
    }
    assert.ok(huecos.length >= 4, `desfase ${seed}: sigue sonando (${huecos.length})`);
    assert.ok(Math.min(...huecos) >= 30, `desfase ${seed}: sin doblarse (${Math.min(...huecos)})`);
  }
});

test('suenan dos patrullas a la vez y el volumen cae con la distancia', () => {
  const f = fixture();
  const near = patrol(6), mid = patrol(30), far = patrol(200);
  for (let i = 0; i < 120 && f.notes.length < 2; i++) f.siren.update(1 / 60, listener, [near, mid, far]);
  assert.equal(f.notes.length, 2, 'solo las dos más cercanas');
  assert.ok(f.gains[0].peak > f.gains[1].peak, 'la de 6 m suena más que la de 30 m');
  assert.ok(f.gains[1].peak > 0, 'y la de 30 m todavía se oye');
});

test('cuando la patrulla desiste, la sirena no se oye', () => {
  const f = fixture();
  arrancar(f, patrol(120));
  assert.equal(f.notes.length, 0);
});

test('salir y volver a la persecución retoma el compás sin doblarse', () => {
  const f = fixture();
  const vehicle = patrol(3);
  arrancar(f, vehicle);
  assert.equal(f.notes.length, 1);
  for (let i = 0; i < 30; i++) f.siren.update(1 / 60, listener, []);
  for (let i = 0; i < 60; i++) f.siren.update(1 / 60, listener, [vehicle]);
  assert.equal(f.notes.length, 2, 'al volver sale el siguiente lamento, ni uno de más');
});

test('sin contexto de audio no programa nada ni se cae', () => {
  const f = fixture({ fxNull: true });
  const vehicle = patrol(3);
  arrancar(f, vehicle);
  f.siren.update(.6, listener, [vehicle]);
  assert.equal(f.notes.length, 0);
});
