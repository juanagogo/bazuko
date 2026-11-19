// src/systems/StreetVoices.js
// Frases de la calle: suenan de quien está cerca, una a la vez y con enfriamiento por persona y por grabación.

import { STREET_VOICES } from '../data/vocesDePaso.js';
import { RepartoVocal, puedeHablar } from './voces/identidad.js';
import { setPan, voicePan } from './voiceVariety.js';
export { STREET_VOICES };
export { npcSexo } from './voces/identidad.js';

/** Todas las voces del juego quedan a esta sonoridad: la de los conductores y el reclamo por robo (≈ -17,5). */
export const VOICE_LUFS = -18;

/** Multiplicador que lleva una grabación de `lufs` a VOICE_LUFS; sin medida no se toca. */
export function loudnessGain(lufs) {
  return Number.isFinite(lufs) ? Math.min(1.25, 10 ** ((VOICE_LUFS - lufs) / 20)) : 1;
}

/** Los saludos de paso esperan mientras la persona huye, combate, duerme o atiende a alguien. */
export function canGreet(npc) {
  return puedeHablar(npc) && npc.stance !== 'dormido' && !npc.deathResponse &&
    !npc.talk && !npc.witnessing && !(npc.fleeTimer > 0 || npc.panicTimer > 0) && !npc._counter && npc.action !== 'recibirGolpe';
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
  constructor({ bank, random = Math.random, reparto = new RepartoVocal() } = {}) {
    this.bank = bank;
    this.random = random;
    this.reparto = reparto;
    this.camera = null;
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
      else if (!canGreet(this._voice.npc) || this.externalVoiceActive()) this.cancel();
      else { this._setVolume(position); return; }
    }
    if (now < this._nextAt || this.externalVoiceActive()) return;
    const chosen = this._pick(position, pedestrians, now);
    if (!chosen) { this._nextAt = now + RETRY; return; }
    const sound = this.bank?.[chosen.clip.key];
    let duration = 2.5;
    if (sound?.state() === 'loaded') {
      const id = sound.play(), gain = loudnessGain(chosen.clip.lufs);
      sound.volume(this._volume(chosen.distance, gain), id);
      setPan(sound, voicePan(position, this.camera, chosen.npc.position), id);
      this.reparto.registrar(chosen.npc, chosen.clip.voz);
      this._voice = { sound, id, npc: chosen.npc, gain, text: chosen.clip.text };
      duration = Math.max(1.5, (sound.duration() || 2) + .5);
    }
    this._npcAt.set(chosen.npc, now + NPC_COOLDOWN);
    this._clipAt.set(chosen.clip.key, now + CLIP_COOLDOWN);
    this._nextAt = now + GAP_MIN + this.random() * (GAP_MAX - GAP_MIN);
    chosen.npc.say(chosen.clip.text, duration);
  }

  /** Entre los más cercanos a la vista elige la persona y, entre las grabaciones libres, la frase. */
  _pick(position, pedestrians, now) {
    const candidatos = [];
    for (const npc of pedestrians ?? []) {
      if ((this._npcAt.get(npc) ?? -Infinity) > now) continue;
      if (!canGreet(npc) || npc._bubbleEl) continue;
      const p = npc.position;
      const distance = Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z);
      if (distance > START_RANGE) continue;
      candidatos.push({ npc, distance });
    }
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => a.distance - b.distance);
    const libres = STREET_VOICES.filter(clip => (this._clipAt.get(clip.key) ?? -Infinity) <= now);
    const aptos = [];
    for (const candidato of candidatos) {
      const voz = this.reparto.vozDe(candidato.npc);
      if (!this.reparto.disponible(candidato.npc, voz)) continue;
      const clips = libres.filter(clip => clip.voz === voz);
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
    setPan(this._voice.sound, voicePan(position, this.camera, p), this._voice.id);
  }

  _drop() {
    if (this.active) this._voice.sound.stop(this._voice.id);
    this._voice = null;
  }

  /** Cede el canal: la reclama quien habla más fuerte, sin soltar los enfriamientos. */
  cancel(npc = null) {
    if (npc && this._voice?.npc !== npc) return;
    if (this.active) this._voice.npc.callar?.(this._voice.text);
    this._drop();
  }

  setPaused(paused) { this.paused = paused; if (paused) this._drop(); }

  clear() { this._drop(); this._clipAt.clear(); this._nextAt = 0; }
}
