// src/ui/PanelDock.js
// Accesos visibles al inventario y a la mesa de crafteo, bajo Pausa y sonido.
// Cada botón hace lo mismo que su tecla y respeta la misma pausa. Usa los iconos
// lucide del resto del HUD; los objetos conservan su arte de game-icons.
import { icon } from './icons.js';

const ENTRIES = [
  { id: 'inventory-open', glyph: 'backpack', label: 'Inventario', key: 'I', title: 'Abrir inventario (I o Tab)' },
  { id: 'craft-open', glyph: 'hammer', label: 'Fabricar', key: 'C', title: 'Abrir mesa de crafteo (C)' }
];

/** Igual que la tecla C: cierra la mesa si está abierta y solo la abre si nada pausa el juego. */
export function toggleCraft(game) {
  const hud = game?.hud;
  if (!hud) return false;
  if (!hud._craftOpen && game.paused) return false;
  hud.toggleCraftPanel();
  return true;
}

export function createPanelDock(game) {
  const nav = document.createElement('nav');
  nav.id = 'panel-dock';
  nav.setAttribute('aria-label', 'Paneles');
  nav.innerHTML = ENTRIES.map((e) => `
    <button type="button" id="${e.id}" class="dock-btn" title="${e.title}" aria-label="${e.title}">
      <span class="dock-art"></span><span class="dock-label">${e.label}</span><kbd class="dock-key">${e.key}</kbd>
    </button>`).join('');
  ENTRIES.forEach((e) => nav.querySelector(`#${e.id} .dock-art`).append(icon(e.glyph, { size: 18 })));
  const onClick = (ev) => {
    const btn = ev.target.closest('.dock-btn');
    if (!btn) return;
    btn.blur(); // el panel que se abre toma el foco
    if (btn.id === 'inventory-open') game.inventoryUI?.toggle();
    else toggleCraft(game);
  };
  nav.addEventListener('click', onClick);
  document.body.appendChild(nav);
  return {
    el: nav,
    dispose() { nav.removeEventListener('click', onClick); nav.remove(); }
  };
}
