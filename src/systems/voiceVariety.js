// src/systems/voiceVariety.js
// Lo que evita que las voces suenen a disco rayado: frases barajadas como cartas, una voz por persona,
// cada toma un poco distinta y un paneo leve hacia el lado de quien habla.

/**
 * Reparte como un mazo: ninguna sale dos veces hasta que hayan salido todas, y la última de una ronda
 * no abre la siguiente. `items` puede cambiar entre llamadas (filtros por voz, sexo o enfriamiento).
 */
export class ShuffleBag {
  constructor(random = Math.random) {
    this.random = random;
    this._used = new Set();
    this._last = undefined;
  }

  draw(items, key = item => item) {
    if (!items?.length) return null;
    let fresh = items.filter(item => !this._used.has(key(item)));
    if (!fresh.length) {
      for (const item of items) this._used.delete(key(item));
      fresh = items.length > 1 ? items.filter(item => key(item) !== this._last) : items;
    }
    const item = fresh[Math.min(fresh.length - 1, Math.floor(this.random() * fresh.length))];
    this._used.add(key(item));
    this._last = key(item);
    return item;
  }

  clear() { this._used.clear(); this._last = undefined; }
}

// Velocidad y tono ±4 %, volumen ±1 dB: la misma toma no suena idéntica y nadie queda con voz de ardilla.
const RATE_SPREAD = .04, GAIN_DB = 1;

/** Cómo sale esta vez la toma. Con azar 0,5 sale tal cual (las pruebas lo fijan ahí). */
export function takeVariation(random = Math.random) {
  const rate = 1 + (random() - .5) * 2 * RATE_SPREAD;
  const gain = 10 ** ((random() - .5) * 2 * GAIN_DB / 20);
  return { rate, gain };
}

/** El hombre y la mujer se marcan; una frase sin marcar es voz de hombre. Sin sexo conocido, cualquiera. */
export function sameSex(entry, sexo) {
  return !sexo || (entry.gender ?? 'hombre') === sexo;
}

// Paneo leve: de dónde viene el grito se nota sin que la voz salte de un audífono al otro.
const MAX_PAN = .35, PAN_FULL_AT = 3;

/** -0,35 (izquierda) a 0,35 (derecha) según dónde queda quien habla respecto a la cámara. */
export function voicePan(listener, camera, source) {
  const e = camera?.matrixWorld?.elements;
  if (!e || !listener || !source) return 0;
  const dx = source.x - listener.x, dz = source.z - listener.z;
  const distance = Math.hypot(dx, dz);
  const right = Math.hypot(e[0], e[2]);
  if (distance < .5 || right < 1e-6) return 0;
  const side = (dx * e[0] + dz * e[2]) / (distance * right);
  return Math.max(-1, Math.min(1, side)) * MAX_PAN * Math.min(1, distance / PAN_FULL_AT);
}

/** Howler solo panea con Web Audio; sin él (o en las pruebas) no hace nada. */
export function setPan(sound, pan, id) {
  if (typeof sound?.stereo === 'function') sound.stereo(pan, id);
}

export function setRate(sound, rate, id) {
  if (typeof sound?.rate === 'function') sound.rate(rate, id);
}
