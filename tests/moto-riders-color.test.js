import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CLOTH, CLOTH_MIN_LUMA, SKIN_MIN_LUMA, liftDark, riderMaterial } from '../src/world/bogota/motoRiders.js';

const luma = color => color.r * .2126 + color.g * .7152 + color.b * .0722;

test('el color de instancia solo tiñe la parte de arriba: la piel, el pantalón y el calzado no heredan la ropa', () => {
  const shader = { vertexShader: '#include <begin_vertex>\n#include <color_vertex>\n' };
  riderMaterial().onBeforeCompile(shader);
  assert.ok(!shader.vertexShader.includes('#include <color_vertex>'), 'el chunk de three multiplica la instancia en todos los vértices');
  const lines = shader.vertexShader.split('\n');
  const tint = lines.findIndex(line => line.includes('instanceColor'));
  assert.ok(tint > 0 && /aPart > \.5 && aPart < 1\.5/.test(lines[tint]), 'la instancia se aplica solo si aPart es la parte de arriba');
});

test('ningún color de ropa es tan oscuro que la persona se lea como una sombra', () => {
  for (const rgb of CLOTH) {
    const lineal = new THREE.Color().setRGB(...rgb, THREE.SRGBColorSpace);
    assert.ok(luma(lineal) >= CLOTH_MIN_LUMA, `${rgb} queda en ${luma(lineal).toFixed(3)}`);
  }
});

test('lo muy oscuro se sube hasta el piso sin cambiar de tono, y lo claro queda igual', () => {
  const negro = liftDark(new THREE.Color(0, 0, 0), SKIN_MIN_LUMA);
  assert.ok(Math.abs(luma(negro) - SKIN_MIN_LUMA) < 1e-6);
  const azul = liftDark(new THREE.Color(.002, .004, .02));
  assert.ok(Math.abs(luma(azul) - CLOTH_MIN_LUMA) < 1e-6 && azul.b > azul.r);
  const claro = new THREE.Color(.5, .4, .3);
  assert.deepEqual(liftDark(claro.clone()).toArray(), claro.toArray());
});
