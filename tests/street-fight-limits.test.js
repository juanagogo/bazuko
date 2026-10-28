import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { Npc } from '../src/entities/Npc.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() {
      return {
        className: '',
        textContent: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        remove() {}
      };
    },
    body: {
      appendChild() {},
      removeChild() {}
    }
  };
});

test('Límite de pelea 1: Golpear consume 8 de energía si el jugador tiene energía disponible', () => {
  const scene = new THREE.Scene();
  const input = {
    consumePress: (key) => key === 'KeyG',
    axis: { x: 0, z: 0 },
    isRunning: false
  };
  const stats = { dinero: 500, energia: 50, salud: 100 };
  const player = new Player(scene, input, stats, {});

  assert.equal(stats.energia, 50);
  const ok = player.punch([]);
  assert.equal(ok, true);
  assert.equal(stats.energia, 42, 'Consumió 8 puntos de energía');
  assert.equal(player.punchCooldown, 0.75, 'Activa cooldown de combate');
});

test('Límite de pelea 2: Jugador exhausto (energía < 8) no puede pelear y recibe aviso', () => {
  const scene = new THREE.Scene();
  const input = {
    consumePress: (key) => key === 'KeyG',
    axis: { x: 0, z: 0 },
    isRunning: false
  };
  const stats = { dinero: 500, energia: 4, salud: 100 };
  const player = new Player(scene, input, stats, {});

  let toastReceived = null;
  globalThis.window.addEventListener('toast', (e) => {
    toastReceived = e.detail;
  });

  const ok = player.punch([]);
  assert.equal(ok, false, 'No permite golpear si está exhausto');
  assert.equal(stats.energia, 4, 'La energía no se altera');
  assert.ok(toastReceived !== null, 'Emite notificación toast');
  assert.ok(toastReceived.text.includes('exhausto'), 'Avisa al jugador de su agotamiento');
});

test('Límite de pelea 3: Cooldown de combate impide spammear golpes en cuadros consecutivos', () => {
  const scene = new THREE.Scene();
  let pressed = true;
  const input = {
    consumePress: (key) => {
      if (key === 'KeyG' && pressed) {
        return true;
      }
      return false;
    },
    axis: { x: 0, z: 0 },
    isRunning: false
  };
  const stats = { dinero: 500, energia: 80 };
  const player = new Player(scene, input, stats, {});

  // Primer cuadro: golpea
  player.update(0.016);
  assert.equal(player.action, 'golpear');
  assert.equal(stats.energia, 72);
  assert.ok(player.punchCooldown > 0.7);

  // Siguiente cuadro: intenta golpear de nuevo (termina actionTimer artificialmente pero cooldown sigue activo)
  player.actionTimer = 0;
  player.action = null;
  pressed = true;
  player.update(0.016);

  assert.equal(player.action, null, 'No debe reiniciar el golpe porque punchCooldown está activo');
  assert.equal(stats.energia, 72, 'No gasta energía extra');
});

test('Límite de pelea 4: Un transeúnte solo suelta botín en el primer golpe; golpes repetidos no dan dinero', () => {
  const scene = new THREE.Scene();
  const input = {
    consumePress: () => false,
    axis: { x: 0, z: 0 },
    isRunning: false
  };
  const stats = { dinero: 1000, energia: 90, salud: 100 };
  const player = new Player(scene, input, stats, { playPunchHit: () => {} });
  player.position.set(0, 0, 0);

  const npc = new Npc(scene, new THREE.Vector3(0, 0, 1), { look: {} });
  assert.equal(npc.hasDroppedLoot, false);

  // Primer golpe
  const loot1 = npc.takePunch(player);
  assert.ok(loot1 >= 200, 'Primer golpe suelta dinero');
  assert.equal(npc.hasDroppedLoot, true);

  // Segundo golpe al mismo NPC (mientras huye o después)
  const loot2 = npc.takePunch(player);
  assert.equal(loot2, 0, 'Segundo golpe devuelve 0 dinero');
  assert.ok(npc._bubbleEl !== null, 'Emite burbuja de que ya no tiene dinero');
});

test('Límite de pelea 5: Transeúnte fuerte contraataca y reduce la salud del agresor', () => {
  const scene = new THREE.Scene();
  const stats = { dinero: 1000, energia: 90, salud: 100 };
  const audio = { playPunchHit: () => {} };
  const player = new Player(scene, {}, stats, audio);

  // Peatón adulto fuerte garantizado
  const npc = new Npc(scene, new THREE.Vector3(0, 0, 1), {
    look: { real: { edad: 'adulto' } }
  });

  const loot = npc.takePunch(player);
  assert.ok(loot >= 200);
  assert.ok(stats.salud < 100, 'El transeúnte contraatacó reduciendo la salud');
});

test('Límite de pelea 6: Golpear peatones incrementa el nivel de búsqueda policial', () => {
  const scene = new THREE.Scene();
  const input = {
    consumePress: (key) => key === 'KeyG',
    axis: { x: 0, z: 0 },
    isRunning: false
  };
  const stats = { dinero: 1000, energia: 90 };
  const player = new Player(scene, input, stats, { playWhoosh: () => {}, playPunchHit: () => {} });
  player.position.set(0, 0, 0);
  player.root.rotation.y = 0; // Frente a +Z

  const mockGame = {
    steal: { buscado: 0 }
  };
  player.game = mockGame;

  const npc = new Npc(scene, new THREE.Vector3(0, 0, 1), { look: {} });

  player.punch([npc]);
  assert.equal(mockGame.steal.buscado, 1, 'Incrementa el nivel de buscado al golpear');

  // Máximo 3
  mockGame.steal.buscado = 3;
  player.punchCooldown = 0;
  player.punch([npc]);
  assert.equal(mockGame.steal.buscado, 3, 'No sobrepasa el nivel máximo de 3');
});
