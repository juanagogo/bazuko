import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { SceneManager } from '../src/core/Scene.js';
import { OutdoorUrbanEnvironment, Renderer } from '../src/core/Renderer.js';
import { LocalLights } from '../src/core/LocalLights.js';
import { Farol } from '../src/world/props/Farol.js';
import { WeatherSystem } from '../src/world/WeatherSystem.js';

const overcast = { cloudCover: .9, rainIntensity: .3, fogDensity: 1.2, flash: 0 };
const brightness = color => color.r + color.g + color.b;

test('el resplandor urbano se apaga de día y conserva la continuidad al pasar medianoche', () => {
  const manager = new SceneManager();
  const uniforms = manager.skyDome.material.uniforms;
  manager.setTimeOfDay(12, overcast, 1);
  assert.equal(uniforms.cityGlow.value, 0);
  const dayGround = manager.ambient.groundColor.clone();
  manager.setTimeOfDay(22, overcast, 1);
  assert.ok(uniforms.cityGlow.value > .05);
  assert.ok(manager.ambient.groundColor.r / manager.ambient.groundColor.b > dayGround.r / dayGround.b,
    'el rebote de las luminarias es más cálido que el suelo de día');
  assert.ok(uniforms.topColor.value.b > uniforms.topColor.value.r, 'la bóveda conserva el tono nocturno frío');
  manager.setTimeOfDay(23.999, overcast, 1);
  const previous = manager.scene.background.clone();
  const glow = uniforms.cityGlow.value;
  manager.setTimeOfDay(0, overcast, 2);
  for (const channel of ['r', 'g', 'b']) {
    assert.ok(Math.abs(previous[channel] - manager.scene.background[channel]) < .001);
  }
  assert.ok(Math.abs(glow - uniforms.cityGlow.value) < .001);
});

test('el ciclo atmosférico mantiene sus luces y colores reutilizados en todas las calidades', () => {
  const manager = new SceneManager();
  const top = manager.skyDome.material.uniforms.topColor.value;
  const ground = manager.ambient.groundColor;
  for (const quality of ['baja', 'media', 'alta']) {
    manager.setQuality(quality);
    for (let hour = 0; hour < 24; hour += .5) {
      manager.setTimeOfDay(hour, overcast, 4);
      assert.equal(manager.skyDome.material.uniforms.topColor.value, top);
      assert.equal(manager.ambient.groundColor, ground);
      assert.ok(Number.isFinite(manager.ambient.intensity) && manager.ambient.intensity > 0);
      assert.ok(Number.isFinite(brightness(manager.scene.background)));
      assert.ok(manager.scene.fog.near < manager.scene.fog.far);
    }
    const lights = [];
    manager.scene.traverse(object => { if (object.isLight) lights.push(object); });
    assert.equal(lights.length, 2);
  }
});

test('la lluvia responde a la hora sin reescribir partículas ni exceder el presupuesto bajo', () => {
  const weather = new WeatherSystem(new THREE.Scene());
  weather.setWeather('llovizna', false);
  weather.setQuality('baja');
  const attributes = Object.values(weather.rainGeometry.attributes);
  const versions = attributes.map(attribute => attribute.version);
  const lowCount = weather.rainGeometry.drawRange.count;
  const color = weather.rainParticles.material.uniforms.uColor.value;
  const position = new THREE.Vector3(112.98, 0, 97.84);
  weather.update(.016, position, null, { hour: 22, day: 1 });
  const night = brightness(color);
  weather.update(.016, position, null, { hour: 12, day: 1 });
  assert.ok(brightness(color) > night, 'las gotas reciben más luz de día');
  assert.equal(weather.rainParticles.material.uniforms.uColor.value, color);
  assert.deepEqual(attributes.map(attribute => attribute.version), versions);
  assert.equal(weather.rainGeometry.drawRange.count, lowCount);
  weather.setQuality('alta');
  assert.ok(lowCount < weather.rainGeometry.drawRange.count);
  weather.dispose();
});

test('el entorno de reflejos libera una vez cada recurso compartido al terminar el horneado', () => {
  const environment = new OutdoorUrbanEnvironment();
  const disposals = new Map();
  environment.traverse(object => {
    for (const resource of [object.geometry, object.material].flat().filter(Boolean)) {
      if (disposals.has(resource)) continue;
      disposals.set(resource, 0);
      resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
    }
  });
  environment.dispose();
  assert.ok(disposals.size > 0);
  assert.ok([...disposals.values()].every(count => count === 1));
});

test('la exposición cambia suavemente durante el día y conserva margen en la noche lluviosa', () => {
  const manager = new SceneManager();
  let previous;
  for (let hour = 0; hour <= 24; hour += 1 / 60) {
    manager.setTimeOfDay(hour, overcast, 1);
    const exposure = manager.scene.userData.toneMappingExposure;
    assert.ok(exposure >= 1 && exposure <= 1.3);
    if (previous !== undefined) assert.ok(Math.abs(exposure - previous) < .01, 'sin saltos al amanecer o atardecer');
    previous = exposure;
  }
  manager.setTimeOfDay(12, overcast, 1);
  const daylightExposure = manager.scene.userData.toneMappingExposure;
  const daylightSun = manager.sun.intensity;
  manager.setTimeOfDay(22, overcast, 1);
  assert.ok(manager.scene.userData.toneMappingExposure > daylightExposure);
  assert.ok(manager.sun.intensity < daylightSun);
  // Piso de relleno lineal para que los semitonos del personaje tengan luz incluso sin un farol cercano.
  const fill = manager.ambient.color.clone().add(manager.ambient.groundColor).multiplyScalar(manager.ambient.intensity * .5);
  assert.ok(.2126 * fill.r + .7152 * fill.g + .0722 * fill.b > .2);
});

test('el renderer aplica la exposición de la escena a todas sus pasadas sin añadir renderizados', () => {
  const scene = new THREE.Scene(), exposures = [];
  scene.userData.toneMappingExposure = 1.2;
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    quality: 'alta', resolution: { pressure: 0 },
    culling: { apply() {}, restore() {} },
    instance: { info: { reset() {} }, shadowMap: {}, render() { exposures.push(this.toneMappingExposure); } },
    silhouette: { render(instance) { exposures.push(instance.toneMappingExposure); } }
  });
  renderer.render(scene, new THREE.PerspectiveCamera(), new THREE.Group());
  assert.deepEqual(exposures, [1.2, 1.2]);
  delete scene.userData.toneMappingExposure;
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.equal(exposures.at(-1), 1.05, 'las escenas ajenas al ciclo conservan la exposición estándar');
});

test('el presupuesto local prioriza luz que llega al jugador frente a fuentes fuera de alcance', () => {
  const scene = new THREE.Scene();
  const distant = new THREE.PointLight(0xff0000, 100, 2, 2);
  distant.position.set(8, 0, 0);
  const nearby = new THREE.PointLight(0xffd29a, 5, 9, 2);
  nearby.position.set(0, 3, 0);
  scene.add(distant, nearby);
  const budget = new LocalLights(scene, 1);
  budget.update(0, new THREE.Vector3());
  assert.ok(budget.pool[0].position.equals(nearby.position));
  assert.equal(budget.pool[0].distance, nearby.distance);
  assert.equal(budget.pool[0].decay, nearby.decay);
  budget.update(.1, new THREE.Vector3(8, 0, 0));
  assert.ok(budget.pool[0].position.equals(distant.position));
  assert.equal(budget.pool.length, 1);
  budget.dispose();
});

test('el farol ilumina de noche a altura real y se apaga de día conservando su alcance', () => {
  const farol = new Farol(new THREE.Vector3());
  const range = farol.light.distance;
  farol.setNight(true);
  const height = farol.light.position.y;
  const cutoff = 1 - (height / range) ** 4;
  const illuminationAtFeet = farol.light.intensity / height ** farol.light.decay * cutoff ** 2;
  assert.ok(illuminationAtFeet > .5 && illuminationAtFeet < 2, 'luz útil sin quemar el suelo');
  assert.ok(farol.light.color.r > farol.light.color.b);
  farol.setNight(false);
  assert.equal(farol.light.intensity, 0);
  assert.equal(farol.light.distance, range);
});
