// Cargar o importar una partida no puede dejar cosas de otra: el carro que la Policía se llevó al volante (cerrando la
// pestaña en la plana), los carros robados en la sesión de antes, el día de rebusque de la sesión que importa y lo
// cobrado cuidando carros antes de importar. Car se cambia por un doble: el de verdad necesita un canvas.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

class CarroDoble {
  constructor(scene, posicion, rot, { kind = 'sedan', variant = 0 } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(posicion);
    this.group.rotation.y = rot;
    this.kind = kind ?? 'sedan';
    this.variant = variant ?? 0;
    this.length = 4.2;
    this.width = 1.8;
    this.traffic = false;
  }
  get position() { return this.group.position; }
  setPlayerDriver() {}
  setDriverInside() {}
}
mock.module('../src/entities/Car.js', { namedExports: { Car: CarroDoble } });

const { Game } = await import('../src/core/game.js');
const { StatsSystem } = await import('../src/systems/StatsSystem.js');
const { InventorySystem } = await import('../src/systems/InventorySystem.js');
const { SaveSystem } = await import('../src/systems/SaveSystem.js');
const { CarjackSystem } = await import('../src/systems/CarjackSystem.js');
const { EncargoSystem } = await import('../src/systems/EncargoSystem.js');
const { ObjectiveSystem } = await import('../src/systems/ObjectiveSystem.js');
const { RebusqueSystem } = await import('../src/systems/RebusqueSystem.js');
const { REBUSQUE } = await import('../src/data/rebusque.js');

const memoria = () => {
  const datos = new Map();
  return { datos, getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) };
};

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
});

/** Lo justo de Game para caer preso, guardar, cargar e importar (como en castigo-pendiente.test.js), con carros. */
function juego(almacen) {
  const serial = (valor = {}) => ({ serialize: () => valor, deserialize() {} });
  const game = Object.assign(Object.create(Game.prototype), {
    save: new SaveSystem(almacen),
    stats: new StatsSystem(), inventory: new InventorySystem(),
    clock: { day: 1, hour: 22, isNight: true, serialize() { return { day: this.day, hour: this.hour }; }, deserialize(d) { Object.assign(this, d); } },
    talents: { ...serial(), getEffect: (k, f) => f }, diseases: { ...serial(), cureAll() {} },
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
    sceneMgr: { scene: new THREE.Scene() }, cars: [], traffic: { playerVehicle: null, setParkedCars() {} },
  });
  game.carjack = new CarjackSystem(game);
  return game;
}

/** Se sube a un carro estacionado de la calle, como lo deja CarjackSystem.enter. */
function alVolante(game, carro) {
  game.cars.push(carro);
  game.carjack.car = carro;
  game.carjack.stolen = carro;
  game.carjack._owned.add(carro);
  carro.driven = true;
}
const carro = (kind = 'sedan', x = 40, z = 26) => new CarroDoble(null, new THREE.Vector3(x, 0, z), 0, { kind });

test('preso al volante: cerrar la pestaña en la plana y volver pierde el carro, igual que Continuar', () => {
  const continuar = juego(memoria());
  alVolante(continuar, carro());
  continuar._policeArrest();
  continuar._randomWalkablePosition = () => new THREE.Vector3();
  continuar._resetAfterRelocation = () => {};
  continuar._finishArrest();
  assert.equal(continuar.carjack.serialize(), null, 'Continuar: la partida ya no lo guarda');

  const almacen = memoria();
  const cerrada = juego(almacen);
  const robado = carro();
  alVolante(cerrada, robado);
  cerrada._policeArrest();
  const guardada = JSON.parse(almacen.getItem('habitante-de-calle-save-v1'));
  assert.ok(guardada.carroRobado, 'en la plana todavía es el robado');
  assert.equal(guardada.castigoPendiente.alVolante, true, 'la marca dice que lo cogieron manejando');

  const vuelta = juego(almacen);
  vuelta._aplicarPartida(vuelta.save.load());
  assert.equal(vuelta.stats.dinero, 0);
  const estacionado = vuelta.cars[0];
  assert.ok(estacionado, 'el carro queda donde lo cogieron');
  assert.equal(vuelta.carjack.serialize(), continuar.carjack.serialize(), 'lo mismo que Continuar: no se guarda');
  assert.equal(vuelta.carjack._isOwn(estacionado), false, 'subirse otra vez es otro robo');
});

test('preso a pie con un carro robado estacionado: Continuar y recargar se lo dejan', () => {
  const continuar = juego(memoria());
  alVolante(continuar, carro());
  continuar.carjack.reset(); // se bajó y lo dejó estacionado
  continuar._policeArrest();
  continuar._randomWalkablePosition = () => new THREE.Vector3();
  continuar._resetAfterRelocation = () => {};
  continuar._finishArrest();
  assert.ok(continuar.carjack.serialize(), 'Continuar no se lleva un carro que no manejaba');

  const almacen = memoria();
  const cerrada = juego(almacen);
  alVolante(cerrada, carro());
  cerrada.carjack.reset();
  cerrada._policeArrest();
  const vuelta = juego(almacen);
  vuelta._aplicarPartida(vuelta.save.load());
  assert.ok(vuelta.carjack.serialize(), 'recargar tampoco');
  assert.equal(vuelta.carjack._isOwn(vuelta.cars[0]), true);
});

test('importar no deja como suyos los carros robados en la sesión de antes, y rehace el carro del tipo guardado', () => {
  const game = juego(memoria());
  const taxi = carro('taxi', 5, 5), otro = carro('sedan', 9, 9);
  alVolante(game, otro);
  game.carjack.reset();
  alVolante(game, taxi);
  game.carjack.reset();
  const base = { stats: { dinero: 100, salud: 80 }, clock: { day: 3, hour: 9 }, inventory: { items: [] }, player: { pos: [100, 0, -50] }, v: 2 };
  game._importarTexto(JSON.stringify(base));
  assert.equal(game.carjack._isOwn(taxi), false, 'el taxi no es de la partida importada');
  assert.equal(game.carjack._isOwn(otro), false);

  alVolante(game, taxi);
  game.carjack.reset();
  game._importarTexto(JSON.stringify({ ...base, carroRobado: { pos: [100, 0, 100], rot: 0, kind: 'camioneta', variant: 0 } }));
  const suyo = game.carjack.stolen;
  assert.equal(suyo?.kind, 'camioneta', 'el carro guardado, no el taxi movido');
  assert.deepEqual(suyo.position.toArray(), [100, 0, 100]);
  assert.deepEqual(taxi.position.toArray(), [5, 0, 5], 'el taxi se queda donde estaba');
  assert.equal(game.carjack._isOwn(taxi), false);
  assert.equal(game.carjack._isOwn(suyo), true);
});

test('si el archivo no se puede aplicar, el carro robado de antes vuelve a ser suyo sin quedar repetido', () => {
  const game = juego(memoria());
  const taxi = carro('taxi', 5, 5);
  alVolante(game, taxi);
  game.carjack.reset();
  const encargos = game.encargos.deserialize.bind(game.encargos);
  let veces = 0;
  // Falla después de rehacer el carro del archivo, como cualquier error a mitad de cargar.
  game.encargos.deserialize = (d) => { if (veces++ === 0) throw new Error('dañado'); return encargos(d); };
  game._importarTexto(JSON.stringify({
    stats: { dinero: 100, salud: 80 }, clock: { day: 3, hour: 9 }, inventory: { items: [] }, player: { pos: [100, 0, -50] }, v: 2,
    carroRobado: { pos: [100, 0, 100], rot: 0, kind: 'camioneta', variant: 0 },
  }));
  assert.equal(veces, 2, 'se volvió a la partida que había');
  assert.equal(game.carjack.stolen, taxi, 'el mismo taxi, no uno nuevo');
  assert.equal(game.cars.filter((c) => c.kind === 'taxi').length, 1, 'sin un taxi encima del otro');
  assert.equal(game.cars.filter((c) => c.kind === 'camioneta').length, 0, 'la camioneta del archivo no se queda en la calle');
  assert.deepEqual(game.cars, [taxi]);
  assert.deepEqual(taxi.position.toArray(), [5, 0, 5]);
  assert.equal(game.carjack._isOwn(taxi), true);
});

test('si el archivo no se puede aplicar, el carro robado que traía se da de baja como uno de la flota que se va', () => {
  const game = juego(memoria());
  const registrados = new Set(), descartados = new Set(), parqueados = [];
  game.interaction = { ...game.interaction, register: (c) => registrados.add(c), unregister: (c) => registrados.delete(c) };
  game.renderer = { culling: { register: (g) => descartados.add(g), unregister: (g) => descartados.delete(g) } };
  game.traffic.setParkedCars = (cars) => parqueados.push(cars.slice());
  let liberados = 0;
  CarroDoble.prototype.dispose = function () { liberados++; this._disposed = true; };
  try {
    const sedan = carro('sedan', 9, 9);
    game.cars.push(sedan); // uno estacionado de la calle, que no es de nadie
    let veces = 0;
    const encargos = game.encargos.deserialize.bind(game.encargos);
    game.encargos.deserialize = (d) => { if (veces++ === 0) throw new Error('dañado'); return encargos(d); };
    game._importarTexto(JSON.stringify({
      stats: { dinero: 100, salud: 80 }, clock: { day: 3, hour: 9 }, inventory: { items: [] }, player: { pos: [100, 0, -50] }, v: 2,
      carroRobado: { pos: [100, 0, 100], rot: 0, kind: 'camioneta', variant: 0 },
    }));
    assert.equal(veces, 2, 'se volvió a la partida que había');
    assert.deepEqual(game.cars, [sedan], 'sin la camioneta del archivo');
    assert.equal(game.carjack.stolen, null, 'no había robado y sigue sin haberlo');
    assert.equal(registrados.size, 0, 'la E ya no la ofrece');
    assert.equal(descartados.size, 0, 'ni queda en el descarte');
    assert.equal(liberados, 1, 'y se libera');
    assert.deepEqual(parqueados.at(-1), [sedan], 'el tráfico ya no la esquiva');
    assert.equal(sedan._disposed, undefined, 'el carro de la calle sigue ahí');
  } finally {
    delete CarroDoble.prototype.dispose;
  }
});

test('importar una partida vieja sin rebusque el mismo día empieza la jornada en cero', () => {
  const game = juego(memoria());
  game.rebusque = new RebusqueSystem(game);
  const j = game.rebusque.jornada;
  for (let i = 0; i < 10; i++) j.registrar('malabares', 7, 22);
  j.quemar(7);
  j.furiaHoy = true;
  game.rebusque._pagados = 5;
  game.rebusque._ganado.push([0, 1000]);
  game.rebusque._esquinas.set('malabares:7', 0);
  assert.ok(j.cansado('malabares'));
  game._importarTexto(JSON.stringify({ stats: { dinero: 100, salud: 80 }, clock: { day: 1, hour: 9 }, inventory: { items: [] }, player: { pos: [100, 0, -50] }, v: 2 }));
  const k = game.rebusque.jornada;
  assert.equal(k.dia, 1);
  assert.equal(k.cansado('malabares'), false, 'sin cansancio de la otra partida');
  assert.equal(k.quemado(7), false, 'ni esquinas quemadas');
  assert.equal(k.furiaHoy, false);
  assert.equal(game.rebusque._pagados, 0);
  assert.deepEqual(game.rebusque._ganado, []);
  assert.equal(game.rebusque._esquinas.size, 0);
});

test('importar cuidando carros: lo cobrado no cuenta para el objetivo de la partida importada', () => {
  const game = juego(memoria());
  window.addEventListener('rebusque', (e) => game.objectives.notify('rebusque', e.detail)); // como Game
  game.rebusque = new RebusqueSystem(game);
  game.rebusque.trabajo = { def: REBUSQUE.cuidar, cars: [], pesos: 1000, dieron: 1 };
  const indice = game.objectives.defs.findIndex((d) => d.id === 'cuidar-carros');
  game._importarTexto(JSON.stringify({
    stats: { dinero: 100, salud: 80 }, clock: { day: 3, hour: 9 }, inventory: { items: [] }, player: { pos: [100, 0, -50] }, v: 2,
    objectives: { index: indice, counter: 0 },
  }));
  assert.equal(game.rebusque.trabajo, null, 'el trabajo se corta');
  assert.equal(game.objectives.index, indice);
  assert.equal(game.objectives.counter, 0, 'las propinas eran de la otra partida');
});

test('importación fallida cuidando carros: lo que el corte ya contó para el objetivo no se pierde', () => {
  const game = juego(memoria());
  window.addEventListener('rebusque', (e) => game.objectives.notify('rebusque', e.detail)); // como Game
  game.rebusque = new RebusqueSystem(game);
  const indice = game.objectives.defs.findIndex((d) => d.id === 'cuidar-carros');
  game.objectives.deserialize({ index: indice, counter: 0 }); // los de antes, cumplidos
  game.rebusque.trabajo = { def: REBUSQUE.cuidar, cars: [], pesos: 1000, dieron: 1 };
  let veces = 0;
  const encargos = game.encargos.deserialize.bind(game.encargos);
  game.encargos.deserialize = (d) => { if (veces++ === 0) throw new Error('dañado'); return encargos(d); };
  game._importarTexto(JSON.stringify({
    stats: { dinero: 100, salud: 80 }, clock: { day: 3, hour: 9 }, inventory: { items: [] }, player: { pos: [100, 0, -50] }, v: 2,
    objectives: { index: 0, counter: 0 },
  }));
  assert.equal(veces, 2, 'se volvió a la partida que había');
  assert.equal(game.rebusque.trabajo, null, 'el trabajo quedó cortado');
  assert.equal(game.objectives.index, indice, 'sigue en cuidar carros');
  assert.equal(game.objectives.counter, 1, 'las propinas que ya dieron cuentan para el objetivo');
});
