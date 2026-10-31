export const embedded =
  new URLSearchParams(location.search).get('embedded') === '1' &&
  parent !== window;
if (!embedded) location.replace('/');
let nonce,
  state,
  seq = 0;
const pending = new Map();
let resolveReady;
export const hostReady = embedded
  ? new Promise((resolve) => (resolveReady = resolve))
  : new Promise(() => {});
if (embedded) {
  window.addEventListener('message', (e) => {
    if (
      e.source !== parent ||
      e.origin !== location.origin ||
      e.data?.channel !== 'bazuko-bolirana'
    )
      return;
    const d = e.data;
    if (d.type === 'init' && !nonce) {
      nonce = d.nonce;
      state = d.state;
      resolveReady(state);
      return;
    }
    if (d.nonce !== nonce || d.type !== 'reply') return;
    const task = pending.get(d.id);
    if (!task) return;
    pending.delete(d.id);
    clearTimeout(task.timer);
    if (d.error) task.reject(Error(d.error));
    else {
      state = d.state;
      task.resolve(state);
    }
  });
  parent.postMessage(
    { channel: 'bazuko-bolirana', type: 'ready' },
    location.origin
  );
}
export async function hostRequest(type, data = {}) {
  await hostReady;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('No hubo respuesta del juego.'));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    parent.postMessage(
      { channel: 'bazuko-bolirana', nonce, id, type, ...data },
      location.origin
    );
  });
}
export async function leaveHost() {
  await hostReady;
  parent.postMessage(
    { channel: 'bazuko-bolirana', nonce, type: 'leave' },
    location.origin
  );
}
