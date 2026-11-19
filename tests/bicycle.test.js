// tests/bicycle.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Bicycle } from '../src/entities/Bicycle.js';
import { BikeFence, STOLEN_BIKE_PRICE } from '../src/entities/BikeFence.js';
import { Player } from '../src/entities/Player.js';
import { textoDelPrompt } from '../src/ui/HUD.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

function tireGap(tire, groundHeight, level) {
  tire.updateWorldMatrix(true, false);
  const point = new THREE.Vector3(), tread = tire.geometry.attributes.position;
  let gap = Infinity;
  for (let i = 0; i < tread.count; i++) {
    point.fromBufferAttribute(tread, i).applyMatrix4(tire.matrixWorld);
    gap = Math.min(gap, point.y - groundHeight(point.x, point.z, level));
  }
  return gap;
}

test('Bicycle se construye con geometría de cuadro, ruedas, manubrio, sillín y candado', () => {
  const scene = new THREE.Scene();
  const bike = new Bicycle(scene, new THREE.Vector3(10, 0, 10), 0, { locked: true });

  assert.equal(bike.kind, 'bicycle');
  assert.equal(bike.isLocked, true);
  assert.equal(bike.stolen, false);
  assert.equal(bike.isRidden, false);
  assert.ok(bike.group.children.length > 0);
  assert.ok(bike.rearWheelGroup);
  assert.ok(bike.frontWheelGroup);
  assert.ok(bike.steerGroup);
  assert.ok(bike.crankGroup);
  assert.ok(bike.kickstand);
  assert.equal(bike.lockGroup.visible, true);

  bike.dispose();
});

test('Robar bicicleta: desbloquea candado, marca como robada y monta al jugador', () => {
  const scene = new THREE.Scene();
  const bike = new Bicycle(scene, new THREE.Vector3(10, 0, 10), 0, { locked: true });
  const player = {
    position: new THREE.Vector3(10, 0, 10),
    ridingBike: null,
    root: new THREE.Group()
  };
  const game = {
    steal: { buscado: 0 },
    audio: { play() {} }
  };

  const ok = bike.steal(player, game);
  assert.equal(ok, true);
  assert.equal(bike.isLocked, false);
  assert.equal(bike.stolen, true);
  assert.equal(bike.isRidden, true);
  assert.equal(player.ridingBike, bike);
  assert.equal(bike.lockGroup.visible, false);
  assert.equal(game.steal.buscado, 1, 'sube el nivel de búsqueda policial');

  bike.dispose();
});

test('Montar y desmontar bicicleta actualiza estados y apoyos', () => {
  const scene = new THREE.Scene();
  const bike = new Bicycle(scene, new THREE.Vector3(15, 0, 15), 0, { locked: false });
  const player = {
    position: new THREE.Vector3(15, 0, 15),
    ridingBike: null,
    root: new THREE.Group()
  };

  // Montar
  assert.equal(bike.mount(player), true);
  assert.equal(bike.isRidden, true);
  assert.equal(player.ridingBike, bike);
  assert.equal(bike.rider, player);

  // Desmontar
  assert.equal(bike.dismount(), true);
  assert.equal(bike.isRidden, false);
  assert.equal(player.ridingBike, null);
  assert.equal(bike.rider, null);

  bike.dispose();
});

test('la cota del andén queda en la posición de la bici después de actualizarla', () => {
  const groundHeight = () => .12;
  const bike = new Bicycle(new THREE.Scene(), new THREE.Vector3(10, 0, 10), .86, { groundHeight });
  for (let i = 0; i < 6; i++) bike.update(1 / 60);
  assert.equal(bike.position.y, .12);
  assert.equal(bike.group.position.y, bike.position.y);
  for (const tire of [bike.frontTire, bike.rearTire]) assert.ok(Math.abs(tireGap(tire, groundHeight, .12)) < .002);
  bike.dispose();
});

test('al desmontar en pendiente conserva la capa del ciclista y apoya ambas llantas', () => {
  const groundHeight = (x, z, level) => (level > 1.5 ? 2.8 : .12) + z * .07;
  const bike = new Bicycle(new THREE.Scene(), new THREE.Vector3(), 0, { groundHeight, locked: false });
  for (const level of [0, 3]) {
    const y = groundHeight(2, 5, level);
    const player = { position: new THREE.Vector3(2, y + 1.3, 5), groundSurface: { height: y }, root: new THREE.Group() };
    player.root.rotation.y = .44;
    bike.mount(player);
    bike.update(.03, player);
    bike.dismount();
    bike.update(.03);
    assert.equal(bike.position.y, y);
    assert.equal(bike.group.rotation.y, .44);
    assert.ok(Math.abs(bike.bikeBody.rotation.x) > .02);
    for (const tire of [bike.frontTire, bike.rearTire]) assert.ok(Math.abs(tireGap(tire, groundHeight, y)) < .002);
  }
  bike.dispose();
});

test('una llanta en la calzada y otra en el andén quedan sobre sus propias cotas', () => {
  const groundHeight = (x, z) => z > 0 ? .12 : 0;
  const bike = new Bicycle(new THREE.Scene(), new THREE.Vector3(), 0, { groundHeight });
  assert.ok(bike.bikeBody.rotation.x < -.1);
  for (const tire of [bike.frontTire, bike.rearTire]) assert.ok(Math.abs(tireGap(tire, groundHeight, 0)) < .002);
  bike.dispose();
});

test('al rodar ambos neumáticos cruzan el bordillo sin forzar la trayectoria del jugador', () => {
  const groundHeight = (x, z) => z >= 0 ? .12 : .06;
  const bike = new Bicycle(new THREE.Scene(), new THREE.Vector3(0, .06, -1), 0, { groundHeight, locked: false });
  const player = { position: new THREE.Vector3(), root: new THREE.Group(), speed: 8.5, isGrounded: true };
  bike.mount(player);
  for (const direction of [1, -1]) {
    player.root.rotation.y = direction > 0 ? 0 : Math.PI;
    let pitched = false;
    for (let frame = -9; frame <= 9; frame++) {
      const z = frame * .1 * direction, y = groundHeight(0, z);
      player.position.set(0, y, z);
      bike.update(1 / 60, player);
      assert.deepEqual(bike.group.position, player.position);
      for (const tire of [bike.frontTire, bike.rearTire]) assert.ok(tireGap(tire, groundHeight, y) > -.005);
      pitched ||= bike.bikeBody.rotation.x * direction < -.03;
    }
    assert.ok(pitched, 'las dos ruedas siguen sus cotas de apoyo al subir y bajar');
  }
  player.isGrounded = false;
  player.position.y = .5;
  bike.update(1 / 60, player);
  assert.equal(bike.bikeBody.rotation.x, 0);
  assert.equal(bike.bikeBody.position.y, .024);
  assert.equal(bike.group.position.y, .5);
  bike.dismount();
  bike.dispose();
});

test('cada rueda vuelve a su punto de partida al recorrer la circunferencia del neumático', () => {
  const bike = new Bicycle(new THREE.Scene(), new THREE.Vector3(), 0, { locked: false });
  const player = { position: new THREE.Vector3(), root: new THREE.Group() };
  const { radius, tube } = bike.frontTire.geometry.parameters;
  const rollingRadius = radius + tube;
  const dt = 1 / 60;
  bike.mount(player);

  let chainSounds = 0;
  const audio = { play(key) { if (key === 'step') chainSounds++; } };
  for (const [speed, expectedRPM] of [[8.5, 82], [13.5, 130]]) {
    player.speed = speed;
    const startZ = player.position.z, wheelStart = bike.wheelRotation, pedalStart = bike.pedalRotation;
    for (let i = 0; i < 60; i++) {
      player.position.z += speed * dt;
      bike.update(dt, player, audio);
    }
    const distance = bike.position.z - startZ;
    const rotations = bike.wheelRotation - wheelStart;
    const rpm = 60 * (bike.pedalRotation - pedalStart) / (Math.PI * 2);
    assert.ok(Math.abs(distance - rotations * rollingRadius) < 1e-9);
    assert.equal(bike.frontWheelGroup.rotation.x, bike.rearWheelGroup.rotation.x);
    assert.ok(Math.abs(rpm - expectedRPM) < .5);
  }
  assert.ok(bike.pedals.every(pedal => pedal.rotation.x === -bike.crankGroup.rotation.x));
  assert.equal(chainSounds, 8);
  bike.dispose();
});

test('el cuadro y la horquilla acotan el giro visual a ambos lados y vuelven al centro', () => {
  const bike = new Bicycle(new THREE.Scene(), new THREE.Vector3(), 0, { locked: false });
  const player = { position: new THREE.Vector3(), speed: 6, movement: { turnRate: 22 }, root: new THREE.Group() };
  bike.mount(player);
  for (const side of [-1, 1]) {
    player.root.rotation.y = side * Math.PI / 2;
    player.movement.turnRate = side * 22;
    for (let i = 0; i < 25; i++) bike.update(1 / 60, player);
    assert.equal(bike.group.rotation.y, player.root.rotation.y);
    assert.ok(-bike.bikeBody.rotation.z * side > .20);
    assert.ok(Math.abs(bike.bikeBody.rotation.z) <= .22);
    assert.ok(-bike.steerGroup.rotation.y * side > .5);
    assert.ok(Math.abs(bike.steerGroup.rotation.y) <= .55);
  }
  player.speed = 0;
  const lastLean = Math.abs(bike.bikeBody.rotation.z);
  bike.update(1 / 60, player);
  assert.ok(Math.abs(bike.bikeBody.rotation.z) < lastLean);
  assert.ok(Math.abs(bike.bikeBody.rotation.z) > 0);
  for (let i = 0; i < 45; i++) bike.update(1 / 60, player);
  assert.ok(Math.abs(bike.bikeBody.rotation.z) < .001);
  assert.ok(Math.abs(bike.steerGroup.rotation.y) < .001);
  bike.dispose();
});

test('la tija baja con el ciclista dentro de su recorrido y regresa al aparcar', () => {
  const bike = new Bicycle(new THREE.Scene(), new THREE.Vector3(), 0, { locked: false });
  const parkedSaddle = bike.saddle.position.clone();
  const parkedPost = bike._seatPost.position.clone();
  const parkedPostDirection = bike._seatPost.quaternion.clone();
  const rider = { position: new THREE.Vector3(), root: new THREE.Group() };
  assert.equal(bike.setSaddleDrop(.08), 0);
  bike.mount(rider);
  assert.equal(bike.setSaddleDrop(.08), .08);
  assert.ok(Math.abs(bike.saddle.position.y - (parkedSaddle.y - .08)) < 1e-9);
  assert.ok(bike._seatPost.scale.y < 1);
  assert.equal(bike.setSaddleDrop(.2), .10);
  bike.dismount();
  assert.deepEqual(bike.saddle.position, parkedSaddle);
  assert.ok(bike._seatPost.position.distanceTo(parkedPost) < 1e-9);
  assert.ok(bike._seatPost.quaternion.angleTo(parkedPostDirection) < 1e-7);
  assert.equal(bike._seatPost.scale.y, 1);
  bike.dispose();
});

test('Espacio en bicicleta no salta ni deja un salto pendiente al desmontar', () => {
  const scene = new THREE.Scene();
  const presses = new Set(['Space']);
  const input = {
    axis: { x: 0, z: 0 }, isRunning: false,
    consumePress: key => presses.delete(key), isDown: () => false
  };
  const player = new Player(scene, input);
  const bike = new Bicycle(scene, new THREE.Vector3(), 0, { locked: false });
  bike.mount(player);
  const step = () => player.update(1 / 60, null, null, () => 0);
  step();
  assert.equal(player.ridingBike, bike);
  assert.ok(player.isGrounded && player.jumpVelocity === 0, 'sigue en el suelo al pedalear');
  bike.dismount();
  step();
  assert.ok(player.isGrounded && player.jumpVelocity === 0, 'desmonta sin despegar');
  presses.add('Space');
  step();
  assert.ok(!player.isGrounded && player.jumpVelocity > 0, 'una nueva pulsación a pie sí salta');
  player.dispose();
  bike.dispose();
});

test('Player al montar bicicleta tiene velocidad de ciclista y se cae con impacto', () => {
  const scene = new THREE.Scene();
  const player = new Player(scene, new THREE.Vector3(0, 0, 0));
  const bike = new Bicycle(scene, new THREE.Vector3(0, 0, 0), 0, { locked: false });

  bike.mount(player);
  assert.equal(player.ridingBike, bike);

  // Al recibir impacto de vehículo, se desmonta automáticamente y el ragdoll toma el control
  player.receiveVehicleImpact(new THREE.Vector3(1, 0, 0), 10, { collisions: null });
  assert.equal(player.ridingBike, null, 'se cae de la bicicleta al ser atropellado');
  assert.equal(bike.isRidden, false);

  player.dispose();
  bike.dispose();
});

test('textoDelPrompt para bicicleta y puesto de compras de bicicletas', () => {
  const bikeLocked = { kind: 'bicycle', isLocked: true, isRidden: false };
  const bikeUnlocked = { kind: 'bicycle', isLocked: false, isRidden: false };

  assert.equal(textoDelPrompt({ currentTarget: bikeLocked, currentTargetType: 'bicycle' }), '[E] Robar bicicleta');
  assert.equal(textoDelPrompt({ currentTarget: bikeUnlocked, currentTargetType: 'bicycle' }), '[E] Montar bicicleta');

  const playerRiding = { ridingBike: {} };
  assert.equal(
    textoDelPrompt({ player: playerRiding }),
    '[E] Bajarse de la bicicleta · [Shift] Pedalear rápido'
  );
});

test('BikeFence: compra bicicletas robadas y paga en efectivo', () => {
  const scene = new THREE.Scene();
  const fence = new BikeFence(scene, new THREE.Vector3(20, 0, 20));
  const bike = new Bicycle(scene, new THREE.Vector3(21, 0, 20), 0, { locked: false, stolen: true });

  const game = {
    stats: { dinero: 5000 },
    bicycles: [bike],
    player: { position: new THREE.Vector3(21, 0, 20), ridingBike: null },
    audio: { play() {} },
    interaction: { unregister() {} },
    _save() {}
  };

  // 1. Detecta la bicicleta robada cercana
  const nearby = fence.getNearbyBike(game);
  assert.equal(nearby, bike);

  // 2. Vende la bicicleta y recibe el dinero
  const ok = fence.sellStolenBike(game);
  assert.equal(ok, true);
  assert.equal(game.stats.dinero, 5000 + STOLEN_BIKE_PRICE);
  assert.equal(game.bicycles.length, 0, 'la bicicleta vendida se retira del mundo');

  fence.dispose();
});

test('BikeFence: no compra bicicletas que no sean robadas', () => {
  const scene = new THREE.Scene();
  const fence = new BikeFence(scene, new THREE.Vector3(20, 0, 20));
  const bike = new Bicycle(scene, new THREE.Vector3(21, 0, 20), 0, { locked: false, stolen: false });

  const game = {
    stats: { dinero: 5000 },
    bicycles: [bike],
    player: { position: new THREE.Vector3(21, 0, 20), ridingBike: null },
    audio: { play() {} }
  };

  const ok = fence.sellStolenBike(game);
  assert.equal(ok, false);
  assert.equal(game.stats.dinero, 5000, 'el dinero no cambia');
  assert.equal(game.bicycles.length, 1);

  bike.dispose();
  fence.dispose();
});
