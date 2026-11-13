// Física y curvas del salto, sin Three ni DOM. Player las usa para mover la raíz y ActionPose para la
// pose, que depende del estado físico (velocidad vertical, tiempo hasta el suelo, impacto) y no de un
// reloj: la misma lógica sirve para un salto, para caer de un bordillo y para una caída larga.

/**
 * Arco calibrado para que el salto completo llegue a 0,775 m (60 FPS) como antes: el mundo tiene
 * escalones de 0,6 m. La gravedad baja cerca del ápice (el cuerpo flota un instante) y sube al caer
 * (el aterrizaje llega con peso), con el mismo tiempo en el aire (~0,62 s).
 */
export const JUMP = Object.freeze({
  launchSpeed: 5.45,  // m/s al despegar
  riseGravity: 19.5,  // m/s² subiendo
  apexGravity: 11.5,  // |vy| < apexBand
  fallGravity: 23,    // bajando, también al caer de un bordillo
  apexBand: 1,        // m/s
  coyoteTime: .1,     // s después de salir del borde en que todavía se puede saltar
  bufferTime: .12,    // s que se recuerda un salto pedido en el aire antes de tocar el suelo
  cutFactor: .45,     // soltar antes del ápice deja esta parte de la velocidad de subida
  minHold: .1,        // s mínimos de subida completa: un toque da un salto de ~0,53 m a cualquier FPS
  airControl: .4,     // parte de la aceleración del suelo que queda en el aire
  pushTime: .06,      // s de empuje con los pies plantados (solo en la pose; el mando no espera)
  pushCatch: .18,     // s en que la cadera visible alcanza a la raíz después de despegar (en carrera)
  standCatch: .22,    // lo mismo saltando parado, que primero se agacha
  crouch: .05,        // m que baja la cadera visible al despegar parado (solo en la pose)
  crouchTime: .055,   // s que tarda en llegar abajo antes de estirarse
  landingSlow: .4,    // un aterrizaje medio-fuerte deja la velocidad horizontal en 0,6 y la devuelve al recuperarse
  rampSlope: .84,     // subida del piso por metro de avance que todavía es una rampa (~40°); más es un escalón o un borde
  rampBend: .2        // lo que puede cambiar esa pendiente de un cuadro al siguiente sin dejar de ser la misma rampa
});

/**
 * Golpe fuerte al tocar el suelo (empieza a 10,3 m/s, unos 2,3 m de caída, y es completo desde 11,8 m/s,
 * unos 3 m): baja en `fall` s hasta `depth`,
 * se queda `hold` s y se levanta en `rise` s con un rebote pequeño (ζ). `depth` es para una pierna de `leg` m
 * (cadera a tobillo); con piernas más cortas baja en proporción, y la cadera va `back` m atrás (sentadilla).
 * Mientras baja el cuerpo patina y se frena del todo (~14 cm corriendo), se queda quieto en el fondo y recupera
 * la marcha al levantarse (`hardBrake`). Por debajo de esa velocidad el aterrizaje es el de siempre: liviano
 * hasta ~6,5 m/s y medio después (`landingImpact`).
 */
export const HARD_LANDING = Object.freeze({ from: 10.3, to: 11.8, depth: .32, leg: .85, back: .1, fall: .12, hold: .12, rise: .6, omega: 7.8, zeta: .7 });

const clamp01 = value => Math.min(1, Math.max(0, value));
export const smoothstep = (from, to, value) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/**
 * Gravedad de la fase en que va el cuerpo. La banda del ápice (flotar) es solo de los saltos
 * (`floaty`); quien sale de un borde cae con la gravedad de caída desde que deja de subir.
 */
export function jumpGravity(vy, floaty = true) {
  if (vy > JUMP.apexBand) return JUMP.riseGravity;
  return floaty && vy > -JUMP.apexBand ? JUMP.apexGravity : JUMP.fallGravity;
}

/** Velocidad en que termina la fase de `vy` (fin de la subida, fin de la banda); cayendo no hay otra. */
const phaseEnd = (vy, floaty) => vy > JUMP.apexBand ? JUMP.apexBand : floaty && vy > -JUMP.apexBand ? -JUMP.apexBand : -Infinity;

/**
 * Avanza altura y velocidad vertical `dt` segundos con la solución exacta del movimiento uniformemente
 * acelerado por tramos: si dentro del paso termina la subida o la banda del ápice, el resto sigue con la
 * gravedad de la fase nueva. Así el arco es el mismo a cualquier FPS. Escribe en `out` ({ y, vy }) para
 * no crear objetos por cuadro.
 */
export function stepVertical(out, y, vy, dt, floaty = true) {
  let left = dt > 0 ? dt : 0;
  for (let i = 0; i < 3 && left > 0; i++) {
    const g = jumpGravity(vy, floaty), edge = phaseEnd(vy, floaty);
    const until = (vy - edge) / g;
    const t = until < left ? until : left;
    y += vy * t - .5 * g * t * t;
    vy = t === until ? edge : vy - g * t;
    left -= t;
  }
  out.y = y;
  out.vy = vy;
  return out;
}

/** Tiempo hasta bajar `height` metros con velocidad `v` (hacia arriba positiva) y gravedad `g`. */
const descent = (height, v, g) => (v + Math.sqrt(Math.max(0, v * v + 2 * g * height))) / g;

/**
 * Segundos que faltan para tocar un suelo `gap` metros más abajo con velocidad vertical `vy`, por
 * tramos con la gravedad de cada fase (la misma de `stepVertical`). Con `rate` el suelo de delante sube esos
 * m/s mientras avanza (una rampa cuesta arriba; negativo, cuesta abajo).
 */
export function timeToGround(gap, vy, floaty = true, rate = 0) {
  if (!(gap > 0)) return 0;
  if (rate) return rampTime(gap, vy, floaty, rate);
  const band = JUMP.apexBand;
  let time = 0, height = gap, v = vy;
  if (v > band) {
    const g = JUMP.riseGravity;
    time += (v - band) / g; height += (v * v - band * band) / (2 * g); v = band;
  }
  if (floaty && v > -band) {
    const g = JUMP.apexGravity, lost = (band * band - v * v) / (2 * g);
    if (lost >= height) return time + descent(height, v, g);
    time += (v + band) / g; height -= lost; v = -band;
  }
  return time + descent(height, v, JUMP.fallGravity);
}

/** `timeToGround` con el suelo subiendo a `rate` m/s: la altura que falta es la del cuerpo menos la del suelo. */
function rampTime(gap, vy, floaty, rate) {
  let time = 0, height = gap, v = vy;
  for (let i = 0; i < 3; i++) {
    const g = jumpGravity(v, floaty), edge = phaseEnd(v, floaty), rel = v - rate;
    const t = (rel + Math.sqrt(Math.max(0, rel * rel + 2 * g * height))) / g;
    const until = (v - edge) / g;
    if (t <= until) return time + t;
    time += until; height += rel * until - .5 * g * until * until; v = edge;
  }
  return time;
}

/** Hermite cúbica de (y0, v0) a (y1, v1) en `span` s, evaluada en la fracción `s`. */
function hermite(s, y0, v0, y1, v1, span) {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * span * v0 + (3 * s2 - 2 * s3) * y1 + (s3 - s2) * span * v1;
}

/**
 * Cuánto va la cadera visible por debajo de la raíz `t` s después de despegar. La raíz sale a
 * `launchSpeed` de golpe (el mando no espera); la cadera sale de donde estaba (`from` m por debajo de la
 * raíz, subiendo a `fromSpeed` m/s: quieta de pie, o desde el fondo de un aterrizaje) y la alcanza a los `T` s
 * con la misma altura y velocidad del arco (curva de Hermite), así que el empuje se ve sin tirón al arrancar
 * ni al soltarse. Con `crouch` primero baja eso (desde su velocidad y hasta quieta) y se estira de golpe.
 * Depende solo del tiempo: soltar el botón no la cambia.
 */
export function pushOffset(t, launch = JUMP.launchSpeed, crouch = 0, T = JUMP.pushCatch, from = 0, fromSpeed = 0) {
  if (!(t > 0) || t >= T || !(launch > 0)) return 0;
  const g = JUMP.riseGravity;
  const rise = launch * t - .5 * g * t * t;
  const end = launch * T - .5 * g * T * T, endSpeed = launch - g * T;
  const y0 = -Math.max(0, finite0(from)), v0 = finite0(fromSpeed);
  if (!(crouch > 0)) return Math.max(0, rise - hermite(t / T, y0, v0, end, endSpeed, T));
  // Parado: la cadera visible baja `crouch` en `crouchTime` y de ahí se estira de golpe hasta la raíz.
  const tc = Math.min(JUMP.crouchTime, .5 * T), low = y0 - crouch;
  if (t < tc) return Math.max(0, rise - hermite(t / tc, y0, v0, low, 0, tc));
  return Math.max(0, rise - hermite((t - tc) / (T - tc), low, 0, end, endSpeed, T - tc));
}

/**
 * Velocidad con que se va a tocar el suelo desde la altura `gap` y la velocidad vertical `vy`, con la
 * gravedad de caída: en caída libre no cambia mientras baja, así que sirve para preparar el golpe.
 */
export function contactSpeed(vy, gap) {
  const height = Math.max(0, finite0(gap)) + (vy > 0 ? vy * vy / (2 * JUMP.riseGravity) : 0);
  return Math.sqrt((vy < 0 ? vy * vy : 0) + 2 * JUMP.fallGravity * height);
}
const finite0 = value => Number.isFinite(value) ? value : 0;

/** 0 a 1: cuánto de golpe fuerte tiene un contacto a `speed` m/s (continuo entre 10,3 y 11,8 m/s). */
export const hardLanding = speed => smoothstep(HARD_LANDING.from, HARD_LANDING.to, Math.abs(finite0(speed)));
const hardTotal = HARD_LANDING.fall + HARD_LANDING.hold + HARD_LANDING.rise;

/**
 * Marcha que queda en un golpe fuerte, `t` s después de tocar, como fracción de la velocidad horizontal con
 * que tocó: (1 − t/`fall`)⁴ mientras baja, así que patina `fall`/5 de la velocidad (~14 cm a 6 m/s) y llega a
 * cero sin tirón en el fondo; se queda quieto mientras dura el fondo y recupera la marcha mientras se levanta.
 * Una sola curva para el frenazo y la vuelta.
 */
export function hardBrake(t) {
  const { fall, hold, rise } = HARD_LANDING, down = fall + hold;
  if (!(t > 0)) return 1;
  if (t < fall) return (1 - t / fall) ** 4;
  if (t < down) return 0;
  return smoothstep(down, down + rise, t);
}

/**
 * Lo que avanza el cuerpo en un golpe fuerte hasta `t` s después de tocar, en segundos de marcha (la integral
 * de `hardBrake` mientras frena): `fall`/5 al llegar al fondo. Con ella cada cuadro avanza lo que le toca y el
 * patinazo mide lo mismo a 20 o a 144 FPS.
 */
export function hardSlide(t) {
  const { fall } = HARD_LANDING;
  if (!(t > 0)) return 0;
  return fall / 5 * (1 - (1 - Math.min(t, fall) / fall) ** 5);
}

/** Duración del aterrizaje según la velocidad al tocar: 0,18 a 0,45 s y, con un golpe fuerte, ~0,8 s. */
export function landingDuration(speed) {
  const hard = hardLanding(speed);
  return recoveryTime(landingImpact(speed)) * (1 - hard) + hardTotal * hard;
}

/**
 * Perfil de la cadera en un golpe fuerte, `t` s después de tocar (1 = fondo): se dobla hasta el fondo en
 * `fall` s, se queda `hold` s y sube con un resorte poco subamortiguado (pasa
 * ~1,5 cm por encima hacia los 0,42 s de subida y se asienta); vale 0 al terminar.
 */
export function hardProfile(t) {
  const { fall, hold, rise, omega, zeta } = HARD_LANDING;
  if (!(t > 0) || t >= hardTotal) return 0;
  let bend;
  // La rodilla entra a ~12 rad/s y frena hasta el fondo (Hermite: pendiente 1 al tocar, 0 abajo; con 1,5
  // el primer cuadro era un tirón de rodilla de 40 rad/s en las tiras).
  if (t < fall) { const x = t / fall; bend = x + x * x - x * x * x; }
  else if (t < fall + hold) bend = 1;
  else {
    const tau = t - fall - hold, root = Math.sqrt(1 - zeta * zeta), damped = omega * root;
    bend = Math.exp(-zeta * omega * tau) * (Math.cos(damped * tau) + zeta / root * Math.sin(damped * tau));
    bend *= 1 - smoothstep(fall + hold + .8 * rise, hardTotal, t);
  }
  return kneeToHip(bend);
}

// La curva va en ángulo de rodilla (de 25° a ~105°) y se pasa a altura de cadera: con la pierna casi
// estirada un centímetro de cadera es mucho giro de rodilla, así que la cadera arranca despacio (~3 m/s) y la
// rodilla dobla a ritmo parejo: el cuerpo se clava al tocar y se hunde, sin un tirón de rodilla.
const KNEE_FROM = 25 * Math.PI / 180, KNEE_TO = 105 * Math.PI / 180;
const kneeHeight = angle => Math.cos(angle / 2);
const kneeToHip = bend => (kneeHeight(KNEE_FROM) - kneeHeight(KNEE_FROM + bend * (KNEE_TO - KNEE_FROM))) / (kneeHeight(KNEE_FROM) - kneeHeight(KNEE_TO));

/**
 * Bajada de la cámara en un golpe fuerte, de 0 a 1 en ~0,1 s: impulso de un resorte un poco
 * subamortiguado (ζ = 0,55), que al volver se pasa un poco hacia arriba; 0 al terminar el aterrizaje.
 */
export function hardDip(t) {
  if (!(t > 0) || t >= hardTotal) return 0;
  const zeta = .55, damped = 9.9, omega = damped / Math.sqrt(1 - zeta * zeta);
  const peakTime = Math.atan(Math.sqrt(1 - zeta * zeta) / zeta) / damped;
  const peak = Math.exp(-zeta * omega * peakTime) * Math.sin(damped * peakTime);
  return Math.exp(-zeta * omega * t) * Math.sin(damped * t) / peak * (1 - smoothstep(.8 * hardTotal, hardTotal, t));
}

/** 0 en un saltito (≈5 m/s al tocar), ~0,3 en un salto completo, 1 cayendo desde ~2,2 m (10 m/s). */
export const landingImpact = speed => clamp01((Math.abs(speed) - 4.5) / 5.5);
/** Lo que baja la cadera al absorber: de 5 cm a 25 cm. */
export const landingDepth = impact => .05 + .2 * clamp01(impact);
/**
 * Cuánto de esa absorción hace un toque a `speed` m/s contra el piso: entera desde 4,5 m/s (donde empieza
 * `landingImpact`) y en proporción por debajo, así que la cadera sigue bajando con la velocidad con que tocó.
 * Un toque suave (subir una rampa, un escalón al vuelo) casi no se dobla.
 */
export const landingGive = speed => clamp01(Math.abs(finite0(speed)) / 4.5);
/** Lo que tarda en recuperarse: de 0,18 s a 0,45 s. */
export const recoveryTime = impact => .18 + .27 * clamp01(impact);

/**
 * Bajada de la cadera `t` segundos después de tocar el suelo, en metros. Es la respuesta de un resorte
 * críticamente amortiguado que recibe el cuerpo con la velocidad del impacto: frena, llega al fondo y vuelve
 * sin pasarse. Los primeros ~15 ms el pie se asienta (suela y tobillo ceden): la cadera arranca a ~40 % de la
 * velocidad del golpe y la alcanza enseguida, en vez de pasar de quieta a toda velocidad en un cuadro.
 */
export function landingDrop(t, impact) {
  if (!(t >= 0)) return 0;
  const total = recoveryTime(impact), omega = 6 / total, x = omega * (t - SETTLE_LAG * (1 - Math.exp(-t / SETTLE_TIME)));
  return landingDepth(impact) * x * Math.exp(1 - x) * (1 - smoothstep(.8 * total, total, t));
}

const SETTLE_TIME = .015, SETTLE_LAG = .6 * SETTLE_TIME;

/**
 * Brazos al aterrizar, de 0 (como tocaron) a 1 (en reposo): desde el contacto siguen bajando con un resorte
 * subamortiguado (ζ = 0,6) que se pasa ~9 % del reposo y se asienta. La pasada llega ~0,1 s después de que
 * la cadera toque fondo (a `total`/6, `landingDrop`): los brazos van detrás del cuerpo, por inercia, sin
 * quedarse quietos al tocar. `total` es lo que dura el aterrizaje.
 */
export function landingArmsDown(t, total) {
  if (!(t > 0)) return 0;
  const zeta = .6, root = Math.sqrt(1 - zeta * zeta);
  const damped = Math.PI / (Math.max(.15, total) / 6 + .1), omega = damped / root;
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + zeta / root * Math.sin(damped * t));
}

/**
 * Arrastre de los brazos tras el aterrizaje, de -0,3 a 1: siguen bajando 50 ms después de la cadera
 * y rebotan un poco (resorte subamortiguado, ζ = 0,45).
 */
export function landingArms(t, impact) {
  const lag = t - .05;
  if (!(lag > 0)) return 0;
  const total = recoveryTime(impact), omega = 7.5 / total, zeta = .45;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  // Máximo de e^(-ζωt)·sen(ω_d t) para normalizar a 1.
  const peakTime = Math.atan(Math.sqrt(1 - zeta * zeta) / zeta) / damped;
  const peak = Math.exp(-zeta * omega * peakTime) * Math.sin(damped * peakTime);
  return Math.exp(-zeta * omega * lag) * Math.sin(damped * lag) / peak * (1 - smoothstep(.85 * total, 1.2 * total, t));
}

/** Fase que falta para llegar a `goal` (0 a 1) avanzando; una pisada recién alcanzada cuenta como 0. */
const phaseUntil = (phase, goal) => {
  const ahead = ((goal - phase) % 1 + 1) % 1;
  return ahead > 1 - 1e-6 ? 0 : ahead;
};

/** Ritmo relativo del paso en el aire según vy: normal al despegar y cayendo, ~40 % cerca del ápice. */
export const strideShape = vy => .4 + .6 * smoothstep(1.5, 4, Math.abs(vy));
const strideScratch = { y: 0, vy: 0 };

/**
 * Cuánto paso queda por dar hasta el suelo con `strideShape` (∫ forma dτ), por Simpson sobre el arco por
 * tramos que falta. Con esto el paso puede ir lento en el ápice y llegar igual a la pisada al tocar.
 */
function strideWork(vy, timeToGround, floaty) {
  const n = 8, h = timeToGround / n;
  let sum = 0, v = vy;
  for (let k = 0; k <= n; k++) {
    sum += (k === 0 || k === n ? 1 : k % 2 ? 4 : 2) * strideShape(v);
    if (k < n) v = stepVertical(strideScratch, 0, v, h, floaty).vy;
  }
  return sum * h / 3;
}

/**
 * Velocidad con que hay que recorrer `remaining` (fase, en las unidades que sean) para llegar justo al tocar
 * el suelo: con `vy` sigue `strideShape` (rodilla de delante arriba y paso lento en el ápice, más rápido al
 * final); sin `vy`, pareja.
 */
export function airborneStride(remaining, timeToGround, dt, vy = NaN, floaty = true) {
  if (!Number.isFinite(vy)) return remaining / Math.max(timeToGround, dt);
  const shape = strideShape(vy);
  return remaining * shape / Math.max(strideWork(vy, timeToGround, floaty), dt * shape);
}

/**
 * Ciclos por segundo del paso en el aire. Los clips horneados de andar, trote y correr empiezan en la
 * pisada izquierda y tienen la derecha en 0,5: la fase se estira (o se apura hasta 1,8 veces) para
 * llegar a la próxima pisada justo cuando el cuerpo toca el suelo, con el ritmo de `strideShape`. Así se
 * cae sobre el pie adelantado y la carrera sigue sin saltar de fase ni patinar. Sin fase alineada (los clips
 * Mixamo de vista previa no dicen dónde pisan) el paso sigue a su ritmo, como antes: congelarlo dejaba las
 * piernas a media pisada.
 */
export function airborneStrideRate(rate, phase, timeToGround, dt, aligned, vy = NaN, floaty = true) {
  if (!aligned) return rate;
  if (!(timeToGround > 0) || !Number.isFinite(timeToGround)) return rate;
  const remaining = Math.min(phaseUntil(phase, 1), phaseUntil(phase, .5));
  return Math.min(rate * 1.8, airborneStride(remaining, timeToGround, dt, vy, floaty));
}

/** Pie de la próxima pisada en la fase de los clips de paso: 1 izquierdo (fase 0), -1 derecho (0,5). */
export const nextFootfall = phase => phaseUntil(phase, 1) <= phaseUntil(phase, .5) ? 1 : -1;
