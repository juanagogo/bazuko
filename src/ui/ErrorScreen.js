// Aviso amable ante errores inesperados y pérdida del contexto gráfico.
// Un error de lógica deja seguir jugando (el bucle ya programó el siguiente cuadro);
// la pérdida de WebGL sí requiere recargar, después de guardar la partida si el momento lo permite.

const MAX_REPORTS = 20;

/** Texto corto y sin rutas internas para mostrar al jugador. */
export function describeError(error) {
  if (!error) return 'Error desconocido';
  const message = typeof error === 'string' ? error : error.message ?? String(error);
  return message.split('\n')[0].slice(0, 160) || 'Error desconocido';
}

/**
 * Guarda solo si es un momento firme, con la misma guarda del guardado solo (`Game._puedeAutoguardar`): cargando,
 * preso o muerto no se escribe nada, o una partida a medio cargar pisaría la buena. Devuelve si guardó.
 */
function guardarSiSePuede(game) {
  try {
    if (game?.autoSave?.guardarAhora) return game.autoSave.guardarAhora() === true;
    if (game?._puedeAutoguardar && !game._puedeAutoguardar()) return false;
    return game?._save ? game._save() !== false : false;
  } catch { return false; }
}

export function installErrorScreen({ canvas = null, game = null, doc = globalThis.document, win = globalThis.window } = {}) {
  if (!doc || !win) return null;
  const reports = [];
  let banner = null;
  let fatal = false;

  const remember = (kind, error) => {
    const entry = { kind, message: describeError(error), at: new Date().toISOString() };
    reports.push(entry);
    if (reports.length > MAX_REPORTS) reports.shift();
    return entry;
  };

  const show = ({ title, text, canContinue }) => {
    banner?.remove();
    banner = doc.createElement('div');
    banner.id = 'error-screen';
    banner.setAttribute('role', 'alertdialog');
    banner.setAttribute('aria-live', 'assertive');
    banner.className = canContinue ? 'error-screen error-screen--suave' : 'error-screen';
    const box = doc.createElement('div');
    box.className = 'carton error-screen__caja';
    const h = doc.createElement('h2');
    h.textContent = title;
    const p = doc.createElement('p');
    p.textContent = text;
    const actions = doc.createElement('div');
    actions.className = 'error-screen__acciones';
    const reload = doc.createElement('button');
    reload.type = 'button';
    reload.className = 'cinta cinta--verbo';
    reload.textContent = 'Recargar el juego';
    reload.addEventListener('click', () => { guardarSiSePuede(game); win.location.reload(); });
    actions.append(reload);
    if (canContinue) {
      const keep = doc.createElement('button');
      keep.type = 'button';
      keep.className = 'cinta';
      keep.textContent = 'Seguir jugando';
      keep.addEventListener('click', () => { banner?.remove(); banner = null; });
      actions.append(keep);
    }
    box.append(h, p, actions);
    banner.append(box);
    doc.body.append(banner);
  };

  const onError = (kind, error) => {
    const entry = remember(kind, error);
    console.error(`[${kind}]`, error);
    if (fatal || banner) return;
    show({
      title: 'Algo falló',
      text: `Ocurrió un error inesperado (${entry.message}). Puede seguir jugando o recargar; al recargar se guarda si se puede, y si no se sigue desde el último guardado.`,
      canContinue: true
    });
  };

  win.addEventListener('error', (event) => {
    // Recursos que no cargan (imágenes, audio) también disparan "error" sin objeto Error: no se reportan.
    if (!event?.error && !event?.message) return;
    onError('error', event.error ?? event.message);
  });
  win.addEventListener('unhandledrejection', (event) => onError('promesa', event?.reason));

  canvas?.addEventListener('webglcontextlost', (event) => {
    event.preventDefault?.();
    fatal = true;
    remember('webgl', 'Se perdió el contexto WebGL');
    const guardada = guardarSiSePuede(game);
    show({
      title: 'Se perdió la imagen',
      text: guardada
        ? 'El navegador reinició la tarjeta gráfica. La partida quedó guardada; recargue para seguir jugando.'
        : 'El navegador reinició la tarjeta gráfica. Recargue para seguir desde el último guardado.',
      canContinue: false
    });
  });

  return { reports, show };
}
