import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const shareSkeletons = async root => (await import('../src/character/sharedSkeleton.js')).shareSkeletons(root);

const BONES = 52;

/** Un cuerpo de juguete: cadena de 52 huesos, dos mallas del cuerpo y tres piezas atadas como en attachPart. */
function rig() {
  const root = new THREE.Group();
  const bones = [];
  for (let i = 0; i < BONES; i++) {
    const bone = new THREE.Bone();
    bone.name = `b${i}`;
    bone.position.set(i % 3 === 0 ? .05 : 0, .1, 0);
    (bones[i - 1] ?? root).add(bone);
    bones.push(bone);
  }
  root.updateMatrixWorld(true);
  const inverses = bones.map(bone => bone.matrixWorld.clone().invert());
  const geometry = () => {
    const g = new THREE.BoxGeometry(.2, .2, .2, 1, 4, 1);
    const count = g.attributes.position.count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4).map((_, k) => (k * 7) % BONES), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(.25), 4));
    return g;
  };
  const mesh = (name, skeleton, bindMatrix = new THREE.Matrix4().makeTranslation(.01, 0, 0)) => {
    const m = new THREE.SkinnedMesh(geometry(), new THREE.MeshBasicMaterial());
    m.name = name;
    root.add(m);
    m.bind(skeleton, bindMatrix);
    return m;
  };
  // Como GLTFLoader: un esqueleto por malla, con sus propias matrices inversas de igual valor.
  const body = mesh('Body', new THREE.Skeleton(bones, inverses.map(m => m.clone())));
  const brows = mesh('Eyebrows', new THREE.Skeleton(bones, inverses.map(m => m.clone())));
  // Como attachPart: huesos buscados por nombre y las inversas del archivo de la pieza.
  // El pelo trae su propio bindMatrix, distinto del de las demás mallas: compartir no debe tocarlo.
  const parts = ['ropa', 'pelo', 'calzado'].map(name => mesh(name, new THREE.Skeleton(bones.slice(), inverses.map(m => m.clone())),
    name === 'pelo' ? new THREE.Matrix4().makeRotationZ(.2).setPosition(0, .03, -.02) : undefined));
  return { root, bones, body, brows, parts, inverses };
}

function pose(bones, t) {
  bones.forEach((bone, i) => bone.rotation.set(Math.sin(t + i) * .3, Math.cos(t * 2 + i) * .2, i * .01));
  bones[0].parent.updateMatrixWorld(true);
}

const skinned = root => { const out = []; root.traverse(o => { if (o.isSkinnedMesh) out.push(o); }); return out; };

test('las piezas con huesos e inversas iguales comparten el esqueleto del cuerpo y dan los mismos números', async () => {
  const { root, bones, body, parts } = rig();
  const odd = parts[0], swapped = parts[2];
  // Una inversa distinta en 1e-6 y dos huesos en otro orden (con las inversas en el orden del cuerpo, así que
  // solo el orden de los huesos los distingue): esas conservan su esqueleto.
  odd.skeleton.boneInverses[10].elements[12] += 1e-6;
  [swapped.skeleton.bones[3], swapped.skeleton.bones[4]] = [swapped.skeleton.bones[4], swapped.skeleton.bones[3]];
  const ownBind = parts[1].bindMatrix.clone();
  pose(bones, .7);
  const expected = new Map(), vertex = new THREE.Vector3(), skinnedVertices = new Map();
  for (const mesh of skinned(root)) {
    mesh.skeleton.update();
    expected.set(mesh, Float32Array.from(mesh.skeleton.boneMatrices));
    skinnedVertices.set(mesh, Array.from({ length: 8 }, (_, i) => mesh.applyBoneTransform(i * 3, mesh.getVertexPosition(i * 3, vertex)).toArray()));
  }
  const disposed = [];
  for (const mesh of skinned(root)) {
    const original = mesh.skeleton.dispose.bind(mesh.skeleton);
    mesh.skeleton.dispose = () => { disposed.push(mesh.name); original(); };
  }

  const result = await shareSkeletons(root);
  assert.deepEqual(result, { before: 5, after: 3 });
  const meshes = skinned(root);
  assert.equal(new Set(meshes.map(mesh => mesh.skeleton)).size, 3);
  assert.equal(parts[1].skeleton, body.skeleton);
  assert.notEqual(odd.skeleton, body.skeleton);
  assert.notEqual(swapped.skeleton, body.skeleton);
  assert.deepEqual(disposed.sort(), ['Eyebrows', 'pelo'], 'se liberan los esqueletos que quedan sin uso');
  assert.deepEqual(parts[1].bindMatrix.elements, ownBind.elements, 'el pelo perdió su bindMatrix');
  assert.notDeepEqual(parts[1].bindMatrix.elements, body.bindMatrix.elements);

  for (const t of [.7, 2.3]) {
    pose(bones, t);
    for (const mesh of meshes) mesh.skeleton.update();
    for (const mesh of meshes) {
      if (t === .7) assert.deepEqual(Float32Array.from(mesh.skeleton.boneMatrices), expected.get(mesh), `${mesh.name}: huesos`);
      if (t === .7) {
        const now = Array.from({ length: 8 }, (_, i) => mesh.applyBoneTransform(i * 3, mesh.getVertexPosition(i * 3, new THREE.Vector3())).toArray());
        assert.deepEqual(now, skinnedVertices.get(mesh), `${mesh.name}: vértices`);
      }
    }
  }
  // Liberar al personaje entero (como disposeRealisticInstance) no libera dos veces ni falla.
  const skeletons = new Set(meshes.map(mesh => mesh.skeleton));
  for (const skeleton of skeletons) skeleton.dispose();
});

test('sin piezas, o con una sola malla, no cambia nada', async () => {
  assert.deepEqual(await shareSkeletons(new THREE.Group()), { before: 0, after: 0 });
  const { root, body } = rig();
  for (const mesh of skinned(root)) if (mesh !== body) mesh.removeFromParent();
  const own = body.skeleton;
  assert.deepEqual(await shareSkeletons(root), { before: 1, after: 1 });
  assert.equal(body.skeleton, own);
});

test('una prenda con un hueso que el cuerpo no tiene conserva su esqueleto y su pose', async () => {
  const { root, bones, body, parts, inverses } = rig();
  const tail = new THREE.Bone();
  tail.name = 'cola';
  bones[0].add(tail);
  root.updateMatrixWorld(true);
  const extra = new THREE.SkinnedMesh(parts[0].geometry, new THREE.MeshBasicMaterial());
  extra.name = 'ruana';
  root.add(extra);
  extra.bind(new THREE.Skeleton([...bones, tail], [...inverses.map(m => m.clone()), tail.matrixWorld.clone().invert()]), new THREE.Matrix4());
  const own = extra.skeleton;
  pose(bones, 1.1);
  own.update();
  const expected = Float32Array.from(own.boneMatrices);
  assert.deepEqual(await shareSkeletons(root), { before: 6, after: 2 });
  assert.equal(extra.skeleton, own);
  assert.equal(parts[0].skeleton, body.skeleton);
  extra.skeleton.update();
  assert.deepEqual(Float32Array.from(extra.skeleton.boneMatrices), expected);
});

// Personajes reales, con los glTF del juego: cada malla termina con huesos e inversas idénticos a los de su propio archivo.
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const sources = new Map(); // nombre de malla → mallas con piel tal como vienen en los archivos
const disposals = new Map(); // esqueleto → veces que se liberó
let createRealisticCharacter;

test.before(async () => {
  const originalFetch = globalThis.fetch;
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
    result.scene.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      if (!sources.has(mesh.name)) sources.set(mesh.name, []);
      sources.get(mesh.name).push(mesh);
    });
    return result;
  });
  const dispose = THREE.Skeleton.prototype.dispose;
  mock.method(THREE.Skeleton.prototype, 'dispose', function () {
    disposals.set(this, (disposals.get(this) ?? 0) + 1);
    return dispose.call(this);
  });
  ({ createRealisticCharacter } = await import('../src/character/RealisticCharacter.js'));
});
test.after(() => mock.restoreAll());

const LOOKS = [
  { real: { sexo: 'hombre', edad: 'adulto', pelo: 'corto', barba: 'descuidada', ropa: 'buzo', calzado: 'tenis', cabeza: 'sin-sombrero' } },
  { real: { sexo: 'mujer', edad: 'joven', pelo: 'largo', ropa: 'policia', calzado: 'botas' } },
  { real: { sexo: 'mujer', edad: 'mayor', pelo: 'crespo' } },
  { real: { sexo: 'hombre', edad: 'mayor', pelo: 'rapado', barba: 'larga' } }
];
const skeletonsOf = character => new Set(skinned(character.group).map(mesh => mesh.skeleton));
const topOf = object => { while (object.parent) object = object.parent; return object; };

test('personajes reales: un esqueleto donde había varios, con las inversas de cada archivo', async () => {
  const sameInverses = (a, b) => a.length === b.length && a.every((m, i) => m.elements.every((v, k) => Object.is(v, b[i].elements[k])));
  let meshes = 0, skeletons = 0;
  for (const look of LOOKS) for (const lod of [false, true]) {
    const character = await createRealisticCharacter(look, { lod });
    character.update(.3, { speed: 1.2, movement: { grounded: true } });
    const list = skinned(character.group);
    const unique = skeletonsOf(character);
    meshes += list.length; skeletons += unique.size;
    for (const mesh of list) {
      const names = mesh.skeleton.bones.map(bone => bone.name).join();
      const own = (sources.get(mesh.name) ?? []).filter(source => source.skeleton.bones.map(bone => bone.name).join() === names);
      assert.ok(own.some(source => sameInverses(source.skeleton.boneInverses, mesh.skeleton.boneInverses)),
        `${look.real.sexo}-${look.real.edad}${lod ? ' liviano' : ''}: ${mesh.name} usa inversas que no son las suyas`);
      // Los huesos son los de este personaje, no los del archivo.
      for (const bone of mesh.skeleton.bones) assert.equal(topOf(bone), character.group, 'hueso de otro personaje');
    }
    assert.equal(unique.size, 1, `${look.real.sexo}-${look.real.edad}${lod ? ' liviano' : ''}: ${list.length} mallas con piel y ${unique.size} esqueletos`);
    character.dispose();
  }
  assert.ok(skeletons * 2 < meshes, `${meshes} mallas con piel, ${skeletons} esqueletos`);
});

test('dos personajes del mismo modelo no comparten esqueleto entre ellos', async () => {
  for (const lod of [false, true]) {
    const a = await createRealisticCharacter(LOOKS[0], { lod });
    const b = await createRealisticCharacter(LOOKS[0], { lod });
    const sa = skeletonsOf(a), sb = skeletonsOf(b);
    assert.equal(sa.size, 1, `${lod ? 'liviano' : 'completo'}: el primero tiene ${sa.size} esqueletos`);
    assert.equal(sb.size, 1, `${lod ? 'liviano' : 'completo'}: el segundo tiene ${sb.size} esqueletos`);
    assert.notEqual([...sa][0], [...sb][0], `${lod ? 'liviano' : 'completo'}: los dos usan el mismo esqueleto`);
    for (const bone of [...sb][0].bones) assert.equal(topOf(bone), b.group, 'el segundo usa huesos del primero');
    // Mover a uno no mueve al otro.
    const read = character => { character.group.updateMatrixWorld(true); const s = [...skeletonsOf(character)][0]; s.update(); return Float32Array.from(s.boneMatrices); };
    const still = read(b);
    a.update(.5, { speed: 4, running: true, movement: { grounded: true } });
    read(a);
    assert.deepEqual(read(b), still);
    a.dispose(); b.dispose();
  }
});

test('cambiar de ropa y de pelo después de creado deja un esqueleto y libera los de antes una sola vez', async () => {
  const character = await createRealisticCharacter(LOOKS[0]);
  const first = skeletonsOf(character);
  // Como el renderizador: cada esqueleto con su textura de huesos.
  for (const skeleton of first) skeleton.computeBoneTexture();
  await character.setLook({ real: { ...LOOKS[0].real, ropa: 'camisa', pelo: 'largo', barba: 'ninguna', cabeza: 'boina' } });
  const second = skeletonsOf(character);
  assert.equal(second.size, 1, `${skinned(character.group).length} mallas con ${second.size} esqueletos tras cambiar de ropa`);
  for (const skeleton of second) assert.ok(!first.has(skeleton), 'quedó un esqueleto de la ropa anterior');
  for (const skeleton of first) {
    assert.equal(disposals.get(skeleton), 1, 'el esqueleto de antes se liberó más de una vez o ninguna');
    assert.equal(skeleton.boneTexture, null);
  }
  for (const bone of [...second][0].bones) assert.equal(topOf(bone), character.group);
  for (const skeleton of second) skeleton.computeBoneTexture();
  character.dispose();
  character.dispose();
  for (const skeleton of second) {
    assert.equal(disposals.get(skeleton), 1, 'al soltar al personaje su esqueleto se liberó más de una vez o ninguna');
    assert.equal(skeleton.boneTexture, null);
  }
  for (const skeleton of first) assert.equal(disposals.get(skeleton), 1, 'al soltar al personaje se liberó otra vez un esqueleto de la ropa anterior');
  assert.equal(character.group.parent, null);
  for (const [skeleton, times] of disposals) assert.ok(times <= 1, `un esqueleto de ${skeleton.bones.length} huesos se liberó ${times} veces`);
});
