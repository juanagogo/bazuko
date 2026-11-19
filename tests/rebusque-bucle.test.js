// El bucle de verdad (Game._loop), sin navegador: el constructor de Game corre con dobles en lugar de lo que pide DOM o
// WebGL, como en arranque.test.js, y lo que se mira es de verdad: la tecla B, el rebusque, las pelotas, el costal, los
// semáforos, el robo de carros y la tecla de contexto del HUD.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import * as THREE from 'three';
// Se cargan antes de cambiar los módulos de game.js por dobles: estas clases son las de verdad.
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { RebusqueVisual } from '../src/systems/rebusque/RebusqueVisual.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { CarjackSystem } from '../src/systems/CarjackSystem.js';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { ITEMS } from '../src/data/items.js';
import { HUD } from '../src/ui/HUD.js';
import { ponerModo } from '../src/core/modoEntrada.js';

// Lo demás que importa game.js, salvo three, es un doble que acepta cualquier uso (clase, función, objeto o número).
const doble = new Proxy(function () {}, {
  get: (_, key) => key === Symbol.toPrimitive ? () => 0 : key === 'then' ? () => doble : doble,
  set: () => true,
  apply: () => doble,
  construct: () => doble
});
const gameUrl = new URL('../src/core/game.js', import.meta.url);
const modulos = new Map();
for (const [, nombres, desde] of readFileSync(gameUrl, 'utf8').matchAll(/^import \{([^}]*)\} from '([^']+)';/gm)) {
  const namedExports = modulos.get(desde) ?? {};
  for (const nombre of nombres.split(',')) {
    const importado = nombre.trim().split(/\s+as\s+/)[0];
    if (importado) namedExports[importado] = doble;
  }
  modulos.set(desde, namedExports);
}
for (const [desde, namedExports] of modulos) mock.module(new URL(desde, gameUrl).href, { namedExports });
globalThis.window = new EventTarget();
globalThis.requestAnimationFrame = () => 0;
const avisos = [];
window.addEventListener('toast', e => avisos.push(e.detail.text));
const { Game } = await import('../src/core/game.js');

const PISTA = 'Con unas pelotas de malabares de la tienda podría rebuscarme en este semáforo.';

/**
 * Una partida con la calle de rebusque-tecla.test.js: una cola de dos carros quieta en rojo antes del primer cruce y el
 * jugador frente a la trompa del primero. `carjack`, si se da, reemplaza al robo de carros de verdad por su estado.
 */
function partida({ malabares = true, carjack = null } = {}) {
  avisos.length = 0;
  const signals = new TrafficSignals();
  let t = 0;
  while (signalState(t, 0) === 0 || 36 - t % 36 < 10) t += .5;
  signals.update(t);
  const node = signals.nodes[0];
  const z = node.z0 + 4.3, x0 = node.x0 - 8;
  const vehicles = [0, 1].map(i => ({ car: { position: { x: x0 - 5.5 * i, y: 0, z }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, kind: 'carro', update() {} }, speed: 0, stopped: true }));
  const inventory = new InventorySystem();
  if (malabares) inventory.add(ITEMS.malabares, 1);
  const stats = { dinero: 0, energia: 100, salud: 100, animo: 50, higiene: 80, addXP() {}, update() {} };
  // Quieto en su sitio: a pie, el bucle lo mueve con update.
  const player = { position: new THREE.Vector3(x0 + 3.2, 0, z), root: new THREE.Object3D(), action: null,
    update() {}, updateBicyclePose() {}, updateCartPose() {}, faceTowards() {},
    playAction(a, d) { this.action = a; this.actionTimer = d; } };
  const pendientes = new Set();
  const game = new Game(doble);
  // La tecla de contexto de verdad (HUD._pintarContexto) sobre un elemento de mentira.
  const tecla = { html: '', visible: false, set innerHTML(v) { this.html = v; }, classList: { toggle(_c, on) { tecla.visible = on; } }, querySelector: () => null };
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), promptEl: tecla });
  Object.assign(game, {
    // Ya cargó, sin menús abiertos (Game.paused): la simulación corre.
    _running: true, _loading: false, menu: { isOpen: false }, creator: { isOpen: false }, inventoryUI: null, photoMode: null,
    isSleeping: false, steal: null, cars: [],
    player, stats, inventory,
    traffic: Object.assign(Object.create(TrafficSystem.prototype), { signals, vehicles, update() {} }),
    // Como Input: una tecla oprimida vale solo en su cuadro.
    input: { axis: { x: 0, z: 0 }, keys: {}, isRunning: false, consumePress: k => pendientes.delete(k), isDown: () => false, endFrame: () => pendientes.clear() },
    hud: { setMovementState() {}, update: (_stats, _clock, interaction, inv) => hud._pintarContexto(interaction, inv) }
  });
  game.interaction = new InteractionSystem(player, inventory, stats, { play() {} }, null, { getEffect: (_k, base) => base }, null);
  game.rebusque = new RebusqueSystem(game, { random: () => 0 });
  game.interaction.rebusque = game.rebusque;
  game.rebusqueVisual = new RebusqueVisual(new THREE.Scene(), game);
  // Como CarjackSystem: maneja si tiene carro, y update dice si el cuerpo es del carro (al volante, subiendo o bajando).
  game.carjack = carjack ? Object.assign({ prompt: null, get driving() { return !!this.car; }, update() { return !!(this.car || this.transition); } }, carjack)
    : new CarjackSystem(game);
  /** Un cuadro de 0,1 s del bucle, con las teclas que se oprimen en él. */
  const paso = (...teclas) => {
    for (const k of teclas) pendientes.add(k);
    game._lastTime = -Infinity;
    game._loop(0);
  };
  return { game, tecla, paso, x0, z };
}

test('al volante, subiendo o bajando del carro frente a la cola en rojo, el bucle no le pasa a la tecla de contexto el aviso de B ni gasta la pista de la tienda; a pie, sí', () => {
  ponerModo('teclado');
  const estados = { 'al volante': { car: {}, transition: null }, subiendo: { car: {}, transition: { kind: 'enter' } }, bajando: { car: null, transition: { kind: 'exit' } } };
  for (const [caso, estado] of Object.entries(estados)) {
    const conPelotas = partida({ carjack: { ...estado } });
    conPelotas.paso('KeyB');
    assert.equal(conPelotas.game.interaction.rebusquePrompt, null, `${caso}: sin aviso de B`);
    assert.equal(conPelotas.tecla.visible, false, `${caso}: la tecla de contexto no ofrece nada`);
    assert.ok(!conPelotas.game.rebusque.activo, `${caso}: B no empieza ningún show`);
    Object.assign(conPelotas.game.carjack, { car: null, transition: null });
    conPelotas.paso();
    assert.equal(conPelotas.game.interaction.rebusquePrompt, '[B] Hacer malabares frente a los carros', `${caso}: a pie vuelve el aviso de B`);

    const sinPelotas = partida({ malabares: false, carjack: { ...estado } });
    sinPelotas.paso();
    sinPelotas.paso();
    assert.deepEqual(avisos, [], `${caso}: la pista no sale`);
    Object.assign(sinPelotas.game.carjack, { car: null, transition: null });
    sinPelotas.paso();
    sinPelotas.paso();
    assert.deepEqual(avisos, [PISTA], `${caso}: a pie, la pista sale una vez`);
  }
});

test('Y permite conducir hasta el semáforo y bajarse allí sin activar B ni gastar la pista de la tienda en el trayecto', () => {
  ponerModo('teclado');
  for (const malabares of [true, false]) {
    const { game, tecla, paso, x0, z } = partida({ malabares });
    const carjack = game.carjack;
    game.world = { active: { getMovementGroundHeight: () => 0 }, update() {} };
    game.collisions = {};
    const carro = { position: new THREE.Vector3(x0 - 12, 0, z + 2.1), group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, update() {} };
    game.cars = [carro];
    game.player.position.set(x0 - 12, 0, z + .2);
    const estados = new Set();
    const cuadro = (...teclas) => {
      paso('KeyB', ...teclas);
      if (!carjack.driving && !carjack.transition) return;
      estados.add(carjack.transition?.kind ?? 'volante');
      assert.equal(game.rebusque.activo, false);
      assert.equal(game.interaction.rebusquePrompt, null);
      assert.equal(tecla.visible, false);
      assert.ok(!avisos.includes(PISTA));
    };
    const avanzarHasta = (condicion, avanzar, motivo) => {
      for (let i = 0; i < 160 && !condicion(); i++) avanzar();
      assert.ok(condicion(), motivo);
    };
    cuadro('KeyY');
    avanzarHasta(() => !carjack.transition, cuadro, 'termina de subir');
    assert.equal(carjack.car, carro);
    avanzarHasta(() => carro.position.x >= x0 + 1.8, () => {
      game.input.axis.z = carjack.speed < 2 ? -1 : 0;
      cuadro();
    }, 'llega por el costado de la cola');
    game.input.axis.z = 0;
    avanzarHasta(() => carjack.speed === 0, cuadro, 'se detiene');
    cuadro('KeyY');
    avanzarHasta(() => !carjack.transition, cuadro, 'termina de bajar');
    assert.deepEqual([...estados], ['enter', 'volante', 'exit']);
    assert.equal(carjack.driving, false);
    assert.ok(game.player.position.distanceTo(new THREE.Vector3(x0 + 3.2, 0, z)) < 1.5);
    paso();
    paso();
    if (malabares) assert.equal(game.interaction.rebusquePrompt, '[B] Hacer malabares frente a los carros');
    else assert.deepEqual(avisos.filter(aviso => aviso === PISTA), [PISTA]);
  }
});
