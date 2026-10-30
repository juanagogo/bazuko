import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityAcoustics, OBSTRUCTED_GAIN, thickness } from '../src/systems/CityAcoustics.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { VehicleAudio } from '../src/systems/VehicleAudio.js';

const box = (x0, z0, x1, z1, y1 = 12, y0 = 0) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
const world = (...boxes) => {
  const collisions = new CollisionSystem();
  for (const b of boxes) collisions.colliders.push({ box: b });
  collisions.invalidateStaticIndex();
  return collisions;
};
const clock = () => { const c = { t: 0, now: () => c.t }; return c; };

test('el grosor atravesado mide solo el tramo dentro de la caja', () => {
  const b = box(10, -5, 20, 5);
  assert.ok(Math.abs(thickness(b, 0, 1.6, 0, 30, 1, 0) - 10) < .01, 'diez metros de edificio (el rayo baja 0,6 m en 30)');
  assert.equal(thickness(b, 0, 1.6, 10, 30, 1, 10), 0, 'pasa al lado');
  assert.equal(thickness(b, 0, 14, 0, 30, 14, 0), 0, 'pasa por encima del techo');
  assert.equal(thickness(b, 15, 1, 0, 30, 1, 0), 0, 'el oyente dentro de una caja no silencia la ciudad');
});

test('un edificio entre el jugador y la fuente la atenúa; en la misma calle se oye completa', () => {
  const c = clock(), acoustics = new CityAcoustics(world(box(10, -6, 22, 6), box(-3, 40, 3, 44, 1)), { now: c.now });
  const ears = { x: 0, y: 1.6, z: 0 };
  assert.ok(acoustics.obstruction({ x: 0, y: 0, z: 60 }, ears, 1) === 0, 'un bordillo bajo no cuenta como edificio');
  assert.ok(acoustics.obstruction({ x: 35, y: 0, z: 0 }, ears, 1) > .95);
  assert.equal(acoustics.obstruction({ x: 0, y: 0, z: -30 }, ears, 1), 0);
  const behind = {}, street = {};
  assert.ok(Math.abs(acoustics.gain(behind, { x: 35, y: 0, z: 0 }, ears) - OBSTRUCTED_GAIN) < .02);
  assert.equal(acoustics.gain(street, { x: 0, y: 0, z: -30 }, ears), 1);
});

test('la obstrucción se vuelve a trazar cada cuarto de segundo y cambia de forma gradual', () => {
  const c = clock(), acoustics = new CityAcoustics(world(box(10, -6, 22, 6)), { now: c.now });
  const ears = { x: 0, y: 1.6, z: 0 }, key = {}, source = { x: 35, y: 0, z: 0 };
  assert.ok(acoustics.gain(key, source, ears) < .25);
  source.z = 30; c.t = .1;
  assert.ok(acoustics.gain(key, source, ears) < .25, 'sin volver a trazar antes de 0,25 s');
  c.t = .3;
  const rising = acoustics.gain(key, source, ears);
  assert.ok(rising > .25 && rising < 1, 'sale de detrás del edificio sin saltar de golpe');
  c.t = 1;
  assert.ok(acoustics.gain(key, source, ears) > .99);
});

test('motores y claxon de un carro detrás de un edificio suenan más bajo sin cambiar su alcance', () => {
  class Howl { constructor() { this.voices = new Map(); this.n = 0; } state() { return 'loaded'; } play() { const id = ++this.n; this.voices.set(id, {}); return id; }
    volume(v, id) { this.voices.get(id).volume = v; } rate() {} seek() {} duration() { return 1; } stop() {} playing() { return true; } }
  const sounds = Object.fromEntries(['carIdle', 'carDrive', 'busIdle', 'busDrive', 'horn1', 'horn2', 'horn3'].map(k => [k, new Howl()]));
  // Mismo carro a la misma distancia, tapado o no; cada uno en su mezcla porque solo suenan dos claxones a la vez.
  const play = gain => {
    const audio = new VehicleAudio(sounds, () => 0);
    const entry = { car: { position: new THREE.Vector3(10, 0, 0) }, speed: 0, personBlocked: true };
    audio.update(1, new THREE.Vector3(), [entry], null, () => gain);
    const state = audio.instances.get(entry.car);
    return { idle: sounds.carIdle.voices.get(state.idle.id).volume, horn: state.horn.sound.voices.get(state.horn.id).volume };
  };
  const open = play(1), hidden = play(OBSTRUCTED_GAIN);
  assert.ok(open.idle > 0 && open.horn > 0);
  assert.ok(Math.abs(hidden.idle - open.idle * OBSTRUCTED_GAIN) < 1e-9);
  assert.ok(Math.abs(hidden.horn - open.horn * OBSTRUCTED_GAIN) < 1e-9);
});

test('una manzana hecha de franjas de dos metros tapa según su fondo total', () => {
  const strips = Array.from({ length: 6 }, (_, i) => box(-20, 10 + i * 2, 20, 12 + i * 2, 8));
  const acoustics = new CityAcoustics(world(...strips), { now: () => 0 });
  const ears = { x: 0, y: 1.6, z: 0 };
  assert.ok(acoustics.obstruction({ x: 0, y: 0, z: 40 }, ears, 1) > .98, 'doce metros de manzana (el trazado se corta pasados 10 m)');
  assert.ok(acoustics.obstruction({ x: 0, y: 0, z: 11 }, ears, 1) < .5, 'la fuente en el borde apenas se tapa');
});
