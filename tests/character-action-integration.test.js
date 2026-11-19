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
