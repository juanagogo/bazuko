// src/character/pointing.js
// Señalar con el brazo izquierdo estirado a la altura del hombro (el jefe da la orden), sumado sobre la
// pose del mixer como los golpes. Ejes del personaje: +X su izquierda, +Y arriba, +Z al frente.
import { findBone } from './props.js';
import { rotateInFrame } from './melee.js';

export const POINT_POSE = {
  arm: [-1.52, -0.04, -0.15], // el brazo sube al frente hasta quedar horizontal
  forearm: [0.2, 0, -0.12],    // y el codo se estira
  chest: -0.12,                // el pecho se echa un poco atrás: de pie, mandando
  head: 0                      // la cabeza derecha, mirando a la víctima
};

/** Superposición de señalar para el esqueleto Mixamo. Llamar cada cuadro después de `mixer.update`. */
export function createPointOverlay(bones, frame) {
  const arm = findBone(bones, 'LeftArm');
  const forearm = findBone(bones, 'LeftForeArm');
  const chest = findBone(bones, 'Spine2');
  const head = findBone(bones, 'Head');
  let reach = 0;
  return {
    get active() { return reach > 0.001; },
    /** `amount` de 0 (brazo abajo) a 1 (señalando) */
    apply(dt, amount) {
      reach += ((amount ?? 0) - reach) * Math.min(1, dt * 7);
      if (reach < 0.001) return;
      const P = POINT_POSE, r = reach;
      if (arm) rotateInFrame(frame, arm, P.arm[0] * r, P.arm[1] * r, P.arm[2] * r);
      if (forearm) rotateInFrame(frame, forearm, P.forearm[0] * r, P.forearm[1] * r, P.forearm[2] * r);
      if (chest) rotateInFrame(frame, chest, P.chest * r, 0, 0);
      if (head) rotateInFrame(frame, head, P.head * r, 0, 0);
    }
  };
}
