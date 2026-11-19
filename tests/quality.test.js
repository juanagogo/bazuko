import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { SceneManager } from '../src/core/Scene.js';
import { effectiveQuality, initialGraphicsQuality } from '../src/core/GraphicsQuality.js';
import { Vector3 } from 'three';

test('la entrada de PC usa Baja salvo que haya una preferencia o un perfil solicitado válido', () => {
  assert.equal(effectiveQuality(), 'baja');
  assert.equal(initialGraphicsQuality(null, null), 'baja');
  assert.equal(initialGraphicsQuality('valor antiguo', 'toString'), 'baja');
  assert.equal(initialGraphicsQuality('alta', null), 'alta');
  assert.equal(initialGraphicsQuality('media', null), 'media');
  assert.equal(initialGraphicsQuality('baja', 'alta'), 'alta');
  assert.equal(initialGraphicsQuality('media', 'toString'), 'media');
});

test('al caminar menos de medio texel la sombra de Alta permanece en la misma muestra', () => {
  const mgr = new SceneManager();
  const position = new Vector3();
  mgr.followTarget(position, 15);
  const lightDirection = mgr.sun.position.clone().normalize();
  const right = new Vector3().crossVectors(mgr.sun.shadow.camera.up, lightDirection).normalize();
  const texel = 90 / mgr.sun.shadow.mapSize.x;
  for (const [step, grid] of [[.25, 0], [.75, 1], [1.1, 1]]) {
    mgr.followTarget(position.copy(right).multiplyScalar(step * texel), 15);
    assert.ok(Math.abs(right.dot(mgr.sun.target.position) - grid * texel) < 1e-10);
    assert.ok(mgr.sun.position.clone().sub(mgr.sun.target.position).normalize().distanceTo(lightDirection) < 1e-10);
  }
});

test('SceneManager ajusta sombras y niebla según nivel de calidad gráfica', () => {
  const sceneMgr = new SceneManager();
  assert.equal(sceneMgr.sun.castShadow, true);

  // Calidad baja: apaga sombras para máximo rendimiento en GPU básica
  sceneMgr.setQuality('baja');
  assert.equal(sceneMgr.sun.castShadow, false);
  assert.equal(sceneMgr.scene.fog.near, 40);

  // Calidad media: sombras ligeras
  sceneMgr.setQuality('media');
  assert.equal(sceneMgr.sun.castShadow, true);
  assert.equal(sceneMgr.sun.shadow.mapSize.x, 1024);

  // Calidad alta: sombras nítidas
  sceneMgr.setQuality('alta');
  assert.equal(sceneMgr.sun.castShadow, true);
  assert.equal(sceneMgr.sun.shadow.mapSize.x, 4096);
});
