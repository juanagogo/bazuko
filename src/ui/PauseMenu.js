// src/ui/PauseMenu.js
// Menú de pausa y configuración para Habitante de Calle
import { el, button } from './dom.js';
import { cop } from '../utils/money.js';

export function openPauseMenu(game) {
  if (!game || game._loading || game._deathPending || game.creator?.isOpen || game.isSleeping || game.player?.isStunned) return;
  if (game.menu?.isOpen || game.inventoryUI?.isOpen || game.hud?._talentOpen || game.hud?._craftOpen || game.hud?._dealerOpen) return;
  game.cameraRig?.releaseControls?.();
  if (game.input) { game.input.keys = {}; game.input.endFrame(); }
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch { /* sin pointer lock */ }
  }

  const audio = game.audio;
  const stats = game.stats;
  const clock = game.clock;

  const render = () => {
    // 1. Control de Audio
    const volPct = Math.round((audio?.volume ?? 0.7) * 100);
    const isMuted = audio?.isMuted() ?? false;

    const volumeInput = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: String(volPct),
      class: 'pause-slider',
      'aria-label': 'Volumen maestro'
    });

    const volumeLabel = el('span', { class: 'pause-vol-label', text: `${volPct}%` });

    volumeInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) / 100;
      audio?.setVolume(val);
      volumeLabel.textContent = `${Math.round(val * 100)}%`;
    });

    const muteBtn = button(isMuted ? '🔇 Desactivar silencio' : '🔊 Silenciar', {
      class: 'btn btn--ghost btn--small',
      onClick: () => {
        const next = audio?.toggleMute();
        muteBtn.textContent = next ? '🔇 Desactivar silencio' : '🔊 Silenciar';
      }
    });

    const audioSection = el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: '🔊 Sonido y Volumen' }),
      el('div', { class: 'pause-row' },
        el('label', { text: 'Volumen maestro:' }),
        volumeInput,
        volumeLabel,
        muteBtn
      )
    );

    // 2. Rendimiento y Calidad Gráfica (FPS)
    const curQuality = game.renderer?.quality || 'alta';
    const qualitySection = el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: '⚡ Rendimiento y Calidad (FPS)' }),
      el('div', { class: 'pause-actions' },
        button(curQuality === 'baja' ? '⚡ Baja (Máx FPS) ✔' : '⚡ Baja (Máx FPS)', {
          class: curQuality === 'baja' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small',
          onClick: () => {
            game.setGraphicsQuality?.('baja');
            game.menu?.refresh();
          }
        }),
        button(curQuality === 'media' ? '⚖️ Media ✔' : '⚖️ Media', {
          class: curQuality === 'media' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small',
          onClick: () => {
            game.setGraphicsQuality?.('media');
            game.menu?.refresh();
          }
        }),
        button(curQuality === 'alta' ? '✨ Alta (Detalle) ✔' : '✨ Alta (Detalle)', {
          class: curQuality === 'alta' ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small',
          onClick: () => {
            game.setGraphicsQuality?.('alta');
            game.menu?.refresh();
          }
        })
      )
    );

    // 3. Estado del jugador
    const h = Math.floor(clock.hour).toString().padStart(2, '0');
    const m = Math.floor((clock.hour % 1) * 60).toString().padStart(2, '0');
    const stateSection = el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: '📊 Estado Actual' }),
      el('div', { class: 'pause-grid' },
        el('div', {}, el('strong', { text: 'Personaje: ' }), el('span', { text: game.look?.nombre ?? 'Parcero' })),
        el('div', {}, el('strong', { text: 'Dinero: ' }), el('span', { text: cop(stats.dinero) })),
        el('div', {}, el('strong', { text: 'Tiempo: ' }), el('span', { text: `Día ${clock.day} — ${h}:${m}` })),
        el('div', {}, el('strong', { text: 'Nivel: ' }), el('span', { text: `Nv ${stats.level}` })),
        el('div', {}, el('strong', { text: 'Salud: ' }), el('span', { text: `${Math.round(stats.salud)}%` })),
        el('div', {}, el('strong', { text: 'Sed / Hambre: ' }), el('span', { text: `${Math.round(stats.sed)}% / ${Math.round(stats.hambre)}%` }))
      )
    );

    // 3. Acciones rápidas
    const actionsSection = el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: '⚙️ Opciones Rápidas' }),
      el('div', { class: 'pause-actions' },
                button(game.radio?.isOn ? '📻 Sintonizar radio transistor (R)' : '📻 Radio transistor (R)', {
          onClick: () => {
            window.dispatchEvent(new CustomEvent('open-radio-modal'));
          }
        }),
        button('🐕 Personalizar compañero (G)', {
          onClick: () => {
            game.menu?.close?.();
            game.pet?.toggleCustomizationMenu?.();
          }
        }),
        button('💾 Guardar partida ahora', {
          onClick: () => {
            game._save();
            window.dispatchEvent(new CustomEvent('toast', {
              detail: { text: '💾 ¡Partida guardada con éxito!', type: 'info' }
            }));
          }
        }),
        button(game.minimap?.visible ? '🧭 Ocultar radar (N)' : '🧭 Mostrar radar (N)', {
          onClick: () => {
            game.minimap?.toggle();
            game.menu.refresh();
          }
        }),
        button(game.player?.modelKind === 'realista' ? '🧸 Usar modelo liviano (M)' : '🧍 Usar modelo realista (M)', {
          onClick: () => {
            game._toggleModel();
            game.menu.refresh();
          }
        })
      )
    );

    // 4. Guía de controles
    const controlsSection = el('details', { class: 'pause-details' },
      el('summary', { text: '📖 Guía completa de controles y supervivencia' }),
      el('ul', { class: 'pause-controls-list' },
        el('li', {}, el('kbd', { text: 'WASD' }), ' — Desplazarse por el barrio.'),
        el('li', {}, el('kbd', { text: 'Ratón' }), ' — Clic para fijar cámara (o arrastrar) · Rueda para zoom.'),
        el('li', {}, el('kbd', { text: 'Shift' }), ' — Correr.'),
        el('li', {}, el('kbd', { text: 'V' }), ' — Alternar vista tercera persona / isométrica.'),
        el('li', {}, el('kbd', { text: 'E' }), ' — Interactuar con basura, tiendas, cambuche o autos.'),
        el('li', {}, el('kbd', { text: 'Q' }), ' — Mantener para clasificar basura / abrir tienda del dealer.'),
        el('li', {}, el('kbd', { text: 'B / L' }), ' — Pedir limosna a peatones.'),
        el('li', {}, el('kbd', { text: 'F' }), ' — Activar / desactivar boost de adrenalina.'),
        el('li', {}, el('kbd', { text: 'T' }), ' — Abrir árbol de talentos.'),
        el('li', {}, el('kbd', { text: 'C' }), ' — Abrir mesa de crafteo.'),
        el('li', {}, el('kbd', { text: 'P' }), ' — Modificar apariencia del personaje.'),
        el('li', {}, el('kbd', { text: 'G' }), ' — Personalizar nombre, pelaje y accesorios del perro.'),
        el('li', {}, el('kbd', { text: 'I / Tab' }), ' — Inventario y acceso rápido.'),
        el('li', {}, el('kbd', { text: 'N' }), ' — Alternar radar / minimapa urbano.'),
        el('li', {}, el('kbd', { text: 'M' }), ' — Alternar entre modelo 3D realista y liviano.'),
                el('li', {}, el('kbd', { text: 'R' }), ' — Abrir sintonizador de radio transistor AM/FM.'),
        el('li', {}, el('kbd', { text: 'ESC' }), ' — Pausar el juego / cerrar paneles.')
      )
    );

    const body = el('div', { class: 'pause-menu-body' },
      audioSection,
      qualitySection,
      stateSection,
      actionsSection,
      controlsSection
    );

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
    sub: 'Vagabundo / Habitante de Calle · Bogotá',
    ic: 'pause',
    render
  });
}
