// src/data/rebusqueReacciones.js
// Lo que hace cada conductor al terminar un trabajo en el semáforo. Lo usa systems/rebusque/reacciones.js.
//
// Pesos base por trabajo: la probabilidad de cada reacción de día, con fama 0, sin mugre y con un show normal.
// La 'paga' va primero en la tirada: con random() = 0 siempre se cobra el mínimo (las pruebas y el E2E dependen de eso).
//
// Balance (de día, fama 0, show normal): unos $1.000 por show de malabares a cuatro carros (unos $1.130 frente al
// primero de la cola), unos $670 por parabrisas y unos $1.000 por dos dulces vendidos. El techo de $3.000 por minuto
// real, sumando los tres trabajos, lo pone RebusqueSystem (TECHO_MINUTO); las esperas por esquina (40 s los
// malabares) y la de 60 s por carro hacen que casi nunca se toque. tests/rebusque-reacciones.test.js lo mide.
// Referencias: un día de juego dura 60 min reales; el ciclo del semáforo es de 36 s; 100 de energía alcanzan para
// unos 20 shows; la limosna da $200 a $1.500 cada 4 s.

/** Cómo cuenta cada reacción para los modificadores: positivas (dan algo), neutras y hostiles. */
export const CLASE_REACCION = Object.freeze({
  paga: 'positiva', propina: 'positiva', comida: 'positiva', compra: 'positiva',
  excusa: 'neutra', ventana: 'neutra', ignora: 'neutra',
  pito: 'hostil', insulto: 'hostil', bravo: 'hostil', furia: 'hostil'
});

/** El orden de la tirada: primero lo que paga. */
export const ORDEN_REACCION = Object.freeze(['paga', 'compra', 'propina', 'comida', 'excusa', 'ventana', 'ignora', 'pito', 'bravo', 'insulto', 'furia']);

export const PESOS_REACCION = Object.freeze({
  malabares: { paga: .32, propina: .03, comida: .02, excusa: .24, ventana: .17, ignora: .15, pito: .04, insulto: .03 },
  vidrios: { paga: .46, propina: .04, excusa: .12, ventana: .10, ignora: .10, bravo: .14, insulto: .03, furia: .01 },
  dulces: { compra: .47, propina: .03, excusa: .25, ventana: .15, ignora: .10 }
});

/** Propina: billete o monedas de más. En dulces es «quédese con las vueltas»: un dulce a $2.000. */
export const PROPINA = Object.freeze({ min: 1000, max: 2000, billete: 5000, probBillete: .08, dulce: 2000 });

/** Lo que regalan en vez de plata. */
export const COMIDA_REGALADA = Object.freeze(['pan', 'agua', 'refresco']);

/** Tope del efecto combinado de hora, fama y show sobre lo positivo: el mejor caso no se dispara. */
export const TOPE_POSITIVAS = 1.4;

/** Voces: la clave nueva solo si ya tiene audio en data/vocesCalle.js; si no, la de siempre. */
export const VOZ_REACCION = Object.freeze({
  paga: ['semaforo_si'], compra: ['semaforo_compra', 'semaforo_si'], propina: ['semaforo_propina', 'semaforo_si'],
  comida: ['semaforo_si'], excusa: ['semaforo_no'], ignora: [], ventana: [], pito: [],
  bravo: ['semaforo_bravo'], insulto: ['semaforo_madrazo'], furia: ['semaforo_bravo']
});

/**
 * Lo que cambia según el trabajo. 'semaforo_bravo' solo dice frases del vidrio («No, no, no, no me limpie el vidrio.»):
 * únicamente el que insulta por el parabrisas puede caer en ella. En malabares y dulces, sin 'semaforo_madrazo' grabado,
 * el insulto no tiene voz (el aviso ya lo cita) y habla el siguiente conductor.
 */
export const VOZ_REACCION_TRABAJO = Object.freeze({
  vidrios: Object.freeze({ insulto: ['semaforo_madrazo', 'semaforo_bravo'] })
});

/** Las claves de voz, en orden de preferencia, de una reacción en un trabajo. */
export function clavesVoz(tipo, trabajo) {
  return VOZ_REACCION_TRABAJO[trabajo]?.[tipo] ?? VOZ_REACCION[tipo] ?? [];
}

/** Lo que dice el conductor cuando no hay audio para la reacción (va entre comillas en el aviso). */
export const DICHOS = Object.freeze({
  insulto: [
    '¡Quítese de ahí, desechable!', '¡Vaya a trabajar, gonorrea!', '¡No me toque el carro, ñero hijueputa!',
    '¡Uy, qué asco, aléjese!', '¡Ni una moneda, vicioso!'
  ],
  excusa: ['No tengo sencillo, hermano.', 'Otro día, otro día.', 'Qué pena, no traigo nada.'],
  propina: ['Tome, mijo, por el show.', 'Eso, papá, tome pa\' algo.', 'Hágale, que se lo ganó.']
});
