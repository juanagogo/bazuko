// src/systems/AudioSystem.js
import { Howl, Howler } from 'howler';

export class AudioSystem {
  constructor() {
    let savedVolume = 0.7;
    let savedMuted = false;
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem('bazuko.audio_volume') : null;
      if (v !== null) savedVolume = Math.max(0, Math.min(1, parseFloat(v)));
      savedMuted = typeof localStorage !== 'undefined' && localStorage.getItem('bazuko.audio_muted') === 'true';
    } catch { /* sin almacenamiento */ }

    this._masterVolume = savedVolume;
    this.muted = savedMuted;

    // Volumen maestro inicial (0.0 a 1.0)
    Howler.volume(this.muted ? 0 : this._masterVolume);

    // Definir sonidos. Si el archivo no existe, Howl queda en silencio
    // pero NO crashea (maneja el error internamente).
    this.sounds = {
      pickup:   new Howl({ src: ['/audio/pickup.wav'],   volume: 0.6 }),
      treasure: new Howl({ src: ['/audio/treasure.wav'], volume: 0.9 }),
      sell:     new Howl({ src: ['/audio/sell.wav'],     volume: 0.8 }),
      full:     new Howl({ src: ['/audio/full.wav'],     volume: 0.5 }),
      empty:    new Howl({ src: ['/audio/empty.wav'],    volume: 0.4 }),
      steps:    new Howl({ src: ['/audio/steps.wav'],    volume: 0.5, loop: true }),
      boost:    new Howl({ src: ['/audio/boost.wav'],    volume: 0.6, loop: true }),
      ambient:  new Howl({ src: ['/audio/ambient.wav'],  volume: 0.25, loop: true })
    };

    // El audio es opcional: un archivo ausente o bloqueado no impide jugar.
    this.ready = Promise.all(Object.values(this.sounds).map(sound => new Promise(resolve => {
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
      if (Howler.ctx && Howler.ctx.state === 'suspended') {
        Howler.ctx.resume();
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('click', unlock);
      window.addEventListener('keydown', unlock);
    }
  }

  get volume() {
    return this._masterVolume;
  }

  setVolume(vol) {
    const clamped = Math.max(0, Math.min(1, Number(vol) || 0));
    this._masterVolume = clamped;
    if (!this.muted) {
      Howler.volume(clamped);
    }
    try {
      localStorage?.setItem('bazuko.audio_volume', String(clamped));
    } catch { /* sin almacenamiento */ }
    this._emitChange();
    return this._masterVolume;
  }

  setMuted(muted) {
    this.muted = !!muted;
    Howler.volume(this.muted ? 0 : this._masterVolume);
    try {
      localStorage?.setItem('bazuko.audio_muted', String(this.muted));
    } catch { /* sin almacenamiento */ }
    this._emitChange();
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  isMuted() {
    return this.muted;
  }

  _emitChange() {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('audio-settings-change', {
        detail: { volume: this._masterVolume, muted: this.muted }
      }));
    }
  }

  play(name) {
    const s = this.sounds[name];
    if (!s || s.playing()) return;
    s.play();
  }

  stop(name) {
    this.sounds[name]?.stop();
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

      if (!this._stepsPlaying) {
        if (typeof s.rate === 'function') s.rate(baseRate);
        if (typeof s.volume === 'function') s.volume(vol);
        if (typeof s.play === 'function') s.play();
        this._stepsPlaying = true;
        this._lastGroundType = groundType;
        this._lastRunning = running;
      } else if (this._lastGroundType !== groundType || this._lastRunning !== running) {
        if (typeof s.rate === 'function') s.rate(baseRate);
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
    this.sounds.ambient?.play();
    this._ambientStarted = true;
  }

  /** ===== Efectos Procedurales (Web Audio) ===== */

  playFart() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
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

      gain.gain.setValueAtTime(0.45 * this._masterVolume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.39);
    } catch {}
  }

  playWhoosh() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.linearRampToValueAtTime(420, t + 0.08);
      osc.frequency.linearRampToValueAtTime(110, t + 0.24);

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.35 * this._masterVolume, t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    } catch {}
  }

  playSplat() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(290, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);

      gain.gain.setValueAtTime(0.55 * this._masterVolume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.19);
    } catch {}
  }

  playHeartbeat(intensity = 1) {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const makeThump = (offset, vol) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(65, t + offset);
        osc.frequency.exponentialRampToValueAtTime(28, t + offset + 0.12);
        gain.gain.setValueAtTime(vol * 0.45 * this._masterVolume, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.13);
      };
      makeThump(0, 1 * intensity);
      makeThump(0.14, 0.7 * intensity);
    } catch {}
  }

  playPsychosisWhisper() {
    if (this.muted || typeof window === 'undefined') return;
    try {
      const ctx = Howler.ctx;
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
      gain.gain.linearRampToValueAtTime(0.22 * this._masterVolume, ctx.currentTime + 0.25);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + dur);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
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
