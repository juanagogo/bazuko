// src/ui/cierre.js
// El cierre de todos los menús: una equis en cinta y la tecla de ese menú. Con el dedo queda la equis; con mando, B.
import { iconChar } from './icons.js';
import { teclaDeCierre } from '../core/modoEntrada.js';

const kbd = (tecla) => `<kbd aria-hidden="true" data-k="${tecla}" data-k-mando="Esc">${teclaDeCierre(tecla)}</kbd>`;

/** El botón, para los menús que se escriben como texto. */
export const cierreHTML = (tecla, etiqueta, clase = '', extra = '') =>
  `<button type="button" class="cinta cierre ${clase}" aria-label="${etiqueta}"${extra ? ` ${extra}` : ''}><span class="picto" data-dibujo="${iconChar('x')}" aria-hidden="true"></span>${kbd(tecla)}</button>`;

/** Lo de adentro, para un botón que ya existe en la página. */
export const cierreAdentro = (tecla) => `<span class="picto" data-dibujo="${iconChar('x')}" aria-hidden="true"></span>${kbd(tecla)}`;
