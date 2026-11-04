// src/ui/RadioModal.js
// La radio: un transistor de pilas, con su dial a escala y las emisoras de Bogotá.
import { porcentaje } from './formato.js';
import { el, button } from './dom.js';
import { pasarTexto } from './pictos.js';
import { STATIONS } from '../systems/RadioSystem.js';

// El dial: la AM ocupa de 0 a 78 % y la FM de 82 a 98 %, para que cada emisora quede donde está y la aguja no mienta.
const AM_MIN = 500, AM_MAX = 1100, FM_MIN = 88, FM_MAX = 108;
const dialPct = (freq) => (freq < 150
  ? 82 + ((freq - FM_MIN) / (FM_MAX - FM_MIN)) * 16
  : ((freq - AM_MIN) / (AM_MAX - AM_MIN)) * 78);

const conComa = (freq) => String(freq).replace('.', ',');
const lecturaDe = (freq) => `${conComa(freq)} ${freq < 150 ? 'MHz FM' : 'kHz AM'}`;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** 2026-10-27 se dice «27 de octubre». */
const fechaDicha = (fecha) => { const [, m, d] = String(fecha).split('-').map(Number); return MESES[m - 1] ? `${d} de ${MESES[m - 1]}` : fecha; };

const senalDe = (signal) => (signal > 80 ? 'Señal limpia'
  : signal > 45 ? 'Buena señal, con algo de estática'
  : signal > 15 ? 'Señal débil, mucho ruido'
  : 'Sin señal, solo estática');

export function openRadioModal(game) {
  if (!game || game._deathPending || game._loading || game.isSleeping || game.player?.isStunned || game.creator?.isOpen) return;
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch { /* sin pointer lock */ }
  }

  const radio = game.radio;
  if (!radio) return;

  const render = () => {
    const isPowerOn = radio.isOn;
    const batteryPct = Math.round(radio.battery);
    const hasPilas = game.inventory?.items?.some((i) => i.id === 'pilas' && i.qty > 0);

    // ---------- prender y pilas ----------
    const powerBtn = button(isPowerOn ? 'Apagar' : 'Prender', {
      primary: true,
      onClick: () => { radio.toggle(); game.menu.refresh(); }
    });
    const insertBatteryBtn = button('Poner pilas (+50 %)', {
      disabled: !hasPilas || batteryPct >= 100,
      onClick: () => {
        if (game.inventory.remove('pilas', 1)) {
          radio.battery = Math.min(100, radio.battery + 50);
          window.dispatchEvent(new CustomEvent('toast', { detail: { text: 'Le puse pilas al radio (+50 %)', type: 'info' } }));
          game.menu.refresh();
        }
      }
    });
    const statusRow = el('div', { class: 'radio-status-row' },
      el('div', { class: 'radio-power-col' },
        powerBtn,
        el('span', { class: 'radio-estado', text: isPowerOn ? 'Sonando' : 'Apagada' })),
      el('div', { class: `radio-battery-col${batteryPct <= 15 ? ' is-low' : ''}` },
        el('span', { class: 'radio-battery-label' }, 'Pilas ', el('span', { class: 'radio-battery-value cifra', text: porcentaje(batteryPct) })),
        el('div', { class: 'pause-meter' }, el('div', { class: 'pause-meter__fill masa', style: `width:${batteryPct}%` })),
        insertBatteryBtn,
        batteryPct < 100 && !hasPilas ? el('span', { class: 'radio-sin-pilas', text: 'No tengo pilas' }) : null));

    // ---------- el dial ----------
    const needle = el('div', { class: 'radio-dial-needle' });
    const freqDisplay = el('span', { class: 'radio-freq-display cifra' });
    const dialScale = el('div', { class: 'radio-dial-scale', 'aria-hidden': 'true' },
      STATIONS.map((st) => el('span', { class: 'radio-dial-tick', style: `left:${dialPct(st.freq)}%`, text: conComa(st.freq) })),
      el('span', { class: 'radio-dial-band', style: 'left:0', text: 'AM' }),
      el('span', { class: 'radio-dial-band', style: 'left:82%', text: 'FM' }),
      needle);
    const tunerSlider = el('input', {
      type: 'range', min: String(AM_MIN), max: String(AM_MAX), step: '5',
      value: String(radio.frequency > 150 ? radio.frequency : 540),
      class: 'pause-slider radio-tuner-slider', 'aria-label': 'Frecuencia AM',
    });

    // ---------- lo que está sonando ----------
    const stationBox = el('div', { class: 'radio-info-box', 'aria-live': 'polite' });
    const presets = el('ul', { class: 'radio-presets' });
    const pintarSintonia = () => {
      const { station, signal } = radio.getStationInfo();
      const senal = Math.round(signal * 100);
      needle.style.left = `${Math.max(0, Math.min(100, dialPct(radio.frequency)))}%`;
      freqDisplay.textContent = lecturaDe(radio.frequency);
      stationBox.replaceChildren(
        el('strong', { class: 'radio-info-name', text: pasarTexto(station.name) }),
        el('span', { class: 'radio-info-signal', text: senalDe(senal) }),
        el('span', { class: 'radio-info-program', text: pasarTexto(`${station.program}, ${station.genre.toLowerCase()}`) }),
        ...(station.id === 'noticias' && radio.lastBulletin ? [
          el('span', { class: 'radio-info-program', text: `Último boletín (${radio.lastBulletin.fuente}, ${fechaDicha(radio.lastBulletin.fecha)}): ${radio.lastBulletin.titular}. ${radio.lastBulletin.objetivo}` })
        ] : []));
      presets.replaceChildren(...STATIONS.map((st) => {
        const isCur = Math.abs(radio.frequency - st.freq) < 1;
        return el('li', {}, el('button', {
          type: 'button', class: 'radio-preset', 'aria-pressed': String(isCur),
          onclick: () => {
            radio.setFrequency(st.freq);
            if (!radio.isOn) { radio.turnOn(); game.menu.refresh(); return; }
            tunerSlider.value = String(st.freq > 150 ? st.freq : 540);
            const foco = presets.querySelector('[aria-pressed="true"]') === document.activeElement;
            pintarSintonia();
            if (foco || document.activeElement === document.body) presets.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
          },
        }, el('span', { class: `radio-preset__name${isCur ? ' elegido' : ''}`, text: pasarTexto(st.name) }),
        el('span', { class: 'radio-preset__band', text: st.band })));
      }));
    };
    // Sin refrescar la ventana: reemplazar el deslizador lo soltaría a mitad del arrastre.
    tunerSlider.addEventListener('input', (e) => {
      radio.setFrequency(parseFloat(e.target.value));
      pintarSintonia();
    });
    pintarSintonia();

    const volPct = Math.round(radio.volume * 100);
    const volumeLabel = el('span', { class: 'pause-value', text: porcentaje(volPct) });
    const volumeSlider = el('input', { type: 'range', min: '0', max: '100', value: String(volPct), class: 'pause-slider', 'aria-label': 'Volumen de la radio',
      oninput: (e) => {
        const val = parseInt(e.target.value, 10) / 100;
        radio.setVolume(val);
        volumeLabel.textContent = porcentaje(val * 100);
      } });

    const body = el('div', { class: 'radio-modal-body' },
      el('div', { class: 'radio-col' },
        statusRow,
        el('div', { class: 'radio-dial' }, dialScale, tunerSlider, freqDisplay),
        el('div', { class: 'pause-row' }, el('label', { class: 'pause-row__label', text: 'Volumen' }), volumeSlider, volumeLabel),
        el('p', { class: 'radio-perk-text', text: 'Con buena señal, la radio sube el ánimo, hasta +0,8 por segundo, y a El Chato lo calma.' })),
      el('div', { class: 'radio-col' },
        el('h3', { class: 'pause-section-title', text: 'Emisoras' }),
        presets,
        stationBox));

    return { body, foot: [], tecla: 'R' };
  };

  game._radioModalOpen = true;
  game.menu.open({
    title: 'La radio',
    sub: 'A pilas, AM y FM',
    ic: 'radio',
    render,
    onClose: () => { game._radioModalOpen = false; }
  });
}
