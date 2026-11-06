// src/data/vocesReuso.js
// Situaciones nuevas con las grabaciones que ya hay: no se graba nada. Una frase solo se usa en otra situación
// cuando lo que dice le sirve a las dos; al lado de cada id va lo que dice, para revisarlo sin abrir el audio.
// Los ids son los de vocesCalle.js, que dependen del orden de LINEAS: reordenarlas rompe esta tabla
// (tests/voces-reuso.test.js lo detecta).

/** Categoría del banco de peatones → frases de vocesCalle.js que la dicen con la voz de quien las grabó. */
export const REUSO = Object.freeze({
  // Le dan plata a quien pide limosna.
  begYes: [
    'conductor_semaforo_si_1',   // «Tome, pa' la gaseosa.»
    'conductora_semaforo_si_1',  // «Ay, tenga, Dios lo bendiga.»
    'busetero_semaforo_si_1',    // «Hágale, tome esas moneditas.»
    'abuelo_ambiente_2',         // «Dios lo bendiga, joven.»
  ],
  // Le dan pan o agua.
  begFood: [
    'abuelo_ambiente_3',         // «¿Ya almorzó, mijito?»
    'abuelo_ambiente_2',         // «Dios lo bendiga, joven.»
    'conductora_semaforo_si_1',  // «Ay, tenga, Dios lo bendiga.»
  ],
  // No le dan nada.
  begNo: [
    'conductor_semaforo_no_1',   // «No, hermano, hoy no tengo, qué pena.»
    'conductora_semaforo_no_1',  // «No, gracias, no traigo sencillo.»
    'busetero_semaforo_no_1',    // «Otro día, mi so, otro día.»
    'conductor_ambiente_1',      // «Permiso, que voy tarde.»
    'conductora_ambiente_1',     // «Permiso, que voy tarde.»
    'estudiante_ambiente_2',     // «¿Tiene hora? Voy tarde pa' clase.»
    'estudiante_h_ambiente_2',   // «¿Tiene hora? Voy tarde pa' clase.»
    'senora_ambiente_2',         // «Esto está carísimo, Dios mío.»
    'senora_ambiente_3',         // «Con permiso, mi niño.»
    'nera_ambiente_2',           // «¡Uy, sí, como usted tiene!»
    'nero_pelado_ambiente_1',    // «¿Qué me mira, ñero?»
    'nero_viejo_ambiente_1',     // «¿Qué hubo, mi so? ¿Me regala pa'l pan?»
    'reciclador_ambiente_3',     // «Con permiso, que voy cargado.»
    'abuelo_ambiente_1',         // «En mis tiempos esto era otra cosa, mijo.»
  ],
  // El jugador lo agarra (H).
  grabbed: [
    'conductor_robado_1',        // «¡Quite la mano de ahí, hijueputa!»
    'senora_robado_2',           // «¡Suelte eso, sinvergüenza!»
    'nera_robado_1',             // «¡Ey, rata, suélteme eso!»
    'busetero_robado_1',         // «¡Ey, suelte eso, ladrón!»
    'reciclador_pelea_1',        // «¡Quieto, patrón, que eso no es así!»
    'nero_pelado_reto_1',        // «¿Qué, ñero? ¿Qué? ¡Venga pues!»
    'nero_viejo_robado_1',       // «¡Quieto, que eso es mío, ñero!»
    'conductora_robado_1',       // «¡Auxilio, me están robando!»
  ],
  // Lo sacan de su carro.
  carjacked: [
    'conductor_testigo_robo_1',  // «¡Cójanlo, que robó!»
    'conductor_robado_1',        // «¡Quite la mano de ahí, hijueputa!»
    'conductora_robado_1',       // «¡Auxilio, me están robando!»
    'conductora_testigo_robo_1', // «¡Auxilio, un ladrón!»
  ],
  // El conductor bravo que persigue con la varilla.
  roadRage: [
    'conductor_robo_espejo_1',   // «¡Ey! ¡Mi espejo, gonorrea!»
    'conductor_robo_espejo_3',   // «¡Ladrón, devuélvame eso, hijueputa!»
    'conductora_robo_espejo_1',  // «¡Ay, no, mi espejo! ¡Rata!»
    'conductora_robo_espejo_2',  // «¡Ese man me arrancó el espejo! ¡Policía!»
  ],
  // Quien ve que un carro atropelló a alguien.
  witnessRunOver: [
    'senora_testigo_pelea_1',    // «¡Lo van a matar, Dios mío!»
    'abuelo_testigo_pelea_1',    // «Ay, Dios, esta ciudad ya no es la misma.»
    'conductor_pito_3',          // «¡Oiga, pilas, que lo atropellan!»
    'nera_pelea_1',              // «¡Déjelo, déjelo, que lo mata!»
    'estudiante_testigo_graba_1',   // «Esto va pa' las redes, parce.»
    'estudiante_h_testigo_graba_1', // «Esto va pa' las redes, parce.»
  ],
  // Doña Rosa en la Tienda La Esquinita (la voz de la vendedora).
  shopGreet: [
    'vendedora_ambiente_1',      // «¡A la orden, a la orden! ¿Qué le vamos a llevar?»
    'vendedora_ambiente_4',      // «Lleve, lleve, mi rey, que se acaba.»
  ],
  // La Recicladora El Progreso.
  recycler: [
    'reciclador_ambiente_1',     // «¿Tiene cartón o botellas que no le sirvan, patrón?»
  ],
  // El jíbaro: abre su tienda de noche, de día no vende, y sin plata no hay negocio.
  dealerOpen: [
    'jibaro_ofrece_1',           // «Pss, pss... ¿qué necesita, mi so?»
    'jibaro_ofrece_4',           // «¿Qué, va a llevar o va a mirar?»
  ],
  dealerDay: [
    'jibaro_ofrece_3',           // «Pilas, que por aquí pasa la tomba.»
  ],
  dealerBroke: [
    'jibaro_ofrece_4',           // «¿Qué, va a llevar o va a mirar?»
  ],
  // La requisa en plena venta.
  raid: [
    'policia_a_grito_1', 'policia_b_grito_1', // «¡Quieto ahí! ¡Las manos donde las vea!»
    'policia_a_grito_5', 'policia_b_grito_5', // «¡Al piso, al piso!»
  ],
  // Un pelado avisa que viene la patrulla.
  tomba: [
    'nero_pelado_ambiente_2',    // «Pilas, que por ahí viene la tomba.»
  ],
  // Más testigos con su propia voz (antes solo la burbuja).
  witnessTheft: [
    'busetero_persecucion_1',    // «¡Agarren a ese man, que no se vuele!»
    'nero_viejo_pelea_2',        // «¡Denle, denle, que es rata!»
    'nera_pelea_2',              // «¡Gonorrea, se le metió a la gente!»
    'nero_pelado_pelea_1',       // «¡Uy, qué boleta! ¡Cáigale!»
    'abuelo_testigo_pelea_1',    // «Ay, Dios, esta ciudad ya no es la misma.»
    'reciclador_pelea_1',        // «¡Quieto, patrón, que eso no es así!»
  ],
  witnessFight: [
    'nera_pelea_1',              // «¡Déjelo, déjelo, que lo mata!»
    'reciclador_pelea_1',        // «¡Quieto, patrón, que eso no es así!»
    'nero_pelado_pelea_1',       // «¡Uy, qué boleta! ¡Cáigale!»
    'estudiante_testigo_graba_1',   // «Esto va pa' las redes, parce.»
    'estudiante_h_testigo_graba_1', // «Esto va pa' las redes, parce.»
  ],
  witnessFilm: [
    'nero_pelado_ambiente_3',    // «Uy, qué boleta ese man.»
  ],
});

/**
 * Frases prestadas entre dos papeles que graba la misma voz (mismo voiceId en REPARTO): [id, papel que la dice,
 * categoría]. Así la vendedora y el pelado dicen lo que su actor ya grabó para otro papel, sin cambiar de voz.
 */
export const PRESTADAS = Object.freeze([
  ['senora_robado_2', 'vendedora', 'grabbed'],              // «¡Suelte eso, sinvergüenza!» (Virginia)
  ['senora_olor_1', 'vendedora', 'shopDirty'],              // «¡Uy, qué olor tan horrible!» (Virginia)
  ['senora_olor_1', 'vendedora', 'smell'],                  // «¡Uy, qué olor tan horrible!» (Virginia)
  ['senora_popo_1', 'vendedora', 'poop'],                   // «¡Ay, qué asco! ¡Cochino!» (Virginia)
  ['estudiante_h_olor_1', 'nero_pelado', 'smell'],          // «Parce, ¿hace cuánto no se baña?» (Charlee)
  ['estudiante_h_testigo_graba_1', 'nero_pelado', 'witnessFilm'], // «Esto va pa' las redes, parce.» (Charlee)
]);

/** Los reclamos de Roberto por el espejo: AudioSystem ya los carga para el carro y el conductor bravo usa esos mismos. */
export const ROBO_ESPEJO_ROBERTO = Object.freeze([1, 2, 3, 4, 5].map(n => `roberto_robo_espejo_n${n}.mp3`));

/**
 * Grabaciones de antes (public/audio, sin voz del reparto) en situaciones nuevas: [archivo, texto, categoría, voz].
 * Sin voz las dice cualquier hombre que no tenga frase propia para esa situación (ver getRandomVoice). Las de
 * Roberto no tienen transcripción: su burbuja va vacía y solo las dice el carro de Roberto.
 */
export const HEREDADAS = Object.freeze([
  ['mevaamatar.mp3', '¡Gonorrea me va a matar! ¡Quíteme a este loco de encima!', 'grabbed', null],
  ['policia.mp3', '¡Policía, policía! ¡Me va a matar esta gonorrea!', 'runOver', null],
  ...ROBO_ESPEJO_ROBERTO.map(file => [file, '', 'roadRage', 'roberto']),
]);

/**
 * Lo que dice quien no tiene grabación para la situación: un sonido sin palabras con su propio tono
 * (src/systems/voces/Vocalizador.js). Ambiente, llamada y colgar no tienen: callar suena mejor que un quejido.
 */
export const GESTO_POR_CATEGORIA = Object.freeze({
  hit: 'ay', knockout: 'ay_fuerte', runOver: 'ay_fuerte',
  grabbed: 'ey', robbed: 'ey', theftChase: 'ey', mob: 'ey', taunt: 'ey', witnessTheft: 'ey', carjacked: 'ey',
  witnessFight: 'uy', nearMiss: 'uy', witnessRunOver: 'uy', roadRage: 'ey',
  poop: 'uf', smell: 'uf', shopDirty: 'uf',
  witnessFilm: 'jaja',
  begYes: 'mmm', begFood: 'mmm',
  begNo: 'mmm_no',
});
