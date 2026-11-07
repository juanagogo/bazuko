// El peatón que se queda grabando o llamando arranca después tomando el paso, como desde cualquier parada.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';

const character = () => ({
  group: new THREE.Group(), holds: [],
  update(dt, params) { this.last = params; }, snapPose() {}, hold() { return true; }, setSmoking() {}, dispose() {}
});
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => character(), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
const { Npc } = await import('../src/entities/Npc.js');

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = { getElementById() { return null; }, createElement() { return { style: {}, remove() {} }; }, body: { appendChild() {} } };
});

async function person(at = [10, 0, 2]) {
  const row = Array.from({ length: 40 }, (_, x) => (x === 20 ? 'road' : 'sidewalk'));
  const navigation = new PedestrianNavigation([row, row, row], 2, { isCrossing: x => x === 20 });
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(...at), {
    arquetipo: 'oficinista', navigation, facing: Math.PI / 2, groundHeight: () => 0,
    isWalkable: (x, z) => navigation.isWalkableAt(x, z) || Math.hypot(x - at[0], z - at[2]) < 2
  });
  await npc.ready;
  npc.fullChar = character();
  return npc;
}

const ahead = npc => {
  npc.target = new THREE.Vector3(npc.position.x + 20, 0, npc.position.z);
  npc.route = []; npc.wait = 0; npc.stance = null; npc.action = null;
};

for (const mode of ['grabar', 'llamar']) {
  test(`después de ${mode} un robo arranca tomando el paso, no a toda marcha`, async () => {
    const npc = await person();
    npc.root.rotation.y = Math.PI / 2; // de cara a +X
    ahead(npc);
    const ctx = () => ({ player: npc.position.clone().add(new THREE.Vector3(6, 0, 0)) }); // cerca y de frente
    for (let i = 0; i < 30; i++) npc.update(.05, ctx());
    assert.equal(npc._stride, 1, 'iba a paso completo');
    assert.equal(npc.witness(mode, 1), true);
    ahead(npc); // al terminar sigue derecho
    const speeds = [];
    for (let i = 0; i < 40; i++) {
      const before = npc.position.clone();
      npc.update(.05, ctx());
      if (!npc.witnessing) speeds.push(npc.position.distanceTo(before) / .05);
    }
    const first = speeds.findIndex(v => v > 1e-6);
    assert.ok(first >= 0, 'volvió a caminar');
    assert.ok(speeds[first] < npc.walkSpeed * .2, `primer paso a ${speeds[first].toFixed(2)} m/s (camina a ${npc.walkSpeed.toFixed(2)})`);
    npc.dispose();
  });
}
