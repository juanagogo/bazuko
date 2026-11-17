// src/systems/rebusque/ritmo.js
// El calendario de la cascada de tres pelotas. Puro y determinista con el tiempo del show: no depende del dt, así que
// da lo mismo a 20 que a 60 cuadros.
//
// Un lanzamiento cada BEAT segundos, alternando manos. El lanzamiento k es de la pelota k % 3 y sale de la mano k % 2
// hacia la otra; esa pelota cae VUELO segundos después en la mano que la vuelve a lanzar en k + 3, tras PERMANENCIA
// segundos en la palma. La pose del cuerpo (character/rebusquePose.js) sube cada mano justo cuando lanza y las pelotas
// (RebusqueVisual.js) vuelan con el mismo reloj.

export const BEAT = .32;                       // s entre lanzamientos
export const PERMANENCIA = .19;                // s que la pelota pasa en la mano antes de volver a salir
export const VUELO = 3 * BEAT - PERMANENCIA;   // s en el aire: .77
export const ALTURA = 9.8 * VUELO * VUELO / 8; // m sobre la mano: .73

/** Mano que lanza en k (0 derecha, 1 izquierda). */
export const manoDe = k => k % 2;
