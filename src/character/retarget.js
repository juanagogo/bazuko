// src/character/retarget.js
// Pasa animaciones de un esqueleto Mixamo a otro con los mismos nombres de hueso pero distinta
// pose de reposo, ejes y orientación (p. ej. de Mixamo a MakeHuman/MPFB2).
import * as THREE from 'three';

const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const bonesOf = (root) => {
  const map = new Map();
  root.traverse((o) => { if (o.isBone) map.set(o.name, o); });
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
    const s = src.get(bone.name);
    const child = bone.children.find((c) => c.isBone && src.has(c.name));
    if (!s || !child) continue;
    tgtRoot.updateMatrixWorld(true);
    _a.copy(worldPos(child)).sub(worldPos(bone)).normalize();
    _b.copy(worldPos(src.get(child.name))).sub(worldPos(s)).applyQuaternion(C).normalize();
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
 * con rotaciones y, si se pide, la altura de la cadera (animación en el sitio):
 *   mundoDestino(t) = C · mundoOrigen(t) · reposoOrigen⁻¹ · C⁻¹ · reposoDestino
 *   localDestino(t) = mundoPadreDestino(t)⁻¹ · mundoDestino(t)
 *
 * Con `flatFeet`, pie y dedos parten del reposo propio del personaje: los dos reposos apoyan la
 * planta, así que plano sigue siendo plano. Alinear el hueso con el del origen la inclinaba lo
 * que difiera la altura del tobillo, y un cuerpo de pie quedaba de puntillas.
 */
export function createRetargeter(srcRoot, tgtRoot, { preserveHipHeight = false, hipSpace = 'local', flatFeet = false } = {}) {
  const src = bonesOf(srcRoot);
  const tgt = bonesOf(tgtRoot);
  const srcLocalRest = new Map([...src].map(([n, b]) => [n, [b.position.clone(), b.quaternion.clone(), b.scale.clone()]]));
  srcRoot.updateMatrixWorld(true);
  tgtRoot.updateMatrixWorld(true);
  const ownFeet = flatFeet ? [...tgt].filter(([n]) => /(?:Foot|ToeBase)$/.test(n)).map(([n, b]) => [n, b.getWorldQuaternion(new THREE.Quaternion())]) : [];

  const C = facingRotation(src, tgt);
  const Cinv = C.clone().invert();
  matchRestPose(src, tgtRoot, C);

  const restSrc = new Map([...src].map(([n, b]) => [n, b.getWorldQuaternion(new THREE.Quaternion())]));
  const restTgt = new Map([...tgt].map(([n, b]) => [n, b.getWorldQuaternion(new THREE.Quaternion())]));
  for (const [n, q] of ownFeet) restTgt.set(n, q);
  const restLocal = new Map([...tgt].map(([n, b]) => [n, b.quaternion.clone()]));
  // El cargador de glTF quita los «:» del nombre: mixamorig:Hips llega como mixamorigHips.
  const hipName = [...src.keys()].find(n => n.replace(/[^a-z0-9]/gi, '').replace(/^mixamorig/i, '').toLowerCase() === 'hips' && tgt.has(n));
  const sourceHip = hipName && src.get(hipName);
  const targetHip = hipName && tgt.get(hipName);
  const sourceHipRest = sourceHip?.position.clone();
  const targetHipRest = targetHip?.position.clone();
  const heightRatio = sourceHipRest?.y ? targetHipRest.y / sourceHipRest.y : 1;
  const sourceHipWorldRest = sourceHip && worldPos(sourceHip);
  const targetHipWorldRest = targetHip && worldPos(targetHip);
  const legLength = bones => {
    const find = suffix => [...bones.values()].find(bone => bone.name.endsWith(suffix));
    const thigh = find('LeftUpLeg'), knee = find('LeftLeg'), foot = find('LeftFoot');
    return thigh && knee && foot ? worldPos(thigh).distanceTo(worldPos(knee)) + worldPos(knee).distanceTo(worldPos(foot)) : 0;
  };
  const sourceLegLength = hipSpace === 'world' ? legLength(src) : 0;
  const worldHeightRatio = sourceLegLength > 1e-6 ? legLength(tgt) / sourceLegLength : 1;
  const hipPosition = new THREE.Vector3();
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
      srcRoot.updateMatrixWorld(true);
      if (hipPositions) {
        if (hipSpace === 'world') {
          // Un FBX puede usar Z local arriba y centímetros. La altura se mide
          // en mundo y se escala por la pierna; nunca se copia su desplazamiento X/Z.
          const height = sourceHip.getWorldPosition(hipPosition).y - sourceHipWorldRest.y;
          hipPosition.copy(targetHipWorldRest);
          hipPosition.y += height * worldHeightRatio;
          targetHip.parent.worldToLocal(hipPosition).toArray(hipPositions, f * 3);
        } else {
          hipPositions.set([targetHipRest.x,
            targetHipRest.y + (sourceHip.position.y - sourceHipRest.y) * heightRatio,
            targetHipRest.z], f * 3);
        }
      }
      for (const b of order) {
        const parentW = b.parent?.isBone ? world.get(b.parent.name) : rootParentWorld.get(b.name);
        const s = src.get(b.name);
        let w;
        if (s) {
          const delta = s.getWorldQuaternion(new THREE.Quaternion()).multiply(_q.copy(restSrc.get(b.name)).invert());
          w = C.clone().multiply(delta).multiply(Cinv).multiply(restTgt.get(b.name));
        } else {
          w = parentW.clone().multiply(restLocal.get(b.name));
        }
        world.set(b.name, w);
        parentW.clone().invert().multiply(w).toArray(values.get(b.name), f * 4);
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(srcRoot);
    restoreSource();

    const tracks = [...values].map(([n, v]) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, v));
    if (hipPositions) tracks.push(new THREE.VectorKeyframeTrack(`${hipName}.position`, times, hipPositions));
    return new THREE.AnimationClip(srcClip.name, srcClip.duration, tracks);
  };
}
