// src/systems/voces/prioridad.js
// Quién se oye cuando dos quieren hablar a la vez. Hay un solo canal de voz grabada (AudioSystem): una frase nueva
// solo corta la que suena si pesa más. A igual peso, la que ya está sigue.

/** Peso de cada situación de la gente de la calle. */
export const PRIORIDAD_VOZ = Object.freeze({
  witnessCall: 70, witnessTheft: 70,
  witnessFight: 65,
  witnessHangUp: 45, witnessFilm: 45,
  ambient: 20,
});

/**
 * Lo que pesan las voces que ya había en el juego: la del carro (el reclamo por el espejo robado), la frase de un
 * conductor al que no dejan pasar y la de la calle (las cinco de StreetVoices y las conversaciones entre peatones).
 * Lo que le grita un testigo al jugador corta a las dos últimas y espera a la del carro.
 */
export const PRIORIDAD_CANAL = Object.freeze({ carro: 90, reclamo: 30, calle: 30 });

export const prioridadDe = category => PRIORIDAD_VOZ[category] ?? 0;
