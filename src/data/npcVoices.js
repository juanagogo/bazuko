import { FRASES, REPARTO } from './vocesCalle.js';
import { HEREDADAS, PRESTADAS, REUSO } from './vocesReuso.js';

// Frases con audio de los peatones, por situación. `text` es la burbuja y `audio` la grabación.
// `gender: 'mujer'` marca voz de mujer; sin marcar es voz de hombre y solo la dicen los hombres.
// `voz` (opcional) nombra a quien la grabó: quien tiene voz dice las suyas y solo sin ellas las que no tienen voz.
export const NPC_VOICE_BANK = {
  hit: [
    {
      audio: '/audio/neromalparido.mp3',
      text: '¡Ay hijueputa! ¿Qué le pasa ñero malparido?'
    },
    {
      audio: '/audio/veneco cascando.mp3',
      text: '¡Auxilio maricas! ¡Un veneco hijueputa me está cascando!'
    },
    {
      audio: '/audio/costenodmierda.mp3',
      text: '¡Uy quieto ahí costeño de mierda, no me toque!'
    }
  ],
  taunt: [
    {
      audio: '/audio/bajesedelanube.mp3',
      text: '¿Qué me mira gonorrea? Bájese de esa nube o lo quiebro.'
    },
    {
      audio: '/audio/leabroelcuerpo.mp3',
      text: '¡Váyase para la mierda malparido o le abro el cuerpo acá mismo!'
    }
  ],
  flee: [
    {
      audio: '/audio/policia.mp3',
      text: '¡Policía, policía! ¡Me va a matar esta gonorrea!'
    },
    {
      audio: '/audio/mevaamatar.mp3',
      text: '¡Gonorrea me va a matar! ¡Quíteme a este loco de encima!'
    }
  ],
  mob: [
    {
      audio: '/audio/vamosacascarentretodos.mp3',
      text: '¡Lleguen, lleguen! ¡Vamos a cascar a este gonorrea entre todos!'
    },
    {
      audio: '/audio/denleduroporrata.mp3',
      text: '¡Píselo, píselo! ¡Denle duro a ese hijueputa por rata!'
    }
  ],
  knockout: [
    {
      audio: '/audio/derrota.mp3',
      text: '¡Derrota!'
    },
    {
      audio: '/audio/ahh.mp3',
      text: '¡Ahhh!'
    }
  ],
  ambient: [
    {
      audio: '/audio/asqueroso.mp3',
      text: '¡Asqueroso!',
      gender: 'mujer'
    },
    {
      audio: '/audio/petrista.mp3',
      text: '¡Petrista!',
      gender: 'mujer'
    },
    {
      audio: '/audio/locohp.mp3',
      text: '¡Loco HP!'
    },
    {
      audio: '/audio/hedor.mp3',
      text: '¡Qué hedor!'
    }
  ],
  theftChase: [
    {
      audio: '/audio/peste.mp3',
      text: '¡Peste!',
      gender: 'mujer'
    },
    {
      audio: '/audio/encuerenrata.mp3',
      text: '¡Encuerenrata!'
    }
  ]
};

/** Situación de vocesCalle.js → categoría del banco. Las de carros, policía, jíbaro y bus van por otro lado. */
export const CATEGORIA_DE_SITUACION = Object.freeze({
  ambiente: 'ambient', pelea: 'mob', reto: 'taunt', persecucion: 'theftChase',
  robado: 'robbed', popo: 'poop', olor: 'smell',
  testigo_llama: 'witnessCall', testigo_graba: 'witnessFilm', testigo_cuelga: 'witnessHangUp',
  testigo_robo: 'witnessTheft', testigo_pelea: 'witnessFight',
});

for (const frase of FRASES) {
  const category = CATEGORIA_DE_SITUACION[frase.situacion];
  if (!category) continue;
  (NPC_VOICE_BANK[category] ??= []).push({ audio: frase.audio, text: frase.text, gender: frase.gender, voz: frase.voz });
}

// Las situaciones nuevas con grabaciones que ya existen (ver vocesReuso.js): cada frase con la voz de quien la dijo,
// las prestadas con el papel que comparte actor, y las de antes sin voz del reparto.
const POR_ID = new Map(FRASES.map(frase => [frase.id, frase]));
const agregar = (category, entry) => {
  const bank = NPC_VOICE_BANK[category] ??= [];
  if (!bank.some(item => item.audio === entry.audio && item.voz === entry.voz)) bank.push(entry);
};
for (const [category, ids] of Object.entries(REUSO)) for (const id of ids) {
  const frase = POR_ID.get(id);
  if (frase) agregar(category, { audio: frase.audio, text: frase.text, gender: frase.gender, voz: frase.voz });
}
for (const [id, voz, category] of PRESTADAS) {
  const frase = POR_ID.get(id);
  if (frase) agregar(category, { audio: frase.audio, text: frase.text, gender: REPARTO[voz].sexo, voz });
}
for (const [file, text, category, voz] of HEREDADAS) {
  agregar(category, voz ? { audio: `/audio/${file}`, text, voz } : { audio: `/audio/${file}`, text });
}
