// src/systems/voces/robo.js
// Lo que grita con su voz la víctima de un robo: las frases de «robado» de vocesCalle.js, y de ellas solo las que
// cuadran con lo que pasó. Cada una con la voz de quien la grabó: la víctima solo dice las de su voz.
import { frasesDe } from '../../data/vocesCalle.js';

/**
 * Qué frases no cuadran con cada robo. Pillado con la mano adentro todavía no se llevó nada: no dice «me robó el
 * celular» ni «devuélvamelo», y el cosquilleo va al bolsillo, no al bolso. En el raponazo nadie le deja la mano
 * encima: no dice «quite la mano»; y «mi bolso» solo lo grita quien cargaba un bolso.
 */
export const NO_CUADRA = Object.freeze({
  pillado: /me robó|mi bolso|devuélvamelo/i,
  raponazo: /quite la mano/i,
  'raponazo-sin-bolso': /quite la mano|bolso/i,
});

/** El tipo de raponazo según lo que carga la víctima: solo con un bolso encima puede gritar «mi bolso». */
export function tipoDeRaponazo(npc) {
  const carga = npc?.look?.real?.accesorios ?? npc?.person?.real?.accesorios ?? [];
  return carga.some(item => item?.id === 'bolso') ? 'raponazo' : 'raponazo-sin-bolso';
}

/** Las frases de una voz para un robo: 'pillado' (el cosquilleo descubierto), 'raponazo' o 'raponazo-sin-bolso'. */
export function frasesDeRobo(voz, tipo) {
  const noCuadra = NO_CUADRA[tipo];
  if (!voz || !noCuadra) return [];
  return frasesDe('robado', voz).filter(frase => !noCuadra.test(frase.text));
}
