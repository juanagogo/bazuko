// src/data/objectives.js
// Cadena de objetivos de la primera hora. Se cumplen en orden; cada uno
// enseña una mecánica y deja al jugador listo para la siguiente.
//
// Campos:
//  - title / hint: texto del objetivo actual. Va en cartón: título en infinitivo,
//    pista en primera persona (ver tests/voz.test.js).
//  - target: lugar al que el GPS marca ruta ('bed', 'sell', 'shop', 'craft', 'dog').
//  - event: evento de `window` que cuenta hacia `goal` mientras el objetivo está activo.
//  - accept(detail): filtra el evento (opcional).
//  - progress(game): valor actual cuando el avance sale del estado del juego.
//  - done(game): condición de estado que también lo da por cumplido
//    (sirve para partidas guardadas antes de existir los objetivos).
//  - reward: pesos y experiencia al cumplirlo.
import { CAMBUCHE } from './cambuche.js';

const built = (game, id) => !!game.built?.[id];
const count = (game, id) => game.inventory?.count?.(id) ?? 0;
const builtCount = (game) => CAMBUCHE.filter(p => built(game, p.id)).length;

export const OBJECTIVES = [
  {
    id: 'revisar-basura',
    title: 'Buscar en la basura',
    hint: 'Me acerco a una bolsa o caneca y oprimo E.',
    event: 'pickup', accept: (d) => (d?.added?.length ?? 0) > 0, goal: 1,
    done: (g) => (g.inventory?.items?.length ?? 0) > 0 || built(g, 'base'),
    reward: { xp: 10 }
  },
  {
    id: 'juntar-carton',
    title: 'Juntar cartón para la base',
    hint: 'Saco cartón de bolsas y canecas hasta tener 8.',
    goal: 8, progress: (g) => count(g, 'carton'),
    done: (g) => built(g, 'base'),
    reward: { xp: 20 }
  },
  {
    id: 'armar-base',
    title: 'Armar la base del cambuche',
    hint: 'En el cambuche oprimo E y armo la base de cartón.',
    target: 'bed', done: (g) => built(g, 'base'),
    reward: { xp: 30 }
  },
  {
    id: 'reciclar',
    title: 'Vender material en la recicladora',
    hint: 'Latas, botellas, chatarra y cable se cambian por pesos.',
    target: 'sell', event: 'sell', goal: 1,
    reward: { xp: 20, dinero: 1000 }
  },
  {
    id: 'comprar-pan',
    title: 'Comprar pan en la tienda',
    hint: 'El pan quita el hambre y sirve para ganarse un amigo.',
    target: 'shop',
    done: (g) => count(g, 'pan') > 0 || count(g, 'lataComida') > 0 || !!g.dog?.isFriend,
    reward: { xp: 10 }
  },
  {
    id: 'el-chato',
    title: 'Ganarse a El Chato',
    hint: 'El perro anda cerca del cambuche: le doy pan o atún con E.',
    target: 'dog', done: (g) => !!g.dog?.isFriend,
    reward: { xp: 30 }
  },
  {
    id: 'dormir',
    title: 'Dormir en el cambuche',
    hint: 'Dormir recupera energía y salud. En el cambuche oprimo E.',
    target: 'bed', event: 'sleep-end', goal: 1,
    reward: { xp: 20 }
  },
  {
    id: 'techo',
    title: 'Ponerle techo al cambuche',
    hint: 'Una lona azul sale de la basura. Con techo recupero más salud.',
    target: 'bed', done: (g) => built(g, 'techo'),
    reward: { xp: 40 }
  },
  {
    id: 'retrovisor',
    title: 'Conseguir un retrovisor',
    hint: 'Junto a un carro oprimo E. Los parqueados tienen alarma.',
    event: 'steal', accept: (d) => !d?.caught, goal: 1,
    done: (g) => count(g, 'retrovisor') > 0,
    reward: { xp: 30 }
  },
  {
    id: 'robar-carro',
    title: 'Robar un carro',
    hint: 'Junto a un carro parqueado o detenido en el semáforo, oprimo Y.',
    event: 'carjack', goal: 1,
    reward: { xp: 50 }
  },
  {
    id: 'ahorrar',
    title: 'Ahorrar $ 20.000',
    hint: 'Reciclo, pido limosna con B o vendo lo que encuentro.',
    goal: 20000, progress: (g) => g.stats?.dinero ?? 0, money: true,
    reward: { xp: 40 }
  },
  {
    id: 'fabricar',
    title: 'Fabricar algo',
    hint: 'Con C abro la mesa y armo una receta con lo que llevo.',
    event: 'craft', goal: 1,
    reward: { xp: 30 }
  },
  {
    id: 'paredes',
    title: 'Levantar las paredes',
    hint: 'Con 6 tablas armo paredes: así nadie me roba dormido.',
    target: 'bed', done: (g) => built(g, 'paredes'),
    reward: { xp: 50, dinero: 3000 }
  },
  {
    id: 'cambuche-completo',
    title: 'Terminar el cambuche',
    hint: 'Colchón, fogón y vela: cada pieza mejora el descanso.',
    target: 'bed', goal: CAMBUCHE.length, progress: builtCount,
    reward: { xp: 100, dinero: 10000 }
  },
  {
    id: 'rebusque-semaforo',
    title: 'Rebuscarse en el semáforo',
    hint: 'Con pelotas, rodillo o dulces de la tienda, junto a los carros en rojo oprimo B.',
    target: 'shop', event: 'rebusque', accept: (d) => (d?.pesos ?? 0) > 0, goal: 3,
    reward: { xp: 40, dinero: 2000 }
  }
];
