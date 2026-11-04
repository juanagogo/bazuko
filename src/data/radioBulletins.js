// src/data/radioBulletins.js
// Boletines locales de La Voz de la Capital 890 AM. Son textos curados y versionados:
// funcionan sin conexión y no dependen de noticias en tiempo real.
//
// trigger: 'lluvia' (empieza a llover), 'despeje' (escampa) o 'ciudad' (rotación general).
// objetivo: lo que el boletín le sugiere hacer al jugador dentro del juego.

export const BULLETIN_TRIGGERS = ['lluvia', 'despeje', 'ciudad'];

export const BULLETINS = [
  {
    id: 'ideam-alerta-lluvias',
    trigger: 'lluvia',
    fecha: '2026-10-27',
    fuente: 'Boletín del clima',
    titular: 'Alerta por lluvias en Bogotá',
    texto: 'Sigue la alerta por lluvias en la ciudad. Se esperan aguaceros en la tarde y la noche.',
    objetivo: 'Busque techo o vuelva al cambuche para secarse.'
  },
  {
    id: 'granizada-oriente',
    trigger: 'lluvia',
    fecha: '2026-10-27',
    fuente: 'Reportes de oyentes',
    titular: 'Posible granizada en los cerros orientales',
    texto: 'Oyentes reportan granizo en el oriente. Las canecas y las bolsas se mojan rápido.',
    objetivo: 'Termine el techo del cambuche antes de que arrecie.'
  },
  {
    id: 'escampa-centro',
    trigger: 'despeje',
    fecha: '2026-10-27',
    fuente: 'La Voz de la Capital',
    titular: 'Escampa en el centro',
    texto: 'La llovizna cede sobre la Séptima y la Caracas. Las calles siguen mojadas.',
    objetivo: 'Buen momento para revisar canecas y bolsas antes del próximo aguacero.'
  },
  {
    id: 'reciclaton-octubre',
    trigger: 'ciudad',
    fecha: '2026-10-28',
    fuente: 'La alcaldía local',
    titular: 'Jornada de reciclaje el 28 y el 29 de octubre',
    texto: 'Habrá puntos de recolección de reciclaje en varias localidades.',
    objetivo: 'Junte latas, cartón y chatarra para venderlos en la recicladora.'
  },
  {
    id: 'transmilenio-desvios',
    trigger: 'ciudad',
    fecha: '2026-10-28',
    fuente: 'Reportes de la troncal',
    titular: 'Cambios de operación en la troncal',
    texto: 'Algunas rutas cambian su recorrido por obras. Los buses siguen parando en Portal del Centro.',
    objetivo: 'Cuidado al cruzar el carril exclusivo cerca de la estación.'
  }
];

/** Boletines de un disparador, en el orden del catálogo. */
export function bulletinsFor(trigger) {
  return BULLETINS.filter((b) => b.trigger === trigger);
}
