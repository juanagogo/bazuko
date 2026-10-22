import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { Zorra } from '../src/entities/Zorra.js';
import { ZorraController } from '../src/systems/ZorraController.js';
import { ZorraSystem } from '../src/systems/ZorraSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { RecicladorEstado } from '../src/systems/RecicladorEstado.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function juego({ costal = false } = {}) {
  return Object.assign(Object.create(Game.prototype), {
    talents: { getEffect: (key, fallback) => fallback },
    costal,
    inventory: new InventorySystem(),
    player: { load: 0 },
    zorra: new ZorraSystem()
  });
}

test('la capacidad suma la zorra solo mientras se empuja', () => {
  const game = juego({ costal: true });
  game._actualizarCapacidad();
  assert.equal(game.inventory.maxWeight, 40);
  game.zorra.obtener();
  game._actualizarCapacidad();
  assert.equal(game.inventory.maxWeight, 80);
  game.zorra.soltar([0, 0, 0], 0);
  game._actualizarCapacidad();
  assert.equal(game.inventory.maxWeight, 40);
});

test('el radar muestra la zorra solo cuando está en el suelo', () => {
  const game = juego();
  const ctl = Object.assign(Object.create(ZorraController.prototype), { game });
  assert.equal(ctl.poi(), null);
  game.zorra.obtener();
  assert.equal(ctl.poi(), null);
  game.zorra.soltar([12, 0, -7], 0);
  assert.deepEqual(ctl.poi(), { name: 'Tu zorra', icon: '🛒', x: 12, z: -7, color: '#c98a3a' });
  game.zorra.agarrar();
  assert.equal(ctl.poi(), null);
});

test('el punto para agarrar la zorra es donde estaba el jugador, no el modelo', () => {
  const z = new Zorra(new THREE.Scene(), { crearModelo: () => new THREE.Group() });
  z.colocarDelante(new THREE.Vector3(10, 0, 5), 0);
  assert.deepEqual(z.position.toArray(), [10, 0, 5]);
  assert.ok(Math.abs(z.group.position.z - (5 + 1.9)) < 1e-9);
});

test('al morir empujando se descarta hasta caber sin la zorra y se avisa', () => {
  const game = juego({ costal: false });
  game.zorra.obtener();
  game.inventory.maxWeight = 60;
  game.inventory.items = [{ id: 'chatarra', name: 'Chatarra', weight: 1, value: 900, qty: 50 }];
  let toast = null;
  window.addEventListener('toast', (e) => { toast = e.detail.text; });
  Object.assign(Object.create(ZorraController.prototype), { game }).alMorir();
  assert.equal(game.inventory.totalWeight, 20);
  assert.equal(game.zorra.estado, 'pushing');
  assert.equal(toast, 'Te desmayaste y te desocuparon la zorra');
});

test('al morir con la zorra en el suelo no se descarta nada extra', () => {
  const game = juego({ costal: false });
  game.zorra.obtener(); game.zorra.soltar([1, 0, 1], 0);
  game.inventory.items = [{ id: 'chatarra', name: 'Chatarra', weight: 1, value: 900, qty: 15 }];
  Object.assign(Object.create(ZorraController.prototype), { game }).alMorir();
  assert.equal(game.inventory.totalWeight, 15);
  assert.equal(game.zorra.estado, 'dropped');
});

test('al morir con la zorra en el suelo se recorta en silencio hasta la capacidad sin zorra', () => {
  const game = juego({ costal: false });
  game.zorra.obtener(); game.zorra.soltar([1, 0, 1], 0);
  game.inventory.items = [{ id: 'chatarra', name: 'Chatarra', weight: 1, value: 900, qty: 50 }];
  let toast = null;
  window.addEventListener('toast', (e) => { toast = e.detail.text; });
  Object.assign(Object.create(ZorraController.prototype), { game }).alMorir();
  assert.equal(game.inventory.totalWeight, 20);
  assert.equal(game.zorra.estado, 'dropped');
  assert.equal(toast, null);
});

test('update recalcula la capacidad antes de medir el sobrepeso', () => {
  const game = Object.assign(juego(), { player: { position: new THREE.Vector3(), root: new THREE.Group(), zorraMult: 1, canRun: true, load: 0 } });
  game.zorra.obtener();
  game.inventory.items = [{ id: 'chatarra', name: 'Chatarra', weight: 1, value: 900, qty: 50 }];
  game.inventory.maxWeight = 20; // valor viejo
  let toast = null;
  window.addEventListener('toast', (e) => { toast = e.detail.text; });
  const ctl = Object.assign(Object.create(ZorraController.prototype), {
    game, forcejeo: null, zorraJugador: null, _avisoSobrepeso: 0
  });
  ctl.update(0.016, { axis: { x: 0, z: 0 }, consumePress: () => false });
  assert.equal(game.inventory.maxWeight, 60);
  assert.equal(game.player.zorraMult, 0.7);
  assert.equal(toast, null);
});

// ---------- forcejeo ----------

function entradaConE() {
  return { axis: { x: 0, z: 0 }, consumePress: (code) => code === 'KeyE' };
}

function entradaSinTeclas() {
  return { axis: { x: 0, z: 0 }, consumePress: () => false };
}

function forcejeoEnCurso() {
  const game = Object.assign(juego(), {
    stats: new StatsSystem(),
    look: null,
    player: { position: new THREE.Vector3(), root: new THREE.Group(), zorraMult: 1, canRun: true, load: 0 }
  });
  game._actualizarCapacidad();
  const rival = { estado: new RecicladorEstado(), zorra: { dispose() {} } };
  const barra = { mostrar() {}, ocultar() { this.oculta = true; } };
  const ctl = Object.assign(Object.create(ZorraController.prototype), {
    game, forcejeo: null, rival: null, barra,
    zorraJugador: new Zorra(new THREE.Scene(), { crearModelo: () => new THREE.Group() })
  });
  ctl.iniciarForcejeo(rival);
  return { ctl, game, rival, barra };
}

test('ganar el forcejeo con el inventario casi lleno usa la capacidad con zorra', () => {
  const { ctl, game } = forcejeoEnCurso();
  game.inventory.items = [{ id: 'chatarra', name: 'Chatarra', weight: 1, value: 900, qty: 20 }];
  game._actualizarCapacidad();
  ctl.forcejeo.barra = 0.99;
  ctl.update(1 / 60, entradaConE());
  assert.equal(game.zorra.estado, 'pushing');
  assert.equal(game.inventory.maxWeight, 60);
  assert.ok(game.inventory.totalWeight > 20);
  assert.equal(ctl.forcejeo, null);
});

test('perder el forcejeo cuesta 15 de salud y 10 de ánimo y enoja al reciclador', () => {
  const { ctl, game, rival } = forcejeoEnCurso();
  game.stats.salud = 50; game.stats.animo = 50;
  ctl.update(7, entradaSinTeclas());
  assert.equal(game.stats.salud, 35);
  assert.equal(game.stats.animo, 40);
  assert.equal(ctl.rival, null);
  assert.equal(rival.estado.enojado, true);
});

test('morir en pleno forcejeo lo cancela sin castigo y oculta la barra', () => {
  const { ctl, game, rival, barra } = forcejeoEnCurso();
  game.stats.salud = 50;
  ctl.alMorir();
  assert.equal(ctl.forcejeo, null);
  assert.equal(rival.estado.fase, 'paseando');
  assert.equal(rival.estado.enojado, false);
  assert.equal(barra.oculta, true);
  assert.equal(game.stats.salud, 50);
});

// ---------- tecla G ----------

const entradaCon = (...codes) => ({ axis: { x: 0, z: 0 }, consumePress: (c) => codes.includes(c) });

function controlador({ rival = null } = {}) {
  const game = Object.assign(juego(), {
    stats: new StatsSystem(),
    look: null,
    player: { position: new THREE.Vector3(), root: new THREE.Group(), zorraMult: 1, canRun: true, load: 0 }
  });
  const zorraJugador = new Zorra(new THREE.Scene(), {
    crearModelo: () => new THREE.Group(),
    interactable: () => game.zorra.estado === 'dropped',
    interactuar: () => { game.zorra.agarrar(); }
  });
  const barra = { mostrar() {}, ocultar() {} };
  const ctl = Object.assign(Object.create(ZorraController.prototype), {
    game, forcejeo: null, rival: null, barra, zorraJugador, recicladores: rival ? [rival] : [], _avisoSobrepeso: 0, _posSuelo: new THREE.Vector3()
  });
  return { ctl, game, zorraJugador };
}

test('G empujando suelta la zorra', () => {
  const { ctl, game } = controlador();
  game.zorra.obtener();
  ctl.update(0.016, entradaCon('KeyG'));
  assert.equal(game.zorra.estado, 'dropped');
});

test('G junto a la zorra propia soltada la agarra', () => {
  const { ctl, game, zorraJugador } = controlador();
  game.zorra.obtener(); game.zorra.soltar([0.5, 0, 0], 0);
  zorraJugador.colocarDelante(new THREE.Vector3(0.5, 0, 0), 0);
  ctl.update(0.016, entradaCon('KeyG'));
  assert.equal(game.zorra.estado, 'pushing');
});

test('G lejos de la zorra soltada no hace nada', () => {
  const { ctl, game, zorraJugador } = controlador();
  game.zorra.obtener(); game.zorra.soltar([5, 0, 0], 0);
  zorraJugador.colocarDelante(new THREE.Vector3(5, 0, 0), 0);
  ctl.update(0.016, entradaCon('KeyG'));
  assert.equal(game.zorra.estado, 'dropped');
});

test('E junto a la zorra soltada no hace nada', () => {
  const { ctl, game, zorraJugador } = controlador();
  game.zorra.obtener(); game.zorra.soltar([0.5, 0, 0], 0);
  zorraJugador.colocarDelante(new THREE.Vector3(0.5, 0, 0), 0);
  ctl.update(0.016, entradaCon('KeyE'));
  assert.equal(game.zorra.estado, 'dropped');
});

test('G junto a la zorra desatendida de un reciclador se la lleva', () => {
  let robos = 0;
  const zorraRec = new Zorra(new THREE.Scene(), {
    crearModelo: () => new THREE.Group(),
    interactable: () => true,
    interactuar: () => { robos++; }
  });
  zorraRec.colocarDelante(new THREE.Vector3(1, 0, 0), 0);
  const { ctl, game } = controlador({ rival: { zorra: zorraRec } });
  ctl.update(0.016, entradaCon('KeyG'));
  assert.equal(robos, 1);
  assert.equal(game.zorra.estado, 'none');
});

test('G durante el forcejeo se rinde, aplica el castigo y no suelta ni agarra en el mismo frame', () => {
  const { ctl, game, rival } = forcejeoEnCurso();
  game.stats.salud = 50; game.stats.animo = 50;
  let tocada = 0;
  ctl.zorraJugador = new Zorra(new THREE.Scene(), {
    crearModelo: () => new THREE.Group(), interactable: () => true, interactuar: () => { tocada++; }
  });
  ctl.recicladores = [];
  ctl.update(0.016, entradaCon('KeyG'));
  assert.equal(game.stats.salud, 35);
  assert.equal(game.stats.animo, 40);
  assert.equal(ctl.forcejeo, null);
  assert.equal(rival.estado.enojado, true);
  assert.equal(tocada, 0);
  assert.equal(game.zorra.estado, 'none');
});

test('Escape durante el forcejeo ya no lo cancela', () => {
  const { ctl, game } = forcejeoEnCurso();
  game.stats.salud = 50;
  ctl.update(0.016, entradaCon('Escape'));
  assert.ok(ctl.forcejeo);
  assert.equal(game.stats.salud, 50);
});
