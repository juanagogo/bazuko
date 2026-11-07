// src/systems/voces/hablar.js
// Lo que hace un peatón al decir una frase grabada: pide el canal con el peso de su situación y pone la burbuja
// cuando la voz de verdad empieza, del largo de la grabación. Si la frase no se va a oír porque otra pesa más, no
// deja burbuja: la gente no habla por encima de otra en silencio. Lejos o en silencio, la burbuja queda de subtítulo.
import { prioridadDe } from './prioridad.js';

const BURBUJA_S = 3.5, MIN_S = 1.5, DESPUES_S = .4;
const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * El canal lo tiene una voz que pesa igual o más que `category` (la misma cuenta que playNpcVoice sin `force`): la
 * frase no se oiría. speakScenario lo pregunta antes de sacar la frase del banco, así una que nadie oyó no queda
 * gastada (ShuffleBag y los 8 s sin repetir) ni cuenta como dicha.
 */
export function vozOcupada(npc, category) {
  const audio = npc.audio ??= globalThis.window?.__game?.audio;
  if (typeof audio?._voiceActive !== 'function' || typeof audio._voicePriority !== 'function') return false;
  return audio._voiceActive() && prioridadDe(category) <= audio._voicePriority();
}

/**
 * `entry` es la del banco (audio, texto, voz). Devuelve false si la frase no salió ni va a salir (otra voz manda);
 * true si suena, si espera a cargar o si queda solo la burbuja.
 */
export function decirFrase(npc, entry, category, { allowKnockedOut = false } = {}) {
  npc.audio ??= globalThis.window?.__game?.audio;
  const audio = npc.audio;
  const burbuja = seconds => { if (entry.text) npc.say(entry.text, seconds); };
  if (typeof audio?.playNpcVoice !== 'function') { burbuja(BURBUJA_S); return true; }
  let empezo = false;
  const onStart = seconds => {
    empezo = true;
    const now = nowMs();
    npc._hablaDesde = now; npc._hablaHasta = now + seconds * 1000;
    if (entry.voz) npc._vozOida = true;
    burbuja(Math.max(MIN_S, seconds + DESPUES_S));
  };
  const sono = audio.playNpcVoice(entry.audio, npc, { allowKnockedOut, priority: prioridadDe(category), onStart });
  if (sono) {
    if (!empezo) burbuja(BURBUJA_S);
    if (entry.voz) npc._vozOida = true;
    return true;
  }
  const motivo = audio.lastRefusal;
  if (motivo === 'espera') return true;    // la burbuja sale con la voz
  if (motivo === 'ocupado') return false;  // nadie la va a oír
  burbuja(BURBUJA_S);
  return true;
}
