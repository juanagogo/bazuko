// src/ui/HUD.js
import { TALENTS, BRANCHES } from '../data/talents.js';
import { XP_PER_LEVEL, XP_CRAFT, SUBSTANCE_PRICE_MULT, SUBSTANCE_RISK_CHANCE, SORT_BASE_TIME } from '../utils/constants.js';
import { NEEDS } from '../systems/StatsSystem.js';
import { cop } from '../utils/money.js';
import { conSigno } from '../utils/numeros.js';
import { ITEMS, dealerPrice, dealerOffer } from '../data/items.js';
import { diseaseName } from '../data/diseases.js';
import { SMOKABLES, smokable } from '../character/smoking.js';
import { itemArtHTML, itemCategory, itemEffectLine } from './itemArt.js';
import { NEED_META, NEED_LOW, NEED_CRITICAL, NEED_ORDEN, needLevel, masUrgente } from './needsMeta.js';
import { describeWeather } from '../world/Climate.js';
import { icon, setIcon } from './icons.js';
import { pasarTexto } from './pictos.js';
import { modoEntrada, teclaVisible, sinTeclas } from '../core/modoEntrada.js';
import { Avisos } from './avisos.js';
import { cierreHTML } from './cierre.js';
import { cuentaAtras, hora, porcentaje } from './formato.js';
import { tabDaLaVuelta } from './dom.js';
import { CAMBUCHE } from '../data/cambuche.js';

/** Las cuatro filas de siempre, siempre en este orden y en el mismo sitio. */
const FILAS = ['salud', 'hambre', 'sed', 'energia'];
/** Las demás: se suben debajo de las cuatro cuando están bajas. */
const SUBEN = ['higiene', 'animo', 'vicio', 'calor'];
const MAX_SUBIDAS = 2;
const CALOR_TOPE = 300;  // segundos de «calientito» que caben
const CALOR_BAJO = 60;   // de aquí para abajo la fila de calor se sube
const ENCIMA_M = 18;     // la patrulla está encima
const ENCIMA_SUELTA_M = 21; // y deja de estarlo un poco más lejos, para que la placa no vaya y venga
const MISION_S = 4;
/** Los segundos de calor como se leen en el cartón: 2:59. */
export const calorALaVista = cuentaAtras;
const PLATA_LARGA = 1_000_000;
const PLATA_LARGUISIMA = 10_000_000;

const escapar = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Qué se ve de la búsqueda: nada, fichado, detras o encima. `distancia` es null si nadie lo persigue. */
export function estadoBusqueda(distancia, nivel, previo = 'nada') {
  if (distancia === null || distancia === undefined) return nivel > 0 ? 'fichado' : 'nada';
  return distancia < (previo === 'encima' ? ENCIMA_SUELTA_M : ENCIMA_M) ? 'encima' : 'detras';
}

/**
 * Un aviso de tecla, en sus piezas: `[E] Recoger basura · [Mantener Q] Seleccionar`.
 * Cada pieza trae su tecla (si tiene) y su verbo; el emoji pasa a dibujo y «Mantener» queda en el verbo.
 */
export function piezasDelPrompt(texto) {
  return String(texto).split(' · ').map((parte) => {
    const m = /^(.*?)\[([^\]]+)\]\s*(.*)$/.exec(parte);
    if (!m) return { tecla: null, verbo: pasarTexto(parte), sostener: false };
    const sostener = /^Mantener /.test(m[2]);
    const tecla = sostener ? m[2].replace(/^Mantener /, '') : m[2];
    const verbo = pasarTexto(`${m[1]}${m[3]}`.trim());
    return { tecla, verbo: sostener ? `Mantener: ${verbo.toLowerCase()}` : verbo, sostener };
  });
}

/** Lo que dice la tecla de contexto ahora mismo. Cadena vacía si no hay nada que hacer. */
export function textoDelPrompt(interaction, inventory) {
  if (!interaction?.currentTarget && !interaction?.stealPrompt) return '';
  const type = interaction.currentTargetType;
  if (type === 'pickup') return '[E] Recoger basura · [Mantener Q] Seleccionar';
  if (type === 'car') return interaction.currentTarget?.traffic ? '[E] Robar retrovisor del carro en circulación' : '[E] Robar retrovisor del carro';
  if (type === 'fireBarrel') return '[E] Calentarme en la fogata';
  if (type === 'sell') return '[E] Vender material en la recicladora';
  if (type === 'shop') return `[E] Comprar en ${interaction.currentTarget.title ?? 'Tienda La Esquinita'}`;
  if (type === 'dog') {
    const hasFood = inventory?.items?.some(item => item.qty > 0 && ['pan', 'lataComida', 'carne', 'hueso'].includes(item.id));
    if (interaction.currentTarget?.isFriend) return '[E] Acariciar a El Chato';
    return hasFood ? '[E] Darle pan o atún a El Chato para que me siga' : '[E] Acariciar a El Chato · Si le traigo pan o una lata de atún, me sigue';
  }
  if (type === 'cambuche') return '[E] Mi cambuche: armar o dormir';
  if (type === 'mesa') return '[E] Fabricar';
  if (type === 'dealer') return '[Q / E] El jíbaro: comprar o vender';
  if (type === 'cart') return interaction.currentTarget?.isAttached ? '[E] Soltar la carreta' : '[E] Agarrar la carreta (+120 kg)';
  return interaction.stealPrompt ?? '';
}

// Con el dedo la cinta va a un lado del personaje, y ahí no cabe la frase entera: lo mismo, en corto.
const VERBO_CORTO = [
  [/^Robar retrovisor/, 'Robar retrovisor'],
  [/^Darle pan o atún/, 'Darle comida'],
  [/^Acariciar a El Chato/, 'Acariciar'],
  [/^Calentarme/, 'Calentarme'],
  [/^Vender material/, 'Vender material'],
  [/^Comprar en /, 'Comprar'],
  [/^Mi cambuche/, 'Mi cambuche'],
  [/^El jíbaro/, 'El jíbaro'],
  [/^Agarrar la carreta/, 'Agarrar carreta'],
  [/^Soltar la carreta/, 'Soltar carreta'],
  [/^Cosquilleo/, 'Cosquilleo'],
  [/^Mantener: seleccionar/, 'Seleccionar'],
];

/** Las piezas de la tecla de contexto para el dedo: máximo dos, cortas y sin la nota de al lado. */
export function piezasParaElDedo(piezas) {
  return piezas.filter((p) => p.tecla).slice(0, 2).map((p) => ({
    ...p, verbo: VERBO_CORTO.find(([patron]) => patron.test(p.verbo))?.[1] ?? p.verbo,
  }));
}

function piezaHTML({ tecla, verbo, sostener }, principal) {
  if (!tecla) return `<span class="cx cx--nota">${escapar(verbo)}</span>`;
  const barra = sostener ? '<span class="cx__sostener" role="progressbar" aria-label="Manteniendo la tecla" aria-valuemin="0" aria-valuemax="100"><i class="masa"></i></span>' : '';
  const codigo = `Key${tecla[0]}`, dedo = modoEntrada() === 'tactil' ? ' role="button"' : '';
  return `<span class="cx cinta${principal ? ' cinta--verbo' : ''}" data-tecla="${escapar(codigo)}"${dedo}><kbd>${escapar(teclaVisible(tecla))}</kbd><span class="cx__verbo">${escapar(verbo)}${barra}</span></span>`;
}

/** Lo que falta del cambuche, en una línea: sale de sus piezas, de lo armado y de lo que lleva en el costal. */
export function textoDeMision(built, inventory) {
  if (!built || !inventory?.count) return null;
  const pieza = CAMBUCHE.find((p) => !built[p.id] && (!p.needs || built[p.needs]));
  if (!pieza) return null;
  const alcanza = Object.entries(pieza.req).every(([id, n]) => inventory.count(id) >= n);
  if (alcanza) return pieza.id === 'base' ? 'TOCA ARMAR EL CAMBUCHE' : `TOCA PONER ${pieza.name.toUpperCase()}`;
  if (pieza.id !== 'base') return null;
  const [id, n] = Object.entries(pieza.req)[0];
  const falta = n - inventory.count(id);
  return `TOCA JUNTAR ${falta} ${falta === 1 ? 'CARTÓN' : 'CARTONES'}`;
}

/** Cuántas veces el valor paga el Dealer: 1,8×, o 2,34× con Contactos. */
const dealerSellMult = (priceMult = 1) => String(+(SUBSTANCE_PRICE_MULT * priceMult).toFixed(2)).replace('.', ',');

/** Los kilos, con coma. */
const kilos = (n) => String(n).replace('.', ',');

export class HUD {
  constructor() {
    this._htmlCache = new WeakMap();
    this._panelElapsed = 0.1;
    this.bars = {};
    this.barValues = {};
    this._rows = {};
    this._buildNeeds(document.getElementById('hud'));
    this.movementEl = document.getElementById('movement-status');
    this.movementLabel = document.getElementById('movement-label');
    this.movementHelp = document.getElementById('movement-help');

    this.clockEl = document.getElementById('clock');
    this.moneyEl = document.getElementById('money');
    this.statusEl = document.getElementById('status');
    this.retazoEl = document.getElementById('retazo');
    this.retazoGrito = this.retazoEl?.querySelector?.('.retazo__grito');
    this.retazoOrden = this.retazoEl?.querySelector?.('.retazo__orden');
    this.wantedEl = document.getElementById('wanted');
    this.wantedGrito = this.wantedEl?.querySelector?.('.wanted__grito');
    this.wantedRayas = this.wantedEl?.querySelector?.('.wanted__rayas');
    this.wantedDato = this.wantedEl?.querySelector?.('.wanted__dato');
    this.wantedBarra = this.wantedEl?.querySelector?.('.wanted__barra .masa');
    this.wantedVoz = this.wantedEl?.querySelector?.('.wanted__voz');
    this.misionEl = document.getElementById('mision');
    this.cartEl = document.getElementById('cart-indicator');
    this.boostEl = document.getElementById('boost-indicator');
    this.boostTimeEl = document.getElementById('boost-time');
    this.diseaseEl = document.getElementById('disease-panel');
    this.xpBarEl = document.getElementById('xp-bar');
    this.xpFillEl = document.getElementById('xp-fill');
    this.levelEl = document.getElementById('level-display');
    this.talentPointsEl = document.getElementById('talent-points');
    this.talentCountEl = document.getElementById('talent-count');
    this.dayEl = document.getElementById('day-display');
    this.xpTextEl = document.getElementById('xp-text');
    this.weatherEl = document.getElementById('weather-display');
    this.weatherWordEl = this.weatherEl?.querySelector?.('.clima__palabra');
    this.talentWordEl = document.getElementById('talent-word');
    this.nameEl = document.getElementById('player-name');
    this.cameraButton = document.getElementById('camera-toggle');
    this.cameraHint = document.getElementById('camera-hint');
    this.audioBtn = document.getElementById('audio-toggle');
    this.pauseBtn = document.getElementById('pause-toggle');
    this.radioBtn = document.getElementById('radio-toggle');
    // Iconos de los botones (marcados con data-icon en index.html)
    for (const slot of document.querySelectorAll?.('[data-icon]') ?? []) setIcon(slot, slot.dataset.icon, { size: 24 });
    // Con el celular de pie el cartón del radar va debajo de la plata, cuya altura cambia con la persecución.
    // Al crecer la plata, el cartón baja sin cambiar de tamaño: los dos bordes se miden juntos, sea cual sea el que cambió.
    const topbar = document.getElementById('topbar');
    const dock = document.getElementById('hud-dock');
    if (topbar && typeof ResizeObserver !== 'undefined') {
      const raiz = document.documentElement;
      const medir = () => {
        const arriba = `${Math.round(topbar.getBoundingClientRect().bottom)}px`;
        if (arriba !== this._topbarBottom) { this._topbarBottom = arriba; raiz.style.setProperty('--topbar-bottom', arriba); }
        if (dock) {
          const abajo = `${Math.round(dock.getBoundingClientRect().bottom)}px`;
          if (abajo !== this._dockBottom) { this._dockBottom = abajo; raiz.style.setProperty('--dock-bottom', abajo); }
        }
        this.avisos?.acomodar();
      };
      const mirar = new ResizeObserver(medir);
      mirar.observe(topbar);
      if (dock) mirar.observe(dock);
    }
    // Lo que se oprime sobre el cartón no cae al mundo.
    document.getElementById('hud-dock')?.addEventListener?.('mousedown', (e) => e.stopPropagation());
    this.radioBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-radio-modal'));
      this.radioBtn.blur();
    });

    this.audioBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('audio-toggle'));
      this.audioBtn.blur();
    });
    this.pauseBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-pause-menu'));
      this.pauseBtn.blur();
    });
    window.addEventListener('audio-settings-change', (e) => {
      this.setMuted(!!e.detail?.muted);
    });
    this.cameraButton?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('camera-toggle'));
      this.cameraButton.blur();
    });

    // Paneles
    this.talentPanel = document.getElementById('talent-panel');
    this.craftPanel = document.getElementById('craft-panel');
    this.dealerPanel = document.getElementById('dealer-panel');
    this.promptEl = document.getElementById('interaction-prompt');
    this.poopAmmoEl = document.getElementById('poop-hud-ammo');

    // Estado de paneles
    this._talentOpen = false;
    this._craftOpen = false;
    this._dealerOpen = false;
    this._craftSelected = null;
    this.craftPanel?.addEventListener('click', (e) => this._onCraftClick(e));

    // Toasts
    this._bindEvents();

    // Controles de paneles
    window.addEventListener('keydown', (e) => {
      // No abrir paneles mientras se escribe (nombre) o hay un menú/creador abierto
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab') {
        const abierto = this._talentOpen ? this.talentPanel : this._craftOpen ? this.craftPanel : this._dealerOpen ? this.dealerPanel : null;
        if (abierto) tabDaLaVuelta(e, abierto);
        return;
      }
      // Un panel abierto pausa el juego: en pausa, su tecla solo sirve para cerrarlo.
      const pausado = window.__game?.paused;
      if (e.code !== 'Escape' && pausado && !(e.code === 'KeyT' && this._talentOpen) && !(e.code === 'KeyC' && this._craftOpen)) return;
      if (e.code === 'KeyT' && !e.repeat) this.toggleTalentPanel();
      if (e.code === 'KeyC' && !e.repeat) this.toggleCraftPanel();
      if (e.code === 'KeyH' && !e.repeat) this.needsToggle?.click();
      if (e.code === 'Escape') {
        if (this._talentOpen || this._craftOpen || this._dealerOpen) e._panelHandled = true;
        this.talentPanel?.classList.remove('open');
        this.craftPanel?.classList.remove('open');
        this.dealerPanel?.classList.remove('open');
        this._talentOpen = false;
        this._craftOpen = false;
        this._dealerOpen = false;
      }
    });

    window.addEventListener('dealer-toggle', (e) => {
      this.toggleDealerPanel(e.detail?.dealer);
    });

    window.addEventListener('rejected', (e) => {
      if (e.detail.reason === 'higiene') {
        this._toast('El vendedor no me atiende: huelo muy mal.', 'warn');
      }
    });
  }

  /** Botón de sonido: icono y textos según el silencio. */
  setMuted(muted) {
    if (!this.audioBtn) return;
    const label = muted ? 'Activar sonido' : 'Silenciar sonido';
    setIcon(this.audioBtn, muted ? 'mute' : 'sound', { size: 24 });
    this.audioBtn.setAttribute('title', label);
    this.audioBtn.setAttribute('aria-label', label);
    this.audioBtn.classList.toggle('is-muted', muted);
  }

  /**
   * Cuatro filas fijas, las que estén bajas debajo, y el resto se consulta sin abrir una pausa.
   * Cada fila: [dibujo] [nombre] [barra] [cifra]. Ninguna letra va sobre el relleno: cada una tiene su celda.
   */
  _buildNeeds(container) {
    if (!container) return;
    const vitals = document.createElement('div');
    vitals.id = 'hud-vitals';
    const subidas = document.createElement('div');
    subidas.id = 'needs-subidas';
    const details = document.createElement('div');
    details.id = 'needs-details';
    details.hidden = true;
    const toggle = document.createElement('button');
    toggle.id = 'needs-toggle';
    toggle.type = 'button';
    toggle.className = 'cinta';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', details.id);
    toggle.setAttribute('aria-keyshortcuts', 'H');
    toggle.title = 'Estado y necesidades (H)';
    toggle.innerHTML = '<span class="needs-toggle__dibujo" aria-hidden="true"></span><span id="needs-summary">Estado</span><kbd class="needs-toggle__key" aria-hidden="true">H</kbd>';
    toggle.firstChild.append(icon('chart', { size: 20 }));
    toggle.addEventListener('click', () => {
      details.hidden = !details.hidden;
      toggle.setAttribute('aria-expanded', String(!details.hidden));
      this._subidasKey = null; // abierto, cada fila vuelve a su lugar
    });
    // El control conserva la activación nativa con Espacio sin disparar un salto.
    toggle.addEventListener('keydown', event => {
      if (event.code === 'Space') event.stopPropagation();
    });
    container.append(vitals, subidas, details, toggle);
    this.needsSummary = toggle.querySelector('#needs-summary');
    this.needsToggle = toggle;
    this.needsDetails = details;
    this.needsSubidas = subidas;
    const fila = ({ id, glyph, label }, padre, max = 100) => {
      const row = document.createElement('div');
      row.className = 'stat-bar';
      row.dataset.stat = id;
      row.dataset.level = 'ok';
      row.title = id === 'vicio' ? 'Vicio: si se vacía, llega la abstinencia' : label;
      row.innerHTML = '<span class="stat-bar__icon" aria-hidden="true"></span>'
        + `<span class="stat-bar__name">${label}</span>`
        + '<div class="bar"><div class="fill masa"></div></div>'
        + `<span class="stat-bar__orden" aria-hidden="true">${NEED_ORDEN[id]}</span>`
        + '<span class="stat-bar__value cifra">100</span>';
      row.firstChild.append(icon(glyph, { size: 22 }));
      const meter = row.querySelector('.bar');
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', label);
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', String(max));
      meter.setAttribute('aria-valuenow', String(max));
      padre.appendChild(row);
      this._rows[id] = row;
      this.bars[id] = row.querySelector('.fill');
      this.barValues[id] = row.querySelector('.stat-bar__value');
    };
    const meta = (id) => NEED_META.find((n) => n.id === id);
    for (const id of FILAS) fila(meta(id), vitals);
    for (const id of SUBEN) fila(id === 'calor' ? { id, glyph: 'flame', label: 'Calor' } : meta(id), details, id === 'calor' ? CALOR_TOPE : 100);
  }

  /** Las que están bajas, de la más baja a la menos, con el calor contado por sus segundos. */
  _bajas(stats) {
    const bajas = [];
    for (const id of SUBEN) {
      const v = id === 'calor'
        ? (stats.calor > 0 && stats.calor <= CALOR_BAJO ? stats.calor / CALOR_BAJO * NEED_LOW : Infinity)
        : stats[id] ?? Infinity;
      if (v < NEED_LOW || (id === 'calor' && v !== Infinity)) bajas.push({ id, v });
    }
    return bajas.sort((a, b) => a.v - b.v);
  }

  /** Lo que está mal se sube solo; las cuatro filas no se mueven nunca. Se toca la página solo si cambia el reparto. */
  _subirNecesidades(bajas) {
    const abierto = this.needsDetails && !this.needsDetails.hidden;
    const suben = abierto || !this.needsSubidas ? [] : bajas.slice(0, MAX_SUBIDAS).map((b) => b.id);
    const key = suben.join();
    if (this.needsSubidas && key !== this._subidasKey) {
      this._subidasKey = key;
      for (const id of SUBEN) {
        const row = this._rows[id];
        if (!row) continue;
        const padre = suben.includes(id) ? this.needsSubidas : this.needsDetails;
        if (row.parentElement !== padre) padre.appendChild(row);
      }
    }
    return suben;
  }

  setMovementState(player) {
    if (!this.movementEl) return;
    const swimming = !!player?.isSwimming;
    const inWater = swimming || (player?.waterDepth ?? 0) > .1;
    if (this.movementEl.hidden === inWater) this.movementEl.hidden = !inWater;
    if (!inWater) return;
    this.movementEl.dataset.movement = swimming ? 'swimming' : 'wading';
    this._setText(this.movementLabel, swimming ? 'Nadando' : 'En el agua');
    this._setText(this.movementHelp, swimming
      ? sinTeclas('WASD para nadar, Shift para acelerar')
      : 'Busco la orilla para salir');
  }

  setCameraMode(mode) {
    const thirdPerson = mode === 'third-person';
    if (this.cameraButton) {
      this.cameraButton.dataset.targetView = thirdPerson ? 'isometric' : 'third-person';
      this.cameraButton.title = `Vista actual: ${thirdPerson ? 'tercera persona' : 'isométrica'}. Clic o V para cambiar.`;
      this.cameraButton.setAttribute('aria-pressed', String(thirdPerson));
      this.cameraButton.setAttribute('aria-label', `Cambiar a vista ${thirdPerson ? 'isométrica' : 'en tercera persona'} (V)`);
    }
    if (this.cameraHint) this.cameraHint.textContent = thirdPerson
      ? 'Clic: fijar el mouse. Arrastrar o flechas: girar. Rueda: distancia. Esc: soltar.'
      : 'V: cambiar a tercera persona';
  }

  _bindEvents() {
    window.addEventListener('toast', (e) => this._toast(e.detail.text, e.detail.type ?? e.detail.kind));
    window.addEventListener('resize', () => this.avisos?.acomodar());
    window.addEventListener('pickup', (e) => this._onPickup(e.detail));
    window.addEventListener('sell', (e) => this._onSell(e.detail));
    window.addEventListener('disease', (e) => this._toast(`Me enfermé: ${e.detail.name}`, 'death'));
    window.addEventListener('disease-cured', (e) => this._toast(`Me curé: ${e.detail.name}`, 'info'));
    window.addEventListener('levelup', (e) => this._toast(`Nivel ${e.detail.level}: +1 maña`, 'rare'));
    window.addEventListener('talent-unlock', (e) => this._toast(`Aprendí: ${e.detail.name}`, 'rare'));
    window.addEventListener('craft', (e) => this._toast(`Fabriqué: ${e.detail.name} ×${e.detail.qty}`, 'info'));
    window.addEventListener('steal', (e) => {
      // La persecución ya la dice la placa de arriba: el aviso solo cuenta lo que se llevó.
      if (e.detail.chase) {
        if (e.detail.added?.length) this._toast(`Robé: ${e.detail.added.join(', ')}`, 'warn');
      } else if (e.detail.caught) this._toast('¡Me pillaron robando!', 'death');
      else if (e.detail.added?.length) this._toast(`Robé: ${e.detail.added.join(', ')}`, 'warn');
    });
    window.addEventListener('police-escaped', () => {
      this._toast('Los despisté', 'info');
    });
    window.addEventListener('withdrawal', (e) => {
      if (e.detail.active) this._toast('Me dio malilla: camino más lento y me bajo de ánimo', 'warn');
      else this._toast('Se me pasó la malilla', 'info');
    });
    window.addEventListener('substance-sell', (e) => this._toast(`Le vendí al jíbaro: ${cop(e.detail.earned)}`, 'sell'));
    window.addEventListener('substance-buy', (e) => {
      this._toast(`Compré ${e.detail.name} (−${cop(e.detail.cost)})`, 'info');
      if (this._dealerOpen) this.renderDealer();
    });
    window.addEventListener('substance-fail', (e) => {
      if (e.detail.reason === 'day') this._toast(`El jíbaro no compra de día (de noche paga ${dealerSellMult(window.__game?.interaction?.substancePriceMult?.())}×)`, 'warn');
    });
    window.addEventListener('substance-raid', (e) => {
      this._toast(`¡Requisa! La Policía se llevó: ${e.detail.lost.join(', ')}`, 'death');
      if (this._dealerOpen) this.renderDealer();
    });
    window.addEventListener('substance-buy-fail', (e) => {
      if (e.detail?.reason === 'insufficient_money') {
        this._toast(`No me alcanza la plata (${cop(e.detail.cost)})`, 'warn');
      } else if (e.detail?.reason === 'inventory_full') {
        this._toast('El costal está lleno', 'warn');
      } else {
        this._toast('No se pudo comprar', 'warn');
      }
    });

    // Eventos de pedir limosna
    window.addEventListener('beg-result', (e) => {
      const type = e.detail.success ? (e.detail.rare ? 'rare' : 'sell') : 'warn';
      this._toast(e.detail.message, type);
    });
    window.addEventListener('beg-cooldown', (e) => {
      this._toast(`Espere ${e.detail.waitSec} s para volver a pedir`, 'info');
    });
    window.addEventListener('beg-fail', () => {
      this._toast('No me queda energía para pedir limosna', 'warn');
    });

    window.addEventListener('sleep-end', (e) => this._toast(`Dormí ${e.detail?.hours ?? ''} h. Partida guardada`, 'info'));
    window.addEventListener('sleep-fail', (e) => this._toast(
      e.detail.reason === 'nobase' ? 'Primero toca armar el cambuche (8 cartones)' : 'Aquí no puedo dormir',
      'warn'
    ));
  }

  toggleTalentPanel() {
    window.__game?.cameraRig?.releaseControls?.();
    this._talentOpen = !this._talentOpen;
    this.talentPanel?.classList.toggle('open', this._talentOpen);
    if (this._talentOpen) {
      this.renderTalents();
      const nodos = this.talentPanel?.querySelector;
      if (nodos) (this.talentPanel.querySelector('.talent-node.available') ?? this.talentPanel.querySelector('.talent-node'))?.focus({ preventScroll: true });
    }
  }

  toggleCraftPanel() {
    window.__game?.cameraRig?.releaseControls?.();
    this._craftOpen = !this._craftOpen;
    this.craftPanel?.classList.toggle('open', this._craftOpen);
    if (this._craftOpen) {
      const game = window.__game;
      if (game?.crafting && game.inventory) this.renderCrafting(game.crafting, game.inventory, game.talents);
      this.craftPanel?.querySelector?.('.craft-recipe.selected')?.focus({ preventScroll: true });
    }
  }

  toggleDealerPanel(dealer = null) {
    window.__game?.cameraRig?.releaseControls?.();
    this._dealerOpen = !this._dealerOpen;
    this.dealerPanel?.classList.toggle('open', this._dealerOpen);
    if (this._dealerOpen) {
      this.renderDealer(dealer);
      this.dealerPanel?.querySelector?.('.dealer-buy-btn:not([disabled]), .dealer-close')?.focus({ preventScroll: true });
    }
  }

  update(stats, clock, interaction, inventory, diseaseSystem, talentSystem, craftingSystem, dt = 0.1) {
    // Las filas: la página se toca solo cuando cambia el número que se ve.
    for (const k of NEEDS) {
      const el = this.bars[k];
      if (!el) continue;
      const value = Math.round(Math.max(0, Math.min(100, stats[k] ?? 0)));
      const level = k === 'vicio' && stats.inWithdrawal ? 'critical' : needLevel(value);
      this._pintarFila(el, this.barValues[k], value, 100, String(value), level);
    }
    if (this.bars.calor) {
      const calor = Math.max(0, Math.ceil(stats.calor ?? 0));
      this._pintarFila(this.bars.calor, this.barValues.calor, calor, CALOR_TOPE, `${calor} s`, calor > 0 && calor <= CALOR_BAJO ? 'low' : 'ok');
    }
    const filaVicio = this.bars.vicio?.parentElement?.parentElement;
    if (filaVicio && stats.abstinencia !== undefined) {
      const title = stats.abstinencia > 0
        ? `Abstinencia: ${porcentaje(stats.abstinencia)} (Vicio: ${Math.round(stats.vicio)}/100)`
        : 'Vicio: si se vacía, llega la abstinencia';
      if (filaVicio.title !== title) filaVicio.title = title;
    }

    // Munición de popó: se ve solo si hay con qué. Sin nada, la tecla sigue estando en la ayuda.
    if (this.poopAmmoEl) {
      // Con la camioneta encima no hay chiste que valga: la etiqueta se quita y la tecla sigue sirviendo.
      const poopCount = window.__game?.limpieza?.active ? 0 : inventory?.count?.('popo') ?? 0;
      if (poopCount !== this._popoVisto) {
        this._popoVisto = poopCount;
        this.poopAmmoEl.className = poopCount > 0 ? 'ready' : 'empty';
        this._setHTML(this.poopAmmoEl, poopCount > 0 ? `<kbd data-k="X">${teclaVisible('X')}</kbd> Lanzar popó (${poopCount})` : '');
      }
    }

    // Reloj
    this._setText(this.clockEl, hora(clock.hour));
    this._setText(this.dayEl, `Día ${clock.day}`);
    this._pintarClima(clock);
    this._pintarPlata(stats.dinero);

    // Nivel, experiencia y mañas
    this._setText(this.levelEl, `nivel ${stats.level}`);
    this._setText(this.nameEl, window.__game?.look?.nombre ?? '');
    const xpNeeded = XP_PER_LEVEL * stats.level;
    if (this.xpFillEl) this._setWidth(this.xpFillEl, Math.round((stats.xp / xpNeeded) * 100));
    this._setText(this.xpTextEl, `${Math.floor(stats.xp ?? 0)}/${xpNeeded}`);
    const points = talentSystem?.points ?? 0;
    this._setText(this.talentCountEl, String(points));
    this._setText(this.talentWordEl, points === 1 ? 'maña' : 'mañas');
    if (this.talentPointsEl && this.talentPointsEl.hidden !== (points <= 0)) this.talentPointsEl.hidden = points <= 0;

    // Envión
    if (this.boostEl) {
      const activo = interaction?.boostActive ?? false;
      this.boostEl.classList.toggle('active', activo);
      if (activo) this._setText(this.boostTimeEl, `${Math.ceil(interaction.boostTimer ?? 0)} s`);
    }

    // La tecla de contexto
    this._pintarPrompt(window.__game?.paused ? '' : textoDelPrompt(interaction, inventory), interaction);

    if (this._misionS > 0 && (this._misionS -= dt) <= 0 && this.misionEl) this.misionEl.hidden = true;

    // Lo demás se revisa a 10 Hz; movimiento, filas y tecla de contexto siguen cada cuadro.
    this._panelElapsed += dt;
    if (this._panelElapsed < 0.1) return;
    this._panelElapsed %= 0.1;

    this._pintarResumen(stats);
    this._pintarUrgente(stats);
    this._pintarBusqueda();
    this._pintarMision(inventory);
    this._pintarElegida(inventory);
    const carreta = !!window.__game?.cart?.isAttached;
    if (this.cartEl && this.cartEl.hidden === carreta) this.cartEl.hidden = !carreta;

    // Enfermedades y calor: líneas con su tiempo
    if (this.diseaseEl && diseaseSystem) {
      this._renderDiseases(diseaseSystem, stats);
    }

    // Actualizar paneles si están abiertos
    if (this._talentOpen) this.renderTalents(talentSystem);
    if (this._craftOpen && craftingSystem && inventory) {
      this.renderCrafting(craftingSystem, inventory, talentSystem);
    }
    if (this._dealerOpen) {
      this.renderDealer();
    }
  }

  /** Una fila: relleno, nivel y número. La página se toca solo si cambió lo que se ve. */
  _pintarFila(fill, valueEl, valor, tope, cifra, level) {
    this._setWidth(fill, Math.round(valor / tope * 100));
    this._setText(valueEl, cifra);
    const meter = fill.parentElement;
    if (!meter) return;
    const now = String(valor);
    if (meter.getAttribute?.('aria-valuenow') !== now) meter.setAttribute?.('aria-valuenow', now);
    const row = meter.parentElement;
    if (row && row.dataset.level !== level) row.dataset.level = level;
  }

  /** Lo que está mal y no se ve en ninguna fila queda dicho en el botón de estado. */
  _pintarResumen(stats) {
    const bajas = this._bajas(stats);
    const suben = this._subirNecesidades(bajas);
    if (!this.needsSummary) return;
    const ocultas = bajas.filter(({ id }) => !suben.includes(id));
    const nombres = ocultas.map(({ id }) => (id === 'calor' ? 'Calor' : NEED_META.find((n) => n.id === id).label)).join(', ');
    this._setText(this.needsSummary, nombres || 'Estado');
    const level = ocultas.some(({ v }) => v < NEED_CRITICAL) ? 'critical' : ocultas.length ? 'low' : 'ok';
    if (this.needsToggle.dataset.level !== level) this.needsToggle.dataset.level = level;
    const announcement = nombres ? `Estado: niveles bajos de ${nombres}. Ver todas las necesidades` : 'Ver estado y necesidades';
    if (this._needsAnnouncement !== announcement) {
      this._needsAnnouncement = announcement;
      this.needsToggle.setAttribute('aria-label', announcement);
    }
  }

  /** Un solo retazo, el más urgente. Las frases exactas siguen en #status, para el lector de pantalla. */
  _pintarUrgente(stats) {
    if (this.statusEl) {
      const warnings = [];
      if (stats.calor > 0) warnings.push(`🔥 Calientito (${Math.ceil(stats.calor)}s)`);
      else if (stats.isFreezing) warnings.push('🥶 Me estoy congelando: el frío y la lluvia me debilitan.');
      if (stats.sed <= 20) warnings.push(stats.sed <= 0 ? 'Sin agua: estoy perdiendo salud.' : 'Sed crítica: tengo que beber agua.');
      if (stats.hambre <= 20) warnings.push(stats.hambre <= 0 ? 'Sin alimento: estoy perdiendo salud.' : 'Hambre crítica: tengo que comer algo.');
      if (stats.energia <= 20) warnings.push('Energía baja: tengo que descansar.');
      if (stats.salud <= 30) warnings.push('Salud crítica: tengo que recuperarme.');
      this._setText(this.statusEl, warnings.join(' '));
      if (this.statusEl.hidden !== (warnings.length === 0)) this.statusEl.hidden = warnings.length === 0;
    }
    if (!this.retazoEl) return;
    const urgente = masUrgente(stats, this._retazoId);
    const id = urgente?.id ?? null;
    if (id === this._retazoId) return;
    this._retazoId = id;
    this.retazoEl.hidden = !urgente;
    this.retazoEl.dataset.urgencia = id ?? '';
    if (urgente) {
      this._setText(this.retazoGrito, urgente.grito);
      this._setText(this.retazoOrden, urgente.orden);
    }
    this.avisos?.acomodar();
  }

  /** Nada, fichado, patrulla detrás o patrulla encima. Con la placa arriba no hace falta ningún aviso. */
  _pintarBusqueda() {
    if (!this.wantedEl) return;
    const game = window.__game;
    const info = game?.traffic?.pursuitInfo ?? null;
    const nivel = game?.steal?.buscado ?? 0;
    const estado = estadoBusqueda(info ? info.distance : null, nivel, this._wantedEstado);
    if (estado !== this._wantedEstado) {
      this._wantedEstado = estado;
      this.wantedEl.hidden = estado === 'nada';
      this.wantedEl.className = estado === 'fichado' ? 'carton corte-d' : estado === 'encima' ? 'placa corte-c' : 'placa corte-b';
      this.wantedEl.dataset.estado = estado;
      document.getElementById('topbar')?.setAttribute('data-estado', estado);
      this._setText(this.wantedGrito, estado === 'fichado' ? 'Te tienen fichado' : estado === 'encima' ? '¡CÓRRALE!' : '¡PILAS!');
      this._setText(this.wantedVoz, { nada: '', fichado: 'Te tienen fichado', detras: '¡Pilas! Una patrulla viene detrás', encima: '¡Córrale! La patrulla está encima' }[estado]);
      this.avisos?.acomodar();
    }
    if (estado === 'fichado' && this.wantedRayas && this._wantedNivel !== nivel) {
      this._wantedNivel = nivel;
      this.wantedRayas.dataset.nivel = String(Math.min(3, nivel));
    }
    if (info) {
      const d = info.distance < 30 ? Math.round(info.distance) : Math.round(info.distance / 5) * 5;
      this._setText(this.wantedDato, `Patrulla a ${d} m`);
      if (this.wantedBarra) this._setWidth(this.wantedBarra, Math.round(info.closeness * 100));
    }
  }

  /** Lo que toca hacer con el cambuche, unos segundos cada vez que cambia. Nunca durante una persecución. */
  _pintarMision(inventory) {
    if (!this.misionEl) return;
    const game = window.__game;
    if (game?.traffic?.inPursuit) {
      if (!this.misionEl.hidden) this.misionEl.hidden = true;
      this._misionS = 0;
      return;
    }
    const texto = textoDeMision(game?.built, inventory);
    // Cada cartón baja la cuenta, pero no es una misión nueva: no vuelve a salir por eso.
    const clave = texto?.replace(/\d+ CART\S+/, 'CARTONES') ?? null;
    if (clave === this._misionTexto) return;
    this._misionTexto = clave;
    if (!texto) { this.misionEl.hidden = true; this._misionS = 0; return; }
    this._setText(this.misionEl, texto);
    this.misionEl.hidden = false;
    this._misionS = MISION_S;
  }

  /** En la barra rápida, el círculo va en el arma que tengo en la mano. */
  _pintarElegida(inventory) {
    const arma = window.__game?.player?.equippedWeapon;
    if (!inventory?.hotbar) return;
    this._casillas ??= document.querySelectorAll?.('#quickbar .qb-slot') ?? [];
    this._casillas.forEach?.((casilla, i) => casilla.classList.toggle('elegido', !!arma && inventory.hotbar[i] === arma));
  }

  /** La hora dice el clima con palabra; la temporada queda en el título. */
  _pintarClima(clock) {
    if (!this.weatherEl) return;
    const sky = this.weather?.type ? describeWeather(this.weather.type, clock.isNight) : null;
    const key = sky ? `${sky.label}|${this.weather.season?.id}` : '';
    if (this._weatherTitle === key) return;
    this._weatherTitle = key;
    this.weatherEl.hidden = !sky;
    if (!sky) return;
    const title = `${sky.label}, ${this.weather.season?.label ?? ''}`;
    this._setText(this.weatherWordEl, sky.label);
    this.weatherEl.title = title;
    this.weatherEl.setAttribute('aria-label', `Clima: ${title}`);
  }

  /** La plata se achica desde el millón con una clase: el cartón no crece ni se sale. */
  _pintarPlata(dinero) {
    if (dinero === this._dineroVisto) return;
    this._dineroVisto = dinero;
    this._setText(this.moneyEl, cop(dinero));
    this.moneyEl?.classList?.toggle('plata--larga', dinero >= PLATA_LARGA);
    this.moneyEl?.classList?.toggle('plata--larguisima', dinero >= PLATA_LARGUISIMA);
  }

  /** La tecla de contexto se reescribe solo si cambia el texto; mantener Q muestra su progreso de verdad. */
  _pintarPrompt(texto, interaction) {
    if (!this.promptEl) return;
    if (texto !== this._promptTexto) {
      this._promptTexto = texto;
      if (texto) {
        let principal = true;
        const piezas = piezasDelPrompt(texto);
        const html = (modoEntrada() === 'tactil' ? piezasParaElDedo(piezas) : piezas).map((p) => {
          const pieza = piezaHTML(p, principal && !!p.tecla);
          if (p.tecla) principal = false;
          return pieza;
        }).join('');
        this._setHTML(this.promptEl, html);
      }
      this.promptEl.classList.toggle('visible', !!texto);
      this._sostenerEl = texto ? this.promptEl.querySelector?.('.cx__sostener') ?? null : null;
      this._sostenerMasa = this._sostenerEl?.querySelector?.('.masa') ?? null;
    }
    if (!this._sostenerEl) return;
    const pickup = interaction?.isHoldingQ ? interaction.sortingPickup : null;
    const avance = pickup ? Math.round(Math.min(1, (pickup.sortProgress ?? 0) / SORT_BASE_TIME) * 100) : 0;
    if (avance !== this._sostenerVisto) {
      this._sostenerVisto = avance;
      this._setWidth(this._sostenerMasa, avance);
      this._sostenerEl.setAttribute('aria-valuenow', String(avance));
      this._sostenerEl.classList.toggle('activo', avance > 0);
    }
  }

  _setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  _setWidth(element, percent) {
    this._widthCache ??= new WeakMap();
    const width = `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
    if (this._widthCache.get(element) === width) return;
    this._widthCache.set(element, width);
    element.style.width = width;
  }

  /** Mantiene los nodos, el foco y sus listeners mientras el contenido no cambie. */
  _setHTML(element, html) {
    if (this._htmlCache.get(element) === html) return false;
    element.innerHTML = html;
    this._htmlCache.set(element, html);
    return true;
  }

  _useItem(itemId, inv) {
    const item = inv.items.find((x) => x.id === itemId);
    if (!item) return;
    const game = window.__game;
    if (!game) return;


    if (itemId === 'popo') {
      if (game.player?.isStunned) return;
      game.inventoryUI?.close();
      game.poopSystem?.throwPoop(game.player, game.cameraRig);
      return;
    }
    if (item.weapon) {
      if (!game.player || game.player.isStunned) return;
      const equipped = game.player.toggleWeapon(item.weapon);
      game.audio?.play('pickup');
      this._toast(equipped ? `Saqué: ${item.name}. Pego con clic o G.` : `Guardé: ${item.name}. Vuelvo a los puños.`, 'info');
      return;
    }
    if (itemId === 'radioTransistor') {
      game.inventoryUI?.close();
      window.dispatchEvent(new CustomEvent('open-radio-modal'));
      return;
    }
    if (itemId === 'pilas') {
      if (game.radio) {
        if (game.radio.battery >= 100) {
          this._toast('El radio ya tiene las pilas llenas', 'info');
        } else {
          inv.remove('pilas', 1);
          game.radio.battery = Math.min(100, game.radio.battery + 50);
          game.audio?.play('pickup');
          this._toast('Le puse pilas al radio (+50 %)', 'info');
        }
      }
      return;
    }

    const smokes = !!SMOKABLES[item.id];
    if (smokes && game.player?.smoking) {
      this._toast('Ya tengo uno prendido.', 'info');
      return;
    }
    // Si la pose no puede empezar (nado, caída o golpe), conserva objeto y necesidades.
    if (smokes && game.player?.startSmoking && !game.player.startSmoking(item.id)) {
      this._toast('Ahora no lo puedo prender.', 'info');
      return;
    }
    // el basuco se fuma en pipa: si está ocupado (pelea, otra acción) no se gasta
    const pipe = item.id === 'basuco';
    if (pipe && game.player?.startBasuco && !game.player.startBasuco()) {
      this._toast('Ahora no: tengo las manos ocupadas.', 'info');
      return;
    }
    if (item.consumable) {
      if (item.consumable === 'hambre' && game.stats.canEat?.() === false) {
        this._toast('No puedo comer con estas náuseas.', 'warning');
        return;
      }
      // Efecto principal (consumable + amount) y efectos extra por necesidad (p. ej. animo: 15, salud: -3)
      for (const k of NEEDS) {
        const delta = (k === item.consumable ? item.amount : 0) + (k !== item.consumable ? (item[k] ?? 0) : 0);
        if (delta) game.stats[k] = Math.max(0, Math.min(100, game.stats[k] + delta));
      }
      if (item.calor) {
        game.stats.calor = Math.min(300, (game.stats.calor || 0) + item.calor);
      }
      inv.remove(itemId, 1);
      // Lo que alimenta y además cura (la aguapanela con la gripe) también quita la enfermedad.
      const cured = !!item.cure && !!game.diseases?.cure?.(item.cure);
      game.audio?.play('pickup');
      const isDrink = item.consumable === 'sed' || item.id === 'cafe' || item.id === 'refresco' || item.id === 'aguapanela';
      const verb = isDrink ? 'Bebí' : item.substance ? 'Consumí' : item.consumable === 'salud' ? 'Me apliqué' : 'Comí';
      // el cigarrillo y el porro no se comen: se quedan en la mano y se fuman caminando
      if (!smokes && !pipe) game.player?.playAction?.(isDrink ? 'beber' : 'comer', 1.2);
      const lit = smokable(item.id);
      const curedText = cured ? `, me curé: ${diseaseName(item.cure)}` : '';
      this._toast(smokes ? `Prendí un ${lit.name}` : pipe ? 'Prendí la pipa' : `${verb}: ${item.name}${curedText}`, 'info');
      // lo que se fuma pega al aspirar: el jugador avisa en cada calada o al soltar la pipa
      const smokedLater = (smokes || pipe) && game.player?.startSmoking;
      if (item.substance && !smokedLater) window.dispatchEvent(new CustomEvent('substance-consumed', { detail: { id: itemId } }));
    } else if (item.cure) {
      // Sin la enfermedad, el remedio no se gasta.
      if (!game.diseases?.cure?.(item.cure)) {
        game.audio?.play('empty');
        this._toast(`No tengo ${diseaseName(item.cure).toLowerCase()}. Guardo el remedio para cuando lo necesite.`, 'info');
        return;
      }
      inv.remove(itemId, 1);
      game.audio?.play('pickup');
      this._toast(`Me curé: ${diseaseName(item.cure)} con ${item.name}`, 'info');
    }
  }

  _renderDiseases(diseaseSystem, stats = null) {
    // El calor se ve mientras dure: si su fila no subió, queda una línea con el tiempo que le queda.
    const calor = stats?.calor > 0 && this._rows.calor?.parentElement !== this.needsSubidas
      ? `<div class="disease-item disease-item--calor" title="Calientito"><span class="disease-item__dibujo" aria-hidden="true">${pasarTexto('🔥')}</span><span class="disease-item__nombre">Calientito</span><span class="disease-item__seg cifra">${calorALaVista(stats.calor)}</span></div>`
      : '';
    const lista = diseaseSystem.hasAny ? diseaseSystem.list.map((d) =>
      `<div class="disease-item" title="${escapar(d.name)}"><span class="disease-item__dibujo" aria-hidden="true">${pasarTexto(d.emoji ?? '')}</span><span class="disease-item__nombre">${escapar(d.name)}</span><span class="disease-item__seg cifra">${Math.ceil(d.timeLeft)} s</span></div>`
    ).join('') : '';
    this._setHTML(this.diseaseEl, calor + lista);
  }

  renderTalents(talentSystem) {
    if (!this.talentPanel) return;
    const ts = talentSystem || window.__game?.talents;
    if (!ts) return;

    const branchesHtml = BRANCHES.map((branch) => {
      const talents = Object.values(TALENTS).filter((t) => t.branch === branch.id);
      const nodes = talents.map((t) => {
        const unlocked = ts.has(t.id);
        const canUnlock = ts.canUnlock(t.id);
        const cls = unlocked ? 'unlocked' : (canUnlock ? 'available' : 'locked');
        const reqs = t.requires.length && !unlocked
          ? `<span class="reqs">Primero: ${t.requires.map((r) => TALENTS[r].name).join(', ')}</span>`
          : '';
        return `
          <button type="button" class="talent-node ${cls}" data-id="${t.id}"${canUnlock ? '' : ' aria-disabled="true"'}>
            <span class="talent-name${unlocked ? ' chulo' : ''}">${t.name}</span>
            <span class="talent-desc">${t.desc}</span>
            ${reqs}
            ${unlocked ? '' : `<span class="talent-cost">Vale ${t.cost}</span>`}
          </button>
        `;
      }).join('');

      return `
        <section class="talent-branch">
          <h3><span aria-hidden="true">${pasarTexto(branch.emoji)}</span> ${branch.name}</h3>
          ${nodes}
        </section>
      `;
    }).join('');

    if (!this._setHTML(this.talentPanel, `
      <header class="talent-header cabecera">
        <h2>Mañas</h2>
        <span class="talent-points-display">Por aprender: <b class="cifra">${ts.points}</b></span>
        ${cierreHTML('T', 'Cerrar mañas', 'talent-close')}
      </header>
      <div class="talent-branches">${branchesHtml}</div>
      <p class="talent-hint">Cada nivel me deja aprender algo más. Lo que está en cinta ya lo puedo aprender.</p>
    `)) return;

    this.talentPanel.querySelector?.('.talent-close')?.addEventListener('click', () => this.toggleTalentPanel());
    // Bind clicks
    this.talentPanel.querySelectorAll('.talent-node.available').forEach((node) => {
      node.addEventListener('click', () => {
        const id = node.dataset.id;
        if (ts.unlock(id)) {
          this.renderTalents(ts);
          this.talentPanel.querySelector?.(`.talent-node[data-id="${id}"]`)?.focus({ preventScroll: true });
          window.dispatchEvent(new CustomEvent('talent-unlock', {
            detail: { name: TALENTS[id].name }
          }));
        }
      });
    });
  }

  renderCrafting(craftingSystem, inventory, talentSystem) {
    if (!this.craftPanel) return;
    this._craftCtx = { craftingSystem, inventory, talentSystem };
    const recipes = craftingSystem.getAvailable(inventory);
    // La selección sobrevive a los redibujados; por defecto, la primera receta lista.
    if (!recipes.some((r) => r.id === this._craftSelected)) {
      this._craftSelected = (recipes.find((r) => r.craftable && r.fits !== false) ?? recipes[0])?.id ?? null;
    }

    // Una receta es una suma: lo que falta, tachado; lo que sale, subrayado.
    const slots = recipes.map((r) => {
      const ready = r.craftable && r.fits !== false;
      const heavy = r.craftable && !ready;
      const selected = r.id === this._craftSelected;
      const state = ready ? 'disponible' : heavy ? 'no cabe en el costal' : 'faltan materiales';
      const cls = ['item-slot', 'craft-recipe', ready && 'craftable', heavy && 'heavy', selected && 'selected']
        .filter(Boolean).join(' ');
      const partes = Object.entries(r.ingredients).map(([id, qty]) => `
        <span class="craft-parte${inventory.count(id) >= qty ? '' : ' tachado'}">${itemArtHTML(id, 'craft-parte-art')}${qty > 1 ? `${qty} ` : ''}${ITEMS[id]?.name ?? id}</span>`)
        .join('<span class="craft-oper" aria-hidden="true">+</span>');
      return `
        <button type="button" class="${cls}" data-id="${r.id}" aria-pressed="${selected}" aria-label="${r.name} ×${r.qty}: ${state}">
          ${partes}<span class="craft-oper" aria-hidden="true">=</span>
          <span class="craft-res${selected ? ' elegido' : ''}">${itemArtHTML(r.result, 'craft-slot-art')}<span class="craft-slot-name">${r.name}</span>${r.qty > 1 ? `<span class="craft-slot-qty">×${r.qty}</span>` : ''}</span>
          ${ready ? '<span class="craft-slot-flag chulo" aria-hidden="true"></span>' : ''}
          ${heavy ? '<span class="craft-slot-nota">No cabe en el costal</span>' : ''}
        </button>
      `;
    }).join('');

    this._setHTML(this.craftPanel, `
      <header class="craft-header cabecera">
        <h2>La mesa</h2>
        <span class="craft-load" title="Carga del costal">${kilos(inventory.totalWeight.toFixed(1))} de ${kilos(inventory.maxWeight)} kg</span>
        ${cierreHTML('C', 'Cerrar la mesa', 'craft-close', 'data-act="close"')}
      </header>
      <div class="craft-body">
        <div class="craft-recipes" aria-label="Recetas">${slots}</div>
        ${this._craftBench(recipes.find((r) => r.id === this._craftSelected), inventory)}
      </div>
      <p class="craft-hint">Lo tachado todavía no lo tengo.</p>
    `);
  }

  /** Lo que se está por fabricar: el resultado grande, los materiales y el verbo. */
  _craftBench(r, inventory) {
    if (!r) return '<section class="craft-bench"><p class="craft-reason">No hay recetas.</p></section>';
    const item = ITEMS[r.result];
    const ready = r.craftable && r.fits !== false;
    let missing = 0;
    const mats = Object.entries(r.ingredients).map(([id, qty]) => {
      const have = inventory.count(id);
      const ok = have >= qty;
      missing += Math.max(0, qty - have);
      return `
        <li class="craft-mat ${ok ? 'ok' : 'missing'}">
          ${itemArtHTML(id, 'craft-mat-art')}
          <span class="craft-mat-name${ok ? '' : ' tachado'}">${ITEMS[id]?.name ?? id}</span>
          <span class="craft-mat-count${ok ? ' chulo' : ''}">${Math.min(have, qty)} de ${qty}</span>
        </li>
      `;
    }).join('');
    const state = ready ? 'ready' : r.craftable ? 'heavy' : 'missing';
    const reason = ready ? 'Listo para fabricar'
      : r.craftable ? 'No me cabe en el costal'
      : missing === 1 ? 'Me falta 1 material' : `Me faltan ${missing} materiales`;

    return `
      <section class="craft-bench ${state}">
        <div class="craft-pedestal">
          ${itemArtHTML(r.result, 'craft-result-art')}
          ${r.qty > 1 ? `<span class="craft-yield cifra">×${r.qty}</span>` : ''}
        </div>
        <h3 class="craft-result-name">${r.name}</h3>
        <p class="craft-effect">${this._craftEffect(item)}</p>
        <ul class="craft-mats">${mats}</ul>
        <p class="craft-reason" role="status">${reason}</p>
        <button type="button" class="cinta cinta--verbo craft-go" data-act="craft" ${ready ? '' : 'disabled'}>Fabricar</button>
      </section>
    `;
  }

  /** Una línea con lo que hace el objeto, a partir de sus datos reales. */
  _craftEffect(item) {
    return itemEffectLine(item);
  }

  _onCraftClick(e) {
    const target = e.target.closest?.('[data-act], .craft-recipe');
    if (!target || !this._craftCtx) return;
    const { craftingSystem, inventory, talentSystem } = this._craftCtx;
    if (target.dataset.act === 'close') { this.toggleCraftPanel(); return; }

    if (target.dataset.act !== 'craft') {
      this._craftSelected = target.dataset.id;
      this.renderCrafting(craftingSystem, inventory, talentSystem);
      this.craftPanel.querySelector('.craft-recipe.selected')?.focus({ preventScroll: true });
      return;
    }

    const recipe = craftingSystem.recipes.find((r) => r.id === this._craftSelected);
    if (!recipe) return;
    const game = window.__game;
    const result = craftingSystem.craft(recipe, inventory);
    if (result) {
      game?.stats?.addXP(XP_CRAFT, game.talents);
      game?.audio?.play('treasure');
    } else {
      game?.audio?.play('full');
    }
    this.renderCrafting(craftingSystem, inventory, talentSystem);
    const bench = this.craftPanel.querySelector('.craft-bench');
    if (result && bench) {
      // Reinicia la animación aunque el HTML no haya cambiado.
      bench.classList.remove('just-crafted');
      void bench.offsetWidth;
      bench.classList.add('just-crafted');
    }
    (this.craftPanel.querySelector('.craft-go:not([disabled])') ?? this.craftPanel.querySelector('.craft-recipe.selected'))
      ?.focus({ preventScroll: true });
  }

  renderDealer(dealer = null) {
    if (!this.dealerPanel) return;
    const game = window.__game;
    const d = dealer || game?.dealer;
    const stats = game?.stats;
    const inv = game?.inventory;
    const products = d?.getProducts ? d.getProducts() : [];

    const itemsHtml = products.map((p) => {
      const price = dealerPrice(p);
      const canAfford = (stats?.dinero ?? 0) >= price;
      const weightOk = inv ? (inv.totalWeight + p.weight <= inv.maxWeight) : true;
      const canBuy = canAfford && weightOk;
      const effectDesc = p.id === 'tintico' ? `+${p.amount} vicio, +${p.animo} ánimo, +${p.energia} energía`
                       : `+${p.amount} vicio, +${p.animo} ánimo, ${conSigno(p.salud)} salud`;

      return `
        <div class="dealer-product" data-id="${p.id}">
          <div class="dealer-prod-info">
            <div class="dealer-prod-name">${p.name}</div>
            <div class="dealer-prod-desc">${effectDesc}, pesa ${kilos(p.weight)} kg${canBuy ? '' : `. ${canAfford ? 'No me cabe' : 'No me alcanza'}`}</div>
          </div>
          <div class="dealer-prod-action">
            <div class="dealer-prod-price">${cop(price)}</div>
            <button class="dealer-buy-btn" data-id="${p.id}" ${canBuy ? '' : 'disabled'}>
              Comprar
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Venta: de noche, una fila por sustancia del inventario; nada se vende sin pulsar su botón.
    const priceMult = game?.interaction?.substancePriceMult?.() ?? 1;
    const lots = (inv?.items ?? []).filter((entry) => ITEMS[entry.id]?.substance);
    const sellHtml = !game?.clock?.isNight
      ? '<div class="dealer-empty">De día no compra nada. Vuelva de noche.</div>'
      : !lots.length
        ? '<div class="dealer-empty">No llevo nada que venderle.</div>'
        : lots.map(({ id, qty }) => {
          const item = ITEMS[id];
          const offer = dealerOffer(item, priceMult);
          return `
            <div class="dealer-product" data-id="${id}">
              <div class="dealer-prod-info">
                <div class="dealer-prod-name">${item.name} ×${qty}</div>
                <div class="dealer-prod-desc">Paga ${cop(offer)} por unidad</div>
              </div>
              <div class="dealer-prod-action">
                <div class="dealer-prod-price">${cop(offer * qty)}</div>
                <button class="dealer-sell-btn" data-id="${id}">Vender</button>
              </div>
            </div>
          `;
        }).join('');

    if (!this._setHTML(this.dealerPanel, `
      <header class="dealer-header cabecera">
        <h2>El jíbaro</h2>
        <span class="dealer-money">Plata: ${cop(stats?.dinero)}</span>
        ${cierreHTML('Esc', 'Cerrar', 'dealer-close')}
      </header>
      <div class="dealer-section">Comprar</div>
      <div class="dealer-products">${itemsHtml}</div>
      <div class="dealer-section">Vender</div>
      <div class="dealer-products">${sellHtml}</div>
      <div class="dealer-hint">
        De noche paga ${dealerSellMult(priceMult)}× el valor de lo que se le traiga, pero en cada venta
        hay un ${porcentaje(SUBSTANCE_RISK_CHANCE * 100)} de que caiga la policía y se lleve la mercancía.
      </div>
    `)) return;

    this.dealerPanel.querySelector?.('.dealer-close')?.addEventListener('click', () => this.toggleDealerPanel());

    // El mando pulsa con click() (detail 0) y reescribir el panel le borra el foco: sigue en la misma fila o en la última
    // de esa lista. Si ahí no queda qué pulsar, espera en la fila o en el aviso, donde A no hace nada: insistir no compra
    // ni vende otra cosa, y la cruceta sigue desde ahí. Con el ratón no hay foco que Espacio pueda volver a pulsar.
    const keepFocus = (selector, index, e) => {
      if (e.detail) return;
      const rows = this.dealerPanel.querySelectorAll(selector);
      const next = rows[Math.min(index, rows.length - 1)];
      const target = !next ? this.dealerPanel.querySelector('.dealer-empty') : next.disabled ? next.closest('.dealer-product') : next;
      if (target && target !== next) {
        target.tabIndex = -1;
        // Solo mientras espera. Cambiar de ventana también le quita el foco, pero al volver debe seguir ahí.
        const leave = () => {
          if (!document.hasFocus()) return;
          target.removeAttribute('tabindex');
          target.removeEventListener('blur', leave);
        };
        target.addEventListener('blur', leave);
      }
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    };
    this.dealerPanel.querySelectorAll('.dealer-buy-btn').forEach((btn, index) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (window.__game?.interaction) {
          window.__game.interaction.buySubstanceFromDealer(id);
          this.renderDealer(d);
          keepFocus('.dealer-buy-btn', index, e);
        }
      });
    });
    this.dealerPanel.querySelectorAll('.dealer-sell-btn').forEach((btn, index) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.__game?.interaction) {
          window.__game.interaction.sellSubstancesToDealer(btn.dataset.id, window.__game.clock);
          this.renderDealer(d);
          keepFocus('.dealer-sell-btn', index, e);
        }
      });
    });
  }

  _avisar(text, type) {
    (this.avisos ??= new Avisos()).poner(text, type);
  }

  _toast(text, type = 'info') {
    this._avisar(text, type);
  }

  _onPickup({ added, rare, sorted }) {
    if (!added || added.length === 0) return;
    this._avisar(`+ ${added.join(', ')}`, rare ? 'rare' : 'info');
  }

  _onSell({ earned }) {
    this._avisar(`Vendí por ${cop(earned)}`, 'sell');
  }
}
