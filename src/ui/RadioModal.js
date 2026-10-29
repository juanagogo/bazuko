// src/ui/RadioModal.js
// Modal interactivo de Radio Transistor a Pilas Lo-Fi Bogotano
import { el, button } from './dom.js';
import { STATIONS } from '../systems/RadioSystem.js';

export function openRadioModal(game) {
  if (!game || game._deathPending || game._loading || game.isSleeping || game.player?.isStunned || game.creator?.isOpen) return;
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch { /* sin pointer lock */ }
  }

  const radio = game.radio;
  if (!radio) return;

  const render = () => {
    const curInfo = radio.getStationInfo();
    const station = curInfo.station;
    const signal = Math.round(curInfo.signal * 100);

    // 1. Estado de encendido y batería
    const isPowerOn = radio.isOn;
    const batteryPct = Math.round(radio.battery);
    const hasPilas = game.inventory?.items?.some((i) => i.id === 'pilas' && i.qty > 0);

    const powerBtn = button(isPowerOn ? '🔴 Apagar Radio' : '🟢 Encender Radio', {
      class: isPowerOn ? 'btn btn--ghost btn--small' : 'btn btn--primary btn--small',
      onClick: () => {
        radio.toggle();
        game.menu.refresh();
      }
    });

    const batteryBar = el('div', { class: 'radio-battery-bar' },
      el('div', {
        class: 'radio-battery-fill',
        style: `width: ${batteryPct}%; background-color: ${batteryPct > 30 ? '#27ae60' : batteryPct > 10 ? '#f39c12' : '#e74c3c'};`
      })
    );

    const insertBatteryBtn = button('🔋 Poner pilas AA (+50%)', {
      class: 'btn btn--ghost btn--small',
      disabled: !hasPilas || batteryPct >= 100,
      onClick: () => {
        if (game.inventory.remove('pilas', 1)) {
          radio.battery = Math.min(100, radio.battery + 50);
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: '🔋 ¡Pilas nuevas colocadas en la radio! (+50%)', type: 'info' }
          }));
          game.menu.refresh();
        }
      }
    });

    const statusRow = el('div', { class: 'pause-section' },
      el('div', { class: 'radio-status-row' },
        el('div', { class: 'radio-power-col' },
          powerBtn,
          el('span', {
            class: `radio-indicator-led ${isPowerOn ? 'is-on' : ''}`,
            text: isPowerOn ? '• TRANSMISIÓN ACTIVA' : '• APAGADA'
          })
        ),
        el('div', { class: 'radio-battery-col' },
          el('span', { class: 'radio-battery-label', text: `Batería: ${batteryPct}%` }),
          batteryBar,
          insertBatteryBtn
        )
      )
    );

    // 2. Dial analógico retro con aguja roja
    // Rango visual 500 AM a 1100 AM (para estaciones AM)
    const dialMin = 500;
    const dialMax = 1100;
    let needlePct = 50;
    if (radio.frequency >= dialMin && radio.frequency <= dialMax) {
      needlePct = ((radio.frequency - dialMin) / (dialMax - dialMin)) * 100;
    } else if (radio.frequency < 108) {
      // FM: mapear 88 - 108 a 0 - 100%
      needlePct = ((radio.frequency - 88) / (108 - 88)) * 100;
    }

    const dialScale = el('div', { class: 'radio-dial-scale' },
      el('div', { class: 'radio-dial-ticks' },
        el('span', { text: '540 AM' }),
        el('span', { text: '700' }),
        el('span', { text: '890 AM' }),
        el('span', { text: '1040 AM' }),
        el('span', { text: '98.5 FM' })
      ),
      el('div', { class: 'radio-dial-needle', style: `left: ${Math.max(2, Math.min(98, needlePct))}%;` })
    );

    // Control deslizante de sintonizador analógico
    const tunerSlider = el('input', {
      type: 'range',
      min: '520',
      max: '1060',
      step: '5',
      value: String(radio.frequency > 150 ? radio.frequency : 540),
      class: 'pause-slider radio-tuner-slider',
      'aria-label': 'Frecuencia AM'
    });

    const freqDisplay = el('span', {
      class: 'radio-freq-display',
      text: `${radio.frequency} ${radio.frequency < 110 ? 'MHz (FM)' : 'kHz (AM)'}`
    });

    tunerSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      radio.setFrequency(val);
      freqDisplay.textContent = `${radio.frequency} kHz (AM)`;
      game.menu.refresh();
    });

    const tunerSection = el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: '📻 Dial de Sintonía Analógico' }),
      dialScale,
      el('div', { class: 'pause-row' },
        el('label', { text: 'Ajuste manual:' }),
        tunerSlider,
        freqDisplay
      )
    );

    // 3. Emisoras preestablecidas (Presets rápidos)
    const presetButtons = STATIONS.map((st) => {
      const isCur = Math.abs(radio.frequency - st.freq) < 1;
      return button(`${st.band === 'FM' ? '🎸' : '📻'} ${st.name}`, {
        class: isCur ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small',
        onClick: () => {
          radio.setFrequency(st.freq);
          if (!radio.isOn) radio.turnOn();
          game.menu.refresh();
        }
      });
    });

    const presetsSection = el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: '📡 Emisoras Populares de Bogotá' }),
      el('div', { class: 'radio-presets-grid' }, ...presetButtons)
    );

    // 4. Panel de transmisión y señal actual
    let signalRating = 'Sin señal (solo estática)';
    let signalClass = 'signal-none';
    if (signal > 80) { signalRating = 'Excelente (Sintonía fina)'; signalClass = 'signal-full'; }
    else if (signal > 45) { signalRating = 'Buena (Fondo con estática)'; signalClass = 'signal-medium'; }
    else if (signal > 15) { signalRating = 'Débil (Mucho ruido)'; signalClass = 'signal-low'; }

    const stationBox = el('div', { class: 'radio-info-box' },
      el('div', { class: 'radio-info-header' },
        el('strong', { text: station.name }),
        el('span', { class: `radio-signal-badge ${signalClass}`, text: `📶 ${signalRating}` })
      ),
      el('div', { class: 'radio-info-program', text: `Programa: ${station.program}` }),
      el('div', { class: 'radio-info-genre', text: `Género: ${station.genre}` }),
      ...(station.id === 'noticias' && radio.lastBulletin ? [
        el('div', {
          class: 'radio-info-program',
          text: `Último boletín (${radio.lastBulletin.fuente}, ${radio.lastBulletin.fecha}): ${radio.lastBulletin.titular}. ${radio.lastBulletin.objetivo}`
        })
      ] : [])
    );

    // 5. Control de volumen de radio
    const volPct = Math.round(radio.volume * 100);
    const volumeSlider = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: String(volPct),
      class: 'pause-slider',
      'aria-label': 'Volumen de la radio'
    });
    const volumeLabel = el('span', { class: 'pause-vol-label', text: `${volPct}%` });

    volumeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) / 100;
      radio.setVolume(val);
      volumeLabel.textContent = `${Math.round(val * 100)}%`;
    });

    const volumeSection = el('div', { class: 'pause-section' },
      el('h3', { class: 'pause-section-title', text: '🔊 Volumen del Transistor' }),
      el('div', { class: 'pause-row' },
        el('label', { text: 'Volumen:' }),
        volumeSlider,
        volumeLabel
      )
    );

    // 6. Efectos del juego
    const perksSection = el('div', { class: 'radio-perks-box' },
      el('span', { class: 'radio-perk-icon', text: '✨' }),
      el('div', { class: 'radio-perk-text' },
        el('strong', { text: 'Compañía y Salud Mental: ' }),
        el('span', { text: 'Escuchar la radio sintonizada restaura +0.8 de salud mental por segundo, previene la desesperación nocturna y relaja a El Chato 🐕.' })
      )
    );

    const body = el('div', { class: 'pause-menu-body radio-modal-body' },
      statusRow,
      tunerSection,
      presetsSection,
      stationBox,
      volumeSection,
      perksSection
    );

    const foot = [
      button(isPowerOn ? '📻 Escuchar de fondo y cerrar (R)' : 'Cerrar ventana (R)', {
        primary: true,
        onClick: () => game.menu.close()
      })
    ];

    return { body, foot };
  };

  game._radioModalOpen = true;
  game.menu.open({
    title: 'Radio Transistor a Pilas',
    sub: 'Sintonizador AM / FM Lo-Fi Bogotano',
    ic: 'radio',
    render,
    onClose: () => { game._radioModalOpen = false; }
  });
}
