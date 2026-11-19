/**
 * Cinco tomas originales. Sin un intérprete común documentado, cada archivo conserva su propio timbre.
 * `lufs` es la sonoridad medida del archivo (`ffmpeg -af ebur128`): vienen grabadas muy dispares, de -7,5 a -18,4,
 * y sin compensar «Un 3 nacional» sonaría más de tres veces más fuerte que «Las mejores». Una nueva se mide al añadirla.
 */
export const STREET_VOICES = [
  { key: 'carechimba', voz: 'calle_carechimba', file: 'calle_las_mejores_carechimba.mp3', text: 'Las mejores, carechimba.', sexo: 'mujer', lufs: -18.4 },
  { key: 'pirobito', voz: 'calle_pirobito', file: 'calle_pirobito.mp3', text: 'Pirobito.', sexo: 'mujer', lufs: -15.3 },
  { key: 'enano', voz: 'calle_enano', file: 'calle_enano_gonorrea.mp3', text: 'Enano gonorrea.', sexo: 'mujer', lufs: -12.9 },
  { key: 'medallo', voz: 'calle_medallo', file: 'calle_medallo.mp3', text: 'Medallo.', sexo: 'hombre', lufs: -11 },
  { key: 'nacional', voz: 'calle_nacional', file: 'calle_un3snacional.mp3', text: 'Un 3 nacional.', sexo: 'hombre', lufs: -7.5 }
];
