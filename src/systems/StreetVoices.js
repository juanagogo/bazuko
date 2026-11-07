// src/systems/StreetVoices.js
// Frases de la calle: suenan de quien está cerca, una a la vez y con enfriamiento por persona y por grabación.
import { distanceGain } from './VehicleAudio.js';
import { setPan, setRate, takeVariation, voicePan } from './voiceVariety.js';

/**
 * Las frases de la calle, grabadas de verdad. `text` es lo que muestra la burbuja; `sexo` dice quién la puede decir,
 * según la voz grabada (ver `voiceFits`). No son de ninguna voz del reparto: las dice quien todavía no se ha oído
 * con la suya (`_vozOida`). Decirlas no le cambia la voz del reparto: el banco casi no tiene frases sin voz para
 * hombre (robo, testigo, limosna... ninguna), así que quedarse con una "voz de la calle" lo dejaría mudo justo
 * cuando lo roban. Lo que queda: quien dijo una de la calle puede después hablar con la suya (un cambio, una vez),
 * pero quien ya se oyó con la suya no vuelve a la de la calle.
 */
export const STREET_VOICES = [
  { key: 'carechimba', file: 'calle_las_mejores_carechimba.mp3', text: 'Las mejores, carechimba.', sexo: 'mujer' },
  { key: 'pirobito', file: 'calle_pirobito.mp3', text: 'Pirobito.', sexo: 'hombre' },
  { key: 'enano', file: 'calle_enano_gonorrea.mp3', text: 'Enano gonorrea.', sexo: 'mujer' },
  { key: 'medallo', file: 'calle_medallo.mp3', text: 'Medallo.', sexo: 'hombre' },
  { key: 'nacional', file: 'calle_un3snacional.mp3', text: 'Un 3 nacional.', sexo: 'hombre' },
  { key: 'mamacita', file: 'calle_mamacita.mp3', text: 'Mamacita, todas somos perras porque a todas nos gusta que nos den por el mismo hueco. No se azare por eso, mi amor.', sexo: 'mujer' },
  { key: 'envidia', file: 'calle_mucha_envidia.mp3', text: '¿Mucha envidia o qué, perra?', sexo: 'mujer' },
  { key: 'besitos', file: 'calle_besitos.mp3', text: 'Besitos hasta donde no llega el sol, y cuando quiera, carechimba.', sexo: 'mujer' },
  { key: 'papasito', file: 'calle_papasito.mp3', text: 'Papasito.', sexo: 'mujer' }
];

/** La voz grabada tiene que ser de quien habla: una frase de mujer no sale de un hombre. */
export const voiceFits = (clip, npc) => clip.sexo === (npc.look?.real?.sexo ?? npc.person?.real?.sexo);

const RANGE = 18, FULL = 5;               // metros: pleno hasta FULL, mudo desde RANGE
const NPC_COOLDOWN = 25000;               // ms antes de volver a oír a la misma persona
const CLIP_COOLDOWN = 50000;              // ms antes de repetir la misma grabación
const GAP_MIN = 6000, GAP_MAX = 13000;    // ms entre frase y frase
const RETRY = 1000;                       // con nadie disponible, no vuelve a mirar cada cuadro
const POOL = 4;                           // entre los más cercanos, cualquiera puede hablar
const BURBUJA_CORTADA = .4;               // s que le quedan a la burbuja de una frase cortada

export class StreetVoices {
  constructor({ bank, random = Math.random } = {}) {
    this.bank = bank;
    this.random = random;
    this.levels = { voices: 1 };
    // Otra voz en curso (robo o frase de conductor) impide empezar la de la calle.
    this.externalVoiceActive = () => false;
    this.paused = false;
    this._npcAt = new WeakMap();
    this._clipAt = new Map();
    this._nextAt = 0;
    this._voice = null;
    this.camera = null;
  }

  /** Una frase de la calle sonando: tráfico y ambiente bajan mientras tanto. */
  get active() { return !!this._voice && this._voice.sound.playing(this._voice.id); }

  update(position, pedestrians, now = performance.now()) {
    if (this.paused) return;
    if (this._voice) {
      if (!this._voice.sound.playing(this._voice.id)) this._voice = null;
      else { this._setVolume(position); return; }
    }
    if (now < this._nextAt || this.externalVoiceActive()) return;
    const chosen = this._pick(position, pedestrians, now);
    const sound = chosen && this.bank[chosen.clip.key];
    if (!sound || sound.state() !== 'loaded') { this._nextAt = now + RETRY; return; }
    const id = sound.play();
    const { rate, gain } = takeVariation(this.random);
    setRate(sound, rate, id);
    this._voice = { sound, id, npc: chosen.npc, gain };
    sound.volume(this._volume(chosen.distance), id);
    setPan(sound, voicePan(position, this.camera, chosen.npc.position), id);
    this._npcAt.set(chosen.npc, now + NPC_COOLDOWN);
    this._clipAt.set(chosen.clip.key, now + CLIP_COOLDOWN);
    this._nextAt = now + GAP_MIN + this.random() * (GAP_MAX - GAP_MIN);
    chosen.npc.say(chosen.clip.text, Math.max(1.5, (sound.duration() || 2) + .5));
    this._voice.bubble = chosen.npc._bubbleEl ?? null;
  }

  /** Entre los más cercanos a la vista elige la persona y, entre las grabaciones libres, la frase. */
  _pick(position, pedestrians, now) {
    const candidatos = [];
    for (const npc of pedestrians ?? []) {
      if ((this._npcAt.get(npc) ?? -Infinity) > now) continue;
      if (npc._bubbleEl || npc.koState || npc.stance === 'dormido') continue;
      if (npc._vozOida) continue; // ya habló con su voz del reparto: no pasa a la de la calle
      const p = npc.position;
      const distance = Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z);
      if (distance > RANGE) continue;
      candidatos.push({ npc, distance });
    }
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => a.distance - b.distance);
    const libres = STREET_VOICES.filter(clip => (this._clipAt.get(clip.key) ?? -Infinity) <= now);
    if (!libres.length) return null;
    // Solo cuenta quien tenga alguna frase libre de su sexo: una mujer no habla con voz de hombre.
    const conFrase = candidatos.filter(({ npc }) => libres.some(clip => voiceFits(clip, npc)));
    if (!conFrase.length) return null;
    const pool = Math.min(POOL, conFrase.length);
    const persona = conFrase[Math.floor(this.random() * pool)];
    const clips = libres.filter(clip => voiceFits(clip, persona.npc));
    return { npc: persona.npc, distance: persona.distance, clip: clips[Math.floor(this.random() * clips.length)] };
  }

  _volume(distance) { return (this._voice?.gain ?? 1) * this.levels.voices * distanceGain(distance, FULL, RANGE); }

  _setVolume(position) {
    const p = this._voice.npc.position;
    const distance = Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z);
    if (distance > RANGE) { this._drop(); return; }
    this._voice.sound.volume(this._volume(distance), this._voice.id);
    setPan(this._voice.sound, voicePan(position, this.camera, p), this._voice.id);
  }

  _drop() {
    if (this.active) {
      this._voice.sound.stop(this._voice.id);
      // Cortada por una voz que pesa más: su burbuja no se queda el largo entero de la grabación.
      const { npc, bubble } = this._voice;
      if (bubble && npc._bubbleEl === bubble && npc._bubbleTimer > BURBUJA_CORTADA) npc._bubbleTimer = BURBUJA_CORTADA;
    }
    this._voice = null;
  }

  /** Cede el canal: la reclama quien habla más fuerte, sin soltar los enfriamientos. */
  cancel() { this._drop(); }

  setPaused(paused) { this.paused = paused; if (paused) this._drop(); }

  clear() { this._drop(); this._clipAt.clear(); this._nextAt = 0; }
}
