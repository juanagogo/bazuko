import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { StatsSystem, NEEDS } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { Menu } from '../src/ui/Menu.js';
import { Player } from '../src/entities/Player.js';
import { StealSystem } from '../src/features/steal.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { consejoDeMuerte } from '../src/ui/momentosTextos.js';
import { SaveSystem } from '../src/systems/SaveSystem.js';
import { DiseaseSystem } from '../src/systems/DiseaseSystem.js';
import { Clock } from '../src/core/Clock.js';
import { ITEMS } from '../src/data/items.js';
import { HUD } from '../src/ui/HUD.js';
import { InventoryUI } from '../src/ui/InventoryUI.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fixture() {
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), deathCount: 0, _deathPending: false, _arrestPending: false,
    talents: { getEffect: (key, fallback) => fallback }, clock: { isNight: false },
    player: { position: new THREE.Vector3(40, 0, 26), root: new THREE.Group(),
      receiveVehicleImpact(direction, speed) { this.lastImpact = { direction, speed }; },
      clearVehicleImpact() { this.lastImpact = null; } },
    world: { active: { reserved: { bed: { x: 89, z: 80 }, spawn: { x: 32, z: 32 } } } },
    input: { keys: { KeyW: true }, endFrame() {} },
    audio: { updateSteps() {} },
    interaction: { currentTarget: {}, currentTargetType: 'shop', boostActive: false },
    menu: { isOpen: false, open(options) { this.options = options; this.isOpen = true; }, close() { this.isOpen = false; } },
    creator: { isOpen: false },
    diseases: { hasAny: false, cureAll() { this.hasAny = false; } },
    inventory: new InventorySystem(),
    cameraRig: { follow(position) { this.target = position.clone(); } },
    collisions: null, _save() {},
  });
  game.inventory.items = [{ id: 'papel', qty: 2 }, { id: 'carton', qty: 3 }];
  return game;
}

test('un atropello aplica daño proporcional a la velocidad y protege de golpes repetidos por cuadro', () => {
  const game = fixture(), direction = new THREE.Vector3(1, 0, 0);
  let messages = 0; window.addEventListener('toast', () => messages++);
  game._onVehicleImpact({ speed: 6, direction });
  assert.equal(game.stats.salud, 69);
  assert.equal(game.player.lastImpact.speed, 6);
  assert.equal(game.player.lastImpact.direction, direction);
  game._onVehicleImpact({ speed: 12, direction });
  assert.equal(game.stats.salud, 69);
  assert.equal(messages, 1);
  const slower = fixture(); slower._onVehicleImpact({ speed: 3, direction });
  assert.ok(slower.stats.salud > game.stats.salud);
});

test('un atropello grave pausa la muerte y limpia el golpe solo al recuperar en el cambuche', () => {
  const game = fixture(), position = game.player.position.clone();
  game._onVehicleImpact({ speed: 12, direction: new THREE.Vector3(1, 0, 0) });
  assert.equal(game.stats.salud, 0);
  assert.equal(game._handleDeath(), true);
  assert.equal(game.menu.options.title, 'Me atropellaron');
  assert.ok(game.player.position.equals(position));
  assert.equal(game.deathCount, 1);
  game._handleDeath(); assert.equal(game.deathCount, 1);
  game._respawn();
  assert.equal(game.player.lastImpact, null);
  assert.equal(game._deathCause, null);
  assert.ok(game.stats.salud >= 60);
});

test('la recuperación fatal espera a que termine el vuelo del ragdoll', () => {
  const game = fixture(); game.stats.salud = 0;
  game.player.isRagdollActive = true;
  assert.equal(game._handleDeath(), false);
  assert.equal(game.menu.isOpen, false);
  assert.equal(game.deathCount, 0);
  game.player.isRagdollActive = false;
  assert.equal(game._handleDeath(), true);
  assert.equal(game.deathCount, 1);
});

test('al agotarse la sed, la muerte se pausa sin trasladar al jugador', () => {
  const game = fixture();
  game.stats.sed = 1;
  game.stats.salud = 10;
  const start = game.player.position.clone();
  let deaths = 0;
  window.addEventListener('death', () => deaths++);
  for (let frame = 0; frame < 360 * 60; frame++) {
    if (!game.paused) {
      game.stats.update(1 / 60);
      game._handleDeath();
    }
  }
  assert.equal(game.stats.salud, 0);
  assert.equal(game.stats.sed, 0);
  assert.equal(game.paused, true);
  assert.equal(game.menu.options.dismissible, false);
  assert.deepEqual(game.player.position, start);
  assert.equal(game.inventory.items.length, 2);
  assert.equal(deaths, 1);
  for (let i = 0; i < 100; i++) game._handleDeath();
  assert.equal(deaths, 1);
  assert.equal(game.deathCount, 1);
});

test('solo la recuperación explícita traslada al cambuche una vez y sincroniza cámara y modelo', () => {
  const game = fixture();
  game._respawn();
  assert.deepEqual(game.player.position.toArray(), [40, 0, 26]);
  game.world.active.reserved.respawn = { x: 112.98, z: 97.84 };
  game.world.active.getGroundHeight = () => .08;
  for (const need of NEEDS) game.stats[need] = 0;
  game.diseases.hasAny = true;
  game._handleDeath();
  game._respawn();
  assert.equal(game.paused, false);
  assert.deepEqual(game.player.position.toArray(), [112.98, .08, 97.84]);
  assert.deepEqual(game.player.root.position, game.player.position);
  assert.deepEqual(game.cameraRig.target, game.player.position);
  assert.equal(game.cameraRig._snap, true);
  assert.equal(game.diseases.hasAny, false);
  assert.equal(game.interaction.currentTarget, null);
  assert.deepEqual(game.input.keys, {});
  for (const need of NEEDS) assert.equal(game.stats[need], 60);
  assert.equal(game.inventory.items.length, 1);
  game._respawn();
  assert.equal(game.inventory.items.length, 1);
  // Antes, sed/hambre a 20 y salud a 30 producían otra muerte en 55 s.
  for (let frame = 0; frame < 90 * 60; frame++) {
    game.stats.update(1 / 60);
    assert.equal(game._handleDeath(), false);
  }
  assert.ok(game.stats.salud >= 60);
});

test('Escape y el fondo no pueden omitir la pantalla de muerte; otros menús siguen cerrando', () => {
  const menu = Object.assign(Object.create(Menu.prototype), {
    root: { hidden: false }, _dismissible: false
  });
  menu.dismiss();
  assert.equal(menu.isOpen, true);
  menu._dismissible = true;
  menu.dismiss();
  assert.equal(menu.isOpen, false);
});

test('la captura policial confisca todo y reaparece en otro punto', () => {
  const game = fixture();
  game.stats.dinero = 12000;
  const start = game.player.position.clone();
  game.world.active.isWalkableAt = () => true;
  game.world.active.width = 40;
  game.world.active.height = 40;
  let rolls = 0;
  const originalRandom = Math.random;
  Math.random = () => {
    rolls += 1;
    return rolls === 1 ? 0.9 : 0.1;
  };
  try {
    game._policeArrest();
    assert.equal(game.paused, true);
    assert.equal(game.menu.options.dismissible, false);
    assert.equal(game.inventory.items.length, 2);
    assert.equal(game.stats.dinero, 12000);
    game._finishArrest();
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(game.paused, false);
  assert.equal(game.inventory.items.length, 0);
  assert.equal(game.stats.dinero, 0);
  assert.ok(game.player.position.distanceTo(start) > 1);
  assert.deepEqual(game.player.root.position, game.player.position);
  assert.equal(game.interaction.currentTarget, null);
  game._finishArrest();
  assert.equal(game.inventory.items.length, 0);
});

test('arresto desde el agua restaura el Player real en la calle y termina amenazas y acciones', () => {
  const game = fixture();
  game.player = new Player(new THREE.Scene(), { axis: {}, consumePress: () => false }, game.stats, game.audio);
  game.player.position.set(40, -1.2, 262);
  game.player.isSwimming = game.player.inWater = true;
  game.player.waterMovement.state = 'swimming';
  game.player.waterDepth = 5;
  game.player.jumpVelocity = -3;
  game.player.isGrounded = false;
  game.player.groundSurface = { layer: 'bridge', height: 7.82 };
  game.player.action = 'saltar'; game.player.actionTimer = .3;
  game.player.velocity.set(2, -3, 1);
  game.world.active.getSpawnGrid = () => [{ x: 80, z: 260 }];
  game.world.active.getGroundHeight = () => 7.82;
  game.world.active.getMovementGroundHeight = (_x, _z, y) => { assert.equal(y, 0); return .08; };
  const finished = [];
  game.waterEffects = { reset: () => finished.push('agua') };
  game.traffic = { endPursuit: () => finished.push('policia') };
  game.roadRage = { reset: () => finished.push('conductor') };
  game.limpieza = { reset: () => finished.push('agresores') };
  game.substanceEffects = { end: () => finished.push('efectos') };
  game.psychosis = { clearInduced: () => finished.push('paranoia') };
  game.steal = { buscado: 3, targetNpc: {}, _endMinigame: (_success, reason) => assert.equal(reason, 'cancel') };
  game._arrestPending = true;
  game._finishArrest();
  assert.deepEqual(game.player.position.toArray(), [80, .08, 260]);
  assert.equal(game.player.isSwimming, false); assert.equal(game.player.inWater, false);
  assert.equal(game.player.waterMovement.state, 'dry'); assert.equal(game.player.waterDepth, 0);
  assert.equal(game.player.jumpVelocity, 0); assert.equal(game.player.isGrounded, true);
  assert.equal(game.player.groundSurface, null); assert.equal(game.player.action, null);
  assert.equal(game.player.actionTimer, 0); assert.equal(game.player.velocity.length(), 0);
  assert.equal(game.steal.buscado, 0); assert.equal(game.steal.targetNpc, null);
  assert.deepEqual(finished, ['agua', 'policia', 'conductor', 'agresores', 'efectos', 'paranoia']);
  game.player.dispose();
});

test('una muerte pendiente tiene prioridad sobre un aviso policial', () => {
  const game = fixture(); game.stats.salud = 0;
  game._policeArrest();
  assert.equal(game._arrestPending, false);
  assert.equal(game._handleDeath(), true);
  assert.equal(game._deathPending, true);
});

// ---------- de qué murió ----------
const sinEnfermedad = { getAggregatedEffects: () => ({ healthDrain: 0, mentalDrain: 0, speedMultiplier: 1, hungerDrainMultiplier: 1, energyDrainMultiplier: 1, hygieneDrain: 0, canEat: true }) };
const enfermo = { getAggregatedEffects: () => ({ ...sinEnfermedad.getAggregatedEffects(), healthDrain: .5 }) };
/** Deja correr las necesidades hasta morir, como el bucle: un cuadro de 0,1 s tras otro. */
function hastaMorir(game, { diseases = sinEnfermedad, clock = { isNight: false }, weather = { isRaining: false } } = {}) {
  for (let t = 0; t < 3600 && game.stats.salud > 0; t += .1) game.stats.update(.1, null, diseases, clock, null, weather);
  assert.equal(game.stats.salud, 0);
  assert.equal(game._handleDeath(), true);
  return { titulo: game.menu.options.title, consejo: consejoDeMuerte(game.stats.danoPor, game.stats) };
}

test('si me mata la sed una noche de lluvia sin calor, el cartón culpa a la sed y no al frío', () => {
  const game = fixture();
  Object.assign(game.stats, { sed: 0, calor: 0, salud: 20 });
  const { titulo, consejo } = hastaMorir(game, { clock: { isNight: true }, weather: { isRaining: true } });
  assert.equal(game.stats.isFreezing, true, 'murió con frío');
  assert.equal(titulo, 'Me mató la sed');
  assert.match(consejo, /agua/);
});

test('si me mata una enfermedad con la energía en 0, el cartón culpa a la enfermedad y no al cansancio', () => {
  const game = fixture();
  Object.assign(game.stats, { energia: 0, salud: 20 });
  const { titulo, consejo } = hastaMorir(game, { diseases: enfermo });
  assert.equal(game.stats.energia, 0);
  assert.equal(titulo, 'Me mató la enfermedad');
  assert.match(consejo, /remedio/);
});

test('el hambre que ya pasó no se lleva la culpa de lo que mató después', () => {
  const game = fixture();
  Object.assign(game.stats, { hambre: 0, salud: 30 });
  for (let i = 0; i < 100; i++) game.stats.update(.1, null, sinEnfermedad, { isNight: false }, null, { isRaining: false });
  assert.equal(game.stats.danoPor, 'hambre');
  game.stats.hambre = 80; // comió
  const { titulo } = hastaMorir(game, { diseases: enfermo });
  assert.equal(titulo, 'Me mató la enfermedad');
});

test('si me matan a golpes al robar, el cartón lo dice: el raponazo que se defiende y el retrovisor pillado', () => {
  const raponazo = fixture();
  raponazo.stats.salud = 5;
  const robo = Object.assign(Object.create(StealSystem.prototype), { game: raponazo, buscado: 0, cooldown: 0, _calma: 0 });
  robo.game.player.position = new THREE.Vector3();
  robo._toast = () => {};
  robo.executeRoboDirecto({ look: { real: { edad: 'adulto' } }, stance: null, alarmedByTheft() {} });
  assert.equal(raponazo._handleDeath(), true);
  assert.equal(raponazo.menu.options.title, 'Me mataron a golpes');

  const retrovisor = fixture();
  Object.assign(retrovisor.stats, { salud: 10, sed: 0 }); // con sed, para que no se la culpe de lo que no fue
  const ix = Object.assign(Object.create(InteractionSystem.prototype), {
    talents: retrovisor.talents, stats: retrovisor.stats, inventory: retrovisor.inventory, player: retrovisor.player, audio: null,
  });
  ix._executeCarTheft({ steal: () => ({ items: [], caught: true }) });
  assert.equal(retrovisor._handleDeath(), true);
  assert.equal(retrovisor.menu.options.title, 'Me mataron a golpes');
});

/** Unos cuadros de necesidades sin nada que quite salud. */
const sinDano = (game, cuadros = 10) => {
  for (let i = 0; i < cuadros; i++) game.stats.update(.1, null, sinEnfermedad, { isNight: false }, null, { isRaining: false });
};

test('la sed que ya pasó no se lleva la culpa si después me mata lo que me metí', () => {
  const game = fixture();
  Object.assign(game.stats, { sed: 0, salud: 30 });
  sinDano(game, 100);
  assert.equal(game.stats.danoPor, 'sed');
  game.stats.sed = 100; // bebió
  sinDano(game);
  assert.equal(game.stats.danoPor, null, 'ya nada quita salud: la sed deja de ser la causa');
  game.stats.salud = Math.max(0, 4 - 6); // la pipa de basuco con la salud en 4, que no pasa por las necesidades
  assert.equal(game._handleDeath(), true);
  assert.equal(game.menu.options.title, 'Me quedé sin salud');
  assert.notEqual(consejoDeMuerte(game.stats.danoPor, game.stats), consejoDeMuerte('sed', game.stats));
});

test('sobrevivir a un peatón que se defiende no deja «a golpes» para lo que mate después', () => {
  const game = fixture();
  game.stats.salud = 40;
  const robo = Object.assign(Object.create(StealSystem.prototype), { game, buscado: 0, cooldown: 0, _calma: 0, _toast() {} });
  robo.executeRoboDirecto({ look: { real: { edad: 'adulto' } }, stance: null, alarmedByTheft() {} });
  assert.equal(game.stats.danoPor, 'pelea');
  assert.ok(game.stats.salud > 0);
  sinDano(game);
  assert.equal(game.stats.danoPor, null);
  game.stats.salud = 0;
  assert.equal(game._handleDeath(), true);
  assert.notEqual(game.menu.options.title, 'Me mataron a golpes');
});

test('en el cuadro de la muerte la causa no se borra aunque las necesidades ya no quiten salud', () => {
  const game = fixture();
  Object.assign(game.stats, { salud: 5, hambre: 40 }); // con hambre, pero sin que quite salud ni deje reponerla
  const robo = Object.assign(Object.create(StealSystem.prototype), { game, buscado: 0, cooldown: 0, _calma: 0, _toast() {} });
  robo.executeRoboDirecto({ look: { real: { edad: 'adulto' } }, stance: null, alarmedByTheft() {} });
  assert.equal(game.stats.salud, 0);
  sinDano(game, 1); // si las necesidades corren otra vez antes de abrir el cartón, la causa sigue
  assert.equal(game.stats.danoPor, 'pelea');
  assert.equal(game._handleDeath(), true);
  assert.equal(game.menu.options.title, 'Me mataron a golpes');
});

test('la causa no pasa a la vida siguiente', () => {
  const game = fixture();
  Object.assign(game.stats, { sed: 0, salud: 1 });
  hastaMorir(game);
  assert.equal(game.stats.danoPor, 'sed');
  game._respawn();
  assert.equal(game.stats.danoPor, null);
});

// ---------- recargar la página con el cartón abierto ----------
/** El juego de la prueba con su partida de verdad (SaveSystem sobre un localStorage en memoria). */
function conPartida(game) {
  const disco = new Map();
  globalThis.localStorage = { getItem: k => disco.get(k) ?? null, setItem: (k, v) => disco.set(k, String(v)), removeItem: k => disco.delete(k) };
  delete game._save;
  Object.assign(game, {
    save: new SaveSystem(), clock: new Clock({ hour: 15 }), diseases: new DiseaseSystem(), inventory: new InventorySystem(),
    talents: { ...game.talents, serialize: () => ({}), deserialize() {} },
  });
  for (const [id, qty] of [['carton', 2], ['lata', 3], ['pilas', 1], ['cable', 1]]) assert.ok(game.inventory.add(ITEMS[id], qty));
  game.stats.dinero = 12000;
  game._save(); // la última vez que se guardó: durmió, comió en el comedor o guardó en la pausa
  return game;
}
/** F5: un juego nuevo que lee la partida guardada, como al abrir la página. */
function recargar() {
  const game = Object.assign(Object.create(Game.prototype), {
    stats: new StatsSystem(), clock: new Clock(), inventory: new InventorySystem(), diseases: new DiseaseSystem(),
    talents: { deserialize() {} }, world: {}, player: { position: new THREE.Vector3() }, save: new SaveSystem(),
  });
  assert.equal(game._loadIfSave(), true);
  return game;
}
const filas = game => game.inventory.items.map(it => it.id);

test('recargar con la plana del arresto abierta no devuelve la plata ni el costal, y seguir no cobra dos veces', () => {
  const game = conPartida(fixture());
  game._policeArrest();
  assert.equal(game.stats.dinero, 12000, 'mientras se lee la plana, nada ha cambiado');
  for (let vez = 0; vez < 2; vez++) {
    const recargada = recargar();
    assert.equal(recargada.stats.dinero, 0);
    assert.deepEqual(filas(recargada), []);
  }

  game._finishArrest();
  assert.equal(game.stats.dinero, 0);
  assert.equal(JSON.parse(localStorage.getItem('habitante-de-calle-save-v1')).castigo, null, 'pagado: la partida ya no lo debe');
  const despues = recargar();
  assert.equal(despues.stats.dinero, 0);
  assert.deepEqual(filas(despues), []);
});

test('recargar con el cartón de la muerte abierto se lleva la mitad del costal una sola vez y no vuelve a matar', () => {
  const game = conPartida(fixture());
  Object.assign(game.stats, { salud: 0, sed: 0 });
  game.diseases.active = { gripe: { t: 0 } };
  assert.equal(game._handleDeath(), true);
  assert.deepEqual(filas(game), ['carton', 'lata', 'pilas', 'cable'], 'mientras se lee el cartón, nada ha cambiado');
  for (let vez = 0; vez < 2; vez++) {
    const recargada = recargar();
    assert.deepEqual(filas(recargada), ['pilas', 'cable']);
    assert.equal(recargada.stats.salud, 60, 'vuelve como del cambuche: no se muere otra vez al cargar');
    assert.equal(recargada.stats.sed, 60);
    assert.equal(recargada.diseases.hasAny, false);
    assert.equal(recargada.stats.dinero, 12000, 'morir no quita la plata');
  }

  game._respawn();
  assert.deepEqual(filas(game), ['pilas', 'cable']);
  const despues = recargar();
  assert.deepEqual(filas(despues), ['pilas', 'cable'], 'la mitad de la mitad sería cobrar dos veces');
  assert.equal(despues.stats.salud, 60);
});

test('recargar con el cuerpo aún en el aire tras un atropello mortal también paga la muerte', () => {
  const game = conPartida(fixture());
  game._onVehicleImpact({ speed: 12, direction: new THREE.Vector3(1, 0, 0) });
  game.player.isRagdollActive = true; // el carro lo lanzó: el cartón espera de 2 a 5 s a que caiga
  assert.equal(game.stats.salud, 0);
  assert.equal(game._handleDeath(), false);
  assert.equal(game.menu.isOpen, false);
  for (let vez = 0; vez < 2; vez++) {
    const recargada = recargar();
    assert.deepEqual(filas(recargada), ['pilas', 'cable'], 'F5 en pleno vuelo no devuelve la partida de antes del golpe');
    assert.equal(recargada.stats.salud, 60);
    assert.equal(recargada.stats.dinero, 12000);
  }

  game.player.isRagdollActive = false; // cayó: ahora sí, el cartón
  assert.equal(game._handleDeath(), true);
  assert.equal(game.menu.options.title, 'Me atropellaron');
  game._respawn();
  assert.deepEqual(filas(recargar()), ['pilas', 'cable'], 'seguir desde el cartón no cobra otra vez');
});

/** Usa una cosa del costal como la tecla o el panel: los mismos efectos del juego. */
function usar(game, id) {
  window.__game = game;
  game.audio.play = () => {};
  Object.assign(Object.create(HUD.prototype), { _toast() {} })._useItem(id, game.inventory);
}

test('si un vendaje lo levanta antes de caer, la partida deja de deber la muerte', () => {
  const game = conPartida(fixture());
  assert.ok(game.inventory.add(ITEMS.vendaje, 1));
  game._onVehicleImpact({ speed: 12, direction: new THREE.Vector3(1, 0, 0) });
  game.player.isRagdollActive = true;
  assert.equal(game._handleDeath(), false);
  usar(game, 'vendaje'); // con la tecla del vendaje, en pleno vuelo
  assert.equal(game.stats.salud, 30);
  assert.equal(game._handleDeath(), false);
  const recargada = recargar();
  assert.deepEqual(filas(recargada), ['carton', 'lata', 'pilas', 'cable'], 'sigue vivo: no se cobra una muerte que no hubo');
  assert.equal(recargada.stats.salud, 30);
});

test('morir con el costal abierto queda marcado aunque el cartón espere a que se cierre', () => {
  const game = conPartida(fixture());
  assert.ok(game.inventory.add(ITEMS.pegante, 1));
  game.stats.salud = 3;
  window.__game = game;
  game.audio.play = () => {};
  game.hud = Object.assign(Object.create(HUD.prototype), { _toast() {} });
  // El costal abierto pone el mundo en pausa: el bucle no mira la muerte hasta cerrarlo.
  const costal = Object.assign(Object.create(InventoryUI.prototype), { game, inv: game.inventory, isOpen: true, _feedback() {} });
  game.inventoryUI = costal;
  assert.equal(game.paused, true);
  costal._useItem('pegante');
  assert.equal(game.stats.salud, 0);
  assert.equal(game.menu.isOpen, false, 'el cartón sale al cerrar el costal');
  assert.deepEqual(filas(recargar()), ['pilas', 'cable'], 'F5 con el costal abierto no deshace la muerte');
});

test('una partida vieja, sin la marca del castigo, carga tal cual', () => {
  const game = conPartida(fixture());
  const vieja = JSON.parse(localStorage.getItem('habitante-de-calle-save-v1'));
  delete vieja.castigo;
  localStorage.setItem('habitante-de-calle-save-v1', JSON.stringify(vieja));
  const cargada = recargar();
  assert.equal(cargada.stats.dinero, 12000);
  assert.deepEqual(filas(cargada), filas(game));
  assert.equal(cargada.stats.salud, game.stats.salud);
});
