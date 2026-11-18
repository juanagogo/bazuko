// src/systems/CarGuarding.js
// Cuidar carros: junto a un carro parqueado, Q y me quedo cerca hasta que vuelve el dueño, que deja una
// propina. Si me alejo mucho, pierdo el turno; si le robo el espejo al carro que cuido, quedo mal.
// Todo avanza con el tiempo de la simulación: la pausa y los menús no cuentan.

export const GUARD = {
  waitMin: 40,       // segundos hasta que vuelve el dueño
  waitMax: 75,
  stay: 9,           // metros: hasta aquí sigo cuidando
  leave: 14,         // metros: de aquí en adelante perdí el turno
  graceSeconds: 6,   // segundos que aguanta lejos (entre stay y leave) antes de perderlo
  tipMin: 1500,
  tipMax: 4500,
  noTipProb: 0.1,    // a veces el dueño no da nada
  carCooldown: 300,  // segundos antes de volver a cuidar el mismo carro
};

export class CarGuarding {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.car = null;
    this.elapsed = 0;
    this.wait = 0;
    this.away = 0;
    this._cooldowns = new Map(); // carro → segundos restantes
  }

  get active() { return !!this.car; }
  get progress() { return this.car ? Math.min(1, this.elapsed / this.wait) : 0; }
  get remaining() { return this.car ? Math.max(0, this.wait - this.elapsed) : 0; }

  /** ¿Se puede cuidar este carro? Parqueado, sin usar y sin haberlo cuidado hace poco. */
  canGuard(car) {
    return !!car && !car.traffic && car.kind !== 'police' && !car.used && !this.active && !(this._cooldowns.get(car) > 0);
  }

  /** Segundos antes de poder volver a cuidar ese carro, o 0. */
  cooldownOf(car) { return Math.max(0, this._cooldowns.get(car) ?? 0); }

  start(car) {
    if (!this.canGuard(car)) return false;
    this.car = car;
    this.elapsed = 0;
    this.away = 0;
    this.wait = GUARD.waitMin + this.random() * (GUARD.waitMax - GUARD.waitMin);
    return true;
  }

  cancel() {
    if (this.car) this._cooldowns.set(this.car, GUARD.carCooldown / 3);
    this.car = null;
  }

  /**
   * Avanza el turno. Devuelve un evento cuando pasa algo:
   * `{ type: 'paid', amount }`, `{ type: 'left' }`, `{ type: 'far', seconds }` (aviso de que me voy) o null.
   */
  update(dt, playerPos) {
    for (const [car, s] of this._cooldowns) {
      if (s - dt <= 0) this._cooldowns.delete(car); else this._cooldowns.set(car, s - dt);
    }
    const car = this.car;
    if (!car) return null;
    // Se lo robaron o lo dañé yo: el turno se acaba.
    if (car.used) { this.cancel(); return { type: 'spoiled' }; }
    const d = Math.hypot(playerPos.x - car.position.x, playerPos.z - car.position.z);
    if (d > GUARD.leave) { this.cancel(); return { type: 'left' }; }
    let event = null;
    if (d > GUARD.stay) {
      const before = this.away;
      this.away += dt;
      if (this.away >= GUARD.graceSeconds) { this.cancel(); return { type: 'left' }; }
      if (before === 0) event = { type: 'far', seconds: GUARD.graceSeconds };
    } else this.away = 0;
    this.elapsed += dt;
    if (this.elapsed < this.wait) return event;
    this.car = null;
    this._cooldowns.set(car, GUARD.carCooldown);
    if (this.random() < GUARD.noTipProb) return { type: 'paid', amount: 0 };
    const amount = Math.round((GUARD.tipMin + this.random() * (GUARD.tipMax - GUARD.tipMin)) / 100) * 100;
    return { type: 'paid', amount };
  }
}
