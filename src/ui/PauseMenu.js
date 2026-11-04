// src/ui/PauseMenu.js
// Menú de pausa por pestañas: Mapa (GPS), Estado, Ajustes y Controles.
import { el, button } from './dom.js';
import { modoEntrada } from '../core/modoEntrada.js';
import { CONTROLES_CON_EL_DEDO } from '../core/TouchControls.js';
import { cop } from '../utils/money.js';
import { XP_PER_LEVEL } from '../utils/constants.js';
import { MapView } from './MapView.js';
import { hora, porcentaje } from './formato.js';
import { CONTROLES_CON_MANDO } from '../core/Gamepad.js';
import { formatDistance, RADAR_ZOOM_MIN, RADAR_ZOOM_MAX, RADAR_SIZES } from './Minimap.js';
import { NEED_META, needLevel } from './needsMeta.js';
import { describeWeather } from '../world/Climate.js';
import { icon } from './icons.js';
import { pasarTexto } from './pictos.js';
import { DOG_ACCESSORIES, DOG_COATS } from '../entities/Dog.js';

export const PAUSE_TABS = [
  { id: 'mapa', label: 'Mapa' },
  { id: 'estado', label: 'Estado' },
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'controles', label: 'Controles' },
];

const CONTROL_GROUPS = [
  ['Movimiento', [['WASD', 'Caminar'], ['Shift', 'Correr'], ['Espacio', 'Brincar'], ['Mouse', 'Clic fija la cámara, la rueda acerca'], ['V', 'Vista tercera persona / isométrica']]],
  ['Acciones', [['E', 'Hacer lo que dice: basura, tiendas, cambuche, carros'], ['Q', 'Mantener para seleccionar basura. También abre al jíbaro'], ['E / Q', 'Junto a una persona: cosquilleo o robo directo'], ['B / L', 'Pedir limosna'], ['F', 'Envión'], ['G / Clic', 'Pegar'], ['X', 'Lanzar / recoger'], ['Z', 'Popó']]],
  ['Paneles', [['I / Tab', 'El costal. 1 a 5: acceso rápido'], ['H', 'Estado y necesidades'], ['T', 'Mañas'], ['C', 'Fabricar'], ['P', 'Editar personaje'], ['R', 'Radio'], ['K', 'Personaje realista / liviano'], ['F2', 'Foto'], ['F3', 'Panel de rendimiento'], ['Esc', 'Pausa o cerrar panel']]],
  ['Mapa y GPS', [['M', 'Abrir / cerrar el mapa'], ['M, Enter', 'Ruta a lo que más necesito'], ['N', 'Mostrar / ocultar radar'], ['+ / −', 'Acercar o alejar el radar'], ['Clic', 'Marcar destino en el mapa'], ['Clic der. / Supr', 'Quitar destino'], ['Q / E', 'Cambiar de pestaña en la pausa']]],
];

const horaDe = hora;

const cieloDe = (game) => {
  const { clock = {} } = game;
  const hour = clock.hour ?? 0;
  return game.weather?.type && describeWeather(game.weather.type, clock.isNight ?? (hour < 6 || hour >= 20));
};

/** La línea de arriba: hora, día y clima con palabra, como en el juego. */
function lineaDelMomento(game) {
  const { clock = {} } = game;
  const sky = cieloDe(game);
  return `${horaDe(clock.hour ?? 0)}, Día ${clock.day ?? 1}${sky ? `, ${sky.label}` : ''}`;
}

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
    // `refresh` conserva el desplazamiento para comprar y vender; otra pestaña empieza desde arriba.
    if (game.menu.bodyEl) game.menu.bodyEl.scrollTop = 0;
  };
  const cycle = (dir) => {
    const i = PAUSE_TABS.findIndex(t => t.id === game._pauseTab);
    select(PAUSE_TABS[(i + dir + PAUSE_TABS.length) % PAUSE_TABS.length].id);
  };

  const onKey = (e) => {
    if (e._pauseOpened || e.repeat || !game.menu?.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target?.closest?.('input[type="text"], textarea, [contenteditable="true"]')) return;
    // Por `key`: en teclados español y latinoamericano, la tecla física de «]» escribe «+».
    if (e.code === 'KeyQ' || e.key === '[') cycle(-1);
    else if (e.code === 'KeyE' || e.key === ']') cycle(1);
    else if (e.code === 'KeyM') { if (game._pauseTab === 'mapa') game.menu.close(); else select('mapa'); }
    else return;
    e.preventDefault?.();
  };
  window.addEventListener('keydown', onKey);

  const render = () => {
    const current = game._pauseTab;
    const tabs = el('nav', { class: 'pause-tabs', role: 'tablist', 'aria-label': 'Secciones de la pausa' },
      el('kbd', { class: 'pause-tabs__key', text: 'Q', 'aria-hidden': 'true' }),
      PAUSE_TABS.map(t => el('button', {
        type: 'button', role: 'tab', class: `pause-tab${t.id === current ? ' is-active' : ''}`,
        'aria-selected': t.id === current ? 'true' : 'false',
        onclick: () => select(t.id),
      }, el('span', { class: `pause-tab__palabra${t.id === current ? ' elegido' : ''}`, text: t.label }))),
      el('kbd', { class: 'pause-tabs__key', text: 'E', 'aria-hidden': 'true' }));

    const panels = { mapa: mapPanel, estado: statePanel, ajustes: settingsPanel, controles: controlsPanel };
    const body = el('div', { class: `pause-menu-body pause-menu-body--${current}` },
      el('section', { class: 'pause-panel', role: 'tabpanel', 'aria-label': PAUSE_TABS.find(t => t.id === current).label }, panels[current](game)));

    const foot = [
      button(['Continuar jugando', el('kbd', { text: 'Esc', 'aria-hidden': 'true' })], {
        primary: true,
        onClick: () => game.menu.close()
      })
    ];

    return { body, foot, tabs };
  };

  game.menu.open({
    title: 'Un momentico',
    sub: lineaDelMomento(game),
    ic: 'pause',
    wide: true,
    render,
    // Si otra ventana (la radio) reemplaza a la pausa, tampoco se queda escuchando.
    onLeave: () => window.removeEventListener('keydown', onKey),
  });
}

function mapPanel(game) {
  game.mapView ??= new MapView(game);
  game.mapView.mount({ recenter: !game.mapView._mounted });
  game.mapView._mounted = true;
  return game.mapView.root;
}

/** Elegir es círculo: la opción elegida no se pinta, se encierra. */
function choice(label, on, onClick) {
  const b = button(el('span', { class: on ? 'elegido' : null, text: label }), { class: 'pause-choice', onClick });
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  return b;
}

const sectionTitle = (glyph, title) => el('h3', { class: 'pause-section-title' }, icon(glyph, { size: 22 }), title);

/** Apariencia de El Chato; solo cuando ya es compañero. Cada cambio se guarda con la partida. */
function dogSection(game) {
  const dog = game.dog;
  if (!dog?.isFriend) return null;
  const change = (look) => { dog.setLook(look); game._save?.(); game.menu.refresh(); };
  const row = (label, ...controls) => el('div', { class: 'pause-row' }, el('label', { class: 'pause-row__label', text: label }), ...controls);
  const size = Math.round(dog.look.tamano * 100);
  const sizeLabel = el('span', { class: 'pause-value', text: porcentaje(size) });
  const sizeInput = el('input', {
    type: 'range', min: '80', max: '125', step: '5', value: String(size), class: 'pause-slider', 'aria-label': 'Tamaño de El Chato',
    oninput: (e) => { dog.setLook({ tamano: Number(e.target.value) / 100 }); sizeLabel.textContent = porcentaje(e.target.value); },
    onchange: () => game._save?.()
  });
  return el('div', { class: 'pause-section pause-section--chato' },
    sectionTitle('dog', 'El Chato'),
    row('Pelaje', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Pelaje de El Chato' },
      Object.entries(DOG_COATS).map(([id, { label, color }]) => {
        const b = choice(label, dog.look.pelaje === id, () => change({ pelaje: id }));
        b.prepend?.(el('span', { class: 'pause-dog-swatch', style: `--c:${color}`, 'aria-hidden': 'true' }));
        return b;
      }))),
    row('Accesorio', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Accesorio de El Chato' },
      Object.entries(DOG_ACCESSORIES).map(([id, label]) => choice(label, dog.look.accesorio === id, () => change({ accesorio: id }))))),
    row('Tamaño', sizeInput, sizeLabel));
}

function statePanel(game) {
  const { stats = {}, clock = {} } = game;
  const level = stats.level ?? 1;
  const xpNeeded = XP_PER_LEVEL * level;
  const xpPct = Math.max(0, Math.min(100, (stats.xp ?? 0) / xpNeeded * 100));
  const wp = game.gps?.waypoint;
  const pos = game.player?.position;

  const sky = cieloDe(game);
  const card = (label, value, glyph) => el('div', { class: 'pause-card' },
    el('span', { class: 'pause-card__label', text: label }),
    el('strong', { class: 'pause-card__value' }, glyph ? icon(glyph, { size: 20 }) : null, el('span', { text: value })));
  const puntos = game.talents?.points ?? 0;

  return el('div', { class: 'pause-state' },
    el('div', { class: 'pause-state__yo' },
      el('h3', { class: 'pause-nombre', text: game.look?.nombre ?? 'Parcero' }),
      el('div', { class: 'pause-level' },
        el('span', { class: 'pause-level__badge', text: `nivel ${level}` }),
        el('div', { class: 'pause-meter' }, el('div', { class: 'pause-meter__fill masa', style: `width:${xpPct}%` })),
        el('span', { class: 'pause-level__xp', text: `${stats.xp ?? 0} de ${xpNeeded}` })),
      el('div', { class: 'pause-cards' },
        card('Plata', cop(stats.dinero ?? 0)),
        card('Tiempo', `Día ${clock.day ?? 1}, ${horaDe(clock.hour ?? 0)}`),
        ...(sky ? [card('Clima', sky.label, sky.glyph),
          card('Temporada', `${game.weather.season.label} (${game.weather.season.months})`, game.weather.season.glyph)] : []),
        card('El Chato', game.dog?.isFriend ? 'Me acompaña' : 'Sin adoptar', game.dog?.isFriend ? 'dog' : null)),
      el('div', { class: 'pause-actions' },
        button([`Mañas${puntos ? ` (${puntos})` : ''}`, el('kbd', { text: 'T', 'aria-hidden': 'true' })], {
          onClick: () => { game.menu.close(); game.hud?.toggleTalentPanel?.(); }
        }),
        button('Guardar partida', {
          onClick: () => {
            game._save?.();
            window.dispatchEvent(new CustomEvent('toast', {
              detail: { text: 'Partida guardada', type: 'info' }
            }));
          }
        })),
      el('p', { class: 'pause-gps-summary' }, icon('pin', { size: 18 }), el('span', { text: wp
        ? `Destino: ${pasarTexto(wp.name)}${pos && game.gps.route.length ? `, ${formatDistance(game.gps.remainingDistance(pos))}` : ''}`
        : 'Sin destino marcado. El mapa se abre con M.' }))),
    el('div', { class: 'pause-state__cuerpo' },
      el('h3', { class: 'pause-section-title', text: 'Cómo estoy' }),
      el('ul', { class: 'pause-needs' }, NEED_META.map(({ id, glyph, label }) => {
        const value = Math.round(stats[id] ?? 0);
        return el('li', { class: `pause-need is-${needLevel(value)}` },
          el('span', { class: 'pause-need__label' }, icon(glyph, { size: 20 }), el('span', { text: label })),
          el('div', { class: 'pause-meter' }, el('div', { class: 'pause-meter__fill masa', style: `width:${value}%` })),
          el('span', { class: 'pause-need__value cifra', text: `${value}` }));
      })),
      dogSection(game)));
}

function settingsPanel(game) {
  const audio = game.audio;
  const row = (label, ...controls) => el('div', { class: 'pause-row' }, el('label', { class: 'pause-row__label', text: label }), ...controls);
  const section = (glyph, title, ...rows) => el('div', { class: 'pause-section' }, sectionTitle(glyph, title), ...rows);
  const volPct = Math.round((audio?.volume ?? 0.7) * 100);
  const volumeLabel = el('span', { class: 'pause-value', text: porcentaje(volPct) });
  const volumeInput = el('input', {
    type: 'range', min: '0', max: '100', value: String(volPct), class: 'pause-slider', 'aria-label': 'Volumen general',
    oninput: (e) => {
      const val = parseInt(e.target.value, 10) / 100;
      audio?.setVolume(val);
      volumeLabel.textContent = porcentaje(val * 100);
    }
  });
  const mixRows = [['ambient', 'Ambiente'], ['traffic', 'Tráfico'], ['voices', 'Voces'], ['effects', 'Efectos']]
    .filter(() => typeof audio?.getMix === 'function').map(([category, label]) => {
      const pct = Math.round(audio.getMix(category) * 100);
      const value = el('span', { class: 'pause-value', text: porcentaje(pct) });
      const input = el('input', {
        type: 'range', min: '0', max: '100', value: String(pct), class: 'pause-slider', 'aria-label': `Volumen de ${label.toLowerCase()}`,
        oninput: (e) => { value.textContent = porcentaje(audio.setMix(category, Number(e.target.value) / 100) * 100); }
      });
      return row(label, input, value);
    });
  const muteLabel = (muted) => [icon(muted ? 'mute' : 'sound', { size: 18 }), muted ? 'Activar sonido' : 'Silenciar'];
  const muteBtn = button(muteLabel(audio?.isMuted()), {
    onClick: () => muteBtn.replaceChildren(...muteLabel(audio?.toggleMute()))
  });

  // Lo elegido, que puede tardar en aplicarse mientras compilan las sombras.
  const curQuality = game.chosenQuality || game.renderer?.quality || 'alta';
  const quality = (id, label) => choice(label, curQuality === id, () => { game.setGraphicsQuality?.(id); game.menu?.refresh(); });

  // Si lo elegido ya está aplicado y aun así el juego corre en otra calidad, fue la calidad automática.
  const running = game.renderer?.effectiveQuality;
  const qualityOrder = ['baja', 'media', 'alta'];
  const qualityNow = running && game.renderer.quality === curQuality && running !== curQuality
    ? ` Ahora corre en ${running}: ${qualityOrder.indexOf(running) > qualityOrder.indexOf(curQuality) ? 'subió' : 'bajó'} sola.` : '';

  const minimap = game.minimap;
  const zoom = minimap?.zoomBase ?? 70;
  const zoomLabel = el('span', { class: 'pause-value', text: `${zoom} m` });
  const zoomInput = el('input', {
    type: 'range', min: String(RADAR_ZOOM_MIN), max: String(RADAR_ZOOM_MAX), step: '5', value: String(zoom),
    class: 'pause-slider', 'aria-label': 'Alcance del radar',
    oninput: (e) => { zoomLabel.textContent = `${minimap?.setZoomBase(Number(e.target.value)) ?? e.target.value} m`; }
  });

  return el('div', { class: 'pause-settings' },
    section('sound', 'Sonido', row('Volumen', volumeInput, volumeLabel), ...mixRows, row('Silencio', muteBtn)),
    el('div', { class: 'pause-settings__col' },
      section('zap', 'Calidad gráfica',
        el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Calidad gráfica' }, quality('baja', 'Baja'), quality('media', 'Media'), quality('alta', 'Alta')),
        el('p', { class: 'pause-hint', text: `Baja va más fluido. Si el equipo no da, baja sola sin cambiar lo elegido.${qualityNow}` }),
        row('Rendimiento', choice(game.performanceHUD?.visible ? 'Visible (F3)' : 'Oculto (F3)', !!game.performanceHUD?.visible,
          () => { game.performanceHUD?.toggle(); game.menu.refresh(); }))),
      section('user', 'Personaje y radio',
        el('div', { class: 'pause-actions' },
          button([icon('body', { size: 18 }), game.player?.modelKind === 'realista' ? 'Usar personaje liviano (K)' : 'Usar personaje realista (K)'], {
            onClick: () => { game._toggleModel?.(); game.menu.refresh(); }
          }),
          button([icon('radio', { size: 18 }), game.radio?.isOn ? 'Sintonizar radio (R)' : 'Radio (R)'], {
            onClick: () => window.dispatchEvent(new CustomEvent('open-radio-modal'))
          })))),
    section('arrow', 'Radar y GPS',
      row('Radar', choice(minimap?.visible ? 'Visible (N)' : 'Oculto (N)', !!minimap?.visible,
        () => { minimap?.toggle(); game.menu.refresh(); })),
      row('Tamaño', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Tamaño del radar' },
        RADAR_SIZES.map(({ id, label }) => choice(label, minimap?.size === id, () => { minimap?.setSize(id); game.menu.refresh(); })))),
      row('Alcance base', zoomInput, zoomLabel),
      row('Luz del destino', choice(game.showGpsBeacon !== false ? 'Visible' : 'Oculto', game.showGpsBeacon !== false,
        () => { game.setGpsBeaconVisible?.(game.showGpsBeacon === false); game.menu.refresh(); }))));
}

function controlsPanel() {
  // Con el dedo no hay teclas: en la celda va el nombre del botón.
  const dedo = modoEntrada() === 'tactil', mando = modoEntrada() === 'mando';
  return el('div', { class: 'pause-controls' }, (dedo ? CONTROLES_CON_EL_DEDO : mando ? CONTROLES_CON_MANDO : CONTROL_GROUPS).map(([title, items]) =>
    el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: title }),
      el('ul', { class: 'pause-controls-list' }, items.map(([key, text]) =>
        el('li', {}, el(dedo || mando ? 'b' : 'kbd', { text: key }), el('span', { text })))))));
}
