// tests/poop.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { PoopSystem } from '../src/systems/PoopSystem.js';
import { PoopProjectile } from '../src/entities/PoopProjectile.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { ITEMS } from '../src/data/items.js';
import { Player } from '../src/entities/Player.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('el jugador puede hacer popó presionando la tecla/acción y recibe un mojón en el inventario', () => {
  const scene = new THREE.Scene();
  const inventory = new InventorySystem();
  const stats = new StatsSystem();
  let actionPlayed = null;
  const player = {
    position: new THREE.Vector3(10, 0, 10),
    root: new THREE.Group(),
    playAction(act) { actionPlayed = act; }
  };

  const poopSys = new PoopSystem(scene, null, inventory, stats, { active: { getGroundHeight: () => 0 } });

  assert.equal(inventory.count('popo'), 0);
  const ok = poopSys.poop(player);

  assert.equal(ok, true);
  assert.equal(actionPlayed, 'cagar');
  assert.equal(inventory.count('popo'), 1);
  assert.equal(stats.higiene, 97); // baja 3 de higiene
  assert.equal(poopSys.groundPoops.length, 1);

  // Cooldown impide spam instantáneo
  const spamOk = poopSys.poop(player);
  assert.equal(spamOk, false);
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

function squatter(axis = { x: 0, z: 0 }) {
  const scene = new THREE.Scene();
  const input = { axis, isRunning: false, consumePress() { return false; }, isDown() { return false; } };
  const player = new Player(scene, input, { dinero: 0 }, {});
  player.position.set(0, 0, 0);
  const poseActions = [];
  const update = player.character.update.bind(player.character);
  player.character.update = (dt, state) => { poseActions.push(state.action); return update(dt, state); };
  const tick = (seconds, dt = 0.05) => { for (let t = 0; t < seconds - 1e-9; t += dt) player.update(dt, null, null, () => 0, []); };
  const system = new PoopSystem(scene, null, new InventorySystem(), null, { active: { getGroundHeight: () => 0 } });
  return { player, tick, system, poseActions };
}

test('al hacer popó se agacha, queda quieto aunque empuje, y se levanta al terminar', () => {
  const { player, tick, system, poseActions } = squatter({ x: 1, z: 0 });
  assert.equal(system.poop(player), true);
  assert.equal(player.action, 'cagar');
  tick(1.2);
  assert.ok(player.position.length() < 0.01, 'quieto en cuclillas');
  assert.equal(poseActions.at(-1), 'cagar', 'la pose sigue puesta');
  tick(0.6);
  assert.equal(player.action, null, 'terminó la acción');
  assert.notEqual(poseActions.at(-1), 'cagar', 'ya no está en la pose');
  tick(0.5);
  assert.ok(player.position.length() > 0.05, 'vuelve a caminar');
});

test('hacer popó no pisa una acción en curso ni un golpe', () => {
  const { player, system } = squatter();
  player.playAction('saludo', 1);
  assert.equal(system.poop(player), true);
  assert.equal(player.action, 'saludo');
  const played = [];
  const fighting = { position: new THREE.Vector3(), attack: { t: 0 }, playAction: (a) => played.push(a) };
  system.poopCooldown = 0;
  assert.equal(system.poop(fighting), true);
  assert.deepEqual(played, []);
});
