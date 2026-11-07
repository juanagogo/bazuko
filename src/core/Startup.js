export async function loadInBatches(items, load, onProgress = () => {}, concurrency = 4) {
  let next = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      await load(items[next++]);
      await onProgress(++completed, items.length);
    }
  }));
}

/** Alterna familias para que una cola de personajes no retrase los otros modelos. */
export function loadTaskGroups(groups, onProgress, concurrency = 6) {
  const tasks = [];
  const count = Math.max(0, ...groups.map(group => group.length));
  for (let i = 0; i < count; i++) {
    for (const group of groups) if (group[i]) tasks.push(group[i]);
  }
  return loadInBatches(tasks, task => task(), onProgress, concurrency);
}

// Safari no tiene requestIdleCallback: un cuadro de espera hace lo mismo a grandes rasgos.
const whenIdle = () => new Promise(resolve => {
  if (globalThis.requestIdleCallback) globalThis.requestIdleCallback(() => resolve(), { timeout: 250 });
  else setTimeout(resolve, 16);
});

/**
 * Deja pasar las tareas de a una, cada una en un rato libre del navegador, mientras está cerrada;
 * abierta, las corre de inmediato. Sirve para cargar con el creador de personaje abierto sin trabarlo.
 */
export class CreatorGate {
  constructor() {
    this.closed = true;
    this._turn = Promise.resolve();
  }

  run(task) {
    if (!this.closed) return task();
    const result = this._turn.then(() => (this.closed ? whenIdle() : undefined)).then(task);
    this._turn = result.catch(() => {});
    return result;
  }

  open() { this.closed = false; }
}

export async function withLoadTimeout(promise, message, milliseconds = 120000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
    ]);
  } finally { clearTimeout(timer); }
}
