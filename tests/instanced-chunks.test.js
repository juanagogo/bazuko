import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { instanceModelByCells } from '../src/graphics/InstancedChunks.js';

const lampModel = () => {
  const root = new THREE.Group();root.scale.set(2, 1, 1);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(.2, 4, .2), new THREE.MeshStandardMaterial());
  pole.position.set(.5, 2, 0);pole.castShadow = pole.receiveShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(.4, .2, .4), new THREE.MeshBasicMaterial());
  head.position.set(1, 4, 0);
  root.add(pole, head);
  return root;
};
const at = (x, z) => new THREE.Matrix4().makeTranslation(x, .2, z);

test('las copias de un modelo se agrupan por celda y malla, compartiendo geometría y material', () => {
  const model = lampModel(), pole = model.children[0];
  const group = instanceModelByCells(model, [at(1, 1), at(30, 10), at(100, 0)], { cell: 64 });
  assert.equal(group.children.length, 4, 'dos celdas × dos mallas');
  assert.equal(group.userData.noMerge, true);
  const poles = group.children.filter(chunk => chunk.geometry === pole.geometry);
  assert.deepEqual(poles.map(chunk => chunk.count).sort(), [1, 2]);
  for (const chunk of poles) {
    assert.equal(chunk.isInstancedMesh, true);
    assert.equal(chunk.material, pole.material);
    assert.equal(chunk.castShadow, true);assert.equal(chunk.receiveShadow, true);
    assert.ok(chunk.boundingSphere, 'cada celda se descarta por su propia esfera');
  }
});

test('cada instancia queda donde estaba la copia con su modelo, incluida la escala de la raíz', () => {
  const model = lampModel(), head = model.children[1];
  const lamp = new THREE.Group();lamp.position.set(30, .2, 10);
  const copy = model.clone(true);lamp.add(copy);lamp.updateMatrixWorld(true);
  const expected = new THREE.Vector3().setFromMatrixPosition(copy.children[1].matrixWorld);
  const group = instanceModelByCells(model, [at(1, 1), lamp.matrixWorld.clone()], { cell: 64 });
  const chunk = group.children.find(c => c.geometry === head.geometry);
  const matrix = new THREE.Matrix4();chunk.getMatrixAt(1, matrix);
  const actual = new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.ok(actual.distanceTo(expected) < 1e-6, `${actual.toArray()} ≠ ${expected.toArray()}`);
  assert.equal(new THREE.Vector3().setFromMatrixScale(matrix).x, 2);
});
