import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { compileScenePass } from '../src/graphics/ScenePassPreparation.js';
import { withFrameTransforms } from '../src/graphics/FrameTransforms.js';
import { useInstanceStorage } from '../src/graphics/InstanceStorage.js';
import { installStableInstanceShaders } from '../src/graphics/StableInstanceShaders.js';
import { collectShaderWarmupJobs, shaderCompilationBatches, withWarmupVariants } from '../src/core/ShaderWarmup.js';

test('precompila en el contexto del MRT anidado y restaura antes de otro cuadro', async () => {
  const contexts = { get(target, mrt, depth = 0) { return { target, mrt, depth }; } };
  const original = contexts.get;
  const steps = [], sceneLights = { updateProgram() { steps.push('clusters'); } };
  let finish;
  const renderer = { _renderContexts: contexts,
    lighting: { getNode: () => sceneLights },
    _nodes: { callHashCache: { delete(key) { steps.push('invalidate'); assert.equal(key[1], sceneLights); } } },
    compileAsync(root, camera, scene) {
    assert.deepEqual(steps, ['clusters', 'invalidate']);
    assert.deepEqual([root, camera, scene], ['root', 'camera', 'scene']);
    assert.equal(contexts.get('target', 'mrt').depth, 1);
    assert.equal(contexts.get('shadow', null, 2).depth, 2);
    return new Promise(resolve => { finish = resolve; });
  } };
  const promise = compileScenePass(renderer, 'root', 'camera', 'scene');
  assert.equal(contexts.get, original);
  assert.equal(contexts.get('target', 'mrt').depth, 0, 'runtime normal no queda modificado');
  finish(); await promise;
  renderer.compileAsync = () => { throw Error('GPU perdida'); };
  assert.throws(() => compileScenePass(renderer), /GPU perdida/);
  assert.equal(contexts.get, original);
});

test('los lotes conservan cada objeto y sus padres sin repetir recorridos de ciudad', () => {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial(), geometry = new THREE.BoxGeometry();
  for (let i = 0; i < 150; i++) root.add(new THREE.Mesh(geometry, material));
  const { jobs } = collectShaderWarmupJobs([root]);
  const batches = shaderCompilationBatches(jobs, 64);
  assert.deepEqual(batches.map(b => b.children.length), [64, 64, 22]);
  assert.deepEqual(batches.flatMap(b => b.children), root.children);
  assert.ok(root.children.every(o => o.parent === root));
});

test('prepara variantes ocultas explícitas, respeta otras ocultaciones y restaura ante fallo', async () => {
  const root = new THREE.Group(), lod = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const hidden = lod.clone(); root.add(lod, hidden);
  lod.visible = hidden.visible = false; lod.userData.prepareWhileHidden = true;
  assert.equal(collectShaderWarmupJobs([root]).objects, 1);
  await assert.rejects(withWarmupVariants([root, root], async () => {
    assert.equal(lod.visible, true); assert.equal(lod.userData.preparingGraphics, true);
    assert.equal(hidden.visible, false); throw Error('fallo');
  }), /fallo/);
  assert.equal(lod.visible, false); assert.equal(lod.userData.preparingGraphics, undefined);
});

test('actualiza transformaciones una vez por cuadro, también objetos móviles, y restaura tras error', () => {
  const scene = new THREE.Scene(), child = new THREE.Object3D(); scene.add(child);
  let visits = 0; const update = child.updateMatrixWorld.bind(child);
  child.updateMatrixWorld = force => { visits++; update(force); };
  const passes = () => { for (let pass = 0; pass < 3; pass++) if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld(); };
  child.position.x = 5; withFrameTransforms(scene, passes);
  assert.equal(visits, 1); assert.equal(child.matrixWorld.elements[12], 5);
  child.position.x = 8; withFrameTransforms(scene, passes);
  assert.equal(visits, 2); assert.equal(child.matrixWorld.elements[12], 8);
  assert.throws(() => withFrameTransforms(scene, () => { throw Error('perdida'); }), /perdida/);
  assert.equal(scene.matrixWorldAutoUpdate, true);
  scene.matrixWorldAutoUpdate = false; withFrameTransforms(scene, passes);
  assert.equal(scene.matrixWorldAutoUpdate, false);
});

test('bancos con programas iguales mantienen buffers y bindings independientes', () => {
  const a = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
  const b = a.clone(), source = a.instanceMatrix.array;
  a.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  assert.equal(useInstanceStorage(a), true); assert.equal(useInstanceStorage(a), false);
  useInstanceStorage(b);
  assert.equal(a.instanceMatrix.array, source); assert.equal(a.instanceMatrix.usage, THREE.StaticDrawUsage);
  assert.notEqual(a.instanceMatrix.array, b.instanceMatrix.array);
  const renderer = { debug: {} }; installStableInstanceShaders(renderer);
  for (const mesh of [a, b]) {
    const builder = { getUniformFromNode(node, type, stage, name) { return { node, name }; } };
    renderer.debug.onNodeBuilderCreated(builder, { object: mesh });
    const node = { value: mesh.instanceMatrix };
    const result = builder.getUniformFromNode(node, 'storageBuffer', 'vertex');
    assert.equal(result.name, 'instanceMatrices'); assert.equal(result.node.value, mesh.instanceMatrix);
    assert.equal(builder.getUniformFromNode({ value: {} }, 'storageBuffer', 'vertex', 'other').name, 'other');
  }
});
