// Robo de carros: lo que cuida el volante. Pantalla táctil y mando, el golpe al volante, el carro dejado que vuelve a
// su puesto, la Y con el cosquilleo abierto, el ladeo del sardinel, los topes de velocidad y desnivel, la reversa, los
// choques con otros carros, el lado por el que se baja, el filtro de altura y lo que el juego apaga mientras maneja.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CarjackSystem, CARJACK } from '../src/systems/CarjackSystem.js';
import { CarGuarding } from '../src/systems/CarGuarding.js';
import { Game } from '../src/core/game.js';
import { Player } from '../src/entities/Player.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { CON_LB } from '../src/core/Gamepad.js';
import { ponerModo, teclaVisible, TECLA_EN_MANDO } from '../src/core/modoEntrada.js';

beforeEach(() => { globalThis.window = new EventTarget(); });
afterEach(() => { ponerModo('teclado'); });

/** Carro parqueado con su carrocería ladeada en el sardinel, como lo deja `parkCar`. */
function fakeCar(x = 0, z = 0, { tilt = -.063, lift = .06 } = {}) {
  const group = new THREE.Group(), body = new THREE.Group();
  group.position.set(x, 0, z);
  body.rotation.x = tilt;
  body.position.y = lift;
  return { group, vehicle: { group: body }, get position() { return group.position; }, length: 4.2, width: 1.8,
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
}

const caja = (minX, minZ, maxX, maxZ) => ({ box: new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, 2, maxZ)) });

function fakeGame(cars = [], { dynamics = [], ground = () => 0 } = {}) {
  return {
    cars, traffic: { vehicles: [], _resizeDistance: () => 60 },
    player: { position: new THREE.Vector3(0, 0, 1.5), root: new THREE.Group(), velocity: new THREE.Vector3() },
    cameraRig: { mode: 'third-person', yaw: 0, pitch: .22, distance: 5.5 },
    collisions: { queryStatic: () => [], dynamicColliders: dynamics },
    world: { active: { npcs: [], getGroundHeight: ground } },
    audio: { playCarAlarm() {} },
    steal: { buscado: 0 }, stats: { salud: 100, addXP() {} }
  };
}

function subir(carjack, car) {
  carjack.enter({ car });
  settle(carjack);
  assert.equal(carjack.car, car);
}

/** Maneja `seconds` con las teclas de `keys` apretadas. */
function manejar(carjack, keys, seconds, dt = 1 / 30) {
  const input = fakeInput();
  for (const k of keys) input.down.add(k);
  for (let t = 0; t < seconds; t += dt) carjack.update(dt, input);
}

function toasts() {
  const list = [];
  window.addEventListener('toast', e => list.push(e.detail.text));
  return list;
}

test('en pantalla táctil no se ofrece robar: sin aviso y la Y no lo sube (no hay botón para bajarse)', () => {
  const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game), input = fakeInput();
  ponerModo('tactil');
  input.pressed.add(CARJACK.key);
  assert.equal(carjack.update(1 / 30, input), false);
  assert.equal(carjack.prompt, null);
  assert.equal(carjack.car, null);
  ponerModo('teclado');
  carjack.update(1 / 30, fakeInput());
  assert.equal(carjack.prompt, '[Y] Forzar la puerta y robarme el carro');
});

test('con mando la Y del aviso se lee LB+B, el botón que roba, y el velocímetro dice sus teclas', () => {
  assert.equal(TECLA_EN_MANDO.Y, 'LB+B');
  assert.equal(CON_LB[1], 'KeyY', 'B con LB sostenido es la Y');
  ponerModo('mando');
  assert.equal(teclaVisible('Y'), 'LB+B');
  const source = readFileSync(new URL('../src/systems/CarjackSystem.js', import.meta.url), 'utf8');
  const hud = source.match(/hud\.innerHTML = '([^']*)'/)[1];
  const kbds = hud.match(/<kbd[^>]*>/g);
  assert.equal(kbds.length, 6);
  // Con mando, `body.mando kbd:not([data-k])` se esconde: cada tecla lleva su data-k.
  for (const kbd of kbds) assert.match(kbd, /data-k="/);
});

test('con la barra del cosquilleo abierta la Y no hace nada: ni aviso ni robo', () => {
  const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game), input = fakeInput();
  game.steal.minigameActive = true;
  input.pressed.add(CARJACK.key);
  assert.equal(carjack.update(1 / 30, input), false);
  assert.equal(carjack.prompt, null);
  assert.equal(carjack.car, null);
});

test('subirse endereza el carro ladeado en el sardinel, y bajarse no lo vuelve a ladear', () => {
  const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game);
  subir(carjack, car);
  assert.equal(car.vehicle.group.rotation.x, 0);
  assert.ok(Math.abs(car.vehicle.group.position.y - 0) < 1e-9, 'baja los 6 cm del sardinel');
  manejar(carjack, ['KeyW'], 1);
  manejar(carjack, ['Space'], 2);
  carjack.update(1 / 30, Object.assign(fakeInput(), { consumePress: c => c === CARJACK.key }));
  settle(carjack);
  assert.equal(carjack.car, null);
  assert.equal(car.vehicle.group.rotation.x, 0);
});

test('el carro dejado lejos de su puesto vuelve a él, ladeado como estaba, cuando el jugador se aleja; cerca se queda', () => {
  const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game);
  subir(carjack, car);
  car.position.set(30, 0, 0);
  car.group.rotation.y = .7;
  carjack.exit();
  settle(carjack);
  const quieto = () => { for (let i = 0; i < 90; i++) carjack.update(1 / 30, fakeInput()); };
  // Jugador al lado del carro: no se mueve.
  quieto();
  assert.equal(car.position.x, 30);
  // Lejos del carro (70 m) pero cerca del puesto (40 m): tampoco, se vería aparecer.
  game.player.position.set(-40, 0, 0);
  quieto();
  assert.equal(car.position.x, 30);
  // Cerca del carro (55 m) y lejos del puesto (85 m): tampoco, se vería desaparecer.
  game.player.position.set(85, 0, 0);
  quieto();
  assert.equal(car.position.x, 30);
  // Lejos de los dos, con el puesto ocupado por otro carro: espera.
  game.player.position.set(200, 0, 0);
  const other = { vehicle: {}, ...caja(-1, -1, 1, 1) };
  game.collisions.dynamicColliders = [other];
  quieto();
  assert.equal(car.position.x, 30);
  game.collisions.dynamicColliders = [];
  quieto();
  assert.deepEqual([car.position.x, car.position.y, car.position.z], [0, 0, 0]);
  assert.equal(car.group.rotation.y, 0);
  assert.equal(car.vehicle.group.rotation.x, -.063);
  assert.equal(car.vehicle.group.position.y, .06);
  assert.equal(carjack._away.length, 0);
  // Sigue siendo suyo: subirse otra vez no es otro robo.
  game.player.position.set(0, 0, 1.5);
  carjack.cooldown = 0;
  carjack.update(1 / 30, fakeInput());
  assert.equal(carjack.prompt, '[Y] Subirme a mi carro');
});

test('el carro dejado a medio metro de su puesto y girado vuelve; dejado justo en su puesto recupera el ladeo y la altura', () => {
  const lejos = (game, carjack) => {
    game.player.position.set(200, 0, 0);
    for (let i = 0; i < 40; i++) carjack.update(1 / 30, fakeInput());
  };
  {
    const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game);
    // Su propia caja, que pisa el puesto, no cuenta como otro carro encima.
    game.collisions.dynamicColliders = [{ vehicle: car, ...caja(-1.6, -1.4, 2.6, 1.4) }];
    subir(carjack, car);
    car.position.set(.5, 0, 0);
    car.group.rotation.y = .6;
    carjack.exit();
    settle(carjack);
    lejos(game, carjack);
    assert.deepEqual([car.position.x, car.position.z, car.group.rotation.y], [0, 0, 0]);
    assert.equal(car.vehicle.group.rotation.x, -.063);
  }
  {
    const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game);
    subir(carjack, car);
    carjack.exit();
    settle(carjack);
    assert.equal(car.vehicle.group.rotation.x, 0, 'al bajarse sigue derecho');
    lejos(game, carjack);
    assert.equal(car.vehicle.group.rotation.x, -.063);
    assert.equal(car.vehicle.group.position.y, .06);
  }
});

test('el carro que se llevó la Policía también vuelve a su puesto', () => {
  const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game);
  subir(carjack, car);
  car.position.set(0, 0, 40);
  carjack.reset({ perdido: true });
  game.player.position.set(-200, 0, 0);
  for (let i = 0; i < 40; i++) carjack.update(1 / 30, fakeInput());
  assert.equal(car.position.z, 0);
});

test('solo se baja a 7,2 km/h o menos', () => {
  const car = fakeCar(), game = fakeGame([car]), said = toasts(), carjack = new CarjackSystem(game);
  subir(carjack, car);
  const y = () => Object.assign(fakeInput(), { consumePress: c => c === CARJACK.key });
  carjack.speed = 2.1;
  assert.equal(carjack.update(1 / 60, y()), true);
  assert.equal(carjack.car, car);
  assert.ok(said.includes('Tengo que frenar antes de bajarme.'));
  carjack.speed = 1.9;
  assert.equal(carjack.update(1 / 60, y()), false);
  assert.equal(carjack.car, null);
});

test('topes: 54 km/h adelante, 18 en reversa', () => {
  const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game);
  subir(carjack, car);
  manejar(carjack, ['KeyW'], 8);
  assert.equal(Math.round(carjack.speed * 3.6), 54);
  manejar(carjack, ['KeyS'], 8);
  assert.equal(Math.round(carjack.speed * 3.6), -18);
});

test('un desnivel de más de 1,2 m frena el carro; uno de 1,1 m se sube', () => {
  for (const [alto, pasa] of [[1.3, false], [1.1, true]]) {
    const car = fakeCar(), game = fakeGame([car], { ground: x => (x > 4 ? alto : 0) }), carjack = new CarjackSystem(game);
    subir(carjack, car);
    manejar(carjack, ['KeyW'], 3);
    assert.equal(car.position.x > 4, pasa, `desnivel de ${alto} m`);
  }
});

test('en reversa la dirección se invierte', () => {
  const giro = speed => {
    const car = fakeCar(), carjack = new CarjackSystem(fakeGame([car]));
    subir(carjack, car);
    carjack.speed = speed;
    manejar(carjack, ['KeyA'], .1);
    return car.group.rotation.y;
  };
  assert.ok(giro(4) > 0, 'adelante, A gira a la izquierda');
  assert.ok(giro(-4) < 0, 'en reversa, A lleva la cola a la izquierda');
});

test('manejando contra otro carro choca y no se mete en él', () => {
  const car = fakeCar(), other = fakeCar(8, 0);
  const game = fakeGame([car, other], { dynamics: [{ vehicle: other, ...caja(5.9, -.9, 10.1, .9) }] });
  const carjack = new CarjackSystem(game);
  subir(carjack, car);
  manejar(carjack, ['KeyW'], 3);
  assert.ok(car.position.x + car.length / 2 <= 5.9 + 1e-6, `el frente queda en ${car.position.x + car.length / 2}`);
  assert.ok(car.position.x > 1, 'avanzó hasta el otro carro');
});

test('se baja primero por la puerta del conductor (izquierda) si los dos lados están libres', () => {
  const car = fakeCar(), carjack = new CarjackSystem(fakeGame([car]));
  subir(carjack, car);
  carjack.exit();
  // Rumbo 0: el frente es +X y la izquierda del conductor es −Z.
  assert.ok(carjack.transition.to.z < -1, `quedó en z ${carjack.transition.to.z}`);
});

test('no ofrece el carro de otro piso (debajo o encima del puente)', () => {
  const car = fakeCar(), game = fakeGame([car]), carjack = new CarjackSystem(game);
  car.position.y = 1.6;
  carjack.update(1 / 30, fakeInput());
  assert.equal(carjack.prompt, null);
  car.position.y = 1.4;
  carjack.update(1 / 30, fakeInput());
  assert.ok(carjack.prompt);
});

test('el carro robado no se cuida por propina, y al soltarlo queda apagado como parqueado', () => {
  const car = fakeCar(), carjack = new CarjackSystem(fakeGame([car])), guarding = new CarGuarding();
  assert.equal(guarding.canGuard(car), true);
  subir(carjack, car);
  carjack.reset();
  assert.equal(car.traffic, false);
  assert.equal(car.driven, false);
  assert.equal(guarding.canGuard(car), false);
});

// --- El juego alrededor ---

function gameFixture() {
  const car = fakeCar(30, 30);
  const player = Object.assign(Object.create(Player.prototype), {
    position: new THREE.Vector3(30, 0, 31.5), root: new THREE.Group(), velocity: new THREE.Vector3(),
    _impactTime: 0, _impactHeavy: false, _impactVelocity: new THREE.Vector3(), melee: { cancel() {} }, animateScripted() {},
    hitLean: { remove() {}, clear() {}, kick() {} }, character: { group: new THREE.Group() },
    ragdoll: { active: false, starts: 0, start() { this.starts++; this.active = true; return true; } }
  });
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), player, input: fakeInput(), _deathPending: false,
    world: { active: { getGroundHeight: () => 0 } },
    cameraRig: { mode: 'third-person', yaw: 0, pitch: .22, distance: 5.5 },
    collisions: { queryStatic: () => [], dynamicColliders: [] },
    cars: [car], traffic: { vehicles: [] }, steal: { buscado: 0 }
  });
  game.carjack = new CarjackSystem(game);
  subir(game.carjack, car);
  return { game, car, player };
}

test('un golpe al volante (camioneta, conductor bravo) no lo baja ni lo tumba: el carro sigue solo y luego vuelve el mando', () => {
  const { game, car, player } = gameFixture();
  game.carjack.speed = 10;
  game.stats.salud = 5;
  player.receiveHit(new THREE.Vector3(1, 0, 0), 4, { salud: 5 });
  assert.equal(player.ragdoll.starts, 0, 'no arranca el cuerpo tirado');
  assert.equal(player.isStunned, true);
  game.input.down.add('KeyW');
  const x0 = car.position.x;
  assert.equal(game._updateCarjack(1 / 30), true, 'sigue manejando aturdido');
  assert.ok(game.carjack.speed < 10, 'sin manos en el volante no acelera');
  assert.ok(car.position.x > x0, 'el carro sigue rodando');
  assert.ok(player.position.distanceTo(car.position) < 1e-9, 'el jugador va dentro del carro');
  for (let i = 0; i < 12; i++) game._updateCarjack(1 / 30);
  assert.equal(player.isStunned, false, 'el aturdimiento pasa al volante');
  const speed = game.carjack.speed;
  game._updateCarjack(1 / 30);
  assert.ok(game.carjack.speed > speed, 'vuelve a acelerar');
  assert.equal(game.carjack.car, car);
});

test('a pie, después de bajarse o de soltar el carro a la fuerza, el golpe con salud baja conserva los pies en el suelo', () => {
  for (const soltar of ['bajarse', 'reset']) {
    const { game, player } = gameFixture();
    if (soltar === 'bajarse') {
      assert.equal(game.carjack.exit(), true);
      for (let i = 0; i < 30; i++) game._updateCarjack(1 / 30);
      assert.equal(game.carjack.transition, null);
    } else game.carjack.reset();
    player.receiveHit(new THREE.Vector3(1, 0, 0), 4, { salud: 5 });
    assert.equal(player.ragdoll.starts, 0, `tras ${soltar} sigue de pie`);
    assert.equal(player.isKnockedDown, false);
  }
});

test('un golpe a mitad de bajarse corta el paso y le devuelve el cuerpo al movimiento a pie', () => {
  const { game, player } = gameFixture();
  game.carjack.exit();
  assert.ok(game.carjack.transition);
  player.receiveHit(new THREE.Vector3(1, 0, 0), 4, { salud: 5 });
  assert.equal(game._updateCarjack(1 / 30), false);
  assert.equal(game.carjack.transition, null);
});

test('un carro del tráfico no atropella al jugador que va al volante', () => {
  const { game } = gameFixture();
  game._onVehicleImpact({ speed: 10, direction: new THREE.Vector3(1, 0, 0) });
  assert.equal(game.stats.salud, 100);
});

test('al volante no quedan avisos de a pie, X no lanza popó y el HUD pinta el aviso de la Y', () => {
  const source = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  const loop = source.slice(source.indexOf('_loop = (stamp) =>'));
  assert.match(loop, /if \(driving\) this\.interaction\.currentTarget = this\.interaction\.currentTargetType = this\.interaction\.stealPrompt = null;/);
  assert.match(loop, /if \(!this\.player\.isStunned && !this\.player\.isSwimming && !driving && this\.input\.consumePress\('KeyX'\)\)/);
  assert.match(loop, /this\.interaction\.carjackPrompt = driving \? null : this\.carjack\?\.prompt \?\? null;/);
  const hud = readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
  assert.match(hud, /const texto = \[textoDelPrompt\(interaction, inventory\), interaction\?\.carjackPrompt\]\.filter\(Boolean\)\.join\(' · '\);\s*this\._pintarPrompt\(texto, interaction, interaction\?\.rebusquePrompt \?\? ''\);/);
});
