// tests/censor.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  CENSOR_MIN_BLOCK, censorBlockPixels, censorByLocalY, censorByRestBox, censorSeed,
  createCensorUniforms, setCensor
} from '../src/character/censor.js';

const compile = (material) => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, null);
  return shader;
};

test('el mosaico va después de opaque_fragment y conserva el sombreador anterior', () => {
  const material = new THREE.MeshStandardMaterial();
  material.onBeforeCompile = shader => { shader.prev = true; };
  material.customProgramCacheKey = () => 'calle';
  const uniforms = createCensorUniforms(new THREE.Color(0xb9805a));
  censorByRestBox(material, uniforms, new THREE.Vector3(.12, .4, .6));
  const shader = compile(material);
  assert.equal(shader.prev, true);
  const opaque = shader.fragmentShader.indexOf('#include <opaque_fragment>');
  assert.ok(opaque >= 0);
  assert.ok(shader.fragmentShader.indexOf('uCensorBlock', opaque) > opaque, 'el mosaico se pinta después del color final');
  assert.match(shader.fragmentShader, /vStreetRest\.y > uCensorBox\.y/);
  assert.equal(shader.uniforms.uCensor, uniforms.uCensor);
  assert.equal(shader.uniforms.uCensorBlock, uniforms.uCensorBlock);
  assert.ok(shader.uniforms.uCensorBox.value.equals(new THREE.Vector3(.12, .4, .6)));
  assert.match(material.customProgramCacheKey(), /^calle\|censor:v1:rest$/);
  setCensor(uniforms, { on: true, block: 9, seed: 3.7 });
  assert.equal(uniforms.uCensor.value, 1);
  assert.equal(uniforms.uCensorBlock.value, 9);
  assert.equal(uniforms.uCensorSeed.value, 3.7);
  setCensor(uniforms, { on: false });
  assert.equal(uniforms.uCensor.value, 0);
});

test('por altura local el vértice pasa su altura al fragmento', () => {
  const material = new THREE.MeshLambertMaterial();
  const uniforms = createCensorUniforms(new THREE.Color(0xb9805a));
  censorByLocalY(material, uniforms, .05);
  const shader = {
    uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader
  };
  material.onBeforeCompile(shader, null);
  assert.match(shader.vertexShader, /vCensorY = position\.y/);
  assert.match(shader.fragmentShader, /vCensorY > uCensorMinY/);
  assert.equal(shader.uniforms.uCensorMinY.value, .05);
  assert.match(material.customProgramCacheKey(), /censor:v1:local$/);
});

test('los cuadros miden un sexto de la cadera en pantalla y nunca menos de 3 px', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 200);
  const center = new THREE.Vector3(0, .7, 0);
  const blockAt = distance => {
    camera.position.set(0, .7, distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    return censorBlockPixels(center, camera, 900);
  };
  const near = blockAt(3), far = blockAt(6);
  assert.ok(Number.isInteger(near) && Number.isInteger(far));
  assert.ok(Math.abs(near - 2 * far) <= 1, `a 3 m ${near} px, a 6 m ${far} px`);
  assert.ok(near > 10 && near < 25);
  assert.equal(blockAt(80), CENSOR_MIN_BLOCK);
});

test('el patrón cambia cada dos segundos', () => {
  assert.equal(censorSeed(0), censorSeed(1.99));
  assert.notEqual(censorSeed(2), censorSeed(0));
  assert.equal(censorSeed(2), censorSeed(3.5));
});
