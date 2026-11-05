// src/data/rebusque.js
// Rebusque: trabajos informales que se hacen con B, la misma tecla de pedir limosna. Los lleva `systems/RebusqueSystem.js`.
//
// Dónde se hace cada uno (`donde`):
//  - 'semaforo': a los carros quietos frente a un rojo.
//  - 'bus': a los pasajeros del bus troncal mientras está detenido.
//  - 'parqueados': a los dueños de los carros parqueados que el jugador cuida.
//
// Campos:
//  - item: lo que hace falta en el costal. `consume`: se gasta uno por venta.
//  - segundos: lo que dura el trabajo; si el carro o el bus arrancan antes, no paga.
//  - alcance: metros hasta lo que se atiende. `carros`: cuántos carros o pasajeros como mucho.
//  - paga: [mínimo, máximo] en pesos por cada uno que da. `prob`: probabilidad de que dé.
//  - propinas: (parqueados) cada cuántos segundos puede volver un dueño; paga al momento. Con un solo carro, menos seguido.
//  - energia: lo que cansa cada vez. `espera`: segundos antes de volverle a trabajar a lo mismo.
//  - verbo / ocupado / empezar: textos en primera persona (aviso de tecla y tarjeta).
export const REBUSQUE = {
  dulces: {
    id: 'dulces', donde: 'semaforo', item: 'dulces', consume: true,
    verbo: 'Vender dulces a los carros en rojo', ocupado: 'Vendiendo dulces',
    empezar: 'Bombones a mil, a mil el bombón.',
    segundos: 3, alcance: 8, carros: 3, prob: .5, paga: [1000, 1000], energia: 3, xp: 4
  },
  vidrios: {
    id: 'vidrios', donde: 'semaforo', item: 'limpiavidrios',
    verbo: 'Limpiar el parabrisas', ocupado: 'Limpiando el parabrisas',
    empezar: 'Le limpio el vidrio, patrón, con lo que quiera.',
    segundos: 4, alcance: 4.5, carros: 1, prob: .6, paga: [500, 3000], energia: 4, xp: 5,
    // Uno de cada tantos se enoja porque no pidió el servicio.
    enojo: .15
  },
  malabares: {
    id: 'malabares', donde: 'semaforo', item: 'malabares',
    verbo: 'Hacer malabares frente a los carros', ocupado: 'Haciendo malabares',
    empezar: 'Me paro frente a los carros y lanzo las pelotas.',
    segundos: 5, alcance: 9, carros: 4, prob: .4, paga: [200, 1000], energia: 5, xp: 4
  },
  bus: {
    id: 'bus', donde: 'bus', item: 'dulces', consume: true,
    verbo: 'Vender dulces a los pasajeros del bus', ocupado: 'Vendiendo dulces en el bus',
    empezar: 'Buenas, damas y caballeros: no vengo a robarles, vengo a ofrecerles un dulce.',
    segundos: 5, alcance: 4, carros: 4, prob: .45, paga: [1000, 1000], energia: 3, xp: 4
  },
  cuidar: {
    id: 'cuidar', donde: 'parqueados', item: 'franela',
    verbo: 'Cuidar los carros parqueados', ocupado: 'Cuidando carros',
    empezar: 'Saco la franela: yo le cuido el carro, patrón.',
    segundos: 40, alcance: 12, carros: 6, propinas: 8, prob: .5, paga: [500, 2000],
    energia: 6, xp: 3, espera: 180
  }
};

/** El orden en que se escoge: primero lo que más deja si se tiene con qué. */
export const ORDEN_REBUSQUE = ['dulces', 'vidrios', 'malabares', 'bus', 'cuidar'];

/** Segundos antes de volverle a trabajar al mismo carro (o bus), salvo que el trabajo diga otra cosa. */
export const ESPERA_POR_CARRO = 60;
