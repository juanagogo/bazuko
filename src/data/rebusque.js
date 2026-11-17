// src/data/rebusque.js
// Rebusque: trabajos informales que se hacen con B, la misma tecla de pedir limosna, a los carros quietos frente a un
// semáforo en rojo. Los lleva `systems/RebusqueSystem.js`.
//
// Campos:
//  - item: lo que hace falta en el costal (no se gasta).
//  - segundos: lo que dura el trabajo; si el carro arranca antes, no paga.
//  - alcance: metros hasta los carros que se atienden. `carros`: cuántos como mucho.
//  - paga: [mínimo, máximo] en pesos por cada conductor que paga (cada uno reacciona según data/rebusqueReacciones.js).
//  - energia: lo que cansa cada vez. `xp`: experiencia por cada conductor que da.
//  - verbo / ocupado / empezar: textos en primera persona (aviso de tecla y tarjeta).
export const REBUSQUE = {
  malabares: {
    id: 'malabares', item: 'malabares',
    verbo: 'Hacer malabares frente a los carros', ocupado: 'Haciendo malabares',
    empezar: 'Me paro frente a los carros y lanzo las pelotas.',
    segundos: 5, alcance: 9, carros: 4, paga: [200, 1000], energia: 5, xp: 4
  }
};

/** Segundos antes de volverle a trabajar al mismo carro. */
export const ESPERA_POR_CARRO = 60;
