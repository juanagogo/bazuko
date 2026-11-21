/** Ayuda bajo demanda: permanece abierta hasta que el usuario la cierre. */
export function startControlsHelp() {
  const root = document.getElementById('controls-help');
  const content = document.getElementById('controls-help-content');
  const toggle = document.getElementById('controls-help-toggle');
  if (!root || !content || !toggle) return;
  const collapse = () => {
    root.classList.add('is-collapsed');
    content.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Ayuda';
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
  document.getElementById('controls-help-rappi')?.addEventListener('click', () => {
    collapse();
    window.dispatchEvent(new CustomEvent('open-pause-menu', { detail: { tab: 'controles' } }));
  });
  window.addEventListener('keydown', (event) => {
    // En teclado español la tecla Ñ puede llegar como `ñ`/`Ñ`; Semicolon es
    // el código físico de esa tecla en muchos navegadores.
    const esEne = event.key === 'ñ' || event.key === 'Ñ' || (event.code === 'Semicolon' && event.key !== ';');
    if (!esEne || event.repeat || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    toggle.click();
  });
  collapse();
}
