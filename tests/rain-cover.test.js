import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildRainCover } from '../src/world/RainCover.js';
import { WeatherSystem } from '../src/world/WeatherSystem.js';
import { buildGasStation } from '../src/world/bogota/GasStation.js';
import { buildTransitTerminal } from '../src/world/bogota/TransitTerminal.js';
import { buildColpatriaViaduct, viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
import { buildMetroBogota, METRO } from '../src/world/bogota/MetroBogota.js';

const near = (actual, expected, tolerance) =>
  assert.ok(actual != null && Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test('el campo toma las cubiertas dibujadas, sus bordes y el tablero superior donde se solapan', () => {
  const garage = buildGasStation({ createSign: () => new THREE.Texture() });
  const platform = buildTransitTerminal({ asphalt: new THREE.MeshStandardMaterial() });
  const bridge = buildColpatriaViaduct();
  const metro = buildMetroBogota();

  const onlyPlatform = buildRainCover(platform);
  try {
    near(onlyPlatform.heightAt(75, -24), 4.69, .025);
    assert.equal(onlyPlatform.heightAt(75, -8.9), null);
    assert.equal(onlyPlatform.heightAt(79, -24), null);
  } finally { onlyPlatform.dispose(); }

  const originalRandom = Math.random;
  let draws = 0;
  Math.random = () => { draws++; return originalRandom(); };
  let roofs;
  try { roofs = buildRainCover(garage, platform, bridge, metro); }
  finally { Math.random = originalRandom; }
  try {
    assert.equal(draws, 0);
    near(roofs.heightAt(154, 99.5), 5.3, .03);
    assert.equal(roofs.heightAt(154, 92.25), null);
    assert.equal(roofs.heightAt(83, -24), null);
    near(roofs.heightAt(75, -24), METRO.trackHeight, .03);
    near(roofs.heightAt(75, 234), METRO.trackHeight, .03);
    near(roofs.heightAt(81.65, 234), viaductSurface(81.65, 234), .03);
    near(roofs.heightAt(92.308, 235.338), viaductSurface(92.308, 235.338), .03);
    assert.equal(roofs.heightAt(105, 230), null);
  } finally { roofs.dispose(); }
});

test('las gotas y cortinas comparten cubiertas y los aros solo se esconden debajo', () => {
  const scene = new THREE.Scene(), weather = new WeatherSystem(scene);
  const geometry = new THREE.BoxGeometry(5, .5, 5), material = new THREE.MeshBasicMaterial();
  const slab = new THREE.Mesh(geometry, material);
  slab.position.y = 4.75;
  slab.userData.rainCover = true;
  const rainCover = buildRainCover(slab);
  const district = { rainCover, getGroundHeight: () => 0 };
  const player = new THREE.Vector3(0, 0, 0);
  try {
    weather.setWeather('aguacero', false);
    const ages = weather.rippleGeometry.attributes.aAge;
    for (const [index, x, y] of [[0, 0, .025], [1, 4, .025], [2, 0, 5.025]]) {
      Object.assign(weather.rippleData[index], { x, y, z: 0, age: .1, life: .5 });
    }
    weather.update(0, player, district, { hour: 12, day: 1 });
    assert.equal(ages.getX(0), 1);
    near(ages.getX(1), .2, 1e-6);
    near(ages.getX(2), .2, 1e-6);
    assert.equal(weather.rainParticles.visible, true);
    const drops = weather.rainParticles.material.uniforms;
    const curtains = weather.rainCurtains.material.uniforms;
    assert.equal(drops.uRainCoverMap, curtains.uRainCoverMap);
    assert.equal(drops.uRainCoverMap.value, rainCover.texture);
    assert.equal(weather.rainIntensity, .72);

    weather.update(0, player, { getGroundHeight: () => 0 }, { hour: 12, day: 1 });
    assert.equal(drops.uRainCoverMap.value, null);
    near(ages.getX(0), .2, 1e-6);
  } finally {
    weather.dispose();
    rainCover.dispose();
    geometry.dispose();
    material.dispose();
  }
});
