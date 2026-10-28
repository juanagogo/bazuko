import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { VehicleAudio } from '../src/systems/VehicleAudio.js';
import { HORN_RANGE, hornAcoustics } from '../src/systems/HornAcoustics.js';
import { createDriver, hornReason, updateDriver, commitHonk } from '../src/systems/HornBehavior.js';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';
mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');

let nextId = 0;
class FakeHowl {
  constructor(options) { this.options = options; this.voices = new Map(); this.starts = 0; this.loaded = true; }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play(sprite) {
    if (typeof sprite === 'number') { this.voices.get(sprite).playing = true; return sprite; }
    const id = ++nextId;
    this.voices.set(id, { playing: true, sprite }); this.starts++; return id;
  }
  playing(id) { return id === undefined ? [...this.voices.values()].some(voice => voice.playing) : this.voices.get(id)?.playing; }
  pause(id) { this.voices.get(id).playing = false; }
  stop(id) { for (const [key, voice] of this.voices) if (id === undefined || key === id) voice.playing = false; }
  volume(value, id) { if (id !== undefined) this.voices.get(id).volume = value; }
  rate(value, id) { if (id !== undefined) this.voices.get(id).rate = value; }
  seek(value, id) { this.voices.get(id).seek = value; }
  duration() { return 7.8; }
  unload() { this.unloaded = true; }
}
const bank = () => Object.fromEntries(['carIdle', 'carDrive', 'busIdle', 'busDrive', 'horn1', 'horn2', 'horn3']
  .map(key => [key, new FakeHowl({ sprite: { honk: [0, 600] } })]));
const hornStarts = sounds => sounds.horn1.starts + sounds.horn2.starts + sounds.horn3.starts;
const car = (x, z = 0) => ({ car: { position: new THREE.Vector3(x, 0, z), group: new THREE.Group() }, speed: 0 });
const origin = new THREE.Vector3();
function sequence(seed) {
  let value = seed;
  return () => (value = (value * 16807) % 2147483647) / 2147483647;
}

test('frenar detrás de otro carro o esperar en rojo no pita ni emite bocinas sintetizadas', () => {
  const previous = globalThis.window, target = new EventTarget();
  let synthetic = 0;
  globalThis.window = target; target.addEventListener('car-honk', () => synthetic++);
  try {
    const route = new TrafficRoute(0, 60, 0, 60, 3.2);
    const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 4, random: () => .5 });
    const stop = new THREE.Vector3(), direction = new THREE.Vector3();
    route.sample(20, stop, direction);
    let red = true;
    traffic.signals = { blocks: position => red && position.distanceTo(stop) < .3 };
    const sounds = bank(), audio = new VehicleAudio(sounds, () => .5);
    const listener = stop.clone();
    // Dos minutos con ciclos de 20 s: colas, frenadas y arranques ordinarios.
    for (let frame = 0; frame < 2400; frame++) {
      red = Math.floor(frame / 400) % 2 === 0;
      traffic.update(.05);
      audio.update(.05, listener, traffic.vehicles);
    }
    assert.ok(traffic.vehicles.some(vehicle => vehicle.blockReason === 'car' || vehicle.blockReason === 'signal'));
    assert.equal(hornStarts(sounds), 0, 'El tráfico normal no es motivo para pitar');
    assert.equal(synthetic, 0);
    traffic.dispose();
  } finally { globalThis.window = previous; }
});

test('el motivo sigue la cola: rojo, arranque demorado, cruce bloqueado y persona', () => {
  const signal = { speed: 0, blockReason: 'signal' };
  const moving = { speed: 4, blockReason: null };
  const crossing = { speed: 0, blockReason: 'cross' };
  const queue = head => ({ speed: 0, blockReason: 'car', blocker: { speed: 0, blockReason: 'car', blocker: head } });
  assert.equal(hornReason(queue(signal)), null, 'Toda la cola espera el semáforo');
  assert.equal(hornReason(queue(moving)), 'lag', 'La cabeza ya arrancó y este carro sigue detenido');
  assert.equal(hornReason(queue(crossing)), 'jam');
  assert.equal(hornReason({ ...queue(signal), personBlocked: true }), 'person');
  assert.equal(hornReason({ ...queue(moving), speed: 5 }), null, 'En marcha no hay espera');
  assert.equal(hornReason(queue({ ...crossing, blocker: { speed: 6 } })), null, 'Ceder el paso a quien cruza es normal');
  assert.equal(hornReason({ speed: 0, personBlocked: true, personBlocker: 'pedestrian' }), 'pedestrian');
});

test('un peatón que cruza recibe más paciencia que el jugador plantado frente al carro', () => {
  const waitFor = source => {
    const driver = createDriver(() => .5);
    for (let frame = 1; frame < 400; frame++) if (updateDriver(driver, source, .05, () => .5)) return frame * .05;
    return Infinity;
  };
  const player = waitFor({ speed: 0, personBlocked: true, personBlocker: 'player' });
  const pedestrian = waitFor({ speed: 0, personBlocked: true, personBlocker: 'pedestrian' });
  assert.ok(player < 1.5 && pedestrian > 3.5, `jugador ${player}s, peatón ${pedestrian}s`);
  const route = new TrafficRoute(0, 60, 0, 60, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0]; vehicle.distance = 5;
  route.sample(vehicle.distance, vehicle.car.position, traffic._direction);
  const person = vehicle.car.position.clone().addScaledVector(traffic._direction, 6);
  traffic._clearance(vehicle, null, [{ position: person }]); assert.equal(vehicle.personBlocker, 'pedestrian');
  traffic._clearance(vehicle, person, [{ position: person }]); assert.equal(vehicle.personBlocker, 'player');
  traffic._clearance(vehicle, null, []); assert.equal(vehicle.personBlocker, null);
  traffic.dispose();
});

test('los conductores varían: la mayoría es paciente y pocos pitan al arrancar lento', () => {
  const random = sequence(7), drivers = Array.from({ length: 2000 }, () => createDriver(random));
  const impatient = drivers.filter(driver => driver.temper > .45).length / drivers.length;
  assert.ok(impatient > .25 && impatient < .45, `impacientes: ${impatient}`);
  assert.deepEqual(new Set(drivers.map(driver => driver.maxHonks)), new Set([1, 2, 3, 4]));
  assert.equal(new Set(drivers.map(driver => driver.hornIndex)).size, 3);
  const lag = { speed: 0, blockReason: 'car', blocker: { speed: 3, blockReason: null } };
  const honks = temper => {
    const driver = { ...createDriver(() => .5), temper };
    let count = 0;
    for (let i = 0; i < 400; i++) {
      const decision = updateDriver(driver, lag, .05, () => .5);
      if (decision) { count++; commitHonk(driver, decision.reason, () => .5); }
    }
    return count;
  };
  assert.equal(honks(.1), 0, 'Un conductor tranquilo espera sin pitar');
  assert.equal(honks(.8), 1, 'El impaciente da un solo toque al de adelante');
});

test('con la vía libre el conductor insiste hasta que lo dejan pasar; con rojo termina resignándose', () => {
  const honkTimes = (source, temper) => {
    const driver = { ...createDriver(() => .5), temper, maxHonks: 3 }, times = [], patterns = [];
    for (let frame = 0; frame < 2400; frame++) {
      const decision = updateDriver(driver, source, .05, () => .5);
      if (decision) { times.push(frame * .05); patterns.push(decision.pattern); commitHonk(driver, decision.reason, () => .5); }
    }
    return { times, patterns, driver };
  };
  const blocked = { speed: 0, personBlocked: true, blockReason: 'person', personPriority: 'vehicle', personStanding: true };
  const { times, patterns, driver } = honkTimes(blocked, .9);
  const gaps = times.slice(1).map((time, i) => time - times[i]);
  assert.ok(times.length >= 8, `Sigue insistiendo durante dos minutos: ${times.length}`);
  assert.ok(gaps[1] > gaps[0], 'Las primeras insistencias se espacian');
  assert.ok(Math.max(...gaps) < 9, 'El intervalo deja de crecer: no se queda esperando para siempre');
  assert.equal(patterns.at(-1), 'long', 'La pitada se vuelve larga');
  assert.ok(honkTimes(blocked, .1).times.length < times.length, 'El conductor tranquilo insiste menos');
  // Detenido por el rojo con alguien contra el parachoques: protesta un par de veces y espera.
  const atRed = { speed: 0, personBlocked: true, blockReason: 'signal' };
  assert.equal(honkTimes(atRed, .9).times.length, 3);
  assert.equal(driver.reason, 'blocking');
  // Si la persona se va y vuelve a atravesarse, empieza un incidente nuevo.
  for (let frame = 0; frame < 300; frame++) updateDriver(driver, { speed: 0 }, .05, () => .5);
  let again = false;
  for (let frame = 0; frame < 100 && !again; frame++) again = !!updateDriver(driver, blocked, .05, () => .5);
  assert.ok(again);
});

test('un frenazo por algo que se atraviesa provoca un toque reflejo; el rojo no', () => {
  const route = new TrafficRoute(0, 60, 0, 60, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0]; vehicle.distance = 8; vehicle.speed = 10; vehicle.routeTimer = 1000;
  route.sample(vehicle.distance, vehicle.car.position, traffic._direction);
  const ahead = vehicle.car.position.clone().addScaledVector(traffic._direction, vehicle.car.length / 2 + 2.5);
  traffic.update(.05, { pedestrians: [{ position: ahead }] });
  assert.equal(vehicle.suddenBrakes, 1);
  traffic.update(.05, { pedestrians: [{ position: ahead }] });
  assert.equal(vehicle.suddenBrakes, 1, 'Un mismo frenazo cuenta una sola vez');
  const stop = vehicle.car.position.clone().addScaledVector(traffic._direction, 3);
  const second = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const other = second.vehicles[0]; other.distance = 8; other.speed = 10; other.routeTimer = 1000;
  second.signals = { blocks: position => position.distanceTo(stop) < .3 };
  second.update(.05);
  assert.equal(other.suddenBrakes, 0);
  const driver = { ...createDriver(() => .5), temper: .8 };
  assert.equal(updateDriver(driver, { speed: 9, suddenBrakes: 1 }, .05, () => .1), null, 'Primero reacciona');
  let decision = null;
  for (let i = 0; i < 10 && !decision; i++) decision = updateDriver(driver, { speed: 3, suddenBrakes: 1 }, .05, () => .1);
  assert.equal(decision?.reason, 'reflex');
  traffic.dispose(); second.dispose();
});

test('la distancia atenúa, oscurece, difumina y retrasa el claxon', () => {
  const near = hornAcoustics(4, 0, 0), mid = hornAcoustics(60, 0, 0), far = hornAcoustics(150, 0, 0);
  assert.ok(near.level > mid.level && mid.level > far.level);
  assert.ok(near.cutoff > 14000 && mid.cutoff < near.cutoff && far.cutoff < 2500);
  assert.ok(near.wet < .2 && far.wet > .4, 'Lejos la reverberación de las fachadas iguala al sonido directo');
  assert.ok(Math.abs(far.delay - 150 / 343) < 1e-9);
  // A la misma distancia, desde otra calle llega rodeando manzanas: más apagado y difuso.
  const around = hornAcoustics(60 / Math.SQRT2, 0, 60 / Math.SQRT2);
  assert.ok(around.cutoff < mid.cutoff && around.wet > mid.wet && around.level < mid.level);
  assert.equal(hornAcoustics(HORN_RANGE, 0, 0).level, 0);
});

test('un claxon lejano llega tarde y más suave; los conductores lejanos también pitan', () => {
  const sounds = bank(), audio = new VehicleAudio(sounds, () => .5);
  const close = car(3), distant = car(100);
  close.personBlocked = distant.personBlocked = true;
  for (const vehicle of [close, distant]) {
    audio.update(.05, origin, [close, distant]);
    Object.assign(audio.instances.get(vehicle.car), { patience: 0 });
  }
  audio.update(.05, origin, [close, distant]);
  const [nearVoice] = [...sounds.horn2.voices.values()];
  assert.equal(sounds.horn2.starts, 1, 'El sonido lejano todavía viaja por la calle');
  for (let frame = 0; frame < 6; frame++) audio.update(.05, origin, [close, distant]);
  assert.equal(sounds.horn2.starts, 2, 'A 100 metros llega unos 0,3 s después');
  const farVoice = [...sounds.horn2.voices.values()][1];
  assert.ok(farVoice.volume < nearVoice.volume * .3);
  assert.equal(audio.instances.get(distant.car).idle, null, 'Fuera de los 55 m no suena su motor');
});

test('varias obstrucciones a la vez no superan cuatro claxones simultáneos', () => {
  const sounds = bank(), audio = new VehicleAudio(sounds, sequence(3));
  const cars = Array.from({ length: 10 }, (_, index) => Object.assign(car(index * 3), { personBlocked: true }));
  let peak = 0;
  for (let frame = 0; frame < 200; frame++) {
    audio.update(.05, origin, cars);
    peak = Math.max(peak, [...audio.instances.values()].filter(state => state.horn).length);
  }
  assert.ok(peak > 1 && peak <= 4, `simultáneos: ${peak}`);
});

test('AudioSystem ya no reproduce bocinas sintetizadas sin distancia', () => {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: null });
  assert.equal(audio.playCarHorn, undefined);
  audio.dispose();
});

test('el conductor impaciente mantiene el claxon segundos enteros, cada vez más tiempo', () => {
  const driver = { ...createDriver(() => .5), temper: .85 };
  const blocked = { speed: 0, personBlocked: true, blockReason: 'person', personPriority: 'vehicle', personStanding: true };
  const holds = [];
  for (let frame = 0; frame < 1600; frame++) {
    const decision = updateDriver(driver, blocked, .05, () => .5);
    if (!decision) continue;
    if (decision.hold) holds.push(decision.hold);
    commitHonk(driver, decision.reason, () => .5, decision.hold);
  }
  assert.ok(holds.length >= 4 && holds[0] >= 1, `Mantiene el claxon: ${holds.map(h => h.toFixed(1)).join(', ')}`);
  assert.ok(holds.at(-1) > holds[0] && Math.max(...holds) <= 4.5, 'Cada vez más largo, sin volverse eterno');
  // La voz sostenida repite su fragmento estable el tiempo pedido y luego se suelta.
  const sounds = bank(), audio = new VehicleAudio(sounds, () => .5), vehicle = { ...car(4), ...blocked };
  audio.update(.05, origin, [vehicle]);
  const state = audio.instances.get(vehicle.car);
  Object.assign(state, { temper: .85, honks: 3, patience: 0 });
  let held = null, playing = 0;
  for (let frame = 0; frame < 200; frame++) {
    audio.update(.05, origin, [vehicle]);
    const voice = [...sounds[`horn${state.hornIndex + 1}`].voices.values()].find(v => v.sprite === 'hold');
    if (voice && !held) held = voice;
    if (held?.playing) playing++;
  }
  assert.ok(held, 'Usa el fragmento sostenido');
  assert.ok(playing * .05 >= 1.5, `Suena de forma continua al menos 1,5 s: ${(playing * .05).toFixed(2)} s`);
  assert.equal(held.playing, false, 'Al soltar, la voz se detiene');
});
