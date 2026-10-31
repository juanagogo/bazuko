/** Ventanas largas e histéresis para no cambiar resolución por un tirón aislado. */
export class AdaptiveResolution {
  constructor(deviceRatio = 1) {
    this.max = 1;
    this.min = 1;
    this.ratio = this.max;
    this.pressure = 0;
    this.resetWindow();
  }

  resetWindow() { this.elapsed = 0; this.frames = 0; this.work = 0; this.slowFrames = 0; this.fastWindows = 0; }

  setLimit(max) {
    this.max = 1;
    this.min = 1;
    this.ratio = 1;
    this.pressure = 0;
    this.resetWindow();
  }

  sample(frameMs, workMs = 0) {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return false;
    this.elapsed += frameMs;
    this.frames++;
    if (frameMs > 1000 / 58) this.slowFrames++;
    this.work += Number.isFinite(workMs) ? Math.max(0, workMs) : 0;
    const fps = this.frames * 1000 / this.elapsed;
    // Ocho cuadros lentos como mínimo: un tirón aislado no cambia la calidad.
    const severe = fps < 30 && this.elapsed >= 1000 && this.frames >= 8;
    if (this.elapsed < 3000 && !severe) return false;
    const work = this.work / this.frames;
    const sustained = this.slowFrames / this.frames >= .2;
    this.elapsed = this.frames = this.work = this.slowFrames = 0;
    const before = this.ratio;
    const previousPressure = this.pressure;
    // El objetivo son 60 FPS: 50–57 sostenidos también requieren aliviar carga.
    if (fps < 58 && sustained) {
      if (this.ratio > this.min) this.ratio = Math.max(this.min, Math.round((this.ratio - (severe ? .3 : .15)) * 100) / 100);
      else this.pressure = Math.min(2, this.pressure + 1);
      this.fastWindows = 0;
    } else if (fps > 59 && work < 12) {
      if (++this.fastWindows >= 4) {
        if (this.pressure) this.pressure--;
        else this.ratio = Math.min(this.max, Math.round((this.ratio + .15) * 100) / 100);
        this.fastWindows = 0;
      }
    } else this.fastWindows = 0;
    return this.ratio !== before || this.pressure !== previousPressure;
  }
}
