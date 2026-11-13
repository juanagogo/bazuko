// src/systems/StreetVoices.js
// Frases de la calle: suenan de quien está cerca, una a la vez y con enfriamiento por persona y por grabación.

/**
 * Las cinco frases de la calle. `text` es lo que muestra la burbuja y `sexo` la voz de la grabación:
 * solo la dice alguien de ese sexo. Una grabación con voz de mujer se añade con `sexo: 'mujer'`.
 * `lufs` es la sonoridad medida del archivo (`ffmpeg -af ebur128`): vienen grabadas muy dispares, de -7,5 a -18,4,
 * y sin compensar «Un 3 nacional» sonaría más de tres veces más fuerte que «Las mejores». Una nueva se mide al añadirla.
 */
export const STREET_VOICES = [
  { key: 'carechimba', file: 'calle_las_mejores_carechimba.mp3', text: 'Las mejores, carechimba.', sexo: 'mujer', lufs: -18.4 },
  { key: 'pirobito', file: 'calle_pirobito.mp3', text: 'Pirobito.', sexo: 'mujer', lufs: -15.3 },
  { key: 'enano', file: 'calle_enano_gonorrea.mp3', text: 'Enano gonorrea.', sexo: 'mujer', lufs: -12.9 },
  { key: 'medallo', file: 'calle_medallo.mp3', text: 'Medallo.', sexo: 'hombre', lufs: -11 },
  { key: 'nacional', file: 'calle_un3snacional.mp3', text: 'Un 3 nacional.', sexo: 'hombre', lufs: -7.5 }
];

/** Todas las voces del juego quedan a esta sonoridad: la de los conductores y el reclamo por robo (≈ -17,5). */
export const VOICE_LUFS = -18;

/** Multiplicador que lleva una grabación de `lufs` a VOICE_LUFS; sin medida no se toca. */
export function loudnessGain(lufs) {
  return Number.isFinite(lufs) ? Math.min(1.25, 10 ** ((VOICE_LUFS - lufs) / 20)) : 1;
}

/** Sexo de quien habla: el de su cuerpo; sin dato no se le asigna voz. */
export function npcSexo(npc) {
  return npc?.look?.real?.sexo ?? npc?.person?.sexo ?? null;
}

/**
 * Una voz sin amplificar: plena de cerca y, después, cae más rápido que 1/d, porque en la calle el ruido la tapa
 * pronto. Un último tramo la apaga del todo en `far` para no cortarla de golpe.
 */
export function voiceGain(distance, near, far) {
  if (distance <= near) return 1;
  if (distance >= far) return 0;
  return (near / distance) ** 1.5 * Math.min(1, (far - distance) / (far * .35));
}

const RANGE = 15, FULL = 3;               // metros: pleno hasta FULL, mudo desde RANGE
const START_RANGE = 8;                    // solo empieza quien está cerca: más lejos se oiría apenas y su burbuja, perdida
const VOLUME = .8;                        // como el reclamo por robo: voz cercana, no un parlante
const NPC_COOLDOWN = 120000;               // ms antes de volver a oír a la misma persona
const CLIP_COOLDOWN = 150000;              // ms antes de repetir la misma grabación
const GAP_MIN = 20000, GAP_MAX = 45000;    // ms entre frase y frase
const RETRY = 1000;                       // con nadie disponible, no vuelve a mirar cada cuadro
const POOL = 4;                           // entre los más cercanos, cualquiera puede hablar

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
    const gain = loudnessGain(chosen.clip.lufs);
    sound.volume(this._volume(chosen.distance, gain), id);
    this._voice = { sound, id, npc: chosen.npc, gain };
    this._npcAt.set(chosen.npc, now + NPC_COOLDOWN);
    this._clipAt.set(chosen.clip.key, now + CLIP_COOLDOWN);
    this._nextAt = now + GAP_MIN + this.random() * (GAP_MAX - GAP_MIN);
    chosen.npc.say(chosen.clip.text, Math.max(1.5, (sound.duration() || 2) + .5));
  }

  /** Entre los más cercanos a la vista elige la persona y, entre las grabaciones libres, la frase. */
  _pick(position, pedestrians, now) {
    const candidatos = [];
    for (const npc of pedestrians ?? []) {
      if ((this._npcAt.get(npc) ?? -Infinity) > now) continue;
      if (npc._bubbleEl || npc.koState || npc.stance === 'dormido') continue;
      const p = npc.position;
      const distance = Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z);
      if (distance > START_RANGE) continue;
      candidatos.push({ npc, distance });
    }
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => a.distance - b.distance);
    const libres = STREET_VOICES.filter(clip => (this._clipAt.get(clip.key) ?? -Infinity) <= now);
    // Entre los más cercanos que tengan una grabación de su sexo: una mujer no dice la voz de un hombre.
    const aptos = [];
    for (const candidato of candidatos) {
      const sexo = npcSexo(candidato.npc);
      const clips = libres.filter(clip => clip.sexo === sexo);
      if (clips.length) aptos.push({ ...candidato, clips });
      if (aptos.length === POOL) break;
    }
    if (!aptos.length) return null;
    const persona = aptos[Math.floor(this.random() * aptos.length)];
    return { npc: persona.npc, distance: persona.distance, clip: persona.clips[Math.floor(this.random() * persona.clips.length)] };
  }

  _volume(distance, gain = 1) { return Math.min(1, VOLUME * gain * this.levels.voices * voiceGain(distance, FULL, RANGE)); }

  _setVolume(position) {
    const p = this._voice.npc.position;
    const distance = Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z);
    if (distance > RANGE) { this._drop(); return; }
    this._voice.sound.volume(this._volume(distance, this._voice.gain), this._voice.id);
  }

  _drop() {
    if (this.active) this._voice.sound.stop(this._voice.id);
    this._voice = null;
  }

  /** Cede el canal: la reclama quien habla más fuerte, sin soltar los enfriamientos. */
  cancel() { this._drop(); }

  setPaused(paused) { this.paused = paused; if (paused) this._drop(); }

  clear() { this._drop(); this._clipAt.clear(); this._nextAt = 0; }
}
