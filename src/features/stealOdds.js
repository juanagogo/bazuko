// src/features/stealOdds.js
// Lo que pesa al robarle a alguien, sin DOM ni THREE: por dónde se le llega (de espaldas, de lado o de
// frente), si va distraído, si uno llega corriendo, lo que dice el aviso y lo que carga cada quien.
// Lo usa StealSystem (steal.js); las cuentas están aquí para poder probarlas solas.

/** Ajustes del robo. StealSystem guarda una copia en `ajustes` para que las pruebas la puedan mover. */
export const ROBO_ODDS = {
  espalda: { dot: -.35, zona: 1.35, aviso: -.2, marcador: .85 },
  frente: { dot: .35, zona: .7, aviso: .2, marcador: 1.15 },
  distraida: { zona: 1.15, aviso: -.1 },
  corriendo: { speed: 3.2, zona: .75, aviso: .15 },
  avisoMin: .2, avisoMinEspalda: .12, avisoMax: .95,
  zonaMin: .14, zonaMax: .5,
  // Un cosquilleo limpio puede descubrirse después, solo si el jugador sigue cerca (decisión del dueño).
  descubre: { chance: .35, min: 4, max: 8, radio: 10 },
  // Un mirón de frente, cerca, puede ver la mano.
  miron: { chance: .15, radio: 7, mira: .5 },
  // El raponazo: hasta dónde alcanza el tirón al momento del contacto.
  raponazoAlcance: 2.5,
  // La práctica («mano»): cada cosquilleo limpio agranda la zona un 1 %, hasta un 12 %.
  manoPorLimpio: .01, manoMax: .12,
  // Con la mano adentro se anda a esta fracción de la velocidad.
  velocidadConLaMano: .6
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Cómo le llega el jugador a la víctima. La víctima mira hacia (sin yaw, cos yaw) de su raíz; el jugador,
 * igual. `lado` dice con qué mano robar: 1 la derecha (la víctima queda a su derecha o al frente), -1 la
 * izquierda. Sin raíz (las pruebas con peatones de mentira) cuenta como de lado.
 */
export function ventajaDeRobo(playerPos, npc, { playerSpeed = 0, playerYaw = null, odds = ROBO_ODDS, out = {} } = {}) {
  let posicion = 'lado', lado = 1;
  const dx = (playerPos?.x ?? 0) - (npc?.position?.x ?? 0), dz = (playerPos?.z ?? 0) - (npc?.position?.z ?? 0);
  const d = Math.hypot(dx, dz);
  const yaw = npc?.root?.rotation?.y;
  if (Number.isFinite(yaw) && d > 1e-4) {
    // Hacia dónde mira la víctima, contra hacia dónde queda el jugador.
    const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d;
    posicion = dot <= odds.espalda.dot ? 'espalda' : dot >= odds.frente.dot ? 'frente' : 'lado';
  }
  if (Number.isFinite(playerYaw) && d > 1e-4) {
    // La víctima en el marco del jugador: +x su izquierda. A la izquierda clara, mano izquierda.
    const local = (Math.cos(playerYaw) * -dx - Math.sin(playerYaw) * -dz) / d;
    lado = local > .35 ? -1 : 1;
  }
  const distraida = !!npc?.moving || !!npc?.witnessing;
  const corriendo = playerSpeed > odds.corriendo.speed;
  let zonaMult = 1, marcadorMult = 1, avisoExtra = 0;
  if (posicion === 'espalda') { zonaMult *= odds.espalda.zona; avisoExtra += odds.espalda.aviso; marcadorMult *= odds.espalda.marcador; }
  if (posicion === 'frente') { zonaMult *= odds.frente.zona; avisoExtra += odds.frente.aviso; marcadorMult *= odds.frente.marcador; }
  if (distraida) { zonaMult *= odds.distraida.zona; avisoExtra += odds.distraida.aviso; }
  if (corriendo) { zonaMult *= odds.corriendo.zona; avisoExtra += odds.corriendo.aviso; }
  out.posicion = posicion; out.distraida = distraida; out.corriendo = corriendo;
  out.zonaMult = zonaMult; out.marcadorMult = marcadorMult; out.avisoExtra = avisoExtra; out.lado = lado;
  return out;
}

/**
 * La probabilidad de que la víctima note un cosquilleo fallido. `talento` es el multiplicador de
 * «Mano suave» (stealCaughtMult). De espaldas el piso es más bajo; nunca es seguro ni imposible.
 */
export function probabilidadDeAviso({ alerta = .5, perro = 0, fama = 0, franja = 0, ventaja = null, talento = 1, odds = ROBO_ODDS } = {}) {
  const base = Math.max(odds.avisoMin, alerta - perro + fama + franja) + (ventaja?.avisoExtra ?? 0);
  const piso = ventaja?.posicion === 'espalda' ? odds.avisoMinEspalda : odds.avisoMin;
  return clamp(base * (Number.isFinite(talento) ? talento : 1), piso, odds.avisoMax);
}

// Los cuatro avisos posibles, armados una vez: se piden cada cuadro que hay alguien cerca.
const AVISO = (nota) => nota ? `[E] Cosquilleo · ${nota} · [Q] Robo directo` : '[E] Cosquilleo · [Q] Robo directo';
const AVISOS = { espalda: AVISO('de espaldas, ni me ve'), frente: AVISO('de frente: me está viendo'), distraida: AVISO('va en lo suyo'), nada: AVISO(null) };

/** El aviso: primero el cosquilleo, luego cómo está la cosa y al final la Q (el dedo se queda con las teclas). */
export function avisoDeRobo(ventaja) {
  return ventaja?.posicion === 'espalda' ? AVISOS.espalda
    : ventaja?.posicion === 'frente' ? AVISOS.frente
      : ventaja?.distraida ? AVISOS.distraida : AVISOS.nada;
}

/** Lo que carga cada quien: la plata es una fracción del botín normal, y lo que se le puede sacar. */
export const BOTIN_POR_ARQUETIPO = {
  oficinista: { plata: 1, objetos: ['tintico', 'reloj', 'cigarrillo'] },
  senora: { plata: .9, objetos: ['pan', 'moneda', 'tintico'] },
  obrero: { plata: .85, objetos: ['lataComida', 'cigarrillo', 'tintico'] },
  abuelo: { plata: .8, objetos: ['moneda', 'reloj', 'pan'] },
  estudiante: { plata: .7, objetos: ['dulces', 'cigarrillo', 'pan'] },
  reciclador: { plata: .45, objetos: ['cigarrillo', 'pan'] },
  habitante: { plata: .3, objetos: ['cigarrillo', 'pan'] }
};

/** Robarle a uno de los suyos: pillado, el barrio lo cobra más (ver ReputationSystem). */
export const LOS_SUYOS = new Set(['habitante', 'reciclador']);

export function botinDe(npc, porDefecto = null) {
  const entry = BOTIN_POR_ARQUETIPO[npc?.person?.arquetipo];
  return entry ?? { plata: 1, objetos: porDefecto };
}

export const esDeLosSuyos = npc => LOS_SUYOS.has(npc?.person?.arquetipo);

/** La zona de la barra con la práctica: +1 % por cosquilleo limpio, hasta +12 %. */
export function manoMult(limpios, odds = ROBO_ODDS) {
  const n = Number.isFinite(limpios) && limpios > 0 ? limpios : 0;
  return 1 + Math.min(odds.manoMax, n * odds.manoPorLimpio);
}

/** La zona final de la barra, entre sus topes. */
export function zonaDeCosquilleo(base, ventaja, limpios = 0, odds = ROBO_ODDS) {
  return clamp(base * (ventaja?.zonaMult ?? 1) * manoMult(limpios, odds), odds.zonaMin, odds.zonaMax);
}
