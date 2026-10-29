// src/ui/PauseMenu.js
// Menú de pausa por pestañas: Mapa (GPS), Estado, Ajustes y Controles.
import { el, button } from './dom.js';
import { cop } from '../utils/money.js';
import { XP_PER_LEVEL } from '../utils/constants.js';
import { MapView } from './MapView.js';
import { formatDistance, RADAR_ZOOM_MIN, RADAR_ZOOM_MAX, RADAR_SIZES } from './Minimap.js';
import { NEED_META, needLevel } from './needsMeta.js';
import { describeWeather } from '../world/Climate.js';
import { DOG_ACCESSORIES, DOG_COATS } from '../entities/Dog.js';

export const PAUSE_TABS = [
  { id: 'mapa', label: 'Mapa', icon: '🗺️' },
  { id: 'estado', label: 'Estado', icon: '📊' },
  { id: 'ajustes', label: 'Ajustes', icon: '⚙️' },
  { id: 'controles', label: 'Controles', icon: '⌨️' },
];

const CONTROL_GROUPS = [
  ['Movimiento', [['WASD', 'Caminar'], ['Shift', 'Correr'], ['Espacio', 'Saltar'], ['Ratón', 'Clic fija la cámara ∙ rueda acerca'], ['V', 'Vista tercera persona / isométrica']]],
  ['Acciones', [['E', 'Interactuar: basura, tiendas, cambuche, carros'], ['Q', 'Mantener para clasificar basura ∙ dealer'], ['B / L', 'Pedir limosna'], ['F', 'Boost de adrenalina'], ['G / Clic', 'Golpear'], ['X', 'Lanzar / recoger'], ['Z', 'Defecar']]],
  ['Paneles', [['I / Tab', 'Inventario ∙ 1-5 acceso rápido'], ['T', 'Talentos'], ['C', 'Fabricar'], ['P', 'Editar personaje'], ['R', 'Radio transistor'], ['K', 'Modelo realista / liviano'], ['F3', 'Panel de rendimiento'], ['Esc', 'Pausa ∙ cerrar panel']]],
  ['Mapa y GPS', [['M', 'Abrir / cerrar el mapa'], ['N', 'Mostrar / ocultar radar'], ['+ / −', 'Zoom del radar'], ['Clic', 'Marcar destino en el mapa'], ['Clic der. / Supr', 'Quitar destino'], ['Q / E', 'Cambiar de pestaña en la pausa']]],
];

export function openPauseMenu(game, tab = 'estado') {
  if (!game || game._loading || game._deathPending || game.creator?.isOpen || game.isSleeping || game.player?.isStunned) return;
  if (game.menu?.isOpen || game.inventoryUI?.isOpen || game.hud?._talentOpen || game.hud?._craftOpen || game.hud?._dealerOpen) return;
  game.cameraRig?.releaseControls?.();
  if (game.input) { game.input.keys = {}; game.input.endFrame(); }
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch { /* sin pointer lock */ }
  }

  game._pauseTab = PAUSE_TABS.some(t => t.id === tab) ? tab : 'estado';
  const select = (id) => {
    if (id === game._pauseTab) return;
    game._pauseTab = id;
    game.menu.refresh?.();
  };
  const cycle = (dir) => {
    const i = PAUSE_TABS.findIndex(t => t.id === game._pauseTab);
    select(PAUSE_TABS[(i + dir + PAUSE_TABS.length) % PAUSE_TABS.length].id);
  };

  const onKey = (e) => {
    // Si otro menú (p. ej. la radio) reemplazó a la pausa, el listener se retira.
    if (game.menu?._render && game.menu._render !== render) { window.removeEventListener('keydown', onKey); return; }
    if (e._pauseOpened || e.repeat || !game.menu?.isOpen) return;
    if (e.target?.closest?.('input[type="text"], textarea, [contenteditable="true"]')) return;
    if (e.code === 'KeyQ' || e.code === 'BracketLeft') cycle(-1);
    else if (e.code === 'KeyE' || e.code === 'BracketRight') cycle(1);
    else if (e.code === 'KeyM') { if (game._pauseTab === 'mapa') game.menu.close(); else select('mapa'); }
    else return;
    e.preventDefault?.();
  };
  window.addEventListener('keydown', onKey);

  const render = () => {
    const current = game._pauseTab;
    const tabs = el('nav', { class: 'pause-tabs', role: 'tablist', 'aria-label': 'Secciones de la pausa' },
      el('kbd', { class: 'pause-tabs__key', text: 'Q' }),
      PAUSE_TABS.map(t => el('button', {
        type: 'button', role: 'tab', class: `pause-tab${t.id === current ? ' is-active' : ''}`,
        'aria-selected': t.id === current ? 'true' : 'false',
        onclick: () => select(t.id),
      }, el('span', { class: 'pause-tab__icon', text: t.icon }), t.label)),
      el('kbd', { class: 'pause-tabs__key', text: 'E' }));

    const panels = { mapa: mapPanel, estado: statePanel, ajustes: settingsPanel, controles: controlsPanel };
    const body = el('div', { class: `pause-menu-body pause-menu-body--${current}` }, tabs,
      el('section', { class: 'pause-panel', role: 'tabpanel' }, panels[current](game)));

    const foot = [
      button('Continuar jugando', {
        primary: true,
        onClick: () => game.menu.close()
      })
    ];

    return { body, foot };
  };

  game.menu.open({
    title: 'Partida en Pausa',
    sub: 'Vagabundo / Habitante de Calle ∙ Bogotá',
    ic: 'pause',
    wide: true,
    render,
    onClose: () => window.removeEventListener('keydown', onKey),
  });
}

function mapPanel(game) {
  game.mapView ??= new MapView(game);
  game.mapView.mount({ recenter: !game.mapView._mounted });
  game.mapView._mounted = true;
  return game.mapView.root;
}

/** Apariencia de El Chato; solo cuando ya es compañero. Cada cambio se guarda con la partida. */
function dogSection(game) {
  const dog = game.dog;
  if (!dog?.isFriend) return null;
  const change = (look) => { dog.setLook(look); game._save?.(); game.menu.refresh(); };
  const row = (label, ...controls) => el('div', { class: 'pause-row' }, el('label', { class: 'pause-row__label', text: label }), ...controls);
  const size = Math.round(dog.look.tamano * 100);
  const sizeLabel = el('span', { class: 'pause-value', text: `${size}%` });
  const sizeInput = el('input', {
    type: 'range', min: '80', max: '125', step: '5', value: String(size), class: 'pause-slider', 'aria-label': 'Tamaño de El Chato',
    oninput: (e) => { dog.setLook({ tamano: Number(e.target.value) / 100 }); sizeLabel.textContent = `${e.target.value}%`; },
    onchange: () => game._save?.()
  });
  return el('div', { class: 'pause-section pause-section--compact' },
    el('h3', { class: 'pause-section-title', text: '🐕 El Chato' }),
    row('Pelaje', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Pelaje de El Chato' },
      Object.entries(DOG_COATS).map(([id, { label, color }]) => button(
        [el('span', { class: 'pause-dog-swatch', style: `--c:${color}`, 'aria-hidden': 'true' }), label],
        { primary: dog.look.pelaje === id, class: 'pause-choice', onClick: () => change({ pelaje: id }) })))),
    row('Accesorio', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Accesorio de El Chato' },
      Object.entries(DOG_ACCESSORIES).map(([id, label]) => button(label,
        { primary: dog.look.accesorio === id, class: 'pause-choice', onClick: () => change({ accesorio: id }) })))),
    row('Tamaño', sizeInput, sizeLabel));
}

function statePanel(game) {
  const { stats = {}, clock = {} } = game;
  const hour = clock.hour ?? 0;
  const h = Math.floor(hour).toString().padStart(2, '0');
  const m = Math.floor((hour % 1) * 60).toString().padStart(2, '0');
  const level = stats.level ?? 1;
  const xpNeeded = XP_PER_LEVEL * level;
  const xpPct = Math.max(0, Math.min(100, (stats.xp ?? 0) / xpNeeded * 100));
  const wp = game.gps?.waypoint;
  const pos = game.player?.position;

  const sky = game.weather?.type && describeWeather(game.weather.type, clock.isNight ?? (hour < 6 || hour >= 20));
  const card = (label, value) => el('div', { class: 'pause-card' },
    el('span', { class: 'pause-card__label', text: label }), el('strong', { class: 'pause-card__value', text: value }));

  return el('div', { class: 'pause-state' },
    el('div', { class: 'pause-cards' },
      card('Personaje', game.look?.nombre ?? 'Parcero'),
      card('Dinero', cop(stats.dinero ?? 0)),
      card('Tiempo', `Día ${clock.day ?? 1} ∙ ${h}:${m}`),
      ...(sky ? [card('Clima', `${sky.icon} ${sky.label}`),
        card('Temporada', `${game.weather.season.icon} ${game.weather.season.label} (${game.weather.season.months})`)] : []),
      card('El Chato', game.dog?.isFriend ? '🐕 Te acompaña' : 'Sin adoptar'),
    ),
    dogSection(game),
    el('div', { class: 'pause-level' },
      el('span', { class: 'pause-level__badge', text: `Nv ${level}` }),
      el('div', { class: 'pause-meter' }, el('div', { class: 'pause-meter__fill', style: `width:${xpPct}%;--c:#19c463` })),
      el('span', { class: 'pause-level__xp', text: `${stats.xp ?? 0} / ${xpNeeded} XP` })),
    el('h3', { class: 'pause-section-title', text: 'Necesidades' }),
    el('ul', { class: 'pause-needs' }, NEED_META.map(({ id, icon, label, color }) => {
      const value = Math.round(stats[id] ?? 0);
      return el('li', { class: `pause-need is-${needLevel(value)}` },
        el('span', { class: 'pause-need__label', text: `${icon} ${label}` }),
        el('div', { class: 'pause-meter' }, el('div', { class: 'pause-meter__fill', style: `width:${value}%;--c:${color}` })),
        el('span', { class: 'pause-need__value', text: `${value}%` }));
    })),
    el('div', { class: 'pause-row pause-row--split' },
      el('span', { class: 'pause-gps-summary', text: wp
        ? `📍 Destino: ${wp.icon} ${wp.name}${pos && game.gps.route.length ? ` ∙ ${formatDistance(game.gps.remainingDistance(pos))}` : ''}`
        : '📍 Sin destino marcado ∙ abre el mapa con M' }),
      button('💾 Guardar partida', {
        onClick: () => {
          game._save?.();
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: '💾 ¡Partida guardada con éxito!', type: 'info' }
          }));
        }
      })));
}

function settingsPanel(game) {
  const audio = game.audio;
  const row = (label, ...controls) => el('div', { class: 'pause-row' }, el('label', { class: 'pause-row__label', text: label }), ...controls);
  const section = (title, ...rows) => el('div', { class: 'pause-section' }, el('h3', { class: 'pause-section-title', text: title }), ...rows);
  const volPct = Math.round((audio?.volume ?? 0.7) * 100);
  const volumeLabel = el('span', { class: 'pause-value', text: `${volPct}%` });
  const volumeInput = el('input', {
    type: 'range', min: '0', max: '100', value: String(volPct), class: 'pause-slider', 'aria-label': 'Volumen maestro',
    oninput: (e) => {
      const val = parseInt(e.target.value, 10) / 100;
      audio?.setVolume(val);
      volumeLabel.textContent = `${Math.round(val * 100)}%`;
    }
  });
  const mixRows = [['ambient', 'Ambiente'], ['traffic', 'Tráfico'], ['voices', 'Voces'], ['effects', 'Efectos']]
    .filter(() => typeof audio?.getMix === 'function').map(([category, label]) => {
      const pct = Math.round(audio.getMix(category) * 100);
      const value = el('span', { class: 'pause-value', text: `${pct}%` });
      const input = el('input', {
        type: 'range', min: '0', max: '100', value: String(pct), class: 'pause-slider', 'aria-label': `Volumen de ${label.toLowerCase()}`,
        oninput: (e) => { value.textContent = `${Math.round(audio.setMix(category, Number(e.target.value) / 100) * 100)}%`; }
      });
      return row(label, input, value);
    });
  const muteBtn = button(audio?.isMuted() ? '🔇 Activar sonido' : '🔊 Silenciar', {
    onClick: () => {
      const next = audio?.toggleMute();
      muteBtn.textContent = next ? '🔇 Activar sonido' : '🔊 Silenciar';
    }
  });

  const curQuality = game.renderer?.quality || 'alta';
  const quality = (id, label) => button(label, {
    primary: curQuality === id, class: 'pause-choice',
    onClick: () => { game.setGraphicsQuality?.(id); game.menu?.refresh(); }
  });

  const minimap = game.minimap;
  const zoom = minimap?.zoomBase ?? 70;
  const zoomLabel = el('span', { class: 'pause-value', text: `${zoom} m` });
  const zoomInput = el('input', {
    type: 'range', min: String(RADAR_ZOOM_MIN), max: String(RADAR_ZOOM_MAX), step: '5', value: String(zoom),
    class: 'pause-slider', 'aria-label': 'Alcance del radar',
    oninput: (e) => { zoomLabel.textContent = `${minimap?.setZoomBase(Number(e.target.value)) ?? e.target.value} m`; }
  });


  return el('div', { class: 'pause-settings' },
    el('div', { class: 'pause-section pause-section--compact' }, el('h3', { class: 'pause-section-title', text: '🔊 Sonido' }),
      row('Volumen', volumeInput, volumeLabel), ...mixRows, row('Silencio', muteBtn)),
    section('⚡ Calidad gráfica',
      el('div', { class: 'pause-segmented' }, quality('baja', '⚡ Baja'), quality('media', '⚖️ Media'), quality('alta', '✨ Alta')),
      el('p', { class: 'pause-hint', text: 'Baja da más FPS. Bajo carga la calidad puede bajar sola sin cambiar tu elección.' }),
      row('Rendimiento', button(game.performanceHUD?.visible ? 'Visible (F3)' : 'Oculto (F3)', {
        primary: !!game.performanceHUD?.visible, class: 'pause-choice',
        onClick: () => { game.performanceHUD?.toggle(); game.menu.refresh(); }
      }))),
    section('🧭 Radar y GPS',
      row('Radar', button(minimap?.visible ? 'Visible (N)' : 'Oculto (N)', {
        primary: !!minimap?.visible, class: 'pause-choice',
        onClick: () => { minimap?.toggle(); game.menu.refresh(); }
      })),
      row('Tamaño', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Tamaño del radar' },
        RADAR_SIZES.map(({ id, label }) => button(label, {
          primary: minimap?.size === id, class: 'pause-choice',
          onClick: () => { minimap?.setSize(id); game.menu.refresh(); }
        })))),
      row('Alcance base', zoomInput, zoomLabel),
      row('Haz del destino', button(game.showGpsBeacon !== false ? 'Visible' : 'Oculto', {
        primary: game.showGpsBeacon !== false, class: 'pause-choice',
        onClick: () => { game.setGpsBeaconVisible?.(game.showGpsBeacon === false); game.menu.refresh(); }
      }))),
    section('🧍 Personaje y radio',
      el('div', { class: 'pause-actions' },
        button(game.player?.modelKind === 'realista' ? '🧸 Usar modelo liviano (K)' : '🧍 Usar modelo realista (K)', {
          onClick: () => { game._toggleModel?.(); game.menu.refresh(); }
        }),
        button(game.radio?.isOn ? '📻 Sintonizar radio (R)' : '📻 Radio transistor (R)', {
          onClick: () => window.dispatchEvent(new CustomEvent('open-radio-modal'))
        }))));
}

function controlsPanel() {
  return el('div', { class: 'pause-controls' }, CONTROL_GROUPS.map(([title, items]) =>
    el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: title }),
      el('ul', { class: 'pause-controls-list' }, items.map(([key, text]) =>
        el('li', {}, el('kbd', { text: key }), el('span', { text })))))));
}
