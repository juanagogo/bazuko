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

    // Partículas de lluvia (Three.js Points)
    this.rainCount = 350;
    this.rainGeometry = null;
    this.rainParticles = null;
    this.rainArea = { x: 26, y: 16, z: 26 };

    // Ondas y salpicaduras en charcos de asfalto (puddle ripples)
    this.rippleMesh = null;
    this.rippleData = [];

    if (this.scene) {
      this._initRain();
      this._initRipples();
    }
  }

  _initRipples() {
    this.rippleCount = 36;
    this.rippleData = [];
    this._dummyMatrix = new THREE.Matrix4();
    this._dummyPos = new THREE.Vector3();
    this._dummyScale = new THREE.Vector3();
    this._dummyQuat = new THREE.Quaternion();
    this._dummyQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

    this.rippleGeometry = new THREE.RingGeometry(0.08, 0.18, 16);
    this.rippleMaterial = new THREE.MeshBasicMaterial({
      color: 0xbeddf5,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.rippleMesh = new THREE.InstancedMesh(this.rippleGeometry, this.rippleMaterial, this.rippleCount);
    this.rippleMesh.frustumCulled = false;
    this.rippleMesh.visible = false;

    for (let i = 0; i < this.rippleCount; i++) {
      this.rippleData.push({
        x: 0, y: -100, z: 0,
        age: Math.random() * 0.8,
        life: 0.45 + Math.random() * 0.35,
        maxScale: 1.0 + Math.random() * 0.7
      });
      this._dummyPos.set(0, -100, 0);
      this._dummyMatrix.makeTranslation(0, -100, 0);
      this.rippleMesh.setMatrixAt(i, this._dummyMatrix);
    }
    this.rippleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.rippleMesh);
  }

  _initRain() {
    const coords = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) {
      coords[i * 3] = (Math.random() - 0.5) * this.rainArea.x;
      coords[i * 3 + 1] = Math.random() * this.rainArea.y;
      coords[i * 3 + 2] = (Math.random() - 0.5) * this.rainArea.z;
    }

    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));

    const material = new THREE.PointsMaterial({
      color: 0x99bbdd,
      size: 0.12,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });

    this.rainParticles = new THREE.Points(this.rainGeometry, material);
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
      this.rainParticles.material.opacity = this.isRaining ? 0.45 : 0;
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

    // Ondas y salpicaduras en el pavimento mojado
    if (this.rippleMesh && playerPosition) {
      const active = (this.isRaining || this.wetness > 0.05);
      this.rippleMesh.visible = active;
      if (active) {
        this.rippleMaterial.opacity = 0.35 * Math.min(1.0, this.wetness * 1.5);
        for (let i = 0; i < this.rippleCount; i++) {
          const r = this.rippleData[i];
          r.age += dt;
          if (r.age >= r.life) {
            r.age = 0;
            r.life = 0.45 + Math.random() * 0.35;
            r.x = playerPosition.x + (Math.random() - 0.5) * 26;
            r.z = playerPosition.z + (Math.random() - 0.5) * 26;
            const gh = district?.getGroundHeight?.(r.x, r.z) ?? 0;
            r.y = gh + 0.025;
            r.maxScale = 1.0 + Math.random() * 0.8;
          }
          const progress = Math.min(1.0, r.age / r.life);
          const currentScale = (0.2 + progress * r.maxScale);
          this._dummyPos.set(r.x, r.y, r.z);
          this._dummyScale.set(currentScale, currentScale, currentScale);
          this._dummyMatrix.compose(this._dummyPos, this._dummyQuat, this._dummyScale);
          this.rippleMesh.setMatrixAt(i, this._dummyMatrix);
        }
        this.rippleMesh.instanceMatrix.needsUpdate = true;
      }
    }

    if (!this.isRaining || !this.rainParticles || !this.rainGeometry || !playerPosition) return;

    // Acompaña al jugador
    this.rainParticles.position.x = playerPosition.x;
    this.rainParticles.position.z = playerPosition.z;

    // Caída de gotas
    const positions = this.rainGeometry.attributes.position.array;
    const speed = 24 * dt;
    for (let i = 1; i < positions.length; i += 3) {
      positions[i] -= speed;
      if (positions[i] < 0) {
        positions[i] = this.rainArea.y;
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
    if (this.rippleMesh && this.scene) {
      this.scene.remove(this.rippleMesh);
      this.rippleGeometry?.dispose();
      this.rippleMaterial?.dispose();
    }
  }
}
