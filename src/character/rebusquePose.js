// src/character/rebusquePose.js
// La pose de los malabares sobre el cuerpo realista, después del mezclador (la aplica ActionPose, como 'calentarse'):
// las manos suben y bajan con el calendario de la cascada (systems/rebusque/ritmo.js) y la cabeza sigue las pelotas.
// Ejes del personaje: +Z al frente, +X a su izquierda, +Y arriba. Solo brazos y cabeza: los pies no se mueven.
import { BEAT } from '../systems/rebusque/ritmo.js';

const TAU = Math.PI * 2;

/** Fase (0 a 1) del ciclo de una mano: 0 es el instante en que lanza. Mano 0 = derecha, 1 = izquierda. */
export function faseMano(t, mano) {
  const ciclo = 2 * BEAT;
  return (((t - mano * BEAT) % ciclo) + ciclo) % ciclo / ciclo;
}

/**
 * Altura (0 a 1) y apertura (−1 adentro, 1 afuera) de la mano en la cascada: lanza subiendo desde adentro, sale hacia
 * afuera a esperar, agarra bajando y lleva la pelota abajo y adentro para volver a lanzar.
 */
export function manoEnCascada(p) {
  return { alto: .55 + .45 * Math.cos(TAU * (p - .35)), afuera: Math.cos(TAU * (p - .55)) };
}

export function aplicarMalabares(pose, w, t) {
  if (!w) return;
  pose._rotate('head', -.17, 0, 0, w);
  for (const [side, name, mano] of [[1, 'left', 1], [-1, 'right', 0]]) {
    const { alto, afuera } = manoEnCascada(faseMano(t, mano));
    // Codos abajo y pegados; el antebrazo hace todo el trabajo.
    pose._aim(`${name}Arm`, side * .2, -.76 + .08 * alto, .55, w);
    pose._aim(`${name}ForeArm`, side * (.12 + .11 * afuera), -.06 + .5 * alto, .9, w);
    pose._rotate(`${name}Hand`, -.2 - .25 * alto, 0, 0, w);
  }
}
