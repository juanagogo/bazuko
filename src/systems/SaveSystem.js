// src/systems/SaveSystem.js
// Guardado en IndexedDB (principal) con respaldo en localStorage. Al guardar se escribe en ambos;
// al cargar se toma el más reciente por `savedAt`. Nunca lanza: un save corrupto se ignora.
const DB_NAME = 'habitante-de-calle';
const STORE = 'saves';
const SLOT = 'slot1';
const KEY_V2 = 'habitante-de-calle-save-v2';
const KEY_V1 = 'habitante-de-calle-save-v1'; // formato anterior (solo lectura/migración)
export const SAVE_VERSION = 6; // v6: contenedores de basura {x,z,yaw,cooldown,leftover} (sin ellos = no se restauran); v3: world {cols, rows} (sin él = mundo antiguo 32x32); v4: avenida TM ancha; v5: 2ª avenida TM (50x50), sin autos guardados (tráfico en vivo). Las posiciones de saves viejos se descartan (el mundo cambió de tamaño)
const IDB_TIMEOUT = 3000;

export class SaveSystem {
  constructor() {
    this._dbPromise = null;
  }

  // ----- IndexedDB -----

  _open() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve) => {
      let done = false;
      const finish = (db) => { if (!done) { done = true; resolve(db); } };
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) return finish(null);
        const rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = () => {
          if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE);
        };
        rq.onsuccess = () => finish(rq.result);
        rq.onerror = () => finish(null);
        rq.onblocked = () => finish(null);
        setTimeout(() => finish(null), IDB_TIMEOUT);
      } catch { finish(null); }
    });
    return this._dbPromise;
  }

  // Ejecuta una operación del store; resuelve { ok, value }
  async _idb(mode, op) {
    const db = await this._open();
    if (!db) return { ok: false };
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const rq = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve({ ok: true, value: rq?.result });
        tx.onerror = tx.onabort = () => resolve({ ok: false });
      } catch { resolve({ ok: false }); }
    });
  }

  // ----- localStorage -----

  _lsRead(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[Save] localStorage corrupto en', key, err);
      return null;
    }
  }

  // ----- API -----

  /** Guarda en localStorage (síncrono, sirve al cerrar la pestaña) e IndexedDB. Devuelve true si algún backend guardó. */
  async save(state) {
    let data;
    try {
      data = { ...state, version: SAVE_VERSION, savedAt: Date.now() };
    } catch { return false; }

    let lsOk = false;
    try { localStorage.setItem(KEY_V2, JSON.stringify(data)); lsOk = true; }
    catch (err) { console.warn('[Save] localStorage no disponible', err); }

    const r = await this._idb('readwrite', (st) => st.put(data, SLOT));
    return lsOk || r.ok;
  }

  /** Devuelve el estado más reciente (migrado a v2) o null. */
  async load() {
    const cands = [];
    try {
      const r = await this._idb('readonly', (st) => st.get(SLOT));
      if (r.ok && r.value) cands.push(r.value);
    } catch (err) { console.warn('[Save] error leyendo IndexedDB', err); }
    const ls = this._lsRead(KEY_V2);
    if (ls) cands.push(ls);

    let best = null;
    for (const c of cands) {
      const s = this._validate(c);
      if (s && (!best || (s.savedAt ?? 0) > (best.savedAt ?? 0))) best = s;
    }
    if (best) return best;

    // Migración desde el save v1 (sin version/savedAt)
    const v1 = this._lsRead(KEY_V1);
    const m = v1 && this._validate(v1);
    if (m) console.info('[Save] migrado desde save v1');
    return m || null;
  }

  async hasSave() { return !!(await this.load()); }

  /** Borra todos los guardados (IndexedDB y ambos localStorage). */
  async clear() {
    for (const k of [KEY_V2, KEY_V1]) {
      try { localStorage.removeItem(k); } catch { /* sin storage */ }
    }
    await this._idb('readwrite', (st) => st.delete(SLOT));
  }

  // Comprueba forma y versión; el formato v1 (sin version) se acepta tal cual (campos opcionales)
  _validate(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const v = s.version ?? 1;
    if (typeof v !== 'number' || v > SAVE_VERSION) {
      console.warn('[Save] versión desconocida, se ignora:', s.version);
      return null;
    }
    return { ...s, version: SAVE_VERSION, savedAt: Number(s.savedAt) || 0 };
  }
}
