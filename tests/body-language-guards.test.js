import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BodyLanguage } from '../src/character/BodyLanguage.js';
import { bakeGaitFamily, buildGaitSources } from '../src/character/gaitFamilies.js';
import { createRealisticCharacter } from '../src/character/RealisticCharacter.js';
import { bakeStances } from '../src/character/stances.js';

// Lo que la capa de cuerpo le promete al juego, con los cuerpos y las prendas reales: el liviano también
// la lleva, sin pedir matrices; cada familia de paso se hornea una vez; los gestos no tiemblan.
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const originalFetch = globalThis.fetch;

async function parseAsset(url) {
  const file = path.join(models, url.replace(/^\/models\//, ''));
  const parser = new GLTFLoader();
  parser.register(() => ({ name: 'CHECK_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  if (file.endsWith('.glb')) {
    const bytes = readFileSync(file);
    return parser.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }
  const json = JSON.parse(readFileSync(file));
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(name => name !== 'EXT_texture_webp');
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
  for (const texture of json.textures ?? []) { texture.source = texture.extensions?.EXT_texture_webp?.source ?? texture.source; delete texture.extensions; }
  for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + readFileSync(path.join(path.dirname(file), buffer.uri)).toString('base64');
  return parser.parseAsync(JSON.stringify(json), '');
}

test.before(() => {
  mock.method(globalThis, 'fetch', (url, ...rest) => url === '/models/personaje/catalogo.json'
    ? Promise.resolve(new Response(readFileSync(path.join(models, 'personaje/catalogo.json'))))
    : originalFetch(url, ...rest));
  mock.method(GLTFLoader.prototype, 'loadAsync', parseAsset);
  mock.method(THREE.TextureLoader.prototype, 'loadAsync', async () => new THREE.Texture());
});
test.after(() => mock.restoreAll());

const LOOK = { real: { sexo: 'hombre', edad: 'adulto', pelo: 'corto', barba: 'ninguna', ropa: 'buzo', calzado: 'tenis', cabeza: 'sin-sombrero' } };

const bonesOf = character => {
  const bones = new Map();
  character.group.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  return bones;
};
const skinMesh = character => {
  let found = null;
  character.group.traverse(node => { if (node.isSkinnedMesh && node.material.userData.streetSurface === 'skin' && /body/i.test(node.name)) found = node; });
  return found;
};

/** Dos personajes iguales al mismo reloj: lo que los separa es lo que se le pidió a uno de ellos. */
async function pairDifference(options, params, seconds = 1) {
  const asked = await createRealisticCharacter(LOOK, options), plain = await createRealisticCharacter(LOOK, options);
  for (let t = 0; t < seconds; t += 1 / 30) {
    asked.update(1 / 30, { speed: 0, ...params });
    plain.update(1 / 30, { speed: 0 });
  }
  const other = bonesOf(plain), angles = {};
  for (const [name, bone] of bonesOf(asked)) angles[name] = bone.quaternion.angleTo(other.get(name).quaternion);
  asked.dispose();
  plain.dispose();
  return angles;
}

test('el liviano también lleva la capa de cuerpo: su postura y su estilo mueven los huesos', async () => {
  const stance = await pairDifference({ lod: true }, { stance: 'bolsillos' });
  assert.ok(stance.mixamorigLeftForeArm > .3, `bolsillos no dobla el antebrazo: ${stance.mixamorigLeftForeArm}`);
  const style = await pairDifference({ lod: true }, { style: { stoop: .8, headDown: .6 } });
  assert.ok(style.mixamorigSpine1 > .05, `encorvarse no dobla la espalda: ${style.mixamorigSpine1}`);
  assert.ok(style.mixamorigHead > .05, `bajar la cabeza no la baja: ${style.mixamorigHead}`);
});

test('el modelo completo se mueve igual que el liviano con la misma postura', async () => {
  const far = await pairDifference({ lod: true }, { stance: 'bolsillos' });
  const near = await pairDifference({}, { stance: 'bolsillos' });
  assert.ok(Math.abs(far.mixamorigLeftForeArm - near.mixamorigLeftForeArm) < .05, `${far.mixamorigLeftForeArm} frente a ${near.mixamorigLeftForeArm}`);
});

test('cada familia de paso se hornea una vez por cuerpo: quien la repite usa los mismos clips', async t => {
  const seen = [];
  const clipAction = THREE.AnimationMixer.prototype.clipAction;
  t.mock.method(THREE.AnimationMixer.prototype, 'clipAction', function (clip, ...rest) {
    seen.at(-1)?.add(clip);
    return clipAction.call(this, clip, ...rest);
  });
  const clipsOf = async (look, options) => {
    seen.push(new Set());
    const person = await createRealisticCharacter(look, options);
    person.dispose();
    return seen.at(-1);
  };
  // Hornear también pide acciones a sus propios mezcladores: el primero de cada familia ve algún clip de más.
  const within = (list, baked) => {
    assert.ok(list.size > 3);
    for (const clip of list) assert.ok(baked.has(clip), `${clip.name} se volvió a hornear`);
  };
  const first = await clipsOf(LOOK, {});
  within(await clipsOf(LOOK, {}), first);
  within(await clipsOf(LOOK, { lod: true }), first);
  within(await clipsOf({ real: { ...LOOK.real, ropa: 'camiseta' } }, {}), first);
  const tired = await clipsOf(LOOK, { andar: 'cansado' });
  assert.ok([...tired].some(clip => !first.has(clip)), 'otra familia, otros clips');
  within(await clipsOf(LOOK, { andar: 'cansado' }), tired);
  const otherBody = await clipsOf({ real: { ...LOOK.real, edad: 'joven' } }, {});
  assert.ok([...otherBody].every(clip => !first.has(clip)), 'otro cuerpo, sus propios clips');
});

test('el update del personaje no pide matrices de mundo', async t => {
  for (const options of [{ lod: true }, {}]) {
    const person = await createRealisticCharacter(LOOK, options);
    const scene = new THREE.Scene();
    scene.add(person.group);
    scene.updateMatrixWorld(true);
    let calls = 0;
    const count = (owner, name) => {
      const real = owner[name];
      return t.mock.method(owner, name, function (...args) { calls++; return real.apply(this, args); });
    };
    const spies = ['updateMatrixWorld', 'updateWorldMatrix', 'updateMatrix', 'getWorldPosition', 'getWorldQuaternion', 'getWorldScale', 'getWorldDirection', 'localToWorld', 'worldToLocal']
      .map(name => count(THREE.Object3D.prototype, name));
    for (let i = 0; i < 30; i++) person.update(1 / 30, { speed: i < 15 ? 0 : 1.2, stance: 'bolsillos', style: { stoop: .4, headDown: .2, swing: .6 } });
    for (const spy of spies) spy.mock.restore();
    assert.equal(calls, 0, `${options.lod ? 'liviano' : 'completo'}: casi toda la gente pasa por aquí en cada cuadro`);
    person.dispose();
  }
});

test('el liviano esconde la piel que su ropa tapa', async () => {
  const bare = await parseAsset('/models/personaje/hombre-adulto/lod/cuerpo.gltf');
  let whole = 0;
  bare.scene.traverse(node => { if (node.isSkinnedMesh && /body/i.test(node.name)) whole = node.geometry.index.count / 3; });
  assert.ok(whole > 1000, `cuerpo liviano: ${whole} triángulos`);
  for (const ropa of ['buzo', 'camiseta', 'overol']) {
    const person = await createRealisticCharacter({ real: { ...LOOK.real, ropa } }, { lod: true });
    const kept = skinMesh(person).geometry.index.count / 3;
    assert.ok(kept < whole - 300, `${ropa}: de ${whole} quedan ${kept} triángulos de piel`);
    assert.ok(kept > 100, `${ropa}: quedó sin cara ni manos`);
    person.dispose();
  }
});

// `angleTo` no sirve para decir «igual»: el cuaternión del archivo no mide 1 exacto y da una milésima consigo mismo.
const sameRotation = (a, b) => a.toArray().every((value, i) => Math.abs(value - b.toArray()[i]) < 1e-6);

const bodyLibrary = (async () => {
  const gltf = await parseAsset('/models/personaje/hombre-adulto/cuerpo.gltf');
  const [upright, tired] = await Promise.all([parseAsset('/models/andar-erguido.glb'), parseAsset('/models/andar-cansado.glb')]);
  const sources = buildGaitSources(gltf, upright, tired);
  return { gltf, library: bakeStances(gltf.scene, sources.standing), rest: bakeGaitFamily(gltf.scene, sources, 'normal').idle };
})();

function instance(gltf, library, options = {}) {
  const root = clone(gltf.scene);
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  return { root, bones, layer: new BodyLanguage(bones, library, options) };
}

// Los gestos son movimiento, no un color que parpadea: su límite es no temblar. Una mano a más de esto
// ya no parece rascarse sino vibrar.
const GESTURE_RATE_LIMIT = 1.1; // vueltas por segundo que puede pedir el catálogo
const GESTURE_HZ_LIMIT = 1.5; // pico a pico más corto que se llega a ver, con la variación incluida
const WITH_MOTION = ['celular', 'frotarse', 'fumar-quieto', 'hablar', 'rascarse'];

/** Veces por segundo que el hueso que más se mueve vuelve a su extremo, a lo largo de un minuto. */
function measureGesture({ gltf, library }, name, { fps = 60, seconds = 60, seed = 3 } = {}) {
  const { layer, bones } = instance(gltf, library, { seed });
  const { entries } = library.stances.get(name);
  const widest = entries.reduce((best, entry) => (entry.quaternion.angleTo(entry.alt) > best.quaternion.angleTo(best.alt) ? entry : best));
  const bone = bones.get(widest.boneName);
  const samples = [];
  for (let i = 0; i < fps * seconds; i++) {
    layer.restore();
    layer.apply(1 / fps, { stance: name, speed: 0 });
    samples.push(bone.quaternion.angleTo(widest.quaternion));
  }
  const settled = samples.slice(fps * 2);
  const low = Math.min(...settled), high = Math.max(...settled);
  const peaks = [];
  for (let i = 1; i < settled.length - 1; i++) {
    if (settled[i] > settled[i - 1] && settled[i] >= settled[i + 1] && settled[i] > low + (high - low) * .5) peaks.push(i / fps);
  }
  const gaps = peaks.slice(1).map((time, i) => time - peaks[i]);
  return { travel: high - low, peaks: peaks.length, perSecond: peaks.length / (settled.length / fps), fastest: gaps.length ? 1 / Math.min(...gaps) : 0 };
}

test('ningún gesto tiembla: la frecuencia de cada postura que oscila tiene un tope', async () => {
  const baked = await bodyLibrary;
  const moving = [...baked.library.stances.values()].filter(stance => stance.motion);
  assert.deepEqual(moving.map(stance => stance.name).sort(), WITH_MOTION, 'una postura nueva que oscila pasa por este tope');
  for (const { name, motion } of moving) {
    assert.ok(motion.rate > 0 && motion.rate <= GESTURE_RATE_LIMIT, `${name}: pide ${motion.rate} vueltas por segundo`);
    for (const seed of [0, 3, 41]) {
      const { fastest } = measureGesture(baked, name, { seed });
      assert.ok(fastest <= GESTURE_HZ_LIMIT, `${name} con semilla ${seed}: llega a ${fastest.toFixed(2)} Hz`);
    }
  }
});

test('las posturas que oscilan se mueven de verdad, y las demás se quedan quietas', async () => {
  const baked = await bodyLibrary;
  for (const name of WITH_MOTION) {
    const { travel, perSecond } = measureGesture(baked, name);
    assert.ok(travel > .02, `${name}: el hueso recorre ${travel} rad`);
    const { rate } = baked.library.stances.get(name).motion;
    assert.ok(Math.abs(perSecond - rate) < .15 * rate + .03, `${name}: ${perSecond.toFixed(3)} veces por segundo para ${rate}`);
  }
  // Sin `motion`, ni un hueso cambia con el tiempo una vez puesta la postura.
  const { gltf, library } = baked;
  const { layer, bones } = instance(gltf, library);
  layer.apply(5, { stance: 'bolsillos', speed: 0 });
  const held = [...bones.values()].map(bone => bone.quaternion.clone());
  for (let i = 0; i < 300; i++) { layer.restore(); layer.apply(1 / 60, { stance: 'bolsillos', speed: 0 }); }
  [...bones.values()].forEach((bone, i) => assert.ok(sameRotation(bone.quaternion, held[i]), bone.name));
});

test('el estilo dobla espalda y cabeza, en los dos modelos, y mecerse y cojear se notan al andar', async () => {
  const { gltf, library } = await bodyLibrary;
  const light = await parseAsset('/models/personaje/hombre-adulto/lod/cuerpo.gltf');
  for (const [source, options] of [[gltf, {}], [light, { lod: true }]]) {
    const { layer, bones } = instance(source, library, options);
    const rest = new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
    const moved = name => bones.get(name).quaternion.angleTo(rest.get(name));
    layer.apply(5, { style: { stoop: .8 }, speed: 0 });
    assert.ok(moved('mixamorigSpine1') > .05, `encorvarse: ${moved('mixamorigSpine1')}`);
    layer.restore();
    layer.apply(5, { style: { headDown: .8 }, speed: 0 });
    assert.ok(moved('mixamorigHead') > .05, `bajar la cabeza: ${moved('mixamorigHead')}`);
    layer.restore();
    assert.ok(sameRotation(bones.get('mixamorigHead').quaternion, rest.get('mixamorigHead')), 'al retirarse devuelve la base');
    layer.gaitWeight = 1;
    layer.apply(1, { style: { sway: 1, limp: 1 }, speed: 1, phase: .75 });
    const swaying = [...layer.dirty].map(slot => slot.bone.name);
    assert.ok(swaying.some(name => /Spine/.test(name)), 'mecerse dobla la columna');
    assert.ok(swaying.some(name => /Leg/.test(name)), 'cojear dobla la rodilla');
    layer.restore();
  }
});

test('el estilo entra igual a 30 y a 144 FPS, también mientras está entrando', async () => {
  const { gltf, library } = await bodyLibrary;
  const at = (fps, seconds) => {
    const { layer, bones } = instance(gltf, library, { seed: 3 });
    for (let i = 0; i < Math.round(fps * seconds); i++) { layer.restore(); layer.apply(1 / fps, { style: { stoop: 1, headDown: 1 }, speed: 0 }); }
    return { spine: bones.get('mixamorigSpine1').quaternion.clone(), head: bones.get('mixamorigHead').quaternion.clone(), stoop: layer.stoopNow };
  };
  for (const seconds of [1 / 6, 1 / 3, 1 / 2, 5 / 6, 3 / 2]) { // cuadros enteros a los dos ritmos
    const slow = at(30, seconds), fast = at(144, seconds);
    assert.ok(Math.abs(slow.stoop - fast.stoop) < .035, `a ${seconds} s: ${slow.stoop.toFixed(3)} frente a ${fast.stoop.toFixed(3)}`);
    assert.ok(slow.spine.angleTo(fast.spine) < .012, `espalda a ${seconds} s: ${slow.spine.angleTo(fast.spine)}`);
    assert.ok(slow.head.angleTo(fast.head) < .012, `cabeza a ${seconds} s: ${slow.head.angleTo(fast.head)}`);
  }
});
