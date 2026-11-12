// tests/pants-down-light.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createCharacter, DEFAULT_LOOK } from '../src/character/character.js';

const DOWN = { drop: 1, censor: true, block: 8, seed: 0 };
const visible = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
const countMeshes = character => { let n = 0; character.group.traverse(o => { if (o.isMesh) n++; }); return n; };

function dressed(parts) {
  assert.equal(visible(parts.hipBand), true, 'la pretina se ve');
  for (const slot of parts.legSlots) for (const child of slot.upper.children) assert.equal(visible(child), true, 'el pantalón del muslo se ve');
  for (const sleeve of parts.sleeves) assert.equal(sleeve.visible, false);
  for (const ring of parts.rings) assert.equal(ring.visible, false);
  assert.equal(parts.uniforms.uCensor.value, 0);
}

test('sin bajarse, el personaje liviano se ve igual que antes', () => {
  const character = createCharacter(DEFAULT_LOOK, { undress: true });
  dressed(character.undress.parts);
});

test('al bajar, cadera y muslos muestran piel censurada y el pantalón queda en las rodillas', () => {
  const character = createCharacter(DEFAULT_LOOK, { undress: true });
  character.setUndress(DOWN);
  const parts = character.undress.parts;
  assert.equal(visible(parts.hipBand), false);
  for (const slot of parts.legSlots) for (const child of slot.upper.children) assert.equal(visible(child), false);
  assert.ok(parts.thighs.every(visible) && visible(parts.pelvis), 'la piel queda a la vista');
  for (const ring of parts.rings) assert.equal(ring.visible, true);
  for (const sleeve of parts.sleeves) assert.ok(sleeve.scale.y < .01, 'la manga se recoge en la rodilla');
  assert.equal(parts.uniforms.uCensor.value, 1);
  assert.equal(parts.uniforms.uCensorBlock.value, 8);
  character.setUndress({ ...DOWN, drop: .5, censor: true });
  for (const sleeve of parts.sleeves) assert.ok(sleeve.scale.y > .05, 'a media bajada la manga cubre parte del muslo');
});

test('setUndress(null) deja la ropa como estaba', () => {
  const character = createCharacter(DEFAULT_LOOK, { undress: true });
  character.setUndress(DOWN);
  character.setUndress(null);
  dressed(character.undress.parts);
});

test('cambiar de look con el pantalón abajo reconstruye con el mismo estado', () => {
  const character = createCharacter(DEFAULT_LOOK, { undress: true });
  character.setUndress(DOWN);
  character.setLook({ ...DEFAULT_LOOK, abajo: 'sudadera', contextura: 'robusto' });
  const parts = character.undress.parts;
  assert.equal(visible(parts.hipBand), false, 'la pretina nueva también queda abajo');
  for (const slot of parts.legSlots) for (const child of slot.upper.children) assert.equal(visible(child), false);
  character.setUndress(null);
  dressed(character.undress.parts);
});

test('en pantaloneta también baja', () => {
  const character = createCharacter({ ...DEFAULT_LOOK, abajo: 'pantaloneta' }, { undress: true });
  character.setUndress(DOWN);
  const parts = character.undress.parts;
  assert.equal(visible(parts.hipBand), false);
  for (const ring of parts.rings) assert.equal(ring.visible, true);
});

test('bajarse lleva las manos de la cintura a las rodillas', () => {
  const handHeight = drop => {
    const character = createCharacter(DEFAULT_LOOK, { undress: true });
    character.setUndress({ drop, censor: drop > .08, block: 8, seed: 0 });
    for (let i = 0; i < 90; i++) character.update(1 / 60, { action: 'bajarse', t: i / 60 });
    character.group.updateMatrixWorld(true);
    return character.ragdollRig.leftForeArm.localToWorld(new THREE.Vector3(0, -.2, 0)).y;
  };
  const up = handHeight(0), down = handHeight(1);
  assert.ok(down < up - .05, `manos a ${up.toFixed(2)} m y luego a ${down.toFixed(2)} m`);
});

test('los NPC livianos no traen nada de esto', () => {
  const npc = createCharacter(DEFAULT_LOOK);
  const player = createCharacter(DEFAULT_LOOK, { undress: true });
  assert.equal(npc.undress, null);
  assert.doesNotThrow(() => npc.setUndress(DOWN));
  assert.ok(countMeshes(player) > countMeshes(npc));
  let censored = false;
  npc.group.traverse(o => { if (o.material?.customProgramCacheKey?.().includes('censor')) censored = true; });
  assert.equal(censored, false);
});
