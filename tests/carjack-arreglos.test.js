// Robo de carros: volver al propio carro, el lago, la salida junto a otro carro y la cámara.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CarjackSystem, CARJACK } from '../src/systems/CarjackSystem.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

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

function fakeGame(cars = []) {
  let xp = 0;
  return {
    cars, traffic: { vehicles: [] },
    player: { position: new THREE.Vector3(0, 0, 1.5), root: new THREE.Group(), velocity: new THREE.Vector3() },
    cameraRig: { mode: 'third-person', yaw: 0, pitch: .22, distance: 5.5 },
    collisions: { queryStatic: () => [], dynamicColliders: [] },
    world: { active: { npcs: [], getGroundHeight: () => 0 } },
    steal: { buscado: 0 }, stats: { salud: 100, addXP(n) { xp += n; } },
    get xp() { return xp; }
  };
}

test('volver a subirse al propio carro no es otro robo: sin alarma, fichado ni experiencia', async () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  const events = [];
  window.addEventListener('toast', e => events.push(['toast', e.detail]));
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
  const { CarGuarding } = await import('../src/systems/CarGuarding.js');
  assert.equal(new CarGuarding().canGuard(car), false, 'el carro robado no se cuida por propina');
  assert.equal(events.filter(([n, d]) => n === 'toast' && /Forcé/.test(d.text)).length, 1, 'solo el primer robo fuerza la puerta');
});

test('si lo coge la Policía manejándolo, el carro ya no es suyo: volver a subirse es otro robo', () => {
  const car = fakeCar(), game = fakeGame([car]), input = fakeInput();
  const carjack = new CarjackSystem(game);
  carjack.enter({ car });
  settle(carjack);
  // Game._policeArrest
  carjack.reset({ perdido: true });
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
  // El arresto se lo quita (Game._policeArrest).
  const loop = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(loop, /_policeArrest\(\) \{[^]*?this\.carjack\?\.reset\(\{ perdido: true \}\)/);
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
    carjack.enter({ car });
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
  carjack.enter({ car: stolen });
  settle(carjack);
  carjack.exit();
  settle(carjack);
  const p = game.player.position, box = collisions.dynamicColliders.find(e => e.vehicle === parked).box;
  assert.ok(p.z > 0, `salió por la derecha (z ${p.z.toFixed(2)})`);
  assert.ok(!(p.x + .4 > box.min.x && p.x - .4 < box.max.x && p.z + .4 > box.min.z && p.z - .4 < box.max.z));
});

test('la rueda del ratón durante el regreso de la cámara no se pierde', () => {
  const car = fakeCar(0, 0), game = fakeGame([car]);
  const carjack = new CarjackSystem(game);
  carjack.enter({ car });
  settle(carjack);
  carjack.exit();
  carjack.update(1 / 30, fakeInput());
  game.cameraRig.distance = 4; // zoom del jugador
  for (let i = 0; i < 40; i++) carjack.update(1 / 30, fakeInput());
  assert.equal(game.cameraRig.distance, 4);
});

test('al que va dentro del carro robado la patrulla lo ve por los vidrios; al que está detrás del carro, no', async () => {
  const { hasClearCombatLine } = await import('../src/systems/CombatGeometry.js');
  const collisions = new CollisionSystem();
  const stolen = fakeCar(10, 0);
  stolen.driven = true;
  collisions.setVehicles([stolen]);
  const patrol = new THREE.Vector3(0, 0, 0);
  assert.equal(hasClearCombatLine({ from: patrol, to: stolen.position.clone(), collisions }), true, 'el que maneja');
  assert.equal(hasClearCombatLine({ from: patrol, to: new THREE.Vector3(14, 0, 0), collisions }), false, 'el que se esconde detrás');
  stolen.driven = false;
  assert.equal(hasClearCombatLine({ from: patrol, to: stolen.position.clone(), collisions }), false, 'un carro parqueado sigue tapando');
});

test('al volante las flechas mueven solo la cámara: ni aceleran ni giran el carro, y la cámara no se devuelve mientras mira', () => {
  const car = fakeCar(0, 0), game = fakeGame([car]);
  const carjack = new CarjackSystem(game);
  carjack.enter({ car });
  settle(carjack);
  const input = fakeInput();
  input.down.add('ArrowUp'); input.down.add('ArrowLeft');
  game.cameraRig.yaw = 1; // la cámara ya giró con las flechas
  for (let i = 0; i < 60; i++) carjack.update(1 / 30, input);
  assert.equal(carjack.speed, 0, 'la flecha de arriba no acelera');
  assert.equal(car.group.rotation.y, 0, 'la flecha izquierda no gira');
  assert.equal(car.position.x, 0);
  assert.equal(game.cameraRig.yaw, 1, 'mientras mira con las flechas, la cámara se queda donde la puso');
  // Con W, A, S, D sí maneja, y al soltar las flechas la cámara vuelve detrás del carro.
  const drive = fakeInput();
  drive.down.add('KeyW'); drive.down.add('KeyA');
  for (let i = 0; i < 30; i++) carjack.update(1 / 30, drive);
  assert.ok(carjack.speed > 3 && car.group.rotation.y > 0);
  drive.down.delete('KeyA');
  for (let i = 0; i < 60; i++) carjack.update(1 / 30, drive);
  assert.ok(Math.abs(game.cameraRig.yaw - (car.group.rotation.y - Math.PI / 2)) < .5, `la cámara volvió detrás (${game.cameraRig.yaw.toFixed(2)})`);
});

test('un carro que quedó encajado contra un muro sale en reversa, pero no se mete más en él', () => {
  // Muro de 8 m de alto que empieza a 1 m del centro del carro: el frente (2,1 m) queda 1,1 m adentro.
  const wall = { box: new THREE.Box3(new THREE.Vector3(1, 0, -5), new THREE.Vector3(6, 8, 5)) };
  const car = fakeCar(0, 0), game = fakeGame([car]);
  game.collisions = { queryStatic: () => [wall], dynamicColliders: [] };
  const carjack = new CarjackSystem(game);
  carjack.enter({ car });
  settle(carjack);
  const forward = fakeInput();
  forward.down.add('KeyW');
  for (let i = 0; i < 60; i++) carjack.update(1 / 30, forward);
  assert.ok(car.position.x <= 1e-9, `no avanzó hacia el muro (x ${car.position.x.toFixed(2)})`);
  const back = fakeInput();
  back.down.add('KeyS');
  for (let i = 0; i < 60; i++) carjack.update(1 / 30, back);
  assert.ok(car.position.x < -1.5, `salió en reversa (x ${car.position.x.toFixed(2)})`);
  assert.equal(carjack._bodyOverlap(car.position.x, car.position.z, 0, 0), 0, 'ya no está encajado');
});
