// src/systems/RoboArmed.js
// El árbol de decisión del robo armado: qué plan trae el ladrón y qué hace en cada momento según lo que haga el jugador.
// Es una función pura del azar que se le pase, para poder probarla con semilla.

export const ARMED = {
  shootAnyway: .15,      // de los robos, los que disparan sin más aunque el jugador entregue
  passive: .2,           // los que se conforman con revisarlo, como el robo de siempre
  choroChance: .25,      // de los ladrones, los «pegados»: trabados de algo, erráticos
  cockFirst: .8,         // de los de pistola, los que rastrillan antes de exigir
  cockTime: .9,          // s: lo que dura el sonido de rastrillar
  triggerDelay: 1.4,     // s apuntando antes de que el que dispara sin más lo haga
  patience: 3.5,         // s apuntando antes de dispararle al que no entrega
  moveTolerance: 1.6,    // m que puede moverse el jugador sin que cuente como moverse
  hesitate: 2.2,         // s extra que duda el pegado que titubea
  pointBlank: .8         // de acierto a quemarropa; de lejos vale el de siempre
};

export const GUN_DEMANDS = [
  '¡Quieto, gonorrea, pase todo!',
  '¡Las manos donde las vea y suelte la plata!',
  '¡Quieto o lo quemo, parcero!'
];
export const KNIFE_DEMANDS = [
  '¡Quieto, gonorrea, que lo pincho!',
  '¡Suelte todo y no se me haga el loco!',
  '¡Sin chistar, o lo abro!'
];
export const CHORO_LINES = ['¿Qué me mira?', '¿Qué, qué, qué?', '¡No me mire así, parce!', '¿Usted qué, usted qué?'];
export const CHORO_QUIRKS = ['early', 'air', 'random', 'hesitate', 'run'];

/**
 * El plan con el que baja el ladrón. `style`: passive (revisa como siempre), threat (exige y dispara o apuñala si no entregan)
 * o trigger (dispara sin más). `choro`: va pegado de algo, con su manía: `early` actúa antes de exigir, `air` dispara al aire,
 * `random` se arrepiente de dejar entregar, `hesitate` titubea y `run` se asusta y se va.
 */
export function planRobbery({ weapon = 'cuchillo', random = Math.random, armed = true } = {}) {
  if (!armed) return { weapon, style: 'passive', choro: false, quirk: null, cocks: false };
  const choro = random() < ARMED.choroChance;
  const roll = random();
  const style = roll < ARMED.shootAnyway ? 'trigger' : roll < ARMED.shootAnyway + ARMED.passive ? 'passive' : 'threat';
  const quirk = choro ? CHORO_QUIRKS[Math.floor(random() * CHORO_QUIRKS.length) % CHORO_QUIRKS.length] : null;
  const cocks = weapon === 'pistola' && style !== 'passive' && random() < ARMED.cockFirst;
  return { weapon, style, choro, quirk, cocks, aired: false };
}

/**
 * Qué hace ahora: 'cock' (rastrilla), 'point' (apunta y espera), 'wait' (sigue en lo suyo), 'shoot', 'stab', 'air' (tiro al aire),
 * 'run' (se asusta y se va) o 'rob' (el jugador entregó). `phase`: arrive (recién llegó), cock (rastrillando) o point (exigiendo).
 */
export function armedAct(plan, { phase, t = 0, giveIn = false, moved = false, ran = false, attacked = false, random = Math.random } = {}) {
  const violence = plan.weapon === 'pistola' ? 'shoot' : 'stab';
  if (phase === 'arrive') {
    if (plan.quirk === 'early') return violence;
    return plan.cocks ? 'cock' : 'point';
  }
  if (phase === 'cock') {
    if (t < ARMED.cockTime) return 'wait';
    if (plan.quirk === 'air' && !plan.aired) return 'air';
    if (plan.quirk === 'run') return 'run';
    return plan.style === 'trigger' ? violence : 'point';
  }
  if (plan.style === 'trigger' && t >= ARMED.triggerDelay) return violence;
  if (plan.quirk === 'hesitate' && t < ARMED.hesitate) return 'wait';
  if (plan.quirk === 'air' && !plan.aired && t >= 1) return 'air';
  if (plan.quirk === 'run' && t >= 1.5) return 'run';
  if (giveIn) return plan.quirk === 'random' && random() < .5 ? violence : 'rob';
  if (attacked || moved || ran) return violence;
  if (t >= ARMED.patience + (plan.quirk === 'hesitate' ? ARMED.hesitate : 0)) return violence;
  return 'wait';
}
