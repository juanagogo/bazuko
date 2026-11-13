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

test('sin dueño merodea cerca de su lugar', (t) => {
  // Azar sembrado: sin semilla, alguna vez el perro apenas se movía en esos 10 s.
  let semilla = 7;
  t.mock.method(Math, 'random', () => (semilla = semilla * 16807 % 2147483647) / 2147483647);
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3(5, 0, 5));
  dog._wanderPause = 0;
  // Lo que importa es que salió de su sitio: el punto final depende del azar del merodeo, que puede
  // devolverlo cerca de donde empezó al cruzar de un destino a otro.
  let lejos = 0;
  for (let i = 0; i < 300; i++) {
    dog.update(1 / 30, new THREE.Vector3(50, 0, 50), []);
    assert.ok(dog.position.distanceTo(dog.home) < 5.5);
    lejos = Math.max(lejos, dog.position.distanceTo(dog.home));
  }
  assert.ok(lejos > .3, 'se movió');
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

test('El Chato le ladra a una patrulla cercana solo si estoy fichado o me persiguen', async () => {
  const { DOG_POLICE_ALERT } = await import('../src/entities/Dog.js');
  const dog = await dogWithModel(new THREE.Vector3(0, 0, 0));
  dog.befriend();
  const alerts = [];
  window.addEventListener('dog-alert', e => alerts.push(e.detail.kind));
  const player = new THREE.Vector3(1, 0, 0);
  assert.equal(DOG_POLICE_ALERT, 32);
  const patrol = { police: true, state: 'patrol', car: { position: new THREE.Vector3(DOG_POLICE_ALERT + 1, 0, 0) } };
  dog.update(.1, player, [], [], { patrols: [patrol], wanted: 1 });
  assert.deepEqual(alerts, [], 'a más de 32 m todavía no la oye');
  patrol.car.position.x = DOG_POLICE_ALERT - 5;
  dog.update(.1, player, [], [], { patrols: [patrol], wanted: 0 });
  assert.deepEqual(alerts, []);
  dog.update(.1, player, [], [], { patrols: [patrol], wanted: 1 });
  assert.deepEqual(alerts, ['policia']);
  dog.update(.1, player, [], [], { patrols: [patrol], wanted: 1 });
  assert.deepEqual(alerts, ['policia'], 'no ladra en cada cuadro');
  // Sin estar fichado, también avisa de la que ya lo persigue.
  const otra = { police: true, state: 'chase', car: { position: new THREE.Vector3(0, 0, 10) } };
  for (let i = 0; i < 200; i++) dog.update(.1, player, [], [], { patrols: [patrol, otra], wanted: 0 });
  assert.deepEqual(alerts, ['policia', 'policia']);
  // Un carro que no es de la Policía no cuenta.
  const civil = { police: false, state: 'patrol', car: { position: new THREE.Vector3(0, 0, 5) } };
  for (let i = 0; i < 200; i++) dog.update(.1, player, [], [], { patrols: [civil], wanted: 2 });
  assert.deepEqual(alerts, ['policia', 'policia']);
  dog.destroy();
});

test('El Chato avisa una vez por patrulla que se arrima y no repite mientras siga cerca', async () => {
  const { DOG_POLICE_ALERT } = await import('../src/entities/Dog.js');
  const dog = await dogWithModel(new THREE.Vector3(0, 0, 0));
  dog.befriend();
  const toasts = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
  const player = new THREE.Vector3(1, 0, 0);
  const patrol = { police: true, state: 'chase', car: { position: new THREE.Vector3(20, 0, 0) } };
  const minuto = () => { for (let i = 0; i < 600; i++) dog.update(.1, player, [], [], { patrols: [patrol], wanted: 1 }); };
  minuto();
  assert.deepEqual(toasts, ['El Chato: ¡Le ladra a una patrulla que viene!'], 'un minuto con la patrulla encima: un solo aviso');
  // Se aleja apenas pasando el borde y vuelve: sigue siendo la misma, no avisa otra vez.
  patrol.car.position.set(DOG_POLICE_ALERT + 3, 0, 0); minuto();
  patrol.car.position.set(20, 0, 0); minuto();
  assert.equal(toasts.length, 1);
  // Se va de verdad y vuelve: avisa de nuevo.
  patrol.car.position.set(DOG_POLICE_ALERT + 30, 0, 0); minuto();
  patrol.car.position.set(20, 0, 0); minuto();
  assert.equal(toasts.length, 2);
  // Dos patrullas que llegan seguidas no dan dos avisos pegados: el segundo espera.
  const otra = { police: true, state: 'chase', car: { position: new THREE.Vector3(0, 0, 60) } };
  patrol.car.position.set(DOG_POLICE_ALERT + 30, 0, 0); minuto();
  patrol.car.position.set(20, 0, 0); otra.car.position.set(0, 0, 60);
  dog.update(.1, player, [], [], { patrols: [patrol, otra], wanted: 1 });
  otra.car.position.set(0, 0, 15);
  for (let i = 0; i < 145; i++) dog.update(.1, player, [], [], { patrols: [patrol, otra], wanted: 1 });
  assert.equal(toasts.length, 3, 'a los 14,5 s todavía no avisa de la segunda');
  for (let i = 0; i < 10; i++) dog.update(.1, player, [], [], { patrols: [patrol, otra], wanted: 1 });
  assert.equal(toasts.length, 4, 'pasados 15 s, sí');
  dog.destroy();
});

test('mientras le ladra a la patrulla, El Chato queda mirando hacia donde viene', async () => {
  const dog = await dogWithModel(new THREE.Vector3(0, 0, 0));
  dog.befriend();
  const player = new THREE.Vector3(0, 0, 1.5); // quieto a su lado: sin patrulla, me mira a mí
  const hacia = (p) => Math.atan2(p.x - dog.position.x, p.z - dog.position.z);
  const desvio = (p) => Math.abs(Math.atan2(Math.sin(hacia(p) - dog.group.rotation.y), Math.cos(hacia(p) - dog.group.rotation.y)));
  // Llevo un rato quieto y él ya está echado.
  for (let i = 0; i < 200; i++) dog.update(.1, player, [], []);
  assert.equal(dog._lookAt, player);
  assert.ok(dog._posture.lie > .9, 'echado');
  // La patrulla llega por detrás de él.
  const patrol = { police: true, state: 'patrol', car: { position: new THREE.Vector3(-18, 0, -12) } };
  assert.ok(desvio(patrol.car.position) > 2, 'empieza de espaldas a la patrulla');
  for (let i = 0; i < 20; i++) {
    dog.update(.1, player, [], [], { patrols: [patrol], wanted: 1 });
    assert.equal(dog._lookAt, patrol.car.position, 'la mira mientras ladra');
  }
  assert.ok(dog._posture.lie < .1 && dog._posture.sit < .1, 'se paró');
  assert.ok(desvio(patrol.car.position) < 1, `giró el cuerpo hacia ella: ${desvio(patrol.car.position).toFixed(2)} rad`);
  assert.ok(dog._posture.alert > .5, 'con las orejas paradas');
  // Sigue a la patrulla si se mueve, y a los pocos segundos vuelve a mirarme.
  patrol.car.position.set(-18, 0, 6);
  dog.update(.1, player, [], [], { patrols: [patrol], wanted: 1 });
  assert.equal(dog._lookAt, patrol.car.position);
  for (let i = 0; i < 40; i++) dog.update(.1, player, [], [], { patrols: [patrol], wanted: 1 });
  assert.equal(dog._lookAt, player);
  dog.destroy();
});

test('cuidando el cambuche no sigue al jugador y vuelve a su puesto', async () => {
  const dog = await dogWithModel(new THREE.Vector3(0, 0, 0));
  dog.befriend();
  assert.equal(dog.guard(new THREE.Vector3(2, 0, 0)), true);
  const far = new THREE.Vector3(30, 0, 0);
  for (let i = 0; i < 40; i++) dog.update(.1, far, [], []);
  assert.ok(dog.position.distanceTo(new THREE.Vector3(2, 0, 0)) < 1.3);
  dog.restAt(far);
  assert.equal(dog.sleeping, false, 'no se va a dormir al lado del jugador lejano');
  dog.stopGuarding();
  assert.equal(dog.guarding, null);
  dog.destroy();
});
