import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { SceneManager, skyFogUniforms } from '../src/core/Scene.js';

const clear = { cloudCover: .1, rainIntensity: 0, fogDensity: 1, flash: 0 };

test('la niebla de todo material integrado lee el mismo cielo que la cúpula', () => {
  for (const name of ['standard', 'basic', 'lambert', 'phong', 'physical']) {
    assert.equal(THREE.ShaderLib[name].uniforms.skyFogLow, skyFogUniforms.skyFogLow, name);
    assert.equal(THREE.ShaderLib[name].uniforms.skyFogHigh, skyFogUniforms.skyFogHigh, name);
  }
  assert.match(THREE.ShaderChunk.fog_fragment, /skyFogMix\(/);
  assert.match(THREE.ShaderChunk.fog_pars_fragment, /skyFogColor\(\)/);
  assert.match(THREE.ShaderChunk.fog_fragment, /fogFactor > \.004/, 'lo cercano se salta el cálculo');
  // Clonar un material no debe romper el enlace: el objeto compartido llega por referencia.
  assert.equal(THREE.UniformsUtils.clone({ a: skyFogUniforms.skyFogLow }).a.value.r, skyFogUniforms.skyFogLow.value.r);
});

test('la curva del degradado es una sola, y el color de la niebla sigue siendo el horizonte', () => {
  const manager = new SceneManager(document_free());
  const dome = manager.skyDome.material;
  const ramp = /mix\( skyFogLow, skyFogHigh, (pow\( .* \)) \);/.exec(THREE.ShaderChunk.fog_pars_fragment)?.[1];
  assert.ok(ramp, 'la niebla declara su curva');
  assert.ok(dome.fragmentShader.includes(`mix(bottomColor, topColor, ${ramp})`), 'la cúpula usa la misma');
  for (const hour of [6, 11, 18, 22]) {
    manager.setTimeOfDay(hour, clear, 4);
    const { topColor, bottomColor } = dome.uniforms;
    for (const channel of ['r', 'g', 'b']) {
      assert.equal(skyFogUniforms.skyFogHigh.value[channel], topColor.value[channel]);
      assert.equal(skyFogUniforms.skyFogLow.value[channel], bottomColor.value[channel]);
    }
    assert.ok(manager.scene.fog.near < manager.scene.fog.far);
    assert.equal(manager.scene.fog.color.getHex(), bottomColor.value.getHex(), 'el fondo de la ciudad lee fogColor');
  }
});

function document_free() { return new THREE.Scene(); }
