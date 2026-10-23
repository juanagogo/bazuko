// src/ui/CinematicOverlays.js
// Controla efectos cinemáticos de inmersión:
// 1. Gotas y condensación de lluvia en lente de cámara
// 2. Viñeta helada de frío bogotano (madrugadas y noches andinas)
// 3. Aberración cromática y distorsión durante episodios de psicosis

export class CinematicOverlays {
  constructor() {
    this.rainEl = null;
    this.coldEl = null;
    this.psychosisOverlayEl = null;

    this.rainIntensity = 0;
    this.coldIntensity = 0;

    this._initElements();
  }

  _initElements() {
    if (typeof document === 'undefined') return;
    this.rainEl = document.getElementById('cinematic-rain');
    this.coldEl = document.getElementById('cinematic-cold');
    this.psychosisOverlayEl = document.getElementById('psychosis-overlay');
  }

  update(dt, weather, clock, psychosis) {
    if (typeof document === 'undefined') return;
    if (!this.rainEl || !this.coldEl) this._initElements();

    // 1. Gotas de lluvia en lente
    const isRaining = weather?.isRaining ?? false;
    const targetRain = isRaining ? 0.85 : 0;
    const rainSpeed = isRaining ? 1.2 : 0.4;
    this.rainIntensity += (targetRain - this.rainIntensity) * Math.min(1, dt * rainSpeed);
    if (this.rainEl) {
      this.rainEl.style.opacity = this.rainIntensity.toFixed(3);
      if (typeof this.rainEl.classList?.toggle === 'function') {
        this.rainEl.classList.toggle('active', this.rainIntensity > 0.05);
      }
    }

    // 2. Frío bogotano (madrugadas y noches andinas)
    const h = clock?.hour ?? 12;
    const isColdHour = h < 6.5 || h > 21.0;
    const targetCold = isColdHour ? 0.65 : 0;
    this.coldIntensity += (targetCold - this.coldIntensity) * Math.min(1, dt * 0.8);
    if (this.coldEl) {
      this.coldEl.style.opacity = this.coldIntensity.toFixed(3);
      if (typeof this.coldEl.classList?.toggle === 'function') {
        this.coldEl.classList.toggle('active', this.coldIntensity > 0.05);
      }
    }

    // 3. Aberración cromática y viñeta palpitante por Psicosis
    if (this.psychosisOverlayEl && psychosis) {
      const active = !!psychosis.active;
      if (this.psychosisOverlayEl.classList) {
        if (typeof this.psychosisOverlayEl.classList.toggle === 'function') {
          this.psychosisOverlayEl.classList.toggle('chromatic-aberration', active);
        } else if (active && typeof this.psychosisOverlayEl.classList.add === 'function') {
          this.psychosisOverlayEl.classList.add('chromatic-aberration');
        } else if (!active && typeof this.psychosisOverlayEl.classList.remove === 'function') {
          this.psychosisOverlayEl.classList.remove('chromatic-aberration');
        }
      }
    }
  }

  dispose() {
    if (this.rainEl) this.rainEl.style.opacity = '0';
    if (this.coldEl) this.coldEl.style.opacity = '0';
  }
}
