// src/character/HitLean.js
// Inclinación del cuerpo al recibir un golpe: el tronco cede hacia donde lo empujan y vuelve
// con un muelle amortiguado, sin el salto de un cuadro a otro ni la vibración de antes.
// Solo inclina el cuerpo; la cámara no se toca (el temblor sigue siendo mínimo).

export const HIT_LEAN = {
  stiffness: 90,   // ≈ 1,5 Hz: un golpe se nota y se recupera en medio segundo
  damping: 11,     // casi sin rebote
  impulse: 2.3,    // rad/s por unidad de fuerza
  max: .3          // rad: nunca parece que se cae
};

export class HitLean {
  constructor() {
    this.pitch = 0; this.roll = 0;   // rad: + adelante · + hacia su izquierda (rotation.z de three)
    this.vPitch = 0; this.vRoll = 0;
    this.applied = { x: 0, z: 0 };
  }

  get active() { return this.pitch !== 0 || this.roll !== 0 || this.vPitch !== 0 || this.vRoll !== 0; }

  /**
   * @param {{x:number, z:number}} push dirección horizontal del empujón en el mundo (del agresor hacia el jugador)
   * @param {number} yaw rumbo del cuerpo (rotation.y; el frente es +Z local)
   * @param {number} strength 1 = golpe corriente
   */
  kick(push, yaw, strength = 1) {
    const length = Math.hypot(push?.x ?? 0, push?.z ?? 0);
    if (!(length > 1e-6) || !Number.isFinite(yaw) || !(strength > 0)) return;
    const x = push.x / length, z = push.z / length;
    const along = x * Math.sin(yaw) + z * Math.cos(yaw);   // + lo empujan desde atrás
    const side = x * Math.cos(yaw) - z * Math.sin(yaw);    // + hacia su +X local
    const v = HIT_LEAN.impulse * Math.min(2, strength);
    this.vPitch += along * v;
    // Un golpe de frente también lo dobla un poco de lado: nadie recibe un puño perfectamente recto.
    this.vRoll += (-side + (Math.abs(side) < .2 ? (along >= 0 ? .25 : -.25) : 0)) * v * .8;
  }

  update(dt) {
    if (!(dt > 0) || !this.active) return;
    const step = Math.min(dt, 1 / 20), { stiffness: k, damping: c, max } = HIT_LEAN;
    this.vPitch += (-k * this.pitch - c * this.vPitch) * step;
    this.vRoll += (-k * this.roll - c * this.vRoll) * step;
    this.pitch = Math.max(-max, Math.min(max, this.pitch + this.vPitch * step));
    this.roll = Math.max(-max, Math.min(max, this.roll + this.vRoll * step));
    if (Math.abs(this.pitch) + Math.abs(this.roll) < 2e-4 && Math.abs(this.vPitch) + Math.abs(this.vRoll) < 2e-3) this.clear();
  }

  /** Quita lo que se sumó el cuadro anterior, para que las mezclas del cuerpo no lo acumulen. */
  remove(object) {
    object.rotation.x -= this.applied.x;
    object.rotation.z -= this.applied.z;
    this.applied.x = this.applied.z = 0;
  }

  apply(object, scale = 1) {
    this.applied.x = this.pitch * scale;
    this.applied.z = this.roll * scale;
    object.rotation.x += this.applied.x;
    object.rotation.z += this.applied.z;
  }

  clear() { this.pitch = this.roll = this.vPitch = this.vRoll = 0; }
}
