// tests/street-immersion.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { ITEMS, SHOP_ITEMS } from '../src/data/items.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { Dog } from '../src/entities/Dog.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { TrafficSignals } from '../src/world/bogota/TrafficSignals.js';
import { Car } from '../src/entities/Car.js';
import { Minimap } from '../src/ui/Minimap.js';

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

test('Calentarse en la fogata restablece ánimo, otorga calor, seca la ropa y respeta cooldown', () => {
  const stats = new StatsSystem();
  stats.energia = 50;
  stats.animo = 50;
  stats.calor = 0;

  let clothesDried = false;
  globalThis.window.addEventListener('dry-clothes', () => {
    clothesDried = true;
  });

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
  assert.equal(clothesDried, true, 'Debe disparar el evento dry-clothes');

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

test('Alimentar a El Chato aumenta su amistad y fidelidad', () => {
  const scene = new THREE.Scene();
  const dog = new Dog(scene, new THREE.Vector3(0, 0, 0));
  assert.equal(dog.friendship, 20, 'Amistad inicial es 20');

  dog.feed();
  assert.equal(dog.isFriend, true, 'Al darle comida se hace amigo');
  assert.equal(dog.friendship, 45, 'Amistad sube +25 al alimentarlo');

  dog.pet();
  assert.equal(dog.friendship, 50, 'Acariciarlo sube +5 amistad');

  // Test de InteractionSystem alimentando al perro
  const inventory = {
    items: [{ id: 'empanada', qty: 1 }],
    remove(id, qty) {
      const idx = this.items.findIndex(i => i.id === id);
      if (idx >= 0) this.items.splice(idx, 1);
    }
  };
  const stats = new StatsSystem();
  const interaction = new InteractionSystem(
    { position: new THREE.Vector3(0, 0, 0) },
    inventory,
    stats,
    { play: () => {} },
    null,
    null,
    null
  );

  interaction._interactDog(dog);
  assert.equal(inventory.items.length, 0, 'La empanada debió consumirse al alimentar al perro');
  assert.equal(dog.friendship, 75, 'Amistad subió a 75');
});

test('El Chato con alta amistad trae regalos escarbados de la calle', () => {
  const scene = new THREE.Scene();
  const dog = new Dog(scene, new THREE.Vector3(0, 0, 0));
  dog.befriend();
  dog.friendship = 80;

  let giftReceived = null;
  globalThis.window.addEventListener('dog-gift', (e) => {
    giftReceived = e.detail?.itemId;
  });

  // Forzar timer de fetch
  dog._fetchTimer = 91;
  const origRandom = Math.random;
  Math.random = () => 0.1;

  dog.update(0.1, new THREE.Vector3(0, 0, 0), []);
  Math.random = origRandom;

  assert.ok(giftReceived, 'El Chato debe disparar el evento dog-gift');
  assert.ok(['moneda', 'cable', 'reloj', 'lata', 'chatarra'].includes(giftReceived), 'El regalo debe ser un objeto callejero válido');
});

test('Semáforos están ubicados fuera de las calzadas y cuentan con colisiones físicas', () => {
  const bogota = new Bogota();
  bogota.map = bogota._layout();
  const signals = new TrafficSignals();

  // Verificar que 100% de los postes estén en andén o plaza (0 en calzada o carril bus)
  let onRoad = 0;
  for (const p of signals.poles) {
    const tx = Math.floor(p.x / 2);
    const tz = Math.floor(p.z / 2);
    const tile = bogota.map[tz]?.[tx];
    if (tile === 'road' || tile === 'busway') onRoad++;
  }
  assert.equal(onRoad, 0, 'Ningún semáforo debe estar ubicado en la calzada vehicular');

  // Verificar colisiones
  const colliders = [];
  signals.addColliders({
    add(obj, size) {
      colliders.push({ obj, size });
    }
  });
  assert.equal(colliders.length, signals.poles.length, 'Cada poste de semáforo debe tener su caja de colisión');
  assert.ok(colliders[0].size.x >= 0.35, 'El colisionador del poste debe tener grosor físico');
});

test('Vehículos en tráfico tienen figura de conductor visible en la cabina', () => {
  const scene = new THREE.Scene();
  const trafficCar = new Car(scene, new THREE.Vector3(0, 0, 0), 0, { traffic: true });
  assert.ok(trafficCar.driver, 'Un vehículo en tráfico debe tener figura de conductor');
  assert.equal(trafficCar.driver.name, 'Driver', 'El grupo del conductor debe llamarse Driver');

  const parkedCar = new Car(scene, new THREE.Vector3(10, 0, 0), 0, { traffic: false });
  assert.equal(parkedCar.driver, undefined, 'Un vehículo estacionado no debe tener conductor');
});

test('Pedir limosna requiere transeúntes cercanos (<7m) y no consume energía si no hay nadie', () => {
  const stats = new StatsSystem();
  stats.energia = 50;
  const player = { position: new THREE.Vector3(0, 0, 0), playBeg: () => {} };
  const interaction = new InteractionSystem(player, { items: [] }, stats, { play: () => {} }, null, null, null);

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

test('Minimap soporta alternar tamaños y fijar/limpiar waypoints con cálculo direccional', () => {
  const map = new Minimap();
  assert.equal(map.sizeMode, 'normal');

  map.toggleSize();
  assert.equal(map.sizeMode, 'large');
  assert.equal(map.radarRadius, 92);

  // Fijar waypoint
  map.setWaypoint(50, 50, 'Destino Prueba', '📍');
  assert.ok(map.waypoint);
  assert.equal(map.waypoint.name, 'Destino Prueba');

  map.update({ x: 0, z: 0 }, 0, []);
  assert.ok(map.infoEl.textContent.includes('Destino Prueba'));

  // Limpiar waypoint
  map.clearWaypoint();
  assert.equal(map.waypoint, null);
});
