// src/ui/ParoAviso.js
// El cartel de arriba cuando arranca una protesta: una franja con la causa, aparte del aviso chiquito, que dura unos segundos.
const DURACION_MS = 6500;

export class ParoAviso {
  constructor({ doc = globalThis.document, win = globalThis.window } = {}) {
    this.el = doc.createElement('div');
    this.el.id = 'paro-aviso';
    this.el.setAttribute('role', 'alert');
    this.el.hidden = true;
    (doc.getElementById('app') ?? doc.body).append(this.el);
    this._timer = null;
    win.addEventListener('protest-alert', e => this.mostrar(e.detail.text));
  }

  mostrar(texto) {
    this.el.textContent = texto;
    this.el.hidden = false;
    this.el.style.animation = 'none';
    void this.el.offsetWidth;
    this.el.style.animation = '';
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.el.hidden = true; }, DURACION_MS);
  }
}
