import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { SceneManager, skyFogUniforms } from '../src/core/Scene.js';
import { GRAPHICS_PROFILES } from '../src/core/GraphicsQuality.js';

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

test('la bruma se acuesta: a ras de piso queda igual, arriba se abre y cierra antes del plano lejano', () => {
  assert.match(THREE.ShaderChunk.fog_fragment, /skyFogMix\( gl_FragColor\.rgb, skyFogBank\( fogFactor \) \)/);
  assert.match(THREE.ShaderChunk.fog_pars_fragment, /float skyFogBank\( float amount \)/);
  for (const name of ['standard', 'basic', 'lambert', 'points', 'sprite']) {
    for (const uniform of ['skyFogLayer', 'skyFogCool', 'skyFogVeil']) {
      assert.equal(THREE.ShaderLib[name].uniforms[uniform], skyFogUniforms[uniform], `${name} ${uniform}`);
    }
  }
  // La misma cuenta del trozo de niebla, para comprobar sus bordes sin navegador.
  const bank = (amount, height, depth) => {
    const { x, y, z, w } = skyFogUniforms.skyFogLayer.value;
    let banked = amount * (1 - y * (1 - Math.exp(-height * x)));
    banked += (1 - banked) * w * Math.exp(-height * .12) * THREE.MathUtils.smoothstep(amount, 0, .3);
    const closing = THREE.MathUtils.clamp(depth * z - 4.3, 0, 1);
    return Math.max(banked, closing * closing * (3 - 2 * closing));
  };
  const manager = new SceneManager(document_free());
  for (const quality of ['baja', 'media', 'alta']) {
    manager.setQuality(quality);
    const far = GRAPHICS_PROFILES[quality].far;
    for (const hour of [6, 12, 22]) {
      manager.setTimeOfDay(hour, clear, 4);
      const fog = manager.scene.fog, layer = skyFogUniforms.skyFogLayer.value;
      assert.ok(fog.near < fog.far && fog.far <= far, `${quality} ${hour}: la bruma no pasa del plano lejano`);
      for (const height of [0, 30, 110]) {
        assert.ok(bank(1, height, far) > .999, `${quality} ${hour}: a ${height} m el plano lejano queda tapado`);
        assert.ok(bank(.5, height, 60) <= bank(.5, 0, 60) + 1e-9, 'arriba nunca hay más bruma que abajo');
      }
      assert.ok(bank(1, 0, fog.far) > .999, 'a ras de piso cierra donde cerraba');
      assert.ok(bank(1, 90, far * .78) < .5, 'lo alto asoma sobre la bruma');
      assert.ok(layer.w >= 0 && layer.w <= .8);
      if (hour === 12) {
        assert.equal(layer.w, 0, 'a mediodía no hay neblina baja');
        assert.ok(Math.abs(bank(.4, 0, 60) - .4) < 1e-9, 'el piso lleva la misma bruma de antes');
      }
      if (hour === 6) assert.ok(layer.w > .3, 'la madrugada trae neblina baja');
      const cool = skyFogUniforms.skyFogCool.value, veil = skyFogUniforms.skyFogVeil.value;
      assert.ok(cool.r >= cool.g && cool.g >= cool.b && cool.r < .6, 'la bruma media se enfría: pierde más rojo que azul');
      if (hour === 12) assert.ok(veil.r < .01, 'de día no hay velo de sodio');
      if (hour === 22) assert.ok(veil.r > .08 && veil.r > veil.g && veil.b === 0, 'de noche el velo es cálido');
    }
  }
  manager.setQuality('baja');
  manager.setTimeOfDay(6, clear, 4);
  assert.ok(manager.scene.fog.near >= 40 - 1e-9, 'en baja la neblina de la madrugada no acerca la bruma');
});

function document_free() { return new THREE.Scene(); }
