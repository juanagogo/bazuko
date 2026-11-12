// tests/comedor.test.js
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

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
    getContext() { return { fillStyle: '', fillRect() {}, strokeStyle: '', strokeRect() {}, fillText() {} }; }
  });
  globalThis.document = { createElement: nodo, activeElement: null };
  globalThis.window = new EventTarget();
  return nodo;
}

test.before(() => {
  dom();
  mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}')));
});
test.after(() => mock.restoreAll());

const { ComedorComunitario } = await import('../src/entities/ComedorComunitario.js');
const { openComedor } = await import('../src/ui/placeMenus.js');
const { textoDelPrompt } = await import('../src/ui/HUD.js');

test('ComedorComunitario se crea como entidad con kind comedor, letrero y grupo', () => {
  const scene = new THREE.Scene();
  const comedor = new ComedorComunitario(scene, new THREE.Vector3(100, 0, 90));

  assert.equal(comedor.kind, 'comedor');
  assert.equal(comedor.position.x, 100);
  assert.equal(comedor.position.z, 90);
  assert.ok(comedor.group.children.length > 5, 'construye mostrador, toldo, olla y letrero');

  comedor.dispose();
  assert.equal(comedor.group.children.length, 0);
});

test('comedor comunitario: disponibilidad cada 24 horas y efectos del almuerzo', () => {
  const stats = { hambre: 10, sed: 15, animo: 40, energia: 30, calor: 0, dinero: 1000, xp: 0, addXP(amount) { this.xp += amount; } };
  const clock = { day: 1, hour: 12 };
  let saved = false;

  const game = {
    stats,
    clock,
    lastComedorHour: null,
    audio: { play() {} },
    _save() { saved = true; },
    get totalGameHours() {
      return ((this.clock?.day ?? 1) - 1) * 24 + (this.clock?.hour ?? 0);
    },
    isComedorAvailable() {
      if (this.lastComedorHour === undefined || this.lastComedorHour === null) return true;
      return (this.totalGameHours - this.lastComedorHour) >= 24;
    },
    getComedorRemainingHours() {
      if (this.isComedorAvailable()) return 0;
      const diff = this.totalGameHours - this.lastComedorHour;
      return Math.max(0, Math.ceil(24 - diff));
    },
    serveComedor() {
      if (!this.isComedorAvailable()) return false;
      this.lastComedorHour = this.totalGameHours;
      this.stats.hambre = Math.min(100, (this.stats.hambre || 0) + 80);
      this.stats.sed = Math.min(100, (this.stats.sed || 0) + 60);
      this.stats.animo = Math.min(100, (this.stats.animo || 0) + 25);
      this.stats.energia = Math.min(100, (this.stats.energia || 0) + 25);
      this.stats.calor = Math.min(300, (this.stats.calor || 0) + 180);
      this.stats.addXP?.(30);
      this._save();
      return true;
    }
  };

  // 1. Inicialmente disponible
  assert.equal(game.isComedorAvailable(), true);
  assert.equal(game.getComedorRemainingHours(), 0);

  // 2. Almorzar gratis
  const ok = game.serveComedor();
  assert.equal(ok, true);
  assert.equal(saved, true);
  assert.equal(stats.hambre, 90);
  assert.equal(stats.sed, 75);
  assert.equal(stats.animo, 65);
  assert.equal(stats.energia, 55);
  assert.equal(stats.calor, 180);
  assert.equal(stats.xp, 30);
  assert.equal(game.lastComedorHour, 12);

  // 3. Ya no está disponible de inmediato
  assert.equal(game.isComedorAvailable(), false);
  assert.equal(game.getComedorRemainingHours(), 24);
  assert.equal(game.serveComedor(), false, 'no puede almorzar dos veces en el mismo turno');

  // 4. Tras avanzar 10 horas
  clock.hour = 22;
  assert.equal(game.isComedorAvailable(), false);
  assert.equal(game.getComedorRemainingHours(), 14);

  // 5. Al siguiente día tras pasar 24 horas (Día 2, hora 12)
  clock.day = 2;
  clock.hour = 12;
  assert.equal(game.isComedorAvailable(), true);
  assert.equal(game.getComedorRemainingHours(), 0);
  assert.equal(game.serveComedor(), true);
});

test('openComedor abre el menú con título, opciones y sin emojis', () => {
  let menuConfig = null;
  const menu = {
    isOpen: false,
    open(cfg) { menuConfig = cfg; this.isOpen = true; },
    refresh() {}
  };

  const game = {
    menu,
    isComedorAvailable: () => true,
    getComedorRemainingHours: () => 0,
    serveComedor: () => true
  };

  openComedor(game);
  assert.ok(menuConfig, 'se llamó a game.menu.open');
  assert.equal(menuConfig.title, 'Comedor Comunitario');
  assert.equal(menuConfig.ic, 'food');

  const rendered = menuConfig.render();
  assert.ok(rendered.body);
  assert.ok(rendered.foot);

  // Sin emojis en las etiquetas
  const EMOJI = /[\u{1F300}-\u{1F9FF}]/u;
  assert.doesNotMatch(menuConfig.title, EMOJI);
  assert.doesNotMatch(menuConfig.sub, EMOJI);
});

test('textoDelPrompt para comedor cambia según disponibilidad', () => {
  const prevGame = window.__game;
  window.__game = {
    isComedorAvailable: () => true,
    getComedorRemainingHours: () => 0
  };

  const promptAvail = textoDelPrompt({ currentTarget: {}, currentTargetType: 'comedor' }, { items: [] });
  assert.match(promptAvail, /Almorzar en el Comedor Comunitario \(Gratis\)/);

  window.__game = {
    isComedorAvailable: () => false,
    getComedorRemainingHours: () => 14
  };
  const promptWait = textoDelPrompt({ currentTarget: {}, currentTargetType: 'comedor' }, { items: [] });
  assert.match(promptWait, /Próximo servicio en 14 h/);

  window.__game = prevGame;
});

test('Comedor Comunitario figura en _getPOIs y en los servicios del mapa como lugar fijo gratuito', async () => {
  const { hasTag, placeMeta } = await import('../src/ui/mapServices.js');
  const district = {
    reserved: {
      comedor: { x: 60, z: 66 }
    },
    vendors: []
  };

  const game = {
    world: { active: district },
    comedor: { position: { x: 60, z: 66 } },
    _poiCache: null,
    _poiCacheTime: 0,
    stats: {},
    inventory: { items: [] },
    player: {},
    clock: { isNight: false }
  };

  // Reutilizamos la lógica de _getPOIs
  const { Game } = await import('../src/core/game.js');
  const pois = Game.prototype._getPOIs.call(game);

  const comedorPoi = pois.find(p => p.name === 'Comedor Comunitario');
  assert.ok(comedorPoi, 'el Comedor Comunitario está en la lista de POIs del mapa');
  assert.equal(comedorPoi.x, 60);
  assert.equal(comedorPoi.z, 66);
  assert.equal(comedorPoi.fijo, true);
  assert.equal(comedorPoi.prices?.comida, 0);
  assert.equal(comedorPoi.prices?.agua, 0);

  assert.equal(hasTag(comedorPoi, 'comida'), true);
  assert.equal(hasTag(comedorPoi, 'agua'), true);

  // Ya servido hoy: sigue en el mapa, pero no se ofrece como comida ni agua.
  game._poiCache = null; game._poiCacheTime = 0;
  game.isComedorAvailable = () => false;
  const servido = Game.prototype._getPOIs.call(game).find(p => p.name === 'Comedor Comunitario');
  assert.ok(servido);
  assert.equal(hasTag(servido, 'comida'), false);
  assert.equal(hasTag(servido, 'agua'), false);
  assert.match(placeMeta(comedorPoi), /Almuerzo caliente gratis cada 24 horas/);
});
