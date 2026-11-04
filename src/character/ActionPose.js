import { Euler, Quaternion, Vector3 } from 'three';
import { createMeleeOverlay, rotateInFrame } from './melee.js';
import { createSmokeOverlay } from './smoking.js';
import { createBasucoOverlay } from './pipe.js';
import { createPointOverlay } from './pointing.js';
import { SleepPose } from './SleepPose.js';

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
  leftFoot: ['leftfoot'], rightFoot: ['rightfoot'],
  leftHand: ['lefthand'], rightHand: ['righthand']
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
      if (!bone) continue;
      const child = this.joints[CHILD[key]] ?? bone.children.find(object => object.isBone);
      const axis = child?.position.lengthSq() > 1e-8 ? child.position.clone().normalize() : new Vector3(0, procedural ? -1 : 1, 0);
      this.slots.set(key, { bone, axis, quaternion: new Quaternion(), position: new Vector3() });
    }
    this.lod = lod;
    this.procedural = procedural;
    this.sleep = procedural ? null : new SleepPose(bones, this.frame);
    this.active = false;
    this.time = 0;
    this.swimWeight = 0;
    this.swimSpeed = 0;
    this.swimLift = 0;
    this.glance = 0;
    this.greetWeight = 0;
    this.greetTime = 0;
    this.warmWeight = 0;
    this.warmTime = 0;
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
    this.sleep?.restore();
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

  apply(dt, { speed = 0, action = null, actionProgress = 0, movement = {}, attack = null, smoke = null, basuco = null, point = 0, look = 0, hipLow = 0 } = {}) {
    this.restore();
    const elapsed = Math.max(0, finite(dt));
    const swim = movement.swimming === true;
    const airborne = movement.grounded === false && !swim;
    const landing = clamp(finite(movement.landing));
    const punch = action === 'golpear', hit = action === 'recibirGolpe';
    const greet = !this.procedural && action === 'saludo' && !airborne && !swim && !landing && speed < .15;
    this.greetWeight += ((greet ? 1 : 0) - this.greetWeight) * -Math.expm1(-(greet ? 11 : 9) * elapsed);
    if (airborne || swim || landing || (action && action !== 'saludo') || attack || smoke || basuco != null || point || speed >= .15) this.greetWeight = 0;
    if (!greet && this.greetWeight < .001) this.greetWeight = this.greetTime = 0;
    if (this.greetWeight) this.greetTime += elapsed;
    const warm = !this.procedural && action === 'calentarse' && !airborne && !swim && !landing && speed < .15;
    this.warmWeight += ((warm ? 1 : 0) - this.warmWeight) * -Math.expm1(-(warm ? 7 : 6) * elapsed);
    // Andar baja las manos de a poco; otro dueño de las manos las necesita de una vez.
    if (airborne || swim || landing || (action && action !== 'calentarse') || (!warm && (attack || smoke || basuco != null || point))) this.warmWeight = 0;
    if (!warm && this.warmWeight < .001) this.warmWeight = this.warmTime = 0;
    if (this.warmWeight) this.warmTime += elapsed;
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
    const sleeping = action === 'dormir' && !airborne && !swim && !landing && speed < .15;
    if (this.sleep) {
      // Echar a andar no corta la pose: se levanta andando. Saltar, nadar, golpear o fumar sí necesitan el cuerpo de una vez.
      if (!sleeping && (action || airborne || swim || landing || attack || smoke || basuco != null || point)) this.sleep.reset();
      if (sleeping || this.sleep.weight > 0) {
        this.sleep.apply(elapsed, sleeping);
        return;
      }
    }
    this.glance += (finite(look) - this.glance) * -Math.expm1(-16 * elapsed);
    if (handsBlocked) this.glance = 0;
    const gestures = attack || smoke || basuco != null || point > 0 || this.melee?.active || this.smoke?.active || this.pipe?.active || this.point?.active || Math.abs(this.glance) > .002;
    // El LOD mantiene animación barata salvo una reacción de combate visible.
    if (this.lod && !punch && !hit && !gestures && !this.greetWeight && !this.warmWeight) return;
    const swimTarget = swim ? Math.min(3, Math.max(0, finite(speed))) : 0;
    const speedBlend = -Math.expm1(-12 * elapsed);
    // Integrar la velocidad suavizada analíticamente conserva la fase a distintos FPS.
    const speedIntegral = swimTarget * elapsed + (this.swimSpeed - swimTarget) * speedBlend / 12;
    this.swimSpeed += (swimTarget - this.swimSpeed) * speedBlend;
    this.swimWeight += ((swim ? 1 : 0) - this.swimWeight) * -Math.expm1(-14 * elapsed);
    if (!swim && this.swimWeight < .001) this.swimWeight = this.swimLift = 0;
    if (!swim && !this.swimWeight && !airborne && !landing && !punch && !hit && !gestures && !this.greetWeight && !this.warmWeight) return;
    if (action && !punch && !hit && !swim && !gestures && action !== 'saltar' && action !== 'aterrizar' && !this.greetWeight && !this.warmWeight) return;
    this.time += swim || this.swimWeight ? .8 * elapsed + .25 * speedIntegral : elapsed;
    this.frame?.getWorldQuaternion(this._frameQ) ?? this._frameQ.identity();
    for (const slot of this.slots.values()) {
      slot.quaternion.copy(slot.bone.quaternion);
      slot.position.copy(slot.bone.position);
    }
    this.active = true;

    if (this.swimWeight) this._swim(this.swimSpeed, this.swimWeight, movement, elapsed);
    if (!swim && (airborne || landing)) this._jump(movement, airborne, landing, speed);
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
    if (hit) this._hit(clamp(finite(actionProgress)), clamp(finite(hipLow)));
    if (this.greetWeight) this._greet(this.greetWeight);
    if (this.warmWeight) this._warm(this.warmWeight);
  }

  _jump(movement, airborne, landing, speed = 0) {
    const velocity = finite(movement.verticalVelocity);
    const airTime = Math.max(0, finite(movement.airTime, 1));
    const rising = smooth(-.5, 3, velocity);
    const falling = smooth(0, 5, -velocity);
    const weight = airborne ? smooth(0, .09, airTime) : landing;
    const tuck = airborne ? .25 + rising * .55 - falling * .2 : .65;
    const forward = smooth(.2, 4, Math.max(0, finite(speed)));
    const launch = rising * smooth(0, .09, airTime);
    // El suelo queda en la física: solo se articulan piernas/cadera visuales.
    const footY = !airborne ? this._lowestFoot() : null;
    this._rotate('hips', airborne ? .04 + rising * .06 : .14, 0, 0, weight);
    this._rotate('spine', airborne ? -.06 : .13, 0, 0, weight);
    this._rotate('head', -.08, 0, 0, weight);
    for (const [side, name] of [[1, 'left'], [-1, 'right']]) {
      const asymmetry = airborne ? side * (.04 + forward * .11) : 0;
      this._aim(`${name}UpLeg`, side * .09, -.95 + tuck * .5, tuck + asymmetry, weight);
      this._aim(`${name}Leg`, side * .03, -.95 + tuck * .35, -.15 - tuck * .7, weight);
      // Impulso de brazos al despegar, apertura al caer y recogida al apoyar.
      this._aim(`${name}Arm`, side * (.24 + falling * .14), -.55 + launch * .35 + falling * .1, airborne ? .12 + launch * .45 + side * forward * .1 : .38, weight);
      this._aim(`${name}ForeArm`, side * .08, -.5 + launch * .25, .68, weight);
      this._rotate(`${name}Foot`, airborne ? .18 * rising - .12 * falling : -.05, 0, 0, weight);
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

  _greet(weight) {
    const wave = Math.sin(this.greetTime * Math.PI * 3.2);
    // Saludo de mano: hombro estable, pequeño arco de antebrazo y muñeca.
    this._rotate('spine', 0, -.035, .015, weight);
    this._rotate('head', -.035, -.06, -.025, weight);
    this._aim('rightArm', -.65, .50, .12, weight);
    this._aim('rightForeArm', -.08 + wave * .18, .96, .12, weight);
    this._rotate('rightHand', 0, .08, wave * .20, weight);
  }

  _warm(weight) {
    // Las dos manos hacia el calor y los hombros sueltos; el vaivén lento no se confunde con temblar.
    const drift = Math.sin(this.warmTime * 1.7) * .03;
    this._rotate('spine', .07, 0, 0, weight);
    this._rotate('head', .05, 0, 0, weight);
    for (const [side, name] of [[1, 'left'], [-1, 'right']]) {
      // Codos bajos y antebrazos casi planos: con el brazo recto y a la altura del hombro parece guardia de boxeo.
      this._aim(`${name}Arm`, side * .2, -.72, .66, weight);
      this._aim(`${name}ForeArm`, -side * .24, .03 + side * drift, .97, weight);
      this._rotate(`${name}Hand`, -.35, 0, 0, weight);
    }
  }

  _hit(progress, hipLow = 0) {
    const recoil = smooth(0, .10, progress) * (1 - smooth(.22, 1, progress));
    // Con la cadera todavía abajo no hay rodillas que absorban nada: estirarlas subiría el cuerpo de un salto.
    const legs = recoil * .4 * Math.max(0, 1 - hipLow * 4);
    const headLag = smooth(.03, .20, progress) * (1 - smooth(.3, 1, progress));
    const footY = this._lowestFoot();
    // El impacto se reparte entre pelvis, columna y cabeza; las rodillas absorben
    // parte del golpe sin arrastrar el controlador ni hundir los apoyos.
    this._rotate('hips', -.04, -.05, .025, recoil);
    this._rotate('lowerSpine', -.10, -.04, .02, recoil);
    this._rotate('spine', -.21, -.08, .05, recoil);
    this._rotate('head', .13, .10, -.08, headLag);
    for (const [side, name] of [[1, 'left'], [-1, 'right']]) {
      this._aim(`${name}UpLeg`, side * .10, -.92, .23, legs);
      this._aim(`${name}Leg`, 0, -.96, -.22, legs);
      this._aim(`${name}Arm`, side * .42, -.28, .42, recoil);
      this._aim(`${name}ForeArm`, -side * .07, .75, .58, recoil);
    }
    const after = this._lowestFoot();
    if (legs > 0 && footY !== null && after !== null) this._raiseHips(footY - after);
  }

  _swim(speed, weight, movement, dt) {
    const moving = smooth(.08, 1.2, speed);
    const phase = this.time * Math.PI * 2;
    this._rotate('hips', .12 + moving * (this.procedural ? .73 : 1.02), 0, Math.sin(phase) * .07 * moving, weight);
    this._rotate('spine', -.04, 0, -Math.sin(phase) * .025 * moving, weight);
    this._rotate('head', -.08 - moving * .55, 0, 0, weight);
    for (const [side, name] of [[1, 'left'], [-1, 'right']]) {
      const cycle = phase + (side < 0 ? Math.PI : 0);
      const stroke = Math.sin(cycle), lift = Math.cos(cycle);
      const pull = Math.sin(cycle - .45), kick = Math.sin(phase * 2 + (side < 0 ? Math.PI : 0));
      // En reposo las manos reman a los lados; al avanzar alternan brazadas.
      const scull = stroke * (1 - moving);
      this._aim(`${name}Arm`, side * (.65 - moving * .3 + scull * .10), -.20 + moving * lift * .65, .24 + moving * stroke * .85, weight);
      this._aim(`${name}ForeArm`, side * (.25 - moving * .35 + scull * .18), -.35 + moving * (.15 - Math.max(0, lift) * .25), .65 + moving * pull * .45, weight);
      this._aim(`${name}UpLeg`, side * .12, -.95 + moving * (.65 + kick * .10), -.05 - moving * .9 + scull * .12, weight);
      this._aim(`${name}Leg`, side * .04, -.95 + moving * .65, -.05 - moving * (.85 - kick * .17) - scull * .12, weight);
      this._rotate(`${name}Foot`, .16 * moving + kick * .06 * moving, 0, 0, weight);
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
