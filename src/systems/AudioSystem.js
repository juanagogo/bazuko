// src/systems/AudioSystem.js
import { Howl, Howler } from 'howler';
import { VehicleAudio } from './VehicleAudio.js';

export class AudioSystem {
  constructor({ HowlClass = Howl, howler = Howler, eventTarget = globalThis.window } = {}) {
    this.howler = howler;
    this.loadErrors = new Map();
    const sound = (file, options = {}) => new HowlClass({
      src: [`/audio/${encodeURIComponent(file)}`], ...options,
      onload: () => this.loadErrors.delete(file),
      onloaderror: (_id, error) => {
        if (!this.loadErrors.has(file)) console.error(`[Audio] No se pudo cargar /audio/${file}:`, error);
        this.loadErrors.set(file, String(error));
      },
      onplayerror(id) { this.once('unlock', () => this.play(id)); }
    });
    // Volumen maestro (0.0 a 1.0)
    this.eventTarget = eventTarget;
    this._masterVolume = .7; this.muted = false;
    try {
      const saved = globalThis.localStorage?.getItem('bazuko.audio_volume');
      if (saved !== null && saved !== undefined && Number.isFinite(Number(saved))) this._masterVolume = Math.max(0, Math.min(1, Number(saved)));
      this.muted = globalThis.localStorage?.getItem('bazuko.audio_muted') === 'true';
    } catch { /* sin almacenamiento */ }
    howler.volume(this.muted ? 0 : this._masterVolume);

    // Definir sonidos. Si el archivo no existe, Howl queda en silencio
    // pero NO crashea (maneja el error internamente).
    this.sounds = {
      pickup: sound('pickup.wav', { volume: .6 }),
      treasure: sound('treasure.wav', { volume: .9 }),
      sell: sound('sell.wav', { volume: .8 }),
      full: sound('full.wav', { volume: .5 }),
      empty: sound('empty.wav', { volume: .4 }),
      carAlarm: sound('Sonido De Alarma De Auto.opus', { volume: .6, loop: false, pool: 6 }),
      steps: sound('Sounds_of_a_steps.opus', { volume: .65, loop: true }),
      ambient: sound('city_atmosphere_soun.opus', { volume: .18, loop: true }),
      rain: sound('rain_sound_01.mp3', { volume: .45, loop: true })
    };
    // Reproducción normal: sin posiciones, panners ni atenuación 3D.
    const vehicleOptions = { volume: 0, loop: true, pool: 10 };
    this.vehicleSounds = {
      carIdle: sound('car_idling_at_a_traf.opus', vehicleOptions),
      carDrive: sound('small_vehicle_drivin.opus', vehicleOptions),
      busIdle: sound('car_idling_at_a_traf_bus.opus', vehicleOptions),
      busDrive: sound('bus_vehicle_drivin.opus', vehicleOptions),
      // Tomar una sola pitada de cada grabación evita reproducir secuencias de casi 8 s.
      horn1: sound('car_horn_sound1.opus', { ...vehicleOptions, loop: false, sprite: { honk: [900, 550] } }),
      horn2: sound('car_horn_sound.opus', { ...vehicleOptions, loop: false, sprite: { honk: [1000, 600] } }),
      horn3: sound('car_horn_sound_v3.opus', { ...vehicleOptions, loop: false, sprite: { honk: [200, 650] } })
    };
    const driverFiles = [
      ...[1, 3, 4, 5, 6, 7].map(n => `valentina_n${n}.mp3`),
      ...Array.from({ length: 6 }, (_, i) => `roberto_n${i + 1}.mp3`)
    ];
    this.driverSounds = driverFiles.map(file => sound(file, { volume: 0, loop: false, pool: 8 }));
    this.theftSounds = Array.from({ length: 5 }, (_, i) => sound(`roberto_robo_espejo_n${i + 1}.mp3`, { volume: 0, loop: false, pool: 6 }));
    this._theftVoices = new Map();
    this.vehicles = new VehicleAudio(this.vehicleSounds, Math.random, this.driverSounds);
    this._carAlarms = new Map();

    // El audio es opcional: un archivo ausente o bloqueado no impide jugar.
    this.ready = Promise.all([...Object.values(this.sounds), ...Object.values(this.vehicleSounds), ...this.driverSounds, ...this.theftSounds].map(sound => new Promise(resolve => {
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
    this._boostPlaying = false;
    this._ambientStarted = false;
    this._lastGroundType = 'sidewalk';
    this._lastRunning = false;
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('car-honk', (e) => {
        const pitch = 380 + Math.random() * 80;
        this.playCarHorn(pitch, 0.22 + Math.random() * 0.12);
      });
    }


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
  _applySettings() {
    this.howler.volume(this.muted ? 0 : this.volume);
    try {
      globalThis.localStorage?.setItem('bazuko.audio_volume', String(this.volume));
      globalThis.localStorage?.setItem('bazuko.audio_muted', String(this.muted));
    } catch { /* sin almacenamiento */ }
    this.eventTarget?.dispatchEvent(new CustomEvent('audio-settings-change', { detail: { volume: this.volume, muted: this.muted } }));
  }

  play(name) {
    const s = this.sounds[name];
    if (!s || s.playing()) return;
    s.play();
  }

  /** Ladrido breve sintetizado; usa el mismo volumen maestro y silencio que los vehículos. */
  barkDog() {
    const ctx = this.howler.ctx;
    if (this._paused || !ctx || ctx.state !== 'running' || !ctx.createBuffer || !this.howler.masterGain) return;
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
    source.connect(filter); filter.connect(gain); gain.connect(this.howler.masterGain);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  }

  /** Golpe seco sintetizado (varilla); usa el volumen maestro y el silencio generales. */
  playThud() {
    const ctx = this.howler.ctx;
    if (this._paused || !ctx || ctx.state !== 'running' || !ctx.createBuffer || !this.howler.masterGain) return;
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
    source.connect(filter); filter.connect(gain); gain.connect(this.howler.masterGain);
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
    if (!car.position || !listener) return .6;
    const distance = Math.hypot(car.position.x - listener.x, car.position.y - listener.y, car.position.z - listener.z);
    // Volumen completo a cinco metros; silencio desde los 41 m, sin panner espacial.
    return .6 * Math.max(0, Math.min(1, (41 - distance) / 36));
  }

  playMovingTheft(car) {
    if (!car?.traffic || this._paused) return false;
    const sound = this.theftSounds[Math.min(4, Math.floor(this.vehicles.random() * 5))];
    if (sound.state() !== 'loaded') return false;
    const previous = this._theftVoices.get(car);
    if (previous) previous.sound.stop(previous.id);
    const voice = { sound, id: sound.play() };
    sound.volume(this._theftVolume(car, this._listenerPosition), voice.id);
    this._theftVoices.set(car, voice);
    // El reclamo por el robo reemplaza la frase normal de obstrucción de ese conductor.
    const driver = this.vehicles.instances.get(car);
    if (driver) {
      if (driver.remark) { driver.remark.sound.stop(driver.remark.id); driver.remark = null; }
      driver.cooldown = Math.max(driver.cooldown, sound.duration() + .5);
    }
    return true;
  }

  _theftVolume(car, listener) {
    if (!car.position || !listener) return .75;
    const distance = Math.hypot(car.position.x - listener.x, car.position.y - listener.y, car.position.z - listener.z);
    return .75 * Math.max(0, Math.min(1, (12 - distance) / 10));
  }

  updateSteps(moving, running, groundType = 'sidewalk', isRaining = false) {
    const s = this.sounds.steps;
    if (!s) return;

    if (moving) {
      let baseRate = running ? 1.4 : 1.0;
      let vol = 0.5;

      if (groundType === 'dirt' || groundType === 'grass') {
        baseRate *= 0.88;
        vol = 0.38;
      } else if (groundType === 'road' || groundType === 'busway') {
        baseRate *= 1.05;
        vol = 0.48;
      } else if (groundType === 'sidewalk' || groundType === 'floor' || groundType === 'plaza') {
        baseRate *= 1.0;
        vol = 0.52;
      }

      if (isRaining) {
        baseRate *= 1.04;
      }

      if (this._stepsRate !== baseRate) {
        if (typeof s.rate === 'function') s.rate(baseRate);
        this._stepsRate = baseRate;
      }

      if (!this._stepsPlaying) {
        if (typeof s.volume === 'function') s.volume(vol);
        if (typeof s.play === 'function') s.play();
        this._stepsPlaying = true;
        this._lastGroundType = groundType;
        this._lastRunning = running;
      } else if (this._lastGroundType !== groundType || this._lastRunning !== running) {
        if (typeof s.volume === 'function') s.volume(vol);
        this._lastGroundType = groundType;
        this._lastRunning = running;
      }
    } else if (this._stepsPlaying) {
      if (typeof s.stop === 'function') s.stop();
      this._stepsPlaying = false;
    }
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
    }
  }

  setPaused(paused) {
    if (this._paused === paused) return;
    this._paused = paused;
    this._syncRain();
    this.vehicles.setPaused(paused);
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

  updateWorld(dt, position, _camera, vehicles, bus) {
    this._listenerPosition = position;
    this.setPaused(false);
    this.vehicles.update(dt, position, vehicles, bus);
    for (const [car, voice] of this._theftVoices) {
      if (!voice.sound.playing(voice.id)) this._theftVoices.delete(car);
      else voice.sound.volume(this._theftVolume(car, position), voice.id);
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
    this._theftVoices.clear();
    this._carAlarms.clear();
    this.eventTarget?.removeEventListener('dog-bark', this._dogBark);
    this.vehicles.clear();
    this._removeUnlock();
    globalThis.document?.removeEventListener?.('visibilitychange', this._visibilityChanged);
    for (const sound of [...Object.values(this.sounds), ...Object.values(this.vehicleSounds), ...this.driverSounds, ...this.theftSounds]) sound.unload();
  }

  /** ===== Efectos Procedurales (Web Audio) ===== */

  playFart() {
    if (this._paused || this.muted || typeof window === 'undefined') return;
    try {
      const ctx = this.howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
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

      gain.gain.setValueAtTime(0.45 * (this.howler.masterGain ? 1 : this._masterVolume), t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.howler.masterGain ?? ctx.destination);
      osc.start(t);
      osc.stop(t + 0.39);
    } catch {}
  }

  playWhoosh() {
    if (this._paused || this.muted || typeof window === 'undefined') return;
    try {
      const ctx = this.howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.linearRampToValueAtTime(420, t + 0.08);
      osc.frequency.linearRampToValueAtTime(110, t + 0.24);

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.35 * (this.howler.masterGain ? 1 : this._masterVolume), t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

      osc.connect(gain);
      gain.connect(this.howler.masterGain ?? ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    } catch {}
  }

  playSplat() {
    if (this._paused || this.muted || typeof window === 'undefined') return;
    try {
      const ctx = this.howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(290, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);

      gain.gain.setValueAtTime(0.55 * (this.howler.masterGain ? 1 : this._masterVolume), t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.connect(gain);
      gain.connect(this.howler.masterGain ?? ctx.destination);
      osc.start(t);
      osc.stop(t + 0.19);
    } catch {}
  }

  playHeartbeat(intensity = 1) {
    if (this._paused || this.muted || typeof window === 'undefined') return;
    try {
      const ctx = this.howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const makeThump = (offset, vol) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(65, t + offset);
        osc.frequency.exponentialRampToValueAtTime(28, t + offset + 0.12);
        gain.gain.setValueAtTime(vol * 0.45 * (this.howler.masterGain ? 1 : this._masterVolume), t + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.12);
        osc.connect(gain);
        gain.connect(this.howler.masterGain ?? ctx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.13);
      };
      makeThump(0, 1 * intensity);
      makeThump(0.14, 0.7 * intensity);
    } catch {}
  }

  playPsychosisWhisper() {
    if (this._paused || this.muted || typeof window === 'undefined') return;
    try {
      const ctx = this.howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
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
      gain.gain.linearRampToValueAtTime(0.22 * (this.howler.masterGain ? 1 : this._masterVolume), ctx.currentTime + 0.25);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + dur);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.howler.masterGain ?? ctx.destination);
      src.start();
      src.stop(ctx.currentTime + dur);
    } catch {}
  }

  playCarHorn(frequency = 415, duration = 0.28) {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
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
      gain.gain.linearRampToValueAtTime(0.35 * this._masterVolume, t + 0.02);
      gain.gain.setValueAtTime(0.32 * this._masterVolume, t + duration - 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + duration);
      osc2.stop(t + duration);
    } catch {}
  }

  playCartRumble() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const dur = 0.15;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(75 + Math.random() * 20, t);
      osc.frequency.linearRampToValueAtTime(85, t + dur);
      gain.gain.setValueAtTime(0.12 * this._masterVolume, t);
      gain.gain.linearRampToValueAtTime(0.01, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch {}
  }


  playJump() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(320, t + 0.16);
      gain.gain.setValueAtTime(0.28 * this._masterVolume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    } catch {}
  }

  playLanding() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(95, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.12);
      gain.gain.setValueAtTime(0.42 * this._masterVolume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    } catch {}
  }

  playPunchHit() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
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

      gain.gain.setValueAtTime(0.55 * this._masterVolume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.15);
      osc2.stop(t + 0.15);
    } catch {}
  }

}
