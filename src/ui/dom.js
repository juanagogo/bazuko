// src/ui/dom.js
// Helpers mínimos para armar DOM sin innerHTML (evita inyección con nombres de jugador).
import { sinTeclas } from '../core/modoEntrada.js';

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = sinTeclas(v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) continue;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(sinTeclas(c));
  return e;
}

/** Un diálogo: al llegar al último botón, Tab da la vuelta en vez de salirse a lo que está debajo. */
export function tabDaLaVuelta(e, root) {
  const todos = [...root.querySelectorAll('button:not([disabled]), a[href], input, select, [tabindex="0"]')]
    .filter((b) => b.tabIndex >= 0 && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden');
  if (!todos.length) return;
  const i = todos.indexOf(document.activeElement);
  if (e.shiftKey ? i <= 0 : i === todos.length - 1) { e.preventDefault(); todos[e.shiftKey ? todos.length - 1 : 0].focus(); }
}

export function button(label, { primary = false, small = true, disabled = false, onClick, ghost = !primary, class: extra = '' } = {}) {
  return el('button', {
    type: 'button',
    class: `btn ${primary ? 'btn--primary' : ''} ${ghost ? 'btn--ghost' : ''} ${small ? 'btn--small' : ''} ${extra}`.trim(),
    disabled: disabled || null,
    onclick: onClick,
  }, label);
}
