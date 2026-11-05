import { startBoliranaMusic } from './BoliranaMusic.js';
import { BoliranaSession } from '../features/bolirana/BoliranaSession.js';
export function openBolirana(game, target) {
  if (
    game.paused ||
    game.isSleeping ||
    game.stats.salud <= 0 ||
    target !== game.boliranaVenue ||
    game.player.position.distanceTo(target.position) > 3
  )
    return;
  const session = new BoliranaSession(game),
    nonce = crypto.randomUUID();
  game.audio.setVenueMuted(true);
  game.audio.setPaused(true);
  game.radio?.setPaused(true);
  game._boliranaOpen = true;
  game.cameraRig.releaseControls();
  game.input.locked = true;
  game.input.keys = {};
  game.input.endFrame();
  const shell = document.createElement('div');
  shell.id = 'bolirana-venue';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-label', 'El Rumbiadero · Bolirana');
  shell.setAttribute('aria-modal', 'true');
  Object.assign(shell.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10000',
    background: '#171220'
  });
  const frame = document.createElement('iframe');
  frame.title = 'Bolirana';
  frame.src = '/bolirana/index.html?embedded=1';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.setAttribute(
    'allow',
    "camera 'none'; microphone 'none'; geolocation 'none'"
  );
  Object.assign(frame.style, { width: '100%', height: '100%', border: '0' });
  shell.append(frame);
  document.body.append(shell);
  let stopMusic = () => {};
  try {
    stopMusic = startBoliranaMusic(game);
  } catch {}
  let closed = false;
  const previousFocus = document.activeElement;
  const close = () => {
    if (closed) return;
    stopMusic();
    try {
      session.close();
    } catch {
      window.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            text: 'No se pudo guardar el resultado de Bolirana.',
            type: 'info'
          }
        })
      );
    }
    closed = true;
    game.audio.setVenueMuted(false);
    window.removeEventListener('message', receive);
    window.removeEventListener('pagehide', close);
    window.removeEventListener('keydown', escape, true);
    shell.remove();
    game._boliranaOpen = false;
    game.input.locked = false;
    game.input.keys = {};
    game.input.endFrame();
    previousFocus?.focus?.({ preventScroll: true });
  };
  const send = (data) =>
    frame.contentWindow?.postMessage(
      { channel: 'bazuko-bolirana', nonce, ...data },
      location.origin
    );
  function receive(e) {
    if (
      e.source !== frame.contentWindow ||
      e.origin !== location.origin ||
      e.data?.channel !== 'bazuko-bolirana'
    )
      return;
    const d = e.data;
    if (d.type === 'ready') {
      if (session.match?.active) session.close();
      send({ type: 'init', state: session.snapshot() });
      return;
    }
    if (d.nonce !== nonce) return;
    try {
      let state;
      if (d.type === 'begin') state = session.begin(d.stake);
      else if (d.type === 'score') state = session.score(d.who, d.points);
      else if (d.type === 'finish') state = session.finish(d.forfeit === true);
      else if (d.type === 'leave') {
        close();
        return;
      } else return;
      send({ type: 'reply', id: d.id, state });
    } catch (error) {
      send({ type: 'reply', id: d.id, error: error.message });
    }
  }
  function escape(e) {
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  }
  window.addEventListener('message', receive);
  window.addEventListener('pagehide', close);
  window.addEventListener('keydown', escape, true);
  frame.focus();
}
