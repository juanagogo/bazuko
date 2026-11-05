// src/character/BodyLanguage.js
// Capa de lenguaje corporal de UNA instancia: postura (`stance`), forma de llevar el cuerpo (`style`)
// y caída (`ko`). Va después del mezclador y antes de ActionPose, y se retira con `restore()` antes
// del mezclador, como las demás capas. Solo hace `slerp` y productos de cuaterniones en espacio local:
// ni una matriz de mundo por cuadro, porque casi todos los peatones se ven con el modelo liviano.
// Sin postura, sin estilo y sin caída no toca ningún hueso.
import { Quaternion } from 'three';

const QUIET_SPEED = .15;
const RETIRE_TIME = .14;
// Pararse de un susto o de un golpe desde una postura con la cadera abajo: rápido, pero sin salir volando.
export const RISE_TIME = .35;
const LOW_HIP_DROP = .1; // m: cambiar el peso de pierna baja la cadera un poco, pero sigue de pie
const KO_HIP_HOLD = .4; // último tramo de la caída, medido en ko, en que la cadera sale de la postura baja
/**
 * Caer y pararse, sin girar el cuerpo entero: los pies se quedan y la cadera va de una pose a otra (ver stances.js).
 * Cada tramo es `[pose, desde dónde]`; `null` es como esté de pie o en su postura. Es función de `ko`: el otro modelo
 * de la misma persona sigue en el mismo punto sin tener que heredar nada.
 */
const RISE_PATH = [['tendido', 0], ['incorpora', .28], ['abre', .35], ['recoge', .42], ['rodilla', .55], ['pisa', .68], ['empuje', .8], [null, 1]];
const WALL_RISE = [['recostado', 0], ['desliza', .32], ['empuje', .6], [null, 1]];
export const KO_PLANS = {
  espalda: { fall: [[null, 0], ['flexiona', .2], ['cede', .42], ['sienta', .58], ['golpe', .74], ['tendido', 1]], rise: RISE_PATH },
  // Desde abajo no se para para caerse: la cadera sigue en el piso y solo se va de espaldas.
  bajo: { fall: [[null, 0], ['tendido', 1]], rise: RISE_PATH },
  // De rodillas primero saca los pies de debajo: de una, las piernas pasarían por el piso.
  rodillas: { fall: [[null, 0], ['saca-pies', .42], ['se-tiende', .7], ['tendido', 1]], rise: RISE_PATH },
  dormido: { fall: [[null, 0], ['dormido', 1]], rise: [['dormido', 0], ['rueda', .12], ['cruza', .24], ['despierta', .36], ['rodilla', .5], ['pisa', .64], ['empuje', .78], [null, 1]] },
  banca: { fall: [[null, 0], ['desplomado', 1]], rise: [['desplomado', 0], ['empuje', .55], [null, 1]] },
  muro: { fall: [[null, 0], ['flexiona', .2], ['cede', .45], ['encoge', .72], ['recostado', 1]], rise: WALL_RISE },
  'muro-bajo': { fall: [[null, 0], ['recostado', 1]], rise: WALL_RISE },
  'muro-rodillas': { fall: [[null, 0], ['saca-pies', .36], ['encoge', .66], ['recostado', 1]], rise: WALL_RISE }
};
// Cuánto de la subida ha pasado cuando la mano derecha ya está en el piso.
export const KO_HAND_DOWN = .55;
// Quien se escurrió contra un muro ya tiene la mano en el piso cuando empieza a pararse.
export const koHandDown = plan => (plan?.startsWith('muro') ? .02 : KO_HAND_DOWN);
const STYLE_TIME = .5;
// Parte de la inclinación del tronco que las manos ancladas a la cadera devuelven con el brazo.
const HIP_ANCHOR = .85;

export const smooth = t => t * t * (3 - 2 * t);
const clamp01 = value => Math.min(1, Math.max(0, value));

const _alt = new Quaternion(), _delta = new Quaternion();

/** Peso que avanza a ritmo fijo: da lo mismo a 30 que a 144 FPS y llega exactamente a 0 y a 1. */
const ramp = (value, target, step) => (value < target ? Math.min(target, value + step) : Math.max(target, value - step));

export class BodyLanguage {
  /**
   * `library` es lo que hornea `bakeStances` para este cuerpo; `lod` no gasta en los dedos; `lean`
   * es cuántos radianes inclina el tronco el andar de esta persona.
   */
  constructor(bones, library, { lod = false, seed = 0, lean = 0 } = {}) {
    this.bones = bones;
    this.library = library;
    this.lod = lod;
    this.lean = lean;
    this.time = seed;
    this.hips = [...bones.values()].find(bone => /hips$/i.test(bone.name));
    this.slots = new Map();
    this.layers = [];
    this.resolved = new Map();
    this.dirty = [];
    this.hipSaved = this.hips.position.clone();
    this.hipDirty = false;
    this.styleWeight = 0;
    this.carryWeight = 0;
    this.carrySide = null;
    this.gaitWeight = 0;
    this.stoopNow = 0; this.headNow = 0;
    this.snapNext = false;
    this.koSlots = null;
    this.stoopSlots = null; this.headSlots = null; this.swaySlots = null;
    this.backSlots = null; this.armSlots = null; this.kneeSlot = null;
  }

  /** Espacio de una instancia para un hueso, con su valor antes de que la capa lo toque. */
  _slot(boneName) {
    let slot = this.slots.get(boneName);
    if (!slot) {
      const bone = this.bones.get(boneName);
      if (!bone) return null;
      slot = { bone, base: new Quaternion(), used: false };
      this.slots.set(boneName, slot);
    }
    return slot;
  }

  _resolve(name) {
    let stance = this.resolved.get(name);
    if (stance !== undefined) return stance;
    const source = this.library.stances.get(name);
    if (!source) { this.resolved.set(name, null); return null; }
    const entries = [];
    for (const item of source.entries) {
      if (this.lod && item.dedo) continue;
      const slot = this._slot(item.boneName);
      if (slot) entries.push({ slot, quaternion: item.quaternion, alt: item.alt ?? null, peso: item.peso });
    }
    stance = { name, entries, hip: source.hip, hipDrop: source.hipDrop, walk: source.walk, anchored: source.anchored, transition: source.transition, motion: source.motion };
    this.resolved.set(name, stance);
    return stance;
  }

  /** Lista de huesos con su eje local; los slots se crean una vez. */
  _axes(list) {
    return list.map(item => ({ slot: this._slot(item.boneName), axis: item.axis, share: item.share })).filter(item => item.slot);
  }

  _touch(slot) {
    if (slot.used) return;
    slot.base.copy(slot.bone.quaternion);
    slot.used = true;
    this.dirty.push(slot);
  }

  restore() {
    const dirty = this.dirty;
    for (let i = 0; i < dirty.length; i++) {
      dirty[i].bone.quaternion.copy(dirty[i].base);
      dirty[i].used = false;
    }
    dirty.length = 0;
    if (this.hipDirty) {
      this.hips.position.copy(this.hipSaved);
      this.hipDirty = false;
    }
  }

  /** ¿Hay algo que aplicar o que retirar? */
  get active() { return this.layers.length > 0 || this.styleWeight > 0 || this.carryWeight > 0; }

  /** Cuánto pesa ahora una postura que mueve la cadera: 0 de pie, 1 del todo en ella. */
  get hipWeight() {
    let weight = 0;
    for (let i = 0; i < this.layers.length; i++) if (this.layers[i].stance.hipDrop > LOW_HIP_DROP) weight = Math.max(weight, smooth(this.layers[i].weight));
    return weight;
  }

  /** La siguiente vez entra en su postura de golpe: para quien cambió de postura sin que nadie lo viera. */
  snap() { this.snapNext = true; }

  /** Por dónde va: el otro modelo de la misma persona sigue desde ahí, a media subida o a media transición. */
  state() {
    return {
      layers: this.layers.map(({ stance, weight }) => ({ name: stance.name, weight })),
      styleWeight: this.styleWeight, carryWeight: this.carryWeight, carrySide: this.carrySide,
      gaitWeight: this.gaitWeight, stoopNow: this.stoopNow, headNow: this.headNow
    };
  }

  setState({ layers, styleWeight, carryWeight, carrySide, gaitWeight, stoopNow, headNow }) {
    this.layers = layers.map(({ name, weight }) => ({ stance: this._resolve(name), weight })).filter(layer => layer.stance);
    Object.assign(this, { styleWeight, carryWeight, carrySide, gaitWeight, stoopNow, headNow });
  }

  /**
   * @param {string|null} stance  nombre de la postura
   * @param {number} stanceWeight 0..1, sobre el peso de la transición
   * @param {object|null} style   { stoop, swing, sway, headDown, carry, limp }
   * @param {number} ko           0..1, ya suavizado; manda sobre lo demás
   * @param {boolean} koRising    va de vuelta: `ko` baja y el cuerpo se levanta por el camino de subida
   * @param {string} koPlan       cómo cae y cómo se para: una entrada de `KO_PLANS`
   * @param {string|null} koFrom  la postura baja en la que estaba al caer, hasta que quede atrás
   * @param {number} speed        velocidad del paso (m/s)
   * @param {number} phase        fase del paso (0..1)
   * @param {boolean} blocked     otra capa es dueña de todo el cuerpo: saltar, nadar, dormir, golpe recibido
   * @param {boolean} handsBusy   otra capa es dueña de las manos: pegar, fumar con pipa, señalar
   * @param {boolean} rising      se está parando del piso de afán: la postura baja se retira en RISE_TIME
   */
  apply(dt, { stance = null, stanceWeight = 1, style = null, ko = 0, koRising = false, koPlan = 'espalda', koFrom = null, speed = 0, phase = 0, blocked = false, handsBusy = false, rising = false } = {}) {
    const hasStyle = !!style && !blocked;
    // Aunque no haya nada que hacer, la orden se gasta: si no, la próxima postura entraría de un cuadro.
    const snap = this.snapNext;
    this.snapNext = false;
    if (!stance && !this.layers.length && !hasStyle && this.styleWeight === 0 && this.carryWeight === 0 && ko <= 0) return;
    this.time += dt;
    const stepOf = seconds => (snap ? 1 : dt / seconds);

    // --- peso del estilo y del paso ---
    this.styleWeight = ramp(this.styleWeight, hasStyle && ko <= 0 ? 1 : 0, blocked ? stepOf(RETIRE_TIME) : stepOf(STYLE_TIME));
    this.gaitWeight = ramp(this.gaitWeight, speed >= QUIET_SPEED ? 1 : 0, stepOf(.25));
    const styleWeight = smooth(this.styleWeight);

    if (styleWeight > 0 || this.carryWeight > 0) this._applyArmStyle(style, styleWeight, handsBusy, blocked, stepOf);
    // Con lo que recogió ya en la mano, de subida el brazo va tomando su postura: no llega abajo con el paraguas de lado.
    const backUp = koRising && 1 - ko >= KO_HAND_DOWN && !!stance && !!this._resolve(stance)?.walk;
    this._applyStance(stance, stanceWeight, speed, blocked || handsBusy || (ko > 0 && !backUp), rising, ko, koRising ? null : koFrom, dt, stepOf);
    if (ko > 0) this._applyKnockout(ko, koRising, koPlan);
    if (styleWeight > 0) this._applyBodyStyle(style, styleWeight, phase, dt, snap);
    else if (this.stoopNow || this.headNow) { this.stoopNow = 0; this.headNow = 0; }
  }

  _applyStance(stance, stanceWeight, speed, retired, rising, ko, koFrom, dt, stepOf) {
    const wanted = !retired && stance ? this._resolve(stance) : null;
    const target = wanted && (wanted.walk || speed < QUIET_SPEED) ? wanted : null;
    if (target && !this.layers.some(layer => layer.stance === target)) this.layers.push({ stance: target, weight: 0 });
    // El modelo que entra a media caída desde el piso arranca con la postura baja puesta.
    if (koFrom && ko < 1 && !this.layers.some(layer => layer.stance.name === koFrom)) {
      const from = this._resolve(koFrom);
      if (from) this.layers.push({ stance: from, weight: 1 });
    }
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      const going = layer.stance === target;
      // Noqueado desde el piso se va de espaldas con la cadera abajo: si sube antes de acostarse, flota.
      if (ko > 0 && layer.stance.hipDrop > LOW_HIP_DROP) layer.weight = Math.min(layer.weight, clamp01((1 - ko) / KO_HIP_HOLD));
      // Pararse de afán va siempre a su ritmo: es lo que se ve, aunque en ese cuadro cambie de modelo.
      else if (!going && rising && layer.stance.hip) layer.weight = ramp(layer.weight, 0, dt / RISE_TIME);
      else layer.weight = ramp(layer.weight, going ? 1 : 0, stepOf(going ? layer.stance.transition : retired ? RETIRE_TIME : layer.stance.transition * .8));
      if (layer.weight <= 0) this.layers.splice(i, 1);
    }
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      this._applyLayer(layer.stance, smooth(layer.weight) * clamp01(stanceWeight));
    }
  }

  _applyLayer(stance, weight) {
    if (weight <= 0) return;
    const entries = stance.entries;
    const swing = stance.motion ? this._motion(stance.motion) : 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      this._touch(entry.slot);
      const goal = swing > 0 && entry.alt ? _alt.copy(entry.quaternion).slerp(entry.alt, swing) : entry.quaternion;
      entry.slot.bone.quaternion.slerp(goal, weight * entry.peso);
    }
    if (stance.anchored && this.gaitWeight > 0) this._leanBack(weight);
    if (stance.hip) this._moveHip(stance.hip, weight);
  }

  /** Manos en la cadera: el tronco que se inclina al andar no se las lleva hacia delante. */
  _leanBack(weight) {
    const angle = this.lean * HIP_ANCHOR * smooth(this.gaitWeight) * weight;
    if (angle < .001) return;
    this.backSlots ??= this._axes(this.library.style.leanBack);
    for (let i = 0; i < this.backSlots.length; i++) {
      const item = this.backSlots[i];
      this._touch(item.slot);
      item.slot.bone.quaternion.premultiply(_delta.setFromAxisAngle(item.axis, angle));
    }
  }

  _moveHip(target, weight) {
    if (!this.hipDirty) {
      this.hipSaved.copy(this.hips.position);
      this.hipDirty = true;
    }
    this.hips.position.lerp(target, weight);
  }

  /** Cuánto de la pose alternativa toca ahora: 0..1, sin saltos. */
  _motion({ rate, pulse = 0 }) {
    const cycle = this.time * rate;
    const turn = cycle - Math.floor(cycle);
    if (!pulse) return .5 - .5 * Math.cos(turn * Math.PI * 2 + Math.sin(cycle * 2.399) * .9);
    return turn >= pulse ? 0 : Math.sin(turn / pulse * Math.PI) ** 2;
  }

  /** Por dónde va del camino de `KO_PLANS` y a qué pose se acerca: nada de esto guarda estado. */
  _applyKnockout(ko, rising, planName) {
    const data = this.library.knockout, plan = KO_PLANS[planName] ?? KO_PLANS.espalda;
    const path = rising ? plan.rise : plan.fall, t = rising ? 1 - ko : ko;
    let i = 0;
    while (i < path.length - 2 && t >= path[i + 1][1]) i++;
    const raw = clamp01((t - path[i][1]) / (path[i + 1][1] - path[i][1]));
    const s = raw + (smooth(raw) - raw) * .5; // sin frenar del todo en cada pose
    const from = path[i][0] && data.keys[path[i][0]], to = path[i + 1][0] && data.keys[path[i + 1][0]];
    const slots = this.koSlots ??= data.bones.map(item => (this.lod && item.dedo ? null : this._slot(item.boneName)));
    for (let n = 0; n < slots.length; n++) {
      const slot = slots[n];
      if (!slot) continue;
      this._touch(slot);
      const q = slot.bone.quaternion;
      if (from && to) q.slerpQuaternions(from.q[n], to.q[n], s);
      else if (to) q.slerp(to.q[n], s);
      else q.slerp(from.q[n], 1 - s);
    }
    if (from && to) { this._moveHip(from.hip, 1); this.hips.position.lerp(to.hip, s); }
    else if (to) this._moveHip(to.hip, s);
    else this._moveHip(from.hip, 1 - s);
  }

  /** Braceo y brazo que carga: van antes de la postura, que manda sobre ellos si usa ese brazo. */
  _applyArmStyle(style, weight, handsBusy, blocked, stepOf) {
    const swing = style?.swing ?? 1;
    if (!handsBusy && weight > 0 && this.gaitWeight > 0 && swing !== 1) {
      this.armSlots ??= this.library.style.arms.map(item => ({ slot: this._slot(item.boneName), quaternion: item.quaternion })).filter(item => item.slot);
      const amount = (1 - Math.min(1.3, Math.max(0, swing))) * weight * smooth(this.gaitWeight);
      for (let i = 0; i < this.armSlots.length; i++) {
        const arm = this.armSlots[i];
        this._touch(arm.slot);
        arm.slot.bone.quaternion.slerp(arm.quaternion, amount);
      }
    }
    const side = style?.carry === 'derecha' || style?.carry === 'izquierda' ? style.carry : null;
    if (side && side !== this.carrySide && this.carryWeight === 0) this.carrySide = side;
    this.carryWeight = ramp(this.carryWeight, side === this.carrySide && side && !handsBusy && !blocked ? 1 : 0, stepOf(.3));
    if (this.carryWeight > 0) this._applyLayer(this._resolve(`cargar-${this.carrySide}`), smooth(this.carryWeight));
  }

  /** Encorvar, bajar la cabeza, mecerse y cojear: productos pequeños sobre columna y cuello. */
  _applyBodyStyle(style, weight, phase, dt, snap) {
    const list = this.library.style;
    const damp = snap ? 1 : 1 - Math.exp(-dt * 4);
    this.stoopNow += ((style?.stoop ?? 0) * weight - this.stoopNow) * damp;
    this.headNow += ((style?.headDown ?? 0) * weight - this.headNow) * damp;
    if (Math.abs(this.stoopNow) > .002) this._bend(this.stoopSlots ??= this._axes(list.stoop), this.stoopNow * .5);
    if (Math.abs(this.headNow) > .002) this._bend(this.headSlots ??= this._axes(list.head), this.headNow * .6);
    const gait = smooth(this.gaitWeight) * weight;
    if (gait <= 0) return;
    const sway = style?.sway ?? 0, limp = style?.limp ?? 0;
    if (!sway && !limp) return;
    const wave = Math.sin(phase * Math.PI * 2);
    // Pisar con la pierna mala tira del torso hacia ese lado; pisar con la buena no.
    const roll = -sway * .085 * wave + limp * .13 * Math.max(0, -wave);
    if (Math.abs(roll) > .001) this._bend(this.swaySlots ??= this._axes(list.sway), roll * gait);
    if (limp) {
      this.kneeSlot ??= this._slot(list.knee.boneName);
      if (this.kneeSlot) {
        this._touch(this.kneeSlot);
        this.kneeSlot.bone.quaternion.slerp(list.knee.quaternion, limp * .34 * gait);
      }
    }
  }

  _bend(slots, angle) {
    for (let i = 0; i < slots.length; i++) {
      const item = slots[i];
      this._touch(item.slot);
      item.slot.bone.quaternion.multiply(_delta.setFromAxisAngle(item.axis, angle * item.share));
    }
  }
}
