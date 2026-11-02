import { LoadingArtwork } from './LoadingArtwork.js';
import { MARCA } from './marcaBazuko.js';
import artworkIds from './loading-artwork.json' with { type: 'json' };

const TOTAL = 5; // etapas de Game.start
const ARRANQUE = .05; // nunca se ve el cartón sin nada escrito

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

/** Cuánto de cada trazo va escrito, en orden y según su largo. El trazo en curso es uno solo. */
export function escritura(avance, largos) {
  const total = largos.reduce((s, l) => s + l, 0);
  let falta = Math.min(1, Math.max(0, avance)) * total;
  return largos.map(l => {
    const t = Math.min(1, falta / l);
    falta = Math.max(0, falta - l);
    return t;
  });
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
    this.artwork = new LoadingArtwork(this.root, artworkIds);
    this.artwork.start();
    document.getElementById('loading-retry').onclick = () => location.reload();
  }

  /** Solo escribe en la página lo que cambió. */
  _write() {
    const avance = ARRANQUE + (1 - ARRANQUE) * this.value / TOTAL;
    escritura(avance, this.largos).forEach((t, i) => {
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
    this.root.hidden = false;
    this.artwork.start();
    this.update(text, progress);
    await paintLoadingFrame();
  }

  forCreator() { this.root.hidden = true; this.artwork.stop(); }

  finish() {
    this.artwork.stop({ remove: true });
    this.root.hidden = true;
    document.body.classList.remove('is-loading');
  }

  error(error) {
    this.failed = true;
    this.root.classList.add('has-loading-error');
    this.artwork.stop();
    console.error('[Inicio]', error);
    this.root.hidden = false;
    this.status.textContent = 'No se pudo cargar. Revise la conexión y vuelva a intentar.';
    this.progress.removeAttribute('aria-valuetext');
    document.getElementById('loading-retry').hidden = false;
  }
}
