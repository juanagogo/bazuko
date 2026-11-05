import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ACTIONFORGE_CLIPS, buildCharacterClips } from '../src/character/actionforge.js';
import { HipBlend } from '../src/character/AnimationPlayback.js';
import { createSkinSupport, groundLocomotion } from '../src/character/mixamoGrounding.js';

const path = new URL('../public/models/animaciones-actionforge.glb', import.meta.url);
async function bank() {
  const data = fs.readFileSync(path);
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}

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
  // Sin esta pista la cadera se queda de pie y el cuerpo se arrodilla en el aire.
  const hips = clips.buscar.tracks.find(track => track.name.endsWith('.position'));
  assert.ok(hips, 'buscar lleva la altura de la cadera');
  const heights = [...hips.values].filter((_, i) => i % 3 === 1);
  assert.ok(Math.max(...heights) - Math.min(...heights) > .4, 'la cadera baja al arrodillarse');
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
        if (clip.name === 'buscar') {
          // Al rebuscar los pies siguen apoyados durante todo el clip.
          const feet = ['Left', 'Right'].map(side => body.scene.getObjectByName(`mixamorig${side}Foot`));
          let highest = 0;
          for (let t = 0; t <= clip.duration; t += clip.duration / 24) {
            mixer.setTime(t);
            body.scene.updateMatrixWorld(true);
            highest = Math.max(highest, Math.min(...feet.map(foot => foot.getWorldPosition(new THREE.Vector3()).y)));
          }
          assert.ok(highest < .22, `${id}/${variant}: pie más bajo a ${highest.toFixed(2)} m`);
        }
        action.stop();
      }
      // Al entrar y salir del gesto los pies no atraviesan el suelo.
      const feet = ['Left', 'Right'].map(side => body.scene.getObjectByName(`mixamorig${side}Foot`));
      const lowest = () => {
        body.scene.updateMatrixWorld(true);
        return Math.min(...feet.map(foot => foot.getWorldPosition(new THREE.Vector3()).y));
      };
      const actions = { idle: mixer.clipAction(clips.idle).play(), buscar: mixer.clipAction(clips.buscar).play() };
      const blend = new HipBlend(actions, body.scene.getObjectByName('mixamorigHips'));
      const kneeling = clips.buscar.duration / 2;
      actions.idle.setEffectiveWeight(1); actions.buscar.setEffectiveWeight(0);
      mixer.setTime(kneeling);
      const standing = lowest();
      for (const weight of [.25, .5, .75]) {
        actions.idle.setEffectiveWeight(1 - weight); actions.buscar.setEffectiveWeight(weight);
        mixer.setTime(kneeling);
        const sunk = lowest();
        blend.apply({ idle: 1 - weight, buscar: weight });
        const held = lowest();
        blend.restore();
        assert.ok(held > sunk, `${id}/${variant}: la mezcla al ${weight} no levanta la cadera`);
        assert.ok(held > standing - .06, `${id}/${variant}: al ${weight} el pie baja a ${held.toFixed(3)} m (de pie ${standing.toFixed(3)} m)`);
      }
      mixer.stopAllAction();
      // Correr no clava el pie: la pisada no baja de donde apoya de pie.
      const grounded = groundLocomotion(body.scene, clips);
      const support = createSkinSupport(body.scene);
      const lowestOver = clip => {
        const played = mixer.clipAction(clip).play();
        let low = Infinity;
        for (let t = 0; t <= clip.duration; t += clip.duration / 40) {
          mixer.setTime(t);
          low = Math.min(low, support.minimumY());
        }
        played.stop();
        return low;
      };
      const standingLow = lowestOver(clips.idle);
      for (const name of ['walk', 'run']) {
        assert.ok(lowestOver(grounded[name]) > standingLow - .012, `${id}/${variant}: ${name} hunde el pie`);
      }
      const hipHeights = [...grounded.run.tracks.find(track => track.name.endsWith('.position')).values].filter((_, i) => i % 3 === 1);
      const shake = Math.max(...hipHeights.slice(1, -2).map((height, i) => Math.abs(hipHeights[i] - 2 * height + hipHeights[i + 2])));
      assert.ok(shake < .03, `${id}/${variant}: la cadera tiembla ${shake.toFixed(3)} m al correr`);
      assert.equal(grounded.run.duration, clips.run.duration);
      assert.equal(grounded.buscar, clips.buscar, 'los gestos conservan su clip');
    }
  }
});
