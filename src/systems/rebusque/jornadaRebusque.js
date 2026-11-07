// src/systems/rebusque/jornadaRebusque.js
// La jornada del rebusque en el semáforo: cuántos shows lleva hoy (cansancio), cuánto ha trabajado cada esquina
// (repetición), las esquinas donde lo vieron robando (quemadas) y si ya salió hoy un conductor bravo con varilla.
// Se guarda en la partida (clave `rebusque`); una partida sin ella empieza el día en cero.

/** Después de tantos shows con los brazos (malabares y parabrisas) en el día, cansan más y rinden menos. */
export const CANSANCIO_SHOWS = 10;
export const ENERGIA_CANSADO = 1.5;
/** Horas de juego sin trabajar una esquina para que vuelva a estar fresca. */
export const HORAS_FRESCA = 1;
const BRAZOS = ['malabares', 'vidrios'];
const TRABAJOS = ['malabares', 'vidrios', 'dulces'];
const MAX_CRUCES = 400;

const entero = (v, min = 0, max = 1e6) => Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : min;
const numero = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;

export class JornadaRebusque {
  constructor(dia = 1) { this.reiniciar(dia); }

  reiniciar(dia) {
    this.dia = entero(dia, 0);
    this.shows = { malabares: 0, vidrios: 0, dulces: 0 };
    this.cruces = {};        // índice del cruce → { n, ultimaHora, quemado }
    this.furiaHoy = false;
    this.avisoCansancio = false;
  }

  /** Cambió el día del reloj: todo vuelve a cero. */
  sincronizar(dia) {
    if (Number.isFinite(dia) && Math.trunc(dia) !== this.dia) this.reiniciar(dia);
  }

  get brazos() { return BRAZOS.reduce((n, id) => n + this.shows[id], 0); }

  /** ¿Ya lleva demasiados shows hoy? Cuenta para el que va a empezar. */
  cansado(id) { return BRAZOS.includes(id) && this.brazos >= CANSANCIO_SHOWS; }

  /** Energía que cuesta el trabajo: más si ya está molido. */
  energia(def) { return def.energia * (this.cansado(def.id) ? ENERGIA_CANSADO : 1); }

  _cruce(nodo) {
    if (!(nodo >= 0)) return null;
    return this.cruces[nodo] ??= { n: 0, ultimaHora: -Infinity, quemado: false };
  }

  /** Trabajos hechos en la esquina en la última hora de juego (`hora` = día × 24 + hora del reloj). */
  repeticion(nodo, hora) {
    const c = nodo >= 0 ? this.cruces[nodo] : null;
    if (!c) return 0;
    return hora - c.ultimaHora > HORAS_FRESCA ? 0 : c.n;
  }

  quemado(nodo) { return !!(nodo >= 0 && this.cruces[nodo]?.quemado); }

  /** Lo vieron robando cerca: esa esquina no le da nada bueno el resto del día. */
  quemar(nodo) {
    const c = this._cruce(nodo);
    if (c) c.quemado = true;
  }

  /** Un trabajo cobrado (o intentado) en el semáforo. */
  registrar(id, nodo, hora) {
    if (TRABAJOS.includes(id)) this.shows[id]++;
    const c = this._cruce(nodo);
    if (!c) return;
    c.n = hora - c.ultimaHora > HORAS_FRESCA ? 1 : c.n + 1;
    c.ultimaHora = hora;
  }

  serialize() {
    const cruces = {};
    for (const [k, c] of Object.entries(this.cruces)) {
      cruces[k] = { n: c.n, ultimaHora: Number.isFinite(c.ultimaHora) ? c.ultimaHora : null, quemado: !!c.quemado };
    }
    return { dia: this.dia, shows: { ...this.shows }, cruces, furiaHoy: this.furiaHoy, avisoCansancio: this.avisoCansancio };
  }

  /** Lee lo guardado sin confiar en nada: números finitos, índices enteros, nada de claves raras. */
  deserialize(data) {
    // Partida sin la clave (de antes): el día empieza en cero, no con lo que llevaba la sesión que la carga.
    if (!data || typeof data !== 'object') { this.reiniciar(this.dia); return false; }
    this.reiniciar(numero(data.dia, this.dia));
    for (const id of TRABAJOS) this.shows[id] = entero(data.shows?.[id], 0, 10000);
    const cruces = data.cruces && typeof data.cruces === 'object' ? Object.entries(data.cruces) : [];
    for (const [k, c] of cruces.slice(0, MAX_CRUCES)) {
      if (!/^\d+$/.test(k) || !c || typeof c !== 'object') continue;
      this.cruces[Number(k)] = { n: entero(c.n, 0, 10000), ultimaHora: Number.isFinite(c.ultimaHora) ? c.ultimaHora : -Infinity, quemado: c.quemado === true };
    }
    this.furiaHoy = data.furiaHoy === true;
    this.avisoCansancio = data.avisoCansancio === true;
    return true;
  }
}
