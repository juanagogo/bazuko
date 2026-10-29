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

export async function withLoadTimeout(promise, message, milliseconds = 120000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
    ]);
  } finally { clearTimeout(timer); }
}
