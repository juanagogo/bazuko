import { Euler, Quaternion, Vector3 } from 'three';
import { createMeleeOverlay, rotateInFrame } from './melee.js';
import { createSmokeOverlay } from './smoking.js';
import { createBasucoOverlay } from './pipe.js';
import { createPointOverlay } from './pointing.js';

const clamp = value => Math.min(1, Math.max(0, value));
const smooth = (from, to, value) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const normalizeName = name => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
const JOINTS = {
  hips: ['hips'], spine: ['spine2', 'spine1', 'spine'], head: ['head'],
  lowerSpine: ['spine'], midSpine: ['spine1'], neck: ['neck'],
  leftArm: ['leftarm'], leftForeArm: ['leftforearm'], rightArm: ['rightarm'], rightForeArm: ['rightforearm'],
  leftUpLeg: ['leftupleg'], leftLeg: ['leftleg'], rightUpLeg: ['rightupleg'], rightLeg: ['rightleg'],
  leftFoot: ['leftfoot'], rightFoot: ['rightfoot']
};
const CHILD = { leftArm: 'leftForeArm', rightArm: 'rightForeArm', leftUpLeg: 'leftLeg', rightUpLeg: 'rightLeg', leftLeg: 'leftFoot', rightLeg: 'rightFoot' };

/**
 * Poses de acción sobre una instancia, después del mezclador. Los objetivos de
 * brazos y piernas usan el espacio del personaje (+Z delante), no ejes Euler
 * supuestos: los huesos Mixamo y las articulaciones procedurales difieren.
 * restore() debe ejecutarse antes de la siguiente evaluación del mezclador.
 * No cambia la raíz física, clips, materiales ni objetos de otros personajes.
 */
export class ActionPose {
  constructor(bones, { procedural = false, lod = false, frame = null } = {}) {
    const values = bones instanceof Map ? [...bones.values()] : Object.values(bones ?? {});
    this.joints = {};
    for (const [key, aliases] of Object.entries(JOINTS)) {
      this.joints[key] = bones instanceof Map
        ? aliases.map(alias => values.find(bone => normalizeName(bone.name ?? '').endsWith(alias))).find(Boolean)
        : bones?.[key];
    }
    this.frame = frame ?? this.joints.hips?.parent ?? this.joints.spine?.parent?.parent;
    this.overlayBones = bones instanceof Map ? bones : new Map(Object.entries(this.joints)
      .filter(([, bone]) => bone).map(([key, bone]) => [key === 'spine' ? 'Spine2' : key[0].toUpperCase() + key.slice(1), bone]));
    this.slots = new Map();
    for (const [key, bone] of Object.entries(this.joints)) {
      if (!bone || key.endsWith('Foot')) continue;
      const child = this.joints[CHILD[key]] ?? bone.children.find(object => object.isBone);
      const axis = child?.position.lengthSq() > 1e-8 ? child.position.clone().normalize() : new Vector3(0, procedural ? -1 : 1, 0);
      this.slots.set(key, { bone, axis, quaternion: new Quaternion(), position: new Vector3() });
    }
    this.lod = lod;
    this.procedural = procedural;
    this.active = false;
    this.time = 0;
    this.swimWeight = 0;
    this.swimSpeed = 0;
    this.swimLift = 0;
    this.glance = 0;
    this._frameQ = new Quaternion();
    this._worldQ = new Quaternion();
    this._parentQ = new Quaternion();
    this._deltaQ = new Quaternion();
    this._targetQ = new Quaternion();
    this._direction = new Vector3();
    this._target = new Vector3();
    this._position = new Vector3();
    this._euler = new Euler();
  }

  restore() {
    if (!this.active) return;
    for (const slot of this.slots.values()) {
      slot.bone.quaternion.copy(slot.quaternion);
      slot.bone.position.copy(slot.position);
    }
    this.active = false;
  }

  _aim(key, x, y, z, weight) {
    const slot = this.slots.get(key);
    if (!slot || weight <= 0) return;
    const bone = slot.bone;
    bone.getWorldQuaternion(this._worldQ);
    this._direction.copy(slot.axis).applyQuaternion(this._worldQ).normalize();
    this._target.set(x, y, z).normalize().applyQuaternion(this._frameQ);
    this._deltaQ.setFromUnitVectors(this._direction, this._target);
    this._targetQ.copy(this._worldQ).premultiply(this._deltaQ);
    if (bone.parent) this._targetQ.premultiply(bone.parent.getWorldQuaternion(this._parentQ).invert());
    bone.quaternion.slerp(this._targetQ, weight);
    bone.updateMatrixWorld(true);
  }

  _rotate(key, x, y, z, weight = 1) {
    const slot = this.slots.get(key);
    if (!slot || weight <= 0) return;
    const bone = slot.bone;
    bone.getWorldQuaternion(this._worldQ);
    this._deltaQ.setFromEuler(this._euler.set(x * weight, y * weight, z * weight));
    this._deltaQ.premultiply(this._frameQ).multiply(this._parentQ.copy(this._frameQ).invert());
    this._targetQ.copy(this._worldQ).premultiply(this._deltaQ);
    if (bone.parent) this._targetQ.premultiply(bone.parent.getWorldQuaternion(this._parentQ).invert());
    bone.quaternion.copy(this._targetQ);
    bone.updateMatrixWorld(true);
  }

  mouth(target) {
    this.smoke ??= createSmokeOverlay(this.overlayBones, this.frame);
    return this.smoke.mouth(target);
  }

  apply(dt, { speed = 0, action = null, actionProgress = 0, movement = {}, attack = null, smoke = null, basuco = null, point = 0, look = 0 } = {}) {
    this.restore();
    const elapsed = Math.max(0, finite(dt));
    const swim = movement.swimming === true;
    const airborne = movement.grounded === false && !swim;
    const landing = clamp(finite(movement.landing));
    const punch = action === 'golpear', hit = action === 'recibirGolpe';
    const handsBlocked = swim || airborne || landing > 0 || hit || (action && !['golpear', 'basuco'].includes(action));
    // Un dueño de manos por vez. El agua, el vuelo y los impactos cancelan incluso
    // los restos de una transición; no se suman un puñetazo y una calada al mismo brazo.
    if (handsBlocked) {
      attack = smoke = basuco = null; point = look = 0;
      this.melee?.reset(); this.smoke?.reset(); this.pipe?.reset(); this.point?.reset();
    } else if (attack || punch) {
      smoke = basuco = null; point = look = 0;
      this.smoke?.reset(); this.pipe?.reset(); this.point?.reset();
    } else if (basuco != null && speed < .15) {
      smoke = null; point = look = 0;
      this.melee?.reset(); this.smoke?.reset(); this.point?.reset();
    } else if (point > 0) {
      smoke = basuco = null;
      this.melee?.reset(); this.smoke?.reset(); this.pipe?.reset();
    } else if (smoke) {
      basuco = null; look = 0;
      this.melee?.reset(); this.pipe?.reset(); this.point?.reset();
    }
    if (speed >= .15) { basuco = null; this.pipe?.reset(); }
    this.glance += (finite(look) - this.glance) * -Math.expm1(-16 * elapsed);
    if (handsBlocked) this.glance = 0;
    const gestures = attack || smoke || basuco != null || point > 0 || this.melee?.active || this.smoke?.active || this.pipe?.active || this.point?.active || Math.abs(this.glance) > .002;
    // El LOD mantiene animación barata salvo una reacción de combate visible.
    if (this.lod && !punch && !hit && !gestures) return;
    const swimTarget = swim ? Math.min(3, Math.max(0, finite(speed))) : 0;
    const speedBlend = -Math.expm1(-12 * elapsed);
    // Integrar la velocidad suavizada analíticamente conserva la fase a distintos FPS.
    const speedIntegral = swimTarget * elapsed + (this.swimSpeed - swimTarget) * speedBlend / 12;
    this.swimSpeed += (swimTarget - this.swimSpeed) * speedBlend;
    this.swimWeight += ((swim ? 1 : 0) - this.swimWeight) * -Math.expm1(-14 * elapsed);
    if (!swim && this.swimWeight < .001) this.swimWeight = this.swimLift = 0;
    if (!swim && !this.swimWeight && !airborne && !landing && !punch && !hit && !gestures) return;
    if (action && !punch && !hit && !swim && !gestures && action !== 'saltar' && action !== 'aterrizar') return;
    this.time += swim || this.swimWeight ? .8 * elapsed + .25 * speedIntegral : elapsed;
    this.frame?.getWorldQuaternion(this._frameQ) ?? this._frameQ.identity();
    for (const slot of this.slots.values()) {
      slot.quaternion.copy(slot.bone.quaternion);
      slot.position.copy(slot.bone.position);
    }
    this.active = true;

    if (this.swimWeight) this._swim(this.swimSpeed, this.swimWeight, movement, elapsed);
    if (!swim && (airborne || landing)) this._jump(movement, airborne, landing);
    if (!handsBlocked) {
      if (attack || this.melee?.active) (this.melee ??= createMeleeOverlay(this.overlayBones, this.frame)).apply(elapsed, attack);
      else if (punch) this._punch(clamp(finite(actionProgress)));
      if (smoke || this.smoke?.active) (this.smoke ??= createSmokeOverlay(this.overlayBones, this.frame)).apply(elapsed, smoke);
      if (basuco != null || this.pipe?.active) {
        (this.pipe ??= createBasucoOverlay(this.overlayBones, this.frame)).apply(elapsed, basuco);
        this._raiseHips(-this.pipe.drop);
      }
      if (point || this.point?.active) (this.point ??= createPointOverlay(this.overlayBones, this.frame)).apply(elapsed, point);
      if (Math.abs(this.glance) > .002) {
        if (this.joints.neck) rotateInFrame(this.frame, this.joints.neck, 0, this.glance * .4, 0);
        if (this.joints.head) rotateInFrame(this.frame, this.joints.head, 0, this.glance * (this.joints.neck ? .6 : 1), 0);
      }
    }
    if (hit) this._hit(clamp(finite(actionProgress)));
  }

  _jump(movement, airborne, landing) {
    const velocity = finite(movement.verticalVelocity);
    const airTime = Math.max(0, finite(movement.airTime, 1));
    const rising = smooth(-.5, 3, velocity);
    const falling = smooth(0, 5, -velocity);
    const weight = airborne ? smooth(0, .09, airTime) : landing;
    const tuck = airborne ? .25 + rising * .55 - falling * .2 : .65;
    // El suelo queda en la física: solo se articulan piernas/cadera visuales.
    const footY = !airborne ? this._lowestFoot() : null;
    this._rotate('hips', airborne ? .04 + rising * .06 : .14, 0, 0, weight);
    this._rotate('spine', airborne ? -.06 : .13, 0, 0, weight);
    this._rotate('head', -.08, 0, 0, weight);
    for (const [side, name] of [[1, 'left'], [-1, 'right']]) {
      const asymmetry = airborne ? side * .08 : 0;
      this._aim(`${name}UpLeg`, side * .09, -.95 + tuck * .5, tuck + asymmetry, weight);
      this._aim(`${name}Leg`, side * .03, -.95 + tuck * .35, -.15 - tuck * .7, weight);
      this._aim(`${name}Arm`, side * .34, -.5 + falling * .2, airborne ? -.25 + falling * .4 : .35, weight);
      this._aim(`${name}ForeArm`, side * .1, -.6, .6, weight);
    }
    if (footY !== null) {
      const after = this._lowestFoot();
      const hips = this.joints.hips;
      if (hips?.parent && after !== null) {
        // Mantiene la altura del apoyo al comprimir rodillas para aterrizar.
        this._raiseHips(footY - after);
      }
    }
  }

  _raiseHips(height) {
    const hips = this.joints.hips;
    if (!hips?.parent || !height) return;
    this._target.set(0, height, 0);
    hips.parent.updateWorldMatrix(true, false);
    this._position.setFromMatrixPosition(hips.parent.matrixWorld);
    this._target.add(this._position);
    hips.parent.worldToLocal(this._target);
    hips.position.add(this._target);
  }

  _lowestFoot() {
    let height = Infinity;
    for (const key of ['leftFoot', 'rightFoot']) {
      const foot = this.joints[key];
      if (foot) height = Math.min(height, foot.getWorldPosition(this._position).y);
    }
    return Number.isFinite(height) ? height : null;
  }

  _punch(progress) {
    const weight = smooth(0, .1, progress) * (1 - smooth(.82, 1, progress));
    // El impacto de .22 s en un golpe de .58 s coincide con la extensión máxima.
    const extension = smooth(.29, .22 / .58, progress) * (1 - smooth(.44, .8, progress));
    const windup = smooth(0, .28, progress) * (1 - extension);
    this._rotate('spine', .08 * extension, -.20 * windup + .32 * extension, -.04 * extension, weight);
    this._rotate('head', -.04, -.1 * extension, 0, weight);
    this._aim('leftArm', .17, -.65, .28, weight);
    this._aim('leftForeArm', -.12, .85, .45, weight);
    this._aim('rightArm', -.14, -.18 + extension * .23, .3 + extension * 1.1 - windup * .45, weight);
    this._aim('rightForeArm', .08, .9 * (1 - extension), .35 + extension * 1.1, weight);
  }

  _hit(progress) {
    const recoil = smooth(0, .14, progress) * (1 - smooth(.22, 1, progress));
    this._rotate('spine', -.34, -.1, .07, recoil);
    this._rotate('head', .15, .12, -.1, recoil);
    this._aim('leftArm', .5, -.3, .4, recoil);
    this._aim('rightArm', -.5, -.3, .4, recoil);
    this._aim('leftForeArm', -.05, .8, .5, recoil);
    this._aim('rightForeArm', .05, .8, .5, recoil);
  }

  _swim(speed, weight, movement, dt) {
    const moving = smooth(.08, 1.2, speed);
    const phase = this.time * Math.PI * 2;
    this._rotate('hips', .12 + moving * (this.procedural ? .73 : 1.02), 0, Math.sin(phase) * .035 * moving, weight);
    this._rotate('spine', -.04, 0, 0, weight);
    this._rotate('head', -.08 - moving * .55, 0, 0, weight);
    for (const [side, name] of [[1, 'left'], [-1, 'right']]) {
      const cycle = phase + (side < 0 ? Math.PI : 0);
      const stroke = Math.sin(cycle), lift = Math.cos(cycle);
      // En reposo las manos reman a los lados; al avanzar alternan brazadas.
      const scull = stroke * (1 - moving);
      this._aim(`${name}Arm`, side * (.65 - moving * .3 + scull * .10), -.20 + moving * lift * .65, .24 + moving * stroke * .85, weight);
      this._aim(`${name}ForeArm`, side * (.25 - moving * .35 + scull * .18), -.35 + moving * .15, .65 + moving * stroke * .45, weight);
      this._aim(`${name}UpLeg`, side * .12, -.95 + moving * (.65 + stroke * .12), -.05 - moving * .9 + scull * .12, weight);
      this._aim(`${name}Leg`, side * .04, -.95 + moving * .65, -.05 - moving * (.85 - stroke * .18) - scull * .12, weight);
    }
    const head = this.joints.head;
    if (movement.swimming && head) {
      const surfaceY = finite(movement.surfaceY, (this.frame?.getWorldPosition(this._position).y ?? 0) + 1.05);
      this.swimLift = Math.max(0, surfaceY + .10 - head.getWorldPosition(this._position).y);
    } else this.swimLift *= Math.exp(-14 * dt);
    // Una estatura corta sigue respirando sobre el agua; el controlador físico no se eleva.
    this._raiseHips(this.swimLift);
  }
}
