// src/systems/SubstanceAudio.js
// Sonidos de los efectos de consumo, sintetizados con Web Audio como el latido de la psicosis.
// `out` copia el volumen general (y el silencio) por la categoría Efectos; `bus` sigue la intensidad.
// A diferencia de `_fx()`, `out` sale a los parlantes después del pasa-bajos del pegante: así el
// pitido de oídos tapados no queda ahogado por el mismo filtro que apaga la ciudad.

const ONSET_GAP = 0.25;    // s: consumir varias veces seguidas no apila el sonido
const ONSET_LENGTH = 2.5;  // s: el sonido de consumir más largo (inhalar hierba) dura 2,4 s
const MUFFLE_OPEN = 20000; // Hz: sin filtro audible
const MUFFLE_CLOSED = 700; // Hz: la ciudad «bajo el agua» con el pegante al máximo

// `onset` suena al consumir; `sustain` acompaña el efecto mientras dura.
const SOUNDS = {
  pastilla: {
    onset(s) {
      // Un trago y un brillo que sube.
      // Cada barrido parte de `s.now`: sin ese punto, la rampa se contaría desde el inicio del contexto.
      const gulp = s.osc('sine', 140);
      gulp.frequency.setValueAtTime(140, s.now);
      gulp.frequency.exponentialRampToValueAtTime(60, s.now + 0.12);
      gulp.connect(s.env(0.25, 0.01, 0.02, 0.12)).connect(s.out);
      for (const [f, cents] of [[400, 0], [600, 7]]) {
        const rise = s.osc('triangle', f);
        rise.detune.value = cents;
        rise.frequency.setValueAtTime(f, s.now);
        rise.frequency.exponentialRampToValueAtTime(f * 4, s.now + 1.4);
        rise.connect(s.env(0.06, 0.3, 0.6, 0.8)).connect(s.out);
      }
    },
    sustain(s) {
      // Acorde brillante que ondula al ritmo de la cámara.
      const lp = s.filter('lowpass', 2200, 2);
      lp.connect(s.bus);
      s.lfo(0.25, 900, lp.frequency);
      for (const f of [220, 277.18, 329.63, 440]) {
        const o = s.osc('triangle', f);
        s.lfo(0.2 + Math.random() * 0.2, 9, o.detune);
        o.connect(s.gain(0.05)).connect(lp);
      }
    }
  },
  pegante: {
    onset(s) {
      // Inhalación dentro de la bolsa.
      const bp = s.filter('bandpass', 400, 1.5);
      bp.frequency.setValueAtTime(400, s.now);
      bp.frequency.exponentialRampToValueAtTime(1500, s.now + 1.1);
      s.noise().connect(bp).connect(s.env(0.25, 0.9, 0.1, 0.3)).connect(s.out);
    },
    sustain(s) {
      // Zumbido grave que se mece (dos tonos cercanos baten) y pitido de oídos tapados.
      const lp = s.filter('lowpass', 320, 1);
      lp.connect(s.bus);
      for (const f of [55, 55.8]) {
        const o = s.osc('sawtooth', f);
        s.lfo(0.32, 30, o.detune);
        o.connect(s.gain(0.09)).connect(lp);
      }
      const ringGain = s.gain(0.012);
      s.lfo(0.5, 0.006, ringGain.gain);
      s.osc('sine', 6200).connect(ringGain).connect(s.bus);
      s.muffle();
    }
  },
  hierba: {
    onset(s) {
      // Chispazo de encendedor e inhalación larga.
      for (const at of [0, 0.18]) {
        const g = s.gain(0);
        g.gain.setValueAtTime(0.3, s.now + at);
        g.gain.exponentialRampToValueAtTime(0.0001, s.now + at + 0.04);
        s.noise().connect(s.filter('highpass', 3000)).connect(g).connect(s.out);
      }
      const bp = s.filter('bandpass', 300, 1.2);
      bp.frequency.setValueAtTime(300, s.now + 0.4);
      bp.frequency.exponentialRampToValueAtTime(900, s.now + 2.2);
      const inhale = s.gain(0);
      inhale.gain.setValueAtTime(0.0001, s.now + 0.4);
      inhale.gain.exponentialRampToValueAtTime(0.2, s.now + 1.6);
      inhale.gain.exponentialRampToValueAtTime(0.0001, s.now + 2.4);
      s.noise().connect(bp).connect(inhale).connect(s.out);
    },
    sustain(s) {
      // Fondo cálido, grave y lento.
      const lp = s.filter('lowpass', 600, 0.7);
      lp.connect(s.bus);
      const tremolo = s.gain(1);
      s.lfo(0.12, 0.35, tremolo.gain);
      tremolo.connect(lp);
      for (const [type, f, v] of [['sine', 110, 0.09], ['sine', 165, 0.06], ['triangle', 220, 0.03]]) {
        s.osc(type, f).connect(s.gain(v)).connect(tremolo);
      }
    }
  }
};

export class SubstanceAudio {
  /** @param {object} audioSystem AudioSystem del juego; su contexto puede no existir (Node, audio bloqueado) */
  constructor(audioSystem) {
    this.audioSystem = audioSystem;
    this.out = null;
    this.bus = null;
    this.muffle = null;
    this._sustainNodes = [];
    this._pendingSustain = null;
    this._lastOnset = new Map();
    this._noiseBuffer = null;
  }

  get _ctx() { return this.audioSystem?.howler?.ctx ?? null; }
  get _master() { return this.audioSystem?.howler?.masterGain ?? null; }

  _ready() {
    return !!(this._ctx && this._master && this._ctx.state === 'running');
  }

  /** Volumen general por la categoría Efectos del menú de pausa. */
  _volume() {
    return this._master.gain.value * (this.audioSystem?.getMix?.('effects') ?? 1);
  }

  /** Sonido de consumir: suena aunque el juego esté en pausa, como el de recoger objetos. */
  playOnset(id) {
    const sound = SOUNDS[id];
    if (!sound || !this._ready()) return;
    const now = this._ctx.currentTime;
    const last = this._lastOnset.get(id);
    if (last !== undefined && now - last < ONSET_GAP) return;
    this._lastOnset.set(id, now);
    sound.onset(this._kit([], now + ONSET_LENGTH));
  }

  /** Capa que acompaña el efecto; si el audio aún no arranca, empieza al reanudarse. */
  startSustain(id) {
    if (!SOUNDS[id]) return;
    this.stopSustain();
    this._pendingSustain = id;
    this._startPending();
  }

  update(intensity, { paused = false } = {}) {
    this._startPending();
    const ctx = this._ctx, master = this._master;
    if (!ctx || !master || !this.out) return;
    const now = ctx.currentTime;
    this.out.gain.setTargetAtTime(this._volume(), now, 0.05);
    this.bus?.gain.setTargetAtTime(paused ? 0 : intensity, now, 0.1);
    this.muffle?.frequency.setTargetAtTime(MUFFLE_OPEN * (MUFFLE_CLOSED / MUFFLE_OPEN) ** intensity, now, 0.1);
  }

  stopSustain() {
    this._pendingSustain = null;
    if (this.muffle) {
      this._master?.disconnect();
      this._master?.connect(this._ctx.destination);
      this.muffle = null;
    }
    for (const node of this._sustainNodes) {
      try { node.stop?.(); } catch {}
      try { node.disconnect(); } catch {}
    }
    this._sustainNodes = [];
    this.bus = null;
  }

  dispose() {
    this.stopSustain();
    this.out?.disconnect();
    this.out = null;
    this._lastOnset.clear();
  }

  _startPending() {
    const id = this._pendingSustain;
    if (!id || !this._ready()) return;
    this._pendingSustain = null;
    const nodes = [];
    const kit = this._kit(nodes);
    this.bus = kit.gain(0);
    this.bus.connect(kit.out);
    kit.bus = this.bus;
    kit.muffle = () => {
      // Corta los agudos de todo el juego: el filtro va entre el volumen general y los parlantes.
      this.muffle = kit.filter('lowpass', MUFFLE_OPEN, 0.7);
      this._master.disconnect();
      this._master.connect(this.muffle).connect(this._ctx.destination);
    };
    SOUNDS[id].sustain(kit);
    this._sustainNodes = nodes;
  }

  _output() {
    if (!this.out) {
      this.out = this._ctx.createGain();
      this.out.gain.value = this._volume();
      this.out.connect(this._ctx.destination);
    }
    return this.out;
  }

  /** Piezas para armar un sonido. Con `stopAt`, cada fuente se detiene sola (sonidos de un golpe). */
  _kit(nodes, stopAt = null) {
    const ctx = this._ctx, now = ctx.currentTime;
    const track = (node) => (nodes.push(node), node);
    const start = (src) => {
      src.start(now);
      if (stopAt !== null) src.stop(stopAt);
      return src;
    };
    const kit = {
      now,
      out: this._output(),
      gain: (v) => {
        const g = track(ctx.createGain());
        g.gain.value = v;
        return g;
      },
      osc: (type, f) => {
        const o = track(ctx.createOscillator());
        o.type = type; o.frequency.value = f;
        return start(o);
      },
      filter: (type, f, q = 1) => {
        const node = track(ctx.createBiquadFilter());
        node.type = type; node.frequency.value = f; node.Q.value = q;
        return node;
      },
      noise: () => {
        const src = track(ctx.createBufferSource());
        src.buffer = this._noise(); src.loop = true;
        return start(src);
      },
      env: (peak, attack, hold, release) => {
        const g = kit.gain(0.0001);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(peak, now + attack);
        g.gain.setValueAtTime(peak, now + attack + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, now + attack + hold + release);
        return g;
      }
    };
    kit.lfo = (hz, depth, param) => kit.osc('sine', hz).connect(kit.gain(depth)).connect(param);
    return kit;
  }

  _noise() {
    if (!this._noiseBuffer) {
      const ctx = this._ctx;
      this._noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this._noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this._noiseBuffer;
  }
}
