import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildLakeTerrain, LAKE_TERRAIN, lakeTerrainHeight } from '../src/world/bogota/LakePark.js';
import { createLakeShoreMaterial, createLakeShoreDetail, lakePavingBlend, LAKE_PAVING_EDGE } from '../src/world/bogota/LakeShoreMaterials.js';

const indexAt = (x, z) => (z - LAKE_TERRAIN.z0) * (LAKE_TERRAIN.x1 - LAKE_TERRAIN.x0 + 1) + x - LAKE_TERRAIN.x0;
const dispose = mesh => { mesh.geometry.dispose(); mesh.material.dispose(); };

test('el acabado de ribera no cambia vértices, índices, alturas ni la consulta física', () => {
  const land = (x, z) => z > 287 ? .14 : .06;
  const plain = buildLakeTerrain(land), detailed = buildLakeTerrain(land, {
    groundMap: new THREE.Texture(), plazaMap: new THREE.Texture(), groundTint: '#c2c7ac', plazaTint: '#cac8bd'
  });
  assert.deepEqual(detailed.geometry.attributes.position.array, plain.geometry.attributes.position.array);
  assert.deepEqual(detailed.geometry.index.array, plain.geometry.index.array);
  assert.equal(detailed.children.length, 0, 'el acabado no añade props ni obstáculos');
  const p = detailed.geometry.attributes.position, layers = detailed.geometry.attributes.lakeLayers;
  for (let i = 0; i < p.count; i++) {
    assert.ok(Math.abs(p.getY(i) - lakeTerrainHeight(p.getX(i), p.getZ(i), land)) < 1e-5);
    for (let component = 0; component < 3; component++) {
      const value = layers.array[i * 3 + component];
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    }
  }
  dispose(plain); dispose(detailed);
});

test('la línea húmeda, la grava y el césped se separan sin romper el material del borde', () => {
  const groundTint = new THREE.Color('#c2c7ac'), plazaTint = new THREE.Color('#cac8bd');
  const terrain = buildLakeTerrain(() => .06, { groundMap: new THREE.Texture(), groundTint });
  const layers = terrain.geometry.attributes.lakeLayers, colors = terrain.geometry.attributes.color;
  const waterline = indexAt(125, 262), bank = indexAt(126, 262), edge = indexAt(129, 262);
  assert.ok(layers.getZ(waterline) > .95, 'lodo húmedo junto al agua');
  assert.ok(layers.getY(bank) > .1, 'grava en el talud exterior');
  assert.equal(layers.getX(edge), 1, 'césped en el borde del parque');
  assert.equal(layers.getZ(edge), 0);
  for (const [component, value] of groundTint.toArray().entries()) assert.ok(Math.abs(colors.array[edge * 3 + component] - value) < 1e-6);
  const promenade = buildLakeTerrain(() => .14, { groundMap: new THREE.Texture(), groundTint, plazaMap: new THREE.Texture(), plazaTint });
  const pavedColors = promenade.geometry.attributes.color;
  for (const [component, value] of groundTint.toArray().entries()) assert.ok(Math.abs(pavedColors.array[edge * 3 + component] - value) < 1e-6,
    'el color de vértice no introduce piedra blanca en el césped');
  assert.ok(promenade.material.userData.uniforms.lakePlazaTint.value.equals(plazaTint));
  assert.equal(promenade.geometry.attributes.lakePlaza.getX(edge), 1);
  dispose(terrain); dispose(promenade);
});

test('el borde de las lajas mezcla solo 10–14 cm y la irregularidad no forma un halo de un metro', () => {
  const width = LAKE_PAVING_EDGE.end - LAKE_PAVING_EDGE.start;
  assert.ok(width <= .15 && width >= .1);
  assert.ok(width / Math.SQRT2 >= .09);
  for (const grain of [0, .3, .65, 1]) {
    assert.equal(lakePavingBlend(.4, grain), 0);
    assert.equal(lakePavingBlend(.6, grain), 1);
  }
  assert.ok(lakePavingBlend(.5) > .4 && lakePavingBlend(.5) < .6);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  const material = createLakeShoreMaterial(); material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('diffuse * lakePlazaTint * lakePavingAlbedo, lakePavingMix'));
  assert.equal(shader.fragmentShader.includes('0.84, vLakePlaza'), false);
  material.dispose();
});

test('detalle y variación espacial son deterministas y comparten una sola pasada', () => {
  const a = buildLakeTerrain(), b = buildLakeTerrain();
  assert.deepEqual(a.geometry.attributes.color.array, b.geometry.attributes.color.array);
  assert.deepEqual(a.geometry.attributes.lakeLayers.array, b.geometry.attributes.lakeLayers.array);
  const textureA = createLakeShoreDetail(), textureB = createLakeShoreDetail();
  assert.deepEqual(textureA.image.data, textureB.image.data);
  assert.equal(textureA.image.width, 128); assert.equal(textureA.image.height, 128);
  assert.equal(textureA.colorSpace, THREE.NoColorSpace);
  assert.equal(a.material.isMeshStandardMaterial, true); assert.equal(Array.isArray(a.material), false);
  assert.equal(a.material.transparent, false); assert.equal(a.material.displacementMap, null);
  dispose(a); dispose(b); textureA.dispose(); textureB.dispose();
});

test('el shader conserva luces, niebla y salidas PBR; mezcla los mapas con cinco lecturas como máximo', () => {
  const material = createLakeShoreMaterial({ groundMap: new THREE.Texture(), plazaMap: new THREE.Texture(),
    groundBumpMap: new THREE.Texture(), plazaBumpMap: new THREE.Texture() });
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  for (const chunk of ['<lights_fragment_begin>', '<tonemapping_fragment>', '<colorspace_fragment>', '<fog_fragment>']) {
    assert.ok(shader.fragmentShader.includes(chunk));
  }
  assert.ok(shader.vertexShader.includes('vLakeXZ = position.xz;'));
  assert.equal(shader.vertexShader.includes('transformed.y +='), false);
  assert.ok(shader.fragmentShader.includes('perturbNormalArb'));
  assert.ok(shader.fragmentShader.includes('lakeDryRoughness'));
  assert.equal((shader.fragmentShader.match(/texture2D\(/g) ?? []).length, 5);
  assert.deepEqual(shader.uniforms.lakeSurfaceScale.value.toArray(), [8, 6]);
  material.dispose();
});

test('dispose libera el detalle propio una sola vez y conserva las texturas compartidas del parque', () => {
  const shared = Array.from({ length: 4 }, () => new THREE.Texture());
  let sharedDisposals = 0, ownDisposals = 0;
  for (const map of shared) map.addEventListener('dispose', () => sharedDisposals++);
  const material = createLakeShoreMaterial({ groundMap: shared[0], groundBumpMap: shared[1], plazaMap: shared[2], plazaBumpMap: shared[3] });
  material.userData.uniforms.lakeShoreDetail.value.addEventListener('dispose', () => ownDisposals++);
  material.dispose(); material.dispose();
  assert.equal(ownDisposals, 1); assert.equal(sharedDisposals, 0);
  for (const map of shared) map.dispose();
});
