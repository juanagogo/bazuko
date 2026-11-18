// tests/radio-en-pausa.test.js
// La radio sigue sonando con los paneles que congelan el mundo, y calla solo con la partida detenida.
import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/game.js';

const juego = (extra = {}) => Object.assign(Object.create(Game.prototype), {
  _loading: false, _deathPending: false, _arrestPending: false, isSleeping: false,
  menu: { isOpen: false }, creator: { isOpen: false }, inventoryUI: { isOpen: false },
  hud: {}, photoMode: { active: false },
}, extra);

test('La radio sigue sonando con el costal, la mesa, las mañas y la pausa abiertos', () => {
  const costal = juego({ inventoryUI: { isOpen: true } });
  assert.equal(costal.paused, true, 'el costal congela el mundo');
  assert.equal(costal.radioSuspended, false, 'pero no apaga la radio');

  for (const panel of [{ hud: { _craftOpen: true } }, { hud: { _talentOpen: true } }, { hud: { _dealerOpen: true } }, { menu: { isOpen: true } }]) {
    assert.equal(juego(panel).paused, true);
    assert.equal(juego(panel).radioSuspended, false);
  }
});

test('La radio calla durmiendo, en modo foto, con la pestaña oculta, cargando, muerto o preso', () => {
  assert.equal(juego({ isSleeping: true }).radioSuspended, true);
  assert.equal(juego({ photoMode: { active: true } }).radioSuspended, true);
  assert.equal(juego({ _loading: true }).radioSuspended, true);
  assert.equal(juego({ _deathPending: true }).radioSuspended, true);
  assert.equal(juego({ _arrestPending: true }).radioSuspended, true);

  globalThis.document = { hidden: true };
  try { assert.equal(juego().radioSuspended, true, 'la pestaña oculta la calla'); }
  finally { delete globalThis.document; }
});
