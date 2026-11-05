import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SleepPose } from '../src/character/SleepPose.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
async function bodyRig(id) {
  const folder = new URL(`../public/models/personaje/${id}/`, import.meta.url);
  const json = JSON.parse(readFileSync(new URL('cuerpo.gltf', folder)));
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(n => n !== 'EXT_texture_webp');
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(n => n !== 'EXT_texture_webp');
  for (const t of json.textures ?? []) { t.source = t.extensions?.EXT_texture_webp?.source ?? t.source; delete t.extensions; }
  for (const b of json.buffers) b.uri = 'data:application/octet-stream;base64,' + readFileSync(new URL(b.uri, folder)).toString('base64');
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const { scene } = await loader.parseAsync(JSON.stringify(json), '');
  const bones = new Map(); scene.traverse(b => { if (b.isBone) bones.set(b.name, b); });
  return { scene, bones };
}
function snapshot(bones) { return [...bones.values()].map(b => [...b.position.toArray(), ...b.quaternion.toArray()]); }
function bounds(root) {
  const box = new THREE.Box3(); const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(m => { if (m.isSkinnedMesh) for (let i = 0; i < m.geometry.attributes.position.count; i++) {
    m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld); box.expandByPoint(v);
  } });
  return box;
}

test('dormir apoya la geometría real, articula el cuerpo horizontal y conserva la raíz', async () => {
  for (const id of ['hombre-joven', 'hombre-adulto', 'hombre-mayor', 'mujer-joven', 'mujer-adulta', 'mujer-mayor']) {
    const { scene, bones } = await bodyRig(id);
    const before = snapshot(bones), pose = new SleepPose(bones, scene);
    for (let i = 0; i < 60; i++) {
      pose.apply(1 / 30, true);
      assert.ok(bounds(scene).min.y >= -.00001, `contacto durante transición de ${id}`);
    }
    const final = bounds(scene), size = final.getSize(new THREE.Vector3());
    assert.ok(final.min.y < .02, `${id}: el cuerpo descansa cerca del suelo`);
    assert.ok(size.z > 1.3 && size.y < .65, `${id}: postura horizontal, no pose de pie girada`);
    assert.deepEqual(scene.position.toArray(), [0, 0, 0]);
    pose.restore(); assert.deepEqual(snapshot(bones), before);
    for (let i = 0; i < 80; i++) pose.apply(1 / 30, false);
    assert.equal(pose.active, false); assert.deepEqual(snapshot(bones), before);
  }
});

test('al levantarse el apoyo se va con la pose: no empuja la cadera a cada paso y apenas cruza el piso', async () => {
  const { scene, bones } = await bodyRig('hombre-adulto');
  const hips = [...bones.values()].find(b => /hips$/i.test(b.name));
  const height = () => { scene.updateMatrixWorld(true); return hips.getWorldPosition(new THREE.Vector3()).y; };
  const pose = new SleepPose(bones, scene);
  for (let i = 0; i < 120; i++) pose.apply(1 / 60, true);
  // De pie, sin una animación encima.
  let lowest = Infinity;
  while (pose.weight > 0) { pose.apply(1 / 60, false); lowest = Math.min(lowest, bounds(scene).min.y); pose.restore(); }
  assert.ok(lowest > -.05, `apenas cruza el piso: ${lowest}`);
  // Andando, la punta del pie baja del piso en cada paso: aquí, todo el cuerpo.
  for (let i = 0; i < 120; i++) pose.apply(1 / 60, true);
  pose.restore();
  const standing = hips.position.y;
  hips.position.y = standing - .09;
  const step = height();
  let push = -Infinity;
  while (pose.weight >= .02) {
    pose.apply(1 / 60, false);
    if (pose.weight < .05) push = Math.max(push, height() - step);
    pose.restore();
  }
  hips.position.y = standing;
  assert.ok(push < .02, `apenas empuja la cadera: ${push}`);
});

test('dormir no acumula offsets ni cambia otro cuerpo, tampoco al cancelar', async () => {
  const { scene, bones } = await bodyRig('hombre-adulto');
  const before = snapshot(bones), pose = new SleepPose(bones, scene);
  for (let i = 0; i < 120; i++) pose.apply(1 / 60, true);
  pose.reset(); assert.equal(pose.weight, 0); assert.deepEqual(snapshot(bones), before);
  pose.apply(0, false); assert.deepEqual(snapshot(bones), before);
});
