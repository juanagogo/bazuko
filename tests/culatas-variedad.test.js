import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

const { planCulatas, material, SIN_REPETIR } = await import('../src/world/bogota/Culatas.js');
const { PIEZAS, TEXTOS } = await import('../src/world/bogota/culatasAtlas.js');

const PRINCIPALES = ['mural', 'aviso', 'tapada'];

test('hay un segundo juego de avisos de barrio, con la cal vieja tapando uno de antes', () => {
  for (const nombre of ['parquear', 'casa', 'soldadura', 'modista', 'bazar', 'encalada']) {
    assert.ok(PIEZAS[nombre], `falta ${nombre}`);
    assert.ok(TEXTOS[nombre]?.length === 2, `sin texto: ${nombre}`);
  }
  assert.equal(PIEZAS.encalada.tipo, 'tapada');
  const avisos = Object.keys(PIEZAS).filter((nombre) => ['aviso', 'tapada'].includes(PIEZAS[nombre].tipo));
  assert.ok(avisos.length >= 9, `avisos: ${avisos.length}`);
});

test('la misma pieza no sale dos veces a menos de 80 metros', () => {
  assert.equal(SIN_REPETIR, 80);
  // Una cuadrícula de casas sueltas con un costado ciego a la vista: todas piden pieza.
  const lotes = [];
  for (let i = 0; i < 14; i++) for (let k = 0; k < 12; k++) {
    const x0 = i * 24, z0 = k * 24;
    lotes.push({ x0, x1: x0 + 11, z0, z1: z0 + 11, alto: 9 + (i + k) % 3, ciegas: [0] });
  }
  const piezas = planCulatas(lotes).filter((pieza) => PRINCIPALES.includes(PIEZAS[pieza.nombre].tipo));
  assert.ok(piezas.length >= 60, `piezas: ${piezas.length}`);
  assert.ok(new Set(piezas.map((pieza) => pieza.nombre)).size >= 11);
  piezas.forEach((a, i) => piezas.slice(i + 1).forEach((b) => {
    if (a.nombre === b.nombre) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= SIN_REPETIR - 1, `${a.nombre} repetido a ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(1)} m`);
  }));
});

test('de noche la cal no brilla más que un muro: la pintura clara tiene tope y sigue el campo de sol', () => {
  const pintura = material();
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  pintura.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /#include <map_fragment>\s*diffuseColor\.rgb = min\(diffuseColor\.rgb, vec3\(\.4, \.37, \.33\)\);/);
  assert.match(shader.fragmentShader, /sunFieldLit/);
  assert.ok(pintura.userData.sunFieldChained);
});
