// src/ui/CinematicOverlays.js
// Controla efectos cinemáticos de inmersión:
// 1. Gotas y condensación de lluvia en lente de cámara
// 2. Viñeta helada de frío bogotano (madrugadas y noches andinas)

export class CinematicOverlays {
  constructor() {
    this.rainEl = null;
    this.coldEl = null;

    this.rainIntensity = 0;
    this.coldIntensity = 0;
    this._coldOpacity = '0.00';
    this._rainOpacity = null;

    this._initElements();
  }

  _initElements() {
    if (typeof document === 'undefined') return;
    // Las gotas siguen sin conectar en index.html: seis puntos fijos parecen polvo en la pantalla.
    this.rainEl = document.getElementById('cinematic-rain');
    this.coldEl = document.getElementById('cinematic-cold');
  }

  update(dt, weather, stats, psychosis) {
    if (typeof document === 'undefined') return;
    if (!this.coldEl) this._initElements();

    // 1. Gotas de lluvia en lente: más densas con aguacero y tormenta
    const isRaining = weather?.isRaining ?? false;
    const targetRain = isRaining ? 0.55 + 0.4 * (weather.rainIntensity ?? 0.75) : 0;
    const rainSpeed = isRaining ? 1.2 : 0.4;
    this.rainIntensity += (targetRain - this.rainIntensity) * Math.min(1, dt * rainSpeed);
    const rainOpacity = this.rainIntensity.toFixed(2);
    if (this.rainEl && rainOpacity !== this._rainOpacity) {
      this._rainOpacity = rainOpacity;
      this.rainEl.style.opacity = rainOpacity;
      if (typeof this.rainEl.classList?.toggle === 'function') {
        this.rainEl.classList.toggle('active', this.rainIntensity > 0.05);
      }
    }

    // 2. Frío: el mismo que debilita al jugador. Se mete de a poco y la fogata lo quita rápido.
    const targetCold = stats?.isFreezing ? 0.7 + 0.3 * Math.min(1, weather?.rainIntensity ?? 0) : 0;
    const coldRate = targetCold > this.coldIntensity ? 0.12 : 1.6;
    this.coldIntensity += (targetCold - this.coldIntensity) * Math.min(1, dt * coldRate);
    if (this.coldIntensity < 0.002 && !targetCold) this.coldIntensity = 0;
    // De a dos centésimas: a ojo es lo mismo, y la página no se reescribe en cada cuadro mientras se mete el frío.
    const coldOpacity = (Math.round(this.coldIntensity * 50) / 50).toFixed(2);
    if (this.coldEl && coldOpacity !== this._coldOpacity) {
      this._coldOpacity = coldOpacity;
      this.coldEl.style.opacity = coldOpacity;
      if (typeof this.coldEl.classList?.toggle === 'function') {
        this.coldEl.classList.toggle('active', this.coldIntensity > 0);
      }
    }
  }

  dispose() {
    if (this.rainEl) this.rainEl.style.opacity = '0';
    if (this.coldEl) this.coldEl.style.opacity = '0';
  }
}
