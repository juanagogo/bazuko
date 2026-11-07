// src/systems/rebusque/ritmo.js
// Los malabares: el calendario de la cascada de tres pelotas y el mini-juego de ritmo, que es opcional.
// Puro y determinista con el tiempo del show: no depende del dt, así que da lo mismo a 20 que a 60 cuadros.
//
// Cascada: un lanzamiento cada BEAT segundos, alternando manos. El lanzamiento k es de la pelota k % 3 y sale
// de la mano k % 2 hacia la otra; esa pelota cae VUELO segundos después en la mano que la vuelve a lanzar en
// k + 3, tras PERMANENCIA segundos en la palma. La pose del cuerpo (character/rebusquePose.js) usa el mismo
// calendario para subir cada mano justo cuando lanza.
//
// Mini-juego: cada tercer lanzamiento desde el segundo 1,5 va alto (es siempre la misma pelota). Oprimir B
// cuando esa pelota baja a la mano suma; oprimir a destiempo resta, y dos errores seguidos tumban la siguiente
// pelota. Sin tocar nada la calidad queda en 0,5 y el show paga como siempre.

export const BEAT = .32;                       // s entre lanzamientos
export const PERMANENCIA = .19;                // s que la pelota pasa en la mano antes de volver a salir
export const VUELO = 3 * BEAT - PERMANENCIA;   // s en el aire: .77
export const ALTURA = 9.8 * VUELO * VUELO / 8; // m sobre la mano: .73
export const ALTURA_ALTA = 1.8;                // el lanzamiento alto sube esto más (mismo tiempo: se ve más rápido)
export const DESDE_ALTA = 1.5;                 // s antes de la primera alta
export const VENTANA = .22;                    // s alrededor del agarre de la alta que cuentan como acierto
export const CALIDAD_BASE = .5;

/** ¿El lanzamiento k va alto? Cada tercero desde DESDE_ALTA: así es siempre la misma pelota. */
export const esAlta = k => k % 3 === 2 && k * BEAT >= DESDE_ALTA;
/** Mano que lanza en k (0 derecha, 1 izquierda). */
export const manoDe = k => k % 2;
/** Instante en que la pelota del lanzamiento k cae en la mano de destino. */
export const agarreDe = k => k * BEAT + VUELO;

const clamp01 = v => Math.min(1, Math.max(0, v));

export class Ritmo {
  constructor(duracion = 5) {
    this.duracion = duracion;
    this.aciertos = 0;
    this.errores = 0;
    this.caidas = 0;
    this._seguidos = 0;           // errores sin un acierto en medio
    this._acertadas = new Set();  // lanzamientos altos ya acertados
    this.caidaPendiente = false;  // la próxima pelota que se agarre se cae
    this.caidas_k = [];           // lanzamientos cuyas pelotas se cayeron (la visual las deja en el piso)
    this.aplauso = false;
  }

  get calidad() {
    return clamp01(CALIDAD_BASE + .15 * this.aciertos - .2 * this.errores - .25 * this.caidas);
  }

  /** Estrellas para el aviso: 0 a 3. */
  get estrellas() { return Math.round(this.calidad * 3); }

  /** Altas que todavía caen antes de que termine el show (para no pedir una que no llega). */
  altasRestantes(t) {
    let n = 0;
    for (let k = Math.ceil(Math.max(0, t - VUELO) / BEAT); agarreDe(k) <= this.duracion - .1; k++) if (esAlta(k) && agarreDe(k) >= t) n++;
    return n;
  }

  /** Oprimir B en el instante t del show. Devuelve 'acierto', 'error' o 'caida'. */
  golpe(t) {
    // El agarre alto más cercano que todavía no se acertó.
    const kMin = Math.max(0, Math.floor((t - VENTANA - VUELO) / BEAT)), kMax = Math.ceil((t + VENTANA - VUELO) / BEAT);
    for (let k = kMin; k <= kMax; k++) {
      if (!esAlta(k) || this._acertadas.has(k) || agarreDe(k) > this.duracion) continue;
      if (Math.abs(t - agarreDe(k)) <= VENTANA) {
        this._acertadas.add(k);
        this.aciertos++;
        this._seguidos = 0;
        return 'acierto';
      }
    }
    this.errores++;
    if (++this._seguidos >= 2) {
      this._seguidos = 0;
      this.caidaPendiente = true;
      return 'caida';
    }
    return 'error';
  }

  /**
   * Avanza el show hasta t: si quedó una caída pendiente, se cae la siguiente pelota que llega a una mano.
   * Devuelve el lanzamiento k cuya pelota se cae, o −1 si ya no llega ninguna antes del final.
   */
  avanzar(t) {
    if (!this.caidaPendiente) return -1;
    this.caidaPendiente = false;
    for (let k = Math.max(0, Math.ceil((t - VUELO) / BEAT)); agarreDe(k) <= this.duracion; k++) {
      if (agarreDe(k) < t || !this.enJuego(k)) continue;
      this.caidas++;
      this.caidas_k.push(k);
      return k;
    }
    return -1;
  }

  /** ¿Sale el lanzamiento k? No, si su pelota ya se cayó en un lanzamiento anterior. */
  enJuego(k) {
    for (const c of this.caidas_k) if (c % 3 === k % 3 && c < k) return false;
    return true;
  }

  /** ¿La pelota del lanzamiento k se cae en vez de llegar a la mano? */
  seCae(k) { return this.caidas_k.includes(k); }
}
