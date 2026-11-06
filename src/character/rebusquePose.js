// src/character/rebusquePose.js
// Poses del rebusque sobre el cuerpo realista, después del mezclador (las aplica ActionPose, como 'calentarse'):
//  - malabares: las manos suben y bajan con el calendario de la cascada (systems/rebusque/ritmo.js) y la cabeza
//    sigue las pelotas.
//  - limpiar: inclinado sobre el capó, el brazo derecho barre de lado a lado y el izquierdo se apoya.
//  - ofrecer: la mano derecha estira el dulce hacia la ventana y la izquierda sostiene la chaza.
//  - apartarse: el paso atrás del despeje, con las manos en alto («ya, ya, me quito»).
// Ejes del personaje: +Z al frente, +X a su izquierda, +Y arriba. Solo brazos, columna y cabeza: los pies no se mueven.
import { BEAT, PERMANENCIA } from '../systems/rebusque/ritmo.js';

export const POSES_REBUSQUE = new Set(['malabares', 'limpiar', 'ofrecer', 'apartarse']);

/** Una pasada del rodillo de lado a lado, en segundos. La visual la usa para la espuma. */
export const PASADA_S = 1.25;

const TAU = Math.PI * 2;
const suave = t => t * t * (3 - 2 * t);

/** De −1 a 1 y de vuelta: el barrido del rodillo, con pausa suave en cada orilla. */
export function barrido(t) {
  const fase = ((t / PASADA_S) % 2 + 2) % 2;
  return fase < 1 ? -1 + 2 * suave(fase) : 1 - 2 * suave(fase - 1);
}

/** Fase (0 a 1) del ciclo de una mano: 0 es el instante en que lanza. Mano 0 = derecha, 1 = izquierda. */
export function faseMano(t, mano) {
  const ciclo = 2 * BEAT;
  return (((t - mano * BEAT) % ciclo) + ciclo) % ciclo / ciclo;
}

/** Instante del agarre dentro del ciclo de la mano. */
export const FASE_AGARRE = 1 - PERMANENCIA / (2 * BEAT);

/**
 * Altura (0 a 1) y apertura (−1 adentro, 1 afuera) de la mano en la cascada: lanza subiendo desde adentro, sale hacia
 * afuera a esperar, agarra bajando y lleva la pelota abajo y adentro para volver a lanzar.
 */
export function manoEnCascada(p) {
  return { alto: .55 + .45 * Math.cos(TAU * (p - .35)), afuera: Math.cos(TAU * (p - .55)) };
}

export function aplicarPoseRebusque(pose, tipo, w, t) {
  if (!w || !tipo) return;
  if (tipo === 'malabares') {
    pose._rotate('head', -.17, 0, 0, w);
    for (const [side, name, mano] of [[1, 'left', 1], [-1, 'right', 0]]) {
      const { alto, afuera } = manoEnCascada(faseMano(t, mano));
      // Codos abajo y pegados; el antebrazo hace todo el trabajo.
      pose._aim(`${name}Arm`, side * .2, -.76 + .08 * alto, .55, w);
      pose._aim(`${name}ForeArm`, side * (.12 + .11 * afuera), -.06 + .5 * alto, .9, w);
      pose._rotate(`${name}Hand`, -.2 - .25 * alto, 0, 0, w);
    }
    return;
  }
  if (tipo === 'limpiar') {
    const b = barrido(t);
    pose._rotate('spine', .2, -.12 * b, 0, w);
    pose._rotate('head', .1, 0, 0, w);
    pose._aim('rightArm', -.15 - .55 * b, -.05, .95, w);
    pose._aim('rightForeArm', -.1 - .5 * b, .12, .95, w);
    pose._aim('leftArm', .25, -.6, .75, w);
    pose._aim('leftForeArm', .05, -.35, .95, w);
    return;
  }
  if (tipo === 'ofrecer') {
    const vaiven = .04 * Math.sin(TAU * 1.6 * t);
    pose._rotate('spine', .05, 0, 0, w);
    pose._aim('rightArm', -.14, -.22 + vaiven, .96, w);
    pose._aim('rightForeArm', -.06, .08 + vaiven, .99, w);
    pose._aim('leftArm', .16, -.85, .45, w);
    pose._aim('leftForeArm', -.35, .02, .94, w);
    return;
  }
  if (tipo === 'apartarse') {
    // Retrocede mirando al carro: el pecho atrás y las palmas al frente.
    pose._rotate('spine', -.12, 0, 0, w);
    pose._rotate('head', .04, 0, 0, w);
    for (const [side, name] of [[1, 'left'], [-1, 'right']]) {
      pose._aim(`${name}Arm`, side * .35, -.45, .6, w);
      pose._aim(`${name}ForeArm`, side * .1, .8, .45, w);
      pose._rotate(`${name}Hand`, .5, 0, 0, w);
    }
  }
}
