// src/systems/voces/acceso.js
// Cómo llega a las voces grabadas (AudioSystem.voces) lo que no tiene el audio a mano, como un peatón.

/** El director de voces de la partida en marcha, o null si no hay (pruebas, sala). */
export const vocesDelJuego = () => globalThis.window?.__game?.audio?.voces ?? null;

/** ¿Es el jugador de la partida en marcha? */
export const esElJugador = quien => !!quien && quien === globalThis.window?.__game?.player;
