// src/data/vocesCalle.js
// Voces de la calle hechas con ElevenLabs (eleven v4, voces de biblioteca, una toma por frase).
// Cada papel tiene su voz y cada frase dice quién la dice, en qué situación suena y cómo se pidió (las
// etiquetas entre corchetes son la dirección que recibió la voz; el texto de la burbuja va sin ellas).
// Los audios salen de tools/voces/procesar.mjs: -16 LUFS, mono, con la calle detrás (radio y megáfono
// llevan su filtro).

/** Papel → voz. `sexo` decide qué personas de la calle pueden decir sus frases. */
export const REPARTO = Object.freeze({
  nero_viejo:   { sexo: 'hombre', actor: 'Santiago',           voiceId: 'VXZKNah1ssrzM8c81OiY' },
  nero_pelado:  { sexo: 'hombre', actor: 'Charlee',            voiceId: 'WwBoE3ZND2tj8noa9Obu' },
  estudiante_h: { sexo: 'hombre', actor: 'Charlee',            voiceId: 'WwBoE3ZND2tj8noa9Obu' },
  nera:         { sexo: 'mujer',  actor: 'Angie',              voiceId: 'YPh7OporwNAJ28F5IQrm' },
  reciclador:   { sexo: 'hombre', actor: 'Albeiro',            voiceId: 'OUfIyuG1GcVW5wnTy7Ru' },
  senora:       { sexo: 'mujer',  actor: 'Virginia',           voiceId: 'Tzf8K1T8bC5nay312fzF' },
  vendedora:    { sexo: 'mujer',  actor: 'Virginia',           voiceId: 'Tzf8K1T8bC5nay312fzF' },
  abuelo:       { sexo: 'hombre', actor: 'Oslo',               voiceId: '2lj4aExF052KSi14NJCI' },
  estudiante:   { sexo: 'mujer',  actor: 'Carito',             voiceId: 'J8BF9c7OgbHiqagCNoEj' },
  conductor:    { sexo: 'hombre', actor: 'El Faraón',          voiceId: 'W1hAcdh0RNsPYUA7fkJh' },
  conductora:   { sexo: 'mujer',  actor: 'Valentina Medellín', voiceId: 'J4vZAFDEcpenkMp3f3R9' },
  busetero:     { sexo: 'hombre', actor: 'Diego',              voiceId: 'tN4nkw7MBnGYAwQ71zQp' },
  vendedor:     { sexo: 'hombre', actor: 'El Faraón 2',        voiceId: '9TcPbUAhHnAV8mzFDAWU' },
  policia_a:    { sexo: 'hombre', actor: 'Zabra',              voiceId: 'G6LT3kjUUW86fQaWfBaj' },
  policia_b:    { sexo: 'hombre', actor: 'Murdock',            voiceId: 'OLmSqlYzB06EIKJRy5b0' },
  operadora:    { sexo: 'mujer',  actor: 'Adriana',            voiceId: 'CFhe2thhS6uqHsZesIpg' },
  jibaro:       { sexo: 'hombre', actor: 'Leon',               voiceId: '4KqeipGJCCqs2hVhiUFn' },
});

const POLICIA = [
  ['grito', '[shouting] ¡Quieto ahí! ¡Las manos donde las vea!'],
  ['grito', '[shouting] ¡Alto! ¡Policía Nacional!'],
  ['grito', '[shouting] ¡Deténgase, no corra!'],
  ['grito', '[breathless] ¡Párese, párese ahí!'],
  ['grito', '[shouting] ¡Al piso, al piso!'],
  ['arresto', '[firm] Ahora sí, se nos va pa\' la estación.'],
  ['escape', '[breathless] ¡Se nos voló, se nos voló por la carrera!'],
  ['radio', '[firm] Central, solicito apoyo, sospechoso a pie.'],
  ['radio', '[tired] Lo perdimos de vista, sigan buscando.'],
  ['megafono', '[firm] Ciudadano, deténgase.'],
];

const AMBIENTE_ESTUDIANTE = [
  '[tired] Qué pereza ese parcial, parce.',
  '[nervous] ¿Tiene hora? Voy tarde pa\' clase.',
  '[curious] ¿Por dónde coge el bus pa\' la U?',
];
const AMBIENTE_VENTA = [
  '[shouting] ¡A la orden, a la orden! ¿Qué le vamos a llevar?',
  '[shouting] ¡El tintico, el tintico, a la orden!',
  '¿Qué más pues, parcero? [shouting] ¡Barato, barato!',
  'Lleve, lleve, mi rey, que se acaba.',
];

/** [papel, situación, lo que se le pidió a la voz]. El orden fija el número de cada archivo: no reordenar. */
const LINEAS = [
  // A. Un conductor frenado por alguien en la vía (pito).
  ['conductor', 'pito', '[angry] ¡Quítese de ahí, hombre! Uy, no, qué tipo tan lento.'],
  ['conductor', 'pito', '[sighs] ¿Va a pasar o qué? [angry] ¡Muévase!'],
  ['conductor', 'pito', '[angry] ¡Oiga, pilas, que lo atropellan!'],
  ['conductor', 'pito', '[angry] ¡Ese man parado en la mitad... muévase, chino!'],
  ['conductora', 'pito', '[annoyed] ¡Señor! ¿No ve que estoy pasando?'],
  ['conductora', 'pito', '[annoyed] Ay, no, ¿en serio? ¡Córrase!'],
  ['conductora', 'pito', '[angry] ¡Qué falta de respeto, quítese del carro!'],
  ['conductora', 'pito', '[annoyed] ¡Me va a hacer llegar tarde, muévase!'],
  ['busetero', 'pito', '[shouting] ¡Abra, abra, que lleva afán la buseta!'],
  ['busetero', 'pito', '[shouting] ¡Uy, papá, se me quita o lo paso por encima!'],
  ['busetero', 'pito', '[shouting] ¡Hágale, hágale, que voy de afán!'],
  ['busetero', 'pito', '[shouting] ¡Quítese de la vía, ñero, que esto no frena!'],

  // B. El rebusque en el semáforo: no da, se pone bravo, da, o cambia la luz.
  ['conductor', 'semaforo_no', '[tired] No, hermano, hoy no tengo, qué pena.'],
  ['conductora', 'semaforo_no', '[sighs] No, gracias, no traigo sencillo.'],
  ['busetero', 'semaforo_no', '[tired] Otro día, mi so, otro día.'],
  ['conductor', 'semaforo_bravo', '[angry] No, no, no, no me limpie el vidrio.'],
  ['conductora', 'semaforo_bravo', '[angry] ¡No me toque el carro, por favor!'],
  ['conductor', 'semaforo_si', '[tired] Tome, pa\' la gaseosa.'],
  ['conductora', 'semaforo_si', '[warmly] Ay, tenga, Dios lo bendiga.'],
  ['busetero', 'semaforo_si', '[chuckles] Hágale, tome esas moneditas.'],
  ['conductor', 'semaforo_verde', '[shouting] ¡Ya, ya, que cambió el semáforo, quítese!'],
  ['conductora', 'semaforo_verde', '[annoyed] ¡Está en verde, córrase!'],

  // C. Le roban el espejo al carro.
  ['conductor', 'robo_espejo', '[shouting] ¡Ey! ¡Mi espejo, gonorrea!'],
  ['conductor', 'robo_espejo', '[shouting] ¡Me robaron el espejo! ¡Cójanlo!'],
  ['conductor', 'robo_espejo', '[angry] ¡Ladrón, devuélvame eso, hijueputa!'],
  ['conductora', 'robo_espejo', '[shouting] ¡Ay, no, mi espejo! ¡Rata!'],
  ['conductora', 'robo_espejo', '[shouting] ¡Ese man me arrancó el espejo! ¡Policía!'],
  ['conductora', 'robo_espejo', '[angry] ¡No puede ser, otra vez el espejo!'],

  // D. Le roban a alguien que va a pie.
  ['senora', 'robado', '[shouting] ¡Ay, Virgen santísima, mi bolso! ¡Ladrón!'],
  ['senora', 'robado', '[angry] ¡Suelte eso, sinvergüenza!'],
  ['abuelo', 'robado', '[shouting] ¡Oiga, oiga, eso es mío, joven!'],
  ['estudiante', 'robado', '[shouting] ¡Mi celular! ¡Parce, me robó el celular!'],
  ['estudiante', 'robado', '[nervous] ¡Ey, no, no, no, devuélvamelo!'],
  ['conductor', 'robado', '[angry] ¡Quite la mano de ahí, hijueputa!'],
  ['conductora', 'robado', '[shouting] ¡Auxilio, me están robando!'],
  ['nero_pelado', 'robado', '[angry] ¡Ey, ñero! ¿Me va a robar a mí? ¿A mí?'],
  ['estudiante_h', 'robado', '[shouting] ¡Mi celular! ¡Parce, me robó el celular!'],
  ['nera', 'robado', '[angry] ¡Ey, rata, suélteme eso!'],
  ['nero_viejo', 'robado', '[raspy] ¡Quieto, que eso es mío, ñero!'],
  ['reciclador', 'robado', '[shouting] ¡Ey, patrón, eso es mío!'],
  ['busetero', 'robado', '[shouting] ¡Ey, suelte eso, ladrón!'],

  // E. Testigos: llaman a la policía, graban, cuelgan asustados o gritan lo que vieron.
  ['senora', 'testigo_llama', '[nervous] ¿Aló? ¿Policía? Aquí en la esquina están robando.'],
  ['conductor', 'testigo_llama', '[nervous] Sí, señor, un man de chaqueta, vengan rápido.'],
  ['conductora', 'testigo_llama', '[nervous] ¿Aló, Policía? Aquí hay un man robando, vengan rápido.'],
  ['estudiante', 'testigo_llama', '[nervous] ¿Aló? Sí, aquí en la esquina están robando, vengan.'],
  ['estudiante', 'testigo_graba', '[laughs] Esto va pa\' las redes, parce.'],
  ['estudiante', 'testigo_graba', '[mischievously] Lo tengo grabado, ¿oyó? Grabado.'],
  ['estudiante_h', 'testigo_graba', '[laughs] Esto va pa\' las redes, parce.'],
  ['conductora', 'testigo_cuelga', '[nervous] ¡Ya, ya, ya colgué, tranquilo!'],
  ['senora', 'testigo_cuelga', '[nervous] ¡Ya colgué, mijo, ya colgué!'],
  ['conductor', 'testigo_cuelga', '[nervous] Tranquilo, tranquilo, no llamé a nadie.'],
  ['conductora', 'testigo_robo', '[shouting] ¡Auxilio, un ladrón!'],
  ['conductor', 'testigo_robo', '[shouting] ¡Cójanlo, que robó!'],
  ['busetero', 'testigo_pelea', '[shouting] ¡Pelea, pelea! ¡Sepárenlos!'],
  ['senora', 'testigo_pelea', '[shouting] ¡Lo van a matar, Dios mío!'],
  ['abuelo', 'testigo_pelea', '[sighs] Ay, Dios, esta ciudad ya no es la misma.'],

  // F. Les cae popó.
  ['senora', 'popo', '[disgusted] ¡Ay, qué asco! ¡Cochino!'],
  ['estudiante', 'popo', '[disgusted] ¡Ush, no, qué asco, parce, me untó!'],
  ['conductor', 'popo', '[angry] ¿Qué le pasa, enfermo? ¡Me embarró!'],
  ['conductora', 'popo', '[disgusted] ¡Ay, no, no, no! ¡Qué cochinada!'],
  ['busetero', 'popo', '[shouting] ¡Ese loco me tiró mierda!'],
  ['abuelo', 'popo', '[disgusted] ¡Qué pestilencia, Dios mío!'],
  ['estudiante_h', 'popo', '[disgusted] ¡Ush, no, qué asco, parce, me untó!'],
  ['nero_pelado', 'popo', '[angry] ¡Gonorrea, cochino, me untó!'],
  ['nera', 'popo', '[disgusted] ¡Ay, qué asco, cochino!'],
  ['nero_viejo', 'popo', '[raspy] ¡Uy, qué cochinada, ñero!'],
  ['reciclador', 'popo', '[disgusted] ¡Ay, patrón, no, qué asco!'],
  ['vendedor', 'popo', '[disgusted] ¡Uy, no, pues, qué cochinada!'],

  // G. Peleas: la turba, el que reta y el que grita que cojan al ladrón.
  ['nero_viejo', 'pelea', '[raspy] ¡Lleguen, lleguen, que aquí hay un sapo!'],
  ['nero_viejo', 'pelea', '[shouting] ¡Denle, denle, que es rata!'],
  ['nero_pelado', 'pelea', '[excited] ¡Uy, qué boleta! ¡Cáigale!'],
  ['nera', 'pelea', '[shouting] ¡Déjelo, déjelo, que lo mata!'],
  ['nera', 'pelea', '[angry] ¡Gonorrea, se le metió a la gente!'],
  ['reciclador', 'pelea', '[shouting] ¡Quieto, patrón, que eso no es así!'],
  ['nero_pelado', 'reto', '[angry] ¿Qué, ñero? ¿Qué? ¡Venga pues!'],
  ['busetero', 'persecucion', '[shouting] ¡Agarren a ese man, que no se vuele!'],

  // H. Lo que dice la gente al pasar (y los vendedores en su puesto).
  ['nero_viejo', 'ambiente', '[raspy] ¿Qué hubo, mi so? ¿Me regala pa\'l pan?'],
  ['nero_viejo', 'ambiente', '[sighs] Uy, este frío sí está berraco.'],
  ['nero_viejo', 'ambiente', '[raspy] Aquí, rebuscándonos, ¿sí o qué?'],
  ['nero_pelado', 'ambiente', '[annoyed] ¿Qué me mira, ñero?'],
  ['nero_pelado', 'ambiente', '[whispers] Pilas, que por ahí viene la tomba.'],
  ['nero_pelado', 'ambiente', '[laughs] Uy, qué boleta ese man.'],
  ['nera', 'ambiente', '[tired] Mi amor, regáleme una monedita.'],
  ['nera', 'ambiente', '[sarcastic] ¡Uy, sí, como usted tiene!'],
  ['nera', 'ambiente', '[sarcastic] Ay, ¿y este qué? ¿Muy elegante?'],
  ['reciclador', 'ambiente', '[tired] ¿Tiene cartón o botellas que no le sirvan, patrón?'],
  ['reciclador', 'ambiente', '[tired] Aquí, trabajando honrado.'],
  ['reciclador', 'ambiente', '[tired] Con permiso, que voy cargado.'],
  ['senora', 'ambiente', '[warmly] Ay, mijo, sumercé cuídese esa bolsa.'],
  ['senora', 'ambiente', '[sighs] Esto está carísimo, Dios mío.'],
  ['senora', 'ambiente', '[warmly] Con permiso, mi niño.'],
  ['abuelo', 'ambiente', '[sighs] En mis tiempos esto era otra cosa, mijo.'],
  ['abuelo', 'ambiente', '[warmly] Dios lo bendiga, joven.'],
  ['abuelo', 'ambiente', '[warmly] ¿Ya almorzó, mijito?'],
  ...AMBIENTE_ESTUDIANTE.map(d => ['estudiante', 'ambiente', d]),
  ...AMBIENTE_ESTUDIANTE.map(d => ['estudiante_h', 'ambiente', d]),
  ['conductor', 'ambiente', '[annoyed] Permiso, que voy tarde.'],
  ['conductor', 'ambiente', '[tired] Sí, ya casi llego a la oficina... sí, sí.'],
  ['conductora', 'ambiente', '[annoyed] Permiso, que voy tarde.'],
  ['conductora', 'ambiente', '[tired] Sí, ya voy llegando a la oficina, ya.'],
  ['busetero', 'ambiente', '[chuckles] ¿Qué hubo, maestro?'],
  ['busetero', 'ambiente', '[shouting] Pilas, que van a descargar material.'],
  ...AMBIENTE_VENTA.map(d => ['vendedor', 'ambiente', d]),
  ...AMBIENTE_VENTA.map(d => ['vendedora', 'ambiente', d]),

  // I. Huelen al jugador cuando lleva días sin bañarse.
  ['senora', 'olor', '[disgusted] ¡Uy, qué olor tan horrible!'],
  ['estudiante', 'olor', '[disgusted] Parce, ¿hace cuánto no se baña?'],
  ['conductor', 'olor', '[clears throat] Uy, no, aléjese.'],
  ['conductora', 'olor', '[disgusted] ¡Qué hedor, por Dios!'],
  ['nera', 'olor', '[sarcastic] Ush, mi amor, ni yo huelo así.'],
  ['estudiante_h', 'olor', '[disgusted] Parce, ¿hace cuánto no se baña?'],
  ['abuelo', 'olor', '[sighs] Uy, mijo, vaya báñese, por Dios.'],
  ['busetero', 'olor', '[disgusted] ¡Uy, no, qué gas, aléjese!'],
  ['vendedor', 'olor', '[disgusted] Uy, no, pues, ¡qué olor tan berraco!'],

  // J. La policía, con dos voces para que cada patrulla suene distinta.
  ...['policia_a', 'policia_b'].flatMap(voz => POLICIA.map(([situacion, dicho]) => [voz, situacion, dicho])),
  ['operadora', 'radio', '[firm] Atención patrullas, sospechoso a pie por la carrera décima. Procedan.'],
  ['operadora', 'radio', '[firm] Patrulla más cercana, reportan un robo en la zona. Acérquense.'],
  ['operadora', 'radio', '[firm] Recibido, unidad. Va un refuerzo en camino.'],
  ['operadora', 'radio', '[firm] Atención, todas las unidades: el sospechoso se dio a la fuga.'],

  // El jíbaro, en susurro.
  ['jibaro', 'ofrece', '[whispers] Pss, pss... ¿qué necesita, mi so?'],
  ['jibaro', 'ofrece', '[whispers] Venga, venga, que aquí tengo de todo.'],
  ['jibaro', 'ofrece', '[whispers] Pilas, que por aquí pasa la tomba.'],
  ['jibaro', 'ofrece', '[whispers] ¿Qué, va a llevar o va a mirar?'],

  // K. El voceador de la buseta cuando para.
  ['busetero', 'voceador', '[shouting] ¡Centro, Caracas, Jiménez, súbase!'],
  ['busetero', 'voceador', '[shouting] ¡Hay puesto, hay puesto!'],
  ['busetero', 'voceador', '[shouting] ¡Corriendito, que vamos tarde!'],
  ['busetero', 'voceador', '[shouting] ¡Súbase, que no lo espero!'],
];

/** Texto de la burbuja: lo pedido sin las etiquetas de dirección. */
export const sinEtiquetas = dicho => dicho.replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();

function numerar(lineas) {
  const cuenta = {};
  return lineas.map(([voz, situacion, dicho]) => {
    const clave = `${voz}_${situacion}`;
    cuenta[clave] = (cuenta[clave] ?? 0) + 1;
    const id = `${clave}_${cuenta[clave]}`;
    return Object.freeze({
      id, voz, situacion, dicho,
      text: sinEtiquetas(dicho),
      audio: `/audio/voces/${id}.mp3`,
      gender: REPARTO[voz].sexo,
    });
  });
}

/** Todas las frases, con su archivo en public/audio/voces/. */
export const FRASES = Object.freeze(numerar(LINEAS));

/** Frases de una situación, opcionalmente solo de un papel. */
export const frasesDe = (situacion, voz) => FRASES.filter(f => f.situacion === situacion && (!voz || f.voz === voz));

/**
 * Qué voz le toca a cada persona de la calle según su arquetipo, su sexo y su edad. Un habitante de calle
 * adulto puede salir con la voz del pelado o la del viejo (lo decide `random` una vez y la persona la conserva).
 * Sin sexo conocido todavía (el cuerpo no ha cargado) devuelve null para volver a preguntar después.
 */
const VOZ_POR_ARQUETIPO = Object.freeze({
  habitante:  { hombre: ({ edad }, random) => edad === 'joven' ? 'nero_pelado' : edad === 'mayor' ? 'nero_viejo'
    : random() < .5 ? 'nero_pelado' : 'nero_viejo', mujer: 'nera' },
  reciclador: { hombre: 'reciclador', mujer: 'nera' },
  senora:     { hombre: 'abuelo', mujer: 'senora' },
  abuelo:     { hombre: 'abuelo', mujer: 'senora' },
  oficinista: { hombre: 'conductor', mujer: 'conductora' },
  conductor:  { hombre: 'conductor', mujer: 'conductora' },
  estudiante: { hombre: 'estudiante_h', mujer: 'estudiante' },
  obrero:     { hombre: 'busetero', mujer: 'conductora' },
  vendedor:   { hombre: 'vendedor', mujer: 'vendedora' },
});

export function vozPara({ arquetipo, sexo, edad } = {}, random = Math.random) {
  const voz = VOZ_POR_ARQUETIPO[arquetipo]?.[sexo];
  return typeof voz === 'function' ? voz({ edad }, random) : voz ?? null;
}
