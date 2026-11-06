// Cerrar la pestaña con la plana del arresto o la pantalla de muerte abierta ya no esquiva el castigo: se guarda una
// vez con la marca de lo que falta cobrar y al cargar se cobra lo mismo que Continuar. E importar una partida al
// volante no deja al jugador dentro del carro de antes.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { SaveSystem } from '../src/systems/SaveSystem.js';
import { AutoSave } from '../src/systems/AutoSave.js';
import { CarjackSystem } from '../src/systems/CarjackSystem.js';
import { EncargoSystem } from '../src/systems/EncargoSystem.js';
import { ObjectiveSystem } from '../src/systems/ObjectiveSystem.js';
import { leerCastigoPendiente } from '../src/systems/castigoPendiente.js';

const memoria = () => {
  const datos = new Map();
  return { datos, getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) };
};

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
});

/** Lo justo de Game para morir, caer preso, guardar, cargar e importar, con los sistemas de verdad que pesan. */
function juego(almacen) {
  const serial = (valor = {}) => ({ serialize: () => valor, deserialize() {} });
  const game = Object.assign(Object.create(Game.prototype), {
    save: new SaveSystem(almacen),
    stats: new StatsSystem(), inventory: new InventorySystem(),
    clock: { day: 1, hour: 22, isNight: true, serialize() { return { day: this.day, hour: this.hour }; }, deserialize(d) { Object.assign(this, d); } },
    talents: { ...serial(), getEffect: (k, f) => f }, diseases: { ...serial(), cureAll() { this.curado = true; } },
    player: {
      position: new THREE.Vector3(40, 0, 26), root: new THREE.Group(), equippedWeapon: null, isRagdollActive: false,
      clearVehicleImpact() {}, resetGrounding() {},
    },
    world: { active: null }, look: null, built: {}, costal: false,
    _deathPending: false, _arrestPending: false, _loading: false, isSleeping: false, deathCount: 0,
    creator: { isOpen: false }, steal: { buscado: 2 },
    input: { keys: {}, endFrame() {} }, audio: { updateSteps() {}, setPaused() {}, playPlayerDeath() {} },
    interaction: { boostActive: false, currentTarget: null }, cameraRig: { follow() {} },
    menu: { open(o) { this.opciones = o; }, close() {}, refresh() {} },
    encargos: new EncargoSystem(), objectives: new ObjectiveSystem(),
  });
  game.carjack = new CarjackSystem(game);
  game.autoSave = new AutoSave({ guardar: () => game._save(), puede: () => game._puedeAutoguardar() });
  game.inventory.items = [{ id: 'lata', qty: 4 }, { id: 'pan', qty: 2 }, { id: 'agua', qty: 1 }, { id: 'carton', qty: 3 }];
  return game;
}
const enDisco = (almacen) => JSON.parse(almacen.getItem('habitante-de-calle-save-v1'));

test('preso con 60.000 y el costal lleno: cerrar la pestaña en la plana y volver cobra el arresto', () => {
  const almacen = memoria();
  const game = juego(almacen);
  game.stats.dinero = 60000;
  game._policeArrest();
  game.autoSave.enganchar();
  window.dispatchEvent(new Event('pagehide')); // el guardado solo sigue sin escribir en la plana
  const guardada = enDisco(almacen);
  assert.deepEqual(guardada.castigoPendiente, { tipo: 'arresto', nivel: 2 });

  const vuelta = juego(almacen);
  vuelta._aplicarPartida(vuelta.save.load());
  assert.equal(vuelta.stats.dinero, 0, 'la plata se la llevaron');
  assert.deepEqual(vuelta.inventory.items, [], 'con nivel 2, todo el costal');
  assert.equal(vuelta._estado().castigoPendiente, null, 'cobrado una vez: la marca no se vuelve a guardar');
});

test('lo que se cobra al cargar es lo mismo que cobra Continuar', () => {
  const continuar = juego(memoria());
  continuar.stats.dinero = 9000;
  continuar.steal.buscado = 1;
  continuar.inventory.items.push({ id: 'pegante', qty: 2 });
  continuar._policeArrest();
  continuar._randomWalkablePosition = () => new THREE.Vector3();
  continuar._resetAfterRelocation = () => {};
  continuar._finishArrest();

  const almacen = memoria();
  const cerrada = juego(almacen);
  cerrada.stats.dinero = 9000;
  cerrada.steal.buscado = 1;
  cerrada.inventory.items.push({ id: 'pegante', qty: 2 });
  cerrada._policeArrest();
  const vuelta = juego(almacen);
  vuelta._aplicarPartida(vuelta.save.load());
  assert.equal(vuelta.stats.dinero, continuar.stats.dinero);
  const filas = (inv) => inv.items.map((it) => [it.id, it.qty]);
  assert.deepEqual(filas(vuelta.inventory), filas(continuar.inventory));
  assert.equal(vuelta.inventory.count('pegante'), 0, 'con nivel 1 se llevan el vicio');
  assert.equal(vuelta.inventory.count('lata'), 4, 'y dejan lo demás');
  assert.equal(continuar._estado().castigoPendiente, null);
});

test('muerto: cerrar la pestaña en la pantalla de muerte y volver pierde la mitad del costal y revive', () => {
  const almacen = memoria();
  const game = juego(almacen);
  game.stats.salud = 0;
  assert.equal(game._handleDeath(), true);
  const guardada = enDisco(almacen);
  assert.deepEqual(guardada.castigoPendiente, { tipo: 'muerte' });

  const vuelta = juego(almacen);
  vuelta._aplicarPartida(vuelta.save.load());
  assert.deepEqual(vuelta.inventory.items.map((it) => it.id), ['agua', 'carton'], 'la primera mitad, como al recuperarse');
  assert.ok(vuelta.stats.salud >= 60);
  assert.equal(vuelta._handleDeath(), false, 'no vuelve a morir al cargar');
});

test('una marca rara no cobra nada', () => {
  assert.equal(leerCastigoPendiente(null), null);
  assert.equal(leerCastigoPendiente({ tipo: 'otro' }), null);
  assert.deepEqual(leerCastigoPendiente({ tipo: 'arresto', nivel: 99 }), { tipo: 'arresto', nivel: 3 });
});

test('importar al volante un archivo sin carro, encargos ni objetivos deja al jugador a pie y la cadena desde el principio', () => {
  const game = juego(memoria());
  game.carjack.car = { driven: true, traffic: false, setPlayerDriver(v) { this.conductor = v; } };
  game.carjack.stolen = game.carjack.car;
  game.encargos.racha = 7;
  game.encargos.next(game);
  game.objectives.index = 5;
  let cancelado = 0;
  game.rebusque = { cancelar: () => cancelado++ };
  const archivo = JSON.stringify({
    stats: { dinero: 100, salud: 80 }, clock: { day: 3, hour: 9 }, inventory: { items: [] },
    player: { pos: [100, 0, -50] }, v: 2,
  });
  game._importarTexto(archivo);
  assert.equal(game.carjack.driving, false, 'ya no maneja el carro de antes');
  assert.equal(game.carjack.stolen, null, 'y no queda guardado como suyo');
  assert.deepEqual(game.player.position.toArray(), [100, 0, -50]);
  assert.equal(game.encargos.current, null);
  assert.equal(game.encargos.racha, 0);
  assert.equal(game.objectives.index, 0);
  assert.equal(game._objectivesCatchUp, true);
  assert.equal(cancelado, 1, 'el rebusque a medias se corta');
});
