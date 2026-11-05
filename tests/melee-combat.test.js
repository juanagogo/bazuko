import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { MeleeCombat, MELEE_ATTACK } from '../src/systems/MeleeCombat.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

// Solo la carga GLB se sustituye: reaccion, desplazamiento y LOD del NPC son reales.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({
    group: new THREE.Group(), frames: [],
    update(dt, state) { this.frames.push({ dt, ...state }); }, dispose() {}
  }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
const { Npc, NPC_HIT_REACTION_DURATION } = await import('../src/entities/Npc.js');

function attacker() {
  const audio = { swings: 0, hits: 0, playWhoosh() { this.swings++; }, playPunchHit() { this.hits++; } };
  return { position: new THREE.Vector3(), root: new THREE.Group(), audio, isGrounded: true, stats: { dinero: 1000 } };
}

function target(x = 0, y = 0, z = 1, reward = 300) {
  return { position: new THREE.Vector3(x, y, z), hits: 0, takePunch() { this.hits++; return reward; } };
}

function contact(combat, player, npcs) {
  assert.equal(combat.start(player), true);
  return combat.update(MELEE_ATTACK.impact, player, npcs);
}

test('el golpe anticipa, conecta al terminar windup y solo entrega un contacto durante la recuperacion', () => {
  const player = attacker(), npc = target(), combat = new MeleeCombat();
  assert.equal(combat.start(player), true);
  assert.equal(player.audio.swings, 1);
  assert.equal(npc.hits, 0);
  assert.equal(combat.phase, 'windup');
  assert.equal(combat.update(MELEE_ATTACK.impact - .02, player, [npc]), null);
  assert.equal(combat.update(.01, player, [npc]), null);
  assert.equal(combat.phase, 'windup');
  assert.equal(npc.hits, 0, 'no hay daño antes de extender el brazo');
  const result = combat.update(.01, player, [npc]);
  assert.deepEqual(result, { target: npc, reward: 300, hits: [{ target: npc, reward: 300 }] });
  assert.equal(combat.phase, 'active');
  assert.equal(player.audio.hits, 1);
  assert.equal(player.stats.dinero, 1000, 'el controlador devuelve la recompensa y Player la acredita');
  for (let i = 0; i < 40; i++) assert.equal(combat.update(.01, player, [npc]), null);
  assert.equal(npc.hits, 1);
  assert.equal(combat.active, false);
  assert.equal(combat.progress, 1);
});

test('el enfriamiento bloquea spam incluso tras terminar o cancelar el movimiento', () => {
  const player = attacker(), combat = new MeleeCombat();
  assert.equal(combat.start(player), true);
  assert.equal(combat.start(player), false);
  combat.update(MELEE_ATTACK.duration, player);
  assert.equal(combat.active, false);
  combat.cancel(); // cancelar también borra la ventana legítima de continuación
  assert.equal(combat.start(player), false);
  combat.update(MELEE_ATTACK.cooldown - MELEE_ATTACK.duration, player);
  assert.equal(combat.start(player), true);
  combat.cancel();
  assert.equal(combat.start(player), false, 'cancelar no elimina el enfriamiento');
  combat.update(MELEE_ATTACK.cooldown, player);
  assert.equal(combat.start(player), true);
  assert.equal(player.audio.swings, 3);
});

test('la pausa no avanza el impacto y una caida cancela un golpe pendiente', () => {
  const player = attacker(), npc = target(), combat = new MeleeCombat();
  combat.start(player);
  for (let i = 0; i < 30; i++) assert.equal(combat.update(0, player, [npc]), null);
  assert.equal(combat.progress, 0);
  assert.equal(combat.cooldownRemaining, MELEE_ATTACK.cooldown);
  player.isStunned = true;
  assert.equal(combat.update(.3, player, [npc]), null);
  assert.equal(combat.active, false);
  assert.equal(npc.hits, 0);
});

test('solo conecta el peaton frontal mas cercano, independientemente del orden del array', () => {
  const player = attacker(), combat = new MeleeCombat();
  const behind = target(0, 0, -.3), side = target(.4, 0, 0), far = target(0, 0, 1.6), near = target(0, 0, .9);
  const result = contact(combat, player, [behind, side, far, near]);
  assert.equal(result.target, near);
  assert.deepEqual([behind.hits, side.hits, far.hits, near.hits], [0, 0, 0, 1]);
});

test('alcance, direccion y altura se comprueban en el instante de contacto', () => {
  const player = attacker(), npc = target(), combat = new MeleeCombat();
  combat.start(player);
  combat.update(.1, player, [npc]);
  npc.position.z = 3;
  assert.equal(combat.update(.12, player, [npc]), null, 'alejarse durante la anticipacion evita el golpe');
  assert.equal(npc.hits, 0);
  const above = target(0, 7.82, 1), below = target(0, -7.82, 1), distant = target(0, 0, 2);
  assert.equal(contact(new MeleeCombat(), player, [above, below, distant]), null);
  player.root.rotation.y = Math.PI;
  assert.equal(contact(new MeleeCombat(), player, [target()]), null);
  assert.equal(new MeleeCombat().start({ ...player, isGrounded: false }), false);
});

test('las paredes y vehiculos bloquean el golpe, pero un suelo o tablero encima no lo bloquean', () => {
  const player = attacker(), npc = target();
  const collisions = new CollisionSystem();
  player._lastCollisions = collisions;
  const obstacle = { box: new THREE.Box3(new THREE.Vector3(-1, 0, .4), new THREE.Vector3(1, 2, .6)) };
  collisions.colliders.push(obstacle);
  assert.equal(contact(new MeleeCombat(), player, [npc]), null, 'no golpea a traves de una pared');
  obstacle.box.min.y = 7; obstacle.box.max.y = 8;
  assert.equal(contact(new MeleeCombat(), player, [npc]).target, npc, 'el tablero alto no bloquea a peatones de calle');
  obstacle.box.min.y = -.1; obstacle.box.max.y = .12;
  assert.equal(contact(new MeleeCombat(), player, [npc]).target, npc, 'el anden no bloquea el brazo');
  collisions.dynamicColliders.push({ box: new THREE.Box3(new THREE.Vector3(-1, 0, .4), new THREE.Vector3(1, 2, .6)) });
  assert.equal(contact(new MeleeCombat(), player, [npc]), null, 'un vehiculo interpuesto bloquea el contacto');
});

test('el obstaculo de un bus usa su caja orientada y no toda la envolvente diagonal', () => {
  const player = attacker(), npc = target();
  const center = new THREE.Vector3(2, 1.05, .5);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const obb = { center, halfSize: new THREE.Vector3(.2, 1, .2), inverse: quaternion.clone().invert() };
  player._lastCollisions = {
    colliders: [], dynamicColliders: [{
      box: new THREE.Box3(new THREE.Vector3(-1, 0, .3), new THREE.Vector3(3, 3, .7)), obb
    }]
  };
  assert.equal(contact(new MeleeCombat(), player, [npc]).target, npc);
  center.x = 0;
  assert.equal(contact(new MeleeCombat(), player, [npc]), null);
});

test('el peaton muestra recibirGolpe antes de huir, sin teletransportarse ni atravesar paredes', async () => {
  const scene = new THREE.Scene();
  const npc = new Npc(scene, new THREE.Vector3(0, .12, 1), {
    look: {}, speed: 1, facing: 0, groundHeight: () => .12,
    isWalkable: (x, z) => z < 1.4 && Math.abs(x) < 2
  });
  await npc.preload();
  const player = attacker(), initial = npc.position.clone();
  const reward = npc.takeHit({ attacker: player, damage: 12, knockback: 0, attackId: 1 });
  assert.ok(reward >= 200 && reward < 600);
  assert.equal(npc.action, 'recibirGolpe');
  assert.equal(npc.state, 'recibirGolpe');
  assert.equal(npc.actionProgress, 0);
  assert.deepEqual(npc.position, initial);
  npc.update(.12, { player: player.position });
  assert.equal(npc.character.frames.at(-1).action, 'recibirGolpe');
  assert.ok(Math.abs(npc.character.frames.at(-1).actionProgress - .25) < 1e-8);
  assert.deepEqual(npc.position, initial);
  npc.update(NPC_HIT_REACTION_DURATION - .12, { player: player.position });
  assert.equal(npc.actionProgress, 0);
  assert.equal(npc.action, null);
  assert.deepEqual(npc.position, initial, 'termina la pose antes de empezar a huir');
  npc.update(.1, { player: player.position });
  assert.equal(npc.action, null);
  assert.equal(npc.state, 'flee');
  assert.ok(npc.position.z > initial.z);
  for (let i = 0; i < 15; i++) {
    const before = npc.position.clone();
    npc.update(.1, { player: player.position });
    assert.ok(npc.position.distanceTo(before) <= .24 + 1e-8);
    assert.ok(npc.isWalkable(npc.position.x, npc.position.z));
    assert.equal(npc.position.y, .12);
  }
  npc.dispose();
});

test('un ID de golpe no repite daño ni botín, pero el siguiente golpe del combo sí conecta', async () => {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0, 1), { look: {} });
  await npc.ready;
  const player = attacker();
  const hit = { attacker: player, attackId: 10, damage: 12, knockback: 0 };
  assert.ok(npc.takeHit(hit) >= 200);
  const hp = npc.health;
  assert.equal(npc.takeHit(hit), false);
  npc.update(.2);
  const progress = npc.actionProgress;
  assert.equal(npc.takeHit(hit), false);
  assert.equal(npc.actionProgress, progress);
  assert.equal(npc.health, hp);
  assert.equal(npc.takeHit({ ...hit, attackId: 11 }), 0, 'otro golpe del combo conecta sin fabricar monedas');
  assert.equal(npc.health, hp - 12);
  npc.dispose();
});

test('la reaccion termina fuera de camara y el peaton retoma su navegacion despues de huir', async () => {
  let routes = 0;
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0, 1), {
    look: {}, speed: 1, navigation: { createRoute(pos) { routes++; return [pos.clone().add(new THREE.Vector3(2, 0, 0))]; } }
  });
  await npc.ready;
  npc.takePunch(attacker());
  const hidden = { player: new THREE.Vector3(80, 0, 80), frustum: { intersectsSphere: () => false } };
  for (let i = 0; i < 70; i++) npc.update(.1, hidden);
  assert.equal(npc.action, null);
  assert.equal(npc.panicTimer, 0);
  assert.equal(npc.root.visible, false);
  assert.ok(routes > 0, 'vuelve a pedir una ruta a la red peatonal');
  npc.dispose();
});
