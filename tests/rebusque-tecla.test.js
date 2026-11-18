// La tecla B entre la limosna y el rebusque (teclado, mando y pantalla táctil), el carro sin E ni Q mientras dura el
// show, la tienda que vende las pelotas una vez y el juego que corta el show (y baja los brazos) al morir, dormir o
// caer preso.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { BUTTON_KEYS } from '../src/core/Gamepad.js';
import { EN_MAS } from '../src/core/TouchControls.js';
import { ITEMS, SHOP_ITEMS, isForSale } from '../src/data/items.js';
import { openShop } from '../src/ui/placeMenus.js';
import { Game } from '../src/core/game.js';
import { HUD, piezasDelPrompt, piezasParaElDedo } from '../src/ui/HUD.js';
import { ponerModo } from '../src/core/modoEntrada.js';

let avisos;
beforeEach(() => {
  avisos = [];
  globalThis.window = new EventTarget();
  window.addEventListener('toast', e => avisos.push(e.detail.text));
});

const press = (code) => {
  const pending = new Set([code]);
  return { isDown: () => false, consumePress: key => pending.delete(key) };
};

/** Una cola de dos carros quieta antes del primer cruce, con el jugador frente a la trompa del primero. */
function calle({ malabares = false, verde = false, lejos = false } = {}) {
  const signals = new TrafficSignals();
  let t = 0;
  while ((signalState(t, 0) === 0) !== verde || (!verde && 36 - t % 36 < 10)) t += .5;
  signals.update(t);
  const node = signals.nodes[0];
  const z = node.z0 + 4.3, x0 = node.x0 - 8;
  const vehicles = [0, 1].map(i => ({ car: { position: { x: x0 - 5.5 * i, y: 0, z }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, kind: 'carro' }, speed: 0, stopped: true }));
  const traffic = Object.assign(Object.create(TrafficSystem.prototype), { signals, vehicles });
  const inventory = new InventorySystem();
  if (malabares) inventory.add(ITEMS.malabares, 1);
  const stats = { dinero: 0, energia: 100, salud: 100, animo: 50, higiene: 80, addXP() {} };
  const player = { position: new THREE.Vector3(x0 + 3.2 + (lejos ? 15 : 0), 0, z), faceTowards() {}, action: null,
    playAction(a, d) { this.action = a; this.actionTimer = d; } };
  const game = { traffic, inventory, stats, player };
  const rebusque = new RebusqueSystem(game, { random: () => 0 });
  const interaction = new InteractionSystem(player, inventory, stats, { play() {} }, null, { getEffect: (_k, base) => base }, null);
  interaction.rebusque = rebusque;
  let limosnas = 0;
  interaction._beg = () => { limosnas++; };
  rebusque.update(.1);
  return { game, rebusque, interaction, limosnas: () => limosnas };
}

test('B: sin pelotas, en verde o lejos de la cola es limosna; con pelotas frente al rojo es el show. L siempre pide', () => {
  for (const [caso, opciones] of [['sin pelotas', {}], ['en verde', { malabares: true, verde: true }], ['lejos', { malabares: true, lejos: true }]]) {
    const c = calle(opciones);
    c.interaction.update(.016, press('KeyB'), null);
    assert.equal(c.limosnas(), 1, `${caso}: pide limosna`);
    assert.ok(!c.rebusque.activo, caso);
  }
  const c = calle({ malabares: true });
  c.interaction.update(.016, press('KeyB'), null);
  assert.equal(c.limosnas(), 0, 'con pelotas en el rojo B no pide');
  assert.ok(c.rebusque.activo);
  c.interaction.update(.016, press('KeyB'), null);
  assert.equal(c.limosnas(), 0, 'a mitad del show B tampoco pide');
  c.interaction.update(.016, press('KeyL'), null);
  assert.equal(c.limosnas(), 1, 'L pide limosna aunque haya show');
});

test('el mando y la pantalla táctil mandan la misma B: rebuscan donde la B rebusca', () => {
  assert.equal(BUTTON_KEYS[14], 'KeyB', 'cruceta izquierda');
  assert.equal(EN_MAS.find(b => b.id === 'pedir').tecla, 'KeyB', '«Pedir» en la pantalla táctil');
  const c = calle({ malabares: true });
  c.interaction.update(.016, press(BUTTON_KEYS[14]), null);
  assert.ok(c.rebusque.activo);
  assert.equal(c.limosnas(), 0);
});

function carroEnLaVia() {
  const position = new THREE.Vector3(1, 0, 0);
  return { position, traffic: true, stealable: true, cleanable: true, robado: 0, limpio: 0,
    interactDistance: p => position.distanceTo(p), steal() { this.robado++; return null; }, cleanWindshield() { this.limpio++; } };
}

test('rebusque en curso: el carro no da aviso de E ni de Q y sus teclas no hacen nada; al terminar, vuelven', () => {
  const stats = { energia: 100, salud: 100, dinero: 0 };
  const interaction = new InteractionSystem({ position: new THREE.Vector3() }, { count: () => 0 }, stats, { play() {} },
    null, { getEffect: (_key, base) => base }, null);
  const car = carroEnLaVia();
  interaction.register(car);
  const rebusque = { activo: true, intentar: () => true };
  interaction.rebusque = rebusque;
  for (const tecla of ['KeyE', 'KeyQ']) {
    interaction.update(.016, press(tecla), null);
    assert.equal(interaction.currentTarget, null, `sin aviso del carro (${tecla})`);
  }
  assert.equal(car.robado + car.limpio, 0, 'ni E ni Q tocan al carro');
  rebusque.activo = false;
  interaction.update(.016, press('KeyF0'), null);
  assert.equal(interaction.currentTarget, car, 'al terminar el show vuelve el aviso');
  assert.equal(interaction.currentTargetType, 'car');
});

test('morir, dormir o caer preso a mitad del show lo cortan y bajan los brazos, y el carro vuelve a ofrecer E y Q', () => {
  const casos = {
    morir: g => {
      Object.assign(g, { _deathPending: false, _arrestPending: false, deathCount: 0, substanceEffects: { end() {} }, psychosis: null });
      g.stats.salud = 0;
      assert.equal(g._handleDeath(), true);
    },
    dormir: g => {
      Object.assign(g, { built: { base: true }, clock: { hour: 22, day: 1, isNight: true }, dog: null });
      g.player.playAction = () => {};
      g.sleep();
    },
    'caer preso': g => {
      g._policeArrest();
    }
  };
  for (const [caso, hacer] of Object.entries(casos)) {
    const c = calle({ malabares: true });
    c.interaction.update(.016, press('KeyB'), null);
    c.rebusque.update(.5);
    assert.ok(c.rebusque.activo && c.rebusque.prompt, caso);
    assert.equal(c.game.player.action, 'malabares', caso);
    const car = carroEnLaVia();
    car.position.copy(c.game.player.position);
    c.interaction.register(car);
    const game = Object.assign(Object.create(Game.prototype), c.game, {
      rebusque: c.rebusque, interaction: c.interaction, input: { keys: {}, endFrame() {} }, audio: { updateSteps() {}, play() {} },
      menu: { open() {} }, look: {}, _calleCercana: () => '', _save() {}
    });
    hacer(game);
    assert.ok(!c.rebusque.activo, `${caso}: el show no queda colgado`);
    assert.equal(c.rebusque.prompt, null, `${caso}: sin el aviso pegado`);
    assert.notEqual(c.game.player.action, 'malabares', `${caso}: no queda con los brazos arriba`);
    c.interaction.update(.016, press('KeyF0'), null);
    assert.equal(c.interaction.currentTarget, car, `${caso}: el carro vuelve a dar su aviso`);
    assert.equal(c.game.stats.dinero, 0);
  }
  // Al cerrar el juego tampoco queda nada andando.
  const c = calle({ malabares: true });
  c.interaction.update(.016, press('KeyB'), null);
  c.rebusque.dispose();
  assert.ok(!c.rebusque.activo);
});

test('guardar a mitad del show no guarda el show, y una partida vieja sin pelotas carga con la B de limosna', () => {
  const c = calle({ malabares: true });
  c.interaction.update(.016, press('KeyB'), null);
  let guardado;
  const serializable = () => ({ serialize: () => ({}) });
  const game = Object.assign(Object.create(Game.prototype), {
    stats: serializable(), clock: serializable(), talents: serializable(), diseases: serializable(),
    inventory: c.game.inventory, player: { position: new THREE.Vector3() }, world: {}, rebusque: c.rebusque,
    save: { save: data => { guardado = data; } }
  });
  game._save();
  assert.ok(!JSON.stringify(guardado).includes('Haciendo malabares'));
  assert.equal(guardado.rebusque, undefined);
  // Las pelotas se guardan con el costal y vuelven al cargar.
  const nuevo = new InventorySystem();
  nuevo.deserialize(JSON.parse(JSON.stringify(guardado.inventory)));
  assert.equal(nuevo.count('malabares'), 1);
  // Una partida de antes del rebusque no trae pelotas: B sigue siendo limosna.
  const viejo = calle();
  viejo.game.inventory.deserialize({ items: [{ id: 'pan', qty: 2 }], maxWeight: 20 });
  viejo.interaction.update(.016, press('KeyB'), null);
  assert.equal(viejo.limosnas(), 1);
});

function dom() {
  const nodo = tag => ({
    tag, className: '', textContent: '', children: [], attributes: {}, style: {}, dataset: {},
    addEventListener(evt, fn) { this['on' + evt] = fn; }, removeEventListener() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    append(...n) { for (const item of n) { if (typeof item === 'string') this.textContent += item; this.children.push(item); } },
    appendChild(n) { this.children.push(n); return n; }, prepend(...n) { this.children.unshift(...n); },
    replaceChildren(...n) { this.children = n; }, querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  });
  globalThis.document = { createElement: nodo, getElementById: () => nodo('div'), createTextNode: t => t, activeElement: null };
}
const textos = n => (typeof n === 'string' ? n : [n?.textContent ?? '', ...(n?.children ?? []).map(textos)].join(' '));

test('la tienda vende las pelotas a $3.000, no las vende otra vez si ya las cargo y la recicladora no las compra', () => {
  dom();
  const venta = SHOP_ITEMS.find(s => s.item === 'malabares');
  assert.equal(venta.price, 3000);
  assert.ok(!isForSale(ITEMS.malabares), 'no se reciclan');
  const fila = inventory => {
    let cfg;
    const game = { menu: { open(c) { cfg = c; }, refresh() {} }, inventory, stats: { dinero: 10000 }, audio: { play() {} } };
    openShop(game);
    const ul = cfg.render().body;
    const li = ul.children.find(li => textos(li).includes('Pelotas de malabares'));
    return { li, boton: li.children.find(n => n.tag === 'button'), game };
  };
  const inv = new InventorySystem();
  const { boton, game } = fila(inv);
  assert.ok(!('disabled' in boton.attributes));
  boton.onclick();
  assert.equal(inv.count('malabares'), 1);
  assert.equal(game.stats.dinero, 7000);
  const otra = fila(inv);
  assert.ok('disabled' in otra.boton.attributes, 'ya las tengo');
  assert.ok(textos(otra.li).includes('Ya lo tengo.'));
});

test('el aviso del rebusque sale con teclado y con el dedo (la cuenta del show y el motivo también), y no con la pausa abierta', () => {
  const prompt = { html: '', visible: false, set innerHTML(v) { this.html = v; }, classList: { toggle(_c, on) { prompt.visible = on; } }, querySelector: () => null };
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), promptEl: prompt });
  const pintar = (rebusquePrompt, paused = false) => { window.__game = { paused }; hud._promptTexto = undefined; hud._pintarContexto({ rebusquePrompt }, null); };
  try {
    for (const modo of ['teclado', 'tactil']) {
      ponerModo(modo);
      pintar('Haciendo malabares, 4 s · rojo 12 s');
      assert.ok(prompt.visible && /Haciendo malabares, 4 s/.test(prompt.html) && /rojo 12 s/.test(prompt.html), modo);
      pintar('Ya va a cambiar la luz: espero el próximo rojo.');
      assert.match(prompt.html, /Ya va a cambiar la luz/, modo);
      pintar('[B] Hacer malabares frente a los carros');
      assert.match(prompt.html, modo === 'tactil' ? />Malabares</ : /Hacer malabares frente a los carros/, modo);
    }
    pintar('Haciendo malabares, 4 s · rojo 12 s', true);
    assert.equal(prompt.visible, false, 'con la pausa abierta no se ve');
  } finally { ponerModo('teclado'); delete window.__game; }
});

test('con el dedo los demás avisos salen como antes, y la cinta de B se suma detrás de las dos que ya hay', () => {
  const dedo = texto => piezasParaElDedo(piezasDelPrompt(texto)).map(p => [p.tecla, p.verbo]);
  assert.deepEqual(dedo('[E] Recoger basura · [Mantener Q] Seleccionar'), [['E', 'Recoger basura'], ['Q', 'Seleccionar']]);
  assert.deepEqual(dedo('[E] Agarrar la carreta (+120 kg) · Pesa mucho'), [['E', 'Agarrar carreta']]);
  assert.deepEqual(dedo('[E] Cosquilleo · [Q] Robar retrovisor · [F] Hablar'), [['E', 'Cosquilleo'], ['Q', 'Robar retrovisor']]);
  const conB = piezasParaElDedo(piezasDelPrompt('[E] Cosquilleo · [Q] Robar retrovisor'), piezasDelPrompt('[B] Hacer malabares frente a los carros'));
  assert.deepEqual(conB.map(p => [p.tecla, p.verbo]), [['E', 'Cosquilleo'], ['Q', 'Robar retrovisor'], ['B', 'Malabares']]);
});

test('junto a un carro parqueado y frente a la cola en rojo salen juntos el aviso de la Y y el del rebusque, y ninguno con la pausa abierta', () => {
  const prompt = { html: '', visible: false, set innerHTML(v) { this.html = v; }, classList: { toggle(_c, on) { prompt.visible = on; } }, querySelector: () => null };
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), promptEl: prompt });
  const interaction = { carjackPrompt: '[Y] Forzar la puerta y robarme el carro', rebusquePrompt: '[B] Hacer malabares frente a los carros' };
  const pintar = (paused) => { window.__game = { paused }; hud._promptTexto = undefined; hud._pintarContexto(interaction, null); };
  try {
    ponerModo('teclado');
    pintar(false);
    assert.ok(prompt.visible);
    assert.match(prompt.html, /Forzar la puerta y robarme el carro/);
    assert.match(prompt.html, /Hacer malabares frente a los carros/);
    pintar(true);
    assert.equal(prompt.visible, false, 'con la pausa abierta no se ve ninguno');
  } finally { delete window.__game; }
});
