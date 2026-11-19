// Lo que llena la franja del sardinel: canecas dobles, armarios de servicios con afiches, hidrantes, materas,
// bicicleteros, bolsas de basura, lonas de escombro y bolardos de concreto, según el barrio.
// Todo entra al lote de la calle que ya existe: ni mallas, ni materiales, ni texturas nuevas, y nada choca.
// Sitio y clase salen de un hash por baldosa con sales propias: no gasta el azar sembrado de la ciudad.
import { TILE_SIZE } from '../../utils/constants.js';
import { tint, unit } from './StreetBatch.js';
import { neighborhoodAt } from './NeighborhoodIdentity.js';
import { crossings } from './StreetMarkings.js';
import { SIDEWALK_TILES } from './StreetLayout.js';

const T = TILE_SIZE;
const ROADS = new Set(['road', 'busway']);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Sales propias del hash: las de la calle llegan hasta 131. */
const SAL = 200;
const ALTURA_ANDEN = .12;

export const CLASES = ['caneca', 'armario', 'hidrante', 'matera', 'bolsas', 'escombro', 'bici'];

/**
 * Cuánto deja cada barrio. `piezas`: probabilidad por baldosa de andén frente a la vía;
 * `bolardos`: por tramo de tres baldosas; lo demás es el peso de cada clase.
 */
export const MEZCLA = Object.freeze({
  centro: { piezas: .4, bolardos: .09, caneca: 30, armario: 25, hidrante: 7, matera: 8, bolsas: 20, escombro: 10, bici: 0 },
  comercio: { piezas: .42, bolardos: .1, caneca: 30, armario: 22, hidrante: 6, matera: 12, bolsas: 20, escombro: 5, bici: 5 },
  cambuche: { piezas: .46, bolardos: .02, caneca: 6, armario: 12, hidrante: 5, matera: 0, bolsas: 45, escombro: 32, bici: 0 },
  lago: { piezas: .2, bolardos: .06, caneca: 30, armario: 10, hidrante: 8, matera: 30, bolsas: 7, escombro: 0, bici: 15 },
  candelaria: { piezas: .18, bolardos: .05, caneca: 28, armario: 10, hidrante: 10, matera: 32, bolsas: 15, escombro: 5, bici: 0 },
  chapinero: { piezas: .38, bolardos: .1, caneca: 25, armario: 15, hidrante: 6, matera: 25, bolsas: 10, escombro: 4, bici: 15 }
});

/**
 * Media huella a lo largo del sardinel, media huella hacia el andén y distancia del centro al borde del sardinel.
 * Toda pieza queda entre 34 y 70 cm del borde: el carro más ancho que se parquea se monta 20 cm
 * y la gente camina por el centro de la baldosa, a 1 m.
 */
export const FRANJA = Object.freeze({ desde: .34, hasta: .7 });
export const HUELLA = Object.freeze({
  caneca: { medio: .4, fondo: .18, borde: .52 },
  armario: { medio: .45, fondo: .18, borde: .52 },
  hidrante: { medio: .18, fondo: .14, borde: .48 },
  matera: { medio: .72, fondo: .18, borde: .52 },
  bolsas: { medio: .9, fondo: .18, borde: .52 },
  escombro: { medio: .95, fondo: .18, borde: .52 },
  bici: { medio: .78, fondo: .05, borde: .5 },
  bolardo: { medio: .12, fondo: .12, borde: .46 }
});

const LAMINA = tint('#a9ada6');
const LAMINA_OSCURA = tint('#6c7170');
const CONCRETO = tint('#aaa69b');
const CONCRETO_SUCIO = tint('#8f8a7e');
const VERDE_BOTELLA = tint('#4f6a5a');
const AZUL_GRIS = tint('#5b6c7a');
const ROJO_OXIDO = tint('#96402f');
const OCRE = tint('#b3923f');
// Ninguna bolsa es negra del todo: de noche tiene que leerse bajo el farol.
const BOLSA_NEGRA = tint('#2e3034');
const BOLSA_BLANCA = tint('#bdb9ad');
const BOLSA_VERDE = tint('#3f5a4a');
const LADRILLO = tint('#96604a');
const TIERRA = tint('#4a3d2e');
const HOJAS = [tint('#465a30'), tint('#5a6d38'), tint('#6d7a42')];
const GRISES_ARMARIO = [tint('#a7aaa2'), tint('#b3b0a3'), tint('#929a94')];

const scale = (c, s) => [c[0] * s, c[1] * s, c[2] * s];
const elige = (lista, valor) => lista[Math.min(lista.length - 1, Math.floor(valor * lista.length))];

/** Clase de la pieza según los pesos del barrio. */
export function claseDe(mezcla, valor) {
  let total = 0, suma = 0;
  for (const clase of CLASES) total += mezcla[clase];
  for (const clase of CLASES) {
    suma += mezcla[clase];
    if (valor * total < suma) return clase;
  }
  return CLASES[0];
}

// En todas las piezas `a` es el ángulo de la caja con el ancho a lo largo del sardinel y el frente hacia el andén:
// (cos a, −sen a) corre por el sardinel y (sen a, cos a) mira hacia la fachada.

/** Dos canecas de lámina perforada colgadas de un parante, con la bolsa doblada sobre el borde; una va llena. */
function caneca(street, UV, x, y, z, a, seed) {
  const c = Math.cos(a), s = Math.sin(a);
  // Verde botella o gris, siempre oscura y más sucia hacia el fondo: la lámina clara se leía como un dado.
  const lamina = elige([scale(VERDE_BOTELLA, .82), scale(LAMINA_OSCURA, .8), scale(VERDE_BOTELLA, .66), scale(AZUL_GRIS, .7)], unit(seed, 1, SAL + 10));
  const llena = unit(seed, 2, SAL + 10) < .5 ? -1 : 1;
  street.box(x, y, z, .2, .05, .2, a, UV.concrete, CONCRETO_SUCIO, .7);
  street.cylinder(x, y, z, .034, .034, 1.08, 5, UV.plain, LAMINA_OSCURA, .7);
  street.box(x, y + .93, z, .74, .04, .04, a, UV.plain, LAMINA_OSCURA, 1);
  for (const lado of [-1, 1]) {
    const bx = x + lado * .21 * c, bz = z - lado * .21 * s;
    const bolsa = unit(seed, 3 + lado, SAL + 10) < .6 ? BOLSA_NEGRA : BOLSA_BLANCA;
    // La celda de canasta es blanca con rejilla oscura: teñida de oscuro queda como lámina con huecos.
    street.cylinder(bx, y + .38, bz, .122, .16, .5, 10, UV.crate, lamina, .45);
    // La bolsa asoma doblada sobre el borde; adentro, basura hasta arriba o el fondo oscuro.
    street.cylinder(bx, y + .835, bz, .176, .168, .06, 10, UV.plain, bolsa, .8);
    if (lado === llena) street.cylinder(bx, y + .885, bz, .15, .06, .07, 7, UV.plain, scale(bolsa === BOLSA_NEGRA ? BOLSA_BLANCA : BOLSA_NEGRA, .9), .7);
    else street.cylinder(bx, y + .88, bz, .15, .15, .018, 8, UV.plain, scale(bolsa, .35), 1);
  }
}

/** Armario de servicios sobre su dado de concreto, forrado de afiches por las dos caras. */
function armario(street, UV, x, y, z, a, seed) {
  const c = Math.cos(a), s = Math.sin(a);
  const ancho = .58 + unit(seed, 1, SAL + 20) * .2, alto = 1 + unit(seed, 2, SAL + 20) * .35, fondo = .26;
  const gris = elige(GRISES_ARMARIO, unit(seed, 3, SAL + 20));
  street.box(x, y, z, ancho + .1, .1, fondo + .1, a, UV.concrete, CONCRETO_SUCIO, .6);
  // La mitad son de persianas con el pie oxidado; los otros, de lámina lisa con puerta doble y chapa.
  const persianas = unit(seed, 5, SAL + 20) < .5;
  // La celda de persianas ya es gris: el tinte se sube para que el armario no quede más oscuro que el liso.
  street.box(x, y + .1, z, ancho, alto, fondo, a, persianas ? UV.trans : UV.plain, persianas ? scale(gris, 3.1) : gris, .6);
  if (!persianas) {
    street.box(x, y + .16, z, .014, alto - .12, fondo + .008, a, UV.plain, scale(gris, .42), 1);
    street.box(x + .05 * c, y + .1 + alto * .52, z - .05 * s, .035, .09, fondo + .03, a, UV.plain, LAMINA_OSCURA, 1);
    street.box(x, y + .1, z, ancho + .012, .16, fondo + .012, a, UV.rust, [1.25, 1.2, 1.15], .7);
  }
  street.box(x, y + .1 + alto, z, ancho + .05, .035, fondo + .05, a, UV.plain, scale(gris, .7), 1);
  const avisos = [UV.adA, UV.adB, UV.adC, UV.adD, UV.paintA, UV.paintB, UV.paintC, UV.paintD];
  for (const cara of [1, -1]) {
    const n = 2 + Math.floor(unit(seed, 4 + cara, SAL + 21) * 3);
    for (let i = 0; i < n; i++) {
      const w = .22 + unit(seed, i * 2 + cara, SAL + 22) * .1, h = w * (.95 + unit(seed, i, SAL + 23) * .35);
      const lado = (unit(seed, i * 3 + cara, SAL + 24) - .5) * (ancho - w - .04);
      const sube = .3 + unit(seed, i * 5 + cara, SAL + 25) * (alto - h - .28);
      const fuera = cara * (fondo / 2 + .006 + i * .003);
      // El sol y la lluvia los destiñen: ninguno queda con el color de imprenta.
      const viejo = .6 + unit(seed, i * 7 + cara, SAL + 26) * .3;
      street.box(x + lado * c + fuera * s, y + sube, z - lado * s + fuera * c, w, h, .008, a + (cara < 0 ? Math.PI : 0),
        elige(avisos, unit(seed, i * 11 + cara, SAL + 27)), [viejo, viejo * .97, viejo * .9], 1);
    }
  }
}

/** Hidrante bajito, rojo óxido u ocre, con sus dos bocas. */
function hidrante(street, UV, x, y, z, a, seed) {
  const color = unit(seed, 1, SAL + 30) < .6 ? ROJO_OXIDO : OCRE;
  street.cylinder(x, y, z, .13, .13, .04, 7, UV.plain, scale(color, .7), .8);
  street.cylinder(x, y + .04, z, .092, .082, .46, 7, UV.plain, color, .55);
  street.cylinder(x, y + .5, z, .1, .1, .035, 7, UV.plain, scale(color, .8), 1);
  street.cylinder(x, y + .535, z, .09, .035, .1, 7, UV.plain, color, .9);
  street.box(x, y + .635, z, .045, .04, .045, a, UV.plain, LAMINA_OSCURA, 1);
  street.box(x, y + .31, z, .3, .085, .085, a, UV.plain, scale(color, .9), .85);
  street.box(x - Math.sin(a) * .07, y + .29, z - Math.cos(a) * .07, .11, .11, .14, a, UV.plain, scale(color, .85), .85);
}

/** Matera de concreto prefabricada; algunas con la mata viva y otras con la tierra sola. */
function matera(street, UV, x, y, z, a, seed) {
  const c = Math.cos(a), s = Math.sin(a);
  const largo = .9 + unit(seed, 1, SAL + 40) * .5, fondo = .34, alto = .42;
  const tono = scale(CONCRETO, .85 + unit(seed, 2, SAL + 40) * .2);
  street.box(x, y, z, largo, alto, fondo, a, UV.concrete, tono, .55);
  street.box(x, y + alto - .03, z, largo - .1, .035, fondo - .1, a, UV.plain, TIERRA, 1);
  const matas = unit(seed, 3, SAL + 40) < .2 ? 0 : 2 + Math.floor(unit(seed, 4, SAL + 40) * 3);
  for (let i = 0; i < matas; i++) {
    const lado = ((i + .5) / matas - .5) * (largo - .3) + (unit(seed, i, SAL + 41) - .5) * .08;
    const px = x + lado * c, pz = z - lado * s;
    const r = .11 + unit(seed, i, SAL + 42) * .05, h = .22 + unit(seed, i, SAL + 43) * .3;
    arbusto(street, UV, px, y + alto, pz, c, s, r, h, elige(HOJAS, unit(seed, i, SAL + 44)), unit(seed, i, SAL + 42) * 6.283);
  }
}

const RAMA_SECA = tint('#6b5a45');
const COLILLA = tint('#b9b2a0');

/**
 * Mata de matera: hojas de cinta que salen del pie y se abren, cada una un triángulo que se ve por las dos caras, algo
 * apagadas, con dos o tres ramitas secas entre las verdes. De las materas con mata, tres de cada ocho se quedaron sin
 * ella: con las que ya venían vacías, la mitad muestra la tierra, con colillas o una bolsa tirada.
 * Nada se sale del ancho de la matera, y todo sale del sitio, el radio, la altura y el giro que ya trae la mata.
 */
function arbusto(street, UV, x, y, z, c, s, r, h, hoja, giro) {
  const kx = Math.round(x * 64), kz = Math.round(z * 64);
  if (unit(Math.round(x / T), Math.round(z / T), SAL + 45) < .375) {
    const resto = unit(kx, kz, SAL + 46);
    if (resto < .2) {
      const bolsa = resto < .1 ? BOLSA_BLANCA : BOLSA_NEGRA;
      street.cylinder(x, y, z, .085, .07, .045, 6, UV.plain, bolsa, .6);
      street.cylinder(x, y + .045, z, .07, 0, .04, 6, UV.plain, scale(bolsa, 1.15), 1);
    } else if (resto < .65) {
      for (let i = 0; i < 3; i++) {
        const lado = (unit(kx + i, kz, SAL + 47) - .5) * .2, fuera = (unit(kx, kz + i, SAL + 47) - .5) * .14;
        street.decal?.(x + lado * c + fuera * s, y + .004, z - lado * s + fuera * c, .045, .013, unit(kx + i, kz + i, SAL + 47) * 3.14, UV.plain, COLILLA);
      }
    }
    return;
  }
  if (!street.triangle) return;
  // Diez por ciento menos de saturación que la paleta: cada canal se acerca a su gris.
  const gris = hoja[0] * .3 + hoja[1] * .55 + hoja[2] * .15, verde = hoja.map(v => v + (gris - v) * .1);
  const hojas = 8 + Math.floor(unit(kx, kz, SAL + 48) * 3), secas = 2 + Math.floor(unit(kx, kz, SAL + 49) * 2);
  for (let i = 0; i < hojas + secas; i++) {
    const seca = i >= hojas, rumbo = giro + i * 2.39996 + unit(kx + i, kz, SAL + 50) * .7;
    const largo = (seca ? .22 : .3) + unit(kx, kz + i, SAL + 51) * (seca ? .12 : .15) * Math.min(1.2, .7 + h);
    // A lo largo de la matera la hoja se puede abrir; hacia el andén y la calzada se queda dentro del borde.
    const abre = (seca ? .45 : .3) + unit(kx + i, kz + i, SAL + 52) * (seca ? .4 : .5);
    const along = Math.cos(rumbo) * largo * abre, limite = .15 / Math.max(.15, Math.abs(Math.sin(rumbo) * largo * abre));
    const across = Math.sin(rumbo) * largo * abre * Math.min(1, limite), tendido = Math.hypot(along, across);
    const pie = Math.min(r * .45, .06), bx = Math.cos(rumbo) * pie, bz = Math.sin(rumbo) * pie * .6;
    const ancho = seca ? .008 : .022 + unit(kx + i, kz - i, SAL + 53) * .012;
    const px = -Math.sin(rumbo) * ancho, pz = Math.cos(rumbo) * ancho;
    const en = (a, b, alto) => [x + a * c + b * s, y + alto, z - a * s + b * c];
    const izquierda = en(bx + px, bz + pz, 0), derecha = en(bx - px, bz - pz, 0);
    const punta = en(bx + along, bz + across, Math.sqrt(Math.max(.01, largo * largo - tendido * tendido)));
    const tono = seca ? scale(RAMA_SECA, .8 + unit(kx - i, kz, SAL + 54) * .4) : scale(verde, .8 + unit(kx - i, kz, SAL + 54) * .45);
    const colores = [scale(tono, .5), scale(tono, .5), scale(tono, seca ? 1 : 1.15)];
    const normal = [(along * c + across * s) * .6, 1, (-along * s + across * c) * .6];
    street.triangle(izquierda, derecha, punta, normal, UV.plain, colores);
    street.triangle(derecha, izquierda, punta, normal, UV.plain, [colores[1], colores[0], colores[2]]);
  }
}

/** Dos bicicleteros en U, de tubo, en fila junto al sardinel. */
function bicicletero(street, UV, x, y, z, a, seed) {
  const c = Math.cos(a), s = Math.sin(a);
  const tubo = unit(seed, 1, SAL + 50) < .5 ? LAMINA_OSCURA : tint('#6b7069');
  for (const centro of [-.46, .46]) {
    for (const pata of [-.27, .27]) {
      street.box(x + (centro + pata) * c, y, z - (centro + pata) * s, .045, .76, .045, a, UV.rust, tubo, .6);
    }
    street.box(x + centro * c, y + .76, z - centro * s, .585, .045, .045, a, UV.plain, tubo, 1);
  }
}

/** Bolsas sacadas para el camión: carbón, blancas y verdes, con el hombro caído y el nudo arriba. */
function bolsas(street, UV, x, y, z, a, seed, muchas) {
  const c = Math.cos(a), s = Math.sin(a);
  const n = (muchas ? 4 : 2) + Math.floor(unit(seed, 1, SAL + 60) * 4);
  for (let i = 0; i < n; i++) {
    const lado = (unit(seed, i, SAL + 61) - .5) * 1.3, fuera = (unit(seed, i, SAL + 62) - .5) * .02;
    const px = x + lado * c + fuera * s, pz = z - lado * s + fuera * c;
    // Paradas a lo largo del sardinel, sin meterse en el paso: menos anchas que antes y un poco más altas.
    const clase = unit(seed, i, SAL + 63), r = .13 + unit(seed, i, SAL + 64) * .04, h = .3 + unit(seed, i, SAL + 65) * .14;
    const color = clase < .55 ? BOLSA_NEGRA : clase < .85 ? BOLSA_BLANCA : BOLSA_VERDE;
    // Panza ancha abajo y el nudo chiquito arriba: una bolsa llena se aplasta, no se para en punta.
    street.cylinder(px, y, pz, r, r * .92, h * .62, 7, UV.plain, color, .6);
    street.cylinder(px, y + h * .62, pz, r * .92, .05, h * .3, 7, UV.plain, scale(color, 1.15), 1);
    street.cylinder(px, y + h * .92, pz, .03, .045, .05, 5, UV.plain, scale(color, 1.25), 1);
  }
  if (unit(seed, 2, SAL + 66) < .5) {
    const lado = (unit(seed, 3, SAL + 66) - .5) * .9;
    street.box(x + lado * c, y, z - lado * s, .5, .035, .28, a + (unit(seed, 4, SAL + 66) - .5) * .3, UV.cardboard, [.88, .86, .82], .9);
  }
}

/** Lonas de cascajo paradas en fila, el montón que no cupo y una tabla encima. */
function escombro(street, UV, x, y, z, a, seed) {
  const c = Math.cos(a), s = Math.sin(a);
  const lonas = 2 + Math.floor(unit(seed, 1, SAL + 70) * 3);
  for (let i = 0; i < lonas; i++) {
    const lado = -.75 + i * .34 + (unit(seed, i, SAL + 71) - .5) * .05, fuera = (unit(seed, i, SAL + 72) - .5) * .06;
    const px = x + lado * c + fuera * s, pz = z - lado * s + fuera * c;
    const h = .42 + unit(seed, i, SAL + 73) * .14;
    street.cylinder(px, y, pz, .15, .14, h, 6, UV.sack, [.86, .84, .78], .6);
    street.cylinder(px, y + h, pz, .13, .05, .07, 5, UV.concrete, CONCRETO_SUCIO, .9);
  }
  const trozos = 3 + Math.floor(unit(seed, 2, SAL + 74) * 4);
  for (let i = 0; i < trozos; i++) {
    const lado = .32 + unit(seed, i, SAL + 75) * .46, fuera = (unit(seed, i, SAL + 76) - .5) * .06;
    const w = .12 + unit(seed, i, SAL + 77) * .12, h = .06 + unit(seed, i, SAL + 78) * .12;
    const ladrillo = unit(seed, i, SAL + 79) < .45;
    street.box(x + lado * c + fuera * s, y, z - lado * s + fuera * c, w, h, w * .7, a + unit(seed, i, SAL + 80) * 3,
      ladrillo ? UV.plain : UV.concrete, ladrillo ? LADRILLO : CONCRETO, .6);
  }
  if (unit(seed, 3, SAL + 81) < .6) street.box(x + .5 * c, y + .14, z - .5 * s, .8, .03, .13, a + .12, UV.wood, [.8, .78, .72], .8);
}

/** Bolardo de concreto; alguno pintado de ocre y alguno partido por un carro. */
function bolardo(street, UV, x, y, z, seed, pintado) {
  const tono = scale(CONCRETO, .8 + unit(seed, 1, SAL + 90) * .25);
  if (unit(seed, 2, SAL + 90) < .08) {
    street.cylinder(x, y, z, .115, .1, .13, 7, UV.concrete, scale(tono, .8), .6);
    return;
  }
  const h = .46 + unit(seed, 3, SAL + 90) * .06;
  street.cylinder(x, y, z, .115, .1, h, 7, UV.concrete, tono, .5);
  street.cylinder(x, y + h, z, .1, .045, .055, 7, UV.concrete, scale(tono, 1.05), 1);
  if (pintado) street.cylinder(x, y + h - .13, z, .107, .104, .07, 7, UV.plain, scale(OCRE, .8 + unit(seed, 4, SAL + 90) * .2), 1);
}

const PIEZAS = { caneca, armario, hidrante, matera, bolsas, escombro, bici: bicicletero };

/** La entrada a cada cruce: la rampa al final de la cebra y el andén que lleva a ella. */
function entradas() {
  const lista = [], banda = SIDEWALK_TILES * T;
  for (const { x0, x1, z0, z1 } of crossings()) {
    for (const z of [z0 - banda / 2, z1 + banda / 2]) lista.push([x0, z, 1, 0], [x1, z, -1, 0]);
    for (const x of [x0 - banda / 2, x1 + banda / 2]) lista.push([x, z0, 0, 1], [x, z1, 0, -1]);
  }
  return lista;
}

const enEntrada = (lista, px, pz) => lista.some(([x, z, dx, dz]) => {
  const along = (px - x) * dz + (pz - z) * dx, into = (px - x) * dx + (pz - z) * dz;
  return Math.abs(along) < 1.3 && into > -1.6 && into < 1;
});

/**
 * Recorre el andén baldosa por baldosa y deja el mobiliario en la franja del sardinel.
 * Devuelve cuántas piezas puso de cada clase; `piezas` trae sitio y clase de cada una.
 */
export function addMobiliarioDenso(street, district, UV, obstacles) {
  const map = district.map, rows = map.length, cols = map[0].length;
  const reglas = district._pedestrianRules?.();
  const esPaso = (tx, tz) => reglas?.isCrossing?.(tx, tz) ?? false;
  const tile = (x, z) => map[Math.round(z / T)]?.[Math.round(x / T)];
  // Un sector del lote que no existe sería una malla nueva: ahí no se pone nada.
  const haySector = (x, z) => street.chunks.has(`${Math.floor(x / street.chunkSize)},${Math.floor(z / street.chunkSize)}`);
  const rampas = entradas();
  const cabe = (x, z, c, s, { medio, fondo }) => {
    for (const i of [-medio, 0, medio]) for (const j of [-fondo, fondo]) {
      const px = x + i * c + j * s, pz = z - i * s + j * c;
      if (tile(px, pz) !== 'sidewalk' || !haySector(px, pz) || enEntrada(rampas, px, pz)) return false;
    }
    return true;
  };
  const cuenta = { bolardo: 0 }, piezas = [];
  for (const clase of CLASES) cuenta[clase] = 0;
  for (let tz = 0; tz < rows; tz++) for (let tx = 0; tx < cols; tx++) {
    if (map[tz][tx] !== 'sidewalk') continue;
    const vias = DIRS.filter(([dx, dz]) => ROADS.has(map[tz + dz]?.[tx + dx]));
    // En la esquina se cruza y se espera el semáforo: queda libre.
    if (vias.length !== 1) continue;
    const [dx, dz] = vias[0];
    if (esPaso(tx + dx, tz + dz)) continue;
    const x = tx * T, z = tz * T, y = ALTURA_ANDEN;
    const barrio = neighborhoodAt(x, z).id, mezcla = MEZCLA[barrio] ?? MEZCLA.centro;
    const a = Math.atan2(-dx, -dz), c = Math.cos(a), s = Math.sin(a);
    const sitio = (lado, borde) => [x + dx * (T / 2 - borde) + lado * c, z + dz * (T / 2 - borde) - lado * s];

    const tramo = dx ? unit(tx, Math.floor(tz / 3), SAL + 1) : unit(Math.floor(tx / 3), tz, SAL + 2);
    if (tramo < mezcla.bolardos) {
      const pintado = (dx ? unit(tx, Math.floor(tz / 3), SAL + 3) : unit(Math.floor(tx / 3), tz, SAL + 4)) < .3;
      for (const lado of [-.5, .5]) {
        const [px, pz] = sitio(lado, HUELLA.bolardo.borde);
        if (!cabe(px, pz, c, s, HUELLA.bolardo) || !obstacles.free(px, pz, .3)) continue;
        bolardo(street, UV, px, y, pz, (tx * 311 + tz * 733 + (lado > 0 ? 97 : 0)) >>> 0, pintado);
        cuenta.bolardo++;
        piezas.push({ clase: 'bolardo', barrio, x: px, z: pz, tx, tz, dx, dz });
      }
      continue;
    }
    if (unit(tx, tz, SAL + 5) >= mezcla.piezas) continue;
    const clase = claseDe(mezcla, unit(tx, tz, SAL + 6)), huella = HUELLA[clase];
    const [px, pz] = sitio((unit(tx, tz, SAL + 7) - .5) * .5, huella.borde);
    if (!cabe(px, pz, c, s, huella) || !obstacles.free(px, pz, Math.max(.45, huella.medio))) continue;
    PIEZAS[clase](street, UV, px, y, pz, a, (tx * 311 + tz * 733) >>> 0, barrio === 'cambuche');
    // Entre dos piezas queda por lo menos metro y medio de sardinel limpio.
    obstacles.add(px, pz, 1.1);
    cuenta[clase]++;
    piezas.push({ clase, barrio, x: px, z: pz, tx, tz, dx, dz });
  }
  return { cuenta, piezas };
}
