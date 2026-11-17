// src/systems/voces/VoiceDirector.js
// Las voces de la gente de la calle con las frases grabadas de data/vocesCalle.js:
//  - Al pasar cerca, de vez en cuando alguien dice algo: la primera a los 4 s y luego cada 7 a 14 s, entre los
//    cuatro más cercanos a menos de 6 m que no hayan hablado hace poco.
//  - Cada persona tiene la voz de su arquetipo, su sexo y su edad (vozPara) y la conserva. Las frases de cada voz
//    salen barajadas: ninguna se repite hasta que hayan salido todas.
//  - Comparte el canal con las demás voces del juego (AudioSystem): solo empieza si nadie más habla.
//  - Los audios se cargan al pedirlos: los de quien está al lado (a menos de 6 m) empiezan a cargar antes. Una frase
//    solo arranca con su audio ya cargado, como las demás voces; si a quien le toca no tiene ninguna lista, se pide la
//    carga y habla en otro turno (o le toca a otro). Ningún audio se descarga hasta salir de la partida.
// La burbuja sale con la voz, del largo de la grabación. Si un audio no carga (al hablar o al precargar), ese archivo
// no se vuelve a pedir y su frase sale solo en la burbuja.
import { VOCES_LUFS, frasesDe, vozPara } from '../../data/vocesCalle.js';
import { ShuffleBag, setPan, setRate, takeVariation, voicePan } from '../voiceVariety.js';
import { loudnessGain, npcSexo, voiceGain } from '../StreetVoices.js';

export const DIRECTOR = Object.freeze({
  rango: 15, pleno: 3,           // m: pleno hasta `pleno`; desde `rango` se calla y suelta el canal, como las frases de la calle
  volumen: .8,                   // como las frases de la calle (StreetVoices)
  ambiente: { primera: 4000, alcance: 6, pool: 4, porPersona: 30000, min: 7000, extra: 7000, reintento: 1000 },
  precarga: { alcance: 6, cada: 1000 },
  burbuja: { min: 1.5, despues: .4, sinAudio: 3 },
});

/** La voz del reparto de una persona: la de su arquetipo, su sexo y su edad. */
export function vozDePersona(npc, random = Math.random) {
  const real = npc?.look?.real ?? npc?.person?.real;
  const arquetipo = npc?.person?.arquetipo ?? (npc?.isVendor ? 'vendedor' : null);
  return vozPara({ arquetipo, sexo: npcSexo(npc), edad: real?.edad }, random);
}

const audioFile = path => path.replace(/^\/audio\//, '');

export class VoiceDirector {
  /**
   * `load(file)` crea el Howl de `public/audio/<file>`. `otraVoz()` dice si suena otra voz del juego y `audioListo()`
   * si el audio del navegador está corriendo (con el contexto suspendido, Howler dejaría la frase en cola para luego).
   */
  constructor({ load, random = Math.random, now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
    this.load = load;
    this.random = random;
    this.now = now;
    this.levels = { voices: 1 };
    this.paused = false;
    this.camera = null;
    this.otraVoz = () => false;
    this.audioListo = () => true;
    this._sounds = new Map();      // archivo → Howl
    this._fallidos = new Set();    // archivos que no cargaron
    this._bags = new Map();
    this._voz = null;              // { sound, id, source, gain, entry }
    this._listener = null;
    this._nextAmbient = null;      // la primera frase espera `primera` desde el arranque
    this._dijo = new WeakMap();    // persona → instante desde el que puede volver a decir algo al pasar
    this._precargaAt = 0;
    this.ultima = null;            // la última frase que mandó a sonar (pruebas y depuración)
  }

  /** Una frase grabada sonando. */
  get active() { return !!this._voz && this._voz.sound.playing(this._voz.id); }

  /** La voz de la persona: se decide una vez y la conserva. */
  vozDe(npc) {
    if (!npc) return null;
    return npc._voz ??= vozDePersona(npc, this.random);
  }

  /** Las frases que la persona puede decir al pasar: las de su voz. */
  frasesPara(npc) {
    const voz = this.vozDe(npc);
    return voz ? frasesDe('ambiente', voz) : [];
  }

  /**
   * La persona dice una frase al pasar, entre las suyas que ya están cargadas (o cuyo audio falló: esas, solo en la
   * burbuja). Devuelve true si la dijo; false si no puede hablar ahora o si todavía no tiene ninguna lista.
   */
  decir(npc) {
    if (!npc?.position || npc._disposed || this.paused || this.active || this.otraVoz() || !this.audioListo()) return false;
    const lista = this.frasesPara(npc);
    if (!lista.length) return false;
    this.precargar(npc);
    const listas = lista.filter(entry => {
      const file = audioFile(entry.audio);
      return this._fallidos.has(file) || this._sounds.get(file)?.state() === 'loaded';
    });
    if (!listas.length) return false;
    let bag = this._bags.get(npc._voz);
    if (!bag) this._bags.set(npc._voz, bag = new ShuffleBag(this.random));
    return this._sonar(bag.draw(listas, item => item.audio), npc);
  }

  _sonar(entry, source) {
    const file = audioFile(entry.audio);
    const { min, despues, sinAudio } = DIRECTOR.burbuja;
    this.ultima = { id: entry.id, audio: entry.audio, text: entry.text, voz: entry.voz };
    if (this._fallidos.has(file)) { source.say?.(entry.text, sinAudio); return true; }
    const sound = this._sounds.get(file);
    if (this._voz) this._cortar();
    const { rate, gain } = takeVariation(this.random);
    const id = sound.play();
    setRate(sound, rate, id);
    const voz = { sound, id, source, gain, entry };
    this._voz = voz;
    sound.volume(this._volumen(voz), id);
    setPan(sound, voicePan(this._listener, this.camera, source.position), id);
    source.say?.(entry.text, Math.max(min, (sound.duration() || 2) + despues));
    return true;
  }

  /** El Howl de un archivo: se crea al pedirlo. Si no carga, el archivo queda marcado y el Howl se suelta. */
  _sound(file) {
    if (this._sounds.has(file) || this._fallidos.has(file)) return;
    const sound = this.load?.(file);
    if (!sound) return;
    this._sounds.set(file, sound);
    sound.once?.('loaderror', () => {
      this._fallidos.add(file);
      this._sounds.delete(file);
      sound.unload?.();
    });
  }

  /** Empieza a cargar las frases que la persona diría al pasar. */
  precargar(npc) {
    for (const entry of this.frasesPara(npc)) this._sound(audioFile(entry.audio));
  }

  _volumen(voz) {
    const p = voz.source.position, l = this._listener;
    const distance = l && p ? Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z) : 0;
    return Math.min(1, DIRECTOR.volumen * loudnessGain(VOCES_LUFS) * voz.gain * this.levels.voices
      * voiceGain(distance, DIRECTOR.pleno, DIRECTOR.rango));
  }

  update(position, pedestrians = []) {
    this._listener = position;
    if (this.paused) return;
    const now = this.now();
    if (this._voz) {
      const voz = this._voz;
      const p = voz.source.position;
      if (!this.active) this._voz = null;
      else if (voz.source._disposed || Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z) > DIRECTOR.rango) this._cortar();
      else {
        voz.sound.volume(this._volumen(voz), voz.id);
        setPan(voz.sound, voicePan(position, this.camera, voz.source.position), voz.id);
      }
    }
    this._precargar(position, pedestrians, now);
    this._ambiente(position, pedestrians, now);
  }

  _precargar(position, pedestrians, now) {
    if (now < this._precargaAt || !position) return;
    this._precargaAt = now + DIRECTOR.precarga.cada;
    let cercano = null, mejor = DIRECTOR.precarga.alcance;
    for (const npc of pedestrians) {
      if (!npc?.position || npc._disposed || npc.koState) continue;
      const d = Math.hypot(npc.position.x - position.x, npc.position.z - position.z);
      if (d < mejor) { mejor = d; cercano = npc; }
    }
    if (cercano) this.precargar(cercano);
  }

  /** Entre los más cercanos que no hayan hablado hace poco, alguien dice algo al pasar. */
  _ambiente(position, pedestrians, now) {
    this._nextAmbient ??= now + DIRECTOR.ambiente.primera;
    if (now < this._nextAmbient || !position) return;
    const { alcance, pool, porPersona, min, extra, reintento } = DIRECTOR.ambiente;
    const candidatos = [];
    for (const npc of pedestrians) {
      if (!npc?.position || npc._disposed || npc.koState || npc.stance === 'dormido' || npc._bubbleEl) continue;
      if ((this._dijo.get(npc) ?? -Infinity) > now) continue;
      const d = Math.hypot(npc.position.x - position.x, npc.position.y - position.y, npc.position.z - position.z);
      if (d <= alcance) candidatos.push({ npc, d });
    }
    candidatos.sort((a, b) => a.d - b.d);
    const aptos = candidatos.slice(0, pool).filter(({ npc }) => this.frasesPara(npc).length);
    if (!aptos.length) { this._nextAmbient = now + reintento; return; }
    const { npc } = aptos[Math.floor(this.random() * aptos.length)];
    if (!this.decir(npc)) { this._nextAmbient = now + reintento; return; }
    this._dijo.set(npc, now + porPersona);
    this._nextAmbient = now + min + this.random() * extra;
  }

  _cortar() {
    const voz = this._voz;
    this._voz = null;
    if (voz?.sound.playing(voz.id)) voz.sound.stop(voz.id);
  }

  /** Cede el canal a una voz que pesa más (el reclamo por robo). */
  cancel() { this._cortar(); }

  setPaused(paused) { this.paused = paused; if (paused) this._cortar(); }

  dispose() {
    this._cortar();
    for (const sound of this._sounds.values()) sound.unload?.();
    this._sounds.clear();
  }
}
