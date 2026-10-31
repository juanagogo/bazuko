import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setShadowActive, isShadowActive, setShadowResolution, shadowResolutionFor } from '../src/graphics/ShadowState.js';

test('pausar la sombra no cambia castShadow y reactivarla fuerza una actualización', () => {
  const light = new THREE.DirectionalLight();light.castShadow = true;
  setShadowActive(light, false);
  assert.equal(light.castShadow, true);assert.equal(isShadowActive(light), false);assert.equal(light.shadow.intensity, 0);
  light.shadow.needsUpdate = false;
  setShadowActive(light, true);
  assert.equal(isShadowActive(light), true);assert.equal(light.shadow.intensity, 1);assert.equal(light.shadow.needsUpdate, true);
  light.shadow.needsUpdate = false;setShadowActive(light, true);
  assert.equal(light.shadow.needsUpdate, false);
});

test('la resolución de sombra libera el mapa solo si cambia de tamaño', () => {
  const light = new THREE.DirectionalLight();let disposed = 0;light.shadow.mapSize.set(2048, 2048);
  light.shadow.map = { dispose() { disposed++; } };
  assert.equal(setShadowResolution(light, shadowResolutionFor('alta')), false);
  assert.equal(setShadowResolution(light, shadowResolutionFor('media')), true);
  assert.equal(disposed, 1);assert.equal(light.shadow.map, null);assert.equal(light.shadow.mapSize.x, 1024);
  assert.equal(shadowResolutionFor('baja'), 1024);
});
