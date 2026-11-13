// src/data/origins.js
// ¿Cómo llegó el personaje a la calle? `relato` es la historia, sobria y sin justificar nada; `efecto` es lo que cambia
// en el juego, en su propia línea. El uno no explica al otro: nadie gana una ventaja por lo que le pasó.

export const ORIGINS = {
  // ===== TRIBUTO A «LOS REYES» (RCN) =====
  beto: {
    name: 'Beto Reyes (El Presidente)',
    relato: 'Chofer de plaza en La Fraguita. Nombrado de la noche a la mañana presidente del Grupo GER.',
    efecto: 'Sabor de barrio: vendo 25 % más caro y resisto 20 % mejor las enfermedades.',
    effects: { sellMult: 1.25, diseaseResist: 0.8 }
  },
  leo: {
    name: 'Leo Reyes (El Mecánico)',
    relato: 'Apasionado por los motores y las carreras en la Caracas. El galán trabajador de la familia.',
    efecto: 'Destreza en la calle: saco 1 objeto más de cada bolsa y gano 10 % más al vender.',
    effects: { extraLoot: 1, sellMult: 1.1 }
  },
  hilda: {
    name: 'Hilda Reyes (La Gata Montesa)',
    relato: 'Cantante de tecnocarrilera. Su alegría y voz conquistan desde el barrio hasta la Zona T.',
    efecto: 'Carisma musical: cuando pido me dan 40 % más y resisto mejor el frío.',
    effects: { begMult: 1.4, diseaseResist: 0.85 }
  },
  laisa: {
    name: 'Laisa Reyes (La Diva de Rosales)',
    relato: 'Puro glamour, actitud y corazón. Trae locos a todos en la Zona Rosa y al vecino Emilio Iriarte.',
    efecto: 'Elegancia arrolladora: vendo 30 % más caro y me dan 20 % más al pedir.',
    effects: { sellMult: 1.3, begMult: 1.2 }
  },

  // ===== ORÍGENES CLÁSICOS DE SUPERVIVENCIA =====
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
