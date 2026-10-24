import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { audioMetadata } from './helpers/audio-file.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { VehicleAudio } from '../src/systems/VehicleAudio.js';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';
import { BusService } from '../src/world/bogota/BusService.js';
mock.module('../src/world/bogota/textures.js', { exports: { ...textures, radialSprite: () => new THREE.Texture() } });
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
  pos(x, y, z, id) { this.voices.get(id).position = [x, y, z]; }
  volume(value, id) { if (id !== undefined) this.voices.get(id).volume = value; }
  rate(value, id) { if (id !== undefined) this.voices.get(id).rate = value; else this.currentRate = value; }
  seek(value, id) { this.voices.get(id).seek = value; }
  duration() { return 7.8; }
  unload() { this.unloaded = true; }
}
function fixture() {
  const howler = { volume() {}, pos(...value) { this.position = value; }, orientation(...value) { this.direction = value; } };
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler });
  audio.vehicles.random = () => .5;
  return { audio, howler, bank: audio.vehicleSounds };
}

test('volumen y silencio persistentes controlan el maestro sin reemplazar motores ni claxones', async () => {
  const store = new Map([['bazuko.audio_volume', '.45'], ['bazuko.audio_muted', 'true']]);
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const volumes = [], target = new EventTarget(); let changes = 0;
  target.addEventListener('audio-settings-change', () => changes++);
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume: value => volumes.push(value) }, eventTarget: target });
  await audio.ready;
  assert.equal(audio.volume, .45); assert.equal(audio.isMuted(), true); assert.equal(volumes.at(-1), 0);
  const horn = audio.vehicleSounds.horn1;
  audio.setVolume(.8); assert.equal(volumes.at(-1), 0);
  audio.toggleMute(); assert.equal(volumes.at(-1), .8);
  audio.setPaused(true); audio.setPaused(false);
  assert.equal(audio.volume, .8); assert.equal(store.get('bazuko.audio_muted'), 'false');
  assert.equal(store.get('bazuko.audio_volume'), '.8'.replace(/^\./, '0.'));
  assert.equal(audio.vehicleSounds.horn1, horn); assert.equal(changes, 2);
  audio.dispose(); delete globalThis.localStorage;
});
const car = (x, z = 0) => ({ car: { position: new THREE.Vector3(x, 0, z), group: new THREE.Group() }, speed: 0 });
const origin = new THREE.Vector3();

test('el robo en circulación selecciona inmediatamente cualquiera de las cinco frases exclusivas', () => {
  const { audio } = fixture(), vehicle = car(2); vehicle.car.traffic = true;
  audio.updateWorld(.1, origin, null, [vehicle]);
  assert.equal(audio.playMovingTheft({ traffic: false }), false);
  for (let i = 0; i < 5; i++) {
    audio.vehicles.random = () => (i + .1) / 5;
    assert.equal(audio.playMovingTheft(vehicle.car), true);
    const voice = audio._theftVoices.get(vehicle.car);
    assert.equal(voice.sound.options.src[0], `/audio/roberto_robo_espejo_n${i + 1}.mp3`);
    assert.equal(voice.sound.voices.get(voice.id).volume, .75);
  }
  assert.ok(audio.theftSounds.every(sound => sound.starts === 1));
  assert.equal(audio.sounds.carAlarm.starts, 0);
  audio.dispose(); assert.ok(audio.theftSounds.every(sound => sound.unloaded));
});

test('la voz de robo sigue al carro, se silencia a doce metros y no se repite tras pausar', () => {
  const { audio } = fixture(), vehicle = car(2); vehicle.car.traffic = true;
  audio.updateWorld(.1, origin, null, [vehicle]); audio.playMovingTheft(vehicle.car);
  const { sound, id } = audio._theftVoices.get(vehicle.car);
  vehicle.car.position.x = 7; audio.updateWorld(.1, origin, null, [vehicle]);
  assert.equal(sound.voices.get(id).volume, .375);
  for (const distance of [12, 13, 30]) {
    vehicle.car.position.x = distance; audio.updateWorld(.1, origin, null, [vehicle]);
    assert.equal(sound.voices.get(id).volume, 0);
  }
  vehicle.car.position.x = 1; audio.updateWorld(.1, origin, null, [vehicle]);
  assert.equal(sound.voices.get(id).volume, .75); assert.equal(sound.starts, 1);
  audio.setPaused(true); assert.equal(sound.playing(id), false); assert.equal(audio._theftVoices.size, 0);
  audio.setPaused(false); assert.equal(sound.playing(id), false);
  audio.dispose();
});

test('la interacción distingue robo de tráfico y alarma de estacionado antes de recoger los objetos', () => {
  globalThis.window = new EventTarget();
  for (const moving of [false, true]) {
    const order = [];
    const target = { traffic: moving, steal() { order.push('steal'); return { items: ['retrovisor'], caught: false }; } };
    const interaction = new InteractionSystem({}, { add() { order.push('add'); return true; } },
      { salud: 100, dinero: 10000, addXP() {} },
      { play() {}, playCarAlarm() { order.push('alarm'); }, playMovingTheft() { order.push('voice'); } },
      null, { getEffect: (_key, fallback) => fallback });
    interaction._stealCar(target);
    assert.deepEqual(order, ['steal', moving ? 'voice' : 'alarm', 'add']);
  }
});

test('cada pitada elige al azar entre las doce frases de Valentina y Roberto', () => {
  const { audio } = fixture(), vehicle = car(2);
  audio.updateWorld(.1, origin, null, [vehicle]);
  const state = audio.vehicles.instances.get(vehicle.car);
  vehicle.personBlocked = true; state.patience = 0;
  const files = [1, 3, 4, 5, 6, 7].map(n => `valentina_n${n}.mp3`)
    .concat(Array.from({ length: 6 }, (_, i) => `roberto_n${i + 1}.mp3`));
  assert.equal(audio.driverSounds.length, 12);
  for (let i = 0; i < files.length; i++) {
    audio.vehicles.random = () => (i + .1) / files.length;
    state.cooldown = 0;
    audio.updateWorld(.1, origin, null, [vehicle]);
    const file = files[i];
    assert.equal(state.remark.sound.options.src[0], `/audio/${file}`);
    assert.equal(state.remark.sound.voices.get(state.remark.id).volume, .7);
  }
  assert.ok(audio.driverSounds.every(sound => sound.starts === 1));
  audio.dispose(); assert.ok(audio.driverSounds.every(sound => sound.unloaded));
});

test('las frases solo empiezan a menos de ocho metros, se atenúan y los menús las detienen sin repetirlas', () => {
  const { audio } = fixture(), vehicle = car(0), listener = new THREE.Vector3(9, 0, 0);
  audio.updateWorld(.1, listener, null, [vehicle]);
  const state = audio.vehicles.instances.get(vehicle.car);
  assert.equal(state.remark, undefined, 'No habla sin una obstrucción');
  vehicle.personBlocked = true; state.patience = 0;
  audio.updateWorld(.1, listener, null, [vehicle]);
  assert.ok(state.horn); assert.equal(state.remark, undefined, 'La frase no empieza fuera de su alcance');
  listener.x = 2; state.cooldown = 0;
  audio.updateWorld(.1, listener, null, [vehicle]);
  const { sound, id } = state.remark;
  listener.x = 5; audio.updateWorld(.1, listener, null, [vehicle]);
  assert.equal(sound.voices.get(id).volume, .35);
  for (const distance of [8, 9, 20]) {
    listener.x = distance; audio.updateWorld(.1, listener, null, [vehicle]);
    assert.equal(sound.voices.get(id).volume, 0);
  }
  listener.set(0, 9, 0); audio.updateWorld(.1, listener, null, [vehicle]);
  assert.equal(sound.voices.get(id).volume, 0, 'También respeta la distancia vertical');
  audio.setPaused(true); assert.equal(sound.playing(id), false); assert.equal(state.remark, null);
  audio.setPaused(false); assert.equal(sound.playing(id), false);
  audio.dispose();
});

test('cada alarma se atenúa según su carro y queda muda desde los 41 metros sin reiniciar', () => {
  const { audio } = fixture(), car = { position: new THREE.Vector3() }, other = { position: new THREE.Vector3(60, 0, 0) };
  audio.updateWorld(.1, origin, null, []);
  audio.playCarAlarm(car); audio.playCarAlarm(other);
  const sound = audio.sounds.carAlarm, id = audio._carAlarms.get(car).id, otherId = audio._carAlarms.get(other).id;
  assert.equal(sound.voices.get(id).volume, .6); assert.equal(sound.voices.get(otherId).volume, 0);
  audio.updateWorld(.1, new THREE.Vector3(23, 0, 0), null, []);
  assert.equal(sound.voices.get(id).volume, .3);
  for (const distance of [41, 42, 80]) {
    audio.updateWorld(.1, new THREE.Vector3(distance, 0, 0), null, []);
    assert.equal(sound.voices.get(id).volume, 0);
  }
  audio.updateWorld(.1, origin, null, []);
  assert.equal(sound.voices.get(id).volume, .6);
  assert.equal(sound.starts, 2, 'Volver a acercarse conserva la reproducción original');
  audio.dispose();
});

test('la alarma usa una voz por carro estacionado, no se duplica y respeta pausa y volumen maestro', () => {
  const { audio } = fixture(), first = {}, second = {};
  const sound = audio.sounds.carAlarm;
  assert.equal(sound.options.src[0], '/audio/Sonido%20De%20Alarma%20De%20Auto.opus');
  assert.equal(sound.options.loop, false);
  assert.equal(audio.playCarAlarm({ traffic: true }), false);
  assert.equal(audio.playCarAlarm(first), true);
  assert.equal(audio.playCarAlarm(first), false);
  assert.equal(audio.playCarAlarm(second), true);
  assert.equal(sound.starts, 2);
  const id = audio._carAlarms.get(first).id;
  audio.setPaused(true); assert.equal(sound.playing(id), false);
  assert.equal(audio.playCarAlarm({}), false);
  audio.setPaused(false); assert.equal(sound.playing(id), true);
  assert.equal(sound.starts, 2);
  sound.stop(id); audio.updateWorld(.1, origin, null, []);
  assert.equal(audio._carAlarms.has(first), false);
  audio.dispose(); assert.equal(sound.unloaded, true);
});

test('robar un retrovisor activa la alarma aunque te atrapen, pero un carro ya saqueado no la repite', () => {
  globalThis.window = new EventTarget();
  for (const caught of [false, true]) {
    let alarms = 0, used = false;
    const target = { steal() { if (used) return null; used = true; return { items: ['retrovisor'], caught }; } };
    const interaction = new InteractionSystem({}, { add() { return true; } },
      { salud: 100, dinero: 10000, addXP() {} },
      { play() {}, playCarAlarm(car) { assert.equal(car, target); alarms++; } },
      null, { getEffect: (_key, fallback) => fallback });
    interaction._stealCar(target); assert.equal(alarms, 1);
    interaction._stealCar(target); assert.equal(alarms, 1);
  }
});

test('la carpeta de audio contiene únicamente archivos utilizados y todos tienen duración válida', () => {
  const { audio } = fixture();
  try {
    const sounds = [...Object.values(audio.sounds), ...Object.values(audio.vehicleSounds), ...audio.driverSounds, ...audio.theftSounds];
    const used = sounds.map(sound => decodeURIComponent(sound.options.src[0].split('/').at(-1))).sort();
    const files = readdirSync(new URL('../public/audio/', import.meta.url)).sort();
    assert.deepEqual(files, used);
    assert.equal(files.filter(file => file.endsWith('.opus')).length, 10);
    for (const file of files) {
      const bytes = readFileSync(new URL(`../public/audio/${encodeURIComponent(file)}`, import.meta.url));
      assert.ok(audioMetadata(bytes).duration > 0);
    }
  } finally { audio.dispose(); }
});

test('los nueve audios nuevos existen y las rutas de claxon coinciden con los nombres actuales', async () => {
  const { audio, bank } = fixture(); await audio.ready;
  for (const sound of [...Object.values(bank), audio.sounds.steps, audio.sounds.ambient]) {
    const file = decodeURIComponent(sound.options.src[0].replace('/audio/', ''));
    const bytes = readFileSync(new URL(`../public/audio/${encodeURIComponent(file)}`, import.meta.url));
    const metadata = audioMetadata(bytes);
    assert.equal(metadata.format, 'opus');
    assert.ok(bytes.length > 1000);
    if (sound.options.sprite) {
      const [start, length] = sound.options.sprite.honk;
      assert.ok(metadata.duration * 1000 >= start + length, 'La pitada cabe en el nuevo archivo');
    }
  }
  assert.deepEqual([bank.horn1, bank.horn2, bank.horn3].map(sound => sound.options.src[0]),
    ['/audio/car_horn_sound1.opus', '/audio/car_horn_sound.opus', '/audio/car_horn_sound_v3.opus']);
  assert.equal(audio.sounds.steps.options.src[0], '/audio/Sounds_of_a_steps.opus');
  assert.ok(bank.horn1.options.sprite.honk[1] < 1000);
  audio.dispose();
});

test('un archivo de sonido ausente informa su ruta y conserva el error hasta una carga correcta', () => {
  const { audio, bank } = fixture(), errors = [];
  const logger = mock.method(console, 'error', (...args) => errors.push(args));
  try {
    bank.horn2.options.onloaderror(null, '404');
    bank.horn2.options.onloaderror(null, '404');
    assert.equal(audio.loadErrors.get('car_horn_sound.opus'), '404');
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0].includes('/audio/car_horn_sound.opus'));
    bank.horn2.options.onload();
    assert.equal(audio.loadErrors.size, 0);
  } finally { logger.mock.restore(); audio.dispose(); }
});

test('los dos buses mantienen voces independientes de marcha y ralentí', () => {
  const { audio, bank } = fixture();
  const north = new BusService({x:78.5,startZ:80,endZ:-60,stationZ:-30});
  const south = new BusService({x:71.5,startZ:-60,endZ:80,stationZ:-30});
  north.position.set(78.5,.02,-30); south.position.set(71.5,.02,-30); south.speed=5;
  audio.vehicles.update(.1,new THREE.Vector3(75,.92,-30),[],[north,south]);
  const a=audio.vehicles.instances.get(north),b=audio.vehicles.instances.get(south);
  assert.ok(a&&b); assert.notEqual(a.idle.id,b.idle.id);assert.notEqual(a.drive.id,b.drive.id);
  assert.equal(bank.busIdle.starts,2);assert.equal(bank.busDrive.starts,2);
  audio.dispose(); north.dispose(); south.dispose();
});

test('cada carro tiene voces normales independientes que mezclan marcha y ralentí', () => {
  const { audio, bank } = fixture(), first = car(4), second = car(-8);
  const vehicles = audio.vehicles;
  vehicles.update(.1, origin, [first, second]);
  const a = vehicles.instances.get(first.car), b = vehicles.instances.get(second.car);
  assert.notEqual(a.idle.id, b.idle.id);
  assert.notEqual(a.drive.id, b.drive.id);
  assert.equal(bank.carIdle.voices.get(a.idle.id).position, undefined);
  assert.equal(bank.carIdle.voices.get(b.idle.id).position, undefined);
  const oldIdle = a.idleVolume;
  first.speed = 5; first.car.position.x = 6;
  vehicles.update(.1, origin, [first, second]);
  assert.ok(a.idleVolume < oldIdle && a.idleVolume > 0);
  assert.ok(a.driveVolume > 0 && a.driveVolume < .40);
  assert.equal(b.driveVolume, 0);
  assert.equal(bank.carDrive.voices.get(a.drive.id).position, undefined);
  audio.dispose();
});

test('el claxon espera una obstrucción peatonal y mantiene enfriamiento independiente por carro', () => {
  const { audio, bank } = fixture(), first = car(5), second = car(-5);
  first.personBlocked = true;
  for (let i = 0; i < 8; i++) audio.vehicles.update(.1, origin, [first, second]);
  assert.equal(bank.horn2.starts, 0);
  for (let i = 0; i < 8; i++) audio.vehicles.update(.1, origin, [first, second]);
  assert.equal(bank.horn2.starts, 1);
  second.personBlocked = true;
  for (let i = 0; i < 20; i++) audio.vehicles.update(.1, origin, [first, second]);
  assert.equal(bank.horn2.starts, 2);
  const a = audio.vehicles.instances.get(first.car), b = audio.vehicles.instances.get(second.car);
  assert.notEqual(a.horn.id, b.horn.id);
  assert.equal(bank.horn2.voices.get(a.horn.id).volume, .48);
  first.personBlocked = second.personBlocked = false;
  for (let i = 0; i < 100; i++) audio.vehicles.update(.1, origin, [first, second]);
  assert.equal(bank.horn2.starts, 2);
  audio.dispose();
});

test('el presupuesto de ocho vehículos cercanos evita motores lejanos y libera los retirados', () => {
  const { audio, bank } = fixture();
  const cars = Array.from({ length: 20 }, (_, index) => car(index * 4));
  audio.vehicles.update(.1, origin, cars);
  assert.equal(bank.carIdle.starts, 8); assert.equal(bank.carDrive.starts, 8);
  assert.equal(audio.vehicles.instances.get(cars[19].car).idle, null);
  const removed = audio.vehicles.instances.get(cars[0].car).idle.id;
  audio.vehicles.update(.1, origin, cars.slice(1));
  assert.equal(audio.vehicles.instances.has(cars[0].car), false);
  assert.equal(bank.carIdle.playing(removed), false);
  cars[1].car.position.x = 200;
  audio.vehicles.update(.1, origin, cars.slice(1));
  assert.equal(audio.vehicles.instances.get(cars[1].car).idle, null);
  audio.dispose();
});

test('los vehículos cercanos mantienen motor y claxon aunque no se dibujen en la cámara', () => {
  const { audio, bank } = fixture(), vehicle = car(3);
  vehicle.car.group.visible = false; vehicle.personBlocked = true;
  for (let frame = 0; frame < 20; frame++) audio.vehicles.update(.1, origin, [vehicle]);
  assert.equal(bank.carIdle.starts, 1);
  assert.equal(bank.horn2.starts, 1);
  const voice = audio.vehicles.instances.get(vehicle.car).idle;
  assert.ok(bank.carIdle.voices.get(voice.id).volume > .2);
  audio.dispose();
});

test('menús pausan motores y ambiente sin duplicar voces al volver; eliminar audio libera todo', () => {
  const { audio, bank } = fixture(), vehicle = car(3);
  audio.startAmbient(); audio.updateSteps(true, false);
  audio.vehicles.update(.1, origin, [vehicle]);
  const id = audio.vehicles.instances.get(vehicle.car).idle.id;
  audio.setPaused(true);
  assert.equal(bank.carIdle.playing(id), false);
  assert.equal(audio.sounds.ambient.playing(), false);
  assert.equal(audio.sounds.steps.playing(), false);
  audio.setPaused(false); audio.setPaused(false);
  assert.equal(bank.carIdle.playing(id), true);
  assert.equal(bank.carIdle.starts, 1);
  assert.equal(audio.sounds.ambient.starts, 1);
  audio.dispose();
  assert.ok(Object.values(bank).every(sound => sound.unloaded));
  assert.equal(audio.vehicles.instances.size, 0);
});

test('el audio normal ignora la orientación de cámara y correr cambia los pasos sin reiniciarlos', () => {
  const { audio, howler } = fixture();
  const camera = new THREE.PerspectiveCamera(); camera.position.set(100, 50, 100); camera.lookAt(101, 50, 100);
  audio.updateWorld(.1, new THREE.Vector3(10, 0, 20), camera, []);
  assert.equal(howler.position, undefined);
  assert.equal(howler.direction, undefined);
  audio.updateSteps(true, false); audio.updateSteps(true, true);
  assert.equal(audio.sounds.steps.starts, 1);
  assert.equal(audio.sounds.steps.currentRate, 1.4);
  camera.lookAt(99, 50, 100);
  audio.updateWorld(.1, origin, camera, []);
  assert.equal(howler.direction, undefined);
  audio.dispose();
});

test('un audio todavía sin cargar no acumula reproducciones pendientes por cuadro', () => {
  const { audio, bank } = fixture();
  for (const sound of Object.values(bank)) sound.loaded = false;
  const sounds = new VehicleAudio(bank, () => .5), vehicle = car(1); vehicle.personBlocked = true;
  for (let i = 0; i < 100; i++) sounds.update(.1, origin, [vehicle]);
  assert.ok(Object.values(bank).every(sound => sound.starts === 0));
  for (const sound of Object.values(bank)) sound.loaded = true;
  sounds.update(.1, origin, [vehicle]);
  assert.equal(bank.carIdle.starts, 1); assert.equal(bank.horn2.starts, 1);
  sounds.clear(); audio.dispose();
});

test('carro y bus distinguen a un peatón atravesado de un semáforo o una cola de vehículos', () => {
  const route = new TrafficRoute(0, 60, 0, 60, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0]; vehicle.distance = 5; vehicle.speed = 4;
  route.sample(vehicle.distance, vehicle.car.position, traffic._direction);
  const person = vehicle.car.position.clone().add(new THREE.Vector3(6, 0, 0));
  traffic._clearance(vehicle, person, []); assert.equal(vehicle.personBlocked, true);
  traffic._clearance(vehicle, null, [{ position: person }]); assert.equal(vehicle.personBlocked, true);
  traffic._clearance(vehicle, null, []); assert.equal(vehicle.personBlocked, false);
  traffic.signals = { blocks: () => true };
  traffic._clearance(vehicle, person, []); assert.equal(vehicle.personBlocked, false);
  traffic.dispose();
  const bus = new BusService({ x: 10, startZ: 100, endZ: 0, stationZ: 20 });
  bus.position.z = 80;
  bus.update(.05, { player: new THREE.Vector3(10, 0, 65) });
  assert.equal(bus.personBlocked, true);
  bus.update(.05); assert.equal(bus.personBlocked, false);
  bus.signals = { busClearance: () => 0 };
  bus.update(.05, { player: new THREE.Vector3(10, 0, 65) });
  assert.equal(bus.personBlocked, false);
  bus.update(.05, { player: new THREE.Vector3(10, 0, bus.position.z - bus.length / 2 - .9) });
  assert.equal(bus.personBlocked, true, 'El bus también detecta al jugador junto al frente aunque tenga rojo');
});

test('quedarse ante el parachoques activa el claxon aunque el semáforo ya haya detenido al carro', () => {
  for (const distance of [10, 70, 130, 190]) {
    const { audio, bank } = fixture();
    const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 60, 0, 60, 3.2)], { carsPerRoute: 1, random: () => .5 });
    const vehicle = traffic.vehicles[0]; vehicle.distance = distance; vehicle.routeTimer = 1000;
    vehicle.route.sample(distance, vehicle.car.position, traffic._direction);
    vehicle.car.group.rotation.y = Math.atan2(-traffic._direction.z, traffic._direction.x);
    const front = vehicle.car.position.clone().addScaledVector(traffic._direction, vehicle.car.length / 2 + .8);
    traffic.signals = { blocks: () => true };
    for (let frame = 0; frame < 35; frame++) {
      traffic.update(.05);
      audio.vehicles.update(.05, front, traffic.vehicles);
    }
    assert.equal(bank.horn2.starts, 0, 'El rojo por sí solo no provoca una pitada');
    for (let frame = 0; frame < 35; frame++) {
      traffic.update(.05, { player: front });
      audio.vehicles.update(.05, front, traffic.vehicles);
    }
    assert.equal(bank.horn2.starts, 1, 'El jugador junto al frente debe provocar el claxon en cualquier rumbo');
    assert.equal(vehicle.speed, 0);
    const back = vehicle.car.position.clone().addScaledVector(traffic._direction, -vehicle.car.length / 2 - .8);
    for (let frame = 0; frame < 240; frame++) {
      traffic.update(.05, { player: back });
      audio.vehicles.update(.05, back, traffic.vehicles);
    }
    assert.equal(bank.horn2.starts, 1, 'Quedarse detrás no provoca claxon');
    traffic.dispose(); audio.dispose();
  }
});

test('la lluvia mantiene un único bucle, respeta pausa y se detiene al despejar', () => {
  const {audio}=fixture(),rain=audio.sounds.rain;
  assert.equal(rain.options.src[0],'/audio/rain_sound_01.mp3');
  assert.equal(rain.options.loop,true);
  audio.setRaining(false);assert.equal(rain.starts,0);
  for(let i=0;i<60;i++)audio.setRaining(true);
  const id=audio._rainId;
  assert.equal(rain.starts,1);assert.ok(rain.playing(id));
  audio.setMuted(true);assert.equal(audio.isMuted(),true);
  audio.setVolume(.3);assert.equal(audio.volume,.3);
  audio.setMuted(false);
  audio.setPaused(true);assert.equal(rain.playing(id),false);
  audio.setRaining(true);assert.equal(rain.playing(id),false);
  audio.setPaused(false);assert.ok(rain.playing(id));assert.equal(rain.starts,1);
  audio.setPaused(true);audio.setRaining(false);audio.setPaused(false);
  assert.equal(rain.playing(),false);assert.equal(audio._rainId,undefined);
  audio.setRaining(true);assert.equal(rain.starts,2);
  audio.dispose();assert.equal(rain.unloaded,true);
});

test('una lluvia que todavía carga no acumula reproducciones pendientes', () => {
  const {audio}=fixture(),rain=audio.sounds.rain;rain.loaded=false;
  for(let i=0;i<60;i++)audio.setRaining(true);
  assert.equal(rain.starts,0);
  rain.loaded=true;audio.setRaining(true);audio.setRaining(true);
  assert.equal(rain.starts,1);
  audio.setRaining(false);assert.equal(rain.playing(),false);
  audio.dispose();
});
