// src/ui/dom.js
// Helpers mínimos para armar DOM sin innerHTML (evita inyección con nombres de jugador).

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) continue;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

export function button(label, { primary = false, small = true, disabled = false, onClick, ghost = !primary, class: extra = '' } = {}) {
  return el('button', {
    type: 'button',
    class: `btn ${primary ? 'btn--primary' : ''} ${ghost ? 'btn--ghost' : ''} ${small ? 'btn--small' : ''} ${extra}`.trim(),
    disabled: disabled || null,
    onclick: onClick,
  }, label);
}
