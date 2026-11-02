import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bakeGaitFamily, buildGaitSources, GAIT_FAMILIES, resolveGait, straightenTorso, alignCycle } from '../src/character/gaitFamilies.js';
import { PoseRig } from '../src/character/poseRig.js';
import { createSkinSupport } from '../src/character/mixamoGrounding.js';
import { gaitStage, stageRate } from '../src/character/locomotion.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = new URL('../public/models/', import.meta.url);

async function glb(file) {
  const data = fs.readFileSync(new URL(file, models));
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
  for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + fs.readFileSync(pathModule.join(location, buffer.uri)).toString('base64');
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'CHECK_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return loader.parseAsync(JSON.stringify(json), '');
}

const banks = Promise.all([glb('andar-erguido.glb'), glb('andar-cansado.glb')]);
const cache = new Map();
function baked(id, gait) {
  const key = `${id}/${gait}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const gltf = await body(id);
    const [upright, tired] = await banks;
    const sources = buildGaitSources(gltf, upright, tired);
    return { gltf, sources, clips: bakeGaitFamily(gltf.scene, sources, gait) };
  })());
  return cache.get(key);
}

/** Copia del cuerpo que reproduce un clip. */
function player(gltf, clip) {
  const root = clone(gltf.scene);
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const find = suffix => [...bones.values()].find(bone => bone.name.endsWith(suffix));
  const at = time => { mixer.setTime(time); root.updateMatrixWorld(true); };
  return { root, bones, find, at };
}

test('una familia desconocida o ausente es la normal', () => {
  assert.equal(resolveGait(undefined), 'normal');
  assert.equal(resolveGait('volando'), 'normal');
  assert.equal(resolveGait('constructor'), 'normal');
  for (const name of ['firme', 'normal', 'cansado', 'lento', 'trote']) assert.equal(resolveGait(name), name);
});

test('cada familia da clips finitos que solo escriben huesos, y solo la cadera se traslada', async () => {
  for (const id of ['hombre-adulto', 'mujer-mayor']) {
    for (const gait of Object.keys(GAIT_FAMILIES)) {
      const { gltf, clips } = await baked(id, gait);
      const names = new Set();
      let hips = null;
      gltf.scene.traverse(node => { if (node.isBone) { names.add(node.name); if (/Hips$/.test(node.name)) hips = node; } });
      assert.equal(!!clips.trote, gait === 'trote', 'solo el trote tiene tercer clip');
      for (const clip of [clips.idle, clips.walk, clips.run, clips.trote].filter(Boolean)) {
        for (const track of clip.tracks) {
          const [bone, property] = track.name.split('.');
          assert.ok(names.has(bone), `${gait}/${clip.name}: ${track.name} no es de un hueso`);
          assert.ok(property === 'quaternion' || (property === 'position' && bone === hips.name), `${gait}/${clip.name}: ${track.name}`);
          assert.ok(track.values.every(Number.isFinite), `${gait}/${clip.name}: ${track.name}`);
        }
      }
    }
  }
});

test('el ciclo cierra: su último cuadro es el primero y la pisada izquierda abre el clip', async () => {
  const { gltf, clips } = await baked('hombre-adulto', 'normal');
  for (const clip of [clips.walk, clips.run]) {
    for (const track of clip.tracks) {
      const size = track.getValueSize(), count = track.times.length;
      for (let k = 0; k < size; k++) {
        assert.ok(Math.abs(track.values[k] - track.values[(count - 1) * size + k]) < .02 || size === 4, `${clip.name}: ${track.name}`);
      }
    }
    const { find, at } = player(gltf, clip);
    const reach = time => { at(time); return find('LeftFoot').getWorldPosition(new THREE.Vector3()).z - find('RightFoot').getWorldPosition(new THREE.Vector3()).z; };
    assert.ok(reach(0) > .15, `${clip.name}: el pie izquierdo va delante al empezar (${reach(0).toFixed(2)})`);
    assert.ok(reach(clip.duration / 2) < -.15, `${clip.name}: a mitad de ciclo va delante el derecho`);
  }
});

test('el pie apoyado retrocede a la velocidad del paso: no patina', async () => {
  for (const id of ['hombre-adulto', 'mujer-joven']) {
    for (const gait of ['firme', 'normal', 'cansado', 'lento', 'trote']) {
      const { gltf, clips } = await baked(id, gait);
      for (const clip of [clips.walk, clips.trote].filter(Boolean)) {
        const stride = clip.userData.locomotion.strides[0];
        const { find, at } = player(gltf, clip);
        const SAMPLES = 90;
        for (const foot of ['LeftToeBase', 'RightToeBase']) {
          const bone = find(foot), points = [];
          for (let i = 0; i <= SAMPLES; i++) {
            at(i / SAMPLES * clip.duration);
            points.push(bone.getWorldPosition(new THREE.Vector3()));
          }
          const floor = Math.min(...points.map(point => point.y));
          const speeds = [];
          // Apoyado: junto al piso y yendo hacia atrás. A media zancada el pie pasa rozando, pero va adelante.
          for (let i = 1; i <= SAMPLES; i++) {
            const speed = (points[i - 1].z - points[i].z) * SAMPLES;
            if (speed > 0 && Math.max(points[i].y, points[i - 1].y) < floor + .03) speeds.push(speed);
          }
          speeds.sort((a, b) => a - b);
          assert.ok(speeds.length > SAMPLES * .2, `${id}/${gait}/${clip.name}/${foot}: apenas toca el piso`);
          const low = speeds[Math.floor(speeds.length * .1)] / stride, high = speeds[Math.floor(speeds.length * .9)] / stride;
          assert.ok(low > .65 && high < 1.45, `${id}/${gait}/${clip.name}/${foot}: el pie apoyado va de ${low.toFixed(2)} a ${high.toFixed(2)} veces el paso`);
        }
      }
    }
  }
});

test('andando la suela no se hunde ni flota', async () => {
  for (const gait of ['firme', 'normal', 'cansado', 'lento']) {
    const { gltf, clips } = await baked('hombre-adulto', gait);
    const { root, at } = player(gltf, clips.walk);
    const support = createSkinSupport(root, { bones: /(?:Left|Right)(?:Foot|ToeBase)$/ });
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < 30; i++) {
      at(i / 30 * clips.walk.duration);
      const y = support.minimumY();
      low = Math.min(low, y); high = Math.max(high, y);
    }
    assert.ok(low > -.002 && high < .05, `${gait}: suela entre ${low.toFixed(3)} y ${high.toFixed(3)} m`);
  }
});

test('en reposo los pies no se mueven ni despegan, y la cadera vive', async () => {
  for (const gait of ['firme', 'normal', 'lento']) {
    const { gltf, clips } = await baked('mujer-joven', gait);
    const { find, at } = player(gltf, clips.idle);
    const left = find('LeftFoot'), right = find('RightFoot'), hips = find('Hips');
    const span = point => point.max.clone().sub(point.min);
    const boxes = [new THREE.Box3(), new THREE.Box3(), new THREE.Box3()];
    for (let i = 0; i <= 64; i++) {
      at(i / 64 * clips.idle.duration);
      [left, right, hips].forEach((bone, k) => boxes[k].expandByPoint(bone.getWorldPosition(new THREE.Vector3())));
    }
    assert.ok(span(boxes[0]).length() < .004 && span(boxes[1]).length() < .004, `${gait}: los pies se mueven ${span(boxes[0]).length().toFixed(4)}`);
    assert.ok(span(boxes[2]).x > .02, `${gait}: la cadera pasa el peso de una pierna a la otra`);
  }
});

test('de pie no está en guardia: brazos colgando a los lados y rodillas casi estiradas', async () => {
  for (const id of ['hombre-adulto', 'hombre-mayor', 'mujer-adulta', 'mujer-joven']) {
    const { gltf, clips } = await baked(id, 'normal');
    const { find, at } = player(gltf, clips.idle);
    at(1);
    const p = name => find(name).getWorldPosition(new THREE.Vector3());
    for (const side of ['Left', 'Right']) {
      const shoulder = p(`${side}Arm`), elbow = p(`${side}ForeArm`), wrist = p(`${side}Hand`);
      assert.ok(wrist.y < p('Hips').y + .02, `${id}: la mano ${side} no cuelga`);
      assert.ok(Math.abs(wrist.z - shoulder.z) < .1, `${id}: la mano ${side} se adelanta`);
      const upper = elbow.clone().sub(shoulder).normalize(), lower = wrist.clone().sub(elbow).normalize();
      assert.ok(upper.angleTo(lower) < .5, `${id}: el codo ${side} se dobla ${upper.angleTo(lower).toFixed(2)} rad`);
      const thigh = p(`${side}Leg`).sub(p(`${side}UpLeg`)).normalize(), shin = p(`${side}Foot`).sub(p(`${side}Leg`)).normalize();
      assert.ok(thigh.angleTo(shin) < .3, `${id}: la rodilla ${side} se dobla ${thigh.angleTo(shin).toFixed(2)} rad`);
    }
  }
});

test('enderezar el tronco: la cabeza mira al frente en promedio, y cadera, piernas y brazos siguen igual', async () => {
  const { gltf, sources } = await baked('hombre-adulto', 'normal');
  const rig = new PoseRig(gltf.scene);
  const raw = alignCycle('correr', sources.run, 0);
  const fixed = straightenTorso(raw, rig);
  assert.notEqual(fixed, raw, 'devuelve una copia');
  const worlds = (clip, names) => {
    const { find, at } = player(gltf, clip);
    return Array.from({ length: 20 }, (_, i) => {
      at(i / 20 * clip.duration);
      return names.map(name => find(name).getWorldQuaternion(new THREE.Quaternion()));
    });
  };
  const unmoved = ['Hips', 'LeftUpLeg', 'RightLeg', 'LeftFoot', 'LeftArm', 'RightArm'];
  const before = worlds(raw, unmoved), after = worlds(fixed, unmoved);
  before.forEach((row, i) => row.forEach((quaternion, k) => {
    assert.ok(quaternion.angleTo(after[i][k]) < .002, `${unmoved[k]} cambió ${quaternion.angleTo(after[i][k])}`);
  }));
  // Giro medio de cabeza y pecho, respecto a la pose de enlace.
  const yawMean = (clip, name) => {
    const { root, find, at } = player(gltf, clip);
    root.updateMatrixWorld(true);
    const bind = rig.bindWorld.get(rig.joints[{ Head: 'head', Spine2: 'spine2' }[name]]).clone().invert();
    let sum = 0;
    for (let i = 0; i < 24; i++) {
      at(i / 24 * clip.duration);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(find(name).getWorldQuaternion(new THREE.Quaternion()).multiply(bind));
      sum += Math.atan2(forward.x, forward.z);
    }
    return sum / 24;
  };
  assert.ok(Math.abs(yawMean(raw, 'Spine2')) > .2, 'el clip sin enderezar va girado');
  for (const name of ['Head', 'Spine2']) assert.ok(Math.abs(yawMean(fixed, name)) < .02, `${name}: ${yawMean(fixed, name)}`);
  // Los pies no se enteran.
  const hipTrack = clip => clip.tracks.find(track => track.name.endsWith('.position')).values;
  assert.deepEqual([...hipTrack(fixed)], [...hipTrack(raw)]);
});

test('andar con la cabeza al frente también en la familia ya horneada', async () => {
  for (const gait of ['firme', 'normal', 'cansado', 'lento']) {
    const { gltf, clips } = await baked('mujer-joven', gait);
    const rig = new PoseRig(gltf.scene);
    const bind = rig.bindWorld.get(rig.joints.head).clone().invert();
    const { find, at } = player(gltf, clips.walk);
    let yaw = 0, down = 0;
    for (let i = 0; i < 24; i++) {
      at(i / 24 * clips.walk.duration);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(find('Head').getWorldQuaternion(new THREE.Quaternion()).multiply(bind));
      yaw += Math.atan2(forward.x, forward.z) / 24;
      down += -Math.asin(forward.y) / 24;
    }
    assert.ok(Math.abs(yaw) < .03, `${gait}: la cabeza gira ${yaw.toFixed(3)} rad en promedio`);
    if (gait === 'firme') assert.ok(down < .2, 'el firme mira al frente');
    if (gait === 'lento') assert.ok(down > .4, 'el lento mira al piso');
  }
});

test('el jugador: despacio anda, a 3 m/s trota sin correr y a 6 m/s corre', async () => {
  const { clips } = await baked('hombre-adulto', 'trote');
  const low = clips.walk.userData.locomotion, high = clips.trote.userData.locomotion;
  assert.ok(low && high);
  const scale = 1.08;
  assert.equal(gaitStage(.5 / scale, low, high), 0);
  const trot = gaitStage(3 / scale, low, high);
  assert.ok(trot > .8 && trot < 1.5, `a 3 m/s, tramo ${trot.toFixed(2)}`);
  assert.ok(gaitStage(6 / scale, low, high) > 1.9, 'a 6 m/s corre');
  for (let speed = .4; speed <= 7; speed += .2) {
    const stage = gaitStage(speed, low, high), next = gaitStage(speed + .2, low, high);
    assert.ok(next >= stage - 1e-6, 'el tramo solo sube con la velocidad');
    const rate = stageRate(speed, low, high, stage);
    assert.ok(rate > 0 && rate < 2.5, `a ${speed.toFixed(1)}, ${rate.toFixed(2)} ciclos por segundo`);
  }
});

const legFlex = (hip, knee, ankle) => Math.PI - hip.clone().sub(knee).angleTo(ankle.clone().sub(knee));

/** Por cuadro: cuánto dobla la rodilla la pierna que pisa y la libre, largo de la que pisa y altura de la cadera. */
function stanceOf(gltf, clip, samples = 120) {
  const { find, at } = player(gltf, clip);
  const where = name => find(name).getWorldPosition(new THREE.Vector3());
  return Array.from({ length: samples }, (_, i) => {
    at(i / samples * clip.duration);
    const left = ['LeftUpLeg', 'LeftLeg', 'LeftFoot'].map(where), right = ['RightUpLeg', 'RightLeg', 'RightFoot'].map(where);
    const [down, up] = left[2].y <= right[2].y ? [left, right] : [right, left];
    return { knee: legFlex(...down), free: legFlex(...up), under: Math.abs(down[2].z - down[0].z) < .06, length: down[0].distanceTo(down[2]), reach: down[0].distanceTo(down[1]) + down[1].distanceTo(down[2]), hips: where('Hips').y };
  });
}
const middle = values => values.slice().sort((a, b) => a - b)[values.length >> 1];
const toDegrees = 180 / Math.PI;

test('al andar la pierna que pisa se estira a mitad de apoyo, sin quedar tiesa, y la cadera sube y baja lo justo', async () => {
  for (const id of ['hombre-adulto', 'mujer-adulta', 'mujer-mayor']) {
    for (const gait of ['firme', 'normal', 'cansado', 'lento']) {
      const { gltf, clips } = await baked(id, gait);
      const frames = stanceOf(gltf, clips.walk), label = `${id}/${gait}`;
      assert.ok(middle(frames.map(f => f.knee)) * toDegrees < 21, `${label}: rodilla de apoyo en ${(middle(frames.map(f => f.knee)) * toDegrees).toFixed(1)}°`);
      assert.ok(Math.min(...frames.map(f => f.knee)) * toDegrees < 10, `${label}: nunca se estira`);
      const passing = frames.filter(f => f.under);
      assert.ok(passing.length > 8, label);
      assert.ok(middle(passing.map(f => f.length / f.reach)) > .985, `${label}: al pasar sobre el pie la pierna da ${middle(passing.map(f => f.length / f.reach)).toFixed(3)} de su largo`);
      assert.ok(Math.max(...frames.map(f => f.free)) * toDegrees > 50, `${label}: la pierna libre no se recoge`);
      const heights = frames.map(f => f.hips), bob = Math.max(...heights) - Math.min(...heights);
      assert.ok(bob > .03 && bob < GAIT_FAMILIES[gait].apoyo.vaiven + .005, `${label}: la cadera sube y baja ${bob.toFixed(3)} m`);
      assert.ok(clips.walk.userData.grounding && clips.walk.userData.locomotion, `${label}: el andar pierde sus medidas`);
    }
  }
});

test('enderezar la pierna no mueve los pies: ni patinan ni se hunden más que antes, y el ciclo sigue cerrando', async () => {
  for (const id of ['hombre-adulto', 'mujer-adulta']) {
    for (const gait of ['normal', 'cansado']) {
      const { gltf, sources, clips } = await baked(id, gait);
      const family = GAIT_FAMILIES[gait], stance = family.apoyo;
      delete family.apoyo;
      let plain;
      try { plain = bakeGaitFamily(gltf.scene, sources, gait); } finally { family.apoyo = stance; }
      const a = player(gltf, clips.walk), b = player(gltf, plain.walk);
      const p = new THREE.Vector3(), q = new THREE.Vector3(), pa = new THREE.Quaternion(), pb = new THREE.Quaternion();
      let moved = 0, turned = 0, raised = 0;
      for (let i = 0; i < 60; i++) {
        const time = i / 60 * clips.walk.duration;
        a.at(time); b.at(time);
        raised = Math.max(raised, a.find('Hips').getWorldPosition(p).y - b.find('Hips').getWorldPosition(q).y);
        for (const name of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) {
          moved = Math.max(moved, a.find(name).getWorldPosition(p).distanceTo(b.find(name).getWorldPosition(q)));
          turned = Math.max(turned, a.find(name).getWorldQuaternion(pa).angleTo(b.find(name).getWorldQuaternion(pb)));
        }
      }
      assert.ok(raised > .015, `${id}/${gait}: la cadera sube ${raised.toFixed(3)} m`);
      assert.ok(moved < .002, `${id}/${gait}: un pie se movió ${moved.toFixed(4)} m`);
      assert.ok(turned < .005, `${id}/${gait}: un pie giró ${turned.toFixed(4)} rad`);
      const close = clips.walk.userData.locomotion.strides[0] / plain.walk.userData.locomotion.strides[0];
      assert.ok(Math.abs(close - 1) < .02, `${id}/${gait}: la zancada cambia ${close.toFixed(3)} veces`);
      for (const track of clips.walk.tracks) {
        const size = track.getValueSize(), last = track.times.length - 1;
        const first = Array.from(track.values.slice(0, size)), end = Array.from(track.values.slice(last * size, (last + 1) * size));
        const sign = size === 4 && first.reduce((sum, v, k) => sum + v * end[k], 0) < 0 ? -1 : 1;
        first.forEach((value, k) => assert.ok(Math.abs(value - sign * end[k]) < .02, `${track.name} no cierra`));
      }
    }
  }
});

test('el reposo también queda asentado: la planta en su altura, por muy distinta que sea la pierna del cuerpo', async () => {
  for (const id of ['hombre-adulto', 'mujer-mayor']) {
    for (const gait of ['firme', 'lento']) {
      const { gltf, clips } = await baked(id, gait);
      assert.equal(clips.idle.userData.grounding?.follow, true, `${id}/${gait}: el reposo no pasó por el asentado`);
      const { root, at } = player(gltf, clips.idle);
      const support = createSkinSupport(root, { bones: /(?:Left|Right)(?:Foot|ToeBase)$/ });
      for (let i = 0; i < 12; i++) {
        at(i / 12 * clips.idle.duration);
        const y = support.minimumY();
        assert.ok(y > .004 && y < .022, `${id}/${gait}: la planta en reposo a ${y.toFixed(4)} m`);
      }
    }
  }
});

test('al correr el pecho y la cabeza miran al frente: el ciclo original los deja girados', async () => {
  for (const id of ['hombre-adulto', 'mujer-adulta']) {
    const { gltf, clips } = await baked(id, 'normal');
    const { find, at } = player(gltf, clips.run);
    const bind = name => { const copy = clone(gltf.scene); copy.updateMatrixWorld(true); let found = null; copy.traverse(node => { if (node.isBone && node.name.endsWith(name)) found = node; }); return found.getWorldQuaternion(new THREE.Quaternion()).invert(); };
    for (const [name, rest] of [['Spine2', bind('Spine2')], ['Head', bind('Head')]]) {
      const sum = new THREE.Vector3(), q = new THREE.Quaternion(), forward = new THREE.Vector3();
      for (let i = 0; i < 40; i++) {
        at(i / 40 * clips.run.duration);
        forward.set(0, 0, 1).applyQuaternion(q.copy(find(name).getWorldQuaternion(q)).multiply(rest));
        sum.add(forward);
      }
      const yaw = Math.atan2(sum.x, sum.z) * toDegrees;
      assert.ok(Math.abs(yaw) < 5, `${id}: ${name} gira ${yaw.toFixed(1)}° al correr`);
    }
  }
});
