// Robo de carros: bajarse sin sitio, el daño del choque, la alarma, el fichado y lo que pasa con el juego si se
// muere, cae preso, guarda, cambia la calidad o abre un menú al volante.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CarjackSystem, CARJACK } from '../src/systems/CarjackSystem.js';
import { Game } from '../src/core/game.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';

const realRandom = Math.random;
beforeEach(() => { globalThis.window = new EventTarget(); });
afterEach(() => { Math.random = realRandom; });

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

/** Caja de colisión estática o dinámica (un carro) en planta. */
const caja = (minX, minZ, maxX, maxZ) => ({ box: new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, 2, maxZ)) });

function fakeGame(cars = [], { statics = [], dynamics = [], water = null } = {}) {
  const alarms = [];
  return {
    cars, traffic: { vehicles: [] },
    player: { position: new THREE.Vector3(0, 0, 1.5), root: new THREE.Group(), velocity: new THREE.Vector3() },
    cameraRig: { mode: 'third-person', yaw: 0, pitch: .22, distance: 5.5 },
    collisions: { queryStatic: () => statics, dynamicColliders: dynamics },
    world: { active: { npcs: [], getGroundHeight: () => 0, getWaterInfo: water } },
    audio: { playCarAlarm: car => alarms.push(car) },
    steal: { buscado: 0 }, stats: { salud: 100, addXP() {} },
    alarms
  };
}

/** Sube a `car` y espera a quedar al volante. */
function subir(carjack, car) {
  carjack.enter({ car });
  settle(carjack);
  assert.equal(carjack.car, car);
}

function toasts() {
  const list = [];
  window.addEventListener('toast', e => list.push(e.detail.text));
  return list;
}

test('sin un lado libre (carros a los dos costados y muro delante y detrás) no se baja dentro de nada: sigue al volante', () => {
  // El carro va a lo largo de X: los costados son ±Z y las puntas ±X.
  const car = fakeCar(), left = fakeCar(0, -2.6), right = fakeCar(0, 2.6);
  const game = fakeGame([car, left, right], {
    statics: [caja(2.4, -1, 4, 1), caja(-4, -1, -2.4, 1)],
    dynamics: [{ vehicle: left, ...caja(-2.1, -3.5, 2.1, -1.7) }, { vehicle: right, ...caja(-2.1, 1.7, 2.1, 3.5) }]
  });
  const said = toasts(), carjack = new CarjackSystem(game), input = fakeInput();
  subir(carjack, car);
  input.pressed.add(CARJACK.key);
  assert.equal(carjack.update(1 / 30, input), true, 'sigue manejando');
  assert.equal(carjack.car, car);
  assert.equal(carjack.transition, null);
  assert.equal(game.player.root.visible, false);
  assert.ok(said.includes('No hay por dónde bajarme.'), said.join(' | '));
  // Se quita el muro de delante: ahora se baja por la punta libre, fuera de toda caja.
  game.collisions.queryStatic = () => [caja(-4, -1, -2.4, 1)];
  input.pressed.add(CARJACK.key);
  carjack.update(1 / 30, input);
  settle(carjack);
  assert.equal(carjack.car, null);
  assert.equal(game.player.root.visible, true);
  assert.ok(game.player.position.x > 2.1 + .4, `queda delante del carro, x = ${game.player.position.x.toFixed(2)}`);
  assert.equal(car.driven, false);
});

test('a la orilla del lago se baja por el lado seco, y con agua honda por todos lados no se baja', () => {
  const car = fakeCar();
  let wetSide = z => z < 0; // el lago al costado izquierdo (−Z)
  const water = (x, z) => (wetSide(z) ? { surfaceY: 1 } : null);
  const game = fakeGame([car], { water });
  const carjack = new CarjackSystem(game), input = fakeInput();
  subir(carjack, car);
  input.pressed.add(CARJACK.key);
  carjack.update(1 / 30, input);
  settle(carjack);
  assert.equal(carjack.car, null);
  assert.ok(game.player.position.z > 0, 'se bajó por el costado seco');
  // De nuevo al volante, ahora rodeado de agua honda.
  for (let i = 0; i < 60; i++) carjack.update(1 / 30, fakeInput());
  subir(carjack, car);
  wetSide = () => true;
  input.pressed.add(CARJACK.key);
  assert.equal(carjack.update(1 / 30, input), true);
  assert.equal(carjack.car, car);
});

test('el choque contra un muro: nada a 20 km/h, 4 de salud a 36 y 6 a 54; nunca deja la salud en cero', () => {
  const golpe = (kmh, salud = 100) => {
    const car = fakeCar(), game = fakeGame([car], { statics: [caja(2.2, -3, 4, 3)] });
    game.stats.salud = salud;
    const carjack = new CarjackSystem(game), input = fakeInput();
    subir(carjack, car);
    carjack.speed = kmh / 3.6;
    input.down.add('KeyW');
    carjack.update(1 / 30, input);
    assert.ok(carjack.speed <= 0, `rebota o se detiene a ${kmh} km/h`);
    assert.equal(car.position.x, 0, 'no atraviesa el muro');
    return salud - game.stats.salud;
  };
  assert.equal(golpe(20), 0);
  assert.equal(golpe(36), 4);
  assert.equal(golpe(54), 6);
  assert.equal(golpe(54, 3), 2, 'deja al menos 1 de salud');
});

test('forzar la puerta: con alarma suena y lo dice, sin alarma no; el fichado sube uno por robo y no pasa de 3', () => {
  for (const [roll, alarma] of [[.1, true], [.9, false]]) {
    const car = fakeCar(), game = fakeGame([car]), said = toasts();
    Math.random = () => roll;
    const carjack = new CarjackSystem(game);
    subir(carjack, car);
    assert.equal(game.alarms.length, alarma ? 1 : 0);
    assert.ok(said.some(t => (alarma ? /saltó la alarma/ : /sin hacer ruido/).test(t)), said.join(' | '));
    assert.equal(game.steal.buscado, 1);
  }
  const cars = [fakeCar(), fakeCar(20, 0), fakeCar(40, 0), fakeCar(60, 0)];
  const game = fakeGame(cars), carjack = new CarjackSystem(game);
  for (const car of cars) {
    subir(carjack, car);
    carjack.reset();
  }
  assert.equal(game.steal.buscado, 3);
});

// --- El juego alrededor: Game con lo justo para cada caso ---

function gameFixture() {
  const car = fakeCar(30, 30);
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), deathCount: 0, _deathPending: false, _arrestPending: false,
    talents: { getEffect: (key, fallback) => fallback, serialize: () => ({}) }, clock: { isNight: false, serialize: () => ({}) },
    save: { saved: null, save(data) { this.saved = data; } }, built: {}, costal: false,
    player: { position: new THREE.Vector3(30, 0, 31.5), root: new THREE.Group(), velocity: new THREE.Vector3(),
      clearVehicleImpact() {} },
    world: { active: { reserved: { bed: { x: 89, z: 80 }, spawn: { x: 32, z: 32 } }, getGroundHeight: () => 0 } },
    input: { keys: {}, endFrame() {} },
    audio: { updateSteps() {} },
    interaction: { currentTarget: null, currentTargetType: null, boostActive: false },
    menu: { isOpen: false, open(options) { this.options = options; this.isOpen = true; }, close() { this.isOpen = false; } },
    diseases: { hasAny: false, cureAll() {}, serialize: () => ({}) },
    inventory: new InventorySystem(),
    cameraRig: { mode: 'third-person', yaw: 0, pitch: .22, distance: 5.5, follow() {} },
    collisions: { queryStatic: () => [], dynamicColliders: [] },
    cars: [car], traffic: { vehicles: [] }, steal: { buscado: 0, serialize: () => null }, look: {},
    _calleCercana: () => 'la Séptima', _randomWalkablePosition: () => new THREE.Vector3(50, 0, 50)
  });
  game.carjack = new CarjackSystem(game);
  subir(game.carjack, car);
  assert.equal(game.player.root.visible, false);
  return { game, car };
}

/** Lo que nunca puede quedar después de soltar el volante a la fuerza. */
function quedaBien(game, car) {
  assert.equal(game.carjack.driving, false, 'ya no maneja');
  assert.equal(game.carjack.transition, null);
  assert.equal(game.player.root.visible, true, 'el jugador se ve');
  assert.equal(car.driven, false, 'el carro no queda con conductor');
  assert.equal(game.cameraRig.distance, 5.5, 'la cámara vuelve a su distancia a pie');
  assert.ok(game.player.position.distanceTo(car.position) > 3, 'no queda dentro del carro');
  assert.equal(game.carjack.update(1 / 30, { consumePress: () => false, isDown: () => false, axis: { x: 0, z: 0 } }), false,
    'el juego le devuelve el movimiento a pie');
}

test('morir al volante: al recuperarse está a pie, visible y lejos del carro, que queda parqueado', () => {
  const { game, car } = gameFixture();
  game.stats.salud = 0;
  assert.equal(game._handleDeath(), true);
  assert.equal(game.menu.isOpen, true);
  game._respawn();
  quedaBien(game, car);
});

test('caer preso al volante: sale a pie, el carro deja de ser suyo y subirse otra vez es otro robo', () => {
  const { game, car } = gameFixture();
  game._policeArrest();
  game._finishArrest();
  quedaBien(game, car);
  game.player.position.set(30, 0, 31.5);
  for (let i = 0; i < 60; i++) game.carjack.update(1 / 30, fakeInput());
  assert.equal(game.carjack.prompt, '[Y] Forzar la puerta y robarme el carro');
});

test('guardar al volante no guarda el carro, y cada partida empieza a pie frente al cambuche', () => {
  const { game } = gameFixture();
  game._save();
  const saved = game.save.saved;
  assert.ok(saved?.player, 'guardó la partida');
  assert.equal(JSON.stringify(saved).includes('carjack'), false);
  assert.equal(game.carjack.driving, true, 'guardar no lo baja');
  const source = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(source, /_loadIfSave\(partida\);[^]*?reserved\.spawn\.x/, 'al cargar, la posición guardada se cambia por el inicio');
});

test('cambiar la calidad gráfica al volante no lo baja ni le cambia la cámara', () => {
  const { game, car } = gameFixture();
  Object.assign(game, {
    renderer: { setQuality() {}, instance: { shadowMap: { enabled: false } } },
    sceneMgr: { setQuality() {} }
  });
  game.setGraphicsQuality('baja', false);
  assert.equal(game.carjack.car, car);
  assert.equal(game.cameraRig.distance, CARJACK.cameraDistance);
  assert.equal(game.player.root.visible, false);
});

test('al volante no se abre nada de a pie (dormir, el bus, tiendas, robar) y el menú, la pausa y la foto congelan el carro', () => {
  const source = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  const loop = source.slice(source.indexOf('_loop = (stamp) =>'));
  // La pausa, los menús y el modo foto salen del bucle antes de llegar al carro.
  assert.ok(loop.indexOf('this.photoMode?.active') < loop.indexOf('this._updateCarjack(dt)'));
  assert.ok(loop.indexOf('if (this.isSleeping || this.paused') < loop.indexOf('this._updateCarjack(dt)'));
  // Las interacciones (cambuche, torniquetes del bus, tiendas) y el robo a pie no corren mientras maneja.
  assert.match(loop, /if \(!this\.player\.isStunned && !driving\) \{\s*\/\/[^\n]*\n[^]*?this\.interaction\.update/);
  assert.match(loop, /if \(!this\.player\.isSwimming && !driving\) this\.steal\?\.update\(dt\);\s*else if \(this\.steal\?\.minigameActive\) this\.steal\._endMinigame\(false, 'cancel'\);/);
  // En el modo foto el velocímetro no sale en la foto.
  const css = readFileSync(new URL('../src/ui/css/hud.css', import.meta.url), 'utf8');
  assert.match(css, /\.is-photo-mode #carjack-hud \{ visibility: hidden !important; \}/);
});
