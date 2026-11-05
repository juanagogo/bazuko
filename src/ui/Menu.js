// src/ui/Menu.js
// Ventana modal genérica (tienda, recicladora, cambuche). Mientras está abierta el juego se pausa.
import { el, tabDaLaVuelta } from './dom.js';
import { icon } from './icons.js';
import { cierreAdentro } from './cierre.js';

const $ = (id) => document.getElementById(id);

export class Menu {
  constructor() {
    this.root = $('menu');
    this.iconEl = $('menu-icon');
    this.titleEl = $('menu-title');
    this.subEl = $('menu-sub');
    this.bodyEl = $('menu-body');
    this.footEl = $('menu-foot');
    this.tabsEl = $('menu-tabs');
    this._render = null;
    this._onClose = null;

    // Lo que cada ventana dice arriba de sí misma, al lado del título: la plata, la carga.
    this.datoEl = $('menu-dato');
    this._pintarCierre('Esc');
    $('menu-close').addEventListener('click', () => this.dismiss());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.dismiss();
    });
    // Input cancela Espacio en `window` por el salto; sin esto, Espacio no pulsa los botones del menú.
    this.root.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.closest?.('button')) e.stopPropagation();
    });
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape') { e._panelHandled = true; this.dismiss(); }
      // Un momento tiene un solo botón: el foco no se sale de él.
      if (this.isOpen && this._momento && e.code === 'Tab') { e.preventDefault(); this.footEl.querySelector('button')?.focus({ preventScroll: true }); }
      else if (this.isOpen && e.code === 'Tab') tabDaLaVuelta(e, this.root);
    }, true);
  }

  get isOpen() { return !this.root.hidden; }
  /** La plana, el recorte y la pausa ocupan toda la pantalla: detrás no se ve nada y no se dibuja nada. */
  get opaco() { return this.isOpen && (this._ancho || this._momento === 'plana' || this._momento === 'recorte'); }

  /**
   * @param {{title: string, sub?: string, ic?: string, render: () => {body: Node, foot: Node[]}, onClose?: Function, dismissible?: boolean, wide?: boolean}} opts
   * `render` se vuelve a llamar con refresh() después de cada compra/venta y puede traer `tabs`, las solapas de arriba.
   * `wide` ocupa toda la pantalla (la pausa).
   * `momento` ('plana', 'muerte' o 'recorte') lo viste `momentos.css`.
   * `onLeave` corre al salir por cualquier lado: al cerrar, y también si otra ventana la reemplaza. `onClose`, solo al cerrar.
   */
  open({ title, sub = '', ic = 'box', render, onClose = null, onLeave = null, dismissible = true, wide = false, momento = null }) {
    window.__game?.cameraRig?.releaseControls?.();
    const saliendo = this._onLeave;
    this._onLeave = onLeave;
    saliendo?.();
    this.root.querySelector('.sign--menu')?.classList.toggle('sign--wide', wide);
    this._ancho = wide;
    this._dismissible = dismissible;
    this._momento = momento;
    if (momento) this.root.setAttribute?.('data-momento', momento);
    else this.root.removeAttribute?.('data-momento');
    $('menu-close').hidden = !dismissible;
    this._render = render;
    this._onClose = onClose;
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
    this.iconEl.replaceChildren(icon(ic, { size: 34 }));
    this.refresh();
    this.root.hidden = false;
    this.bodyEl.scrollTop = 0; // cada ventana abre desde arriba; refresh conserva el sitio solo entre compras. Oculta, no le haría caso
    // La pausa no lleva equis: se sale con su verbo.
    (dismissible && !wide ? $('menu-close') : this.footEl.querySelector('button'))?.focus({ preventScroll: true });
  }

  dismiss() {
    if (this._dismissible !== false) this.close();
  }

  refresh() {
    if (!this._render) return;
    const { body, foot = [], tabs = null, dato = [], tecla = 'Esc' } = this._render();
    const scroll = this.bodyEl.scrollTop;
    this.tabsEl?.replaceChildren(...(tabs ? [tabs] : []));
    this.bodyEl.replaceChildren(body);
    this.footEl.replaceChildren(...foot);
    this.datoEl.replaceChildren(...dato);
    this._pintarCierre(tecla);
    this.bodyEl.scrollTop = scroll;
  }

  /** La tecla con que se cierra esta ventana: la misma equis en todas. */
  _pintarCierre(tecla) {
    if (tecla === this._teclaCierre) return;
    this._teclaCierre = tecla;
    $('menu-close').innerHTML = cierreAdentro(tecla);
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this._render = null;
    const cb = this._onClose;
    this._onClose = null;
    const saliendo = this._onLeave;
    this._onLeave = null;
    cb?.();
    saliendo?.();
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
