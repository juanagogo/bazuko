import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { openPauseMenu } from '../src/ui/PauseMenu.js';

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
        addEventListener() {},
        setAttribute(k, v) { this.attributes[k] = v; },
        append(...nodes) { this.children.push(...nodes); }
      };
    }
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
  assert.equal(openedConfig.title, 'Partida en Pausa');

  const rendered = openedConfig.render();
  assert.ok(rendered.body);
  assert.ok(rendered.foot);
  assert.equal(rendered.foot.length, 1);
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
