import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { SceneManager } from '../src/core/Scene.js';
import { LocalLights } from '../src/core/LocalLights.js';
import { Farol } from '../src/world/props/Farol.js';
import { buildStreetLightMap, streetLightSources } from '../src/world/bogota/StreetLightMap.js';
import { STREET_LIGHT_CELL, streetLightUniforms } from '../src/world/bogota/StreetLightShader.js';

function block() {
  const lamp = new Farol(new THREE.Vector3(8, .12, 8));
  const window = { x: 8, z: 0, dx: 1, dz: 0, ancho: 3, estado: 'abierta', interior: 'pan' };
  return { lamp, district: { props: [{ instance: lamp }], vitrinas: [window,
    { ...window, z: 12, estado: 'media', interior: 'farmacia' }, { ...window, z: 24, estado: 'cerrada' }],
    getGroundHeight: () => .12 } };
}

function recordsAt(map, x, z) {
  const { grid, texture } = map;
  const column = Math.floor((x - grid.x) / STREET_LIGHT_CELL), row = Math.floor((z - grid.y) / STREET_LIGHT_CELL);
  if (column < 0 || row < 0 || column >= grid.z || row >= grid.w) return [];
  const data = texture.image.data, header = (row * grid.z + column) * 4;
  const entries = [];
  for (let i = data[header]; i < data[header + 1]; i += 2) entries.push(data.subarray(i * 4, i * 4 + 8));
  return entries;
}

test('los vanos instalados fijan color, ancho, altura y alcance; cerrar la persiana quita la fuente', () => {
  const { district } = block();
  const [lamp, bakery, pharmacy, ...others] = streetLightSources(district);
  assert.equal(others.length, 0);
  assert.equal(lamp.shape, 0);
  assert.ok(lamp.y > 6 && lamp.range > bakery.range);
  assert.ok(bakery.shape > 1 && bakery.shape < 2, 'el vano abre hacia +X');
  assert.ok(Math.abs((bakery.shape % 1) * 4 - 1.2) < 1e-6);
  assert.ok(pharmacy.y < bakery.y - .8 && pharmacy.range < bakery.range);
  assert.ok(pharmacy.radiance[2] / pharmacy.radiance[0] > bakery.radiance[2] / bakery.radiance[0] * 1.3);
  district.vitrinas[1].interior = 'cabinas';
  const screen = streetLightSources(district)[2];
  assert.ok(Math.max(...screen.radiance) < Math.max(...pharmacy.radiance) * .35,
    'con la misma abertura, la pantalla deja escapar menos luz que el tubo de la farmacia');
});

test('a ambos lados de cada borde se conservan todas las fuentes que alcanzan el fragmento, incluso al final del tubo', () => {
  const { district } = block(), lights = streetLightSources(district);
  let calls = 0;
  const random = Math.random;
  let map;
  try {
    Math.random = () => { calls++; return random(); };
    map = buildStreetLightMap(district);
  } finally { Math.random = random; }
  assert.equal(calls, 0, 'el UUID de la tabla no consume la secuencia del tráfico');
  assert.equal(map.texture.minFilter, THREE.NearestFilter);
  for (const light of lights) {
    const radius = light.range + (light.shape % 1) * 4;
    for (let x = -8; x <= 32; x += 2) for (let z = -16; z <= 32; z += 2) {
      for (const epsilon of [-.001, .001]) {
        if (Math.hypot(x + epsilon - light.x, z + epsilon - light.z) >= radius) continue;
        assert.ok(recordsAt(map, x + epsilon, z + epsilon).some(data =>
          Math.abs(data[0] - light.x) < .001 && Math.abs(data[2] - light.z) < .001));
      }
    }
  }
  assert.deepEqual(recordsAt(map, 140, 28), []);
  map.texture.dispose();
});

test('al ocaso la fachada y la luz directa siguen al sol; en alta el presupuesto de puntos queda libre para el fuego', () => {
  const { district, lamp } = block(), manager = new SceneManager(), scene = manager.scene;
  scene.userData.streetLightMap = buildStreetLightMap(district);
  const fire = new THREE.PointLight(0xfe7635, 4, 7);
  fire.position.set(8, .5, 8);
  scene.add(lamp.group, fire);
  lamp.setNight(true);
  const budget = new LocalLights(scene);
  const levels = [12, 17.8, 18, 21].map(hour => {
    manager.setTimeOfDay(hour, false, 0);
    assert.equal(scene.userData.streetLightMap.windowLevel, streetLightUniforms.uStreetLightLevel.value);
    return streetLightUniforms.uStreetLightLevel.value;
  });
  assert.equal(levels[0], 0);
  assert.equal(levels.at(-1), 1);
  assert.ok(levels[0] < levels[1] && levels[1] < levels[2] && levels[2] < levels[3]);
  budget.update(0, new THREE.Vector3(8, .12, 8));
  assert.deepEqual(budget.candidates.map(entry => entry.light), [fire]);
  manager.setQuality('media');
  assert.equal(streetLightUniforms.uStreetLightLevel.value, 0);
  assert.equal(streetLightUniforms.uStreetLightMap.value, null);
  budget.update(0, new THREE.Vector3(8, .12, 8));
  assert.ok(budget.candidates.some(entry => entry.light === lamp.light));
  budget.dispose();
  scene.userData.streetLightMap.texture.dispose();
});
