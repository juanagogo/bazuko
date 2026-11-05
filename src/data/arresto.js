/**
 * Lo que cuesta que lo coja la Policía, según el nivel de «te tienen fichado» que tenía al caer.
 * Nivel 0 o 1: requisa; se llevan la plata y el vicio. Nivel 2: la plata y todo el costal.
 * Nivel 3: lo mismo y unas horas en el calabozo, sin comer ni beber.
 */
export function castigoDeArresto(nivel) {
  const n = Math.max(0, Math.min(3, Math.floor(nivel) || 0));
  return { nivel: n, todoElCostal: n >= 2, horas: n >= 3 ? CALABOZO_HORAS : 0 };
}

export const CALABOZO_HORAS = 6;
export const CALABOZO_HAMBRE = 25;
export const CALABOZO_SED = 30;
/** Al salir del calabozo el hambre y la sed no bajan de aquí: castiga sin matar. */
export const CALABOZO_PISO = 15;
/** Metros alrededor del cambuche donde, con techo y paredes, la patrulla no lo ve. */
export const ESCONDITE_M = 2.2;
