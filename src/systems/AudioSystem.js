// src/systems/AudioSystem.js
import { Howl, Howler } from 'howler';

export class AudioSystem {
  constructor() {
    // Volumen maestro (0.0 a 1.0)
    Howler.volume(0.7);

    // Definir sonidos. Si el archivo no existe, Howl queda en silencio
    // pero NO crashea (maneja el error internamente).
    this.sounds = {
      pickup:   new Howl({ src: ['/audio/pickup.wav'],   volume: 0.6 }),
      treasure: new Howl({ src: ['/audio/treasure.wav'], volume: 0.9 }),
      sell:     new Howl({ src: ['/audio/sell.wav'],     volume: 0.8 }),
      full:     new Howl({ src: ['/audio/full.wav'],     volume: 0.5 }),
      empty:    new Howl({ src: ['/audio/empty.wav'],    volume: 0.4 }),
      boost:    new Howl({ src: ['/audio/boost.wav'],    volume: 0.6, loop: true }),
      ambient:  new Howl({ src: ['/audio/ambient.wav'],  volume: 0.25, loop: true })
    };

    this._boostPlaying = false;
    this._ambientStarted = false;

    // Desbloquear audio tras primer click (política de navegadores)
    const unlock = () => {
      if (Howler.ctx && Howler.ctx.state === 'suspended') {
        Howler.ctx.resume();
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
  }

  play(name) {
    const s = this.sounds[name];
    if (!s || s.playing()) return;
    s.play();
  }

  stop(name) {
    this.sounds[name]?.stop();
  }

  /**
   * Un paso, sintetizado con WebAudio (golpe grave + roce de ruido filtrado).
   * Se llama en cada contacto de pie detectado por la animacion (Player.onFootstep), asi que el
   * ritmo, las pausas y la cojera de la marcha se reflejan solos. Variacion leve de tono/volumen.
   * Caminar agotado = suave; correr = algo mas fuerte y seco. Sin audio desbloqueado = silencio.
   * @param {boolean} running
   * @param {number} foot 1 = izquierdo, 2 = derecho (el derecho es el lesionado: algo mas arrastrado)
   */
  playStep(running, foot = 1) {
    const ctx = Howler.ctx;
    const out = Howler.masterGain;
    if (!ctx || !out || ctx.state !== 'running') return; // espera el desbloqueo por gesto del usuario

    if (!this._stepNoise) {
      // Buffer de ruido corto compartido por todos los pasos
      const len = Math.floor(ctx.sampleRate * 0.25);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._stepNoise = buf;
    }

    const now = ctx.currentTime;
    const vary = 1 + (Math.random() - 0.5) * 0.2; // +-10 % tono
    const gainVar = 0.85 + Math.random() * 0.3;    // +-15 % volumen
    const injured = foot === 2;
    const level = (running ? 0.34 : 0.15) * gainVar * (injured && !running ? 0.9 : 1);
    const dur = running ? 0.11 : (injured ? 0.2 : 0.16); // el pie lesionado se arrastra un poco mas

    // Roce / impacto: ruido pasa-bajos con caida rapida
    const noise = ctx.createBufferSource();
    noise.buffer = this._stepNoise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = (running ? 1100 : 650) * vary;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(level, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(lp); lp.connect(g); g.connect(out);
    noise.start(now, Math.random() * 0.08, dur + 0.02);

    // Golpe grave (talon)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime((running ? 120 : 90) * vary, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(level * 0.9, now + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(og); og.connect(out);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /**
   * Pitido sintetizado (WebAudio, sin archivos): monedas, errores, avisos de minijuegos.
   * @param {number} freq Hz  @param {number} dur s  @param {string} type onda  @param {number} vol 0..1
   * @param {number} slideTo Hz final (0 = sin glissando)  @param {number} delay s de retardo
   */
  blip(freq, dur = 0.1, type = 'square', vol = 0.15, slideTo = 0, delay = 0) {
    const ctx = Howler.ctx;
    const out = Howler.masterGain;
    if (!ctx || !out || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Alarma de auto (el conductor te vio): sirena de 2 tonos sintetizada */
  playAlarm() {
    for (let i = 0; i < 6; i++) this.blip(i % 2 ? 740 : 988, 0.14, 'square', 0.18, 0, i * 0.15);
  }

  /** Golpe seco (atropello): ruido pasa-bajos + golpe grave sintetizado (WebAudio, sin archivos) */
  playHit() {
    const ctx = Howler.ctx;
    const out = Howler.masterGain;
    if (!ctx || !out || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    src.connect(lp); lp.connect(g); g.connect(out); src.start(now);
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now); osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, now); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(og); og.connect(out); osc.start(now); osc.stop(now + 0.32);
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
}