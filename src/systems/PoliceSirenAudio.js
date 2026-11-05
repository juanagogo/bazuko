// src/systems/PoliceSirenAudio.js
// La sirena de las patrullas: un vaivén sintetizado que sale de quien va persiguiendo, más fuerte de cerca.
// Sin nodos permanentes: cada tramo es una nota programada por el mismo canal de efectos.
import { POLICE_GIVE_UP_RANGE } from '../utils/constants.js';
import { distanceGain } from './VehicleAudio.js';

const SIREN_NEAR = 12, SIREN_FAR = POLICE_GIVE_UP_RANGE;  // metros: plena hasta NEAR, muda cuando desisten
const STEP = .55;                        // segundos de cada lamento
const LOW = 700, HIGH = 1250;            // Hz del barrido

export class PoliceSirenAudio {
  constructor({ fx, random = Math.random } = {}) {
    this.fx = fx;                        // devuelve { ctx, out } como AudioSystem._fx, o null
    this.random = random;
    this._time = new WeakMap();          // patrulla -> tiempo acumulado del vaivén
  }

  /** `vehicles` son los del tráfico; suenan las dos patrullas en persecución más cercanas. */
  update(dt, playerPosition, vehicles) {
    let first = null, firstDist = Infinity, second = null, secondDist = Infinity;
    for (const vehicle of vehicles ?? []) {
      const car = vehicle.car;
      if (!vehicle.police || !car?.pursuit) continue;
      const distance = Math.hypot(car.position.x - playerPosition.x, car.position.y - playerPosition.y, car.position.z - playerPosition.z);
      if (distance >= SIREN_FAR) continue;
      if (distance < firstDist) { second = first; secondDist = firstDist; first = vehicle; firstDist = distance; }
      else if (distance < secondDist) { second = vehicle; secondDist = distance; }
    }
    this._advance(dt, first, firstDist);
    this._advance(dt, second, secondDist);
  }

  /** Cada STEP segundos, un lamento. El primer avistamiento arranca el reloj, sin sonar de golpe. */
  _advance(dt, vehicle, distance) {
    if (!vehicle) return;
    const previous = this._time.get(vehicle);
    if (previous === undefined) {
      // Desfase negativo: el primer lamento llega al cruzar el cero, no en el mismo cuadro.
      this._time.set(vehicle, -this.random() * STEP);
      return;
    }
    const elapsed = previous + dt;
    this._time.set(vehicle, elapsed);
    if (Math.floor(elapsed / STEP) === Math.floor(previous / STEP)) return;
    this._wail(distanceGain(distance, SIREN_NEAR, SIREN_FAR));
  }

  _wail(volume) {
    const fx = this.fx?.();
    if (!fx) return;
    const { ctx, out } = fx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(LOW, t);
    osc.frequency.linearRampToValueAtTime(HIGH, t + STEP);
    filter.type = 'lowpass'; filter.frequency.value = 1500; filter.Q.value = .7;
    const peak = .34 * volume;
    gain.gain.setValueAtTime(.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + .08);
    gain.gain.linearRampToValueAtTime(peak * .85, t + STEP - .12);
    gain.gain.exponentialRampToValueAtTime(.0001, t + STEP);
    osc.connect(filter); filter.connect(gain); gain.connect(out);
    osc.start(t); osc.stop(t + STEP + .02);
  }
}
