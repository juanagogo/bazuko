// En baja las dos luces de punto se apagan; los halos decorativos del suelo se quedan.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { LocalLights } from '../src/core/LocalLights.js';

test('apagar las luces de punto no apaga los halos', () => {
  const scene = new THREE.Scene();
  const lights = new LocalLights(scene);
  scene.add(new THREE.PointLight(0xffaa55, 3, 12));
  lights.refreshSources();

  lights.setEnabled(false);
  assert.equal(lights.enabled, false);
  assert.ok(lights.pool.every(light => !light.visible), 'baja las deja fuera del shader');
  lights.update(1 / 60, new THREE.Vector3(0, 0, 0), () => 0, null);
  assert.equal(lights.halos.mesh.count, 1, 'el halo del fogón se sigue dibujando');

  lights.setEnabled(true);
  assert.ok(lights.pool.every(light => light.visible), 'media y alta las recuperan');
});
