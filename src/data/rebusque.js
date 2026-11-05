// src/data/rebusque.js
// Rebusque en el semáforo: mientras la luz está en rojo, trabajarles a los carros que esperan.
// Lo lleva `systems/RebusqueSystem.js`; se hace con B, la misma tecla de pedir limosna.
//
// Campos:
//  - item: lo que hace falta en el costal. `consume`: se gasta uno por venta.
//  - segundos: lo que dura el trabajo; si el carro arranca antes, no paga.
//  - alcance: metros hasta los carros a los que se les trabaja. `carros`: a cuántos como mucho.
//  - paga: [mínimo, máximo] en pesos por carro que da. `prob`: probabilidad de que un carro dé.
//  - energia: lo que cansa cada vez.
//  - empezar / ocupado: textos en primera persona (tarjeta y aviso de tecla).
export const REBUSQUE = {
  dulces: {
    id: 'dulces', item: 'dulces', consume: true,
    verbo: 'Vender dulces a los carros en rojo', ocupado: 'Vendiendo dulces',
    empezar: 'Bombones a mil, a mil el bombón.',
    segundos: 3, alcance: 8, carros: 3, prob: .5, paga: [1000, 1000], energia: 3, xp: 4
  },
  vidrios: {
    id: 'vidrios', item: 'limpiavidrios',
    verbo: 'Limpiar el parabrisas', ocupado: 'Limpiando el parabrisas',
    empezar: 'Le limpio el vidrio, patrón, con lo que quiera.',
    segundos: 4, alcance: 4.5, carros: 1, prob: .6, paga: [500, 3000], energia: 4, xp: 5,
    // Uno de cada tantos se enoja porque no pidió el servicio.
    enojo: .15
  },
  malabares: {
    id: 'malabares', item: 'malabares',
    verbo: 'Hacer malabares frente a los carros', ocupado: 'Haciendo malabares',
    empezar: 'Me paro frente a los carros y lanzo las pelotas.',
    segundos: 5, alcance: 9, carros: 4, prob: .4, paga: [200, 1000], energia: 5, xp: 4
  }
};

/** El orden en que se escoge: primero lo que más deja si se tiene con qué. */
export const ORDEN_REBUSQUE = ['dulces', 'vidrios', 'malabares'];

/** Segundos antes de volverle a trabajar al mismo carro. */
export const ESPERA_POR_CARRO = 60;
