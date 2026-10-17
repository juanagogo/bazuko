// src/entities/FootstepDetector.js
// Detecta el contacto de cada pie con el suelo a partir de la ANIMACION (altura mundial de los
// huesos de los pies), no con un temporizador: si el clip se frena (pausas, ritmo irregular de
// ExhaustedGait) o se detiene, los pasos se frenan/paran igual. Sin allocations por frame.
// Llamar update() DESPUES de mixer.update y gait.apply (pose final visible).

const NAMES = ['mixamorig:LeftFoot', 'mixamorig:RightFoot'];
const ON = 0.30;   // contacto cuando la altura cae por debajo de lo + ON*amp
const OFF = 0.50;  // el pie "se levanta" cuando supera lo + OFF*amp (histeresis)
const MIN_AMP = 0.03;       // m; con menos recorrido vertical el pie no se esta moviendo
const MIN_INTERVAL = 0.22;  // s entre pasos (antirrebote)
const DRIFT = 0.15;         // m/s: min/max se relajan hacia la altura actual (adapta caminar/correr)

export class FootstepDetector {
  constructor(model) {
    this.feet = [];
    for (const n of NAMES) {
      const bone = model.getObjectByName(n) || model.getObjectByName(n.replace(':', ''));
      if (bone) this.feet.push({ bone, lo: Infinity, hi: -Infinity, contact: null });
    }
    this.ok = this.feet.length === 2;
    this._cool = 0;
    this.debug = false;
  }

  /** Al quedarse quieto: el siguiente movimiento no dispara un paso espurio al arrancar. */
  reset() {
    for (const f of this.feet) f.contact = null;
    this._cool = 0;
  }

  /**
   * @returns {number} 0 = sin paso, 1 = pie izquierdo, 2 = pie derecho
   */
  update(dt, rootY = 0) {
    if (!this.ok) return 0;
    if (this._cool > 0) this._cool -= dt;
    let step = 0;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      f.bone.updateWorldMatrix(true, false);
      const y = f.bone.matrixWorld.elements[13] - rootY;

      // min/max adaptativos (se expanden al instante, se relajan despacio)
      if (y < f.lo) f.lo = y; else f.lo = Math.min(y, f.lo + DRIFT * dt);
      if (y > f.hi) f.hi = y; else f.hi = Math.max(y, f.hi - DRIFT * dt);
      const amp = f.hi - f.lo;
      if (amp < MIN_AMP) continue;

      const rel = (y - f.lo) / amp;
      if (f.contact === null) {
        f.contact = rel < ON; // estado inicial, sin disparar
      } else if (f.contact) {
        if (rel > OFF) f.contact = false;
      } else if (rel < ON) {
        f.contact = true;
        if (this._cool <= 0) {
          step = i + 1;
          this._cool = MIN_INTERVAL;
        }
      }
    }
    if (this.debug && step) console.log('[step]', step === 1 ? 'L' : 'R');
    return step;
  }
}
