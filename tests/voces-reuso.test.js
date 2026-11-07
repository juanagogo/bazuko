import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { FRASES, REPARTO } from '../src/data/vocesCalle.js';
import { GESTO_POR_CATEGORIA, HEREDADAS, PRESTADAS, REUSO } from '../src/data/vocesReuso.js';
import { NPC_VOICE_BANK } from '../src/data/npcVoices.js';
import { getRandomVoice } from '../src/entities/Npc.js';
import { GESTOS_AMBIENTE, planVocalizacion, perfilVocal } from '../src/systems/voces/gestosVocales.js';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';

const POR_ID = new Map(FRASES.map(frase => [frase.id, frase]));

test('cada frase reusada existe, va con la voz de quien la grabó y su burbuja es su texto sin etiquetas', () => {
  for (const [category, ids] of Object.entries(REUSO)) {
    for (const id of ids) {
      const frase = POR_ID.get(id);
      assert.ok(frase, `${category}: ${id} existe en vocesCalle.js`);
      const entry = NPC_VOICE_BANK[category].find(item => item.audio === frase.audio && item.voz === frase.voz);
      assert.ok(entry, `${category}: ${id} está en el banco`);
      assert.equal(entry.gender, REPARTO[frase.voz].sexo);
      assert.equal(entry.text, frase.text);
      assert.doesNotMatch(entry.text, /\[|\]/);
    }
  }
});

test('una frase prestada solo pasa entre papeles que graba la misma voz', () => {
  for (const [id, alias, category] of PRESTADAS) {
    const frase = POR_ID.get(id);
    assert.ok(frase, id);
    assert.equal(REPARTO[frase.voz].voiceId, REPARTO[alias].voiceId, `${id} → ${alias}: mismo actor`);
    assert.equal(REPARTO[frase.voz].sexo, REPARTO[alias].sexo);
    const entry = NPC_VOICE_BANK[category].find(item => item.audio === frase.audio && item.voz === alias);
    assert.ok(entry, `${category}: ${id} como ${alias}`);
    assert.equal(entry.gender, REPARTO[alias].sexo);
  }
});

test('las grabaciones de antes existen y no se repite un audio de la misma voz en una categoría', () => {
  for (const [file] of HEREDADAS) assert.ok(existsSync(new URL(`../public/audio/${file}`, import.meta.url)), file);
  for (const [category, bank] of Object.entries(NPC_VOICE_BANK)) {
    const keys = bank.map(entry => `${entry.audio}|${entry.voz ?? ''}`);
    assert.equal(new Set(keys).size, keys.length, `${category} sin duplicados`);
  }
});

test('quien tiene frase la dice con su voz; quien no tiene, se queda sin frase (y le toca el vocalizador)', () => {
  assert.equal(getRandomVoice('begNo', 'mujer', 'nera').audio, '/audio/voces/nera_ambiente_2.mp3');
  assert.equal(getRandomVoice('grabbed', 'mujer', 'estudiante'), null);
  assert.equal(GESTO_POR_CATEGORIA.grabbed, 'ey');
  // La vendedora se queja del olor con su voz (la de la señora: Virginia), no con la de otra.
  assert.equal(getRandomVoice('shopDirty', 'mujer', 'vendedora').audio, '/audio/voces/senora_olor_1.mp3');
  // El abuelo, agarrado, no tiene frase del reparto: dice la de siempre, sin voz marcada.
  assert.equal(getRandomVoice('grabbed', 'hombre', 'abuelo').audio, '/audio/mevaamatar.mp3');
});

test('todas las categorías nuevas tienen prioridad y todos los gestos existen', () => {
  // Una categoría sin peso valdría 0 y cualquier voz la cortaría: todas las del banco lo tienen.
  for (const category of new Set([...Object.keys(REUSO), ...Object.keys(NPC_VOICE_BANK)])) assert.ok(PRIORIDAD_VOZ[category] > 0, category);
  const perfil = perfilVocal({ seed: 3 });
  for (const gesto of new Set([...Object.values(GESTO_POR_CATEGORIA), ...GESTOS_AMBIENTE])) assert.ok(planVocalizacion(gesto, perfil), gesto);
});

test('la tabla queda fija: reordenar las frases de vocesCalle.js la rompe aquí y no en silencio', () => {
  const foto = Object.fromEntries(Object.entries(REUSO).map(([category, ids]) => [category, ids.map(id => POR_ID.get(id)?.text)]));
  assert.deepEqual(foto, {
    begYes: ["Tome, pa' la gaseosa.", 'Ay, tenga, Dios lo bendiga.', 'Hágale, tome esas moneditas.', 'Dios lo bendiga, joven.'],
    begFood: ['¿Ya almorzó, mijito?', 'Dios lo bendiga, joven.', 'Ay, tenga, Dios lo bendiga.'],
    begNo: ['No, hermano, hoy no tengo, qué pena.', 'No, gracias, no traigo sencillo.', 'Otro día, mi so, otro día.', 'Permiso, que voy tarde.',
      'Permiso, que voy tarde.', "¿Tiene hora? Voy tarde pa' clase.", "¿Tiene hora? Voy tarde pa' clase.", 'Esto está carísimo, Dios mío.',
      'Con permiso, mi niño.', '¡Uy, sí, como usted tiene!', '¿Qué me mira, ñero?', "¿Qué hubo, mi so? ¿Me regala pa'l pan?",
      'Con permiso, que voy cargado.', 'En mis tiempos esto era otra cosa, mijo.'],
    grabbed: ['¡Quite la mano de ahí, hijueputa!', '¡Suelte eso, sinvergüenza!', '¡Ey, rata, suélteme eso!', '¡Ey, suelte eso, ladrón!',
      '¡Quieto, patrón, que eso no es así!', '¿Qué, ñero? ¿Qué? ¡Venga pues!', '¡Quieto, que eso es mío, ñero!', '¡Auxilio, me están robando!'],
    carjacked: ['¡Cójanlo, que robó!', '¡Quite la mano de ahí, hijueputa!', '¡Auxilio, me están robando!', '¡Auxilio, un ladrón!'],
    roadRage: ['¡Ey! ¡Mi espejo, gonorrea!', '¡Ladrón, devuélvame eso, hijueputa!', '¡Ay, no, mi espejo! ¡Rata!', '¡Ese man me arrancó el espejo! ¡Policía!'],
    witnessRunOver: ['¡Lo van a matar, Dios mío!', 'Ay, Dios, esta ciudad ya no es la misma.', '¡Oiga, pilas, que lo atropellan!',
      '¡Déjelo, déjelo, que lo mata!', "Esto va pa' las redes, parce.", "Esto va pa' las redes, parce."],
    shopGreet: ['¡A la orden, a la orden! ¿Qué le vamos a llevar?', 'Lleve, lleve, mi rey, que se acaba.'],
    recycler: ['¿Tiene cartón o botellas que no le sirvan, patrón?'],
    dealerOpen: ['Pss, pss... ¿qué necesita, mi so?', '¿Qué, va a llevar o va a mirar?'],
    dealerDay: ['Pilas, que por aquí pasa la tomba.'],
    dealerBroke: ['¿Qué, va a llevar o va a mirar?'],
    raid: ['¡Quieto ahí! ¡Las manos donde las vea!', '¡Quieto ahí! ¡Las manos donde las vea!', '¡Al piso, al piso!', '¡Al piso, al piso!'],
    tomba: ['Pilas, que por ahí viene la tomba.'],
    witnessTheft: ['¡Agarren a ese man, que no se vuele!', '¡Denle, denle, que es rata!', '¡Gonorrea, se le metió a la gente!',
      '¡Uy, qué boleta! ¡Cáigale!', 'Ay, Dios, esta ciudad ya no es la misma.', '¡Quieto, patrón, que eso no es así!'],
    witnessFight: ['¡Déjelo, déjelo, que lo mata!', '¡Quieto, patrón, que eso no es así!', '¡Uy, qué boleta! ¡Cáigale!',
      "Esto va pa' las redes, parce.", "Esto va pa' las redes, parce."],
    witnessFilm: ['Uy, qué boleta ese man.'],
  });
});

test('el reuso no toca las categorías de los clips que el dueño pidió dejar como están (decisiones.md, Voces)', () => {
  // hit y ambient llevan esos clips: sumarles frases cambiaría cada cuánto suenan.
  const tocadas = new Set([...Object.keys(REUSO), ...PRESTADAS.map(([, , c]) => c), ...HEREDADAS.map(([, , c]) => c)]);
  for (const category of ['hit', 'ambient']) assert.equal(tocadas.has(category), false, category);
  const rutas = Object.values(NPC_VOICE_BANK).flat().map(entry => entry.audio);
  for (const clip of ['/audio/veneco cascando.mp3', '/audio/costenodmierda.mp3', '/audio/petrista.mp3']) {
    assert.equal(rutas.filter(ruta => ruta === clip).length, 1, `${clip} sigue una vez en el banco`);
  }
});
