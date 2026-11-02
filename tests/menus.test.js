// Los menús: lo que se reescribió y no debe volver a romperse, sin navegador.
import { hasIcon } from '../src/ui/icons.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepararPlano, hornearPlano } from '../src/ui/planoRadar.js';
import { nombreALaVista } from '../src/ui/Minimap.js';
import { cityMapPlan } from '../src/world/bogota/CityMapRaster.js';
import { Cart } from '../src/entities/Cart.js';
import { BRANCHES, TALENTS } from '../src/data/talents.js';
import { HUD } from '../src/ui/HUD.js';
import { openRadioModal } from '../src/ui/RadioModal.js';
import { openPauseMenu, PAUSE_TABS } from '../src/ui/PauseMenu.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const leer = (ruta) => fs.readFileSync(RAIZ + ruta, 'utf8');
const EMOJI = /\p{Extended_Pictographic}/u;

/** Un DOM de mentiras: guarda lo que se le pide y deja leer el texto de todo el árbol. */
function dom() {
  const nodo = (tag) => ({
    tag, className: '', textContent: '', children: [], attributes: {}, style: {}, dataset: {},
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    append(...n) { this.children.push(...n); },
    appendChild(n) { this.children.push(n); return n; },
    prepend(...n) { this.children.unshift(...n); },
    replaceChildren(...n) { this.children = n; },
    querySelector() { return null; },
  });
  globalThis.document = { createElement: nodo, activeElement: null };
  globalThis.window = new EventTarget();
  return nodo;
}
const textos = (n) => (typeof n === 'string' ? [n] : [n.textContent, ...(n.children ?? []).flatMap(textos)]).filter(Boolean);

test('fuera del navegador no hay plano, y nadie se cae por eso', () => {
  assert.equal(typeof Path2D, 'undefined', 'la prueba corre sin Path2D');
  const plano = cityMapPlan({ map: Array.from({ length: 200 }, () => ['road', 'road']) });
  assert.equal(prepararPlano(null), null);
  assert.equal(prepararPlano({ ancho: 1, desdeZ: 0, hastaZ: 0, T: 2, tipo: () => 'road', originX: 0, originZ: 0 }), null);
  assert.equal(hornearPlano(null), null);
  assert.ok(plano.worldWidth > 0);
});

test('el mapa grande ya no tiene su propio raster ni sus colores', () => {
  const raster = leer('src/world/bogota/CityMapRaster.js'), vista = leer('src/ui/MapView.js');
  assert.doesNotMatch(raster, /MAP_COLORS|buildCityMapRaster/);
  assert.doesNotMatch(vista, /MAP_COLORS|mapRaster|buildCityMapRaster/);
  assert.match(vista, /trazarPlano/);
});

test('a la vista, cada lugar con su voz; por dentro sigue su nombre', () => {
  assert.equal(nombreALaVista('Dealer'), 'El jíbaro');
  assert.equal(nombreALaVista('Crafteo'), 'La mesa');
  assert.equal(nombreALaVista('Gasolinera'), 'Gasolinera');
});

test('los paneles son diálogos con nombre, y la pausa abre con sus solapas', () => {
  assert.ok(hasIcon('info'), 'la nota del desarrollador abre con su dibujo, no con la caja');
  const html = leer('index.html');
  for (const [id, nombre] of [['talent-panel', 'Mañas'], ['craft-panel', 'La mesa'], ['dealer-panel', 'El jíbaro']]) {
    const etiqueta = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))[0];
    assert.match(etiqueta, /role="dialog"/, id);
    assert.match(etiqueta, /aria-modal="true"/, id);
    assert.ok(etiqueta.includes(`aria-label="${nombre}"`), id);
  }
  assert.match(html, /id="menu-tabs"/);
  assert.deepEqual(PAUSE_TABS.map(t => t.label), ['Mapa', 'Estado', 'Ajustes', 'Controles']);
});

test('la carreta no toca el indicador: de eso se encarga el HUD, con hidden', () => {
  // Un `classList.remove('hidden')` no mostraba nada: el indicador se oculta con el atributo.
  assert.doesNotMatch(leer('src/entities/Cart.js'), /cart-indicator/);
  assert.match(leer('src/ui/HUD.js'), /cartEl\.hidden = !/);
  assert.ok(Cart);
});

test('la radio: el botón de pilas dice la acción aunque no se pueda, porque se tacha; el motivo va aparte y sin tachar', () => {
  dom();
  const pinta = (battery, items) => {
    const menu = { isOpen: false, open(c) { this.config = c; }, refresh() {}, close() {} };
    const radio = {
      isOn: true, battery, frequency: 98.5, volume: .5, lastBulletin: null,
      getStationInfo: () => ({ signal: .9, station: { id: 'x', name: 'Emisora', program: 'Programa', genre: 'Género' } }),
      toggle() {}, turnOn() {}, setFrequency() {}, setVolume() {},
    };
    openRadioModal({ menu, radio, inventory: { items, count: (id) => items.filter(i => i.id === id).length }, player: {}, creator: {} });
    const dibujo = menu.config.render();
    return textos(dibujo.body);
  };
  const llena = pinta(100, [{ id: 'pilas', qty: 1 }]);
  assert.ok(llena.some(t => t.startsWith('Poner pilas')), 'con las pilas llenas sigue siendo la acción');
  assert.ok(!llena.some(t => /Pilas llenas|Están llenas/.test(t)));
  assert.ok(!llena.includes('No tengo pilas'), 'tener pilas de repuesto no es no tenerlas');
  const sinRepuesto = pinta(30, []);
  assert.ok(sinRepuesto.some(t => t.startsWith('Poner pilas')));
  assert.ok(sinRepuesto.includes('No tengo pilas'));
  assert.ok(!pinta(100, []).includes('No tengo pilas'), 'llena no hace falta decirlo');
});

test('en la pausa y en la radio no se escribe con emojis', () => {
  dom();
  const menu = { isOpen: false, open(c) { this.config = c; }, refresh() {}, close() {} };
  const radio = {
    isOn: true, battery: 12, frequency: 890, volume: .5, lastBulletin: null,
    getStationInfo: () => ({ signal: .9, station: { id: 'x', name: '📻 Emisora', program: '🎵 Programa', genre: '📻 Género' } }),
    toggle() {}, turnOn() {}, setFrequency() {}, setVolume() {},
  };
  const game = { menu, radio, inventory: { items: [] }, player: {}, creator: {} };
  openRadioModal(game);
  const dibujo = menu.config.render();
  const todo = [menu.config.title, menu.config.sub, ...textos(dibujo.body), ...dibujo.foot.flatMap(textos)];
  assert.equal(menu.config.title, 'La radio');
  assert.ok(todo.length > 10);
  for (const t of todo) assert.doesNotMatch(t, EMOJI, t);
  assert.ok(todo.includes('12 %'), 'las pilas dicen su cifra');
  assert.ok(todo.some(t => t.includes('890 kHz AM')));

  for (const tab of PAUSE_TABS) {
    const g = { menu: { isOpen: false, open(c) { this.config = c; } }, stats: { dinero: 1500, level: 2, xp: 10, hambre: 50 }, clock: { day: 2, hour: 22.5 }, audio: { volume: .5, isMuted: () => false }, mapView: null, _getPOIs: () => [], player: {}, creator: {} };
    if (tab.id === 'mapa') continue; // el mapa tiene sus propias pruebas
    openPauseMenu(g, tab.id);
    assert.equal(g.menu.config.title, 'Un momentico');
    const hecho = g.menu.config.render();
    const palabras = [...textos(hecho.body), ...textos(hecho.tabs), g.menu.config.sub];
    for (const t of palabras) assert.doesNotMatch(t, EMOJI, `${tab.id}: ${t}`);
  }
});

test('las mañas: botones de verdad, sin estrellas ni emojis, y el costo con palabra', () => {
  globalThis.window = {};
  const panel = { html: '', set innerHTML(v) { this.html = v; }, querySelectorAll: () => [] };
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), talentPanel: panel });
  const ts = { points: 2, has: (id) => id === 'collector1', canUnlock: (id) => id === 'collector2' };
  hud.renderTalents(ts);
  assert.match(panel.html, /<h2>Mañas<\/h2>/);
  assert.equal(panel.html.match(/<button type="button" class="talent-node/g).length, Object.keys(TALENTS).length);
  assert.match(panel.html, /class="talent-node available" data-id="collector2">/);
  assert.match(panel.html, /class="talent-node unlocked" data-id="collector1" aria-disabled="true"/);
  assert.match(panel.html, /class="talent-name chulo">Buen ojo/, 'hecho es chulo');
  assert.doesNotMatch(panel.html, EMOJI);
  assert.equal(BRANCHES.length, 3);
});

test('la mesa escribe sus recetas como sumas, y tacha lo que falta', async () => {
  const { CraftingSystem } = await import('../src/systems/CraftingSystem.js');
  const { InventorySystem } = await import('../src/systems/InventorySystem.js');
  const { ITEMS } = await import('../src/data/items.js');
  globalThis.window = {};
  const panel = { html: '', set innerHTML(v) { this.html = v; }, querySelectorAll: () => [] };
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), craftPanel: panel });
  const inv = new InventorySystem(20);
  inv.add(ITEMS.botella, 1);
  hud.renderCrafting(new CraftingSystem(), inv, null);
  const curita = panel.html.match(/<button[^>]*data-id="curita"[\s\S]*?<\/button>/)[0];
  assert.match(curita, /craft-parte">[\s\S]*Botella/);
  assert.match(curita, /craft-parte tachado">[\s\S]*Cartón/);
  assert.match(curita, />\+<\/span>/);
  assert.match(curita, />=<\/span>/);
  assert.match(panel.html, /<h2>La mesa<\/h2>/);
  assert.match(panel.html, /\d,\d de 20 kg/, 'los kilos, con coma');
});

test('el jíbaro habla como habla, sin emojis, y su botón sigue siendo el mismo', async () => {
  const { ITEMS } = await import('../src/data/items.js');
  const { cop } = await import('../src/utils/money.js');
  const panel = { html: '', set innerHTML(v) { this.html = v; }, querySelectorAll: () => [] };
  globalThis.window = { __game: { stats: { dinero: 2000 }, clock: { isNight: true }, inventory: { items: [{ id: 'pegante', qty: 1 }], totalWeight: 1, maxWeight: 20 }, dealer: { getProducts: () => [{ ...ITEMS.tintico, amount: 1, animo: 1, energia: 1 }] } } };
  const hud = Object.assign(Object.create(HUD.prototype), { _htmlCache: new WeakMap(), dealerPanel: panel });
  hud.renderDealer();
  assert.match(panel.html, /<h2>El jíbaro<\/h2>/);
  assert.ok(panel.html.includes(`Plata: ${cop(2000)}`));
  assert.match(panel.html, /class="dealer-sell-btn"/);
  assert.doesNotMatch(panel.html, EMOJI);
  delete globalThis.window.__game;
});

test('lo muerto no vuelve: hojas sin clases viejas, sin foco propio y sin colores de antes', () => {
  const hojas = ['pausa', 'mapa', 'costal', 'mesa', 'paneles'].map(h => [h, leer(`src/ui/css/${h}.css`)]);
  for (const [h, css] of hojas) {
    assert.doesNotMatch(css, /\.inv-row|\.inv-cap|\.inv-d-|\.inv-detail|\.pause-sub|\.signal-|--item-|--urban-|--street-|--hud-/, h);
    assert.doesNotMatch(css, /:focus-visible|outline:\s*none/, h);
    assert.doesNotMatch(css, /backdrop-filter|filter:\s*drop-shadow/, h);
    assert.doesNotMatch(css, /@keyframes[^{]*\{[^}]*(color|opacity|background)/, `${h}: nada de brillo o color animado`);
  }
  assert.doesNotMatch(leer('src/ui/css/base.css'), /\.signal-full|\.item-pedestal|--item-panel/);
});
