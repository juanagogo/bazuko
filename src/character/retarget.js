// src/character/retarget.js
// Pasa animaciones de un esqueleto Mixamo a otro con los mismos nombres de hueso pero distinta
// pose de reposo, ejes y orientación (p. ej. de Mixamo a MakeHuman/MPFB2).
import * as THREE from 'three';

const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Mixamo exporta "mixamorigHips" y el personaje local "mixamorig:Hips".
// La clave canónica permite reutilizar el mismo clip en ambos esqueletos.
const boneKey = (name) => name.replace(/^mixamorig:?/i, 'mixamorig');
const bonesOf = (root) => {
  const map = new Map();
  root.traverse((o) => { if (o.isBone) map.set(boneKey(o.name), o); });
  return map;
};

const worldPos = (o) => o.getWorldPosition(new THREE.Vector3());

/** Giro en Y que lleva el "frente" del origen al del destino (comparando cadera izq → der). */
function facingRotation(src, tgt) {
  const side = (bones) => {
    const l = [...bones.keys()].find((n) => /LeftUpLeg$/.test(n));
    const r = [...bones.keys()].find((n) => /RightUpLeg$/.test(n));
    const v = worldPos(bones.get(l)).sub(worldPos(bones.get(r)));
    v.y = 0;
    return v.normalize();
  };
  return new THREE.Quaternion().setFromUnitVectors(side(src), side(tgt));
}

/** Rota los huesos del destino para que cada uno apunte a su hijo igual que en el origen (T-pose). */
function matchRestPose(src, tgtRoot, C) {
  const r = new THREE.Quaternion(), w = new THREE.Quaternion(), pw = new THREE.Quaternion();
  const order = [];
  tgtRoot.traverse((o) => { if (o.isBone) order.push(o); });
  for (const bone of order) {
    const key = boneKey(bone.name);
    const s = src.get(key);
    const child = bone.children.find((c) => c.isBone && src.has(boneKey(c.name)));
    if (!s || !child) continue;
    tgtRoot.updateMatrixWorld(true);
    _a.copy(worldPos(child)).sub(worldPos(bone)).normalize();
    _b.copy(worldPos(src.get(boneKey(child.name)))).sub(worldPos(s)).applyQuaternion(C).normalize();
    if (_a.lengthSq() < 1e-8 || _b.lengthSq() < 1e-8) continue;
    r.setFromUnitVectors(_a, _b);
    bone.getWorldQuaternion(w);
    bone.parent.getWorldQuaternion(pw);
    bone.quaternion.copy(pw.invert().multiply(r.multiply(w)));
  }
  tgtRoot.updateMatrixWorld(true);
}

/**
 * Prepara el retarget de srcRoot (esqueleto de las animaciones) a tgtRoot (personaje).
 * Deja el destino en la pose de reposo del origen. Devuelve retarget(clip) → clip horneado
 * solo con rotaciones (animación en el sitio):
 *   mundoDestino(t) = C · mundoOrigen(t) · reposoOrigen⁻¹ · C⁻¹ · reposoDestino
 *   localDestino(t) = mundoPadreDestino(t)⁻¹ · mundoDestino(t)
 */
export function createRetargeter(srcRoot, tgtRoot, { preserveHipHeight = false } = {}) {
  const src = bonesOf(srcRoot);
  const tgt = bonesOf(tgtRoot);
  const srcLocalRest = new Map([...src].map(([n, b]) => [n, [b.position.clone(), b.quaternion.clone(), b.scale.clone()]]));
  srcRoot.updateMatrixWorld(true);
  tgtRoot.updateMatrixWorld(true);

  const C = facingRotation(src, tgt);
  const Cinv = C.clone().invert();
  matchRestPose(src, tgtRoot, C);

  const restSrc = new Map([...src].map(([n, b]) => [n, b.getWorldQuaternion(new THREE.Quaternion())]));
  const restTgt = new Map([...tgt].map(([n, b]) => [n, b.getWorldQuaternion(new THREE.Quaternion())]));
  const restLocal = new Map([...tgt].map(([n, b]) => [n, b.quaternion.clone()]));
  const hipName = [...src.keys()].find(n => /(^|:)Hips$/.test(n) && tgt.has(n));
  const sourceHip = hipName && src.get(hipName);
  const targetHip = hipName && tgt.get(hipName);
  const sourceHipRest = sourceHip?.position.clone();
  const targetHipRest = targetHip?.position.clone();
  const heightRatio = sourceHipRest?.y ? targetHipRest.y / sourceHipRest.y : 1;
  const rootParentWorld = new Map();
  for (const [n, b] of tgt) {
    if (!b.parent?.isBone) rootParentWorld.set(n, b.parent.getWorldQuaternion(new THREE.Quaternion()));
  }
  const order = [];
  tgtRoot.traverse((o) => { if (o.isBone) order.push(o); });

  const restoreSource = () => {
    for (const [n, [p, q, s]] of srcLocalRest) {
      const b = src.get(n);
      b.position.copy(p); b.quaternion.copy(q); b.scale.copy(s);
    }
    srcRoot.updateMatrixWorld(true);
  };

  return function retarget(srcClip, fps = 30) {
    const mixer = new THREE.AnimationMixer(srcRoot);
    const sampleAction = mixer.clipAction(srcClip);
    sampleAction.setLoop(THREE.LoopOnce, 1);
    sampleAction.clampWhenFinished = true;
    sampleAction.play();
    const frames = Math.max(2, Math.round(srcClip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const values = new Map([...tgt.keys()].map((n) => [n, new Float32Array(frames * 4)]));
    const hipPositions = preserveHipHeight && sourceHip ? new Float32Array(frames * 3) : null;
    const world = new Map();

    for (let f = 0; f < frames; f++) {
      const t = Math.min(srcClip.duration, f / fps);
      times[f] = t;
      mixer.setTime(t);
      if (hipPositions) {
        hipPositions.set([targetHipRest.x,
          targetHipRest.y + (sourceHip.position.y - sourceHipRest.y) * heightRatio,
          targetHipRest.z], f * 3);
      }
      srcRoot.updateMatrixWorld(true);
      for (const b of order) {
        const key = boneKey(b.name);
        const parentW = b.parent?.isBone ? world.get(boneKey(b.parent.name)) : rootParentWorld.get(key);
        const s = src.get(key);
        let w;
        if (s) {
          const delta = s.getWorldQuaternion(new THREE.Quaternion()).multiply(_q.copy(restSrc.get(key)).invert());
          w = C.clone().multiply(delta).multiply(Cinv).multiply(restTgt.get(key));
        } else {
          w = parentW.clone().multiply(restLocal.get(key));
        }
        world.set(key, w);
        parentW.clone().invert().multiply(w).toArray(values.get(key), f * 4);
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(srcRoot);
    restoreSource();

    const tracks = [...values].map(([n, v]) => new THREE.QuaternionKeyframeTrack(`${tgt.get(n).name}.quaternion`, times, v));
    if (hipPositions) tracks.push(new THREE.VectorKeyframeTrack(`${tgt.get(hipName).name}.position`, times, hipPositions));
    return new THREE.AnimationClip(srcClip.name, srcClip.duration, tracks);
  };
}
