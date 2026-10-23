import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { CinematicOverlays } from '../src/ui/CinematicOverlays.js';
import { Cart } from '../src/entities/Cart.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { Npc } from '../src/entities/Npc.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById(id) {
      return null;
    },
    createElement(tag) {
      return {
        className: '',
        textContent: '',
        style: {},
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          toggle(c, force) {
            const val = force !== undefined ? !!force : !this.classes.has(c);
            if (val) this.classes.add(c);
            else this.classes.delete(c);
            return val;
          }
        },
        remove() {}
      };
    },
    body: {
      appendChild() {}
    }
  };
});

test('CinematicOverlays: inicializa elementos del DOM y actualiza gotas y frío según clima', () => {
  const rainEl = {
    style: {},
    classList: {
      toggle() {}
    }
  };
  const coldEl = {
    style: {},
    classList: {
      toggle() {}
    }
  };
  const psychosisEl = {
    classList: {
      add() {},
      remove() {},
      toggle() {}
    }
  };

  globalThis.document.getElementById = (id) => {
    if (id === 'cinematic-rain') return rainEl;
    if (id === 'cinematic-cold') return coldEl;
    if (id === 'psychosis-overlay') return psychosisEl;
    return null;
  };

  const overlays = new CinematicOverlays();
  assert.ok(overlays);

  // Clima despejado y medio día: opacidad 0
  const weatherClear = { isRaining: false };
  const clockNoon = { hour: 13, isNight: false };
  const psychosisCalm = { active: false };

  overlays.update(0.1, weatherClear, clockNoon, psychosisCalm);
  assert.equal(parseFloat(rainEl.style.opacity), 0);
  assert.equal(parseFloat(coldEl.style.opacity), 0);

  // Lluvia: aumenta gotas en la lente
  const weatherRain = { isRaining: true };
  for (let i = 0; i < 20; i++) overlays.update(0.1, weatherRain, clockNoon, psychosisCalm);
  assert.ok(parseFloat(rainEl.style.opacity) > 0.3, 'Las gotas de lluvia aparecen en la lente');

  // Madrugada fría (4 AM): viñeta de frío andino
  const clockDawn = { hour: 4, isNight: true };
  for (let i = 0; i < 25; i++) overlays.update(0.1, weatherClear, clockDawn, psychosisCalm);
  assert.ok(parseFloat(coldEl.style.opacity) > 0.4, 'El frío bogotano de madrugada oscurece los bordes');
});

test('Detección de terreno y modulación de pasos en AudioSystem', () => {
  const bogota = new Bogota();
  const sidewalkType = bogota.getGroundTypeAt(0, 0);
  assert.ok(typeof sidewalkType === 'string');

  const audio = new AudioSystem();
  assert.ok(audio);

  // Simular pasos en asfalto vs tierra
  audio.updateSteps(true, false, 'road', false);
  assert.equal(audio._stepsPlaying, true);
  assert.equal(audio._lastGroundType, 'road');

  audio.updateSteps(true, true, 'dirt', true);
  assert.equal(audio._lastGroundType, 'dirt');
  assert.equal(audio._lastRunning, true);

  audio.updateSteps(false, false);
  assert.equal(audio._stepsPlaying, false);
});

test('Bocina de carro y sonido de carreta en AudioSystem', () => {
  const audio = new AudioSystem();
  assert.equal(typeof audio.playCarHorn, 'function');
  assert.equal(typeof audio.playCartRumble, 'function');

  assert.doesNotThrow(() => {
    audio.playCarHorn(400);
    audio.playCartRumble();
  });
});

test('Carreta de balineras: estructura 3D, acople al jugador, bonificación de carga y rodamiento', () => {
  const scene = new THREE.Scene();
  const cart = new Cart(scene, new THREE.Vector3(15, 0, 20));

  assert.equal(cart.kind, 'cart');
  assert.equal(cart.isAttached, false);
  assert.equal(cart.capacityBonus, 120);
  assert.ok(cart.group.children.length >= 8, 'La carreta tiene plataforma, barandas, eje, balineras, pata y manubrio');

  const player = {
    position: new THREE.Vector3(10, 0, 10),
    root: { rotation: { y: 0 } },
    speed: 2.5,
    hasCart: false
  };
  const inventory = {
    maxWeight: 20
  };

  // 1. Acoplar carreta
  const attached = cart.toggleGrab(player, inventory);
  assert.equal(attached, true);
  assert.equal(cart.isAttached, true);
  assert.equal(player.hasCart, true);
  assert.equal(inventory.maxWeight, 140, 'Aumenta 120 kg la capacidad de carga');

  // 2. Movimiento: la carreta sigue al jugador al frente
  cart.update(0.1, player, { playCartRumble() {} });
  assert.equal(cart.position.x, 10);
  assert.ok(cart.position.z > 10, 'La carreta se ubica frente al rumbo del jugador');
  assert.ok(cart._wheelRotation > 0, 'Las balineras ruedan con el avance');

  // 3. Persistencia de estado
  const saved = cart.saveState();
  assert.equal(saved.isAttached, true);
  assert.equal(saved.x, cart.position.x);

  // 4. Desacoplar carreta
  const detached = cart.toggleGrab(player, inventory);
  assert.equal(detached, false);
  assert.equal(cart.isAttached, false);
  assert.equal(player.hasCart, false);
  assert.equal(inventory.maxWeight, 20, 'Restaura la capacidad normal');

  // 5. Cargar estado guardado
  cart.loadState(saved, player, inventory);
  assert.equal(cart.isAttached, true);
  assert.equal(inventory.maxWeight, 140);
});

test('NPC reactivos: diálogos flotantes y paraguas procedural en lluvia', () => {
  const scene = new THREE.Scene();
  const pos = new THREE.Vector3(5, 0, 5);
  const npc = new Npc(scene, pos, { look: {}, name: 'Vecino' });

  assert.equal(npc.umbrella, null);

  // En lluvia despliega paraguas
  npc._updateUmbrella(true);
  assert.ok(npc.umbrella !== null);
  assert.equal(npc.umbrella.visible, true);

  // Al escampar se pliega/oculta
  npc._updateUmbrella(false);
  assert.equal(npc.umbrella.visible, false);

  // Diálogo bogotano
  npc.say('¡Dios lo bendiga, vecino!');
  assert.ok(npc._bubbleEl !== null);
  assert.equal(npc._bubbleEl.textContent, '¡Dios lo bendiga, vecino!');

  npc.dispose();
  assert.equal(npc._bubbleEl, null);
  assert.equal(npc.umbrella, null);
});
