// tests/street-immersion.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { ITEMS, SHOP_ITEMS } from '../src/data/items.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { Bogota } from '../src/world/districts/Bogota.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  const mockCtx = new Proxy({}, {
    get: (target, prop) => {
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(64) });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (prop === 'canvas') return { width: 64, height: 64 };
      return () => {};
    }
  });
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          width: 64,
          height: 64,
          getContext: () => mockCtx,
          toDataURL: () => ''
        };
      }
      return {
        className: '',
        textContent: '',
        style: {},
        remove: () => {},
        classList: { toggle() {}, add() {}, remove() {} }
      };
    },
    getElementById: (id) => {
      if (id === 'minimap-container') return { classList: { toggle() {}, add() {}, remove() {} } };
      if (id === 'minimap-canvas') return { width: 130, height: 130, getContext: () => mockCtx };
      if (id === 'minimap-info') return { textContent: '' };
      return null;
    },
    body: {
      appendChild: () => {}
    },
    querySelectorAll: () => []
  };
});

test('Gastronomía callejera bogotana está registrada con valores típicos y calor', () => {
  const foods = ['empanada', 'morcilla', 'papaCriolla', 'aguapanela'];
  for (const id of foods) {
    const item = ITEMS[id];
    assert.ok(item, `El ítem ${id} debe existir en ITEMS`);
    assert.ok(item.calor > 0, `${id} debe proveer calor corporal contra el frío bogotano`);
    assert.ok(item.consumable, `${id} debe ser consumible`);
    
    // Verificar que esté en la lista de tiendas ambulantes
    const inShop = SHOP_ITEMS.some(s => s.item === id);
    assert.ok(inShop, `${id} debe estar en SHOP_ITEMS para poder comprarse`);
  }

  assert.equal(ITEMS.aguapanela.cure, 'gripe', 'La aguapanela caliente con limón debe curar la gripe');
  assert.equal(ITEMS.morcilla.energia, 20, 'La morcilla criolla debe recargar energía');
});

test('Fogatas de El Cartucho están configuradas como interactivas', () => {
  const bogota = new Bogota();
  bogota.scene = new THREE.Scene();
  bogota.map = bogota._layout();
  bogota._buildCartucho();

  assert.ok(Array.isArray(bogota.fireBarrels), 'Bogota debe tener arreglo fireBarrels');
  assert.equal(bogota.fireBarrels.length, 4, 'Deben existir 4 canecas con fuego en El Cartucho');

  for (const fb of bogota.fireBarrels) {
    assert.equal(fb.kind, 'fireBarrel', 'Cada fogata debe tener kind: fireBarrel');
    assert.ok(fb.position instanceof THREE.Vector3, 'Cada fogata debe tener una posición Vector3');
  }
});

test('Calentarse en la fogata restablece ánimo, otorga calor y respeta cooldown', () => {
  const stats = new StatsSystem();
  stats.energia = 50;
  stats.animo = 50;
  stats.calor = 0;

  const interaction = new InteractionSystem(
    { position: new THREE.Vector3(0, 0, 0), playAction: () => {} },
    { items: [] },
    stats,
    { play: () => {} },
    null,
    null,
    null
  );

  const fakeFire = { kind: 'fireBarrel', position: new THREE.Vector3(0, 0, 0) };
  interaction._warmAtFire(fakeFire);

  assert.ok(stats.calor >= 180, 'Debe otorgar al menos 3 minutos de calor corporal');
  assert.ok(stats.energia > 50, 'Debe restaurar energía');
  assert.ok(stats.animo > 50, 'Debe mejorar el ánimo');

  // Intentar calentarse inmediatamente de nuevo (cooldown de 20s activo)
  let warned = false;
  globalThis.window.addEventListener('toast', (e) => {
    if (e.detail?.text?.includes('hace poco')) warned = true;
  });
  interaction._warmAtFire(fakeFire);
  assert.equal(warned, true, 'Debe advertir que el calor aún perdura y respetar cooldown');
});

test('El Frío de La Nevera (noche lluviosa) penaliza al jugador si no tiene calor', () => {
  const statsCold = new StatsSystem();
  statsCold.energia = 100;
  statsCold.animo = 100;
  statsCold.calor = 0;

  const statsWarm = new StatsSystem();
  statsWarm.energia = 100;
  statsWarm.animo = 100;
  statsWarm.calor = 300; // Protegido por comida caliente o fogata

  const nightClock = { isNight: true };
  const rainWeather = { isRaining: true };

  // Simular 30 segundos
  for (let i = 0; i < 30; i++) {
    statsCold.update(1.0, null, null, nightClock, null, rainWeather);
    statsWarm.update(1.0, null, null, nightClock, null, rainWeather);
  }

  assert.equal(statsCold.isFreezing, true, 'El jugador sin calor debe estar en estado isFreezing');
  assert.equal(statsWarm.isFreezing, false, 'El jugador con calor corporal no se congela');
  assert.ok(statsCold.energia < statsWarm.energia, 'El frío debe drenar más energía');
  assert.ok(statsCold.animo < statsWarm.animo, 'El frío debe acelerar la pérdida de ánimo');
});

test('Pedir limosna requiere transeúntes cercanos (<7m) y no consume energía si no hay nadie', () => {
  const stats = new StatsSystem();
  stats.energia = 50;
  const player = { position: new THREE.Vector3(0, 0, 0), playBeg: () => {} };
  // La limosna puede regalar pan o agua al azar: el inventario debe aceptarlos.
  const inventory = { items: [], add: () => true };
  const interaction = new InteractionSystem(player, inventory, stats, { play: () => {} }, null, null, null);

  // Caso 1: Sin peatones
  interaction.setPedestrians([]);
  let rejected = false;
  const listener = (e) => {
    if (e.detail?.reason === 'no_pedestrians') rejected = true;
  };
  globalThis.window.addEventListener('beg-result', listener);

  interaction._beg();
  assert.equal(rejected, true, 'Debe rechazar limosna si no hay transeúntes cerca');
  assert.equal(stats.energia, 50, 'No debe descontar energía si no hay nadie');
  globalThis.window.removeEventListener('beg-result', listener);

  // Caso 2: Con peatón a 3 metros
  interaction._lastBegTime = -9999;
  interaction.setPedestrians([{ position: new THREE.Vector3(2, 0, 2) }]);
  interaction._beg();
  assert.ok(stats.energia < 50, 'Con peatón cercano debe intentar pedir limosna y descontar energía');
});

