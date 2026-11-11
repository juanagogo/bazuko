import { DAY_LENGTH_SECONDS } from '../utils/constants.js';

/** Duración del ciclo día/noche en el juego: 12 minutos reales (720 s) por cada 24 horas del mundo. */
export const DAY_CYCLE_SECONDS = 720;

export class Clock {
  constructor(options = {}) {
    const dayLengthSeconds = typeof options === 'number'
      ? options
      : (options.dayLengthSeconds ?? DAY_LENGTH_SECONDS);
    this.day = options.day ?? 1;
    this.hour = options.hour ?? 6; // empieza al amanecer
    this.dayLengthSeconds = dayLengthSeconds;
    this.speed = options.speed ?? 1;
    this.minutesPerSecond = (24 * 60 / this.dayLengthSeconds) * this.speed;
  }

  update(dt) {
    this.hour += (dt * this.minutesPerSecond) / 60;
    if (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
    }
  }

  setSpeed(multiplier = 1) {
    this.speed = multiplier;
    this.minutesPerSecond = (24 * 60 / this.dayLengthSeconds) * this.speed;
  }

  setDayLengthSeconds(seconds) {
    this.dayLengthSeconds = seconds;
    this.minutesPerSecond = (24 * 60 / this.dayLengthSeconds) * this.speed;
  }

  get hourFloat() { return this.hour; }
  get isNight()   { return this.hour < 6 || this.hour >= 20; }
  /** Carros, ventanas y faroles encienden al ponerse el sol, dos horas antes de que empiece la noche del juego. */
  get lightsOn() { return this.hour < 6 || this.hour >= 18; }

  serialize()   { return { day: this.day, hour: this.hour }; }
  deserialize(d){
    if (d && Number.isFinite(d.day)) this.day = d.day;
    if (d && Number.isFinite(d.hour)) this.hour = d.hour;
  }
}
