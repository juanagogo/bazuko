/** Ayuda bajo demanda: permanece abierta hasta que el usuario la cierre. */
export function startControlsHelp() {
  const root = document.getElementById('controls-help');
  const content = document.getElementById('controls-help-content');
  const toggle = document.getElementById('controls-help-toggle');
  if (!root || !content || !toggle) return;
  if (!document.getElementById('combat-block-help')) {
    const hint = document.createElement('p');
    hint.id = 'combat-block-help'; hint.textContent = 'O: esquivar con Right Pivot. Mantén U: bloquear. G: golpear. H: agarrar/soltar. J: derribar.';
    content.appendChild(hint);
  }
  const collapse = () => {
    root.classList.add('is-collapsed');
    content.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = '!';
    toggle.title = 'Mostrar controles';
    toggle.setAttribute('aria-label', 'Mostrar controles');
  };
  const expand = () => {
    root.classList.remove('is-collapsed');
    content.removeAttribute('aria-hidden');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.textContent = 'Ocultar controles';
    toggle.title = 'Ocultar controles';
    toggle.setAttribute('aria-label', 'Ocultar controles');
  };
  toggle.addEventListener('click', () => root.classList.contains('is-collapsed') ? expand() : collapse());
  collapse();
}
