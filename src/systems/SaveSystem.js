const KEY = 'habitante-de-calle-save-v1';
const BACKUP_KEY = `${KEY}-respaldo`;
const VERSION = 2; // v2: dinero en pesos colombianos + necesidad de vicio

// Cuántos pesos vale un "dólar" de las partidas v1
const V1_TO_COP = 250;

/** Intervalo del autoguardado durante el juego activo, en segundos reales. */
export const AUTOSAVE_INTERVAL = 120;

const defaultStorage = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

const parse = (raw) => {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
};

/**
 * Guardado local tolerante a fallos: nunca lanza excepciones al juego.
 * Antes de escribir conserva la partida anterior como respaldo; si la principal
 * está dañada (JSON inválido o escritura interrumpida), se recupera el respaldo.
 */
export class SaveSystem {
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.lastError = null;
    this.restoredFromBackup = false;
  }

  /** Devuelve true si la partida quedó escrita. */
  save(state) {
    if (!this.storage) return false;
    try {
      const raw = JSON.stringify({ ...state, v: VERSION, savedAt: Date.now() });
      const previous = this.storage.getItem(KEY);
      if (parse(previous)) this.storage.setItem(BACKUP_KEY, previous);
      this.storage.setItem(KEY, raw);
      this.lastError = null;
      return true;
    } catch (error) {
      // Cuota llena, almacenamiento bloqueado o estado no serializable.
      this.lastError = error;
      return false;
    }
  }

  load() {
    this.restoredFromBackup = false;
    if (!this.storage) return null;
    let data = null;
    try {
      data = parse(this.storage.getItem(KEY));
      if (!data) {
        data = parse(this.storage.getItem(BACKUP_KEY));
        this.restoredFromBackup = !!data;
      }
    } catch (error) {
      this.lastError = error;
      return null;
    }
    if (!data) return null;
    if (!data.v && data.stats?.dinero !== undefined) {
      data.stats.dinero = Math.round(data.stats.dinero * V1_TO_COP);
    }
    return data;
  }

  clear() {
    try {
      this.storage?.removeItem(KEY);
      this.storage?.removeItem(BACKUP_KEY);
    } catch { /* almacenamiento no disponible */ }
  }
}
