import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FAR_ACCESSORIES, attachStreetProps, createCane, createClosedStick, createPhone, createUmbrella, isStreetProp, sharedPropMaterial } from '../src/character/props.js';
import { CaneMotion } from '../src/character/CaneMotion.js';
import { disposeRealisticInstance } from '../src/character/RealisticCharacter.js';
import { streetWetness } from '../src/character/streetMaterials.js';

const LLEVA = ['maletin', 'bolsa', 'baston-calle', 'morral', 'bolso', 'costal', 'casco', 'bufanda'];

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

test('el morral usa la misma paleta de tela y herrajes en ambas tallas', () => {
  const pack = (sexo, color) => {
    const { root, bones, holds } = skeleton();
    return attachStreetProps(root, bones, [{ id: 'morral', color }], holds, sexo)[0];
  };
  const man = pack('hombre', '#112233'), woman = pack('mujer', '#445566');
  assert.notEqual(man.geometry, woman.geometry);
  assert.ok(man.material.map.isDataTexture);
  assert.equal(man.material.map, woman.material.map);
  for (const mesh of [man, woman]) {
    const uv = mesh.geometry.attributes.uv;
    const swatches = new Set();
    for (let i = 0; i < uv.count; i++) swatches.add(uv.getX(i));
    assert.equal(swatches.size, 4);
  }
});

test('la bufanda apoya en el cuello, sigue el pecho y comparte geometría y lana', () => {
  const place = (sexo, color) => {
    const { root, bones, holds } = skeleton();
    const [mesh] = attachStreetProps(root, bones, [{ id: 'bufanda', color }], holds, sexo);
    return { mesh, spine: bones.get('mixamorig:Spine2') };
  };
  const { mesh: a, spine: spineA } = place('hombre', '#a4aabd');
  const { mesh: b, spine: spineB } = place('mujer', '#788d9a');
  assert.equal(a.parent, spineA);
  assert.equal(b.parent, spineB);
  assert.ok(Math.abs(a.getWorldPosition(new THREE.Vector3()).y - 1.45) < 1e-5);
  assert.equal(a.geometry, b.geometry);
  assert.equal(a.material.map, b.material.map);
  assert.ok(a.material.map.generateMipmaps);
  a.geometry.computeBoundingBox();
  assert.ok(a.geometry.boundingBox.max.y < .04, 'queda bajo la mandíbula');
  assert.ok(a.geometry.boundingBox.min.y > -.2, 'las puntas se recogen en el pecho');
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
  assert.ok(Math.abs(cane.geometry.boundingBox.min.y * cane.scale.y + .96) < .01, 'el largo alcanza aunque apoye inclinado');
});

test('madera y contera del bastón se comparten entre la mano y el piso', () => {
  const { root, bones, holds } = skeleton();
  const color = '#5f452e';
  const [held] = attachStreetProps(root, bones, [{ id: 'baston-calle', color }], holds);
  const dropped = createCane(color), umbrella = createClosedStick(1);
  assert.equal(held.geometry, dropped.geometry);
  assert.equal(held.material, dropped.material);
  assert.ok(held.material.map.generateMipmaps);
  assert.ok(held.material.roughnessMap.isDataTexture);
  assert.notEqual(umbrella.geometry, held.geometry);
  assert.equal(umbrella.geometry.attributes.uv, undefined, 'el paraguas cerrado conserva su geometría lisa');
});

test('el bastón pisa, se eleva con el paso y conserva el punto de agarre con distintas tallas', () => {
  for (const height of [.94, 1.05]) {
    const { root, bones, holds } = skeleton();
    root.scale.set(.97, height, 1.03);
    root.rotation.y = .56;
    root.position.y = .12;
    const walk = holds['cargar-derecha'];
    const run = { ...walk, position: new THREE.Vector3(0, .4, .03),
      quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2) };
    const [cane] = attachStreetProps(root, bones, [{ id: 'baston-calle', color: '#5f452e' }], holds);
    const motion = new CaneMotion(cane, walk, run);
    const grip = () => cane.localToWorld(new THREE.Vector3(...cane.geometry.userData.grip));
    const tip = () => cane.localToWorld(new THREE.Vector3(0, -.8, 0));
    const gripBefore = grip();
    const update = (phase, options = {}, dt = .2) => motion.update(dt, {
      phase, speed: .75, running: false, active: true, rising: false, groundHeight: () => .12, yaw: .56, ...options
    });
    update(.2);
    assert.ok(Math.abs(tip().y - .126) < .008);
    assert.ok(grip().distanceTo(gripBefore) < 1e-6);
    update(.72);
    assert.ok(tip().y > .195);
    assert.ok(grip().distanceTo(gripBefore) < 1e-6);
    update(.13, { speed: 0 });
    assert.ok(Math.abs(tip().y - .126) < .008);

    bones.get(walk.boneName).position.y -= .25;
    update(.13, { speed: 0, rising: true });
    assert.ok(tip().y >= .12 && tip().y < .146, 'acompaña al cuerpo mientras se levanta');
    update(.144, { running: true }, 1 / 60);
    assert.ok(tip().y >= .12, 'mientras cambia de agarre tampoco atraviesa el piso');
    update(.31, { running: true });
    assert.deepEqual(cane.position.toArray(), run.position.toArray());
    assert.ok(cane.quaternion.angleTo(run.quaternion) < 1e-6);
  }
});

test('la mano acompaña el apoyo y la contera no atraviesa el piso al recoger el bastón', () => {
  const { root, bones, holds } = skeleton();
  const walk = holds['cargar-derecha'];
  const hand = bones.get(walk.boneName);
  const arm = new THREE.Bone(), forearm = new THREE.Bone();
  arm.name = 'RightArm'; forearm.name = 'RightForeArm';
  root.add(arm); arm.add(forearm); forearm.add(hand);
  arm.position.set(-.25, 1.48, 0);
  forearm.position.set(-.06, -.28, -.08);
  hand.position.set(-.02, -.29, .10);
  walk.height = .91;
  const color = '#5f452e';
  const [cane] = attachStreetProps(root, bones, [{ id: 'baston-calle', color }], holds);
  const motion = new CaneMotion(cane, walk, walk);
  const stance = { phase: .17, speed: .75, running: false, active: true, rising: false, groundHeight: () => 0, yaw: 0 };
  const tip = mesh => mesh.localToWorld(new THREE.Vector3(0, -.8, 0));
  motion.update(.2, stance);
  const plant = tip(cane);
  motion.restore();
  assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
  root.position.set(0, .018, .052);
  motion.update(.08, { ...stance, phase: .22 });
  assert.ok(tip(cane).distanceTo(plant) < .023, 'el cuerpo avanza sin arrastrar el apoyo');
  motion.restore();

  const picked = createCane(color);
  hand.add(picked);
  picked.position.y = -.32;
  const grip = () => picked.localToWorld(new THREE.Vector3(...picked.geometry.userData.grip));
  const before = grip();
  assert.ok(tip(picked).y < -.1, 'el giro interpolado lo habría hundido');
  motion.clearGround(picked, () => 0, 0);
  assert.ok(tip(picked).y >= 0 && tip(picked).y < .025);
  assert.ok(grip().distanceTo(before) < 1e-6);
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
  assert.equal(hat.geometry, man.geometry);
  assert.equal(man.parent, b.bones.get('mixamorig:Head'));
  assert.ok(man.material.map.generateMipmaps);
  man.geometry.computeBoundingBox();
  const { min, max } = man.geometry.boundingBox;
  assert.ok(max.z > .196 && max.z < .215, 'visera corta y saliente sobre la frente');
  assert.ok(max.z + min.z > .065, 'la visera avanza más que el ala de la nuca');
  assert.ok(min.y > .073 && max.y < .252, 'la visera encima de los ojos y la copa ceñida');
});

test('el paraguas y el celular son de todos: cada persona crea una malla y nada más', () => {
  const a = createUmbrella(0), b = createUmbrella(0), c = createUmbrella(1);
  assert.equal(a.geometry, b.geometry);
  assert.equal(a.material, b.material);
  assert.equal(a.geometry, c.geometry);
  assert.notEqual(a.material, c.material);
  assert.equal(a.material.userData.shared, true);
  assert.equal(a.material.side, THREE.FrontSide, 'por dentro son otras caras: DoubleSide pediría otro programa');
  assert.ok(a.geometry.index.count / 3 <= 900, 'paño y varillas en la misma malla');
  assert.ok(a.material.map?.generateMipmaps);
  assert.equal(a.material.roughnessMap, c.material.roughnessMap);
  assert.equal(a.material.roughnessMap, a.material.metalnessMap);
  assert.equal(a.material.customProgramCacheKey(), c.material.customProgramCacheKey());
  const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
  a.material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.uUmbrellaWet, streetWetness);
  assert.ok(a.material.userData.sunFieldChained);
  assert.ok(createUmbrella(99).material.isMaterial);
  const phone = createPhone(), other = createPhone();
  assert.equal(phone.geometry, other.geometry);
  assert.equal(phone.material, other.material);
  assert.equal(phone.material.userData.shared, true);
});
