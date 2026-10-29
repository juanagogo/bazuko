// src/ui/Menu.js
// Ventana modal genérica (tienda, recicladora, cambuche). Mientras está abierta el juego se pausa.
import { el } from './dom.js';
import { icon, setIcon } from './icons.js';

const $ = (id) => document.getElementById(id);

export class Menu {
  constructor() {
    this.root = $('menu');
    this.iconEl = $('menu-icon');
    this.titleEl = $('menu-title');
    this.subEl = $('menu-sub');
    this.bodyEl = $('menu-body');
    this.footEl = $('menu-foot');
    this._render = null;
    this._onClose = null;

    setIcon($('menu-close'), 'x');
    $('menu-close').addEventListener('click', () => this.dismiss());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.dismiss();
    });
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape') { e._panelHandled = true; this.dismiss(); }
    }, true);
  }

  get isOpen() { return !this.root.hidden; }

  /**
   * @param {{title: string, sub?: string, ic?: string, render: () => {body: Node, foot: Node[]}, onClose?: Function, dismissible?: boolean, wide?: boolean}} opts
   * `render` se vuelve a llamar con refresh() después de cada compra/venta. `wide` amplía la ventana (pausa con mapa).
   */
  open({ title, sub = '', ic = 'box', render, onClose = null, dismissible = true, wide = false }) {
    window.__game?.cameraRig?.releaseControls?.();
    this.root.querySelector('.sign--menu')?.classList.toggle('sign--wide', wide);
    this._dismissible = dismissible;
    $('menu-close').hidden = !dismissible;
    this._render = render;
    this._onClose = onClose;
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
    this.iconEl.replaceChildren(icon(ic, { size: 34 }));
    this.refresh();
    this.root.hidden = false;
    (dismissible ? $('menu-close') : this.footEl.querySelector('button'))?.focus({ preventScroll: true });
  }

  dismiss() {
    if (this._dismissible !== false) this.close();
  }

  refresh() {
    if (!this._render) return;
    const { body, foot = [] } = this._render();
    const scroll = this.bodyEl.scrollTop;
    this.bodyEl.replaceChildren(body);
    this.footEl.replaceChildren(...foot);
    this.bodyEl.scrollTop = scroll;
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this._render = null;
    const cb = this._onClose;
    this._onClose = null;
    cb?.();
  }
}

/** Fila estándar: icono · nombre/descr · cantidad · precio o botón */
export function rowEl({ ic, name, desc, qty, price, btn, cls = '' }) {
  return el('li', { class: `row ${cls}` },
    icon(ic, { size: 24 }),
    el('span', { class: 'row__name' }, name, desc ? el('span', { class: 'row__desc', text: desc }) : null),
    qty !== undefined ? el('span', { class: 'row__qty', text: qty }) : el('span'),
    price !== undefined ? el('span', { class: 'row__price', text: price }) : btn ?? el('span'),
  );
}
