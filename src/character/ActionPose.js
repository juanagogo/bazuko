import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { createMeleeOverlay, rotateInFrame } from './melee.js';
import { createSmokeOverlay } from './smoking.js';
import { createBasucoOverlay } from './pipe.js';
import { createPointOverlay } from './pointing.js';
import { SleepPose } from './SleepPose.js';
import { HARD_LANDING, JUMP, contactSpeed, hardLanding, hardProfile, landingArms, landingArmsDown, landingDrop, landingDuration, landingGive, pushOffset, recoveryTime, stepVertical, timeToGround } from './jumpMotion.js';
import { criticalSpring, snapSpring, spring } from './springs.js';

const clamp = value => Math.min(1, Math.max(0, value));
const smooth = (from, to, value) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
/** Acerca un vector a (x, y, z) en la fracción `t`, sin crear objetos. */
const mix = (v, x, y, z, t) => {
  if (t > 0) v.set(v.x + (x - v.x) * t, v.y + (y - v.y) * t, v.z + (z - v.z) * t);
  return v;
};
const normalizeName = name => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
const JOINTS = {
  hips: ['hips'], spine: ['spine2', 'spine1', 'spine'], head: ['head'],
  lowerSpine: ['spine'], midSpine: ['spine1'], neck: ['neck'],
  leftArm: ['leftarm'], leftForeArm: ['leftforearm'], rightArm: ['rightarm'], rightForeArm: ['rightforearm'],
  leftUpLeg: ['leftupleg'], leftLeg: ['leftleg'], rightUpLeg: ['rightupleg'], rightLeg: ['rightleg'],
  leftFoot: ['leftfoot'], rightFoot: ['rightfoot'],
  leftHand: ['lefthand'], rightHand: ['righthand']
};
const FEET = ['leftFoot', 'rightFoot'];
// Lo que en el aire sale del suelo de debajo (golpe fuerte, buscar el suelo, caída larga, caída alta, hueco):
// al cruzar un borde, o al pasar de tener suelo a tener agua debajo, cambia de golpe y se suelta con un
// resorte crítico: en ~0,12 s lo que prepara el contacto y en ~0,3 s lo que cambia el estilo de la pose
// (dejar la zancada ante un golpe fuerte o una caída larga, bracear, la mirada), que mueve más los brazos.
const AIR_KEYS = ['hard', 'heavy', 'reach', 'prep', 'fall', 'mill', 'gaze', 'gap'];
// Los que salen de la altura de la caída.
const FALL_KEYS = ['fall', 'mill', 'gaze'];
const fallWeights = (out, height) => {
  out.fall = smooth(1, 1.9, height); out.mill = smooth(2.5, 3.5, height); out.gaze = smooth(1.5, 5, height);
  return out;
};
// Lo que tarda la pose del aire en ceder a la del nado al entrar al agua (s).
const WATER_BLEND = .2;
// Saltando parado, los brazos empiezan a abrirse y bajar con esta velocidad de subida (m/s), ~2 cuadros antes del ápice.
const APEX_LEAD = .45;
const DEG = Math.PI / 180;
// Braceo de una caída alta: vueltas por segundo, radio de cada vuelta, apertura del centro (desde colgando,
// al costado), cuánto más arriba va el antebrazo y el desfase entre la vuelta de un brazo y la del otro.
const WINDMILL = { rate: 2.75, radius: 40 * DEG, open: 70 * DEG, forearm: 30 * DEG, lag: 150 * DEG };
const SMOOTH_OMEGA = 4.7 / .12;
const AIR_OMEGA = { hard: SMOOTH_OMEGA, heavy: 4.7 / .3, reach: SMOOTH_OMEGA, prep: SMOOTH_OMEGA, gap: SMOOTH_OMEGA, fall: 4.7 / .3, mill: 4.7 / .3, gaze: 4.7 / .3 };
// En el aire y al tocar la zancada sale de la que traía al despegar y nunca cambia en un cuadro: si la velocidad cae
// (un choque contra una pared o un carro) se recoge hacia la pose de caída con un resorte de ~0,2 s, sin dejarla
// entera en menos de 0,3 s (`GAIT_DROP` por segundo), y si sube (después del frenazo de un golpe fuerte vuelve a correr)
// la sigue como mucho a `GAIT_RISE` por segundo (de nada a toda en 0,125 s). En el aire la pose es la que eligió el
// despegue: si la velocidad sube (pulsar una dirección después de saltar parado), los primeros `GAIT_AIR_HOLD` s la
// zancada no sube y después lo hace como mucho a `GAIT_RISE_AIR` por segundo; al tocar sigue con `GAIT_RISE`.
const GAIT_OMEGA = 4.7 / .2, GAIT_DROP = 1 / .3, GAIT_RISE = 8, GAIT_RISE_AIR = 2, GAIT_AIR_HOLD = .3;
// Vuelo (s) desde el que el aterrizaje empieza a doblar las piernas y desde el que las dobla del todo.
const SHORT_FLIGHT = [.08, .16];
// Lo que tarda (s) en entrar la flexión de un toque suave.
const SOFT_ENTRY = .07;
// Los pies del aterrizaje se anclan con la raíz a menos de esto (m/s); más rápido, acompañan al cuerpo.
const PIN_SPEED = .5;
// Lo que tarda (s) en salir de la pose de la que despega: la de un aterrizaje (el fondo de una sentadilla) o, en un salto
// de coyote, la del último cuadro en el aire. Desde la sentadilla los brazos van de la mano en el piso al lanzamiento
// del salto parado: más rápido giran ~16° en un cuadro.
const TAKEOFF_BLEND = { landing: .2, air: .15 };
// Huesos que el despegue toma de la pose del aterrizaje (tronco, brazos y piernas de una sentadilla).
const TAKEOFF = ['hips', 'lowerSpine', 'midSpine', 'spine', 'neck', 'head', 'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm',
  'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot'];
// Sentadilla del golpe fuerte: tronco (cadera a cuello) a ~38° de la vertical y la cabeza ~15° adelante.
const SQUAT_TORSO = .66, SQUAT_HEAD = .26;
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
      // La mano apunta al dedo medio (el primer hijo suele ser el pulgar).
      const child = this.joints[CHILD[key]] ?? (/Hand$/.test(key) ? bone.children.find(object => object.isBone && /middle/i.test(object.name)) : null)
        ?? bone.children.find(object => object.isBone);
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
    // Pose con que tocó el suelo: el aterrizaje sale de ella y no del clip.
    this._carry = { hips: 0, spine: 0, lower: 0, twist: 0, head: 0, arms: 0, leftUpper: new Vector3(), leftFore: new Vector3(), rightUpper: new Vector3(), rightFore: new Vector3() };
    // Salto: piernas, IK y puntos de apoyo, reservados una vez, con los nombres de sus huesos (por cuadro
    // no se arma ninguna cadena).
    this._legs = [[1, 'left'], [-1, 'right']].map(([side, name]) => ({
      side, name, foot: this.joints[`${name}Foot`], clip: new Vector3(),
      upLeg: `${name}UpLeg`, lowLeg: `${name}Leg`, footKey: `${name}Foot`, arm: `${name}Arm`, foreArm: `${name}ForeArm`, handKey: `${name}Hand`,
      // Cuánto iba suelta la muñeca en el último cuadro en el aire (el aterrizaje la suelta de a poco) y adónde
      // vuelven brazo y antebrazo al aterrizar (los del clip con el tronco derecho).
      loose: 0, restUpper: new Vector3(), restFore: new Vector3(),
      // Brazo del clip al despegar corriendo (grados: flexión, apertura, codo y giro del antebrazo hacia adentro) y
      // cuánto parece un brazo de correr (un clip sin brazos animados los deja en cruz: ahí no se tocan).
      stride: { flex: 0, open: 0, elbow: 0, inward: 0, weight: 0 },
      hand: this.joints[`${name}Hand`], upper: this._carry[`${name}Upper`], fore: this._carry[`${name}Fore`],
      // Golpe fuerte: dónde quedó el tobillo al tocar (los pies no se mueven hasta levantarse) y la
      // orientación del pie plano, de pie, relativa al personaje.
      pin: new Vector3(), flat: null
    }));
    this._pinned = false;
    // Altura del tobillo sobre el piso de pie, medida una vez en reposo (los clips del aire la cambian). Hasta
    // medirla, la del modelo liviano sale de su pose de reposo (en el marco del cuerpo) y la del completo es ~9 cm.
    this._ankleRest = null;
    this._ankleBind = procedural ? this._bindAnkle() : null;
    // Largo de la pierna (cadera a tobillo) de pie, medido con el tobillo.
    this._legRest = null;
    this._side = new Vector3();
    this._handGoal = new Vector3();
    this._front = this._legs[0];
    this._groundPoint = new Vector3();
    this._forward = new Vector3();
    this._hip = new Vector3();
    this._knee = new Vector3();
    this._ankle = new Vector3();
    this._goal = new Vector3();
    this._reach = new Vector3();
    this._pole = new Vector3();
    this._direction2 = new Vector3();
    this._footQ = new Quaternion();
    this._armQ = new Quaternion();
    this._foreQ = new Quaternion();
    this._armUpper = new Vector3();
    this._armFore = new Vector3();
    this._jumpUpper = new Vector3();
    this._jumpFore = new Vector3();
    this._armPlane = new Vector3();
    this._armInward = new Vector3();
    this._invFrameQ = new Quaternion();
    // Brazo que va delante en el salto parado (1 izquierdo, -1 derecho), decidido al despegar.
    this._leadArm = 1;
    // Brazo que va delante en el salto en carrera: el contrario a la pierna que va a apoyar, decidido al despegar.
    this._strideLead = -1;
    // El pecho se mide por las clavículas (sin ellas, por los hombros): la línea de los hombros también gira con
    // los brazos.
    const clavicles = ['leftshoulder', 'rightshoulder'].map(alias => values.find(bone => normalizeName(bone?.name ?? '').endsWith(alias)) ?? null);
    this._chestPair = clavicles[0] && clavicles[1] ? clavicles : [this.joints.leftArm ?? null, this.joints.rightArm ?? null];
    this._shoulderLine = new Vector3();
    this._shoulderOther = new Vector3();
    this.jumpHipDrop = 0;
    // Aire: suelo de debajo del cuadro anterior y lo que su cambio todavía descuenta de cada peso.
    this._air = { ground: NaN, fallHeight: 0, water: false, rate: 0, slope: 0 };
    for (const key of AIR_KEYS) this._air[key] = spring();
    this._airOut = {}; this._airPred = {}; this._airLast = {};
    this._wasAir = false;
    // Si ya saltó en este vuelo (un salto de coyote, ya en el aire, es otro despegue) y si despegó con los pies en
    // el suelo (si no, no hay empuje desde el piso).
    this._jumpedAir = false; this._planted = true; this._stepSeen = false;
    // Altura del piso del que despegó (el empuje no baja de ahí aunque debajo ya haya un desnivel).
    this._pushGround = 0; this._riseOut = { y: 0, vy: 0 }; this._rampOut = { y: 0, vy: 0 };
    // Zancada del aire y del aterrizaje (0-1), y la velocidad del último cuadro en el piso.
    this._gait = spring(); this._stride = 0; this._groundSpeed = 0;
    // Raíz del cuadro anterior, su velocidad horizontal y dónde estaba al anclar los pies.
    this._rootPrev = new Vector3(); this._rootDelta = new Vector3(); this._rootKnown = false; this._rootSpeed = 0;
    this._pinRoot = new Vector3(); this._release = 1; this._lastT = Infinity;
    // Lo que duró el último vuelo (s): un saltito corto con un toque suave no dobla las piernas al aterrizar.
    this._flight = Infinity;
    // Cuánto anclaje quedaba en el último cuadro del aterrizaje (aturdido o andando, nada): `_settleFeet` sale de ahí.
    this._pinLevel = 0; this._still = 1; this._freeFoot = new Vector3();
    // Cuánto bajó la cadera visible en el cuadro anterior y a qué velocidad: el despegue y el aterrizaje
    // salen de ahí, no del clip.
    this._shift = 0; this._lastDrop = 0; this._dropVel = 0; this._vyPrev = 0;
    this._pushFrom = 0; this._pushFromSpeed = 0; this._pushK = 1; this._takeoffRun = 0;
    this._landOff = spring();
    const takeoff = new Set(TAKEOFF.map(key => this.slots.get(key)).filter(Boolean));
    this._takeoff = [...takeoff].map(slot => ({ slot, quaternion: new Quaternion() }));
    this._takeoffValid = false; this._takeTime = TAKEOFF_BLEND.landing;
    this._runArms = 0;
    // Pose del último cuadro en el aire: al entrar al agua cede a la del nado en `WATER_BLEND` s.
    this._airPose = [...takeoff].map(slot => ({ slot, quaternion: new Quaternion() }));
    this._toWater = 0;
    this._upAxis = new Vector3();
    this._settle = 0;
  }

  /** Fuera del salto (en el piso, nadando): nada del salto anterior queda para el siguiente. */
  _jumpIdle() {
    this._pinned = this._rootKnown = this._wasAir = this._jumpedAir = this._takeoffValid = false;
    this.jumpHipDrop = this._lastDrop = this._dropVel = 0;
    this._release = 1; this._lastT = Infinity; this._flight = Infinity;
    this._air.ground = NaN;
    snapSpring(this._landOff, 0);
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

  apply(dt, { speed = 0, action = null, actionProgress = 0, movement = {}, attack = null, smoke = null, basuco = null, point = 0, look = 0, hipLow = 0, step = 0 } = {}) {
    this.restore();
    const elapsed = Math.max(0, finite(dt));
    const swim = movement.swimming === true;
    const airborne = movement.grounded === false && !swim;
    const landing = clamp(finite(movement.landing));
    if (movement.grounded === true && !swim) this._groundSpeed = Math.max(0, finite(speed));
    if (!airborne && !landing) this._carry.arms = this._carry.hips = this._carry.spine = this._carry.lower = this._carry.twist = this._carry.head = 0;
    if (swim || (!airborne && !landing)) {
      // Al terminar un aterrizaje con los pies anclados y el cuerpo casi quieto, los pies vuelven al clip en
      // ~0,25 s (0,1 s si echa a andar) en vez de en un cuadro.
      if (!swim && this._pinned && this._pinLevel > 0 && movement.grounded === true) this._settle = 1;
      else if (swim || airborne || movement.grounded !== true) this._settle = 0;
      // Entra al agua desde el aire: la pose del último cuadro en el aire se suelta en `WATER_BLEND` s.
      if (swim && this._wasAir) this._toWater = 1;
      this._jumpIdle();
      if (this._settle > 0) this._settle = Math.max(0, this._settle - elapsed / (speed >= .15 ? .1 : .25));
    } else this._settle = 0;
    if (!swim) this._toWater = 0;
    if (this._ankleRest === null && movement.grounded === true && !swim && !landing && !action && speed < .15) this._measureRest();
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
    if (!swim && !this.swimWeight && !airborne && !landing && !punch && !hit && !gestures && !this.greetWeight && !this.warmWeight && !this._settle) return;
    if (action && !punch && !hit && !swim && !gestures && action !== 'saltar' && action !== 'aterrizar' && !this.greetWeight && !this.warmWeight) return;
    this.time += swim || this.swimWeight ? .8 * elapsed + .25 * speedIntegral : elapsed;
    this.frame?.getWorldQuaternion(this._frameQ) ?? this._frameQ.identity();
    for (const slot of this.slots.values()) {
      slot.quaternion.copy(slot.bone.quaternion);
      slot.position.copy(slot.bone.position);
    }
    this.active = true;

    if (this.swimWeight) this._swim(this.swimSpeed, this.swimWeight, movement, elapsed);
    if (this._toWater > 0) {
      // Encima del nado (que entra con su propio peso): la pose con que tocó el agua cede de a poco.
      this._fromPose(this._airPose, smooth(0, 1, this._toWater));
      this._toWater = Math.max(0, this._toWater - elapsed / WATER_BLEND);
    }
    if (!swim && (airborne || landing)) this._jump(movement, airborne, landing, speed, step, elapsed);
    else if (this._settle > 0) this._settleFeet(this._settle);
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

  /**
   * Salto, caída y aterrizaje como función del estado físico, sin mover la raíz física:
   * - `u` = velocidad vertical / impulso: subida estirada, recogida máxima en el ápice y piernas que
   *   buscan el suelo los últimos ~200 ms según el tiempo que falta para tocarlo.
   * - El suelo de debajo puede cambiar de golpe (un borde): lo que eso cambia en los pesos del aire (golpe
   *   fuerte, buscar el suelo, caída larga, hueco) se absorbe y se suelta en ~0,12 s (`_airWeights`). Saltar en el
   *   borde de un desnivel alto, o ya fuera de él (el coyote), es un despegue como cualquiera, que después pasa a la
   *   caída; y un choque en el aire no corta la zancada: se recoge de a poco (`GAIT_OMEGA`).
   * - Empuje: la cadera visible sale de donde estaba (de pie, o desde el fondo de un aterrizaje, con su
   *   velocidad) y alcanza a la raíz en `JUMP.pushCatch` s (curva de Hermite con la posición y la velocidad
   *   del arco al final); mientras, el pie de apoyo sigue en el piso. Parado completo, andando ~60 % y
   *   corriendo nada, y nunca por debajo del suelo que tiene bajo los pies. Tronco y brazos salen de la pose
   *   del aterrizaje si despegó desde uno.
   * - Aterrizaje: la cadera baja y vuelve según el impacto, con los pies plantados (IK de dos huesos).
   *   Brazos y tronco salen de la pose con que tocó el suelo (`_carry`), no del clip: sin saltos. Los pies
   *   se anclan donde están solo con la raíz casi quieta (< 0,5 m/s) y el anclaje cede si la raíz se aleja
   *   5-15 cm o si un golpe lo aturde.
   * - Parado salta con los dos pies; corriendo, la zancada la pone el clip (la fase sigue en el aire y
   *   llega a la pisada de `step` al tocar) y aquí se exagera la rodilla de delante, los brazos siguen la
   *   oposición en el vuelo, el tronco se endereza en el ápice y el pecho gira hacia el brazo de delante. En una caída larga
   *   la zancada se deja: piernas juntas que pedalean y brazos que bracean.
   */
  _jump(movement, airborne, landing, speed = 0, step = 0, dt = 0) {
    const vy = finite(movement.verticalVelocity);
    // Sin impulso informado, un cuerpo que sube saltó con el impulso normal y uno que baja se cayó.
    const launch = movement.launchSpeed === undefined ? (vy > 0 ? JUMP.launchSpeed : 0) : Math.max(0, finite(movement.launchSpeed, 0));
    const jumped = launch > 0;
    const u = Math.max(-1, Math.min(1, vy / (launch || JUMP.launchSpeed)));
    const airTime = Math.max(0, finite(movement.airTime, 1));
    const gap = Math.max(0, finite(movement.groundGap, NaN));
    const knowsGround = Number.isFinite(gap);
    const ttg = Math.max(0, finite(movement.timeToGround, Infinity));
    const fallHeight = Math.max(0, finite(movement.fallHeight));
    const rise = Math.max(0, u), fall = Math.max(0, -u);
    const root = this.frame?.getWorldPosition(this._groundPoint) ?? this._groundPoint.set(0, 0, 0);
    // Velocidad horizontal de la raíz (los pies del aterrizaje solo se anclan con el cuerpo casi quieto).
    const moved = this._rootKnown ? this._rootDelta.subVectors(root, this._rootPrev) : this._rootDelta.set(0, 0, 0);
    if (this._rootKnown && dt > 0) this._rootSpeed = Math.hypot(moved.x, moved.z) / dt;
    this._rootPrev.copy(root); this._rootKnown = true;
    const first = airborne !== this._wasAir;
    // Saltar ya en el aire (el coyote, recién salido de un borde) también es un despegue.
    const takeoff = airborne && jumped && !this._jumpedAir, coyote = takeoff && !first;
    this._wasAir = airborne; this._jumpedAir = airborne && jumped;
    this._shift = 0;
    const air = airborne ? this._airWeights(first, coyote, airTime, vy, gap, knowsGround, ttg, fallHeight, jumped, dt, movement.overWater === true,
      finite(movement.groundRate), finite(movement.groundSlope)) : null;
    const longFall = airborne ? air.fall * smooth(.05, .3, airTime) : 0;
    // Golpe fuerte (desde 10,3 m/s al tocar, completo desde 11,8): en el aire se prevé con la altura que falta; en el suelo es
    // la velocidad con que tocó. Con un golpe fuerte la zancada se deja: cae con las dos piernas.
    const contact = airborne ? 0 : finite(movement.landingSpeed, 4.5 + 5.5 * clamp(finite(movement.landingImpact, .3)));
    const hard = airborne ? air.heavy : hardLanding(contact);
    // Zancada: sale de la del despegue (la velocidad del último cuadro en el piso, si un choque la cortó en el mismo
    // cuadro del salto) y sigue a la velocidad sin saltos, también al tocar: si cae (un choque) se recoge con un
    // resorte (`GAIT_OMEGA`) en vez de desaparecer en el cuadro del golpe.
    const run = first && airborne && jumped ? Math.max(0, finite(speed), this._groundSpeed) : Math.max(0, finite(speed));
    const gaitNow = smooth(1.2, 3.2, run);
    if (airborne && first) snapSpring(this._gait, gaitNow);
    else if (gaitNow > this._gait.x) snapSpring(this._gait, Math.min(gaitNow, this._gait.x + (airborne ? (airTime < GAIT_AIR_HOLD ? 0 : GAIT_RISE_AIR) : GAIT_RISE) * Math.max(0, dt)));
    else criticalSpring(this._gait, gaitNow, GAIT_OMEGA, dt);
    this._stride = airborne && first ? this._gait.x : Math.max(this._gait.x, this._stride - GAIT_DROP * Math.max(0, dt));
    const stride = clamp(this._stride) * (1 - longFall) * (1 - hard);
    const standing = 1 - stride;
    this._forward.set(0, 0, 1).applyQuaternion(this._frameQ);
    this._side.set(1, 0, 0).applyQuaternion(this._frameQ);
    if (airborne) { this._pinned = false; this._release = 1; this._lastT = Infinity; this._flight = airTime; }
    // Pies del clip antes de tocar nada.
    const legs = this._legs, carry = this._carry;
    for (const leg of legs) leg.foot?.getWorldPosition(leg.clip);
    const footY = this._lowestFoot();
    // En el aire, si el paso dejó de decir qué pie va a apoyar (el cuerpo liviano lo calla al frenar contra una
    // pared), sigue el que dijo: cambiar de pie en el aire cambia de golpe qué pierna va adelante.
    if (!airborne || first) this._stepSeen = false;
    if (step) { this._front = step > 0 ? legs[0] : legs[1]; this._stepSeen = airborne; }
    else if (stride > 0 && !this._stepSeen) {
      // Sin fase que lo diga, delante va el pie que el clip lleva más adelante (con 5 cm de margen).
      const other = this._front === legs[0] ? legs[1] : legs[0];
      const lead = this._direction.copy(other.clip).sub(this._front.clip).dot(this._forward);
      if (lead > .05) this._front = other;
    }
    let hipDrop = 0;
    this._hold = 0;

    if (airborne) {
      if (first || takeoff) {
        // Lo que se decide al despegar: la cadera sale de donde estaba y con su velocidad, el desfase con la
        // raíz es completo parado, ~60 % andando y nada corriendo, y si arrancó corriendo los brazos no hacen
        // el lanzamiento del salto parado aunque después deje la zancada (un borde alto). En un salto de coyote los
        // pies ya no pisan nada: no hay empuje desde el piso, y la pose sale de la del último cuadro en el aire
        // (como al saltar desde un aterrizaje), porque todo lo que va por el tiempo de vuelo vuelve a empezar.
        const s = run;
        this._planted = !coyote;
        // Empuja el pie que al despegar está en el piso (corriendo el otro va en el aire del paso).
        for (const leg of legs) leg.pushing = !(leg.clip.y > footY + .04 || leg.clip.y - root.y > .12);
        this._pushFrom = Math.max(0, this._lastDrop);
        this._pushFromSpeed = -this._dropVel;
        this._pushK = coyote ? 0 : 1 - .4 * smooth(.2, 2.4, s) - .6 * smooth(2.8, 4.8, s);
        this._takeoffRun = smooth(1.2, 3.2, s);
        // El piso del despegue: la raíz menos lo que subió en este primer cuadro.
        if (jumped && !coyote) this._pushGround = root.y - stepVertical(this._riseOut, 0, launch, airTime, true).y;
        if (coyote) {
          for (let i = 0; i < this._takeoff.length; i++) this._takeoff[i].quaternion.copy(this._airPose[i].quaternion);
          this._takeoffValid = this._takeoff.length > 0;
        }
        this._takeTime = coyote ? TAKEOFF_BLEND.air : TAKEOFF_BLEND.landing;
        // Va delante el brazo contrario al pie adelantado; con los pies parejos, el que no fue la vez anterior.
        const ahead = this._direction.copy(legs[0].clip).sub(legs[1].clip).dot(this._forward);
        this._leadArm = Math.abs(ahead) > .02 ? (ahead > 0 ? -1 : 1) : -this._leadArm;
        this._strideLead = -this._front.side;
        for (const leg of legs) this._clipArm(leg);
      }
      // Los tiempos del despegue (cuándo entran brazos y piernas, la agachada y el empuje) son los de cómo despegó: un
      // choque en pleno empuje recoge la zancada, pero no vuelve a empezar el despegue.
      const stood = jumped ? 1 - this._takeoffRun : standing;
      // Los brazos entran primero (lideran el despegue); tronco y piernas detrás.
      const arms = jumped ? smooth(0, .14 - .11 * stood, airTime) : smooth(0, .2, airTime);
      const trunk = smooth(jumped ? .02 : 0, jumped ? .18 : .22, airTime);
      // Parado las piernas se recogen después del empuje (se agacha y se estira antes); en carrera, enseguida.
      const legsIn = jumped ? smooth(.03 + .08 * stood, .16 + .09 * stood, airTime) : smooth(0, .22, airTime);
      const pushed = jumped ? smooth(0, JUMP.pushTime, airTime) : 1;
      // Recogida: nada al despegar, máxima en el ápice; al caer se suelta y las piernas buscan el suelo.
      const tuckAir = jumped ? (u >= 0 ? smooth(.92, .2, u) : 1 - .45 * smooth(0, .8, fall)) : (.3 + .25 * longFall) * smooth(0, .15, airTime);
      // Buscar el suelo: la pose del aire cede al clip, que en la pisada ya tiene el pie abajo.
      const reach = air.reach;
      // Golpe fuerte: los últimos ~0,2 s las piernas se juntan bajo la cadera con las rodillas un poco dobladas.
      const prep = air.hard * air.prep;
      const tuck = tuckAir * pushed;
      // Caída: desde los ~6 m/s (en ~0,2 s) los brazos se abren al costado. En una caída alta (más de ~3 m) es
      // el movimiento principal: cada brazo da vueltas alrededor de esa apertura y las piernas pedalean al mismo
      // ritmo. Cede al prepararse para tocar el suelo; sobre agua sigue hasta entrar.
      const flail = smooth(6, 10.6, -vy) * (1 - Math.max(reach, prep));
      const windmill = flail * air.mill;
      const cycle = airTime * WINDMILL.rate * 2 * Math.PI;
      // Manos arriba del salto sin zancada; si despegó corriendo y la deja (un borde alto, un choque) no suben.
      const armUp = jumped ? smooth(-.035, .09, airTime) * smooth(-.15, .55, u) * (1 - this._takeoffRun) : 0;
      const hips = (.03 + .07 * tuck - .05 * rise * pushed) * standing;
      // Corriendo: el pecho se abre ~5° al subir y el tronco va adelante antes de tocar.
      const spine = (-.07 * rise * pushed + .1 * tuck + .06 * reach) * standing + (.05 - .09 * rise * pushed + .08 * reach) * stride;
      // Avance del vuelo: 0 al despegar, ½ en el ápice y 1 al volver a la altura de partida; y cuánto es un salto
      // en carrera (despegó corriendo y sigue con la zancada).
      const q = clamp((1 - u) / 2), running = jumped ? stride * this._takeoffRun : 0;
      // Saltando corriendo el tronco, que sale 6-8° adelante con el clip, se endereza desde la cintura hasta quedar casi
      // vertical en el ápice y vuelve 3-5° adelante para recibir.
      const lower = (-.11 * smooth(0, .5, q) + .07 * smooth(.5, 1, q)) * running;
      // Mirada (positivo = hacia abajo, en el mundo): parado sube con el mentón un poco arriba; al caer mira
      // dónde va a apoyar, 10-15° y hasta 25° en una caída alta. El cuello descuenta la inclinación del tronco.
      const falling = jumped ? fall : smooth(0, .2, airTime) * smooth(.5, 3, -vy);
      const gaze = -.07 * rise * pushed * standing + falling * (.2 + .24 * air.gaze) * (1 - .5 * prep);
      const head = gaze - .85 * (hips + spine + lower);
      this._rotate('hips', hips, 0, 0, trunk);
      if (lower) this._rotate('lowerSpine', lower, 0, 0, trunk);
      this._rotate('spine', spine, 0, 0, trunk);
      this._rotate('head', head, 0, 0, trunk);
      carry.hips = hips * trunk; carry.spine = spine * trunk; carry.lower = lower * trunk; carry.head = head * trunk;
      // Saltando corriendo el pecho gira 5-8° hacia el brazo que va delante (el clip de correr lo lleva a ~25°), más
      // cuanto más arriba va ese brazo; la cabeza sigue al frente. Al tocar, el aterrizaje sale de ese giro.
      carry.twist = 0;
      if (running > 0) {
        const yaw = this._chestYaw();
        if (Number.isFinite(yaw)) {
          const want = this._strideLead * (5 + 3 * (1 - smooth(.22, 1, q))) * DEG;
          carry.twist = (yaw - want) * running * trunk;
          this._rotate('spine', 0, carry.twist, 0, 1);
          this._rotate('head', 0, -carry.twist, 0, 1);
        }
      }
      // Despegue parado: los primeros ~55 ms se agacha (cadera abajo, tronco 8-10° adelante, pies en el piso).
      const crouchLean = jumped ? stood * smooth(0, JUMP.crouchTime, airTime) * (1 - smooth(JUMP.crouchTime, JUMP.crouchTime + .08, airTime)) : 0;
      if (crouchLean > 0) {
        this._rotate('hips', .06 * crouchLean, 0, 0, 1);
        this._rotate('spine', .1 * crouchLean, 0, 0, 1);
        this._rotate('head', -.12 * crouchLean, 0, 0, 1);
      }
      // Parado: muslos atrás y rodillas sueltas al subir, rodillas al pecho en el ápice; al buscar el
      // suelo la pose cede al clip, que es la pose con que se aterriza. En una caída larga pedalean.
      const legW = standing * legsIn * (1 - reach);
      for (const leg of legs) {
        const side = leg.side, calm = flail - windmill;
        const pedal = calm ? .14 * calm * Math.sin(airTime * 7 + (side > 0 ? 0 : Math.PI)) : 0;
        // Desparejas: la izquierda más recogida que la derecha.
        const odd = calm * (side > 0 ? .16 : -.1);
        let thigh = -.06 + 1.12 * tuck + pedal + odd, knee = .22 + 1.6 * tuck + Math.max(0, pedal) + 1.4 * odd;
        if (windmill > 0) {
          // Pedalean: rodillas de 15° a 35° al ritmo de los brazos, una contra la otra; el muslo acompaña.
          const p = cycle + (side > 0 ? 0 : Math.PI);
          thigh += (.3 + .12 * Math.sin(p + .6) - thigh) * windmill;
          knee += (.44 + .17 * Math.sin(p) - knee) * windmill;
        }
        this._aim(leg.upLeg, side * .09, -Math.cos(thigh), Math.sin(thigh), legW);
        this._aim(leg.lowLeg, side * .03, -Math.cos(thigh - knee), Math.sin(thigh - knee), legW);
        this._rotate(leg.footKey, (.3 * rise * pushed + .1 * tuck) * standing, 0, 0, legsIn * (1 - reach));
        if (prep > 0) {
          // Muslo 10° adelante y rodilla 20°, juntas; el pie queda plano para apoyar entero.
          this._aim(leg.upLeg, side * .05, -Math.cos(.17), Math.sin(.17), prep);
          this._aim(leg.lowLeg, side * .03, -Math.cos(-.17), Math.sin(-.17), prep);
          this._footFlat(leg, prep);
        }
      }
      if (stride > 0) {
        // Saltando corriendo la zancada se abre durante toda la subida y del todo en el ápice; al caer la rodilla de
        // atrás se dobla hasta la del clip al tocar (~13° más) y el muslo de delante baja buscando el suelo.
        const open = jumped ? (u >= 0 ? smooth(.92, 0, u) : 1 - .45 * smooth(0, .8, fall)) : tuckAir;
        this._strideAir(open * pushed * (1 - reach), stride * legsIn, jumped ? .23 * smooth(0, 1, fall) : 0);
      }
      // Brazos, siempre con el codo doblado: adelante y arriba al despegar, al pecho en el ápice,
      // abiertos al caer (bracean si la caída es larga) y adelante-abajo al buscar el suelo. Corriendo
      // se abren un poco sobre el braceo del clip y, si saltó, siguen la oposición en el vuelo (`_strideArms`):
      // entran en 0,1 s y ceden al clip al buscar el suelo.
      const upper = this._armUpper, fore = this._armFore;
      const standArms = jumped ? Math.min(standing, 1 - this._takeoffRun) : 0;
      // Si en el aire deja la zancada (un borde alto: caída larga o golpe fuerte), salen en no menos de 0,3 s.
      this._runArms = first || takeoff ? running : Math.max(running, this._runArms - Math.max(0, dt) / .3);
      const runArms = this._runArms * smooth(0, .1, airTime) * (1 - reach);
      for (const leg of legs) {
        const s = leg.side;
        upper.set(s * (.35 - .15 * armUp), -.6 + .95 * armUp, .72 + .18 * armUp);
        fore.set(s * (.02 + .03 * armUp), .62 + .18 * armUp, .78 - .23 * armUp);
        const open = jumped ? fall : smooth(0, .25, airTime);
        mix(upper, s * .8, -.3, .45, open); mix(fore, s * .4, .45, .8, open);
        if (standArms > 0) {
          // Parado: contragolpe atrás, lanzamiento adelante-arriba, freno al pecho y apertura al caer.
          const up = this._jumpUpper, lo = this._jumpFore;
          this._standingArms(s, airTime, u, vy, up, lo);
          mix(upper, up.x, up.y, up.z, standArms); mix(fore, lo.x, lo.y, lo.z, standArms);
        }
        if (flail) {
          // Abiertos ~70° al costado; en una caída alta cada uno da vueltas de ~40° de radio hacia delante (arriba
          // va hacia delante), desfasados ~150° entre sí, y el antebrazo sigue la vuelta un poco tarde.
          const a = cycle + (s > 0 ? 0 : WINDMILL.lag), r = WINDMILL.radius * air.mill;
          const up = this._jumpUpper, lo = this._jumpFore;
          this._windmillArm(s, WINDMILL.open, r, a, up);
          this._windmillArm(s, WINDMILL.open + WINDMILL.forearm, r, a - .6, lo);
          mix(upper, up.x, up.y, up.z, flail); mix(fore, lo.x, lo.y, lo.z, flail);
        }
        // Al buscar el suelo van adelante y abajo; saltando parado no (se abren al caer y bajan al tocar).
        const toGround = reach * (1 - (jumped ? Math.max(standArms, .7 * standing) : 0));
        mix(upper, s * .4, -.75, .5, toGround); mix(fore, s * .15, -.05, .99, toGround);
        // Golpe fuerte: las manos van adelante y abajo, listas para apoyarse en el piso.
        mix(upper, s * .25, -.6, .76, prep); mix(fore, s * .1, -.75, .65, prep);
        mix(upper, s * .75, -.45, .3, stride); mix(fore, s * .45, .1, .85, stride);
        let w = Math.max(arms * (1 - .7 * stride), flail, prep);
        if (runArms > 0 && leg.stride.weight > 0) {
          const up = this._jumpUpper, lo = this._jumpFore;
          this._strideArms(leg, q, up, lo);
          const run = runArms * leg.stride.weight, both = w + run - w * run, k = run / both;
          upper.normalize(); fore.normalize();
          mix(upper, up.x, up.y, up.z, k); mix(fore, lo.x, lo.y, lo.z, k);
          w = both;
        }
        this._aim(leg.arm, upper.x, upper.y, upper.z, w);
        this._aim(leg.foreArm, fore.x, fore.y, fore.z, w);
        // Saltando parado, al caer las muñecas van sueltas: la mano cae ~25° respecto del antebrazo.
        leg.loose = w * standArms * clamp(-vy / JUMP.launchSpeed);
        if (leg.loose > 0) this._looseHand(leg, fore, leg.loose);
        leg.upper.copy(upper); leg.fore.copy(fore);
        carry.arms = w;
      }
      // Despegue desde un aterrizaje (el fondo de una sentadilla): tronco, brazos y piernas salen de esa pose en 0,2 s; en un
      // salto de coyote, de la del último cuadro en el aire en 0,15 s.
      const take = this._takeoffValid ? 1 - smooth(0, this._takeTime, airTime) : 0;
      if (take > 0) this._fromPose(this._takeoff, take);
      else this._takeoffValid = false;
      const catchTime = JUMP.pushCatch + (JUMP.standCatch - JUMP.pushCatch) * stood;
      // Desde más abajo tarda un poco más en alcanzar a la raíz (0,04 s por cada 10 cm): la cadera visible
      // nunca va más rápido que el impulso.
      const from = this._pushFrom, k = this._pushK, reachTime = catchTime + .4 * from;
      if (jumped && this._planted && knowsGround && airTime < reachTime) {
        // Empuje: la cadera queda abajo lo que la raíz se adelantó; el pie de apoyo sigue en el piso
        // con el talón levantado y se suelta cuando la pierna ya no da más. Parado, primero se agacha
        // (~5 cm en 55 ms) y se estira de golpe: cadera, rodilla y tobillo, el talón antes que la punta.
        // Desde una sentadilla no se agacha más: se estira desde abajo.
        const push = pushOffset(airTime, JUMP.launchSpeed, Math.max(0, JUMP.crouch * stood - from), reachTime, from, this._pushFromSpeed);
        hipDrop = k * push + (1 - k) * from * (1 - smooth(0, reachTime, airTime));
        // Nunca por debajo del suelo que tiene bajo los pies (un escalón alto delante).
        // Y el pie empuja desde el piso del despegue, no desde el de un desnivel que ya tiene debajo (saltar en el borde).
        const floor = Math.min(air.gap, root.y - this._pushGround + .05);
        hipDrop = Math.min(hipDrop, floor + JUMP.crouch * stood + from);
        this._raiseHips(-hipDrop);
        // Parado el talón sube cuando empieza a estirarse y el pie se suelta en ~40 ms (por tiempo: la
        // cadera visible sube a ~6 m/s y por altura el pie saltaría en un cuadro).
        const lift = floor - hipDrop;
        const plant = ((1 - smooth(.035, .11, airTime)) * (1 - stood) + (1 - smooth(.095, .15, airTime)) * stood) * Math.max(k, Math.min(1, from / JUMP.crouch));
        const heel = Math.min(.06, .7 * Math.max(0, lift)) * (1 - stood) + .06 * smooth(.06, .11, airTime) * stood;
        for (const leg of legs) {
          // Solo el pie que estaba en el piso al despegar, y hasta que el empuje lo suelte: si el clip lo levanta
          // antes (al saltar desde el fondo de un aterrizaje), no se va con él de un cuadro al siguiente.
          if (!leg.pushing) continue;
          // La pierna se suelta junto con el pie: si el IK siguiera girándola entera hasta el último cuadro del
          // empuje (con la meta ya fuera de alcance va estirada), la recogida del aire entraría de una vez.
          this._legTo(leg, leg.clip.y - floor + heel, plant, Math.asin(Math.min(.9, heel / .14)), null, plant, smooth(0, .35, plant));
        }
      } else if (from > 0 && airTime < .15) {
        // Se cae (sin saltar) desde un aterrizaje: la cadera vuelve a la raíz en 0,15 s.
        hipDrop = from * (1 - smooth(0, .15, airTime));
        this._raiseHips(-hipDrop);
      }
    } else {
      // Aterrizaje: la cadera sigue bajando con la velocidad del golpe, frena y vuelve; más fondo y más
      // tiempo cuanto más fuerte fue. Corriendo se absorbe sobre el pie de apoyo y se dobla menos.
      const impact = Math.min(1, Math.max(0, finite(movement.landingImpact, .3)));
      const total = recoveryTime(impact);
      const t = Math.max(0, finite(movement.landingTime, (1 - landing) * total));
      // Otro aterrizaje sin pasar por el aire (no debería pasar): los pies se vuelven a anclar.
      if (t < this._lastT - 1e-6) this._pinned = false;
      this._lastT = t;
      // Todo lo del golpe fuerte llega a cero cuando termina el aterrizaje, que con un golpe a medias es antes.
      const dur = landingDuration(contact);
      const hardW = hard * (1 - smooth(.8 * dur, dur, t));
      // Corriendo se absorbe menos; un toque suave (menos de 4,5 m/s contra el piso) en proporción, y tras un vuelo
      // de menos de ~0,12 s (bajar un bordillo, subir una rampa al vuelo) nada: sigue el paso. Lo poco que dobla un
      // toque suave no tiene golpe que lo meta de una vez: entra en ~4 cuadros (`SOFT_ENTRY`).
      const soft = landingGive(contact) * smooth(SHORT_FLIGHT[0], SHORT_FLIGHT[1], this._flight);
      const give = soft * (soft + (1 - soft) * smooth(0, SOFT_ENTRY, t));
      const absorb = (1 - .45 * stride) * give;
      // Golpe fuerte: sentadilla de 25-35 cm con la cadera atrás, se queda abajo ~0,12 s con el tronco a
      // ~38° y la cabeza al frente, una mano en la rodilla y la otra hacia el piso, y se levanta en ~0,6 s con
      // un rebote pequeño. Entre medio y fuerte se mezcla sin saltos.
      const squat = hardW ? hardProfile(t) * hardW : 0;
      // El fondo está pensado para una pierna de ~0,85 m: con piernas más cortas baja en proporción.
      const legScale = this._legRest ? Math.min(1, this._legRest / HARD_LANDING.leg) : 1;
      hipDrop = landingDrop(t, impact) * absorb * (1 - hard) + HARD_LANDING.depth * legScale * squat;
      // Si tocó en pleno empuje o subió de golpe a un escalón (la raíz salta arriba más de lo que llevaba),
      // la cadera visible sale de donde iba y alcanza a la raíz en ~0,12 s. En una rampa lo que llevaba es también
      // lo que sube el piso: la raíz que sigue a la rampa no es un escalón.
      const rest = root.y + this._restAnkle();
      if (first) {
        const snap = Math.max(0, moved.y - Math.max(0, this._vyPrev, finite(movement.groundRate)) * dt);
        // Golpe fuerte: con las piernas juntas (rodilla a 20°) y la cadera a la altura de pie un tobillo puede no
        // llegar al piso (el cuerpo va un poco ladeado); la cadera baja lo que falta desde el contacto en vez de
        // estirar esa rodilla en un cuadro.
        const short = hardW > 0 ? hardW * this._holdGap(rest) : 0;
        snapSpring(this._landOff, (Math.abs(this._lastDrop) > .01 ? this._lastDrop - hipDrop : 0) + snap + short);
      }
      hipDrop += criticalSpring(this._landOff, 0, SMOOTH_OMEGA, dt);
      const drop = landingArms(t, impact) * (.4 + .6 * impact) * give;
      const lean = landingDrop(t, impact) * absorb / .25 * (1 - hard), left = 1 - smooth(0, .16, t);
      // Los brazos vuelven a colgar como en el clip, no inclinados con el tronco: se miden antes de inclinarlo.
      for (const leg of legs) { this._clipDirection(leg.arm, leg.restUpper); this._clipDirection(leg.foreArm, leg.restFore); }
      this._rotate('hips', carry.hips * left + .28 * lean, 0, 0, 1);
      if (carry.lower) this._rotate('lowerSpine', carry.lower * left, 0, 0, 1);
      this._rotate('spine', carry.spine * left + .34 * lean + .05 * drop, 0, 0, 1);
      // El cuello compensa el tronco: la cabeza mira adelante.
      // La mirada vuelve al frente ~80 ms después de tocar.
      this._rotate('head', carry.head * (1 - smooth(0, .08, t)) - .22 * lean, 0, 0, 1);
      // El giro del pecho del salto en carrera se suelta con el tronco; la cabeza sigue al frente.
      if (carry.twist) { this._rotate('spine', 0, carry.twist * left, 0, 1); this._rotate('head', 0, -carry.twist * left, 0, 1); }
      if (squat > 0) this._squat(squat);
      this._raiseHips(-hipDrop);
      if (squat > 0) this._shiftHips(-this._forward.x * HARD_LANDING.back * legScale * squat, 0, -this._forward.z * HARD_LANDING.back * legScale * squat);
      const support = Math.min(legs[0].clip.y, legs[1].clip.y);
      const down = HARD_LANDING.fall + HARD_LANDING.hold;
      const hold = this._hold = hardW * (1 - smooth(down, down + .3, t));
      // Anclaje: con el cuerpo casi quieto (raíz a menos de ~0,5 m/s) los pies se quedan donde tocaron, y
      // ceden si la raíz se aleja 5-15 cm de ese punto o si un golpe lo aturde. Andando o corriendo el pie de
      // apoyo ya va plantado en el clip: no se ancla. En el patinazo de un golpe fuerte (piernas juntas) los
      // pies van con el cuerpo. Al terminar el aterrizaje se sueltan de a poco (`_settleFeet`).
      // Al echar a andar el anclaje se suelta en no menos de 0,1 s (el clip puede llevar el pie a 10 cm).
      const capture = !this._pinned, slow = 1 - smooth(PIN_SPEED - .2, PIN_SPEED + .2, this._rootSpeed);
      const still = this._still = capture ? slow : Math.max(slow, this._still - (dt > 0 ? dt : 0) / .1);
      const carried = capture ? 0 : (1 - still) * hold;
      if (capture) this._pinRoot.copy(root);
      else if (carried > 0) { this._pinRoot.x += moved.x * carried; this._pinRoot.z += moved.z * carried; }
      if (movement.stunned === true) this._release = Math.max(0, this._release - (dt > 0 ? dt : 0) / .1);
      const away = Math.hypot(root.x - this._pinRoot.x, root.z - this._pinRoot.z);
      this._pinLevel = this._release * still;
      const pinW = (1 - smooth(.05, .15, away)) * this._release * Math.max(hold, still);
      for (const leg of legs) {
        if (hold > 0) {
          // Las dos piernas juntas bajo la cadera, como cayó, con el pie plano en el piso.
          this._aim(leg.upLeg, leg.side * .05, -Math.cos(.17), Math.sin(.17), hold);
          this._aim(leg.lowLeg, leg.side * .03, -Math.cos(-.17), Math.sin(-.17), hold);
        }
        if (capture && leg.foot) leg.foot.getWorldPosition(leg.pin);
        else if (carried > 0) { leg.pin.x += moved.x * carried; leg.pin.z += moved.z * carried; }
        if (hold > 0) this._footFlat(leg, hold);
        // El pie de apoyo va donde lo pone el clip (la inclinación y la bajada del aterrizaje no lo arrastran)
        // y, si hay anclaje, donde tocó; con las piernas juntas del golpe fuerte, donde lo dejan. El que el clip
        // levanta para dar el paso se suelta mientras sube de 2 a 6 cm, no de golpe, y después sigue su paso.
        const lifted = smooth(.02, .06, leg.clip.y - support);
        if (hold <= 0 && lifted >= 1) continue;
        const own = (1 - hold) * (1 - lifted), w = pinW * (hold + own);
        const free = leg.foot ? leg.foot.getWorldPosition(this._freeFoot).lerp(leg.clip, own) : this._freeFoot.copy(leg.clip);
        free.x += (leg.pin.x - free.x) * w; free.z += (leg.pin.z - free.z) * w;
        this._legTo(leg, leg.clip.y + (rest - leg.clip.y) * hold, hold + own, 0, free, 1);
      }
      this._pinned = true;
      // Los brazos siguen bajando, rebotan y vuelven al clip; con un golpe fuerte una mano baja hacia el piso.
      const settle = carry.arms * (1 - smooth(.55 * total, total, t));
      const hand = smooth(.62, .95, impact) * smooth(0, .1, t) * (1 - smooth(.55 * total, total, t)) * (1 - hard);
      const upper = this._armUpper, fore = this._armFore;
      for (const leg of legs) {
        // Siguen bajando desde el contacto hasta colgar como en el clip, se pasan ~10 % ~0,1 s después de que
        // la cadera toque fondo y se asientan (ζ = 0,6); el brazo que no iba delante, 30 ms después.
        const lower = landingArmsDown(t - (leg.side === this._leadArm ? 0 : .03), total);
        const { restUpper, restFore } = leg;
        upper.copy(leg.upper); fore.copy(leg.fore);
        mix(upper, restUpper.x, restUpper.y, restUpper.z, lower); mix(fore, restFore.x, restFore.y, restFore.z, lower);
        let w = settle * (1 - hard);
        if (leg.side < 0 && hand > 0) {
          mix(upper, -.12, -.75, .55, hand); mix(fore, -.05, -.85, .4, hand);
          w = Math.max(w, hand);
        }
        if (w > 0 && upper.lengthSq() > 1e-6) {
          this._aim(leg.arm, upper.x, upper.y, upper.z, w);
          this._aim(leg.foreArm, fore.x, fore.y, fore.z, w);
          // La muñeca suelta de la caída se recoge mientras los brazos bajan.
          if (leg.loose > 0) this._looseHand(leg, fore, w * leg.loose * (1 - smooth(0, 1, lower)));
        }
        if (hardW > 0) {
          // Golpe fuerte: la derecha baja hacia el piso ~35 cm delante de los pies y, 50 ms después, la
          // izquierda se apoya en el muslo, encima de la rodilla.
          const late = leg.side > 0 ? .05 : 0;
          const reachW = hardW * smooth(late, late + .11, t) * (1 - smooth(down + late, down + late + .3, t));
          const keep = hardW * (1 - smooth(down + .2, down + .5, t));
          const goal = this._handGoal;
          if (leg.side > 0) {
            const knee = this.slots.get(leg.lowLeg)?.bone, thigh = this.slots.get(leg.upLeg)?.bone;
            if (!knee || !thigh) continue;
            knee.getWorldPosition(goal).lerp(thigh.getWorldPosition(this._target), .25);
            goal.y += .06;
            goal.addScaledVector(this._forward, .04);
          } else {
            goal.copy(legs[0].pin).add(legs[1].pin).multiplyScalar(.5).addScaledVector(this._forward, .35)
              .addScaledVector(this._side, -.17);
            goal.y = root.y + .05;
          }
          // Mientras no llega, el brazo sale de la pose con que tocó.
          // El brazo ya fue `w` hacia esa pose arriba: el peso es de lo que falta, o con un golpe a medias quedaría
          // a mitad de camino en el cuadro del contacto.
          if (keep > reachW && leg.upper.lengthSq() > 1e-6) {
            const back = w < 1 ? Math.min(1, (keep - reachW) / (1 - w)) : 1;
            this._aim(leg.arm, leg.upper.x, leg.upper.y, leg.upper.z, back);
            this._aim(leg.foreArm, leg.fore.x, leg.fore.y, leg.fore.z, back);
          }
          this._armTo(leg, goal, reachW);
        }
      }
    }
    if (!airborne) {
      // El apoyo queda donde estaba: nada se hunde ni flota por la pose. En un golpe fuerte los pies ya
      // están clavados en el piso (el clip del aire todavía los lleva arriba).
      const after = this._lowestFoot();
      if (after !== null && footY !== null) this._raiseHips((footY - after) * (1 - this._hold));
      this._saveTakeoff();
    } else for (const entry of this._airPose) entry.quaternion.copy(entry.slot.bone.quaternion);
    // Cuánto bajó la cadera visible este cuadro (la sombra de contacto y el próximo despegue salen de ahí).
    const shown = this._shift ? -this._shift : 0;
    if (dt > 0) this._dropVel = (shown - this._lastDrop) / dt;
    this._lastDrop = shown;
    this._vyPrev = vy;
    this.jumpHipDrop = shown;
  }

  /**
   * Pesos del aire que salen del suelo de debajo. Si ese suelo cambió desde el cuadro anterior (se cruzó
   * un borde), la diferencia entre el peso con el suelo nuevo y con el viejo pasa a un resorte crítico que la
   * suelta en ~0,12 s: el peso se mueve con el tiempo y nunca de golpe. Lo mismo al despegar: el golpe fuerte
   * previsto sale de cero (en el piso no lo había) aunque debajo ya haya un desnivel alto (saltar en el borde),
   * y en un salto de coyote todos los pesos siguen desde los del cuadro anterior. Si la pose empieza ya en pleno
   * vuelo (no venía del piso), no hay de dónde seguir: entran como están. Saltando, el golpe fuerte no se prevé
   * mientras los brazos impulsan (entra de 0,1 a 0,3 s de vuelo): un salto en el borde de un desnivel alto empieza
   * como cualquiera y después pasa a la caída. Una rampa (`rate` m/s de subida del piso, `slope` por metro) no es un
   * borde: el suelo que se esperaba es el del cuadro anterior más lo que venía subiendo, y solo lo que se sale de
   * eso (un borde, el quiebre donde empieza o acaba la rampa) pasa por el resorte. Cuesta abajo el piso se aleja y la
   * altura de la caída crece: los pesos que salen de ella entran con el mismo resorte.
   */
  _airWeights(first, coyote, airTime, vy, gap, known, ttg, fallHeight, floaty, dt, water = false, rate = 0, slope = 0) {
    const push = floaty ? smooth(.1, .3, airTime) : 1;
    const state = this._air, out = this._airRaw(this._airOut, vy, known, gap, ttg, fallHeight, water, push, rate, slope, floaty), last = this._airLast;
    const ground = known ? this._groundPoint.y - gap : NaN;
    const lift = first && airTime < .2;
    if (first) for (const key of AIR_KEYS) snapSpring(state[key], lift && (key === 'hard' || key === 'heavy') ? -out[key] : 0);
    else if (coyote) for (const key of AIR_KEYS) state[key].x = finite(last[key], out[key]) - out[key];
    else {
      // Suelo que tocaba aquí según el del cuadro anterior y lo que venía subiendo: en una rampa pareja es el mismo.
      const was = Number.isFinite(state.ground), expected = was ? state.ground + state.rate * dt : NaN;
      const broke = was !== known || state.water !== water
        || (known && (Math.abs(ground - expected) > 1e-4 || Math.abs(rate - state.rate) > 1e-3));
      if (broke || (known && Math.abs(ground - state.ground) > 1e-4)) {
        const before = this._groundPoint.y - expected, height = known && was ? fallHeight + ground - state.ground : state.fallHeight;
        const pred = broke ? this._airRaw(this._airPred, vy, was, before, was ? timeToGround(before, vy, floaty, state.rate) : Infinity,
          height, state.water, push, state.rate, state.slope, floaty) : fallWeights(this._airPred, height);
        for (const key of broke ? AIR_KEYS : FALL_KEYS) state[key].x += pred[key] - out[key];
        if (!(was && known)) snapSpring(state.gap, 0);
      }
    }
    state.ground = ground; state.fallHeight = fallHeight; state.water = water; state.rate = known ? rate : 0; state.slope = known ? slope : 0;
    for (const key of AIR_KEYS) {
      const value = out[key] + criticalSpring(state[key], 0, AIR_OMEGA[key], dt);
      last[key] = out[key] = key === 'gap' ? Math.max(0, value) : clamp(value);
    }
    return out;
  }

  /**
   * Pesos del aire con este suelo debajo. Sobre agua honda no hay golpe ni se busca el suelo: se entra nadando.
   * `push` (0-1) es cuánto del golpe fuerte se prevé ya. Sobre una rampa el golpe es la velocidad contra el piso
   * al tocarlo, como lo mide el jugador.
   */
  _airRaw(out, vy, known, gap, ttg, fallHeight, water = false, push = 1, rate = 0, slope = 0, floaty = true) {
    const ground = known && !water;
    const hit = !ground ? 0 : rate && Number.isFinite(ttg)
      ? Math.max(0, (rate - stepVertical(this._rampOut, 0, vy, ttg, floaty).vy) / Math.hypot(1, slope)) : contactSpeed(vy, gap);
    out.hard = out.heavy = ground ? hardLanding(hit) * push : 0;
    out.reach = ground ? 1 - smooth(.04, .26, ttg) : 0;
    out.prep = ground ? 1 - smooth(.03, .2, ttg) : 0;
    fallWeights(out, fallHeight);
    out.gap = known ? Math.max(0, gap) : 0;
    return out;
  }

  /**
   * Después del aterrizaje: los pies que quedaron anclados vuelven al clip con el peso `weight` (de 1 a 0 en
   * ~0,25 s) por el anclaje que quedaba al terminar (`_pinLevel`), y ceden antes si la raíz se aleja 5-15 cm.
   * El que el clip levanta para dar un paso va libre.
   */
  _settleFeet(weight) {
    const root = this.frame?.getWorldPosition(this._groundPoint) ?? this._groundPoint.set(0, 0, 0);
    const w = smooth(0, 1, weight) * this._pinLevel * (1 - smooth(.05, .15, Math.hypot(root.x - this._pinRoot.x, root.z - this._pinRoot.z)));
    if (!(w > 0)) return;
    this._forward.set(0, 0, 1).applyQuaternion(this._frameQ);
    const legs = this._legs;
    for (const leg of legs) leg.foot?.getWorldPosition(leg.clip);
    const footY = this._lowestFoot(), support = Math.min(legs[0].clip.y, legs[1].clip.y);
    for (const leg of legs) {
      if (leg.clip.y <= support + .06) this._legTo(leg, leg.clip.y, 1, 0, leg.pin, w * (1 - smooth(.02, .06, leg.clip.y - support)));
    }
    const after = this._lowestFoot();
    if (after !== null && footY !== null) this._raiseHips(footY - after);
  }

  /** Guarda tronco y brazos del aterrizaje: si salta desde ahí, el aire sale de esta pose. */
  _saveTakeoff() {
    for (const entry of this._takeoff) entry.quaternion.copy(entry.slot.bone.quaternion);
    this._takeoffValid = this._takeoff.length > 0;
  }

  /** Lleva los huesos de `entries` (guardados con su cuaternión local) hacia esa pose, en la fracción `weight`. */
  _fromPose(entries, weight) {
    for (const entry of entries) entry.slot.bone.quaternion.slerp(entry.quaternion, weight);
    if (this.joints.hips) this.joints.hips.updateMatrixWorld(true);
    else for (const entry of entries) entry.slot.bone.updateMatrixWorld(true);
  }

  /**
   * Sentadilla del golpe fuerte: lleva el tronco (cadera a cuello) a ~38° de la vertical y la cabeza a ~15°
   * adelante, midiendo lo que ya trae el clip; así no se suma a un clip que ya se dobla (una reverencia).
   */
  _squat(weight) {
    const hips = this.joints.hips, top = this.joints.neck ?? this.joints.head;
    if (hips && top) {
      for (let i = 0; i < 2; i++) {
        const v = top.getWorldPosition(this._direction2).sub(hips.getWorldPosition(this._hip));
        const delta = (SQUAT_TORSO - Math.atan2(v.dot(this._forward), v.dot(this._up()))) * weight;
        this._rotate('hips', .5 * delta, 0, 0, 1);
        this._rotate('spine', .5 * delta, 0, 0, 1);
      }
    }
    const head = this.slots.get('head');
    if (!head) return;
    head.bone.getWorldQuaternion(this._worldQ);
    const dir = this._direction.copy(head.axis).applyQuaternion(this._worldQ);
    this._rotate('head', (SQUAT_HEAD - Math.atan2(dir.dot(this._forward), dir.dot(this._up()))) * weight, 0, 0, 1);
  }

  /** Arriba del personaje en el mundo. */
  _up() {
    return this._upAxis.set(0, 1, 0).applyQuaternion(this._frameQ);
  }

  /**
   * Brazos del salto parado en grados (flexión adelante, apertura al costado, codo y giro del antebrazo hacia
   * adentro), pasados a dirección del brazo y del antebrazo (espacio del personaje, +Z delante):
   * - hasta el fondo de la agachada (~40-55 ms) van atrás, con el hombro extendido ~22°;
   * - suben adelante con los codos despegados del cuerpo y llegan al tope ~0,15 s después del despegue (8-10
   *   cuadros): hombro a ~46° y abierto ~34°, codo a ~68°, el antebrazo adelante y ~25° arriba y las manos
   *   separadas ~65 cm (más que los hombros), 12-16 cm bajo el mentón y nunca más arriba. Así la cámara de
   *   detrás ve los codos y los antebrazos al costado del tronco;
   * - se pasan ~3° y flotan 2-3 cuadros; después bajan ~1° por cuadro sin juntarse, cerrando un poco codo y
   *   apertura (en el ápice, hombro a ~36°, abiertos ~26° y codo a ~65°);
   * - desde ~2 cuadros antes del ápice (`APEX_LEAD` m/s de subida) se abren y bajan hacia la pose de la caída:
   *   abiertos al costado (26-35°, 15-25° adelante) con el codo a ~65° y el antebrazo hacia afuera, unos grados
   *   más cuanto más rápido cae. La apertura sigue toda la bajada (no se queda quieta).
   * El brazo que va delante en este salto (`_leadArm`) va en la bajada ~9° más adelante que el otro y ~3° más
   * abierto desde los 2,5 m/s de caída; al subir, el otro va 25 ms detrás y con ~8 % menos de recorrido.
   */
  _standingArms(side, airTime, u, vy, upper, fore) {
    const lead = side === this._leadArm, t = airTime - (lead ? 0 : .025), k = lead ? 1 : .92;
    const back = smooth(0, .04, t) * (1 - smooth(.04, .12, t)), swing = smooth(.04, .15, t);
    let flex = -22 * back + 43 * k * swing, abduct = 8 + 25 * swing, elbow = 12 + 56 * smooth(0, .15, t), inward = 0;
    // Se pasan un poco y flotan; después bajan despacio, todavía separados.
    const over = smooth(.12, .17, t) * (1 - smooth(.17, .26, t));
    flex += 3 * k * over; abduct += 1 * over;
    const relax = smooth(.17, .37, t);
    flex += (36 - flex) * relax; abduct += (24 - abduct) * relax; elbow += (64 - elbow) * relax; inward += (-15 - inward) * relax;
    const open = clamp((APEX_LEAD - vy) / (JUMP.launchSpeed + APEX_LEAD)), lift = smooth(0, 6, -vy);
    flex += (20 - flex) * open; abduct += (26 + 6 * lift - abduct) * open; elbow += (65 - elbow) * open; inward += (-50 - inward) * open;
    // Uno ~9° más adelante y un poco más abierto que el otro, ya desde el principio de la bajada.
    const odd = smooth(0, 2.5, -vy) * (lead ? 1 : -1);
    flex += 4.5 * odd; abduct += 1.5 * odd;
    this._armDirections(side, flex, abduct, elbow, inward, upper, fore);
  }

  /**
   * Brazos del salto en carrera según el avance del vuelo `q` (0 al despegar, ½ en el ápice, 1 al volver a la altura
   * de partida), en grados como `_standingArms` y saliendo de cómo los tenía el clip al despegar (`leg.stride`). El
   * contrario a la pierna que va a apoyar (`_strideLead`) sube adelante hasta ~38° con el codo a ~75° y la mano a la
   * altura del pecho (~0,12 s) y después baja despacio hasta ~-5° al tocar (casi colgando, ~45° delante del otro);
   * el otro va 8° más atrás y vuelve despacio 18° adelante. Los dos se abren ~12° hasta el ápice. En el ápice, donde el vuelo va más lento, el de delante todavía
   * baja ~1,5° por cuadro: no se quedan quietos.
   */
  _strideArms(leg, q, upper, fore) {
    const from = leg.stride, side = leg.side, open = from.open + 12 * smooth(.05, .4, q) * (1 - smooth(.55, 1, q));
    // El codo se dobla más despacio que el hombro: andando el clip lo trae casi estirado (~15°) y doblarlo de golpe
    // haría girar el antebrazo ~20° por cuadro.
    const push = smooth(0, .22, q), bend = smooth(0, .35, q);
    if (side === this._strideLead) {
      const flex = from.flex + (38 - from.flex) * push - 43 * smooth(.2, .8, q);
      return this._armDirections(side, flex, open, from.elbow + (75 - from.elbow) * bend, from.inward + (15 - from.inward) * bend, upper, fore);
    }
    const back = smooth(0, .15, q);
    const flex = from.flex - 8 * back + 18 * smooth(.15, 1, q);
    return this._armDirections(side, flex, open, from.elbow + (85 - from.elbow) * bend, from.inward * (1 - bend), upper, fore);
  }

  /**
   * Brazo por sus dos ángulos (de perfil y de frente, grados); el antebrazo se dobla `elbow` en el plano del brazo y
   * de su perpendicular hacia arriba y adelante, girado `inward` hacia el centro del cuerpo. Espacio del personaje.
   */
  _armDirections(side, flex, abduct, elbow, inward, upper, fore) {
    const limit = 80 * DEG;
    upper.set(side * Math.tan(Math.max(-limit, Math.min(limit, abduct * DEG))), -1, Math.tan(Math.max(-limit, Math.min(limit, flex * DEG)))).normalize();
    const plane = this._armPlane.set(0, upper.z, -upper.y).normalize();
    const inner = this._armInward.crossVectors(upper, plane).normalize();
    if (inner.x * side > 0) inner.negate();
    const e = elbow * DEG, i = inward * DEG;
    fore.copy(upper).multiplyScalar(Math.cos(e))
      .addScaledVector(plane, Math.sin(e) * Math.cos(i)).addScaledVector(inner, Math.sin(e) * Math.sin(i));
    return upper;
  }

  /** Guarda en `leg.stride` el brazo del clip en los ángulos de `_armDirections` (lo inverso). */
  _clipArm(leg) {
    const upper = this._clipDirection(leg.arm, this._jumpUpper), fore = this._clipDirection(leg.foreArm, this._jumpFore);
    const down = Math.max(1e-3, -upper.y), out = leg.stride;
    // Dentro de lo que hace un brazo al correr; en cruz o levantado (a más de ~70° de colgar) no se toca.
    const range = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    out.weight = smooth(.2, .45, -upper.y);
    out.flex = range(Math.atan2(upper.z, down) / DEG, -75, 60); out.open = range(Math.atan2(leg.side * upper.x, down) / DEG, 0, 40);
    const plane = this._armPlane.set(0, upper.z, -upper.y).normalize();
    const inner = this._armInward.crossVectors(upper, plane).normalize();
    if (inner.x * leg.side > 0) inner.negate();
    out.elbow = range(Math.acos(range(fore.dot(upper), -1, 1)) / DEG, 10, 120);
    out.inward = range(Math.atan2(fore.dot(inner), fore.dot(plane)) / DEG, -45, 45);
  }

  /** Giro del pecho (rad): la línea de las clavículas alrededor de la vertical, positivo con la izquierda adelante. */
  _chestYaw() {
    const left = this._chestPair[0], right = this._chestPair[1];
    if (!left || !right) return NaN;
    const line = left.getWorldPosition(this._shoulderLine).sub(right.getWorldPosition(this._shoulderOther));
    return Math.atan2(line.dot(this._forward), line.dot(this._side));
  }

  /** Dirección del hueso `key` (espacio del personaje) tal como está ahora, antes de apuntarlo: la del clip. */
  _clipDirection(key, out) {
    const slot = this.slots.get(key);
    if (!slot) return out.set(0, -1, 0);
    return out.copy(slot.axis).applyQuaternion(slot.bone.getWorldQuaternion(this._worldQ))
      .applyQuaternion(this._invFrameQ.copy(this._frameQ).invert()).normalize();
  }

  /** Mano caída ~25° respecto del antebrazo `fore` (espacio del personaje), en la fracción `weight`. */
  _looseHand(leg, fore, weight) {
    const length = fore.length();
    if (!(length > 1e-6) || !leg.hand) return;
    this._aim(leg.handKey, fore.x / length, fore.y / length - .45, fore.z / length, weight);
  }

  /**
   * Dirección de un brazo (espacio del personaje) que da vueltas de `radius` rad alrededor de una apertura de
   * `open` rad al costado, en la fase `phase`: arriba de la vuelta va hacia delante.
   */
  _windmillArm(side, open, radius, phase, out) {
    const so = Math.sin(open), co = Math.cos(open), cr = Math.cos(radius), sr = Math.sin(radius);
    const c = Math.cos(phase);
    return out.set(side * (so * cr + co * sr * c), -co * cr + so * sr * c, sr * Math.sin(phase) + .1 * cr);
  }

  /**
   * Salto en carrera: rodilla de la pierna que va a apoyar arriba y la de atrás estirada, sobre la zancada del clip;
   * `bend` rad más de rodilla atrás.
   */
  _strideAir(tuck, weight, bend = 0) {
    const left = this._legs[0], right = this._legs[1];
    if (!left.foot || !right.foot) return;
    const front = this._front, back = front === left ? right : left;
    this._rotate(front.upLeg, -.35 * tuck, 0, 0, weight);
    this._rotate(back.upLeg, .18 * tuck, 0, 0, weight);
    this._rotate(back.lowLeg, .25 * tuck + bend, 0, 0, weight);
  }

  /** Apunta un hueso a una dirección del mundo (su eje hacia el hijo). */
  _aimWorld(key, direction, weight) {
    const slot = this.slots.get(key);
    if (!slot || weight <= 0 || direction.lengthSq() < 1e-10) return;
    const bone = slot.bone;
    bone.getWorldQuaternion(this._worldQ);
    this._direction.copy(slot.axis).applyQuaternion(this._worldQ).normalize();
    this._target.copy(direction).normalize();
    this._deltaQ.setFromUnitVectors(this._direction, this._target);
    this._targetQ.copy(this._worldQ).premultiply(this._deltaQ);
    if (bone.parent) this._targetQ.premultiply(bone.parent.getWorldQuaternion(this._parentQ).invert());
    bone.quaternion.slerp(this._targetQ, Math.min(1, weight));
    bone.updateMatrixWorld(true);
  }

  /**
   * IK de dos huesos: lleva el tobillo a la altura `targetY` (mundo) sobre su misma vertical, con la
   * rodilla hacia delante, y conserva la orientación del pie en el mundo (la suela no gira con la pierna)
   * salvo `toe` rad de punta hacia abajo. Con `point` el tobillo va además hacia ese punto en x y z, en la
   * fracción `pointWeight`. `turn` es cuánto gira muslo y pierna hacia la solución (1 = del todo).
   */
  _legTo(leg, targetY, weight, toe = 0, point = null, pointWeight = weight, turn = 1) {
    const upper = this.slots.get(leg.upLeg), lower = this.slots.get(leg.lowLeg), foot = leg.foot;
    if (!upper || !lower || !foot || weight <= 0 || !Number.isFinite(targetY)) return;
    const hip = upper.bone.getWorldPosition(this._hip), knee = lower.bone.getWorldPosition(this._knee);
    const ankle = foot.getWorldPosition(this._ankle);
    const a = hip.distanceTo(knee), b = knee.distanceTo(ankle);
    if (a < 1e-5 || b < 1e-5) return;
    foot.getWorldQuaternion(this._footQ);
    const k = Math.min(1, weight), kp = Math.min(1, Math.max(0, pointWeight));
    // Con `point` el tobillo va a ese punto del mundo; sin él, solo a la altura `targetY` sobre su vertical.
    const goal = point ? this._goal.set(ankle.x + (point.x - ankle.x) * kp, ankle.y + (targetY - ankle.y) * k, ankle.z + (point.z - ankle.z) * kp)
      : this._goal.set(ankle.x, ankle.y + (targetY - ankle.y) * k, ankle.z);
    const reach = this._reach.copy(goal).sub(hip);
    const length = Math.min(Math.max(reach.length(), Math.abs(a - b) + 1e-3), (a + b) * .998);
    reach.normalize();
    // La rodilla se dobla en el plano de la pierna y el frente del personaje.
    const pole = this._pole.copy(this._forward).addScaledVector(reach, -this._forward.dot(reach));
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1);
    pole.normalize();
    const cos = Math.min(1, Math.max(-1, (a * a + length * length - b * b) / (2 * a * length)));
    const sin = Math.sqrt(1 - cos * cos);
    this._knee.copy(hip).addScaledVector(reach, a * cos).addScaledVector(pole, a * sin);
    this._aimWorld(leg.upLeg, this._direction2.copy(this._knee).sub(hip), turn);
    lower.bone.getWorldPosition(this._knee);
    goal.copy(hip).addScaledVector(reach, length);
    this._aimWorld(leg.lowLeg, this._direction2.copy(goal).sub(this._knee), turn);
    // El pie conserva su orientación en el mundo; `toe` lo pone de puntas.
    if (foot.parent) {
      this._targetQ.copy(foot.parent.getWorldQuaternion(this._parentQ).invert()).multiply(this._footQ);
      foot.quaternion.slerp(this._targetQ, Math.min(1, weight));
      foot.updateMatrixWorld(true);
    }
    if (toe) this._rotate(leg.footKey, toe, 0, 0, Math.min(1, weight));
  }

  /**
   * IK de dos huesos del brazo: lleva la muñeca a `target` (mundo) con el codo hacia atrás y afuera. Si no
   * llega, el brazo apunta al punto casi estirado. Sin mano en el esqueleto (modelo liviano) solo apunta.
   * `weight` mezcla los giros resueltos con los del clip: con un peso que tiende a cero el brazo vuelve
   * entero al clip (el codo también), sin un salto al dejar de llamarla.
   */
  _armTo(leg, target, weight) {
    const upper = this.slots.get(leg.arm), lower = this.slots.get(leg.foreArm);
    if (!upper || !lower || weight <= 0) return;
    const shoulder = upper.bone.getWorldPosition(this._hip);
    if (!leg.hand) {
      this._aimWorld(leg.arm, this._direction2.copy(target).sub(shoulder), weight);
      this._aimWorld(leg.foreArm, this._direction2.copy(target).sub(lower.bone.getWorldPosition(this._knee)), weight);
      return;
    }
    const elbow = lower.bone.getWorldPosition(this._knee), wrist = leg.hand.getWorldPosition(this._ankle);
    const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
    if (a < 1e-5 || b < 1e-5) return;
    const k = Math.min(1, weight);
    const upperQ = this._armQ.copy(upper.bone.quaternion), lowerQ = this._foreQ.copy(lower.bone.quaternion);
    const goal = this._goal.copy(target);
    const reach = this._reach.copy(goal).sub(shoulder);
    const length = Math.min(Math.max(reach.length(), Math.abs(a - b) + 1e-3), (a + b) * .995);
    reach.normalize();
    const pole = this._pole.copy(this._forward).multiplyScalar(-1).addScaledVector(this._side, leg.side * .6);
    pole.addScaledVector(reach, -pole.dot(reach));
    if (pole.lengthSq() < 1e-8) pole.copy(this._side).multiplyScalar(leg.side);
    pole.normalize();
    const cos = Math.min(1, Math.max(-1, (a * a + length * length - b * b) / (2 * a * length)));
    const sin = Math.sqrt(1 - cos * cos);
    elbow.copy(shoulder).addScaledVector(reach, a * cos).addScaledVector(pole, a * sin);
    this._aimWorld(leg.arm, this._direction2.copy(elbow).sub(shoulder), 1);
    lower.bone.getWorldPosition(this._knee);
    goal.copy(shoulder).addScaledVector(reach, length);
    this._aimWorld(leg.foreArm, this._direction2.copy(goal).sub(this._knee), 1);
    if (k < 1) {
      upper.bone.quaternion.copy(upperQ.slerp(upper.bone.quaternion, k));
      lower.bone.quaternion.copy(lowerQ.slerp(lower.bone.quaternion, k));
      upper.bone.updateMatrixWorld(true);
    }
  }

  /** Pone el pie plano, como de pie en reposo (si ya se midió), en la fracción `weight`. */
  _footFlat(leg, weight) {
    const foot = leg.foot;
    if (!leg.flat || !foot?.parent || weight <= 0) return;
    this._targetQ.copy(this._frameQ).multiply(leg.flat).premultiply(foot.parent.getWorldQuaternion(this._parentQ).invert());
    foot.quaternion.slerp(this._targetQ, Math.min(1, weight));
    foot.updateMatrixWorld(true);
  }

  _raiseHips(height) {
    this._shift += height || 0;
    this._shiftHips(0, height, 0);
  }

  /** Mueve la cadera (y todo lo que cuelga de ella) en el mundo, sin tocar la raíz. */
  _shiftHips(x, y, z) {
    const hips = this.joints.hips;
    if (!hips?.parent || (!x && !y && !z)) return;
    this._target.set(x, y, z);
    hips.parent.updateWorldMatrix(true, false);
    this._position.setFromMatrixPosition(hips.parent.matrixWorld);
    this._target.add(this._position);
    hips.parent.worldToLocal(this._target);
    hips.position.add(this._target);
  }

  /**
   * Tobillo sobre el piso, largo de la pierna y pie plano de pie, una vez y en reposo. Solo lo mide quien
   * dice si está en el suelo (el jugador y la sala, los únicos que saltan): el resto de la gente pasa por
   * `apply` en cada cuadro y no debe pedir matrices de mundo.
   */
  _measureRest() {
    const foot = this._lowestFoot();
    if (foot === null || !this.frame) return;
    this._ankleRest = Math.min(.15, Math.max(.02, foot - this.frame.getWorldPosition(this._position).y));
    this.frame.getWorldQuaternion(this._parentQ).invert();
    let legs = 0, count = 0;
    for (const leg of this._legs) {
      if (!leg.foot) continue;
      leg.flat = leg.foot.getWorldQuaternion(leg.flat ?? new Quaternion()).premultiply(this._parentQ);
      const hip = this.slots.get(leg.upLeg)?.bone;
      if (!hip) continue;
      legs += hip.getWorldPosition(this._hip).y - leg.foot.getWorldPosition(this._ankle).y; count++;
    }
    if (count) this._legRest = legs / count;
  }

  /** Altura del tobillo sobre la raíz de pie: la medida, o hasta medirla la de la pose de reposo. */
  _restAnkle() {
    if (this._ankleRest !== null) return this._ankleRest;
    if (this._ankleBind === null || !this.frame) return .09;
    return this._ankleBind * this.frame.getWorldScale(this._position).y;
  }

  /** Altura del tobillo en la pose de reposo, en el marco del cuerpo (sin matrices de mundo: se llama al crear). */
  _bindAnkle() {
    const foot = this.joints.leftFoot ?? this.joints.rightFoot;
    if (!foot || !this.frame) return null;
    const point = new Vector3(), matrix = new Matrix4();
    for (let node = foot; node !== this.frame; node = node.parent) {
      if (!node?.parent) return null;
      point.applyMatrix4(matrix.compose(node.position, node.quaternion, node.scale));
    }
    return Math.min(.15, Math.max(.02, point.y));
  }

  /**
   * Cuánto quedaría por encima de `restY` el tobillo más alto con las piernas juntas del golpe fuerte (muslo 10°
   * adelante y rodilla a 20°: la pierna mide ~cos 10° de su largo en vertical) y las caderas donde están.
   */
  _holdGap(restY) {
    let gap = 0;
    for (const leg of this._legs) {
      const upper = this.slots.get(leg.upLeg)?.bone, lower = this.slots.get(leg.lowLeg)?.bone;
      if (!upper || !lower || !leg.foot) continue;
      const hip = upper.getWorldPosition(this._hip), knee = lower.getWorldPosition(this._knee), ankle = leg.foot.getWorldPosition(this._ankle);
      gap = Math.max(gap, hip.y - (hip.distanceTo(knee) + knee.distanceTo(ankle)) * Math.cos(.17) - restY);
    }
    return gap;
  }

  _lowestFoot() {
    let height = Infinity;
    for (let i = 0; i < FEET.length; i++) {
      const foot = this.joints[FEET[i]];
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
