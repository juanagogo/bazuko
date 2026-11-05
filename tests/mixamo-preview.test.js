import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildMixamoPreviewClips, buildMixamoGameComplements, resolveAnimationProfile } from '../src/character/animationProfiles.js';
import { createRealisticCharacter } from '../src/character/RealisticCharacter.js';
import { ACTIONFORGE_CLIPS } from '../src/character/actionforge.js';

function skeleton({ centimeters = false, prefix = 'mixamorig' } = {}) {
  const root = new THREE.Group(), bones = new Map();
  if (centimeters) { root.scale.setScalar(.01); root.rotation.x = -Math.PI / 2; }
  const bone = (name, parent, x, y) => {
    const value = new THREE.Bone();
    value.name = prefix + name;
    value.position.set(x * (centimeters ? 100 : 1), centimeters ? 0 : y, centimeters ? y * 100 : 0);
    parent.add(value); bones.set(name, value); return value;
  };
  const hips = bone('Hips', root, 0, 1);
  const spine = bone('Spine', hips, 0, .2);
  bone('LeftArm', spine, .2, .2); bone('RightArm', spine, -.2, .2);
  for (const [side, x] of [['Left', .1], ['Right', -.1]]) {
    const thigh = bone(`${side}UpLeg`, hips, x, 0);
    const knee = bone(`${side}Leg`, thigh, 0, -.5);
    bone(`${side}Foot`, knee, 0, -.5);
  }
  return { scene: root, bones };
}

test('preview acepta solo el perfil y la ruta local conocidos', () => {
  assert.deepEqual(resolveAnimationProfile(), { id: 'default', url: null });
  assert.equal(resolveAnimationProfile('mixamo-preview', '/bazuko/models/').url, '/bazuko/models/preview/animaciones-mixamo.glb');
  assert.equal(resolveAnimationProfile('mixamo-game-preview').url, '/models/preview/animaciones-mixamo.glb');
  for (const input of ['https://example.com/model.glb', '../otro.glb', 'mixamo', null]) {
    assert.throws(() => resolveAnimationProfile(input), /Perfil de animaciones desconocido/);
  }
});

test('preview conserva altura mundial con FBX Z-local y centímetros sin mover X/Z ni mutar los rigs', () => {
  const source = skeleton({ centimeters: true, prefix: 'mixamorig:' });
  const body = skeleton();
  source.animations = ['idle', 'walk', 'run'].map(name => new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('mixamorig:Hips.position', [0, 1], [0, 0, 100, 30, 40, 50])
  ]));
  const sourceBefore = source.scene.toJSON(), bodyBefore = body.scene.toJSON();
  const clips = buildMixamoPreviewClips(body, source);
  for (const clip of Object.values(clips)) {
    const hip = clip.tracks.find(track => track.name === 'mixamorigHips.position');
    assert.ok(hip, 'la cadera sanitizada tiene pista vertical');
    assert.ok(Math.abs(hip.values[1] - 1) < 1e-5);
    assert.ok(Math.abs(hip.values.at(-2) - .5) < 1e-5);
    for (let i = 0; i < hip.values.length; i += 3) {
      assert.ok(Math.abs(hip.values[i]) < 1e-6);
      assert.ok(Math.abs(hip.values[i + 2]) < 1e-6);
    }
    assert.ok(clip.tracks.every(track => [...track.values].every(Number.isFinite)));
  }
  assert.deepEqual(source.scene.toJSON(), sourceBefore);
  assert.deepEqual(body.scene.toJSON(), bodyBefore);
});

test('preview rechaza bancos incompletos e incompatibles sin reemplazar clips', () => {
  const body = skeleton(), source = skeleton();
  const clip = name => new THREE.AnimationClip(name, 1, [new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
  assert.throws(() => buildMixamoPreviewClips(body, { ...source, animations: [clip('idle')] }), /faltan clips obligatorios: walk, run/);
  const animations = ['idle', 'walk', 'run'].map(clip);
  assert.throws(() => buildMixamoPreviewClips(body, { scene: new THREE.Group(), animations }), /esqueleto incompatible/);
  animations[0].tracks[0].values[0] = NaN;
  assert.throws(() => buildMixamoPreviewClips(body, { ...source, animations }), /clip inválido/);
});

test('los huesos auxiliares de Mixamo se evalúan sin exigirlos en el cuerpo de destino', () => {
  const source = skeleton(), body = skeleton();
  const tip = new THREE.Bone(); tip.name = 'mixamorigHeadTopEnd';
  source.bones.get('Spine').add(tip);
  source.animations = ['idle', 'walk', 'run'].map(name => new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack(tip.name + '.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
  ]));
  const clips = buildMixamoPreviewClips(body, source);
  assert.equal(Object.keys(clips).length, 3);
  assert.ok(clips.idle.tracks.every(track => !track.name.includes('HeadTopEnd')));
});

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const originalFetch = globalThis.fetch;
const loads = [];
let failPreview = true;
const skinDetail = new THREE.Texture();
const detailLoads = [];
test.before(() => {
  mock.method(THREE.TextureLoader.prototype, 'loadAsync', async url => {
    detailLoads.push(url);
    return skinDetail;
  });
  mock.method(globalThis, 'fetch', (url, ...rest) => url === '/models/personaje/catalogo.json'
    ? Promise.resolve(new Response(readFileSync(path.join(models, 'personaje/catalogo.json'))))
    : originalFetch(url, ...rest));
  mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
    loads.push(url);
    const preview = url === '/models/preview/animaciones-mixamo.glb';
    if (preview && failPreview) throw new Error('Banco de prueba ausente');
    const file = path.join(models, preview ? 'animaciones-actionforge.glb' : url.replace(/^\/models\//, ''));
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'CHECK_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    if (file.endsWith('.glb')) {
      const bytes = readFileSync(file);
      const result = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
      if (preview) {
        // Fixture de integración: no se presenta como contenido descargado de Mixamo.
        result.animations = ['idle', 'walk', 'run', 'saludo'].map(name => {
          const clip = result.animations.find(item => item.name === ACTIONFORGE_CLIPS[name === 'saludo' ? 'pedir' : name]).clone();
          clip.name = name; return clip;
        });
      }
      return result;
    }
    const json = JSON.parse(readFileSync(file));
    json.extensionsUsed = (json.extensionsUsed ?? []).filter(name => name !== 'EXT_texture_webp');
    json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
    for (const texture of json.textures ?? []) {
      texture.source = texture.extensions?.EXT_texture_webp?.source ?? texture.source; delete texture.extensions;
    }
    for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + readFileSync(path.join(path.dirname(file), buffer.uri)).toString('base64');
    return loader.parseAsync(JSON.stringify(json), '');
  });
});
test.after(() => mock.restoreAll());

test('el material de calle es el de todos: poros compartidos, ojos con brillo y pestañas suaves', async () => {
  const look = { piel: 2, peloColor: 4, desgaste: 2 };
  const character = await createRealisticCharacter(look);
  const other = await createRealisticCharacter({ piel: 4 });
  assert.equal(character.look, look);
  const materialOf = (expression, owner = character) => {
    let material;
    owner.group.traverse(node => { if (node.isSkinnedMesh && expression.test(node.name)) material = node.material; });
    return material;
  };
  assert.ok(materialOf(/body/).map, 'la textura del cuerpo sigue ahí');
  assert.equal(materialOf(/body/).normalMap, skinDetail);
  assert.equal(materialOf(/body/, other).normalMap, skinDetail);
  assert.equal(materialOf(/body/).userData.streetSurface, 'skin');
  assert.equal(materialOf(/low-poly/).roughness, .22);
  assert.equal(materialOf(/eyelashes/).transparent, true);
  assert.equal(materialOf(/eyelashes/).depthWrite, false);
  assert.equal(skinDetail.flipY, false);
  assert.deepEqual(skinDetail.repeat.toArray(), [18, 18]);
  assert.equal(skinDetail.colorSpace, THREE.NoColorSpace);
  assert.deepEqual(detailLoads, ['/models/preview/skin/skin-micro-normal.png'], 'una sola descarga, de los recursos locales');
  character.dispose();
  other.dispose();
});

test('el material usa el desgaste inicial del personaje y respeta limpio y cabello negro explícitos', async () => {
  const look = {};
  const character = await createRealisticCharacter(look);
  const materialOf = expression => {
    let material;
    character.group.traverse(node => { if (node.isSkinnedMesh && expression.test(node.name)) material = node.material; });
    return material;
  };
  const skinWear = () => {
    const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
    materialOf(/body/).onBeforeCompile(shader, {});
    return shader.uniforms.uStreetWear.value;
  };
  assert.equal(skinWear(), 1, 'look vacío usa el desgaste inicial 2');
  assert.equal(character.look, look, 'la preferencia original no se reescribe');
  await character.setLook({ desgaste: 0, peloColor: 0 });
  assert.equal(skinWear(), 0, 'cero explícito se conserva');
  const blackHair = materialOf(/hair_02/);
  assert.ok(blackHair, 'pelo desordenado real del catálogo');
  assert.ok(Math.max(blackHair.color.r, blackHair.color.g, blackHair.color.b) < .06, 'negro mantiene luminancia baja');
  character.dispose();
});

test('el personaje por defecto nunca descarga el banco preview', async () => {
  const character = await createRealisticCharacter();
  assert.equal(character.animationProfile, 'default');
  assert.ok(character.animationStatus.clips.includes('cagar'));
  assert.ok(!loads.some(url => url.includes('/preview/')));
  character.dispose();
});

test('un error preview se propaga y permite reintentar sin fallback ni contaminar la caché por cuerpo', async () => {
  await assert.rejects(createRealisticCharacter({}, { animaciones: 'mixamo-preview' }), /No se pudo cargar el banco Mixamo/);
  failPreview = false;
  const preview = await createRealisticCharacter({}, { animaciones: 'mixamo-preview' });
  assert.equal(preview.animationProfile, 'mixamo-preview');
  assert.deepEqual(preview.animationStatus.clips, ['idle', 'walk', 'run', 'saludo']);
  assert.equal(preview.animationStatus.source, '/models/preview/animaciones-mixamo.glb');
  assert.ok(preview.animationStatus.durations.walk > 0);
  assert.equal(preview.animationStatus.loops.walk, true);
  assert.equal(preview.animationStatus.loops.saludo, false);
  for (const action of ['saludo', null]) for (let frame = 0; frame < 20; frame++) preview.update(1 / 60, { action, actionProgress: .4 });
  assert.deepEqual(preview.group.position.toArray(), [0, 0, 0]);
  preview.group.traverse(node => assert.ok(node.matrix.elements.every(Number.isFinite)));
  await preview.setLook({ piel: 3 });
  assert.deepEqual(preview.animationStatus.clips, ['idle', 'walk', 'run', 'saludo']);
  const normal = await createRealisticCharacter();
  assert.ok(normal.animationStatus.clips.includes('cagar'));
  assert.ok(!normal.animationStatus.clips.includes('saludo'));
  assert.equal(loads.filter(url => url.includes('/preview/')).length, 2, 'solo el intento fallido y la carga válida');
  preview.dispose(); normal.dispose();
});

test('la cadencia original de la sala no mezcla carrera en Sad Walk ni depende de la velocidad física', async () => {
  const slow = await createRealisticCharacter({}, { animaciones: 'mixamo-preview' });
  const fast = await createRealisticCharacter({}, { animaciones: 'mixamo-preview' });
  for (let i = 0; i < 90; i++) {
    slow.update(1 / 60, { speed: .5, movement: { previewCadence: 'source' } });
    fast.update(1 / 60, { speed: 4, movement: { previewCadence: 'source' } });
  }
  for (const name of ['mixamorigLeftUpLeg', 'mixamorigRightUpLeg', 'mixamorigLeftLeg', 'mixamorigRightLeg']) {
    const a = slow.group.getObjectByName(name), b = fast.group.getObjectByName(name);
    assert.ok(a && b);
    assert.ok(a.quaternion.toArray().every((value, i) => Math.abs(value - b.quaternion.toArray()[i]) < 1e-7), name);
  }
  slow.dispose(); fast.dispose();
});

test('solo el perfil de juego complementa comer/agacharse sin contaminar banco estricto ni default', async () => {
  const game = await createRealisticCharacter({}, { animaciones: 'mixamo-game-preview' });
  const status = game.animationStatus;
  assert.deepEqual(status.clips, ['idle', 'walk', 'run', 'saludo', 'comer', 'cagar']);
  assert.equal(status.clipSources.idle, 'mixamo-preview');
  assert.equal(status.clipSources.comer, 'actionforge');
  assert.equal(status.clipSources.cagar, 'actionforge');
  assert.equal(status.loops.comer, false);
  assert.equal(status.loops.cagar, true);
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  const hips = game.group.getObjectByName('mixamorigHips');
  const standing = hips.position.y;
  for (let i = 0; i < 60; i++) game.update(1 / 60, { action: 'cagar', actionProgress: .5 });
  assert.ok(hips.position.y < standing - .15, 'el complemento agachado conserva su altura de cadera');
  for (let i = 0; i < 60; i++) game.update(1 / 60, { action: 'comer', actionProgress: .5 });
  game.group.traverse(node => assert.ok([...node.position, ...node.quaternion].every(Number.isFinite)));
  assert.deepEqual(game.group.position.toArray(), [0, 0, 0]);
  const strict = await createRealisticCharacter({}, { animaciones: 'mixamo-preview' });
  assert.deepEqual(strict.animationStatus.clips, ['idle', 'walk', 'run', 'saludo']);
  const normal = await createRealisticCharacter();
  assert.equal(normal.animationStatus.profile, 'default');
  assert.ok(normal.animationStatus.clips.includes('lanzar'));
  assert.deepEqual(buildMixamoGameComplements(null, null, { comer: {}, cagar: {} }), {}, 'no sustituye futuros clips propios');
  game.dispose(); strict.dispose(); normal.dispose();
});
