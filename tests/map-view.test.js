import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { MapView } from '../src/ui/MapView.js';
import { pasarTexto } from '../src/ui/pictos.js';

// DOM mínimo: lo justo para armar el panel, pulsar sus botones y seguir el foco.
function node(tag) {
  return {
    tag, className: '', textContent: '', children: [], attributes: {}, listeners: {}, dataset: {}, style: {}, scrollTop: 0,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(k, v) { this.attributes[k] = v; if (k.startsWith('data-')) this.dataset[k.slice(5)] = v; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    contains(other) { return other === this || this.children.some(c => c?.contains?.(other)); },
    querySelector(selector) { return find(this, n => matches(n, selector))[0] ?? null; },
    focus() { document.activeElement = this; },
  };
}
const matches = (n, selector) => {
  const data = selector.match(/^\[data-focus="(.+)"\]$/);
  return data ? n.dataset?.focus === data[1] : n.className?.split(' ').includes(selector.slice(1));
};
const find = (root, test) => (root.children ?? []).flatMap(c => [...(c?.children && test(c) ? [c] : []), ...find(c, test)]);
const byClass = (root, cls) => find(root, n => n.className?.split(' ').includes(cls));
const text = (n) => (typeof n === 'string' ? n : `${n.textContent}${n.children.map(text).join('')}`).replaceAll(' ', ' ');
const click = (n) => n.listeners.click();

const fogata = (x, z = 0) => ({ name: 'Fogata de caneca', icon: '🔥', x, z, service: 'fogata', prices: { calor: 0 } });
const dulces = { name: 'Dulces y minutos', icon: '🍬', x: 6, z: 0, service: 'chaza', prices: { comida: 1200, agua: 2000, calor: 1200 } };
const recicladora = { name: 'Recicladora El Progreso', icon: '♻️', x: 72, z: 0, prices: { vender: 0 } };
const crafteo = { name: 'Crafteo', icon: '🔨', x: 10, z: 0 };
const gasolinera = { name: 'Gasolinera', icon: '⛽', x: 200, z: 0, decor: true };

const FIRES = [fogata(10), fogata(40), fogata(60), fogata(80)];
const POIS = [...FIRES, dulces, crafteo, recicladora, gasolinera];

function makeGame({ pois = POIS, needs = {}, walk = (_, to) => Math.abs(to.x), waypoint = null } = {}) {
  return {
    player: { position: { x: 0, z: 0 } },
    _needs: needs,
    _getPOIs: () => pois,
    gps: {
      waypoint, route: waypoint ? [{}, {}] : [],
      routeLengthTo: walk,
      remainingDistance: () => 50,
    },
    marked: [],
    setGpsWaypoint(target) { this.marked.push(target); this.gps.waypoint = target; this.gps.route = [{}, {}]; },
    clearGpsWaypoint() { this.gps.waypoint = null; this.gps.route = []; },
  };
}

function view(options) {
  const map = new MapView(makeGame(options));
  Object.assign(map, { cssWidth: 800, cssHeight: 600, zoom: 2.2, dpr: 1 });
  map._renderSidebar();
  return map;
}

const FREEZING = { need: 'calor', money: 0, carried: {} };
const rowNames = (map) => byClass(map.sidebar, 'map-view__place-name').map(text);
const cta = (map) => byClass(map.sidebar, 'map-view__nearest')[0];
const noOption = (map) => byClass(map.sidebar, 'map-view__no-option')[0];
const filter = (map, id) => find(map.sidebar, n => n.dataset?.focus === `filtro-${id}`)[0];
// Con contadores: sin ellos, quitar preventDefault o stopPropagation de _onKey no haría fallar nada.
const pressed = (code, extra = {}) => ({ code, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }, ...extra });

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = { activeElement: null, createElement: node };
  globalThis.requestAnimationFrame = (fn) => fn();
});

test('«Todo» sin necesidad: sin botón, las fogatas en una fila y orden a pie', () => {
  const map = view({ walk: (_, to) => (to === gasolinera ? 5 : Math.abs(to.x)) });
  assert.equal(cta(map), undefined);
  assert.equal(noOption(map), undefined);
  assert.deepEqual(rowNames(map), ['Gasolinera', 'Dulces y minutos', 'Fogata de caneca', 'La mesa', 'Recicladora El Progreso']);
  assert.equal(text(byClass(map.sidebar, 'map-view__list-title')[0]), 'Ir a… (más cerca a pie primero)');
  assert.match(text(byClass(map.sidebar, 'map-view__dest')[0]), /Haga clic en el mapa/);
  const metas = byClass(map.sidebar, 'map-view__place-meta').map(text);
  assert.ok(metas.includes('Solo referencia, no vende'));
  assert.ok(metas.includes('Calor gratis, El Cartucho'));
  assert.ok(metas.includes('Comida, agua, calor, desde $ 1.200'));
  assert.ok(metas.includes('Se abre con C, desde cualquier sitio'), 'la mesa no se usa caminando hasta ella');
  assert.ok(byClass(map.sidebar, 'map-view__place-meta').some(meta => meta.textContent.endsWith('desde $ 1.200')), 'el precio no se parte en dos líneas');
  assert.equal(filter(map, 'todo').attributes['aria-pressed'], 'true');
  assert.equal(filter(map, 'calor').attributes['aria-pressed'], 'false');
  assert.ok(filter(map, 'todo').className.includes('is-active'));
});

test('los filtros forman un grupo con nombre para el lector de pantalla', () => {
  const group = byClass(view().sidebar, 'map-view__filters')[0];
  assert.equal(group.attributes.role, 'group');
  assert.equal(group.attributes['aria-label'], 'Filtrar lugares');
  assert.deepEqual(group.children.map(text), ['Todo', 'Comida', 'Agua', 'Calor', 'Vender']);
});

test('con frío y sin plata, el botón marca la fogata de menor recorrido a pie', () => {
  // La fogata más cercana en recta (x 10) es la más lejana a pie.
  const map = view({ needs: FREEZING, walk: (_, to) => (to === FIRES[0] ? 500 : Math.abs(to.x)) });
  assert.equal(text(cta(map)), 'Ir al calor más cercano');
  assert.equal(map._focusCta, cta(map), 'M + Enter debe trazar la ruta');
  assert.match(text(byClass(map.sidebar, 'map-view__dest')[0]), /Me estoy congelando/);
  assert.ok(filter(map, 'calor').className.includes('is-need'));
  assert.equal(filter(map, 'todo').attributes['aria-pressed'], 'true', 'el filtro nunca cambia solo');
  click(cta(map));
  assert.deepEqual(map.game.marked, [{ name: 'Fogata de caneca', icon: '🔥', x: 40, z: 0 }]);
  assert.equal(cta(map), undefined, 'con destino y «Todo» desaparece');
  assert.equal(map._focusCta, null);
});

test('si ya lleva con qué resolverlo, avisa y no manda a comprar', () => {
  const map = view({ needs: { ...FREEZING, carried: { calor: 'Empanada con ají' } } });
  assert.equal(cta(map), undefined);
  assert.equal(noOption(map), undefined);
  assert.match(text(byClass(map.sidebar, 'map-view__dest')[0]), /Llevo: Empanada con ají\. Se usa desde el costal con I/);
  // Con el filtro elegido a mano sí ofrece ir, porque lo pidió el jugador.
  click(filter(map, 'calor'));
  assert.equal(text(cta(map)), 'Ir al calor más cercano');
});

test('con el filtro «Agua» y sin plata explica por qué; con reciclaje ofrece ir a vender', () => {
  const map = view({ needs: { money: 0, carried: {} } });
  click(filter(map, 'agua'));
  assert.equal(filter(map, 'agua').attributes['aria-pressed'], 'true');
  assert.equal(cta(map), undefined);
  assert.equal(text(noOption(map)), 'No alcanza: agua desde $ 2.000. Pida limosna (B).');
  assert.deepEqual(rowNames(map), ['Dulces y minutos'], 'el filtro deja solo lo que sirve');
  assert.equal(text(byClass(map.sidebar, 'map-view__list-title')[0]), 'Ir a… (primero lo que sirve)');
  const [row] = byClass(map.sidebar, 'map-view__place');
  assert.ok(row.className.includes('is-broke'));
  assert.equal(text(byClass(map.sidebar, 'map-view__place-meta')[0]), 'Agua desde $ 2.000, sin plata');
  assert.equal(map._focusCta, null);

  const material = { money: 0, carriesRecyclables: true, recycleValue: 2000, recycleKg: 1, carried: {} };
  const selling = view({ needs: material });
  click(filter(selling, 'agua'));
  assert.equal(text(cta(selling)), 'Ir a vender');
  assert.equal(text(noOption(selling)), 'No alcanza: agua desde $ 2.000. Venda material o pida limosna (B).', 'el botón no borra el motivo');
  click(cta(selling));
  assert.equal(selling.game.marked[0].name, 'Recicladora El Progreso');

  const little = view({ needs: { ...material, recycleValue: 1999 } });
  click(filter(little, 'agua'));
  assert.equal(cta(little), undefined, 'si lo que cobras no alcanza, el viaje no sirve');
  assert.match(text(noOption(little)), /Venda material o pida limosna/);
});

test('sin plata, de noche y con sustancias, «Ir a vender» lleva al Dealer si paga lo suficiente', () => {
  const dealer = { name: 'Dealer', icon: '💀', x: 30, z: 0, dealer: true };
  const pois = [dulces, recicladora, dealer];
  const hungry = { need: 'comida', money: 0, carriesSubstances: true, substanceValue: 5400, night: true, carried: {} };
  const map = view({ pois, needs: hungry });
  assert.equal(text(cta(map)), 'Ir a vender');
  assert.equal(map._focusCta, cta(map), 'M + Enter también lleva a vender');
  assert.equal(text(noOption(map)), 'No alcanza: comida desde $ 1.200. Venda sustancias o pida limosna (B).');
  click(cta(map));
  assert.equal(map.game.marked[0].name, 'Dealer');

  assert.equal(cta(view({ pois, needs: { ...hungry, substanceValue: 450 } })), undefined, 'una hierba no paga la comida');
  assert.equal(cta(view({ pois, needs: { ...hungry, night: false } })), undefined, 'de día no compra');
});

test('con el costal lleno lo dice, y «Ir a vender» nunca lleva al Dealer', () => {
  const dealer = { name: 'Dealer', icon: '💀', x: 3, z: 0, dealer: true };
  const stall = { ...dulces, offers: { agua: [{ price: 2000, weight: .5 }] } };
  const pois = [stall, recicladora, dealer];
  const full = { money: 5000, kg: 19.9, maxKg: 20, carriesRecyclables: true, recycleValue: 1000, recycleKg: 1, carriesSubstances: true, substanceValue: 5400, night: true, carried: {} };

  const thirsty = view({ pois, needs: { ...full, need: 'agua' } });
  assert.equal(text(cta(thirsty)), 'Ir a vender');
  assert.equal(text(noOption(thirsty)), 'No cabe en el costal: venda material o tire algo.');
  click(filter(thirsty, 'agua'));
  assert.equal(text(byClass(thirsty.sidebar, 'map-view__place-meta')[0]), 'Agua desde $ 2.000, no cabe');
  click(cta(thirsty));
  assert.equal(thirsty.game.marked[0].name, 'Recicladora El Progreso');

  const loaded = view({ pois, needs: { ...full, need: 'vender' } });
  assert.equal(text(cta(loaded)), 'Ir a vender');
  click(cta(loaded));
  assert.equal(loaded.game.marked[0].name, 'Recicladora El Progreso', 'el Dealer queda más cerca, pero no compra reciclaje');
});

test('si «Ir a vender» lleva al Dealer, el texto no pide vender material', () => {
  const dealer = { name: 'Dealer', icon: '💀', x: 3, z: 0, dealer: true };
  const stall = { ...dulces, prices: { comida: 1000 }, offers: { comida: [{ price: 1000, weight: .25 }, { price: 1200, weight: .2 }] } };
  const needs = { need: 'comida', money: 1000, kg: 19.79, maxKg: 20, carriesRecyclables: true, carriesSubstances: true, substanceValue: 5400, night: true };

  const hungry = view({ pois: [stall, dealer], needs });
  assert.equal(text(cta(hungry)), 'Ir a vender');
  assert.equal(text(noOption(hungry)), 'Lo que alcanza no cabe: venda sustancias o tire algo.');
  click(cta(hungry));
  assert.equal(hungry.game.marked[0].name, 'Dealer');
});

test('«Vender» distingue entre no llevar nada y que el dealer solo compre de noche', () => {
  const dealer = { name: 'Dealer', icon: '💀', x: 30, z: 0, dealer: true };
  const pois = [...POIS, dealer];
  const empty = view({ pois, needs: { money: 0, carried: {} } });
  click(filter(empty, 'vender'));
  assert.equal(text(noOption(empty)), 'No llevo nada que me compren.');
  assert.equal(byClass(empty.sidebar, 'map-view__place').some(row => row.className.includes('is-broke')), false);

  const day = view({ pois, needs: { carriesSubstances: true, night: false, carried: {} } });
  click(filter(day, 'vender'));
  assert.equal(text(noOption(day)), 'El jíbaro solo compra de noche, desde las 20:00.');

  const night = view({ pois, needs: { carriesSubstances: true, night: true, carried: {} } });
  click(filter(night, 'vender'));
  click(cta(night));
  assert.equal(night.game.marked[0].name, 'Dealer');
});

test('con destino y «Todo» no hay botón; con un filtro sí, y reemplaza el destino', () => {
  const waypoint = { name: 'Crafteo', icon: '🔨', x: 10, z: 0 };
  const map = view({ waypoint, needs: FREEZING });
  assert.equal(cta(map), undefined);
  assert.match(text(byClass(map.sidebar, 'map-view__dest')[0]), /La mesa/);
  assert.ok(byClass(map.sidebar, 'map-view__place').find(row => text(row).includes('La mesa')).className.includes('is-active'));
  click(filter(map, 'calor'));
  click(cta(map));
  assert.equal(map.game.gps.waypoint.name, 'Fogata de caneca');
});

test('las fogatas se llaman igual: su fila es el destino solo si es esa misma fogata', () => {
  const fireRow = (waypoint) => byClass(view({ waypoint }).sidebar, 'map-view__place').find(row => text(row).includes('Fogata'));
  const marked = (x, z = 0) => ({ name: 'Fogata de caneca', icon: '🔥', x, z });
  assert.ok(fireRow(marked(10)).className.includes('is-active'));
  assert.ok(fireRow(marked(12, 2)).className.includes('is-active'), 'el destino puede estar en la acera de al lado');
  assert.ok(!fireRow(marked(80)).className.includes('is-active'), 'otra fogata no marca la más cercana');
  assert.ok(fireRow(marked(13.9)).className.includes('is-active'));
  assert.ok(!fireRow(marked(14.1)).className.includes('is-active'));
});

test('un lugar fijo sigue siendo el destino aunque la ruta lo haya movido a la acera', () => {
  const colpatria = { name: 'Torre Colpatria', icon: '🏙️', x: 100, z: 0 };
  const map = view({ pois: [colpatria], waypoint: { ...colpatria, x: 116.4 } });
  assert.ok(byClass(map.sidebar, 'map-view__place')[0].className.includes('is-active'));
});

test('un lugar sin camino dice «sin ruta» y va al final', () => {
  const map = view({ walk: (_, to) => (to === dulces ? null : Math.abs(to.x)) });
  assert.equal(rowNames(map).at(-1), 'Dulces y minutos');
  assert.equal(byClass(map.sidebar, 'map-view__place-dist').map(text).at(-1), 'sin ruta');
});

test('la distancia a pie se calcula una vez por lugar mientras dura la pestaña', () => {
  let searches = 0;
  const map = view({ walk: (_, to) => { searches++; return Math.abs(to.x); } });
  const points = new Set(POIS.map(poi => `${poi.x}|${poi.z}`)).size; // el Crafteo comparte punto con una fogata
  assert.equal(searches, points);
  map._renderSidebar();
  click(filter(map, 'calor'));
  click(filter(map, 'todo'));
  assert.equal(searches, points);
  map.mount({ recenter: false });
  assert.equal(searches, points * 2, 'al volver a la pestaña se mide de nuevo');
});

test('sin jugador el panel se dibuja sin medir ni fallar', () => {
  const game = makeGame({ needs: FREEZING });
  game.player = null;
  const map = new MapView(game);
  map._renderSidebar();
  assert.equal(byClass(map.sidebar, 'map-view__place-dist').map(text).join(''), '');
});

test('el lienzo oculta puestos y fogatas al ver toda la ciudad, y con filtro deja arriba lo que coincide', () => {
  const map = view();
  map.zoom = 1;
  assert.ok(map._visiblePois().every(poi => !poi.service));
  map.zoom = 1.6;
  assert.ok(map._visiblePois().some(poi => poi.service));
  map.zoom = 1;
  map.filter = 'calor';
  const pois = map._visiblePois();
  assert.equal(pois.length, POIS.length);
  assert.deepEqual(pois.slice(-5).map(poi => poi.name), [...FIRES.map(poi => poi.name), 'Dulces y minutos']);
});

test('en un empate gana el lugar de encima: el Crafteo sin filtro, la fogata con «Calor»', () => {
  const map = view();
  const [sx, sy] = map._toScreen(10, 0);
  assert.equal(map._hit(sx, sy), crafteo, 'mismo punto, servicios primero');
  map.filter = 'calor';
  assert.equal(map._hit(sx, sy), FIRES[0]);
  map.filter = 'todo';
  map.zoom = 1;
  const [ox, oy] = map._toScreen(40, 0);
  assert.equal(map._hit(ox, oy), null, 'lo oculto no recibe clic');
});

test('al elegir un lugar la vista encuadra al jugador y el destino, y solo aleja si hace falta', () => {
  const map = view();
  map._frame({ x: 100, z: 0 });
  assert.equal(map.centerX, 50);
  assert.equal(map.centerZ, 0);
  assert.equal(map.zoom, 2.2, 'ya cabía');
  map._frame({ x: 0, z: 400 });
  assert.equal(map.centerZ, 200);
  assert.ok(Math.abs(map.zoom - 1.2) < 1e-9, `${map.zoom}`);
  map._frame({ x: 0, z: 0 });
  assert.equal(map.zoom, 1.2, 'sobre el jugador no divide entre cero ni acerca');
  const unsized = new MapView(makeGame());
  unsized.zoom = 2;
  unsized._frame({ x: 30, z: 40 });
  assert.deepEqual([unsized.centerX, unsized.centerZ, unsized.zoom], [30, 40, 2]);
});

test('elegir una fila encuadra la ruta y marca el lugar con la forma de siempre', () => {
  const map = view();
  const row = byClass(map.sidebar, 'map-view__place').find(r => text(r).includes('Recicladora'));
  click(row);
  assert.equal(map.centerX, 36);
  assert.deepEqual(map.game.marked, [{ name: 'Recicladora El Progreso', icon: '♻️', x: 72, z: 0 }]);
});

test('al volver a dibujar el panel el foco se conserva, o pasa al lienzo si el control ya no existe', () => {
  const map = view({ needs: FREEZING });
  filter(map, 'agua').focus();
  click(filter(map, 'agua'));
  assert.equal(document.activeElement, filter(map, 'agua'), 'el mando conserva su sitio');

  click(filter(map, 'todo'));
  const button = cta(map);
  button.focus();
  click(button);
  assert.equal(document.activeElement, map.canvas, 'el botón desapareció con la ruta');

  const quit = byClass(map.sidebar, 'btn').find(b => text(b) === 'Quitar destino');
  quit.focus();
  click(quit);
  assert.equal(document.activeElement, map.canvas);
  assert.equal(map.game.gps.waypoint, null);
});

test('el foco no se mueve si estaba fuera del panel, y cada filtro empieza la lista desde arriba', () => {
  const map = view();
  const elsewhere = node('button');
  document.activeElement = elsewhere;
  map._renderSidebar();
  assert.equal(document.activeElement, elsewhere);

  byClass(map.sidebar, 'map-view__list')[0].scrollTop = 120;
  map.sidebar.scrollTop = 80;
  map._renderSidebar();
  assert.equal(byClass(map.sidebar, 'map-view__list')[0].scrollTop, 120, 'marcar un lugar no mueve la lista');
  assert.equal(map.sidebar.scrollTop, 80);
  click(filter(map, 'calor'));
  assert.equal(byClass(map.sidebar, 'map-view__list')[0].scrollTop, 0);
  assert.equal(map.sidebar.scrollTop, 0, 'con la identidad urbana se desplaza el panel entero');
});

test('el foco inicial va al botón con necesidad y al lienzo en cualquier otro caso', () => {
  const urgent = view({ needs: FREEZING });
  urgent.mount({ recenter: false });
  assert.equal(document.activeElement, cta(urgent));

  const calm = view();
  calm.mount({ recenter: false });
  assert.equal(document.activeElement, calm.canvas);

  const filtered = view({ needs: FREEZING });
  click(filter(filtered, 'calor'));
  filtered.mount({ recenter: false });
  assert.equal(document.activeElement, cta(filtered), 'el filtro de esa misma necesidad no le quita el botón');

  const chosen = view();
  click(filter(chosen, 'calor'));
  chosen.mount({ recenter: false });
  assert.equal(document.activeElement, chosen.canvas, 'sin urgencia, el botón del filtro no secuestra el foco');
});

test('lo urgente manda sobre el filtro elegido: M + Enter siempre lleva a lo que más se necesita', () => {
  const map = view({ needs: FREEZING });
  click(filter(map, 'agua'));
  assert.equal(text(cta(map)), 'Ir al calor más cercano');
  assert.equal(filter(map, 'agua').attributes['aria-pressed'], 'true', 'el filtro nunca cambia solo');
  assert.deepEqual(rowNames(map), ['Dulces y minutos'], 'y la lista sigue siendo la que eligió');
  map.mount({ recenter: false });
  assert.equal(document.activeElement, cta(map));
  click(cta(map));
  assert.equal(map.game.marked[0].name, 'Fogata de caneca');
  assert.equal(map._focusCta, null, 'con destino, el botón vuelve a ser del filtro y no toma el foco');
});

test('con el foco en el panel, las teclas del mapa siguen funcionando y el foco vuelve al lienzo', () => {
  const map = view({ needs: FREEZING });
  map.mount({ recenter: false });
  const before = map.centerX;
  const arrow = pressed('ArrowRight', { target: cta(map) });
  map.root.listeners.keydown(arrow);
  assert.ok(map.centerX > before);
  assert.equal(document.activeElement, map.canvas);
  assert.deepEqual([arrow.prevented, arrow.stopped], [1, 1], 'ni desplaza la página ni llega a Input');

  // No solo desde el botón: también desde una fila o un filtro.
  const marked = view({ waypoint: { name: 'Crafteo', icon: '🔨', x: 10, z: 0 } });
  const [row] = byClass(marked.sidebar, 'map-view__place');
  row.focus();
  marked.root.listeners.keydown(pressed('Delete', { target: row }));
  assert.equal(marked.game.gps.waypoint, null);
  assert.equal(document.activeElement, marked.canvas);

  const center = marked.centerX;
  const held = filter(marked, 'calor');
  held.focus();
  marked.root.listeners.keydown(pressed('ArrowLeft', { target: held }));
  assert.ok(marked.centerX < center);
});

test('Enter y Espacio en un botón del panel son de ese botón: ni marcan el centro ni mueven el foco', () => {
  const map = view({ needs: FREEZING });
  map.mount({ recenter: false });
  const button = cta(map);
  map._panned = true;
  for (const code of ['Enter', 'NumpadEnter', 'Space']) {
    const key = pressed(code, { target: button });
    map.root.listeners.keydown(key);
    assert.deepEqual([key.prevented, key.stopped], [0, 0], `${code}: el clic nativo del botón no se cancela`);
  }
  const tab = pressed('Tab', { target: button });
  map.root.listeners.keydown(tab);
  assert.equal(tab.prevented, 0);
  assert.equal(document.activeElement, button);
  assert.deepEqual(map.game.marked, []);
});

test('«+» y «-» también sirven en teclados español y latinoamericano, y los atajos del navegador no son del mapa', () => {
  const map = view();
  const start = map.zoom;
  assert.equal(map._onKey(pressed('BracketRight', { key: '+' })), true);
  assert.ok(map.zoom > start);
  const closer = map.zoom;
  assert.equal(map._onKey(pressed('Slash', { key: '-' })), true);
  assert.ok(map.zoom < closer);
  const zoom = map.zoom;
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
    const key = pressed('Equal', { key: '=', [modifier]: true });
    assert.equal(map._onKey(key), false, modifier);
    assert.equal(key.prevented, 0);
  }
  assert.equal(map.zoom, zoom);
});

test('Enter en el lienzo marca el centro solo si se movió la vista, y nunca reemplaza la ruta sin querer', () => {
  const map = view({ needs: FREEZING });
  click(cta(map));
  const key = pressed;
  assert.equal(map._onKey(key('Enter')), true);
  assert.equal(map.game.gps.waypoint.name, 'Fogata de caneca', 'M + Enter sin botón no reemplaza la ruta');

  assert.equal(map._onKey(key('ArrowRight')), true);
  map._onKey(key('Enter', { repeat: true }));
  assert.equal(map.game.gps.waypoint.name, 'Fogata de caneca', 'mantener Enter tampoco');
  map._onKey(key('Enter'));
  assert.equal(map.game.gps.waypoint.name, 'Punto marcado');
  map._onKey(key('Enter'));
  assert.equal(map.game.marked.length, 2, 'volver a pulsarlo no marca otra vez el mismo punto');

  map._onKey(key('ArrowUp'));
  map.mount({ recenter: false });
  map._onKey(key('Space'));
  assert.equal(map.game.marked.length, 2, 'al volver a la pestaña la vista empieza sin mover');

  map._onKey(key('ArrowUp'));
  const space = key('Space');
  map._onKey(space);
  assert.equal(map.game.marked.length, 3, 'Espacio también marca tras mover la vista');
  assert.deepEqual([space.prevented, space.stopped], [1, 1]);
  map._onKey(key('ArrowUp'));
  map._onKey(key('NumpadEnter'));
  assert.equal(map.game.marked.length, 4);
  assert.equal(map._onKey({ code: 'KeyW' }), false, 'lo que no es suyo sigue su camino');
});

test('«Centrar en mí» y «Ver toda la ciudad» deshacen el movimiento: Enter ya no reemplaza la ruta', () => {
  const map = view({ needs: FREEZING });
  click(cta(map));
  map.game.mapPlan = { originX: 0, originZ: 0, worldWidth: 240, worldHeight: 322 };
  for (const reset of ['centerOnPlayer', 'fitCity']) {
    map._onKey(pressed('ArrowRight'));
    map[reset]();
    map._onKey(pressed('Enter'));
    assert.equal(map.game.gps.waypoint.name, 'Fogata de caneca', reset);
  }
});

test('un arrastre cortado no sigue al ratón ni marca nada con el mapa cerrado', () => {
  const map = view();
  map.canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const down = () => map.canvas.listeners.pointerdown({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  down();
  map.mount({ recenter: false });
  map.canvas.listeners.pointermove({ clientX: 300, clientY: 100 });
  assert.equal(map._panned, false, 'al volver a la pestaña, mover el ratón no arrastra');

  down();
  map.canvas.listeners.pointermove({ clientX: 300, clientY: 100, buttons: 0 });
  assert.equal(map._drag, null, 'el botón se soltó fuera del lienzo');
  assert.equal(map._panned, false);

  down();
  map.canvas.getClientRects = () => [];
  map.canvas.listeners.pointerup({ clientX: 100, clientY: 100 });
  assert.deepEqual(map.game.marked, [], 'el menú se cerró a mitad del clic');
  map.canvas.getClientRects = () => [{}];
  down();
  map.canvas.listeners.pointerup({ clientX: 100, clientY: 100 });
  assert.equal(map.game.marked.length, 1, 'con el mapa a la vista, el clic marca');
});

test('arrastrar el lienzo también habilita marcar el centro con Enter', () => {
  const map = view();
  map.canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const press = { preventDefault() {}, stopPropagation() {}, code: 'Enter' };
  map._onKey(press);
  assert.deepEqual(map.game.marked, []);
  map.canvas.listeners.pointerdown({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  map.canvas.listeners.pointermove({ clientX: 102, clientY: 100 });
  map._onKey(press);
  assert.deepEqual(map.game.marked, [], 'un temblor no es arrastre');
  map.canvas.listeners.pointermove({ clientX: 130, clientY: 100 });
  map.canvas.listeners.pointerup({ clientX: 130, clientY: 100 });
  map._onKey(press);
  assert.equal(map.game.marked[0].name, 'Punto marcado');
});

test('el lienzo dibuja según zoom y filtro, y atenúa lo que no coincide', () => {
  const log = [];
  const state = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      // Cada lugar es una imagen ya hecha: lo que se comprueba es cuál se pega, a qué tamaño y con qué opacidad.
      if (key === 'drawImage') return (img) => { if (img.glyph) log.push({ text: img.glyph, size: img.size, alpha: target.globalAlpha ?? 1 }); };
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const map = view();
  map.ctx = ctx;
  map._hornoAlDia = () => {};
  map._dibujo = (glyph, size) => ({ canvas: { glyph, size }, w: size, h: size });
  map._reparto = () => [];
  const icons = () => log.map(e => e.text);
  const fire = pasarTexto('🔥'), mesa = pasarTexto('🔨');

  map.zoom = 1;
  map.draw();
  assert.ok(!icons().includes(fire) && !icons().includes(pasarTexto('🍬')));
  assert.ok(icons().includes(mesa));

  log.length = 0;
  map.zoom = 2;
  map.draw();
  assert.equal(log.find(e => e.text === fire).size, 18, 'en «Todo», puestos y fogatas van más pequeños');
  assert.equal(log.find(e => e.text === mesa).size, 24);

  log.length = 0;
  map.filter = 'calor';
  map.draw();
  const lit = log.findIndex(e => e.text === fire), dim = log.findIndex(e => e.text === mesa);
  assert.equal(log[lit].alpha, 1);
  assert.equal(log[lit].size, 24, 'con filtro, lo que coincide va a tamaño normal');
  assert.equal(log[dim].alpha, .35);
  assert.ok(dim < lit, 'lo atenuado queda debajo');
  assert.equal(state.globalAlpha, 1, 'la opacidad vuelve a la normalidad');
});
