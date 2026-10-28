import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PUNCH } from '../src/data/combat.js';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';

// Las reacciones y la navegación son reales; solo se sustituye la carga de los modelos.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), frames: [],
    update(dt, state) { this.frames.push(state); } }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { Npc, NPC_COMBAT } = await import('../src/entities/Npc.js');

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { style: {}, textContent: '', remove() { this.removed = true; } }; },
    body: { appendChild() {} }
  };
});

async function fixture(temperament, options = {}) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(), { look: {}, speed: 1, temperament, ...options });
  await npc.ready;
  npc.fullChar = npc.character;
  npc.character.frames.length = 0;
  const hits = [];
  const attacker = { position: new THREE.Vector3(-1, 0, 0),
    receivePunch(source, damage) { hits.push({ source, damage }); return true; } };
  return { npc, attacker, hits };
}

function advance(npc, duration, context = {}) {
  for (let remaining = duration; remaining > 1e-8; remaining -= 0.05) {
    npc.update(Math.min(0.05, remaining), context);
  }
}

test('el evasivo acusa el golpe, corre realmente y vuelve a la navegación', async () => {
  const nav = new PedestrianNavigation([Array(18).fill('sidewalk')], 2);
  const { npc, attacker } = await fixture('evasivo', {
    navigation: nav, isWalkable: (x, z) => nav.isWalkableAt(x, z)
  });
  npc.takePunch(attacker);
  advance(npc, 0.2);
  assert.equal(npc.character.frames.at(-1).action, 'recibirGolpe');
  assert.deepEqual(npc.position.toArray(), [0, 0, 0]);

  advance(npc, 1);
  assert.equal(npc.combatReaction.phase, 'flee');
  assert.ok(npc.position.x > 1.4, 'Se aleja del atacante en vez de limitarse al mensaje');
  assert.equal(npc.character.frames.at(-1).running, true);
  assert.ok(npc.character.frames.at(-1).speed > npc.walkSpeed);
  advance(npc, NPC_COMBAT.fleeDuration + 1);
  assert.equal(npc.combatReaction, null);
  assert.equal(npc.fleeTimer, 0);
  assert.ok(nav.isWalkableAt(npc.position.x, npc.position.z));
  assert.ok(npc.target || npc.route.length > 0, 'Retoma sus recorridos normales');
  npc.dispose();
});

test('la huida comprueba el trayecto y rodea un muro sin atravesarlo', async () => {
  const walkable = (x, z) => !(x > 0.35 && x < 0.65) && Math.abs(z) < 10;
  const { npc, attacker } = await fixture('evasivo', { isWalkable: walkable });
  npc.takePunch(attacker);
  advance(npc, NPC_COMBAT.impactDuration + 0.05);
  for (let i = 0; i < 5; i++) {
    npc.update(0.5);
    assert.ok(npc.position.x <= 0.35, 'No salta al otro lado del muro aunque el paso sea largo');
    assert.ok(walkable(npc.position.x, npc.position.z));
  }
  assert.ok(Math.abs(npc.position.z) > 0.5, 'Busca una dirección lateral transitable');
  npc.dispose();
});

test('el defensivo se planta y responde una sola vez, al llegar la mano al impacto', async () => {
  const { npc, attacker, hits } = await fixture('defensivo');
  npc.takePunch(attacker);
  advance(npc, NPC_COMBAT.impactDuration + 0.1);
  assert.equal(npc.combatReaction.phase, 'guard');
  assert.equal(npc.character.frames.at(-1).action, 'defender');
  assert.deepEqual(npc.position.toArray(), [0, 0, 0]);
  for (let i = 0; i < 20 && npc.combatReaction.phase !== 'counter'; i++) npc.update(0.05);
  assert.equal(npc.combatReaction.phase, 'counter');
  assert.equal(npc.character.frames.at(-1).action, 'golpear');
  assert.equal(hits.length, 0);
  advance(npc, PUNCH.impactTime - 0.02);
  assert.equal(hits.length, 0, 'No hace daño durante la preparación');
  advance(npc, 0.04);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, npc);
  assert.equal(hits[0].damage, NPC_COMBAT.counterDamage);
  advance(npc, 4);
  assert.equal(hits.length, 1, 'No encadena contraataques ni persigue al jugador');
  assert.equal(npc.combatReaction, null);
  assert.deepEqual(npc.position.toArray(), [0, 0, 0]);
  npc.dispose();
});

test('alejarse o subir de altura durante la respuesta evita el impacto', async () => {
  for (const destination of [new THREE.Vector3(-5, 0, 0), new THREE.Vector3(-1, 7.82, 0)]) {
    const { npc, attacker, hits } = await fixture('defensivo');
    npc.takePunch(attacker);
    for (let i = 0; i < 40 && npc.combatReaction.phase !== 'counter'; i++) npc.update(0.05);
    assert.equal(npc.combatReaction.phase, 'counter');
    attacker.position.copy(destination);
    advance(npc, 4);
    assert.equal(hits.length, 0);
    assert.equal(npc.combatReaction, null);
    npc.dispose();
  }
});

test('el defensivo no responde a través de una pared', async () => {
  const { npc, attacker, hits } = await fixture('defensivo', {
    isWalkable: (x) => !(x > -0.7 && x < -0.3)
  });
  npc.takePunch(attacker);
  advance(npc, 4);
  assert.equal(hits.length, 0);
  assert.equal(npc.combatReaction, null);
  npc.dispose();
});

test('el inmóvil se cubre, mantiene su lugar y después retoma su recorrido', async () => {
  const nav = new PedestrianNavigation([Array(12).fill('sidewalk')], 2);
  const { npc, attacker } = await fixture('inmovil', {
    navigation: nav, isWalkable: (x, z) => nav.isWalkableAt(x, z)
  });
  npc.takePunch(attacker);
  advance(npc, 2);
  assert.equal(npc.combatReaction.phase, 'freeze');
  assert.equal(npc.character.frames.at(-1).action, 'asustado');
  assert.deepEqual(npc.position.toArray(), [0, 0, 0]);
  advance(npc, NPC_COMBAT.freezeDuration + 2);
  assert.equal(npc.combatReaction, null);
  assert.ok(npc.position.x > 0.2);
  npc.dispose();
});

test('la personalidad se mantiene y las monedas no se regeneran al repetir golpes', async () => {
  for (const temperament of ['evasivo', 'defensivo', 'inmovil']) {
    const { npc, attacker } = await fixture(temperament);
    const firstDrop = npc.takePunch(attacker);
    assert.equal(firstDrop > 0, temperament === 'evasivo');
    for (let i = 0; i < 6; i++) {
      assert.equal(npc.takePunch(attacker), 0);
      assert.equal(npc.temperament, temperament);
    }
    advance(npc, 7);
    assert.equal(npc.takePunch(attacker), 0);
    npc.dispose();
  }
});

test('la charla ambiental no reemplaza la reacción y su burbuja vence fuera de cámara', async () => {
  const { npc, attacker } = await fixture('inmovil');
  npc.takePunch(attacker);
  const bubble = npc._bubbleEl;
  advance(npc, 0.5, { player: attacker.position });
  assert.equal(npc._bubbleEl, bubble);
  advance(npc, 4, { player: attacker.position, frustum: { intersectsSphere: () => false } });
  assert.equal(npc._bubbleEl, null);
  assert.equal(bubble.removed, true);
  npc.dispose();
});

test('el proyectil sustituye la guardia y conserva la huida con carrera', async () => {
  const { npc, attacker, hits } = await fixture('defensivo');
  npc.takePunch(attacker);
  advance(npc, 0.6);
  npc.hitByPoop(attacker.position);
  npc.update(0.05);
  assert.equal(npc.combatReaction, null);
  assert.equal(npc.isSplatted, true);
  assert.ok(npc.fleeTimer > 7);
  assert.equal(npc.character.frames.at(-1).running, true);
  assert.equal(hits.length, 0);
  npc.dispose();
});
