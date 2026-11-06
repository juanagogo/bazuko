// src/systems/AudioSystem.js
import { Howl, Howler } from 'howler';
import { VehicleAudio } from './VehicleAudio.js';
import { STREET_VOICES, StreetVoices } from './StreetVoices.js';
import { PoliceSirenAudio } from './PoliceSirenAudio.js';
import { NPC_VOICE_BANK } from '../data/npcVoices.js';
import { frasesDe } from '../data/vocesCalle.js';
import { ShuffleBag, setPan, setRate, takeVariation, voicePan } from './voiceVariety.js';
import { WorldVoices } from './WorldVoices.js';

export const MIX_CATEGORIES = ['ambient', 'traffic', 'voices', 'effects'];
// El audio vive en public/audio: la ruta se arma con la base para que la demo de Pages funcione bajo su subcamino.
const AUDIO_BASE = `${import.meta.env?.BASE_URL ?? '/'}audio/`;
// Mientras suena una frase, tráfico y ambiente bajan a esta fracción para que se entienda.
const VOICE_DUCK = .45, DUCK_ATTACK = 10, DUCK_RELEASE = 2.5;
// Pisadas aisladas de Sounds_of_a_steps.opus (inicio y duración en ms).
const STEP_SPRITES = { step1: [215, 300], step2: [605, 300], step3: [995, 300], step4: [1385, 300],
  step5: [1785, 300], step6: [2185, 300], step7: [2575, 280] };
const STEP_NAMES = Object.keys(STEP_SPRITES);
// Metros entre pisadas: con la animación escalada por velocidad mantiene el ritmo de los pies.
const STRIDE_WALK = 1.25, STRIDE_RUN = 1.45;
// Las voces de public/audio/voces se cargan cuando alguien las va a decir y solo las recientes se quedan en memoria:
// decodificadas pesan unas veinte veces lo que pesa el mp3. Si aún no carga, la frase espera un momento y sale.
const LAZY_VOICE_CACHE = 40, PENDING_VOICE_S = 1.2;
const NPC_VOICE_RANGE = 14, NPC_VOICE_LEVEL = .8;
// Quién del reparto dice el robo y el rebusque de cada conductor: Roberto tiene sus frases; Valentina las de la conductora.
const CAR_LINE_VOICE = { roberto: 'conductor', valentina: 'conductora', conductor: 'conductor', conductora: 'conductora', busetero: 'busetero' };
/** Ruta dentro de public/audio, con subcarpeta si la tiene ('/audio/voces/x.mp3' → 'voces/x.mp3'). */
const audioFile = path => path.replace(/^.*?\/audio\//, '');
const isLazyVoice = file => file.startsWith('voces/');
const STEP_SURFACES = {
  grass: { volume: .3, rate: .88 }, dirt: { volume: .34, rate: .9 },
  road: { volume: .46, rate: 1 }, busway: { volume: .46, rate: 1 },
  sidewalk: { volume: .5, rate: 1 }, floor: { volume: .5, rate: 1 }, plaza: { volume: .5, rate: 1 }
};

export class AudioSystem {
  constructor({ HowlClass = Howl, howler = Howler, eventTarget = globalThis.window } = {}) {
    this.howler = howler;
    this.loadErrors = new Map();
    this._baseVolume = new Map();
    const sound = (file, options = {}) => {
      const files = Array.isArray(file) ? file : [file];
      const fileLabel = files.map(name => `${AUDIO_BASE}${name}`).join(' o ');
      return this._track(options.volume ?? 1, new HowlClass({
        src: files.map(name => `${AUDIO_BASE}${name.split('/').map(encodeURIComponent).join('/')}`), ...options,
        onload: () => this.loadErrors.delete(files[0]),
        onloaderror: (_id, error) => {
          if (!this.loadErrors.has(files[0])) console.error(`[Audio] No se pudieron cargar ${fileLabel}:`, error);
          this.loadErrors.set(files[0], String(error));
        },
        onplayerror(id) { this.once('unlock', () => this.play(id)); }
      }));
    };
    this._npcSoundFactory = sound;
    this._npcSounds = new Map();
    // Las de combate de siempre quedan precargadas; las de public/audio/voces, al pedirlas.
    for (const entry of Object.values(NPC_VOICE_BANK).flat()) {
      const file = audioFile(entry.audio);
      if (!isLazyVoice(file) && !this._npcSounds.has(file)) this._npcSounds.set(file, sound(file, { volume: 0 }));
    }
    this._eagerVoices = new Set(this._npcSounds.keys());
    this._npcVoice = null;
    this._pendingVoice = null;
    this._clock = 0;
    // Volumen maestro (0.0 a 1.0)
    this.eventTarget = eventTarget;
    this._masterVolume = .7; this.muted = false;
    try {
      const saved = globalThis.localStorage?.getItem('bazuko.audio_volume');
      if (saved !== null && saved !== undefined && Number.isFinite(Number(saved))) this._masterVolume = Math.max(0, Math.min(1, Number(saved)));
      this.muted = globalThis.localStorage?.getItem('bazuko.audio_muted') === 'true';
    } catch { /* sin almacenamiento */ }
    howler.volume(this.muted ? 0 : this._masterVolume);
    this.mix = Object.fromEntries(MIX_CATEGORIES.map(category => [category, 1]));
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem('bazuko.audio_mix') ?? 'null');
      for (const category of MIX_CATEGORIES) {
        if (Number.isFinite(saved?.[category])) this.mix[category] = Math.max(0, Math.min(1, saved[category]));
      }
    } catch { /* sin almacenamiento o valor dañado */ }
    this._duck = 1;

    // Definir sonidos. Si el archivo no existe, Howl queda en silencio
    // pero NO crashea (maneja el error internamente).
    this.sounds = {
      pickup: sound('pickup.wav', { volume: .6 }),
      treasure: sound('treasure.wav', { volume: .9 }),
      sell: sound('sell.wav', { volume: .8 }),
      full: sound('full.wav', { volume: .5 }),
      empty: sound('empty.wav', { volume: .4 }),
      carAlarm: sound('Sonido De Alarma De Auto.opus', { volume: .6, loop: false, pool: 6 }),
      steps: sound('Sounds_of_a_steps.opus', { volume: .65, sprite: STEP_SPRITES, pool: 6 }),
      ambient: sound('city_atmosphere_soun.opus', { volume: .18, loop: true }),
      rain: sound('rain_sound_01.mp3', { volume: .45, loop: true })
    };
    // Reproducción normal: sin posiciones, panners ni atenuación 3D.
    const vehicleOptions = { volume: 0, loop: true, pool: 10 };
    const vehicleSound = (file, options) => sound([file, file.replace(/\.opus$/, '.mp3')], options);
    this.vehicleSounds = {
      carIdle: vehicleSound('car_idling_at_a_traf.opus', vehicleOptions),
      carDrive: vehicleSound('small_vehicle_drivin.opus', vehicleOptions),
      busIdle: vehicleSound('car_idling_at_a_traf_bus.opus', vehicleOptions),
      busDrive: vehicleSound('bus_vehicle_drivin.opus', vehicleOptions),
      // Tomar una sola pitada de cada grabación evita reproducir secuencias de casi 8 s.
      horn1: vehicleSound('car_horn_sound1.opus', { ...vehicleOptions, loop: false, sprite: { honk: [900, 550] } }),
      horn2: vehicleSound('car_horn_sound.opus', { ...vehicleOptions, loop: false, sprite: { honk: [1000, 600] } }),
      horn3: vehicleSound('car_horn_sound_v3.opus', { ...vehicleOptions, loop: false, sprite: { honk: [200, 650] } })
    };
    // Quién habla en cada frase: cada carro queda con uno de sus conductores y el bus con el busetero.
    const driverLines = [
      ...[1, 3, 4, 5, 6, 7].map(n => ({ file: `valentina_n${n}.mp3`, voice: 'valentina' })),
      ...Array.from({ length: 6 }, (_, i) => ({ file: `roberto_n${i + 1}.mp3`, voice: 'roberto' })),
      ...frasesDe('pito').map(frase => ({ file: audioFile(frase.audio), voice: frase.voz }))
    ];
    this.driverSounds = driverLines.map(({ file }) => sound(file, { volume: 0, loop: false, pool: 8 }));
    this.driverVoices = driverLines.map(({ voice }) => voice);
    const theftLines = [
      ...Array.from({ length: 5 }, (_, i) => ({ file: `roberto_robo_espejo_n${i + 1}.mp3`, voice: 'roberto' })),
      ...frasesDe('robo_espejo').map(frase => ({ file: audioFile(frase.audio), voice: frase.voz }))
    ];
    this.theftSounds = theftLines.map(({ file }) => sound(file, { volume: 0, loop: false, pool: 6 }));
    this.theftVoices = theftLines.map(({ voice }) => voice);
    this._carLineBags = new Map();
    // Frases de la calle: su volumen lo pone StreetVoices según la distancia.
    this.streetVoiceSounds = Object.fromEntries(STREET_VOICES.map(clip => [clip.key, sound(clip.file, { volume: 0, loop: false, pool: 1 })]));
    this._theftVoices = new Map();
    this.vehicles = new VehicleAudio(this.vehicleSounds, Math.random, this.driverSounds, this.driverVoices);
    // Policía, jíbaro y voceador del bus: salen de su sitio por el mismo canal que la gente de la calle.
    this.worldVoices = new WorldVoices({ audio: this, eventTarget, random: () => this.vehicles.random() });
    // Un solo azar para todas las voces (el de los vehículos, que las pruebas fijan).
    this._theftBag = new ShuffleBag(() => this.vehicles.random());
    this._camera = null;
    this.streetVoices = new StreetVoices({ bank: this.streetVoiceSounds });
    this.policeSiren = new PoliceSirenAudio({ fx: () => this._fx() });
    // Una sola voz a la vez entre conductores, robo y calle.
    this.vehicles.externalVoiceActive = () => this._theftVoiceActive() || this.streetVoices.active;
    this.streetVoices.externalVoiceActive = () => this._theftVoiceActive() || this.vehicles.remarkPlaying();
    this._carAlarms = new Map();

    // El audio es opcional: un archivo ausente o bloqueado no impide jugar.
    this.ready = Promise.all([...Object.values(this.sounds), ...Object.values(this.vehicleSounds), ...this.driverSounds, ...this.theftSounds, ...Object.values(this.streetVoiceSounds), ...this._npcSounds.values()].map(sound => new Promise(resolve => {
      if (sound.state() === 'loaded') { resolve(); return; }
      const done = () => {
        clearTimeout(timer);
        sound.off('load', done);
        sound.off('loaderror', done);
        resolve();
      };
      const timer = setTimeout(done, 5000);
      sound.once('load', done);
      sound.once('loaderror', done);
    })));

    this._stepsPlaying = false;
    this._stepDistance = 0;
    this._lastStep = -1;
    this._boostPlaying = false;
    this._ambientStarted = false;
    this._lastGroundType = 'sidewalk';
    this._lastRunning = false;
    // Las pitadas entre carros solo se oyen cerca del jugador y comparten el límite de claxones.
    this._carHonk = (event) => {
      const { x, z } = event.detail ?? {};
      if (Number.isFinite(x) && Number.isFinite(z)) this.vehicles.ambientHonk(x, z, this._listenerPosition);
    };
    eventTarget?.addEventListener('car-honk', this._carHonk);

    // Desbloquear audio tras primer click (política de navegadores)
    const unlock = () => {
      if (howler.ctx && howler.ctx.state === 'suspended') {
        howler.ctx.resume();
      }
      eventTarget?.removeEventListener('click', unlock);
      eventTarget?.removeEventListener('keydown', unlock);
    };
    eventTarget?.addEventListener('click', unlock);
    eventTarget?.addEventListener('keydown', unlock);
    this._removeUnlock = () => { eventTarget?.removeEventListener('click', unlock); eventTarget?.removeEventListener('keydown', unlock); };
    this._visibilityChanged = () => {
      if (globalThis.document?.hidden) this.setPaused(true);
    };
    globalThis.document?.addEventListener?.('visibilitychange', this._visibilityChanged);
    this._dogBark = () => this.barkDog();
    eventTarget?.addEventListener('dog-bark', this._dogBark);
  }

  get volume() { return this._masterVolume; }
  setVolume(value) {
    this._masterVolume = Math.max(0, Math.min(1, Number(value) || 0));
    this._applySettings(); return this.volume;
  }
  setMuted(value) { this.muted = !!value; this._applySettings(); return this.muted; }
  toggleMute() { return this.setMuted(!this.muted); }
  isMuted() { return this.muted; }

  _track(volume, howl) { this._baseVolume.set(howl, volume); return howl; }

  /** Volumen de una categoría (ambiente, tráfico, voces, efectos), de 0 a 1. */
  getMix(category) { return this.mix[category] ?? 1; }
  setMix(category, value) {
    if (!MIX_CATEGORIES.includes(category)) return 1;
    this.mix[category] = Math.max(0, Math.min(1, Number(value) || 0));
    if (this._effectsBus) this._effectsBus.gain.value = this._paused ? 0 : this._level('effects');
    this._applyLevels(true);
    try { globalThis.localStorage?.setItem('bazuko.audio_mix', JSON.stringify(this.mix)); } catch { /* sin almacenamiento */ }
    return this.mix[category];
  }

  /** Nivel efectivo: el de la categoría y, para tráfico y ambiente, la atenuación por voz. */
  _level(category) {
    return this.getMix(category) * (category === 'traffic' || category === 'ambient' ? this._duck : 1);
  }

  _theftVoiceActive() {
    if (this._npcVoice?.sound.playing(this._npcVoice.id)) return true;
    for (const voice of this._theftVoices.values()) if (voice.sound.playing(voice.id)) return true;
    return false;
  }

  _voiceActive() { return this.vehicles.externalVoiceActive() || this.vehicles.remarkPlaying(); }

  /** Ajusta los bucles que no se recalculan cada cuadro (ambiente y lluvia). */
  _applyLevels(force = false) {
    this.vehicles.levels = { traffic: this._level('traffic'), voices: this._level('voices') };
    this.streetVoices.levels.voices = this._level('voices');
    const ambient = this._level('ambient');
    if (!force && Math.abs(ambient - (this._appliedAmbient ?? -1)) < .002) return;
    this._appliedAmbient = ambient;
    if (this._ambientId !== undefined) this.sounds.ambient.volume(this._baseVolume.get(this.sounds.ambient) * ambient, this._ambientId);
    if (this._rainId !== undefined) this.sounds.rain.volume(this._baseVolume.get(this.sounds.rain) * ambient, this._rainId);
  }
  // Silencia el banco de la calle y conserva la preferencia de volumen general.
  setVenueMuted(muted) {
    this._venueMuted = !!muted;
    this.howler.volume(this.muted || this._venueMuted ? 0 : this.volume);
  }

  _applySettings() {
    this.howler.volume(this.muted || this._venueMuted ? 0 : this.volume);
    try {
      globalThis.localStorage?.setItem('bazuko.audio_volume', String(this.volume));
      globalThis.localStorage?.setItem('bazuko.audio_muted', String(this.muted));
    } catch { /* sin almacenamiento */ }
    this.eventTarget?.dispatchEvent(new CustomEvent('audio-settings-change', { detail: { volume: this.volume, muted: this.muted } }));
  }

  play(name) {
    const s = this.sounds[name];
    if (!s || s.playing()) return;
    const id = s.play();
    s.volume(this._baseVolume.get(s) * this._level('effects'), id);
  }

  /** Ladrido breve sintetizado; usa el mismo volumen maestro y silencio que los vehículos. */
  barkDog() {
    const fx = this._fx();
    if (!fx || !fx.ctx.createBuffer) return;
    const { ctx, out } = fx;
    if (!this._barkBuffer) {
      this._barkBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .18), ctx.sampleRate);
      const data = this._barkBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 24) * Math.min(1, t * 250)
          * (.5 + .5 * Math.sin(t * 2 * Math.PI * 140));
      }
    }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this._barkBuffer; filter.type = 'bandpass'; filter.frequency.value = 700; filter.Q.value = .7;
    gain.gain.value = .5;
    source.connect(filter); filter.connect(gain); gain.connect(out);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  }

  /** Golpe seco sintetizado (varilla); comparte mezcla de efectos, maestro, silencio y pausa. */
  playThud() {
    const fx = this._fx();
    if (!fx || !fx.ctx.createBuffer) return;
    const { ctx, out } = fx;
    if (!this._thudBuffer) {
      this._thudBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .16), ctx.sampleRate);
      const data = this._thudBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        data[i] = ((Math.random() * 2 - 1) * .5 + Math.sin(t * 2 * Math.PI * 75) * .9) * Math.exp(-t * 30);
      }
    }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this._thudBuffer; filter.type = 'lowpass'; filter.frequency.value = 800;
    gain.gain.value = .7;
    source.connect(filter); filter.connect(gain); gain.connect(out);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  }

  stop(name) {
    this.sounds[name]?.stop();
  }

  playCarAlarm(car) {
    const sound = this.sounds.carAlarm;
    if (!car || car.traffic || this._paused || sound.state() !== 'loaded') return false;
    const current = this._carAlarms.get(car);
    if (current && (current.paused || sound.playing(current.id))) return false;
    const alarm = { id: sound.play(), paused: false, volume: this._alarmVolume(car, this._listenerPosition) };
    sound.volume(alarm.volume, alarm.id);
    this._carAlarms.set(car, alarm);
    return true;
  }

  _alarmVolume(car, listener) {
    if (!car.position || !listener) return .6 * this._level('traffic');
    const distance = Math.hypot(car.position.x - listener.x, car.position.y - listener.y, car.position.z - listener.z);
    // Volumen completo a cinco metros; silencio desde los 41 m, sin panner espacial.
    return .6 * this._level('traffic') * Math.max(0, Math.min(1, (41 - distance) / 36));
  }

  playMovingTheft(car) {
    if (!car?.traffic || this._paused) return false;
    // Reclama el conductor de ese carro: Roberto con las suyas, los demás con las de conductor o conductora.
    const driver = this.vehicles.driverVoice(car);
    const voice = this.theftVoices.includes(driver) ? driver : CAR_LINE_VOICE[driver] ?? 'roberto';
    const own = this.theftSounds.filter((_, index) => this.theftVoices[index] === voice);
    const sound = this._theftBag.draw(own.length ? own : this.theftSounds);
    if (sound.state() !== 'loaded') return false;
    this._startCarVoice(car, sound);
    return true;
  }

  /**
   * El conductor de `car` (o el busetero del bus) dice una frase de su situación en vocesCalle.js: el rebusque en el
   * semáforo (`semaforo_no`, `semaforo_bravo`, `semaforo_si`, `semaforo_verde`). Sin frase para él, no dice nada.
   */
  playDriverLine(car, situacion, { bus = false } = {}) {
    if (!car?.position || this._paused || this.muted) return false;
    const voice = CAR_LINE_VOICE[this.vehicles.driverVoice(car, null, bus)];
    const lines = frasesDe(situacion, voice);
    if (!lines.length) return false;
    const key = `${voice}_${situacion}`;
    if (!this._carLineBags.has(key)) this._carLineBags.set(key, new ShuffleBag(() => this.vehicles.random()));
    const sound = this._voiceSound(audioFile(this._carLineBags.get(key).draw(lines, line => line.id).audio));
    if (sound.state() !== 'loaded') { this._wait(sound, () => this._startCarVoice(car, sound)); return false; }
    this._startCarVoice(car, sound);
    return true;
  }

  /** Una sola voz a la vez: la del carro reemplaza cualquier otra frase en curso. */
  _startCarVoice(car, sound) {
    for (const previous of this._theftVoices.values()) previous.sound.stop(previous.id);
    this._theftVoices.clear();
    this.vehicles.stopRemarks();
    this.streetVoices.cancel();
    this._npcVoice?.sound.stop(this._npcVoice.id); this._npcVoice = null;
    const { rate, gain } = takeVariation(() => this.vehicles.random());
    const voice = { sound, id: sound.play(), gain };
    setRate(sound, rate, voice.id);
    sound.volume(gain * this._theftVolume(car, this._listenerPosition), voice.id);
    setPan(sound, voicePan(this._listenerPosition, this._camera, car.position), voice.id);
    this._theftVoices.set(car, voice);
    // El reclamo por el robo reemplaza la frase normal de obstrucción de ese conductor.
    const driver = this.vehicles.instances.get(car);
    if (driver) {
      const cooldown = sound.duration() + .5;
      driver.cooldown = Math.max(driver.cooldown, cooldown);
      driver.remarkCooldown = Math.max(driver.remarkCooldown, cooldown);
    }
    return true;
  }

  _theftVolume(car, listener) {
    if (!car.position || !listener) return .75 * this._level('voices');
    const distance = Math.hypot(car.position.x - listener.x, car.position.y - listener.y, car.position.z - listener.z);
    return .75 * this._level('voices') * Math.max(0, Math.min(1, (12 - distance) / 10));
  }

  /** El Howl de una voz: las precargadas siempre; las de voces/ se crean al pedirlas y las viejas se descargan. */
  _voiceSound(file) {
    let sound = this._npcSounds.get(file);
    if (sound) {
      if (!this._eagerVoices.has(file)) { this._npcSounds.delete(file); this._npcSounds.set(file, sound); } // la más reciente
      return sound;
    }
    sound = this._npcSoundFactory(file, { volume: 0 });
    this._npcSounds.set(file, sound);
    let excess = this._npcSounds.size - this._eagerVoices.size - LAZY_VOICE_CACHE;
    for (const [old, voice] of this._npcSounds) {
      if (excess <= 0) break;
      if (this._eagerVoices.has(old) || old === file || voice.playing() || voice === this._pendingVoice?.sound) continue;
      voice.unload(); this._npcSounds.delete(old); excess--;
    }
    return sound;
  }

  /** Empieza a cargar una voz que va a sonar enseguida (la segunda de una conversación por radio). */
  prefetchVoice(path) { if (path && isLazyVoice(audioFile(path))) this._voiceSound(audioFile(path)); }

  /** La frase sale cuando termine de cargar, si no pasa mucho; una nueva espera reemplaza a la anterior. */
  _wait(sound, start) { this._pendingVoice = { sound, start, until: this._clock + PENDING_VOICE_S }; }

  /**
   * Voz de alguien en la calle (peatón, patrulla, jíbaro, bus): sale de su posición, más bajo con la distancia,
   * y no se superpone con otra. `range` es dónde ya no se oye; `force` calla la que esté sonando.
   */
  playNpcVoice(path, owner, { allowKnockedOut = false, allowPaused = false, range = NPC_VOICE_RANGE, level = NPC_VOICE_LEVEL, force = false } = {}) {
    if ((this._paused && !allowPaused) || this.muted || !owner?.position) return false;
    if (this._voiceActive()) {
      if (!force) return false;
      this._silenceVoices();
    }
    const distance = this._listenerPosition ? owner.position.distanceTo(this._listenerPosition) : 0;
    if (distance > range) return false;
    const sound = this._voiceSound(audioFile(path));
    if (sound.state() !== 'loaded') {
      this._wait(sound, () => this.playNpcVoice(path, owner, { allowKnockedOut, allowPaused, range, level }));
      return false;
    }
    const id = sound.play();
    const { rate, gain } = takeVariation(() => this.vehicles.random());
    setRate(sound, rate, id);
    sound.volume(gain * level * this._level('voices') * Math.max(0, 1 - distance / range), id);
    setPan(sound, voicePan(this._listenerPosition, this._camera, owner.position), id);
    this._npcVoice = { sound, id, owner, allowKnockedOut, gain, range, level };
    return true;
  }

  /** Calla toda voz en curso para que entre una que no puede esperar (arresto, radio). */
  _silenceVoices() {
    for (const voice of this._theftVoices.values()) voice.sound.stop(voice.id);
    this._theftVoices.clear();
    this.vehicles.stopRemarks();
    this.streetVoices.cancel();
    if (this._npcVoice) { this._npcVoice.sound.stop(this._npcVoice.id); this._npcVoice = null; }
  }

  playPlayerDeath(owner) {
    const voice = NPC_VOICE_BANK.knockout.find(entry => entry.audio === '/audio/ahh.mp3');
    if (!voice) return false;
    if (this._npcVoice) this._npcVoice.sound.stop(this._npcVoice.id);
    this._npcVoice = null;
    return this.playNpcVoice(voice.audio, owner, { allowKnockedOut: true, allowPaused: true });
  }

  /**
   * Pisadas sueltas cada cierta distancia recorrida en el suelo (travelled, en metros por cuadro).
   * Sin distancia (llamadas antiguas) se estima con la velocidad nominal del jugador.
   */
  updateSteps(moving, running, groundType = 'sidewalk', isRaining = false, travelled = null, dt = 1 / 60) {
    const stride = running ? STRIDE_RUN : STRIDE_WALK;
    if (!moving) {
      // Al arrancar, la primera pisada llega pronto en lugar de esperar un paso completo.
      this._stepDistance = stride * .6;
      this._stepsPlaying = false;
      return;
    }
    this._stepsPlaying = true;
    this._lastGroundType = groundType;
    this._lastRunning = running;
    if (this._paused) return;
    this._stepDistance += travelled ?? (running ? 6 : 3) * dt;
    if (this._stepDistance < stride) return;
    this._stepDistance %= stride;
    this._playStep(running, groundType);
  }

  _playStep(running, groundType) {
    const s = this.sounds.steps;
    if (!s || s.state() !== 'loaded') return;
    // Evita repetir la misma pisada dos veces seguidas.
    let index = Math.floor(Math.random() * (STEP_NAMES.length - 1));
    if (index >= this._lastStep) index++;
    this._lastStep = index;
    const surface = STEP_SURFACES[groundType] ?? STEP_SURFACES.sidewalk;
    const id = s.play(STEP_NAMES[index]);
    s.volume(surface.volume * (running ? 1.12 : 1) * (.85 + Math.random() * .15) * this._level('effects'), id);
    s.rate(surface.rate * (.98 + Math.random() * .04), id);
  }

  updateBoost(active) {
    const s = this.sounds.boost;
    if (!s) return;

    if (active && !this._boostPlaying) {
      s.play();
      this._boostPlaying = true;
    }
    if (!active && this._boostPlaying) {
      s.stop();
      this._boostPlaying = false;
    }
  }

  startAmbient() {
    if (this._ambientStarted) return;
    this._ambientId = this.sounds.ambient?.play();
    this._ambientStarted = true;
    this._applyLevels(true);
  }

  setRaining(raining) {
    this._raining = !!raining;
    this._syncRain();
  }

  _syncRain() {
    const sound = this.sounds.rain;
    if (!this._raining) {
      if (this._rainId !== undefined) sound.stop(this._rainId);
      this._rainId = undefined;
    } else if (this._paused) {
      if (this._rainId !== undefined && sound.playing(this._rainId)) sound.pause(this._rainId);
    } else if (sound.state() === 'loaded' && (this._rainId === undefined || !sound.playing(this._rainId))) {
      this._rainId = sound.play(this._rainId);
      sound.volume(this._baseVolume.get(sound) * this._level('ambient'), this._rainId);
    }
  }

  setPaused(paused) {
    if (this._paused === paused) return;
    this._paused = paused;
    if (this._effectsBus) this._effectsBus.gain.value = paused ? 0 : this._level('effects');
    if (paused && this._npcVoice) { this._npcVoice.sound.stop(); this._npcVoice = null; }
    if (paused) this._pendingVoice = null;
    this._syncRain();
    this.vehicles.setPaused(paused);
    this.streetVoices.setPaused(paused);
    if (paused) {
      for (const voice of this._theftVoices.values()) voice.sound.stop(voice.id);
      this._theftVoices.clear();
    }
    for (const [car, alarm] of this._carAlarms) {
      const sound = this.sounds.carAlarm;
      if (paused && sound.playing(alarm.id)) {
        sound.pause(alarm.id); alarm.paused = true;
      } else if (!paused && alarm.paused) {
        sound.play(alarm.id); alarm.paused = false;
      } else if (!alarm.paused && !sound.playing(alarm.id)) this._carAlarms.delete(car);
    }
    if (paused) {
      this.updateSteps(false, false); this.updateBoost(false);
      if (this._ambientId !== undefined) this.sounds.ambient.pause(this._ambientId);
    } else if (this._ambientStarted) this.sounds.ambient.play(this._ambientId);
  }

  updateWorld(dt, position, camera, vehicles, bus, pedestrians) {
    this._listenerPosition = position;
    this._camera = camera ?? null;
    this._clock += dt;
    this.vehicles.camera = this.streetVoices.camera = this._camera;
    if (this._npcVoice) {
      const v = this._npcVoice, distance = v.owner.position.distanceTo(position), range = v.range ?? NPC_VOICE_RANGE;
      if (v.owner._disposed || (v.owner.hp <= 0 && !v.allowKnockedOut) || distance > range || !v.sound.playing(v.id)) {
        v.sound.stop(); this._npcVoice = null;
      } else {
        v.sound.volume((v.gain ?? 1) * (v.level ?? NPC_VOICE_LEVEL) * this._level('voices') * Math.max(0, 1 - distance / range), v.id);
        setPan(v.sound, voicePan(position, this._camera, v.owner.position), v.id);
      }
    }
    this.setPaused(false);
    const pending = this._pendingVoice;
    if (pending && (this._clock > pending.until || pending.sound.state() === 'loaded')) {
      this._pendingVoice = null;
      if (this._clock <= pending.until) pending.start();
    }
    const duckTarget = this._voiceActive() ? VOICE_DUCK : 1;
    this._duck += (duckTarget - this._duck) * (1 - Math.exp(-dt * (duckTarget < this._duck ? DUCK_ATTACK : DUCK_RELEASE)));
    this._applyLevels();
    this.vehicles.update(dt, position, vehicles, bus);
    this.policeSiren.update(dt, position, vehicles);
    this.streetVoices.update(position, pedestrians);
    this.worldVoices.update(dt, position, vehicles, bus);
    for (const [car, voice] of this._theftVoices) {
      if (!voice.sound.playing(voice.id)) this._theftVoices.delete(car);
      else {
        voice.sound.volume((voice.gain ?? 1) * this._theftVolume(car, position), voice.id);
        setPan(voice.sound, voicePan(position, this._camera, car.position), voice.id);
      }
    }
    for (const [car, alarm] of this._carAlarms) {
      if (!alarm.paused && !this.sounds.carAlarm.playing(alarm.id)) {
        this._carAlarms.delete(car);
        continue;
      }
      const volume = this._alarmVolume(car, position);
      if (Math.abs(volume - alarm.volume) > .001 || (volume === 0 && alarm.volume !== 0)) {
        this.sounds.carAlarm.volume(volume, alarm.id);
        alarm.volume = volume;
      }
    }
  }

  dispose() {
    for (const sound of this._npcSounds.values()) sound.unload();
    this._npcSounds.clear(); this._npcVoice = null; this._pendingVoice = null;
    this.worldVoices.dispose();
    this._theftVoices.clear();
    this._carAlarms.clear();
    this.streetVoices.clear();
    this.eventTarget?.removeEventListener('dog-bark', this._dogBark);
    this.eventTarget?.removeEventListener('car-honk', this._carHonk);
    this.vehicles.clear();
    this._removeUnlock();
    globalThis.document?.removeEventListener?.('visibilitychange', this._visibilityChanged);
    for (const sound of [...Object.values(this.sounds), ...Object.values(this.vehicleSounds), ...this.driverSounds, ...this.theftSounds, ...Object.values(this.streetVoiceSounds)]) sound.unload();
  }

  /** ===== Efectos Procedurales (Web Audio) ===== */

  /** Contexto activo para efectos sintetizados; pasan por el volumen maestro y callan en pausa. */
  _fx() {
    if (this._paused || this.muted || typeof window === 'undefined') return null;
    const ctx = this.howler.ctx;
    if (!ctx || ctx.state !== 'running' || !this.howler.masterGain) return null;
    if (!this._effectsBus || this._effectsBus.context !== ctx) {
      this._effectsBus = ctx.createGain();
      this._effectsBus.connect(this.howler.masterGain);
    }
    this._effectsBus.gain.value = this._level('effects');
    return { ctx, out: this._effectsBus };
  }


  playFart() {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, t);
      filter.frequency.linearRampToValueAtTime(70, t + 0.38);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(130, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.38);

      gain.gain.setValueAtTime(0.45, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.39);
    } catch {}
  }

  playWhoosh() {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.linearRampToValueAtTime(420, t + 0.08);
      osc.frequency.linearRampToValueAtTime(110, t + 0.24);

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.25);
    } catch {}
  }

  playSplat() {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(290, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);

      gain.gain.setValueAtTime(0.55, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.19);
    } catch {}
  }

  playHeartbeat(intensity = 1) {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;
      const makeThump = (offset, vol) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(65, t + offset);
        osc.frequency.exponentialRampToValueAtTime(28, t + offset + 0.12);
        gain.gain.setValueAtTime(vol * 0.45, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.12);
        osc.connect(gain);
        gain.connect(out);
        osc.start(t + offset);
        osc.stop(t + offset + 0.13);
      };
      makeThump(0, 1 * intensity);
      makeThump(0.14, 0.7 * intensity);
    } catch {}
  }

  playPsychosisWhisper() {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const dur = 1.1;
      const bufSize = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.25;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750 + Math.random() * 500, ctx.currentTime);
      filter.Q.value = 3.5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.25);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + dur);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      src.start();
      src.stop(ctx.currentTime + dur);
    } catch {}
  }

  playCarHorn(frequency = 415, duration = 0.28) {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;

      // Doble tono armónico típico de bocina de carro
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(frequency, t);

      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(frequency * 1.25, t); // tercera mayor

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
      gain.gain.setValueAtTime(0.32, t + duration - 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(out);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + duration);
      osc2.stop(t + duration);
    } catch {}
  }

  playCartRumble() {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;
      const dur = 0.15;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(75 + Math.random() * 20, t);
      osc.frequency.linearRampToValueAtTime(85, t + dur);
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.linearRampToValueAtTime(0.01, t + dur);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + dur);
    } catch {}
  }


  playJump() {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(320, t + 0.16);
      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.17);
    } catch {}
  }

  /** Salpicadura breve reutilizable; sigue el canal de efectos, silencio y pausa. */
  playWaterSplash(intensity = .5) {
    const fx = this._fx();
    if (!fx || !fx.ctx.createBuffer) return;
    try {
      const { ctx, out } = fx;
      if (!this._splashBuffer || this._splashBuffer.sampleRate !== ctx.sampleRate) {
        this._splashBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .36), ctx.sampleRate);
        const data = this._splashBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.6);
      }
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = this._splashBuffer;
      filter.type = 'bandpass'; filter.frequency.value = 750; filter.Q.value = .5;
      gain.gain.value = .08 + Math.max(0, Math.min(1, intensity)) * .25;
      source.connect(filter); filter.connect(gain); gain.connect(out);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start();
    } catch { /* El audio opcional no bloquea la natación. */ }
  }

  playLanding() {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(95, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.12);
      gain.gain.setValueAtTime(0.42, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.13);
    } catch {}
  }

  playPunchHit() {
    const fx = this._fx();
    if (!fx) return;
    try {
      const { ctx, out } = fx;
      const t = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'square';
      osc1.frequency.setValueAtTime(180, t);
      osc1.frequency.exponentialRampToValueAtTime(50, t + 0.08);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(120, t);
      osc2.frequency.exponentialRampToValueAtTime(30, t + 0.15);

      gain.gain.setValueAtTime(0.55, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(out);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.15);
      osc2.stop(t + 0.15);
    } catch {}
  }

  /** Volumen del bucle de lluvia según la intensidad del clima (llovizna suave, tormenta fuerte). */
  setRainLevel(level = 0) {
    const sound = this.sounds.rain;
    if (this._rainId === undefined || !sound?.volume) return;
    const mix = typeof this._level === 'function' ? this._level('ambient') : 1;
    const volume = (this._baseVolume?.get(sound) ?? .45) * (.4 + .6 * Math.max(0, Math.min(1, level))) * mix;
    if (this._rainVolumeId === this._rainId && Math.abs(volume - this._rainVolume) < .01) return;
    this._rainVolumeId = this._rainId;
    this._rainVolume = volume;
    sound.volume(volume, this._rainId);
  }

  /**
   * Trueno sintetizado: llega con el retraso del sonido (343 m/s) y los lejanos
   * pierden agudos y volumen. Pasa por el volumen maestro mediante `_fx()`.
   */
  playThunder(distance = 1200) {
    const fx = this._fx();
    if (!fx || !fx.ctx.createBuffer) return;
    try {
      const { ctx, out } = fx;
      if (!this._thunderBuffer) {
        const length = Math.ceil(ctx.sampleRate * 4);
        this._thunderBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = this._thunderBuffer.getChannelData(0);
        let brown = 0;
        for (let i = 0; i < length; i++) {
          brown = (brown + .02 * (Math.random() * 2 - 1)) / 1.02;
          data[i] = brown * 3.5;
        }
      }
      const near = Math.max(0, Math.min(1, 1 - (distance - 300) / 2200));
      const t = ctx.currentTime + Math.min(7, distance / 343);
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = this._thunderBuffer;
      source.playbackRate.value = .75 + Math.random() * .3;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220 + near * 900, t);
      filter.frequency.exponentialRampToValueAtTime(120 + near * 100, t + 3);
      const peak = .25 + near * .55;
      gain.gain.setValueAtTime(.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + (near > .6 ? .03 : .35));
      gain.gain.setValueAtTime(peak * .7, t + .5);
      gain.gain.linearRampToValueAtTime(peak * .45, t + 1.4);
      gain.gain.exponentialRampToValueAtTime(.001, t + 3.6);
      source.connect(filter); filter.connect(gain); gain.connect(out);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(t);
      source.stop(t + 3.7);
    } catch {}
  }
}
