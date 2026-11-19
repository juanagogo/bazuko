// src/data/vocesReuso.js
// Situaciones nuevas con las grabaciones que ya hay: no se graba nada. Una frase solo se usa en otra situación
// cuando lo que dice le sirve a las dos; al lado de cada id va lo que dice, para revisarlo sin abrir el audio.
// Los ids son los de vocesCalle.js, que dependen del orden de LINEAS: reordenarlas rompe esta tabla
// (tests/voces-testigos.test.js lo detecta).

/** Categoría → frases de vocesCalle.js que la dicen con la voz de quien las grabó. */
export const REUSO = Object.freeze({
  // Más testigos con su propia voz (antes solo la burbuja): el grito de quien huye de un robo...
  witnessTheft: [
    'busetero_persecucion_1',    // «¡Agarren a ese man, que no se vuele!»
    'nero_viejo_pelea_2',        // «¡Denle, denle, que es rata!»
    'nera_pelea_2',              // «¡Gonorrea, se le metió a la gente!»
    'nero_pelado_pelea_1',       // «¡Uy, qué boleta! ¡Cáigale!»
    'abuelo_testigo_pelea_1',    // «Ay, Dios, esta ciudad ya no es la misma.»
  ],
  // ... el de quien huye de una pelea...
  witnessFight: [
    'nera_pelea_1',              // «¡Déjelo, déjelo, que lo mata!»
    'nero_pelado_pelea_1',       // «¡Uy, qué boleta! ¡Cáigale!»
  ],
  // ... y lo que dice quien se queda grabando.
  witnessFilm: [
    'nero_pelado_ambiente_3',    // «Uy, qué boleta ese man.»
  ],
});
