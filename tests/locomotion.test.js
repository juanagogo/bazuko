import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildCharacterClips } from '../src/character/actionforge.js';
import { locomotionBlend, locomotionRate, measureLocomotion } from '../src/character/locomotion.js';
import { animationDamping } from '../src/character/SecondaryMotion.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = new URL('../public/models/', import.meta.url);

async function bank() {
  const data = fs.readFileSync(new URL('animaciones-actionforge.glb', models));
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}

async function body(id) {
  const location = pathModule.join(fileURLToPath(models), 'personaje', id);
  const json = JSON.parse(fs.readFileSync(pathModule.join(location, 'cuerpo.gltf')));
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
  loader.register(() => ({ name: 'CHECK_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return loader.parseAsync(JSON.stringify(json), '');
}

test('la zancada de la mezcla caminar/correr se mide sobre el cuerpo sin modificarlo', async () => {
  const gltf = await body('hombre-adulto');
  const before = gltf.scene.toJSON();
  const clips = buildCharacterClips(gltf, null, await bank());
  const locomotion = measureLocomotion(gltf.scene, clips.walk, clips.run);
  assert.deepEqual(gltf.scene.toJSON(), before);
  const [walk, , , , run] = locomotion.strides;
  // Caminar avanza ~1 m/s y el sprint varias veces más; la mezcla crece con la proporción de correr.
  assert.ok(walk / locomotion.walkDuration > .8 && walk / locomotion.walkDuration < 1.4, `caminar ${walk}`);
  assert.ok(run / locomotion.runDuration > 4 * walk / locomotion.walkDuration, `correr ${run}`);
  assert.ok(locomotion.strides.every((stride, i, all) => !i || stride > all[i - 1]));
  assert.equal(measureLocomotion(new THREE.Group(), clips.walk), null);
  assert.equal(measureLocomotion(gltf.scene, clips.walk).strides.length, 1);
});

test('la mezcla avanza la zancada a la misma velocidad que el personaje', () => {
  const locomotion = { walkDuration: 1.33, runDuration: .67, strides: [1.41, 2.02, 2.65, 4.65, 6.19] };
  const stride = (w) => {
    const x = w * 4, i = Math.min(Math.floor(x), 3);
    return THREE.MathUtils.lerp(locomotion.strides[i], locomotion.strides[i + 1], x - i);
  };
  let previous = -1;
  for (const speed of [.5, 1.06, 2, 2.78, 4, 5.56, 9.24, 12]) {
    const blend = locomotionBlend(speed, locomotion);
    assert.ok(blend.run >= previous, `${speed}`);
    assert.ok(Math.abs(stride(blend.run) * blend.rate - speed) < 1e-6, `${speed}`);
    previous = blend.run;
  }
  assert.equal(locomotionBlend(1, locomotion).run, 0);
  assert.equal(locomotionBlend(12, locomotion).run, 1);
  // A media mezcla, la cadencia es la intermedia entre caminar y correr.
  const half = locomotionBlend(2.65, locomotion);
  assert.ok(Math.abs(half.run - .5) < .01 && Math.abs(half.rate - 1) < .01, JSON.stringify(half));
  const walkOnly = { walkDuration: 1.33, runDuration: null, strides: [1.41] };
  assert.deepEqual(locomotionBlend(2, walkOnly), { run: 0, rate: 2 / 1.41 });
});

test('los cambios caminar/correr avanzan la distancia real incluso mientras cambia el reparto', () => {
  const locomotion = { walkDuration: 1.33, runDuration: .67, strides: [1.41, 2.02, 2.65, 4.65, 6.19] };
  for (const fps of [20, 60, 144]) {
    let share = 0, drawnDistance = 0, actualDistance = 0;
    for (let frame = 0; frame < fps * 3; frame++) {
      const speed = frame < fps ? 1 : frame < fps * 2 ? 6 : .4;
      const desired = locomotionBlend(speed, locomotion);
      share += (desired.run - share) * animationDamping(1 / fps, 8);
      const x = share * 4, index = Math.min(Math.floor(x), 3);
      const stride = THREE.MathUtils.lerp(locomotion.strides[index], locomotion.strides[index + 1], x - index);
      drawnDistance += stride * locomotionRate(speed, locomotion, share) / fps;
      actualDistance += speed / fps;
    }
    assert.ok(Math.abs(drawnDistance - actualDistance) < 1e-10, `${fps} FPS`);
  }
  assert.equal(locomotionRate(0, locomotion, .8), 0);
  assert.equal(locomotionRate(-2, locomotion, .8), 0);
});
