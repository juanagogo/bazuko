import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeSceneGroup, lam } from '../src/utils/entityHelpers.js';
import { percentile } from '../src/utils/percentile.js';

test('percentile conserva nearest-rank y el resultado vacío', () => {
  assert.equal(percentile([], .95), 0);
  assert.equal(percentile([10, 20, 30, 40], .5), 20);
  assert.equal(percentile([10, 20, 30, 40], .95), 40);
});

test('la fábrica Lambert conserva sus opciones y la limpieza libera recursos del grupo', () => {
  const material = lam(0xff0000);
  assert.ok(material instanceof THREE.MeshLambertMaterial);
  assert.equal(material.flatShading, true);

  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const meshMaterial = new THREE.MeshLambertMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, meshMaterial);
  group.add(mesh);
  scene.add(group);
  let geometryDisposals = 0, textureDisposals = 0, materialDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  meshMaterial.addEventListener('dispose', () => materialDisposals++);

  disposeSceneGroup(scene, group);
  assert.equal(group.parent, null);
  assert.equal(geometryDisposals, 1);
  assert.equal(textureDisposals, 1);
  assert.equal(materialDisposals, 1);

  material.dispose();
});
