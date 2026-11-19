import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { LAKE_PARK, LAKE_LOOKOUTS, buildLakeTerrain, buildLakeWater, lakeWaterInfo, lakeTerrainHeight } from '../src/world/bogota/LakePark.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { createLakeWaterMaterial } from '../src/world/bogota/LakeWaterMaterial.js';
import { freezeStaticTransforms } from '../src/world/bogota/StaticGeometry.js';
import { buildColpatriaViaduct } from '../src/world/bogota/ColpatriaViaduct.js';

test('la orilla es vadeable y el centro tiene seis metros de profundidad continua', () => {
  assert.equal(lakeWaterInfo(0, 0), null);
  const center = lakeWaterInfo(75, 262);
  assert.equal(center.depth, 6);
  assert.equal(center.bottomY, center.surfaceY - 6);
  const shore = lakeWaterInfo(122.5, 262);
  const middle = lakeWaterInfo(115, 262);
  assert.ok(shore.depth > 0 && shore.depth < .3);
  assert.ok(middle.depth > 1.2 && middle.depth < 1.5);
  let previous = lakeTerrainHeight(129, 262);
  for (let x = 128.9; x >= 75; x -= .1) {
    const next = lakeTerrainHeight(x, 262);
    assert.ok(Math.abs(next - previous) < .06, `salto del terreno en x=${x}`);
    assert.ok(next <= previous + 1e-7, 'la cubeta se profundiza sin peldaños al entrar');
    previous = next;
  }
  assert.equal(lakeTerrainHeight(129, 262), .06);
});

test('las consultas de profundidad coinciden con los triángulos reales del lecho y banco', () => {
  const terrain = buildLakeTerrain();
  const waterSurface = buildLakeWater();
  const ground = terrain.geometry.getAttribute('position');
  const waterDepth = waterSurface.geometry.getAttribute('lakeDepth');
  for (let i = 0; i < ground.count; i++) {
    assert.ok(Math.abs(waterDepth.getX(i) - (LAKE_PARK.surfaceY - ground.getY(i))) < 1e-6);
  }
  assert.ok(waterDepth.array.some(depth => depth < 0), 'la interpolación conserva la cota del banco seco');
  terrain.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  for (const [x, z] of [[75, 262], [122.5, 262], [25.25, 263.8], [75.3, 236.1], [103.6, 281.2], [126.3, 262]]) {
    ray.ray.origin.set(x, 10, z);
    const hit = ray.intersectObject(terrain)[0];
    assert.ok(hit, `falta lecho en ${x},${z}`);
    assert.ok(Math.abs(hit.point.y - lakeTerrainHeight(x, z)) < 1e-5);
    const water = lakeWaterInfo(x, z);
    if (water) assert.ok(Math.abs(water.surfaceY - hit.point.y - water.depth) < 1e-5);
  }
  assert.ok(terrain.geometry.boundingBox.min.y < -6);
  terrain.geometry.dispose(); terrain.material.dispose();
  waterSurface.traverse(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
});

test('el jugador consulta el lecho bajo el puente y conserva el tablero al caminar encima', () => {
  const city = new Bogota(); city.map = city._layout();
  const x = 78.5, z = 262;
  const info = city.getWaterInfo(x, z);
  assert.ok(info.depth > 5);
  const below = city.getPlayerGroundSurface(x, z, {
    from: new THREE.Vector3(x, -.5, z), grounded: false, surface: { layer: 'ground' }
  });
  const above = city.getPlayerGroundSurface(x, z, {
    from: new THREE.Vector3(x, 7.82, z), grounded: true, surface: { layer: 'viaduct' }
  });
  assert.equal(below.height, info.bottomY);
  assert.equal(below.layer, 'ground');
  assert.ok(Math.abs(above.height - 7.82) < 1e-7);
  assert.equal(above.layer, 'viaduct');
  assert.equal(city.getMovementGroundHeight(x, z, -.5), info.bottomY);
  assert.ok(Math.abs(city.getGroundHeight(x, z) - 7.82) < 1e-7);
});

test('el agua anima uniformes sin modificar geometría y no avanza con dt cero', () => {
  const water = buildLakeWater();
  const attributes = Object.values(water.geometry.attributes);
  const versions = attributes.map(attribute => attribute.version);
  const material = water.material;
  const root = new THREE.Group(); root.add(water);
  freezeStaticTransforms(root);
  assert.equal(water.matrixWorldAutoUpdate, true, 'la raíz dinámica sobrevive al congelado de la ciudad');
  water.userData.update(.5);
  assert.equal(material.userData.uniforms.lakeTime.value, .5);
  water.userData.update(0);
  water.userData.update(-1);
  assert.equal(material.userData.uniforms.lakeTime.value, .5);
  assert.deepEqual(attributes.map(attribute => attribute.version), versions);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.forceSinglePass, true);
  assert.ok(water.geometry.getAttribute('lakeDepth').array.some(value => value > 5));
  water.geometry.dispose(); material.dispose();
});

test('las ondas y la profundidad conservan el shader PBR de Three y sus salidas de color', () => {
  const material = createLakeWaterMaterial();
  const shader = {
    uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.lakeTime, material.userData.uniforms.lakeTime);
  assert.ok(shader.vertexShader.includes('attribute float lakeDepth;'));
  assert.ok(shader.vertexShader.includes('transformed.y +='));
  assert.ok(shader.fragmentShader.includes('lakeDepthBlend'));
  for (const chunk of ['<lights_physical_fragment>', '<tonemapping_fragment>', '<colorspace_fragment>', '<fog_fragment>']) {
    assert.ok(shader.fragmentShader.includes(chunk), `falta ${chunk}`);
  }
  assert.ok(shader.fragmentShader.includes('directLight.color *= sunFieldLit'), 'el reflejo solar responde a la sombra del puente');
  assert.equal(LAKE_PARK.surfaceY, -.18);
  material.dispose();
});

test('los pilares del lago llegan al lecho sin mover su techo, huella ni rampas', () => {
  const city = new Bogota(); city.map = city._layout();
  const original = buildColpatriaViaduct(city.map);
  const deep = buildColpatriaViaduct(city.map, { groundHeight: (x, z) => city.getWaterInfo(x, z)?.bottomY ?? 0 });
  const originalPillars = original.children.filter(mesh => mesh.name === 'Pilar');
  const deepPillars = deep.children.filter(mesh => mesh.name === 'Pilar');
  assert.equal(deepPillars.length, originalPillars.length);
  let submerged = 0;
  for (let i = 0; i < deepPillars.length; i++) {
    const before = new THREE.Box3().setFromObject(originalPillars[i]);
    const after = new THREE.Box3().setFromObject(deepPillars[i]);
    for (const axis of ['x', 'z']) {
      assert.equal(after.min[axis], before.min[axis]);
      assert.equal(after.max[axis], before.max[axis]);
    }
    assert.ok(Math.abs(after.max.y - before.max.y) < 1e-6);
    const p = deepPillars[i].position, water = city.getWaterInfo(p.x, p.z);
    if (water) {
      submerged++;
      assert.ok(Math.abs(after.min.y - water.bottomY) < 1e-6);
      const point = new THREE.Vector3(p.x, water.bottomY + .05, p.z);
      assert.ok(deep.userData.colliders.some(box => box.containsPoint(point)));
    } else assert.deepEqual(after, before);
  }
  assert.ok(submerged >= 2);
  const deck = root => root.children.filter(mesh => ['Superficie del puente', 'Tablero de concreto'].includes(mesh.name));
  const beforeDeck = deck(original), afterDeck = deck(deep);
  assert.equal(beforeDeck.length, afterDeck.length);
  for (let i = 0; i < beforeDeck.length; i++) {
    assert.deepEqual(afterDeck[i].geometry.attributes.position.array, beforeDeck[i].geometry.attributes.position.array);
  }
  for (const root of [original, deep]) {
    const materials = new Set();
    root.traverse(mesh => { mesh.geometry?.dispose(); if (mesh.material) materials.add(mesh.material); });
    for (const material of materials) material.dispose();
  }
});

test('desde el andén de la Carrera 5 se llega por adoquín hasta las bancas y el anillo oriental del lago', () => {
  const city = new Bogota(), map = city._layout();
  const entrance = [125, LAKE_PARK.lakeZ / 2];
  assert.equal(map[entrance[1]][entrance[0] + 1], 'sidewalk');
  assert.equal(map[entrance[1]][entrance[0]], 'plaza');
  const queue = [entrance], visited = new Set([entrance.join(',')]);
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
      const key = nx + ',' + nz;
      if (map[nz]?.[nx] === 'plaza' && !visited.has(key)) {
        queue.push([nx, nz]);
        visited.add(key);
      }
    }
  }
  for (const { x, z } of LAKE_LOOKOUTS.filter(seat => seat.x > LAKE_PARK.lakeX)) {
    assert.ok(visited.has((x / 2) + ',' + (z / 2)), 'la banca está en un ensanche conectado al paseo');
  }
  assert.ok(visited.has('58,121') && visited.has('58,141'), 'el paseo alcanza ambos arcos de la ribera');
});
