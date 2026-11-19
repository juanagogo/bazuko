import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { Player } from '../src/entities/Player.js';
import { CONTROL_GROUPS, openPauseMenu } from '../src/ui/PauseMenu.js';
import { Menu } from '../src/ui/Menu.js';
import { SangreGolpes } from '../src/systems/SangreGolpes.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    createElement(tag) {
      return {
        tag,
        className: '',
        textContent: '',
        children: [],
        attributes: {},
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        setAttribute(k, v) { this.attributes[k] = v; },
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.children.push(node); return node; }
      };
    },
  };
});

test('openPauseMenu abre el menú con controles de audio, estado y opciones rápidas', () => {
  let openedConfig = null;
  const game = {
    _deathPending: false,
    creator: { isOpen: false },
    audio: { volume: 0.7, isMuted: () => false, setVolume() {}, toggleMute() {} },
    stats: { dinero: 5000, level: 2, salud: 85, sed: 70, hambre: 60 },
    clock: { day: 1, hour: 14.5 },
    look: { nombre: 'Tester' },
    menu: {
      open(cfg) { openedConfig = cfg; }
    }
  };

  openPauseMenu(game);
  assert.ok(openedConfig);
  assert.equal(openedConfig.title, 'Un momentico');

  const rendered = openedConfig.render();
  assert.ok(rendered.body);
  assert.ok(rendered.foot);
  assert.equal(rendered.foot.length, 1);
});

test('Controles muestra Y después de Z para robar un carro parqueado y bajarse al volante', () => {
  const [, acciones] = CONTROL_GROUPS.find(([grupo]) => grupo === 'Acciones');
  assert.deepEqual(acciones.slice(-2), [
    ['Z', 'Popó'],
    ['Y', 'Junto a un carro parqueado: robarlo. Al volante: bajarme']
  ]);
});

test('Ajustes conserva el botón de Sangre enfocado y solo guarda esa preferencia entre partidas', t => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const guardado = new Map([['bazuko.graphics_quality', 'alta'], ['bazuko.traffic_density', 'normal']]);
  const almacenamiento = { getItem: id => guardado.get(id), setItem: (id, valor) => guardado.set(id, valor) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: almacenamiento });
  t.after(() => {
    if (anterior) Object.defineProperty(globalThis, 'localStorage', anterior);
    else delete globalThis.localStorage;
  });
  const iniciar = () => {
    const sangre = new SangreGolpes(new THREE.Scene(), {}, {}, null);
    t.after(() => sangre.dispose());
    return sangre;
  };
  const game = { sangre: iniciar(), menu: { open(cfg) { this.cfg = cfg; } } };
  t.after(() => game.menu.cfg?.onLeave());
  openPauseMenu(game, 'ajustes');
  function buscarGrupo(nodo) {
    if (nodo.attributes?.['aria-label'] === 'Sangre') return nodo;
    for (const hijo of nodo.children ?? []) {
      const grupo = buscarGrupo(hijo);
      if (grupo) return grupo;
    }
  }
  const botones = buscarGrupo(game.menu.cfg.render().body).children;
  assert.deepEqual(botones.map(b => b.children[0].textContent), ['Desactivada', 'Discreta', 'Visible']);
  const elegidos = () => botones.map(b => b.attributes['aria-pressed'] === 'true');
  assert.deepEqual(elegidos(), [false, true, false]);
  for (const [i, id] of [[2, 'visible'], [0, 'desactivada'], [1, 'discreta']]) {
    botones[i].listeners.click();
    assert.deepEqual(elegidos(), botones.map((_, j) => j === i));
    assert.equal(botones[i].children[0].className, 'elegido');
    assert.equal(iniciar().nivel, id);
  }
  assert.deepEqual([...guardado], [['bazuko.graphics_quality', 'alta'], ['bazuko.traffic_density', 'normal'], ['bazuko.sangre', 'discreta']]);
  game.sangre.setNivel('visible', false);
  assert.equal(iniciar().nivel, 'discreta', 'la sala puede probar un nivel sin guardarlo');
  guardado.set('bazuko.sangre', 'invalida');
  assert.equal(iniciar().nivel, 'discreta');
  almacenamiento.getItem = almacenamiento.setItem = () => { throw new Error('Storage bloqueado'); };
  assert.equal(iniciar().setNivel('visible'), 'visible', 'la elección también funciona para la sesión sin storage');
});

test('la pausa tiene pestañas, abre en la pedida y Q/E/M cambian de sección', () => {
  let cfg = null, refreshed = 0, closed = 0;
  const game = {
    creator: { isOpen: false },
    audio: { volume: 0.5, isMuted: () => false, setVolume() {}, toggleMute() {} },
    stats: { dinero: 0, level: 1, xp: 0 }, clock: { day: 2, hour: 22 },
    minimap: { visible: true, zoomBase: 70, setZoomBase: v => v, toggle() {} },
    menu: {
      isOpen: false,
      open(c) { cfg = c; this.isOpen = true; this._render = c.render; },
      refresh() { refreshed++; },
      close() { closed++; this.isOpen = false; cfg.onClose?.(); }
    }
  };
  openPauseMenu(game, 'ajustes');
  assert.equal(cfg.wide, true);
  assert.equal(game._pauseTab, 'ajustes');
  cfg.render();
  const press = (code) => window.dispatchEvent(Object.assign(new Event('keydown'), { code }));
  press('KeyE');
  assert.equal(game._pauseTab, 'controles');
  press('KeyE');
  assert.equal(game._pauseTab, 'mapa');
  press('KeyQ');
  assert.equal(game._pauseTab, 'controles');
  assert.equal(refreshed, 3);
  for (const tab of ['estado', 'ajustes', 'controles']) { game._pauseTab = tab; assert.ok(cfg.render().body); }
  game._pauseTab = 'mapa';
  press('KeyM');
  assert.equal(closed, 1, 'M en la pestaña Mapa cierra la pausa');
  press('KeyE');
  assert.equal(game._pauseTab, 'mapa', 'el listener se retira al cerrar');
});

test('Ajustes muestra la carga iniciada con K y permite reintentar desde el mismo botón tras el fallo', async t => {
  let cfg;
  const player = new Player(new THREE.Scene(), {});
  const game = Object.assign(Object.create(Game.prototype), {
    player, menu: { open(config) { cfg = config; } }
  });
  t.after(() => { cfg?.onLeave?.(); player.dispose(); });
  function botonModelo(node) {
    if (node?.tag === 'button' && node.children.some(n => n?.textContent?.includes('personaje'))) return node;
    return node?.children?.map(botonModelo).find(Boolean);
  }
  const fallo = Promise.withResolvers();
  player._realisticPromise = fallo.promise;
  const teclado = game._toggleModel();
  openPauseMenu(game, 'ajustes');
  const boton = botonModelo(cfg.render().body), etiqueta = boton.children.at(-1);
  assert.match(etiqueta.textContent, /Cancelar carga/);
  fallo.reject(new Error('Descarga interrumpida'));
  await teclado;
  assert.equal(etiqueta.textContent, 'Usar personaje realista (K)');

  const carga = Promise.withResolvers();
  player._realisticPromise = carga.promise;
  boton.listeners.click();
  assert.match(etiqueta.textContent, /Cancelar carga/);
  carga.resolve({ group: new THREE.Group() });
  await player.pendingModel.ready;
  assert.equal(etiqueta.textContent, 'Usar personaje liviano (K)');
});

test('«+» no cambia de pestaña en teclado español, los atajos del navegador tampoco, y cada pestaña empieza arriba', () => {
  const game = {
    creator: { isOpen: false },
    audio: { volume: 0.5, isMuted: () => false, setVolume() {}, toggleMute() {} },
    stats: { dinero: 0, level: 1, xp: 0 }, clock: { day: 2, hour: 22 },
    menu: {
      isOpen: false, bodyEl: { scrollTop: 900 },
      open(c) { this.isOpen = true; this._render = c.render; },
      refresh() {},
      close() {}
    }
  };
  openPauseMenu(game, 'ajustes');
  const press = (code, extra = {}) => window.dispatchEvent(Object.assign(new Event('keydown'), { code, ...extra }));

  press('BracketRight', { key: '+' });
  press('BracketLeft', { key: 'Dead' });
  assert.equal(game._pauseTab, 'ajustes', 'en esos teclados, esas teclas físicas escriben «+» y un acento');
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) press('KeyE', { key: 'e', [modifier]: true });
  assert.equal(game._pauseTab, 'ajustes');
  assert.equal(game.menu.bodyEl.scrollTop, 900, 'quedarse en la pestaña no mueve nada');

  press('BracketRight', { key: ']' });
  assert.equal(game._pauseTab, 'controles');
  assert.equal(game.menu.bodyEl.scrollTop, 0, 'en móvil, la pestaña nueva no aparece a media altura');
  press('BracketLeft', { key: '[' });
  assert.equal(game._pauseTab, 'ajustes');
});

test('Espacio pulsa los botones de cualquier menú, aunque Input lo cancele para el salto', () => {
  const nodes = {};
  document.getElementById = (id) => (nodes[id] ??= Object.assign(document.createElement('div'), {
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    replaceChildren() {},
  }));
  new Menu();
  let stopped = 0;
  const key = (code, target) => ({ code, target, stopPropagation() { stopped++; } });
  const inButton = { closest: (selector) => (selector === 'button' ? {} : null) };
  nodes.menu.listeners.keydown(key('Space', inButton));
  assert.equal(stopped, 1);
  nodes.menu.listeners.keydown(key('Space', { closest: () => null }));
  nodes.menu.listeners.keydown(key('KeyM', inButton));
  assert.equal(stopped, 1, 'lo demás sigue hasta la pausa y el juego');
});

test('pasar de la pausa a otra ventana no deja el teclado de la pausa escuchando', () => {
  let oyentes = 0;
  const original = { add: window.addEventListener, remove: window.removeEventListener };
  window.addEventListener = (tipo) => { if (tipo === 'keydown') oyentes++; };
  window.removeEventListener = (tipo) => { if (tipo === 'keydown') oyentes--; };
  let leave = null;
  const game = {
    _deathPending: false, creator: { isOpen: false },
    audio: { volume: .7, isMuted: () => false, setVolume() {}, toggleMute() {} },
    stats: { dinero: 0, level: 1, salud: 80, sed: 70, hambre: 60 }, clock: { day: 1, hour: 12 }, look: { nombre: 'Tester' },
    menu: { open(cfg) { leave = cfg.onLeave; } },
  };
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    openPauseMenu(game);
    assert.equal(oyentes, 1);
    assert.equal(typeof leave, 'function', 'la pausa dice qué soltar al salir por cualquier lado');
    leave();
    assert.equal(oyentes, 0);
  }
  Object.assign(window, { addEventListener: original.add, removeEventListener: original.remove });
});
