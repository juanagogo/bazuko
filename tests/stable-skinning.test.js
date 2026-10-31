import test from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceNode } from 'three/webgpu';
import { installStableSkinningNames, BONE_MATRICES_NAME } from '../src/core/StableSkinning.js';

test('el buffer de huesos usa un nombre fijo para compartir shaders entre personajes', () => {
  installStableSkinningNames();installStableSkinningNames();
  const a = new ReferenceNode('skeleton.boneMatrices', 'mat4', null, 52), b = new ReferenceNode('skeleton.boneMatrices', 'mat4', null, 52);
  a.setNodeType('mat4');b.setNodeType('mat4');
  assert.equal(a.node.name, BONE_MATRICES_NAME);assert.equal(b.node.name, BONE_MATRICES_NAME);
  const other = new ReferenceNode('morphTargetInfluences', 'float', null, 4);other.setNodeType('float');
  assert.equal(other.name, null);assert.notEqual(other.node.name, BONE_MATRICES_NAME);
  const named = new ReferenceNode('skeleton.boneMatrices', 'mat4', null, 52).setName('propio');named.setNodeType('mat4');
  assert.equal(named.node.name, 'propio');
});
