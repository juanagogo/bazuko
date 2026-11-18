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

test('Cinemática de bicicleta: giro de ruedas y pedales proporcional a la velocidad', () => {
  const scene = new THREE.Scene();
  const bike = new Bicycle(scene, new THREE.Vector3(0, 0, 0), 0, { locked: false });
  const player = {
    position: new THREE.Vector3(0, 0, 5),
    speed: 8.0,
    movement: { turnRate: 0.5 },
    root: new THREE.Group()
  };

  bike.mount(player);
  const prevWheelRot = bike.wheelRotation;
  const prevPedalRot = bike.pedalRotation;

  bike.update(0.1, player, { play() {} });

  assert.ok(bike.wheelRotation > prevWheelRot, 'la rueda delantera y trasera giran al avanzar');
  assert.ok(bike.pedalRotation > prevPedalRot, 'los pedales giran con la tracción');
  assert.equal(bike.position.z, 5);

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

test('montado en la bicicleta Espacio no salta', () => {
  const scene = new THREE.Scene();
  const input = { axis: { x: 0, z: 0 }, isRunning: false, presses: new Set(['Space']), consumePress(key) { return this.presses.delete(key); }, isDown: () => false };
  const player = new Player(scene, input);
  const bike = new Bicycle(scene, new THREE.Vector3(0, 0, 0), 0, { locked: false });
  bike.mount(player);
  player.update(1 / 60, null, null, () => 0);
  assert.equal(player.ridingBike, bike);
  assert.equal(player.isGrounded, true, 'sigue en el piso');
  assert.ok(!(player.jumpVelocity > 0), 'sin impulso de salto');

  player.dispose();
  bike.dispose();
});
