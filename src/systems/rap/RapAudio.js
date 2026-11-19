// src/systems/rap/RapAudio.js
// El beat del rap del vagón, sintetizado con Web Audio: bombo, caja, platillos con swing y un bajo que da la vuelta
// cada cuatro compases, más el ronroneo del bus y el pito de las puertas. Nada se descarga.
//
// Suena mientras la simulación está quieta (el viaje pausa el juego), así que no usa `_fx()`, que calla en pausa:
// tiene su propio nodo, conectado al volumen general de Howler (`masterGain`), con el nivel de Efectos encima. Así lo
// apagan el silencio y el volumen general como a todo lo demás. Los golpes se programan con el reloj del audio y
// un poco por delante, para que no dependan de los cuadros.

const PASOS = 16;                       // semicorcheas por compás
const BOMBO = [0, 7, 10];
const CAJA = [4, 12];
const SWING = 0.16;                     // cuánto se atrasa la corchea de contratiempo, en fracción de corchea
const BAJO = [110, 87.31, 130.81, 98];  // La, Fa, Do, Sol: una vuelta cada cuatro compases
const ADELANTE = 0.15;                  // s que se programan por delante
const CADA = 25;                        // ms entre una programación y la siguiente

export class RapAudio {
  /** @param {object} audioSystem AudioSystem del juego; sin contexto (Node, audio bloqueado) todo queda en silencio. */
  constructor(audioSystem) {
    this.audioSystem = audioSystem;
    this.out = null;
    this._timer = null;
    this._nodos = new Set();
    this._ruido = null;
    this._rumor = null;
  }

  get _ctx() { return this.audioSystem?.howler?.ctx ?? null; }
  get _master() { return this.audioSystem?.howler?.masterGain ?? null; }

  /** Hay audio de verdad: el contexto existe, corre y hay a dónde conectarse. */
  listo() {
    const ctx = this._ctx;
    return !!(ctx && this._master && ctx.state === 'running' && typeof ctx.createOscillator === 'function');
  }

  /** Lo que tarda en oírse lo que se programa: los golpes se juzgan contra lo que el jugador oye. */
  latencia() {
    const ctx = this._ctx;
    return ctx ? Math.max(0, Math.min(0.25, (ctx.outputLatency || 0) + (ctx.baseLatency || 0))) : 0;
  }

  ahora() { return this._ctx?.currentTime ?? 0; }

  _nivel() {
    const a = this.audioSystem;
    return a?._level?.('effects') ?? a?.getMix?.('effects') ?? 1;
  }

  _salida() {
    if (!this.out) {
      this.out = this._ctx.createGain();
      this.out.gain.value = this._nivel();
      this.out.connect(this._master);
    }
    return this.out;
  }

  /**
   * Arranca: puertas, ronroneo y, desde `inicio` (tiempo del audio), el beat de la canción.
   * `cancion` es la de `armarCancion`; `desde` es el compás por donde empieza (al volver de otra pestaña).
   */
  empezar(cancion, inicio, { desde = 0, puertas = true } = {}) {
    if (!this.listo()) return false;
    this.parar({ suave: false });
    this._sostenerContexto();
    this._cancion = cancion;
    this._inicio = inicio;
    this._siguiente = desde * PASOS;
    this._salida();
    this._arrancarRumor();
    if (puertas) this.puertas(inicio - 1.3);
    this._timer = setInterval(() => this._programar(), CADA);
    this._programar();
    return true;
  }

  /** Detiene el beat. Con `suave`, el ronroneo se apaga en medio segundo. */
  parar({ suave = true } = {}) {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    const ctx = this._ctx;
    if (this._rumor && ctx) {
      const { fuente, ganancia } = this._rumor;
      const t = ctx.currentTime;
      try {
        ganancia.gain.cancelScheduledValues(t);
        ganancia.gain.setValueAtTime(ganancia.gain.value, t);
        ganancia.gain.linearRampToValueAtTime(0, t + (suave ? 0.5 : 0.02));
        fuente.stop(t + (suave ? 0.55 : 0.05));
      } catch { /* ya estaba detenido */ }
    }
    this._rumor = null;
    this._soltarContexto();
    if (!suave) for (const n of this._nodos) { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} }
    this._nodos.clear();
  }

  /**
   * Howler suspende el audio a los 30 s sin sonidos de Howler, y el viaje pausa todos: un rap dura más que eso.
   * Mientras suena el beat no lo deja suspender, y al terminar lo deja como estaba.
   */
  _sostenerContexto() {
    const howler = this.audioSystem?.howler;
    if (!howler || this._autoSuspendPrevio !== undefined) return;
    this._autoSuspendPrevio = howler.autoSuspend;
    howler.autoSuspend = false;
    if (howler._suspendTimer) { clearTimeout(howler._suspendTimer); howler._suspendTimer = null; }
  }

  _soltarContexto() {
    const howler = this.audioSystem?.howler;
    if (!howler || this._autoSuspendPrevio === undefined) return;
    howler.autoSuspend = this._autoSuspendPrevio;
    this._autoSuspendPrevio = undefined;
    if (howler.autoSuspend) howler._autoSuspend?.();
  }

  dispose() {
    this.parar({ suave: false });
    try { this.out?.disconnect(); } catch {}
    this.out = null;
  }

  // ---------- sonidos sueltos ----------

  /** El pito de las puertas: tres pitos cortos. */
  puertas(t = this.ahora()) {
    if (!this.listo()) return;
    for (let i = 0; i < 3; i++) this._tono(t + i * 0.2, 'square', 1046.5, 0.11, 0.05, 1800);
  }

  /** Un pedazo que no pegó: un golpe sordo, como un micrófono que se cae. */
  fallo() {
    if (!this.listo()) return;
    const t = this.ahora();
    this._tono(t, 'sine', 70, 0.18, 0.35);
    this._golpeDeRuido(t, 'lowpass', 600, 0.12, 0.2);
  }

  /** La corneta cuando el vagón grita por una racha: corto, corto y largo, con dos voces un poco desafinadas. */
  grito(t = this.ahora()) {
    if (!this.listo()) return;
    [[0, 0.1], [0.16, 0.1], [0.32, 0.38]].forEach(([d, largo]) => {
      for (const f of [466, 471]) this._tono(t + d, 'sawtooth', f, 0.07, largo, 2400);
    });
  }

  /** El rayón del disco al empezar las estrofas. */
  rayon(t = this.ahora()) {
    if (!this.listo()) return;
    const ctx = this._ctx;
    const filtro = this._track(ctx.createBiquadFilter());
    filtro.type = 'bandpass'; filtro.Q.value = 6;
    filtro.frequency.setValueAtTime(500, t);
    filtro.frequency.exponentialRampToValueAtTime(2600, t + 0.09);
    filtro.frequency.exponentialRampToValueAtTime(400, t + 0.22);
    const g = this._envolvente(t, 0.35, 0.01, 0.2);
    this._fuenteRuido(t, 0.25).connect(filtro).connect(g).connect(this._salida());
  }

  // ---------- el beat ----------

  _programar() {
    const ctx = this._ctx, cancion = this._cancion;
    if (!ctx || !cancion) return;
    this.out?.gain.setTargetAtTime(this._nivel(), ctx.currentTime, 0.05);
    const paso = cancion.compas / PASOS;
    const total = cancion.compases.length * PASOS;
    const limite = ctx.currentTime + ADELANTE;
    while (this._siguiente < total) {
      const t = this._inicio + this._siguiente * paso;
      if (t > limite) return;
      if (t >= ctx.currentTime - 0.01) this._tocarPaso(this._siguiente, t, paso);
      this._siguiente++;
    }
    // La canción terminó: un platillo largo al final y se apaga el beat.
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      const fin = this._inicio + total * paso;
      this._golpeDeRuido(fin, 'highpass', 5000, 0.18, 1.4);
      this._bombo(fin, 0.8);
    }
  }

  _tocarPaso(i, t, paso) {
    const compas = Math.floor(i / PASOS), s = i % PASOS;
    const tipo = this._cancion.compases[compas]?.tipo;
    const intro = tipo === 'intro';
    if (s === 0 && tipo === 'verso' && this._cancion.compases[compas - 1]?.tipo === 'intro') this.rayon(t - 0.24);
    if (BOMBO.includes(s)) this._bombo(t, intro ? 0.55 : 0.9);
    if (CAJA.includes(s)) this._caja(t, intro ? 0.35 : 0.55);
    if (s % 2 === 0) {
      const contra = s % 4 === 2;
      const tt = t + (contra ? SWING * paso * 2 : 0);
      this._golpeDeRuido(tt, 'highpass', 7000, contra ? 0.06 : 0.1, s === 14 && compas % 2 === 1 ? 0.22 : 0.045);
    }
    if (!intro && (s === 0 || s === 10)) {
      const nota = BAJO[compas % BAJO.length];
      this._bajo(t, nota, s === 0 ? paso * 6 : paso * 4);
    }
  }

  _bombo(t, fuerza) {
    const ctx = this._ctx;
    const o = this._track(ctx.createOscillator());
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(this._envolvente(t, fuerza, 0.003, 0.32)).connect(this._salida());
    o.start(t); o.stop(t + 0.4);
  }

  _caja(t, fuerza) {
    const ctx = this._ctx;
    this._golpeDeRuido(t, 'bandpass', 1900, fuerza, 0.2, 0.8);
    const o = this._track(ctx.createOscillator());
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(this._envolvente(t, fuerza * 0.6, 0.002, 0.1)).connect(this._salida());
    o.start(t); o.stop(t + 0.15);
  }

  _bajo(t, frecuencia, largo) {
    const ctx = this._ctx;
    const o = this._track(ctx.createOscillator());
    o.type = 'triangle';
    o.frequency.value = frecuencia;
    const filtro = this._track(ctx.createBiquadFilter());
    filtro.type = 'lowpass'; filtro.frequency.value = 520; filtro.Q.value = 0.7;
    const g = this._track(ctx.createGain());
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
    g.gain.setValueAtTime(0.32, t + largo * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + largo);
    o.connect(filtro).connect(g).connect(this._salida());
    o.start(t); o.stop(t + largo + 0.05);
  }

  // ---------- piezas ----------

  _track(nodo) {
    this._nodos.add(nodo);
    nodo.onended = () => this._nodos.delete(nodo);
    return nodo;
  }

  _envolvente(t, pico, ataque, caida) {
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, pico), t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ataque + caida);
    return g;
  }

  _tono(t, tipo, frecuencia, pico, largo, pasaBajos = null) {
    const ctx = this._ctx;
    const o = this._track(ctx.createOscillator());
    o.type = tipo; o.frequency.value = frecuencia;
    let salida = o;
    if (pasaBajos) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = pasaBajos;
      salida = o.connect(f);
    }
    salida.connect(this._envolvente(t, pico, 0.005, largo)).connect(this._salida());
    o.start(t); o.stop(t + largo + 0.05);
  }

  _ruidoBuffer() {
    const ctx = this._ctx;
    if (!this._ruido || this._ruido.sampleRate !== ctx.sampleRate) {
      const n = Math.ceil(ctx.sampleRate * 2.5);
      this._ruido = ctx.createBuffer(1, n, ctx.sampleRate);
      const datos = this._ruido.getChannelData(0);
      let semilla = 12345;
      for (let i = 0; i < n; i++) { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; datos[i] = semilla / 0x3fffffff - 1; }
    }
    return this._ruido;
  }

  _fuenteRuido(t, largo, bucle = false) {
    const fuente = this._track(this._ctx.createBufferSource());
    fuente.buffer = this._ruidoBuffer();
    fuente.loop = bucle;
    fuente.start(t, Math.random() * 0.8);
    if (!bucle) fuente.stop(t + largo + 0.05);
    return fuente;
  }

  _golpeDeRuido(t, tipo, frecuencia, pico, largo, q = 0.7) {
    const filtro = this._ctx.createBiquadFilter();
    filtro.type = tipo; filtro.frequency.value = frecuencia; filtro.Q.value = q;
    this._fuenteRuido(t, largo).connect(filtro).connect(this._envolvente(t, pico, 0.002, largo)).connect(this._salida());
  }

  /** El bus andando: ruido grave y constante, sin vaivén. */
  _arrancarRumor() {
    const ctx = this._ctx, t = ctx.currentTime;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass'; filtro.frequency.value = 140; filtro.Q.value = 0.5;
    const ganancia = ctx.createGain();
    ganancia.gain.setValueAtTime(0, t);
    ganancia.gain.linearRampToValueAtTime(0.22, t + 1.2);
    const fuente = ctx.createBufferSource();
    fuente.buffer = this._ruidoBuffer();
    fuente.loop = true;
    fuente.connect(filtro).connect(ganancia).connect(this._salida());
    fuente.start(t);
    this._rumor = { fuente, ganancia };
  }
}
