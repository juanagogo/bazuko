// src/systems/voces/testigos.js
// Las frases grabadas que dice un testigo (WitnessSystem), por situación: las de testigo de vocesCalle.js y las
// reusadas de vocesReuso.js. Cada una con la voz de quien la grabó: un testigo solo dice las de su voz.
import { FRASES } from '../../data/vocesCalle.js';
import { REUSO } from '../../data/vocesReuso.js';

/** Situación del testigo (WitnessSystem) → categoría. */
export const TESTIGO_A_CATEGORIA = Object.freeze({
  llamar: 'witnessCall', grabar: 'witnessFilm', colgar: 'witnessHangUp', robo: 'witnessTheft', pelea: 'witnessFight',
});

/** Situación de vocesCalle.js → categoría. */
const CATEGORIA_DE_SITUACION = Object.freeze({
  testigo_llama: 'witnessCall', testigo_graba: 'witnessFilm', testigo_cuelga: 'witnessHangUp',
  testigo_robo: 'witnessTheft', testigo_pelea: 'witnessFight',
});

function armar() {
  const banco = {};
  const agregar = (category, frase) => {
    const lista = banco[category] ??= [];
    if (!lista.includes(frase)) lista.push(frase);
  };
  for (const frase of FRASES) {
    const category = CATEGORIA_DE_SITUACION[frase.situacion];
    if (category) agregar(category, frase);
  }
  const porId = new Map(FRASES.map(frase => [frase.id, frase]));
  for (const [category, ids] of Object.entries(REUSO)) for (const id of ids) agregar(category, porId.get(id));
  for (const lista of Object.values(banco)) Object.freeze(lista);
  return Object.freeze(banco);
}

/** Categoría → frases con audio. */
export const BANCO_TESTIGOS = armar();

/** Las frases de una categoría de testigo que dice una voz. */
export const frasesDeTestigo = (category, voz) => (BANCO_TESTIGOS[category] ?? []).filter(frase => frase.voz === voz);
