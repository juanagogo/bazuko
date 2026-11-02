import { LoopOnce, LoopRepeat } from 'three';
import { animationDamping } from './SecondaryMotion.js';

const ONE_SHOT = new Set(['comer', 'beber', 'lanzar', 'saludo']);
const CROUCHED = new Set(['buscar', 'cagar']);

/** Los clips cortos llegan al gesto antes; levantarse conserva el peso del cuerpo. */
export function transitionRate(from, to) {
  if (CROUCHED.has(from) || CROUCHED.has(to)) return 6.5;
  if (ONE_SHOT.has(to)) return 16;
  if (to === 'locomocion') return 14;
  return 10;
}

/** Prepara una instancia. Nunca cambia el clip compartido ni su duración. */
export function preparePlayback(actions, state, { target, action = null, progress, scale = 1, loop }) {
  const clipAction = actions[target];
  const isGesture = clipAction && target !== 'idle' && target !== 'walk' && target !== 'run';
  const oneShot = typeof loop === 'boolean' ? !loop : ONE_SHOT.has(action);
  const restarted = oneShot && Number.isFinite(progress) && Number.isFinite(state.progress)
    && progress < state.progress - .01;
  if (isGesture && (target !== state.target || action !== state.action || restarted)) {
    clipAction.reset().setLoop(oneShot ? LoopOnce : LoopRepeat, oneShot ? 1 : Infinity);
    clipAction.clampWhenFinished = oneShot;
    clipAction.setEffectiveTimeScale(scale).play();
  }
  // El lanzamiento de .65 s y el consumo completan su recorrido durante la acción
  // del juego, aunque el banco original tenga otra duración. Sin progreso (visor)
  // el AnimationMixer conserva su reloj normal.
  if (isGesture && oneShot && Number.isFinite(progress)) {
    clipAction.paused = false;
    clipAction.setEffectiveTimeScale(0);
    clipAction.time = Math.max(0, Math.min(1, progress)) * clipAction.getClip().duration;
  } else if (isGesture && oneShot && Number.isFinite(state.progress)
    && target === state.target && action === state.action) {
    // Al pasar de una fase dirigida a un visor con reloj propio se continúa
    // desde la última pose; no queda heredado timeScale = 0.
    clipAction.paused = false;
    clipAction.setEffectiveTimeScale(scale);
  }
  if (target !== state.target) state.rate = transitionRate(state.target, target);
  state.target = target; state.action = action; state.progress = progress;
}

export function blendAnimationWeights(weights, target, dt, rate = 10) {
  const k = animationDamping(Number.isFinite(dt) ? dt : 0, rate);
  let total = 0;
  for (const key of Object.keys(weights)) {
    weights[key] += ((key === target ? 1 : 0) - weights[key]) * k;
    if (key !== target && weights[key] < .0001) weights[key] = 0;
    total += weights[key];
  }
  // Evita introducir la pose de enlace al retirar los restos de otro clip.
  if (total > 0) for (const key of Object.keys(weights)) weights[key] /= total;
}

/**
 * La cadera se mezcla en línea recta, pero doblar las rodillas apenas la baja al principio:
 * a media mezcla ya bajó de más y los pies atraviesan el suelo. Lo que baja de verdad sigue
 * más o menos al cuadrado del peso, así que se devuelve w·(1−w) de la bajada de cada gesto.
 */
export class HipBlend {
  constructor(actions, hips) {
    this.hips = hips;
    this.saved = 0;
    this.active = false;
    const heightOf = action => action?.getClip().tracks.find(track => track.name === `${hips.name}.position`);
    this.standing = heightOf(actions.idle)?.values[1] ?? hips.position.y;
    this.gestures = Object.entries(actions)
      .filter(([name]) => !['idle', 'walk', 'run'].includes(name))
      .map(([name, action]) => ({ name, action, track: heightOf(action), height: null }))
      .filter(gesture => gesture.track);
  }

  restore() {
    if (this.active) this.hips.position.y = this.saved;
    this.active = false;
  }

  apply(weights) {
    let lift = 0;
    for (const gesture of this.gestures) {
      const weight = weights[gesture.name] ?? 0;
      if (weight <= 0 || weight >= 1) continue;
      gesture.height ??= gesture.track.createInterpolant();
      lift += weight * (1 - weight) * Math.max(0, this.standing - gesture.height.evaluate(gesture.action.time)[1]);
    }
    if (lift <= 0) return;
    this.saved = this.hips.position.y;
    this.hips.position.y += lift;
    this.active = true;
  }
}
