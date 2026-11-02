const KEY = 'habitante-de-calle-save-v1';
const VERSION = 2; // v2: dinero en pesos colombianos + necesidad de vicio

// Cuántos pesos vale un "dólar" de las partidas v1
const V1_TO_COP = 250;

/** Lo que no se pudo leer queda aquí, sin borrarlo. Se juega como si no hubiera partida. */
export const KEY_DANADA = `${KEY}-danada`;

export class SaveSystem {
  save(state) { localStorage.setItem(KEY, JSON.stringify({ ...state, v: VERSION })); }
  /** Saca la partida del camino sin borrarla. Si tampoco se puede apartar, se queda donde está: nunca se pierde. */
  apartar() {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return;
    try {
      localStorage.setItem(KEY_DANADA, raw);
      localStorage.removeItem(KEY);
      localStorage.setItem(`${KEY_DANADA}-por-avisar`, '1');
    } catch { /* sin almacenamiento: tampoco se pudo guardar nada */ }
  }
  /** Dice una sola vez que hubo que apartarla. */
  fueApartada() {
    try {
      const avisar = localStorage.getItem(`${KEY_DANADA}-por-avisar`) === '1';
      if (avisar) localStorage.removeItem(`${KEY_DANADA}-por-avisar`);
      return avisar;
    } catch { return false; }
  }
  load() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    let data = null;
    try { data = JSON.parse(raw); } catch { /* abajo */ }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      this.apartar();
      return null;
    }
    if (!data.v && data.stats?.dinero !== undefined) {
      data.stats.dinero = Math.round(data.stats.dinero * V1_TO_COP);
    }
    return data;
  }
  clear() { localStorage.removeItem(KEY); }
}