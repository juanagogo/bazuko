// src/data/rebusqueReacciones.js
// Lo que hace cada conductor al terminar un trabajo en el semáforo. Lo usa systems/rebusque/reacciones.js.
//
// Pesos base por trabajo: la probabilidad de cada reacción sin mugre y sin lluvia.
// La 'paga' va primero en la tirada: con random() = 0 siempre se cobra el mínimo (las pruebas y el E2E dependen de eso).
//
// Balance: unos $1.000 por show de malabares a cuatro carros (unos $1.130 frente al primero de la cola). El techo de
// $3.000 por minuto real lo pone RebusqueSystem (TECHO_MINUTO); la espera de 40 s por esquina y la de 60 s por carro
// hacen que casi nunca se toque. tests/rebusque-reacciones.test.js lo mide.
// Referencias: un día de juego dura 60 min reales; el ciclo del semáforo es de 36 s; 100 de energía alcanzan para
// unos 20 shows; la limosna da $200 a $1.500 cada 4 s.

/** Cómo cuenta cada reacción: positivas (dan algo), neutras (llenan lo que sobra) y hostiles. */
export const CLASE_REACCION = Object.freeze({
  paga: 'positiva', propina: 'positiva', comida: 'positiva',
  excusa: 'neutra', ventana: 'neutra', ignora: 'neutra',
  pito: 'hostil', insulto: 'hostil'
});

/** El orden de la tirada: primero lo que paga. */
export const ORDEN_REACCION = Object.freeze(['paga', 'propina', 'comida', 'excusa', 'ventana', 'ignora', 'pito', 'insulto']);

export const PESOS_REACCION = Object.freeze({
  malabares: { paga: .32, propina: .03, comida: .02, excusa: .24, ventana: .17, ignora: .15, pito: .04, insulto: .03 }
});

/** Propina: billete o monedas de más. */
export const PROPINA = Object.freeze({ min: 1000, max: 2000, billete: 5000, probBillete: .08 });

/** Lo que regalan en vez de plata. */
export const COMIDA_REGALADA = Object.freeze(['pan', 'agua', 'refresco']);

/** Lo que grita el conductor que insulta (va entre comillas en el aviso). */
export const DICHOS = Object.freeze({
  insulto: [
    '¡Quítese de ahí, desechable!', '¡Vaya a trabajar, gonorrea!', '¡No me toque el carro, ñero hijueputa!',
    '¡Uy, qué asco, aléjese!', '¡Ni una moneda, vicioso!'
  ]
});
