// src/systems/SubstanceEffects.js
// Efectos de consumo: lo que se ve y se oye al consumir pegante, pastilla o hierba.
// La duración avanza con la simulación; los desvanecidos de cortes y reemplazos, con el tiempo real,
// porque la escena se sigue dibujando en pausa y un corte instantáneo se vería.
import { SubstanceAudio } from './SubstanceAudio.js';
import { EFFECT_CUT_FADE, EFFECT_FADE_IN, EFFECT_FADE_OUT, SUBSTANCE_EFFECTS } from '../data/substanceEffects.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
const TAU = Math.PI * 2;
// Sobre el juego y bajo el HUD: van justo después del canvas, sin z-index positivo.
const LAYER_CSS = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:0;opacity:0';

const FILTER_PARTS = [
  ['blur', 'blur', 'px'], ['sepia', 'sepia', ''], ['hueRotate', 'hue-rotate', 'deg'],
  ['saturate', 'saturate', ''], ['brightness', 'brightness', ''], ['contrast', 'contrast', '']
];

/** Arma `filter` de CSS en un orden fijo; en calidad baja se omite `blur`, el más costoso. */
export function filterCss(parts, { blur = true } = {}) {
  return FILTER_PARTS
    .filter(([key]) => parts[key] !== undefined && (blur || key !== 'blur'))
    .map(([key, name, unit]) => `${name}(${+parts[key].toFixed(3)}${unit})`)
    .join(' ');
}

export class SubstanceEffects {
  constructor({
    canvas = null, audio = null, sound = new SubstanceAudio(audio), eventTarget = globalThis.window,
    now = () => performance.now(), reducedMotion = prefersReducedMotion()
  } = {}) {
    this.canvas = canvas;
    this.sound = sound;
    this.eventTarget = eventTarget;
    this.now = now;
    this.calm = reducedMotion ? 0.2 : 1;

    // `elapsed` mide la duración y se renueva; `phase` mueve colores y cámara y nunca se reinicia.
    this._effect = null;  // { id, recipe, elapsed, phase, intensity }
    this._fade = null;    // { id, recipe, from, start, t }: efecto que se desvanece en tiempo real
    this._queued = null;  // sustancia que espera a que termine el desvanecido
    this._shown = false;  // el cuadro anterior dibujó el efecto
    this._restore = null; // cámara antes del render
    this._trailOn = false;

    // Estela (promedio de los últimos cuadros) y capa de color.
    this._trail = this._overlay = this._trailCtx = null;
    const doc = canvas?.ownerDocument ?? globalThis.document;
    if (canvas?.after && doc) {
      const layer = (tag) => {
        const el = doc.createElement(tag);
        el.style.cssText = LAYER_CSS;
        return el;
      };
      this._trail = layer('canvas');
      this._overlay = layer('div');
      canvas.after(this._trail, this._overlay);
      this._trailCtx = this._trail.getContext?.('2d') ?? null;
    }

    this._onConsumed = (e) => this.consume(e.detail?.id);
    eventTarget?.addEventListener?.('substance-consumed', this._onConsumed);
    // Con la pestaña oculta el juego deja de dibujar: sin esto, la capa sostenida seguiría sonando.
    this._doc = doc;
    this._onVisibility = () => { if (doc.hidden) this.sound.update(this.intensity, { paused: true }); };
    doc?.addEventListener?.('visibilitychange', this._onVisibility);
  }

  get active() {
    this._advanceFade();
    return !!(this._effect || this._fade);
  }

  get currentId() {
    this._advanceFade();
    return (this._effect ?? this._fade)?.id ?? null;
  }

  get intensity() {
    this._advanceFade();
    if (this._fade) return this._fade.from * clamp01(1 - (this.now() - this._fade.start) / (EFFECT_CUT_FADE * 1000));
    return this._effect?.intensity ?? 0;
  }

  /** @returns {boolean} false si la sustancia no tiene efecto (p. ej. tintico) */
  consume(id) {
    if (!SUBSTANCE_EFFECTS[id]) return false;
    this._advanceFade();
    this.sound.playOnset(id);
    if (this._effect?.id === id) {
      // Misma sustancia: renueva la duración sin bajar la intensidad.
      this._effect.elapsed = 0;
    } else if (this._effect || this._fade) {
      this._fadeOut();
      this._queued = id;
    } else {
      this._start(id);
    }
    return true;
  }

  /** Solo en cuadros sin pausa: menús, inventario, sueño y pestaña oculta congelan el efecto. */
  update(dt) {
    this._advanceFade();
    const fx = this._effect;
    if (!fx) return;
    fx.elapsed += dt;
    fx.phase += dt;
    if (fx.elapsed >= fx.recipe.seconds) {
      this._effect = null;
      this.sound.stopSustain();
      return;
    }
    fx.intensity = Math.min(fx.intensity + dt / EFFECT_FADE_IN, clamp01((fx.recipe.seconds - fx.elapsed) / EFFECT_FADE_OUT));
  }

  /** Corte forzado (dormir, morir, recuperarse): se desvanece, nunca de golpe. */
  end() {
    this._advanceFade();
    this._queued = null;
    this._fadeOut();
  }

  /**
   * Justo antes del render: filtro, capas y cámara del cuadro. Sin efecto no toca nada, para no
   * pisar el filtro que la psicosis escribe en cada cuadro.
   */
  beforeRender(camera, { quality = 'alta', paused = false } = {}) {
    const view = this._visible();
    const i = view?.intensity ?? 0;
    this.sound.update(i, { paused });
    this._trailOn = false;
    if (!view || i <= 0) {
      this._clearVisuals();
      return;
    }
    this._shown = true;
    const { recipe, t } = view;
    const low = quality === 'baja';
    const w = TAU * recipe.camera.hz * t;
    if (this.canvas) this.canvas.style.filter = filterCss(recipe.filter(i, t), { blur: !low });
    if (this._overlay) Object.assign(this._overlay.style, recipe.overlay(i, t));
    if (this._trail) {
      const tr = recipe.trail;
      this._trailOn = !low;
      this._trailKeep = tr.keep;
      if (low) this._trail.style.opacity = '0';
      else Object.assign(this._trail.style, {
        filter: this.canvas.style.filter,
        opacity: (tr.opacity * i * this.calm).toFixed(3),
        transform: `translateX(${(tr.sway * i * this.calm * Math.sin(w * 0.6)).toFixed(1)}px) scale(${1 + tr.breathe * i * this.calm * (1 + Math.sin(w))})`
      });
    }
    if (camera) {
      // La cámara se mueve solo durante este render y `afterRender` la devuelve.
      const c = recipe.camera;
      this._restore = { fov: camera.fov, roll: camera.rotation.z };
      camera.fov += c.fov * i * this.calm * Math.sin(w);
      camera.rotation.z += c.roll * i * this.calm * Math.sin(w * 0.8 + 1);
      camera.updateProjectionMatrix();
    }
  }

  /** Justo después del render: devuelve la cámara y copia el cuadro a la estela. */
  afterRender(camera) {
    if (this._restore && camera) {
      camera.fov = this._restore.fov;
      camera.rotation.z = this._restore.roll;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }
    this._restore = null;
    if (!this._trailOn || !this._trailCtx || !this.canvas) return;
    // Media resolución: la estela se ve suave y cuesta poco.
    const w = Math.max(1, (globalThis.innerWidth ?? 0) >> 1), h = Math.max(1, (globalThis.innerHeight ?? 0) >> 1);
    if (this._trail.width !== w || this._trail.height !== h) {
      this._trail.width = w;
      this._trail.height = h;
    }
    this._trailCtx.globalAlpha = 1 - this._trailKeep;
    this._trailCtx.drawImage(this.canvas, 0, 0, w, h);
  }

  dispose() {
    this.eventTarget?.removeEventListener?.('substance-consumed', this._onConsumed);
    this._doc?.removeEventListener?.('visibilitychange', this._onVisibility);
    this._effect = this._fade = this._queued = null;
    this._clearVisuals();
    this._trail?.remove?.();
    this._overlay?.remove?.();
    this.sound.dispose();
  }

  _visible() {
    this._advanceFade();
    if (this._fade) {
      return { recipe: this._fade.recipe, intensity: this.intensity, t: this._fade.t + (this.now() - this._fade.start) / 1000 };
    }
    if (this._effect) return { recipe: this._effect.recipe, intensity: this._effect.intensity, t: this._effect.phase };
    return null;
  }

  _clearVisuals() {
    if (!this._shown) return;
    this._shown = false;
    if (this.canvas) this.canvas.style.filter = '';
    if (this._overlay) this._overlay.style.opacity = '0';
    if (this._trail) {
      this._trail.style.opacity = '0';
      this._trailCtx?.clearRect(0, 0, this._trail.width, this._trail.height);
    }
  }

  _start(id) {
    this._effect = { id, recipe: SUBSTANCE_EFFECTS[id], elapsed: 0, phase: 0, intensity: 0 };
    this.sound.startSustain(id);
  }

  _fadeOut() {
    if (!this._effect) return;
    const { id, recipe, phase, intensity } = this._effect;
    this._fade = { id, recipe, from: intensity, start: this.now(), t: phase };
    this._effect = null;
  }

  _advanceFade() {
    if (!this._fade || this.now() - this._fade.start < EFFECT_CUT_FADE * 1000) return;
    this._fade = null;
    this.sound.stopSustain();
    const next = this._queued;
    this._queued = null;
    if (next) this._start(next);
  }
}
