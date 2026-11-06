// src/systems/PoopSequence.js
// La escena de hacer popó, paso a paso y sin tocar el mundo: bajarse el pantalón, agacharse, popó y
// chichi, pararse y subírselo. Cada cuadro devuelve en qué va; PoopSystem lo aplica al jugador y al piso.

export const POOP_STEPS = Object.freeze([
  { id: 'bajarse', action: 'bajarse', duration: .9 },
  { id: 'agacharse', action: 'cagar', duration: .6 },
  { id: 'popo', action: 'cagar', duration: 2.6 },
  { id: 'pararse', action: 'cagar', duration: .6 },
  { id: 'subirse', action: 'subirse', duration: .8 }
]);
export const POOP_SEQUENCE_LENGTH = POOP_STEPS.reduce((sum, step) => sum + step.duration, 0);

// Desde el inicio del paso `popo`, en segundos.
export const PIECE_TIMES = [.35, .85, 1.3, 1.75, 2.15];
export const PIECE_FALL = .28;
export const PEE_START = .25, PEE_GROW = 1.8, STREAM_FROM = .2, STREAM_TO = 1.9;
/** Con el pantalón así de abajo ya se ve piel de la cadera: desde ahí va censurada. */
export const EXPOSED_DROP = .08;

const STARTS = POOP_STEPS.reduce((list, step, i) => [...list, i ? list[i - 1] + POOP_STEPS[i - 1].duration : 0], []);
const POPO = POOP_STEPS.findIndex(step => step.id === 'popo');
const POPO_AT = STARTS[POPO];
const COMPLETE_AT = POPO_AT + POOP_STEPS[POPO].duration;
const TELEPORT = 1; // metros: más que esto de golpe es una recuperación o un empujón, no la escena

const clamp01 = x => Math.max(0, Math.min(1, x));
const smoothstep = x => { const c = clamp01(x); return c * c * (3 - 2 * c); };

/** Por qué no puede empezar ahora, o null si puede. */
export function poopBlockReason(player) {
  if (player.isGrounded === false) return 'aire';
  if (player.isSwimming) return 'agua';
  if (player.isStunned) return 'aturdido';
  if (player.basuco && !player.basuco.stowed) return 'basuco';
  if (player.sorting) return 'basura';
  if (player.hasCart) return 'zorra';
  if (player.action != null) return 'ocupado';
  return null;
}

function stepAt(t) {
  let index = POOP_STEPS.length - 1;
  while (index > 0 && t < STARTS[index]) index--;
  return { index, step: POOP_STEPS[index], rel: t - STARTS[index] };
}

/** Cuánto ha bajado el pantalón a los `t` segundos: 0 en la cintura, 1 en las rodillas. */
export function pantsDropAt(t) {
  const { step, rel } = stepAt(t);
  if (step.id === 'bajarse') return smoothstep((rel - .3) / .6);
  if (step.id === 'subirse') return 1 - smoothstep(rel / .55);
  return 1;
}

function stanceAt(id, rel) {
  if (id === 'bajarse') return rel < .3 ? 'pretina' : 'pantalon-rodillas';
  if (id === 'subirse') return rel < .1 ? 'pantalon-rodillas' : rel < .55 ? 'pretina' : null;
  return null;
}

/** Cuándo cambia la acción del jugador después de `t`: `cagar` dura tres pasos seguidos. */
function actionEnd(index) {
  const action = POOP_STEPS[index].action;
  let end = index;
  while (end + 1 < POOP_STEPS.length && POOP_STEPS[end + 1].action === action) end++;
  return STARTS[end] + POOP_STEPS[end].duration;
}

export class PoopSequence {
  constructor() {
    this.t = 0;
    this._active = false;
    this._action = null;
    this._from = null;
  }

  get active() { return this._active; }

  /** Empieza si el jugador está libre; devuelve si empezó. */
  start(player) {
    if (this._active || poopBlockReason(player)) return false;
    this._active = true;
    this.t = 0;
    this._action = null;
    this._from = {
      character: player.character, look: player.look,
      x: player.position?.x ?? 0, z: player.position?.z ?? 0
    };
    return true;
  }

  _broken(player) {
    const from = this._from;
    return !!(player.isStunned || player.isRagdollActive || player.isSwimming || player.isGrounded === false
      || (player.stats?.salud ?? 1) <= 0
      || player.character !== from.character || player.look !== from.look
      || Math.hypot((player.position?.x ?? 0) - from.x, (player.position?.z ?? 0) - from.z) > TELEPORT
      || player.action !== this._action);
  }

  _frame(t, previous) {
    const { index, step, rel } = stepAt(t);
    const drop = pantsDropAt(t);
    const popo = step.id === 'popo';
    let pieces = index > POPO ? PIECE_TIMES.length : 0, falling = null, pee = index > POPO ? 1 : 0;
    if (popo) {
      for (let i = 0; i < PIECE_TIMES.length; i++) {
        if (rel >= PIECE_TIMES[i] + PIECE_FALL) pieces++;
        else if (rel >= PIECE_TIMES[i] && !falling) falling = { index: i, progress: (rel - PIECE_TIMES[i]) / PIECE_FALL };
      }
      pee = clamp01((rel - PEE_START) / PEE_GROW);
    }
    const advanced = t > previous;
    return {
      t, step: step.id, stepTime: rel, action: step.action,
      actionChanged: step.action !== this._action, actionLeft: actionEnd(index) - t,
      drop, censor: drop > EXPOSED_DROP, stance: stanceAt(step.id, rel),
      pieces, falling, pee, streaming: popo && rel >= STREAM_FROM && rel <= STREAM_TO,
      fart: advanced && previous < POPO_AT && t >= POPO_AT,
      completed: advanced && previous < COMPLETE_AT && t >= COMPLETE_AT,
      finished: t >= POOP_SEQUENCE_LENGTH,
      interrupted: false
    };
  }

  /** Avanza `dt` segundos. Con `dt = 0` (pausa) repite el cuadro sin eventos. */
  update(dt, player) {
    if (!this._active) return null;
    if (this._action !== null && this._broken(player)) return this.interrupt();
    const previous = this.t;
    this.t = Math.min(POOP_SEQUENCE_LENGTH, this.t + Math.max(0, dt || 0));
    const frame = this._frame(this.t, previous);
    if (frame.actionChanged && this.t === previous && this._action !== null) frame.actionChanged = false;
    this._action = frame.action;
    if (frame.finished) this._active = false;
    return frame;
  }

  /** Corta la escena: el jugador queda vestido en el acto y no se entrega nada. */
  interrupt() {
    if (!this._active) return null;
    this._active = false;
    return {
      ...this._frame(this.t, this.t),
      actionChanged: false, drop: 0, censor: false, stance: null, falling: null, streaming: false,
      fart: false, completed: false, finished: false, interrupted: true
    };
  }
}
