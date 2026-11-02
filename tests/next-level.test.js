import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('CinematicOverlays: el frío sale del estado del jugador, entra de a poco y el calor lo quita rápido', () => {
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

  // Sin frío: opacidad 0
  const weatherClear = { isRaining: false };
  const warm = { isFreezing: false };
  const psychosisCalm = { active: false };

  overlays.update(0.1, weatherClear, warm, psychosisCalm);
  assert.equal(parseFloat(rainEl.style.opacity), 0);
  assert.equal(coldEl.style.opacity, undefined, 'sin cambios no se escribe en el DOM');

  // Lluvia: aumenta gotas en la lente
  const weatherRain = { isRaining: true, rainIntensity: 1 };
  for (let i = 0; i < 20; i++) overlays.update(0.1, weatherRain, warm, psychosisCalm);
  assert.ok(parseFloat(rainEl.style.opacity) > 0.3, 'Las gotas de lluvia aparecen en la lente');
  assert.equal(coldEl.style.opacity, undefined, 'la lluvia con calor no enfría la imagen');

  // Congelándose: entra despacio, sin saltos
  const freezing = { isFreezing: true };
  overlays.update(0.5, weatherRain, freezing, psychosisCalm);
  const first = parseFloat(coldEl.style.opacity);
  assert.ok(first > 0 && first < 0.1, 'el frío no aparece de golpe');
  for (let i = 0; i < 300; i++) overlays.update(0.1, weatherRain, freezing, psychosisCalm);
  assert.ok(parseFloat(coldEl.style.opacity) > 0.9, 'tras un rato a la intemperie los bordes se enfrían');

  // La fogata lo quita en un par de segundos
  for (let i = 0; i < 20; i++) overlays.update(0.1, weatherRain, warm, psychosisCalm);
  assert.ok(parseFloat(coldEl.style.opacity) < 0.05, 'el calor limpia los bordes');
  for (let i = 0; i < 40; i++) overlays.update(0.1, weatherRain, warm, psychosisCalm);
  assert.equal(parseFloat(coldEl.style.opacity), 0);
});

test('index.html trae la capa de frío que busca CinematicOverlays', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="cinematic-cold"/);
  assert.doesNotMatch(html, /id="cold-lens"/);
  assert.ok(html.indexOf('id="cinematic-vignette"') < html.indexOf('id="cinematic-cold"'), 'la viñeta encima apagaría las esquinas frías');
  const css = readFileSync(new URL('../src/ui/css/momentos.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css.match(/\.cold-lens\.active\s*\{([^}]*)\}/)[1], /visibility/, 'un visibility propio le ganaría al modo foto');
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
