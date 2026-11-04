// src/ui/Momentos.js
// Los momentos que no pausan o que apenas duran: TE CASCARON, CERRADO y el consejo que llega al anochecer. Las pantallas
// de muerte, en cartón quieto o en recorte, se arman aquí y las abre el juego.
import { el } from './dom.js';
import { cargarImprenta } from './PrimeraPlana.js';
import { CONSECUENCIAS, CONSEJO_CAMIONETA, letreroDeDormir } from './momentosTextos.js';

const NOQUEADO_S = .35;    // un tambaleo de un golpe dura .3 s y no es estar en el suelo
const CASCADO_MIN_S = 1.4; // lo mínimo para alcanzar a leerlo
const CERRADO_COLA_MS = 500; // CERRADO se queda un momentico después de despertar

/** Lo perdido, tachado. */
function listaPerdida({ cosas, resto }) {
  if (!cosas.length) return null;
  return el('p', { class: 'momento__perdido' },
    el('span', { text: 'Se pierde ' }),
    cosas.map((c) => el('span', { class: 'tachado', text: c })),
    resto ? el('span', { text: `y ${resto} más` }) : null);
}

/** Cartón quieto: título en marcador (el de `#menu-title`), lo perdido y un consejo corto. */
export function cuerpoDeMuerte({ perdido, consejo }) {
  return el('div', { class: 'momento' },
    listaPerdida(perdido),
    el('p', { class: 'momento__consecuencias', text: CONSECUENCIAS }),
    consejo ? el('p', { class: 'momento__consejo', text: consejo }) : null);
}

/** El recorte, derecho, en cartón vacío. Sin nada alrededor. */
export function cuerpoDeRecorte(texto) {
  return el('div', { class: 'recorte-sitio' }, el('article', { class: 'recorte' }, el('p', { text: texto })));
}

/** El botón de volver: en la muerte no hay cinta. */
export const botonDeMuerte = (onclick) => el('button', { type: 'button', class: 'momento__boton', onclick }, 'Volver al cambuche');

/** Lo que dice el cartón según qué lo dejó tirado: un carro no casca a nadie. */
export const tituloDeTirado = (causa) => (causa === 'carro' ? 'Me llevó un carro' : 'TE CASCARON');

export class Momentos {
  constructor() {
    const doc = globalThis.document;
    this.cascadoEl = doc?.getElementById?.('cascado') ?? null;
    this.cerradoEl = doc?.getElementById?.('cerrado') ?? null;
    this.cerradoHoraEl = doc?.getElementById?.('cerrado-hora') ?? null;
    this._aturdido = 0;
    this._cascadoS = 0;
    this._cascado = false;
    this._consejo = false;
    this._eraDeNoche = null;
    this._relojCerrado = 0;
    cargarImprenta();
    globalThis.addEventListener?.('sleep-start', (e) => this.abrirCerrado(e.detail?.despierta));
    globalThis.addEventListener?.('sleep-end', () => this.cerrarCerrado());
  }

  /** Un cuadro de simulación. Solo escribe en la página cuando algo cambia. */
  update(dt, player, stats, clock) {
    this._actualizarCascado(dt, player, stats);
    const deNoche = !!clock?.isNight;
    if (this._consejo && deNoche && this._eraDeNoche === false) {
      this._consejo = false;
      globalThis.dispatchEvent?.(new CustomEvent('toast', { detail: { text: CONSEJO_CAMIONETA, type: 'warn' } }));
    }
    this._eraDeNoche = deNoche;
  }

  _actualizarCascado(dt, player, stats) {
    // Una caída mortal no lleva «Ya me levanto»: la pantalla que sigue es la de la muerte.
    const noqueado = !!player?.isStunned && (stats?.salud ?? 1) > 0;
    this._aturdido = noqueado ? this._aturdido + dt : 0;
    if (!this._cascado) {
      if (this._aturdido >= NOQUEADO_S) this._ponerCascado(true, player?.tiradoPor);
      return;
    }
    this._cascadoS -= dt;
    if ((stats?.salud ?? 1) <= 0 || (!noqueado && this._cascadoS <= 0)) this._ponerCascado(false);
  }

  _ponerCascado(si, causa) {
    this._cascado = si;
    this._cascadoS = si ? CASCADO_MIN_S : 0;
    if (!this.cascadoEl) return;
    if (si) {
      const titulo = this.cascadoEl.querySelector?.('strong');
      if (titulo) titulo.textContent = tituloDeTirado(causa);
      this.cascadoEl.classList?.toggle('cascado--carro', causa === 'carro');
    }
    this.cascadoEl.hidden = !si;
    // En el celular va justo debajo del HUD, donde está la misión: arriba taparía las cifras.
    const dock = si ? globalThis.document?.getElementById?.('hud-dock')?.getBoundingClientRect?.() : null;
    if (dock) this.cascadoEl.style.setProperty('--bajo-el-hud', `${Math.round(dock.bottom)}px`);
  }

  abrirCerrado(despierta) {
    if (!this.cerradoEl) return;
    clearTimeout(this._relojCerrado);
    const { arriba, abajo } = letreroDeDormir(despierta ?? 6);
    this.cerradoEl.querySelector?.('.cerrado__arriba')?.replaceChildren(arriba);
    this.cerradoHoraEl?.replaceChildren(abajo);
    this.cerradoEl.hidden = false;
  }

  cerrarCerrado() {
    if (!this.cerradoEl) return;
    clearTimeout(this._relojCerrado);
    this._relojCerrado = setTimeout(() => { this.cerradoEl.hidden = true; }, CERRADO_COLA_MS);
  }

  /** Después de una muerte por limpieza social: el consejo se dice al caer la noche siguiente, y una sola vez. */
  guardarConsejoDeCamioneta() {
    this._consejo = true;
    this._eraDeNoche = null;
  }

  /** Recuperarse o caer preso: nada de lo que estaba en pantalla sigue. */
  reset() {
    this._aturdido = 0;
    if (this._cascado) this._ponerCascado(false);
  }
}
