import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

const names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const normalized = name => name.replace(/[^a-z0-9]/gi, '').toLowerCase();

/** Pose de descanso boca arriba. Pertenece a una instancia y nunca mueve su raíz. */
export class SleepPose {
  constructor(bones, frame) {
    this.frame = frame;
    const values = bones instanceof Map ? [...bones.values()] : Object.values(bones ?? {});
    this.bones = Object.fromEntries(names.map(name => [name, values.find(b => normalized(b.name ?? '').endsWith(name.toLowerCase()))]));
    this.slots = values.filter(b => b.isBone).map(bone => ({ bone,
      restQ: bone.quaternion.clone(), restP: bone.position.clone(),
      baseQ: new Quaternion(), baseP: new Vector3(), targetQ: new Quaternion(), targetP: new Vector3() }));
    this.meshes = [];
    frame?.traverse(mesh => { if (mesh.isSkinnedMesh && mesh.geometry?.attributes.position) this.meshes.push(mesh); });
    this.support = null;
    this.weight = 0;
    this.active = false;
    this.ready = false;
    this.time = 0;
    this.v = new Vector3(); this.axis = new Vector3(); this.goal = new Vector3();
    this.q = new Quaternion(); this.delta = new Quaternion(); this.parentQ = new Quaternion(); this.frameQ = new Quaternion();
    this.inverse = new Matrix4(); this.euler = new Euler();
  }

  restore() {
    if (!this.active) return;
    for (const s of this.slots) { s.bone.quaternion.copy(s.baseQ); s.bone.position.copy(s.baseP); }
    this.active = false;
  }

  reset() { this.restore(); this.weight = 0; }

  _aim(name, childName, x, y, z) {
    const bone = this.bones[name], child = this.bones[childName] ?? bone?.children.find(b => b.isBone);
    if (!bone || !child || child.position.lengthSq() < 1e-8) return;
    this.axis.copy(child.position).normalize().applyQuaternion(bone.getWorldQuaternion(this.q));
    this.goal.set(x, y, z).normalize().applyQuaternion(this.frameQ);
    this.delta.setFromUnitVectors(this.axis, this.goal);
    this.q.premultiply(this.delta);
    if (bone.parent) this.q.premultiply(bone.parent.getWorldQuaternion(this.parentQ).invert());
    bone.quaternion.copy(this.q); bone.updateMatrixWorld(true);
  }

  _lift(amount) {
    const hips = this.bones.Hips;
    if (!hips?.parent || !amount) return;
    // amount is in frame units (same scale as the model).
    hips.getWorldPosition(this.v);
    this.goal.set(0, 1, 0).transformDirection(this.frame.matrixWorld);
    this.frame.getWorldScale(this.axis);
    this.v.addScaledVector(this.goal, this.axis.y * amount);
    hips.parent.worldToLocal(this.v);
    hips.position.copy(this.v);
    hips.updateMatrixWorld(true);
  }

  _bottom(collect = false) {
    this.frame.updateWorldMatrix(true, true);
    this.inverse.copy(this.frame.matrixWorld).invert();
    let minimum = Infinity;
    for (const mesh of this.meshes) {
      const count = mesh.geometry.attributes.position.count;
      const indices = !collect && this.support ? this.support.get(mesh) : null;
      const heights = collect ? new Float32Array(count) : null;
      const sample = i => {
        mesh.getVertexPosition(i, this.v).applyMatrix4(mesh.matrixWorld).applyMatrix4(this.inverse);
        minimum = Math.min(minimum, this.v.y);
        if (heights) heights[i] = this.v.y;
      };
      if (indices) { for (const i of indices) sample(i); }
      else for (let i = 0; i < count; i++) sample(i);
      if (collect) {
        const candidates = this.support.get(mesh);
        // Keep a band, not only the lowest vertex, so the support remains valid
        // between the cached samples of the transition.
        for (let i = 0; i < count; i++) if (heights[i] < minimum + .035) candidates.add(i);
      }
    }
    if (Number.isFinite(minimum)) return minimum;
    // A skeleton-only preview still has a conservative anatomical support.
    for (const name of ['Hips', 'Head', 'LeftFoot', 'RightFoot', 'LeftLeg', 'RightLeg', 'LeftArm', 'RightArm']) {
      const bone = this.bones[name];
      if (!bone) continue;
      bone.getWorldPosition(this.v).applyMatrix4(this.inverse);
      minimum = Math.min(minimum, this.v.y - (name === 'Hips' ? .12 : name === 'Head' ? .09 : .035));
    }
    return Number.isFinite(minimum) ? minimum : 0;
  }

  _prepare() {
    for (const s of this.slots) { s.bone.quaternion.copy(s.restQ); s.bone.position.copy(s.restP); }
    this.frame.updateWorldMatrix(true, true);
    this.frame.getWorldQuaternion(this.frameQ);
    const hips = this.bones.Hips;
    hips.getWorldQuaternion(this.q);
    this.delta.setFromEuler(this.euler.set(-Math.PI / 2, 0, 0));
    this.delta.premultiply(this.frameQ).multiply(this.parentQ.copy(this.frameQ).invert());
    this.q.premultiply(this.delta);
    if (hips.parent) this.q.premultiply(hips.parent.getWorldQuaternion(this.parentQ).invert());
    hips.quaternion.copy(this.q); hips.updateMatrixWorld(true);
    // Shape the whole body; never inherit a planted idle knee or swinging arm.
    this._aim('Spine', 'Spine1', 0, .015, -1);
    this._aim('Spine1', 'Spine2', 0, .025, -1);
    this._aim('Spine2', 'Neck', 0, .025, -1);
    this._aim('LeftUpLeg', 'LeftLeg', .07, .12, 1);
    this._aim('LeftLeg', 'LeftFoot', .02, -.12, 1);
    this._aim('RightUpLeg', 'RightLeg', -.07, .04, 1);
    this._aim('RightLeg', 'RightFoot', -.02, -.04, 1);
    this._aim('LeftFoot', null, .05, .9, .25);
    this._aim('RightFoot', null, -.05, .9, .25);
    this._aim('LeftArm', 'LeftForeArm', .32, .02, .95);
    this._aim('LeftForeArm', null, -.30, .4, -.8);
    this._aim('RightArm', 'RightForeArm', -.17, .025, 1);
    this._aim('RightForeArm', null, .12, .015, 1);
    this._lift(-this._bottom() + .006);
    for (const s of this.slots) { s.targetQ.copy(s.bone.quaternion); s.targetP.copy(s.bone.position); }
    // Cache the contact envelope once. Updating a sleeping body then samples only
    // potential support vertices instead of skinning every garment each frame.
    this.support = new Map(this.meshes.map(mesh => [mesh, new Set()]));
    for (let step = 0; step <= 12; step++) {
      const w = step / 12;
      for (const s of this.slots) {
        s.bone.quaternion.copy(s.restQ).slerp(s.targetQ, w);
        s.bone.position.copy(s.restP).lerp(s.targetP, w);
      }
      this._bottom(true);
    }
    this.ready = true;
  }

  /** Call after the mixer, and restore before the following mixer evaluation. */
  apply(dt, sleeping) {
    this.restore();
    if (!this.frame || !this.bones.Hips || !this.bones.Head || !this.slots.length) return;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.time += elapsed;
    this.weight += ((sleeping ? 1 : 0) - this.weight) * -Math.expm1(-5 * elapsed);
    if (!sleeping && this.weight < .001) { this.weight = 0; return; }
    if (this.weight < .00001) return;
    for (const s of this.slots) { s.baseQ.copy(s.bone.quaternion); s.baseP.copy(s.bone.position); }
    this.active = true;
    if (!this.ready) this._prepare();
    for (const s of this.slots) {
      s.bone.quaternion.copy(s.baseQ).slerp(s.targetQ, this.weight);
      s.bone.position.copy(s.baseP).lerp(s.targetP, this.weight);
    }
    // During the transition the legs describe arcs. Lift just enough to prevent
    // the visible mesh crossing the ground; at rest the cached target is supported.
    // The lift leaves with the pose: near the end the feet are the animation's, and a
    // walking toe dips below the ground on every step, bobbing the hips with it.
    if (this.weight < .999) this._lift(Math.min(1, 8 * this.weight) * Math.max(0, .006 - this._bottom()));
  }
}
