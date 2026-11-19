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
 * jugador frente a la trompa del primero.
 */
function partida({ malabares = true } = {}) {
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
    // Como Input: una tecla oprimida vale solo en su cuadro; el eje es el de W, A, S, D.
    input: { axis: { x: 0, z: 0 }, keys: {}, isRunning: false, consumePress: k => pendientes.delete(k), isDown: () => false, endFrame: () => pendientes.clear() },
    hud: { setMovementState() {}, update: (_stats, _clock, interaction, inv) => hud._pintarContexto(interaction, inv) }
  });
  game.interaction = new InteractionSystem(player, inventory, stats, { play() {} }, null, { getEffect: (_k, base) => base }, null);
  game.rebusque = new RebusqueSystem(game, { random: () => 0 });
  game.interaction.rebusque = game.rebusque;
  game.rebusqueVisual = new RebusqueVisual(new THREE.Scene(), game);
  // El robo de carros de verdad; solo la geometría del mundo es de mentira: hay por dónde bajarse y el suelo está a 0.
  game.carjack = new CarjackSystem(game);
  game.carjack._pointBlocked = () => false;
  game.carjack._ground = () => 0;
  /** Un cuadro de 0,1 s del bucle, con las teclas que se oprimen en él. */
  const paso = (...teclas) => {
    for (const k of teclas) pendientes.add(k);
    game._lastTime = -Infinity;
    game._loop(0);
  };
  return { game, tecla, paso, x0, z };
}

test('un cuadro del bucle de verdad avanza el show, le pasa su aviso a la tecla de contexto y mueve las pelotas; al terminar, cobra y las guarda', () => {
  ponerModo('teclado');
  const { game, tecla, paso } = partida();
  paso();
  assert.equal(game.interaction.rebusquePrompt, '[B] Hacer malabares frente a los carros');
  assert.ok(tecla.visible && /Hacer malabares frente a los carros/.test(tecla.html), 'a pie, frente a la cola, la tecla ofrece B');
  paso('KeyB');
  assert.ok(game.rebusque.activo, 'B en el bucle empieza el show');
  assert.ok(Math.abs(game.rebusque.trabajo.tiempo - .1) < 1e-9, 'y el mismo cuadro lo avanza');
  assert.match(game.interaction.rebusquePrompt, /^Haciendo malabares, \d+ s · rojo \d+ s$/);
  assert.ok(tecla.visible && /Haciendo malabares, \d+ s/.test(tecla.html) && /rojo \d+ s/.test(tecla.html), 'la cuenta del show sale en la tecla de contexto');
  assert.equal(game.player.action, 'malabares');
  assert.ok(game.rebusqueVisual.group?.visible, 'las pelotas salen');
  const pelotas = () => game.rebusqueVisual._bolas.map(b => b.mesh.position.clone());
  const antes = pelotas();
  paso();
  assert.ok(Math.abs(game.rebusque.trabajo.tiempo - .2) < 1e-9);
  assert.ok(pelotas().some((p, i) => p.distanceTo(antes[i]) > 1e-3), 'las pelotas se mueven');
  for (let i = 0; i < 100 && game.rebusque.activo; i++) paso();
  assert.ok(!game.rebusque.activo, 'el show termina');
  assert.ok(game.stats.dinero > 0 && avisos.some(a => /^Me dieron \$|carros me dieron \$/.test(a)), 'y paga');
  assert.equal(game.rebusqueVisual.group.visible, false, 'las pelotas se guardan');
  assert.notEqual(game.player.action, 'malabares', 'los brazos bajan');
});

test('subiendo a un carro robado, manejándolo hasta la cola en rojo y bajándose frente a ella, el bucle no ofrece B, no empieza el show ni gasta la pista de la tienda; a pie, sí', () => {
  ponerModo('teclado');
  for (const malabares of [true, false]) {
    const { game, tecla, paso, x0, z } = partida({ malabares });
    const carjack = game.carjack;
    // Un parqueado junto al andén, detrás de la cola, y el jugador al lado de su puerta.
    game.cars = [{ position: new THREE.Vector3(x0 - 12, 0, z + 2.1), group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, update() {} }];
    game.player.position.set(x0 - 12, 0, z + .2);
    const pasados = [];
    /** Un cuadro con B oprimida. Si al terminar el cuadro el cuerpo es del carro, el rebusque no hace nada. */
    const cuadro = (...teclas) => {
      paso('KeyB', ...teclas);
      const estado = carjack.transition ? (carjack.transition.kind === 'enter' ? 'subiendo' : 'bajando') : carjack.driving ? 'al volante' : 'a pie';
      if (estado === 'a pie') return;
      if (pasados.at(-1) !== estado) pasados.push(estado);
      const caso = `${malabares ? 'con' : 'sin'} pelotas, ${estado}`;
      assert.ok(!game.rebusque.activo, `${caso}: B no empieza ningún show`);
      assert.equal(game.interaction.rebusquePrompt, null, `${caso}: sin aviso de B`);
      assert.equal(tecla.visible, false, `${caso}: la tecla de contexto no ofrece nada`);
      assert.ok(!avisos.includes(PISTA), `${caso}: la pista no sale`);
    };
    // La Y junto al parqueado sube al carro (CarjackSystem.enter), con su paso de subir.
    cuadro('KeyY');
    while (carjack.transition) cuadro();
    // Al volante, por el lado de la cola, hasta la trompa del primero; ahí suelta el acelerador y el carro se detiene.
    while (carjack.car.position.x < x0 + 1.8) {
      game.input.axis.z = carjack.speed < 2 ? -1 : 0;
      cuadro();
    }
    game.input.axis.z = 0;
    while (carjack.speed > 0) cuadro();
    // La Y lo baja (CarjackSystem.exit). En ese cuadro el bucle sí atiende B: es el único de los del carro.
    cuadro('KeyY');
    while (carjack.transition) cuadro();
    assert.deepEqual(pasados, ['subiendo', 'al volante', 'bajando']);
    assert.ok(!carjack.driving && game.player.position.distanceTo(new THREE.Vector3(x0 + 3.2, 0, z)) < 1.5, 'quedó a pie, frente a la trompa del primero');
    // A pie, después: vuelve el aviso de B, o la pista sale una vez.
    paso();
    paso();
    if (malabares) assert.equal(game.interaction.rebusquePrompt, '[B] Hacer malabares frente a los carros', 'a pie vuelve el aviso de B');
    else assert.deepEqual(avisos.filter(a => a === PISTA), [PISTA], 'a pie, la pista sale una vez');
  }
});

test('con el show en curso, la Y junto a un carro parqueado sube al carro como siempre y corta el show sin pagarlo; al volante no queda ningún aviso del rebusque', () => {
  ponerModo('teclado');
  const { game, tecla, paso, x0, z } = partida();
  // Un parqueado a un lado, a 1,2 m de la carrocería: al alcance de la Y.
  const parqueado = { position: new THREE.Vector3(x0 + 3.2, 0, z + 2.1), group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, update() {} };
  game.cars = [parqueado];
  paso('KeyB');
  paso();
  assert.ok(game.rebusque.activo);
  assert.match(tecla.html, /Forzar la puerta y robarme el carro/, 'la Y sale al lado del show');
  assert.match(tecla.html, /Haciendo malabares/);
  paso('KeyY');
  for (let i = 0; i < 60; i++) paso();
  assert.ok(game.carjack.driving, 'la Y se sube al carro');
  assert.ok(!game.rebusque.activo, 'el show se corta');
  assert.equal(game.stats.dinero, 0, 'sin pagarlo');
  assert.notEqual(game.player.action, 'malabares', 'sin los brazos arriba');
  assert.equal(game.rebusqueVisual.group.visible, false, 'las pelotas se guardan');
  assert.equal(game.interaction.rebusquePrompt, null);
  assert.ok(!avisos.some(a => /me dieron|me fui antes/i.test(a)), 'ni cobra ni dice que se fue');
});
