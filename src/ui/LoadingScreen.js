import { LoadingArtwork } from './LoadingArtwork.js';
import artworkIds from './loading-artwork.json' with { type: 'json' };

export const paintLoadingFrame = () => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
});

export class LoadingScreen {
  constructor() {
    this.root = document.getElementById('loading-screen');
    this.artwork = new LoadingArtwork(this.root, artworkIds);
    this.artwork.start();
    this.status = document.getElementById('loading-status');
    this.progress = document.getElementById('loading-progress');
    this.percent = document.getElementById('loading-percent');
    this.steps = [...this.root.querySelectorAll('[data-loading-step]')];
    document.getElementById('loading-retry').onclick = () => location.reload();
  }

  update(text, progress) {
    if (this.failed) return;
    this.status.textContent = text;
    this.progress.value = Math.max(this.progress.value, Math.min(this.progress.max, progress));
    this.percent.textContent = `${Math.round(this.progress.value / this.progress.max * 100)} %`;
    const step = this.progress.value < 2 ? 0 : this.progress.value < 4 ? 1 : 2;
    this.steps.forEach((item, index) => {
      item.classList.toggle('is-complete', index < step || this.progress.value === this.progress.max);
      if (index === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
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
    this.status.textContent = 'No se pudo completar la carga. Revisa la conexión y vuelve a intentarlo.';
    this.progress.hidden = true;
    document.getElementById('loading-retry').hidden = false;
  }
}
