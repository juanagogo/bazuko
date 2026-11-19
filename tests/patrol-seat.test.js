// La bajada de la patrulla con el cuerpo de verdad y la carrocería de verdad: el agente sentado cabe bajo el techo y
// entre los costados, pasa agachado bajo el marco de la puerta, planta primero el pie de afuera y se para de abajo arriba.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathModule from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bakeStances, CAR_EDGE_HIP, CAR_SEAT_HIP, STANCE_NAMES } from '../src/character/stances.js';
import { BodyLanguage } from '../src/character/BodyLanguage.js';
import { bakeGaitFamily, buildGaitSources } from '../src/character/gaitFamilies.js';
import { exitMotion, exitTimes } from '../src/entities/patrolExit.js';
import * as textures from '../src/world/bogota/textures.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { CAR_MODELS } = await import('../src/world/bogota/carModels.js');
const { getCarBody } = await import('../src/world/bogota/VehicleBody.js');
const { seatLift } = await import('../src/entities/patrolCar.js');

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = new URL('../public/models/', import.meta.url);
const SCALE = 1.08;        // la talla del juego
const CAP = .03;           // m que la gorra sube sobre la coronilla
const ROOF_SKIN = .03;     // m de grueso del techo
const PATROL_MODELS = ['suv', 'sedanPopular'];
const LEVELS = [[1, 1.4], [2, .95]];
const FPS = 60;

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

/** El agente (cuerpo `hombre-adulto`, a la talla del juego) dentro de un grupo que hace de raíz, en ejes del carro. */
const officerBody = (async () => {
  const gltf = await body('hombre-adulto');
  const [upright, tired] = await Promise.all([glb('andar-erguido.glb'), glb('andar-cansado.glb')]);
  const sources = buildGaitSources(gltf, upright, tired);
  const library = bakeStances(gltf.scene, sources.standing), rest = bakeGaitFamily(gltf.scene, sources, 'normal').idle;
  const holder = new THREE.Group(), root = clone(gltf.scene), bones = new Map(), meshes = [];
  holder.add(root);
  root.scale.setScalar(SCALE);
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); if (node.isSkinnedMesh) meshes.push(node); });
  const layer = new BodyLanguage(bones, library, {});
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(rest).play();
  mixer.update(0);
  const bone = pattern => [...bones.values()].find(item => pattern.test(item.name));
  const joints = { hip: bone(/LeftUpLeg$/), head: bone(/Head$/), chest: bone(/Spine2$/), spine: bone(/Spine$/), left: bone(/LeftFoot$/), right: bone(/RightFoot$/), leftArm: bone(/LeftArm$/), rightArm: bone(/RightArm$/) };
  const point = new THREE.Vector3();
  /** Pone la raíz y las posturas, y devuelve cada vértice de la piel, en ejes del carro. */
  const pose = (position, yaw, poses) => {
    layer.restore();
    mixer.setTime(0);
    holder.position.copy(position);
    holder.rotation.y = yaw;
    layer.apply(1 / FPS, { speed: 0, poses });
    holder.updateMatrixWorld(true);
    for (const mesh of meshes) mesh.skeleton.update();
  };
  const eachVertex = visit => {
    for (const mesh of meshes) {
      const count = mesh.geometry.attributes.position.count;
      for (let i = 0; i < count; i += 2) visit(mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld));
    }
  };
  const at = key => joints[key].getWorldPosition(new THREE.Vector3());
  /** Cuánto se inclina hacia adelante el tramo entre dos articulaciones, en radianes desde como va de pie. */
  const raw = (from, to) => {
    const a = at(from), b = at(to), yaw = holder.rotation.y;
    return Math.atan2((b.x - a.x) * Math.sin(yaw) + (b.z - a.z) * Math.cos(yaw), b.y - a.y);
  };
  pose(new THREE.Vector3(), 0, null);
  const standing = { trunk: raw('spine', 'chest'), head: raw('chest', 'head') };
  const pitch = part => raw(part === 'trunk' ? 'spine' : 'chest', part === 'trunk' ? 'chest' : 'head') - standing[part];
  return { pose, eachVertex, at, pitch, bones };
})();

/** La patrulla en el origen mirando a +X, con su lado derecho hacia +Z: asiento, borde y puerta como los da `PatrolCar`. */
function carOf(model, side) {
  const spec = CAR_MODELS[model], shell = getCarBody(model);
  const anchor = new THREE.Vector3(spec.driver.x, 0, spec.driver.z), doorX = spec.driver.door?.x ?? spec.driver.x;
  const lift = seatLift(model, anchor, spec.driver.h);
  return {
    spec, shell, lift,
    seat: new THREE.Vector3(anchor.x, lift, side * Math.abs(anchor.z)),
    edge: new THREE.Vector3(doorX, 0, side * (spec.W / 2 + .12)),
    door: new THREE.Vector3(doorX, 0, side * (spec.W / 2 + .55)),
    seatYaw: Math.PI / 2, outYaw: side > 0 ? 0 : Math.PI
  };
}

/** Recorre una bajada cuadro a cuadro y entrega cada uno a `visit(m, t)` con el cuerpo ya puesto. */
async function exitFrames(model, side, seconds, visit) {
  const who = await officerBody, car = carOf(model, side), e = exitTimes(seconds), position = new THREE.Vector3();
  for (let frame = 0; ; frame++) {
    const t = frame / FPS, m = exitMotion(t, e, side, {});
    if (m.phase === 'step' || m.phase === 'done') break;
    if (m.phase === 'rise') { position.lerpVectors(car.edge, car.door, m.out); position.y += m.lift; }
    else {
      position.lerpVectors(car.seat, car.edge, m.slide);
      position.y = car.seat.y + (car.edge.y - car.seat.y) * m.drop;
    }
    // De cara a la puerta hasta el final: el giro hacia el jugador depende de dónde esté y no cambia lo que aquí se mide.
    const yaw = car.seatYaw + Math.atan2(Math.sin(car.outYaw - car.seatYaw), Math.cos(car.outYaw - car.seatYaw)) * m.yaw;
    who.pose(position, yaw, m.poses);
    visit(m, t, who, car, frame);
  }
}

test('las posturas del carro miden lo que `patrolCar.js` y `stances.js` dicen: cadera, tope de la gorra y rodillas a unos 95°', async () => {
  for (const name of ['patrulla', 'baja-izquierda', 'baja-derecha', 'agachado', 'cabeza-baja']) assert.ok(STANCE_NAMES.includes(name), name);
  const who = await officerBody, zero = new THREE.Vector3();
  who.pose(zero, 0, [['patrulla', 1]]);
  let top = -Infinity;
  who.eachVertex(v => { top = Math.max(top, v.y); });
  // `SEATED_TOP` de patrolCar.js: con él se calcula a qué altura va la raíz bajo el techo.
  assert.ok(top + CAP <= 1.13 && top + CAP > 1.13 - .02, `sentado, el tope de la gorra queda a ${(top + CAP).toFixed(3)} m de la raíz`);
  assert.ok(Math.abs(who.at('hip').y - CAR_SEAT_HIP) < .01, `cadera sentado a ${who.at('hip').y.toFixed(3)}`);
  const knee = [...who.bones.values()].find(item => /LeftLeg$/.test(item.name)).getWorldPosition(new THREE.Vector3());
  const angle = who.at('hip').sub(knee).angleTo(who.at('left').sub(knee)) * 180 / Math.PI;
  assert.ok(angle > 88 && angle < 102, `rodilla a ${angle.toFixed(0)}°`);
  const recline = -who.pitch('trunk') * 180 / Math.PI;
  assert.ok(recline >= 10 && recline <= 15, `recostado ${recline.toFixed(1)}°`);
  who.pose(zero, 0, [['patrulla', 1], ['baja-derecha', 1], ['agachado', 1], ['cabeza-baja', 1]]);
  assert.ok(Math.abs(who.at('hip').y - CAR_EDGE_HIP) < .015, `cadera en el borde a ${who.at('hip').y.toFixed(3)}`);
  const duck = who.pitch('trunk') * 180 / Math.PI;
  assert.ok(duck >= 25 && duck <= 33, `agachado ${duck.toFixed(1)}°`);
});

for (const model of PATROL_MODELS) {
  test(`${model}: sentado, la gorra queda 4 cm o más bajo el techo y el cuerpo entre los costados, por las dos puertas y con los dos afanes`, async () => {
    for (const side of [-1, 1]) for (const [level, seconds] of LEVELS) {
      let frames = 0, room = Infinity, margin = Infinity;
      await exitFrames(model, side, seconds, (m, t, who, car) => {
        if (m.phase !== 'door') return;
        frames++;
        who.eachVertex(v => {
          // Bajo el techo, medido por dentro, donde está ese punto de la cabeza o de los hombros.
          if (v.y > car.lift + .75) room = Math.min(room, car.shell.topY(v.x, v.z) - ROOF_SKIN - (v.y + CAP));
          // Entre los costados: de la cintura para arriba, que es lo que se ve por las ventanas.
          if (v.y > car.lift + .35 && v.y < car.shell.edge(v.x)) margin = Math.min(margin, car.shell.sideZ(v.x, v.y) - Math.abs(v.z));
        });
      });
      assert.ok(frames >= 5, `${frames} cuadros con la puerta abriendo`);
      assert.ok(room >= .04, `lado ${side}, fichado ${level}: la gorra queda a ${(room * 100).toFixed(1)} cm del techo`);
      assert.ok(margin >= .03, `lado ${side}, fichado ${level}: el cuerpo queda a ${(margin * 100).toFixed(1)} cm del costado`);
    }
  });

  test(`${model}: al deslizarse y pararse pasa agachado bajo el marco, sin atravesar el techo ni el piso de la calle`, async () => {
    for (const side of [-1, 1]) for (const [level, seconds] of LEVELS) {
      let under = Infinity, frame = Infinity, ground = Infinity;
      await exitFrames(model, side, seconds, (m, t, who, car) => {
        if (m.phase === 'door') return;
        who.eachVertex(v => {
          ground = Math.min(ground, v.y);
          if (v.y < car.lift + .6) return;
          const across = Math.abs(v.z), edge = car.shell.edgeZ(v.x);
          // Adentro, bajo el techo; en el vano de la puerta, bajo el marco.
          if (across < edge - .04) under = Math.min(under, car.shell.topY(v.x, v.z) - ROOF_SKIN - (v.y + CAP));
          else if (across < car.spec.W / 2) frame = Math.min(frame, car.shell.edge(v.x) - .03 - (v.y + CAP));
        });
      });
      const label = `lado ${side}, fichado ${level}`;
      assert.ok(under >= .02, `${label}: adentro la gorra pasa a ${(under * 100).toFixed(1)} cm del techo`);
      assert.ok(frame >= .02, `${label}: pasa a ${(frame * 100).toFixed(1)} cm del marco de la puerta`);
      assert.ok(ground >= -.01, `${label}: baja hasta ${(ground * 100).toFixed(1)} cm del piso`);
    }
  });
}

test('planta primero el pie de afuera, y al pararse sube la cadera, después el tronco y de última la cabeza', async () => {
  for (const side of [-1, 1]) for (const [level, seconds] of LEVELS) {
    const lead = side < 0 ? 'left' : 'right', other = side < 0 ? 'right' : 'left';
    let planted = null, otherThen = 0, turned = 0;
    const rise = [];
    await exitFrames('sedanPopular', side, seconds, (m, t, who, car, frame) => {
      const ankle = who.at(lead).y;
      if (planted === null && Math.abs(who.at(lead).z) > car.spec.W / 2 && ankle < .12) { planted = frame; otherThen = who.at(other).y; turned = m.yaw; }
      if (m.phase === 'rise') rise.push({ frame, hip: who.at('hip').y, trunk: who.pitch('trunk'), head: who.pitch('head') - who.pitch('trunk') });
    });
    const label = `lado ${side}, fichado ${level}`;
    assert.ok(planted !== null, `${label}: el pie de afuera llega al piso`);
    assert.ok(otherThen > .15, `${label}: el otro pie sigue arriba (${otherThen.toFixed(2)} m)`);
    assert.ok(turned * 90 >= 70, `${label}: ya giró ${(turned * 90).toFixed(0)}° hacia la puerta`);
    // Cuándo va por la mitad cada cosa: lo que sube la cadera, lo que se desdobla el tronco y lo que levanta la cabeza.
    const half = key => {
      const from = rise[0][key], to = rise.at(-1)[key];
      return rise.find(item => Math.abs(item[key] - from) >= Math.abs(to - from) / 2).frame;
    };
    const hip = half('hip'), trunk = half('trunk'), head = half('head');
    assert.ok(trunk - hip >= 2 && head - trunk >= 2, `${label}: cadera en el cuadro ${hip}, tronco en el ${trunk}, cabeza en el ${head}`);
    assert.ok(rise.at(-1).hip > rise[0].hip + .3, `${label}: la cadera sube ${(rise.at(-1).hip - rise[0].hip).toFixed(2)} m`);
  }
});

test('de afán son las mismas poses, comprimidas: a la misma fracción de cada fase el cuerpo queda igual', async () => {
  const who = await officerBody;
  const snapshots = [];
  for (const [, seconds] of LEVELS) {
    const e = exitTimes(seconds), list = [];
    const starts = [0, e.door, e.door + e.swing];
    for (const [index, length] of [e.door, e.swing, e.rise].entries()) for (const u of [0, .25, .5, .75, .98]) {
      const m = exitMotion(starts[index] + length * u, e, 1, {});
      who.pose(new THREE.Vector3(), 0, m.poses);
      list.push({ phase: m.phase, slide: m.slide, drop: m.drop, yaw: m.yaw, out: m.out, pose: [...who.bones.values()].map(item => item.quaternion.toArray()) });
    }
    snapshots.push(list);
  }
  const [slow, fast] = snapshots;
  assert.equal(slow.length, fast.length);
  slow.forEach((a, i) => {
    const b = fast[i];
    assert.equal(a.phase, b.phase);
    for (const key of ['slide', 'drop', 'yaw', 'out']) assert.ok(Math.abs(a[key] - b[key]) < 1e-6, `${a.phase} ${key}`);
    a.pose.forEach((q, k) => q.forEach((value, n) => assert.ok(Math.abs(value - b.pose[k][n]) < 1e-5, `${a.phase}: hueso ${k}`)));
  });
});
