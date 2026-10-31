// src/systems/RadioSystem.js
// Sistema de Radio Transistor AM/FM portátil con síntesis de sonido Lo-Fi bogotano
import { bulletinsFor } from '../data/radioBulletins.js';

// Segundos de escucha continua en 890 AM entre boletines generales de la ciudad.
export const CITY_BULLETIN_INTERVAL = 90;
// Señal mínima para entender al locutor.
const NEWS_MIN_SIGNAL = 0.4;

const emitToast = (text, type = 'info') => {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined' && window.dispatchEvent) {
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
    } catch { /* ignorar en entornos sin DOM completo */ }
  }
};

export const STATIONS = [
  {
    id: 'recuerdos',
    freq: 540,
    band: 'AM',
    name: 'Radio Recuerdos 540 AM',
    genre: 'Cumbia, Bolero y Música Popular',
    program: 'Los Clásicos de Cantina Bogotana',
    color: '#e67e22'
  },
  {
    id: 'noticias',
    freq: 890,
    band: 'AM',
    name: 'La Voz de la Capital 890 AM',
    genre: 'Noticias y Radionovela',
    program: 'Noticiero Popular del Mediodía',
    color: '#3498db'
  },
  {
    id: 'deportes',
    freq: 1040,
    band: 'AM',
    name: 'El Campín 1040 AM',
    genre: 'Fútbol y Deportes',
    program: 'Transmisión En Vivo: Santa Fe vs Millonarios',
    color: '#2ecc71'
  },
  {
    id: 'rock',
    freq: 98.5,
    band: 'FM',
    name: 'Radioactiva 98.5 FM',
    genre: 'Rock y Baladas en Español',
    program: 'Clásicos del Rock en tu Idioma',
    color: '#9b59b6'
  }
];

export class RadioSystem {
  constructor(audioContext = null) {
    this._outputVolume = 1;
    this._outputMuted = false;
    this._paused = false;
    this.isOn = false;
    this.frequency = 540;
    this.volume = 0.7;
    this.battery = 100; // Porcentaje de batería
    this.hasRadio = true; // El jugador posee la radio

    this._ctx = audioContext;
    this._staticNode = null;
    this._staticGain = null;
    this._masterGain = null;
    this._bandpassFilter = null;
    this._synthTimer = null;
    this._step = 0;
    this._lastMentalTick = 0;

    // Boletines de 890 AM: como máximo uno por cada cambio de clima.
    this.lastBulletin = null;
    this.bulletinLog = [];
    this._pendingWeather = null;
    this._bulletinIndex = { lluvia: 0, despeje: 0, ciudad: 0 };
    this._cityTimer = 0;

    // Cargar preferencias guardadas
    try {
      if (typeof localStorage !== 'undefined') {
        const savedFreq = localStorage.getItem('bazuko.radio_freq');
        if (savedFreq) this.frequency = parseFloat(savedFreq);
        const savedVol = localStorage.getItem('bazuko.radio_vol');
        if (savedVol) this.volume = parseFloat(savedVol);
      }
    } catch { /* sin almacenamiento */ }
  }

  _initAudio() {
    if (this._ctx) return true;
    if (typeof window === 'undefined') return false;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this._ctx = new AudioCtx();
    } catch {
      return false;
    }

    const ctx = this._ctx;

    // Filtro Transistor Lo-Fi (corta subgraves y agudos estridentes de altavoz pequeño)
    this._bandpassFilter = ctx.createBiquadFilter();
    this._bandpassFilter.type = 'bandpass';
    this._bandpassFilter.frequency.value = 1450;
    this._bandpassFilter.Q.value = 1.1;

    // Ganancia maestra de la radio
    this._masterGain = ctx.createGain();
    this._applyOutput();

    this._bandpassFilter.connect(this._masterGain);
    this._masterGain.connect(ctx.destination);

    // Generador de ruido estático AM (Loop de 1 segundo de ruido blanco filtrado)
    try {
      const bufferSize = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.35;
      }

      this._staticSource = ctx.createBufferSource();
      this._staticSource.buffer = buffer;
      this._staticSource.loop = true;

      this._staticGain = ctx.createGain();
      this._staticGain.gain.value = 0.05;

      this._staticSource.connect(this._staticGain);
      this._staticGain.connect(this._bandpassFilter);
      this._staticSource.start(0);
    } catch { /* audio buffer no disponible */ }

    return true;
  }

  turnOn() {
    if (this.isOn) return;
    this.isOn = true;
    this._initAudio();

    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume();
    }

    this._startSynthesis();
    this._updateTuning();

    emitToast('📻 Radio encendida: ' + this.getStationInfo().station.name, 'info');
  }

  turnOff() {
    if (!this.isOn) return;
    this.isOn = false;
    this._stopSynthesis();

    if (this._staticGain) {
      this._staticGain.gain.value = 0;
    }

    emitToast('📻 Radio apagada', 'info');
  }

  toggle() {
    if (this.isOn) this.turnOff();
    else this.turnOn();
    return this.isOn;
  }

  setFrequency(freq) {
    this.frequency = Math.round(freq * 10) / 10;
    try {
      localStorage?.setItem('bazuko.radio_freq', String(this.frequency));
    } catch { /* sin almacenamiento */ }
    this._updateTuning();
  }

  setMasterVolume(volume, muted = false) {
    this._outputVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    this._outputMuted = muted;
    this._applyOutput();
  }

  setPaused(paused) {
    this._paused = paused;
    this._applyOutput();
  }

  _applyOutput() {
    if (this._masterGain) this._masterGain.gain.value = this._paused || this._outputMuted ? 0 : this.volume * this._outputVolume;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this._masterGain) {
      this._applyOutput();
    }
    try {
      localStorage?.setItem('bazuko.radio_vol', String(this.volume));
    } catch { /* sin almacenamiento */ }
  }

  /**
   * Obtiene la estación más cercana a la frecuencia actual y el nivel de señal
   */
  getStationInfo() {
    let nearest = STATIONS[0];
    let minDiff = Infinity;

    for (const st of STATIONS) {
      const diff = Math.abs(st.freq - this.frequency);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = st;
      }
    }

    // Tolerancia para sintonía perfecta
    const tolerance = nearest.band === 'FM' ? 0.8 : 25;
    const signal = Math.max(0, 1 - minDiff / tolerance);

    return {
      station: nearest,
      signal, // 0 = solo estática, 1 = sintonía perfecta
      diff: minDiff
    };
  }

  _updateTuning() {
    if (!this.isOn || !this._ctx) return;
    const { signal } = this.getStationInfo();

    // Mayor ruido estático cuando no hay sintonía clara
    if (this._staticGain) {
      const staticLevel = (1 - signal * 0.85) * 0.12 * this.volume;
      this._staticGain.gain.setTargetAtTime(staticLevel, this._ctx.currentTime, 0.05);
    }
  }

  _startSynthesis() {
    this._stopSynthesis();
    if (!this._ctx) return;

    // Bucle rítmico que genera melodías retro según la emisora cada 180ms
    this._step = 0;
    this._synthTimer = setInterval(() => {
      if (!this.isOn || !this._ctx) return;
      this._playStep();
    }, 180);
  }

  _stopSynthesis() {
    if (this._synthTimer) {
      clearInterval(this._synthTimer);
      this._synthTimer = null;
    }
  }

  _playStep() {
    if (!this._ctx || this._ctx.state !== 'running') return;
    const { station, signal } = this.getStationInfo();
    if (signal < 0.15) return; // Muy poca señal para escuchar música clara

    const ctx = this._ctx;
    const t = ctx.currentTime;
    const step = this._step++;
    const vol = signal * this.volume * 0.18;

    if (station.id === 'recuerdos') {
      // 540 AM: Cumbia / Bolero Lo-Fi
      // Bajo trotón de cumbia
      if (step % 2 === 0) {
        const bassFreqs = [110, 130.8, 146.8, 164.8]; // A2, C3, D3, E3
        const f = bassFreqs[(Math.floor(step / 4)) % bassFreqs.length];
        this._note(f, 0.22, vol * 1.2, 'triangle', t);
      }
      // Acorde melódico de acordeón / órgano vintage
      if (step % 4 === 1 || step % 4 === 3) {
        const chords = [
          [220, 261.6, 329.6], // Am
          [293.7, 349.2, 440],   // Dm
          [329.6, 392, 493.9],   // E7
          [220, 261.6, 329.6]    // Am
        ];
        const chord = chords[Math.floor(step / 8) % chords.length];
        for (const freq of chord) {
          this._note(freq, 0.14, vol * 0.6, 'sine', t);
        }
      }
    } else if (station.id === 'noticias') {
      // 890 AM: Campana de inicio de boletín y cadencia de locutor
      if (step % 32 === 0) {
        // Campana de emisora
        this._note(523.25, 0.6, vol * 1.5, 'sine', t); // C5
        this._note(659.25, 0.6, vol * 1.2, 'sine', t + 0.15); // E5
        this._note(783.99, 0.9, vol * 1.5, 'sine', t + 0.3);  // G5
      } else if (step % 32 < 20 && step % 2 === 0) {
        // Cadencia de voz hablada modulada
        const talkFreq = 160 + (step % 7) * 25 + Math.sin(step) * 15;
        this._note(talkFreq, 0.08, vol * 0.85, 'triangle', t);
      }
    } else if (station.id === 'deportes') {
      // 1040 AM: Transmisión El Campín
      // Toque de corneta / trompeta de estadio cada 16 pasos
      if (step % 16 === 0) {
        this._note(440, 0.15, vol * 1.3, 'sawtooth', t);
        this._note(554.37, 0.15, vol * 1.3, 'sawtooth', t + 0.15);
        this._note(659.25, 0.35, vol * 1.6, 'sawtooth', t + 0.3);
      } else if (step % 3 === 0) {
        // Locutor eufórico con pitazo de árbitro ocasional
        const excitedFreq = 220 + (step % 5) * 35;
        this._note(excitedFreq, 0.09, vol * 0.9, 'sawtooth', t);
      }
    } else if (station.id === 'rock') {
      // 98.5 FM: Rock en Español
      // Línea de bajo con overdrive
      const riff = [146.8, 146.8, 174.6, 196.0, 164.8, 146.8];
      const noteFreq = riff[step % riff.length];
      this._note(noteFreq, 0.15, vol * 1.1, 'sawtooth', t);
      if (step % 4 === 2) {
        this._note( noteFreq * 2, 0.1, vol * 0.7, 'triangle', t);
      }
    }
  }

  _note(freq, duration, gainValue, type = 'sine', startTime = 0) {
    if (!this._ctx || !this._bandpassFilter) return;
    try {
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(gainValue, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(this._bandpassFilter);

      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch { /* contexto cerrado o limitado */ }
  }

  /**
   * Actualiza el efecto de la radio sobre la salud mental y la batería
   */
  update(dt, stats = null, dog = null) {
    if (!this.isOn) return;

    // Consumo suave de batería: 100% dura ~40 minutos de juego continuo
    this.battery = Math.max(0, this.battery - (dt / 24));
    if (this.battery <= 0) {
      this.turnOff();
      emitToast('📻 La radio se quedó sin pilas.', 'warn');
      return;
    }

    this._updateBulletins(dt);

    const { signal } = this.getStationInfo();

    // Efecto de bienestar: escuchar radio sube la salud mental (+0.8 por segundo)
    if (stats) {
      if (signal > 0.4) {
        stats.saludMental = Math.min(100, stats.saludMental + dt * 0.8 * signal);
      }
    }

    // Efecto en El Chato: la música lo relaja y mueve la cola
    if (dog && signal > 0.4) {
      dog.time += dt * 0.5;
    }
  }

  /**
   * Recibe el evento 'weather-change' de WeatherSystem. El boletín queda pendiente
   * hasta que el jugador escuche 890 AM; un nuevo cambio reemplaza al anterior.
   */
  onWeatherChange({ isRaining } = {}) {
    this._pendingWeather = isRaining ? 'lluvia' : 'despeje';
    this._tryAirWeatherBulletin();
  }

  isListeningNews() {
    if (!this.isOn || this.battery <= 0) return false;
    const { station, signal } = this.getStationInfo();
    return station.id === 'noticias' && signal >= NEWS_MIN_SIGNAL;
  }

  _updateBulletins(dt) {
    if (!this.isListeningNews()) {
      this._cityTimer = 0;
      return;
    }
    this._tryAirWeatherBulletin();
    this._cityTimer += dt;
    if (this._cityTimer >= CITY_BULLETIN_INTERVAL) {
      this._cityTimer = 0;
      this._airNext('ciudad');
    }
  }

  _tryAirWeatherBulletin() {
    if (!this._pendingWeather || !this.isListeningNews()) return;
    const trigger = this._pendingWeather;
    this._pendingWeather = null;
    this._airNext(trigger);
  }

  _airNext(trigger) {
    const list = bulletinsFor(trigger);
    if (!list.length) return null;
    const bulletin = list[this._bulletinIndex[trigger]++ % list.length];
    this.lastBulletin = bulletin;
    this.bulletinLog = [bulletin, ...this.bulletinLog].slice(0, 5);
    emitToast(`📻 890 AM · ${bulletin.titular}. ${bulletin.objetivo}`, trigger === 'lluvia' ? 'warn' : 'info');
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined' && window.dispatchEvent) {
      try {
        window.dispatchEvent(new CustomEvent('radio-bulletin', { detail: bulletin }));
      } catch { /* ignorar en entornos sin DOM completo */ }
    }
    return bulletin;
  }

  destroy() {
    this.turnOff();
    try {
      this._ctx?.close?.();
    } catch { /* ignorar */ }
  }
}
