import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const SAMPLES = 120;
// Proporciones de correr en las que se mide la zancada de la mezcla.
const SHARES = [0, .25, .5, .75, 1];
const CONTACT = .05;

/**
 * Metros (del modelo) que avanza el pie apoyado durante un ciclo con caminar y correr en fase,
 * mezclados con peso `share` para correr: mediana de la velocidad hacia atrás de cada dedo
 * mientras toca el suelo. Mezclar posturas no mezcla la zancada linealmente, por eso se mide.
 */
function cycleStride(root, feet, mixer, actions, share) {
  const [walk, run] = actions;
  walk.setEffectiveWeight(1 - share);
  run?.setEffectiveWeight(share);
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    walk.time = i / SAMPLES * walk.getClip().duration;
    if (run) run.time = i / SAMPLES * run.getClip().duration;
    mixer.update(0);
    root.updateMatrixWorld(true);
    samples.push(feet.map(foot => root.worldToLocal(foot.getWorldPosition(new THREE.Vector3()))));
  }
  // Apoyado: a menos de CONTACT de la altura mínima de ese mismo pie.
  const floors = [0, 1].map(f => Math.min(...samples.map(s => s[f].y)));
  const strides = [];
  for (let i = 1; i <= SAMPLES; i++) {
    for (let f = 0; f < 2; f++) {
      const p = samples[i][f], q = samples[i - 1][f];
      if (Math.max(p.y, q.y) < floors[f] + CONTACT) strides.push((q.z - p.z) * SAMPLES);
    }
  }
  strides.sort((a, b) => a - b);
  return strides[strides.length >> 1];
}

/**
 * Zancada por ciclo de la mezcla caminar/correr de un cuerpo. Devuelve null si el cuerpo no
 * tiene dedos o el clip no avanza. El cuerpo original no se modifica.
 */
export function measureLocomotion(scene, walkClip, runClip = null) {
  const root = clone(scene);
  const feet = [];
  root.traverse(o => { if (o.isBone && /(Left|Right)ToeBase$/.test(o.name)) feet.push(o); });
  if (feet.length !== 2) return null;
  const mixer = new THREE.AnimationMixer(root);
  const actions = [walkClip, runClip].filter(Boolean).map(clip => mixer.clipAction(clip).play());
  const strides = (runClip ? SHARES : [0]).map(share => cycleStride(root, feet, mixer, actions, share));
  mixer.uncacheRoot(root);
  if (!strides.every(stride => stride > .05)) return null;
  return { walkDuration: walkClip.duration, runDuration: runClip?.duration ?? null, strides };
}

/**
 * Peso de correr y ciclos por segundo para que la zancada coincida con `speed`. La proporción se
 * elige donde la mezcla, a su cadencia natural, ya avanza a esa velocidad.
 */
export function locomotionBlend(speed, locomotion) {
  const { walkDuration, runDuration, strides } = locomotion;
  const stride = share => {
    const x = share * (strides.length - 1), i = Math.min(Math.floor(x), strides.length - 2);
    return strides.length < 2 ? strides[0] : THREE.MathUtils.lerp(strides[i], strides[i + 1], x - i);
  };
  const natural = share => stride(share) / THREE.MathUtils.lerp(walkDuration, runDuration ?? walkDuration, share);
  let share = 0;
  if (runDuration && speed >= natural(1)) share = 1;
  else if (runDuration && speed > natural(0)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (natural(mid) < speed) lo = mid; else hi = mid;
    }
    share = (lo + hi) / 2;
  }
  return { run: share, rate: speed / stride(share) };
}
