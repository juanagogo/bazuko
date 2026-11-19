// src/systems/voces/prioridad.js
// Quién se oye cuando dos quieren hablar a la vez. Hay un solo canal de voz grabada (AudioSystem): una frase nueva
// solo corta la que suena si pesa más. A igual peso, la que ya está sigue.

/**
 * Peso de cada situación. De mayor a menor: lo que le pasa al jugador sin remedio (el arresto), lo que él le hace a
 * alguien, lo que le gritan por lo que hizo, lo que contesta alguien a quien le habló y, al final, el ambiente.
 */
export const PRIORIDAD_VOZ = Object.freeze({
  arrest: 100,
  robbed: 90, espejo: 90,
  hit: 80,
  witnessAid: 84, witnessBody: 78,
  policeShout: 75,
  witnessCall: 70, witnessTheft: 70,
  witnessFight: 65,
  radio: 60, poop: 60,
  semaforo: 50, dealerReply: 50, playerReact: 50,
  witnessHangUp: 45, witnessFilm: 45,
  smell: 40,
  pito: 30, dealerWhisper: 30,
  busCaller: 25,
  ambient: 20,
});

/**
 * Lo que pesan las voces que ya había en el juego: la del carro (el reclamo por el espejo robado), la frase de un
 * conductor al que no dejan pasar y la de la calle (las cinco de StreetVoices y las conversaciones entre peatones).
 * Lo que grita la víctima de un robo, lo que le grita un testigo al jugador y lo que contesta un conductor en el
 * semáforo cortan a las dos últimas y esperan a la del carro.
 */
export const PRIORIDAD_CANAL = Object.freeze({ carro: 90, reclamo: 30, calle: 30 });

export const prioridadDe = category => PRIORIDAD_VOZ[category] ?? 0;
