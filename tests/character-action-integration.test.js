import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRealisticCharacter } from '../src/character/RealisticCharacter.js';
import { createCharacter } from '../src/character/character.js';
import { createSkinSupport } from '../src/character/mixamoGrounding.js';
import { Npc } from '../src/entities/Npc.js';
import { Player } from '../src/entities/Player.js';
import { Bicycle } from '../src/entities/Bicycle.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { CHARACTER_SCALE } from '../src/utils/constants.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
const models = fileURLToPath(new URL('../public/models/', import.meta.url));
const originalFetch = globalThis.fetch;
const sources = new Map();

test.before(() => {
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
    if (file.endsWith('/cuerpo.gltf')) sources.set(result.scene, bonePose(result.scene));
    return result;
  });
});
test.after(() => mock.restoreAll());

function bonePose(root) {
  const pose = {};
  root.traverse(bone => {
    if (bone.isBone) pose[bone.name] = [...bone.position.toArray(), ...bone.quaternion.toArray()];
  });
  return pose;
}

function joint(root, name) {
  let found;
  root.traverse(bone => { if (bone.isBone && bone.name.endsWith(name)) found = bone; });
  assert.ok(found, name);
  return found;
}

function handSurfaces(character, side) {
  const patches = [];
  const rig = character.ragdollRig;
  const region = rig ? rig[`${side.toLowerCase()}ForeArm`] : character.group;
  region.traverse(mesh => {
    if (!mesh.isMesh || (rig && mesh.geometry.type !== 'SphereGeometry')) return;
    if (!rig && (!mesh.isSkinnedMesh || mesh.material.userData.streetSurface !== 'skin')) return;
    const { index, attributes, drawRange } = mesh.geometry;
    const handBone = mesh.skeleton?.bones.map(bone => bone.name.includes(`${side}Hand`));
    const end = Math.min(index?.count ?? attributes.position.count, drawRange.start + drawRange.count);
    const triangles = [];
    for (let i = drawRange.start; i + 2 < end; i += 3) {
      const triangle = [i, i + 1, i + 2].map(at => index?.getX(at) ?? at);
      if (handBone && !triangle.every(vertex => [0, 1, 2, 3].some(n =>
        attributes.skinWeight.getComponent(vertex, n) > .3 && handBone[attributes.skinIndex.getComponent(vertex, n)]))) continue;
      triangles.push(triangle);
    }
    if (triangles.length) patches.push({ mesh, triangles });
  });
  assert.ok(patches.length, `superficie de la mano ${side}`);
  return patches;
}
function gripDistance(grip, patches) {
  const { radiusTop, height } = grip.geometry.parameters;
  const samples = [-.45, -.2, 0, .2, .45].flatMap(t => [0, 1, 2, 3, 4, 5].map(i => {
    const angle = i * Math.PI / 3;
    return grip.localToWorld(new THREE.Vector3(radiusTop * Math.cos(angle), t * height, radiusTop * Math.sin(angle)));
  }));
  const triangle = new THREE.Triangle(), point = new THREE.Vector3();
  const vertices = [triangle.a, triangle.b, triangle.c];
  let gap = Infinity;
  for (const { mesh, triangles } of patches) {
    mesh.skeleton?.update();
    for (const indices of triangles) {
      for (let i = 0; i < 3; i++) mesh.getVertexPosition(indices[i], vertices[i]).applyMatrix4(mesh.matrixWorld);
      for (const sample of samples) gap = Math.min(gap, triangle.closestPointToPoint(sample, point).distanceToSquared(sample));
    }
  }
  return Math.sqrt(gap);
}
test('los dos cuerpos agarran la dirección final de la bicicleta y giran con los pedales', async () => {
  const scene = new THREE.Scene();
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false, isDown: () => false };
  const player = new Player(scene, input);
  const bike = new Bicycle(scene, player.position, 0, { locked: false });
  const point = new THREE.Vector3(), grip = new THREE.Vector3();
  try {
    bike.mount(player);
    const realistas = ['hombre', 'mujer'].flatMap(sexo => ['joven', 'adulto', 'mayor'].map(edad => ({ sexo, edad, model: 'realista' })));
    for (const { sexo, edad, model } of [...realistas, { model: 'procedural' }]) {
      await player.setLook({ v: 2, real: { sexo, edad } });
      await player.setModel(model);
      const { character } = player;
      const part = (key, name) => character.ragdollRig?.[key] ?? character.group.getObjectByName(key) ?? joint(character.group, name);
      const hips = part('hips', 'Hips');
      const palms = ['Right', 'Left'].map(name => handSurfaces(character, name));
      for (const direction of [3, -3]) {
        player.root.rotation.y += direction * .6;
        player.speed = 8.5;
        player.movement.turnRate = direction;
        for (let i = 0; i < 25; i++) {
          character.update(1 / 60, {});
          bike.update(1 / 60, player);
          player.updateBicyclePose();
          bike.saddle.worldToLocal(hips.getWorldPosition(point));
          assert.ok(Math.abs(point.x) < .002 && point.y > .03 && point.y < .14, model);
          for (const [index, side, name] of [[0, 'right', 'Right'], [1, 'left', 'Left']]) {
            if ([0, 12, 24].includes(i)) {
              scene.updateMatrixWorld(true);
              const handGap = gripDistance(bike.grips[index], palms[index]);
              assert.ok(handGap < .02, `${model} ${sexo ?? ''} ${edad ?? ''} ${side}, giro ${direction}, cuadro ${i}: mano a ${handGap} m del puño`);
            }
            const foot = part(`${side}Foot`, `${name}Foot`);
            assert.ok(foot.getWorldPosition(point).distanceTo(bike.pedals[index].getWorldPosition(grip)) < .17, `${model} ${side}`);
          }
        }
      }
      player.speed = 0;
      const phase = bike.pedalRotation;
      bike.update(.2, player);
      player.updateBicyclePose();
      assert.equal(bike.pedalRotation, phase);
    }
    bike.dismount();
    player.update(1 / 60, null, null, () => 0);
    assert.ok(player.character.ragdollRig.hips.position.y < .55, 'la pose de pie vuelve tras desmontar');
  } finally { bike.dispose(); player.dispose(); }
});

test('el liviano de menor estatura alcanza los pedales con chanclas', () => {
  const scene = new THREE.Scene();
  const model = createCharacter({ v: 2, estatura: .92, zapatos: 'chanclas' });
  scene.add(model.group);
  const rider = { position: new THREE.Vector3(), root: new THREE.Object3D(), speed: 8.5, movement: { turnRate: -1 } };
  const bike = new Bicycle(scene, rider.position, 0, { locked: false });
  const point = new THREE.Vector3(), platform = new THREE.Vector3();
  try {
    bike.mount(rider);
    for (let i = 0; i < 90; i++) {
      model.update(1 / 60);
      bike.update(1 / 60, rider);
      model.fitBicycle(bike);
      for (const [index, side, sign] of [[0, 'right', -1], [1, 'left', 1]]) {
        model.ragdollRig[`${side}Foot`].localToWorld(point.set(0, -.0425, .112));
        bike.pedals[index].localToWorld(platform.set(sign * .021, .01, 0));
        assert.ok(point.distanceTo(platform) < .008, 'la suela acompaña el pedal por toda la vuelta');
      }
    }
    assert.ok(Math.abs(bike.wheelRotation - (90 / 60 * 8.5 / .354)) < 1e-8);
    assert.ok(Math.abs(bike.pedalRotation - bike.wheelRotation / 2.8) < 1e-8);
    assert.ok(Math.abs(bike.pedals[1].position.y - .06) < 1e-8);
    bike.dismount();
    assert.equal(bike.pedals[1].position.y, .11, 'la posición de parqueo se recupera');
  } finally { model.dispose(); bike.dispose(); }
});

test('E deja la bicicleta quieta y solo se baja por un lado libre con apoyo', () => {
  const scene = new THREE.Scene();
  let pressed = 'KeyE';
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: key => {
    if (key !== pressed) return false;
    pressed = null;
    return true;
  } };
  const player = new Player(scene, input);
  const start = player.position.clone();
  const bike = new Bicycle(scene, start, 0, { locked: false });
  const collisions = new CollisionSystem();
  const wall = new THREE.Object3D();
  wall.position.copy(start).add(new THREE.Vector3(-.85, 0, 0));
  collisions.add(wall, new THREE.Vector3(.2, 2, 2));
  const floor = x => ({ height: x > start.x + .4 ? .12 : 0, layer: 'ground' });
  try {
    bike.mount(player);
    player.update(1 / 60, null, collisions, floor);
    assert.equal(player.ridingBike, null);
    assert.ok(Math.abs(player.position.x - start.x - .57) < 1e-6);
    assert.equal(player.position.y, .12, 'libra el muro y apoya en el andén');
    assert.deepEqual(bike.position.toArray(), start.toArray());

    player.position.copy(start);
    bike.mount(player);
    pressed = 'KeyE';
    player.update(1 / 60, null, collisions, floor, [], x => x > start.x + .4 ? { surfaceY: .5 } : null);
    assert.equal(player.ridingBike, null);
    assert.deepEqual(player.position.toArray(), start.toArray(), 'se queda donde hay apoyo si el otro lado está inundado');
  } finally { bike.dispose(); player.dispose(); }
});

test('al salir de la banca el cuerpo vestido se apoya, recupera su paso y vuelve al asiento', async t => {
  const scene = new THREE.Scene(), point = new THREE.Vector3(), player = new THREE.Vector3();
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', async () => new THREE.Texture());
  const dt = 1 / 60;
  for (const [arquetipo, portal, ground, top, halfDepth] of [['abuelo', false, .06, .469, .24], ['senora', true, .92, .493, .21]]) {
    // En el Portal la vecina se sienta 36 cm al lado del centro longitudinal de la banca.
    const home = new THREE.Vector3(portal ? -.36 : 0, ground, .1);
    const roll = t.mock.method(Math, 'random', () => portal ? .62 : .49);
    const npc = new Npc(scene, home, { arquetipo, facing: 0, fijo: { stance: 'banca', techo: portal } });
    roll.mock.restore();
    try {
      await npc.preload();
      assert.equal(npc.look.real.edad, 'mayor');
      for (const distance of [2.8, 12.5]) {
        const step = (frames, gap = distance) => {
          for (let i = 0; i < frames; i++) {
            player.copy(npc.position).z += gap;
            npc.update(dt, { player });
          }
        };
        step(90);
        assert.equal(npc.character, distance < 4 ? npc.fullChar : npc.lodChar);
        const { group } = npc.character, hip = joint(group, 'Hips');
        const shoes = createSkinSupport(group, { bones: /(?:Foot|ToeBase)$/ });
        assert.ok(shoes.vertexCount > 0);
        const measureSupport = () => {
          scene.updateMatrixWorld(true);
          let gap = Infinity;
          const soles = [Infinity, Infinity];
          group.traverse(mesh => {
            if (!mesh.visible || !mesh.isSkinnedMesh) return;
            const kind = mesh.material.userData.streetSurface;
            if (kind !== 'fabric' && kind !== 'shoes') return;
            mesh.skeleton.update();
            const { index, attributes, drawRange } = mesh.geometry;
            const end = Math.min(index?.count ?? attributes.position.count, drawRange.start + drawRange.count);
            for (let i = drawRange.start; i < end; i++) {
              mesh.getVertexPosition(index?.getX(i) ?? i, point).applyMatrix4(mesh.matrixWorld);
              if (kind === 'shoes') {
                const side = point.x < home.x ? 0 : 1;
                soles[side] = Math.min(soles[side], point.y - ground);
                continue;
              }
              if (Math.abs(point.x - home.x) < .22 && Math.abs(point.z) < halfDepth && Math.abs(point.y - ground - top) < .13) {
                // Entre los nervios la chapa de acero queda 8 mm más abajo.
                const ribX = Math.round(point.x / .125) * .125;
                const onRib = Math.abs(point.x - ribX) <= .025 && Math.abs(point.z) <= .2;
                const surface = portal && !onRib ? top - .008 : top;
                gap = Math.min(gap, point.y - ground - surface);
              }
            }
          });
          return { gap, soles };
        };
        const seated = hip.getWorldPosition(point).y;
        const { gap: contact, soles } = measureSupport();
        assert.ok(Math.abs(contact) < .008, `${arquetipo}: ropa a ${contact} m del asiento`);
        assert.ok(Math.abs(shoes.minimumY()) < .02, `${arquetipo}: plantas junto al suelo al sentarse`);
        if (portal) {
          assert.equal(npc.look.real.calzado, 'zapatos');
          assert.ok(soles.every(y => Math.abs(y) < .002), `suelas de cuero a ${soles} m del piso`);
        }
        npc.alarmedByTheft(new THREE.Vector3(home.x, ground, -2), true);
        let firstStepHipZ = null;
        for (let frame = 0; frame < 34; frame++) {
          step(1);
          if (npc.moving) {
            const hipZ = hip.getWorldPosition(point).z;
            assert.ok(hipZ > halfDepth, `${arquetipo}: primer paso delante del asiento`);
            firstStepHipZ ??= hipZ;
            if (portal && npc.position.z - home.z > .25) {
              assert.ok(hipZ - firstStepHipZ > .08, 'la cadera acompaña el primer paso y deja pasar la pierna frente a la chapa');
            }
          } else {
            const sole = shoes.minimumY();
            assert.ok(sole > -.018 && sole < .032, `${arquetipo}: suelas a ${sole} m del piso al levantarse`);
          }
        }
        assert.equal(npc.moving, true);
        const standing = hip.getWorldPosition(point).y;
        const rise = standing - seated;
        // Un asiento más alto reduce el recorrido. La marcha debe recuperar también la altura sobre el suelo.
        assert.ok(rise > .23 - (top - .469) && standing - ground > .89,
          `${arquetipo}: la cadera subió ${rise} m hasta quedar a ${standing - ground} m del suelo`);
        step(40);
        assert.ok(npc.position.z > home.z + 1 && npc._bench.advance === 0, `${arquetipo}: continúa su marcha sin desplazamiento de la pose`);
        for (let frame = 0; frame < 2400 && npc.fijo.out; frame++) step(1, 60);
        assert.ok(!npc.fijo.out && npc.stance === 'banca' && npc.position.equals(home), `${arquetipo}: recupera su lugar`);
        step(90); // se asienta y termina de orientarse después de tomar su sitio
        const { gap: returned, soles: returnedSoles } = measureSupport();
        assert.ok(Math.abs(returned - contact) < .006, `${arquetipo}: ropa a ${returned} m al volver, antes a ${contact} m`);
        if (portal) assert.ok(returnedSoles.every(y => Math.abs(y) < .002), `suelas al regresar: ${returnedSoles}`);
      }
    } finally { npc.dispose(); }
  }
});

test('cambiar de modelo a mitad de levantarse no deja al realista a medio acostar cuando vuelve', async () => {
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false, isDown: () => false };
  const player = new Player(new THREE.Scene(), input, new StatsSystem(), null);
  await player.setModel('realista');
  const character = player.character;
  const hips = joint(character.group, 'Hips');
  character.update(.2, { speed: 0, movement: { grounded: true } });
  const standing = hips.quaternion.clone();
  for (let frame = 0; frame < 90; frame++) character.update(1 / 60, { action: 'dormir', movement: { grounded: true } });
  character.update(1 / 60, { speed: 3, movement: { grounded: true } });
  assert.ok(character.sleepWeight > .9 && character.sleepWeight < 1, `se está levantando: ${character.sleepWeight}`);
  assert.ok(hips.quaternion.angleTo(standing) > .7, 'aún casi acostado');
  await player.setModel('procedural');
  await player.setModel('realista');
  assert.equal(player.character, character);
  assert.equal(character.sleepWeight, 0);
  character.update(1 / 60, { speed: 0, movement: { grounded: true } });
  assert.ok(hips.quaternion.angleTo(standing) < .2, 'de pie de una vez');
});

test('salto y puñetazo se componen sobre el cuerpo vestido también con velocidad horizontal', async () => {
  const character = await createRealisticCharacter();
  const { group } = character;
  const rightArm = joint(group, 'RightArm');
  const rightHand = joint(group, 'RightHand');
  for (let frame = 0; frame < 60; frame++) character.update(1 / 60, { speed: 3, movement: { grounded: true } });
  // Saltar corriendo no vuelve al reposo: la zancada sigue y llega a la pisada justo al tocar el suelo,
  // con el pie de delante abajo.
  const foot = name => joint(group, name).getWorldPosition(new THREE.Vector3());
  for (let ttg = .5; ttg > 1e-6; ttg -= 1 / 60) {
    character.update(1 / 60, { speed: 3, action: 'saltar', movement: { grounded: false, verticalVelocity: -2, airTime: .6 - ttg, launchSpeed: 5.45, groundGap: .3 * ttg, timeToGround: Math.max(ttg - 1 / 60, 0) } });
  }
  // Tobillos: al pisar, el de delante entra de talón y el de atrás ya despega.
  const [left, right] = [foot('LeftFoot'), foot('RightFoot')];
  const [front, back] = left.z > right.z ? [left, right] : [right, left];
  assert.ok(front.z - back.z > .2, `las piernas van abiertas en zancada: ${front.z - back.z}`);
  assert.ok(front.y < back.y, `apoya con el pie de delante: ${front.y.toFixed(3)} / ${back.y.toFixed(3)}`);
  character.update(1 / 60, { speed: 3, action: 'golpear', actionProgress: .22 / .58, movement: { grounded: true } });
  const hand = rightHand.getWorldPosition(new THREE.Vector3());
  const shoulder = rightArm.getWorldPosition(new THREE.Vector3());
  assert.ok(hand.z - shoulder.z > .3, 'el puño se extiende hacia delante al llegar el impacto');
  assert.deepEqual(group.position.toArray(), [0, 0, 0], 'ninguna pose desplaza la raíz física');
  for (const [source, original] of sources) assert.deepEqual(bonePose(source), original, 'el banco permanece intacto');
  const bones = new Set();
  group.traverse(object => { if (object.isBone) bones.add(object); });
  group.traverse(object => {
    if (object.isSkinnedMesh) assert.ok(object.skeleton.bones.every(bone => bones.has(bone)), 'ropa y cuerpo comparten huesos de esta instancia');
  });
  character.dispose();
});

test('el gancho izquierdo barre desde fuera y llega al frente con el codo abierto hacia su lado', async () => {
  for (const [sexo, edad, lod] of [['hombre', 'adulto', false], ['mujer', 'mayor', true]]) {
    const character = await createRealisticCharacter({ real: { sexo, edad } }, { andar: 'trote', lod });
    try {
      const dt = 1 / 60, { group } = character;
      const point = name => group.worldToLocal(joint(group, name).getWorldPosition(new THREE.Vector3()));
      const pose = (phase, progress) => {
        character.update(dt, { action: 'golpear', attack: { weapon: 'punos', step: 2, phase, progress }, movement: { grounded: true } });
        return point('LeftHandMiddle1').sub(point('Neck'));
      };
      for (let i = 0; i < 60; i++) character.update(dt, {});
      const load = pose('windup', .6);
      const hit = pose('active', 0);
      const elbow = point('LeftForeArm');
      const upper = point('LeftArm').sub(elbow), forearm = point('LeftHand').sub(elbow);
      const length = upper.length() + forearm.length();
      assert.ok(load.x - hit.x > length * .5, 'la mano parte desde el costado izquierdo');
      assert.ok(Math.abs(hit.x) < .16 * length && hit.z > .85 * length, 'los nudillos llegan delante del pecho');
      assert.ok(elbow.x - point('Neck').x > .35 * length, 'el codo queda fuera de la silueta del tronco');
      const angle = THREE.MathUtils.radToDeg(upper.angleTo(forearm));
      assert.ok(angle > 70 && angle < 110, `el arco conserva la flexión del codo: ${angle}°`);
    } finally { character.dispose(); }
  }
});
test('el cruzado coincide con el contacto a 30, 60 y 144 FPS y transfiere la guardia al cambiar de LOD', async t => {
  const look = { real: { sexo: 'mujer', edad: 'mayor', ropa: 'saco' } };
  const close = await createRealisticCharacter(look, { andar: 'trote' });
  const far = await createRealisticCharacter(look, { andar: 'trote', lod: true });
  t.after(() => { close.dispose(); far.dispose(); });
  const movement = { grounded: true };
  const punch = (id, phase, progress) => ({ action: 'golpear', attack: { id, weapon: 'punos', step: 1, phase, progress }, movement });
  const points = ['Spine2', 'RightArm', 'RightForeArm', 'RightHand', 'LeftForeArm'];
  const upper = figure => points.map(name => joint(figure.group, name).quaternion.clone().normalize());
  const same = (first, second) => first.every((q, i) => q.angleTo(second[i]) < .0001);
  const world = (figure, name) => joint(figure.group, name).getWorldPosition(new THREE.Vector3());
  const arm = (figure, side) => world(figure, side + 'HandMiddle1').sub(world(figure, 'Neck'));
  let reference;
  for (const fps of [30, 60, 144]) {
    for (let i = 0; i / fps < .12; i++) close.update(1 / fps, punch(fps, 'windup', i / fps / .12));
    close.update(0, punch(fps, 'windup', 1));
    const end = upper(close), feet = ['LeftToeBase', 'RightToeBase'].map(name => world(close, name));
    close.update(0, punch(fps, 'active', 0));
    const contact = upper(close);
    reference ??= contact;
    assert.ok(same(contact, reference) && same(contact, end), 'el contacto siempre muestrea el mismo cuadro del clip');
    assert.ok(arm(close, 'Right').z > .50 && arm(close, 'Right').y > -.03, 'los nudillos llegan al frente a la altura del cuello');
    for (let i = 0; i < 5; i++) close.update(0, punch(fps, 'active', 0));
    assert.ok(same(upper(close), contact), 'durante la pausa se mantiene la extensión');
    assert.ok(['LeftToeBase', 'RightToeBase'].every((name, i) => feet[i].distanceTo(world(close, name)) < 1e-7));
    close.update(0, punch(fps, 'recovery', 1));
    close.update(.25, { combatGuard: true, movement });
    for (const side of ['Left', 'Right']) assert.ok(arm(close, side).y > -.16, 'ambas manos siguen delante del pecho');
    far.applyMotion(close.motionState());
    far.update(0, { combatGuard: true, movement });
    assert.ok(same(upper(far), upper(close)), 'el modelo lejano sigue en la misma fase de la guardia');
    for (let i = 0; i < fps / 3; i++) close.update(1 / fps, { movement });
    for (const side of ['Left', 'Right']) assert.ok(arm(close, side).y < -.40, 'al terminar la ventana las manos vuelven al andar');
  }
});
test('solo la mano que golpea sin arma recoge los dedos y el pulgar hasta el contacto', async () => {
  const character = await createRealisticCharacter({ real: { sexo: 'mujer', edad: 'joven' } }, { andar: 'trote' });
  try {
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) character.update(dt, {});
    const pose = (step, phase, progress, weapon = 'punos') => {
      character.update(dt, { action: 'golpear', attack: { weapon, step, phase, progress }, movement: { grounded: true } });
    };
    for (const [side, other, step] of [['Left', 'Right', 0], ['Right', 'Left', 1], ['Left', 'Right', 2]]) {
      const jointOf = name => joint(character.group, name);
      const hand = jointOf(side + 'Hand'), knuckle = jointOf(side + 'HandMiddle1').position;
      const forward = knuckle.clone().normalize();
      const width = jointOf(side + 'HandIndex1').position.distanceTo(jointOf(side + 'HandPinky1').position);
      const digits = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'];
      const rotations = owner => digits.flatMap(digit => [1, 2, 3].map(i => jointOf(owner + 'Hand' + digit + i).quaternion.clone()));
      const match = (actual, expected) => actual.every((q, i) => Math.abs(q.dot(expected[i])) > .999999);
      pose(step, 'windup', 0);
      const open = rotations(side), guard = rotations(other);
      pose(step, 'windup', .6);
      const loaded = rotations(side);
      pose(step, 'active', 0);
      assert.ok(match(rotations(side), loaded), 'el puño ya se cerró antes de tocar');
      assert.ok(match(rotations(other), guard), 'la mano libre conserva el gesto del clip');
      for (const digit of digits) {
        const end = jointOf(side + 'Hand' + digit + '3');
        const tip = hand.worldToLocal(end.localToWorld(new THREE.Vector3(0, end.position.length() * .7, 0)));
        assert.ok(tip.clone().sub(knuckle).dot(forward) < 0, side + digit + ' queda detrás de los nudillos');
        assert.ok(tip.distanceTo(knuckle.clone().multiplyScalar(.6)) < width * (digit === 'Thumb' ? .95 : .70),
          side + digit + ' queda junto a la palma');
      }
      pose(step, 'recovery', 1);
      assert.ok(match(rotations(side), open), 'suelta la mano al terminar la recuperación');
      pose(step, 'active', 0);
      pose(0, 'active', 0, 'cuchillo');
      assert.ok(match(rotations(side), open), 'al cambiar de arma el agarre vuelve al del clip');
    }
  } finally { character.dispose(); }
});
test('las cinco yemas envuelven cada objeto en reposo y al contactar, y sueltan los dedos al desequiparlo', async t => {
  for (const [sexo, edad, lod] of [['hombre', 'adulto', false], ['mujer', 'mayor', true]]) {
    const character = await createRealisticCharacter({ real: { sexo, edad } }, { lod });
    t.after(() => character.dispose());
    const movement = { grounded: true };
    character.update(0, { movement });
    const digits = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    const fingers = digits.map(digit => [1, 2, 3].map(i => joint(character.group, 'RightHand' + digit + i)));
    const neutral = fingers.flat().map(bone => bone.quaternion.clone().normalize());
    for (const weapon of ['cuchillo', 'botella_picada', 'arma']) {
      character.setWeapon(weapon);
      const item = character.group.getObjectByName('weapon-' + weapon);
      const mesh = item.children[0], { index, attributes } = mesh.geometry;
      const triangle = new THREE.Triangle(), closest = new THREE.Vector3();
      for (const attack of [null, { weapon, step: 0, phase: 'active', progress: 0 }]) {
        character.update(0, { attack, movement });
        for (const chain of fingers) {
          const last = chain[2];
          const tip = mesh.worldToLocal(last.localToWorld(new THREE.Vector3(0, last.position.length() * .7, 0)));
          let gap = Infinity;
          for (let i = 0; i < (index?.count ?? attributes.position.count); i += 3) {
            triangle.a.fromBufferAttribute(attributes.position, index?.getX(i) ?? i);
            triangle.b.fromBufferAttribute(attributes.position, index?.getX(i + 1) ?? i + 1);
            triangle.c.fromBufferAttribute(attributes.position, index?.getX(i + 2) ?? i + 2);
            gap = Math.min(gap, triangle.closestPointToPoint(tip, closest).distanceTo(tip));
          }
          assert.ok(gap < .008, `${weapon} en ${sexo}, ${last.name}: yema a ${gap} m`);
        }
      }
      character.setWeapon(null);
      character.update(0, { movement });
      fingers.flat().forEach((bone, i) => {
        assert.ok(bone.quaternion.clone().normalize().angleTo(neutral[i]) < .0001, 'devuelve cada falange a su clip');
      });
    }
  }
});
test('las suelas vestidas conservan el piso al arrancar, correr y frenar en distintas fases', async () => {
  for (const [sexo, edad, calzado, lod, fps] of [['hombre', 'adulto', 'tenis', false, 60], ['mujer', 'mayor', 'botas', true, 30]]) {
    const character = await createRealisticCharacter({ real: { sexo, edad, calzado } }, { andar: 'trote', lod });
    try {
      const { group } = character, dt = 1 / fps;
      group.position.set(7, .6, -3);
      group.rotation.y = .7;
      const support = createSkinSupport(group, { bones: /(?:Foot|ToeBase)$/ });
      assert.ok(support.vertexCount > 0);
      const style = { limp: .75, sway: .7 };
      const stride = speed => {
        character.update(dt, { speed: speed / group.scale.z, running: speed > 3, style, movement: { grounded: true } });
        const sole = support.minimumY() * group.scale.y;
        assert.ok(sole >= -.0025, `${sexo}/${calzado}: planta a ${sole} m del piso`);
        return sole;
      };
      for (const phase of [.15, .45, .72]) {
        character.applyMotion({ ...character.motionState(), phase });
        let flight = 0;
        for (let i = 0; i < fps * 1.5; i++) flight = Math.max(flight, stride(Math.min(6, i * dt * 16)));
        assert.ok(flight > .06, 'la carrera conserva cuadros en los que despegan ambos pies');
        for (let i = 0; i < fps; i++) stride(Math.max(0, 6 - i * dt * 18));
        assert.ok(stride(0) < .025, 'en reposo apoya sin quedar suspendido');
      }
      assert.deepEqual(group.position.toArray(), [7, .6, -3]);
    } finally { character.dispose(); }
  }
});

test('nadar deja de caminar, vuelve a tierra y los NPC LOD muestran el golpe recibido', async () => {
  const character = await createRealisticCharacter();
  const hips = joint(character.group, 'Hips');
  character.update(.2, { speed: 0 });
  const standing = hips.quaternion.clone();
  for (let frame = 0; frame < 20; frame++) character.update(1 / 60, { speed: 2, movement: { swimming: true, waterDepth: 1.5, surfaceY: 1.05 } });
  assert.ok(hips.quaternion.angleTo(standing) > .7, 'el cuerpo se orienta para nadar');
  assert.ok(joint(character.group, 'Head').getWorldPosition(new THREE.Vector3()).y > 1.1, 'la cara queda sobre el agua al flotar los pies 1.05 m bajo la superficie');
  for (let frame = 0; frame < 60; frame++) character.update(1 / 60, { speed: 0, movement: { grounded: true } });
  assert.ok(hips.quaternion.angleTo(standing) < .15, 'no queda inclinación de agua al salir');
  const npc = await createRealisticCharacter({}, { lod: true });
  const chest = joint(npc.group, 'Spine2');
  npc.update(0, { speed: 0 });
  const before = chest.quaternion.clone();
  npc.update(0, { speed: 0, action: 'recibirGolpe', actionProgress: .2 });
  assert.ok(chest.quaternion.angleTo(before) > .2, 'la reacción funciona también en el modelo liviano');
  character.dispose(); npc.dispose();
});

test('en el esqueleto del peatón el cuello se aparta en el sentido del golpe mientras los brazos se protegen', async () => {
  const direcciones = [new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
  for (const completo of [false, true]) for (const dir of direcciones) {
    const npc = new Npc(new THREE.Scene(), new THREE.Vector3(), { look: {}, facing: 0 });
    await npc.ready;
    assert.ifError(npc.loadError);
    if (completo) await npc.preload();
    else npc.fullChar = npc.lodChar;
    npc.update(1 / 60);
    const cadera = joint(npc.character.group, 'Hips'), cuello = joint(npc.character.group, 'Neck');
    const brazo = joint(npc.character.group, 'RightArm'), guardia = brazo.quaternion.clone();
    const eje = () => cuello.getWorldPosition(new THREE.Vector3()).sub(cadera.getWorldPosition(new THREE.Vector3())).normalize();
    const recto = eje();
    npc.takeHit({ damage: 1, dir, knockback: 1.6 });
    for (let i = 0; i < 5; i++) npc.update(1 / 60);
    const cambio = eje().sub(recto.applyQuaternion(npc.root.quaternion)).setY(0);
    assert.ok(cambio.dot(dir) > .06 && cambio.normalize().dot(dir) > .9, `dirección ${dir.toArray()}, torso ${cambio.toArray()}`);
    assert.ok(brazo.quaternion.angleTo(guardia) > .15, 'el brazo conserva el gesto de protegerse');
    npc.dispose();
  }
});
for (const [postura, ejeEsperado, columnaEsperada, cabezaEsperada, cuerpoEsperado] of [
  ['sentado',      12.49, 13.34, 18.90, 0],
  ['acurrucado',   38.49, 28.03, 15.16, 0],
  ['pedir',        28.19,  5.82, 13.10, 0],
  ['banca',        12.12,  6.14, 11.13, 0],
  ['dormido',      89.71, 13.03,  7.40, 0],
  ['levantándose', 30.29, 22.09, 13.09, 0],
  [null,             .07,   .17,   .84, 4.31]
]) {
  test(`retroceso del peatón al recibir un golpe de frente, ${postura ?? 'de pie'}`, async t => {
    const paso = 1 / 60;
    const inicial = postura === 'levantándose' ? 'acurrucado' : postura;
    const npc = new Npc(new THREE.Scene(), new THREE.Vector3(), { look: {}, facing: 0, stance: inicial });
    t.after(() => npc.dispose());
    await npc.ready;
    assert.ifError(npc.loadError);
    npc.fullChar = npc.lodChar;
    // El juego arranca cada peatón en una fase distinta. Aquí todos parten del mismo reposo.
    const movimiento = npc.character.motionState();
    npc.character.applyMotion({ ...movimiento, phase: 0, poseTime: 0, times: { idle: 0 } });
    for (let cuadro = 0; cuadro < 90; cuadro++) npc.update(paso);
    if (postura === 'levantándose') {
      npc._stopCowering();
      for (let cuadro = 0; cuadro < 6; cuadro++) npc.update(paso);
      assert.equal(npc.stance, null);
      assert.ok(npc._riseLeft > 0, 'ya dejó la postura y sigue subiendo');
    }

    const grupo = npc.character.group;
    const cadera = joint(grupo, 'Hips'), cuello = joint(grupo, 'Neck');
    const columna = joint(grupo, 'Spine'), cabeza = joint(grupo, 'Head');
    const ejeDelTronco = () => {
      const base = grupo.worldToLocal(cadera.getWorldPosition(new THREE.Vector3()));
      return grupo.worldToLocal(cuello.getWorldPosition(new THREE.Vector3())).sub(base).normalize();
    };
    const medidas = [
      ['eje cadera-cuello', ejeDelTronco, ejeEsperado],
      ['columna', () => columna.quaternion, columnaEsperada],
      ['cabeza', () => cabeza.quaternion, cabezaEsperada],
      ['cuerpo entero', () => grupo.quaternion, cuerpoEsperado]
    ].map(([nombre, leer, esperado]) => ({ nombre, leer, esperado, reposo: leer().clone(), maximo: 0 }));

    npc.takeHit({ damage: 1, dir: { x: 0, z: -1 }, knockback: .9 });
    for (let cuadro = 0; cuadro < 28; cuadro++) {
      npc.update(paso);
      for (const medida of medidas) {
        const grados = THREE.MathUtils.radToDeg(medida.leer().angleTo(medida.reposo));
        medida.maximo = Math.max(medida.maximo, grados);
      }
    }
    for (const { nombre, maximo, esperado } of medidas) {
      assert.ok(Math.abs(maximo - esperado) < .1, `${nombre} llegó a ${maximo.toFixed(2)}°, se esperaban ${esperado}°`);
    }
  });
}
test('el personaje procedural recibe salto y nado con el mismo contrato de movimiento', () => {
  const character = createCharacter();
  character.group.scale.setScalar(CHARACTER_SCALE);
  character.update(.2, { speed: 0 });
  const before = character.ragdollRig.rightLeg.quaternion.clone();
  // En el ápice de un salto parado recoge las rodillas.
  character.update(.1, { speed: 0, action: 'saltar', movement: { grounded: false, verticalVelocity: 0, airTime: .28, launchSpeed: 5.45, groundGap: .78, timeToGround: .3 } });
  assert.ok(character.ragdollRig.rightLeg.quaternion.angleTo(before) > .5);
  for (let frame = 0; frame < 20; frame++) character.update(1 / 60, { speed: 2, movement: { swimming: true, surfaceY: 1.05 } });
  assert.ok(Math.abs(character.ragdollRig.hips.rotation.x) > .7);
  assert.ok(character.ragdollRig.head.getWorldPosition(new THREE.Vector3()).y > 1.1, 'el modelo liviano mantiene la cara sobre el agua');
  assert.deepEqual(character.group.position.toArray(), [0, 0, 0]);
});

test('modelo liviano: al caer corriendo de 5 m la cadera no salta a la altura de la carrera en el cuadro del contacto', () => {
  const input = { axis: { x: 0, z: 0 }, isRunning: true, consumePress: () => false };
  const player = new Player(new THREE.Scene(), input);
  assert.equal(player.modelKind, 'procedural');
  const rig = player.character.ragdollRig, ground = x => (x < 0 ? 5 : 0);
  player.position.set(-6.5, 5, 0); player.root.position.copy(player.position);
  // Quieto un momento (la pose mide dónde quedan los tobillos de pie) y después corre hacia el borde.
  for (let frame = 0; frame < 10; frame++) player.update(1 / 60, null, null, ground);
  input.axis.x = 1;
  const hip = () => rig.hips.getWorldPosition(new THREE.Vector3()).y - player.position.y;
  let before = null, knee = null, contact = null;
  for (let frame = 0; frame < 170 && contact === null; frame++) {
    const wasGrounded = player.isGrounded;
    player.update(1 / 60, null, null, ground);
    player.character.group.updateMatrixWorld(true);
    if (!wasGrounded && player.isGrounded && player.landingSpeed > 10) {
      contact = { drop: before - hip(), turn: rig.rightLeg.quaternion.angleTo(knee) * 180 / Math.PI };
    }
    before = hip(); knee = rig.rightLeg.quaternion.clone();
  }
  assert.ok(contact, 'llegó al suelo de abajo');
  assert.ok(contact.drop < .03, `en el cuadro del contacto la cadera baja ${(100 * contact.drop).toFixed(1)} cm`);
  assert.ok(contact.turn < 30, `y la rodilla gira ${contact.turn.toFixed(0)}° en ese cuadro`);
});

test('modelo liviano: en un golpe fuerte los tobillos quedan a la altura de pie aunque nunca haya estado quieto', () => {
  const ankles = still => {
    const input = { axis: { x: still ? 0 : 1, z: 0 }, isRunning: true, consumePress: () => false };
    const player = new Player(new THREE.Scene(), input), rig = player.character.ragdollRig, ground = x => (x < 0 ? 5 : 0);
    player.position.set(-6.5, 5, 0); player.root.position.copy(player.position);
    // Quieto, la pose mide dónde quedan los tobillos de pie; corriendo desde el primer cuadro, no.
    if (still) for (let frame = 0; frame < 10; frame++) player.update(1 / 60, null, null, ground);
    input.axis.x = 1;
    let after = -1;
    for (let frame = 0; frame < 240 && after < 8; frame++) {
      const wasGrounded = player.isGrounded;
      player.update(1 / 60, null, null, ground);
      if (after >= 0 || (!wasGrounded && player.isGrounded && player.landingSpeed > 10)) after++;
    }
    player.character.group.updateMatrixWorld(true);
    return Math.min(rig.leftFoot.getWorldPosition(new THREE.Vector3()).y, rig.rightFoot.getWorldPosition(new THREE.Vector3()).y);
  };
  const measured = ankles(true), unmeasured = ankles(false);
  assert.ok(Math.abs(unmeasured - measured) < .01, `tobillos a ${(100 * unmeasured).toFixed(1)} cm sin medir y a ${(100 * measured).toFixed(1)} cm medidos`);
});

test('en el modelo liviano calentarse sube las manos y echar a andar las baja', () => {
  const character = createCharacter();
  const arm = () => character.ragdollRig.rightArm.rotation.x;
  for (let frame = 0; frame < 30; frame++) character.update(1 / 60, { speed: 0, action: 'calentarse', actionProgress: .5 });
  const warming = arm();
  assert.ok(warming < -1, 'las manos van al frente');
  for (let frame = 0; frame < 30; frame++) character.update(1 / 60, { speed: 2, action: 'calentarse', actionProgress: .5 });
  assert.ok(Math.abs(arm()) < .7, 'andando los brazos vuelven a su balanceo');
  character.dispose();
});

test('la estatura corta personalizada mantiene cabeza fuera del agua sin elevar la raíz física', () => {
  const character = createCharacter({ estatura: .92 });
  for (let frame = 0; frame < 30; frame++) character.update(1 / 60, { speed: 2.6, movement: { swimming: true, surfaceY: 1.05 } });
  assert.ok(character.ragdollRig.head.getWorldPosition(new THREE.Vector3()).y > 1.1);
  assert.deepEqual(character.group.position.toArray(), [0, 0, 0]);
  for (let frame = 0; frame < 60; frame++) character.update(1 / 60, { speed: 0, movement: { grounded: true } });
  assert.ok(Math.abs(character.ragdollRig.hips.position.y - .52) < .01, 'al salir no queda elevación de la pelvis');
});

test('ambos modelos muestran armas y ocultan objetos ocupados al nadar', async () => {
  for (const character of [createCharacter(), await createRealisticCharacter()]) {
    character.setWeapon('cuchillo'); character.setSmoking(true); character.setBasuco(true);
    const knife = character.group.getObjectByName('weapon-cuchillo');
    const cigarette = character.group.getObjectByName('prop-cigarrillo');
    const pipe = character.group.getObjectByName('prop-pipa');
    assert.ok(knife && cigarette && pipe);
    character.update(.1, { action: 'basuco', basuco: 2 });
    assert.equal(pipe.visible, true); assert.equal(knife.visible, false); assert.equal(cigarette.visible, false);
    character.update(.1, { speed: 2, movement: { swimming: true, surfaceY: 1.05 }, basuco: 2, smoke: { puff: 1 } });
    for (const object of [knife, cigarette, pipe]) assert.equal(object.visible, false);
    character.update(.1, { speed: 0, movement: { grounded: true } });
    assert.equal(knife.visible, true);
    character.dispose();
  }
});

test('cambiar de ropa sosteniendo la pipa libera su geometría propia y conserva la compartida', async () => {
  const character = await createRealisticCharacter();
  character.setWeapon('cuchillo'); character.setSmoking(true); character.setBasuco(true);
  const own = new Set(), shared = new Set();
  for (const name of ['prop-pipa', 'prop-encendedor']) character.group.getObjectByName(name).traverse(object => { if (object.geometry) own.add(object.geometry); });
  for (const name of ['weapon-cuchillo', 'prop-cigarrillo']) character.group.getObjectByName(name).traverse(object => { if (object.geometry) shared.add(object.geometry); });
  let freed = 0, sharedFreed = 0;
  for (const geometry of own) geometry.addEventListener('dispose', () => freed++);
  for (const geometry of shared) geometry.addEventListener('dispose', () => sharedFreed++);
  await character.setLook({ piel: 3 });
  assert.equal(freed, own.size);
  assert.equal(sharedFreed, 0);
  assert.ok(character.group.getObjectByName('prop-pipa'), 'se vuelve a equipar sobre el cuerpo nuevo');
  character.dispose(); character.dispose();
  assert.equal(freed, own.size);
  assert.equal(sharedFreed, 0);
});

test('NPC LOD conserva arma y gesto de señalar; el golpe por fases llega al impacto', async () => {
  const npc = await createRealisticCharacter({}, { lod: true });
  npc.setWeapon('pistola');
  const arm = joint(npc.group, 'LeftArm');
  npc.update(0, {}); const original = arm.quaternion.clone();
  for (let frame = 0; frame < 30; frame++) npc.update(1 / 60, { point: 1 });
  assert.ok(arm.quaternion.angleTo(original) > .7);
  assert.ok(npc.group.getObjectByName('weapon-pistola'));
  npc.update(1 / 60, { action: 'golpear', actionProgress: .1, attack: { weapon: 'punos', step: 1, phase: 'active', progress: 0 } });
  const hand = joint(npc.group, 'RightHand').getWorldPosition(new THREE.Vector3());
  const shoulder = joint(npc.group, 'RightArm').getWorldPosition(new THREE.Vector3());
  assert.ok(hand.z - shoulder.z > .3, 'el impacto no espera el filtro de suavizado');
  npc.dispose();
});

test('las acciones cortas del cuerpo real conservan la fase y pueden repetirse sin mover el jugador', async () => {
  const character = await createRealisticCharacter();
  const hand = joint(character.group, 'RightHand');
  for (const action of ['comer', 'beber', 'lanzar']) {
    for (let frame = 0; frame < 120; frame++) character.update(1 / 60, { action, actionProgress: .4 });
    const atPhase = hand.getWorldPosition(new THREE.Vector3());
    for (let frame = 0; frame < 180; frame++) character.update(1 / 60, { action, actionProgress: .4 });
    assert.ok(hand.getWorldPosition(new THREE.Vector3()).distanceTo(atPhase) < .001,
      `${action}: la mano no avanza por otro reloj después de alcanzar su fase`);
    character.update(1 / 60, { action, actionProgress: .95 });
    const finished = hand.getWorldPosition(new THREE.Vector3());
    character.update(1 / 60, { action, actionProgress: .1 });
    assert.ok(hand.getWorldPosition(new THREE.Vector3()).distanceTo(finished) > .01,
      `${action}: repetir la acción no deja el último fotograma congelado`);
    assert.deepEqual(character.group.position.toArray(), [0, 0, 0]);
  }
  character.dispose();
});

test('los dos modelos del peatón conservan la zancada mientras se asienta y vuelve a andar', async t => {
  const scene = new THREE.Scene();
  const npc = new Npc(scene, new THREE.Vector3(), { arquetipo: 'oficinista', facing: 0, speed: 1.25, wander: 5 });
  t.after(() => npc.dispose());
  npc.wait = 10;
  await npc.preload();
  const dt = 1 / 60, player = new THREE.Vector3();
  const walk = () => { npc.target = npc.position.clone().add(new THREE.Vector3(0, 0, 4)); };
  const tick = (frames, distance) => {
    for (let i = 0; i < frames; i++) {
      player.copy(npc.position).z += distance;
      npc.update(dt, { player });
    }
    return npc.character.motionState();
  };
  tick(30, 12);
  walk();
  const walking = tick(42, 12);
  assert.equal(npc.character, npc.lodChar);
  assert.ok(walking.weights.locomocion > .99);
  npc.target = null;
  const beforeStop = npc.position.clone();
  const braking = tick(3, 12);
  const full = tick(1, 3);
  assert.equal(npc.character, npc.fullChar);
  assert.ok(full.weights.locomocion < braking.weights.locomocion && full.weights.locomocion > .4);
  const advance = (from, to) => (to.phase - from.phase + 1) % 1;
  assert.ok(advance(walking, braking) > .015, 'la zancada termina de asentarse al parar');
  assert.ok(advance(braking, full) > 0 && advance(braking, full) < .022, 'el modelo nuevo toma la fase y la transición del anterior');

  walk();
  const firstStep = tick(1, 3);
  assert.ok(firstStep.weights.locomocion > 0 && firstStep.weights.locomocion < .85);
  assert.ok(advance(full, firstStep) > 0 && advance(full, firstStep) < .05);
  assert.ok(Math.abs(npc.position.distanceTo(beforeStop) - 1.25 * dt) < 1e-8, 'la ruta reanuda de inmediato');
  assert.ok(npc.root.position.equals(npc.position));
  assert.ok(tick(24, 3).weights.locomocion > .99);
});

test('lejos lo transparente va en una pasada; de cerca barbas y cejas conservan las dos', async () => {
  const transparent = character => {
    const materials = [];
    character.group.traverse(mesh => { if (mesh.isMesh && mesh.material.transparent) materials.push(mesh.material); });
    return materials;
  };
  const look = { barba: 'media' };
  const far = await createRealisticCharacter(look, { lod: true }), close = await createRealisticCharacter(look);
  assert.ok(transparent(far).length > 0 && transparent(far).every(material => material.forceSinglePass));
  assert.ok(transparent(close).length > 0 && transparent(close).every(material => !material.forceSinglePass), 'no se contagia al modelo completo');
  far.dispose(); close.dispose();
});
