// El modo trucos: se prende con ?trucos, cambia el estado del juego y no escribe la partida.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../src/core/game.js';
import { StatsSystem, NEEDS } from '../src/systems/StatsSystem.js';
import { ITEMS } from '../src/data/items.js';
import { CAMBUCHE } from '../src/data/cambuche.js';
import { CheatMode, trucosActivos, destinosDeZona, DINERO_TRUCO, QTY_TRUCO } from '../src/core/trucos.js';
import { ZONA_NOMBRES } from '../src/ui/ZonaAviso.js';
import { StealSystem } from '../src/features/steal.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';

test('el modo trucos solo se prende con ?trucos en la dirección', () => {
  assert.equal(trucosActivos('?trucos'), true);
  assert.equal(trucosActivos('?aspecto=realista&trucos'), true);
  assert.equal(trucosActivos(''), false);
  assert.equal(trucosActivos('?trucos2'), false);
  assert.equal(trucosActivos('?otro=1'), false);
});

const juegoFalso = (over = {}) => Object.assign({
  stats: { dinero: 0, invulnerable: false, ...Object.fromEntries(NEEDS.map((n) => [n, 5])) },
  inventory: { maxWeight: 20, items: {}, count(id) { return this.items[id] ?? 0; }, add(item, qty) { this.items[item.id] = this.count(item.id) + qty; return true; } },
  clock: { hour: 22 },
  weather: { weather: 'nublado', setWeather(id) { this.weather = id; } },
  cambuche: { built: null, setBuilt(b) { this.built = b; } },
  traffic: { wantedLevel: 3, ended: false, endPursuit() { this.ended = true; } },
  steal: { buscado: 2 },
  interaction: {},
  built: {},
  teleportTo(x, z) { this.teleported = { x, z }; },
}, over);

test('las necesidades se clavan al máximo, de una y sostenidas', () => {
  const game = juegoFalso();
  const cheats = new CheatMode(game);
  cheats.llenarTodo();
  for (const need of NEEDS) assert.equal(game.stats[need], 100, need);
  game.stats.hambre = 1;
  cheats.setNecesidades(true);
  cheats.update();
  assert.equal(game.stats.hambre, 100, 'prendido, el update lo vuelve a llenar');
});

test('la plata y el costal se llenan sin tocar el cambuche', () => {
  const game = juegoFalso();
  const cheats = new CheatMode(game);
  cheats.darDinero();
  assert.equal(game.stats.dinero, DINERO_TRUCO);
  cheats.darObjetos();
  for (const id of Object.keys(ITEMS)) assert.equal(game.inventory.count(id), QTY_TRUCO, id);
  assert.equal(game.cambuche.built, null, 'el costal no construye');
  assert.deepEqual(game.built, {}, 'el costal no marca piezas');
});

test('el truco del cambuche lo construye y mejora completo, solo al pedirlo', () => {
  const game = juegoFalso();
  const cheats = new CheatMode(game);
  cheats.construirCambuche();
  for (const piece of CAMBUCHE) assert.equal(game.built[piece.id], true, piece.id);
  assert.deepEqual(game.cambuche.built, game.built);
});

test('la policía se calma y la invisibilidad deja ciego al que avisa', () => {
  const game = juegoFalso();
  const cheats = new CheatMode(game);
  cheats.calmarPolicia();
  assert.equal(game.traffic.wantedLevel, 0);
  assert.equal(game.steal.buscado, 0);
  assert.equal(game.traffic.ended, true);
  cheats.setInvisible(true);
  assert.equal(game.interaction.policeBlind, true);
  cheats.setInvisible(false);
  assert.equal(game.interaction.policeBlind, false);
});

test('la invulnerabilidad no deja bajar la salud', () => {
  const stats = new StatsSystem();
  const cheats = new CheatMode(juegoFalso({ stats }));
  cheats.setInvulnerable(true);
  stats.salud = 40;
  assert.equal(stats.salud, 100, 'no baja');
  stats.salud = 120;
  assert.equal(stats.salud, 100, 'no pasa de 100');
  cheats.setInvulnerable(false);
  stats.salud = 40;
  assert.equal(stats.salud, 40, 'apagado vuelve a bajar');
});

test('reloj, clima y viaje usan los sistemas del juego', () => {
  const game = juegoFalso();
  const cheats = new CheatMode(game);
  cheats.ponerHora(3);
  assert.equal(game.clock.hour, 3);
  cheats.ponerClima('tormenta');
  assert.equal(game.weather.weather, 'tormenta');
  cheats.teletransportar({ name: 'x', x: 10, z: 20 });
  assert.deepEqual(game.teleported, { x: 10, z: 20 });
});

test('los destinos salen de las zonas del mapa y del cambuche', () => {
  const district = {
    getSpawnGrid: () => [{ x: 10, z: 10 }, { x: 300, z: 55 }, { x: 300, z: 200 }],
    _zoneAt: (x, z) => (x >= 267 ? (z < 121 ? 'candelaria' : 'chapinero') : 'andenes'),
    reserved: { spawn: { x: 112.98, z: 97.84 }, dealer: { x: 14, z: 22 } },
  };
  const destinos = destinosDeZona(district);
  const nombres = Object.values(ZONA_NOMBRES);
  for (const destino of destinos) assert.ok(nombres.includes(destino.name) || destino.name === 'Cambuche');
  assert.equal(destinos.at(-1).name, 'Cambuche');
  assert.deepEqual(destinos.at(-1), { name: 'Cambuche', x: 112.98, z: 97.84 });
  assert.ok(destinos.some((d) => d.name === 'La Candelaria' && d.x === 300));
  // El Cartucho no tiene punto libre en la rejilla: cae donde el jíbaro.
  assert.deepEqual(destinos.find((d) => d.name === 'El Cartucho'), { name: 'El Cartucho', x: 14, z: 22 });
});

test('la invisibilidad corta el aviso a la patrulla y el arresto', () => {
  const game = {
    cheats: { invisible: true },
    traffic: { wantedLevel: 0, llamadas: 0, alertForTheft() { this.llamadas++; return true; } },
    player: { position: { x: 0, z: 0 } }, stats: {}, inventory: {},
  };
  const steal = new StealSystem(game);
  steal.buscado = 2;
  steal._alertPolice();
  assert.equal(game.traffic.llamadas, 0, 'nadie llama a la patrulla');
  assert.equal(game.traffic.wantedLevel, 0);
  game.cheats.invisible = false;
  steal._alertPolice();
  assert.equal(game.traffic.llamadas, 1);
  assert.equal(game.traffic.wantedLevel, 2);

  const arresto = Object.assign(Object.create(Game.prototype), {
    _arrestPending: false, _deathPending: false, stats: { salud: 80 }, cheats: { invisible: true },
  });
  arresto._policeArrest();
  assert.equal(arresto._arrestPending, false, 'invisible no va preso');
});

test('el robo en un carro no avisa a la patrulla si está ciego', () => {
  const eventos = [];
  globalThis.window = new EventTarget();
  globalThis.window.addEventListener('police-chase', () => eventos.push('chase'));
  const sys = Object.assign(Object.create(InteractionSystem.prototype), {
    policeBlind: true,
    talents: { getEffect: () => 1 },
    audio: { play() {}, playMovingTheft() {}, playCarAlarm() {} },
    inventory: { add: () => true },
    stats: { salud: 100, dinero: 0, addXP() {} },
    getTraffic: () => ({ alertForTheft: () => { throw new Error('no debería llamar'); } }),
    player: { position: { x: 0, z: 0 } },
  });
  sys._stealCar({ steal: () => ({ items: ['retrovisor'], caught: false }), traffic: true });
  assert.deepEqual(eventos, []);
});

test('con trucos prendidos la partida no se guarda', () => {
  const serial = { serialize: () => ({}) };
  const base = {
    save: { veces: 0, save() { this.veces++; return true; } },
    stats: serial, clock: serial, inventory: serial, talents: serial, diseases: serial,
    player: { position: { toArray: () => [0, 0, 0] }, equippedWeapon: null },
    world: { active: null }, look: {}, built: {}, costal: false, radio: null, dog: null, cart: null, gps: null,
    _loading: false, _deathPending: false, _arrestPending: false, isSleeping: false, creator: { isOpen: false },
  };
  const stats = { salud: 80, serialize: () => ({}) };
  const conTrucos = Object.assign(Object.create(Game.prototype), { ...base, stats, cheats: {} });
  assert.equal(conTrucos._puedeAutoguardar(), false);
  assert.equal(conTrucos._save(), false);
  assert.equal(conTrucos.save.veces, 0, 'no escribe nada');
  const normal = Object.assign(Object.create(Game.prototype), { ...base, stats, cheats: null });
  assert.equal(normal._puedeAutoguardar(), true);
  assert.equal(normal._save(), true);
  assert.equal(normal.save.veces, 1);
});
