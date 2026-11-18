// Música exclusiva del local; el sonido de la calle se pausa por separado.
export function startBoliranaMusic(
  game,
  {
    source = '/audio/bolirana-caslo-salsa-trap.mp3',
    AudioClass = globalThis.Audio,
    events = globalThis.window,
    doc = globalThis.document,
    schedule = globalThis.setInterval,
    cancel = globalThis.clearInterval
  } = {}
) {
  if (!source) return () => {};
  if (
    !source.startsWith('/audio/') ||
    source.startsWith('//') ||
    source.includes('..')
  )
    throw Error('La música debe ser un archivo local de audio.');
  const music = new AudioClass(source);
  music.id = 'bolirana-music';
  music.loop = true;
  music.preload = 'auto';
  music.hidden = true;
  doc.body?.append?.(music);
  let disposed = false,
    starting = false,
    blocked = false;
  function play() {
    if (disposed || starting || doc.hidden || !music.paused || blocked) return;
    starting = true;
    Promise.resolve(music.play())
      .catch(() => {
        blocked = true;
      })
      .finally(() => (starting = false));
  }
  function sync() {
    if (disposed) return;
    music.muted = !!game.audio.muted;
    music.volume = Math.max(
      0,
      Math.min(
        1,
        0.45 *
          game.audio.volume *
          (game.audio._level?.('ambient') ??
            game.audio.getMix?.('ambient') ??
            1)
      )
    );
    if (doc.hidden) music.pause();
    else play();
  }
  function retry() {
    blocked = false;
    sync();
  }
  events.addEventListener('audio-settings-change', sync);
  events.addEventListener('pointerdown', retry, true);
  events.addEventListener('keydown', retry, true);
  doc.addEventListener('visibilitychange', sync);
  const timer = schedule(sync, 250);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    cancel(timer);
    events.removeEventListener('audio-settings-change', sync);
    events.removeEventListener('pointerdown', retry, true);
    events.removeEventListener('keydown', retry, true);
    doc.removeEventListener('visibilitychange', sync);
    music.pause();
    music.removeAttribute('src');
    music.load();
    music.remove();
  };
}
