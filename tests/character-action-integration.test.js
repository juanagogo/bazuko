import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRealisticCharacter } from '../src/character/RealisticCharacter.js';
import { createCharacter } from '../src/character/character.js';
import { CHARACTER_SCALE } from '../src/utils/constants.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const originalFetch = globalThis.fetch;
const sources = new Map();

test.before(() => {
  mock.method(globalThis, 'fetch', (url, ...rest) => url === '/models/personaje/catalogo.json'
    ? Promise.resolve(new Response(readFileSync(path.join(models, 'personaje/catalogo.json'))))
    : originalFetch(url, ...rest));
  mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
    const file = path.join(models, url.replace(/^\/models\//, ''));
    const parser = new GLTFLoader();
    parser.register(() => ({ name: 'CHECK_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    let result;
    if (file.endsWith('.glb')) {
      const bytes = readFileSync(file);
      result = await parser.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    } else {
      const json = JSON.parse(readFileSync(file));
      json.extensionsUsed = (json.extensionsUsed ?? []).filter(name => name !== 'EXT_texture_webp');
      json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
      for (const texture of json.textures ?? []) {
        texture.source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
        delete texture.extensions;
      }
      for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + readFileSync(path.join(path.dirname(file), buffer.uri)).toString('base64');
      result = await parser.parseAsync(JSON.stringify(json), '');
    }
    if (file.endsWith('/cuerpo.gltf')) sources.set(result.scene, bonePose(result.scene));
    return result;
  });
});
test.after(() => mock.restoreAll());

function bonePose(root) {
  const pose = {};
  root.traverse(bone => {
    if (bone.isBone) pose[bone.name] = [...bone.position.toArray(), ...bone.quaternion.toArray()];
  });
  return pose;
}

function joint(root, name) {
  let found;
  root.traverse(bone => { if (bone.isBone && bone.name.endsWith(name)) found = bone; });
  assert.ok(found, name);
  return found;
}

test('salto y puñetazo se componen sobre el cuerpo vestido también con velocidad horizontal', async () => {
  const character = await createRealisticCharacter();
  const { group } = character;
  const rightArm = joint(group, 'RightArm');
  const rightHand = joint(group, 'RightHand');
  const rightLeg = joint(group, 'RightLeg');
  const rightThigh = joint(group, 'RightUpLeg');
  for (let frame = 0; frame < 60; frame++) character.update(1 / 60, { speed: 3, movement: { grounded: true } });
  character.update(1 / 60, { speed: 3, action: 'saltar', movement: { grounded: false, verticalVelocity: 3, airTime: .2 } });
  const thighDirection = rightLeg.getWorldPosition(new THREE.Vector3()).sub(rightThigh.getWorldPosition(new THREE.Vector3())).normalize();
  assert.ok(thighDirection.z > .7, 'las rodillas apuntan al frente durante despegue aun corriendo');
  character.update(1 / 60, { speed: 3, action: 'golpear', actionProgress: .22 / .58, movement: { grounded: true } });
  const hand = rightHand.getWorldPosition(new THREE.Vector3());
  const shoulder = rightArm.getWorldPosition(new THREE.Vector3());
  assert.ok(hand.z - shoulder.z > .3, 'el puño se extiende hacia delante al llegar el impacto');
  assert.deepEqual(group.position.toArray(), [0, 0, 0], 'ninguna pose desplaza la raíz física');
  for (const [source, original] of sources) assert.deepEqual(bonePose(source), original, 'el banco permanece intacto');
  const bones = new Set();
  group.traverse(object => { if (object.isBone) bones.add(object); });
  group.traverse(object => {
    if (object.isSkinnedMesh) assert.ok(object.skeleton.bones.every(bone => bones.has(bone)), 'ropa y cuerpo comparten huesos de esta instancia');
  });
  character.dispose();
});

test('nadar deja de caminar, vuelve a tierra y los NPC LOD muestran el golpe recibido', async () => {
  const character = await createRealisticCharacter();
  const hips = joint(character.group, 'Hips');
  character.update(.2, { speed: 0 });
  const standing = hips.quaternion.clone();
  for (let frame = 0; frame < 20; frame++) character.update(1 / 60, { speed: 2, movement: { swimming: true, waterDepth: 1.5, surfaceY: 1.05 } });
  assert.ok(hips.quaternion.angleTo(standing) > .7, 'el cuerpo se orienta para nadar');
  assert.ok(joint(character.group, 'Head').getWorldPosition(new THREE.Vector3()).y > 1.1, 'la cara queda sobre el agua al flotar los pies 1.05 m bajo la superficie');
  for (let frame = 0; frame < 60; frame++) character.update(1 / 60, { speed: 0, movement: { grounded: true } });
  assert.ok(hips.quaternion.angleTo(standing) < .15, 'no queda inclinación de agua al salir');
  const npc = await createRealisticCharacter({}, { lod: true });
  const chest = joint(npc.group, 'Spine2');
  npc.update(0, { speed: 0 });
  const before = chest.quaternion.clone();
  npc.update(0, { speed: 0, action: 'recibirGolpe', actionProgress: .2 });
  assert.ok(chest.quaternion.angleTo(before) > .2, 'la reacción funciona también en el modelo liviano');
  character.dispose(); npc.dispose();
});

test('el personaje procedural recibe salto y nado con el mismo contrato de movimiento', () => {
  const character = createCharacter();
  character.group.scale.setScalar(CHARACTER_SCALE);
  character.update(.2, { speed: 3 });
  const before = character.ragdollRig.rightLeg.quaternion.clone();
  character.update(.1, { speed: 3, action: 'saltar', movement: { grounded: false, verticalVelocity: 4, airTime: .2 } });
  assert.ok(character.ragdollRig.rightLeg.quaternion.angleTo(before) > .15);
  for (let frame = 0; frame < 20; frame++) character.update(1 / 60, { speed: 2, movement: { swimming: true, surfaceY: 1.05 } });
  assert.ok(Math.abs(character.ragdollRig.hips.rotation.x) > .7);
  assert.ok(character.ragdollRig.head.getWorldPosition(new THREE.Vector3()).y > 1.1, 'el modelo liviano mantiene la cara sobre el agua');
  assert.deepEqual(character.group.position.toArray(), [0, 0, 0]);
});

test('la estatura corta personalizada mantiene cabeza fuera del agua sin elevar la raíz física', () => {
  const character = createCharacter({ estatura: .92 });
  for (let frame = 0; frame < 30; frame++) character.update(1 / 60, { speed: 2.6, movement: { swimming: true, surfaceY: 1.05 } });
  assert.ok(character.ragdollRig.head.getWorldPosition(new THREE.Vector3()).y > 1.1);
  assert.deepEqual(character.group.position.toArray(), [0, 0, 0]);
  for (let frame = 0; frame < 60; frame++) character.update(1 / 60, { speed: 0, movement: { grounded: true } });
  assert.ok(Math.abs(character.ragdollRig.hips.position.y - .52) < .01, 'al salir no queda elevación de la pelvis');
});

test('ambos modelos muestran armas y ocultan objetos ocupados al nadar', async () => {
  for (const character of [createCharacter(), await createRealisticCharacter()]) {
    character.setWeapon('cuchillo'); character.setSmoking(true); character.setBasuco(true);
    const knife = character.group.getObjectByName('weapon-cuchillo');
    const cigarette = character.group.getObjectByName('prop-cigarrillo');
    const pipe = character.group.getObjectByName('prop-pipa');
    assert.ok(knife && cigarette && pipe);
    character.update(.1, { action: 'basuco', basuco: 2 });
    assert.equal(pipe.visible, true); assert.equal(knife.visible, false); assert.equal(cigarette.visible, false);
    character.update(.1, { speed: 2, movement: { swimming: true, surfaceY: 1.05 }, basuco: 2, smoke: { puff: 1 } });
    for (const object of [knife, cigarette, pipe]) assert.equal(object.visible, false);
    character.update(.1, { speed: 0, movement: { grounded: true } });
    assert.equal(knife.visible, true);
    character.dispose();
  }
});

test('cambiar de ropa sosteniendo la pipa libera su geometría propia y conserva la compartida', async () => {
  const character = await createRealisticCharacter();
  character.setWeapon('cuchillo'); character.setSmoking(true); character.setBasuco(true);
  const own = new Set(), shared = new Set();
  for (const name of ['prop-pipa', 'prop-encendedor']) character.group.getObjectByName(name).traverse(object => { if (object.geometry) own.add(object.geometry); });
  for (const name of ['weapon-cuchillo', 'prop-cigarrillo']) character.group.getObjectByName(name).traverse(object => { if (object.geometry) shared.add(object.geometry); });
  let freed = 0, sharedFreed = 0;
  for (const geometry of own) geometry.addEventListener('dispose', () => freed++);
  for (const geometry of shared) geometry.addEventListener('dispose', () => sharedFreed++);
  await character.setLook({ piel: 3 });
  assert.equal(freed, own.size);
  assert.equal(sharedFreed, 0);
  assert.ok(character.group.getObjectByName('prop-pipa'), 'se vuelve a equipar sobre el cuerpo nuevo');
  character.dispose(); character.dispose();
  assert.equal(freed, own.size);
  assert.equal(sharedFreed, 0);
});

test('NPC LOD conserva arma y gesto de señalar; el golpe por fases llega al impacto', async () => {
  const npc = await createRealisticCharacter({}, { lod: true });
  npc.setWeapon('pistola');
  const arm = joint(npc.group, 'LeftArm');
  npc.update(0, {}); const original = arm.quaternion.clone();
  for (let frame = 0; frame < 30; frame++) npc.update(1 / 60, { point: 1 });
  assert.ok(arm.quaternion.angleTo(original) > .7);
  assert.ok(npc.group.getObjectByName('weapon-pistola'));
  npc.update(1 / 60, { action: 'golpear', actionProgress: .1, attack: { weapon: 'punos', step: 1, phase: 'active', progress: 0 } });
  const hand = joint(npc.group, 'RightHand').getWorldPosition(new THREE.Vector3());
  const shoulder = joint(npc.group, 'RightArm').getWorldPosition(new THREE.Vector3());
  assert.ok(hand.z - shoulder.z > .3, 'el impacto no espera el filtro de suavizado');
  npc.dispose();
});
