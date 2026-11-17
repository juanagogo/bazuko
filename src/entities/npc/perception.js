// src/entities/npc/perception.js
// Ver, oír y asustarse por grados. Un peatón ve en un cono de 115° hasta 16 m (menos de noche o con lluvia) y nota a
// quien tiene encima aunque esté a su espalda; oye lo que suena dentro de su radio. Lo que percibe sube su nivel de
// alerta; el nivel baja solo con el tiempo. Pasar de un nivel a otro pide más que volver: así no titubea en el borde.
import { STIMULI } from './stimuli.js';

export const SENSES = {
  fov: 115 * Math.PI / 180, // cono de visión
  sight: 16,                // m que ve de día y en seco
  night: .6,                // de noche ve a este tanto
  rain: .8,                 // con lluvia, a este tanto
  near: 2.5                 // m: a esta distancia nota a cualquiera, aunque esté a su espalda
};
const HALF_COS = Math.cos(SENSES.fov / 2);

// Niveles: 0 calma, 1 curiosidad, 2 recelo, 3 miedo. `enter[k]` sube del nivel k al k+1; `exit[k]` baja del k+1 al k.
export const ALARM = {
  enter: [.15, .4, .7],
  exit: [.08, .3, .55],
  decay: .07, // por segundo, pasado el aguante
  hold: 2.5   // s sin bajar después de lo último que percibió
};
export const LEVELS = ['calma', 'curiosidad', 'recelo', 'miedo'];

/** Metros que ve según la luz y el clima. */
export function sightRange(night = false, rain = false) {
  return SENSES.sight * (night ? SENSES.night : 1) * (rain ? SENSES.rain : 1);
}

/**
 * ¿Ve el punto (tx, tz) desde (px, pz) mirando con `yaw` (el rumbo del cuerpo: hacia (sin yaw, cos yaw))? Dentro del
 * cono y del alcance, o muy cerca en cualquier dirección.
 */
export function canSee(px, pz, yaw, tx, tz, range) {
  const dx = tx - px, dz = tz - pz, d2 = dx * dx + dz * dz;
  if (d2 > range * range) return false;
  if (d2 < SENSES.near * SENSES.near) return true;
  return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / Math.sqrt(d2) >= HALF_COS;
}

/**
 * Qué tan fuerte le llega un estímulo (0..1): su peso, su intensidad y cuánto se apaga con la distancia, por lo que
 * ve o por lo que oye, lo mayor. 0 si no lo percibe.
 */
export function strength(tipo, d, seen, intensity, radius, range) {
  const spec = STIMULI[tipo];
  if (!spec) return 0;
  let best = 0;
  if (seen && spec.sight && d <= range) best = 1 - (d / range) ** 2;
  const hear = spec.sound ? Math.min(radius, spec.sound) : 0;
  if (hear && d <= hear) best = Math.max(best, 1 - (d / hear) ** 2);
  return best * spec.weight * intensity;
}

/** El nivel que corresponde a `alarm` viniendo de `level`, con histéresis. */
export function levelFor(alarm, level) {
  let next = level;
  while (next < 3 && alarm >= ALARM.enter[next]) next++;
  while (next > 0 && alarm < ALARM.exit[next - 1]) next--;
  return next;
}

/** La alerta después de `elapsed` s: no baja durante el aguante; después, a `decay` por segundo. */
export function decayAlarm(alarm, elapsed, sinceLast) {
  const free = Math.min(elapsed, Math.max(0, sinceLast - ALARM.hold));
  return Math.max(0, alarm - ALARM.decay * free);
}
