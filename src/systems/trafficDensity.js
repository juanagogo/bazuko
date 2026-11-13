// src/systems/trafficDensity.js
// Cuánta flota quiere la ciudad según la hora y el nivel elegido. Sin DOM ni Three: lo comparten menú, juego y pruebas.

// Cada nivel fija la flota del mediodía; la hora la multiplica. Todos son la flota que rodea al jugador.
export const TRAFFIC_DENSITY_LEVELS = [
  { id: 'baja', label: 'Baja', midday: 18 },
  { id: 'normal', label: 'Normal', midday: 30 },
  { id: 'alta', label: 'Alta', midday: 34 },
  { id: 'maxima', label: 'Máxima', midday: 38 },
  { id: 'ultra', label: 'Ultra', midday: 420 },
];
export const DEFAULT_TRAFFIC_DENSITY = 'ultra';

/** Elegir densidad es cosa de desarrolladores: solo con `?trucos` en la dirección. Sin trucos, siempre Ultra. */
export function trafficDensityChoosable(search = '') { return new URLSearchParams(search).has('trucos'); }

// Una de cada cinco busetas: la flota se ve con más de transporte público. Ultra va más cargado de buses.
export const BUSETA_EVERY = 5;
export const ULTRA_BUSETA_EVERY = 12;

/** Cada cuántos vehículos del conteo sale una buseta. */
export function busetaEvery(densityId) {
  return densityId === 'ultra' ? ULTRA_BUSETA_EVERY : BUSETA_EVERY;
}

// Velocidades de crucero en metros por segundo (35 a 45 km/h en vía normal, 50 a 60 en avenida).
export const CRUISE_STREET = [9.7, 12.5];
export const CRUISE_AVENUE = [14, 16.7];
// Las motos pasan los carros y arrancan antes; la buseta es la más pesada.
export const MOTO_SPEED_FACTOR = 1.15;
export const BUSETA_SPEED_FACTOR = .85;
// Un circuito con un tramo recto de esta largura es una avenida.
export const AVENUE_STRAIGHT = 120;

function level(id) {
  return TRAFFIC_DENSITY_LEVELS.find(candidate => candidate.id === id)
    ?? TRAFFIC_DENSITY_LEVELS.find(candidate => candidate.id === DEFAULT_TRAFFIC_DENSITY);
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
  return HOUR_CURVE[HOUR_CURVE.length - 1][1];
}

/** Vehículos que caben a esa hora y nivel, sin contar las patrullas. */
export function trafficTargetVehicles(hour, densityId) {
  return Math.round(trafficDensityMidday(densityId) * trafficHourFactor(hour));
}

// Las motos son una tajada grande de la flota y todavía mayor en las horas pico, cuando el carro se deja quieto.
const MOTO_SHARE_BASE = .3, MOTO_SHARE_PEAK = .4;

/** Fracción de la flota que va en moto a esa hora. */
export function motoShare(hour) {
  // La curva diaria va de .3 en la madrugada a 1.6 en el pico: se lleva a 0..1 y las motos suben con ella.
  const factor = Math.min(1, Math.max(0, (trafficHourFactor(hour) - .3) / 1.3));
  return MOTO_SHARE_BASE + (MOTO_SHARE_PEAK - MOTO_SHARE_BASE) * factor;
}

/** De cada diez vehículos del conteo, desde cuál sale una moto. Sin azar: el tráfico reparte sus modelos con él. */
export function motoThreshold(hour, densityId = null) {
  // Ultra mezcla más motos todavía: es la tajada que más se ve en un semáforo bogotano.
  const share = Math.min(.8, motoShare(hour) + (densityId === 'ultra' ? .3 : 0));
  return Math.round(10 * (1 - share));
}

/** Un circuito con un tramo recto de avenida: recto largo sin radio de giro. Sin Three ni mapa. */
export function routeIsAvenue(route) {
  let longest = 0;
  for (const segment of route.segments ?? []) if (!segment.radius && segment.length > longest) longest = segment.length;
  return longest >= AVENUE_STRAIGHT;
}

/** Velocidad de crucero de un vehículo en su circuito, en metros por segundo. */
export function cruiseSpeedFor(route, random, { moto = false, buseta = false } = {}) {
  const [low, high] = routeIsAvenue(route) ? CRUISE_AVENUE : CRUISE_STREET;
  return (low + random() * (high - low)) * (buseta ? BUSETA_SPEED_FACTOR : moto ? MOTO_SPEED_FACTOR : 1);
}
