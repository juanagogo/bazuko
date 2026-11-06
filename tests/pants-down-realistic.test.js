// tests/pants-down-realistic.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createRealisticCharacter } from '../src/character/RealisticCharacter.js';
import { bakeStances, STANCE_NAMES } from '../src/character/stances.js';
import { fakeCompile, mockRealisticModels } from './helpers/realistic-models.js';

mockRealisticModels(test);

const DOWN = { drop: .5, censor: true, block: 9, seed: 3.7 };
const bodyOf = character => {
  let body = null;
  character.group.traverse(o => { if (o.isSkinnedMesh && o.geometry.attributes.pdRestored) body = o; });
  return body;
};
const keys = character => {
  const out = [];
  character.group.traverse(o => { if (o.isMesh && o.material?.customProgramCacheKey) out.push(o.material.customProgramCacheKey()); });
  return out;
};

test('el jugador realista trae pantalón y censurado listos y los NPC no', async () => {
  const player = await createRealisticCharacter({}, { undress: true });
  const npc = await createRealisticCharacter({});
  const body = bodyOf(player);
  assert.ok(body, 'el cuerpo del jugador sabe qué piel estaba tapada');
  assert.match(body.material.customProgramCacheKey(), /pantalon-piel:v1/);
  assert.match(body.material.customProgramCacheKey(), /censor:v1:rest/);
  assert.ok(player.undress.garmentMeshes.length > 0);
  for (const { mesh } of player.undress.garmentMeshes) assert.match(mesh.material.customProgramCacheKey(), /pantalon:v1/);
  assert.equal(npc.undress, null);
  assert.ok(!keys(npc).some(key => /censor|pantalon/.test(key)), 'los NPC no cambian de programa');
  assert.doesNotThrow(() => npc.setUndress(DOWN));
  const shader = fakeCompile(player.undress.garmentMeshes[0].mesh.material);
  assert.match(shader.vertexShader, /pdWeight/, 'el pantalón doblado se ata al muslo');
  assert.doesNotMatch(shader.vertexShader.split('pdFold')[1] ?? '', /getBoneMatrix\( skinIndex/);
  player.dispose(); npc.dispose();
});

test('al bajar el pantalón vuelve la piel tapada de la cadera y los muslos', async () => {
  const player = await createRealisticCharacter({}, { undress: true });
  const body = bodyOf(player);
  const dressed = body.geometry.index.count;
  player.setUndress(DOWN);
  assert.ok(body.geometry.index.count > dressed, 'aparece piel que estaba oculta');
  player.setUndress({ ...DOWN, drop: 0 });
  assert.equal(body.geometry.index.count, dressed);
  player.setUndress(DOWN);
  player.setUndress(null);
  assert.equal(body.geometry.index.count, dressed, 'vestido otra vez, exactamente como antes');
  player.dispose();
});

test('el pantalón baja por uniforme y el censurado se prende', async () => {
  const player = await createRealisticCharacter({}, { undress: true });
  player.setUndress(DOWN);
  const { uniforms, lowerTop, kneeY, hipY } = player.undress;
  assert.equal(uniforms.uPantsDrop.value, .5);
  assert.equal(uniforms.uCensor.value, 1);
  assert.equal(uniforms.uCensorBlock.value, 9);
  assert.equal(uniforms.uCensorSeed.value, 3.7);
  assert.ok(kneeY < hipY && hipY < lowerTop, `rodilla ${kneeY.toFixed(2)} < cadera ${hipY.toFixed(2)} < pretina ${lowerTop.toFixed(2)}`);
  const [u, v] = uniforms.uCensorUv.value.toArray();
  assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1 && !(u === .5 && v === .5), 'el tono sale de la piel de la cadera en la textura');
  player.setUndress(null);
  assert.equal(uniforms.uPantsDrop.value, 0);
  assert.equal(uniforms.uCensor.value, 0);
  player.dispose();
});

test('con rota o saco también baja el cargo_pants aparte', async () => {
  for (const ropa of ['rota', 'saco']) {
    const player = await createRealisticCharacter({ real: { ropa } }, { undress: true });
    const cargo = player.undress.garmentMeshes.find(item => /cargo_pants/.test(item.mesh.name));
    assert.ok(cargo, ropa);
    assert.equal(cargo.under, true);
    assert.match(cargo.mesh.material.customProgramCacheKey(), /pantalon:v1/);
    player.dispose();
  }
});

test('cambiar de apariencia con el pantalón abajo reconstruye con el mismo estado', async () => {
  const player = await createRealisticCharacter({}, { undress: true });
  player.setUndress({ ...DOWN, drop: 1 });
  await player.setLook({ real: { ropa: 'camisa' } });
  const body = bodyOf(player);
  assert.equal(body.geometry.index, player.undress.openIndex, 'la piel sigue a la vista con la ropa nueva');
  assert.equal(player.undress.uniforms.uPantsDrop.value, 1);
  player.setUndress(null);
  assert.equal(body.geometry.index, player.undress.coveredIndex);
  player.dispose();
});

test('pretina y pantalon-rodillas se hornean con las manos más abajo en la segunda', async () => {
  assert.ok(STANCE_NAMES.includes('pretina') && STANCE_NAMES.includes('pantalon-rodillas'));
  const gltf = await new GLTFLoader().loadAsync('/models/personaje/hombre-adulto/cuerpo.gltf');
  const { stances } = bakeStances(gltf.scene);
  const handY = name => {
    const scene = clone(gltf.scene);
    const bones = new Map();
    scene.traverse(o => { if (o.isBone) bones.set(o.name, o); });
    for (const entry of stances.get(name).entries) bones.get(entry.boneName)?.quaternion.copy(entry.quaternion);
    scene.updateMatrixWorld(true);
    const hand = [...bones.values()].find(b => b.name.endsWith('LeftHand'));
    return hand.getWorldPosition(new THREE.Vector3()).y;
  };
  const waist = handY('pretina'), knees = handY('pantalon-rodillas');
  assert.ok(knees < waist - .1, `manos en la pretina a ${waist.toFixed(2)} y en las rodillas a ${knees.toFixed(2)}`);
  assert.ok(stances.get('pantalon-rodillas').entries.some(e => /Spine/.test(e.boneName)), 'se inclina el tronco');
});

test('al bajarse el realista se inclina sobre la pose de pie y baja las manos', async () => {
  const measure = async stance => {
    const character = await createRealisticCharacter({}, { undress: true });
    for (let i = 0; i < 90; i++) character.update(1 / 60, { action: 'bajarse', stance, actionProgress: .5 });
    character.group.updateMatrixWorld(true);
    const at = suffix => { let bone; character.group.traverse(o => { if (o.isBone && o.name.endsWith(suffix)) bone = o; }); return bone.getWorldPosition(new THREE.Vector3()); };
    const result = { forward: at('Head').z - at('Hips').z, hand: at('LeftHand').y };
    character.dispose();
    return result;
  };
  const standing = await measure(null), bent = await measure('pantalon-rodillas');
  assert.ok(bent.forward > standing.forward + .2, `la cabeza avanza ${(bent.forward - standing.forward).toFixed(2)} m`);
  assert.ok(bent.hand < standing.hand - .08, `las manos bajan ${(standing.hand - bent.hand).toFixed(2)} m`);
});
