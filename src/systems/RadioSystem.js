// src/systems/RadioSystem.js
// Sistema de Radio Transistor AM/FM portátil con síntesis de sonido Lo-Fi bogotano.
// Las emisoras de `kind: 'stream'` sintonizan su señal oficial en vivo; las demás son síntesis.
import { bulletinsFor } from '../data/radioBulletins.js';

// Segundos de escucha continua en 890 AM entre boletines generales de la ciudad.
export const CITY_BULLETIN_INTERVAL = 90;
// Señal mínima para entender al locutor.
const NEWS_MIN_SIGNAL = 0.4;
// Señal mínima para enganchar una emisora en vivo: solo con la aguja sobre su frecuencia exacta.
const STREAM_MIN_SIGNAL = 0.9;

const emitToast = (text, type = 'info') => {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined' && window.dispatchEvent) {
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
    } catch { /* ignorar en entornos sin DOM completo */ }
  }
};

// Catálogo del dial. Las emisoras de `kind: 'stream'` son reales: su `url` es la señal oficial,
// su `freq` la de verdad y el `homepage` el crédito. `region` desambigua las frecuencias repetidas.
// La Gotera dejó el 98,5 que UN Radio Bogotá usa de verdad y se mudó al 97,4.
export const STATIONS = [
  {
    id: 'recuerdos',
    freq: 540,
    band: 'AM',
    region: 'Bogotá',
    name: 'Radio Recuerdos 540 AM',
    genre: 'Cumbia, Bolero y Música Popular',
    program: 'Los Clásicos de Cantina Bogotana',
    color: '#e67e22'
  },
  {
    id: 'noticias',
    freq: 890,
    band: 'AM',
    region: 'Bogotá',
    name: 'La Voz de la Capital 890 AM',
    genre: 'Noticias y Radionovela',
    program: 'Noticiero Popular del Mediodía',
    color: '#3498db'
  },
  {
    id: 'deportes',
    freq: 1040,
    band: 'AM',
    region: 'Bogotá',
    name: 'La Gradería 1040 AM',
    genre: 'Fútbol y Deportes',
    program: 'En vivo: el partido de la tarde',
    color: '#2ecc71'
  },
  {
    id: 'rock',
    freq: 97.4,
    band: 'FM',
    region: 'Bogotá',
    name: 'La Gotera 97,4 FM',
    genre: 'Rock y Baladas en Español',
    program: 'Rock viejo en español',
    color: '#9b59b6'
  },
  {
    id: 'unradio-bogota',
    freq: 98.5,
    band: 'FM',
    region: 'Bogotá',
    name: 'UN Radio 98,5 FM',
    kind: 'stream',
    codec: 'MP3',
    url: 'https://radio.unal.edu.co/streaming/bogota/',
    homepage: 'https://radio.unal.edu.co/'
  },
  {
    id: 'javeriana',
    freq: 91.9,
    band: 'FM',
    region: 'Bogotá',
    name: 'Javeriana Estéreo 91,9 FM',
    kind: 'stream',
    codec: 'MP3',
    url: 'https://radio06.cehis.net/proxy/javerian?mp=%2Fstream',
    homepage: 'https://www.javeriana.edu.co/'
  },
  {
    id: 'radionacional-bogota',
    freq: 95.9,
    band: 'FM',
    region: 'Bogotá',
    name: 'Radio Nacional de Colombia',
    kind: 'stream',
    codec: 'HLS',
    url: 'https://streaming.rtvc.gov.co/Radio_Radionacional/Radionacional.stream/playlist.m3u8',
    homepage: 'https://www.radionacional.co/'
  },
  {
    id: 'radionica',
    freq: 99.1,
    band: 'FM',
    region: 'Bogotá',
    name: 'Radiónica 99,1 FM',
    kind: 'stream',
    codec: 'HLS',
    url: 'https://streaming.rtvc.gov.co/Radio_Radionica/Radionica.stream/playlist.m3u8',
    homepage: 'https://www.radionacional.co/'
  },
  {
    id: 'unradio-medellin',
    freq: 100.4,
    band: 'FM',
    region: 'Medellín',
    name: 'UN Radio 100,4 FM',
    kind: 'stream',
    codec: 'MP3',
    url: 'https://radio.unal.edu.co/streaming/medellin/',
    homepage: 'https://radio.unal.edu.co/medellin-1004'
  },
  {
    id: 'univalle',
    freq: 105.3,
    band: 'FM',
    region: 'Cali',
    name: 'Univalle Estéreo 105,3 FM',
    kind: 'stream',
    codec: 'MP3',
    url: 'https://uv-stereo.univalle.edu.co:8000/envivo.mp3',
    homepage: 'https://www.univalle.edu.co/'
  },
  {
    id: 'uninorte',
    freq: 103.1,
    band: 'FM',
    region: 'Barranquilla',
    name: 'Uninorte FM 103,1',
    kind: 'stream',
    codec: 'AAC+',
    url: 'https://cactus2.uninorte.edu.co/stream.mp3',
    homepage: 'https://www.uninorte.edu.co/'
  },
  {
    id: 'uniguajira',
    freq: 89.3,
    band: 'FM',
    region: 'Riohacha',
    name: 'Uniguajira Stereo 89,3 FM',
    kind: 'stream',
    codec: 'AAC+',
    url: 'https://play8.tikast.com/proxy/uniguajirafm?mp=/stream',
    homepage: 'https://uniguajira.edu.co/'
  },
  {
    id: 'universitaria-utp',
    freq: 88.2,
    band: 'FM',
    region: 'Pereira',
    name: 'Universitaria Estéreo 88,2 FM',
    kind: 'stream',
    codec: 'AAC',
    url: 'https://www.utp.edu.co/stream/',
    homepage: 'https://universitariaestereo.utp.edu.co/'
  },
  {
    id: 'unicauca',
    freq: 104.1,
    band: 'FM',
    region: 'Popayán',
    name: 'Unicauca Stereo 104,1 FM',
    kind: 'stream',
    codec: 'MP3',
    url: 'https://emisora.unicauca.edu.co/stream',
    homepage: 'https://www.unicauca.edu.co/'
  },
  {
    id: 'reconciliacion-bojaya',
    freq: 98.5,
    band: 'FM',
    region: 'Bojayá',
    name: 'Radio Nacional, Emisora de la Reconciliación Bojayá',
    kind: 'stream',
    codec: 'HLS',
    url: 'https://streaming.rtvc.gov.co/Radio_Paz_Bojaya/Paz_Bojaya.stream/playlist.m3u8',
    homepage: 'https://www.radionacional.co/'
  },
  {
    id: 'reconciliacion-arauquita',
    freq: 88.9,
    band: 'FM',
    region: 'Arauquita',
    name: 'Radio Nacional, Emisora de la Reconciliación Arauquita',
    kind: 'stream',
    codec: 'HLS',
    url: 'https://streaming.rtvc.gov.co/Radio_Paz_Arauquita/Paz_Arauquita.stream/playlist.m3u8',
    homepage: 'https://www.radionacional.co/'
  },
  {
    id: 'reconciliacion-leguizamo',
    freq: 100.3,
    band: 'FM',
    region: 'Puerto Leguízamo',
    name: 'Radio Nacional, Emisora de la Reconciliación Puerto Leguízamo',
    kind: 'stream',
    codec: 'HLS',
    url: 'https://streaming.rtvc.gov.co/Radio_Paz_Puerto_Leguizamo/Paz_Puerto_Leguizamo.stream/playlist.m3u8',
    homepage: 'https://www.radionacional.co/'
  },
  {
    id: 'reconciliacion-san-jacinto',
    freq: 102.7,
    band: 'FM',
    region: 'San Jacinto',
    name: 'Radio Nacional, Emisora de la Reconciliación San Jacinto',
    kind: 'stream',
    codec: 'HLS',
    url: 'https://streaming.rtvc.gov.co/Radio_Paz_San_Jacinto/Paz_San_Jacinto.stream/playlist.m3u8',
    homepage: 'https://www.radionacional.co/'
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

    // Sintonía: `stationId` es la emisora elegida a mano, que desempata las frecuencias repetidas.
    // Una sola señal en vivo a la vez: `_liveId` suena, `_failedId` se quedó sin ella.
    this.stationId = null;
    this._audioEl = null;
    this._hls = null;
    this._hlsLoader = () => import('hls.js');
    this._liveId = null;
    this._failedId = null;
    this._onStreamError = null;

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

    emitToast('Radio prendido: ' + this.getStationInfo().station.name, 'info');
  }

  turnOff() {
    if (!this.isOn) return;
    this.isOn = false;
    this._stopSynthesis();
    this.stopStream();
    this._failedId = null; // apagar y volver a prender vuelve a intentar

    if (this._staticGain) {
      this._staticGain.gain.value = 0;
    }

    emitToast('Radio apagado', 'info');
  }

  toggle() {
    if (this.isOn) this.turnOff();
    else this.turnOn();
    return this.isOn;
  }

  setFrequency(freq) {
    this.stationId = null; // mover el dial suelta la emisora elegida a mano
    this._tune(freq);
  }

  /** Sintoniza una emisora concreta del catálogo. Hace falta porque hay frecuencias repetidas. */
  setStation(station) {
    this.stationId = station.id;
    this._failedId = null; // volver a pulsarla es la forma de reintentar
    this._tune(station.freq);
  }

  _tune(freq) {
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
    // `Game._loop` la llama en cada cuadro: sin este corte, el elemento recibiría un volumen nuevo por fotograma.
    paused = !!paused;
    if (this._paused === paused) return;
    this._paused = paused;
    this._applyOutput();
  }

  _applyOutput() {
    const level = this._paused || this._outputMuted ? 0 : this.volume * this._outputVolume;
    if (this._masterGain) this._masterGain.gain.value = level;

    // La señal en vivo sale por el propio elemento, no por la Web Audio API: un nodo de fuente
    // exigiría CORS y varias emisoras no lo dan.
    const el = this._audioEl;
    if (el) {
      el.volume = Math.max(0, Math.min(1, this.volume * this._outputVolume));
      el.muted = this._paused || this._outputMuted;
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    this._applyOutput();
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
      // En una frecuencia repetida manda la emisora elegida a mano; si no, la primera del catálogo.
      if (diff < minDiff || (diff === minDiff && st.id === this.stationId)) {
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
    const { station, signal } = this.getStationInfo();
    this._syncStream(station, signal);

    if (!this.isOn || !this._ctx) return;

    // Mayor ruido estático cuando no hay sintonía clara
    if (this._staticGain) {
      const staticLevel = this._failedId ? 0.12 * this.volume : (1 - signal * 0.85) * 0.12 * this.volume;
      this._staticGain.gain.setTargetAtTime(staticLevel, this._ctx.currentTime, 0.05);
    }
  }

  /** Una sola emisora en vivo a la vez: cambiar de sintonía suelta la anterior. */
  _syncStream(station, signal) {
    const id = this.isOn && station.kind === 'stream' ? station.id : null;
    if (this._failedId && this._failedId !== id) this._failedId = null; // otro dial vuelve a intentar
    if (!id || signal < STREAM_MIN_SIGNAL) { this.stopStream(); return; }
    if (this._liveId === id || this._failedId === id) return;
    this._startStream(station);
  }

  /** ¿La emisora sintonizada es una señal en vivo que no respondió? */
  isStreamDown() {
    return !!this._failedId;
  }

  /**
   * Engancha la señal oficial de una emisora real. Donde el navegador no reproduce HLS solo,
   * hls.js entra en ese momento con un import dinámico que no pesa en el arranque.
   */
  _startStream(station) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return this._noSignal(station);

    this.stopStream();
    const el = document.createElement('audio');

    this._audioEl = el;
    this._liveId = station.id;
    el.preload = 'none';
    this._onStreamError = () => this._failStream(station);
    el.addEventListener('error', this._onStreamError);
    el.addEventListener('stalled', this._onStreamError);
    el.addEventListener('ended', this._onStreamError); // un archivo que se acaba también deja la estática
    this._applyOutput();

    if (station.codec === 'HLS' && !el.canPlayType('application/vnd.apple.mpegurl')) {
      this._hlsLoader().then((mod) => {
        const Hls = mod.default;
        if (this._audioEl !== el || this._liveId !== station.id) return; // ya se cambió de emisora
        if (!Hls.isSupported()) return this._failStream(station);
        this._hls = new Hls();
        this._hls.attachMedia(el);
        this._hls.on(Hls.Events.ERROR, (_event, data) => { if (data?.fatal) this._failStream(station); });
        this._hls.loadSource(station.url);
        this._playStream(el, station);
      }).catch(() => this._failStream(station));
      return;
    }

    el.src = station.url;
    this._playStream(el, station);
  }

  _playStream(el, station) {
    // Una promesa vieja no puede tumbar la señal que ya ocupa el elemento.
    el.play()?.catch(() => { if (this._audioEl === el) this._failStream(station); });
  }

  /** Sin señal: se suelta el elemento y queda la estática que ya sintetiza la radio. */
  _failStream(station) {
    if (this._liveId !== station.id) return;
    this._noSignal(station);
  }

  _noSignal(station) {
    this._failedId = station.id;
    this.stopStream();
    this._updateTuning();
    emitToast(`${station.name}: no responde, queda la estática.`, 'warn');
  }

  /** Suelta la señal en vivo: nada sigue descargando por detrás. */
  stopStream() {
    this._liveId = null;

    const el = this._audioEl;
    if (el) {
      this._audioEl = null;
      if (this._onStreamError) {
        el.removeEventListener('error', this._onStreamError);
        el.removeEventListener('stalled', this._onStreamError);
        el.removeEventListener('ended', this._onStreamError);
      }
      el.pause();
      el.removeAttribute('src');
      el.load(); // corta la descarga que quedaba
    }
    this._onStreamError = null;

    if (this._hls) {
      const hls = this._hls;
      this._hls = null;
      hls.destroy();
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
    if (station.kind === 'stream') return; // el sonido lo pone la señal en vivo

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
      // 1040 AM: el partido
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
      // 97.4 FM: Rock en Español
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
      emitToast('El radio se quedó sin pilas.', 'warn');
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
    emitToast(`890 AM: ${bulletin.titular}. ${bulletin.objetivo}`, trigger === 'lluvia' ? 'warn' : 'info');
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
