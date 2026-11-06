// Robo de carros: motos, volver al propio carro, el lago, la salida junto a otro carro, la cámara y los atropellos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CarjackSystem, CARJACK, BOARDING } from '../src/systems/CarjackSystem.js';
import { MirrorCinematic, MIRROR_CINEMATIC } from '../src/ui/MirrorCinematic.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { Moto } from '../src/entities/Moto.js';
import { Npc } from '../src/entities/Npc.js';
import { StealSystem, WANTED_DECAY_SECONDS } from '../src/features/steal.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fakeCar(x = 0, z = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  return { group, get position() { return group.position; }, length: 4.2, width: 1.8,
    marker: { visible: true }, traffic: false, setNight() {}, animateDrive() {} };
}

function fakeInput() {
  const down = new Set(), pressed = new Set();
  const input = { down, pressed, isDown: c => down.has(c), consumePress: c => pressed.delete(c) };
  Object.defineProperty(input, 'axis', { get() {
    return { x: (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0), z: (down.has('KeyS') ? 1 : 0) - (down.has('KeyW') ? 1 : 0) };
  } });
  return input;
}

function settle(carjack, input = fakeInput(), dt = 1 / 30) {
  let frames = 0;
  while (carjack.transition && frames < 200) { carjack.update(dt, input); frames++; }
  return frames;
}

function fakeGame(cars = [], vehicles = []) {
  let xp = 0, reports = 0;
  return {
    cars, traffic: { vehicles, playerVehicle: null, setParkedCars() {}, release(v) { vehicles.splice(vehicles.indexOf(v), 1); } },
    player: { position: new THREE.Vector3(0, 0, 1.5), root: new THREE.Group(), velocity: new THREE.Vector3() },
    cameraRig: { mode: 'third-person', yaw: 0, pitch: .22, distance: 5.5 },
    collisions: { queryStatic: () => [], dynamicColliders: [] },
    world: { active: { npcs: [], getGroundHeight: () => 0 } },
    witnesses: { report() { reports++; } },
    steal: { buscado: 0 }, stats: { salud: 100, addXP(n) { xp += n; } },
    get xp() { return xp; }, get reports() { return reports; }
  };
}

const moto = (x = 0, z = 0) => new Moto(new THREE.Vector3(x, 0, z), 0,
  { variant: 0, occupancy: [true, false, false], helmets: [true, false, false], color: '#f00' });

test('una moto quieta en el semáforo no se deja robar con Y', () => {
  const m = moto(), vehicle = { car: m, speed: 0, police: false, hold: false };
  const game = fakeGame([], [vehicle]), input = fakeInput();
  game.player.position.set(0, 0, m.width / 2 + .5);
  const carjack = new CarjackSystem(game);
  assert.equal(carjack._findTarget(), null);
  assert.equal(carjack.update(.016, input), false);
  assert.equal(carjack.prompt, null);
  input.pressed.add(CARJACK.key);
  carjack.update(.016, input);
  assert.equal(carjack.driving, false);
  assert.equal(game.traffic.vehicles.length, 1, 'sigue en el tráfico, la sigue dibujando el lote');
  assert.equal(game.cars.length, 0);
});

test('una partida vieja con una moto robada no la rehace como carro', () => {
  const game = fakeGame();
  game.sceneMgr = { scene: new THREE.Scene() };
  const carjack = new CarjackSystem(game);
  let built = 0;
  class CarClass { constructor() { built++; } }
  assert.equal(carjack.restore({ pos: [0, 0, 0], rot: 0, kind: 'moto', variant: 0 }, { CarClass }), null);
  assert.equal(built, 0);
  assert.equal(game.cars.length, 0);
  // Y si alguna quedara como la robada, no se guarda.
  carjack.stolen = moto(); game.cars.push(carjack.stolen);
  assert.equal(carjack.serialize(), null);
});

test('volver a subirse al propio carro no es otro robo: sin alarma, fichado, testigos, experiencia ni evento', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  const events = [];
  for (const name of ['carjack', 'carjack-reenter', 'toast']) window.addEventListener(name, e => events.push([name, e.detail]));
  input.pressed.add(CARJACK.key);
  carjack.update(.016, input);
  settle(carjack);
  assert.equal(game.steal.buscado, 1);
  for (let round = 0; round < 3; round++) {
    input.pressed.add(CARJACK.key);
    carjack.update(1 / 30, input); // se baja
    settle(carjack);
    for (let i = 0; i < 60; i++) carjack.update(1 / 30, fakeInput()); // pasa el enfriamiento
    assert.equal(carjack.prompt, '[Y] Subirme a mi carro');
    input.pressed.add(CARJACK.key);
    carjack.update(1 / 30, input);
    settle(carjack);
    assert.equal(carjack.car, car);
  }
  assert.equal(game.steal.buscado, 1);
  assert.equal(game.xp, CARJACK.xp);
  assert.equal(game.reports, 1);
  assert.equal(events.filter(([n]) => n === 'carjack').length, 1);
  assert.equal(events.filter(([n]) => n === 'carjack-reenter').length, 3);
  assert.equal(events.filter(([n, d]) => n === 'toast' && /Forcé/.test(d.text)).length, 1, 'solo el primer robo fuerza la puerta');
});

test('si lo coge la Policía manejándolo, el carro ya no es suyo: volver a subirse es otro robo', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  const events = [];
  for (const name of ['carjack', 'carjack-reenter']) window.addEventListener(name, () => events.push(name));
  carjack.enter({ car, vehicle: null });
  settle(carjack);
  assert.ok(carjack.serialize(), 'manejándolo, la partida lo guarda');
  // Game._finishArrest
  carjack.reset({ perdido: true });
  assert.equal(carjack.serialize(), null, 'la partida ya no lo guarda como suyo');
  game.player.position.set(0, 0, 1.5);
  game.steal.buscado = 0;
  for (let i = 0; i < 60; i++) carjack.update(1 / 30, fakeInput());
  assert.notEqual(carjack.prompt, '[Y] Subirme a mi carro');
  assert.match(carjack.prompt ?? '', /^\[Y\] /);
  input.pressed.add(CARJACK.key);
  carjack.update(1 / 30, input);
  settle(carjack);
  assert.equal(carjack.car, car);
  assert.equal(game.steal.buscado, 1, 'otro robo, otra vez fichado');
  assert.equal(game.xp, 2 * CARJACK.xp);
  assert.deepEqual(events, ['carjack', 'carjack']);
  // Un reinicio cualquiera (cambio de distrito, recuperación) no le quita el carro.
  carjack.reset();
  assert.ok(carjack.serialize());
  // El arresto se cobra en cobrarArresto (castigoPendiente.js), que usan el juego y la partida guardada.
  const loop = readFileSync(new URL('../src/systems/castigoPendiente.js', import.meta.url), 'utf8');
  assert.match(loop, /ya no es suyo\.\s*game\.carjack\?\.reset\?\.\(\{ perdido: true \}\)/);
});

test('el carro de la partida guardada también es suyo al cargar', () => {
  const game = fakeGame();
  game.sceneMgr = { scene: new THREE.Scene() };
  const carjack = new CarjackSystem(game);
  class CarClass {
    constructor(_scene, position, rotation) {
      this.group = new THREE.Group(); this.group.position.copy(position); this.group.rotation.y = rotation;
      this.position = this.group.position; this.length = 4.2; this.width = 1.8; this.marker = { visible: true };
    }
    setNight() {} animateDrive() {}
  }
  const car = carjack.restore({ pos: [0, 0, 0], rot: 0, kind: 'carro', variant: 1 }, { CarClass });
  assert.ok(car);
  carjack.update(.016, fakeInput());
  assert.equal(carjack.prompt, '[Y] Subirme a mi carro');
  carjack.enter({ car, vehicle: null });
  settle(carjack);
  assert.equal(game.steal.buscado, 0);
  assert.equal(game.xp, 0);
});

test('manejando, la Policía sabe en qué carro va; al bajarse o reiniciar, ya no', () => {
  const car = fakeCar(), game = fakeGame([car]);
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  assert.equal(game.traffic.playerVehicle, car);
  settle(carjack);
  carjack.exit();
  assert.equal(game.traffic.playerVehicle, null);
  settle(carjack);
  carjack.cooldown = 0;
  carjack.enter({ car, vehicle: null });
  carjack.reset();
  assert.equal(game.traffic.playerVehicle, null);
});

test('el carro no entra al lago: se queda en la orilla, y por el puente sí pasa sobre el agua', () => {
  // Orilla en x = 10: más allá el fondo baja hasta 6 m bajo la superficie, como el Parque del Lago.
  const water = x => x > 10 ? { surfaceY: -.18, bottomY: -6.18, depth: 6 } : null;
  const bed = x => x > 10 ? Math.max(-6.18, -.18 - (x - 10) * .5) : 0;
  const run = deck => {
    const car = fakeCar(0, 0), game = fakeGame([car]);
    game.world.active = { npcs: [], getWaterInfo: x => water(x),
      getMovementGroundHeight: (x, _z, y) => deck ? y : bed(x) };
    const carjack = new CarjackSystem(game);
    carjack.enter({ car, vehicle: null });
    settle(carjack);
    const input = fakeInput();
    input.down.add('KeyW');
    let minY = 0;
    for (let i = 0; i < 300; i++) { carjack.update(1 / 30, input); minY = Math.min(minY, car.position.y); }
    return { car, minY };
  };
  const shore = run(false);
  assert.ok(shore.minY > -.5, `bajó hasta ${shore.minY.toFixed(2)}`);
  assert.ok(shore.car.position.x > 5 && shore.car.position.x < 14, `quedó en x ${shore.car.position.x.toFixed(1)}`);
  const bridge = run(true);
  assert.ok(bridge.car.position.x > 30, 'sobre el tablero sigue de largo');
});

test('al bajarse no lo pone dentro del carro parqueado de al lado: sale por el otro costado', () => {
  const collisions = new CollisionSystem();
  const stolen = fakeCar(0, 0), parked = fakeCar(0, -2.4); // al lado de la puerta del conductor (−Z)
  collisions.setVehicles([stolen, parked]);
  const game = fakeGame([stolen, parked]);
  game.collisions = collisions;
  const carjack = new CarjackSystem(game);
  carjack.enter({ car: stolen, vehicle: null });
  settle(carjack);
  carjack.exit();
  settle(carjack);
  const p = game.player.position, box = collisions.dynamicColliders.find(e => e.vehicle === parked).box;
  assert.ok(p.z > 0, `salió por la derecha (z ${p.z.toFixed(2)})`);
  assert.ok(!(p.x + .4 > box.min.x && p.x - .4 < box.max.x && p.z + .4 > box.min.z && p.z - .4 < box.max.z));
});

test('robar el carro durante la cinemática del espejo deja la cámara del carro, y al bajarse la de a pie', () => {
  const car = fakeCar(0, 0), game = fakeGame([car]);
  const cinematic = game.mirrorCinematic = new MirrorCinematic(game, { random: () => 0 });
  const carjack = game.carjack = new CarjackSystem(game);
  window.dispatchEvent(new CustomEvent('steal', { detail: { mirror: true, caught: false, car } }));
  assert.equal(game.cameraRig.distance, MIRROR_CINEMATIC.distance);
  const input = fakeInput();
  input.pressed.add(CARJACK.key);
  carjack.update(1 / 30, input); cinematic.update(1 / 30);
  assert.equal(game.cameraRig.distance, CARJACK.cameraDistance);
  settle(carjack);
  carjack.exit();
  for (let t = 0; t < BOARDING.cameraReturn + .5; t += 1 / 30) { carjack.update(1 / 30, fakeInput()); cinematic.update(1 / 30); }
  assert.ok(Math.abs(game.cameraRig.distance - 5.5) < 1e-9, `quedó a ${game.cameraRig.distance}`);
});

test('la cinemática del espejo justo al bajarse conserva su primer plano y luego vuelve a la distancia a pie', () => {
  const car = fakeCar(0, 0), game = fakeGame([car]);
  const cinematic = game.mirrorCinematic = new MirrorCinematic(game, { random: () => 0 });
  const carjack = game.carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  settle(carjack);
  carjack.exit();
  // Al terminar de bajarse (la cámara todavía regresa) le roba un espejo al mismo carro.
  while (carjack.update(1 / 30, fakeInput())) cinematic.update(1 / 30);
  assert.ok(game.cameraRig.distance > 5.6, 'la cámara aún venía de lejos');
  assert.equal(cinematic.play(car), true);
  for (let t = 0; t < MIRROR_CINEMATIC.duration - .1; t += 1 / 30) {
    carjack.update(1 / 30, fakeInput()); cinematic.update(1 / 30);
    assert.equal(game.cameraRig.distance, MIRROR_CINEMATIC.distance);
  }
  for (let t = 0; t < .5; t += 1 / 30) { carjack.update(1 / 30, fakeInput()); cinematic.update(1 / 30); }
  assert.equal(cinematic.active, false);
  assert.equal(game.cameraRig.distance, 5.5);
});

test('la rueda del ratón durante el regreso de la cámara no se pierde', () => {
  const car = fakeCar(0, 0), game = fakeGame([car]);
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  settle(carjack);
  carjack.exit();
  carjack.update(1 / 30, fakeInput());
  game.cameraRig.distance = 4; // zoom del jugador
  for (let i = 0; i < 40; i++) carjack.update(1 / 30, fakeInput());
  assert.equal(game.cameraRig.distance, 4);
});

test('pasar por encima de alguien que ya está en el suelo no sube el fichado ni frena el carro', () => {
  const car = fakeCar(0, 0), game = fakeGame([car]);
  const carjack = new CarjackSystem(game);
  carjack.enter({ car, vehicle: null });
  settle(carjack);
  const toasts = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
  const npc = { position: new THREE.Vector3(1, 0, 0), koState: 'down', hitByCar: Npc.prototype.hitByCar };
  game.world.active.npcs = [npc];
  const before = game.steal.buscado;
  carjack.speed = 5;
  carjack._hitPedestrians();
  assert.equal(game.steal.buscado, before);
  assert.equal(carjack.speed, 5);
  assert.equal(toasts.length, 0);
  // Uno de pie sí recibe el golpe y cuenta.
  const standing = { position: new THREE.Vector3(1, 0, 0), hitByCar: () => true };
  game.world.active.npcs = [standing];
  carjack._hitPedestrians();
  assert.equal(game.steal.buscado, before + 1);
  assert.ok(carjack.speed < 5);
  // Un `false` explícito tampoco cuenta.
  const refused = { position: new THREE.Vector3(1, 0, 0), hitByCar: () => false };
  game.world.active.npcs = [refused];
  carjack.speed = 5;
  carjack._hitPedestrians();
  assert.equal(game.steal.buscado, before + 1);
});

test('al volante el fichado se sigue enfriando: StealSystem.tick y el juego lo llama cuando no camina', () => {
  const traffic = { wantedLevel: 0, inPursuit: false };
  const npc = { _robadoTimer: 30 };
  const steal = new StealSystem({ traffic, stats: {}, input: { consumePress: () => false }, interaction: {}, world: { active: { npcs: [npc] } } });
  steal.buscado = 1;
  steal._enfriarFichado(0);
  steal.cooldown = 5;
  for (let t = 0; t < WANTED_DECAY_SECONDS + 1; t += 1 / 60) steal.tick(1 / 60);
  assert.equal(steal.buscado, 0);
  assert.equal(traffic.wantedLevel, 0);
  assert.equal(steal.cooldown, 0);
  assert.equal(npc._robadoTimer, 0);
  const loop = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(loop, /if \(!this\.player\.isSwimming && !driving[^)]*\) this\.steal\?\.update\(dt\);\s*else \{[^}]*this\.steal\?\.tick\?\.\(dt\);/);
});
