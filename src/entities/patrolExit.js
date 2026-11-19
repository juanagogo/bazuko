// src/entities/patrolExit.js
// Cómo se baja un agente de la patrulla, sin nada del mundo: de cada instante sale cuánto se ha deslizado, girado y
// parado, y qué posturas lleva con qué peso (`BodyLanguage` las pone tal cual, sin transición propia). Todo va en
// fracciones de cada fase, así que de afán son las mismas poses más rápido, no recortadas.
import { smooth } from '../character/BodyLanguage.js';

/** Segundos de cada fase: la puerta se abre, se desliza al borde girando hacia afuera, se para y da el primer paso. */
export const EXIT = { door: .3, swing: .45, rise: .5, step: .4 };
export const EXIT_SECONDS = EXIT.door + EXIT.swing + EXIT.rise + EXIT.step;

const RISE_LIFT = .06; // m que sube la raíz a media parada (ver `seatRise`)

const ease = t => smooth(Math.min(1, Math.max(0, t)));
const LEAD_FOOT = { [-1]: 'baja-izquierda', 1: 'baja-derecha' }; // el pie de afuera: el del lado de la puerta

/**
 * Deslizarse del asiento al borde, en la fracción `u` de esa fase (subirse es lo mismo al revés). Devuelve cuánto ha
 * girado hacia la puerta (`yaw`), cuánto se ha corrido de lado (`slide`), cuánto ha bajado la raíz hasta la calle (`drop`)
 * y las posturas con su peso. Primero agacha tronco y cabeza, que tienen que pasar bajo el marco; gira la cadera mientras
 * se desliza, y solo ya afuera del asiento baja a plantar el pie del lado de la puerta.
 */
export function seatSlide(u, side, out = {}) {
  out.yaw = ease(u / .8);
  out.slide = ease((u - .15) / .85);
  // La raíz baja al paso que entra la postura del borde: así la cadera va derecho de la altura del asiento a la del borde.
  out.drop = ease((u - .12) / .88);
  out.poses = [['patrulla', 1], [LEAD_FOOT[side], out.drop], ['agachado', ease(u / .32)], ['cabeza-baja', .5 + .5 * ease(u / .25)]];
  return out;
}

/**
 * Pararse desde el borde, en la fracción `u` de esa fase: primero sube la cadera mientras sale del marco (`out`), después
 * se desdobla el tronco y de última sube la cabeza. `lift` es lo que hay que subir la raíz para que el pie no se hunda.
 */
export function seatRise(u, side, out = {}) {
  out.out = ease(u / .6);
  // A media parada las piernas van más estiradas de lo que ha subido la cadera: la raíz sube lo que hundiría el pie plantado.
  out.lift = RISE_LIFT * 4 * out.out * (1 - out.out);
  out.poses = [[LEAD_FOOT[side], 1 - out.out], ['agachado', 1 - ease((u - .3) / .5)], ['cabeza-baja', 1 - ease((u - .55) / .45)]];
  return out;
}

/** Las fases de una bajada que dura `seconds` en total; por debajo de la de siempre, es de afán. */
export function exitTimes(seconds = EXIT_SECONDS) {
  const k = seconds / EXIT_SECONDS;
  return { door: EXIT.door * k, swing: EXIT.swing * k, rise: EXIT.rise * k, step: EXIT.step * k, urgent: k < .95 };
}

/**
 * La bajada a los `t` s, con las fases `e` de `exitTimes`, por la puerta `side` (−1 izquierda, 1 derecha). Deja en `m`:
 * `phase` (door | swing | rise | step | done), `slide`, `drop` y `yaw` (0 en el asiento, 1 en el borde y de cara a la
 * puerta), `out` (0 en el borde, 1 parado junto a la puerta), `turn` (0 de cara a la puerta, 1 hacia donde va a correr:
 * gira mientras termina de pararse y da el primer paso), `step` (fracción del primer paso), `stoop` y `poses`.
 */
export function exitMotion(t, e, side, m = {}) {
  const swingEnd = e.door + e.swing, riseEnd = swingEnd + e.rise, turnFrom = swingEnd + e.rise * .5;
  m.turn = ease((t - turnFrom) / (riseEnd + e.step * .6 - turnFrom));
  m.yaw = m.slide = m.drop = m.out = m.step = m.stoop = m.lift = 0;
  m.poses = null;
  if (t < e.door) {
    // Sentado mientras la puerta abre; ya empieza a agachar la cabeza.
    m.phase = 'door';
    m.poses = [['patrulla', 1], ['cabeza-baja', .5 * ease((t / e.door - .4) / .6)]];
  } else if (t < swingEnd) {
    m.phase = 'swing';
    seatSlide((t - e.door) / e.swing, side, m);
  } else if (t < riseEnd) {
    const u = (t - swingEnd) / e.rise;
    m.phase = 'rise';
    m.yaw = m.slide = m.drop = 1;
    seatRise(u, side, m);
    if (e.urgent) m.stoop = .4 * ease((u - .5) / .5);
  } else {
    m.phase = t < riseEnd + e.step ? 'step' : 'done';
    m.yaw = m.slide = m.drop = m.out = 1;
    m.lift = 0;
    m.step = Math.min(1, (t - riseEnd) / e.step);
  }
  return m;
}
