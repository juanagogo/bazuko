// src/character/archetypes.js
// La gente de Bogotá. Cada arquetipo dice cómo se viste, cómo anda y qué hace cuando se para; cada zona
// de la ciudad dice cuántos hay de cada uno. Son solo datos: sin Three, sin catálogo y sin modelos, para
// que un peatón sepa quién es antes de cargar su cuerpo. Las piezas se comprueban contra el catálogo real
// en tests/archetypes.test.js y `normalizeReal` corrige lo que le faltara a un catálogo viejo.
// Nada lleva marcas: los tonos son lisos, a rayas o de franela, y los accesorios no tienen logotipos.
import { DEFAULT_LOOK, SKIN_ALBEDO, randomLook } from './look.js';

// Índices de PALETTES.piel (de muy clara a muy oscura).
const PIEL_CIUDAD = [.1, .25, .28, .21, .11, .05];
const PIEL_CALLE = [.03, .13, .25, .3, .2, .09];

// Índices de PALETTES.pelo: negro, castaño oscuro, castaño, cobrizo, rubio, canoso, blanco, vinotinto, azul.
const PELO_EDAD = {
  joven: [.56, .28, .09, .02, .01, 0, 0, .03, .01],
  adulto: [.5, .28, .1, .01, .01, .1, 0, 0, 0],
  mayor: [.08, .1, .03, 0, 0, .54, .25, 0, 0]
};
// Teñidos que se ven en la calle: solo en mujeres adultas y mayores, y no entre quienes viven en ella.
// El vinotinto de la paleta es del creador: en una señora se ve de carnaval.
const PELO_TINTE = [2, 3, 4];
const PELO_NEGRO = 0, PELO_CASTANO = 2, COBRIZO = 3, RUBIO = 4;

/**
 * Manos que usa cada postura. Quien lleva algo en una mano no pide posturas que la necesiten: el objeto
 * se iría con ella. Lo que no está aquí no usa las manos.
 */
const MANOS = {
  bolsillos: 'ambas', 'brazos-cruzados': 'ambas', 'manos-atras': 'ambas', hablar: 'ambas', 'fumar-quieto': 'ambas',
  atender: 'ambas', barriga: 'ambas', frotarse: 'ambas', encogido: 'ambas', sentado: 'ambas', acurrucado: 'ambas',
  banca: 'ambas', pedir: 'ambas', dormido: 'ambas', huir: 'ambas',
  telefono: 'derecha', celular: 'derecha', paraguas: 'derecha', cubrirse: 'derecha', nariz: 'derecha', rascarse: 'derecha',
  buscar: 'ambas'
};

/** Posturas que bajan la cadera: se entra y se sale de ellas despacio, sin andar. */
export const LOW_STANCES = new Set(['sentado', 'acurrucado', 'banca', 'pedir', 'dormido']);

/**
 * Prendas que dejan al aire el torso o las piernas: ningún cuerpo joven las lleva, ni aquí, ni en el creador,
 * ni en una partida guardada (`normalizeReal`). La rota entra porque su dobladillo roto deja ver la piel.
 * tests/street-look.test.js mide contra los cuerpos reales que esta lista esté completa.
 */
export const UNCOVERED_GARMENTS = new Set(['short', 'sudadera', 'rota']);
export const garmentAllowed = (ropa, edad) => edad !== 'joven' || !UNCOVERED_GARMENTS.has(ropa);

const manoLibre = (postura, mano) => !mano || !MANOS[postura] || (MANOS[postura] !== 'ambas' && MANOS[postura] !== mano);

// `buscar` no es una postura sino un clip (agacharse a mirar en el piso): `Npc` lo pide como acción.
export const SEARCH_ACTION = 'buscar';

/**
 * Cada arquetipo:
 * - `mujer`: probabilidad de que sea mujer. `edad`: pesos por edad.
 * - `ropa`, `pelo`: piezas del catálogo por sexo. `barba`: pesos entre hombres. `calzado`, `cabeza`: pesos.
 * - `desgaste`: valor de `look.real.desgaste`. `tonos`: colores de arriba y abajo; `patron`: pesos de liso, rayas y franela.
 * - `accesorios`: grupos excluyentes `{ p, opciones: [{ id, colores, mano }] }`, con su probabilidad.
 * - `velocidad`: rango en m/s para un hombre; las mujeres de ese paso andan un 12 % menos, como su clip. `andar`: familia de paso.
 * - `estilo`: rangos de `style`. `alto`, `ancho`: rango de la talla.
 * - `paraguas`: probabilidad de llevarlo. `lluvia`: postura de quien no lo lleva, `correr`: cuánto apura el paso.
 * - `pausa`: probabilidad de quedarse un rato al terminar un recorrido. `paradas`: pesos de lo que hace entonces.
 * - `marcha`: probabilidad de andar con cada postura; el resto va con las manos libres.
 * - `frases`: lo que dice además de lo de siempre.
 */
export const ARCHETYPES = {
  oficinista: {
    mujer: .46, edad: { joven: .35, adulto: .58, mayor: .07 },
    ropa: { hombre: ['camisa', 'camisa', 'rayas', 'chaqueta', 'saco'], mujer: ['blusa', 'blusa', 'saco'] },
    pelo: { hombre: ['corto', 'corto', 'corto', 'rapado', 'calvo'], mujer: ['cola', 'melena', 'melena', 'largo', 'corto'] },
    barba: { ninguna: .66, candado: .2, bigote: .14 },
    calzado: { zapatos: 1 }, cabeza: { 'sin-sombrero': 1 }, desgaste: [0],
    tonos: {
      arriba: ['#dfe3e6', '#b9cbdc', '#8f9aa5', '#d8cfc0', '#5e6b7a', '#7a3b3f', '#46525e'],
      abajo: ['#2b2f36', '#3a3f47', '#23272f', '#4a4238', '#33405a'],
      patron: { liso: .82, rayas: .18 }, patronColor: ['#5e6b7a', '#33405a', '#7a3b3f']
    },
    accesorios: [
      { p: .55, opciones: [{ id: 'maletin', mano: 'izquierda', colores: ['#2b2622', '#3a2c20', '#1f2126'] }, { id: 'morral', colores: ['#23262c', '#2f3540'] }] }
    ],
    velocidad: [1.3, 1.5], andar: 'firme', estilo: { swing: [.75, 1.05] }, alto: [.97, 1.06], ancho: [.94, 1.04],
    paraguas: .75, lluvia: 'cubrirse', correr: 1.2, pausa: .42,
    paradas: { telefono: 3, celular: 3, 'brazos-cruzados': 1, 'manos-atras': 1, 'mirar-izquierda': 1, 'mirar-derecha': 1, 'cambiar-peso': 1 },
    marcha: { telefono: .1, celular: .12, bolsillos: .06 },
    frases: ['Permiso, que voy tarde.', 'Sí, ya casi llego a la oficina.', 'Buenas, ¿me regala la hora?']
  },
  estudiante: {
    // Universitarios: gente adulta, ni un cuerpo menudo ni ropa corta.
    mujer: .5, edad: { joven: .65, adulto: .35 },
    ropa: { hombre: ['camiseta', 'camiseta', 'buzo', 'rayas'], mujer: ['blusa', 'blusa', 'saco', 'saco'] },
    pelo: { hombre: ['corto', 'rapado', 'desordenado', 'crespo', 'cola'], mujer: ['cola', 'largo', 'melena', 'crespo'] },
    barba: { ninguna: .8, candado: .14, bigote: .06 },
    calzado: { tenis: 1 }, cabeza: { 'sin-sombrero': .9, 'gorro-lana': .1 }, desgaste: [0],
    tonos: {
      arriba: ['#2f5f8a', '#8a3a3a', '#3f6e52', '#b7a453', '#44474f', '#d5d3cc', '#6a4c7d', '#8f2f4a'],
      abajo: ['#34435e', '#2a3448', '#3f4a5c', '#57554f', '#27272b'],
      patron: { liso: .86, rayas: .14 }, patronColor: ['#27272b', '#d5d3cc']
    },
    accesorios: [{ p: .8, opciones: [{ id: 'morral', colores: ['#2f3a4c', '#3f4d3a', '#5a2f35', '#26272b', '#6b5a3a'] }] }],
    velocidad: [1.02, 1.22], andar: 'normal', estilo: { swing: [.8, 1.1], sway: [0, .25] }, alto: [1, 1.06], ancho: [.94, 1.02],
    paraguas: .35, lluvia: 'cubrirse', correr: 1.3, pausa: .5,
    paradas: { celular: 5, bolsillos: 2, 'cambiar-peso': 2, 'mirar-izquierda': 1, 'mirar-derecha': 1, telefono: 1 },
    marcha: { celular: .2, bolsillos: .14, telefono: .05 },
    frases: ['Qué pereza ese parcial.', '¿Tiene hora? Voy tarde pa\' clase.', 'Parce, ¿por dónde coge el bus?']
  },
  senora: {
    mujer: 1, edad: { adulto: .55, mayor: .45 },
    ropa: { hombre: ['saco'], mujer: ['saco', 'saco', 'blusa'] },
    pelo: { hombre: ['corto'], mujer: ['melena', 'melena', 'corto', 'cola', 'largo'] },
    barba: { ninguna: 1 },
    calzado: { zapatos: .7, tenis: .3 }, cabeza: { 'sin-sombrero': 1 }, desgaste: [0, 0, 1], tinte: .3,
    tonos: {
      arriba: ['#7c4a57', '#5a6e7a', '#76516e', '#4e6a58'],
      abajo: ['#2e2c33', '#3f3a36', '#4c4a55', '#524636'],
      patron: { liso: .9, rayas: .1 }, patronColor: ['#3f3a36', '#d8cfc0']
    },
    accesorios: [
      { p: .95, opciones: [
        { id: 'bolsa', mano: 'izquierda', colores: ['#77766c', '#667076', '#2e3036', '#5f6a5a', '#6b6068'] },
        { id: 'bolsa', mano: 'izquierda', colores: ['#77766c', '#667076', '#2e3036'] },
        { id: 'bolso', colores: ['#3a2c20', '#20242c', '#5a2f35', '#6b5a3a'] }
      ] }
    ],
    velocidad: [1.02, 1.18], andar: 'normal', estilo: { swing: [.75, 1], sway: [.1, .3] }, alto: [.94, 1.02], ancho: [.98, 1.1],
    paraguas: .8, lluvia: 'cubrirse', correr: 1.25, pausa: .55,
    paradas: { 'mirar-izquierda': 2, 'mirar-derecha': 2, 'cambiar-peso': 2, telefono: 1, 'brazos-cruzados': 1, 'manos-atras': 1 },
    marcha: { telefono: .05 },
    frases: ['Ay mijo, cuidado con esa bolsa.', 'Esto está carísimo, Dios mío.', 'Con permiso, mi niño.']
  },
  abuelo: {
    mujer: .3, edad: { mayor: 1 },
    ropa: { hombre: ['saco', 'saco', 'chaqueta', 'camisa'], mujer: ['saco', 'blusa'] },
    pelo: { hombre: ['calvo', 'corto', 'corto', 'rapado'], mujer: ['melena', 'corto', 'cola'] },
    barba: { ninguna: .5, bigote: .36, candado: .08, descuidada: .06 },
    calzado: { zapatos: 1 }, cabeza: { 'sin-sombrero': .55, boina: .4, 'gorro-lana': .05 }, desgaste: [0, 1],
    tonos: {
      arriba: ['#6a5d4d', '#55585c', '#4f5a4a', '#3c3f45', '#7a6a55'],
      abajo: ['#3b3a38', '#4a453d', '#2f3034'],
      patron: { liso: .85, franela: .15 }, patronColor: ['#3b3a38', '#6a5d4d']
    },
    accesorios: [
      { p: .7, opciones: [{ id: 'baston-calle', mano: 'derecha', colores: ['#5f452e', '#3f3128', '#262422'] }] }
    ],
    velocidad: [.66, .8], andar: 'lento', estilo: { stoop: [.28, .5], swing: [.45, .75], limp: [0, .2] }, alto: [.94, 1], ancho: [.94, 1.04],
    paraguas: .35, lluvia: null, correr: 1, pausa: .68,
    paradas: { 'mirar-izquierda': 3, 'mirar-derecha': 3, 'cambiar-peso': 1, 'manos-atras': 4, 'brazos-cruzados': 1 },
    marcha: { 'manos-atras': .5 },
    frases: ['En mis tiempos esto era distinto, mijo.', 'Dios lo bendiga, joven.', '¿Ya almorzó, mijito?']
  },
  obrero: {
    mujer: .05, edad: { joven: .35, adulto: .6, mayor: .05 },
    ropa: { hombre: ['overol', 'overol', 'camiseta', 'chaqueta', 'buzo'], mujer: ['saco'] },
    pelo: { hombre: ['corto', 'rapado', 'rapado', 'calvo'], mujer: ['cola'] },
    barba: { ninguna: .45, bigote: .25, candado: .2, descuidada: .1 },
    calzado: { botas: .85, tenis: .15 }, cabeza: { 'sin-sombrero': 1 }, desgaste: [1],
    tonos: {
      arriba: ['#b5632f', '#2f4d75', '#4a5a3f', '#77736a', '#86622f'],
      abajo: ['#2f4d75', '#3b3f46', '#4b4a44'],
      patron: { liso: 1 }
    },
    accesorios: [{ p: .65, opciones: [{ id: 'casco', colores: ['#d7a92c', '#e3e1da', '#c8662a'] }] }],
    velocidad: [1.22, 1.42], andar: 'firme', estilo: { swing: [.8, 1.1] }, alto: [.97, 1.06], ancho: [1, 1.1],
    paraguas: .05, lluvia: 'cubrirse', correr: 1.2, pausa: .48,
    paradas: { 'fumar-quieto': 3, 'brazos-cruzados': 2, bolsillos: 2, celular: 2, 'mirar-izquierda': 1, 'mirar-derecha': 1 },
    marcha: { bolsillos: .08, celular: .06 },
    frases: ['Qué hubo, maestro.', 'Pilas que ahí van a descargar material.', 'Toca volver a la obra.']
  },
  vendedor: {
    mujer: .42, edad: { joven: .25, adulto: .55, mayor: .2 },
    ropa: { hombre: ['saco', 'buzo', 'camisa', 'chaqueta'], mujer: ['blusa', 'saco'] },
    pelo: { hombre: ['corto', 'rapado', 'desordenado', 'calvo'], mujer: ['cola', 'melena', 'corto'] },
    barba: { ninguna: .5, bigote: .25, descuidada: .15, candado: .1 },
    calzado: { tenis: .55, zapatos: .3, botas: .15 }, cabeza: { 'sin-sombrero': .55, 'gorro-lana': .25, boina: .2 }, desgaste: [1],
    tonos: {
      arriba: ['#5b6a78', '#4f6658', '#8c7a55', '#684f5c', '#3f4852'],
      abajo: ['#34383f', '#413d36', '#2e3640'],
      patron: { liso: .7, rayas: .1, franela: .2 }, patronColor: ['#2e3640', '#413d36']
    },
    accesorios: [{ p: .5, opciones: [{ id: 'bolsa', mano: 'izquierda', colores: ['#2e3036', '#667076'] }, { id: 'bolso', colores: ['#3a2c20', '#20242c'] }] }],
    velocidad: [.98, 1.16], andar: 'normal', estilo: { swing: [.7, 1], stoop: [0, .15] }, alto: [.95, 1.04], ancho: [.96, 1.08],
    paraguas: .5, lluvia: 'cubrirse', correr: 1.25, pausa: .6,
    paradas: { 'brazos-cruzados': 3, celular: 2, 'fumar-quieto': 1, 'mirar-izquierda': 2, 'mirar-derecha': 2, 'cambiar-peso': 1 },
    marcha: { celular: .05 },
    frases: ['Lleve, lleve, a la orden.', 'A la orden el tintico, veci.', '¿Qué le vamos a llevar hoy?', 'Barato, barato, mi rey.']
  },
  reciclador: {
    mujer: .22, edad: { joven: .1, adulto: .62, mayor: .28 },
    ropa: { hombre: ['rota', 'overol', 'buzo', 'saco', 'camiseta'], mujer: ['rota', 'saco'] },
    pelo: { hombre: ['desordenado', 'corto', 'rapado', 'calvo', 'crespo'], mujer: ['cola', 'desordenado', 'largo'] },
    barba: { ninguna: .25, descuidada: .5, bigote: .15, larga: .1 },
    calzado: { 'tenis-rotos': .6, botas: .4 }, cabeza: { 'sin-sombrero': .55, 'gorro-lana': .3, boina: .15 }, desgaste: [1, 2], piel: PIEL_CALLE,
    tonos: {
      arriba: ['#6b6552', '#5a5a52', '#7a6248', '#4b5a5a', '#65594d'],
      abajo: ['#423f38', '#4d4a3e', '#39373a'],
      patron: { liso: .75, franela: .25 }, patronColor: ['#39373a', '#423f38']
    },
    accesorios: [{ p: 1, opciones: [{ id: 'costal', colores: ['#6f6753', '#5f5a4a', '#7a7260', '#55503f'] }] }],
    velocidad: [.78, .94], andar: 'cansado', estilo: { stoop: [.38, .55], headDown: [.1, .3], swing: [.45, .75] }, alto: [.94, 1.02], ancho: [.94, 1.02],
    paraguas: 0, lluvia: 'encogido', correr: 1, pausa: .78,
    paradas: { [SEARCH_ACTION]: 6, 'fumar-quieto': 1, barriga: 1, 'cambiar-peso': 1, 'mirar-izquierda': 1, 'mirar-derecha': 1 },
    marcha: {},
    frases: ['¿Tiene cartón o botellas que no le sirvan?', 'Aquí trabajando, patrón.', 'Con permiso, que voy cargado.']
  },
  habitante: {
    mujer: .18, edad: { joven: .18, adulto: .6, mayor: .22 },
    ropa: { hombre: ['rota', 'rota', 'saco', 'chaqueta', 'buzo', 'overol'], mujer: ['rota', 'saco'] },
    pelo: { hombre: ['desordenado', 'desordenado', 'largo', 'crespo', 'rapado'], mujer: ['desordenado', 'largo', 'cola'] },
    barba: { descuidada: .55, larga: .3, ninguna: .15 },
    calzado: { 'tenis-rotos': .68, botas: .18, descalzo: .14 }, cabeza: { 'sin-sombrero': .72, 'gorro-lana': .28 }, desgaste: [2], piel: PIEL_CALLE,
    tonos: {
      arriba: ['#4f4a42', '#5c5446', '#3e3e3c', '#6a5c4a', '#47504a'],
      abajo: ['#38352f', '#453f36', '#2e2d2c'],
      patron: { liso: .85, franela: .15 }, patronColor: ['#2e2d2c', '#38352f']
    },
    accesorios: [],
    velocidad: [.72, .9], andar: 'cansado', estilo: { stoop: [.35, .6], headDown: [.12, .4], swing: [.3, .7], limp: [0, .25] }, alto: [.94, 1.03], ancho: [.94, 1],
    paraguas: 0, lluvia: 'encogido', correr: 1, pausa: .8,
    paradas: { 'fumar-quieto': 3, encogido: 2, frotarse: 2, rascarse: 2, barriga: 2, pedir: 2, sentado: 3, acurrucado: 2, [SEARCH_ACTION]: 2 },
    marcha: { encogido: .25, bolsillos: .1 },
    frases: ['¿Tiene una monedita que le sobre?', 'Regáleme pa\'l pan, mi rey.', 'Dios se lo pague, vecino.']
  }
};

/** Cuántos de cada uno en cada zona de la ciudad. */
export const ZONE_WEIGHTS = {
  // El Cartucho, la olla: sobre todo quienes viven y rebuscan en la calle.
  cartucho: { habitante: .55, reciclador: .25, vendedor: .08, obrero: .05, abuelo: .04, senora: .03 },
  // Andenes del centro: la mezcla bogotana.
  andenes: { oficinista: .18, estudiante: .14, senora: .16, abuelo: .08, obrero: .14, vendedor: .1, reciclador: .08, habitante: .12 },
  // Barrios: más vecinos que oficinas.
  barrio: { senora: .2, estudiante: .15, oficinista: .12, abuelo: .12, obrero: .14, vendedor: .07, reciclador: .09, habitante: .11 },
  // La Candelaria: universidades y turistas locales.
  candelaria: { estudiante: .3, oficinista: .15, senora: .15, abuelo: .12, vendedor: .1, obrero: .06, habitante: .07, reciclador: .05 },
  // Chapinero: oficinas y estudiantes.
  chapinero: { oficinista: .3, estudiante: .22, senora: .18, abuelo: .08, obrero: .08, vendedor: .05, reciclador: .04, habitante: .05 },
  parque: { abuelo: .2, estudiante: .2, senora: .2, habitante: .15, vendedor: .1, oficinista: .1, reciclador: .05 },
  // Quien aparece de la nada (un conductor bravo, una prueba): cualquiera que no viva en la calle.
  comun: { oficinista: .3, estudiante: .15, senora: .15, obrero: .25, vendedor: .15 }
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const range = ([low, high], random) => low + random() * (high - low);
const fromList = (list, random) => list[Math.floor(random() * list.length) % list.length];

/** Clave de una tabla de pesos, o de una lista de pesos si `table` es un arreglo (devuelve el índice). */
function weighted(table, random) {
  const entries = Array.isArray(table) ? table.map((weight, i) => [i, weight]) : Object.entries(table);
  let total = 0;
  for (const [, weight] of entries) total += weight;
  let roll = random() * total;
  for (const [key, weight] of entries) {
    if (weight <= 0) continue;
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries.find(([, weight]) => weight > 0)?.[0] ?? null;
}

/** Quién anda por esta zona. Una zona desconocida se trata como andén. */
export function pickArchetype(zone = 'andenes', random = Math.random) {
  return weighted(ZONE_WEIGHTS[zone] ?? ZONE_WEIGHTS.andenes, random);
}

// Lab de un color lineal: la distancia aquí se parece a la que ve el ojo.
function linearToLab([r, g, b]) {
  const curve = value => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const x = curve((.4124 * r + .3576 * g + .1805 * b) / .95047);
  const y = curve(.2126 * r + .7152 * g + .0722 * b);
  const z = curve((.0193 * r + .1192 * g + .9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const hexToLinear = hex => [1, 3, 5].map(at => {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
});
const SKIN_LAB = SKIN_ALBEDO.map(linearToLab);

/** Qué tan lejos está un tono de tela de una piel; por debajo de SKIN_CLEARANCE, de lejos parece cuerpo sin ropa. */
export function skinDistance(hex, piel) {
  const [l, a, b] = linearToLab(hexToLinear(hex)), [sl, sa, sb] = SKIN_LAB[piel];
  return Math.hypot(l - sl, a - sa, b - sb);
}
export const SKIN_CLEARANCE = 14;

/** Tono de la lista que no se confunda con esa piel. */
function clothTone(list, piel, random) {
  const clear = list.filter(hex => skinDistance(hex, piel) >= SKIN_CLEARANCE);
  return fromList(clear.length ? clear : list, random);
}

// El zapato de cuero de la textura es naranja: cada quien lo lleva negro, café oscuro o gris.
export const SHOE_TONES = ['#1d1c1c', '#26201d', '#2d2019', '#3a2a20', '#3d3d3f', '#4a4a4b'];

function rollTonos(spec, piel, calzado, random) {
  const patron = weighted(spec.patron ?? { liso: 1 }, random);
  const tonos = { arriba: clothTone(spec.arriba, piel, random), abajo: clothTone(spec.abajo, piel, random), patron };
  if (patron !== 'liso') tonos.patronColor = clothTone(spec.patronColor, piel, random);
  else tonos.patronColor = tonos.abajo;
  if (calzado === 'zapatos') tonos.calzado = fromList(SHOE_TONES, random);
  return tonos;
}

function rollStyle(spec, carry, random) {
  const style = {};
  for (const [key, bounds] of Object.entries(spec)) {
    const value = range(bounds, random);
    if (key === 'swing' ? Math.abs(value - 1) > .02 : value > .02) style[key] = +value.toFixed(3);
  }
  if (carry) style.carry = carry;
  return Object.keys(style).length ? style : null;
}

// El pelo y las cejas rubias sobre piel oscura se ven amarillos, y lo mismo el cobrizo sobre la más oscura.
const hairSuitsSkin = (peloColor, piel) => (peloColor !== RUBIO || piel < 3) && (peloColor !== COBRIZO || piel < 5);

function rollHair(spec, sexo, edad, piel, random) {
  const tinte = spec.tinte && sexo === 'mujer' && random() < spec.tinte;
  const color = tinte ? fromList(PELO_TINTE, random) : weighted(PELO_EDAD[edad], random);
  return hairSuitsSkin(color, piel) ? color : tinte ? PELO_CASTANO : PELO_NEGRO;
}

/**
 * Una persona de ese arquetipo, sin tocar el catálogo. `sinCarga` le quita lo que lleva encima o en la
 * mano (quien está sentado o dormido no sostiene un maletín) y `tallaFija` la deja de 1 × 1, porque una
 * banca está medida para esa altura.
 * @returns {{ arquetipo: string, sexo: string, real: object, piel: number, peloColor: number, speed: number,
 *   andar: string, style: object|null, paraguas: number|null, lluvia: string|null, nariz: boolean, correr: number,
 *   pausa: number, paradas: object, marcha: object, frases: string[] }}
 */
export function rollPerson(id, { random = Math.random, sinCarga = false, tallaFija = false } = {}) {
  const spec = ARCHETYPES[id];
  if (!spec) throw new Error(`Arquetipo desconocido: ${id}`);
  const sexo = random() < spec.mujer ? 'mujer' : 'hombre';
  const edad = weighted(spec.edad, random);
  const accesorios = [];
  let mano = null;
  for (const group of spec.accesorios) {
    if (random() >= group.p) continue;
    const item = fromList(group.opciones, random);
    // Sentado o dormido no se sostiene nada.
    if (sinCarga && item.id !== 'casco') continue;
    accesorios.push({ id: item.id, color: fromList(item.colores, random) });
    mano ??= item.mano ?? null;
  }
  const lleva = id => accesorios.some(item => item.id === id);
  const piel = weighted(spec.piel ?? PIEL_CIUDAD, random);
  const calzado = weighted(spec.calzado, random);
  const real = {
    sexo, edad,
    pelo: fromList(spec.pelo[sexo], random),
    barba: sexo === 'mujer' ? 'ninguna' : weighted(spec.barba, random),
    ropa: fromList(spec.ropa[sexo].filter(ropa => garmentAllowed(ropa, edad)), random),
    calzado,
    cabeza: weighted(spec.cabeza, random),
    desgaste: fromList(spec.desgaste, random),
    tonos: rollTonos(spec.tonos, piel, calzado, random),
    talla: tallaFija ? { alto: 1, ancho: 1 } : {
      alto: +range(spec.alto ?? [.94, 1.06], random).toFixed(3),
      ancho: +range(spec.ancho ?? [.94, 1.1], random).toFixed(3)
    },
    accesorios
  };
  // El casco no cabe sobre una melena ni sobre un sombrero.
  if (lleva('casco')) { real.cabeza = 'sin-sombrero'; if (!['corto', 'rapado', 'calvo'].includes(real.pelo)) real.pelo = 'corto'; }
  const peloColor = rollHair(spec, sexo, edad, piel, random);
  const carry = mano === 'izquierda' || mano === 'derecha' ? mano : null;
  const usable = table => Object.fromEntries(Object.entries(table).filter(([stance]) => manoLibre(stance, mano)));
  const femenino = sexo === 'mujer' ? .88 : 1;
  return {
    arquetipo: id, sexo,
    real,
    piel,
    peloColor,
    speed: +(range(spec.velocidad, random) * femenino).toFixed(3),
    andar: spec.andar,
    style: rollStyle(spec.estilo, carry, random),
    // Solo hay paraguas si esa mano está libre; la paleta es la de `createUmbrella`.
    paraguas: manoLibre('paraguas', mano) && random() < spec.paraguas ? Math.floor(random() * 5) : null,
    lluvia: spec.lluvia && manoLibre(spec.lluvia, mano) ? spec.lluvia : null,
    nariz: manoLibre('nariz', mano),
    correr: spec.correr,
    pausa: spec.pausa,
    paradas: usable(spec.paradas),
    marcha: usable(spec.marcha),
    frases: spec.frases
  };
}

/** Postura de la tabla de paradas; puede salir `buscar`, que es un clip. Sin opciones, null. */
export function pickStop(person, random = Math.random) {
  return Object.keys(person.paradas).length ? weighted(person.paradas, random) : null;
}

/** Con qué postura sale andando; casi siempre ninguna. */
export function pickWalk(person, random = Math.random) {
  let roll = random();
  for (const [stance, chance] of Object.entries(person.marcha)) {
    roll -= chance;
    if (roll <= 0) return stance;
  }
  return null;
}

/** Apariencia lista para el personaje; `real` lo corrige después `normalizeReal` con el catálogo. */
export function personLook(person) {
  const look = randomLook(DEFAULT_LOOK);
  look.piel = person.piel;
  look.peloColor = person.peloColor;
  look.desgaste = person.real.desgaste;
  look.accesorios = [];
  look.real = person.real;
  return look;
}

/** Talla de una apariencia ya normalizada, siempre dentro de lo que el cuerpo aguanta. */
export function normalizeTalla(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const alto = Number.isFinite(raw.alto) ? clamp(raw.alto, .94, 1.06) : 1;
  const ancho = Number.isFinite(raw.ancho) ? clamp(raw.ancho, .94, 1.1) : 1;
  return { alto, ancho };
}
