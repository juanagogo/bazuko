// src/ui/PanelDock.js
// El costal y la mesa, junto a la barra rápida. Cada botón hace lo mismo que su tecla y respeta la misma pausa.
import { icon } from './icons.js';
import { teclaVisible } from '../core/modoEntrada.js';
import { openMissionsModal } from './MissionsModal.js';

const ENTRIES = [
  { id: 'inventory-open', glyph: 'backpack', label: 'Costal', key: 'I', title: 'Abrir el costal (I o Tab)' },
  { id: 'craft-open', glyph: 'hammer', label: 'Fabricar', key: 'C', title: 'Abrir la mesa (C)' },
  { id: 'missions-open', glyph: 'pin', label: 'Misiones', key: 'J', title: 'Misiones del día (J)' }
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
    <button type="button" id="${e.id}" class="dock-btn cinta" title="${e.title}" aria-label="${e.title}">
      <span class="dock-art"></span><span class="dock-label">${e.label}</span><kbd class="dock-key" data-k="${e.key}">${teclaVisible(e.key)}</kbd>
    </button>`).join('');
  ENTRIES.forEach((e) => nav.querySelector(`#${e.id} .dock-art`).append(icon(e.glyph, { size: 22 })));
  const onClick = (ev) => {
    const btn = ev.target.closest('.dock-btn');
    if (!btn) return;
    btn.blur(); // el panel que se abre toma el foco
    if (btn.id === 'inventory-open') game.inventoryUI?.toggle();
    else if (btn.id === 'craft-open') toggleCraft(game);
    else if (btn.id === 'missions-open') {
      if (game._missionsModalOpen) game.menu?.close();
      else if (!game.paused) openMissionsModal(game);
    }
  };
  nav.addEventListener('click', onClick);
  document.body.appendChild(nav);
  // La cámara y la ayuda se paran a la izquierda de la barra: su ancho real (cambia con las teclas
  // del mando o del teclado) va en --panel-dock-w y el de la cámara en --camera-w (hud.css).
  let mirar = null;
  const camara = document.getElementById('camera-controls');
  const ayuda = document.getElementById('controls-help-toggle');
  const contexto = document.getElementById('interaction-prompt');
  const barra = document.getElementById('quickbar');
  const controles = [nav, camara, ayuda].filter(Boolean);
  const medir = () => {
    const raiz = document.documentElement.style;
    if (nav.offsetWidth) raiz.setProperty('--panel-dock-w', `${Math.ceil(nav.getBoundingClientRect().width)}px`);
    if (camara?.offsetWidth) raiz.setProperty('--camera-w', `${Math.ceil(camara.getBoundingClientRect().width)}px`);
    raiz.setProperty('--ancho-barra-rapida', `${barra?.offsetWidth ?? 0}px`);
    const aviso = contexto?.getBoundingClientRect();
    // El texto puede tener varias líneas. Solo aparta los botones si llega hasta su columna.
    const cruza = aviso?.height && controles.some(control => {
      const r = control.getBoundingClientRect();
      return r.width && aviso.right + 6 > r.left && aviso.left - 6 < r.right;
    });
    raiz.setProperty('--alto-contexto-cruzado', `${cruza ? Math.ceil(aviso.height) : 0}px`);
  };
  if (typeof ResizeObserver !== 'undefined') {
    mirar = new ResizeObserver(medir);
    for (const el of [...controles, contexto, barra]) if (el) mirar.observe(el);
    globalThis.addEventListener?.('resize', medir);
  }
  return {
    el: nav,
    dispose() {
      mirar?.disconnect();
      globalThis.removeEventListener?.('resize', medir);
      nav.removeEventListener('click', onClick);
      nav.remove();
    }
  };
}
