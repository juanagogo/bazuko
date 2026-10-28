import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createCombatPose } from '../src/character/CombatPose.js';
import { createCharacter } from '../src/character/character.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };

async function bodyModel(id, variant = '') {
  const folder = fileURLToPath(new URL(`../public/models/personaje/${id}/${variant}`, import.meta.url));
  const json = JSON.parse(fs.readFileSync(path.join(folder, 'cuerpo.gltf')));
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(name => name !== 'EXT_texture_webp');
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
  for (const texture of json.textures ?? []) {
    texture.source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    delete texture.extensions;
  }
  for (const buffer of json.buffers) {
    buffer.uri = 'data:application/octet-stream;base64,' + fs.readFileSync(path.join(folder, buffer.uri)).toString('base64');
  }
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'COMBAT_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return loader.parseAsync(JSON.stringify(json), '');
}

function bonesOf(root) {
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  return bones;
}

const named = (bones, suffix) => [...bones.values()].find(bone => bone.name.endsWith(suffix));
const wristPosition = (root, bones) => root.worldToLocal(named(bones, 'RightHand').getWorldPosition(new THREE.Vector3()));

test('el puño avanza y se recupera en los seis cuerpos y sus versiones livianas sin alterar las piernas', async () => {
  for (const id of ['hombre-joven', 'hombre-adulto', 'hombre-mayor', 'mujer-joven', 'mujer-adulta', 'mujer-mayor']) {
    for (const variant of ['', 'lod/']) {
      const { scene } = await bodyModel(id, variant);
      const bones = bonesOf(scene), original = new Map([...bones.values()].map(bone => [bone, bone.quaternion.clone()]));
      const combat = createCombatPose(scene, bones);
      combat.apply('golpear', 0.18);
      const preparation = wristPosition(scene, bones);
      combat.restore();
      combat.apply('golpear', 0.367);
      const contact = wristPosition(scene, bones);
      assert.ok(contact.z > preparation.z + 0.25, `${id}/${variant}: el puño se extiende hacia el frente`);
      assert.deepEqual(named(bones, 'RightUpLeg').quaternion.toArray(), original.get(named(bones, 'RightUpLeg')).toArray());
      scene.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
      combat.restore();
      for (const [bone, quaternion] of original) assert.deepEqual(bone.quaternion.toArray(), quaternion.toArray());
    }
  }
});

test('las poses de defensa y miedo levantan las manos sin acumular rotaciones entre cuadros', async () => {
  const { scene } = await bodyModel('hombre-adulto');
  const bones = bonesOf(scene), combat = createCombatPose(scene, bones);
  const initialWrist = wristPosition(scene, bones);
  for (const action of ['defender', 'asustado', 'recibirGolpe']) {
    const progress = action === 'recibirGolpe' ? 0.4 : 0;
    combat.apply(action, progress);
    const first = wristPosition(scene, bones);
    assert.ok(first.y > initialWrist.y + 0.2, action);
    const head = scene.worldToLocal(named(bones, 'Head').getWorldPosition(new THREE.Vector3()));
    assert.ok(first.y < head.y + 0.05, `${action}: la mano protege la cara sin pasar sobre la cabeza`);
    for (let frame = 0; frame < 30; frame++) {
      combat.restore(); combat.apply(action, progress);
      assert.ok(wristPosition(scene, bones).distanceTo(first) < 1e-6, `${action}: pose estable`);
    }
    combat.restore();
    assert.ok(wristPosition(scene, bones).distanceTo(initialWrist) < 1e-6);
  }
});

test('el personaje procedural sincroniza preparación y extensión con la acción aunque camine', () => {
  const first = createCharacter(), second = createCharacter();
  first.update(0.016, { action: 'golpear', actionProgress: 0.18, speed: 2, t: 10 });
  const elbowPreparation = first.ragdollRig.rightForeArm.rotation.x;
  first.update(0.016, { action: 'golpear', actionProgress: 0.367, speed: 2, t: 10.1 });
  second.update(0.016, { action: 'golpear', actionProgress: 0.367, speed: 2, t: 700 });
  assert.ok(first.ragdollRig.rightForeArm.rotation.x > elbowPreparation + 1.5);
  assert.equal(first.ragdollRig.rightForeArm.rotation.x, second.ragdollRig.rightForeArm.rotation.x);
  assert.equal(first.ragdollRig.rightArm.rotation.x, second.ragdollRig.rightArm.rotation.x);
  first.update(0.016, { action: 'golpear', actionProgress: 1, speed: 0 });
  assert.equal(first.ragdollRig.rightForeArm.rotation.x, -0.2);
});

test('update del realista aplica el golpe sobre la marcha y deja intacta otra instancia', async () => {
  mock.module('../src/character/weathering.js', { namedExports: { addGrime() {}, addHairTone() {} } });
  const body = await bodyModel('hombre-adulto');
  const data = fs.readFileSync(new URL('../public/models/animaciones-actionforge.glb', import.meta.url));
  const bank = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  const catalog = {
    cuerpos: [{ id: 'hombre-adulto', sexo: 'hombre', edad: 'adulto', piezas: {} }], piezas: {}
  };
  mock.method(globalThis, 'fetch', async () => ({ json: async () => catalog }));
  mock.method(GLTFLoader.prototype, 'loadAsync', async url => url.endsWith('cuerpo.gltf') ? body : bank);
  const { createRealisticCharacter } = await import('../src/character/RealisticCharacter.js');
  const first = await createRealisticCharacter(), second = await createRealisticCharacter();
  try {
    const firstRoot = first.group.children[0], firstBones = bonesOf(firstRoot);
    const secondBones = bonesOf(second.group), secondArm = named(secondBones, 'RightArm').quaternion.clone();
    first.update(0.2, { speed: 2 });
    first.update(0, { speed: 2, action: 'golpear', actionProgress: 0.18 });
    const preparation = wristPosition(firstRoot, firstBones);
    first.update(0, { speed: 2, action: 'golpear', actionProgress: 0.367 });
    assert.ok(wristPosition(firstRoot, firstBones).z > preparation.z + 0.25);
    assert.ok(named(secondBones, 'RightArm').quaternion.angleTo(secondArm) < 1e-7);
  } finally {
    first.dispose(); second.dispose(); mock.restoreAll();
  }
});
