import test from 'node:test';
import assert from 'node:assert/strict';
import ClusteredLightsNode from 'three/addons/tsl/lighting/ClusteredLightsNode.js';
import { StableClusteredLightsNode, StableClusteredLighting } from '../src/graphics/StableClusteredLighting.js';

const renderer = (w, h) => ({ getDrawingBufferSize: v => v.set(w, h) });

test('la malla de clusters no cambia con la resolución y conserva la clave de luces', () => {
  const base = new ClusteredLightsNode(16, 32, 4, 8);
  base.updateProgram(renderer(1280, 720));const baseKey = base.customCacheKey();
  base.updateProgram(renderer(1088, 612));
  assert.notEqual(base.customCacheKey(), baseKey, 'Three reconstruye la malla al cambiar el tamaño');

  const node = new StableClusteredLightsNode(16, 32, 4, 8);
  node.updateProgram(renderer(1280, 720));
  const key = node.customCacheKey(), grid = node._gridDimensions.value.clone(), index = node._screenClusterIndex;
  for (const [w, h] of [[1088, 612], [960, 540], [1920, 1080]]) node.updateProgram(renderer(w, h));
  assert.equal(node.customCacheKey(), key);
  assert.deepEqual(node._gridDimensions.value.toArray(), grid.toArray());
  assert.equal(node._screenClusterIndex, index);
  assert.ok(new StableClusteredLighting(16, 32, 4, 8).createNode() instanceof StableClusteredLightsNode);
});
