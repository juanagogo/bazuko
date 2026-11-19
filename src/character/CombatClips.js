import { MathUtils, Quaternion } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createRetargeter } from './retarget.js';

const CLIPS = ['FightIdle', 'PunchCross', 'HitChest'];
const UPPER = /(?:Spine[12]?|Neck|Head|(?:Left|Right)(?:Shoulder|Arm|ForeArm|Hand))\.quaternion$/;
const smooth = MathUtils.smoothstep;

/** La marcha conserva cadera y piernas. Los dedos siguen a los puños y agarres del personaje. */
export function buildCombatClips(body, bank) {
  const source = CLIPS.map(name => bank?.animations.find(clip => clip.name === name));
  if (!source.every(Boolean)) return null;
  const retarget = createRetargeter(bank.scene, clone(body.scene));
  return Object.fromEntries(source.map(clip => {
    const adapted = retarget(clip, 24);
    adapted.tracks = adapted.tracks.filter(track => UPPER.test(track.name));
    return [clip.name, adapted];
  }));
}

// En la fuente de 24 FPS el brazo termina de extenderse en el cuadro 9; al 13 comienza a recogerse.
// El reloj del juego sitúa el primero en el contacto, aunque el cuadro haya cruzado varias fases.
function crossTime(attack) {
  const p = MathUtils.clamp(attack.progress ?? 0, 0, 1);
  if (attack.phase === 'windup') return 9 * p / 24;
  if (attack.phase === 'active') return (9 + 4 * p) / 24;
  return (13 + 6 * smooth(p, 0, .82)) / 24;
}

/** Capa local de la instancia. Las tres curvas adaptadas son compartidas por cuerpo y LOD. */
export class CombatPose {
  constructor(bones, clips) {
    this.guardDuration = clips.FightIdle.duration;
    this.hitDuration = clips.HitChest.duration;
    const channels = CLIPS.map(name => new Map(clips[name].tracks.map(track => [track.name, track])));
    this.slots = [];
    for (const [name, guard] of channels[0]) {
      const joint = name.split('.')[0], bone = bones.get(joint);
      if (!bone) continue;
      this.slots.push({
        bone, arm: /Left|Right/.test(joint), right: joint.includes('Right'),
        guard: guard.createInterpolant(), cross: channels[1].get(name).createInterpolant(),
        hit: channels[2].get(name).createInterpolant(),
        saved: new Quaternion(), last: new Quaternion(), entry: new Quaternion()
      });
    }
    this.sample = new Quaternion();
    this.applied = false;
    this.reset();
  }

  reset() {
    this.guardTime = 0;
    this.guardWeight = 0;
    this.attackKey = null;
    this.hasLast = false;
  }

  restore() {
    if (this.applied) for (const slot of this.slots) slot.bone.quaternion.copy(slot.saved);
    this.applied = false;
  }

  state() {
    if (!this.hasLast) return null;
    return { time: this.guardTime, weight: this.guardWeight, key: this.attackKey,
      joints: this.slots.map(slot => [slot.last.clone(), slot.entry.clone()]) };
  }

  setState(state) {
    if (!state) { this.reset(); return; }
    this.guardTime = state.time; this.guardWeight = state.weight; this.attackKey = state.key;
    this.hasLast = true;
    this.slots.forEach((slot, i) => {
      slot.last.copy(state.joints[i][0]);
      slot.entry.copy(state.joints[i][1]);
    });
  }

  /** El golpe recibido conserva el muelle direccional del tronco y la absorción de las rodillas. */
  hit(progress) {
    this.reset();
    const p = MathUtils.clamp(progress, 0, 1);
    const weight = smooth(p, 0, .14) * (1 - smooth(p, .65, 1));
    if (!weight) return;
    // Las manos llegan al pecho al cuadro 5; la segunda parte del clip vuelve a abrir los codos.
    const time = p < .18 ? 5 / 24 * p / .18 : MathUtils.lerp(5 / 24, this.hitDuration, (p - .18) / .82);
    this.applied = true;
    for (const slot of this.slots) {
      slot.saved.copy(slot.bone.quaternion);
      if (slot.arm) slot.bone.quaternion.slerp(this.sample.fromArray(slot.hit.evaluate(time)), weight);
    }
  }

  fight(dt, attack, guarding) {
    const p = MathUtils.clamp(attack?.progress ?? 0, 0, 1);
    const winding = attack?.phase === 'windup';
    const cross = attack?.step === 1;
    const key = attack ? attack.id ?? attack.step ?? 0 : null;
    const entering = attack && key !== this.attackKey;
    if (attack) {
      this.guardTime = 0;
      this.guardWeight = attack.phase === 'recovery' ? smooth(p, .12, .72) : 0;
    } else {
      this.guardWeight = MathUtils.clamp(this.guardWeight + dt * (guarding ? 7 : -5), 0, 1);
      if (!this.guardWeight) { this.reset(); return; }
      this.guardTime = (this.guardTime + dt) % this.guardDuration;
    }
    const time = cross ? crossTime(attack) : 0;
    const enter = winding ? smooth(p, 0, .62) : 1;
    const guard = smooth(this.guardWeight, 0, 1);
    this.applied = true;
    for (const slot of this.slots) {
      const q = slot.bone.quaternion;
      slot.saved.copy(q);
      if (entering) slot.entry.copy(this.hasLast ? slot.last : q);
      if (cross) {
        q.fromArray(slot.cross.evaluate(time));
      } else {
        // En el jab y el gancho manda su arco procedural. El otro brazo acompaña con la guardia.
        const weight = attack && slot.right ? 1 : guard;
        if (weight > 0) q.slerp(this.sample.fromArray(slot.guard.evaluate(this.guardTime)), weight);
      }
      if (winding && enter < 1) q.slerp(slot.entry, 1 - enter);
      slot.last.copy(q);
    }
    this.hasLast = true;
    this.attackKey = key;
  }
}
