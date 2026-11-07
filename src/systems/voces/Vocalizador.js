// src/systems/voces/Vocalizador.js
// Toca los gestos de gestosVocales.js con Web Audio, desde donde está quien los hace: una fuente glotal (con un poco
// de vibrato y aire) pasa por tres formantes en paralelo, una envolvente corta, un pasa-bajos que apaga lo agudo con
// la distancia, un paneo leve y el volumen por distancia. Todo sale por un canal de voces propio que se conecta a
// Howler.masterGain (nunca a ctx.destination): respeta el volumen general, el silencio, la pausa y el de «Voces».
// Solo suena donde no hay una grabación que sirva; es discreto, de a pocos y nunca más de lo que dice LIMITE.
import { distanceGain } from '../VehicleAudio.js';
import { voicePan } from '../voiceVariety.js';
import { GESTO_POR_CATEGORIA } from '../../data/vocesReuso.js';
import { GESTOS_AMBIENTE, azarDe, hashTexto, perfilVocal, planVocalizacion } from './gestosVocales.js';

/** Interruptor general: `?sinVocalizador` en la dirección lo apaga para comparar. */
export const VOCALIZADOR = {
  activo: !/[?&]sinVocalizador\b/.test(globalThis.location?.search ?? ''),
};

// A la vez: dos reacciones y un sonido de ambiente. Cada persona espera 1,2 s entre gesto y gesto.
export const LIMITE = Object.freeze({ reactivos: 2, ambiente: 1, porPersonaMs: 1200 });
const NIVEL = .55;             // unos 4 dB por debajo de una frase grabada (que sale a .8); cada gesto lo baja más
const AIRE = .6;               // el soplo, por debajo de la voz: más se oye a siseo
const SOBRE_VOZ = .6;          // una reacción encima de una frase grabada suena a este nivel
const PLENO_HASTA = 3;         // metros a volumen completo
const ALCANCE = 14;            // como las frases de la gente
const AGUDOS_CERCA = 4500, AGUDOS_LEJOS = 1500;
const ANCHO_FORMANTE = [80, 100, 120]; // Hz: Q = F / ancho
const PESO_FORMANTE = [1, .5, .25];

let semillas = 0;
const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

/** La semilla de la voz de esa persona: la que traiga, o una nueva que se queda con ella. */
function semillaDe(owner) {
  if (Number.isFinite(owner?.vozSemilla)) return owner.vozSemilla;
  const id = owner?.person?.id ?? owner?.id ?? owner?.name;
  const seed = typeof id === 'string' || typeof id === 'number' ? hashTexto(String(id)) : hashTexto(`voz-${++semillas}`);
  if (owner && typeof owner === 'object') owner.vozSemilla = seed;
  return seed;
}

/** Perfil de quien vocaliza: su voz del reparto, su sexo y su edad; lo de `opts` manda (un carro no tiene cuerpo). */
export function perfilDe(owner, opts = {}) {
  const real = owner?.look?.real ?? owner?.person?.real;
  return perfilVocal({
    seed: semillaDe(owner),
    voz: opts.voz ?? owner?._voz ?? null,
    sexo: opts.sexo ?? real?.sexo ?? owner?.person?.sexo ?? 'hombre',
    edad: opts.edad ?? real?.edad ?? 'adulto',
  });
}

/** La onda de la glotis: armónicos que caen algo más rápido que un diente de sierra, menos zumbona. */
function ondaGlotal(ctx) {
  if (typeof ctx.createPeriodicWave !== 'function') return null;
  const n = 48, real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = 1 / Math.pow(k, 1.25) * (k % 2 ? 1 : .85);
  return ctx.createPeriodicWave(real, imag);
}

/** Lleva un AudioParam por los puntos [t, valor] de un plan, desde `t0`. */
function automatizar(param, puntos, t0, indice = 1, minimo = 0, factor = 1) {
  if (!param || !puntos.length) return;
  param.setValueAtTime(Math.max(minimo, puntos[0][indice] * factor), t0 + puntos[0][0]);
  for (let i = 1; i < puntos.length; i++) param.linearRampToValueAtTime(Math.max(minimo, puntos[i][indice] * factor), t0 + puntos[i][0]);
}

export class Vocalizador {
  /** `audio` es el AudioSystem: su contexto de Howler, su mezcla, su oyente y su pausa. */
  constructor({ audio, random = Math.random } = {}) {
    this.audio = audio;
    this.random = random;
    this._activos = [];          // { nodos, fin, ambiente, owner, timer }
    this._ultimo = new WeakMap(); // persona → cuándo hizo su último gesto (ms)
    this._bus = null;
    this._busCtx = null;
    this._ruido = null;
    this._onda = null;
  }

  get activos() { return this._activos.length; }

  /** El contexto si se puede sonar ya: con Web Audio corriendo, sin pausa ni silencio. */
  _ctx() {
    const audio = this.audio, ctx = audio?.howler?.ctx;
    if (!VOCALIZADOR.activo || audio?._paused || audio?.muted || !ctx || ctx.state !== 'running' || !audio.howler.masterGain) return null;
    if (!this._bus || this._busCtx !== ctx) {
      try { this._bus?.disconnect(); } catch { /* ya suelto */ }
      this._bus = ctx.createGain();
      this._busCtx = ctx;
      this._bus.connect(audio.howler.masterGain);
      this._ruido = null; this._onda = null;
    }
    this._bus.gain.value = this._nivel();
    return ctx;
  }

  _nivel() {
    const audio = this.audio;
    return audio?._paused || audio?.muted ? 0 : audio?._level?.('voices') ?? 1;
  }

  _bufferRuido(ctx) {
    if (this._ruido) return this._ruido;
    const length = Math.ceil(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0), random = azarDe(0x5eed);
    for (let i = 0; i < length; i++) data[i] = random() * 2 - 1;
    return (this._ruido = buffer);
  }

  /**
   * `owner` hace el gesto desde su posición. Devuelve false si no toca: sin contexto, lejos, la misma persona hace
   * menos de 1,2 s, ya suenan los que caben, o es de ambiente mientras alguien habla con voz grabada.
   * `opts`: range, position (si no es la de owner), sexo, voz y edad (para quien no tiene cuerpo, como un carro).
   */
  decir(owner, gesto, opts = {}) {
    const position = opts.position ?? owner?.position;
    if (!position || !gesto) return false;
    const ctx = this._ctx();
    if (!ctx) return false;
    const audio = this.audio, ambiente = GESTOS_AMBIENTE.has(gesto);
    const listener = audio._listenerPosition;
    const range = opts.range ?? ALCANCE;
    const distance = listener ? Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z) : 0;
    if (distance >= range) return false;
    const now = nowMs();
    if (owner && now - (this._ultimo.get(owner) ?? -Infinity) < LIMITE.porPersonaMs) return false;
    this._limpiar(ctx.currentTime);
    const ocupados = this._activos.filter(a => a.ambiente === ambiente).length;
    if (ocupados >= (ambiente ? LIMITE.ambiente : LIMITE.reactivos)) return false;
    const hablando = !!audio._voiceActive?.();
    if (ambiente && hablando) return false;
    const perfil = perfilDe(owner, opts);
    const plan = planVocalizacion(gesto, perfil, azarDe(perfil.seed ^ hashTexto(gesto) ^ Math.floor(this.random() * 0x7fffffff)));
    if (!plan) return false;
    const nivel = NIVEL * plan.ganancia * (hablando ? SOBRE_VOZ : 1) * distanceGain(distance, PLENO_HASTA, range);
    if (nivel <= .001) return false;
    let nodos;
    try { nodos = this._tocar(ctx, plan, { nivel, distance, range, pan: voicePan(listener, audio._camera, position) }); }
    catch { return false; } // el audio es opcional: un navegador sin algo de esto no deja de jugar
    const activo = { nodos, fin: ctx.currentTime + plan.dur + .05, ambiente, owner };
    // Si el contexto se suspende, onended puede no llegar: el temporizador limpia igual.
    activo.timer = setTimeout(() => this._soltar(activo), (plan.dur + .4) * 1000);
    nodos.fuente.onended = () => this._soltar(activo);
    this._activos.push(activo);
    if (owner) {
      this._ultimo.set(owner, now);
      if (typeof owner === 'object' && !ambiente) { owner._hablaDesde = now; owner._hablaHasta = now + plan.dur * 1000; }
    }
    return true;
  }

  /** El grafo de una toma; devuelve sus nodos para soltarlos al terminar. */
  _tocar(ctx, plan, { nivel, distance, range, pan }) {
    const t0 = ctx.currentTime + .01, fin = t0 + plan.dur;
    const lista = [];
    const nodo = n => { lista.push(n); return n; };
    const salida = nodo(ctx.createGain());
    salida.gain.value = nivel;
    const agudos = nodo(ctx.createBiquadFilter());
    agudos.type = 'lowpass';
    agudos.frequency.value = Math.min(plan.pasaBajos, AGUDOS_CERCA - (AGUDOS_CERCA - AGUDOS_LEJOS) * Math.min(1, distance / range));
    agudos.Q.value = .5;
    if (typeof ctx.createStereoPanner === 'function') {
      const paneo = nodo(ctx.createStereoPanner());
      paneo.pan.value = pan;
      agudos.connect(paneo); paneo.connect(salida);
    } else agudos.connect(salida);
    salida.connect(this._bus);
    const boca = nodo(ctx.createGain()); // la suma de los tres formantes
    boca.gain.value = 1;
    boca.connect(agudos);
    const voz = nodo(ctx.createGain()), aire = nodo(ctx.createGain());
    voz.gain.value = 0; aire.gain.value = 0;
    for (let k = 0; k < 3; k++) {
      const f = nodo(ctx.createBiquadFilter()), peso = nodo(ctx.createGain());
      f.type = 'bandpass';
      const media = plan.formantes.reduce((sum, p) => sum + p[k + 1], 0) / Math.max(1, plan.formantes.length);
      f.Q.value = media / ANCHO_FORMANTE[k];
      automatizar(f.frequency, plan.formantes, t0, k + 1, 50);
      peso.gain.value = PESO_FORMANTE[k] * (k === 0 ? 4 : 6); // la banda angosta deja pasar poco: se compensa
      voz.connect(f); aire.connect(f); f.connect(peso); peso.connect(boca);
    }
    automatizar(voz.gain, plan.amp, t0);
    automatizar(aire.gain, plan.aire, t0, 1, 0, AIRE);
    // La glotis: tono con vibrato de 5,5 Hz (±1,5 %).
    const glotis = nodo(ctx.createOscillator());
    const onda = this._onda ??= ondaGlotal(ctx);
    if (onda) glotis.setPeriodicWave(onda); else glotis.type = 'sawtooth';
    automatizar(glotis.frequency, plan.pitch, t0, 1, 20);
    const vibrato = nodo(ctx.createOscillator()), cuanto = nodo(ctx.createGain());
    vibrato.frequency.value = 5.5;
    cuanto.gain.value = (plan.pitch[0]?.[1] ?? 120) * .015;
    vibrato.connect(cuanto); cuanto.connect(glotis.frequency);
    glotis.connect(voz);
    // El aire: ruido blanco sin graves, por la boca; la fricción (la f) sale sin formantes.
    const ruido = nodo(ctx.createBufferSource());
    ruido.buffer = this._bufferRuido(ctx);
    ruido.loop = true;
    const sinGraves = nodo(ctx.createBiquadFilter());
    sinGraves.type = 'highpass'; sinGraves.frequency.value = 500;
    ruido.connect(sinGraves); sinGraves.connect(aire);
    if (plan.friccion.length) {
      const f = nodo(ctx.createBiquadFilter()), g = nodo(ctx.createGain());
      f.type = 'highpass'; f.frequency.value = 1800;
      g.gain.value = 0;
      automatizar(g.gain, plan.friccion, t0);
      sinGraves.connect(f); f.connect(g); g.connect(agudos);
    }
    glotis.start(t0); vibrato.start(t0); ruido.start(t0, Math.random() * .9);
    glotis.stop(fin + .02); vibrato.stop(fin + .02); ruido.stop(fin + .02);
    return { fuente: glotis, lista };
  }

  _soltar(activo) {
    const index = this._activos.indexOf(activo);
    if (index < 0) return;
    this._activos.splice(index, 1);
    clearTimeout(activo.timer);
    for (const n of activo.nodos.lista) {
      try { n.stop?.(); } catch { /* ya terminó */ }
      try { n.disconnect(); } catch { /* ya suelto */ }
    }
  }

  _limpiar(now) { for (const activo of [...this._activos]) if (activo.fin < now) this._soltar(activo); }

  /** Cada cuadro: el canal sigue la mezcla; en pausa o silencio se calla todo lo que sonaba. */
  update() {
    if (this.audio?._paused || this.audio?.muted || !VOCALIZADOR.activo) { this.callar(); return; }
    if (this._bus) {
      const nivel = this._nivel();
      if (Math.abs(this._bus.gain.value - nivel) > .002) this._bus.gain.value = nivel;
    }
  }

  callar() { for (const activo of [...this._activos]) this._soltar(activo); }

  dispose() {
    this.callar();
    try { this._bus?.disconnect(); } catch { /* ya suelto */ }
    this._bus = null; this._busCtx = null; this._ruido = null; this._onda = null;
  }
}

/**
 * Quien no tiene frase grabada para `category` hace su gesto, si la categoría tiene uno (ver GESTO_POR_CATEGORIA).
 * Devuelve si sonó. Las burbujas y textos de siempre los sigue poniendo quien llama.
 */
export function vocalizarFaltante(npc, category) {
  const gesto = GESTO_POR_CATEGORIA[category];
  if (!gesto || !npc) return false;
  const audio = npc.audio ?? globalThis.window?.__game?.audio;
  return !!audio?.vocalizador?.decir(npc, gesto);
}
