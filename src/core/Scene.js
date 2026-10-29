import * as THREE from 'three';
import { sunDirection, moonDirection, moonPhase, moonIllumination } from '../world/Climate.js';

const smooth = THREE.MathUtils.smoothstep;
const clamp01 = value => THREE.MathUtils.clamp(value, 0, 1);
const C = hex => new THREE.Color(hex);

// Paleta del cielo bogotano: despejado, cubierto y crepuscular.
const SKY = {
  nightTop: C(0x060c15), nightTopOvercast: C(0x17151a),
  nightHorizon: C(0x121a24), nightHorizonOvercast: C(0x2b231f), // nubes con el reflejo de la ciudad
  dayTop: C(0x2f6db0), dayTopOvercast: C(0x76838f),
  dayHorizon: C(0xa9c4da), dayHorizonOvercast: C(0x9aa3ab),
  twilightTop: C(0x34405e), twilightHorizon: C(0xd49a72),
  rain: C(0x3c4651), mistDay: C(0xa9aeb2), mistNight: C(0x2b2c30), flash: C(0x8e98b0)
};
const CLOUD = {
  dayLight: C(0xf3f5f7), dayShadow: C(0x9aa6b1), overcastShadow: C(0x5e6771),
  twilightLight: C(0xe2a785), twilightShadow: C(0x6a5a66),
  nightLight: C(0x3b322d), nightShadow: C(0x1b1819), rainShadow: C(0x3c434b)
};
const SUN = { day: C(0xfff2e0), low: C(0xff9a55), overcast: C(0xdde4ec), night: C(0x506580), moon: C(0x93a7c8) };
const HEMI = { day: C(0x9fb5cc), night: C(0x55657e) };
const OCTAVES = { baja: 2, media: 3, alta: 4 };

function createSkyDome() {
  const geo = new THREE.SphereGeometry(360, 32, 16);
  const mat = new THREE.ShaderMaterial({
    name: 'BogotaSkyShader',
    uniforms: {
      topColor: { value: new THREE.Color(0x060c15) },
      bottomColor: { value: new THREE.Color(0x121a24) },
      sunDirection: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
      sunGlowColor: { value: new THREE.Color(0xffaa55) },
      sunGlowIntensity: { value: 0.0 },
      sunDisc: { value: 0.0 },
      moonDirection: { value: new THREE.Vector3(0, 1, 0) },
      moonPhase: { value: 0.5 },
      moonVisibility: { value: 0.0 },
      nightFactor: { value: 1.0 },
      cloudCover: { value: 0.5 },
      cloudOffset: { value: new THREE.Vector2() },
      cloudLight: { value: new THREE.Color(0xf3f5f7) },
      cloudShadow: { value: new THREE.Color(0x9aa6b1) },
      octaves: { value: 4 },
      flash: { value: 0.0 },
      time: { value: 0.0 }
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        // La cúpula no rota ni escala: la posición local ya es la dirección de vista.
        vDirection = position;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // Siempre en el plano lejano: la cámara de cualquier calidad la dibuja completa.
        gl_Position = clip.xyww;
        gl_Position.z = clip.w * 0.99999;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDirection;
      uniform vec3 sunGlowColor;
      uniform float sunGlowIntensity;
      uniform float sunDisc;
      uniform vec3 moonDirection;
      uniform float moonPhase;
      uniform float moonVisibility;
      uniform float nightFactor;
      uniform float cloudCover;
      uniform vec2 cloudOffset;
      uniform vec3 cloudLight;
      uniform vec3 cloudShadow;
      uniform float octaves;
      uniform float flash;
      uniform float time;
      varying vec3 vDirection;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      float fbm(vec2 p) {
        float value = 0.0, amplitude = 0.5, total = 0.0;
        for (int i = 0; i < 4; i++) {
          if (float(i) >= octaves) break;
          value += amplitude * noise(p);
          total += amplitude;
          p = p * 2.03 + vec2(17.1, 9.2);
          amplitude *= 0.5;
        }
        return value / total;
      }

      void main() {
        vec3 dir = normalize(vDirection);
        float h = max(dir.y + 0.04, 0.0);
        vec3 sky = mix(bottomColor, topColor, pow(h, 0.55));
        float sunDot = max(dot(dir, sunDirection), 0.0);
        sky += sunGlowColor * (pow(sunDot, 5.0) * 0.6 + pow(sunDot, 48.0) * 0.5) * sunGlowIntensity;

        if (nightFactor > 0.05 && dir.y > 0.12) {
          vec2 starCoord = floor(dir.xz / (dir.y + 0.45) * 320.0);
          float star = hash21(starCoord);
          if (star > 0.992) {
            float twinkle = 0.6 + 0.4 * sin(time * 3.5 + star * 45.0);
            sky += vec3(0.95, 0.98, 1.0) * twinkle * (star - 0.992) * 110.0 * nightFactor;
          }
        }

        // Luna con fase: esfera iluminada desde el lado del sol.
        float moonDot = dot(dir, moonDirection);
        if (moonVisibility > 0.01 && moonDot > 0.97) {
          vec3 right = normalize(cross(moonDirection, vec3(0.0, 1.0, 0.0)) + vec3(0.0001, 0.0, 0.0));
          vec3 up = cross(right, moonDirection);
          vec3 rel = dir - moonDirection * moonDot;
          vec2 q = vec2(dot(rel, right), dot(rel, up)) / 0.03;
          float r2 = dot(q, q);
          float angle = moonPhase * 6.2831853;
          if (r2 < 1.0) {
            vec3 normal = vec3(q, sqrt(1.0 - r2));
            float lit = smoothstep(-0.04, 0.1, dot(normal, vec3(sin(angle), 0.0, -cos(angle))));
            float maria = 0.8 + 0.2 * noise(q * 2.6 + 4.0);
            vec3 moon = vec3(0.93, 0.93, 0.88) * maria * (0.05 + lit * 1.15);
            sky = mix(sky, moon, smoothstep(1.0, 0.85, r2) * moonVisibility);
          }
          float brightness = (1.0 - cos(angle)) * 0.5;
          sky += vec3(0.55, 0.65, 0.85) * pow(max(moonDot, 0.0), 900.0) * 0.35 * brightness * moonVisibility;
        }

        // Disco solar nítido; las nubes lo tapan más abajo.
        sky += sunGlowColor * smoothstep(0.99955, 0.9998, sunDot) * sunDisc * 6.0;

        // Nubes proyectadas sobre un plano alto: densidad por fbm y umbral de cobertura.
        if (dir.y > 0.0 && cloudCover > 0.01) {
          vec2 uv = dir.xz / (dir.y + 0.12) * 1.7 + cloudOffset;
          float n = fbm(uv);
          float threshold = mix(0.74, 0.22, cloudCover);
          float density = smoothstep(threshold, threshold + 0.26, n);
          density = max(density, smoothstep(0.86, 1.0, cloudCover) * 0.92);
          density *= smoothstep(0.0, 0.14, dir.y);
          float thickness = clamp((n - threshold) * 2.2 + cloudCover * 0.35, 0.0, 1.0);
          vec3 cloud = mix(cloudLight, cloudShadow, thickness);
          cloud += sunGlowColor * pow(sunDot, 10.0) * (1.0 - thickness) * sunGlowIntensity * 0.8;
          cloud += vec3(0.75, 0.8, 0.95) * flash * (0.4 + thickness);
          sky = mix(sky, cloud, density);
          sky += sunGlowColor * pow(sunDot, 24.0) * density * (1.0 - thickness) * sunDisc * 0.5;
        }
        sky += vec3(0.5, 0.55, 0.7) * flash * 0.25;

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.userData.isSkyDome = true;
  return mesh;
}

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a222d);

    // Bóveda celeste procedural andina: sol, luna con fases, estrellas y nubes
    this.skyDome = createSkyDome();
    this.scene.add(this.skyDome);

    // Niebla atmosférica con mayor alcance para dar profundidad urbana
    this.scene.fog = new THREE.Fog(0x1a222d, 50, 180);

    // Luz ambiental: cielo azul-gris suave + rebote cálido del suelo/asfalto
    this.ambient = new THREE.HemisphereLight(0x9fb5cc, 0x4a4640, 0.85);
    this.scene.add(this.ambient);

    // Sol de día y luna de noche: una sola luz direccional con sombra
    this.sun = new THREE.DirectionalLight(0xffedd8, 1.2);
    this.sun.position.set(50, 80, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);

    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun.target);
    this.quality = 'alta';
    this.day = 1;
    this._sky = new THREE.Color();
    this._top = new THREE.Color();
    this._tmp = new THREE.Color();
    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._moonDir = new THREE.Vector3(0, 1, 0);
    this._lightDir = new THREE.Vector3(0, 1, 0);
    this._celestialKey = '';
    this._wind = new THREE.Vector2();
    this._legacyWeather = { cloudCover: .85, rainIntensity: 0, fogDensity: 1, flash: 0, wind: null };
  }

  /** Sol y luna para la hora y el día; se recalculan solo si cambian. */
  _celestial(hour, day = this.day) {
    const key = `${hour}|${day}`;
    if (key === this._celestialKey) return;
    this._celestialKey = key;
    sunDirection(hour, day, this._sunDir);
    moonDirection(hour, day, this._moonDir);
    this._phase = moonPhase(day, hour);
    this._illumination = moonIllumination(this._phase);
    // Luz direccional: el sol mientras está arriba; de noche la luna, si salió.
    if (this._sunDir.y > -0.03) this._lightDir.copy(this._sunDir);
    else if (this._moonDir.y >= 0.05) this._lightDir.copy(this._moonDir);
    else this._lightDir.set(-0.35, 1, 0.25);
    // Evita sombras infinitas con el astro sobre el horizonte.
    if (this._lightDir.y < 0.28) this._lightDir.y = 0.28;
    this._lightDir.normalize();
  }

  /**
   * Cielo e iluminación según hora, día y clima.
   * `weather` es el WeatherSystem (cloudCover, rainIntensity, fogDensity, flash, wind).
   * Por compatibilidad acepta también `(hour, isRaining, wetness)`.
   */
  setTimeOfDay(hour, weather = null, dayOrWetness = undefined) {
    if (weather == null) weather = this._lastWeather ?? this._legacyWeather;
    else if (typeof weather === 'boolean') {
      weather = Object.assign(this._legacyWeather, {
        cloudCover: weather ? .92 : .85, rainIntensity: weather ? .65 : 0, fogDensity: 1 + (dayOrWetness ?? 0) * .25
      });
    } else {
      this._lastWeather = weather;
      if (Number.isFinite(dayOrWetness)) this.day = dayOrWetness;
    }
    this._hour = hour;
    this._celestial(hour);

    const cloud = clamp01(weather.cloudCover ?? .85);
    const rain = clamp01(weather.rainIntensity ?? 0);
    const flash = weather.flash ?? 0;
    const mist = clamp01(((weather.fogDensity ?? 1) - 1) / 1.4);
    if (weather.wind) this._wind.copy(weather.wind);

    const sunAlt = this._sunDir.y, moonAlt = this._moonDir.y;
    const day = smooth(sunAlt, -0.08, 0.22);
    const night = 1 - smooth(sunAlt, -0.18, 0.02);
    const twilight = clamp01(1 - Math.abs(sunAlt - 0.02) / 0.17) * (1 - cloud * .55);
    const lowSun = 1 - smooth(sunAlt, 0.05, 0.4);
    const sunLit = smooth(sunAlt, -0.03, 0.12);
    const moonLit = smooth(moonAlt, -0.03, 0.1) * (1 - sunLit);
    const moonLight = moonLit * (0.1 + 0.3 * this._illumination) * (1 - 0.75 * cloud);

    // Luz directa: el sol pierde fuerza con las nubes; de noche queda la luna y el brillo urbano.
    this.sun.intensity = sunLit * THREE.MathUtils.lerp(2.5, 0.45, Math.pow(cloud, 1.3)) * (1 - 0.3 * rain)
      + (1 - sunLit) * (0.3 + moonLight);
    if (sunLit > 0.02) {
      this.sun.color.copy(SUN.day).lerp(SUN.low, lowSun * (1 - cloud * .6)).lerp(SUN.overcast, cloud * .5);
      this.sun.color.lerp(SUN.night, 1 - sunLit);
    } else {
      this.sun.color.copy(SUN.night).lerp(SUN.moon, clamp01(moonLight * 2.5));
    }

    // Con cielo cubierto la luz es más difusa: sube la parte ambiental.
    this.ambient.intensity = (0.55 + day * (0.8 + 0.25 * cloud) + twilight * 0.25) * (1 - 0.12 * rain) + flash * 2.2;
    this.ambient.color.copy(HEMI.night).lerp(HEMI.day, day);
    this.scene.environmentIntensity = 0.45 + day * 0.55 * (1 - 0.25 * cloud) + twilight * 0.2 + flash * .8;

    // Colores del cielo: cenit (top) y horizonte (sky = fondo y niebla).
    const top = this._top.copy(SKY.nightTop).lerp(SKY.nightTopOvercast, cloud)
      .lerp(this._tmp.copy(SKY.dayTop).lerp(SKY.dayTopOvercast, cloud), day)
      .lerp(SKY.twilightTop, twilight * 0.7);
    const sky = this._sky.copy(SKY.nightHorizon).lerp(SKY.nightHorizonOvercast, cloud)
      .lerp(this._tmp.copy(SKY.dayHorizon).lerp(SKY.dayHorizonOvercast, cloud), day)
      .lerp(SKY.twilightHorizon, twilight * 0.6);
    if (rain > 0.01) {
      top.lerp(SKY.rain, rain * 0.45);
      sky.lerp(SKY.rain, rain * 0.4);
    }
    if (mist > 0.01) sky.lerp(this._tmp.copy(SKY.mistNight).lerp(SKY.mistDay, day), mist * 0.75);
    if (flash > 0.01) sky.lerp(SKY.flash, Math.min(1, flash) * 0.5);

    this.scene.background.copy(sky);
    if (this.scene.fog) {
      this.scene.fog.color.copy(sky);
      if (this.quality !== 'baja') {
        const density = Math.max(1, weather.fogDensity ?? 1);
        this.scene.fog.near = Math.max(12, (45 + day * 30) * (1 - rain * 0.38) / density);
        this.scene.fog.far = Math.max(60, (150 + day * 80) * (1 - rain * 0.35) / Math.sqrt(density));
      } else {
        this.scene.fog.near = 40 / Math.max(1, weather.fogDensity ?? 1);
        this.scene.fog.far = 130;
      }
      this._limitFog();
    }

    const u = this.skyDome?.material?.uniforms;
    if (!u) return;
    u.topColor.value.copy(top);
    u.bottomColor.value.copy(sky);
    u.sunDirection.value.copy(this._sunDir);
    u.moonDirection.value.copy(this._moonDir);
    u.moonPhase.value = this._phase;
    u.moonVisibility.value = smooth(moonAlt, -0.02, 0.06) * (0.25 + 0.75 * night);
    u.sunGlowColor.value.copy(SUN.day).lerp(SUN.low, lowSun);
    u.sunGlowIntensity.value = (twilight * 1.0 + day * 0.35 * (1 - cloud)) * (1 - rain * 0.85);
    u.sunDisc.value = smooth(sunAlt, -0.02, 0.03) * (1 - rain);
    u.nightFactor.value = night; // las nubes tapan las estrellas en el shader
    u.cloudCover.value = cloud;
    u.flash.value = flash;
    u.cloudLight.value.copy(CLOUD.nightLight).lerp(CLOUD.dayLight, day).lerp(CLOUD.twilightLight, twilight * 0.45);
    u.cloudShadow.value.copy(CLOUD.nightShadow)
      .lerp(this._tmp.copy(CLOUD.dayShadow).lerp(CLOUD.overcastShadow, cloud), day)
      .lerp(CLOUD.twilightShadow, twilight * 0.5)
      .lerp(CLOUD.rainShadow, rain * 0.6 * day);
  }

  setQuality(level = 'alta') {
    this.quality = ['baja', 'media', 'alta'].includes(level) ? level : 'alta';
    level = this.quality;
    const size = level === 'media' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.mapPass?.dispose();
      this.sun.shadow.map = this.sun.shadow.mapPass = null;
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.needsUpdate = true;
    }
    if (level === 'baja') {
      this.sun.castShadow = false;
      if (this.scene.fog) {
        this.scene.fog.near = 40;
        this.scene.fog.far = 130;
      }
    } else if (level === 'media') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      if (this.scene.fog) {
        this.scene.fog.near = 45;
        this.scene.fog.far = 160;
      }
    } else {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
    }
    // La cúpula se dibuja en el plano lejano en todas las calidades; baja usa menos octavas de nubes.
    if (this.skyDome) {
      this.skyDome.visible = true;
      this.skyDome.material.uniforms.octaves.value = OCTAVES[level];
    }
    this.setTimeOfDay(this._hour ?? 6);
  }

  _limitFog() {
    if (!this.scene.fog) return;
    const cap = this.quality === 'baja' ? 130 : this.quality === 'media' ? 160 : 230;
    this.scene.fog.far = Math.min(this.scene.fog.far, cap);
    this.scene.fog.near = Math.min(this.scene.fog.near, this.scene.fog.far * .5, this.quality === 'baja' ? 40 : Infinity);
  }

  /** La luz direccional (y su caja de sombras) sigue al jugador para sombras nítidas en un mapa grande */
  followTarget(pos, hour = this._hour ?? 12) {
    this._celestial(hour);
    this.sun.target.position.copy(pos);
    this.sun.position.copy(this._lightDir).multiplyScalar(90).add(pos);

    if (this.skyDome) this.skyDome.position.set(pos.x, 0, pos.z);
  }

  update(dt = 0) {
    const u = this.skyDome?.material?.uniforms;
    if (!u) return;
    u.time.value += dt;
    // Las nubes derivan con el viento del clima y una corriente lenta de fondo.
    u.cloudOffset.value.x = (u.cloudOffset.value.x + (this._wind.x * 0.004 + 0.002) * dt) % 512;
    u.cloudOffset.value.y = (u.cloudOffset.value.y + (this._wind.y * 0.004 + 0.001) * dt) % 512;
  }

  /** Ajusta el color de fondo/fog según ánimo */
  applyMentalState(desaturation) {
    if (desaturation <= 0) return;
    const bg = this.scene.background;
    const fog = this.scene.fog?.color;
    if (!bg) return;

    const r = bg.r, g = bg.g, b = bg.b;
    const gray = (r + g + b) / 3;

    bg.setRGB(
      r * (1 - desaturation) + gray * desaturation,
      g * (1 - desaturation) + gray * desaturation,
      b * (1 - desaturation) + gray * desaturation
    );

    if (fog) fog.copy(bg);

    if (this.skyDome?.material?.uniforms) {
      const tc = this.skyDome.material.uniforms.topColor.value;
      const tGray = (tc.r + tc.g + tc.b) / 3;
      tc.setRGB(
        tc.r * (1 - desaturation) + tGray * desaturation,
        tc.g * (1 - desaturation) + tGray * desaturation,
        tc.b * (1 - desaturation) + tGray * desaturation
      );
      const bc = this.skyDome.material.uniforms.bottomColor.value;
      const bGray = (bc.r + bc.g + bc.b) / 3;
      bc.setRGB(
        bc.r * (1 - desaturation) + bGray * desaturation,
        bc.g * (1 - desaturation) + bGray * desaturation,
        bc.b * (1 - desaturation) + bGray * desaturation
      );
    }
  }
}
