import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ACTIONFORGE_CLIPS, buildCharacterClips } from '../src/character/actionforge.js';

const path = new URL('../public/models/animaciones-actionforge.glb', import.meta.url);
async function bank() {
  const data = fs.readFileSync(path);
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}

test('banco ActionForge incluye solo once clips y esqueleto, sin ropa ni texturas duplicadas', async () => {
  const data = fs.readFileSync(path);
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)));
  assert.ok(data.length < 2 * 1024 * 1024);
  assert.equal(json.images, undefined);
  assert.equal(json.meshes, undefined);
  assert.equal(json.animations.length, 11);
  const gltf = await bank();
  const names = new Set(gltf.animations.map(c => c.name));
  assert.ok(Object.values(ACTIONFORGE_CLIPS).every(name => names.has(name)));
  let bones = 0;
  gltf.scene.traverse(o => { if (o.isBone) bones++; });
  assert.equal(bones, 52);
});

test('clips se adaptan sin modificar el cuerpo, quedan en el sitio y permiten agacharse', async () => {
  const source = await bank();
  const body = await bank();
  const before = body.scene.toJSON();
  const legacy = { scene: body.scene, animations: [] };
  const clips = buildCharacterClips(body, legacy, source);
  assert.deepEqual(body.scene.toJSON(), before);
  assert.deepEqual(Object.keys(clips), Object.keys(ACTIONFORGE_CLIPS));
  for (const clip of Object.values(clips)) {
    assert.ok(clip.duration > 0);
    for (const track of clip.tracks) {
      assert.ok([...track.values].every(Number.isFinite));
      if (track.name.endsWith('.position')) {
        for (let i = 3; i < track.values.length; i += 3) {
          assert.equal(track.values[i], track.values[0]);
          assert.equal(track.values[i + 2], track.values[2]);
        }
      }
    }
  }
  assert.notEqual(clips.comer, clips.beber);
  const fallback = buildCharacterClips(body, {
    scene: source.scene,
    animations: [new THREE.AnimationClip('idle', 1, source.animations[0].tracks)]
  });
  assert.ok(fallback.idle);
  assert.deepEqual(body.scene.toJSON(), before);
});

test('los seis cuerpos reales y sus versiones livianas aceptan los clips sin huesos perdidos', async () => {
  globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
  const source = await bank();
  const folder = fileURLToPath(new URL('../public/models/personaje/', import.meta.url));
  for (const id of ['hombre-joven', 'hombre-adulto', 'hombre-mayor', 'mujer-joven', 'mujer-adulta', 'mujer-mayor']) {
    for (const variant of ['', 'lod/']) {
      const location = pathModule.join(folder, id, variant);
      const json = JSON.parse(fs.readFileSync(pathModule.join(location, 'cuerpo.gltf')));
      // Las texturas se sustituyen en esta prueba; evitar el decodificador WebP del navegador.
      json.extensionsUsed = (json.extensionsUsed ?? []).filter(name => name !== 'EXT_texture_webp');
      json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
      for (const texture of json.textures ?? []) {
        texture.source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
        delete texture.extensions;
      }
      for (const buffer of json.buffers) {
        buffer.uri = 'data:application/octet-stream;base64,' + fs.readFileSync(pathModule.join(location, buffer.uri)).toString('base64');
      }
      const loader = new GLTFLoader();
      // Verifica esqueleto y geometría sin renderizar ni decodificar texturas.
      loader.register(() => ({ name: 'CHECK_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
      const body = await loader.parseAsync(JSON.stringify(json), '');
      const clips = buildCharacterClips(body, { scene: source.scene, animations: [] }, source);
      const mixer = new THREE.AnimationMixer(body.scene);
      for (const clip of Object.values(clips)) {
        const action = mixer.clipAction(clip).play();
        mixer.setTime(clip.duration / 2);
        body.scene.updateMatrixWorld(true);
        body.scene.traverse(node => {
          if (node.isSkinnedMesh) assert.ok(node.skeleton.bones.every(bone => bone?.isBone));
          assert.ok(node.matrixWorld.elements.every(Number.isFinite), `${id}/${variant}: ${clip.name}`);
        });
        action.stop();
      }
    }
  }
});
