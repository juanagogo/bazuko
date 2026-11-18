// src/data/vocesCalle.js
// Lo que dice la gente de la calle al pasar, grabado con ElevenLabs (eleven v4, voces de biblioteca, una toma por
// frase). Cada papel tiene su voz y cada frase dice quién la dice y cómo se pidió (las etiquetas entre corchetes son
// la dirección que recibió la voz; el texto de la burbuja va sin ellas). Los audios están a -16 LUFS, mono, con la
// calle detrás, en public/audio/voces/<id>.mp3.

/** Papel → voz. `sexo` decide qué personas de la calle pueden decir sus frases. */
export const REPARTO = Object.freeze({
  nero_viejo:   { sexo: 'hombre', actor: 'Santiago',    voiceId: 'VXZKNah1ssrzM8c81OiY' },
  nero_pelado:  { sexo: 'hombre', actor: 'Charlee',     voiceId: 'WwBoE3ZND2tj8noa9Obu' },
  estudiante_h: { sexo: 'hombre', actor: 'Charlee',     voiceId: 'WwBoE3ZND2tj8noa9Obu' },
  nera:         { sexo: 'mujer',  actor: 'Angie',       voiceId: 'YPh7OporwNAJ28F5IQrm' },
  senora:       { sexo: 'mujer',  actor: 'Virginia',    voiceId: 'Tzf8K1T8bC5nay312fzF' },
  vendedora:    { sexo: 'mujer',  actor: 'Virginia',    voiceId: 'Tzf8K1T8bC5nay312fzF' },
  abuelo:       { sexo: 'hombre', actor: 'Oslo',        voiceId: '2lj4aExF052KSi14NJCI' },
  estudiante:   { sexo: 'mujer',  actor: 'Carito',      voiceId: 'J8BF9c7OgbHiqagCNoEj' },
  conductor:    { sexo: 'hombre', actor: 'El Faraón',   voiceId: 'W1hAcdh0RNsPYUA7fkJh' },
  conductora:   { sexo: 'mujer',  actor: 'Valentina Medellín', voiceId: 'J4vZAFDEcpenkMp3f3R9' },
  busetero:     { sexo: 'hombre', actor: 'Diego',       voiceId: 'tN4nkw7MBnGYAwQ71zQp' },
  vendedor:     { sexo: 'hombre', actor: 'El Faraón 2', voiceId: '9TcPbUAhHnAV8mzFDAWU' },
});

/** Sonoridad de las grabaciones (todas entre -16,7 y -15,8 LUFS). */
export const VOCES_LUFS = -16;

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
  // Lo que dice la gente al pasar (y los vendedores en su puesto).
  ['nero_viejo', 'ambiente', '[raspy] ¿Qué hubo, mi so? ¿Me regala pa\'l pan?'],
  ['nero_viejo', 'ambiente', '[sighs] Uy, este frío sí está berraco.'],
  ['nero_viejo', 'ambiente', '[raspy] Aquí, rebuscándonos, ¿sí o qué?'],
  ['nero_pelado', 'ambiente', '[annoyed] ¿Qué me mira, ñero?'],
  ['nero_pelado', 'ambiente', '[whispers] Pilas, que por ahí viene la tomba.'],
  ['nero_pelado', 'ambiente', '[laughs] Uy, qué boleta ese man.'],
  ['nera', 'ambiente', '[tired] Mi amor, regáleme una monedita.'],
  ['nera', 'ambiente', '[sarcastic] ¡Uy, sí, como usted tiene!'],
  ['nera', 'ambiente', '[sarcastic] Ay, ¿y este qué? ¿Muy elegante?'],
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
 * El reciclador habla con la voz del ñero viejo.
 */
const VOZ_POR_ARQUETIPO = Object.freeze({
  habitante:  { hombre: ({ edad }, random) => edad === 'joven' ? 'nero_pelado' : edad === 'mayor' ? 'nero_viejo'
    : random() < .5 ? 'nero_pelado' : 'nero_viejo', mujer: 'nera' },
  reciclador: { hombre: 'nero_viejo', mujer: 'nera' },
  senora:     { hombre: 'abuelo', mujer: 'senora' },
  abuelo:     { hombre: 'abuelo', mujer: 'senora' },
  oficinista: { hombre: 'conductor', mujer: 'conductora' },
  estudiante: { hombre: 'estudiante_h', mujer: 'estudiante' },
  obrero:     { hombre: 'busetero', mujer: 'conductora' },
  vendedor:   { hombre: 'vendedor', mujer: 'vendedora' },
});

/**
 * La voz de una persona. Sin arquetipo conocido, la del oficinista de su sexo; sin sexo conocido todavía (el cuerpo
 * no ha cargado) devuelve null para volver a preguntar después.
 */
export function vozPara({ arquetipo, sexo, edad } = {}, random = Math.random) {
  if (sexo !== 'hombre' && sexo !== 'mujer') return null;
  const voz = (VOZ_POR_ARQUETIPO[arquetipo] ?? VOZ_POR_ARQUETIPO.oficinista)[sexo];
  return typeof voz === 'function' ? voz({ edad }, random) : voz;
}
