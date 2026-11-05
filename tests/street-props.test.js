import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FAR_ACCESSORIES, attachStreetProps, createPhone, createUmbrella, isStreetProp, sharedPropMaterial } from '../src/character/props.js';
import { disposeRealisticInstance } from '../src/character/RealisticCharacter.js';

const LLEVA = ['maletin', 'bolsa', 'baston-calle', 'morral', 'bolso', 'costal', 'casco'];

function skeleton() {
  const root = new THREE.Group();
  const bones = new Map();
  for (const [name, y] of [['mixamorig:Spine2', 1.2], ['mixamorig:Neck', 1.45], ['mixamorig:Head', 1.5], ['mixamorig:LeftHand', 1], ['mixamorig:RightHand', 1]]) {
    const bone = new THREE.Bone();
    bone.position.y = y;
    root.add(bone);
    bones.set(name, bone);
  }
  const hold = (boneName) => ({ boneName, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1), height: 1 });
  return { root, bones, holds: { 'cargar-izquierda': hold('mixamorig:LeftHand'), 'cargar-derecha': hold('mixamorig:RightHand') } };
}

test('cada accesorio es una sola malla, una sola llamada de dibujo, sin dos caras ni colores por vértice', () => {
  for (const id of LLEVA) {
    assert.ok(isStreetProp(id), id);
    const { root, bones, holds } = skeleton();
    const [mesh, ...rest] = attachStreetProps(root, bones, [{ id, color: '#223344' }], holds);
    assert.equal(rest.length, 0, id);
    assert.ok(mesh.isMesh, id);
    assert.equal(mesh.children.length, 0, id);
    assert.ok(!Array.isArray(mesh.material), id);
    assert.equal(mesh.material.side, THREE.FrontSide, id);
    assert.equal(mesh.material.vertexColors, false, id);
    assert.ok(!mesh.geometry.attributes.color, id);
    assert.ok(mesh.parent?.isBone, `${id} va en un hueso: nada se actualiza por cuadro`);
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    assert.ok(triangles < 900, `${id}: ${triangles} triángulos`);
  }
  assert.equal(isStreetProp('constructor'), false);
  assert.equal(isStreetProp('chaleco'), false);
  assert.equal(isStreetProp(undefined), false);
});

test('los accesorios que se notan de lejos los lleva también el modelo liviano', () => {
  for (const id of LLEVA) assert.ok(FAR_ACCESSORIES.has(id), id);
});

test('dos personas comparten geometría y material; solo un color distinto crea otro material', () => {
  const a = skeleton(), b = skeleton();
  const items = [{ id: 'morral', color: '#112233' }, { id: 'maletin', color: '#112233' }];
  const first = attachStreetProps(a.root, a.bones, items, a.holds);
  const second = attachStreetProps(b.root, b.bones, items, b.holds);
  assert.equal(first[0].geometry, second[0].geometry);
  assert.equal(first[1].geometry, second[1].geometry);
  assert.notEqual(first[0].geometry, first[1].geometry);
  assert.equal(first[0].material, second[0].material);
  assert.equal(first[1].material, second[1].material);
  assert.notEqual(first[0].material, first[1].material, 'cada accesorio con su aspereza');
  const [other] = attachStreetProps(a.root, a.bones, [{ id: 'morral', color: '#445566' }], a.holds);
  assert.equal(other.geometry, first[0].geometry);
  assert.notEqual(other.material, first[0].material);
  assert.equal(sharedPropMaterial('#112233', .3), sharedPropMaterial('#112233', .3));
});

test('liberar a una persona no destruye lo que los demás siguen usando', () => {
  const { root, bones, holds } = skeleton();
  const [mesh] = attachStreetProps(root, bones, [{ id: 'costal', color: '#b4aa92' }], holds);
  const own = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), own));
  let shared = 0, owned = 0, geometry = 0;
  mesh.material.addEventListener('dispose', () => { shared++; });
  mesh.geometry.addEventListener('dispose', () => { geometry++; });
  own.addEventListener('dispose', () => { owned++; });
  disposeRealisticInstance({ root, mixer: { stopAllAction() {}, uncacheRoot() {} }, ownedGeometries: [] });
  assert.equal(owned, 1, 'lo suyo sí se libera');
  assert.equal(shared, 0);
  assert.equal(geometry, 0);
});

test('lo que no se conoce o no tiene hueso se ignora sin romper a la persona', () => {
  const { root, bones, holds } = skeleton();
  assert.deepEqual(attachStreetProps(root, bones, [{ id: 'nada', color: '#111111' }], holds), []);
  assert.deepEqual(attachStreetProps(root, bones, [{ id: 'maletin', color: '#111111' }], null), [], 'sin marco de la mano no flota en el aire');
  assert.deepEqual(attachStreetProps(root, new Map(), [{ id: 'morral', color: '#111111' }], holds), []);
  assert.deepEqual(attachStreetProps(root, bones), []);
});

test('el bastón llega al piso sea cual sea el cuerpo', () => {
  const { root, bones, holds } = skeleton();
  holds['cargar-derecha'].height = .9;
  const [cane] = attachStreetProps(root, bones, [{ id: 'baston-calle', color: '#5f452e' }], holds);
  cane.geometry.computeBoundingBox();
  assert.ok(Math.abs(cane.geometry.boundingBox.min.y * cane.scale.y + .933) < .01, 'y un poco más, porque al andar la mano sube');
});

test('el casco y lo que va a la espalda se ajustan a cada cuerpo: se miden desde el cuello y la cabeza de mujer es menor', () => {
  const a = skeleton(), b = skeleton();
  const [back] = attachStreetProps(a.root, a.bones, [{ id: 'morral', color: '#111111' }], a.holds);
  a.root.updateMatrixWorld(true);
  back.updateMatrixWorld(true);
  const origin = back.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(origin.y - 1.45) < 1e-6, 'el origen queda en el cuello');
  assert.equal(back.parent, a.bones.get('mixamorig:Spine2'), 'pero se mueve con el pecho');
  const [hat] = attachStreetProps(b.root, b.bones, [{ id: 'casco', color: '#111111' }], b.holds, 'mujer');
  assert.ok(hat.scale.x < 1 && hat.scale.y < 1);
  const [man] = attachStreetProps(b.root, b.bones, [{ id: 'casco', color: '#111111' }], b.holds, 'hombre');
  assert.equal(man.scale.x, 1);
});

test('el paraguas y el celular son de todos: cada persona crea una malla y nada más', () => {
  const a = createUmbrella(0), b = createUmbrella(0), c = createUmbrella(1);
  assert.equal(a.geometry, b.geometry);
  assert.equal(a.material, b.material);
  assert.equal(a.geometry, c.geometry);
  assert.notEqual(a.material, c.material);
  assert.equal(a.material.userData.shared, true);
  assert.equal(a.material.side, THREE.FrontSide, 'por dentro son otras caras: DoubleSide pediría otro programa');
  assert.ok(createUmbrella(99).material.isMaterial);
  const phone = createPhone(), other = createPhone();
  assert.equal(phone.geometry, other.geometry);
  assert.equal(phone.material, other.material);
  assert.equal(phone.material.userData.shared, true);
});
