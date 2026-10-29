import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Dog, DOG_COATS, DOG_DEFAULT_LOOK, legacyPetLook, normalizeDogLook } from '../src/entities/Dog.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

let modelPromise;
function model() {
  globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
  const data = fs.readFileSync(new URL('../public/models/perro.glb', import.meta.url));
  return modelPromise ??= new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}

async function dogWithModel(position = new THREE.Vector3(), look) {
  const dog = new Dog(new THREE.Scene(), position, look);
  dog._mountModel((await model()).scene);
  return dog;
}

function boneState(dog) {
  return [...dog._rig.values()].map(({ bone }) => [...bone.quaternion.toArray(), ...bone.position.toArray()]);
}

test('Dog inicializa con posición y estado neutral', () => {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3(10, 0, 20));
  assert.equal(dog.kind, 'dog');
  assert.equal(dog.title, 'El Chato');
  assert.equal(dog.isFriend, false);
  assert.equal(dog.position.x, 10);
  assert.equal(dog.position.z, 20);
  assert.deepEqual(dog.look, DOG_DEFAULT_LOOK);
});

test('el modelo generado es liviano y trae el esqueleto que anima el juego', async () => {
  const gltf = await model();
  let triangles = 0, skinned = 0;
  gltf.scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    skinned++;
    triangles += o.geometry.index.count / 3;
    assert.ok(o.geometry.attributes.color, 'los tonos del pelaje van en colores de vértice');
  });
  assert.ok(skinned >= 1 && triangles < 4000, `${triangles} triángulos`);
  const dog = await dogWithModel();
  for (const name of ['raiz', 'pelvis', 'pecho', 'cuello', 'cabeza', 'cola_1', 'cola_3', 'oreja_L',
    'brazo_L', 'antebrazo_R', 'mano_L', 'muslo_R', 'pierna_L', 'pie_R']) assert.ok(dog._rig.has(name), name);
  assert.equal(new THREE.Color(DOG_COATS.canela.color).getHex(), dog._coat.color.getHex());
  assert.ok(dog._accessory, 'el pañuelo rojo viene puesto');
});

test('Dog se hace amigo, reacciona a caricias y sigue al jugador', async () => {
  const dog = await dogWithModel();
  assert.equal(dog.pet(), true);
  assert.equal(dog.pet(), false, 'las caricias tienen enfriamiento');
  dog.befriend();
  assert.equal(dog.isFriend, true);
  const playerPos = new THREE.Vector3(10, 0, 0);
  for (let i = 0; i < 10; i++) dog.update(.1, playerPos, []);
  assert.ok(dog.position.x > .5, 'El perro se acerca al jugador');
  assert.equal(dog.state, 'follow');
  assert.ok(boneState(dog).flat().every(Number.isFinite));
});

test('si el jugador lo deja muy atrás reaparece cerca, y no pasa de largo al alcanzarlo', () => {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3());
  dog.befriend();
  const far = new THREE.Vector3(80, 0, 0);
  dog.update(.1, far, []);
  assert.ok(Math.abs(dog.position.distanceTo(far) - 2.5) < .01, 'aparece cerca, no encima del jugador');
  const player = new THREE.Vector3(85, 0, 0);
  for (let i = 0; i < 120; i++) dog.update(1 / 30, player, []);
  const dist = dog.position.distanceTo(player);
  assert.ok(dist >= 2 && dist < 2.6, `distancia ${dist}`);
});

test('quieto se sienta y luego se echa; al dormir queda acostado', async () => {
  const dog = await dogWithModel();
  dog.befriend();
  const player = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 4 * 30; i++) dog.update(1 / 30, player, []);
  assert.ok(dog._posture.sit > .9 && dog._posture.lie < .1);
  for (let i = 0; i < 14 * 30; i++) dog.update(1 / 30, player, []);
  assert.ok(dog._posture.lie > .9);
  dog.wake();
  dog.restAt(new THREE.Vector3(3, 0, 3));
  assert.equal(dog.sleeping, true);
  assert.ok(dog._rig.get('raiz').bone.position.y < -.2, 'el cuerpo baja al suelo');
});

test('Dog emite alerta cuando olfatea basura cercana y ante sospechosos', () => {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3(0, 0, 0));
  dog.befriend();
  const texts = [];
  globalThis.window.addEventListener('toast', e => texts.push(e.detail.text));
  dog._barkTimer = 11;
  dog.update(.1, new THREE.Vector3(1, 0, 1), [{ position: new THREE.Vector3(3, 0, 3) }]);
  assert.ok(texts.some(text => text.includes('basura')));
  dog.update(.1, new THREE.Vector3(1, 0, 1), [], [{ position: new THREE.Vector3(2, 0, 0), alerta: .8 }]);
  assert.equal(texts.length, 1, 'no repite ladridos dentro del enfriamiento');
  dog.time += 8;
  dog.update(.1, new THREE.Vector3(1, 0, 1), [], [{ position: new THREE.Vector3(2, 0, 0), alerta: .8 }]);
  assert.ok(texts.some(text => text.includes('sospechoso')));
});

test('sin dueño merodea cerca de su lugar', () => {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3(5, 0, 5));
  dog._wanderPause = 0;
  for (let i = 0; i < 300; i++) {
    dog.update(1 / 30, new THREE.Vector3(50, 0, 50), []);
    assert.ok(dog.position.distanceTo(dog.home) < 5.5);
  }
  assert.ok(dog.position.distanceTo(dog.home) > .3, 'se movió');
});

test('distrae a los peatones solo si acompaña al jugador de cerca', () => {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3());
  const player = new THREE.Vector3(2, 0, 0);
  assert.equal(dog.distractionBonus(player), 0);
  dog.befriend();
  assert.equal(dog.distractionBonus(player), .1);
  assert.equal(dog.distractionBonus(new THREE.Vector3(20, 0, 0)), 0);
});

test('la apariencia se normaliza, se aplica y migra desde la antigua mascota', async () => {
  assert.deepEqual(normalizeDogLook({ pelaje: 'azul', accesorio: 'capa', tamano: 9 }),
    { pelaje: DOG_DEFAULT_LOOK.pelaje, accesorio: DOG_DEFAULT_LOOK.accesorio, tamano: 1.25 });
  const dog = await dogWithModel();
  dog.setLook({ pelaje: 'negro', accesorio: 'gorra', tamano: .9 });
  assert.equal(dog._coat.color.getHex(), new THREE.Color(DOG_COATS.negro.color).getHex());
  assert.equal(dog.group.scale.x, .9);
  assert.equal(dog._accessory.parent, dog._rig.get('cabeza').bone);
  dog.setLook({ accesorio: 'ninguno' });
  assert.equal(dog._accessory, null);
  const storage = { getItem: () => JSON.stringify({ nombre: 'Rex', color: '#3498db', accesorio: 'bufanda', tamano: 1.6 }) };
  assert.deepEqual(legacyPetLook(storage), { pelaje: '#3498db', accesorio: 'panuelo', tamano: 1.25 });
  assert.equal(legacyPetLook({ getItem: () => null }), null);
});
