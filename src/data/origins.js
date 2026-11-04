// src/data/origins.js
// ¿Cómo llegó el personaje a la calle? `relato` es la historia, sobria y sin justificar nada; `efecto` es lo que cambia
// en el juego, en su propia línea. El uno no explica al otro: nadie gana una ventaja por lo que le pasó.

export const ORIGINS = {
  reciclador: {
    name: 'Perdí el trabajo',
    relato: 'Cerraron donde trabajaba y no alcancé a pagar la pieza.',
    efecto: 'Saco un objeto más de cada bolsa.',
    effects: { extraLoot: 1 }
  },
  desplazado: {
    name: 'Me desplazaron',
    relato: 'Salí del campo huyendo de la violencia. Allá quedó todo.',
    efecto: 'Me enfermo 30 % menos.',
    effects: { diseaseResist: 0.7 }
  },
  migrante: {
    name: 'Salí de mi país',
    relato: 'Crucé la frontera buscando trabajo y no lo encontré.',
    efecto: 'Cuando pido me dan 30 % más.',
    effects: { begMult: 1.3 }
  },
  endeudado: {
    name: 'El gota a gota',
    relato: 'Lo perdí todo por un préstamo gota a gota.',
    efecto: 'Vendo 15 % más caro.',
    effects: { sellMult: 1.15 }
  }
};

/** Efecto del origen elegido, o `base` si no aplica */
export function originEffect(originId, key, base = 1) {
  return ORIGINS[originId]?.effects[key] ?? base;
}
