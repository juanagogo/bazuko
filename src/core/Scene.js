import * as THREE from 'three';

const _NIGHT = new THREE.Color(0x0c131d);     // Noche azul oscuro fría
const _DAWN = new THREE.Color(0x5a6d80);      // Amanecer andino gris azulado nítido
const _DAY = new THREE.Color(0x8898a7);       // Día bogotano nublado con luz natural
const _DUSK_SKY = new THREE.Color(0x8b5545);  // Cielo del atardecer

const _SUN_DAY = new THREE.Color(0xfff2e0);
const _SUN_DAWN = new THREE.Color(0xffd9b3);
const _SUN_DUSK = new THREE.Color(0xff8c4a);
const _SUN_NIGHT = new THREE.Color(0x506580);

function createSkyDome() {
  const geo = new THREE.SphereGeometry(360, 24, 16);
  const mat = new THREE.ShaderMaterial({
    name: 'BogotaSkyShader',
    uniforms: {
      topColor: { value: new THREE.Color(0x060c15) },
      bottomColor: { value: new THREE.Color(0x121a24) },
      sunDirection: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
      sunGlowColor: { value: new THREE.Color(0xffaa55) },
      sunGlowIntensity: { value: 0.0 },
      nightFactor: { value: 1.0 },
      time: { value: 0.0 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDirection;
      uniform vec3 sunGlowColor;
      uniform float sunGlowIntensity;
      uniform float nightFactor;
      uniform float time;
      varying vec3 vWorldPosition;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec3 dir = normalize(vWorldPosition);
        float h = max(dir.y + 0.06, 0.0);
        float t = pow(h, 0.65);
        vec3 sky = mix(bottomColor, topColor, t);

        if (sunGlowIntensity > 0.01) {
          float sunDot = max(dot(dir, sunDirection), 0.0);
          sky += sunGlowColor * pow(sunDot, 5.0) * sunGlowIntensity;
        }

        if (nightFactor > 0.05 && dir.y > 0.12) {
          vec2 starCoord = floor(dir.xz / (dir.y + 0.45) * 320.0);
          float star = hash21(starCoord);
          if (star > 0.988) {
            float twinkle = 0.6 + 0.4 * sin(time * 3.5 + star * 45.0);
            sky += vec3(0.95, 0.98, 1.0) * twinkle * (star - 0.988) * 80.0 * nightFactor;
          }
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1000;
  mesh.userData.isSkyDome = true;
  return mesh;
}

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a222d);

    // Bóveda celeste procedural andina (cielo dinámico con estrellas y resplandor crepuscular)
    this.skyDome = createSkyDome();
    this.scene.add(this.skyDome);

    // Niebla atmosférica con mayor alcance para dar profundidad urbana
    this.scene.fog = new THREE.Fog(0x1a222d, 50, 180);

    // Luz ambiental: cielo azul-gris suave + rebote cálido del suelo/asfalto
    this.ambient = new THREE.HemisphereLight(0x9fb5cc, 0x4a4640, 0.85);
    this.scene.add(this.ambient);

    // Sol / luna (direccional) con sombra nítida y normalBias anti-acné
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
  }

  /**
   * Cielo de Bogotá según la hora (0–24):
   * - Noche: azul pizarra oscuro con luz lunar y bóveda estrellada
   * - Amanecer (5:30-7:30): bruma matutina andina fresca y luz dorada suave
   * - Día (8:00-17:00): cielo nublado bogotano con luz clara
   * - Atardecer (17:30-19:00): tonos cálidos ocres y ámbar
   */
  setTimeOfDay(hour, isRaining = false, wetness = 0) {
    const day = THREE.MathUtils.smoothstep(hour, 6.5, 8.5) * (1 - THREE.MathUtils.smoothstep(hour, 17.0, 19.0));
    const dawn = Math.max(0, 1 - Math.abs(hour - 6.2) / 1.3);
    const dusk = Math.max(0, 1 - Math.abs(hour - 18.2) / 1.2);

    this.sun.intensity = 0.35 + day * 1.85 + dawn * 1.15 + dusk * 1.05;
    this.ambient.intensity = 0.55 + day * 0.85 + dawn * 0.50 + dusk * 0.40;
    this.scene.environmentIntensity = 0.45 + day * 0.55 + dawn * 0.35;

    if (dusk > 0.1) {
      this.sun.color.copy(_SUN_DAY).lerp(_SUN_DUSK, dusk);
    } else if (dawn > 0.1) {
      this.sun.color.copy(_SUN_DAY).lerp(_SUN_DAWN, dawn);
    } else if (day > 0.1) {
      this.sun.color.copy(_SUN_DAY);
    } else {
      this.sun.color.copy(_SUN_NIGHT);
    }

    const sky = new THREE.Color().copy(_NIGHT);
    if (dawn > 0.01) sky.lerp(_DAWN, dawn * 0.85);
    if (day > 0.01) sky.lerp(_DAY, day);
    if (dusk > 0.01) sky.lerp(_DUSK_SKY, dusk * 0.65);

    // Ajuste por bruma de páramo y lluvia
    const rainFactor = THREE.MathUtils.clamp((isRaining ? 0.65 : 0) + (wetness || 0) * 0.4, 0, 1);
    if (rainFactor > 0.02) {
      const mistColor = new THREE.Color(0x3e4a56);
      sky.lerp(mistColor, rainFactor * 0.45);
      this.sun.intensity *= (1 - rainFactor * 0.35);
      this.ambient.intensity *= (1 - rainFactor * 0.15);
    }

    this.scene.background.copy(sky);
    if (this.scene.fog && this.quality !== 'baja') {
      this.scene.fog.color.copy(sky);
      const baseNear = 45 + day * 30;
      const baseFar = 150 + day * 80;
      this.scene.fog.near = Math.max(25, baseNear * (1 - rainFactor * 0.38));
      this.scene.fog.far = Math.max(75, baseFar * (1 - rainFactor * 0.35));
    }

    // Actualiza la cúpula de cielo procedural
    if (this.skyDome?.material?.uniforms) {
      const skyTop = new THREE.Color(0x060c15);
      const skyBottom = new THREE.Color(0x121a24);

      if (dawn > 0.01) {
        skyTop.lerp(new THREE.Color(0x1f2e3d), dawn * 0.9);
        skyBottom.lerp(new THREE.Color(0xdc8855), dawn * 0.9);
      }
      if (day > 0.01) {
        skyTop.lerp(new THREE.Color(0x3a6088), day);
        skyBottom.lerp(new THREE.Color(0x7e94a8), day);
      }
      if (dusk > 0.01) {
        skyTop.lerp(new THREE.Color(0x271e35), dusk * 0.85);
        skyBottom.lerp(new THREE.Color(0xba5232), dusk * 0.85);
      }
      if (rainFactor > 0.02) {
        skyTop.lerp(new THREE.Color(0x384450), rainFactor * 0.55);
        skyBottom.lerp(new THREE.Color(0x4a5866), rainFactor * 0.55);
      }

      this.skyDome.material.uniforms.topColor.value.copy(skyTop);
      this.skyDome.material.uniforms.bottomColor.value.copy(skyBottom);
      this.skyDome.material.uniforms.sunGlowIntensity.value = (isRaining ? 0.15 : 1.0) * (dusk * 1.5 + dawn * 0.85);
      this.skyDome.material.uniforms.nightFactor.value = Math.max(0, 1 - day * 1.3 - dawn * 1.1 - dusk * 1.1);
    }
  }

  setQuality(level = 'alta') {
    this.quality = level;
    if (level === 'baja') {
      this.sun.castShadow = false;
      if (this.scene.fog) {
        this.scene.fog.near = 40;
        this.scene.fog.far = 130;
      }
      if (this.skyDome) this.skyDome.visible = false;
    } else if (level === 'media') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      if (this.scene.fog) {
        this.scene.fog.near = 45;
        this.scene.fog.far = 160;
      }
      if (this.skyDome) this.skyDome.visible = true;
    } else {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      if (this.skyDome) this.skyDome.visible = true;
    }
  }

  /** El sol (y su caja de sombras) sigue al jugador para sombras nítidas en un mapa grande */
  followTarget(pos, hour = 12) {
    this.sun.target.position.copy(pos);
    const isDay = hour >= 5.5 && hour <= 18.5;
    if (isDay) {
      const solarAngle = ((hour - 5.5) / 13) * Math.PI;
      const clamped = THREE.MathUtils.clamp(solarAngle, 0.22, Math.PI - 0.22);
      const sx = -Math.cos(clamped) * 45;
      const sy = Math.sin(clamped) * 60 + 20;
      const sz = 18 + Math.sin(clamped * 2) * 8;
      this.sun.position.set(pos.x + sx, sy, pos.z + sz);
    } else {
      this.sun.position.set(pos.x + 30, 60, pos.z + 18);
    }

    if (this.skyDome) {
      this.skyDome.position.set(pos.x, 0, pos.z);
      if (this.skyDome.material?.uniforms?.sunDirection) {
        this.skyDome.material.uniforms.sunDirection.value.copy(this.sun.position).sub(pos).normalize();
      }
    }
  }

  update(dt = 0) {
    if (this.skyDome?.material?.uniforms?.time) {
      this.skyDome.material.uniforms.time.value += dt;
    }
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
