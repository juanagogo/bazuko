// tests/poop.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { PoopSystem } from '../src/systems/PoopSystem.js';
import { PoopProjectile } from '../src/entities/PoopProjectile.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { ITEMS } from '../src/data/items.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

function makePlayer(extra = {}) {
  return {
    position: new THREE.Vector3(10, 0, 10), root: { rotation: { y: 0 } },
    isGrounded: true, isSwimming: false, isStunned: false, isRagdollActive: false,
    basuco: null, sorting: false, hasCart: false, action: null,
    character: {}, look: {}, stats: { salud: 100 }, pose: undefined,
    playAction(act) { this.action = act; },
    setPoopPose(pose) { this.pose = pose; },
    ...extra
  };
}

function run(system, seconds, dt = 1 / 30, before = null) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) { before?.(i * dt); system.update(dt); }
}

test('hacer popó baja el pantalón, deja el montón y entrega el mojón solo al terminar', () => {
  const scene = new THREE.Scene();
  const inventory = new InventorySystem();
  const stats = new StatsSystem();
  const player = makePlayer();
  const poopSys = new PoopSystem(scene, null, inventory, stats, { active: { getGroundHeight: () => 0 } });

  assert.equal(poopSys.poop(player), true);
  poopSys.update(1 / 60);
  assert.equal(player.action, 'bajarse');
  assert.equal(player.pose.stance, 'pretina');
  run(poopSys, 3);
  assert.equal(player.action, 'cagar');
  assert.equal(player.pose.drop, 1);
  assert.equal(inventory.count('popo'), 0, 'todavía no ha terminado');
  run(poopSys, 2.6);
  assert.equal(inventory.count('popo'), 1);
  assert.equal(stats.higiene, 97); // baja 3 de higiene
  assert.equal(poopSys.groundPoops.length, 1);
  assert.equal(poopSys.groundPoops[0].pieces, 5);
  assert.equal(player.pose, null, 'vestido otra vez');
  assert.equal(player.action, null);

  // El enfriamiento empieza al terminar.
  assert.equal(poopSys.poop(player), false);
  run(poopSys, 2.3);
  assert.equal(poopSys.poop(player), true);
});

test('mientras hace popó, X no lanza y Z no reinicia', () => {
  const inventory = new InventorySystem();
  inventory.add(ITEMS.popo, 2);
  const player = makePlayer();
  const poopSys = new PoopSystem(new THREE.Scene(), null, inventory, null, { active: { npcs: [], getGroundHeight: () => 0 } });
  assert.equal(poopSys.poop(player), true);
  run(poopSys, .5);
  assert.equal(poopSys.throwPoop(player, null), false);
  assert.equal(poopSys.activeProjectiles.length, 0);
  assert.equal(inventory.count('popo'), 2);
  assert.equal(poopSys.poop(player), false);
  assert.equal(player.action, 'bajarse');
});

test('si lo interrumpen a mitad no entrega el mojón y queda vestido', () => {
  const inventory = new InventorySystem();
  const player = makePlayer();
  const poopSys = new PoopSystem(new THREE.Scene(), null, inventory, null, { active: { getGroundHeight: () => 0 } });
  poopSys.poop(player);
  run(poopSys, 2.5);
  player.isStunned = true;
  poopSys.update(1 / 30);
  assert.equal(player.pose, null);
  assert.equal(inventory.count('popo'), 0);
  assert.equal(poopSys.groundPoops.length, 1, 'lo que ya cayó se queda');
  assert.ok(poopSys.groundPoops[0].pieces > 0);

  const early = makePlayer();
  const other = new PoopSystem(new THREE.Scene(), null, new InventorySystem(), null, { active: { getGroundHeight: () => 0 } });
  other.poop(early);
  run(other, 1);
  early.isStunned = true;
  other.update(1 / 30);
  assert.equal(early.pose, null);
  assert.equal(other.groundPoops.length, 0, 'sin trozos ni chichi no queda nada');
});

test('en el puente la popó y la lanzada quedan sobre el tablero', () => {
  const deck = 7.82;
  const world = { active: { npcs: [], getGroundHeight: () => 0, getMovementGroundHeight: () => deck } };
  const player = makePlayer({ position: new THREE.Vector3(75, deck, 120) });
  const poopSys = new PoopSystem(new THREE.Scene(), null, new InventorySystem(), null, world);
  poopSys.poop(player);
  run(poopSys, .2);
  assert.ok(Math.abs(poopSys.groundPoops[0].position.y - deck) < 1e-6);

  const inventory = new InventorySystem();
  inventory.add(ITEMS.popo, 1);
  const thrower = makePlayer({ position: new THREE.Vector3(75, deck, 120) });
  const throwSys = new PoopSystem(new THREE.Scene(), null, inventory, null, world);
  assert.equal(throwSys.throwPoop(thrower, null), true);
  for (let i = 0; i < 120 && throwSys.activeProjectiles.length; i++) throwSys.update(1 / 30);
  assert.equal(throwSys.groundPoops.length, 1);
  assert.ok(Math.abs(throwSys.groundPoops[0].position.y - deck) < .05, `cayó a ${throwSys.groundPoops[0].position.y}`);
});

test('la popó lanzada al piso trae moscas y no charquito', () => {
  const inventory = new InventorySystem();
  inventory.add(ITEMS.popo, 1);
  const player = makePlayer({ position: new THREE.Vector3(0, 0, 0) });
  const poopSys = new PoopSystem(new THREE.Scene(), null, inventory, null, { active: { npcs: [], getGroundHeight: () => 0 } });
  poopSys.throwPoop(player, null);
  for (let i = 0; i < 120 && poopSys.activeProjectiles.length; i++) poopSys.update(1 / 30);
  const pile = poopSys.groundPoops[0];
  assert.ok(pile);
  assert.equal(pile.peeMesh, null);
  assert.equal(pile.pieces, 5);
  assert.notEqual(pile.settledAge, null);
});

test('lanzar popó consume un mojón, activa la animación de lanzar y genera el proyectil balístico', () => {
  const scene = new THREE.Scene();
  const inventory = new InventorySystem();
  inventory.add(ITEMS.popo, 2);
  let actionPlayed = null;
  const player = {
    position: new THREE.Vector3(5, 0, 5),
    root: { rotation: { y: 0 } },
    playAction(act) { actionPlayed = act; }
  };

  const poopSys = new PoopSystem(scene, null, inventory, null, { active: { npcs: [], getGroundHeight: () => 0 } });

  const ok = poopSys.throwPoop(player, null);
  assert.equal(ok, true);
  assert.equal(actionPlayed, 'lanzar');
  assert.equal(inventory.count('popo'), 1);
  assert.equal(poopSys.activeProjectiles.length, 1);
});

test('el proyectil de popó impacta a un NPC peatón y activa su reacción de pánico y huida', () => {
  const scene = new THREE.Scene();
  let npcHitOrigin = null;
  const mockNpc = {
    position: new THREE.Vector3(5, 0, 9),
    hitByPoop(origin) {
      this.isSplatted = true;
      this.fleeTimer = 8;
      npcHitOrigin = origin;
    }
  };

  const startPos = new THREE.Vector3(5, 1.2, 5);
  const dir = new THREE.Vector3(0, 0, 1); // directo hacia el NPC
  const projectile = new PoopProjectile(scene, startPos, dir, [mockNpc], () => 0);

  // Simular cuadros de avance del proyectil hasta impactar al NPC
  let hitResult = null;
  for (let f = 0; f < 30; f++) {
    const res = projectile.update(1 / 60);
    if (res.hit) {
      hitResult = res;
      break;
    }
  }

  assert.ok(hitResult, 'El proyectil debió registrar un impacto');
  assert.equal(hitResult.type, 'npc');
  assert.equal(hitResult.npc, mockNpc);
  assert.equal(mockNpc.isSplatted, true);
  assert.equal(mockNpc.fleeTimer, 8);
  assert.ok(npcHitOrigin, 'El NPC recibió el origen del proyectil');
});

test('el proyectil de popó impacta contra el suelo si no toca ningún peatón', () => {
  const scene = new THREE.Scene();
  const startPos = new THREE.Vector3(0, 1.2, 0);
  const dir = new THREE.Vector3(1, 0, 0);
  const projectile = new PoopProjectile(scene, startPos, dir, [], () => 0);

  let hitResult = null;
  for (let f = 0; f < 60; f++) {
    const res = projectile.update(1 / 30);
    if (res.hit) {
      hitResult = res;
      break;
    }
  }

  assert.ok(hitResult);
  assert.equal(hitResult.type, 'ground');
});
