import { ITEMS } from '../data/items.js';

const KEY = 'habitante-de-calle-save-v1';
const VERSION = 2; // v2: dinero en pesos colombianos + necesidad de vicio

// Cuántos pesos vale un "dólar" de las partidas v1
const V1_TO_COP = 250;

/** Lo que no se pudo leer queda aquí, sin borrarlo. Se juega como si no hubiera partida. */
export const KEY_DANADA = `${KEY}-danada`;

export class SaveSystem {
  /** La partida como texto, sin escribirla: es lo que va al almacenamiento y a un archivo. */
  comoTexto(state) { return JSON.stringify({ ...state, v: VERSION }); }
  /** Guarda la partida. Devuelve false si el navegador no dejó escribir (lleno o prohibido). */
  save(state) {
    try {
      localStorage.setItem(KEY, this.comoTexto(state));
      return true;
    } catch { return false; }
  }
  /** La partida que trae el texto de un archivo, o null si no es de este juego. */
  leerArchivo(texto) {
    let data = null;
    try { data = JSON.parse(texto); } catch { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.v !== undefined && (!Number.isInteger(data.v) || data.v > VERSION)) return null;
    const objeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    if (!objeto(data.stats) || !objeto(data.clock) || !objeto(data.inventory) || !objeto(data.player)) return null;
    if (!Number.isFinite(data.clock.day) || !Number.isFinite(data.clock.hour)) return null;
    if (!Array.isArray(data.inventory.items) || !data.inventory.items.every((i) => objeto(i) && ITEMS[i.id] && Number.isInteger(i.qty) && i.qty > 0)) return null;
    const enfermedades = data.diseases?.active;
    if (enfermedades !== undefined && (!objeto(enfermedades) || !Object.values(enfermedades).every((d) => objeto(d) && Number.isFinite(d.timeLeft)))) return null;
    const pos = data.player.pos;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((n) => Number.isFinite(n))) return null;
    for (const k of ['look', 'built', 'talents', 'diseases']) if (data[k] !== undefined && !objeto(data[k])) return null;
    for (const k of ['cart', 'gps', 'radio', 'dog']) if (data[k] != null && !objeto(data[k])) return null;
    // La migración de las partidas v1 cambia el dinero: se revisa después, no antes.
    const migrada = this._migrar(data);
    return Object.values(migrada.stats).every(Number.isFinite) ? migrada : null;
  }
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
  /** Las partidas v1 guardaban "dólares" y no decían su versión: se pasan a pesos al leerlas. */
  _migrar(data) {
    if (!data.v && data.stats?.dinero !== undefined) {
      data.stats.dinero = Math.round(data.stats.dinero * V1_TO_COP);
    }
    return data;
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
    return this._migrar(data);
  }
  clear() { localStorage.removeItem(KEY); }
}