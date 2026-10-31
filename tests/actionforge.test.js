import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ACTIONFORGE_CLIPS, buildCharacterClips } from '../src/character/actionforge.js';
import { loadActionForgeBank } from './helpers/actionforge-bank.js';

const path = new URL('../public/models/animaciones-actionforge.glb', import.meta.url);
const bank = () => loadActionForgeBank(path);

test('los FBX de combate se adaptan como Group y producen pistas animadas', async () => {
  const body = await bank();
  for (const [action, file] of Object.entries({ fueraCombate: 'fallingdown', golpe_jab: 'combat-jab-cross', reaccion_pecho: 'combat-hit-body', reaccion_cabeza: 'combat-hit-head', provocar: 'combat-taunt', bloquear: 'center-block' })) {
    const bytes = fs.readFileSync(new URL(`../public/models/${file}.fbx`, import.meta.url));
    const source = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const clips = buildCharacterClips(body, null, null, { [action]: source });
    assert.ok(clips[action]?.duration > 0);
    assert.ok(clips[action].tracks.length > 10);
    if (action === 'fueraCombate') {
      const hip = clips[action].tracks.find(track => track.name.endsWith('Hips.position'));
      assert.ok(hip, 'Falling Down conserva la traslación vertical de la cadera');
      assert.ok(hip.values[1] > 0.8, 'La animación empieza con la cadera erguida');
      assert.ok(hip.values[hip.values.length - 2] < 0.15, 'La cadera termina junto al suelo');
      assert.ok(Math.abs(hip.values[hip.values.length - 3] - hip.values[0]) < 1e-6, 'La caída conserva la posición horizontal X');
      assert.ok(Math.abs(hip.values[hip.values.length - 1] - hip.values[2]) < 1e-6, 'La caída conserva la posición horizontal Z');
    }
    for (const track of clips[action].tracks) assert.ok(track.values.every(Number.isFinite));
    if (action === 'golpe_jab') assert.ok(clips.golpe_cross.duration > 0);
  }
});

test('banco ActionForge incluye solo ocho clips y esqueleto, sin ropa ni texturas duplicadas', async () => {
  const data = fs.readFileSync(path);
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)));
  assert.ok(data.length < 1024 * 1024);
  assert.equal(json.images, undefined);
  assert.equal(json.meshes, undefined);
  assert.equal(json.animations.length, 8);
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
