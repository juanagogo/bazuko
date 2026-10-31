// src/world/WeatherSystem.js
import * as THREE from 'three/webgpu';
import { uniform, attribute, vec3, float, mod, abs, max, mix, smoothstep } from 'three/tsl';
import { WEATHER_TYPES, RAIN_THRESHOLD, seasonForDay, pickNextWeather } from './Climate.js';

// Gotas visibles por perfil gráfico: el resto del búfer no se dibuja.
const RAIN_BUDGET = { baja: .4, media: .7, alta: 1 };
const RAIN_DROPS = 1400;
const RIPPLE_COUNT = 36;

/**
 * Las gotas caen en el vertex shader: la CPU no reescribe el búfer cada cuadro.
 * Cada gota es un segmento orientado según su velocidad (caída + viento) y su
 * posición horizontal se repite en una celda anclada al mundo, para que la
 * lluvia no se desplace con el jugador.
 */
function createRainMaterial(area) {
  // Mismo cálculo que el shader GLSL del original, en TSL: el renderer WebGPU no ejecuta ShaderMaterial.
  const uniforms = {
    uTime: uniform(0), uArea: uniform(new THREE.Vector3(area.x, area.y, area.z)), uOrigin: uniform(new THREE.Vector3()),
    uWind: uniform(new THREE.Vector2()), uSpeed: uniform(22), uLength: uniform(.55), uColor: uniform(new THREE.Color(0xaec6dc)), uOpacity: uniform(0)
  };
  const drop = attribute('aDrop', 'vec4'), tail = attribute('aTail', 'float');
  const fall = uniforms.uSpeed.mul(drop.w);
  const y = mod(drop.y.sub(uniforms.uTime.mul(fall)), uniforms.uArea.y).sub(2);
  const xz = mod(drop.xz.sub(uniforms.uOrigin.xz).add(uniforms.uWind.mul(uniforms.uTime)), uniforms.uArea.xz).sub(uniforms.uArea.xz.mul(.5));
  const velocity = vec3(uniforms.uWind.x, fall.negate(), uniforms.uWind.y);
  const material = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  material.name = 'BogotaRainShader';
  material.positionNode = vec3(xz.x, y, xz.y).sub(velocity.mul(tail.mul(uniforms.uLength).div(fall)));
  const edge = abs(xz).div(uniforms.uArea.xz.mul(.5));
  const fade = float(1).sub(smoothstep(.55, 1, max(edge.x, edge.y))).mul(mix(1, .15, tail));
  material.colorNode = uniforms.uColor;
  material.opacityNode = uniforms.uOpacity.mul(fade);
  material.uniforms = uniforms;
  return material;
}

// Desactivada temporalmente; cambiar a true para volver a tener llovizna al iniciar y en el ciclo.
export const RAIN_ENABLED = false;

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.rainEnabled = RAIN_ENABLED;
    this.weather = 'nublado';
    this.timer = 0;
    this.nextChange = 180 + Math.random() * 120; // 3 a 5 minutos
    this.isRaining = false;
    this.wetness = 0;
    this.season = seasonForDay(1);
    this.quality = 'alta';
    this.random = Math.random;

    // Valores mezclados que consumen el cielo, el audio y la interfaz.
    const start = WEATHER_TYPES.nublado;
    this.cloudCover = start.cloud;
    this.rainIntensity = 0;
    this.windStrength = start.wind;
    this.fogDensity = start.fog;
    this.lightningChance = 0;
    this.windDirection = new THREE.Vector2(.8, .6).normalize();
    this.wind = new THREE.Vector2();
    this.flash = 0;
    this._flashTime = -1;
    this._nextLightning = 6;
    this._windClock = 0;

    this.rainArea = { x: 30, y: 18, z: 30 };
    this.rainGeometry = null;
    this.rainParticles = null;
    this.rippleMesh = null;
    this.rippleData = [];

    if (this.scene) {
      this._initRain();
      this._initRipples();
    }
  }

  get type() { return WEATHER_TYPES[this.weather] ?? WEATHER_TYPES.nublado; }

  _initRipples() {
    this.rippleCount = RIPPLE_COUNT;
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
    this._dummyMatrix.makeTranslation(0, -100, 0);
    for (let i = 0; i < this.rippleCount; i++) {
      this.rippleData.push({ x: 0, y: -100, z: 0, age: Math.random() * 0.8, life: 0.45 + Math.random() * 0.35, maxScale: 1.0 + Math.random() * 0.7 });
      this.rippleMesh.setMatrixAt(i, this._dummyMatrix);
    }
    this.rippleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.rippleMesh);
  }

  _initRain() {
    const drops = new Float32Array(RAIN_DROPS * 2 * 4);
    const tails = new Float32Array(RAIN_DROPS * 2);
    const positions = new Float32Array(RAIN_DROPS * 2 * 3); // la posición real sale del shader
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = Math.random() * this.rainArea.x, y = Math.random() * this.rainArea.y;
      const z = Math.random() * this.rainArea.z, speed = .85 + Math.random() * .3;
      for (let end = 0; end < 2; end++) {
        drops.set([x, y, z, speed], (i * 2 + end) * 4);
        tails[i * 2 + end] = end;
      }
    }
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainGeometry.setAttribute('aDrop', new THREE.BufferAttribute(drops, 4));
    this.rainGeometry.setAttribute('aTail', new THREE.BufferAttribute(tails, 1));
    this.rainGeometry.setDrawRange(0, 0);

    this.rainParticles = new THREE.LineSegments(this.rainGeometry, createRainMaterial(this.rainArea));
    this.rainParticles.frustumCulled = false;
    this.rainParticles.visible = false;
    this.rainParticles.renderOrder = 5;
    this.scene.add(this.rainParticles);
  }

  setQuality(level = 'alta') {
    this.quality = RAIN_BUDGET[level] ? level : 'alta';
    this._applyRain();
  }

  /**
   * Cambia el estado del tiempo. Por defecto el cambio es inmediato (inicio de
   * partida, pruebas); `transition` mezcla nubes, lluvia y viento durante ~40 s.
   */
  setWeather(type, notify = true, { transition = false } = {}) {
    if (!WEATHER_TYPES[type] || this.weather === type) return;
    // La lluvia sigue desactivada temporalmente: los climas lluviosos se omiten hasta reactivarla.
    if (!this.rainEnabled && WEATHER_TYPES[type].rain >= RAIN_THRESHOLD) return;
    this.weather = type;
    const target = WEATHER_TYPES[type];
    if (!transition) {
      this.cloudCover = target.cloud;
      this.rainIntensity = target.rain;
      this.windStrength = target.wind * this.season.windMul;
      this.fogDensity = target.fog;
      this.lightningChance = target.lightning;
      this.isRaining = this.rainIntensity >= RAIN_THRESHOLD;
      this._applyRain();
    }

    if (notify && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: target.toast, type: 'info' } }));
      window.dispatchEvent(new CustomEvent('weather-change', {
        detail: { weather: this.weather, isRaining: target.rain >= RAIN_THRESHOLD, season: this.season.id }
      }));
    }
  }

  /** Herramienta de desarrollo: fuerza un aguacero (o lo quita) ignorando el interruptor global de lluvia. */
  forceRain(on) {
    if (on) {
      this.rainEnabled = true;
      this.setWeather('aguacero', false);
      this.timer = 0;
      this.nextChange = 600;
    } else {
      this.setWeather('nublado', false);
      this.rainEnabled = RAIN_ENABLED;
      this.nextChange = 180 + this.random() * 200;
    }
  }

  _applyRain() {
    this._appliedRain = this.rainIntensity;
    if (!this.rainParticles) return;
    const amount = this.isRaining ? THREE.MathUtils.clamp(this.rainIntensity, .2, 1) : 0;
    const material = this.rainParticles.material;
    this.rainParticles.visible = amount > 0;
    material.opacity = amount > 0 ? .3 + amount * .3 : 0;
    material.uniforms.uOpacity.value = material.opacity;
    const drops = Math.round(RAIN_DROPS * amount * RAIN_BUDGET[this.quality]);
    this.rainGeometry.setDrawRange(0, drops * 2);
  }

  _blend(dt) {
    const target = this.type;
    const k = 1 - Math.exp(-dt / 14);
    this.cloudCover += (target.cloud - this.cloudCover) * k;
    // La lluvia arranca cuando las nubes ya cerraron el cielo; al escampar baja primero.
    const rainTarget = this.cloudCover >= target.cloud - .08 ? target.rain : Math.min(target.rain, this.rainIntensity);
    this.rainIntensity += (rainTarget - this.rainIntensity) * Math.min(1, k * 1.4);
    if (Math.abs(rainTarget - this.rainIntensity) < .002) this.rainIntensity = rainTarget;
    this.windStrength += (target.wind * this.season.windMul - this.windStrength) * k;
    this.fogDensity += (target.fog - this.fogDensity) * k;
    this.lightningChance += (target.lightning - this.lightningChance) * k;
  }

  _updateLightning(dt, playerPosition) {
    if (this._flashTime >= 0) {
      this._flashTime += dt;
      const t = this._flashTime;
      // Dos destellos seguidos, como un relámpago que parpadea.
      this.flash = Math.max(0, 1 - t / .12) + (t > .18 ? Math.max(0, .7 - (t - .18) / .25) : 0);
      if (t > .5) { this._flashTime = -1; this.flash = 0; }
    }
    if (this.lightningChance < .05) return;
    this._nextLightning -= dt * this.lightningChance;
    if (this._nextLightning > 0) return;
    this._nextLightning = 5 + this.random() * 11;
    this._flashTime = 0;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      // La distancia retrasa y apaga el trueno en el audio.
      window.dispatchEvent(new CustomEvent('weather-lightning', {
        detail: { distance: 300 + this.random() * 2200, x: playerPosition?.x ?? 0, z: playerPosition?.z ?? 0 }
      }));
    }
  }

  /** `clock` es opcional: aporta día y hora para la temporada y la neblina matinal. */
  update(dt, playerPosition, district = null, clock = null) {
    if (clock) this.season = seasonForDay(clock.day);
    this.timer += dt;
    if (this.timer >= this.nextChange) {
      this.timer = 0;
      this.nextChange = 180 + this.random() * 200;
      this.setWeather(pickNextWeather(this.weather, this.season, clock?.hour ?? 12, this.random), true, { transition: true });
    }
    this._blend(dt);
    const wasRaining = this.isRaining;
    this.isRaining = this.rainIntensity >= RAIN_THRESHOLD;
    // Ajustar el presupuesto de gotas solo cuando la intensidad cambia de forma visible.
    if (wasRaining !== this.isRaining || Math.abs(this.rainIntensity - this._appliedRain) > .02) this._applyRain();
    this._updateLightning(dt, playerPosition);

    // Viento: la dirección gira lentamente y hay ráfagas suaves.
    this._windClock += dt;
    const angle = Math.atan2(this.windDirection.y, this.windDirection.x) + Math.sin(this._windClock * .013) * dt * .02;
    this.windDirection.set(Math.cos(angle), Math.sin(angle));
    const gust = 1 + Math.sin(this._windClock * .7) * .15 + Math.sin(this._windClock * 1.9) * .08;
    this.wind.copy(this.windDirection).multiplyScalar(this.windStrength * 6 * gust);

    // Acumulación y secado gradual de charcos/humedad; el sol seca más rápido.
    if (this.isRaining) {
      this.wetness = Math.min(1.0, this.wetness + dt * 0.25 * Math.max(.4, this.rainIntensity));
    } else {
      this.wetness = Math.max(0.0, this.wetness - dt * (this.weather === 'soleado' ? .07 : .04));
    }
    if (district?.setWetness && Math.abs(this.wetness - (this._sentWetness ?? -1)) > .004) {
      this._sentWetness = this.wetness;
      district.setWetness(this.wetness);
    }

    this._updateRipples(dt, playerPosition, district);

    if (!this.isRaining || !this.rainParticles || !playerPosition) return;
    this.rainParticles.position.copy(playerPosition);
    const uniforms = this.rainParticles.material.uniforms;
    uniforms.uTime.value = (uniforms.uTime.value + dt) % 600;
    uniforms.uOrigin.value.copy(playerPosition);
    uniforms.uWind.value.copy(this.wind);
    uniforms.uLength.value = .45 + this.rainIntensity * .35;
  }

  _updateRipples(dt, playerPosition, district) {
    if (!this.rippleMesh || !playerPosition) return;
    const count = this.isRaining ? Math.max(6, Math.round(this.rippleCount * this.rainIntensity)) : 0;
    this.rippleMesh.visible = count > 0;
    this.rippleMesh.count = count;
    if (!count) return;
    this.rippleMaterial.opacity = 0.35 * Math.min(1.0, this.wetness * 1.5);
    for (let i = 0; i < count; i++) {
      const r = this.rippleData[i];
      r.age += dt;
      if (r.age >= r.life) {
        r.age = 0;
        r.life = 0.45 + Math.random() * 0.35;
        r.x = playerPosition.x + (Math.random() - 0.5) * 26;
        r.z = playerPosition.z + (Math.random() - 0.5) * 26;
        r.y = (district?.getGroundHeight?.(r.x, r.z) ?? playerPosition.y) + 0.025;
        r.maxScale = 1.0 + Math.random() * 0.8;
      }
      const currentScale = 0.2 + Math.min(1.0, r.age / r.life) * r.maxScale;
      this._dummyPos.set(r.x, r.y, r.z);
      this._dummyScale.set(currentScale, currentScale, currentScale);
      this._dummyMatrix.compose(this._dummyPos, this._dummyQuat, this._dummyScale);
      this.rippleMesh.setMatrixAt(i, this._dummyMatrix);
    }
    this.rippleMesh.instanceMatrix.needsUpdate = true;
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
