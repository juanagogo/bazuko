import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
const _eye = new Vector3(), _forward = new Vector3(), _right = new Vector3();
const _up = new Vector3(0, 1, 0);
const _inverse = new Matrix4();
const _parent = new Quaternion(), _turn = new Quaternion(), _tilt = new Quaternion();

/** Atención sobre el gesto del clip, con la posición de los ojos y el frente tomados en reposo. */
export class ConversationGaze {
  constructor(root, head, neck, eyePoint) {
    this.head = head;
    this.neck = neck;
    this.eye = head.worldToLocal(eyePoint);
    this.forward = new Vector3(0, 0, 1).transformDirection(root.matrixWorld)
      .transformDirection(_inverse.copy(head.matrixWorld).invert());
    this.beforeHead = new Quaternion();
    this.beforeNeck = new Quaternion();
    this.active = false;
    this.yaw = this.pitch = 0;
  }

  eyePosition(target) { return this.head.localToWorld(target.copy(this.eye)); }

  restore() {
    if (!this.active) return;
    this.head.quaternion.copy(this.beforeHead);
    this.neck?.quaternion.copy(this.beforeNeck);
    this.active = false;
  }

  update(dt, target, enabled, nod = 0) {
    if (!enabled) { this.pitch = this.yaw = 0; return; }
    if (!target && !this.pitch && !this.yaw) return;

    this.eyePosition(_eye); // también deja lista la matriz del hueso para leer el frente
    _forward.copy(this.forward).transformDirection(this.head.matrixWorld);
    const heading = Math.atan2(_forward.x, _forward.z);
    let yaw = 0, pitch = 0;
    if (target) {
      const dx = target.x - _eye.x, dz = target.z - _eye.z;
      const flat = Math.hypot(dx, dz);
      if (flat > .18) {
        const turn = Math.atan2(dx, dz) - heading;
        yaw = MathUtils.clamp(Math.atan2(Math.sin(turn), Math.cos(turn)) * .86, -56 * DEG, 56 * DEG);
        const inclination = Math.asin(MathUtils.clamp(_forward.y, -1, 1));
        const error = inclination - Math.atan2(target.y - _eye.y, flat);
        // Conserva parte del gesto y espera a que el interlocutor entre en el campo de la cara.
        pitch = MathUtils.clamp(error * .86 + nod, -30 * DEG, 24 * DEG) * MathUtils.smoothstep(Math.cos(turn), 0, .6);
      }
    }
    const blend = -Math.expm1(-(target ? 10 : 8) * dt);
    this.yaw += (yaw - this.yaw) * blend;
    this.pitch += (pitch - this.pitch) * blend;
    if (Math.abs(this.yaw) < .002) this.yaw = 0;
    if (Math.abs(this.pitch) < .002) this.pitch = 0;
    if (!this.yaw && !this.pitch) return;

    // La inclinación sigue el eje lateral de la cara: la cabeza ya puede venir girada por el clip.
    const aimed = heading + this.yaw;
    _right.set(Math.cos(aimed), 0, -Math.sin(aimed));
    this.beforeHead.copy(this.head.quaternion);
    if (this.neck) {
      this.beforeNeck.copy(this.neck.quaternion);
      this._rotate(this.neck, .32);
    }
    this._rotate(this.head, this.neck ? .68 : 1);
    this.active = true;
  }

  _rotate(bone, share) {
    bone.parent.getWorldQuaternion(_parent).normalize();
    _turn.setFromAxisAngle(_up, this.yaw * share);
    _tilt.setFromAxisAngle(_right, this.pitch * share).multiply(_turn).multiply(_parent);
    bone.quaternion.premultiply(_parent.invert().multiply(_tilt));
  }
}
