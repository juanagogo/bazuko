// src/character/HitLean.js
// Inclinación del cuerpo al recibir un golpe: el tronco cede hacia donde lo empujan y vuelve
// con un muelle amortiguado, sin el salto de un cuadro a otro ni la vibración de antes.
// Solo inclina el cuerpo; la cámara no se toca.

import * as THREE from 'three';

export const HIT_LEAN = {
  stiffness: 90,   // ≈ 1,5 Hz: un golpe se nota y se recupera en medio segundo
  damping: 11,
  impulse: 2.3,    // rad/s por unidad de fuerza
  max: .3          // rad: nunca parece que se cae
};

export class HitLean {
  constructor() {
    this.pitch = 0; this.roll = 0;   // rad, en el marco del cuerpo: + la cabeza hacia su frente · + hacia su derecha
    this.vPitch = 0; this.vRoll = 0;
    this.applied = false;
    this._base = new THREE.Euler();
    this._after = new THREE.Quaternion();
    this._lean = new THREE.Quaternion();
    this._euler = new THREE.Euler();
  }

  get active() { return this.pitch !== 0 || this.roll !== 0 || this.vPitch !== 0 || this.vRoll !== 0; }

  /**
   * @param {{x:number, z:number}} push dirección horizontal del empujón en el mundo (del agresor hacia el jugador)
   * @param {number} yaw rumbo del cuerpo (rotation.y; el frente es +Z local)
   * @param {number} strength 1 = golpe corriente
   */
  kick(push, yaw, strength = 1) {
    const length = Math.hypot(push?.x ?? 0, push?.z ?? 0);
    if (!(length > 1e-6) || !Number.isFinite(length) || !Number.isFinite(yaw) || !(strength > 0) || !Number.isFinite(strength)) return;
    const x = push.x / length, z = push.z / length;
    const along = x * Math.sin(yaw) + z * Math.cos(yaw);   // + lo empujan desde atrás
    const side = x * Math.cos(yaw) - z * Math.sin(yaw);    // + hacia su +X local
    const v = HIT_LEAN.impulse * Math.min(2, strength);
    this.vPitch += along * v;
    // Un golpe de frente también lo dobla un poco de lado: nadie recibe un puño perfectamente recto.
    this.vRoll += (-side + (Math.abs(side) < .2 ? (along >= 0 ? .25 : -.25) : 0)) * v * .8;
  }

  /** Cambia los ejes al girarse la víctima, conservando la dirección del empujón en el mundo. */
  orientar(rumbo) {
    if (this.active && this._rumbo !== undefined) {
      const giro = rumbo - this._rumbo, cos = Math.cos(giro), sin = Math.sin(giro);
      const { pitch, roll, vPitch, vRoll } = this;
      const amplitud = Math.hypot(pitch, roll);
      const escala = amplitud > HIT_LEAN.max ? HIT_LEAN.max / amplitud : 1;
      this.pitch = (pitch * cos - roll * sin) * escala;
      this.roll = (pitch * sin + roll * cos) * escala;
      this.vPitch = vPitch * cos - vRoll * sin;
      this.vRoll = vPitch * sin + vRoll * cos;
    }
    this._rumbo = rumbo;
  }

  update(dt) {
    if (!(dt > 0) || !this.active) return;
    // Paso exacto del muelle amortiguado: el mismo recorrido a 30, 60 o 144 imágenes por segundo.
    const { stiffness: k, damping: c, max } = HIT_LEAN;
    const a = c / 2, wd = Math.sqrt(k - a * a);
    const e = Math.exp(-a * dt), cos = Math.cos(wd * dt), sin = Math.sin(wd * dt) / wd;
    const pitch = this.pitch, roll = this.roll, vPitch = this.vPitch, vRoll = this.vRoll;
    this.vPitch = e * (vPitch * cos - (a * vPitch + k * pitch) * sin);
    this.vRoll = e * (vRoll * cos - (a * vRoll + k * roll) * sin);
    this.pitch = Math.max(-max, Math.min(max, e * (pitch * cos + (vPitch + a * pitch) * sin)));
    this.roll = Math.max(-max, Math.min(max, e * (roll * cos + (vRoll + a * roll) * sin)));
    if (Math.abs(this.pitch) + Math.abs(this.roll) < 2e-4 && Math.abs(this.vPitch) + Math.abs(this.vRoll) < 2e-3) this.clear();
  }

  /** Quita la inclinación del cuadro anterior, para que nada de lo que mueve el cuerpo la lea ni la acumule. */
  remove(object) {
    if (!this.applied) return;
    this.applied = false;
    // Si nadie tocó el objeto desde entonces, vuelve exactamente a su rotación de antes.
    if (object.quaternion.equals(this._after)) object.rotation.copy(this._base);
  }

  /** Inclina el objeto en su propio marco (el del cuerpo, con su rumbo), sea cual sea hacia dónde mira. */
  apply(object) {
    if (!this.active) return;
    this._base.copy(object.rotation);
    object.quaternion.multiply(this._lean.setFromEuler(this._euler.set(this.pitch, 0, this.roll)));
    this._after.copy(object.quaternion);
    this.applied = true;
  }

  clear() { this.pitch = this.roll = this.vPitch = this.vRoll = 0; }
}
