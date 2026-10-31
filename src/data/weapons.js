// src/data/weapons.js
// Armas cuerpo a cuerpo. Tiempos en segundos; `range` en metros; `arc` es el producto punto mínimo
// entre el frente del jugador y la dirección al peatón (más bajo = arco más ancho).
// El daño se aplica una sola vez, al terminar `windup` (momento del impacto).

export const WEAPONS = {
  punos: {
    id: 'punos', name: 'Puños', hitVerb: 'Puñetazo',
    damage: 12, range: 1.6, arc: 0.3, windup: 0.12, active: 0.08, recovery: 0.22,
    combo: 3, knockback: 0.9, hitAll: false
  },
  cuchillo: {
    id: 'cuchillo', name: 'Cuchillo', hitVerb: 'Cuchillada',
    damage: 28, range: 1.7, arc: 0.2, windup: 0.09, active: 0.06, recovery: 0.2,
    combo: 3, knockback: 0.7, hitAll: true
  },
  botella_picada: {
    id: 'botella_picada', name: 'Botella picada', hitVerb: 'Botellazo',
    damage: 20, range: 1.9, arc: 0.3, windup: 0.16, active: 0.08, recovery: 0.28,
    combo: 2, knockback: 1.2, hitAll: true
  }
};

export const DEFAULT_WEAPON = 'punos';
/** Tiempo tras terminar un golpe en el que pulsar de nuevo continúa el combo. */
export const COMBO_WINDOW = 0.45;
/** Fracción de la recuperación a partir de la cual un golpe en cola cancela el resto y arranca. */
export const CHAIN_AT = 0.4;

/** Tiempos y daño del golpe `step` del combo; el último del combo pega más fuerte y tarda más. */
export function comboStep(weapon, step = 0) {
  const last = weapon.combo > 1 && step >= weapon.combo - 1;
  return {
    step,
    finisher: last,
    damage: weapon.damage * (last ? 1.5 : 1),
    knockback: weapon.knockback * (last ? 1.8 : 1),
    range: weapon.range,
    windup: weapon.windup * (last ? 1.15 : 1),
    active: weapon.active,
    recovery: weapon.recovery * (last ? 1.25 : 1)
  };
}
