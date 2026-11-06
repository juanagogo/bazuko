// src/ui/pauseParts.js
// Piezas que comparten las pestañas de la pausa: rótulo, fila, sección y opción en círculo.
import { el, button } from './dom.js';
import { icon } from './icons.js';

export const sectionTitle = (glyph, title) => el('h3', { class: 'pause-section-title' }, icon(glyph, { size: 22 }), title);

export const row = (label, ...controls) => el('div', { class: 'pause-row' }, el('label', { class: 'pause-row__label', text: label }), ...controls);

export const section = (glyph, title, ...rows) => el('div', { class: 'pause-section' }, sectionTitle(glyph, title), ...rows);

/** Elegir es círculo: la opción elegida no se pinta, se encierra. */
export function choice(label, on, onClick) {
  const b = button(el('span', { class: on ? 'elegido' : null, text: label }), { class: 'pause-choice', onClick });
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  return b;
}
