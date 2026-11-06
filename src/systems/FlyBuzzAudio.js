// src/systems/FlyBuzzAudio.js
// El zumbido de las moscas: una sola voz que suena cerca de la popó más cercana, más fuerte cuanto más
// cerca. Sin nodos permanentes: cada tramo es una nota corta por el canal de efectos (`_fx()`), así la
// pausa, el silencio y el volumen de Efectos la afectan como a cualquier otro efecto.
import { distanceGain } from './VehicleAudio.js';

export const BUZZ_NEAR = 1, BUZZ_FAR = 4;   // metros: plena hasta NEAR, muda desde FAR
export const BUZZ_STEP = .35;               // segundos de cada tramo
export const BUZZ_GAIN = .06;
const ATTACK = .04, RELEASE = .06, OVERLAP = .06;

export class FlyBuzzAudio {
  constructor({ fx, random = Math.random } = {}) {
    this.fx = fx;          // devuelve { ctx, out } como AudioSystem._fx, o null
    this.random = random;
    this._next = 0;        // segundos hasta el próximo tramo
  }

  /** `distance` a la popó más cercana, en metros (Infinity si no hay). */
  update(dt, distance) {
    if (!(distance < BUZZ_FAR)) { this._next = 0; return; }
    this._next -= dt;
    if (this._next > 0) return;
    this._next = Math.max(this._next + BUZZ_STEP, 0) || BUZZ_STEP;
    const fx = this.fx?.();
    if (!fx) return;
    this._note(fx, BUZZ_GAIN * distanceGain(distance, BUZZ_NEAR, BUZZ_FAR));
  }

  _note({ ctx, out }, peak) {
    if (!(peak > 0)) return;
    const t = ctx.currentTime, length = BUZZ_STEP + OVERLAP;
    const base = 190 + this.random() * 40;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(650, t);
    filter.Q.setValueAtTime(1.2, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + ATTACK);
    gain.gain.setValueAtTime(peak, t + length - RELEASE);
    gain.gain.linearRampToValueAtTime(0, t + length);
    filter.connect(gain);
    gain.connect(out);
    for (const frequency of [base, base + 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(frequency, t);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + length);
    }
  }
}
