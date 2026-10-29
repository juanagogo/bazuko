import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUD } from '../src/ui/HUD.js';

function element() {
  return {
    writes: 0, html: '',
    set innerHTML(value) { this.html = value; this.writes++; },
    querySelectorAll() { return []; }
  };
}
function fixture() {
  globalThis.window = {};
  return Object.assign(Object.create(HUD.prototype), {
    _htmlCache: new WeakMap(), _panelElapsed: 0.1, bars: {},
    invEl: element(), diseaseEl: element(),
    talentPanel: element(), craftPanel: element(), dealerPanel: element()
  });
}

test('abrir fabricación muestra las recetas inmediatamente aunque el mundo quede en pausa', () => {
  const hud = fixture(), crafting = {}, inventory = {}, talents = {};
  hud.craftPanel.classList = { toggle() {} };
  let rendered = 0, released = 0;
  window.__game = { crafting, inventory, talents, cameraRig: { releaseControls() { released++; } } };
  hud.renderCrafting = (...args) => { rendered++; assert.deepEqual(args, [crafting, inventory, talents]); };
  hud.toggleCraftPanel();
  assert.equal(hud._craftOpen, true); assert.equal(rendered, 1); assert.equal(released, 1);
  hud.toggleCraftPanel();
  assert.equal(hud._craftOpen, false); assert.equal(rendered, 1);
});

test('avisa antes de agotar la sed y mantiene visible el daño hasta recuperarse', () => {
  const hud = fixture();
  hud.statusEl = { textContent: '', hidden: true };
  const stats = { sed: 19, hambre: 100, energia: 100, salud: 100 };
  const update = () => hud.update(stats, { hour: 6, day: 1 }, null, null, null, null, null, 0.1);
  update();
  assert.equal(hud.statusEl.hidden, false);
  assert.match(hud.statusEl.textContent, /bebe agua/);
  stats.sed = 0;
  stats.salud = 20;
  update();
  assert.match(hud.statusEl.textContent, /perdiendo salud/);
  assert.match(hud.statusEl.textContent, /Salud crítica/);
  stats.sed = stats.salud = 60;
  update();
  assert.equal(hud.statusEl.hidden, true);
});

test('el estado compacto avisa de necesidades ocultas y retira la alerta al recuperarse', () => {
  const hud = fixture();
  hud.needsSummary = { textContent: '' };
  hud.needsToggle = { dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const stats = { sed: 12, vicio: 28, hambre: 70, higiene: 60, animo: 75 };
  const update = () => hud.update(stats, { hour: 22, day: 1 }, null, null, null, null, null, .1);
  update();
  assert.equal(hud.needsSummary.textContent, 'Sed, Vicio');
  assert.equal(hud.needsToggle.dataset.level, 'critical');
  assert.match(hud.needsToggle.attributes['aria-label'], /niveles bajos de Sed, Vicio/);
  stats.sed = 40;
  update();
  assert.equal(hud.needsSummary.textContent, 'Vicio');
  assert.equal(hud.needsToggle.dataset.level, 'low');
  stats.vicio = 70;
  update();
  assert.equal(hud.needsSummary.textContent, 'Estado');
  assert.equal(hud.needsToggle.dataset.level, 'ok');
  assert.equal(hud.needsToggle.attributes['aria-label'], 'Ver estado y necesidades');
});

test('las barras exponen el valor real limitado también a lectores de pantalla', () => {
  const hud = fixture();
  const row = { dataset: {} };
  const attributes = {};
  const meter = { parentElement: row, setAttribute(key, value) { attributes[key] = value; }, getAttribute(key) { return attributes[key]; } };
  const fill = { style: {}, parentElement: meter };
  hud.bars = { salud: fill };
  hud.barValues = { salud: { textContent: '' } };
  hud.update({ salud: 123 }, { hour: 22, day: 1 });
  assert.equal(attributes['aria-valuenow'], '100');
  assert.equal(parseFloat(fill.style.width), 100);
  hud.update({ salud: 9.2 }, { hour: 22, day: 1 });
  assert.equal(attributes['aria-valuenow'], '9');
  assert.equal(row.dataset.level, 'critical');
  assert.equal(hud.barValues.salud.textContent, '9');
});

test('el contexto distingue nadar, vadear y suelo seco sin anunciar cambios cada frame', () => {
  const hud = fixture();
  hud.movementEl = { hidden: true, dataset: {} };
  hud.movementLabel = { textContent: '' };
  let help = '', writes = 0;
  hud.movementHelp = { get textContent() { return help; }, set textContent(value) { help = value; writes++; } };
  hud.setMovementState({ isSwimming: true, waterDepth: 2 });
  assert.equal(hud.movementEl.hidden, false);
  assert.equal(hud.movementLabel.textContent, 'Nadando');
  assert.match(help, /WASD.*Shift/);
  for (let i = 0; i < 60; i++) hud.setMovementState({ isSwimming: true, waterDepth: 2 });
  assert.equal(writes, 1);
  hud.setMovementState({ isSwimming: false, waterDepth: .4 });
  assert.equal(hud.movementEl.dataset.movement, 'wading');
  assert.equal(hud.movementLabel.textContent, 'En el agua');
  assert.doesNotMatch(help, /Shift/);
  hud.setMovementState({ isSwimming: false, waterDepth: 0 });
  assert.equal(hud.movementEl.hidden, true);
});

test('600 fotogramas no reconstruyen el inventario ni enfermedades sin cambios', () => {
  const hud = fixture();
  const inventory = { items: [{ id: 'pan', name: 'Pan', qty: 1 }], totalWeight: 0.2, maxWeight: 20 };
  for (let i = 0; i < 600; i++) hud.update({}, { hour: 6, day: 1 }, {}, inventory, { hasAny: false }, null, null, 1 / 60);
  assert.equal(hud.invEl.writes, 1);
  assert.equal(hud.diseaseEl.writes, 1);
  inventory.items[0].qty = 2;
  inventory.totalWeight = 0.4;
  hud.update({}, { hour: 6, day: 1 }, {}, inventory, { hasAny: false }, null, null, 0.1);
  assert.equal(hud.invEl.writes, 2);
  assert.match(hud.invEl.html, /x2/);
  assert.match(hud.invEl.html, /0.4\/20/);
  inventory.maxWeight = 30;
  hud._renderInventory(inventory);
  assert.match(hud.invEl.html, /0.4\/30/);
});

test('las enfermedades refrescan el tiempo visible y se eliminan al curarlas', () => {
  const hud = fixture();
  const disease = { hasAny: true, list: [{ emoji: '!', name: 'Prueba', timeLeft: 5.9 }] };
  hud._renderDiseases(disease);
  disease.list[0].timeLeft = 5.1;
  hud._renderDiseases(disease);
  assert.equal(hud.diseaseEl.writes, 1);
  disease.list[0].timeLeft = 4.9;
  hud._renderDiseases(disease);
  assert.equal(hud.diseaseEl.writes, 2);
  assert.match(hud.diseaseEl.html, /5s/);
  hud._renderDiseases({ hasAny: false });
  assert.equal(hud.diseaseEl.html, '');
});

test('paneles estables conservan sus nodos y se refrescan cuando cambia el estado', () => {
  const hud = fixture();
  const talents = { points: 0, has: () => false, canUnlock: () => false };
  const crafting = { getAvailable: () => [{ id: 'test', name: 'Prueba', qty: 1, ingredients: { papel: 2 }, craftable: false }] };
  let quantity = 1;
  const inventory = { count: () => quantity, totalWeight: 0, maxWeight: 20 };
  window.__game = { stats: { dinero: 10 }, inventory, dealer: { getProducts: () => [] } };
  for (let i = 0; i < 20; i++) {
    hud.renderTalents(talents);
    hud.renderCrafting(crafting, inventory, talents);
    hud.renderDealer();
  }
  assert.equal(hud.talentPanel.writes, 1);
  assert.equal(hud.craftPanel.writes, 1);
  assert.equal(hud.dealerPanel.writes, 1);
  talents.points = 1;
  quantity = 2;
  window.__game.stats.dinero = 20;
  hud.renderTalents(talents);
  hud.renderCrafting(crafting, inventory, talents);
  hud.renderDealer();
  assert.equal(hud.talentPanel.writes, 2);
  assert.equal(hud.craftPanel.writes, 2);
  assert.equal(hud.dealerPanel.writes, 2);
});

test('la mesa conserva la receta elegida y explica por qué no se puede fabricar', async () => {
  const { CraftingSystem } = await import('../src/systems/CraftingSystem.js');
  const { InventorySystem } = await import('../src/systems/InventorySystem.js');
  const { ITEMS } = await import('../src/data/items.js');
  const hud = fixture();
  const crafting = new CraftingSystem();
  const inventory = new InventorySystem(20);
  inventory.add(ITEMS.carton, 2); inventory.add(ITEMS.lata, 1);

  hud.renderCrafting(crafting, inventory, null);
  assert.equal(hud._craftSelected, 'rifa', 'abre en la primera receta lista');
  assert.match(hud.craftPanel.html, /data-id="rifa" aria-pressed="true"/);
  assert.match(hud.craftPanel.html, /Listo para fabricar/);

  hud._craftSelected = 'arma';
  hud.renderCrafting(crafting, inventory, null);
  hud.renderCrafting(crafting, inventory, null);
  assert.equal(hud._craftSelected, 'arma', 'la selección sobrevive a los redibujados');
  assert.match(hud.craftPanel.html, /Te faltan 4 materiales/);
  assert.match(hud.craftPanel.html, /class="item-primary craft-go" data-act="craft" disabled/);

  inventory.add(ITEMS.chatarra, 2); inventory.add(ITEMS.cable, 1); inventory.add(ITEMS.madera, 1);
  inventory.maxWeight = inventory.totalWeight;
  hud.renderCrafting(crafting, inventory, null);
  assert.match(hud.craftPanel.html, /Listo para fabricar/);

  inventory.maxWeight = 2; // Tras consumir materiales quedarían 2,4 kg.
  hud.renderCrafting(crafting, inventory, null);
  assert.match(hud.craftPanel.html, /No te cabe en el costal/);
  assert.match(hud.craftPanel.html, /data-id="arma"[^>]*no cabe en el costal/);
});

test('fabricar desde el banco descuenta materiales, suma XP y suena una vez', async () => {
  const { CraftingSystem } = await import('../src/systems/CraftingSystem.js');
  const { InventorySystem } = await import('../src/systems/InventorySystem.js');
  const { ITEMS } = await import('../src/data/items.js');
  const hud = fixture();
  hud.craftPanel.querySelector = () => null;
  globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  const events = [], sounds = [];
  let xp = 0;
  Object.assign(window, { dispatchEvent: (e) => events.push(e.type) });
  window.__game = { stats: { addXP: (n) => { xp += n; } }, talents: null, audio: { play: (s) => sounds.push(s) } };
  const crafting = new CraftingSystem();
  const inventory = new InventorySystem(20);
  inventory.add(ITEMS.botella, 1); inventory.add(ITEMS.carton, 1);
  hud.renderCrafting(crafting, inventory, null);
  hud._craftSelected = 'curita';

  const target = (data) => ({ target: { closest: () => ({ dataset: data }) } });
  hud._onCraftClick(target({ act: 'craft' }));
  assert.equal(inventory.count('curita'), 2);
  assert.equal(inventory.count('botella'), 0);
  assert.equal(xp, 10);
  assert.deepEqual(sounds, ['treasure']);
  assert.deepEqual(events, ['craft']);

  hud._onCraftClick(target({ id: 'hierba' }));
  assert.equal(hud._craftSelected, 'hierba');
  assert.match(hud.craftPanel.html, /data-id="hierba" aria-pressed="true"/);
});
