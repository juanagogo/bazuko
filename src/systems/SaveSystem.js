import { ITEMS } from '../data/items.js';

// Guardado de la partida en el almacenamiento del navegador y en archivos.
//
// La partida del navegador va acompañada de una suma de verificación en su propia
// clave (los archivos exportados no la llevan: se pueden editar y leerArchivo los
// revisa campo por campo). Antes de escribir se conserva la anterior como respaldo.
// Al cargar se verifica, se migra y se sanea: si la principal está dañada se aparta
// sin borrarla y se recupera el respaldo.

const KEY = 'habitante-de-calle-save-v1';
const VERSION = 2; // v2: dinero en pesos colombianos + necesidad de vicio

// Cuántos pesos vale un "dólar" de las partidas v1
const V1_TO_COP = 250;

/** Lo que no se pudo leer queda aquí, sin borrarlo. Se juega como si no hubiera partida. */
export const KEY_DANADA = `${KEY}-danada`;
/** La última partida buena antes del guardado actual. */
export const KEY_RESPALDO = `${KEY}-respaldo`;
/**
 * Las apartadas no se pisan: la más nueva en KEY_DANADA y las anteriores en `-2` y `-3`. Con la apartada va el
 * respaldo que tenía en ese momento, porque los dos primeros guardados de la partida nueva lo reemplazan.
 */
export const KEYS_APARTADAS = [KEY_DANADA, `${KEY_DANADA}-2`, `${KEY_DANADA}-3`];
/** El respaldo de cada apartada, en el mismo puesto: corren juntos. */
export const KEYS_RESPALDO_APARTADO = KEYS_APARTADAS.map((clave) => `${clave}-respaldo`);
export const KEY_RESPALDO_APARTADO = KEYS_RESPALDO_APARTADO[0];
export const SAVE_VERSION = VERSION;

const SUMA = (clave) => `${clave}-suma`;
const AVISO_APARTADA = `${KEY_DANADA}-por-avisar`;
const AVISO_RECUPERADA = `${KEY_RESPALDO}-por-avisar`;

/**
 * Migraciones en orden: cada una lleva una partida de la versión `desde` a la siguiente.
 * Una versión nueva del formato se agrega aquí con su paso, sin tocar el resto.
 */
const MIGRACIONES = [
  // v1 guardaba "dólares" y no decía su versión.
  { desde: 1, aplicar(data) {
    if (data.stats?.dinero !== undefined) data.stats.dinero = Math.round(data.stats.dinero * V1_TO_COP);
  } }
];

/** FNV-1a de 32 bits: barato y suficiente para notar una escritura cortada o tocada. */
export function sumaDeVerificacion(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const objeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const numero = (v) => typeof v === 'number' && Number.isFinite(v);
const NECESIDADES = ['hambre', 'sed', 'energia', 'salud', 'higiene', 'animo', 'saludMental', 'vicio'];

/** Interpreta el texto de una partida. Lanza un error si no es un objeto. */
function abrir(texto) {
  const data = JSON.parse(texto);
  if (!objeto(data)) throw new Error('No es una partida');
  return data;
}

/**
 * Corrige lo imposible sin tirar la partida: necesidades fuera de 0–100, dinero negativo,
 * reloj o posición inválidos y secciones de un tipo inesperado vuelven a un valor seguro.
 */
export function sanearPartida(data) {
  const out = { ...data };
  const stats = objeto(out.stats) ? { ...out.stats } : {};
  for (const k of NECESIDADES) {
    if (!(k in stats)) continue;
    if (numero(stats[k])) stats[k] = Math.min(100, Math.max(0, stats[k]));
    else delete stats[k];
  }
  if ('dinero' in stats) {
    if (numero(stats.dinero)) stats.dinero = Math.max(0, Math.round(stats.dinero));
    else delete stats.dinero;
  }
  for (const k of ['xp', 'level']) if (k in stats && !(numero(stats[k]) && stats[k] >= 0)) delete stats[k];
  out.stats = stats;

  // Clock.deserialize asigna los dos campos sin revisar: siempre deben ser números válidos.
  const clock = objeto(out.clock) ? out.clock : {};
  out.clock = {
    ...clock,
    day: numero(clock.day) && clock.day >= 1 ? Math.floor(clock.day) : 1,
    hour: numero(clock.hour) ? ((clock.hour % 24) + 24) % 24 : 6
  };

  const inventory = objeto(out.inventory) ? { ...out.inventory } : {};
  if (inventory.items !== undefined) {
    inventory.items = Array.isArray(inventory.items)
      ? inventory.items.filter((i) => objeto(i) && ITEMS[i.id] && Number.isInteger(i.qty) && i.qty > 0)
      : [];
  }
  out.inventory = inventory;

  for (const k of ['talents', 'diseases', 'built']) if (out[k] !== undefined && !objeto(out[k])) delete out[k];
  const pos = out.player?.pos;
  if (!(Array.isArray(pos) && pos.length === 3 && pos.every(numero))) delete out.player;
  for (const k of ['look', 'cart', 'gps', 'radio', 'dog', 'zorra', 'bolirana', 'robo']) {
    if (out[k] != null && !objeto(out[k])) delete out[k];
  }
  return out;
}

export class SaveSystem {
  /** `storage` sirve para pruebas; por defecto es el localStorage del momento. */
  constructor(storage) {
    this._storage = storage;
    /** true si la última carga tuvo que usar la copia de respaldo. */
    this.restoredFromBackup = false;
  }

  get storage() {
    if (this._storage !== undefined) return this._storage;
    try { return globalThis.localStorage ?? null; } catch { return null; }
  }

  _leer(clave) {
    try { return this.storage?.getItem(clave) ?? null; } catch { return null; }
  }

  /** La partida como texto, sin escribirla: es lo que va al almacenamiento y a un archivo. */
  comoTexto(state) { return JSON.stringify({ ...state, v: VERSION }); }

  /** Guarda la partida. Devuelve false si el navegador no dejó escribir (lleno o prohibido). */
  save(state) {
    try {
      const storage = this.storage;
      if (!storage) return false;
      const texto = this.comoTexto(state);
      // La partida anterior pasa a respaldo, con su suma, solo si se deja leer.
      const anterior = this._leer(KEY);
      const sumaAnterior = this._leer(SUMA(KEY));
      if (anterior && anterior !== texto && this._esValida(anterior, sumaAnterior)) {
        try {
          storage.setItem(KEY_RESPALDO, anterior);
          if (sumaAnterior) storage.setItem(SUMA(KEY_RESPALDO), sumaAnterior);
          else storage.removeItem(SUMA(KEY_RESPALDO));
        } catch { /* sin espacio para el respaldo */ }
      }
      // La suma va antes que la partida: si se corta entre las dos, la principal no
      // coincide y se recupera el respaldo, que es justo la partida anterior.
      storage.setItem(SUMA(KEY), sumaDeVerificacion(texto));
      try { storage.setItem(KEY, texto); } catch (error) {
        try {
          if (sumaAnterior) storage.setItem(SUMA(KEY), sumaAnterior);
          else storage.removeItem(SUMA(KEY));
        } catch { /* nada más que hacer */ }
        throw error;
      }
      // Releer: una escritura que no quedó igual no cuenta como guardada.
      return this._leer(KEY) === texto;
    } catch { return false; }
  }

  _esValida(texto, suma) {
    try { this._cargarTexto(texto, suma); return true; } catch { return false; }
  }

  /** La partida que trae el texto de un archivo, o null si no es de este juego. */
  leerArchivo(texto) {
    let data = null;
    try { data = abrir(texto); } catch { return null; }
    if (data.v !== undefined && (!Number.isInteger(data.v) || data.v > VERSION)) return null;
    if (!objeto(data.stats) || !objeto(data.clock) || !objeto(data.inventory) || !objeto(data.player)) return null;
    if (!Number.isFinite(data.clock.day) || !Number.isFinite(data.clock.hour)) return null;
    if (!Array.isArray(data.inventory.items) || !data.inventory.items.every((i) => objeto(i) && ITEMS[i.id] && Number.isInteger(i.qty) && i.qty > 0)) return null;
    const enfermedades = data.diseases?.active;
    if (enfermedades !== undefined && (!objeto(enfermedades) || !Object.values(enfermedades).every((d) => objeto(d) && Number.isFinite(d.timeLeft)))) return null;
    const pos = data.player.pos;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((n) => Number.isFinite(n))) return null;
    for (const k of ['look', 'built', 'talents', 'diseases']) if (data[k] !== undefined && !objeto(data[k])) return null;
    for (const k of ['cart', 'gps', 'radio', 'dog', 'robo']) if (data[k] != null && !objeto(data[k])) return null;
    // La migración de las partidas v1 cambia el dinero: se revisa después, no antes.
    const migrada = this._migrar(data);
    return Object.values(migrada.stats).every(Number.isFinite) ? migrada : null;
  }

  /** Saca la partida del camino sin borrarla. Si tampoco se puede apartar, se queda donde está: nunca se pierde. */
  apartar({ avisar = true } = {}) {
    const raw = this._leer(KEY);
    if (raw === null) return;
    try {
      // Una apartada anterior distinta corre un puesto en lugar de perderse, y su respaldo corre con ella.
      const otra = this._leer(KEY_DANADA) !== raw;
      if (otra) {
        for (let i = KEYS_APARTADAS.length - 1; i > 0; i--) {
          const anterior = this._leer(KEYS_APARTADAS[i - 1]);
          if (anterior === null) continue;
          this.storage.setItem(KEYS_APARTADAS[i], anterior);
          const suRespaldo = this._leer(KEYS_RESPALDO_APARTADO[i - 1]);
          if (suRespaldo !== null) this.storage.setItem(KEYS_RESPALDO_APARTADO[i], suRespaldo);
          else this.storage.removeItem(KEYS_RESPALDO_APARTADO[i]);
        }
      }
      const respaldo = this._leer(KEY_RESPALDO);
      if (respaldo !== null && respaldo !== raw) this.storage.setItem(KEY_RESPALDO_APARTADO, respaldo);
      else if (otra) this.storage.removeItem(KEY_RESPALDO_APARTADO);
      this.storage.setItem(KEY_DANADA, raw);
      this.storage.removeItem(KEY);
      this.storage.removeItem(SUMA(KEY));
      if (avisar) this.storage.setItem(AVISO_APARTADA, '1');
    } catch { /* sin almacenamiento: tampoco se pudo guardar nada */ }
  }

  _avisoPendiente(clave) {
    try {
      const avisar = this.storage?.getItem(clave) === '1';
      if (avisar) this.storage.removeItem(clave);
      return avisar;
    } catch { return false; }
  }

  /** Dice una sola vez que hubo que apartarla y se empieza sin partida. */
  fueApartada() { return this._avisoPendiente(AVISO_APARTADA); }

  /** Dice una sola vez que la partida estaba dañada y se siguió desde el respaldo. */
  fueRecuperada() { return this._avisoPendiente(AVISO_RECUPERADA); }

  /** Lleva cualquier versión anterior a la actual, paso por paso. */
  _migrar(data) {
    let version = Number.isInteger(data.v) ? data.v : 1;
    for (const paso of MIGRACIONES) {
      if (version === paso.desde) {
        paso.aplicar(data);
        version = paso.desde + 1;
      }
    }
    if (version < VERSION) throw new Error(`Falta la migración desde la versión ${version}`);
    return data;
  }

  /** Lee, verifica, migra y sanea un texto guardado. Lanza un error si no sirve. */
  _cargarTexto(texto, suma) {
    // Las partidas anteriores a la suma no la tienen: se aceptan sin ella.
    if (suma && suma !== sumaDeVerificacion(texto)) throw new Error('La suma de verificación no coincide');
    const data = this._migrar(abrir(texto));
    if (data.v !== undefined && data.v > VERSION) throw new Error('Partida de una versión más nueva del juego');
    return sanearPartida(data);
  }

  load() {
    this.restoredFromBackup = false;
    const raw = this._leer(KEY);
    // Sin partida principal se empieza de cero, aunque haya respaldo: si la quitó
    // game.js porque no se pudo aplicar, recuperar el respaldo podría repetir el fallo.
    if (!raw) return null;
    try { return this._cargarTexto(raw, this._leer(SUMA(KEY))); } catch { /* abajo: respaldo o apartar */ }
    const respaldo = this._leer(KEY_RESPALDO);
    let data = null;
    if (respaldo) {
      try { data = this._cargarTexto(respaldo, this._leer(SUMA(KEY_RESPALDO))); } catch { /* el respaldo tampoco sirve */ }
    }
    if (!data) {
      // Sin respaldo bueno, una partida que se lee entera vale más que ninguna aunque su
      // suma no coincida (por ejemplo, escrita por otra versión del juego).
      try {
        const leida = this._cargarTexto(raw, null);
        try { this.storage.removeItem(SUMA(KEY)); } catch { /* el próximo guardado la rehace */ }
        return leida;
      } catch { /* tampoco se lee: se aparta */ }
    }
    this.apartar({ avisar: !data });
    return data && this._restaurar(respaldo, data);
  }

  /** El respaldo vuelve a ser la partida principal, para no fallar otra vez al recargar. */
  _restaurar(texto, data) {
    this.restoredFromBackup = true;
    try {
      const suma = this._leer(SUMA(KEY_RESPALDO));
      if (suma) this.storage.setItem(SUMA(KEY), suma);
      else this.storage.removeItem(SUMA(KEY));
      this.storage.setItem(KEY, texto);
      this.storage.setItem(AVISO_RECUPERADA, '1');
    } catch { /* se reintenta en el próximo guardado */ }
    return data;
  }

  clear() {
    for (const clave of [KEY, KEY_RESPALDO, SUMA(KEY), SUMA(KEY_RESPALDO)]) {
      try { this.storage?.removeItem(clave); } catch { /* sin almacenamiento */ }
    }
  }
}
