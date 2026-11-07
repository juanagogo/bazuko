// src/character/people.js
// El generador de gente: mezcla piezas como un creador de personajes al azar, pero con proporciones y rasgos reales. Solo datos y azar (sin Three, sin catálogo): `rollPerson` de archetypes.js lo usa para dar a cada peatón su piel, contextura, estatura y cara, y `faceParts.js` los dibuja.

// Nadie sale de una plantilla: cada persona tiene una ascendencia principal y, con frecuencia, una segunda que se mezcla. Cada ascendencia solo inclina los pesos de un rasgo y ninguna lo deja en cero, así que una nariz ancha, unos ojos rasgados o unos labios finos pueden aparecer en cualquiera. Con la misma semilla sale siempre la misma persona.

/** Generador con semilla (mulberry32): mismo número, misma secuencia. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla entera a partir de cualquier texto o número. */
export function hashSeed(value) {
  let h = 2166136261;
  for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Elige una clave de una tabla de pesos. */
export function pickWeighted(table, random) {
  let total = 0;
  for (const weight of Object.values(table)) total += weight;
  let roll = random() * total;
  for (const [key, weight] of Object.entries(table)) {
    if (weight <= 0) continue;
    roll -= weight;
    if (roll <= 0) return key;
  }
  return Object.entries(table).find(([, weight]) => weight > 0)?.[0] ?? null;
}

/** Cuánta gente de cada ascendencia principal hay en la ciudad. */
export const POBLACION = { mestiza: .5, europea: .18, afro: .17, indigena: .09, asiatica: .06 };

// Pesos por índice de PALETTES.piel: 0 muy clara, 1 clara, 2 trigueña, 3 morena, 4 oscura, 5 muy oscura, 6 marfil, 7 dorada, 8 cobriza, 9 oliva, 10 ébano, 11 chocolate. Las tablas se cruzan con las vecinas.
export const PIEL = {
  mestiza: { 1: .06, 2: .26, 3: .22, 9: .2, 8: .1, 0: .03, 4: .08, 7: .03, 11: .02 },
  europea: { 6: .16, 0: .26, 1: .28, 9: .12, 2: .12, 7: .03, 3: .03 },
  afro: { 4: .2, 5: .18, 11: .2, 10: .14, 3: .16, 2: .06, 9: .03, 8: .03 },
  indigena: { 8: .32, 3: .26, 2: .14, 4: .12, 9: .1, 11: .03, 7: .03 },
  asiatica: { 7: .46, 1: .16, 6: .12, 9: .1, 2: .1, 0: .06 }
};

// Textura del pelo: 'crespo' es el pelo enroscado (hay una pieza para él), 'liso' y 'ondulado' usan las demás.
const TEXTURA = {
  mestiza: { liso: 4, ondulado: 4, crespo: 1.5 },
  europea: { liso: 5, ondulado: 3.5, crespo: .2 },
  afro: { crespo: 7, ondulado: 1.5, liso: .3 },
  indigena: { liso: 7, ondulado: 1.5, crespo: .1 },
  asiatica: { liso: 8, ondulado: 1, crespo: .05 }
};

/** Cada rasgo: peso de base de cada variante para cualquiera y lo que suma cada ascendencia (o el sexo) a unas pocas. */
export const RASGOS = {
  nariz: {
    base: { media: 3, recta: 3, fina: 2, ancha: 1.5, aguilena: 1, respingada: 1.5, bulbosa: 1, chata: 1 },
    mestiza: { media: 1.5, recta: 1, ancha: .5 },
    europea: { fina: 2, aguilena: 1.5, recta: 1 },
    afro: { ancha: 2.5, bulbosa: 1.5, chata: 1.5 },
    indigena: { aguilena: 1.5, media: 1, ancha: 1 },
    asiatica: { chata: 2, respingada: 1, fina: 1 }
  },
  ojos: {
    base: { redondos: 3, almendrados: 3, rasgados: 1, caidos: 1.5, encapuchados: 1.5, grandes: 2 },
    mestiza: { almendrados: 1, redondos: .5 },
    europea: { encapuchados: 1, redondos: 1, grandes: .5 },
    afro: { grandes: 1.5, redondos: 1.5 },
    indigena: { almendrados: 1.5, rasgados: .8 },
    asiatica: { rasgados: 3, almendrados: 1.5, encapuchados: 1 }
  },
  orejas: { base: { medianas: 4, pegadas: 3, salidas: 1.5, grandes: 1.5, pequenas: 1.5 } },
  cejas: {
    base: { rectas: 3, arqueadas: 2, finas: 2, gruesas: 2.5, pobladas: 1.2, altas: 1 },
    hombre: { gruesas: 1.5, pobladas: 1 },
    mujer: { finas: 1.5, arqueadas: 1.5 }
  },
  boca: {
    base: { media: 4, fina: 2.5, llena: 2.5, 'muy-llena': 1, ancha: 1.2, pequena: 1.3 },
    mestiza: { media: 1 },
    europea: { fina: 1.5 },
    afro: { llena: 2, 'muy-llena': 1.2 },
    indigena: { media: 1 },
    asiatica: { pequena: 1, media: 1 }
  },
  menton: { base: { normal: 5, prominente: 1.5, cuadrado: 2, puntiagudo: 1.5, hundido: 1 } },
  pomulos: {
    base: { suaves: 4, marcados: 2, altos: 1 },
    indigena: { altos: 1.5, marcados: 1 },
    asiatica: { altos: 1.2, marcados: .8 }
  },
  patillas: { base: { ninguna: 7, cortas: 2, largas: 1 } }
};

/** Nombre de cada variante, para el creador. */
export const ETIQUETAS = {
  nariz: { media: 'Media', recta: 'Recta', fina: 'Fina', ancha: 'Ancha', aguilena: 'Aguileña', respingada: 'Respingada', bulbosa: 'Redonda', chata: 'Chata' },
  ojos: { redondos: 'Redondos', almendrados: 'Almendrados', rasgados: 'Rasgados', caidos: 'Caídos', encapuchados: 'Con párpado', grandes: 'Grandes' },
  orejas: { medianas: 'Medianas', pegadas: 'Pegadas', salidas: 'Salidas', grandes: 'Grandes', pequenas: 'Pequeñas' },
  cejas: { rectas: 'Rectas', arqueadas: 'Arqueadas', finas: 'Finas', gruesas: 'Gruesas', pobladas: 'Pobladas', altas: 'Altas' },
  boca: { media: 'Media', fina: 'Fina', llena: 'Llena', 'muy-llena': 'Muy llena', ancha: 'Ancha', pequena: 'Pequeña' },
  menton: { normal: 'Normal', prominente: 'Prominente', cuadrado: 'Cuadrado', puntiagudo: 'Puntiagudo', hundido: 'Hundido' },
  patillas: { ninguna: 'Ninguna', cortas: 'Cortas', largas: 'Largas' }
};

export const RASGOS_IDS = Object.fromEntries(Object.entries(RASGOS).map(([key, spec]) => [key, Object.keys(spec.base)]));

/** Rasgos que el creador deja elegir; los demás (pómulos) solo salen de la generación. */
export const RASGOS_CREADOR = ['nariz', 'ojos', 'cejas', 'boca', 'orejas', 'menton', 'patillas'];

export const CONTEXTURAS = {
  delgado: { ancho: [.8, .92], peso: .27 },
  normal: { ancho: [.93, 1.06], peso: .5 },
  robusto: { ancho: [1.12, 1.38], peso: .23 }
};

// Límites de la talla que aguanta el cuerpo: alto (todo el modelo), ancho (de lado a lado) y cabeza respecto a lo demás.
export const TALLA = { alto: [.58, 1.12], ancho: [.58, 1.45], cabeza: [.9, 1.45] };

// Niños: el cuerpo joven más chico y de cabeza proporcionalmente grande.
export const NINO = { alto: [.64, .86], cabeza: [1.18, 1.34] };

const ALTO_EDAD = { joven: 1, adulto: 1, mayor: .965 };
const CONTEXTURA_EDAD = {
  joven: { delgado: 1.25, normal: 1, robusto: .75 },
  adulto: { delgado: 1, normal: 1, robusto: 1 },
  mayor: { delgado: .8, normal: 1, robusto: 1.4 }
};

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));
const range = ([low, high], random) => low + random() * (high - low);

// Suma de dos uniformes, centrada: la mayoría cerca del promedio y algunos muy bajos o muy altos.
const bell = random => (random() + random()) / 2;

/** Mezcla de ascendencias de una persona: `[[nombre, fracción], ...]`, la principal primero. */
export function rollLinaje(random, { pesos = POBLACION } = {}) {
  const primaria = pickWeighted(pesos, random);
  if (random() >= .38) return [[primaria, 1]];
  const otras = Object.fromEntries(Object.entries(POBLACION).filter(([name]) => name !== primaria));
  const mezcla = +(.15 + random() * .35).toFixed(2);
  return [[primaria, +(1 - mezcla).toFixed(2)], [pickWeighted(otras, random), mezcla]];
}

function mezclar(tablas, linaje) {
  const out = {};
  for (const [name, fraction] of linaje) for (const [key, weight] of Object.entries(tablas[name])) out[key] = (out[key] ?? 0) + weight * fraction;
  return out;
}

function rasgoTabla(rasgo, linaje, sexo) {
  const spec = RASGOS[rasgo];
  const table = { ...spec.base };
  for (const [name, fraction] of linaje) {
    for (const [key, extra] of Object.entries(spec[name] ?? {})) table[key] += extra * fraction;
  }
  for (const [key, extra] of Object.entries(spec[sexo] ?? {})) table[key] += extra;
  return table;
}

/** Toda la cara: una variante por rasgo, y la forma general de la cabeza. */
export function rollRostro(random, linaje, sexo, edad) {
  const rostro = {};
  for (const rasgo of Object.keys(RASGOS)) rostro[rasgo] = pickWeighted(rasgoTabla(rasgo, linaje, sexo), random);
  if (sexo === 'mujer') rostro.patillas = 'ninguna';
  rostro.ancho = +(.93 + bell(random) * .14).toFixed(3);
  rostro.largo = +(.94 + bell(random) * .12).toFixed(3);
  if (edad === 'mayor' && rostro.pomulos === 'suaves' && random() < .4) rostro.pomulos = 'marcados';
  return rostro;
}

/** Cara limpia: lo que falte o no exista pasa a la primera variante de cada rasgo. */
export function normalizeRostro(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [rasgo, ids] of Object.entries(RASGOS_IDS)) out[rasgo] = ids.includes(raw[rasgo]) ? raw[rasgo] : ids[0];
  out.ancho = Number.isFinite(raw.ancho) ? Math.min(1.12, Math.max(.9, raw.ancho)) : 1;
  out.largo = Number.isFinite(raw.largo) ? Math.min(1.1, Math.max(.9, raw.largo)) : 1;
  return out;
}

/** Contextura, estatura y proporciones. `sesgo` es lo que el arquetipo suma al ancho (el obrero es más fornido que el oficinista); `nino` achica el cuerpo y agranda la cabeza. */
export function rollTallaCuerpo(random, { sexo, edad, sesgo = 0, nino = false }) {
  if (nino) {
    const alto = +range(NINO.alto, random).toFixed(3);
    return { contextura: 'normal', talla: { alto, ancho: +(alto * (.97 + random() * .08)).toFixed(3), cabeza: +range(NINO.cabeza, random).toFixed(3) } };
  }
  const pesos = Object.fromEntries(Object.entries(CONTEXTURAS).map(([name, spec]) => [name, spec.peso * CONTEXTURA_EDAD[edad][name]]));
  const contextura = pickWeighted(pesos, random);
  const alto = clamp(ALTO_EDAD[edad] * (1 + (bell(random) - .5) * .42), TALLA.alto);
  const ancho = clamp(range(CONTEXTURAS[contextura].ancho, random) + sesgo, TALLA.ancho);
  return { contextura, talla: { alto: +alto.toFixed(3), ancho: +ancho.toFixed(3), cabeza: 1 } };
}

/** Talla limpia, dentro de lo que aguanta el cuerpo. La cabeza solo se anota si no es la de siempre. */
export function normalizeTalla(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const alto = Number.isFinite(raw.alto) ? clamp(raw.alto, TALLA.alto) : 1;
  const ancho = Number.isFinite(raw.ancho) ? clamp(raw.ancho, TALLA.ancho) : 1;
  const cabeza = Number.isFinite(raw.cabeza) ? clamp(raw.cabeza, TALLA.cabeza) : 1;
  return cabeza === 1 ? { alto, ancho } : { alto, ancho, cabeza };
}

/** Cómo se llama una altura. */
export const estatura = alto => (alto < .9 ? 'baja' : alto > 1.07 ? 'alta' : 'media');

/** Lo que decide la ascendencia: piel (índice de PALETTES.piel), textura del pelo y cara. `sol` carga un poco hacia los tonos curtidos a quien pasa el día a la intemperie. */
export function rollAscendencia(random, { sexo, edad, pesos, sol = false }) {
  const linaje = rollLinaje(random, { pesos });
  const piel = mezclar(PIEL, linaje);
  if (sol) for (const tone of [2, 3, 4, 8, 9]) if (piel[tone]) piel[tone] *= 1.3;
  return {
    linaje,
    piel: +pickWeighted(piel, random),
    textura: pickWeighted(mezclar(TEXTURA, linaje), random),
    rostro: rollRostro(random, linaje, sexo, edad)
  };
}
