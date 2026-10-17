// src/ui/Splash.js
// Control del splash (HTML/CSS inline en index.html). La barra solo avanza (nunca retrocede)
// y se acerca al objetivo con suavizado; finish() hace fade-out y retira el nodo del DOM.
export class Splash {
  constructor() {
    this.el = document.getElementById('splash');
    this.fill = document.getElementById('splash-fill');
    this.pct = document.getElementById('splash-pct');
    this.text = document.getElementById('splash-text');
    this.err = document.getElementById('splash-error');
    this.target = 0;
    this.shown = 0;
    this._raf = 0;
    this._last = 0;
    this._failed = false;
    this._tick = this._tick.bind(this);
    if (this.el) this._raf = requestAnimationFrame(this._tick);
  }

  /** p en 0..1; ignora valores menores al actual. */
  set(p, label) {
    this.target = Math.max(this.target, Math.min(1, p));
    if (label && this.text && !this._failed) this.text.textContent = label;
  }

  _tick(now) {
    const dt = Math.min(0.1, (now - (this._last || now)) / 1000);
    this._last = now;
    if (this.shown < this.target) {
      // Aproximación exponencial con velocidad mínima para que siempre termine
      const step = Math.max((this.target - this.shown) * (1 - Math.exp(-dt * 6)), dt * 0.05);
      this.shown = Math.min(this.target, this.shown + step);
    }
    const v = Math.round(this.shown * 100);
    if (this.fill) this.fill.style.width = v + '%';
    if (this.pct) this.pct.textContent = v + '%';
    this._raf = requestAnimationFrame(this._tick);
  }

  /** Espera a que la barra alcance el objetivo (máx. ms). */
  settled(ms = 800) {
    return new Promise((res) => {
      const t0 = performance.now();
      const chk = () => (this.shown >= this.target - 0.002 || performance.now() - t0 > ms
        ? res() : requestAnimationFrame(chk));
      chk();
    });
  }

  /** Llega a 100 %, fade-out y retirada del DOM. */
  async finish() {
    this.set(1, 'Listo');
    await this.settled();
    this.close();
  }

  close() {
    const el = this.el;
    if (!el) return;
    this.el = null;
    el.classList.add('hide');
    const done = () => { cancelAnimationFrame(this._raf); el.remove(); };
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 900); // respaldo si no hay transitionend
  }

  /** Muestra el error sin dejar el splash trabado: permite continuar. */
  error(msg) {
    this._failed = true;
    if (!this.err) return;
    this.err.textContent = `Error al cargar: ${msg}`;
    const b = document.createElement('button');
    b.textContent = 'Continuar';
    b.onclick = () => this.close();
    this.err.append(b);
    this.err.style.display = 'block';
    if (this.text) this.text.textContent = 'Error';
  }
}
