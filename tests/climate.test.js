import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import {
  DAYS_PER_SEASON, SEASONS, WEATHER_TYPES, seasonForDay, pickNextWeather,
  sunDirection, moonDirection, moonPhase, moonIllumination
} from '../src/world/Climate.js';
import { WeatherSystem } from '../src/world/WeatherSystem.js';
import { SceneManager } from '../src/core/Scene.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('las temporadas de Bogotá rotan cada DAYS_PER_SEASON días', () => {
  assert.equal(seasonForDay(1).id, 'seca');
  assert.equal(seasonForDay(DAYS_PER_SEASON).id, 'seca');
  assert.equal(seasonForDay(DAYS_PER_SEASON + 1).id, 'lluvias1');
  assert.equal(seasonForDay(2 * DAYS_PER_SEASON + 1).id, 'veranillo');
  assert.equal(seasonForDay(3 * DAYS_PER_SEASON + 1).id, 'lluvias2');
  assert.equal(seasonForDay(4 * DAYS_PER_SEASON + 1).id, 'seca');
});

test('el siguiente estado no salta del sol a la tormenta y la neblina es matinal', () => {
  for (const season of SEASONS) {
    for (let i = 0; i < 200; i++) {
      const roll = (i + .5) / 200;
      const fromSun = pickNextWeather('soleado', season, 14, () => roll);
      assert.ok(WEATHER_TYPES[fromSun].level <= 2, `${season.id}: ${fromSun}`);
      assert.notEqual(fromSun, 'niebla');
      assert.notEqual(pickNextWeather('tormenta', season, 12, () => roll), 'tormenta');
    }
  }
  const morning = new Set();
  for (let i = 0; i < 200; i++) morning.add(pickNextWeather('nublado', SEASONS[0], 6, () => (i + .5) / 200));
  assert.ok(morning.has('niebla'));
});

test('las temporadas de lluvias traen más aguaceros que la seca', () => {
  const rainy = season => {
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      if (WEATHER_TYPES[pickNextWeather('nublado', season, 15, () => (i + .5) / 1000)].rain > 0) count++;
    }
    return count;
  };
  assert.ok(rainy(SEASONS[1]) > rainy(SEASONS[0]));
  assert.ok(rainy(SEASONS[3]) > rainy(SEASONS[2]));
});

test('el sol sale por los cerros (−X), pasa alto al mediodía y se oculta de noche', () => {
  const dawn = sunDirection(7), noon = sunDirection(12), dusk = sunDirection(17), midnight = sunDirection(0);
  assert.ok(dawn.x < 0 && dawn.y > 0);
  assert.ok(dusk.x > 0 && dusk.y > 0);
  assert.ok(noon.y > .9);
  assert.ok(midnight.y < -.8);
  assert.ok(Math.abs(Math.hypot(noon.x, noon.y, noon.z) - 1) < 1e-9);
});

test('la luna llena sale al anochecer y la nueva casi no ilumina', () => {
  let full = 1;
  while (Math.abs(moonPhase(full, 0) - .5) > .02) full++;
  assert.ok(moonDirection(0, full).y > .8, 'la luna llena está alta a medianoche');
  assert.ok(moonIllumination(.5) > .99);
  assert.ok(moonIllumination(0) < .01);
});

test('WeatherSystem mezcla gradualmente las transiciones y lanza rayos en tormenta', () => {
  const scene = new THREE.Scene();
  const weather = new WeatherSystem(scene);
  weather.setWeather('soleado', false);
  assert.equal(weather.isRaining, false);
  weather.setWeather('tormenta', false, { transition: true });
  weather.update(1, new THREE.Vector3());
  assert.ok(weather.cloudCover > WEATHER_TYPES.soleado.cloud && weather.cloudCover < 1);
  assert.equal(weather.isRaining, false, 'la lluvia espera a que el cielo se cierre');

  let lightning = 0;
  window.addEventListener('weather-lightning', () => lightning++);
  for (let i = 0; i < 1200; i++) weather.update(.1, new THREE.Vector3());
  assert.equal(weather.isRaining, true);
  assert.ok(weather.rainIntensity > .95);
  assert.ok(lightning > 0);
  assert.ok(weather.rainParticles.geometry.drawRange.count > 0);

  weather.setQuality('baja');
  const low = weather.rainParticles.geometry.drawRange.count;
  weather.setQuality('alta');
  assert.ok(low < weather.rainParticles.geometry.drawRange.count, 'calidad baja dibuja menos gotas');
  weather.dispose();
});

test('el cielo usa el clima: nubes, lluvia y luna llegan al shader sin crear colores por cuadro', () => {
  const mgr = new SceneManager();
  const weather = new WeatherSystem(null);
  weather.setWeather('soleado', false);
  mgr.setTimeOfDay(12, weather, 1);
  const clearSun = mgr.sun.intensity;
  const uniforms = mgr.skyDome.material.uniforms;
  assert.ok(uniforms.cloudCover.value < .2);
  assert.ok(uniforms.sunDisc.value > .9);

  weather.setWeather('aguacero', false);
  mgr.setTimeOfDay(12, weather, 1);
  assert.ok(mgr.sun.intensity < clearSun * .5, 'el aguacero apaga la luz directa');
  assert.ok(uniforms.cloudCover.value > .9);

  mgr.setTimeOfDay(0, weather, 1);
  assert.equal(uniforms.nightFactor.value, 1);
  assert.ok(mgr.scene.fog.color.equals(mgr.scene.background), 'niebla y fondo comparten el horizonte');

  weather.flash = 1;
  const dark = mgr.ambient.intensity;
  weather.flash = 0;
  mgr.setTimeOfDay(0, weather, 1);
  assert.ok(mgr.ambient.intensity < dark + 1e-9);
  weather.flash = 1;
  mgr.setTimeOfDay(0, weather, 1);
  assert.ok(mgr.ambient.intensity > dark - 1e-9 + 1, 'el relámpago ilumina la escena');

  mgr.setQuality('baja');
  assert.equal(mgr.skyDome.visible, true);
  assert.equal(uniforms.octaves.value, 2);
});

test('de noche el cielo despejado muestra la luna en el HUD', async () => {
  const { describeWeather } = await import('../src/world/Climate.js');
  assert.deepEqual(describeWeather(WEATHER_TYPES.soleado, true), { icon: '🌙', label: 'Despejado' });
  assert.deepEqual(describeWeather(WEATHER_TYPES.soleado, false), { icon: '☀️', label: 'Soleado' });
  assert.equal(describeWeather(WEATHER_TYPES.tormenta, true).icon, '⛈️');
});
