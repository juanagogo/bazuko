// src/entities/npc/temperament.js
// El carácter de cada peatón: sale de su arquetipo (estudiante con afán, abuelo sin prisa) y de su propio azar
// sembrado, no del `Math.random` del juego. Cambia umbrales, no comportamientos: el mismo código decide para todos.

const clamp01 = value => Math.max(0, Math.min(1, value));

// Impaciencia de cada arquetipo (0 espera con calma, 1 se le mete a los carros).
const IMPATIENCE = { estudiante: .75, oficinista: .65, obrero: .55, vendedor: .5, reciclador: .6, habitante: .85, senora: .3, abuelo: .1 };

/**
 * Los cinco modos de reaccionar, como números (y dos rasgos):
 * - `gain`: cuánto le sube la alerta lo que percibe.
 * - `watch`: ganas de arrimarse a mirar (0 nunca, 1 siempre que le dé curiosidad).
 * - `stand`: con miedo, en vez de huir le planta cara a quien se lo causó.
 * - `report`: avisa a gritos a la policía de lo que vio.
 * - `fearReach`: m a los que el peligro lo hace retroceder y huir (o plantarse) cuando ya tiene miedo; más lejos
 *   lo mira con recelo. El curioso mira una pelea a 4 m; el miedoso sale corriendo de lo que alcance a ver.
 * - `far`: ante una pelea, ganas de mirarla de lejos (8 a 10 m) en vez de irse.
 * - `glance`: lo que le llama la atención lo mira de reojo, sin aflojar el paso.
 */
export const TEMPERS = {
  miedoso:     { gain: 1.5,  watch: 0,   stand: 0, report: 0, fearReach: 16,  far: .5, glance: false },
  curioso:     { gain: 1,    watch: 1,   stand: 0, report: 0, fearReach: 3.5, far: 0,  glance: false },
  indiferente: { gain: .45,  watch: 0,   stand: 0, report: 0, fearReach: 3,   far: 0,  glance: true },
  bravo:       { gain: .85,  watch: .5,  stand: 1, report: 0, fearReach: 8,   far: 0,  glance: false },
  avisador:    { gain: 1,    watch: .6,  stand: 0, report: 1, fearReach: 6,   far: 0,  glance: false }
};

// Cómo se reparten por arquetipo.
const MIX = {
  oficinista: { indiferente: .4, miedoso: .25, avisador: .2, curioso: .15 },
  estudiante: { curioso: .4, indiferente: .3, bravo: .15, miedoso: .15 },
  senora: { miedoso: .4, avisador: .3, curioso: .2, indiferente: .1 },
  abuelo: { miedoso: .3, avisador: .3, curioso: .3, indiferente: .1 },
  obrero: { bravo: .3, curioso: .3, indiferente: .3, miedoso: .1 },
  vendedor: { avisador: .3, bravo: .3, curioso: .2, indiferente: .2 },
  reciclador: { indiferente: .5, curioso: .3, bravo: .1, miedoso: .1 },
  habitante: { indiferente: .5, bravo: .2, curioso: .2, miedoso: .1 }
};
const DEFAULT_MIX = { indiferente: .3, curioso: .3, miedoso: .2, avisador: .1, bravo: .1 };

function pick(weights, random) {
  let total = 0;
  for (const key in weights) total += weights[key];
  let roll = random() * total;
  for (const key in weights) if ((roll -= weights[key]) < 0) return key;
  return Object.keys(weights).at(-1);
}

/** El temperamento de `person` (de `rollPerson`) con el azar `random` de su mente. */
export function rollTemperament(person, random) {
  const age = person?.real?.edad === 'mayor' ? -.25 : person?.real?.edad === 'joven' ? .1 : 0;
  const impatience = clamp01((IMPATIENCE[person?.arquetipo] ?? .5) + age + (random() - .5) * .4);
  const tipo = pick(MIX[person?.arquetipo] ?? DEFAULT_MIX, random);
  return { tipo, impatience, ...TEMPERS[tipo] };
}
