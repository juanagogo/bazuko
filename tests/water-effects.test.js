import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { WaterEffects } from '../src/systems/WaterEffects.js';

const swimmer = () => ({ position: new THREE.Vector3(40, -1.23, 262), root: new THREE.Group(), speed: 2,
  waterFrame: { inWater: true, swimming: true, entered: true, entryIntensity: .8, intensity: .8, surfaceY: -.18 } });

test('entrada crea dos ondas y salpicaduras en un pool fijo sin luces ni texturas', () => {
  const scene = new THREE.Scene(), effects = new WaterEffects(scene), player = swimmer();
  effects.update(1 / 60, player);
  assert.equal(scene.children.length, 1); assert.equal(effects.group.parent, scene);
  assert.equal(effects.group.visible, true);
  assert.equal(effects.rings.count, 2); assert.ok(effects.drops.geometry.drawRange.count > 8);
  assert.equal(effects.rings.material.map, undefined);
  assert.equal(effects.rings.castShadow, false);
  assert.equal(effects.group.children.filter(object => object.isLight).length, 0);
  const matrix = new THREE.Matrix4(); effects.rings.getMatrixAt(0, matrix);
  assert.ok(matrix.elements[13] > player.waterFrame.surfaceY, 'la onda queda sobre el agua sin z-fighting');
  effects.dispose();
});

test('nadar produce estela acotada; salir deja disipar las gotas sin emitir más', () => {
  const effects = new WaterEffects(new THREE.Scene()), player = swimmer();
  for (let i = 0; i < 900; i++) {
    player.position.x += .03;
    effects.update(1 / 60, player);
    player.waterFrame.entered = false;
    assert.ok(effects.rings.count <= 16); assert.ok(effects.drops.geometry.drawRange.count <= 48);
  }
  assert.ok(effects.rings.count > 0);
  assert.equal(effects.drops.geometry.drawRange.count, 0, 'la entrada no se repite mientras nada');
  player.waterFrame.inWater = false;
  for (let i = 0; i < 180; i++) effects.update(1 / 60, player);
  assert.equal(effects.group.visible, false); assert.equal(effects.rings.count, 0);
  assert.equal(effects.drops.geometry.drawRange.count, 0);
  effects.dispose();
});

test('pausa conserva el fotograma, reset borra los efectos y dispose libera recursos una vez', () => {
  const scene = new THREE.Scene(), effects = new WaterEffects(scene), player = swimmer();
  effects.update(.016, player);
  const age = effects.ringPool[0].age, y = effects.dropPool[0].y;
  effects.update(0, player);
  assert.equal(effects.ringPool[0].age, age); assert.equal(effects.dropPool[0].y, y);
  effects.reset();
  assert.equal(effects.group.visible, false); assert.equal(effects.rings.count, 0);
  assert.equal(effects.drops.geometry.drawRange.count, 0);
  let disposed = 0;
  for (const resource of [effects.rings.geometry, effects.rings.material, effects.drops.geometry, effects.drops.material]) {
    resource.addEventListener('dispose', () => disposed++);
  }
  effects.dispose(); effects.dispose();
  assert.equal(disposed, 4); assert.equal(scene.children.length, 0);
});
