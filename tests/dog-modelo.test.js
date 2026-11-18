// El modelo de El Chato (public/models/perro.glb) y sus accesorios: lo que la animación y el dibujo dan por hecho.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Dog, DOG_ACCESSORIES } from '../src/entities/Dog.js';

const ARCHIVO = new URL('../public/models/perro.glb', import.meta.url);
// Pose de reposo de los 22 huesos que mueve Dog._animate: posición y giro (cuaternión) respecto a su padre.
const IZQUIERDOS = {
  muslo_L: [.07, .00217, .04995, .53266, .05945, -.00129, .84424], pierna_L: [0, .15264, 0, .44351, -.02985, .05143, .89429],
  pie_L: [0, .16125, 0, -.56026, 0, 0, .82831], brazo_L: [.07, .20526, .05973, .71704, .04852, .00231, .69533],
  antebrazo_L: [0, .15067, 0, .06137, -.03332, .03534, .99693], mano_L: [0, .17029, 0, -.50376, 0, 0, .86385],
  oreja_L: [.055, .04946, -.13249, .70662, .33122, .0358, .62426]
};
const REPOSO = {
  raiz: [0, 0, 0, 0, 0, 0, 1], pelvis: [0, .44, -.26, .7223, 0, 0, .69158], pecho: [0, .23022, 0, -.06915, 0, 0, .99761],
  cuello: [0, .21474, -.03982, -.27671, 0, 0, .96095], cabeza: [0, .16401, 0, .21839, 0, 0, .97586],
  cola_1: [0, -.03084, -.01868, -.97185, 0, 0, .23561], cola_2: [0, .08062, 0, .04319, 0, 0, .99907], cola_3: [0, .15811, 0, -.01941, 0, 0, .99981],
  ...IZQUIERDOS,
  // Los derechos son el espejo de los izquierdos.
  ...Object.fromEntries(Object.entries(IZQUIERDOS).map(([name, [x, y, z, qx, qy, qz, qw]]) => [name.replace('_L', '_R'), [-x, y, z, qx, -qy, -qz, qw]]))
};
const HUESOS = Object.keys(REPOSO);

beforeEach(() => {
  globalThis.window = new EventTarget();
});

let modelPromise;
function model() {
  globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
  const data = fs.readFileSync(ARCHIVO);
  return modelPromise ??= new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}

async function dogWithModel(look) {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3(), look);
  dog._mountModel((await model()).scene);
  return dog;
}

function mallas(root) {
  const found = [];
  root.traverse(o => { if (o.isSkinnedMesh) found.push(o); });
  return found;
}

/** Vértices en reposo que se mueven sobre todo con un hueso. */
function verticesDe(root, hueso) {
  const puntos = [];
  for (const mesh of mallas(root)) {
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      let mayor = 0;
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, mayor)) mayor = k;
      if (mesh.skeleton.bones[skinIndex.getComponent(i, mayor)].name === hueso) puntos.push(new THREE.Vector3().fromBufferAttribute(position, i));
    }
  }
  return puntos;
}

test('el archivo cabe en el presupuesto: una malla de dos materiales, pocos triángulos y poco peso', async () => {
  assert.ok(fs.statSync(ARCHIVO).size < 250 * 1024, `${fs.statSync(ARCHIVO).size} bytes`);
  const partes = mallas((await model()).scene);
  assert.deepEqual(partes.map(mesh => mesh.material.name).sort(), ['detalle', 'pelaje'], 'dos pedidos de dibujo, como siempre');
  const triangulos = partes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
  assert.ok(triangulos > 500 && triangulos <= 4000, `${triangulos} triángulos`);
  for (const mesh of partes) {
    assert.ok(mesh.geometry.attributes.color, 'los tonos van en colores de vértice');
    assert.equal(mesh.material.map, null, 'sin texturas');
  }
  const pelaje = partes.find(mesh => mesh.material.name === 'pelaje').material;
  assert.equal(pelaje.color.getHex(), 0xffffff, 'el pelaje sale blanco para que el juego lo tiña');
});

test('trae el esqueleto que anima el juego, en su pose de reposo y con las patas en el suelo', async () => {
  const dog = await dogWithModel();
  for (const name of HUESOS) assert.ok(dog._rig.has(name), `falta el hueso ${name}`);
  assert.equal(dog._rig.size, HUESOS.length, 'ni un hueso de más');
  for (const [name, reposo] of Object.entries(REPOSO)) {
    const { position, rest } = dog._rig.get(name);
    const tiene = [...position.toArray(), ...rest.toArray()];
    assert.ok(reposo.every((valor, i) => Math.abs(tiene[i] - valor) < 1e-5), `${name} cambió de pose de reposo: ${tiene.map(v => v.toFixed(5))}`);
  }
  const altura = name => dog._rig.get(name).bone.getWorldPosition(new THREE.Vector3());
  // LEG = .4 en Dog.js: hombros y caderas a esa altura, o la zancada patina.
  for (const name of ['brazo_L', 'brazo_R', 'muslo_L', 'muslo_R']) assert.ok(Math.abs(altura(name).y - .39) < .005, name);
  assert.ok(Math.abs(altura('cabeza').y - .59) < .005 && Math.abs(altura('cabeza').z - .31) < .005, 'la cabeza gira donde siempre');
  assert.ok(Math.abs(altura('oreja_L').x - .055) < .005 && Math.abs(altura('oreja_R').x + .055) < .005);
  for (const name of ['mano_L', 'mano_R', 'pie_L', 'pie_R']) {
    const suelo = Math.min(...verticesDe(dog.model, name).map(p => p.y));
    assert.ok(Math.abs(suelo) < .005, `${name} pisa en y = ${suelo}`);
  }
});

test('se reconoce de lejos: una oreja parada y otra caída, cola en gancho, manchas y brillo en los ojos', async () => {
  const dog = await dogWithModel();
  const alto = name => Math.max(...verticesDe(dog.model, name).map(p => p.y));
  assert.ok(alto('oreja_R') - alto('oreja_L') > .05, 'la oreja derecha va parada y la izquierda caída');
  const cola = verticesDe(dog.model, 'cola_3');
  const punta = cola.reduce((a, b) => (b.y > a.y ? b : a));
  assert.ok(Math.max(...cola.map(p => p.z)) < -.36 && punta.y > .7, 'la cola sube y se enrosca hacia el lomo, no sale recta');
  const tonos = new Set(), colores = [];
  for (const mesh of mallas(dog.model)) {
    const color = mesh.geometry.attributes.color;
    for (let i = 0; i < color.count; i++) {
      const c = new THREE.Color().fromBufferAttribute(color, i);
      if (mesh.material.name === 'pelaje') tonos.add(c.r.toFixed(2));
      else colores.push(c);
    }
  }
  assert.ok(tonos.size >= 4, `${tonos.size} tonos de pelaje: claro, base, lomo y parche`);
  assert.ok(colores.some(c => Math.min(c.r, c.g, c.b) > .95), 'el brillo de los ojos es blanco');
  assert.ok(colores.some(c => Math.max(c.r, c.g, c.b) < .05), 'trufa y ojos oscuros');
  assert.ok(colores.some(c => c.r > c.g * 2 && c.r > .4), 'lengua rosada');
});

/** Puntos de una malla según sus normales: suaves si todas coinciden, con filo si alguna se aparta. */
function filos(mesh, huesos) {
  const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes, puntos = new Map();
  for (let i = 0; i < position.count; i++) {
    if (huesos) {
      let mayor = 0;
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, mayor)) mayor = k;
      if (!huesos.includes(mesh.skeleton.bones[skinIndex.getComponent(i, mayor)].name)) continue;
    }
    const clave = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 1e4)).join();
    if (!puntos.has(clave)) puntos.set(clave, []);
    puntos.get(clave).push(new THREE.Vector3().fromBufferAttribute(normal, i));
  }
  const cuenta = { suaves: 0, conFilo: 0 };
  for (const normales of puntos.values()) cuenta[normales.every(n => n.dot(normales[0]) > .999) ? 'suaves' : 'conFilo']++;
  return cuenta;
}

test('va con sombreado suave y filo solo en las aristas, el perro y sus accesorios', async () => {
  const dog = await dogWithModel({ accesorio: 'ninguno' });
  assert.equal(dog._coat.flatShading, false, 'el filo viene en las normales del modelo, no de dibujarlo con caras planas');
  const pelaje = mallas(dog.model).find(mesh => mesh.material.name === 'pelaje');
  const cuerpo = filos(pelaje, ['pecho', 'pelvis', 'cuello']);
  assert.ok(cuerpo.suaves > 50, `tronco y cuello suaves: ${cuerpo.suaves} puntos`);
  const patas = filos(pelaje, HUESOS.filter(name => /^(antebrazo|mano|pierna|pie)_/.test(name)));
  assert.ok(patas.conFilo > 60 && patas.suaves < 10, `las patas conservan su filo: ${patas.conFilo} con filo, ${patas.suaves} suaves`);
  for (const name of ['oreja_L', 'oreja_R', 'cola_3']) assert.ok(filos(pelaje, [name]).conFilo > 3, `${name} conserva su filo`);
  for (const kind of Object.keys(DOG_ACCESSORIES).filter(k => k !== 'ninguno')) {
    dog.setLook({ accesorio: kind });
    assert.equal(dog._accessory.material.flatShading, false, `${kind} no se dibuja con caras planas`);
    const { suaves, conFilo } = filos(dog._accessory);
    assert.ok(suaves > 0 && conFilo > 0, `${kind} tiene partes suaves y bordes con filo: ${suaves} y ${conFilo}`);
  }
});

test('cada accesorio es una sola malla que se ata a su hueso y se libera al cambiarlo', async () => {
  const dog = await dogWithModel({ accesorio: 'ninguno' });
  assert.ok(!dog._accessory, 'sin accesorio no se arma nada');
  for (const kind of Object.keys(DOG_ACCESSORIES).filter(k => k !== 'ninguno')) {
    dog.setLook({ accesorio: kind });
    const accessory = dog._accessory;
    assert.ok(accessory?.isMesh, `${kind} es una sola malla (un pedido de dibujo)`);
    assert.equal(accessory.name, `accesorio-${kind}`);
    assert.equal(accessory.parent, dog._rig.get(kind === 'gorra' ? 'cabeza' : 'cuello').bone);
    assert.ok(accessory.geometry.attributes.color && accessory.material.vertexColors, 'pintado por vértice');
    const triangulos = accessory.geometry.attributes.position.count / 3;
    assert.ok(triangulos > 20 && triangulos < 400, `${kind}: ${triangulos} triángulos`);
    let liberados = 0;
    accessory.geometry.addEventListener('dispose', () => liberados++);
    accessory.material.addEventListener('dispose', () => liberados++);
    dog.setLook({ accesorio: 'ninguno' });
    assert.equal(liberados, 2, `${kind} libera su geometría y su material`);
    assert.equal(accessory.parent, null);
  }
  dog.setLook({ accesorio: 'collar' });
  let liberados = 0;
  dog._accessory.geometry.addEventListener('dispose', () => liberados++);
  dog.destroy();
  assert.equal(liberados, 1, 'al destruir al perro se libera el accesorio puesto');
});

test('la gorra no atraviesa las orejas y el pañuelo cae sobre el pecho', async () => {
  const dog = await dogWithModel({ accesorio: 'gorra' });
  dog.group.updateMatrixWorld(true);
  const gorra = new THREE.Box3().setFromObject(dog._accessory).expandByScalar(-.004);
  for (const name of ['oreja_L', 'oreja_R']) {
    for (const p of verticesDe(dog.model, name)) assert.ok(!gorra.containsPoint(p), `la gorra pisa la ${name}`);
  }
  assert.ok(gorra.min.y > .7, 'va sobre la cabeza');
  dog.setLook({ accesorio: 'panuelo' });
  dog.group.updateMatrixWorld(true);
  const panuelo = new THREE.Box3().setFromObject(dog._accessory);
  assert.ok(panuelo.min.y < .42 && panuelo.max.y > .62, 'del nudo en la nuca a la punta sobre el pecho');
});
