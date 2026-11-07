// src/systems/voces/prioridad.js
// Quién se oye cuando dos quieren hablar a la vez. Hay un solo canal de voz grabada (AudioSystem): una frase nueva
// solo corta la que suena si pesa más, o si entra a la fuerza (el arresto). A igual peso, la que ya está sigue.

/** Peso de cada situación: categoría del banco de peatones (npcVoices.js) o voz del mundo (WorldVoices). */
export const PRIORIDAD_VOZ = Object.freeze({
  arrest: 100,
  robbed: 90, carjacked: 90,
  theftChase: 85,
  hit: 80, knockout: 80, grabbed: 80, runOver: 80, raid: 80,
  policeShout: 75,
  witnessCall: 70, witnessTheft: 70, mob: 70, flee: 70,
  witnessFight: 65, witnessRunOver: 65, roadRage: 65,
  radio: 60, poop: 60, taunt: 60,
  begYes: 50, begNo: 50, begFood: 50, shopGreet: 50, shopDirty: 50,
  dealerOpen: 50, dealerDay: 50, dealerBroke: 50, recycler: 50,
  witnessHangUp: 45, witnessFilm: 45,
  smell: 40,
  dealerWhisper: 30,
  busCaller: 25,
  ambient: 20, tomba: 20,
});

/**
 * Lo que pesan las voces que no pasan por playNpcVoice: la del carro (robo del espejo y rebusque), la frase de un
 * conductor al que no dejan pasar y la de la calle. Una voz de peatón sin peso dicho cuenta como `sinPeso`.
 * La de la calle pesa como el resto del ambiente (charla, voceador, jíbaro en voz baja): eso no la corta a media
 * frase, como antes del canal único; lo que le pasa al jugador (desde `smell`) sí.
 */
export const PRIORIDAD_CANAL = Object.freeze({ carro: 90, sinPeso: 50, reclamo: 30, calle: 30 });

export const prioridadDe = category => PRIORIDAD_VOZ[category] ?? 0;
