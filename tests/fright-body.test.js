// Lo que el susto le pide al cuerpo: pararse del piso de afán, encajar un golpe abajo y cambiar de agarre.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bakeStances, HAND_ON_FLOOR } from '../src/character/stances.js';
import { BodyLanguage, KO_HAND_DOWN, KO_PLANS, RISE_TIME, koHandDown, smooth } from '../src/character/BodyLanguage.js';
import { buildGaitSources } from '../src/character/gaitFamilies.js';
import { ActionPose } from '../src/character/ActionPose.js';
import { LOW_STANCES } from '../src/character/archetypes.js';
import { readMotion, writeMotion } from '../src/character/RealisticCharacter.js';

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

const person = (async () => {
  const gltf = await body('hombre-adulto');
  const sources = buildGaitSources(gltf, await glb('andar-erguido.glb'), await glb('andar-cansado.glb'));
  return { gltf, library: bakeStances(gltf.scene, sources.standing) };
})();

function instance({ gltf, library }) {
  const root = clone(gltf.scene);
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  return { root, bones, layer: new BodyLanguage(bones, library) };
}

/** Segundos desde que se suelta la postura hasta que la cadera vuelve arriba. */
function timeToStand(layer, stance, rising) {
  layer.restore();
  layer.apply(5, { stance, speed: 0 });
  assert.ok(layer.hipWeight > .99, stance);
  let t = 0;
  while (layer.hipWeight > .02 && t < 5) {
    layer.restore();
    layer.apply(1 / 60, { stance: null, speed: 0, rising });
    t += 1 / 60;
  }
  return t;
}

test('pararse de afán sube la cadera en el tiempo de levantarse; sin afán, cada postura se toma lo suyo', async () => {
  const who = await person;
  assert.ok(RISE_TIME >= .3 && RISE_TIME <= .4);
  for (const stance of LOW_STANCES) {
    const { layer } = instance(who);
    const quick = timeToStand(layer, stance, true), calm = timeToStand(layer, stance, false);
    assert.ok(Math.abs(quick - RISE_TIME) < .05, `${stance} de afán: ${quick.toFixed(2)} s`);
    assert.ok(calm > quick + .15, `${stance} con calma: ${calm.toFixed(2)} s`);
  }
});

test('cambiar el peso de una pierna a otra no cuenta como tener la cadera abajo', async () => {
  const { layer } = instance(await person);
  layer.apply(5, { stance: 'cambiar-peso', speed: 0 });
  assert.equal(layer.hipWeight, 0);
  layer.restore();
  layer.apply(5, { stance: 'dormido', speed: 0 });
  assert.ok(layer.hipWeight > .99);
});

test('un golpe recibido abajo no estira las piernas ni levanta el cuerpo de un salto', async () => {
  const who = await person;
  const hitAt = (progress, hipLow) => {
    const { root, bones, layer } = instance(who);
    root.updateMatrixWorld(true);
    layer.apply(5, { stance: 'dormido', speed: 0 });
    const pose = new ActionPose(bones);
    const hips = pose.joints.hips;
    root.updateMatrixWorld(true);
    const before = hips.getWorldPosition(new THREE.Vector3()).y;
    pose.apply(.016, { action: 'recibirGolpe', actionProgress: progress, hipLow });
    root.updateMatrixWorld(true);
    return hips.getWorldPosition(new THREE.Vector3()).y - before;
  };
  // De pie, las rodillas absorben. Abajo no hay nada que estirar.
  const low = [.05, .1, .2, .3, .5].map(p => Math.abs(hitAt(p, 1)));
  const ignored = [.05, .1, .2, .3, .5].map(p => Math.abs(hitAt(p, 0)));
  assert.ok(Math.max(...low) < .001, `abajo: ${low}`);
  assert.ok(Math.max(...ignored) > .1, `sin tenerlo en cuenta sube ${Math.max(...ignored).toFixed(2)} m`);
  // A media subida, sin saltos: el peso de las piernas entra poco a poco.
  assert.ok(hitAt(.2, .1) !== 0);
  assert.ok(Math.abs(hitAt(.2, .1)) < Math.abs(hitAt(.2, 0)));
});

test('noqueado desde el piso se va de espaldas sin que la cadera suba, y queda tendido del todo', async () => {
  const who = await person;
  for (const stance of LOW_STANCES) {
    const { root, layer } = instance(who);
    layer.apply(5, { stance, speed: 0 });
    root.updateMatrixWorld(true);
    const height = () => layer.hips.getWorldPosition(new THREE.Vector3()).y;
    const start = height();
    let top = start;
    const koPlan = stance === 'dormido' ? 'dormido' : stance === 'banca' ? 'banca' : 'bajo';
    for (let frame = 1; frame <= 42; frame++) { // lo que dura la caída, a 60 cuadros por segundo
      const ko = smooth(frame / 42);
      layer.restore();
      layer.apply(1 / 60, { speed: 0, ko, koPlan, koFrom: stance });
      root.updateMatrixWorld(true);
      top = Math.max(top, height());
    }
    assert.ok(top - start < .1, `${stance}: de ${start.toFixed(2)} m sube a ${top.toFixed(2)} m`);
    assert.equal(layer.hipWeight, 0, `${stance}: tendido no queda nada de la postura baja`);
  }
});

// ---------- caer y pararse ----------

// Lo más que se admite en cualquier punto del camino, medido en los huesos. De pie el tobillo va a 7 cm y la base de los dedos a 3 cm.
const FLOOR = { knee: .03, ankle: .01, toe: -.03 };

/** Dónde están las piezas del cuerpo en cada punto del camino, con el grupo sin girar. */
function walkPath(who, { plan, rising, frames = 60, lod = false, koFrom = null }) {
  const { root, bones, layer } = instance(who);
  if (lod) layer.lod = true;
  const at = name => bones.get([...bones.keys()].find(bone => bone.endsWith(name))).getWorldPosition(new THREE.Vector3());
  if (koFrom) layer.apply(5, { stance: koFrom, speed: 0 });
  const out = [];
  for (let frame = 0; frame <= frames; frame++) {
    const ko = rising ? smooth(1 - frame / frames) : smooth(frame / frames);
    layer.restore();
    layer.apply(1 / 60, { speed: 0, ko, koRising: rising, koPlan: plan, koFrom });
    root.updateMatrixWorld(true);
    out.push({ ko, t: frame / frames, hips: at('Hips'), head: at('Head'), feet: [at('LeftFoot'), at('RightFoot')], hands: [at('LeftHand'), at('RightHand')], knee: at('LeftLeg') });
  }
  assert.ok(Math.abs(root.rotation.x) < 1e-9, 'el grupo no gira');
  return out;
}

test('al caer primero ceden las rodillas: la cadera baja antes de que el cuerpo se vaya de espaldas, y los pies se quedan', async () => {
  const who = await person;
  const path = walkPath(who, { plan: 'espalda', rising: false });
  const start = path[0], end = path.at(-1);
  // A la tercera parte del camino ya bajó buena parte, sin haberse ido hacia atrás todavía. Un tablón que gira desde los talones haría lo contrario.
  const third = path.find(item => item.ko >= .35);
  assert.ok(start.hips.y - third.hips.y > .2, `cadera a ${third.hips.y.toFixed(2)} desde ${start.hips.y.toFixed(2)}`);
  assert.ok(third.hips.z > -.3, `sigue sobre los pies: ${third.hips.z.toFixed(2)}`);
  assert.ok(third.head.z > -.35, 'la cabeza también');
  for (const item of path) for (const foot of item.feet) assert.ok(Math.hypot(foot.x, foot.z) < .55 && foot.y < .65, `el pie se queda: ${foot.toArray()}`);
  assert.ok(end.hips.z < -.8 && end.hips.y < .2 && end.head.z < -1.3 && end.head.y < .3, `termina acostado: ${end.head.toArray()}`);
  for (let i = 1; i < path.length; i++) assert.ok(path[i].hips.distanceTo(path[i - 1].hips) < .1, `sin saltos en el cuadro ${i}`);
});

test('al pararse apoya la mano y la rodilla, y el tronco sube de último', async () => {
  const who = await person;
  const path = walkPath(who, { plan: 'espalda', rising: true });
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].hips.distanceTo(path[i - 1].hips) < .1, `sin saltos en el cuadro ${i}`);
    assert.ok(path[i].head.distanceTo(path[i - 1].head) < .12, `la cabeza tampoco, cuadro ${i}`);
  }
  const hand = path.find(item => item.ko <= 1 - KO_HAND_DOWN);
  assert.ok(hand.hands[1].y < .22, `la mano derecha está en el piso: ${hand.hands[1].y.toFixed(2)}`);
  assert.ok(hand.hips.y < .75, 'con la cadera todavía abajo');
  // Cuando las piernas ya están casi estiradas, la cabeza sigue adelante y abajo: el tronco no ha subido.
  const legs = path.find(item => item.hips.y > path.at(-1).hips.y - .25);
  assert.ok(legs.head.z > legs.hips.z + .2, `tronco adelantado: ${legs.head.z.toFixed(2)} sobre ${legs.hips.z.toFixed(2)}`);
  assert.ok(legs.head.y < path.at(-1).head.y - .25, 'y la cabeza sigue abajo');
  for (const item of path) for (const part of [item.hips, item.head, ...item.hands]) assert.ok(part.y > .02, `nada se hunde: ${part.toArray()}`);
  assert.ok(path.at(-1).hips.distanceTo(path[0].hips) > .5);
  const standing = instance(who);
  standing.root.updateMatrixWorld(true);
  assert.ok(path.at(-1).head.distanceTo(standing.bones.get([...standing.bones.keys()].find(bone => bone.endsWith('Head'))).getWorldPosition(new THREE.Vector3())) < .03, 'termina como estaba');
});

test('de subida, con el paraguas ya en la mano, el brazo toma su postura en el último tramo: no antes', async () => {
  const who = await person;
  const armAt = (stance, ko) => {
    const { bones, layer, root } = instance(who);
    for (let i = 0; i < 40; i++) layer.apply(1 / 60, { stance, ko: 1 - (i + 1) / 40 * (1 - ko), koRising: true });
    root.updateMatrixWorld(true);
    return bones.get([...bones.keys()].find(name => name.endsWith('RightHand'))).getWorldPosition(new THREE.Vector3());
  };
  assert.ok(armAt('paraguas', 1 - KO_HAND_DOWN + .05).distanceTo(armAt(null, 1 - KO_HAND_DOWN + .05)) < 1e-6, 'apoyándose en el piso no');
  assert.ok(armAt('paraguas', .02).y > armAt(null, .02).y + .2, 'casi de pie, la mano ya va arriba');
});

test('el modelo liviano recorre el mismo camino, sin dedos', async () => {
  const who = await person;
  const full = walkPath(who, { plan: 'espalda', rising: true }), light = walkPath(who, { plan: 'espalda', rising: true, lod: true });
  for (let i = 0; i < full.length; i++) assert.ok(full[i].head.distanceTo(light[i].head) < .001);
  const { layer } = instance(who);
  layer.lod = true;
  layer.apply(1 / 60, { ko: .5 });
  assert.ok(layer.koSlots.some(slot => slot === null), 'los dedos no gastan');
});

test('noqueado en la banca sigue sentado; dormido se queda como está; contra un muro queda sentado con los pies adelante', async () => {
  const who = await person;
  const bench = walkPath(who, { plan: 'banca', rising: false, koFrom: 'banca' });
  assert.ok(Math.abs(bench.at(-1).hips.y - bench[0].hips.y) < .05, 'la cadera sigue en el asiento');
  assert.ok(Math.abs(bench.at(-1).hips.z - bench[0].hips.z) < .1, 'no se va para atrás, donde está el espaldar');
  assert.ok(bench.at(-1).head.z > bench[0].head.z + .1, 'el tronco se vence hacia adelante');
  const asleep = walkPath(who, { plan: 'dormido', rising: false, koFrom: 'dormido' });
  assert.ok(asleep.at(-1).hips.distanceTo(asleep[0].hips) < .03);
  const wall = walkPath(who, { plan: 'muro', rising: false });
  assert.ok(wall.at(-1).hips.z > -.15 && wall.at(-1).head.z > -.3, `no ocupa lo de atrás: cabeza en ${wall.at(-1).head.z.toFixed(2)}`);
  assert.ok(wall.at(-1).hips.y < .3);
  for (const plan of Object.keys(KO_PLANS)) {
    const path = walkPath(who, { plan, rising: true, frames: 90 });
    for (let i = 1; i < path.length; i++) assert.ok(path[i].hips.distanceTo(path[i - 1].hips) < .1, `${plan}: sin saltos, cuadro ${i}`);
  }
});

test('cuando la mano va a recoger lo caído está en el piso, junto a donde quedó, en todos los planes con el cuerpo en el piso', async () => {
  const who = await person;
  for (const plan of ['espalda', 'bajo', 'rodillas', 'dormido', 'muro', 'muro-bajo', 'muro-rodillas']) {
    const { root, bones, layer } = instance(who);
    const hand = bones.get([...bones.keys()].find(bone => bone.endsWith('RightHand')));
    layer.apply(1 / 60, { speed: 0, ko: 1 - koHandDown(plan), koRising: true, koPlan: plan });
    root.updateMatrixWorld(true);
    const at = hand.getWorldPosition(new THREE.Vector3());
    assert.ok(at.y < .25, `${plan}: la mano a ${at.y.toFixed(2)} del piso`);
    assert.ok(Math.hypot(at.x - HAND_ON_FLOOR.x, at.z - HAND_ON_FLOOR.z) < .2, `${plan}: la mano en ${at.x.toFixed(2)}, ${at.z.toFixed(2)}`);
  }
});

test('ni el pie ni la canilla pasan por el piso al caer y pararse, con todos los planes y cuerpos', async () => {
  const sources = await Promise.all([glb('andar-erguido.glb'), glb('andar-cansado.glb')]);
  const low = { sentado: 'bajo', acurrucado: 'bajo', pedir: 'rodillas', dormido: 'dormido', banca: 'banca' };
  const wall = { sentado: 'muro-bajo', acurrucado: 'muro-bajo', pedir: 'muro-rodillas' };
  const paths = [
    ...Object.keys(KO_PLANS).map(plan => ({ plan, rising: true, koFrom: null })),
    { plan: 'espalda', rising: false, koFrom: null }, { plan: 'muro', rising: false, koFrom: null },
    ...Object.entries(low).map(([koFrom, plan]) => ({ plan, rising: false, koFrom })),
    ...Object.entries(wall).map(([koFrom, plan]) => ({ plan, rising: false, koFrom }))
  ];
  // Desde abajo cada postura cae por el plan que le toca: una regla nueva sin su camino se notaría aquí.
  assert.equal(new Set(paths.map(item => item.plan)).size, Object.keys(KO_PLANS).length, 'ningún plan se queda sin medir');
  for (const id of ['hombre-adulto', 'hombre-joven', 'hombre-mayor', 'mujer-adulta', 'mujer-joven', 'mujer-mayor']) {
    const gltf = await body(id);
    const who = { gltf, library: bakeStances(gltf.scene, buildGaitSources(gltf, ...sources).standing) };
    for (const { plan, rising, koFrom } of paths) {
      const { root, bones, layer } = instance(who);
      const bone = name => bones.get([...bones.keys()].find(item => item.endsWith(name)));
      const legs = ['Left', 'Right'].map(side => ({ knee: bone(`${side}Leg`), ankle: bone(`${side}Foot`), toe: bone(`${side}ToeBase`) }));
      if (koFrom) layer.apply(5, { stance: koFrom, speed: 0 });
      const at = new THREE.Vector3(), knee = new THREE.Vector3();
      for (let frame = 0; frame <= 90; frame++) {
        const ko = rising ? smooth(1 - frame / 90) : smooth(frame / 90);
        layer.restore();
        layer.apply(1 / 60, { speed: 0, ko, koRising: rising, koPlan: plan, koFrom });
        root.updateMatrixWorld(true);
        const where = `${id}, ${plan}${koFrom ? ` desde ${koFrom}` : ''}, ${rising ? 'subiendo' : 'cayendo'}, cuadro ${frame}`;
        for (const leg of legs) {
          const ankle = leg.ankle.getWorldPosition(at).y, top = leg.knee.getWorldPosition(knee).y;
          assert.ok(top > FLOOR.knee, `${where}: rodilla a ${top.toFixed(3)} m`);
          assert.ok(ankle > FLOOR.ankle, `${where}: tobillo a ${ankle.toFixed(3)} m`);
          assert.ok((top + ankle) / 2 > FLOOR.knee, `${where}: canilla a ${((top + ankle) / 2).toFixed(3)} m`);
          const toe = leg.toe.getWorldPosition(at).y;
          assert.ok(toe > FLOOR.toe, `${where}: punta del pie a ${toe.toFixed(3)} m`);
        }
      }
    }
  }
});

test('el modelo que entra a media subida sigue donde iba: no se para de un cuadro', async () => {
  const who = await person;
  for (const stance of LOW_STANCES) {
    const light = instance(who), full = instance(who);
    light.layer.apply(5, { stance, speed: 0 });
    light.layer.restore();
    assert.ok(light.layer.hipWeight > .99);
    // Lo asustan y en ese mismo cuadro entra el modelo completo, con la orden de tomar la postura de una.
    full.layer.setState(light.layer.state());
    full.layer.snap();
    full.layer.apply(1 / 60, { stance: null, speed: 0, rising: true });
    assert.ok(full.layer.hipWeight > .9, `${stance}: sigue abajo, ${full.layer.hipWeight.toFixed(2)}`);
    let t = 1 / 60;
    while (full.layer.hipWeight > .02 && t < 2) { full.layer.restore(); full.layer.apply(1 / 60, { stance: null, speed: 0, rising: true }); t += 1 / 60; }
    assert.ok(Math.abs(t - RISE_TIME) < .05, `${stance}: tarda lo de siempre, ${t.toFixed(2)} s`);
  }
});

test('lo que un modelo le pasa al otro lleva la postura puesta: el que entra sigue sentado', async () => {
  const who = await person;
  const hipY = ({ hips }) => hips.position.y;
  const from = instance(who), to = instance(who);
  const hipsOf = ({ bones }) => ({ hips: bones.get([...bones.keys()].find(name => name.endsWith('Hips'))) });
  from.layer.snapNext = true;
  from.layer.apply(1 / 60, { stance: 'sentado' });
  const asInst = ({ layer }) => ({ actions: {}, phase: 0, runShare: 0, bodyLanguage: layer });
  writeMotion(asInst(to), {}, readMotion(asInst(from), {}));
  to.layer.apply(1 / 60, { stance: 'sentado' });
  assert.ok(Math.abs(hipY(hipsOf(to)) - hipY(hipsOf(from))) < .02, 'cadera abajo desde el primer cuadro');
});

test('una orden de entrar de una que nadie usó no se queda para la siguiente postura', async () => {
  const { layer } = instance(await person);
  layer.snap();
  layer.apply(1 / 60, { speed: 0 }); // sin postura, sin estilo: no hay nada que hacer
  layer.apply(1 / 60, { stance: 'sentado', speed: 0 });
  assert.ok(layer.layers[0].weight < .1, `entra poco a poco: ${layer.layers[0].weight}`);
});

test('corriendo el bastón cambia a un agarre por la mitad, atado a la misma mano', async () => {
  const { holds } = (await person).library;
  const walk = holds['cargar-derecha'], run = holds['baston-correr'];
  assert.equal(run.boneName, walk.boneName);
  assert.ok(run.position.length() > .3 && run.position.length() < .6, 'agarrado lejos del extremo');
  assert.ok(Math.abs(run.quaternion.length() - 1) < 1e-6);
  assert.ok(run.quaternion.angleTo(walk.quaternion) > .3, 'otro ángulo que al andar');
});
