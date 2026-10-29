import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toggleCraft } from '../src/ui/PanelDock.js';

function game({ paused = false, craftOpen = false } = {}) {
  const g = { paused, toggles: 0, hud: { _craftOpen: craftOpen } };
  g.hud.toggleCraftPanel = () => { g.toggles++; g.hud._craftOpen = !g.hud._craftOpen; };
  return g;
}

test('el acceso a la mesa abre y cierra como la tecla C', () => {
  const g = game();
  assert.equal(toggleCraft(g), true);
  assert.equal(g.hud._craftOpen, true);
  g.paused = true; // la mesa abierta pausa el juego, pero el botón debe poder cerrarla
  assert.equal(toggleCraft(g), true);
  assert.equal(g.hud._craftOpen, false);
});

test('el acceso a la mesa no actúa con la pausa, el inventario u otro panel abiertos', () => {
  const g = game({ paused: true });
  assert.equal(toggleCraft(g), false);
  assert.equal(g.toggles, 0);
  assert.equal(toggleCraft({ paused: false }), false, 'sin HUD no hace nada');
});
