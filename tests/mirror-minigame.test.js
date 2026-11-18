// tests/mirror-minigame.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { MIRROR_RETRY_SECONDS, StealSystem } from '../src/features/steal.js';
import { Car } from '../src/entities/Car.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

function fakeCar(options = {}) {
  const scene = new THREE.Scene();
  return new Car(scene, new THREE.Vector3(0, 0, 0), 0, { kind: 'carro', variant: 1, ...options });
}

test('startMirrorTheft inicia el minijuego de retrovisores en dos pasos', () => {
  const car = fakeCar();
  const game = {
    player: { position: new THREE.Vector3(0, 0, 1.2) },
    stats: { dinero: 0 },
    inventory: { add: () => true },
    interaction: { _executeCarTheft: () => {} },
    paused: false
  };

  const steal = new StealSystem(game);
  steal.startMirrorTheft(car);

  assert.equal(steal.minigameActive, true);
  assert.equal(steal.theftType, 'mirror');
  assert.equal(steal.targetCar, car);
  assert.equal(steal.mirrorStep, 1);
  assert.ok(steal.zoneSize > 0);

  car.dispose();
});

test('Paso 1 exitoso afloja el soporte y avanza al Paso 2', () => {
  const car = fakeCar();
  let completed = false;
  const game = {
    player: { position: new THREE.Vector3(0, 0, 1.2) },
    stats: { dinero: 0 },
    inventory: { add: () => true },
    interaction: { _executeCarTheft: () => { completed = true; } },
    audio: { play: () => {} },
    paused: false
  };

  const steal = new StealSystem(game);
  steal.startMirrorTheft(car);

  // Acierto en la zona en paso 1
  steal.markerPos = steal.zoneStart + steal.zoneSize / 2;
  steal._handleMirrorKey(true);

  assert.equal(steal.minigameActive, true, 'Sigue activo para el paso 2');
  assert.equal(steal.mirrorStep, 2, 'Avanzó al paso 2');
  assert.equal(completed, false, 'Aún no se arranca');

  // Acierto en paso 2
  steal.markerPos = steal.zoneStart + steal.zoneSize / 2;
  steal._handleMirrorKey(true);

  assert.equal(steal.minigameActive, false, 'Minijuego terminado');
  assert.equal(completed, true, 'Retrovisor arrancado exitosamente');

  car.dispose();
});

test('Dos fallos disparan la alarma del carro y alertan a la policía', () => {
  const car = fakeCar();
  let alarmPlayed = false;
  let policeAlerted = false;
  const game = {
    player: { position: new THREE.Vector3(0, 0, 1.2) },
    stats: { dinero: 0 },
    audio: { playCarAlarm: () => { alarmPlayed = true; }, play: () => {} },
    traffic: { alertForTheft: () => { policeAlerted = true; return true; } },
    paused: false
  };

  const steal = new StealSystem(game);
  steal.startMirrorTheft(car);

  // Fallo 1
  steal.markerPos = 0;
  steal.zoneStart = 0.5;
  steal._handleMirrorKey(false);
  assert.equal(steal.minigameActive, true);
  assert.equal(steal.mirrorMisses, 1);

  // Fallo 2
  steal._handleMirrorKey(false);
  assert.equal(steal.minigameActive, false);
  assert.equal(alarmPlayed, true, 'Sonó la alarma');
  assert.equal(policeAlerted, true, 'Policía alertada');

  car.dispose();
});

test('Alejarse del carro cancela el minijuego de retrovisor', () => {
  const car = fakeCar();
  const playerPos = new THREE.Vector3(0, 0, 1.2);
  const game = {
    player: { position: playerPos },
    paused: false
  };

  const steal = new StealSystem(game);
  steal.startMirrorTheft(car);
  assert.equal(steal.minigameActive, true);

  // El jugador corre lejos
  playerPos.set(10, 0, 10);
  steal._updateMinigame(0.1);

  assert.equal(steal.minigameActive, false, 'Cancelado por distancia');
  assert.equal(car.used, false, 'No se robó el retrovisor');

  car.dispose();
});

test('Fallar dos veces deja el carro sin poder intentarse enseguida', () => {
  const car = fakeCar();
  const game = { player: { position: new THREE.Vector3(0, 0, 1.2) }, paused: false };
  const steal = new StealSystem(game);
  steal.startMirrorTheft(car);
  steal._handleMirrorKey(false);
  steal._handleMirrorKey(false);

  assert.equal(steal.minigameActive, false);
  assert.equal(car.stealable, false, 'ya lo vieron: no hay segundo intento inmediato');
  assert.equal(car.used, false, 'no se robó nada');
  steal.startMirrorTheft(car);
  assert.equal(steal.minigameActive, false, 'E sobre ese carro no abre otra barra');

  car.update(MIRROR_RETRY_SECONDS + 1);
  assert.equal(car.stealable, true, 'pasado el rato se puede volver a intentar');
  car.dispose();
});

test('Junto a un carro al que se le limpia el vidrio, la Q no es del robo directo', () => {
  const car = fakeCar({ traffic: true });
  const game = { player: { position: new THREE.Vector3(0, 0, 1.2) }, paused: false,
    interaction: { currentTargetType: 'car', currentTarget: car } };
  const steal = new StealSystem(game);
  assert.equal(steal._qOcupada(), true);
  game.interaction.currentTarget = fakeCar({ traffic: false });
  assert.equal(steal._qOcupada(), false, 'un parqueado no ocupa la Q');
  game.interaction.currentTargetType = 'pickup';
  assert.equal(steal._qOcupada(), true);
  car.dispose();
});
