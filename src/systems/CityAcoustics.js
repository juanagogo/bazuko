// Obstrucción exterior adaptada de js/audio-acoustics.js de Slop New York 1b54e165 (MIT).
//
// Usa las mismas cajas estáticas del movimiento (CollisionSystem.queryStatic): un sonido detrás de un
// edificio se oye más bajo. Cada voz audible vuelve a trazar su línea cuatro veces por segundo; no hay
// raycasts contra mallas ni DSP por muestra.
// BAZUKO aplica el resultado solo como volumen (sin panners ni filtros por voz).

/** Metros de la caja que atraviesa el segmento a→b. Con `allowEndInside` el extremo b puede estar dentro. */
export function thickness(box, ax, ay, az, bx, by, bz, allowEndInside = false) {
  const { min, max } = box;
  // Una cámara o una fuente pegada a una caja conservadora no debe silenciar toda la ciudad.
  if (ax > min.x && ax < max.x && az > min.z && az < max.z && ay > min.y && ay < max.y) return 0;
  if (!allowEndInside && bx > min.x && bx < max.x && bz > min.z && bz < max.z && by > min.y && by < max.y) return 0;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let enter = 0, exit = 1;
  for (const [a, d, lo, hi] of [[ax, dx, min.x, max.x], [ay, dy, min.y, max.y], [az, dz, min.z, max.z]]) {
    if (Math.abs(d) < 1e-7) {
      if (a <= lo || a >= hi) return 0;
      continue;
    }
    const t0 = (lo - a) / d, t1 = (hi - a) / d;
    enter = Math.max(enter, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
  }
  return Math.max(0, exit - enter) * Math.hypot(dx, dy, dz);
}

const VOICE_REFRESH_SECONDS = .25;
/** Ganancia directa a través de un edificio, como en audio-system.js del donante. */
export const OBSTRUCTED_GAIN = .22;

/**
 * Cajas que pueden tapar sonido: edificios, no postes ni bordillos. Las manzanas genéricas de Bogotá
 * se registran como franjas de una casilla (2 m) de fondo por fila: también cuentan.
 */
export const blocksSound = box => box.max.y - box.min.y > 3 && box.max.x - box.min.x >= 1.9 && box.max.z - box.min.z >= 1.9;

export class CityAcoustics {
  constructor(collisions, { now = () => performance.now() / 1000 } = {}) {
    this.collisions = collisions;
    this.now = now;
    this.voices = new WeakMap();
    this._candidates = [];
    this.traces = 0;
  }

  /**
   * 0 = despejado, 1 = tapado. Tres rayos separados 0,9 m suavizan las esquinas. El donante guarda
   * las cajas a 200 m del oyente y toma el mayor grosor; aquí cada trazado pide al índice espacial
   * del movimiento solo las cajas de su rectángulo (cientos menos en el centro) y suma los grosores,
   * porque una manzana está hecha de franjas contiguas que no se solapan.
   */
  obstruction(source, listener, height = 0) {
    const dx = source.x - listener.x, dz = source.z - listener.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 3 || !this.collisions?.queryStatic) return 0;
    this.traces++;
    const near = this.collisions.queryStatic(Math.min(source.x, listener.x) - 1, Math.min(source.z, listener.z) - 1,
      Math.max(source.x, listener.x) + 1, Math.max(source.z, listener.z) + 1, this._candidates);
    const sideX = -dz / distance * .9, sideZ = dx / distance * .9;
    let blocked = 0;
    for (let ray = -1; ray <= 1; ray++) {
      const ox = sideX * ray, oz = sideZ * ray;
      let depth = 0;
      for (const { box } of near) {
        if (!blocksSound(box)) continue;
        depth += thickness(box, listener.x + ox, listener.y, listener.z + oz, source.x + ox, source.y + height, source.z + oz);
        if (depth > 10) break;
      }
      blocked += 1 - Math.exp(-depth * .45);
    }
    return blocked / 3;
  }

  /**
   * Multiplicador de volumen de una voz. Se vuelve a trazar cada cuarto de segundo por fuente y se
   * acerca suavemente al nuevo valor, para que doblar una esquina no corte el sonido de golpe.
   */
  gain(key, source, listener, height = 1) {
    if (!listener || !source) return 1;
    const now = this.now();
    let voice = this.voices.get(key);
    if (!voice) this.voices.set(key, voice = { target: 0, value: null, tracedAt: -Infinity, at: now });
    if (now - voice.tracedAt >= VOICE_REFRESH_SECONDS) {
      voice.target = this.obstruction(source, listener, height);
      voice.tracedAt = now;
    }
    voice.value = voice.value === null ? voice.target : voice.value + (voice.target - voice.value) * (1 - Math.exp(-(now - voice.at) / .12));
    voice.at = now;
    return 1 - voice.value * (1 - OBSTRUCTED_GAIN);
  }
}
