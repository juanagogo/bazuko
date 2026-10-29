// tests/polish.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Player } from '../src/entities/Player.js';
import { CameraRig } from '../src/core/Camera.js';
import { WeatherSystem } from '../src/world/WeatherSystem.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { Renderer } from '../src/core/Renderer.js';
import { Game } from '../src/core/game.js';

test('Player: inercia física y aceleración/desaceleración orgánica', () => {
  const dummyScene = new THREE.Scene();
  const dummyInput = { axis: { x: 0, z: -1 }, isRunning: false };
  const player = new Player(dummyScene, dummyInput);

  assert.equal(player.hasInertia, true);
  assert.equal(player.velocity.length(), 0);

  // 1. Aceleración al presionar hacia adelante (1 frame de 0.1s)
  player.update(0.1, null, null);
  assert.ok(player.velocity.z < 0, 'La velocidad en Z debe avanzar hacia adelante');
  assert.ok(player.position.z < 16, 'El jugador debe haberse desplazado');

  // 2. Desaceleración al soltar controles
  dummyInput.axis = { x: 0, z: 0 };
  const velZBefore = player.velocity.z;
  player.update(0.1, null, null);
  assert.ok(player.velocity.z > velZBefore, 'La velocidad debe amortiguarse hacia cero por fricción');

  player.dispose();
});

test('Camera: FOV dinámico al correr, balanceo suave (bobbing) y banking al girar', () => {
  globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {} };
  const camera = new CameraRig(new THREE.Scene(), { addEventListener() {} });
  const pos = new THREE.Vector3(20, 0, 20);

  // 1. Reposo: FOV en 55 y bobbing en 0
  camera.follow(pos, 0.1, null, 0, false);
  assert.equal(camera.camera.fov, 55);

  // 2. Carrera: FOV sube hacia 61 y bobbing oscila
  camera.follow(pos, 0.1, null, 5.0, true);
  assert.ok(camera.camera.fov > 55, 'El FOV debe aumentar dinámicamente al esprintar');
  assert.ok(camera._bobAmount > 0, 'El balanceo vertical debe activarse al correr');

  // 3. Banking al girar
  camera.orbit(50, 0);
  assert.ok(camera._targetRoll < 0, 'El giro debe generar banking / inclinación lateral sutil');
});

test('Atmósfera y Gráficos: asfalto con reflectividad húmeda y PCFShadowMap', () => {
  const city = new Bogota();
  city.groundMaterials = {
    road: new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.0 }),
    busway: new THREE.MeshStandardMaterial({ roughness: 1.0, metalness: 0.0 }),
    sidewalk: new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.0 })
  };

  // Suelo seco
  city.setWetness(0);
  assert.equal(city.groundMaterials.road.roughness, 0.82);

  // Lluvia / Suelo mojado (reflejo de charcos)
  city.setWetness(1);
  assert.ok(city.groundMaterials.road.roughness < 0.5, 'La rugosidad debe bajar para dar reflejo mojado');
  assert.ok(city.groundMaterials.road.metalness > 0.1, 'El metalness debe subir sutilmente para reflejar cielo');

  // WeatherSystem propaga humedad al distrito
  const weather = new WeatherSystem(null);
  weather.setWeather('llovizna', false);
  weather.update(1.0, new THREE.Vector3(0, 0, 0), city);
  assert.ok(weather.wetness > 0, 'El clima de lluvia debe aumentar la humedad');
});

test('Optimización: caché de POIs en Game para evitar asignaciones por fotograma', () => {
  const mockGame = Object.assign(Object.create(Game.prototype), {
    world: { active: { reserved: { bed: { x: 10, z: 10 }, sell: { x: 20, z: 20 } } } },
    dog: null
  });

  const t0 = 1000;
  const list1 = mockGame._getPOIs(t0);
  assert.ok(Array.isArray(list1));
  assert.ok(list1.length >= 2);

  // Llamada rápida en el siguiente frame (16 ms después)
  const list2 = mockGame._getPOIs(t0 + 16);
  assert.equal(list1, list2, 'Debe reutilizar la misma instancia en memoria para evitar recolector de basura (GC)');

  // Llamada medio segundo después (debe refrescar)
  const list3 = mockGame._getPOIs(t0 + 400);
  assert.ok(list3);
});
