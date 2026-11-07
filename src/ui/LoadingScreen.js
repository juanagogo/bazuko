import { LoadingArtwork } from './LoadingArtwork.js';
import { MARCA } from './marcaBazuko.js';
import { escritura } from './escritura.js';
import artworkIds from './loading-artwork.json' with { type: 'json' };

const TOTAL = 5; // etapas de Game.start
const ARRANQUE = .05; // nunca se ve el cartón sin nada escrito
const CIERRE_MS = 700; // lo que tarda en terminar de escribirse antes del creador
const PALABRA_ENTERA_MS = 450; // la palabra completa, quieta, antes de pasar al creador

export const paintLoadingFrame = () => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
});

/** La palabra entera y quieta, para donde ya no se está escribiendo. */
export const marcaQuieta = () => `<svg viewBox="0 ${MARCA.arriba} ${MARCA.ancho} ${MARCA.alto}" aria-hidden="true"><path fill="currentColor" d="${MARCA.trazos.map(t => t.tinta).join('')}"/></svg>`;

/** La palabra por escribir: cada trazo es su lomo, muy grueso, recortado por la tinta que deja la punta. */
export const marcaPorEscribir = () => `<svg viewBox="0 ${MARCA.arriba} ${MARCA.ancho} ${MARCA.alto}" aria-hidden="true"><defs>${
  MARCA.trazos.map((t, i) => `<clipPath id="carga-trazo-${i}"><path d="${t.tinta}"/></clipPath>`).join('')
}</defs>${
  MARCA.trazos.map((t, i) => `<g clip-path="url(#carga-trazo-${i})"><path class="carga__lomo" d="${t.lomo}" pathLength="1" stroke-dasharray="0 2" visibility="hidden"/></g>`).join('')
}</svg>`;

export { escritura };

/**
 * BAZUKO dibujado en un worker sobre un lienzo propio: sigue moviéndose aunque el hilo principal esté
 * ocupado construyendo la ciudad. El SVG queda debajo, invisible, con su progreso accesible.
 * Sin OffscreenCanvas o sin workers de módulo devuelve null y se ve el SVG como antes.
 */
function marcaFluida(contenedor, avance) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined'
    || !HTMLCanvasElement.prototype.transferControlToOffscreen) return null;
  try {
    const lienzo = document.createElement('canvas');
    lienzo.className = 'carga__lienzo';
    lienzo.setAttribute('aria-hidden', 'true');
    contenedor.append(lienzo);
    const medida = () => {
      const ancho = Math.max(1, Math.round(contenedor.getBoundingClientRect().width * (globalThis.devicePixelRatio || 1)));
      return { ancho, alto: Math.max(1, Math.round(ancho * MARCA.alto / MARCA.ancho)) };
    };
    const worker = new Worker(new URL('./marcaWorker.js', import.meta.url), { type: 'module' });
    const offscreen = lienzo.transferControlToOffscreen();
    const reducido = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    worker.postMessage({ tipo: 'iniciar', canvas: offscreen, marca: MARCA, color: getComputedStyle(contenedor).color,
      avance, reducido, ...medida() }, [offscreen]);
    // Si el worker no arranca, vuelve el SVG.
    worker.onerror = () => { contenedor.classList.remove('carga__marca--fluida'); lienzo.remove(); worker.terminate(); };
    const vigia = new ResizeObserver(() => worker.postMessage({ tipo: 'tamano', ...medida() }));
    vigia.observe(contenedor);
    contenedor.classList.add('carga__marca--fluida');
    return {
      avance: a => worker.postMessage({ tipo: 'avance', avance: a }),
      /** Termina de escribir la palabra; la promesa se cumple al llegar a la última letra. */
      completar: duracion => new Promise(resolve => {
        const listo = ({ data }) => { if (data?.tipo === 'completo') { worker.removeEventListener('message', listo); resolve(); } };
        worker.addEventListener('message', listo);
        worker.postMessage({ tipo: 'completar', duracion });
        // Solo si el worker no contesta, para que el creador no se quede tapado. Con holgura: el aviso de
        // «completo» llega cuando el hilo principal se desocupa, que con el creador cargando tarda.
        setTimeout(resolve, duracion + 3000);
      }),
      pausa: () => worker.postMessage({ tipo: 'pausa' }),
      seguir: () => worker.postMessage({ tipo: 'seguir' }),
      cerrar: () => { vigia.disconnect(); worker.terminate(); }
    };
  } catch {
    contenedor.classList.remove('carga__marca--fluida');
    contenedor.querySelector('.carga__lienzo')?.remove();
    return null;
  }
}

export class LoadingScreen {
  constructor() {
    this.root = document.getElementById('loading-screen');
    this.status = document.getElementById('loading-status');
    this.progress = document.getElementById('loading-progress');
    this.value = 0;
    this.progress.innerHTML = marcaPorEscribir();
    this.lomos = [...this.progress.querySelectorAll('.carga__lomo')];
    this.escrito = this.lomos.map(() => 0);
    this.largos = MARCA.trazos.map(t => t.largo);
    this._write();
    this.fluida = marcaFluida(this.progress, this._avance());
    this.artwork = new LoadingArtwork(this.root, artworkIds);
    this.artwork.start();
    document.getElementById('loading-retry').onclick = () => location.reload();
  }

  /** Solo escribe en la página lo que cambió. */
  _avance(value = this.value) { return ARRANQUE + (1 - ARRANQUE) * Math.min(TOTAL, value) / TOTAL; }

  _write() {
    const avance = this._avance();
    // El worker escribe a su paso; la carga real le pone el tope y lo apura si va por delante.
    this.fluida?.avance(avance);
    // Ya escrita entera antes del creador, la palabra no vuelve atrás al reaparecer la carga.
    escritura(this.completa ? 1 : avance, this.largos).forEach((t, i) => {
      if (t === this.escrito[i]) return;
      this.escrito[i] = t;
      const lomo = this.lomos[i];
      lomo.setAttribute('stroke-dasharray', `${t.toFixed(4)} 2`);
      lomo.setAttribute('visibility', t > 0 ? 'visible' : 'hidden');
    });
    this.progress.setAttribute('aria-valuenow', String(Math.round(this.value / TOTAL * 100)));
  }

  /** En pantalla siempre dice lo mismo; el detalle de la etapa queda para quien usa lector de pantalla. */
  update(text, progress) {
    if (this.failed) return;
    this.progress.setAttribute('aria-valuetext', text);
    this.value = Math.max(this.value, Math.min(TOTAL, progress));
    this._write();
  }

  async stage(text, progress) {
    if (this.failed) return;
    this._turnoCreador = null;
    this.root.hidden = false;
    this.fluida?.seguir();
    this.artwork.start();
    this.update(text, progress);
    await paintLoadingFrame();
  }

  /**
   * BAZUKO termina de escribirse de un trazo y se queda entero un momento: si se quitara la carga en el
   * cuadro en que se cierra la O, no se vería. Se pide una vez; las siguientes devuelven la misma espera.
   * El progreso accesible no cambia: sigue siendo el real.
   */
  completar() {
    if (this._completar) return this._completar;
    this.completa = true;
    const reducido = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const duracion = reducido ? 0 : CIERRE_MS;
    const espera = ms => new Promise(resolve => setTimeout(resolve, ms));
    let escrita;
    if (this.fluida) escrita = this.fluida.completar(duracion);
    else { this._write(); escrita = espera(duracion); }
    return this._completar = escrita.then(() => {
      // Con la palabra entera, «Un momentico» tiembla (entrada.css).
      if (!this.failed) this.root.classList.add('carga--escrita');
      return espera(PALABRA_ENTERA_MS);
    });
  }

  /** El creador ya está listo debajo: la carga se quita con la palabra entera, nunca a medias. */
  forCreator() {
    const turno = this._turnoCreador = {};
    this.completar().then(() => {
      if (this._turnoCreador !== turno) return; // la carga volvió a mostrarse mientras tanto
      this.root.hidden = true; this.fluida?.pausa(); this.artwork.stop();
    });
  }

  finish() {
    this.fluida?.cerrar();
    this.fluida = null;
    this.artwork.stop({ remove: true });
    this.root.hidden = true;
    document.body.classList.remove('is-loading');
  }

  error(error) {
    this.failed = true;
    this.fluida?.pausa();
    this.root.classList.remove('carga--escrita');
    this.root.classList.add('has-loading-error');
    this.artwork.stop();
    console.error('[Inicio]', error);
    this.root.hidden = false;
    this.status.textContent = 'No se pudo cargar. Revise la conexión y vuelva a intentar.';
    this.progress.removeAttribute('aria-valuetext');
    document.getElementById('loading-retry').hidden = false;
  }
}
