import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { SceneManager } from '../src/core/Scene.js';
import { isShadowActive } from '../src/graphics/ShadowState.js';

test('SceneManager ajusta sombras y niebla según nivel de calidad gráfica', () => {
  const sceneMgr = new SceneManager();
  assert.equal(sceneMgr.sun.castShadow, true);

  // La presión de FPS puede llevar la calidad efectiva a baja: conserva las sombras
  sceneMgr.setQuality('baja');
  assert.equal(isShadowActive(sceneMgr.sun), true);
  assert.equal(sceneMgr.scene.fog.near, 40);

  // Elegir baja en el menú pausa la sombra sin cambiar castShadow (cambiarlo reconstruye toda la escena)
  sceneMgr.setShadowQuality('baja');
  assert.equal(sceneMgr.sun.castShadow, true);
  assert.equal(isShadowActive(sceneMgr.sun), false);
  assert.equal(sceneMgr.sun.shadow.intensity, 0);

  // Calidad media: sombras ligeras; la resolución solo cambia con la elección manual
  sceneMgr.setQuality('media');
  sceneMgr.setShadowQuality('media');
  assert.equal(isShadowActive(sceneMgr.sun), true);
  assert.equal(sceneMgr.sun.shadow.mapSize.x, 1024);

  // Calidad alta: sombras nítidas
  sceneMgr.setQuality('alta');sceneMgr.setShadowQuality('alta');
  assert.equal(isShadowActive(sceneMgr.sun), true);
  assert.equal(sceneMgr.sun.shadow.intensity, 1);
  assert.equal(sceneMgr.sun.shadow.mapSize.x, 2048);
});

test('la bajada automática de calidad por FPS no quita las sombras del día', async () => {
  const sceneMgr = new SceneManager();
  sceneMgr.setShadowQuality('alta');
  for (const effective of ['media', 'baja', 'baja', 'media', 'alta']) {
    sceneMgr.setQuality(effective);
    sceneMgr.setTimeOfDay(12);
    assert.equal(isShadowActive(sceneMgr.sun), true, `sin sombras en calidad efectiva ${effective}`);
  }
});
