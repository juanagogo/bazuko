import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bakeStances, STANCE_NAMES } from '../src/character/stances.js';
import { BodyLanguage } from '../src/character/BodyLanguage.js';
import { bakeGaitFamily, buildGaitSources } from '../src/character/gaitFamilies.js';
import { createSkinSupport } from '../src/character/mixamoGrounding.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = new URL('../public/models/', import.meta.url);
const BODIES = ['hombre-adulto', 'hombre-joven', 'hombre-mayor', 'mujer-adulta', 'mujer-joven', 'mujer-mayor'];

async function glb(file) {
  const data = fs.readFileSync(new URL(file, models));
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}

async function body(id, lod = false) {
  const location = pathModule.join(fileURLToPath(models), 'personaje', id, lod ? 'lod' : '');
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

const banks = Promise.all([glb('andar-erguido.glb'), glb('andar-cansado.glb')]);
const libraries = new Map();
function library(id) {
  if (!libraries.has(id)) libraries.set(id, (async () => {
    const gltf = await body(id);
    const [upright, tired] = await banks;
    const sources = buildGaitSources(gltf, upright, tired);
    return { gltf, sources, library: bakeStances(gltf.scene, sources.standing), rest: bakeGaitFamily(gltf.scene, sources, 'normal').idle };
  })());
  return libraries.get(id);
}

/** Una instancia de prueba: copia del cuerpo con su capa, sin mezclador. */
function instance(gltf, lib, options = {}) {
  const root = clone(gltf.scene);
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  return { root, bones, layer: new BodyLanguage(bones, lib, options) };
}

/** Una instancia de pie con el reposo de su familia debajo, como la deja el mezclador en el juego. */
function standing({ gltf, library: lib, rest }, options = {}) {
  const item = instance(gltf, lib, options);
  const mixer = new THREE.AnimationMixer(item.root);
  mixer.clipAction(rest).play();
  mixer.update(0);
  const hold = (stance, params = {}) => {
    item.layer.restore();
    mixer.setTime(0);
    item.layer.apply(5, { stance, speed: 0, ...params });
    item.root.updateMatrixWorld(true);
  };
  return { ...item, hold };
}

const snapshot = bones => [...bones.values()].map(bone => [...bone.quaternion.toArray(), ...bone.position.toArray()]);

test('la lista de posturas tiene las que pide el diseño y las que usan jugador y vendedores', () => {
  for (const name of ['bolsillos', 'brazos-cruzados', 'telefono', 'celular', 'manos-atras', 'hablar', 'fumar-quieto', 'sentado', 'acurrucado', 'banca', 'pedir', 'paraguas', 'cubrirse', 'nariz', 'huir', 'tendido', 'cargar-derecha', 'cargar-izquierda', 'atender', 'dormido', 'barriga', 'frotarse', 'rascarse', 'encogido', 'cambiar-peso', 'mirar-izquierda', 'mirar-derecha']) {
    assert.ok(STANCE_NAMES.includes(name), name);
  }
});

test('todas las posturas son finitas y unitarias en cada cuerpo, y solo tocan huesos', async () => {
  for (const id of BODIES) {
    const { gltf, library: lib } = await library(id);
    const names = new Set();
    gltf.scene.traverse(node => { if (node.isBone) names.add(node.name); });
    for (const name of STANCE_NAMES) {
      const stance = lib.stances.get(name);
      assert.ok(stance, `${id}: falta ${name}`);
      assert.ok(stance.entries.length > 0, `${id}/${name}: no toca nada`);
      for (const { boneName, quaternion, alt, peso } of stance.entries) {
        assert.ok(names.has(boneName), `${id}/${name}: ${boneName} no es un hueso`);
        for (const q of [quaternion, alt].filter(Boolean)) {
          assert.ok(q.toArray().every(Number.isFinite), `${id}/${name}/${boneName}`);
          assert.ok(Math.abs(q.length() - 1) < 1e-4, `${id}/${name}/${boneName} no es unitario`);
        }
        assert.ok(peso > 0 && peso <= 1);
      }
      if (stance.hip) assert.ok(stance.hip.toArray().every(Number.isFinite), `${id}/${name}: cadera`);
    }
  }
});

test('las posturas que se conservan andando no tocan piernas ni cadera', async () => {
  const { library: lib } = await library('hombre-adulto');
  for (const stance of lib.stances.values()) {
    if (!stance.walk) continue;
    assert.equal(stance.hip, null, stance.name);
    for (const { boneName } of stance.entries) {
      assert.ok(!/Hips|UpLeg|Leg|Foot|Toe/.test(boneName), `${stance.name} toca ${boneName}`);
    }
  }
});

test('la raíz no se mueve: ni la escena ni sus nodos fuera de la cadera y los huesos', async () => {
  const { gltf, library: lib } = await library('hombre-adulto');
  const { root, layer, bones } = instance(gltf, lib);
  const nodes = [];
  root.traverse(node => { if (!node.isBone) nodes.push([node, node.position.clone(), node.quaternion.clone()]); });
  const hips = [...bones.values()].find(bone => /hips$/i.test(bone.name));
  const others = [...bones.values()].filter(bone => bone !== hips).map(bone => [bone, bone.position.clone()]);
  for (const stance of STANCE_NAMES) {
    for (let i = 0; i < 90; i++) { layer.restore(); layer.apply(1 / 30, { stance, speed: 0, style: { stoop: 1, sway: 1, limp: 1 }, ko: 0 }); }
    for (const [node, position, quaternion] of nodes) {
      assert.ok(node.position.equals(position) && node.quaternion.equals(quaternion), `${stance} movió ${node.name}`);
    }
    for (const [bone, position] of others) assert.ok(bone.position.equals(position), `${stance} movió ${bone.name}`);
  }
});

test('las posturas bajas descansan en el piso sin atravesarlo; en la banca los pies apoyan y la pelvis queda sobre el asiento', async () => {
  for (const id of BODIES) {
    const baked = await library(id);
    const { root, bones, hold } = standing(baked);
    const support = createSkinSupport(root);
    const hips = [...bones.values()].find(bone => /Hips$/.test(bone.name));
    for (const [stance, min, max] of [['sentado', -.01, .03], ['acurrucado', -.01, .03], ['pedir', -.01, .04], ['dormido', -.05, .03], ['banca', -.01, .03]]) {
      hold(stance);
      const low = support.minimumY();
      assert.ok(low > min && low < max, `${id}/${stance}: lo más bajo a ${low.toFixed(3)} m`);
    }
    hold('banca');
    const pelvis = hips.getWorldPosition(new THREE.Vector3()).y * 1.08;
    assert.ok(pelvis > .5 && pelvis < .72, `${id}/banca: pelvis a ${pelvis.toFixed(3)} m`);
  }
});

test('las manos llegan: bolsillo, oído, nariz, cabeza y espalda, en todos los cuerpos', async () => {
  for (const id of BODIES) {
    const { bones, hold } = standing(await library(id));
    const find = suffix => [...bones.values()].find(bone => bone.name.endsWith(suffix));
    const at = bone => bone.getWorldPosition(new THREE.Vector3());
    const right = find('RightHand'), left = find('LeftHand'), head = find('Head'), hips = find('Hips');
    hold('bolsillos');
    for (const [hand, leg] of [[right, find('RightUpLeg')], [left, find('LeftUpLeg')]]) {
      const reach = at(hand).distanceTo(at(leg));
      assert.ok(reach < .13, `${id}: la mano queda a ${reach.toFixed(3)} m del bolsillo`);
    }
    hold('telefono');
    assert.ok(at(right).distanceTo(at(head)) < .19, `${id}: el teléfono queda a ${at(right).distanceTo(at(head)).toFixed(3)} m de la cabeza`);
    assert.ok(at(right).x < at(head).x, `${id}: el teléfono va a su derecha`);
    hold('nariz');
    assert.ok(at(right).distanceTo(at(head)) < .23, `${id}: la mano queda a ${at(right).distanceTo(at(head)).toFixed(3)} m de la cara`);
    assert.ok(at(right).z > at(head).z, `${id}: la mano va delante de la cara`);
    hold('cubrirse');
    assert.ok(at(right).y > at(head).y + .09, `${id}: la mano no queda sobre la cabeza`);
    hold('manos-atras');
    assert.ok(at(right).z < at(hips).z - .07 && at(left).z < at(hips).z - .07, `${id}: las manos no quedan detrás`);
    assert.ok(at(right).distanceTo(at(left)) < .13, `${id}: las manos no se juntan a la espalda`);
    hold('atender');
    assert.ok(at(right).distanceTo(at(left)) < .16, `${id}: las manos no se juntan al frente`);
    hold('brazos-cruzados');
    assert.ok(at(right).x > -.03 && at(left).x < .03, `${id}: los brazos no se cruzan`);
    hold('paraguas');
    assert.ok(at(right).z > at(hips).z + .2 && at(right).y > at(hips).y + .25, `${id}: la mano del paraguas no queda arriba y al frente`);
    hold(null);
  }
});

test('andando, las manos siguen donde iban: en el bolsillo, en la oreja y delante del pecho', async () => {
  for (const id of ['hombre-adulto', 'mujer-joven']) {
    const baked = await library(id);
    const { gltf, sources, library: lib } = baked;
    for (const gait of ['normal', 'cansado']) {
      const walk = bakeGaitFamily(gltf.scene, sources, gait).walk;
      assert.ok(walk.userData.lean > .03, 'andar inclina un poco el tronco');
      const { root, bones, layer } = instance(gltf, lib, { lean: walk.userData.lean });
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(walk).play();
      const find = suffix => [...bones.values()].find(bone => bone.name.endsWith(suffix));
      const at = bone => bone.getWorldPosition(new THREE.Vector3());
      const check = (stance, measure) => {
        for (let i = 0; i < 8; i++) {
          layer.restore();
          mixer.setTime(i / 8 * walk.duration);
          layer.apply(5, { stance, speed: 1, phase: i / 8 });
          root.updateMatrixWorld(true);
          measure(`${id}/${gait}/${stance} en ${i}/8`);
        }
      };
      check('bolsillos', label => {
        for (const side of ['Left', 'Right']) {
          const hand = at(find(`${side}Hand`)), hip = at(find(`${side}UpLeg`));
          assert.ok(hand.distanceTo(hip) < .24, `${label}: mano ${side} a ${hand.distanceTo(hip).toFixed(3)} m de su cadera`);
          assert.ok(Math.sign(hand.x) === (side === 'Left' ? 1 : -1), `${label}: la mano ${side} cruza al otro lado`);
        }
      });
      check('telefono', label => {
        const reach = at(find('RightHand')).distanceTo(at(find('Head')));
        assert.ok(reach < .27, `${label}: el teléfono queda a ${reach.toFixed(3)} m de la cabeza`);
      });
      check('celular', label => {
        const hand = at(find('RightHand')), chest = at(find('Spine2'));
        assert.ok(hand.z > chest.z + .15 && hand.y > chest.y - .2, `${label}: el celular no queda delante del pecho`);
      });
      check('manos-atras', label => {
        const hips = at(find('Hips'));
        assert.ok(at(find('RightHand')).z < hips.z - .02 && at(find('LeftHand')).z < hips.z - .02, `${label}: las manos no quedan atrás`);
      });
      layer.restore();
    }
  }
});

test('el modelo liviano comparte la biblioteca y no gasta en los dedos', async () => {
  const { library: lib, gltf } = await library('hombre-adulto');
  const light = await body('hombre-adulto', true);
  const heavy = instance(gltf, lib);
  const thin = instance(light, lib, { lod: true });
  for (let i = 0; i < 40; i++) {
    for (const item of [heavy, thin]) { item.layer.restore(); item.layer.apply(1 / 30, { stance: 'celular', speed: 0 }); }
  }
  const touched = item => item.layer.dirty.map(slot => slot.bone.name);
  assert.ok(touched(heavy).some(name => /Hand(?:Thumb|Index)/.test(name)));
  assert.ok(!touched(thin).some(name => /Hand(?:Thumb|Index)/.test(name)));
  const isFinger = name => /Hand(?:Thumb|Index|Middle|Ring|Pinky)/.test(name);
  const shown = (item, name) => item.bones.get(name).quaternion;
  for (const name of touched(thin)) {
    assert.ok(!isFinger(name));
    assert.ok(shown(heavy, name).angleTo(shown(thin, name)) < .02, `${name} difiere entre modelos`);
  }
});

test('sin postura, estilo ni caída no toca ningún hueso; al retirarse devuelve la base exacta', async () => {
  const { gltf, library: lib } = await library('hombre-adulto');
  const { layer, bones } = instance(gltf, lib);
  const before = snapshot(bones);
  for (let i = 0; i < 20; i++) { layer.restore(); layer.apply(1 / 60, { speed: 1, phase: i / 20 }); }
  assert.deepEqual(snapshot(bones), before);
  assert.equal(layer.active, false);
  assert.equal(layer.slots.size, 0, 'ni siquiera reserva espacio para los huesos');
  for (const stance of STANCE_NAMES) {
    layer.apply(5, { stance, speed: 0, style: { stoop: .5, headDown: .5, swing: .3, sway: .5, limp: .5, carry: 'derecha' } });
    assert.notDeepEqual(snapshot(bones), before, stance);
    layer.restore();
    assert.deepEqual(snapshot(bones), before, `${stance} no se retiró con restore`);
  }
});

test('al quitar la postura el peso vuelve a cero y la capa deja de trabajar', async () => {
  const { gltf, library: lib } = await library('hombre-adulto');
  const { layer, bones } = instance(gltf, lib);
  const before = snapshot(bones);
  for (let i = 0; i < 60; i++) { layer.restore(); layer.apply(1 / 60, { stance: 'sentado', speed: 0, style: { stoop: 1 } }); }
  assert.ok(layer.active);
  for (let i = 0; i < 180; i++) { layer.restore(); layer.apply(1 / 60, { speed: 0 }); }
  assert.equal(layer.active, false);
  layer.restore();
  assert.deepEqual(snapshot(bones), before);
});

test('mismo resultado a 30 y a 144 FPS', async () => {
  const { gltf, library: lib } = await library('hombre-adulto');
  const run = (fps, params) => {
    const { layer, bones } = instance(gltf, lib, { seed: 3 });
    const frames = Math.round(fps * 2.1);
    for (let i = 0; i < frames; i++) { layer.restore(); layer.apply(1 / fps, { ...params, phase: (i / fps) % 1 }); }
    return bones;
  };
  for (const params of [
    { stance: 'bolsillos', speed: 0 }, { stance: 'hablar', speed: 0 }, { stance: 'celular', speed: 1 },
    { stance: 'sentado', speed: 0 }, { style: { stoop: .7, headDown: .4 }, speed: 0 }
  ]) {
    const slow = run(30, params), fast = run(144, params);
    for (const [name, bone] of slow) {
      assert.ok(bone.quaternion.angleTo(fast.get(name).quaternion) < .012, `${JSON.stringify(params)} ${name}: ${bone.quaternion.angleTo(fast.get(name).quaternion)}`);
      assert.ok(bone.position.distanceTo(fast.get(name).position) < .002, `${JSON.stringify(params)} ${name}: posición`);
    }
  }
});

test('la capa no pide matrices de mundo por cuadro', async () => {
  const { gltf, library: lib } = await library('hombre-adulto');
  const { root, layer } = instance(gltf, lib);
  root.updateMatrixWorld(true);
  const proto = THREE.Object3D.prototype;
  const spied = ['updateMatrixWorld', 'updateWorldMatrix', 'updateMatrix', 'getWorldPosition', 'getWorldQuaternion', 'getWorldScale', 'getWorldDirection', 'localToWorld', 'worldToLocal'];
  const saved = spied.map(name => proto[name]);
  let calls = 0;
  spied.forEach(name => { proto[name] = function () { calls++; return saved[spied.indexOf(name)].apply(this, arguments); }; });
  const multiply = THREE.Matrix4.prototype.multiplyMatrices;
  THREE.Matrix4.prototype.multiplyMatrices = function () { calls++; return multiply.apply(this, arguments); };
  try {
    for (const stance of STANCE_NAMES) {
      for (let i = 0; i < 6; i++) {
        layer.restore();
        layer.apply(1 / 30, { stance, speed: 1, phase: i / 6, style: { stoop: .6, headDown: .3, swing: .4, sway: .5, limp: .5, carry: 'izquierda' }, ko: 0 });
      }
    }
    for (let i = 1; i <= 10; i++) { layer.restore(); layer.apply(1 / 30, { ko: i / 10 }); }
    layer.restore();
  } finally {
    spied.forEach((name, i) => { proto[name] = saved[i]; });
    THREE.Matrix4.prototype.multiplyMatrices = multiply;
  }
  assert.equal(calls, 0);
});

test('un dueño de las manos retira la postura y uno del cuerpo retira también el estilo', async () => {
  const { gltf, library: lib } = await library('hombre-adulto');
  const { layer, bones } = instance(gltf, lib);
  const before = snapshot(bones);
  const style = { stoop: .8 };
  for (let i = 0; i < 90; i++) { layer.restore(); layer.apply(1 / 60, { stance: 'bolsillos', style, speed: 0 }); }
  for (let i = 0; i < 40; i++) { layer.restore(); layer.apply(1 / 60, { stance: 'bolsillos', style, speed: 0, handsBusy: true }); }
  assert.equal(layer.layers.length, 0, 'pegar o fumar retira la postura en menos de un cuarto de segundo');
  assert.ok(layer.styleWeight > 0, 'la espalda sigue encorvada');
  for (let i = 0; i < 40; i++) { layer.restore(); layer.apply(1 / 60, { stance: 'bolsillos', style, speed: 0, blocked: true }); }
  assert.equal(layer.styleWeight, 0);
  layer.restore();
  assert.deepEqual(snapshot(bones), before);
});

test('una postura de estar quieto se retira al andar; la que sirve andando sigue', async () => {
  const { gltf, library: lib } = await library('hombre-adulto');
  const { layer } = instance(gltf, lib);
  for (let i = 0; i < 90; i++) { layer.restore(); layer.apply(1 / 60, { stance: 'brazos-cruzados', speed: 0 }); }
  assert.equal(layer.layers[0].weight, 1);
  for (let i = 0; i < 60; i++) { layer.restore(); layer.apply(1 / 60, { stance: 'brazos-cruzados', speed: 1 }); }
  assert.equal(layer.layers.length, 0);
  for (let i = 0; i < 90; i++) { layer.restore(); layer.apply(1 / 60, { stance: 'bolsillos', speed: 1 }); }
  assert.equal(layer.layers[0].weight, 1);
  layer.restore();
});

test('la caída sigue a `ko`: dobla las rodillas a mitad de camino y termina en `tendido`, y `snap` entra sin transición', async () => {
  const { gltf, library: lib } = await library('hombre-adulto');
  const { layer, bones } = instance(gltf, lib);
  const knee = bones.get([...bones.keys()].find(name => name.endsWith('LeftLeg')));
  const start = knee.quaternion.clone();
  layer.apply(1 / 60, { ko: .5 });
  const middle = knee.quaternion.angleTo(start);
  layer.restore();
  layer.apply(1 / 60, { ko: 1 });
  const end = knee.quaternion.clone();
  const target = lib.stances.get('tendido').entries.find(entry => entry.boneName === knee.name).quaternion;
  assert.ok(end.angleTo(target) < 1e-3, 'con ko = 1 queda exactamente tendido');
  assert.ok(middle > .8, `a media caída la rodilla está doblada: ${middle.toFixed(2)}`);
  layer.restore();
  layer.snap();
  layer.apply(1 / 60, { stance: 'sentado', speed: 0 });
  assert.equal(layer.layers[0].weight, 1);
  layer.restore();
});

// ---------- piel bajo la ropa ----------

const MODELS = new URL('../public/models/personaje/', import.meta.url);

/** Posiciones e índices de la malla del cuerpo de un .gltf del catálogo. */
function bodyMesh(file, nodeName) {
  const gltf = JSON.parse(fs.readFileSync(new URL(file, MODELS)));
  const bin = fs.readFileSync(new URL(file.replace(/[^/]+$/, gltf.buffers[0].uri), MODELS));
  const read = (index, Type, size) => {
    const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
    const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return new Type(bin.buffer.slice(start, start + accessor.count * size * Type.BYTES_PER_ELEMENT));
  };
  const node = gltf.nodes.find(item => item.name === nodeName);
  const primitive = gltf.meshes[node.mesh].primitives[0];
  const indexType = gltf.accessors[primitive.indices].componentType === 5125 ? Uint32Array : Uint16Array;
  return { positions: read(primitive.attributes.POSITION, Float32Array, 3), index: read(primitive.indices, indexType, 1) };
}

test('toda la ropa dice qué piel del cuerpo liviano tapa, sin llevarse la cabeza, las manos ni los pies de quien va en tenis', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('catalogo.json', MODELS)));
  for (const body of catalog.cuerpos) {
    const { positions, index } = bodyMesh(`${body.id}/lod/cuerpo.gltf`, 'personaje.body_lod');
    const count = positions.length / 3;
    let top = 0, wide = 0;
    for (let i = 0; i < count; i++) { top = Math.max(top, positions[i * 3 + 1]); wide = Math.max(wide, Math.abs(positions[i * 3])); }
    for (const item of catalog.piezas.ropa) {
      const piece = body.piezas[item.id];
      if (!piece?.file) continue;
      assert.ok(piece.ocultaLod?.length > 150, `${body.id}/${item.id}: la ropa tapa algo`);
      for (const vertex of piece.ocultaLod) {
        assert.ok(Number.isInteger(vertex) && vertex >= 0 && vertex < count, `${body.id}/${item.id}: índice ${vertex}`);
        assert.ok(positions[vertex * 3 + 1] < top - .2, `${body.id}/${item.id}: no tapa la cabeza`);
        assert.ok(Math.abs(positions[vertex * 3]) < wide - .09, `${body.id}/${item.id}: no tapa las manos`);
      }
      // Quitar la ropa no deja a nadie sin cuerpo: solo se va lo tapado, y los triángulos que quedan son válidos.
      const hidden = new Set(piece.ocultaLod);
      let kept = 0;
      for (let i = 0; i < index.length; i += 3) if (!(hidden.has(index[i]) && hidden.has(index[i + 1]) && hidden.has(index[i + 2]))) kept++;
      assert.ok(kept > index.length / 3 * .6 && kept < index.length / 3, `${body.id}/${item.id}: quedan ${kept} de ${index.length / 3}`);
    }
    for (const item of catalog.piezas.calzado) {
      const piece = body.piezas[item.id];
      if (!piece?.file) { assert.ok(!piece?.ocultaLod?.length, `${body.id}/${item.id}: descalzo no oculta el pie`); continue; }
      for (const vertex of piece.ocultaLod) assert.ok(positions[vertex * 3 + 1] < .25, `${body.id}/${item.id}: el calzado no tapa la pierna`);
    }
  }
});

test('el saco y la camiseta rota también ocultan la piel en el cuerpo completo', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('catalogo.json', MODELS)));
  for (const body of catalog.cuerpos) {
    for (const id of ['saco', 'rota']) assert.ok(body.piezas[id].oculta.length > 2000, `${body.id}/${id}`);
    for (const [id, piece] of Object.entries(body.piezas)) {
      assert.deepEqual(piece.oculta, [...new Set(piece.oculta)].sort((a, b) => a - b), `${body.id}/${id}: lista ordenada y sin repetir`);
    }
  }
});
