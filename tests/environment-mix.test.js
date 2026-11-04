// El mapa de entorno alumbra todo material PBR: cambiarlo de golpe hacía saltar el brillo del piso.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { EnvironmentMix } from '../src/core/Renderer.js';
import { SceneManager } from '../src/core/Scene.js';

const baked = () => {
  const texture = new THREE.Texture({ width: 384, height: 512 });
  texture.mapping = THREE.CubeUVReflectionMapping;
  return texture;
};
const fakeGl = () => ({
  drawn: [], target: 'el de antes',
  getRenderTarget() { return this.target; },
  setRenderTarget(target) { this.target = target; },
  render() { this.drawn.push(this.target); }
});

test('la mezcla es una sola textura del tamaño de los mapas, lista para los materiales', () => {
  const mix = new EnvironmentMix(fakeGl(), baked(), baked()), texture = mix.texture;
  assert.equal(texture.mapping, THREE.CubeUVReflectionMapping, 'Three solo la lee como mapa si lleva este tipo');
  assert.deepEqual([mix.target.width, mix.target.height], [384, 512]);
  assert.equal(mix.target.depthBuffer, false);
  mix.update(1); mix.update(.3); mix.update(0);
  assert.equal(mix.texture, texture, 'al no cambiar de textura ningún material busca programa');
});

test('solo dibuja cuando el cambio se notaría, llega a los extremos y devuelve el destino', () => {
  const gl = fakeGl(), mix = new EnvironmentMix(gl, baked(), baked());
  assert.equal(mix.update(1), true, 'la primera vez siempre: compila al cargar y no en el primer atardecer');
  assert.equal(mix.update(1), false);
  assert.equal(mix.update(.9995), false, 'este paso no se ve en el piso');
  assert.equal(mix.amount, 1);
  assert.equal(mix.update(.9), true);
  assert.ok(Math.abs(mix.material.uniforms.dayAmount.value - .9) < 1e-9);
  assert.equal(mix.update(.0005), true);
  assert.equal(mix.update(0), true, 'el extremo se alcanza aunque el último paso sea mínimo');
  assert.equal(mix.update(.0005), false);
  assert.equal(mix.update(1), true);
  assert.equal(gl.drawn.length, 5);
  assert.ok(gl.drawn.every(target => target === mix.target));
  assert.equal(gl.target, 'el de antes');
});

test('el atardecer y el amanecer funden el entorno sin saltos y sin tocar scene.environment', () => {
  const manager = new SceneManager(), marker = new THREE.Texture();
  manager.scene.environment = marker;
  for (const [from, to, falling] of [[17, 19, true], [5.5, 7, false]]) {
    let previous = null, biggest = 0, low = 1, high = 0;
    for (let hour = from; hour <= to; hour += 1 / 150) { // cada 1 s real, 24 horas en una real
      manager.setTimeOfDay(hour);
      const amount = manager.scene.userData.environmentDay;
      assert.ok(amount >= 0 && amount <= 1);
      if (previous !== null) {
        biggest = Math.max(biggest, Math.abs(amount - previous));
        assert.ok(falling ? amount <= previous + 1e-9 : amount >= previous - 1e-9, `${hour}: no oscila`);
      }
      previous = amount; low = Math.min(low, amount); high = Math.max(high, amount);
    }
    assert.deepEqual([low, high], [0, 1], 'recorre todo el fundido');
    assert.ok(biggest < .05, `de un segundo al siguiente cambia ${biggest}`);
    assert.equal(manager.scene.environment, marker);
  }
});
