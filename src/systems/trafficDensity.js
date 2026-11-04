// src/systems/trafficDensity.js
// Cuánta flota quiere la ciudad según la hora y el nivel elegido. Sin DOM ni Three: lo comparten menú, juego y pruebas.

// Cada nivel fija la flota del mediodía; la hora la escala y la densidad elegida la multiplica.
// El techo sale de la prueba de flota: por encima de unos 90 carros los cruces de la ciudad se atascan.
const MAX_VEHICLES = 90, MIN_VEHICLES = 4;

export const TRAFFIC_DENSITY_LEVELS = [
  { id: 'baja', label: 'Baja', midday: 18 },
  { id: 'normal', label: 'Normal', midday: 30 },
  { id: 'alta', label: 'Alta', midday: 34 },
  { id: 'maxima', label: 'Máxima', midday: 38 },
];
export const DEFAULT_TRAFFIC_DENSITY = 'normal';

function level(id) {
  return TRAFFIC_DENSITY_LEVELS.find(level => level.id === id)
    ?? TRAFFIC_DENSITY_LEVELS.find(level => level.id === DEFAULT_TRAFFIC_DENSITY);
}

/** Nivel válido; cualquier otra cosa (sin guardar, corrupta) cae en el de siempre. */
export function trafficDensityId(id) { return level(id).id; }

export function trafficDensityLabel(id) { return level(id).label; }

/** Vehículos que pide ese nivel a mediodía, antes de que la hora lo module. */
export function trafficDensityMidday(id) { return level(id).midday; }

// El día del juego empieza a las 6. Pico a la entrada (6 a 9) y a la salida (17 a 20), mediodía ocupado y madrugada
// floja. Se interpola entre anclas para que la flota no cambie de golpe al pasar de hora.
const HOUR_CURVE = [
  [0, .3], [5, .3], [6.5, 1.5], [9, 1.5], [12, .9], [16, .9], [18.5, 1.6], [20.5, 1.45], [22, .7], [24, .3],
];

/** Fracción de flota que pide la ciudad a esa hora, respecto al mediodía. */
export function trafficHourFactor(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  for (let i = 0; i < HOUR_CURVE.length - 1; i++) {
    const [a, fa] = HOUR_CURVE[i], [b, fb] = HOUR_CURVE[i + 1];
    if (h <= b) return fa + (fb - fa) * (h - a) / (b - a);
  }
  return HOUR_CURVE.at(-1)[1];
}

/** Vehículos que caben a esa hora y nivel, sin contar las patrullas. */
export function trafficTargetVehicles(hour, densityId) {
  const want = trafficDensityMidday(densityId) * trafficHourFactor(hour);
  return Math.max(MIN_VEHICLES, Math.min(MAX_VEHICLES, Math.round(want)));
}
