import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

const character = () => ({ group: new THREE.Group(), update(dt, params) { this.last = params; }, dispose() {} });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => character(), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1
} });
const { Npc, CAR_KNOCKDOWN_SPEED } = await import('../src/entities/Npc.js');

let toasts;
beforeEach(() => {
  globalThis.window = new EventTarget();
  toasts = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
  globalThis.document = { getElementById() { return null; }, createElement() { return { style: {}, remove() {} }; }, body: { appendChild() {} } };
});

async function npcAt(x = 0, z = 0) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(x, 0, z), { isWalkable: () => true, groundHeight: () => 0 });
  await npc.ready;
  npc.fullChar = npc.lodChar;
  return npc;
}
const tick = (npc, time, ctx = {}) => { for (let t = 0; t < time - 1e-8; t += .01) npc.update(.01, ctx); };

test('un carro rápido tira al peatón al piso hacia donde avanza el carro, sin mancha de popó', async () => {
  const npc = await npcAt(0, 0);
  assert.equal(npc.hitByCar({ x: 0, z: -1 }, CAR_KNOCKDOWN_SPEED + 3, { x: 1, z: 0 }), true);
  assert.ok(npc.koState, 'quedó en el piso');
  assert.equal(npc.isSplatted, false);
  assert.equal(npc.splatMesh ?? null, null);
  tick(npc, .6);
  assert.ok(npc.position.x > .3, `salió despedido hacia el avance del carro (${npc.position.x.toFixed(2)})`);
  assert.ok(toasts.some(t => /ATROPELL|CARRO|MANEJA|MATA/.test(t)));
  assert.equal(npc.hitByCar({ x: 0, z: 0 }, 10), false, 'en el piso no lo vuelve a tumbar');
});

test('un carro despacio lo empuja, trastabilla y sale huyendo de pie', async () => {
  const npc = await npcAt(0, 0);
  npc.hitByCar({ x: 0, z: -1 }, 3.5, { x: 0, z: 1 });
  assert.equal(npc.koState ?? null, null);
  assert.equal(npc.action, 'recibirGolpe');
  assert.ok(npc.fleeTimer > 0);
  tick(npc, 1.5);
  assert.ok(npc.position.z > .5, `se alejó del carro (${npc.position.z.toFixed(2)})`);
});

