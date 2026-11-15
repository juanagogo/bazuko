// src/systems/rebusque/ritmo.js
// El calendario de la cascada de tres pelotas. Puro y determinista con el tiempo del show: no depende del dt, así que
// da lo mismo a 20 que a 60 cuadros.
//
// Un lanzamiento cada BEAT segundos, alternando manos; cada pelota pasa PERMANENCIA segundos en la palma antes de
// volver a salir. La pose del cuerpo (character/rebusquePose.js) sube cada mano justo cuando lanza.

export const BEAT = .32;                       // s entre lanzamientos
export const PERMANENCIA = .19;                // s que la pelota pasa en la mano antes de volver a salir
