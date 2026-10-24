// src/world/WeatherSystem.js
import * as THREE from 'three';

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.weather = 'nublado'; // 'nublado' | 'llovizna'
    this.timer = 0;
    this.nextChange = 180 + Math.random() * 120; // 3 a 5 minutos
    this.isRaining = false;
    this.wetness = 0;

    // Estelas de llovizna bogotana (Three.js LineSegments)
    // Trazos finos inclinados por el viento de los cerros orientales
    this.rainCount = 400;
    this.rainGeometry = null;
    this.rainParticles = null;
    this.rainArea = { x: 30, y: 16, z: 30 };
    this.streakLength = 0.45;
    this.windX = -0.09;
    this.windZ = -0.04;

    if (this.scene) {
      this._initRain();
    }
  }

  _initRain() {
    // Cada gota son 2 vértices (inicio y fin de la estela) = 6 floats por gota
    const coords = new Float32Array(this.rainCount * 6);
    for (let i = 0; i < this.rainCount; i++) {
      const rx = (Math.random() - 0.5) * this.rainArea.x;
      const ry = Math.random() * this.rainArea.y;
      const rz = (Math.random() - 0.5) * this.rainArea.z;

      const idx = i * 6;
      // Vértice superior
      coords[idx] = rx;
      coords[idx + 1] = ry;
      coords[idx + 2] = rz;
      // Vértice inferior de la estela
      coords[idx + 3] = rx + this.windX;
      coords[idx + 4] = ry - this.streakLength;
      coords[idx + 5] = rz + this.windZ;
    }

    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0x9cb8d4,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });

    this.rainParticles = new THREE.LineSegments(this.rainGeometry, material);
    this.rainParticles.frustumCulled = false;
    this.rainParticles.visible = false;
    this.scene.add(this.rainParticles);
  }

  setWeather(type, notify = true) {
    if (this.weather === type) return;
    this.weather = type;
    this.isRaining = type === 'llovizna';

    if (this.rainParticles) {
      this.rainParticles.visible = this.isRaining;
      this.rainParticles.material.opacity = this.isRaining ? 0.55 : 0;
    }

    if (notify && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          text: this.isRaining
            ? '🌧️ Comienza a lloviznar en el centro de Bogotá…'
            : '⛅ La llovizna cesa sobre los cerros orientales.',
          type: 'info'
        }
      }));
      window.dispatchEvent(new CustomEvent('weather-change', {
        detail: { weather: this.weather, isRaining: this.isRaining }
      }));
    }
  }

  update(dt, playerPosition, district = null) {
    this.timer += dt;
    if (this.timer >= this.nextChange) {
      this.timer = 0;
      this.nextChange = 120 + Math.random() * 180;
      this.setWeather(this.weather === 'nublado' ? 'llovizna' : 'nublado');
    }

    // Acumulación y secado gradual de charcos/humedad
    if (this.isRaining) {
      this.wetness = Math.min(1.0, this.wetness + dt * 0.25);
    } else {
      this.wetness = Math.max(0.0, this.wetness - dt * 0.04);
    }
    if (district?.setWetness) {
      district.setWetness(this.wetness);
    }

    if (!this.isRaining || !this.rainParticles || !this.rainGeometry || !playerPosition) return;

    // Acompaña al jugador
    this.rainParticles.position.x = playerPosition.x;
    this.rainParticles.position.z = playerPosition.z;

    // Caída continua de las estelas
    const positions = this.rainGeometry.attributes.position.array;
    const speed = 26 * dt;
    for (let i = 0; i < this.rainCount; i++) {
      const idx = i * 6;
      positions[idx + 1] -= speed;
      positions[idx + 4] -= speed;

      if (positions[idx + 4] < 0) {
        const newY = this.rainArea.y + Math.random() * 2;
        const newX = (Math.random() - 0.5) * this.rainArea.x;
        const newZ = (Math.random() - 0.5) * this.rainArea.z;

        positions[idx] = newX;
        positions[idx + 1] = newY;
        positions[idx + 2] = newZ;
        positions[idx + 3] = newX + this.windX;
        positions[idx + 4] = newY - this.streakLength;
        positions[idx + 5] = newZ + this.windZ;
      }
    }
    this.rainGeometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    if (this.rainParticles && this.scene) {
      this.scene.remove(this.rainParticles);
      this.rainGeometry?.dispose();
      this.rainParticles.material?.dispose();
    }
  }
}
