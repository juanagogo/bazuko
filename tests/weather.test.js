import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { WeatherSystem, RAIN_ENABLED } from '../src/world/WeatherSystem.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('WeatherSystem alterna el clima y actualiza visibilidad de partículas de lluvia', () => {
  const scene = new THREE.Scene();
  const weather = new WeatherSystem(scene);
  weather.rainEnabled = true;

  assert.equal(weather.weather, 'nublado');
  assert.equal(weather.isRaining, false);
  assert.equal(weather.rainParticles.visible, false);

  weather.setWeather('llovizna', false);
  assert.equal(weather.weather, 'llovizna');
  assert.equal(weather.isRaining, true);
  assert.equal(weather.rainParticles.visible, true);
  assert.ok(weather.rainParticles.material.opacity > 0);

  weather.setWeather('nublado', false);
  assert.equal(weather.weather, 'nublado');
  assert.equal(weather.isRaining, false);
  assert.equal(weather.rainParticles.visible, false);

  weather.dispose();
  assert.equal(scene.children.length, 0);
});

test('WeatherSystem acompaña al jugador y cicla las gotas en update', () => {
  const scene = new THREE.Scene();
  const weather = new WeatherSystem(scene);
  weather.rainEnabled = true;
  weather.setWeather('llovizna', false);

  const playerPos = new THREE.Vector3(40, 0, 75);
  weather.update(0.1, playerPos);

  assert.equal(weather.rainParticles.position.x, 40);
  assert.equal(weather.rainParticles.position.z, 75);

  weather.dispose();
});

test('con la lluvia desactivada no llueve al iniciar ni en el ciclo automático', () => {
  const weather = new WeatherSystem(new THREE.Scene());
  assert.equal(RAIN_ENABLED, false);
  assert.equal(weather.rainEnabled, false);
  weather.setWeather('llovizna', false);
  weather.nextChange = 0;
  weather.update(1, new THREE.Vector3());
  // El ciclo de climas puede pasar a otro tiempo seco (parcial, soleado…), nunca a uno lluvioso.
  assert.notEqual(weather.weather, 'llovizna');
  assert.equal(weather.isRaining, false);
  assert.equal(weather.rainParticles.visible, false);
  assert.equal(weather.wetness, 0);
});
