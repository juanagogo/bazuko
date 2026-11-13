import { LoadingArtwork } from './LoadingArtwork.js';
import { MARCA } from './marcaBazuko.js';
import { ARRANQUE, DURACION, GROSOR, avanceDeTiempo, escritura } from './cargaEscritura.js';
import artworkIds from './loading-artwork.json' with { type: 'json' };

export const paintLoadingFrame = () => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
});

/** La palabra entera y quieta, para donde ya no se está escribiendo. */
export const marcaQuieta = () => `<svg viewBox="0 ${MARCA.arriba} ${MARCA.ancho} ${MARCA.alto}" aria-hidden="true"><path fill="currentColor" d="${MARCA.trazos.map(t => t.tinta).join('')}"/></svg>`;

/** La palabra por escribir: cada trazo es su lomo, muy grueso, recortado por la tinta que deja la punta. */
export const marcaPorEscribir = () => `<svg viewBox="0 ${MARCA.arriba} ${MARCA.ancho} ${MARCA.alto}" aria-hidden="true"><defs>${
  MARCA.trazos.map((t, i) => `<clipPath id="carga-trazo-${i}"><path d="${t.tinta}"/></clipPath>`).join('')
}</defs>${
  MARCA.trazos.map((t, i) => `<g clip-path="url(#carga-trazo-${i})"><path class="carga__lomo" d="${t.lomo}" pathLength="1" stroke-width="${GROSOR}" stroke-dasharray="0 2" visibility="hidden"/></g>`).join('')
}</svg>`;

/** El dibujo fuera del hilo principal solo existe si el navegador trae módulos y lienzo transferible. */
export const soportaOffscreen = (scope = globalThis) => typeof scope.Worker === 'function'
  && typeof scope.OffscreenCanvas === 'function'
  && typeof scope.HTMLCanvasElement?.prototype?.transferControlToOffscreen === 'function';

export class LoadingScreen {
  constructor() {
    this.root = document.getElementById('loading-screen');
    this.status = document.getElementById('loading-status');
    this.progress = document.getElementById('loading-progress');
    this.largos = MARCA.trazos.map(t => t.largo);
    // Quien pide menos movimiento ve la palabra entera desde el principio.
    this.reducido = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    this.completo = false;
    // El reloj de la mano es el del mundo (Date.now), el mismo en la página y en el trabajador: así el
    // relevo no salta por detrás aunque el trabajador tarde en cargar sus módulos.
    this.arranque = Date.now();
    this.espera = new Promise(resolve => { this._listo = resolve; });
    this.onResize = () => this._ajustar();
    // La palabra está desde el primer cuadro; el lienzo del trabajador la releva apenas dibuja.
    this._empezarSvg();
    if (soportaOffscreen()) this._empezarTrabajador();
    this.artwork = new LoadingArtwork(this.root, artworkIds);
    this.artwork.start();
    document.getElementById('loading-retry').onclick = () => location.reload();
  }

  /** El lienzo lo dibuja un trabajador: la página puede quedarse trabada sin que la mano se detenga. */
  _empezarTrabajador() {
    const lienzo = document.createElement('canvas');
    lienzo.className = 'carga__lienzo';
    lienzo.setAttribute('aria-hidden', 'true');
    lienzo.hidden = true;
    this.progress.append(lienzo);
    this.lienzo = lienzo;
    this.tamano = this._medir();
    lienzo.width = this.tamano.ancho;
    lienzo.height = this.tamano.alto;
    let fuera;
    try {
      this.trabajador = new Worker(new URL('./cargaWorker.js', import.meta.url), { type: 'module' });
      fuera = lienzo.transferControlToOffscreen();
    } catch { return; }
    this.trabajador.onerror = () => { this.trabajador?.terminate(); this.trabajador = null; };
    this.trabajador.onmessage = ({ data }) => {
      if (data.tipo === 'completo') return this._completo();
      if (data.tipo !== 'avance') return;
      if (!this.enLienzo) this._pasarAlLienzo();
      this._avance(data.avance);
    };
    this.trabajador.postMessage({
      tipo: 'inicio', lienzo: fuera, escala: this.tamano.escala,
      arranque: this.arranque, reducido: this.reducido, color: getComputedStyle(this.progress).color
    }, [fuera]);
    globalThis.addEventListener?.('resize', this.onResize);
  }

  /** El trabajador ya dibuja: se lleva el SVG y desde ahí la mano es suya, sin perder lo escrito. */
  _pasarAlLienzo() {
    this.enLienzo = true;
    cancelAnimationFrame(this.pedir);
    this.progress.replaceChildren(this.lienzo);
    this.lienzo.hidden = false;
  }

  /** El respaldo de siempre: la palabra en SVG, ahora también por reloj. Es con lo que se abre la pantalla. */
  _empezarSvg() {
    this.progress.innerHTML = marcaPorEscribir();
    this.lomos = [...this.progress.querySelectorAll('.carga__lomo')];
    this.escritos = this.lomos.map(() => 0);
    const cuadro = (ts) => {
      if (this.cerrando || this.enLienzo) return;
      const p = this.reducido ? 1 : avanceDeTiempo(Date.now() - this.arranque);
      this._pintar(p);
      this._avance(p);
      if (p < 1) this.pedir = requestAnimationFrame(cuadro); else this._completo();
    };
    this.pedir = requestAnimationFrame(cuadro);
  }

  /** Solo escribe en la página lo que cambió. */
  _pintar(p) {
    escritura(ARRANQUE + (1 - ARRANQUE) * p, this.largos).forEach((t, i) => {
      if (t === this.escritos[i]) return;
      this.escritos[i] = t;
      const lomo = this.lomos[i];
      lomo.setAttribute('stroke-dasharray', `${t.toFixed(4)} 2`);
      lomo.setAttribute('visibility', t > 0 ? 'visible' : 'hidden');
    });
  }

  _medir() {
    const ancho = Math.max(1, this.progress.clientWidth || 300);
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const escala = ancho * dpr / MARCA.ancho;
    return { ancho: Math.round(ancho * dpr), alto: Math.round(MARCA.alto * escala), escala };
  }

  _ajustar() {
    if (!this.trabajador || this.root.hidden) return;
    const medida = this._medir();
    if (medida.ancho === this.tamano.ancho && medida.alto === this.tamano.alto) return;
    this.tamano = medida;
    this.trabajador.postMessage({ tipo: 'tamano', ancho: medida.ancho, alto: medida.alto, escala: medida.escala });
  }

  /** El avance que anuncia el lector de pantalla es el de la tinta sobre el cartón. */
  _avance(p) {
    const tinta = Math.round((ARRANQUE + (1 - ARRANQUE) * p) * 100);
    if (this.porcentaje === tinta) return;
    this.porcentaje = tinta;
    this.progress.setAttribute('aria-valuenow', String(tinta));
  }

  _completo() {
    if (this.completo) return;
    this.completo = true;
    this._avance(1);
    this._listo();
  }

  /** En pantalla siempre dice lo mismo; el detalle de la etapa queda para quien usa lector de pantalla. */
  update(text) {
    if (this.failed) return;
    this.progress.setAttribute('aria-valuetext', text);
  }

  async stage(text) {
    if (this.failed) return;
    this.root.hidden = false;
    this.artwork.start();
    this.update(text);
    this._ajustar();
    await paintLoadingFrame();
  }

  forCreator() { this.root.hidden = true; this.artwork.stop(); }

  /** Si la carga se adelanta a la mano, se le da lo justo para terminar antes de irse. */
  async finish() {
    this.artwork.stop({ remove: true });
    globalThis.removeEventListener?.('resize', this.onResize);
    // Tras la pantalla la mano no puede seguir corriendo: o acaba en el lienzo o se acaba aquí.
    cancelAnimationFrame(this.pedir);
    this.cerrando = true;
    if (!this.enLienzo && !this.completo) { this._pintar(1); this._completo(); }
    if (this.trabajador) {
      if (!this.completo) {
        this.trabajador.postMessage({ tipo: 'terminar' });
        await Promise.race([this.espera, new Promise(resolve => setTimeout(resolve, 700))]);
      }
      this.trabajador.terminate();
      this.trabajador = null;
    }
    if (!this.completo) this._completo();
    this.lienzo?.remove();
    this.lienzo = null;
    this.root.hidden = true;
    document.body.classList.remove('is-loading');
  }

  error(error) {
    this.failed = true;
    this.cerrando = true;
    globalThis.removeEventListener?.('resize', this.onResize);
    cancelAnimationFrame(this.pedir);
    this.trabajador?.terminate();
    this.trabajador = null;
    this.lienzo?.remove();
    this.lienzo = null;
    this.root.classList.add('has-loading-error');
    this.artwork.stop();
    console.error('[Inicio]', error);
    this.root.hidden = false;
    this.status.textContent = 'No se pudo cargar. Revise la conexión y vuelva a intentar.';
    this.progress.removeAttribute('aria-valuetext');
    document.getElementById('loading-retry').hidden = false;
  }
}
