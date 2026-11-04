import { DAY_LENGTH_SECONDS } from '../utils/constants.js';

export class Clock {
  constructor() {
    this.day = 1;
    this.hour = 6;          // empieza de madrugada
    this.minutesPerSecond = 24 * 60 / DAY_LENGTH_SECONDS;
  }

  update(dt) {
    this.hour += (dt * this.minutesPerSecond) / 60;
    if (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
    }
  }

  get hourFloat() { return this.hour; }
  get isNight()   { return this.hour < 6 || this.hour >= 20; }
  /** Carros, ventanas y faroles encienden al ponerse el sol, dos horas antes de que empiece la noche del juego. */
  get lightsOn() { return this.hour < 6 || this.hour >= 18; }

  serialize()   { return { day: this.day, hour: this.hour }; }
  deserialize(d){ this.day = d.day; this.hour = d.hour; }
}
