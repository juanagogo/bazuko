// src/world/bogota/carVariantes.js
// Lo que distingue a un carro de otro del mismo modelo sin cambiar el juego. Todo sale de la semilla revuelta de cada
// carro: no se le pide ni un número al azar.
import { SIN_MATIZ } from './carUso.js';
import { TAXI_YELLOWS } from './carLibreas.js';

/** Amarillos de taxi: el de esmalte nuevo, el asoleado y el anaranjado de los repintados viejos. La lista es la de la librea. */
export const AMARILLOS_TAXI = TAXI_YELLOWS;

const revolver = h => { h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 13; h = Math.imul(h, 0x2c1b3c6d); return (h ^ (h >>> 15)) >>> 0; };

export const amarilloDe = h => AMARILLOS_TAXI[revolver(h) % AMARILLOS_TAXI.length];

// Claridad, viveza y laca: el esmalte de fábrica, el asoleado, el recién polichado y el que ya perdió el brillo.
const MATICES = [SIN_MATIZ, SIN_MATIZ, [1.07, .88, .8], [.92, 1.05, 1.15], [1.03, .8, .62], [.96, .94, 1]].map(Object.freeze);
/** Matiz del esmalte de un particular: dos carros del mismo modelo y tono no salen calcados. */
export const matizDe = h => MATICES[(revolver(h) >>> 9) % MATICES.length];

/** Uno de cada tres populares con algunos años ya cambió la aleación por rin de acero. */
export const conRinDeAcero = h => (revolver(h) >>> 17) % 3 === 1;
